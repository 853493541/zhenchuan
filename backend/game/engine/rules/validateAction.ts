// backend/game/engine/rules/validateAction.ts

import { GameState } from "../state/types";
import { ABILITIES } from "../../abilities/abilities";
import { blocksCardTargeting, hasKnockbackImmune, isActiveChannelRuntime, isRuntimeBuffActive } from "./guards";
import { calculateDistance, worldUnitsToGameplayUnits } from "../state/types";
import { worldMap } from "../../map/worldMap";
import type { MapObject } from "../state/types/map";
import type { ExportedMapCollisionSystem } from "../../map/exportedMapCollision";
import { EXPORTED_MAP_WIDTH, EXPORTED_MAP_HEIGHT } from "../../map/exportedMap";
import { isLineBlockedByEnemyChuHeHanJieWall } from "../utils/chuHeHanJieWall";
import { getEffectiveAbilityRange } from "../utils/abilityRange";
import { getOrCreateSpecialAbilityState, isSpecialAbilityBarAbility } from "../utils/specialAbilityBar";
import { hasYuqiState } from "../utils/yuqi";
import { hasMiYunConfusion } from "../utils/miyun";

const SHU_SE_BUFF_ID = 2646;
const REN_CHI_CHENG_ABILITY_ID = "ren_chi_cheng";
const EXPLICIT_GROUND_DASH_ABILITY_IDS = new Set(["gu_feng_sa_ta", "han_di", "lin_shi_fei_zhua"]);

type ValidateCastOptions = {
  ignoreActiveChannel?: boolean;
  pendingJump?: boolean;
  movementIntent?: boolean;
  targetUserId?: string;
  entityTargetId?: string;
  groundTarget?: { x: number; y: number; z?: number };
  /** Map objects to use for LOS checks. Defaults to worldMap.objects if omitted. */
  mapObjects?: MapObject[];
  /** Minimum object height for LOS blocking (0 = all heights block). */
  minLOSBlockH?: number;
  /** If provided, uses BVH-based LOS instead of AABB-based (more accurate). */
  collisionSystem?: ExportedMapCollisionSystem | null;
  /** Internal 迷云 support: let retarget validation ignore normal allegiance checks. */
  ignoreTargetAllegiance?: boolean;
  /** Internal recursion guard for confusion target enumeration. */
  ignoreMiYunRetarget?: boolean;
};

/* =========================================================
   INTERNAL HELPERS
========================================================= */

function hasEffect(player: { buffs: any[] }, type: string) {
  return player.buffs.some((b: any) =>
    isRuntimeBuffActive(b) && b.effects?.some((e: any) => e.type === type)
  );
}

function isLingRanSpecialJumpActive(player: { activeDash?: any }) {
  const dash = player.activeDash;
  return (
    dash?.abilityId === "ling_ran_tian_feng" &&
    dash.ticksRemaining > 0 &&
    dash.lingRanCastLift !== true
  );
}

function isRenChiChengBlockedByLingRan(player: { activeDash?: any }, ability: any) {
  return ability?.id === REN_CHI_CHENG_ABILITY_ID && isLingRanSpecialJumpActive(player);
}

function hasChargeSystem(ability: any): boolean {
  return Number(ability?.maxCharges ?? 0) > 1;
}

function isQinggongAbility(ability: any): boolean {
  return ability?.qinggong === true || ability?.qinggongGcdImmune === true;
}

function getAbilityDamageType(ability: any): "内功" | "外功" | undefined {
  const damageType = ability?.damageType ?? ability?.tags?.damageType;
  return damageType === "内功" || damageType === "外功" ? damageType : undefined;
}

function abilityAllowsSilence(ability: any): boolean {
  return (
    ability?.allowWhileSilenced === true ||
    (Array.isArray(ability?.effects) &&
      ability.effects.some((effect: any) => effect.allowWhileSilenced === true))
  );
}

