// backend/game/engine/rules/validateAction.ts

import { GameState } from "../state/types";
import { ABILITIES } from "../../abilities/abilities";
import { blocksCardTargeting } from "./guards";
import { calculateDistance, worldUnitsToGameplayUnits } from "../state/types";
import { worldMap } from "../../map/worldMap";
import type { MapObject } from "../state/types/map";
import type { ExportedMapCollisionSystem } from "../../map/exportedMapCollision";
import { EXPORTED_MAP_WIDTH, EXPORTED_MAP_HEIGHT } from "../../map/exportedMap";

/* =========================================================
   INTERNAL HELPERS
========================================================= */

function hasEffect(player: { buffs: any[] }, type: string) {
  return player.buffs.some((b: any) =>
    b.effects.some((e: any) => e.type === type)
  );
}

function hasChargeSystem(ability: any): boolean {
  return Number(ability?.maxCharges ?? 0) > 1;
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
  options?: {
    pendingJump?: boolean;
    targetUserId?: string;
    entityTargetId?: string;
    groundTarget?: { x: number; y: number; z?: number };
    /** Map objects to use for LOS checks. Defaults to worldMap.objects if omitted. */
    mapObjects?: MapObject[];
    /** Minimum object height for LOS blocking (0 = all heights block). */
    minLOSBlockH?: number;
    /** If provided, uses BVH-based LOS instead of AABB-based (more accurate). */
    collisionSystem?: ExportedMapCollisionSystem | null;
  }
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

  ensureChargeRuntime(instance, ability);

  const hasGroundTarget =
    options?.groundTarget !== undefined &&
    Number.isFinite(options.groundTarget.x) &&
    Number.isFinite(options.groundTarget.y);
  const allowGroundCastWithoutTarget =
    ability.target === "OPPONENT" &&
    (ability as any).allowGroundCastWithoutTarget === true &&
    hasGroundTarget;

  let targetIndex = ability.target === "SELF" ? playerIndex : (playerIndex === 0 ? 1 : 0);
  if (ability.target === "OPPONENT" && options?.targetUserId) {
    const explicitTarget = state.players.findIndex((p) => p.userId === options.targetUserId);
    if (explicitTarget >= 0) targetIndex = explicitTarget;
  }
  const targetPlayer = state.players[targetIndex];
  const explicitEntity = ability.target === "OPPONENT" && options?.entityTargetId
    ? (state.entities ?? []).find((entity: any) => entity.id === options.entityTargetId) ?? null
    : null;
  if (ability.target === "OPPONENT" && options?.entityTargetId && !explicitEntity) {
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
    (ability as any).qinggong &&
    (hasEffect(player, "QINGGONG_SEAL") || hasEffect(player, "DISPLACEMENT"))
  ) {
    throw new Error("ERR_QINGGONG_SEALED");
  }

  /* ================= CHANNELING ================= */
  if ((player as any).activeChannel) {
    throw new Error("ERR_CHANNELING");
  }

  /* ================= SILENCE (Level 3 — not removable) ================= */
  if (hasEffect(player, "SILENCE")) {
    throw new Error("ERR_SILENCED");
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
  if ((ability as any).requiresStanding) {
    const jumpCount = (player as any).jumpCount ?? 0;
    const vz = (player as any).velocity?.vz ?? 0;
    const vx = (player as any).velocity?.vx ?? 0;
    const vy = (player as any).velocity?.vy ?? 0;
    const pendingJump = options?.pendingJump === true;
    const moving = Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01;

    if (jumpCount > 0 || Math.abs(vz) > 0.01 || pendingJump || moving) {
      throw new Error("ERR_REQUIRES_STANDING");
    }
  }

  /* ================= RANGE CHECK ================= */
  if (ability.range !== undefined) {
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

    if (distance > ability.range) {
      throw new Error("ERR_OUT_OF_RANGE");
    }

    if (ability.minRange !== undefined && distance < ability.minRange) {
      throw new Error("ERR_TOO_CLOSE");
    }
  }

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */
  if (ability.target === "OPPONENT" && !allowGroundCastWithoutTarget) {
    if (explicitEntity) {
      if (explicitEntity.hp <= 0 || explicitEntity.ownerUserId === player.userId) {
        throw new Error("ERR_TARGET_UNAVAILABLE");
      }
    } else {
      const enemy = targetPlayer;
      if (blocksCardTargeting(enemy)) {
        throw new Error("ERR_TARGET_UNAVAILABLE");
      }
    }

    /* ================= FACE DIRECTION (180°) ================= */
    if (requiresFacing(ability as any)) {
      if (!isInFacingHemisphere(player, { position: targetPosition })) {
        throw new Error("ERR_NOT_FACING_TARGET");
      }
    }

    /* ================= LINE OF SIGHT (structure blocking) ================= */
    const losBlocked = (() => {
      const pz = (player.position as any).z ?? 0;
      const ez = (targetPosition as any).z ?? 0;
      if (options?.collisionSystem) {
        return options.collisionSystem.checkLOS(
          player.position.x, player.position.y, pz,
          targetPosition.x, targetPosition.y, ez,
          EXPORTED_MAP_WIDTH, EXPORTED_MAP_HEIGHT,
        );
      }
      const mapObjects = options?.mapObjects ?? worldMap.objects;
      const minLOSBlockH = options?.minLOSBlockH ?? 0;
      return !!isLOSBlocked(
        player.position.x, player.position.y,
        targetPosition.x, targetPosition.y,
        mapObjects, minLOSBlockH, pz, ez,
      );
    })();
    if (losBlocked) {
      console.log(`[LOS] blocked (casterZ=${((player.position as any).z ?? 0).toFixed(2)} targetZ=${((targetPosition as any).z ?? 0).toFixed(2)})`);
      throw new Error("ERR_NO_LINE_OF_SIGHT");
    }
  }

  // ✅ All validations passed
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
  if (!instance) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }

  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = instance.abilityId || (instance as any).id;
  const ability = ABILITIES[abilityId];
  if (!ability) {
    throw new Error("ERR_ABILITY_NOT_FOUND");
  }

  ensureChargeRuntime(instance, ability);

  /* ================= QINGGONG SEAL ================= */
  if (
    (ability as any).qinggong &&
    (hasEffect(player, "QINGGONG_SEAL") || hasEffect(player, "DISPLACEMENT"))
  ) {
    throw new Error("ERR_QINGGONG_SEALED");
  }

  /* ================= COOLDOWN ================= */

  if (hasChargeSystem(ability)) {
    if ((instance.chargeLockTicks ?? 0) > 0 || (instance.chargeCount ?? 0) <= 0) {
      throw new Error("ERR_ON_COOLDOWN");
    }
  } else if (instance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= SILENCE (Level 3 — not removable) ================= */

  if (hasEffect(player, "SILENCE")) {
    throw new Error("ERR_SILENCED");
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