function ensureChargeRuntime(instance: any, ability: any) {
  const maxCharges = Math.max(0, Number(ability?.maxCharges ?? 0));
  if (maxCharges <= 1) return;
  if (typeof instance.chargeCount !== "number") instance.chargeCount = maxCharges;
  if (typeof instance.chargeRegenTicksRemaining !== "number") instance.chargeRegenTicksRemaining = 0;
  if (typeof instance.chargeLockTicks !== "number") instance.chargeLockTicks = 0;
}

/**
 * Facing rule:
 * - Opponent-targeted abilities require 180° facing by default.
 * - Set faceDirection:false to explicitly opt out.
 */
function requiresFacing(ability: { target?: string; faceDirection?: boolean }): boolean {
  if (ability.target === "OPPONENT") return ability.faceDirection !== false;
  return ability.faceDirection === true;
}

/**
 * Check if a target is within 180° of the player's facing direction.
 */
function isInFacingHemisphere(
  player: { position: { x: number; y: number }; facing?: { x: number; y: number } },
  target: { position: { x: number; y: number } }
): boolean {
  const f = player.facing;
  if (!f) return true; // no facing data → allow
  const dx = target.position.x - player.position.x;
  const dy = target.position.y - player.position.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return true; // on top of each other → allow
  // dot product ≥ 0 means within 180°
  return (f.x * dx + f.y * dy) >= 0;
}

/**
 * Check if line-of-sight between two positions is blocked by any map object.
 * Uses 2D segment-vs-AABB test with optional Z-aware height filtering.
 *
 * @param minBlockH  Objects shorter than this are not considered LOS blockers.
 * @param casterZ    Caster feet height (world units).
 * @param targetZ    Target feet height (world units).
 * Returns the blocking entity id, or null if clear.
 */
const LOS_EYE_HEIGHT = 1.5; // game units above player feet
function isLOSBlocked(
  ax: number, ay: number,
  bx: number, by: number,
  objects: MapObject[],
  minBlockH: number = 0,
  casterZ: number = 0,
  targetZ: number = 0,
): string | null {
  const casterEye = casterZ + LOS_EYE_HEIGHT;
  const targetEye = targetZ + LOS_EYE_HEIGHT;
  for (const obj of objects) {
    if (obj.h < minBlockH) continue;
    // Skip if both eye-levels clear the object's top
    if (obj.h <= Math.min(casterEye, targetEye)) continue;
    if (segmentIntersectsAABB(ax, ay, bx, by, obj.x - 0.5, obj.y - 0.5, obj.x + obj.w + 0.5, obj.y + obj.d + 0.5)) {
      return obj.id;
    }
  }
  return null;
}

/** 2D segment vs AABB intersection test. */
function segmentIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // X slab
  if (Math.abs(dx) < 1e-8) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Y slab
  if (Math.abs(dy) < 1e-8) {
    if (y1 < minY || y1 > maxY) return false;
  } else {
    let t1 = (minY - y1) / dy;
    let t2 = (maxY - y1) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

function resolveMiYunCastTarget(params: {
  state: GameState;
  playerIndex: number;
  abilityInstanceId: string;
  player: { userId: string; buffs: any[] };
  options?: ValidateCastOptions;
}) {
  const { state, playerIndex, abilityInstanceId, player, options } = params;
  if (!hasMiYunConfusion(player)) return null;

  const candidates: Array<{ targetUserId?: string; entityTargetId?: string }> = [];
  const recursiveBaseOptions: ValidateCastOptions = {
    ...(options ?? {}),
    ignoreTargetAllegiance: true,
    ignoreMiYunRetarget: true,
  };

  for (const candidate of state.players) {
    if (candidate.userId === player.userId) continue;
    if ((candidate.hp ?? 0) <= 0) continue;

    try {
      validateCastAbility(state, playerIndex, abilityInstanceId, {
        ...recursiveBaseOptions,
        targetUserId: candidate.userId,
        entityTargetId: undefined,
      });
      candidates.push({ targetUserId: candidate.userId });
    } catch {
      // Ignore invalid confusion candidates.
    }
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;

    try {
      validateCastAbility(state, playerIndex, abilityInstanceId, {
        ...recursiveBaseOptions,
        targetUserId: undefined,
        entityTargetId: entity.id,
      });
      candidates.push({ entityTargetId: entity.id });
    } catch {
      // Ignore invalid confusion candidates.
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* =========================================================
   VALIDATE PLAY ABILITY (REAL-TIME BATTLE)
========================================================= */

/**
 * Validate ability cast in real-time battle
 * Checks: cooldown, range, silence
 */
export function validateCastAbility(
  state: GameState,
  playerIndex: number,
  abilityInstanceId: string,
  options?: ValidateCastOptions
) {
  if (state.gameOver) {
    throw new Error("ERR_GAME_OVER");
  }

  const player = state.players[playerIndex];

  // Accept lookup by instanceId OR by abilityId (common abilities may be cast by abilityId)
  let instance = player.hand.find(
    (c) => c.instanceId === abilityInstanceId || (c.abilityId ?? (c as any).id) === abilityInstanceId
  );

  // Auto-inject common abilities missing from hand (legacy/in-progress games)
  if (!instance) {
    const maybeCommon = ABILITIES[abilityInstanceId];
    if (maybeCommon && (maybeCommon as any).isCommon) {
      const newInst: any = { instanceId: abilityInstanceId, abilityId: abilityInstanceId, cooldown: 0 };
      if (hasChargeSystem(maybeCommon)) {
        const maxCharges = Number((maybeCommon as any).maxCharges ?? 0);
        newInst.chargeCount = maxCharges;
        newInst.chargeRegenTicksRemaining = 0;
        newInst.chargeLockTicks = 0;
      }
      player.hand.push(newInst as any);
      instance = newInst as any;
    }
  }

  if (!instance) {
    const maybeSpecial = ABILITIES[abilityInstanceId];
    if (
      maybeSpecial &&
      (maybeSpecial as any).specialBarAbility === true &&
      isSpecialAbilityBarAbility(player as any, abilityInstanceId)
    ) {
      instance = getOrCreateSpecialAbilityState(player as any, abilityInstanceId) as any;
    }
  }

  if (!instance) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }

  console.log("[validateCastAbility] DEBUG - ability instance:", {
    instanceId: instance.instanceId,
    abilityId: instance.abilityId,
    id: (instance as any).id,
    keys: Object.keys(instance).slice(0, 10),
  });

  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = instance.abilityId || (instance as any).id;
  const ability = ABILITIES[abilityId];
  if (!ability) {
    throw new Error("ERR_ABILITY_NOT_FOUND");
  }

  const yuqiMounted = hasYuqiState(player as any);
  const mountedYuqiToggle = yuqiMounted && ability.id === "yuqi";
  let resolvedTargetUserId = options?.targetUserId;
  let resolvedEntityTargetId = options?.entityTargetId;

  ensureChargeRuntime(instance, ability);

  if ((ability as any).gcd === true && Math.max(0, Number((player as any).globalGcdTicks ?? 0)) > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  const hasGroundTarget =
    options?.groundTarget !== undefined &&
    Number.isFinite(options.groundTarget.x) &&
    Number.isFinite(options.groundTarget.y);
  const allowGroundCastWithoutTarget =
    ability.target === "OPPONENT" &&
    (ability as any).friendlyTarget !== true &&
    (ability as any).allowGroundCastWithoutTarget === true &&
    hasGroundTarget;
  const isFriendlyTargetAbility =
    ability.target === "OPPONENT" && (ability as any).friendlyTarget === true;
  const miYunRetarget =
    ability.target === "OPPONENT" &&
    !hasGroundTarget &&
    !allowGroundCastWithoutTarget &&
    options?.ignoreMiYunRetarget !== true &&
    (resolvedTargetUserId !== undefined || resolvedEntityTargetId !== undefined)
      ? resolveMiYunCastTarget({
          state,
          playerIndex,
          abilityInstanceId,
          player,
          options,
        })
      : null;
  if (miYunRetarget) {
    resolvedTargetUserId = miYunRetarget.targetUserId;
    resolvedEntityTargetId = miYunRetarget.entityTargetId;
  }
  const ignoreTargetAllegiance = options?.ignoreTargetAllegiance === true || miYunRetarget !== null;
  const selfTargetRequested =
    ability.target === "OPPONENT" &&
    resolvedTargetUserId === player.userId &&
    ((ability as any).canTargetSelf === true || isFriendlyTargetAbility);

  if ((ability.id === "feng_liu_yun_san" || EXPLICIT_GROUND_DASH_ABILITY_IDS.has(ability.id)) && !hasGroundTarget) {
    throw new Error("ERR_TARGET_UNAVAILABLE");
  }

  if (
    ability.target === "OPPONENT" &&
    resolvedTargetUserId === player.userId &&
    !ignoreTargetAllegiance &&
    !selfTargetRequested
  ) {
    throw new Error("ERR_TARGET_UNAVAILABLE");
  }

  if (
    isFriendlyTargetAbility &&
    !ignoreTargetAllegiance &&
    resolvedTargetUserId &&
    resolvedTargetUserId !== player.userId
  ) {
    throw new Error("ERR_TARGET_UNAVAILABLE");
  }

  let targetIndex =
    ability.target === "SELF" || isFriendlyTargetAbility
      ? playerIndex
      : (playerIndex === 0 ? 1 : 0);
  if (ability.target === "OPPONENT" && resolvedTargetUserId) {
    const explicitTarget = state.players.findIndex((p) => p.userId === resolvedTargetUserId);
    if (explicitTarget >= 0) targetIndex = explicitTarget;
  }
  const targetPlayer = state.players[targetIndex];
  const explicitEntity = ability.target === "OPPONENT" && resolvedEntityTargetId
    ? (state.entities ?? []).find((entity: any) => entity.id === resolvedEntityTargetId) ?? null
    : null;
  if (ability.target === "OPPONENT" && resolvedEntityTargetId && !explicitEntity) {
    throw new Error("ERR_TARGET_UNAVAILABLE");
  }
  const targetPosition = explicitEntity?.position ?? targetPlayer.position;

  /* ================= COOLDOWN ================= */
  if (hasChargeSystem(ability)) {
    if ((instance.chargeLockTicks ?? 0) > 0) {
      throw new Error("ERR_ON_COOLDOWN");
    }
    if ((instance.chargeCount ?? 0) <= 0) {
      throw new Error("ERR_ON_COOLDOWN");
    }
  } else if (instance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= QINGGONG SEAL ================= */
  if (
    isQinggongAbility(ability) &&
    (hasEffect(player, "QINGGONG_SEAL") || hasEffect(player, "DISPLACEMENT"))
  ) {
    throw new Error("ERR_QINGGONG_SEALED");
  }

  if (isRenChiChengBlockedByLingRan(player, ability)) {
    throw new Error("ERR_BLOCKED_BY_BUFF");
  }

  /* ================= CHANNELING ================= */
  if (!options?.ignoreActiveChannel && isActiveChannelRuntime((player as any).activeChannel)) {
    throw new Error("ERR_CHANNELING");
  }

  if (yuqiMounted && !mountedYuqiToggle && (ability as any).canCastWhileMounted !== true) {
    throw new Error("ERR_BLOCKED_BY_BUFF");
  }

  /* ================= SILENCE (Level 3 — not removable) ================= */
  if (hasEffect(player, "SILENCE") && !abilityAllowsSilence(ability)) {
    throw new Error("ERR_SILENCED");
  }

  const abilityDamageType = getAbilityDamageType(ability);
  if (hasEffect(player, "INNER_POWER_LOCK") && abilityDamageType === "内功") {
    throw new Error("ERR_INNER_POWER_LOCKED");
  }
  if (hasEffect(player, "OUTER_POWER_LOCK") && abilityDamageType === "外功") {
    throw new Error("ERR_OUTER_POWER_LOCKED");
  }

  if (hasEffect(player, "DISARM") && (ability as any).noWeaponRequired !== true) {
    throw new Error("ERR_DISARMED");
  }

  if (hasEffect(player, "NON_QINGGONG_LOCK") && !isQinggongAbility(ability)) {
    throw new Error("ERR_NON_QINGGONG_LOCKED");
  }

  if (hasEffect(player, "DISPLACEMENT")) {
    const allowsDisplacement =
      (ability as any).allowWhileDisplaced === true ||
      (Array.isArray(ability.effects) &&
        ability.effects.some((e: any) => e.allowWhileDisplaced === true));
    if (!allowsDisplacement) {
      throw new Error("ERR_DISPLACEMENT");
    }
  }

  /* ================= KNOCKED_BACK (Level 2 — not removable) ================= */
  if (hasEffect(player, "KNOCKED_BACK")) {
    const allowsKnockback =
      (ability as any).allowWhileKnockedBack === true ||
      (Array.isArray(ability.effects) &&
        ability.effects.some((e: any) => e.allowWhileKnockedBack === true));
    if (!allowsKnockback) {
      throw new Error("ERR_KNOCKED_BACK");
    }
  }

  /* ================= PULLED (Level 2 — not removable) ================= */
  if (hasEffect(player, "PULLED")) {
    const allowsPulled =
      (ability as any).allowWhilePulled === true ||
      (Array.isArray(ability.effects) &&
        ability.effects.some((e: any) => e.allowWhilePulled === true));
    if (!allowsPulled) {
      throw new Error("ERR_PULLED");
    }
  }

  /* ================= CONTROL / ATTACK_LOCK (Level 1 — removable) ================= */
  const isControlled =
    hasEffect(player, "CONTROL") || hasEffect(player, "ATTACK_LOCK");
  const allowsOverride =
    (ability as any).allowWhileControlled === true ||
    (Array.isArray(ability.effects) &&
      ability.effects.some((e: any) => e.allowWhileControlled === true));
  if (isControlled && !allowsOverride) {
    throw new Error("ERR_CONTROLLED");
  }

  if (hasEffect(player, "ROOT") && (ability as any).cannotCastWhileRooted === true) {
    throw new Error("ERR_ROOTED");
  }

  /* (Level 0 — ROOT / SLOW only restrict movement unless ability is ROOT-locked) */

  /* ================= MIN SELF HP (exclusive, shields not counted) ================= */
  if (typeof (ability as any).minSelfHpExclusive === "number") {
    if (player.hp <= (ability as any).minSelfHpExclusive) {
      throw new Error("ERR_HP_TOO_LOW");
    }
  }
  if (typeof (ability as any).minSelfHpPercentExclusive === "number") {
    const maxHp = Math.max(1, Number(player.maxHp ?? 100));
    const requiredHp = maxHp * ((ability as any).minSelfHpPercentExclusive / 100);
    if (player.hp <= requiredHp) {
      throw new Error("ERR_HP_TOO_LOW");
    }
  }

  /* ================= 拿云式: target HP must be < 30% ================= */
  if (ability.id === "na_yun_shi") {
    const enemy = state.players[targetIndex];
    const enemyMaxHp = Math.max(1, Number(enemy?.maxHp ?? 100));
    if (!enemy || enemy.userId === player.userId || (enemy.hp ?? 0) >= enemyMaxHp * 0.3) {
      throw new Error("ERR_TARGET_HP_TOO_HIGH");
    }
  }

  /* ================= 梯云纵 / 扶摇直上 mutual exclusion ================= */
  if (ability.id === "ti_yun_zong") {
    const now = Date.now();
    const hasTanTiao = (player.buffs ?? []).some(
      (b: any) => b.buffId === 9001 && b.expiresAt > now,
    );
    if (hasTanTiao) {
      throw new Error("ERR_BLOCKED_BY_BUFF");
    }
  }
  if (ability.id === "fuyao_zhishang") {
    const now = Date.now();
    const hasTiYunZong = (player.buffs ?? []).some(
      (b: any) => b.buffId === 9003 && b.expiresAt > now,
    );
    if (hasTiYunZong) {
      throw new Error("ERR_BLOCKED_BY_BUFF");
    }
  }
  if (ability.id === "hong_meng_tian_jin") {
    const now = Date.now();
    const hasShuSe = (targetPlayer?.buffs ?? []).some(
      (b: any) => b.buffId === SHU_SE_BUFF_ID && b.expiresAt > now,
    );
    if (hasShuSe) {
      throw new Error("ERR_BLOCKED_BY_BUFF");
    }
  }
  if (ability.id === "dou_zhuan_xing_yi") {
    if (explicitEntity) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
    if (!targetPlayer || targetPlayer.userId === player.userId || (targetPlayer.hp ?? 0) <= 0) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
    if (hasKnockbackImmune(targetPlayer as any)) {
      throw new Error("ERR_BLOCKED_BY_BUFF");
    }
  }
  if (ability.id === "qin_yin_gong_ming") {
    if (explicitEntity) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
    if (!targetPlayer || targetPlayer.userId === player.userId || (targetPlayer.hp ?? 0) <= 0) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
  }

  /* ================= REQUIRES GROUNDED ================= */
  if ((ability as any).requiresGrounded) {
    const jumpCount = (player as any).jumpCount ?? 0;
    const vz = (player as any).velocity?.vz ?? 0;
    const groundedCastLockUntil = (player as any).groundedCastLockUntil ?? 0;
    const pendingJump = options?.pendingJump === true;
    if (
      jumpCount > 0 ||
      Math.abs(vz) > 0.01 ||
      groundedCastLockUntil > Date.now() ||
      pendingJump
    ) {
      throw new Error("ERR_REQUIRES_GROUNDED");
    }
  }

  /* ================= REQUIRES STANDING ================= */
  const isPureMovementCancelledChannel = ability.type === "CHANNEL" && (
    !Array.isArray(ability.buffs) ||
    ability.buffs.length === 0 ||
    (ability as any).applyBuffsOnComplete === true ||
    (ability as any).applyBuffsOnChannelStart === true
  ) && ((ability as any).channelCancelOnMove ?? true) === true;
  const requiresStandingForCast = (ability as any).requiresStanding === true || isPureMovementCancelledChannel;
  if (requiresStandingForCast && !mountedYuqiToggle) {
    const jumpCount = (player as any).jumpCount ?? 0;
    const vz = (player as any).velocity?.vz ?? 0;
    const pendingJump = options?.pendingJump === true;
    const activeDash = (player as any).activeDash;
    const moving = options?.movementIntent === true || !!(activeDash && activeDash.ticksRemaining > 0);

    if (jumpCount > 0 || Math.abs(vz) > 0.01 || pendingJump || moving) {
      throw new Error("ERR_REQUIRES_STANDING");
    }
  }

  /* ================= RANGE CHECK ================= */
  const effectiveRange = getEffectiveAbilityRange(ability as any, player.buffs);
  if (effectiveRange !== undefined) {
    const storedUnitScale = state.unitScale;
    const distance = allowGroundCastWithoutTarget
      ? worldUnitsToGameplayUnits(Math.hypot(
          (options?.groundTarget?.x ?? 0) - state.players[playerIndex].position.x,
          (options?.groundTarget?.y ?? 0) - state.players[playerIndex].position.y,
        ), storedUnitScale)
      : calculateDistance(
          state.players[playerIndex].position,
          targetPosition,
          storedUnitScale,
        );

    if (distance > effectiveRange) {
      throw new Error("ERR_OUT_OF_RANGE");
    }

    if (ability.minRange !== undefined && distance < ability.minRange) {
      throw new Error("ERR_TOO_CLOSE");
    }
  }

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */
  if (ability.target === "OPPONENT" && !allowGroundCastWithoutTarget && !selfTargetRequested) {
    if (explicitEntity) {
      if ((explicitEntity.hp ?? 0) <= 0) {
        throw new Error("ERR_TARGET_UNAVAILABLE");
      }
      if (!ignoreTargetAllegiance) {
        const invalidEntityTarget = isFriendlyTargetAbility
          ? explicitEntity.ownerUserId !== player.userId
          : explicitEntity.ownerUserId === player.userId;
        if (invalidEntityTarget) {
          throw new Error("ERR_TARGET_UNAVAILABLE");
        }
      }
    } else {
      if (ignoreTargetAllegiance) {
        if (!targetPlayer || targetPlayer.userId === player.userId || (targetPlayer.hp ?? 0) <= 0) {
          throw new Error("ERR_TARGET_UNAVAILABLE");
        }
        if (blocksCardTargeting(targetPlayer)) {
          throw new Error("ERR_TARGET_UNAVAILABLE");
        }
      } else if (isFriendlyTargetAbility) {
        if (!targetPlayer || targetPlayer.userId !== player.userId || (targetPlayer.hp ?? 0) <= 0) {
          throw new Error("ERR_TARGET_UNAVAILABLE");
        }
      } else {
        const enemy = targetPlayer;
        if (blocksCardTargeting(enemy)) {
          throw new Error("ERR_TARGET_UNAVAILABLE");
        }
      }
    }

    /* ================= FACE DIRECTION (180°) ================= */
    if (!isFriendlyTargetAbility && requiresFacing(ability as any)) {
      if (!isInFacingHemisphere(player, { position: targetPosition })) {
        throw new Error("ERR_NOT_FACING_TARGET");
      }
    }

    /* ================= LINE OF SIGHT (structure blocking) ================= */
  }

  if (ability.target === "OPPONENT" && !selfTargetRequested && !isFriendlyTargetAbility) {
    const losTargetPosition = allowGroundCastWithoutTarget
      ? {
          x: options?.groundTarget?.x ?? targetPosition.x,
          y: options?.groundTarget?.y ?? targetPosition.y,
          z: options?.groundTarget?.z ?? targetPosition.z,
        }
      : targetPosition;

    const losBlocked = (() => {
      const pz = (player.position as any).z ?? 0;
      const ez = (losTargetPosition as any).z ?? 0;
      const blockedByMap = options?.collisionSystem
        ? options.collisionSystem.checkLOS(
          player.position.x, player.position.y, pz,
          losTargetPosition.x, losTargetPosition.y, ez,
          EXPORTED_MAP_WIDTH, EXPORTED_MAP_HEIGHT,
        )
        : !!isLOSBlocked(
            player.position.x,
            player.position.y,
            losTargetPosition.x,
            losTargetPosition.y,
            options?.mapObjects ?? worldMap.objects,
            options?.minLOSBlockH ?? 0,
            pz,
            ez,
          );
      if (blockedByMap) return true;
      return isLineBlockedByEnemyChuHeHanJieWall({
        state,
        actorUserId: player.userId,
        from: player.position,
        to: losTargetPosition,
        casterZ: pz,
        targetZ: ez,
        ignoreEntityId: explicitEntity?.id,
      });
    })();
    if (losBlocked) {
      console.log(`[LOS] blocked (casterZ=${((player.position as any).z ?? 0).toFixed(2)} targetZ=${((losTargetPosition as any).z ?? 0).toFixed(2)})`);
      throw new Error("ERR_NO_LINE_OF_SIGHT");
    }
  }

  // ✅ All validations passed
  return {
    targetUserId: resolvedTargetUserId,
    entityTargetId: resolvedEntityTargetId,
    confusionRetargeted: miYunRetarget !== null,
  };
}

/* =========================================================
   VALIDATE PLAY ABILITY (TURN-BASED - Legacy)
========================================================= */

export function validatePlayAbility(
  state: GameState,
  playerIndex: number,
  abilityInstanceId: string
) {
  if (state.gameOver) {
    throw new Error("ERR_GAME_OVER");
  }

  if (state.activePlayerIndex !== playerIndex) {
    throw new Error("ERR_NOT_YOUR_TURN");
  }

  const player = state.players[playerIndex];

  const instance = player.hand.find((c) => c.instanceId === abilityInstanceId);
  const specialInstance = !instance &&
    ABILITIES[abilityInstanceId] &&
    (ABILITIES[abilityInstanceId] as any).specialBarAbility === true &&
    isSpecialAbilityBarAbility(player as any, abilityInstanceId)
      ? (getOrCreateSpecialAbilityState(player as any, abilityInstanceId) as any)
      : null;
  const resolvedInstance = instance ?? specialInstance;
  if (!resolvedInstance) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }

  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = resolvedInstance.abilityId || (resolvedInstance as any).id;
  const ability = ABILITIES[abilityId];
  if (!ability) {
    throw new Error("ERR_ABILITY_NOT_FOUND");
  }

  ensureChargeRuntime(resolvedInstance, ability);

  /* ================= QINGGONG SEAL ================= */
  if (
    isQinggongAbility(ability) &&
    (hasEffect(player, "QINGGONG_SEAL") || hasEffect(player, "DISPLACEMENT"))
  ) {
    throw new Error("ERR_QINGGONG_SEALED");
  }

  if (isRenChiChengBlockedByLingRan(player, ability)) {
    throw new Error("ERR_BLOCKED_BY_BUFF");
  }

  /* ================= COOLDOWN ================= */

  if (hasChargeSystem(ability)) {
    if ((resolvedInstance.chargeLockTicks ?? 0) > 0 || (resolvedInstance.chargeCount ?? 0) <= 0) {
      throw new Error("ERR_ON_COOLDOWN");
    }
  } else if (resolvedInstance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= SILENCE (Level 3 — not removable) ================= */

  if (hasEffect(player, "SILENCE") && !abilityAllowsSilence(ability)) {
    throw new Error("ERR_SILENCED");
  }

  const abilityDamageType = getAbilityDamageType(ability);
  if (hasEffect(player, "INNER_POWER_LOCK") && abilityDamageType === "内功") {
    throw new Error("ERR_INNER_POWER_LOCKED");
  }
  if (hasEffect(player, "OUTER_POWER_LOCK") && abilityDamageType === "外功") {
    throw new Error("ERR_OUTER_POWER_LOCKED");
  }

  if (hasEffect(player, "DISARM") && (ability as any).noWeaponRequired !== true) {
    throw new Error("ERR_DISARMED");
  }

  if (hasEffect(player, "NON_QINGGONG_LOCK") && !isQinggongAbility(ability)) {
    throw new Error("ERR_NON_QINGGONG_LOCKED");
  }

  if (hasEffect(player, "DISPLACEMENT")) {
    const allowsDisplacement =
      (ability as any).allowWhileDisplaced === true ||
      (Array.isArray(ability.effects) &&
        ability.effects.some((e) => (e as any).allowWhileDisplaced === true));
    if (!allowsDisplacement) {
      throw new Error("ERR_DISPLACEMENT");
    }
  }

  /* ================= KNOCKED_BACK (Level 2 — not removable) ================= */

  if (hasEffect(player, "KNOCKED_BACK")) {
    const allowsKnockback =
      (ability as any).allowWhileKnockedBack === true ||
      (Array.isArray(ability.effects) &&
        ability.effects.some((e) => (e as any).allowWhileKnockedBack === true));
    if (!allowsKnockback) {
      throw new Error("ERR_KNOCKED_BACK");
    }
  }

  /* ================= PULLED (Level 2 — not removable) ================= */

  if (hasEffect(player, "PULLED")) {
    const allowsPulled =
      (ability as any).allowWhilePulled === true ||
      (Array.isArray(ability.effects) &&
        ability.effects.some((e) => (e as any).allowWhilePulled === true));
    if (!allowsPulled) {
      throw new Error("ERR_PULLED");
    }
  }

  /* ================= CONTROL / ATTACK_LOCK (Level 1 — removable) ================= */

  const isControlled =
    hasEffect(player, "CONTROL") || hasEffect(player, "ATTACK_LOCK");

  const allowsOverride =
    (ability as any).allowWhileControlled === true ||
    (Array.isArray(ability.effects) &&
      ability.effects.some((e) => e.allowWhileControlled === true));

  if (isControlled && !allowsOverride) {
    throw new Error("ERR_CONTROLLED");
  }

  if (hasEffect(player, "ROOT") && (ability as any).cannotCastWhileRooted === true) {
    throw new Error("ERR_ROOTED");
  }

  /* (Level 0 — ROOT / SLOW only restrict movement unless ability is ROOT-locked) */

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */

  // Only applies to opponent-targeted abilities
  if (ability.target === "OPPONENT") {
    const enemyIndex = playerIndex === 0 ? 1 : 0;
    const enemy = state.players[enemyIndex];

    if (blocksCardTargeting(enemy)) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
  }

  // ✅ All validations passed
}
