// backend/game/engine/loop/GameLoop.ts
/**
 * Real-time game loop for 2D arena battles
 * Runs at fixed tick rate (configured per game, 30 Hz on current VM)
 * Handles:
 * - Player movement
 * - Ability casting
 * - Buff updates
 * - Win condition checks
 */

import { GameState, MovementInput, GroundZone, TargetEntity, SafeZone, calculateDistance, gameplayUnitsToWorldUnits, normalizeStoredUnitScale } from "../state/types";
import { checkGameOver, resetDefeatedPlayersForTesting } from "../flow/turn/checkGameOver";
import { broadcastGameUpdate } from "../../services/broadcast";
import { broadcastDefeatSystemChat, broadcastSystemChat, collectDefeatAnnouncementsFromEvents, type DefeatAnnouncement } from "../../services/chatMessages";
import { diffState } from "../../services/flow/stateDiff";
import GameSession from "../../models/GameSession";
import { applyMovement, resolveMapCollisions, MapContext, getGroundHeightForMap, resolveEntityHorizontalCollision } from "./movement";
import { addBuff, pushBuffExpired } from "../effects/buffRuntime";
import { resolveHealAmountRoll, resolveNonCritHealAmountRoll, resolveRawDamageWithCrit, resolveScheduledDamage, resolveScheduledDamageRoll } from "../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget, applyPiercingDamageToTarget, reconcileLinkedShieldTotal, removeLinkedShield, resolveMaxHpPercentHealAmount } from "../utils/health";
import { randomUUID } from "crypto";
import { worldMap } from "../../map/worldMap";
import { arenaMap } from "../../map/arenaMap";
import { exportedMap } from "../../map/exportedMap";
import { COLLISION_TEST_PLAYER_RADIUS, getCollisionTestExportedSystem } from "../../map/exportedMapCollision";
import { type GameMode, isExportedMapMode, isYumen1v1BasicMode } from "../../modes";
import { ABILITIES } from "../../abilities/abilities";
import { loadBuffEditorOverrides } from "../../abilities/buffEditorOverrides";
import { blocksCardTargeting, blocksEnemyTargeting, hasKnockbackImmune, hasKnockedBackImmune, hasUntargetable, hasDamageImmune, isActiveChannelRuntime, isRuntimeBuffActive, shouldDodge, shouldDodgeForAbility } from "../rules/guards";
import type { MapObject } from "../state/types/map";
import { applyTriggeredFollowUpPlayRules, breakOnPlay } from "../flow/play/breakOnPlay";
import { applyDashRuntimeBuff } from "../effects/definitions/DirectionalDash";
import { processOnDamageTaken, preCheckRedirect, applyRedirectToOpponent } from "../effects/onDamageHooks";
import { getDunLiReflectVictim } from "../effects/dunLiReflect";
import {
  pulseZhenShanHeTarget,
  transformExpiredXuanjian,
  ZHEN_SHAN_HE_ABILITY_ID,
  ZHEN_SHAN_HE_XUANJIAN_BUFF_ID,
  ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID,
} from "../effects/definitions/ZhenShanHe";
import { ZONG_QING_QI_BUFF_ID, hasYuqiState } from "../utils/yuqi";
import {
  isLineBlockedByEnemyChuHeHanJieWall,
  resolveEnemyChuHeHanJieWallCollision,
} from "../utils/chuHeHanJieWall";
import { getEffectiveAbilityRange } from "../utils/abilityRange";
import { triggerYunSanBlink } from "../utils/yunSan";
import { getMiYunAreaCandidates, hasMiYunConfusion, rerollMiYunAreaTargets } from "../utils/miyun";
import { getHasteAdjustedTimingMs } from "../utils/haste";
import { COMBAT_STATUS_CHECK_INTERVAL_MS, expireCombatStatusLinks, syncCombatStatusFromEvents } from "../utils/combatStatus";
import {
  YUMEN_KUANG_SHA_BUFF,
  YUMEN_KUANG_SHA_BUFF_ID,
  YUMEN_PIERCING_DAMAGE_TYPE,
  YUMEN_SAFE_ZONE_ABILITY,
  YUMEN_SPECTATOR_ABILITY,
  YUMEN_SPECTATOR_BUFF,
  YUMEN_PREP_BUFF_ID,
  YUMEN_SAFE_ZONE_TARGET_DIAMETERS,
  YUMEN_SAFE_ZONE_TOTAL_CIRCLES,
  YUMEN_ZHANYI_ABILITY,
  YUMEN_ZHANYI_BUFF,
  YUMEN_ZHUI_MING_BUFF,
  YUMEN_ZHUI_MING_BUFF_ID,
  YUMEN_ZHUI_MING_STACK_INTERVAL_MS,
  applyYumenKuangShaHealPenalty,
  getYumenKuangShaDamageMultiplier,
  getYumenSafeZoneCircleNumber,
  getYumenSafeZoneCountdownMs,
  getYumenSafeZoneDps,
  getYumenSafeZoneShrinkMs,
  getYumenSafeZoneWaitMs,
  hasActiveYumenPrepBuff,
  hasActiveYumenSpectatorBuff,
  normalizeYumenSafeZoneDamageMode,
  normalizeYumenSafeZoneTimelineMode,
} from "../utils/yumenSafeZone";
import { buildYumenResults, countYumenAlivePlayers } from "../utils/yumenResults";
import {
  GUAN_MU_DISGUISE_ABILITY,
  GUAN_MU_DISGUISE_CONSUMABLE_ID,
  SAND_DISGUISE_ABILITY,
  SAND_DISGUISE_CONSUMABLE_ID,
  SAND_DISGUISE_LEASH_RADIUS_UNITS,
  WA_GUAN_DISGUISE_ABILITY,
  WA_GUAN_DISGUISE_CONSUMABLE_ID,
  clearTargetSelectionsTargetingPlayer,
  createGuanMuDisguiseRuntimeBuff,
  createSandDisguiseRuntimeBuff,
  createWaGuanDisguiseRuntimeBuff,
  isDisguiseBuff,
  removeDisguiseBuffs,
} from "../utils/disguise";
import { YUE_YING_SHA_BUFF_ID } from "../utils/yueYingSha";
import { recordLagProbe, roundLagMs } from "../../../utils/lagProbe";

const LV_YE_MAN_SHENG_ABILITY_ID = "lv_ye_man_sheng";
const LV_YE_MAN_SHENG_BUFF_ID = 2718;
const LV_YE_MAN_SHENG_RADIUS_UNITS = 6;
const LV_YE_MAN_SHENG_KNOCKBACK_SPEED_UNITS_PER_SEC = 20;
const XI_BING_YU_ABILITY_ID = "xi_bing_yu";
const XI_BING_YU_BUFF_ID = 2724;
const YIN_QIAO_ABILITY_ID = "yin_qiao";
const JUE_MAI_BUFF_ID = 1337;
const WU_XIANG_JUE_SNAPSHOT_BUFF_IDS = new Set([2710, 2731, 2732, 2733, 2734]);
const XINZHENG_ABILITY_ID = "xinzheng";
const XINZHENG_CHANNEL_BUFF_ID = 1017;
const XINZHENG_SONG_YAN_BUFF_ID = 1018;

function addXinzhengSongYanStack(state: GameState, player: any) {
  const ability = ABILITIES[XINZHENG_ABILITY_ID];
  const songYanBuff = (ability as any)?.buffs?.find((entry: any) => entry?.buffId === XINZHENG_SONG_YAN_BUFF_ID);
  if (!ability || !songYanBuff) return false;
  addBuff({
    state,
    sourceUserId: player.userId,
    targetUserId: player.userId,
    ability: ability as any,
    buffTarget: player as any,
    buff: songYanBuff,
  });
  return true;
}

function hasActiveXinzhengChannelBuff(player: any, now = Date.now()) {
  return (player?.buffs ?? []).some((buff: any) =>
    buff?.buffId === XINZHENG_CHANNEL_BUFF_ID &&
    buff?.sourceAbilityId === XINZHENG_ABILITY_ID &&
    isRuntimeBuffActive(buff, now)
  );
}

function removeXinzhengSongYanStacks(state: GameState, player: any) {
  if (!Array.isArray(player?.buffs)) return false;
  const removed = player.buffs.filter((buff: any) => buff?.buffId === XINZHENG_SONG_YAN_BUFF_ID);
  if (removed.length === 0) return false;
  player.buffs = player.buffs.filter((buff: any) => buff?.buffId !== XINZHENG_SONG_YAN_BUFF_ID);
  for (const buff of removed) {
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
    });
  }
  return true;
}

/** 2D segment vs AABB intersection test (for LOS checks). */
function segmentIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
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

/** Check if line-of-sight between two 2D positions is blocked by any map object.
 *  minBlockH: objects shorter than this are ignored (ground-level terrain bumps).
 *  casterZ / targetZ: feet heights; eyeHeight is added to get eye-level.
 *  An object is skipped only when both players' eye-levels clear its top.
 */
const LOS_EYE_HEIGHT = 1.5; // game units above feet
function isLOSBlocked(
  ax: number, ay: number,
  bx: number, by: number,
  objects: MapObject[],
  minBlockH: number = 0,
  casterZ: number = 0,
  targetZ: number = 0,
): string | null { // returns blocking entity id or null
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

function resolveChuHeHanJieCollisionForPlayer(
  state: GameState,
  player: any,
  playerRadius: number,
  previousPosition?: { x: number; y: number },
): boolean {
  const collided = resolveEnemyChuHeHanJieWallCollision({
    state,
    actorUserId: player.userId,
    position: player.position,
    radius: playerRadius,
    previousPosition,
    actorBaseZ: player.position.z ?? 0,
    actorHeight: 1.5,
  });
  if (collided) {
    player.velocity.vx = 0;
    player.velocity.vy = 0;
    if (player.activeDash) {
      player.activeDash = undefined;
    }
  }
  return collided;
}

function hasLvYeManShengBuff(player: any, now: number): boolean {
  return (player?.buffs ?? []).some(
    (buff: any) =>
      buff.buffId === LV_YE_MAN_SHENG_BUFF_ID &&
      (buff.expiresAt ?? 0) > now,
  );
}

function clampPlayerToLvYeManShengEdge(params: {
  state: GameState;
  player: any;
  playerRadius: number;
  storedUnitScale: number;
  mapCtx: MapContext;
}): boolean {
  const { state, player, playerRadius, storedUnitScale, mapCtx } = params;
  const now = Date.now();
  const radiusWorld = gameplayUnitsToWorldUnits(LV_YE_MAN_SHENG_RADIUS_UNITS, storedUnitScale);

  for (const protector of state.players) {
    if (protector.userId === player.userId) continue;
    if ((protector.hp ?? 0) <= 0) continue;
    if (!hasLvYeManShengBuff(protector as any, now)) continue;

    const dx = player.position.x - protector.position.x;
    const dy = player.position.y - protector.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= radiusWorld - 0.0001) continue;

    let awayX = dx;
    let awayY = dy;
    if (dist <= 0.0001) {
      const dash = player.activeDash;
      const fallbackX = -Number(dash?.vxPerTick ?? protector.facing?.x ?? 1);
      const fallbackY = -Number(dash?.vyPerTick ?? protector.facing?.y ?? 0);
      const fallbackLen = Math.hypot(fallbackX, fallbackY);
      awayX = fallbackLen > 0.0001 ? fallbackX / fallbackLen : 1;
      awayY = fallbackLen > 0.0001 ? fallbackY / fallbackLen : 0;
    } else {
      awayX /= dist;
      awayY /= dist;
    }

    player.position.x = protector.position.x + awayX * radiusWorld;
    player.position.y = protector.position.y + awayY * radiusWorld;
    resolveMapCollisions(player as any, mapCtx);
    resolveChuHeHanJieCollisionForPlayer(state, player as any, playerRadius);
    player.position.z = getGroundHeightForMap(
      player.position.x,
      player.position.y,
      player.position.z ?? 0,
      mapCtx,
    );
    player.velocity.vx = 0;
    player.velocity.vy = 0;
    delete player.activeDash;
    return true;
  }

  return false;
}

/** Check if target is within the caster's forward 180-degree hemisphere. */
function isInFacingHemisphere(
  player: { position: { x: number; y: number }; facing?: { x: number; y: number } },
  target: { position: { x: number; y: number } }
): boolean {
  const f = player.facing;
  if (!f) return true;
  const dx = target.position.x - player.position.x;
  const dy = target.position.y - player.position.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return true;
  return (f.x * dx + f.y * dy) >= 0;
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

type HostileDamageTarget =
  | { kind: "player"; target: any }
  | { kind: "entity"; target: TargetEntity };

function getHostileDamageTargets(state: GameState, sourceUserId: string): HostileDamageTarget[] {
  const targets: HostileDamageTarget[] = [];

  for (const target of state.players) {
    if (target.userId === sourceUserId) continue;
    if ((target.hp ?? 0) <= 0) continue;
    targets.push({ kind: "player", target });
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;
    if (entity.ownerUserId === sourceUserId) continue;
    targets.push({ kind: "entity", target: entity });
  }

  return targets;
}

function getHostileDamageTargetPosition(target: HostileDamageTarget) {
  return target.target.position;
}

function getHostileDamageTargetRangeDistance(
  sourcePosition: { x: number; y: number; z?: number },
  target: HostileDamageTarget,
  storedUnitScale: number
) {
  const rawDistance = calculateDistance(sourcePosition, getHostileDamageTargetPosition(target), storedUnitScale);
  if (target.kind !== "entity") return rawDistance;
  return Math.max(0, rawDistance - ((target.target.radius ?? 0) / Math.max(0.0001, storedUnitScale)));
}

function getHostileDamageTargetPlanarRangeDistanceWorld(
  center: { x: number; y: number },
  target: HostileDamageTarget,
) {
  const targetPosition = getHostileDamageTargetPosition(target);
  const rawDistance = Math.hypot(targetPosition.x - center.x, targetPosition.y - center.y);
  if (target.kind !== "entity") return rawDistance;
  return Math.max(0, rawDistance - Math.max(0, Number(target.target.radius ?? 0)));
}

function isHostileDamageTargetInsideAoeCylinder(params: {
  center: { x: number; y: number; z?: number };
  target: HostileDamageTarget;
  radiusWorld: number;
  verticalHalfHeightWorld?: number;
}) {
  const { center, target, radiusWorld, verticalHalfHeightWorld = radiusWorld } = params;
  if (getHostileDamageTargetPlanarRangeDistanceWorld(center, target) > radiusWorld) return false;
  const targetPosition = getHostileDamageTargetPosition(target);
  const targetRadius = target.kind === "entity" ? Math.max(0, Number(target.target.radius ?? 0)) : 0;
  return Math.abs(Number(targetPosition.z ?? 0) - Number(center.z ?? 0)) <= verticalHalfHeightWorld + targetRadius;
}

function getMiYunAffectedHostileTargets(params: {
  state: GameState;
  source: { userId: string; buffs?: any[]; facing?: { x: number; y: number } | null } | null | undefined;
  sourceUserId: string;
  center: { x: number; y: number; z?: number };
  storedUnitScale: number;
  rangeUnits?: number;
  radiusWorld?: number;
  coneAngleDeg?: number;
}) {
  const {
    state,
    source,
    sourceUserId,
    center,
    storedUnitScale,
    rangeUnits,
    radiusWorld,
    coneAngleDeg,
  } = params;
  const resolvedRangeUnits = rangeUnits ?? ((radiusWorld ?? 0) / Math.max(0.0001, storedUnitScale));
  const resolvedRadiusWorld = radiusWorld ?? gameplayUnitsToWorldUnits(resolvedRangeUnits, storedUnitScale);
  const facing = source?.facing ?? null;
  const halfAngleCos = coneAngleDeg && coneAngleDeg < 360
    ? Math.cos((coneAngleDeg / 2) * Math.PI / 180)
    : null;

  const hostiles = getHostileDamageTargets(state, sourceUserId).filter((target) => {
    if (blocksEnemyTargeting(target.target as any)) return false;
    if (!isHostileDamageTargetInsideAoeCylinder({ center, target, radiusWorld: resolvedRadiusWorld })) return false;
    if (halfAngleCos === null) return true;

    const targetPos = getHostileDamageTargetPosition(target);
    const dx = targetPos.x - center.x;
    const dy = targetPos.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.0001) return true;

    const facingX = Number(facing?.x ?? 0);
    const facingY = Number(facing?.y ?? 1);
    const facingLen = Math.hypot(facingX, facingY) || 1;
    const dot = ((facingX / facingLen) * dx + (facingY / facingLen) * dy) / distance;
    return dot >= halfAngleCos;
  });

  const rerolledTargets = rerollMiYunAreaTargets({
    state,
    source,
    sourceUserId,
    originalSlotCount: hostiles.length,
    center,
    radiusWorld: resolvedRadiusWorld,
    coneAngleDeg,
    facing,
  });
  return (rerolledTargets as HostileDamageTarget[] | null) ?? hostiles;
}

type RuYiRecordedControlKind = "root" | "freeze" | "stun" | "knockdown";

const RU_YI_ATTACK_BUFF_IDS: Record<RuYiRecordedControlKind, number> = {
  root: 2638,
  freeze: 2639,
  stun: 2640,
  knockdown: 2641,
};

const RU_YI_ATTACK_TRIGGER_EXCLUDED_EFFECT_TYPES = new Set([
  "STACK_ON_HIT_DAMAGE",
  "PERIODIC_DAMAGE",
  "TIMED_AOE_DAMAGE",
  "TIMED_SELF_DAMAGE",
  "TIMED_SOURCE_CENTER_AOE_DAMAGE",
  "TIMED_AOE_DAMAGE_IF_SELF_HP_GT",
]);

function isRuYiAttackTriggerEvent(evt: any) {
  return (
    evt?.type === "DAMAGE" &&
    typeof evt.actorUserId === "string" &&
    typeof evt.targetUserId === "string" &&
    evt.actorUserId !== evt.targetUserId &&
    (evt.value ?? 0) > 0 &&
    !RU_YI_ATTACK_TRIGGER_EXCLUDED_EFFECT_TYPES.has(String(evt.effectType ?? ""))
  );
}

function applyRuYiRecordedControls(params: {
  state: GameState;
  source: { userId: string; buffs: any[] };
  target: { userId: string; buffs: any[]; hp?: number };
  recordedControls: Array<{ kind?: string; fullDurationMs?: number; remainingMs?: number }>;
}) {
  const { state, source, target, recordedControls } = params;
  const ability = ABILITIES.ru_yi_fa as any;
  if (!ability || !Array.isArray(ability.buffs) || !target || (target.hp ?? 0) <= 0) return;

  for (const snapshot of recordedControls) {
    const kind = snapshot.kind as RuYiRecordedControlKind | undefined;
    if (!kind || !(kind in RU_YI_ATTACK_BUFF_IDS)) continue;
    const buffDef = ability.buffs.find((buff: any) => buff.buffId === RU_YI_ATTACK_BUFF_IDS[kind]);
    if (!buffDef) continue;
    addBuff({
      state,
      sourceUserId: source.userId,
      targetUserId: target.userId,
      ability,
      buffTarget: target,
      buff: {
        ...buffDef,
        durationMs: Math.max(1, snapshot.fullDurationMs ?? snapshot.remainingMs ?? buffDef.durationMs),
      } as any,
    });
  }
}

function applyDamageToHostileTarget(params: {
  state: GameState;
  source: { userId: string; buffs: any[] };
  target: HostileDamageTarget;
  baseDamage: number;
  abilityId?: string;
  abilityName?: string;
  effectType: string;
  damageType?: string;
  timestamp: number;
}) {
  const {
    state,
    source,
    target,
    baseDamage,
    abilityId,
    abilityName,
    effectType,
    damageType,
    timestamp,
  } = params;

  const damageTarget = target.kind === "player"
    ? target.target
    : target.target;
  const damageRoll = resolveScheduledDamageRoll({
    source: source as any,
    target: damageTarget,
    base: baseDamage,
    abilityId,
    damageType,
  });
  const resolvedDamage = damageRoll.damage;
  if (resolvedDamage <= 0) {
    if (damageRoll.fullyReducedByDamageReduction === true) {
      state.events.push({
        id: randomUUID(),
        timestamp,
        turn: state.turn,
        type: "DAMAGE",
        actorUserId: source.userId,
        ...(target.kind === "player"
          ? { targetUserId: target.target.userId }
          : { entityId: target.target.id, entityName: target.target.abilityName }),
        abilityId,
        abilityName,
        effectType,
        value: 0,
        suppressCritLabel: true,
        displayZeroDamage: true,
      } as any);
    }
    return 0;
  }

  // Damage immunity + 盾立 reflect for player victims.
  if (target.kind === "player" && hasDamageImmune(target.target as any)) {
    const reflectAbility = abilityId ? ABILITIES[abilityId] : undefined;
    const reflectVictim = getDunLiReflectVictim(
      state,
      source.userId,
      target.target,
      reflectAbility ?? { id: abilityId, name: abilityName },
    );
    if (reflectVictim) {
      return applyDamageToHostileTarget({
        state,
        source: target.target as any,
        target: { kind: "player", target: reflectVictim },
        baseDamage,
        abilityId,
        abilityName,
        effectType,
        damageType,
        timestamp,
      });
    }
    return 0;
  }

  if (target.kind === "player") {
    const victim = target.target;
    const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(state, victim as any, resolvedDamage);
    const appliedDamage = adjustedDamage;
    const result = appliedDamage > 0
      ? applyDamageToTarget(victim as any, appliedDamage)
      : { hpDamage: 0, shieldAbsorbed: 0 };
    state.events.push({
      id: randomUUID(),
      timestamp,
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: victim.userId,
      abilityId,
      abilityName,
      effectType,
      value: appliedDamage,
      isCrit: damageRoll.isCrit,
      shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
    } as any);
    if (result.hpDamage > 0 || result.shieldAbsorbed > 0) {
      processOnDamageTaken(state, victim as any, result.hpDamage, source.userId, result.shieldAbsorbed);
    }
    if (redirectPlayer && redirectAmt > 0) {
      applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
    }
    return appliedDamage;
  }

  const entity = target.target;
  const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(state, entity as any, resolvedDamage);
  const appliedDamage = adjustedDamage;
  const result = appliedDamage > 0
    ? applyDamageToTarget(entity as any, appliedDamage)
    : { hpDamage: 0, shieldAbsorbed: 0 };
  state.events.push({
    id: randomUUID(),
    timestamp,
    turn: state.turn,
    type: "DAMAGE",
    actorUserId: source.userId,
    entityId: entity.id,
    entityName: entity.abilityName,
    abilityId,
    abilityName,
    effectType,
    value: appliedDamage,
    isCrit: damageRoll.isCrit,
    shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
  } as any);
  if (result.hpDamage > 0 || result.shieldAbsorbed > 0) {
    processOnDamageTaken(state, entity as any, result.hpDamage, source.userId, result.shieldAbsorbed);
  }
  if (redirectPlayer && redirectAmt > 0) {
    applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
  }
  return appliedDamage;
}

function applyKnockbackToHostileTarget(params: {
  state: GameState;
  source: { userId: string; position: { x: number; y: number; z?: number } };
  target: HostileDamageTarget;
  ability: any;
  distanceUnits: number;
  durationTicks: number;
  knockedBackBuffId?: number;
}) {
  const { state, source, target, ability, distanceUnits, durationTicks, knockedBackBuffId } = params;
  const knockbackTarget = target.target as any;
  const dx = knockbackTarget.position.x - source.position.x;
  const dy = knockbackTarget.position.y - source.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return false;
  if (target.kind === "player" && hasKnockedBackImmune(knockbackTarget)) return false;

  const dirX = dx / distance;
  const dirY = dy / distance;
  const knockbackDistance = gameplayUnitsToWorldUnits(distanceUnits, state.unitScale);
  const moveTicks = Math.max(1, durationTicks);

  delete knockbackTarget.activeDash;
  if (knockbackTarget.velocity) {
    knockbackTarget.velocity.vx = 0;
    knockbackTarget.velocity.vy = 0;
    knockbackTarget.velocity.vz = 0;
  }

  knockbackTarget.activeDash = {
    abilityId: ability.id,
    vxPerTick: (dirX * knockbackDistance) / moveTicks,
    vyPerTick: (dirY * knockbackDistance) / moveTicks,
    forceVzPerTick: 0,
    maxUpVz: 0,
    maxDownVz: 0,
    ticksRemaining: moveTicks,
    vzPerTick: 0,
  } as any;

  if (target.kind === "player" && typeof knockedBackBuffId === "number") {
    const knockedBackBuff = knockedBackBuffId === 9101
      ? {
          buffId: 9101,
          name: "击退",
          category: "DEBUFF",
          description: "被击退中，行动受限",
          breakOnPlay: false,
          effects: [{ type: "KNOCKED_BACK" }],
        }
      : ability?.buffs?.find((buff: any) => buff.buffId === knockedBackBuffId);
    if (knockedBackBuff) {
      addBuff({
        state,
        sourceUserId: source.userId,
        targetUserId: knockbackTarget.userId,
        ability,
        buffTarget: knockbackTarget,
        buff: {
          ...knockedBackBuff,
          durationMs: Math.max(1, Math.ceil((moveTicks * 1000) / 30)),
        } as any,
      });
    }
  }

  return true;
}

function clearChannelStartBuffs(
  state: GameState,
  player: { userId: string; buffs: any[] },
  channel?: { abilityId?: string; startedBuffIds?: number[] }
) {
  const startedBuffIds = channel?.startedBuffIds ?? [];
  if (startedBuffIds.length === 0) return false;

  let removedAny = false;
  const remainingBuffs: any[] = [];
  for (const buff of player.buffs ?? []) {
    const matchesStartedBuff =
      startedBuffIds.includes(buff.buffId) &&
      (buff.sourceAbilityId ?? channel?.abilityId) === channel?.abilityId;
    if (!matchesStartedBuff) {
      remainingBuffs.push(buff);
      continue;
    }

    removeLinkedShield(player as any, buff as any);
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
    });
    removedAny = true;
  }

  if (removedAny) {
    player.buffs = remainingBuffs;
  }
  return removedAny;
}

function cancelActiveChannel(state: GameState, player: { activeChannel?: any; buffs: any[]; userId: string }) {
  const channel = player.activeChannel;
  if (!channel) return false;
  const removedBuffs = clearChannelStartBuffs(state, player, channel);
  player.activeChannel = undefined;
  return removedBuffs;
}

function isDunyingCompanion(buff: { buffId: number; name?: string; sourceAbilityId?: string }): boolean {
  return buff.buffId === 1021;
}

const SANLIU_XIA_BUFF_ID = 1007;
const FORWARD_CHANNEL_RESOLUTION_STEALTH_BREAK_BUFF_IDS = new Set([1011, 1012, 1013, YUE_YING_SHA_BUFF_ID]);

function isHostileForwardChannelResolution(params: {
  channel?: { forwardChannel?: boolean; consumableId?: string };
  ability?: { target?: string; friendlyTarget?: boolean } | null;
  targetPlayer?: { userId?: string } | null;
  targetEntity?: { id?: string } | null;
}) {
  const { channel, ability, targetPlayer, targetEntity } = params;
  if (channel?.forwardChannel !== true) return false;
  if (typeof channel?.consumableId === "string") return false;
  if (!ability || ability.target !== "OPPONENT" || ability.friendlyTarget === true) return false;
  return !!targetPlayer || !!targetEntity;
}

function breakStealthOnForwardChannelResolution(params: {
  state: GameState;
  player: { userId: string; buffs: any[] };
}) {
  const { state, player } = params;
  if (!Array.isArray(player.buffs) || player.buffs.length === 0) return false;

  const hadFuguang = player.buffs.some((buff) => buff.buffId === 1012);
  const removedBuffs: any[] = [];
  const remainingBuffs: any[] = [];

  for (const buff of player.buffs) {
    const removesStealth = FORWARD_CHANNEL_RESOLUTION_STEALTH_BREAK_BUFF_IDS.has(buff.buffId) ||
      (hadFuguang && isDunyingCompanion(buff));
    if (!removesStealth) {
      remainingBuffs.push(buff);
      continue;
    }
    removedBuffs.push(buff);
  }

  if (removedBuffs.length === 0) return false;

  player.buffs = remainingBuffs;
  for (const buff of removedBuffs) {
    removeLinkedShield(player as any, buff as any);
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
      sourceUserId: buff.sourceUserId,
    });
  }
  return true;
}

function breakSanliuXiaOnSuccessfulChannelComplete(params: {
  state: GameState;
  player: { userId: string; buffs: any[] };
}) {
  const { state, player } = params;
  if (!Array.isArray(player.buffs) || player.buffs.length === 0) return false;

  const removedBuffs: any[] = [];
  const remainingBuffs: any[] = [];

  for (const buff of player.buffs) {
    if (buff.buffId === SANLIU_XIA_BUFF_ID) {
      removedBuffs.push(buff);
    } else {
      remainingBuffs.push(buff);
    }
  }

  if (removedBuffs.length === 0) return false;

  player.buffs = remainingBuffs;
  for (const buff of removedBuffs) {
    removeLinkedShield(player as any, buff as any);
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
      sourceUserId: buff.sourceUserId,
    });
  }
  return true;
}

function hasBuffEffect(player: { buffs: Array<{ effects: Array<{ type: string }> }> }, type: string): boolean {
  return player.buffs.some((b: any) => isRuntimeBuffActive(b) && b.effects.some((e: any) => e.type === type));
}

function hasCombatActivityAgainstPlayerDuringChannel(state: GameState, userId: string, channelStartedAt: number): boolean {
  return (state.events ?? []).some((event: any) => {
    const timestamp = Number(event?.timestamp ?? 0);
    if (!Number.isFinite(timestamp) || timestamp < channelStartedAt) return false;
    if (!event?.actorUserId || event.actorUserId === userId || event.targetUserId !== userId) return false;
    if (event.type === "BUFF_APPLIED" && event.buffCategory === "DEBUFF") return true;
    if (event.type !== "DAMAGE") return false;
    const damageValue = Number(event.value ?? 0);
    const shieldAbsorbed = Number(event.shieldAbsorbed ?? 0);
    return damageValue > 0 || shieldAbsorbed > 0;
  });
}

function tryApplyDodgeForHit(params: {
  state: GameState;
  source: { userId: string };
  target: { userId: string; buffs: any[] };
  abilityId?: string;
  abilityName?: string;
  enabled: boolean;
  damageType?: string;
}): boolean {
  const { state, source, target, abilityId, abilityName, enabled, damageType } = params;
  if (!enabled) return false;
  if (source.userId === target.userId) return false;
  if (!shouldDodgeForAbility(target as any, damageType)) return false;

  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    turn: state.turn,
    type: "DODGE",
    actorUserId: target.userId,
    targetUserId: source.userId,
    abilityId,
    abilityName,
  } as any);
  return true;
}

const CHANNEL_BUFF_IDS = new Set([1014, 1017, 2001, 2003, 2712]);

function isChannelBuffRuntime(buff: { buffId: number }): boolean {
  return CHANNEL_BUFF_IDS.has(buff.buffId);
}

function hasLingRanTianFengState(player: {
  buffs?: Array<{ expiresAt?: number; effects?: Array<{ type?: string }> }>;
}): boolean {
  return Array.isArray(player.buffs) && player.buffs.some((buff) =>
    isRuntimeBuffActive(buff as any) && buff.effects?.some((effect) => effect.type === "LING_RAN_TIAN_FENG_STATE")
  );
}

function shouldSuppressJumpWhileChanneling(player: {
  activeChannel?: any;
  buffs?: Array<{ buffId: number; expiresAt?: number; effects?: Array<{ type?: string }> }>;
}): boolean {
  if (hasLingRanTianFengState(player)) return false;
  if (isActiveChannelRuntime(player.activeChannel)) return true;
  return Array.isArray(player.buffs) && player.buffs.some((buff) =>
    isRuntimeBuffActive(buff as any) && (isChannelBuffRuntime(buff) || buff.effects?.some((effect) => effect.type === "NO_JUMP"))
  );
}

function isMoheKnockdown(buff: { buffId: number; sourceAbilityId?: string }): boolean {
  return buff.buffId === 1002 && buff.sourceAbilityId === "mohe_wuliang";
}

function isStunDebuff(buff: {
  buffId: number;
  sourceAbilityId?: string;
  category?: string;
  effects?: Array<{ type: string }>;
}): boolean {
  if (isMoheKnockdown(buff)) return false;
  if (buff.category !== "DEBUFF") return false;
  return Array.isArray(buff.effects) && buff.effects.some((e) => e.type === "CONTROL");
}

const WUFANG_XINGJIN_ROOT_BUFF_ID = 1330;
const WUFANG_XINGJIN_HIT_PROTECT_BUFF_ID = 1331;
const WUFANG_XINGJIN_REMOVE_ON_HIT_CHANCE = 0.5;
const SAN_CAI_HUA_SHENG_ROOT_BUFF_ID = 2509;
const SAN_CAI_HUA_SHENG_PROTECT_BUFF_ID = 2510;
const SAN_CAI_HUA_SHENG_REMOVE_ON_HIT_CHANCE = 0.5;
const HONG_MENG_TIAN_JIN_ABILITY_ID = "hong_meng_tian_jin";
const HONG_MENG_TIAN_JIN_BUFF_ID = 2645;
const SHU_SE_BUFF_ID = 2646;
const PULL_CHANNEL_QINGGONG_SEAL_CONFIG: Record<string, { buffId: number; buffName: string; durationMs: number }> = {
  zhuo_ying_shi: { buffId: 2403, buffName: "滞影", durationMs: 5_000 },
};

// After the pull completes (activeDash cleared), apply a stun to the target.
// NOTE: 极乐引 is now an instant AOE and no longer uses this channel-pull mechanism.
// The config is kept but empty; the code below won't fire for any current ability.
const PULL_CHANNEL_POST_STUN_CONFIG: Record<string, { buffId: number; buffName: string; durationMs: number }> = {
};

function removeRootAndSlowEffects(state: GameState, target: any, now: number): boolean {
  if (!Array.isArray(target?.buffs) || target.buffs.length === 0) return false;

  let changed = false;
  const nextBuffs: any[] = [];
  for (const buff of target.buffs) {
    const effects = Array.isArray(buff?.effects) ? buff.effects : [];
    if ((buff?.expiresAt ?? 0) <= now || effects.length === 0) {
      nextBuffs.push(buff);
      continue;
    }

    const filteredEffects = effects.filter((effect: any) => effect.type !== "ROOT" && effect.type !== "SLOW");
    if (filteredEffects.length === effects.length) {
      nextBuffs.push(buff);
      continue;
    }

    changed = true;
    if (filteredEffects.length === 0) {
      pushBuffExpired(state, {
        targetUserId: target.userId,
        buffId: buff.buffId,
        buffName: buff.name,
        buffCategory: buff.category,
        sourceAbilityId: buff.sourceAbilityId,
        sourceAbilityName: buff.sourceAbilityName,
      });
      continue;
    }

    nextBuffs.push({
      ...buff,
      effects: filteredEffects,
    });
  }

  if (changed) {
    target.buffs = nextBuffs;
  }
  return changed;
}

function tryRemoveWufangRootOnHit(state: GameState, target: any, now: number): boolean {
  if (!Array.isArray(target?.buffs) || target.buffs.length === 0) return false;

  const hasProtect = target.buffs.some(
    (b: any) => b.buffId === WUFANG_XINGJIN_HIT_PROTECT_BUFF_ID && b.expiresAt > now
  );
  if (hasProtect) return false;

  const rootBuff = target.buffs.find(
    (b: any) => b.buffId === WUFANG_XINGJIN_ROOT_BUFF_ID && b.expiresAt > now
  );
  if (!rootBuff) return false;

  if (Math.random() > WUFANG_XINGJIN_REMOVE_ON_HIT_CHANCE) return false;

  target.buffs = target.buffs.filter((b: any) => b !== rootBuff);
  pushBuffExpired(state, {
    targetUserId: target.userId,
    buffId: rootBuff.buffId,
    buffName: rootBuff.name,
    buffCategory: rootBuff.category,
    sourceAbilityId: rootBuff.sourceAbilityId,
    sourceAbilityName: rootBuff.sourceAbilityName,
  });
  return true;
}

function tryRemoveSanCaiRootOnHit(state: GameState, target: any, now: number): boolean {
  if (!Array.isArray(target?.buffs) || target.buffs.length === 0) return false;

  const hasProtect = target.buffs.some(
    (b: any) => b.buffId === SAN_CAI_HUA_SHENG_PROTECT_BUFF_ID && b.expiresAt > now
  );
  if (hasProtect) return false;

  const rootBuff = target.buffs.find(
    (b: any) => b.buffId === SAN_CAI_HUA_SHENG_ROOT_BUFF_ID && b.expiresAt > now
  );
  if (!rootBuff) return false;

  if (Math.random() > SAN_CAI_HUA_SHENG_REMOVE_ON_HIT_CHANCE) return false;

  target.buffs = target.buffs.filter((b: any) => b !== rootBuff);
  pushBuffExpired(state, {
    targetUserId: target.userId,
    buffId: rootBuff.buffId,
    buffName: rootBuff.name,
    buffCategory: rootBuff.category,
    sourceAbilityId: rootBuff.sourceAbilityId,
    sourceAbilityName: rootBuff.sourceAbilityName,
  });
  return true;
}

function removeStunDebuffsFromPlayer(state: GameState, target: any): boolean {
  const stunBuffs = (target.buffs ?? []).filter((b: any) => isStunDebuff(b));
  if (stunBuffs.length === 0) return false;

  target.buffs = target.buffs.filter((b: any) => !isStunDebuff(b));
  for (const b of stunBuffs) {
    pushBuffExpired(state, {
      targetUserId: target.userId,
      buffId: b.buffId,
      buffName: b.name,
      buffCategory: b.category,
      sourceAbilityId: b.sourceAbilityId,
      sourceAbilityName: b.sourceAbilityName,
    });
  }
  return true;
}

function applyType3KnockbackControl(params: {
  state: GameState;
  source: any;
  target: any;
  abilityId?: string;
  abilityName?: string;
  knockbackUnits: number;
  controlDurationMs: number;
  mapCtx: MapContext;
  now: number;
}) {
  const {
    state,
    source,
    target,
    abilityId,
    abilityName,
    knockbackUnits,
    controlDurationMs,
    mapCtx,
    now,
  } = params;

  if (knockbackUnits <= 0) {
    return { applied: false, removedStuns: false };
  }

  if (target.buffs.some((b: any) => isMoheKnockdown(b))) {
    return { applied: false, removedStuns: false };
  }

  if (source.userId !== target.userId && blocksEnemyTargeting(target)) {
    return { applied: false, removedStuns: false };
  }

  if (hasKnockedBackImmune(target)) {
    return { applied: false, removedStuns: false };
  }

  if (hasBuffEffect(target, "KNOCKED_BACK")) {
    return { applied: false, removedStuns: false };
  }

  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.0001) {
    return { applied: false, removedStuns: false };
  }

  const removedStuns = removeStunDebuffsFromPlayer(state, target);
  const dirX = dx / dist;
  const dirY = dy / dist;
  const knockbackDistance = Math.max(0, knockbackUnits);
  const playerRadius = mapCtx?.playerRadius ?? 2;
  const maxSubStep = Math.max(0.05, playerRadius * 0.85);
  const steps = Math.max(1, Math.ceil(knockbackDistance / maxSubStep));
  const stepX = (dirX * knockbackDistance) / steps;
  const stepY = (dirY * knockbackDistance) / steps;

  for (let step = 0; step < steps; step += 1) {
    const previousPosition = { x: target.position.x, y: target.position.y };
    target.position = {
      ...target.position,
      x: target.position.x + stepX,
      y: target.position.y + stepY,
    };
    resolveMapCollisions(target, mapCtx);
    const chuHeWallHit = resolveEnemyChuHeHanJieWallCollision({
      state,
      actorUserId: target.userId,
      position: target.position,
      radius: playerRadius,
      previousPosition,
      actorBaseZ: target.position.z ?? 0,
      actorHeight: 1.5,
    });
    const actualX = target.position.x - previousPosition.x;
    const actualY = target.position.y - previousPosition.y;
    const intendedStep = Math.hypot(stepX, stepY);
    const actualAlongKnockback = actualX * dirX + actualY * dirY;
    if (chuHeWallHit || (intendedStep > 0.001 && actualAlongKnockback < intendedStep * 0.35)) {
      break;
    }
  }

  if (controlDurationMs > 0) {
    const knockbackBuff = {
      buffId: 9101,
      name: "击退",
      category: "DEBUFF",
      effects: [{ type: "KNOCKED_BACK" }],
      expiresAt: now + controlDurationMs,
      breakOnPlay: false,
      sourceAbilityId: abilityId,
      sourceAbilityName: abilityName,
      appliedAtTurn: state.turn,
      appliedAt: now,
    } as any;

    target.buffs.push(knockbackBuff);
    applyDashRuntimeBuff({
      state,
      target,
      durationMs: controlDurationMs,
      effects: [{ type: "CONTROL_IMMUNE" }] as any,
      sourceAbilityId: abilityId,
      sourceAbilityName: abilityName,
      appliedAt: now,
    });
    state.events.push({
      id: randomUUID(),
      timestamp: now,
      turn: state.turn,
      type: "BUFF_APPLIED",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId,
      abilityName,
      buffId: knockbackBuff.buffId,
      buffName: knockbackBuff.name,
      buffCategory: knockbackBuff.category,
      appliedAtTurn: state.turn,
    } as any);
  }

  return { applied: true, removedStuns };
}

const SHENGTAIJI_ZONE_ID = "qionglong_huasheng_zone";
const SHENGTAIJI_PULSE_BUFF_ID = 1310;
const SHENGTAIJI_ENEMY_SLOW_BUFF_ID = 1311;
const CHONG_YIN_YANG_ZONE_BUFF_ID = 2701;
const LING_TAI_XU_ZONE_BUFF_ID = 2702;
const TUN_RI_YUE_ZONE_BUFF_ID = 2703;
const SUI_XING_CHEN_ZONE_BUFF_ID = 2704;
const PO_CANG_QIONG_ZONE_BUFF_ID = 2705;

export interface GameLoopConfig {
  tickRate?: number; // Hz (default 60)
  mode?: GameMode;
}

/**
 * Singleton game loop instances per game ID
 */
const activeLoops = new Map<string, GameLoop>();
const MAX_EVENT_HISTORY_BEFORE_TRIM = 500;
const EVENT_HISTORY_KEEP_COUNT = 300;

export class GameLoop {
  private gameId: string;
  private state: GameState;
  private isRunning = false;
  private tickRate: number; // Hz
  private tickInterval: any;
  private playerInputs: Map<number, MovementInput | null> = new Map();
  private playerInputSeq: Map<number, number> = new Map();
  private playerInputClientSessions: Map<number, { id: string; startedAt: number }> = new Map();
  private lastBroadcast = 0;
  private ticksSinceBroadcast = 0;
  // Broadcast cadence in ticks. Derived from tickRate to keep roughly 30Hz net updates.
  private broadcastTickInterval = 1;
  // ── 毒圈 (Poison zone) ──
  private zoneStartedAt = 0;
  private lastZoneDamageAt = 0;
  private isArenaMode = false;
  private isYumenMode = false;
  private mapCtx: MapContext;
  // Index into state.events for STACK_ON_HIT_DAMAGE scanning.
  // Prevents missing immediate cast damage that lands between loop ticks.
  private stackProcScanIndex = 0;
  // Pending post-pull stuns: keyed by targetUserId; fires when activeDash clears.
  private readonly pendingPostPullStuns = new Map<
    string,
    { sourceUserId: string; abilityId: string; abilityName: string }
  >();
  private lastCombatStatusCheckAt = Date.now();

  // Phase table: each phase defines a time window, zone size transition, and DPS.
  static ZONE_PHASES = [
    { startTime: 0,     endTime: 10000, fromHalf: 100, toHalf: 100, dps: 0 },
    { startTime: 10000, endTime: 30000, fromHalf: 100, toHalf: 50,  dps: 1 },
    { startTime: 30000, endTime: 40000, fromHalf: 50,  toHalf: 50,  dps: 1 },
    { startTime: 40000, endTime: 50000, fromHalf: 50,  toHalf: 25,  dps: 5 },
    { startTime: 50000, endTime: 60000, fromHalf: 25,  toHalf: 25,  dps: 5 },
    { startTime: 60000, endTime: 61000, fromHalf: 25,  toHalf: 0,   dps: 10 },
  ];

  constructor(gameId: string, state: GameState, config?: GameLoopConfig) {
    this.gameId = gameId;
    this.state = structuredClone(state);
    const isExportedMode = isExportedMapMode(config?.mode);
    this.state.unitScale = normalizeStoredUnitScale(this.state.unitScale ?? (isExportedMode ? 1 : undefined));
    this.stackProcScanIndex = this.state.events?.length ?? 0;
    this.tickRate = config?.tickRate ?? 30;
    this.broadcastTickInterval = Math.max(1, Math.round(this.tickRate / 30));
    this.isArenaMode = config?.mode === 'arena';
    this.isYumenMode = isYumen1v1BasicMode(config?.mode);

    // Select map based on game mode
    const map = isExportedMode ? exportedMap : this.isArenaMode ? arenaMap : worldMap;
    const collisionSystem = isExportedMode ? getCollisionTestExportedSystem() : null;
    this.mapCtx = {
      objects: map.objects,
      width: map.width,
      height: map.height,
      circular: false,
      unitScale: this.state.unitScale,
      playerRadius: isExportedMode ? COLLISION_TEST_PLAYER_RADIUS : undefined,
      collisionSystem,
      playArea: this.state.playArea,
    };

    // Initialize safe zone for arena mode and staged 玉门关 circles.
    if (this.isArenaMode || this.isYumenMode) {
      const now = Date.now();
      this.zoneStartedAt = now;
      this.lastZoneDamageAt = now;
      const centerX = map.width / 2;
      const centerY = map.height / 2;
      const fullHalf = this.isYumenMode ? Math.hypot(map.width / 2, map.height / 2) : Math.min(map.width, map.height) / 2;
      if (this.isYumenMode) {
        this.ensureRandomSafeZoneInitialized(now);
      } else if (this.state.safeZone) {
        const previousShape = this.state.safeZone.shape;
        this.state.safeZone.shape = this.isYumenMode ? "circle" : this.state.safeZone.shape === "circle" ? "circle" : "square";
        this.state.safeZone.centerX = Number.isFinite(this.state.safeZone.centerX) ? this.state.safeZone.centerX : centerX;
        this.state.safeZone.centerY = Number.isFinite(this.state.safeZone.centerY) ? this.state.safeZone.centerY : centerY;
        const existingHalf = this.isYumenMode && previousShape !== "circle" ? fullHalf : this.state.safeZone.currentHalf;
        this.state.safeZone.currentHalf = Math.max(0, Math.min(fullHalf, Number(existingHalf ?? fullHalf)));
        this.state.safeZone.currentDiameter = this.state.safeZone.currentHalf * 2;
      } else {
        this.state.safeZone = {
          shape: this.isYumenMode ? "circle" : "square",
          centerX,
          centerY,
          currentHalf: fullHalf,
          currentDiameter: fullHalf * 2,
          dps: 0,
          shrinking: false,
          shrinkProgress: 0,
          nextChangeIn: this.isArenaMode ? 10 : 0,
        };
      }
    }

    if (this.isYumenMode && !this.state.playArea) {
      this.state.playArea = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
      this.mapCtx.playArea = this.state.playArea;
    }

    // Initialize player input buffers
    this.state.players.forEach((_, idx) => {
      this.playerInputs.set(idx, null);
    });
  }

  private getRandomSafeZoneFullRadius() {
    return Math.hypot(this.mapCtx.width / 2, this.mapCtx.height / 2);
  }

  private ensureRandomSafeZoneInitialized(now: number) {
    const centerX = this.mapCtx.width / 2;
    const centerY = this.mapCtx.height / 2;
    const fullRadius = this.getRandomSafeZoneFullRadius();
    const zone = this.state.safeZone;
    if (
      zone &&
      Number.isFinite(zone.currentHalf) &&
      Number.isFinite(zone.centerX) &&
      Number.isFinite(zone.centerY)
    ) {
      zone.shape = "circle";
      zone.currentHalf = Math.max(0, Math.min(fullRadius, Number(zone.currentHalf)));
      zone.currentDiameter = zone.currentHalf * 2;
      const currentDiameter = zone.currentHalf * 2;
      const inferredStageIndex = currentDiameter <= 25 ? 4 : currentDiameter <= 50 ? 3 : currentDiameter <= 100 ? 2 : currentDiameter <= 200 ? 1 : 0;
      const storedStageIndex = Number(zone.stageIndex);
      zone.stageIndex = Math.max(0, Math.floor(Number.isFinite(storedStageIndex) ? storedStageIndex : inferredStageIndex));
      zone.phase = zone.phase ?? "idle";
      zone.nextChangeIn = zone.phase === "waiting" || zone.phase === "countdown" || zone.phase === "shrinking"
        ? Math.max(0, (Number(zone.phaseEndsAt ?? now) - now) / 1000)
        : 0;
      zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
      zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
      zone.fullPoison = zone.phase === "complete" || zone.currentHalf <= 0;
      zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
      zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
      zone.testShortCooldown = zone.testShortCooldown === true;
      if (zone.paused === true && (zone.phase === "waiting" || zone.phase === "countdown" || zone.phase === "shrinking")) {
        const remainingMs = Math.max(0, Number(zone.pausedRemainingMs ?? (Number(zone.phaseEndsAt ?? now) - now)));
        zone.pausedRemainingMs = remainingMs;
        zone.pausedAt = Number.isFinite(Number(zone.pausedAt)) ? Number(zone.pausedAt) : now;
        zone.phaseEndsAt = now + remainingMs;
        zone.nextChangeIn = remainingMs / 1000;
      } else {
        zone.paused = false;
        delete zone.pausedAt;
        delete zone.pausedRemainingMs;
      }
      return;
    }

    this.state.safeZone = {
      shape: "circle",
      centerX,
      centerY,
      currentHalf: fullRadius,
      currentDiameter: fullRadius * 2,
      dps: 0,
      shrinking: false,
      shrinkProgress: 0,
      nextChangeIn: 0,
      phase: "idle",
      timelineMode: "fast",
      damageMode: "test",
      stageIndex: 0,
      circleNumber: 3,
      totalCircles: YUMEN_SAFE_ZONE_TOTAL_CIRCLES,
      fullPoison: false,
      testShortCooldown: false,
      phaseStartedAt: now,
      phaseEndsAt: now,
      targetVisible: false,
      paused: false,
    };
  }

  private pickRandomSafeZoneCenter(currentCenterX: number, currentCenterY: number, currentRadius: number, targetRadius: number) {
    if (targetRadius <= 0) return { x: currentCenterX, y: currentCenterY };
    const maxDistance = Math.max(0, currentRadius - targetRadius);
    const minX = Math.max(0, targetRadius);
    const maxX = Math.max(minX, this.mapCtx.width - targetRadius);
    const minY = Math.max(0, targetRadius);
    const maxY = Math.max(minY, this.mapCtx.height - targetRadius);

    for (let attempt = 0; attempt < 64; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * maxDistance;
      const candidateX = currentCenterX + Math.cos(angle) * distance;
      const candidateY = currentCenterY + Math.sin(angle) * distance;
      if (candidateX < minX || candidateX > maxX || candidateY < minY || candidateY > maxY) continue;
      return { x: candidateX, y: candidateY };
    }

    const fallbackX = Math.max(minX, Math.min(maxX, currentCenterX));
    const fallbackY = Math.max(minY, Math.min(maxY, currentCenterY));
    const fallbackDistance = Math.hypot(fallbackX - currentCenterX, fallbackY - currentCenterY);
    if (fallbackDistance <= maxDistance || fallbackDistance <= 0.0001) {
      return { x: fallbackX, y: fallbackY };
    }

    const ratio = maxDistance / fallbackDistance;
    return {
      x: currentCenterX + (fallbackX - currentCenterX) * ratio,
      y: currentCenterY + (fallbackY - currentCenterY) * ratio,
    };
  }

  private getRandomZoneNextDiameter(zone: SafeZone) {
    const stageIndex = Math.max(0, Math.floor(Number(zone.stageIndex ?? 0)));
    return YUMEN_SAFE_ZONE_TARGET_DIAMETERS[stageIndex] ?? null;
  }

  private getRandomZoneDps(zone: SafeZone) {
    return getYumenSafeZoneDps(zone);
  }

  private beginRandomZoneCountdown(zone: SafeZone, now: number, targetDiameter: number) {
    const currentRadius = Math.max(0, Number(zone.currentHalf ?? this.getRandomSafeZoneFullRadius()));
    const targetRadius = Math.max(0, targetDiameter / 2);
    const targetCenter = this.pickRandomSafeZoneCenter(zone.centerX, zone.centerY, currentRadius, targetRadius);
    zone.phase = "countdown";
    zone.phaseStartedAt = now;
    zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
    zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
    zone.phaseEndsAt = now + getYumenSafeZoneCountdownMs(Math.max(0, Math.floor(Number(zone.stageIndex ?? 0))), zone.timelineMode);
    zone.targetStageIndex = Math.max(0, Math.floor(Number(zone.stageIndex ?? 0))) + 1;
    zone.targetDiameter = targetDiameter;
    zone.targetHalf = targetRadius;
    zone.targetCenterX = targetCenter.x;
    zone.targetCenterY = targetCenter.y;
    zone.targetVisible = true;
    zone.shrinking = false;
    zone.shrinkProgress = 0;
    zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
    zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
    zone.fullPoison = false;
  }

  private beginRandomZoneShrink(zone: SafeZone, now: number, fallbackTargetDiameter?: number) {
    const stageIndex = Math.max(0, Math.floor(Number(zone.stageIndex ?? 0)));
    const targetDiameter = Math.max(0, Number(zone.targetDiameter ?? fallbackTargetDiameter ?? 0));
    const targetRadius = Math.max(0, Number(zone.targetHalf ?? targetDiameter / 2));
    const targetCenter = targetDiameter <= 0
      ? { x: zone.centerX, y: zone.centerY }
      : {
          x: Number.isFinite(zone.targetCenterX) ? Number(zone.targetCenterX) : zone.centerX,
          y: Number.isFinite(zone.targetCenterY) ? Number(zone.targetCenterY) : zone.centerY,
        };

    zone.phase = "shrinking";
    zone.phaseStartedAt = now;
    zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
    zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
    zone.phaseEndsAt = now + getYumenSafeZoneShrinkMs(stageIndex, zone.timelineMode);
    zone.targetStageIndex = stageIndex + 1;
    zone.targetDiameter = targetDiameter;
    zone.targetHalf = targetRadius;
    zone.targetCenterX = targetCenter.x;
    zone.targetCenterY = targetCenter.y;
    zone.targetVisible = targetDiameter > 0;
    zone.shrinkStartHalf = Math.max(0, Number(zone.currentHalf ?? 0));
    zone.shrinkStartCenterX = zone.centerX;
    zone.shrinkStartCenterY = zone.centerY;
    zone.shrinking = true;
    zone.shrinkProgress = 0;
    zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
    zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
    zone.fullPoison = false;
  }

  private finishRandomZoneShrink(zone: SafeZone, now: number) {
    const targetDiameter = Math.max(0, Number(zone.targetDiameter ?? 0));
    const targetRadius = Math.max(0, Number(zone.targetHalf ?? targetDiameter / 2));
    zone.centerX = Number.isFinite(zone.targetCenterX) ? Number(zone.targetCenterX) : zone.centerX;
    zone.centerY = Number.isFinite(zone.targetCenterY) ? Number(zone.targetCenterY) : zone.centerY;
    zone.currentHalf = targetRadius;
    zone.currentDiameter = targetDiameter;
    zone.stageIndex = Math.max(0, Math.floor(Number(zone.targetStageIndex ?? (Number(zone.stageIndex ?? 0) + 1))));
    zone.targetVisible = false;
    zone.shrinking = false;
    zone.shrinkProgress = 0;
    delete zone.shrinkStartCenterX;
    delete zone.shrinkStartCenterY;
    delete zone.shrinkStartHalf;

    if (targetDiameter <= 0) {
      zone.phase = "complete";
      zone.phaseStartedAt = now;
      zone.phaseEndsAt = now;
      zone.nextChangeIn = 0;
      zone.circleNumber = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
      zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
      zone.fullPoison = true;
      zone.dps = getYumenSafeZoneDps(zone);
      return;
    }

    zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
    zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
    const waitMs = getYumenSafeZoneWaitMs(Math.max(0, Math.floor(Number(zone.stageIndex ?? 0))), zone.timelineMode);
    zone.phase = "waiting";
    zone.phaseStartedAt = now;
    zone.phaseEndsAt = now + waitMs;
    zone.nextChangeIn = waitMs / 1000;
    zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
    zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
    zone.fullPoison = false;
  }

  private updateRandomSafeZone(now: number) {
    this.ensureRandomSafeZoneInitialized(now);
    const zone = this.state.safeZone;
    if (!zone) return;
    const phaseActive = zone.phase === "waiting" || zone.phase === "countdown" || zone.phase === "shrinking";
    if (phaseActive && zone.paused === true) {
      const remainingMs = Math.max(0, Number(zone.pausedRemainingMs ?? (Number(zone.phaseEndsAt ?? now) - now)));
      const elapsedMs = Math.max(0, Number(zone.phaseEndsAt ?? now) - Number(zone.phaseStartedAt ?? now) - remainingMs);
      zone.pausedRemainingMs = remainingMs;
      zone.pausedAt = Number.isFinite(Number(zone.pausedAt)) ? Number(zone.pausedAt) : now;
      zone.phaseStartedAt = now - elapsedMs;
      zone.phaseEndsAt = now + remainingMs;
      zone.shape = "circle";
      zone.currentDiameter = Math.max(0, Number(zone.currentHalf ?? 0)) * 2;
      zone.nextChangeIn = remainingMs / 1000;
      zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
      zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
      zone.fullPoison = zone.phase === "complete" || Number(zone.currentHalf ?? 0) <= 0;
      zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
      zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
      zone.dps = this.getRandomZoneDps(zone);
      return;
    }
    if (!phaseActive) {
      zone.paused = false;
      delete zone.pausedAt;
      delete zone.pausedRemainingMs;
    }
    if (!phaseActive) {
      zone.shape = "circle";
      zone.currentDiameter = Math.max(0, Number(zone.currentHalf ?? 0)) * 2;
      zone.shrinking = false;
      zone.shrinkProgress = 0;
      zone.targetVisible = false;
      zone.nextChangeIn = 0;
      zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
      zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
      zone.fullPoison = zone.phase === "complete" || Number(zone.currentHalf ?? 0) <= 0;
      zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
      zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
      zone.dps = this.getRandomZoneDps(zone);
      return;
    }
    zone.paused = false;
    delete zone.pausedAt;
    delete zone.pausedRemainingMs;

    let transitions = 0;
    while ((zone.phase === "waiting" || zone.phase === "countdown" || zone.phase === "shrinking") && Number(zone.phaseEndsAt ?? now) <= now && transitions < 8) {
      transitions += 1;
      if (zone.phase === "countdown") {
        this.beginRandomZoneShrink(zone, now);
      } else if (zone.phase === "shrinking") {
        this.finishRandomZoneShrink(zone, now);
      } else {
        const targetDiameter = this.getRandomZoneNextDiameter(zone);
        if (targetDiameter === null) {
          zone.phase = "complete";
          zone.phaseStartedAt = now;
          zone.phaseEndsAt = now;
          zone.nextChangeIn = 0;
          zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
          zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
          zone.fullPoison = true;
        } else {
          this.beginRandomZoneCountdown(zone, now, targetDiameter);
        }
      }
    }

    if (zone.phase === "shrinking") {
      const phaseStartedAt = Number(zone.phaseStartedAt ?? now);
      const phaseEndsAt = Number(zone.phaseEndsAt ?? now);
      const duration = Math.max(1, phaseEndsAt - phaseStartedAt);
      const progress = Math.min(1, Math.max(0, (now - phaseStartedAt) / duration));
      const startHalf = Number(zone.shrinkStartHalf ?? zone.currentHalf ?? 0);
      const startCenterX = Number(zone.shrinkStartCenterX ?? zone.centerX);
      const startCenterY = Number(zone.shrinkStartCenterY ?? zone.centerY);
      const targetHalf = Math.max(0, Number(zone.targetHalf ?? 0));
      const targetCenterX = Number.isFinite(zone.targetCenterX) ? Number(zone.targetCenterX) : startCenterX;
      const targetCenterY = Number.isFinite(zone.targetCenterY) ? Number(zone.targetCenterY) : startCenterY;
      zone.currentHalf = startHalf + (targetHalf - startHalf) * progress;
      zone.currentDiameter = zone.currentHalf * 2;
      zone.centerX = startCenterX + (targetCenterX - startCenterX) * progress;
      zone.centerY = startCenterY + (targetCenterY - startCenterY) * progress;
      zone.shrinking = true;
      zone.shrinkProgress = progress;
    } else {
      zone.currentDiameter = Math.max(0, Number(zone.currentHalf ?? 0)) * 2;
      zone.shrinking = false;
      zone.shrinkProgress = 0;
    }

    zone.shape = "circle";
    zone.nextChangeIn = Math.max(0, (Number(zone.phaseEndsAt ?? now) - now) / 1000);
    zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
    zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
    zone.fullPoison = zone.phase === "complete" || Number(zone.currentHalf ?? 0) <= 0;
    zone.timelineMode = normalizeYumenSafeZoneTimelineMode(zone.timelineMode);
    zone.damageMode = normalizeYumenSafeZoneDamageMode(zone.damageMode);
    zone.dps = this.getRandomZoneDps(zone);
  }

  /** Compute safe zone size and damage from elapsed time */
  private computeSafeZone(elapsedMs: number) {
    for (let i = 0; i < GameLoop.ZONE_PHASES.length; i++) {
      const phase = GameLoop.ZONE_PHASES[i];
      if (elapsedMs < phase.endTime) {
        const duration = phase.endTime - phase.startTime;
        const t = Math.min(1, Math.max(0, (elapsedMs - phase.startTime) / duration));
        const currentHalf = phase.fromHalf + (phase.toHalf - phase.fromHalf) * t;
        const shrinking = phase.fromHalf !== phase.toHalf;
        const shrinkProgress = shrinking ? t : 0;
        const nextChangeIn = (phase.endTime - elapsedMs) / 1000;
        return { currentHalf, dps: phase.dps, shrinking, shrinkProgress, nextChangeIn };
      }
    }
    return { currentHalf: 0, dps: 10, shrinking: false, shrinkProgress: 0, nextChangeIn: 0 };
  }

  private syncYumenPrepAnnouncements(now: number): boolean {
    if (!this.isYumenMode) return false;
    const stateAny = this.state as any;
    const prep = stateAny.yumenPrep;
    if (!prep || typeof prep !== "object") return false;

    let changed = false;
    const announcements = prep.announcements && typeof prep.announcements === "object" ? prep.announcements : {};
    if (prep.announcements !== announcements) {
      prep.announcements = announcements;
      changed = true;
    }

    const prepBuffs = (this.state.players ?? []).flatMap((player: any) =>
      (player.buffs ?? []).filter((buff: any) => buff?.buffId === YUMEN_PREP_BUFF_ID)
    );
    const activePrep = (this.state.players ?? []).some((player: any) => hasActiveYumenPrepBuff(player, now));
    const latestBuffEndsAt = prepBuffs.reduce((latest: number, buff: any) => Math.max(latest, Number(buff?.expiresAt ?? 0) || 0), 0);
    const prepEndsAt = Math.max(Number(prep.endsAt ?? 0) || 0, latestBuffEndsAt);
    if (!Number.isFinite(prepEndsAt) || prepEndsAt <= 0) return changed;
    if (prep.endsAt !== prepEndsAt) {
      prep.endsAt = prepEndsAt;
      changed = true;
    }

    if (activePrep) {
      const remainingMs = Math.max(0, prepEndsAt - now);
      const thresholds: Array<[string, number, string]> = [
        ["30", 30_000, "绝境将在30秒后开始。"],
        ["20", 20_000, "绝境将在20秒后开始。"],
        ["10", 10_000, "绝境将在10秒后开始。"],
        ["5", 5_000, "5!"],
        ["4", 4_000, "4!"],
        ["3", 3_000, "3!"],
        ["2", 2_000, "2!"],
        ["1", 1_000, "1!"],
      ];

      for (const [key, triggerMs, text] of thresholds) {
        if (announcements[key] === true || remainingMs > triggerMs) continue;
        announcements[key] = true;
        changed = true;
        void broadcastSystemChat(this.gameId, text).catch((err) => {
          console.error(`[GameLoop] Failed to broadcast Yumen prep chat for ${this.gameId}:`, err);
        });
      }
      return changed;
    }

    if (now >= prepEndsAt && announcements.open !== true) {
      announcements.open = true;
      changed = true;
      void broadcastSystemChat(this.gameId, "绝境开启!祝各位洪福齐天。").catch((err) => {
        console.error(`[GameLoop] Failed to broadcast Yumen prep start chat for ${this.gameId}:`, err);
      });
    }

    return changed;
  }

  /** Return true if player position is outside the safe zone */
  private isOutsideZone(px: number, py: number, cx: number, cy: number, half: number, shape: "square" | "circle" = "square") {
    if (shape === "circle") {
      return Math.hypot(px - cx, py - cy) > half;
    }
    return px < cx - half || px > cx + half || py < cy - half || py > cy + half;
  }

  private syncYumenKuangShaBuff(player: any, outsideSafeZone: boolean, now: number): boolean {
    if (!this.isYumenMode || !Array.isArray(player?.buffs)) return false;
    const matchingBuffs = player.buffs.filter((buff: any) => buff.buffId === YUMEN_KUANG_SHA_BUFF_ID || buff.buffId === YUMEN_ZHUI_MING_BUFF_ID);
    if (hasActiveYumenSpectatorBuff(player, now)) {
      if (matchingBuffs.length === 0 && player.yumenKuangShaStartedAt === undefined) return false;
      player.buffs = player.buffs.filter((buff: any) => buff.buffId !== YUMEN_KUANG_SHA_BUFF_ID && buff.buffId !== YUMEN_ZHUI_MING_BUFF_ID);
      delete player.yumenKuangShaStartedAt;
      for (const buff of matchingBuffs) {
        pushBuffExpired(this.state, {
          targetUserId: player.userId,
          buffId: buff.buffId,
          buffName: buff.name,
          buffCategory: buff.category,
          sourceAbilityId: buff.sourceAbilityId,
          sourceAbilityName: buff.sourceAbilityName,
          sourceUserId: buff.sourceUserId,
        });
      }
      return true;
    }
    const activeKuangSha = matchingBuffs.find((buff: any) => buff.buffId === YUMEN_KUANG_SHA_BUFF_ID && isRuntimeBuffActive(buff, now));
    if (outsideSafeZone) {
      let changed = false;
      const startedAt = Number(player.yumenKuangShaStartedAt ?? 0);
      if (!Number.isFinite(startedAt) || startedAt <= 0) {
        player.yumenKuangShaStartedAt = now;
        changed = true;
      }

      if (!activeKuangSha || Number(activeKuangSha.expiresAt ?? 0) - now <= 900) {
        addBuff({
          state: this.state,
          sourceUserId: player.userId,
          targetUserId: player.userId,
          ability: YUMEN_SAFE_ZONE_ABILITY,
          buffTarget: player,
          buff: YUMEN_KUANG_SHA_BUFF,
        });
        changed = true;
      }

      const activeZhuiMing = player.buffs.find((buff: any) => buff.buffId === YUMEN_ZHUI_MING_BUFF_ID && isRuntimeBuffActive(buff, now));
      const lastStackAt = Math.max(
        Number(activeZhuiMing?.lastProcAt ?? 0),
        Number(player.yumenKuangShaStartedAt ?? now),
      );
      if (now - lastStackAt >= YUMEN_ZHUI_MING_STACK_INTERVAL_MS) {
        addBuff({
          state: this.state,
          sourceUserId: player.userId,
          targetUserId: player.userId,
          ability: YUMEN_SAFE_ZONE_ABILITY,
          buffTarget: player,
          buff: YUMEN_ZHUI_MING_BUFF,
        });
        const refreshedZhuiMing = player.buffs.find((buff: any) => buff.buffId === YUMEN_ZHUI_MING_BUFF_ID && isRuntimeBuffActive(buff, now));
        if (refreshedZhuiMing) refreshedZhuiMing.lastProcAt = now;
        changed = true;
      }

      return changed;
    }

    const removedBuffs = matchingBuffs.filter((buff: any) => buff.buffId === YUMEN_KUANG_SHA_BUFF_ID);
    if (removedBuffs.length === 0 && player.yumenKuangShaStartedAt === undefined) return false;
    player.buffs = player.buffs.filter((buff: any) => buff.buffId !== YUMEN_KUANG_SHA_BUFF_ID);
    delete player.yumenKuangShaStartedAt;
    for (const buff of removedBuffs) {
      pushBuffExpired(this.state, {
        targetUserId: player.userId,
        buffId: buff.buffId,
        buffName: buff.name,
        buffCategory: buff.category,
        sourceAbilityId: buff.sourceAbilityId,
        sourceAbilityName: buff.sourceAbilityName,
        sourceUserId: buff.sourceUserId,
      });
    }
    return true;
  }

  private applyYumenDeathState(player: any, now: number): { changed: boolean; handChanged: boolean; consumablesChanged: boolean; worldObjectsChanged: boolean } {
    if (!this.isYumenMode || !player || hasActiveYumenSpectatorBuff(player, now)) {
      return { changed: false, handChanged: false, consumablesChanged: false, worldObjectsChanged: false };
    }

    const previousHand = Array.isArray(player.hand) ? JSON.parse(JSON.stringify(player.hand)) : [];
    player.yumenPreDeathHand = previousHand;
    const consumablesChanged = Object.keys(player.consumableCounts ?? {}).length > 0 || Object.keys(player.consumableCooldowns ?? {}).length > 0;

    const removedBuffs = Array.isArray(player.buffs) ? [...player.buffs] : [];
    for (const buff of removedBuffs) {
      removeLinkedShield(player as any, buff as any);
      pushBuffExpired(this.state, {
        targetUserId: player.userId,
        buffId: buff.buffId,
        buffName: buff.name,
        buffCategory: buff.category,
        sourceAbilityId: buff.sourceAbilityId,
        sourceAbilityName: buff.sourceAbilityName,
        sourceUserId: buff.sourceUserId,
      });
    }

    player.hp = 0;
    player.shield = 0;
    player.yumenDefeated = true;
    player.yumenDefeatedAt = now;
    player.buffs = [];
    player.hand = [];
    player.consumableCounts = {};
    player.consumableCooldowns = {};
    player.specialAbilityStates = {};
    player.globalGcdTicks = 0;
    delete player.visualGcd;
    delete player.activeChannel;
    delete player.activeDash;
    delete player.targetSelection;
    delete player.yumenKuangShaStartedAt;
    const playerCombatLinks = (player as any).combatLinks && typeof (player as any).combatLinks === "object" && !Array.isArray((player as any).combatLinks)
      ? (player as any).combatLinks
      : {};
    const playerRelatedCombatUserId = Object.keys(playerCombatLinks)[0];
    const playerWasInCombat = player.inCombat === true || Object.keys(playerCombatLinks).length > 0;
    delete player.combatLinks;
    player.inCombat = false;
    if (playerWasInCombat) {
      this.state.events.push({
        id: randomUUID(),
        timestamp: now,
        turn: this.state.turn,
        type: "COMBAT_STATUS",
        actorUserId: player.userId,
        targetUserId: player.userId,
        combatStatus: "exit",
        inCombat: false,
        relatedUserId: playerRelatedCombatUserId,
      });
    }

    for (const other of this.state.players ?? []) {
      if (other.userId === player.userId) continue;
      const otherLinks = (other as any).combatLinks && typeof (other as any).combatLinks === "object" && !Array.isArray((other as any).combatLinks)
        ? (other as any).combatLinks
        : {};
      if (otherLinks[player.userId]) {
        delete otherLinks[player.userId];
      }
      if (Object.keys(otherLinks).length === 0) {
        const otherWasInCombat = (other as any).inCombat === true;
        delete (other as any).combatLinks;
        (other as any).inCombat = false;
        if (otherWasInCombat) {
          this.state.events.push({
            id: randomUUID(),
            timestamp: now,
            turn: this.state.turn,
            type: "COMBAT_STATUS",
            actorUserId: other.userId,
            targetUserId: other.userId,
            combatStatus: "exit",
            inCombat: false,
            relatedUserId: player.userId,
          });
        }
      }
    }
    clearTargetSelectionsTargetingPlayer(this.state, player.userId);

    const groundZonesBefore = this.state.groundZones?.length ?? 0;
    if (Array.isArray(this.state.groundZones)) {
      this.state.groundZones = this.state.groundZones.filter((zone: any) => zone?.ownerUserId !== player.userId);
    }
    const entitiesBefore = this.state.entities?.length ?? 0;
    if (Array.isArray(this.state.entities)) {
      this.state.entities = this.state.entities.filter((entity: any) => entity?.ownerUserId !== player.userId);
    }

    addBuff({
      state: this.state,
      sourceUserId: player.userId,
      targetUserId: player.userId,
      ability: YUMEN_SPECTATOR_ABILITY,
      buffTarget: player,
      buff: YUMEN_SPECTATOR_BUFF,
    });

    return {
      changed: true,
      handChanged: true,
      consumablesChanged,
      worldObjectsChanged: (this.state.groundZones?.length ?? 0) !== groundZonesBefore || (this.state.entities?.length ?? 0) !== entitiesBefore,
    };
  }

  private applyYumenKillReward(attackerUserId: string | null | undefined, defeatedUserIds: Set<string>, now: number): boolean {
    if (!attackerUserId || defeatedUserIds.has(attackerUserId)) return false;
    const attacker = this.state.players.find((player) => player.userId === attackerUserId);
    if (!attacker || attacker.hp <= 0 || hasActiveYumenSpectatorBuff(attacker as any, now)) return false;
    addBuff({
      state: this.state,
      sourceUserId: attacker.userId,
      targetUserId: attacker.userId,
      ability: YUMEN_ZHANYI_ABILITY,
      buffTarget: attacker as any,
      buff: YUMEN_ZHANYI_BUFF,
    });
    return true;
  }

  private getYumenDefeatEventName(userId: string | null | undefined): string | undefined {
    if (!userId) return undefined;
    const player = this.state.players.find((entry: any) => entry.userId === userId) as any;
    if (typeof player?.username === "string" && player.username.trim()) return player.username.trim();
    const stateNames = (this.state as any).playerNames;
    const stateName = stateNames && typeof stateNames === "object" ? stateNames[userId] : undefined;
    if (typeof stateName === "string" && stateName.trim()) return stateName.trim();
    return `User${String(userId).slice(-4)}`;
  }

  private pushYumenDefeatEvents(announcements: DefeatAnnouncement[], now: number) {
    for (const announcement of announcements) {
      this.state.events.push({
        id: randomUUID(),
        timestamp: now,
        turn: this.state.turn,
        type: "YUMEN_DEFEAT",
        actorUserId: announcement.attackerUserId ?? announcement.defeatedUserId,
        targetUserId: announcement.defeatedUserId,
        attackerUserId: announcement.attackerUserId ?? null,
        defeatedUserId: announcement.defeatedUserId,
        attackerName: this.getYumenDefeatEventName(announcement.attackerUserId) ?? "大漠狂沙",
        defeatedName: this.getYumenDefeatEventName(announcement.defeatedUserId),
      });
    }
  }

  private syncDynamicMapContext() {
    this.mapCtx.playArea = this.state.playArea;
  }

  private pruneEventHistoryForBroadcast(): boolean {
    if (!Array.isArray(this.state.events) || this.state.events.length <= MAX_EVENT_HISTORY_BEFORE_TRIM) {
      return false;
    }

    const removedCount = Math.max(0, this.state.events.length - EVENT_HISTORY_KEEP_COUNT);
    this.state.events = this.state.events.slice(-EVENT_HISTORY_KEEP_COUNT);
    this.stackProcScanIndex = Math.max(0, this.stackProcScanIndex - removedCount);
    return true;
  }

  /**
   * Start the game loop for a game
   */
  static start(
    gameId: string,
    state: GameState,
    config?: GameLoopConfig
  ): GameLoop {
    let loop = activeLoops.get(gameId);

    if (loop && loop.isRunning) {
      console.warn(`[GameLoop] Game ${gameId} already has an active loop`);
      return loop;
    }

    loop = new GameLoop(gameId, state, config);
    loop.run();
    activeLoops.set(gameId, loop);

    console.log(`[GameLoop] Started for game ${gameId} at ${loop.tickRate} Hz`);
    return loop;
  }

  /**
   * Stop the game loop
   */
  static stop(gameId: string) {
    const loop = activeLoops.get(gameId);
    if (loop) {
      loop.stop();
      activeLoops.delete(gameId);
      console.log(`[GameLoop] Stopped for game ${gameId}`);
    }
  }

  /**
   * Get active loop for a game
   */
  static get(gameId: string): GameLoop | undefined {
    const loop = activeLoops.get(gameId);
    // Do NOT delete from activeLoops here — getInMemoryGameOver needs to read
    // the terminal state after the loop stops. Only static stop() cleans up.
    if (!loop || !loop.isRunning) {
      return undefined;
    }
    return loop;
  }

  /**
   * Queue player movement input
   * Called when client sends WASD input
   */
  setPlayerInput(
    playerIndex: number,
    input: MovementInput | null,
    seq?: number,
    clientSession?: { id: string; startedAt: number },
  ) {
    if (clientSession?.id) {
      const currentSession = this.playerInputClientSessions.get(playerIndex);
      if (!currentSession || currentSession.id !== clientSession.id) {
        if (
          currentSession &&
          Number.isFinite(currentSession.startedAt) &&
          Number.isFinite(clientSession.startedAt) &&
          clientSession.startedAt < currentSession.startedAt
        ) {
          return false;
        }
        this.playerInputClientSessions.set(playerIndex, clientSession);
        this.playerInputSeq.delete(playerIndex);
      }
    }

    if (typeof seq === "number") {
      const lastSeq = this.playerInputSeq.get(playerIndex);
      const isLateSeq = typeof lastSeq === "number" && seq < lastSeq;
      const isLateJumpPulse = isLateSeq && input?.jump === true && lastSeq - seq <= 90;
      if (isLateSeq && !isLateJumpPulse) {
        return false;
      }
      if (!isLateSeq) {
        this.playerInputSeq.set(playerIndex, seq);
      }
    }

    const pendingInput = this.playerInputs.get(playerIndex) ?? null;
    let nextInput = input;
    const snapshotJumpIntent = (source: MovementInput): NonNullable<MovementInput["jumpIntent"]> => ({
      up: source.up === true,
      down: source.down === true,
      left: source.left === true,
      right: source.right === true,
      dx: typeof source.dx === "number" ? source.dx : undefined,
      dy: typeof source.dy === "number" ? source.dy : undefined,
      backpedalOnly: source.backpedalOnly === true,
      facing: source.facing ? { x: source.facing.x, y: source.facing.y } : undefined,
    });

    // Jump is a one-shot pulse, so keep it latched until the loop tick consumes it.
    if (typeof seq === "number") {
      const lastSeq = this.playerInputSeq.get(playerIndex);
      const isLateJumpPulse = typeof lastSeq === "number" && seq < lastSeq && input?.jump === true && lastSeq - seq <= 90;
      if (isLateJumpPulse && input) {
        nextInput = pendingInput?.jump
          ? pendingInput
          : pendingInput
          ? { ...pendingInput, jump: true, jumpIntent: snapshotJumpIntent(input) }
          : { ...input, jumpIntent: snapshotJumpIntent(input) };
      }
    }

    if (pendingInput?.jump && !nextInput?.jump) {
      const jumpIntent = pendingInput.jumpIntent ?? snapshotJumpIntent(pendingInput);
      nextInput = nextInput ? { ...nextInput, jump: true, jumpIntent } : { ...pendingInput, jumpIntent };
    } else if (nextInput?.jump && !nextInput.jumpIntent) {
      nextInput = { ...nextInput, jumpIntent: snapshotJumpIntent(nextInput) };
    }

    if (nextInput?.jump) {
      const player = this.state.players[playerIndex];
      if (player) {
        if (shouldSuppressJumpWhileChanneling(player as any)) {
          nextInput = { ...nextInput, jump: false };
        } else {
          // Short lock window for requiresGrounded casts to close jump/cast race.
          player.groundedCastLockUntil = Date.now() + 250;
        }
      }
    }
    this.playerInputs.set(playerIndex, nextInput);
    return true;
  }

  setPlayerInputForUser(
    userId: string,
    input: MovementInput | null,
    seq?: number,
    clientSession?: { id: string; startedAt: number },
  ): { accepted: boolean; playerIndex: number; position: any; velocity: any } | null {
    const playerIndex = this.state.players.findIndex((player) => player.userId === userId);
    if (playerIndex === -1) return null;
    const accepted = this.setPlayerInput(playerIndex, input, seq, clientSession);
    const player = this.state.players[playerIndex];
    return {
      accepted,
      playerIndex,
      position: { ...player.position },
      velocity: player.velocity ? { ...player.velocity } : undefined,
    };
  }

  hasPendingJump(playerIndex: number): boolean {
    const input = this.playerInputs.get(playerIndex);
    return input?.jump === true;
  }

  hasMovementIntent(playerIndex: number): boolean {
    const input = this.playerInputs.get(playerIndex);
    if (!input) return false;
    if (typeof input.dx === "number" || typeof input.dy === "number") {
      return Math.hypot(input.dx ?? 0, input.dy ?? 0) > 0.01;
    }
    return input.up || input.down || input.left || input.right;
  }

  /**
   * Main game loop - runs every tick
   */
  private run() {
    if (this.isRunning) {
      console.warn(`[GameLoop] ${this.gameId} already running`);
      return;
    }

    this.isRunning = true;
    const tickDuration = 1000 / this.tickRate;
    console.log(`[GameLoop] Using adaptive timer loop — tickDuration=${tickDuration.toFixed(2)}ms`);

    let lastTickTime = performance.now();
    let lastCallbackAt = lastTickTime;
    const MAX_TICKS_PER_CALLBACK = 6;
    const runTicks = () => {
      if (!this.isRunning) return;
      const callbackStartedAt = performance.now();
      const callbackGapMs = callbackStartedAt - lastCallbackAt;
      lastCallbackAt = callbackStartedAt;
      if (callbackGapMs >= 150) {
        recordLagProbe("game-loop-callback-gap", {
          gameId: this.gameId,
          version: this.state.version ?? null,
          gapMs: roundLagMs(callbackGapMs),
          tickDurationMs: roundLagMs(tickDuration),
          playerCount: this.state.players.length,
          eventCount: this.state.events.length,
          gameOver: this.state.gameOver === true,
        });
      }
      let ticksProcessed = 0;

      while (ticksProcessed < MAX_TICKS_PER_CALLBACK) {
        const now = performance.now();
        if (lastTickTime + tickDuration > now) break;
        lastTickTime += tickDuration;
        ticksProcessed++;
        try {
          this.tick();
        } catch (err) {
          console.error(`[GameLoop] Error in tick for ${this.gameId}:`, err);
          this.stop();
          return;
        }
        if (!this.isRunning) return;
      }

      const now = performance.now();
      if (now - lastTickTime > tickDuration * MAX_TICKS_PER_CALLBACK) {
        lastTickTime = now;
      }

      const callbackTotalMs = performance.now() - callbackStartedAt;
      if (callbackTotalMs >= 100 || ticksProcessed >= MAX_TICKS_PER_CALLBACK) {
        recordLagProbe("game-loop-callback-work", {
          gameId: this.gameId,
          version: this.state.version ?? null,
          ticksProcessed,
          callbackMs: roundLagMs(callbackTotalMs),
          tickDurationMs: roundLagMs(tickDuration),
          playerCount: this.state.players.length,
          eventCount: this.state.events.length,
          gameOver: this.state.gameOver === true,
        });
      }

      const delayMs = Math.max(1, Math.ceil(lastTickTime + tickDuration - now));
      this.tickInterval = setTimeout(runTicks, delayMs);
    };

    this.tickInterval = setTimeout(runTicks, Math.max(1, Math.ceil(tickDuration)));
  }

  /**
   * Single tick of the game loop
   */
  private tick() {
    const tickStart = performance.now();
    const storedUnitScale = normalizeStoredUnitScale(this.state.unitScale);
    this.syncDynamicMapContext();

    if (this.state.gameOver) {
      this.stop();
      return;
    }

    // Track new events for this entire tick (including activeChannel completion).
    const eventDiffStart = this.state.events.length;
    let combatStatusChanged = false;

    const combatCheckNow = Date.now();
    if (combatCheckNow - this.lastCombatStatusCheckAt >= COMBAT_STATUS_CHECK_INTERVAL_MS) {
      this.lastCombatStatusCheckAt = combatCheckNow;
      combatStatusChanged = expireCombatStatusLinks(this.state, combatCheckNow) || combatStatusChanged;
    }

    // 1. Apply player movement
    const moveStart = performance.now();
    // Track buff count per player before movement — applyMovement may splice JUMP_BOOST
    const buffCountsBefore = this.state.players.map((p) => p.buffs?.length ?? 0);
    let movementStateChanged = false;
    let movementBuffsChanged = false;
    this.state.players.forEach((player, idx) => {
      let input = this.playerInputs.get(idx) ?? null;
      // ── 恐惧 (FEARED): force walk away from sourceUserId, ignore player input ──
      const fearedBuff = (player.buffs as any[]).find(
        (b) => b.expiresAt > Date.now() && b.effects?.some((e: any) => e.type === "FEARED")
      );
      if (fearedBuff) {
        const src = this.state.players.find((p) => p.userId === fearedBuff.sourceUserId);
        if (src) {
          const dx = player.position.x - src.position.x;
          const dy = player.position.y - src.position.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.0001) {
            const ax = dx / len;
            const ay = dy / len;
            input = { dx: ax, dy: ay, facing: { x: ax, y: ay }, jump: false } as any;
          } else {
            input = { dx: 1, dy: 0, facing: { x: 1, y: 0 }, jump: false } as any;
          }
        }
      } else {
        const shiXinBuff = (player.buffs as any[]).find(
          (b) => b.expiresAt > Date.now() && b.effects?.some((e: any) => e.type === "SHI_XIN_GU")
        );
        if (shiXinBuff) {
          if ((shiXinBuff as any).forcedMovementMode === "direction") {
            const dir = (shiXinBuff as any).forcedMoveDirection;
            const dx = Number(dir?.x ?? 0);
            const dy = Number(dir?.y ?? 0);
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.0001) {
              const ax = dx / len;
              const ay = dy / len;
              input = { dx: ax, dy: ay, facing: { x: ax, y: ay }, jump: false } as any;
            } else {
              input = { dx: 1, dy: 0, facing: { x: 1, y: 0 }, jump: false } as any;
            }
          } else {
            player.velocity.vx = 0;
            player.velocity.vy = 0;
            input = {
              dx: 0,
              dy: 0,
              facing: player.facing ?? { x: 0, y: 1 },
              jump: false,
            } as any;
          }
        }
      }
      if (input?.jump && shouldSuppressJumpWhileChanneling(player as any)) {
        input = { ...input, jump: false };
        this.playerInputs.set(idx, input);
      }
      const lingRanJumpLockImmune = hasLingRanTianFengState(player as any);
      const movementLockChannel = isActiveChannelRuntime((player as any).activeChannel)
        ? (player as any).activeChannel
        : null;
      if (movementLockChannel?.lockMovement === true) {
        if (input) {
          input = {
            ...input,
            dx: 0,
            dy: 0,
            jump: lingRanJumpLockImmune ? input.jump : false,
          };
          this.playerInputs.set(idx, input);
        }
        player.velocity.vx = 0;
        player.velocity.vy = 0;
      }

      const dashStateBefore = player.activeDash ? { ...player.activeDash } : undefined;
      const dashAbilityIdBefore = player.activeDash?.abilityId;
      const previousPosition = { x: player.position.x, y: player.position.y };
      const movementBuffSignatureBefore = JSON.stringify((player.buffs ?? []).map((b: any) => ({
        buffId: b.buffId,
        expiresAt: b.expiresAt,
        shieldAmount: b.shieldAmount,
        sourceAbilityId: b.sourceAbilityId,
      })));
      applyMovement(player, input, this.tickRate, this.mapCtx);
      const movementBuffSignatureAfter = JSON.stringify((player.buffs ?? []).map((b: any) => ({
        buffId: b.buffId,
        expiresAt: b.expiresAt,
        shieldAmount: b.shieldAmount,
        sourceAbilityId: b.sourceAbilityId,
      })));
      if (movementBuffSignatureAfter !== movementBuffSignatureBefore) {
        movementBuffsChanged = true;
        movementStateChanged = true;
      }
      if (resolveChuHeHanJieCollisionForPlayer(this.state, player, this.mapCtx.playerRadius ?? 2, previousPosition)) {
        movementStateChanged = true;
      }
      if (player.activeDash && clampPlayerToLvYeManShengEdge({
        state: this.state,
        player,
        playerRadius: this.mapCtx.playerRadius ?? 2,
        storedUnitScale,
        mapCtx: this.mapCtx,
      })) {
        movementStateChanged = true;
      }

      // ── 乘黄之威: on dash end, flip facing 180° and silence/fear enemies in 6u/120° cone of new facing ──
      if (dashStateBefore && !player.activeDash && (dashStateBefore as any).chengHuangFlipAndFear) {
        const oldFx = player.facing?.x ?? 0;
        const oldFy = player.facing?.y ?? 1;
        const newFx = -oldFx;
        const newFy = -oldFy;
        player.facing = { x: newFx, y: newFy };
        const chwAbility = ABILITIES["cheng_huang_zhi_wei"] as any;
        this.state.events.push({
          id: randomUUID(),
          timestamp: Date.now(),
          turn: this.state.turn,
          type: "ABILITY_SOUND",
          actorUserId: player.userId,
          targetUserId: player.userId,
          abilityId: "cheng_huang_zhi_wei",
          abilityName: chwAbility?.name ?? "乘黄之威",
          soundPhase: "dashComplete",
        } as any);
        const coneRadiusWorld = gameplayUnitsToWorldUnits(6, this.state.unitScale);
        const halfAngleCos = Math.cos((120 / 2) * Math.PI / 180); // cos(60°) = 0.5
        for (const enemyP of this.state.players) {
          if (enemyP.userId === player.userId) continue;
          if ((enemyP.hp ?? 0) <= 0) continue;
          if (blocksEnemyTargeting(enemyP as any)) continue;
          const dxC = enemyP.position.x - player.position.x;
          const dyC = enemyP.position.y - player.position.y;
          const distC = Math.sqrt(dxC * dxC + dyC * dyC);
          if (distC > coneRadiusWorld || distC < 0.0001) continue;
          const dot = (newFx * dxC + newFy * dyC) / distC;
          if (dot < halfAngleCos) continue;
          addBuff({
            state: this.state,
            sourceUserId: player.userId,
            targetUserId: enemyP.userId,
            ability: chwAbility ?? { id: "cheng_huang_zhi_wei", name: "乘黄之威" } as any,
            buffTarget: enemyP as any,
            buff: {
              buffId: 2625,
              name: "恐惧",
              category: "DEBUFF",
              durationMs: 3_000,
              description: "沉默并强制远离施法者，无法控制移动",
              effects: [
                { type: "SILENCE" },
                { type: "FEARED" },
              ],
            } as any,
          });
        }
      }

      if (dashStateBefore && !player.activeDash && dashStateBefore.hitTargetUserId) {
        const reachAbilityId = dashStateBefore.abilityId;
        const reachAbility = ABILITIES[reachAbilityId] as any;
        const reachTarget = this.state.players.find(
          (p) => p.userId === dashStateBefore.hitTargetUserId
        );

        if (reachAbility && reachTarget && (reachTarget.hp ?? 0) > 0 && !blocksEnemyTargeting(reachTarget) && !hasDamageImmune(reachTarget as any)) {
          const reachDamage = Math.max(0, Number(dashStateBefore.hitDamageOnComplete ?? 0));
          if (reachDamage > 0) {
            const finalDamage = resolveScheduledDamage({
              source: player,
              target: reachTarget,
              base: reachDamage,
              abilityId: reachAbilityId,
              damageType: (reachAbility as any)?.damageType,
            });
            if (finalDamage > 0) {
              const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(
                this.state, reachTarget as any, finalDamage
              );
              const reachApply = adjustedDamage;
              const reachResult = reachApply > 0
                ? applyDamageToTarget(reachTarget as any, reachApply)
                : { hpDamage: 0, shieldAbsorbed: 0 };
              this.state.events.push({
                id: randomUUID(),
                timestamp: Date.now(),
                turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: player.userId,
                targetUserId: reachTarget.userId,
                abilityId: reachAbility.id,
                abilityName: reachAbility.name,
                effectType: dashStateBefore.hitEffectTypeOnComplete ?? "DAMAGE",
                value: reachApply,
              } as any);
              if (reachResult.hpDamage > 0 || reachResult.shieldAbsorbed > 0) {
                processOnDamageTaken(this.state, reachTarget as any, reachResult.hpDamage, player.userId, reachResult.shieldAbsorbed);
              }
              if (redirectPlayer && redirectAmt > 0) {
                applyRedirectToOpponent(this.state, redirectPlayer, redirectAmt);
              }
            }
          }
        }
      }

      // 穹隆化生: apply end-of-charge heal + 生太极 zone when directional dash naturally ends.
      if (dashAbilityIdBefore === "qionglong_huasheng" && !player.activeDash) {
        const dashEndNow = Date.now();
        const healed = applyHealToTarget(player as any, resolveMaxHpPercentHealAmount(player, 10));
        if (healed > 0) {
          this.state.events.push({
            id: randomUUID(),
            timestamp: dashEndNow,
            turn: this.state.turn,
            type: "HEAL",
            actorUserId: player.userId,
            targetUserId: player.userId,
            abilityId: "qionglong_huasheng",
            abilityName: "穹隆化生（贯体）",
            effectType: "TIMED_SELF_HEAL",
            value: healed,
          } as any);
        }

        if (!this.state.groundZones) this.state.groundZones = [];
        const shengTaiJiRadius = gameplayUnitsToWorldUnits(8, storedUnitScale);
        const shengTaiJiGroundZ = getGroundHeightForMap(player.position.x, player.position.y, player.position.z ?? 0, this.mapCtx);
        const qionglongShengTaiJiHeight = gameplayUnitsToWorldUnits(99, storedUnitScale);
        this.state.groundZones.push({
          id: randomUUID(),
          ownerUserId: player.userId,
          x: player.position.x,
          y: player.position.y,
          z: shengTaiJiGroundZ,
          height: qionglongShengTaiJiHeight,
          radius: shengTaiJiRadius,
          expiresAt: dashEndNow + 24_000,
          damagePerInterval: 0,
          intervalMs: 3_000,
          lastTickAt: dashEndNow - 3_000,
          abilityId: SHENGTAIJI_ZONE_ID,
          abilityName: "生太极",
          maxTargets: 0,
        } as GroundZone);
        movementStateChanged = true;
      }

      if (dashAbilityIdBefore === "sanliu_xia" && !player.activeDash) {
        const sanliuAbility = ABILITIES["sanliu_xia"] as any;
        if (sanliuAbility) {
          addBuff({
            state: this.state,
            sourceUserId: player.userId,
            targetUserId: player.userId,
            ability: sanliuAbility,
            buffTarget: player as any,
            buff: {
              buffId: 1007,
              name: "散流霞",
              category: "BUFF",
              durationMs: 5_000,
              periodicMs: 1_000,
              periodicStartImmediate: false,
              breakOnPlay: true,
              description: "不可选中，移动速度提高20%，首秒无治疗，随后每秒回复2%最大气血",
              effects: [
                { type: "UNTARGETABLE" },
                { type: "SPEED_BOOST", value: 0.2 },
                { type: "PERIODIC_GUAN_TI_HEAL", value: 2 },
              ],
            } as any,
          });
          movementStateChanged = true;
        }
      }

      // 撼地: when dash ends, apply stun to enemies within 5u
      if (dashAbilityIdBefore === "han_di" && !player.activeDash) {
        const hanDiAbility = ABILITIES["han_di"] as any;
        if (hanDiAbility) {
          const stunBuff = hanDiAbility.buffs?.[0];
          const dashEffect = Array.isArray(hanDiAbility.effects)
            ? hanDiAbility.effects.find((candidate: any) => candidate?.type === "GROUND_TARGET_DASH")
            : null;
          const aoeDamage = Number(dashEffect?.aoeDamage ?? 1);
          if (stunBuff) {
            for (const opp of getMiYunAffectedHostileTargets({
              state: this.state,
              source: player as any,
              sourceUserId: player.userId,
              center: player.position,
              storedUnitScale,
              rangeUnits: 5,
            })) {
              if (stunBuff) {
                addBuff({
                  state: this.state,
                  sourceUserId: player.userId,
                  targetUserId: opp.target.userId,
                  ability: hanDiAbility,
                  buffTarget: opp.target,
                  buff: stunBuff,
                });
              }
              applyDamageToHostileTarget({
                state: this.state,
                source: player as any,
                target: opp,
                baseDamage: aoeDamage,
                abilityId: "han_di",
                abilityName: hanDiAbility.name,
                effectType: "DAMAGE",
                damageType: (ABILITIES["han_di"] as any)?.damageType,
                timestamp: Date.now(),
              });
            }
            movementStateChanged = true;
          }
        }
      }

      // 跃潮斩波: when dash ends, deal configured landing damage to enemies within 8u
      if (dashAbilityIdBefore === "yue_chao_zhan_bo" && !player.activeDash) {
        const yczbAbility = ABILITIES["yue_chao_zhan_bo"] as any;
        if (yczbAbility) {
          const dashEffect = Array.isArray(yczbAbility.effects)
            ? yczbAbility.effects.find((entry: any) => entry?.type === "DASH")
            : null;
          const landingDamage = Number(dashEffect?.landingDamage ?? 15);
          const hitTargets = getMiYunAffectedHostileTargets({
            state: this.state,
            source: player as any,
            sourceUserId: player.userId,
            center: player.position,
            storedUnitScale,
            rangeUnits: 8,
          });
          if (hitTargets.length > 0) {
            this.state.events.push({
              id: randomUUID(),
              timestamp: Date.now(),
              turn: this.state.turn,
              type: "ABILITY_SOUND",
              actorUserId: player.userId,
              targetUserId: player.userId,
              abilityId: "yue_chao_zhan_bo",
              abilityName: yczbAbility.name,
              soundPhase: "dashComplete",
            } as any);
          }
          for (const opp of hitTargets) {
            applyDamageToHostileTarget({
              state: this.state,
              source: player as any,
              target: opp,
              baseDamage: landingDamage,
              abilityId: "yue_chao_zhan_bo",
              abilityName: yczbAbility.name,
              effectType: "DAMAGE",
              damageType: (ABILITIES["yue_chao_zhan_bo"] as any)?.damageType,
              timestamp: Date.now(),
            });
          }
          movementStateChanged = true;
        }
      }

      // 九转归一: when the knockback dash ends AND wall was hit, apply 羽化 stun
      if (dashAbilityIdBefore === "jiu_zhuan_gui_yi" && !player.activeDash) {        const stunMs: number = (player as any)._wallKnockStunMs ?? 0;
        if (stunMs > 0) {
          const jiuAbility = ABILITIES["jiu_zhuan_gui_yi"] as any;
          const yuHuaBuff = jiuAbility?.buffs?.find((b: any) => b.buffId === 9202);
          const knockbackEffect = Array.isArray(jiuAbility?.effects)
            ? jiuAbility.effects.find((effect: any) => effect?.type === "KNOCKBACK_DASH")
            : null;
          const wallHitDamage = Number(knockbackEffect?.wallHitDamage ?? 0);
          if (jiuAbility && yuHuaBuff) {
            // Remove the KNOCKED_BACK phase debuff so it doesn't overlap
            player.buffs = player.buffs.filter((b) => b.buffId !== 9101);
            const sourceId: string = (player as any)._wallKnockSourceUserId ?? player.userId;

            if (wallHitDamage > 0) {
              applyDamageToHostileTarget({
                state: this.state,
                source: { userId: sourceId, buffs: [] },
                target: { kind: "player", target: player as any },
                baseDamage: wallHitDamage,
                abilityId: "jiu_zhuan_gui_yi",
                abilityName: jiuAbility.name,
                effectType: "DAMAGE",
                damageType: jiuAbility.damageType,
                timestamp: Date.now(),
              });
            }

            // addBuff handles: 递减, CONTROL_IMMUNE check, BUFF_APPLIED event, status bar
            addBuff({
              state: this.state,
              sourceUserId: sourceId,
              targetUserId: player.userId,
              ability: jiuAbility,
              buffTarget: player as any,
              buff: { ...yuHuaBuff, durationMs: stunMs },
            });
            movementStateChanged = true;
          }
        }
        delete (player as any)._wallKnockStunMs;
        delete (player as any)._wallKnockAbilityId;
        delete (player as any)._wallKnockSourceUserId;
      }

      if (dashAbilityIdBefore === "hun_ya_nu_tao" && !player.activeDash) {
        const hunYaAbility = ABILITIES["hun_ya_nu_tao"] as any;
        const stunBuff = hunYaAbility?.buffs?.find((b: any) => b.buffId === 2730);
        const sourceUserId = (player as any)._hunYaNuTaoSourceUserId;
        if (hunYaAbility && stunBuff && sourceUserId) {
          addBuff({
            state: this.state,
            sourceUserId,
            targetUserId: player.userId,
            ability: hunYaAbility,
            buffTarget: player as any,
            buff: stunBuff,
          });
          movementStateChanged = true;
        }
        delete (player as any)._hunYaNuTaoSourceUserId;
      }

      if (dashAbilityIdBefore === "yuan" && !player.activeDash) {
        const yuanAbility = ABILITIES["yuan"] as any;
        const yuanTargetUserId = (dashStateBefore as any).yuanTargetUserId;
        const yuanTargetEntityId = (dashStateBefore as any).yuanTargetEntityId;
        const yuanTarget = yuanTargetEntityId
          ? (this.state.entities ?? []).find((entity: any) => entity.id === yuanTargetEntityId)
          : this.state.players.find((candidate) => candidate.userId === yuanTargetUserId);
        const landingRangeUnits = Math.max(0, Number((dashStateBefore as any).yuanLandingRangeUnits ?? 4));
        const knockbackRangeUnits = Math.max(0, Number((dashStateBefore as any).yuanKnockbackRangeUnits ?? 6));
        const knockbackDistanceUnits = Math.max(0, Number((dashStateBefore as any).yuanKnockbackDistanceUnits ?? 6));
        const knockbackTicks = Math.max(1, Number((dashStateBefore as any).yuanKnockbackTicks ?? 15));
        if (
          yuanAbility &&
          yuanTarget &&
          (yuanTarget.hp ?? 0) > 0 &&
          calculateDistance(player.position, yuanTarget.position, storedUnitScale) <= landingRangeUnits
        ) {
          let knockedBackAny = false;
          for (const hostile of getMiYunAffectedHostileTargets({
            state: this.state,
            source: player as any,
            sourceUserId: player.userId,
            center: yuanTarget.position,
            storedUnitScale,
            rangeUnits: knockbackRangeUnits,
          })) {
            if (applyKnockbackToHostileTarget({
              state: this.state,
              source: { userId: player.userId, position: yuanTarget.position },
              target: hostile,
              ability: yuanAbility,
              distanceUnits: knockbackDistanceUnits,
              durationTicks: knockbackTicks,
              knockedBackBuffId: 9101,
            })) {
              knockedBackAny = true;
            }
          }
          if (knockedBackAny) {
            movementStateChanged = true;
          }
        }
      }

      // 鹤归孤山: on dash end, deal damage + stun to nearby enemies, then give caster 0.5s dash buff
      if (dashAbilityIdBefore === "he_gui_gu_shan" && !player.activeDash) {
        const heAbility = ABILITIES["he_gui_gu_shan"] as any;
        if (heAbility) {
          const dashEffect = Array.isArray(heAbility.effects)
            ? heAbility.effects.find((entry: any) => entry?.type === "DIRECTIONAL_DASH")
            : null;
          const landDamage = Number(dashEffect?.landDamage ?? 2);
          const closeBonusDamage = Number(dashEffect?.closeBonusDamage ?? 2);
          const stunBuff = heAbility.buffs?.find((b: any) => b.buffId === 2325);
          for (const opp of getMiYunAffectedHostileTargets({
            state: this.state,
            source: player as any,
            sourceUserId: player.userId,
            center: player.position,
            storedUnitScale,
            rangeUnits: 10,
          })) {
            const dist = getHostileDamageTargetRangeDistance(player.position, opp, storedUnitScale);
            applyDamageToHostileTarget({
              state: this.state,
              source: player as any,
              target: opp,
              baseDamage: landDamage,
              abilityId: "he_gui_gu_shan",
              abilityName: heAbility.name,
              effectType: "DAMAGE",
              damageType: (ABILITIES["he_gui_gu_shan"] as any)?.damageType,
              timestamp: Date.now(),
            });
            if (dist <= 4) {
              applyDamageToHostileTarget({
                state: this.state,
                source: player as any,
                target: opp,
                baseDamage: closeBonusDamage,
                abilityId: "he_gui_gu_shan",
                abilityName: heAbility.name,
                effectType: "DAMAGE",
                damageType: (ABILITIES["he_gui_gu_shan"] as any)?.damageType,
                timestamp: Date.now(),
              });
            }
            if (stunBuff) {
              addBuff({
                state: this.state,
                sourceUserId: player.userId,
                targetUserId: opp.target.userId,
                ability: heAbility,
                buffTarget: opp.target,
                buff: stunBuff,
              });
            }
          }
          // Grant caster 0.5s of post-landing dash CC immunity (冲势)
          applyDashRuntimeBuff({
            state: this.state,
            target: player as any,
            durationMs: 500,
            effects: [
              { type: "CONTROL_IMMUNE" },
              { type: "KNOCKBACK_IMMUNE" },
            ],
            sourceAbilityId: "he_gui_gu_shan",
            sourceAbilityName: heAbility.name,
          });
          movementStateChanged = true;
        }
      }

      // 化蝶 Phase 2: when Phase 1 dash ends, start the forward 27u dash + apply stealth/immune buff
      if (dashAbilityIdBefore === "hua_die" && !player.activeDash && !(player as any)._huaDieP2Done) {
        (player as any)._huaDieP2Done = true;
        const huaDieAbility = ABILITIES["hua_die"] as any;
        const huaDieBuffDef = huaDieAbility?.buffs?.find((b: any) => b.buffId === 2613);
        if (huaDieBuffDef) {
          addBuff({
            state: this.state,
            sourceUserId: player.userId,
            targetUserId: player.userId,
            ability: huaDieAbility ?? { id: "hua_die", name: "化蝶" },
            buffTarget: player as any,
            buff: huaDieBuffDef,
          });
        }
        // Phase 2: forward 27 units over 30 ticks
        const fLen4 = player.facing
          ? Math.sqrt(player.facing.x * player.facing.x + player.facing.y * player.facing.y)
          : 0;
        const fX4 = fLen4 > 0.01 ? player.facing!.x / fLen4 : 0;
        const fY4 = fLen4 > 0.01 ? player.facing!.y / fLen4 : 1;
        const p2Ticks = 30;
        const p2ForwardWorld = gameplayUnitsToWorldUnits(27, storedUnitScale);
        player.velocity.vx = 0;
        player.velocity.vy = 0;
        player.activeDash = {
          abilityId: "hua_die_p2",
          vxPerTick: fX4 * p2ForwardWorld / p2Ticks,
          vyPerTick: fY4 * p2ForwardWorld / p2Ticks,
          forceVzPerTick: 0,
          maxUpVz: 0.05,
          maxDownVz: -0.3,
          ticksRemaining: p2Ticks,
        } as any;
        applyDashRuntimeBuff({
          state: this.state,
          target: player as any,
          durationMs: Math.ceil(p2Ticks * (1000 / 30)) + 300,
          effects: [
            { type: "CONTROL_IMMUNE" },
            { type: "KNOCKBACK_IMMUNE" },
            { type: "DISPLACEMENT" },
            { type: "DASH_TURN_LOCK" },
          ],
          sourceAbilityId: "hua_die_p2",
          sourceAbilityName: "化蝶",
        });
        movementStateChanged = true;
      }

      // 化蝶 Phase 2 cleanup
      if (dashAbilityIdBefore === "hua_die_p2" && !player.activeDash) {
        (player as any)._huaDieP2Done = false;
      }

      // Cancel channel buffs based on input — read BEFORE clearing the one-shot jump flag
      if (input) {
        const isMoving =
          !!input.up ||
          !!input.down ||
          !!input.left ||
          !!input.right ||
          (input.dx !== undefined && input.dx !== 0) ||
          (input.dy !== undefined && input.dy !== 0);

        // Jump pulses are suppressed while channeling, so channel cancel-on-jump only
        // reacts to real jump state changes from non-channel contexts.
        const isJumping = !!input.jump;

        if (isMoving) player.buffs = player.buffs.filter((b) => !b.cancelOnMove);
        if (isJumping) player.buffs = player.buffs.filter((b) => !b.cancelOnJump);

        // 浮光掠影(1012):
        // - first 5s: moving does not break while 遁影 is still active
        // - jump always breaks
        // - after 5s, or after 遁影 is removed: moving breaks
        const fuguangStealth = player.buffs.find((b) => b.buffId === 1012);
        if (fuguangStealth) {
          const hasDunyingGrace = player.buffs.some((b) => isDunyingCompanion(b));
          const stealthAgeMs = Date.now() - (fuguangStealth.appliedAt ?? Date.now());
          const breakByMove = isMoving && (!hasDunyingGrace || stealthAgeMs >= 5_000);
          const breakByJump = isJumping;
          if (breakByMove || breakByJump) {
            const brokenBuffs = player.buffs.filter((b) => b.buffId === 1012 || isDunyingCompanion(b));
            player.buffs = player.buffs.filter((b) => b.buffId !== 1012 && !isDunyingCompanion(b));
            for (const brokenBuff of brokenBuffs) {
              pushBuffExpired(this.state, {
                targetUserId: player.userId,
                buffId: brokenBuff.buffId,
                buffName: brokenBuff.name,
                buffCategory: brokenBuff.category,
                sourceAbilityId: brokenBuff.sourceAbilityId,
                sourceAbilityName: brokenBuff.sourceAbilityName,
                sourceUserId: brokenBuff.sourceUserId,
              });
            }
          }
        }

        // Cancel activeChannel on move/jump
        const inputCancelableChannel = isActiveChannelRuntime(player.activeChannel)
          ? player.activeChannel
          : null;
        if (inputCancelableChannel) {
          if (inputCancelableChannel.cancelOnMove && isMoving) cancelActiveChannel(this.state, player as any);
          else if (inputCancelableChannel.cancelOnJump && isJumping) cancelActiveChannel(this.state, player as any);
        }
      }

      // Generic post-pull stun: when a pull's activeDash ends, apply deferred stun buff.
      if (dashStateBefore && !player.activeDash && (dashStateBefore as any)._postPullStun) {
        const stunInfo = (dashStateBefore as any)._postPullStun;
        if ((player.hp ?? 0) > 0) {
          const abilityRef = ABILITIES[stunInfo.abilityId] as any ?? { id: stunInfo.abilityId, name: stunInfo.abilityName };
          addBuff({
            state: this.state,
            sourceUserId: stunInfo.sourceUserId,
            targetUserId: player.userId,
            ability: abilityRef,
            buffTarget: player as any,
            buff: stunInfo.buffDef,
          });
          movementStateChanged = true;
        }
      }

      // Clear the one-shot jump flag so it fires only once per press
      if (input?.jump) {
        this.playerInputs.set(idx, { ...input, jump: false });
      }
    });

    // 1b. Apply entity activeDash movement (pull / knockback for TargetEntity).
    // Entities have no input or jumping. We sub-step the movement and run the
    // map collision resolver between sub-steps so dashed/knocked-back entities
    // collide with walls (just like a player would) and stop instead of
    // tunneling through geometry. Z is snapped to the ground each tick so they
    // don't float upward when crossing terrain.
    for (const entity of this.state.entities ?? []) {
      const dash = entity.activeDash;
      if (!dash) continue;

      const prevX = entity.position.x;
      const prevY = entity.position.y;
      const intendedStep = Math.hypot(dash.vxPerTick, dash.vyPerTick);
      const MAX_XY_SUBSTEP = 0.5; // ~half a game unit
      const numSubSteps = Math.max(1, Math.ceil(intendedStep / MAX_XY_SUBSTEP));
      const subStepX = dash.vxPerTick / numSubSteps;
      const subStepY = dash.vyPerTick / numSubSteps;
      for (let ss = 0; ss < numSubSteps; ss++) {
        entity.position.x += subStepX;
        entity.position.y += subStepY;
        resolveEntityHorizontalCollision(entity as any, this.mapCtx);
      }

      // Snap z to ground so an entity pushed across raised terrain doesn't
      // hang in the air, but never go below the ground either.
      const groundZ = getGroundHeightForMap(
        entity.position.x,
        entity.position.y,
        entity.position.z ?? 0,
        this.mapCtx,
      );
      entity.position.z = groundZ + (dash.forceVzPerTick ?? 0);

      // Wall-stop: if collision swallowed most of the intended step, end dash.
      if (intendedStep > 0.001) {
        const actualStep = Math.hypot(
          entity.position.x - prevX,
          entity.position.y - prevY,
        );
        if (actualStep < intendedStep * 0.35) {
          delete entity.activeDash;
          movementStateChanged = true;
          continue;
        }
      }

      dash.ticksRemaining -= 1;
      if (dash.ticksRemaining <= 0) {
        delete entity.activeDash;
      }
      movementStateChanged = true;
    }
    const moveTime = performance.now() - moveStart;

    // 1a-ch. Process active channels: out-of-range / LOS cancel + completion
    let channelStateChanged = false;
    const channelPlayers = this.state.players ?? [];
    for (let idx = 0; idx < channelPlayers.length; idx++) {
        const player = channelPlayers[idx];
        if (!player.activeChannel) continue;

        const ch = player.activeChannel;
        const targetEntity = ch.entityTargetId
          ? (this.state.entities ?? []).find((entity) => entity.id === ch.entityTargetId) ?? null
          : null;
        const fallbackTargetPlayer = channelPlayers.find((candidate, candidateIndex) => (
          candidateIndex !== idx && (candidate.hp ?? 0) > 0
        )) ?? channelPlayers.find((candidate, candidateIndex) => candidateIndex !== idx) ?? null;
        const targetPlayer = targetEntity
          ? null
          : (typeof ch.targetUserId === "string"
            ? channelPlayers.find((p) => p.userId === ch.targetUserId) ?? null
            : fallbackTargetPlayer);
        const channelAbility = (ABILITIES as any)[ch.abilityId] as any;
        const isConsumableChannel = typeof (ch as any).consumableId === "string";
        const targetPosition = targetEntity?.position ?? targetPlayer?.position ?? (
          isConsumableChannel || channelAbility?.target !== "OPPONENT" ? player.position : undefined
        );
        const channelTargetAlive = targetEntity
          ? (targetEntity.hp ?? 0) > 0
          : targetPlayer
            ? (targetPlayer.hp ?? 0) > 0
            : (player.hp ?? 0) > 0;

        // Silence interrupts ability channels. Consumable channels ignore lockouts, but real displacement still breaks them.
        if ((!isConsumableChannel && hasBuffEffect(player as any, "SILENCE")) || hasBuffEffect(player as any, "DISPLACEMENT")) {
          cancelActiveChannel(this.state, player as any);
          channelStateChanged = true;
          continue;
        }

        if (!targetPosition || !channelTargetAlive) {
          cancelActiveChannel(this.state, player as any);
          channelStateChanged = true;
          continue;
        }

        // cancelOnOutOfRange check
        if (ch.cancelOnOutOfRange !== undefined) {
          const dist = Math.max(
            0,
            calculateDistance(player.position, targetPosition, storedUnitScale) -
              (targetEntity ? ((targetEntity.radius ?? 0) / Math.max(0.0001, storedUnitScale)) : 0)
          );
          if (dist > ch.cancelOnOutOfRange) {
            cancelActiveChannel(this.state, player as any);
            channelStateChanged = true;
            continue;
          }
        }

        // Target lost (stealth / untargetable) cancels opponent-targeted channels.
        if (channelAbility?.target === "OPPONENT" && targetPlayer && blocksCardTargeting(targetPlayer as any)) {
          cancelActiveChannel(this.state, player as any);
          channelStateChanged = true;
          continue;
        }

        // Task 8: cancel forward-facing channels if target leaves 180° front arc
        if (channelAbility && requiresFacing(channelAbility) && !isInFacingHemisphere(player as any, { position: targetPosition } as any)) {
          cancelActiveChannel(this.state, player as any);
          channelStateChanged = true;
          continue;
        }

        // Task 7: cancel opponent-targeted channels if LOS is blocked by structures.
        const _losBlockedChannel = channelAbility?.target === "OPPONENT" && (() => {
          const pz = (player.position as any).z ?? 0;
          const tz = (targetPosition as any).z ?? 0;
          if (this.mapCtx.collisionSystem) {
            const blockedByMap = this.mapCtx.collisionSystem.checkLOS(
              player.position.x, player.position.y, pz,
              targetPosition.x, targetPosition.y, tz,
              this.mapCtx.width, this.mapCtx.height,
            );
            if (blockedByMap) return true;
            return isLineBlockedByEnemyChuHeHanJieWall({
              state: this.state,
              actorUserId: player.userId,
              from: player.position,
              to: targetPosition,
              casterZ: pz,
              targetZ: tz,
            });
          }
          const blockedByMap = !!isLOSBlocked(
            player.position.x, player.position.y,
            targetPosition.x, targetPosition.y,
            this.mapCtx.objects, 0, pz, tz,
          );
          if (blockedByMap) return true;
          return isLineBlockedByEnemyChuHeHanJieWall({
            state: this.state,
            actorUserId: player.userId,
            from: player.position,
            to: targetPosition,
            casterZ: pz,
            targetZ: tz,
          });
        })();
        if (_losBlockedChannel) {
          cancelActiveChannel(this.state, player as any);
          channelStateChanged = true;
          continue;
        }

        // Channel completion
        const chNow = Date.now();

        const activeTickIntervalMs = Number((ch as any).tickIntervalMs ?? 0);
        if (Number.isFinite(activeTickIntervalMs) && activeTickIntervalMs > 0) {
          const elapsedMs = Math.max(0, Math.min(chNow, ch.startedAt + ch.durationMs) - ch.startedAt);
          const dueTickCount = Math.floor(elapsedMs / activeTickIntervalMs);
          const completedTickCount = Math.max(0, Number((ch as any).completedTickCount ?? 0));
          for (let tickIdx = completedTickCount; tickIdx < dueTickCount && (player.hp ?? 0) > 0; tickIdx++) {
            (ch as any).completedTickCount = tickIdx + 1;
            (ch as any).lastTickAt = chNow;
            for (const e of ch.effects) {
              if (e.type !== "PERIODIC_HEAL") continue;
              const healRoll = resolveNonCritHealAmountRoll({
                source: player as any,
                target: player as any,
                base: e.value ?? 0,
              });
              const healAmount = applyYumenKuangShaHealPenalty(ch.abilityId, player as any, healRoll.heal, chNow);
              const applied = applyHealToTarget(player as any, healAmount);
              this.state.events.push({
                id: randomUUID(),
                timestamp: chNow,
                turn: this.state.turn,
                type: "HEAL",
                actorUserId: player.userId,
                targetUserId: player.userId,
                abilityId: ch.abilityId,
                abilityName: ch.abilityName,
                effectType: "PERIODIC_HEAL",
                value: Math.max(0, applied),
                isCrit: false,
                suppressCritLabel: true,
              });
              channelStateChanged = true;
            }
          }
        }

        // ── 连环弩 periodic ticks: every 1s deal 1/2/3 damage. Knockback if target ≤15u. ──
        if (ch.abilityId === "lian_huan_nu" && targetPlayer && (targetPlayer.hp ?? 0) > 0) {
          const lhnInterval = Math.max(1, Number((ch as any).tickIntervalMs ?? getHasteAdjustedTimingMs(1_000, channelAbility as any)));
          const lhnElapsed = Math.max(0, Math.min(chNow, ch.startedAt + ch.durationMs) - ch.startedAt);
          const lhnDueTickCount = Math.min(3, Math.floor(lhnElapsed / lhnInterval));
          const lhnCompletedTickCount = Math.min(3, Math.max(0, Number((ch as any).lianHuanNuTickCount ?? 0)));
          const lhnEffect = Array.isArray((channelAbility as any)?.channelEffects)
            ? (channelAbility as any).channelEffects.find((entry: any) => entry?.type === "LIAN_HUAN_NU_TICK")
            : null;
          const lhnTickDamages = [
            Number(lhnEffect?.tickDamage1 ?? 1),
            Number(lhnEffect?.tickDamage2 ?? 2),
            Number(lhnEffect?.tickDamage3 ?? 3),
          ];
          for (let tickIdx = lhnCompletedTickCount; tickIdx < lhnDueTickCount && (targetPlayer.hp ?? 0) > 0; tickIdx++) {
            (ch as any).lianHuanNuTickCount = tickIdx + 1;
            const lhnDmg = lhnTickDamages[tickIdx] ?? (tickIdx + 1);
            if (!blocksEnemyTargeting(targetPlayer as any)) {
              const lhnAbility = (ABILITIES["lian_huan_nu"] ?? { id: "lian_huan_nu", name: "连环弩" }) as any;
              const reflectVictim = getDunLiReflectVictim(this.state, player.userId, targetPlayer as any, lhnAbility);
              const lhnSource = (reflectVictim ? targetPlayer : player) as any;
              const lhnVictim = (reflectVictim ?? targetPlayer) as any;
              if (!blocksEnemyTargeting(lhnVictim as any)) {
                const applied = applyDamageToHostileTarget({
                  state: this.state,
                  source: lhnSource,
                  target: { kind: "player", target: lhnVictim },
                  baseDamage: lhnDmg,
                  abilityId: "lian_huan_nu",
                  abilityName: "连环弩",
                  effectType: "PERIODIC_DAMAGE",
                  damageType: lhnAbility?.damageType,
                  timestamp: chNow,
                });
                if (applied > 0) {
                  channelStateChanged = true;
                }

                // Knockback if the actual victim is within 15u of the actual source.
                const distLhnGameplay = calculateDistance(lhnSource.position, lhnVictim.position, storedUnitScale);
                if (distLhnGameplay <= 15 && !hasKnockedBackImmune(lhnVictim as any)) {
                  const dxK = lhnVictim.position.x - lhnSource.position.x;
                  const dyK = lhnVictim.position.y - lhnSource.position.y;
                  const lenK = Math.sqrt(dxK * dxK + dyK * dyK);
                  if (lenK > 0.0001) {
                    const kbDistWorld = gameplayUnitsToWorldUnits(4, storedUnitScale);
                    const kbTicks = 6; // 4u @ 20u/s = 0.2s @ 30Hz
                    (lhnVictim as any).activeDash = {
                      abilityId: "lian_huan_nu",
                      vxPerTick: (dxK / lenK) * (kbDistWorld / kbTicks),
                      vyPerTick: (dyK / lenK) * (kbDistWorld / kbTicks),
                      forceVzPerTick: 0,
                      maxUpVz: 0,
                      maxDownVz: 0,
                      ticksRemaining: kbTicks,
                      vzPerTick: 0,
                    };
                    addBuff({
                      state: this.state,
                      sourceUserId: lhnSource.userId,
                      targetUserId: lhnVictim.userId,
                      ability: lhnAbility,
                      buffTarget: lhnVictim,
                      buff: {
                        buffId: 9101,
                        name: "击退",
                        category: "DEBUFF",
                        durationMs: Math.max(1, Math.ceil((kbTicks * 1000) / 30)),
                        breakOnPlay: false,
                        description: "被击退中，行动受限",
                        effects: [{ type: "KNOCKED_BACK" }],
                      } as any,
                    });
                    // 连环弩自身不提供击退免疫；被反弹的击退必须立刻打断当前运功。
                    if ((lhnVictim as any).activeChannel) {
                      (lhnVictim as any).activeChannel = undefined;
                    }
                  }
                }
              }
            }
          }
        }

        if (chNow >= ch.startedAt + ch.durationMs) {
          if (
            isConsumableChannel &&
            ((ch as any).consumableId === SAND_DISGUISE_CONSUMABLE_ID ||
              (ch as any).consumableId === GUAN_MU_DISGUISE_CONSUMABLE_ID ||
              (ch as any).consumableId === WA_GUAN_DISGUISE_CONSUMABLE_ID)
          ) {
            const combatDuringChannel = hasCombatActivityAgainstPlayerDuringChannel(this.state, player.userId, ch.startedAt);
            if (player.inCombat !== true && !combatDuringChannel && (player.hp ?? 0) > 0) {
                const isGuanMuDisguise = (ch as any).consumableId === GUAN_MU_DISGUISE_CONSUMABLE_ID;
              const isWaGuanDisguise = (ch as any).consumableId === WA_GUAN_DISGUISE_CONSUMABLE_ID;
              addBuff({
                state: this.state,
                sourceUserId: player.userId,
                targetUserId: player.userId,
                  ability: isWaGuanDisguise
                    ? WA_GUAN_DISGUISE_ABILITY
                    : (isGuanMuDisguise ? GUAN_MU_DISGUISE_ABILITY : SAND_DISGUISE_ABILITY),
                buffTarget: player as any,
                  buff: isWaGuanDisguise
                    ? createWaGuanDisguiseRuntimeBuff(player.position)
                    : (isGuanMuDisguise ? createGuanMuDisguiseRuntimeBuff(player.position) : createSandDisguiseRuntimeBuff(player.position)),
              });
              clearTargetSelectionsTargetingPlayer(this.state, player.userId);
            }
            cancelActiveChannel(this.state, player as any);
            channelStateChanged = true;
            continue;
          }

          const completeRange = getEffectiveAbilityRange(channelAbility as any, player.buffs);
          if (
            channelAbility?.target === "OPPONENT" &&
            channelAbility?.requireTargetInRangeOnChannelComplete === true &&
            typeof completeRange === "number"
          ) {
            const completeDist = Math.max(
              0,
              calculateDistance(player.position, targetPosition, storedUnitScale) -
                (targetEntity ? ((targetEntity.radius ?? 0) / Math.max(0.0001, storedUnitScale)) : 0)
            );
            if (completeDist > completeRange) {
              cancelActiveChannel(this.state, player as any);
              channelStateChanged = true;
              continue;
            }
          }

          const completionThresholdTarget = targetEntity ?? targetPlayer;
          const completionTargetHp = Number((completionThresholdTarget as any)?.hp ?? 0);
          const completionTargetMaxHp = Math.max(1, Number((completionThresholdTarget as any)?.maxHp ?? 100));
          const completionSelfHp = player.hp;
          let channelEffectDodged = false;
          for (const e of ch.effects) {
            if (e.type === "TIMED_SELF_HEAL") {
              const healRoll = resolveHealAmountRoll({ source: player as any, target: player, base: e.value ?? 0 });
              const healAmount = applyYumenKuangShaHealPenalty(ch.abilityId, player as any, healRoll.heal, chNow);
              const applied = applyHealToTarget(player as any, healAmount);
              if (applied > 0) {
                this.state.events.push({
                  id: randomUUID(),
                  timestamp: chNow,
                  turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: ch.abilityId,
                  abilityName: ch.abilityName,
                  effectType: "TIMED_SELF_HEAL",
                  value: applied,
                  isCrit: healRoll.isCrit,
                });
              }
            } else if (e.type === "TIMED_AOE_DAMAGE") {
              const range = e.range ?? 50;
              const targetForAoe = targetEntity
                ? ({ kind: "entity", target: targetEntity } as HostileDamageTarget)
                : targetPlayer
                  ? ({ kind: "player", target: targetPlayer } as HostileDamageTarget)
                  : null;
              const radiusWorld = gameplayUnitsToWorldUnits(range, storedUnitScale);
              if (
                targetForAoe &&
                isHostileDamageTargetInsideAoeCylinder({ center: player.position, target: targetForAoe, radiusWorld }) &&
                (targetEntity?.hp ?? targetPlayer?.hp ?? 0) > 0
              ) {
                if (targetPlayer && blocksEnemyTargeting(targetPlayer as any)) {
                  channelEffectDodged = true;
                  continue;
                }
                // NOTE: DAMAGE_IMMUNE + 盾立 reflect handled inside applyDamageToHostileTarget.
                // PROJECTILE_IMMUNE: block channel-completion damage from projectile abilities
                if (
                  targetPlayer &&
                  (ABILITIES[ch.abilityId] as any)?.isProjectile === true &&
                  (targetPlayer.buffs as any[]).some(
                    (b: any) =>
                      b.effects.some((ef: any) => ef.type === "PROJECTILE_IMMUNE") &&
                      b.expiresAt > chNow
                  )
                ) {
                  channelEffectDodged = true;
                  continue;
                }
                // Dodge check: if target has DODGE (or PHYSICAL_DODGE for 外功), the whole channel completion misses
                if (targetPlayer && shouldDodgeForAbility(targetPlayer as any, (ABILITIES[ch.abilityId] as any)?.damageType)) {
                  channelEffectDodged = true;
                  this.state.events.push({
                    id: randomUUID(), timestamp: chNow, turn: this.state.turn,
                    type: "DODGE",
                    actorUserId: targetPlayer.userId,
                    targetUserId: player.userId,
                    abilityId: ch.abilityId,
                    abilityName: ch.abilityName,
                  } as any);
                  continue;
                }
                applyDamageToHostileTarget({
                  state: this.state,
                  source: player,
                  target: targetEntity
                    ? { kind: "entity", target: targetEntity }
                    : { kind: "player", target: targetPlayer! },
                  baseDamage: e.value ?? 0,
                  abilityId: ch.abilityId,
                  abilityName: ch.abilityName,
                  effectType: "TIMED_AOE_DAMAGE",
                  damageType: (ABILITIES[ch.abilityId] as any)?.damageType,
                  timestamp: chNow,
                });
              }
            } else if (e.type === "TIMED_AOE_DAMAGE_IF_SELF_HP_GT") {
              const threshold = (e as any).threshold ?? 0;
              const thresholdTargetMaxHpPct = Number((e as any).thresholdTargetMaxHpPct);
              const range = e.range ?? 50;
              if (Number.isFinite(thresholdTargetMaxHpPct) && thresholdTargetMaxHpPct > 0) {
                if (completionTargetHp <= completionTargetMaxHp * (thresholdTargetMaxHpPct / 100)) continue;
              } else if (completionSelfHp <= threshold) continue;
              const targetForAoe = targetEntity
                ? ({ kind: "entity", target: targetEntity } as HostileDamageTarget)
                : targetPlayer
                  ? ({ kind: "player", target: targetPlayer } as HostileDamageTarget)
                  : null;
              const radiusWorld = gameplayUnitsToWorldUnits(range, storedUnitScale);
              if (
                !targetForAoe ||
                !isHostileDamageTargetInsideAoeCylinder({ center: player.position, target: targetForAoe, radiusWorld }) ||
                (targetEntity?.hp ?? targetPlayer?.hp ?? 0) <= 0
              ) continue;
              if (targetPlayer && blocksEnemyTargeting(targetPlayer as any)) continue;
              // NOTE: DAMAGE_IMMUNE + 盾立 reflect handled inside applyDamageToHostileTarget.
              // PROJECTILE_IMMUNE: block bonus channel-completion damage from projectile abilities
              if (
                targetPlayer &&
                (ABILITIES[ch.abilityId] as any)?.isProjectile === true &&
                (targetPlayer.buffs as any[]).some(
                  (b: any) =>
                    b.effects.some((ef: any) => ef.type === "PROJECTILE_IMMUNE") &&
                    b.expiresAt > chNow
                )
              ) continue;
              // Dodge check
              if (targetPlayer && shouldDodgeForAbility(targetPlayer as any, (ABILITIES[ch.abilityId] as any)?.damageType)) {
                channelEffectDodged = true;
                this.state.events.push({
                  id: randomUUID(), timestamp: chNow, turn: this.state.turn,
                  type: "DODGE",
                  actorUserId: targetPlayer.userId,
                  targetUserId: player.userId,
                  abilityId: ch.abilityId,
                  abilityName: ch.abilityName,
                } as any);
                continue;
              }
              applyDamageToHostileTarget({
                state: this.state,
                source: player,
                target: targetEntity
                  ? { kind: "entity", target: targetEntity }
                  : { kind: "player", target: targetPlayer! },
                baseDamage: e.value ?? 0,
                abilityId: ch.abilityId,
                abilityName: ch.abilityName,
                effectType: "TIMED_AOE_DAMAGE_IF_SELF_HP_GT",
                damageType: (ABILITIES[ch.abilityId] as any)?.damageType,
                timestamp: chNow,
              });
            } else if (e.type === "TIMED_PULL_TARGET_TO_FRONT") {
              // Entity-target pull: use activeDash so the entity is pulled at speed
              if (targetEntity && targetEntity.hp > 0) {
                const facing = player.facing ?? { x: 0, y: 1 };
                const facingLen = Math.hypot(facing.x, facing.y);
                const nx = facingLen > 0.0001 ? facing.x / facingLen : 0;
                const ny = facingLen > 0.0001 ? facing.y / facingLen : 1;
                const anchorOffset = gameplayUnitsToWorldUnits(1, storedUnitScale);
                const anchorX = player.position.x + nx * anchorOffset;
                const anchorY = player.position.y + ny * anchorOffset;
                const toAnchorX = anchorX - targetEntity.position.x;
                const toAnchorY = anchorY - targetEntity.position.y;
                const distanceToAnchor = Math.hypot(toAnchorX, toAnchorY);
                const maxPullUnits = Math.max(0, Number(e.value ?? 20));
                const maxPullDistance = gameplayUnitsToWorldUnits(maxPullUnits, storedUnitScale);
                const pullDistance = Math.min(distanceToAnchor, maxPullDistance);
                const basePullDurationTicks = Math.max(
                  1,
                  Math.round(Number((e as any).durationTicks ?? this.tickRate))
                );
                const pullDurationTicks = maxPullDistance > 0
                  ? Math.max(1, Math.round(basePullDurationTicks * (pullDistance / maxPullDistance)))
                  : basePullDurationTicks;
                const dirX = distanceToAnchor > 0.0001 ? toAnchorX / distanceToAnchor : nx;
                const dirY = distanceToAnchor > 0.0001 ? toAnchorY / distanceToAnchor : ny;
                if (pullDistance > 0.0001) {
                  targetEntity.activeDash = {
                    abilityId: ch.abilityId,
                    vxPerTick: (dirX * pullDistance) / pullDurationTicks,
                    vyPerTick: (dirY * pullDistance) / pullDurationTicks,
                    forceVzPerTick: 0,
                    ticksRemaining: pullDurationTicks,
                  };
                }
                continue;
              }
              if (!targetPlayer) continue;
              if (player.userId === targetPlayer.userId || targetPlayer.hp <= 0) continue;
              if (blocksEnemyTargeting(targetPlayer as any)) continue;
              if (hasKnockbackImmune(targetPlayer as any)) continue;

              const timedPullAbility = ABILITIES[ch.abilityId] as any;
              const reflectedPullTarget = getDunLiReflectVictim(
                this.state,
                player.userId,
                targetPlayer as any,
                timedPullAbility ?? { id: ch.abilityId, name: ch.abilityName },
              );
              const pullSourcePlayer = reflectedPullTarget ? targetPlayer : player;
              const pullTargetPlayer = reflectedPullTarget ?? targetPlayer;
              if (hasKnockbackImmune(pullTargetPlayer as any)) continue;

              // 雷霆震怒 interaction: pull also strips the buff first
              const leiTingIdx = (pullTargetPlayer.buffs as any[]).findIndex((b: any) => b.buffId === 2506);
              if (leiTingIdx !== -1) {
                const leiTingBuff = (pullTargetPlayer.buffs as any[])[leiTingIdx];
                (pullTargetPlayer.buffs as any[]).splice(leiTingIdx, 1);
                pushBuffExpired(this.state, {
                  targetUserId: pullTargetPlayer.userId,
                  buffId: leiTingBuff.buffId,
                  buffName: leiTingBuff.name,
                  buffCategory: leiTingBuff.category,
                  sourceAbilityId: leiTingBuff.sourceAbilityId,
                  sourceAbilityName: leiTingBuff.sourceAbilityName,
                });
              }

              const facing = pullSourcePlayer.facing ?? { x: 0, y: 1 };
              const facingLen = Math.hypot(facing.x, facing.y);
              const nx = facingLen > 0.0001 ? facing.x / facingLen : 0;
              const ny = facingLen > 0.0001 ? facing.y / facingLen : 1;
              const maxPullUnits = Math.max(0, Number(e.value ?? 20));
              const basePullDurationTicks = Math.max(
                1,
                Math.round(Number((e as any).durationTicks ?? this.tickRate))
              );

              // Pull toward a point 1 unit in front of the caster, but move with timed speed.
              const anchorOffset = gameplayUnitsToWorldUnits(1, storedUnitScale);
              const anchorX = pullSourcePlayer.position.x + nx * anchorOffset;
              const anchorY = pullSourcePlayer.position.y + ny * anchorOffset;

              const anchorGroundZ = getGroundHeightForMap(
                anchorX,
                anchorY,
                pullTargetPlayer.position.z ?? 0,
                this.mapCtx
              );
              const casterZ = pullSourcePlayer.position.z ?? anchorGroundZ;
              const anchorZ = Math.max(anchorGroundZ, casterZ);

              const toAnchorX = anchorX - pullTargetPlayer.position.x;
              const toAnchorY = anchorY - pullTargetPlayer.position.y;
              const distanceToAnchor = Math.hypot(toAnchorX, toAnchorY);
              const maxPullDistance = gameplayUnitsToWorldUnits(maxPullUnits, storedUnitScale);
              const pullDistance = Math.min(distanceToAnchor, maxPullDistance);
              const pullDurationTicks = maxPullDistance > 0
                ? Math.max(1, Math.round(basePullDurationTicks * (pullDistance / maxPullDistance)))
                : basePullDurationTicks;
              const pullDurationMs = Math.max(
                1,
                Math.round((pullDurationTicks * 1000) / this.tickRate)
              );

              const dirX = distanceToAnchor > 0.0001 ? toAnchorX / distanceToAnchor : nx;
              const dirY = distanceToAnchor > 0.0001 ? toAnchorY / distanceToAnchor : ny;

              const targetGroundZ = getGroundHeightForMap(
                pullTargetPlayer.position.x,
                pullTargetPlayer.position.y,
                pullTargetPlayer.position.z ?? 0,
                this.mapCtx
              );
              const currentZ = pullTargetPlayer.position.z ?? targetGroundZ;
              const pullRatio = distanceToAnchor > 0.0001
                ? pullDistance / distanceToAnchor
                : 1;
              const targetZ = currentZ + (anchorZ - currentZ) * pullRatio;
              const verticalDelta = targetZ - currentZ;

              if (pullDistance > 0.0001 || Math.abs(verticalDelta) > 0.0001) {
                pullTargetPlayer.activeDash = {
                  abilityId: ch.abilityId,
                  vxPerTick: (dirX * pullDistance) / pullDurationTicks,
                  vyPerTick: (dirY * pullDistance) / pullDurationTicks,
                  forceVzPerTick: verticalDelta / pullDurationTicks,
                  maxUpVz: 999,
                  maxDownVz: -999,
                  ticksRemaining: pullDurationTicks,
                } as any;

                pullTargetPlayer.velocity = {
                  ...pullTargetPlayer.velocity,
                  vx: 0,
                  vy: 0,
                  vz: 0,
                };
                pullTargetPlayer.isPowerJump = false;
                pullTargetPlayer.isPowerJumpCombined = false;

                applyDashRuntimeBuff({
                  state: this.state,
                  target: pullTargetPlayer as any,
                  durationMs: pullDurationMs + 100,
                  effects: [
                    { type: "CONTROL_IMMUNE" },
                    { type: "KNOCKBACK_IMMUNE" },
                    { type: "DISPLACEMENT" },
                    { type: "DASH_TURN_LOCK" },
                  ] as any,
                  sourceAbilityId: ch.abilityId,
                  sourceAbilityName: ch.abilityName,
                  appliedAt: chNow,
                });

                // Register post-pull stun if configured for this ability.
                if (PULL_CHANNEL_POST_STUN_CONFIG[ch.abilityId]) {
                  this.pendingPostPullStuns.set(pullTargetPlayer.userId, {
                    sourceUserId: pullSourcePlayer.userId,
                    abilityId: ch.abilityId,
                    abilityName: ch.abilityName,
                  });
                }
              }

              resolveMapCollisions(pullTargetPlayer as any, this.mapCtx);

              const sealConfig = PULL_CHANNEL_QINGGONG_SEAL_CONFIG[ch.abilityId];
              if (sealConfig) {
                addBuff({
                  state: this.state,
                  sourceUserId: pullSourcePlayer.userId,
                  targetUserId: pullTargetPlayer.userId,
                  ability: (channelAbility ?? { id: ch.abilityId, name: ch.abilityName }) as any,
                  buffTarget: pullTargetPlayer as any,
                  buff: {
                    buffId: sealConfig.buffId,
                    name: sealConfig.buffName,
                    category: "DEBUFF",
                    durationMs: sealConfig.durationMs,
                    description: "无法施展轻功招式",
                    effects: [{ type: "QINGGONG_SEAL" }],
                  } as any,
                });
              }
            } else if (e.type === "DISPEL_BUFF_ATTRIBUTE") {
              // Dispel BUFF-category buffs from target by attribute (used by channel abilities like 少明指)
              const dispelAbility = (ABILITIES[ch.abilityId] as any)
                ?? ({ id: ch.abilityId, name: ch.abilityName } as any);
              const reflectedDispelTarget = targetPlayer
                ? getDunLiReflectVictim(this.state, player.userId, targetPlayer as any, dispelAbility)
                : null;
              const dispelTarget = reflectedDispelTarget ?? targetPlayer;
              // Skip if the preceding TIMED_AOE_DAMAGE was dodged/blocked, unless 盾立 has already
              // redirected the dispel payload to the caster.
              if (channelEffectDodged && !reflectedDispelTarget) continue;
              if (dispelTarget && dispelTarget.hp > 0 && !blocksEnemyTargeting(dispelTarget as any)) {
                const { overrides: chDispelOvr } = loadBuffEditorOverrides();
                const chAttrs: string[] = (e as any).attributes ?? [];
                const chDispelCount: number = (e as any).count ?? 1;
                for (const attr of chAttrs) {
                  let dispelled = 0;
                  while (dispelled < chDispelCount) {
                    const idx = (dispelTarget.buffs as any[]).findIndex((b: any) => {
                      if (b.category !== "BUFF") return false;
                      const entry = chDispelOvr[String(b.buffId)];
                      return entry?.attribute === attr;
                    });
                    if (idx === -1) break;
                    const removed = (dispelTarget.buffs as any[])[idx];
                    (dispelTarget.buffs as any[]).splice(idx, 1);
                    removeLinkedShield(dispelTarget as any, removed);
                    pushBuffExpired(this.state, {
                      targetUserId: dispelTarget.userId,
                      buffId: removed.buffId,
                      buffName: removed.name,
                      buffCategory: removed.category,
                      sourceAbilityId: removed.sourceAbilityId,
                      sourceAbilityName: removed.sourceAbilityName,
                    });
                    dispelled++;
                  }
                }
              }
            } else if (e.type === "PLACE_GROUND_ZONE") {
              const facing = player.facing ?? { x: 0, y: 1 };
              const zoneOffset = gameplayUnitsToWorldUnits(e.zoneOffsetUnits ?? 6, storedUnitScale);
              const zoneX = player.position.x + facing.x * zoneOffset;
              const zoneY = player.position.y + facing.y * zoneOffset;
              const zoneZ = getGroundHeightForMap(zoneX, zoneY, player.position.z ?? 0, this.mapCtx);
              const zoneRadius = gameplayUnitsToWorldUnits(e.range ?? 8, storedUnitScale);
              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: player.userId,
                x: zoneX,
                y: zoneY,
                z: zoneZ,
                height: zoneRadius,
                radius: zoneRadius,
                expiresAt: chNow + (e.zoneDurationMs ?? 6_000),
                damagePerInterval: e.value ?? 4,
                intervalMs: e.zoneIntervalMs ?? 500,
                lastTickAt: chNow,
                abilityId: ch.abilityId,
                abilityName: ch.abilityName,
                maxTargets: e.maxTargets,
              } as GroundZone);
            }
          }

          if (ch.abilityId === YIN_QIAO_ABILITY_ID && targetPlayer && !channelEffectDodged) {
            const yinQiaoExtraPerStack = Array.isArray((channelAbility as any)?.channelEffects)
              ? Number(
                  ((channelAbility as any).channelEffects.find((entry: any) => entry?.type === "TIMED_AOE_DAMAGE") as any)
                    ?.extraPerStackDamage ?? 1
                )
              : 1;
            const jueMaiIndex = (targetPlayer.buffs as any[]).findIndex(
              (buff: any) =>
                buff.buffId === JUE_MAI_BUFF_ID &&
                (buff.expiresAt ?? 0) > chNow,
            );
            if (jueMaiIndex !== -1) {
              const jueMaiBuff = (targetPlayer.buffs as any[])[jueMaiIndex];
              const extraDamage = Math.max(0, Number(jueMaiBuff.stacks ?? 0) * yinQiaoExtraPerStack);
              if (extraDamage > 0) {
                const appliedExtraDamage = applyDamageToHostileTarget({
                  state: this.state,
                  source: player,
                  target: { kind: "player", target: targetPlayer },
                  baseDamage: extraDamage,
                  abilityId: ch.abilityId,
                  abilityName: ch.abilityName,
                  effectType: "YIN_QIAO_EXTRA_DAMAGE",
                  damageType: (ABILITIES[ch.abilityId] as any)?.damageType,
                  timestamp: chNow,
                });
                if (appliedExtraDamage > 0) {
                  (targetPlayer.buffs as any[]).splice(jueMaiIndex, 1);
                  pushBuffExpired(this.state, {
                    targetUserId: targetPlayer.userId,
                    buffId: jueMaiBuff.buffId,
                    buffName: jueMaiBuff.name,
                    buffCategory: jueMaiBuff.category,
                    sourceAbilityId: jueMaiBuff.sourceAbilityId,
                    sourceAbilityName: jueMaiBuff.sourceAbilityName,
                  });
                }
              }
            }
          }

          if (ch.abilityId === YIN_QIAO_ABILITY_ID) {
            triggerYunSanBlink({
              state: this.state,
              source: player as any,
              targetPosition,
              triggerAbilityId: ch.abilityId,
              mapCtx: this.mapCtx,
              now: chNow,
            });
          }

          // Set cooldown on the consumed ability instance (still in hand)
          const ability = player.hand.find((a) => a.instanceId === ch.instanceId);
          if (ability) {
            ability.cooldown = Math.max(ability.cooldown ?? 0, ch.cooldownTicks ?? 0);
          }

          // applyBuffsOnComplete: apply buffs[] to opponent on channel finish (not on cast)
          if ((channelAbility as any)?.applyBuffsOnComplete === true) {
            const buffDefs = (channelAbility as any)?.buffs ?? [];
            const completeBuffIdSet = Array.isArray((channelAbility as any)?.channelCompleteBuffIds)
              ? new Set((channelAbility as any).channelCompleteBuffIds)
              : null;
            const completeTarget = targetEntity ?? targetPlayer;
            const completeTargetAlive = (completeTarget?.hp ?? 0) > 0;
            for (const buffDef of buffDefs) {
              if (completeBuffIdSet && !completeBuffIdSet.has(buffDef.buffId)) continue;
              const applyTarget = buffDef.applyTo === "SELF" ? player : completeTarget;
              if (!applyTarget) continue;
              if (applyTarget !== player && (!completeTargetAlive || blocksEnemyTargeting(completeTarget as any))) continue;
              addBuff({
                state: this.state,
                sourceUserId: player.userId,
                targetUserId: (applyTarget as any).userId,
                ability: channelAbility as any,
                buffTarget: applyTarget as any,
                buff: buffDef,
              });
            }
          }

          if (ch.abilityId === "shi_fang_xuan_ji") {
            channelStateChanged = clearTargetSelectionsTargetingPlayer(this.state, player.userId) || channelStateChanged;
          }

          if (ch.abilityId === "ren_chi_cheng" && removeRootAndSlowEffects(this.state, player as any, chNow)) {
            channelStateChanged = true;
          }

          breakSanliuXiaOnSuccessfulChannelComplete({
            state: this.state,
            player: player as any,
          });

          const hostileForwardResolution = isHostileForwardChannelResolution({
            channel: ch,
            ability: channelAbility as any,
            targetPlayer: targetPlayer as any,
            targetEntity: targetEntity as any,
          });
          if (hostileForwardResolution) {
            this.state.events.push({
              id: randomUUID(),
              timestamp: chNow,
              turn: this.state.turn,
              type: "PLAY_ABILITY",
              actorUserId: player.userId,
              targetUserId: targetEntity ? undefined : targetPlayer?.userId,
              entityId: targetEntity?.id,
              entityName: targetEntity?.abilityName,
              abilityId: ch.abilityId,
              abilityName: ch.abilityName,
              abilityInstanceId: ch.instanceId,
              channelPhase: "complete",
            } as any);
            breakStealthOnForwardChannelResolution({
              state: this.state,
              player: player as any,
            });
          }

          this.state.events.push({
            id: randomUUID(),
            timestamp: chNow,
            turn: this.state.turn,
            type: "ABILITY_SOUND",
            actorUserId: player.userId,
            targetUserId: targetEntity ? undefined : targetPlayer?.userId,
            entityId: targetEntity?.id,
            entityName: targetEntity?.abilityName,
            abilityId: ch.abilityId,
            abilityName: ch.abilityName,
            abilityInstanceId: ch.instanceId,
            channelPhase: "complete",
          } as any);

          cancelActiveChannel(this.state, player as any);
          channelStateChanged = true;
        }
      }
    this.state.players.forEach((player) => {
      const yumenSpectator = hasActiveYumenSpectatorBuff(player as any);
      const cooldownSlowSum = player.buffs
        .filter((b: any) => isRuntimeBuffActive(b))
        .flatMap((b) => b.effects)
        .filter((e: any) => e.type === "COOLDOWN_SLOW")
        .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
      const cooldownRate = Math.max(0, 1 - cooldownSlowSum);

      if (yumenSpectator) {
        (player as any).globalGcdTicks = 0;
        (player as any)._globalGcdProgress = 0;
      } else if (Math.max(0, Number((player as any).globalGcdTicks ?? 0)) > 0) {
        (player as any)._globalGcdProgress = ((player as any)._globalGcdProgress ?? 0) + cooldownRate;
        while ((player as any)._globalGcdProgress >= 1 && (player as any).globalGcdTicks > 0) {
          (player as any).globalGcdTicks--;
          (player as any)._globalGcdProgress -= 1;
        }
      } else {
        (player as any).globalGcdTicks = 0;
        (player as any)._globalGcdProgress = 0;
      }

      const visualGcd = (player as any).visualGcd;
      if (
        visualGcd &&
        typeof visualGcd.startedAt === "number" &&
        typeof visualGcd.durationMs === "number" &&
        Date.now() - visualGcd.startedAt >= visualGcd.durationMs + 100
      ) {
        (player as any).visualGcd = undefined;
      }

      const runtimeAbilities = [
        ...player.hand,
        ...Object.values((player as any).specialAbilityStates ?? {}),
      ];

      runtimeAbilities.forEach((ability: any) => {
        const abilityId = ability.abilityId || ability.id;
        const abilityDef = (ABILITIES as any)[abilityId];
        const maxCharges = Math.max(0, Number(abilityDef?.maxCharges ?? 0));

        if (yumenSpectator) {
          ability.cooldown = 0;
          ability._cooldownProgress = 0;
          if (maxCharges > 1) {
            ability.chargeCount = maxCharges;
            ability.chargeLockTicks = 0;
            ability.chargeRegenTicksRemaining = 0;
            ability._chargeRegenQueueTicks = [];
            ability._chargeRegenProgress = 0;
          }
          return;
        }

        if (maxCharges > 1) {
          if (typeof ability.chargeCount !== "number") ability.chargeCount = maxCharges;
          if (typeof ability.chargeRegenTicksRemaining !== "number") ability.chargeRegenTicksRemaining = 0;
          if (typeof ability.chargeLockTicks !== "number") ability.chargeLockTicks = 0;

          const recoveryTicks = Math.max(
            1,
            Number(abilityDef?.chargeRecoveryTicks ?? abilityDef?.cooldownTicks ?? 1)
          );

          ability.chargeCount = Math.max(0, Math.min(maxCharges, Number(ability.chargeCount ?? maxCharges)));
          const missingCharges = Math.max(0, maxCharges - ability.chargeCount);

          let regenQueue: number[] = Array.isArray(ability._chargeRegenQueueTicks)
            ? ability._chargeRegenQueueTicks
                .map((ticks: any) => Math.max(0, Number(ticks) || 0))
                .filter((ticks: number) => ticks > 0)
            : [];

          if (regenQueue.length === 0 && missingCharges > 0) {
            const seededRemaining = Math.max(0, Number(ability.chargeRegenTicksRemaining ?? 0));
            if (seededRemaining > 0) {
              regenQueue.push(seededRemaining);
            }
          }

          while (regenQueue.length < missingCharges) {
            regenQueue.push(recoveryTicks);
          }
          if (regenQueue.length > missingCharges) {
            regenQueue = regenQueue.slice(0, missingCharges);
          }

          if (ability.chargeLockTicks > 0) {
            ability.chargeLockTicks--;
          }

          if (regenQueue.length > 0) {
            ability._chargeRegenProgress = (ability._chargeRegenProgress ?? 0) + cooldownRate;
            while (ability._chargeRegenProgress >= 1) {
              regenQueue = regenQueue.map((ticks) => ticks - 1);
              ability._chargeRegenProgress -= 1;
            }

            const completedCharges = regenQueue.reduce(
              (count: number, ticks: number) => count + (ticks <= 0 ? 1 : 0),
              0
            );

            if (completedCharges > 0) {
              ability.chargeCount = Math.min(maxCharges, ability.chargeCount + completedCharges);
              regenQueue = regenQueue.filter((ticks) => ticks > 0);
            }
          } else {
            ability._chargeRegenProgress = 0;
          }

          ability._chargeRegenQueueTicks = regenQueue;
          ability.chargeRegenTicksRemaining = regenQueue.length > 0
            ? Math.max(0, Math.ceil(Math.min(...regenQueue)))
            : 0;

          if (ability.chargeCount <= 0) {
            ability.cooldown = Math.max(0, ability.chargeRegenTicksRemaining ?? 0);
          } else if (ability.chargeLockTicks > 0) {
            ability.cooldown = Math.max(0, ability.chargeLockTicks ?? 0);
          } else {
            ability.cooldown = 0;
          }

          return;
        }

        if (ability.cooldown > 0) {
          ability._cooldownProgress = (ability._cooldownProgress ?? 0) + cooldownRate;
          while (ability._cooldownProgress >= 1 && ability.cooldown > 0) {
            ability.cooldown--;
            ability._cooldownProgress -= 1;
          }
        } else {
          ability._cooldownProgress = 0;
        }
      });
    });

    // 1c. Wall-clock buff expiry + periodic effects (DoT / HoT)
    const now = Date.now();
    // Pre-seed buffsChanged: true if movement consumed any buff (e.g. JUMP_BOOST splice)
    let buffsChanged = this.state.players.some(
      (p, idx) => (p.buffs?.length ?? 0) !== buffCountsBefore[idx]
    ) || movementBuffsChanged || channelStateChanged || movementStateChanged;
    buffsChanged = this.syncYumenPrepAnnouncements(now) || buffsChanged;
    let handStateChanged = false;
    let consumableStateChanged = false;

    // Cancel channel buffs whose out-of-range condition is exceeded (e.g. 云飞玉皇)
    if (this.state.players.length === 2) {
      for (let idx = 0; idx < 2; idx++) {
        const player = this.state.players[idx];
        const opp = this.state.players[idx === 0 ? 1 : 0];
        const before = player.buffs.length;
        const removedByRange = player.buffs.filter((b: any) => {
          if (b.cancelOnOutOfRange === undefined) return false;
          const dist = calculateDistance(player.position, opp.position, storedUnitScale);
          return dist > b.cancelOnOutOfRange;
        });
        for (const removed of removedByRange) {
          removeLinkedShield(player as any, removed as any);
        }
        player.buffs = player.buffs.filter((b: any) => {
          if (b.cancelOnOutOfRange === undefined) return true;
          const dist = calculateDistance(player.position, opp.position, storedUnitScale);
          return dist <= b.cancelOnOutOfRange;
        });
        if (player.buffs.length !== before) buffsChanged = true;
      }
    }

    // Track event count before damage processing so we can diff-patch new events
    const eventsBefore = this.state.events.length;

    this.state.players.forEach((player, pidx) => {
      const oppIdx = pidx === 0 ? 1 : 0;
      const opp = this.state.players[oppIdx];

      // Silence interrupts runtime channel buffs unless the buff itself is interrupt-immune.
      if (hasBuffEffect(player as any, "SILENCE") || hasBuffEffect(player as any, "DISPLACEMENT")) {
        const removedBySilence = player.buffs.filter(
          (b) => isChannelBuffRuntime(b as any) && !b.effects.some((e: any) => e.type === "SILENCE_IMMUNE")
        );
        if (removedBySilence.length > 0) {
          for (const removed of removedBySilence) {
            removeLinkedShield(player as any, removed as any);
          }
          player.buffs = player.buffs.filter((b) => !removedBySilence.includes(b));
          for (const b of removedBySilence) {
            pushBuffExpired(this.state, {
              targetUserId: player.userId,
              buffId: b.buffId,
              buffName: b.name,
              buffCategory: b.category,
              sourceAbilityId: b.sourceAbilityId,
              sourceAbilityName: b.sourceAbilityName,
            });
          }
          buffsChanged = true;
        }
      }

      const leftDisguiseLeashArea = player.buffs.some((buff: any) => {
        if (!isRuntimeBuffActive(buff)) return false;
        if (!isDisguiseBuff(buff)) return false;

        const leashOriginX = Number(buff?.leashOriginX);
        const leashOriginY = Number(buff?.leashOriginY);
        const leashRadiusUnits = Number(buff?.leashRadiusUnits ?? SAND_DISGUISE_LEASH_RADIUS_UNITS);
        if (!Number.isFinite(leashOriginX) || !Number.isFinite(leashOriginY) || leashRadiusUnits <= 0) {
          return false;
        }

        const leashRadiusWorld = gameplayUnitsToWorldUnits(leashRadiusUnits, storedUnitScale);
        return Math.hypot(player.position.x - leashOriginX, player.position.y - leashOriginY) > leashRadiusWorld;
      });
      if (leftDisguiseLeashArea) {
        buffsChanged = removeDisguiseBuffs(this.state, player as any, now) || buffsChanged;
      }

      for (const buff of player.buffs) {
        const buffExpiredNow = now >= buff.expiresAt;
        // Fire periodic effects (DoT / HoT) if interval has elapsed
        if (!buffExpiredNow && buff.periodicMs !== undefined && buff.lastTickAt !== undefined) {
          if (now - buff.lastTickAt >= buff.periodicMs) {
            buff.lastTickAt = now;
            for (const e of buff.effects) {
              if (e.type === "PERIODIC_DAMAGE") {
                if (opp.userId !== player.userId && (blocksEnemyTargeting(player as any) || hasDamageImmune(player as any))) {
                  buffsChanged = true;
                  continue;
                }
                const stackMult = buff.stacks ?? 1;
                const dmg = resolveScheduledDamage({
                  source: opp,
                  target: player,
                  base: (e.value ?? 0) * stackMult,
                  abilityId: buff.sourceAbilityId,
                  damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                });
                if (dmg > 0) {
                  const { adjustedDamage: adjPeri, redirectPlayer: rtPeri, redirectAmt: raPeri } =
                    preCheckRedirect(this.state, player as any, dmg);
                  const periApply = rtPeri ? adjPeri : dmg;
                  const periResult = periApply > 0
                    ? applyDamageToTarget(player as any, periApply)
                    : { hpDamage: 0, shieldAbsorbed: 0 };
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "DAMAGE",
                    actorUserId: opp.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "PERIODIC_DAMAGE",
                    value: periApply,
                    shieldAbsorbed: (periResult.shieldAbsorbed ?? 0) > 0 ? periResult.shieldAbsorbed : undefined,
                  });
                  if (periResult.hpDamage > 0 || periResult.shieldAbsorbed > 0) {
                    processOnDamageTaken(this.state, player as any, periResult.hpDamage, opp.userId, periResult.shieldAbsorbed);
                  }
                  if (rtPeri && raPeri > 0) {
                    applyRedirectToOpponent(this.state, rtPeri, raPeri);
                  }
                }
                buffsChanged = true;
              } else if (e.type === "PERIODIC_HEAL") {
                const healRoll = resolveHealAmountRoll({ source: player as any, target: player, base: e.value ?? 0 });
                const healAmount = applyYumenKuangShaHealPenalty(buff.sourceAbilityId, player as any, healRoll.heal, now);
                const applied = applyHealToTarget(player as any, healAmount);
                if (applied > 0) {
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "PERIODIC_HEAL",
                    value: applied,
                    isCrit: healRoll.isCrit,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "PERIODIC_GUAN_TI_HEAL") {
                const healAmt = resolveMaxHpPercentHealAmount(player, e.value ?? 0);
                const applied = applyHealToTarget(player as any, healAmt);
                if (applied > 0) {
                  const baseName = buff.sourceAbilityName ?? buff.name ?? "贯体";
                  const guanTiName = baseName.includes("（贯体）") ? baseName : `${baseName}（贯体）`;
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: guanTiName,
                    effectType: "PERIODIC_GUAN_TI_HEAL",
                    value: applied,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "CHANNEL_AOE_TICK") {
                // Channel AOE: deal damage to opponent if within range
                const range = e.range ?? 10;
                const angle = (e as any).aoeAngle ?? 360;
                const isLosBlockedTick = (target: HostileDamageTarget) => {
                    const pz = (player.position as any).z ?? 0;
                    const oz = (getHostileDamageTargetPosition(target) as any).z ?? 0;
                    if (this.mapCtx.collisionSystem) {
                      const blockedByMap = this.mapCtx.collisionSystem.checkLOS(
                        player.position.x, player.position.y, pz,
                        getHostileDamageTargetPosition(target).x, getHostileDamageTargetPosition(target).y, oz,
                        this.mapCtx.width, this.mapCtx.height,
                      );
                      if (blockedByMap) return true;
                      return isLineBlockedByEnemyChuHeHanJieWall({
                        state: this.state,
                        actorUserId: player.userId,
                        from: player.position,
                        to: getHostileDamageTargetPosition(target),
                        casterZ: pz,
                        targetZ: oz,
                        ignoreEntityId: target.kind === "entity" ? target.target.id : undefined,
                      });
                    }
                    const blockedByMap = !!isLOSBlocked(
                      player.position.x, player.position.y,
                      getHostileDamageTargetPosition(target).x, getHostileDamageTargetPosition(target).y,
                      this.mapCtx.objects, 0, pz, oz,
                    );
                    if (blockedByMap) return true;
                    return isLineBlockedByEnemyChuHeHanJieWall({
                      state: this.state,
                      actorUserId: player.userId,
                      from: player.position,
                      to: getHostileDamageTargetPosition(target),
                      casterZ: pz,
                      targetZ: oz,
                      ignoreEntityId: target.kind === "entity" ? target.target.id : undefined,
                    });
                };
                const baseTargets = getHostileDamageTargets(this.state, player.userId).filter((target) => {
                  const radiusWorld = gameplayUnitsToWorldUnits(range, storedUnitScale);
                  if (!isHostileDamageTargetInsideAoeCylinder({ center: player.position, target, radiusWorld })) return false;
                  if (blocksEnemyTargeting(target.target as any)) return false;
                  if (angle < 360) {
                    const facing = player.facing ?? { x: 0, y: 1 };
                    const dx = getHostileDamageTargetPosition(target).x - player.position.x;
                    const dy = getHostileDamageTargetPosition(target).y - player.position.y;
                    const planarDist = Math.sqrt(dx * dx + dy * dy);
                    if (planarDist <= 0) return true;
                    const dot = planarDist > 0.0001 ? (facing.x * dx + facing.y * dy) / planarDist : 1;
                    const halfAngleRad = (angle / 2) * (Math.PI / 180);
                    if (dot < Math.cos(halfAngleRad)) {
                      return false;
                    }
                  }
                  return true;
                });
                const confusedTickTargets = (() => {
                  if (!hasMiYunConfusion(player as any) || baseTargets.length === 0) return baseTargets;
                  const candidatePool = getMiYunAreaCandidates({
                    state: this.state,
                    sourceUserId: player.userId,
                    center: player.position,
                    radiusWorld: gameplayUnitsToWorldUnits(range, storedUnitScale),
                    verticalHalfHeightWorld: gameplayUnitsToWorldUnits(range, storedUnitScale),
                    coneAngleDeg: angle < 360 ? angle : undefined,
                    facing: player.facing ?? null,
                  }).filter((candidate) => !isLosBlockedTick(candidate as HostileDamageTarget));
                  if (candidatePool.length === 0) return baseTargets;
                  return Array.from(
                    { length: baseTargets.length },
                    () => candidatePool[Math.floor(Math.random() * candidatePool.length)] as HostileDamageTarget,
                  );
                })();
                for (const target of confusedTickTargets) {
                  const _losBlockedTick = isLosBlockedTick(target);
                  if (_losBlockedTick) {
                    cancelActiveChannel(this.state, player as any);
                    channelStateChanged = true;
                    continue;
                  }
                  if (
                    target.kind === "player" &&
                    tryApplyDodgeForHit({
                      state: this.state,
                      source: player,
                      target: target.target as any,
                      abilityId: buff.sourceAbilityId,
                      abilityName: buff.sourceAbilityName ?? buff.name,
                      enabled: buff.sourceAbilityId === "fenglai_wushan",
                      damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                    })
                  ) {
                    buffsChanged = true;
                    continue;
                  }
                  applyDamageToHostileTarget({
                    state: this.state,
                    source: player,
                    target,
                    baseDamage: e.value ?? 0,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "CHANNEL_AOE_TICK",
                    damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                    timestamp: now,
                  });
                  if (buff.sourceAbilityId === XINZHENG_ABILITY_ID) {
                    addXinzhengSongYanStack(this.state, player as any);
                  }
                  buffsChanged = true;
                }
              } else if (e.type === "CHANNEL_AOE_TICK_DAMAGE") {
                // 斩无常: AOE damage to enemies within range every tick (periodicMs=500, 0.5s)
                const dmgRange = e.range ?? 4;
                const tickAbility = (ABILITIES[buff.sourceAbilityId ?? ""] as any)
                  ?? ({ id: buff.sourceAbilityId, name: buff.sourceAbilityName ?? buff.name } as any);
                for (const target of getMiYunAffectedHostileTargets({
                  state: this.state,
                  source: player as any,
                  sourceUserId: player.userId,
                  center: player.position,
                  storedUnitScale,
                  rangeUnits: dmgRange,
                })) {
                  const reflectVictim = target.kind === "player"
                    ? getDunLiReflectVictim(this.state, player.userId, target.target, tickAbility)
                    : null;
                  // NOTE: DAMAGE_IMMUNE + 盾立 reflect handled inside applyDamageToHostileTarget.
                  applyDamageToHostileTarget({
                    state: this.state,
                    source: (reflectVictim ? target.target : player) as any,
                    target: reflectVictim ? { kind: "player", target: reflectVictim } : target,
                    baseDamage: e.value ?? 1,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "CHANNEL_AOE_TICK_DAMAGE",
                    damageType: tickAbility?.damageType,
                    timestamp: now,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "YING_TIAN_SHIELD") {
                // 应天授命: every 1s, settle accumulated shield-absorbed damage (capped at 20% maxHp) as true damage
                const yMaxHp = player.maxHp ?? 100;
                const accum: number = (buff as any).yingTianAccum ?? 0;
                const cap = yMaxHp * 0.2;
                const settle = Math.min(accum, cap);
                (buff as any).yingTianAccum = 0;
                if (settle > 0) {
                  // True damage — bypass DR and shields
                  const sourcePlayer = this.state.players.find((p) => p.userId === (buff.sourceUserId ?? ""));
                  const settleDamage = resolveRawDamageWithCrit({
                    source: sourcePlayer as any,
                    base: settle,
                    damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                  });
                  const preHp = player.hp;
                  player.hp = Math.max(0, player.hp - settleDamage);
                  const settledHpDmg = preHp - player.hp;
                  if (settledHpDmg > 0) {
                    this.state.events.push({
                      id: randomUUID(), timestamp: now, turn: this.state.turn,
                      type: "DAMAGE",
                      actorUserId: buff.sourceUserId ?? player.userId,
                      targetUserId: player.userId,
                      abilityId: buff.sourceAbilityId,
                      abilityName: buff.sourceAbilityName ?? buff.name,
                      effectType: "YING_TIAN_SHIELD",
                      value: settledHpDmg,
                    });
                  }
                  buffsChanged = true;
                }
              }
            }
          }
        }

        // Fire TIMED_AOE_DAMAGE effects (each fires exactly once at its delayMs offset)
        if (buff.appliedAt !== undefined) {
          for (let effIdx = 0; effIdx < buff.effects.length; effIdx++) {
            const e = buff.effects[effIdx];
            if (
              e.type !== "TIMED_AOE_DAMAGE" &&
              e.type !== "TIMED_SELF_DAMAGE" &&
              e.type !== "TIMED_SOURCE_CENTER_AOE_DAMAGE" &&
              e.type !== "TIMED_GUAN_TI_HEAL" &&
              e.type !== "PLACE_GROUND_ZONE"
            ) continue;
            if (e.delayMs === undefined) continue;
            if (buff.firedDelayIndices?.includes(effIdx)) continue;
            if (now < buff.appliedAt + e.delayMs) continue;

            // Mark this effect as fired
            if (!buff.firedDelayIndices) buff.firedDelayIndices = [];
            buff.firedDelayIndices.push(effIdx);

            // Delayed follow-up attacks may have custom stealth-only break behavior.
            if (e.type === "TIMED_AOE_DAMAGE" && buff.sourceAbilityId) {
              const triggeredAbility = ABILITIES[buff.sourceAbilityId];
              if (triggeredAbility && applyTriggeredFollowUpPlayRules(player as any, triggeredAbility as any)) {
                buffsChanged = true;
              }
            }

            // TIMED_GUAN_TI_HEAL: completion heal bypassing HEAL_REDUCTION
            if (e.type === "TIMED_GUAN_TI_HEAL") {
              const healAmt = resolveMaxHpPercentHealAmount(player, e.value ?? 0);
              const applied = applyHealToTarget(player as any, healAmt);
              if (applied > 0) {
                const baseName = buff.sourceAbilityName ?? buff.name ?? "贯体";
                const guanTiName = baseName.includes("（贯体）") ? baseName : `${baseName}（贯体）`;
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: guanTiName,
                  effectType: "TIMED_GUAN_TI_HEAL",
                  value: applied,
                });
              }
              buffsChanged = true;
              continue;
            }

            // PLACE_GROUND_ZONE: place a persistent damage zone in front of caster
            if (e.type === "PLACE_GROUND_ZONE") {
              const facing = player.facing ?? { x: 0, y: 1 };
              const zoneOffset = gameplayUnitsToWorldUnits(e.zoneOffsetUnits ?? 6, storedUnitScale);
              const zoneX = player.position.x + facing.x * zoneOffset;
              const zoneY = player.position.y + facing.y * zoneOffset;
              const zoneZ = getGroundHeightForMap(zoneX, zoneY, player.position.z ?? 0, this.mapCtx);
              const zoneRadius = gameplayUnitsToWorldUnits(e.range ?? 8, storedUnitScale);
              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: player.userId,
                x: zoneX,
                y: zoneY,
                z: zoneZ,
                height: zoneRadius,
                radius: zoneRadius,
                expiresAt: now + (e.zoneDurationMs ?? 6_000),
                damagePerInterval: e.value ?? 4,
                intervalMs: e.zoneIntervalMs ?? 500,
                lastTickAt: now,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                maxTargets: e.maxTargets,
              } as GroundZone);
              buffsChanged = true;
              continue;
            }

            if (e.type === "TIMED_SOURCE_CENTER_AOE_DAMAGE") {
              const sourcePlayer = this.state.players.find((p) => p.userId === (buff as any).sourceUserId);
              if (!sourcePlayer) {
                buffsChanged = true;
                continue;
              }

              const triggeredAbility = ABILITIES[buff.sourceAbilityId ?? ""] as any;
              const center = player.position;
              const radiusUnits = e.range ?? 6;
              const radiusWorld = gameplayUnitsToWorldUnits(radiusUnits, storedUnitScale);

              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: sourcePlayer.userId,
                x: center.x,
                y: center.y,
                z: center.z ?? 0,
                height: radiusWorld,
                radius: radiusWorld,
                expiresAt: now + 500,
                damagePerInterval: 0,
                intervalMs: 1_000,
                lastTickAt: now,
                abilityId: "baizu_marker",
                abilityName: buff.sourceAbilityName ?? buff.name,
                maxTargets: 0,
              });

              this.state.events.push({
                id: randomUUID(),
                timestamp: now,
                turn: this.state.turn,
                type: "ABILITY_SOUND",
                actorUserId: sourcePlayer.userId,
                targetUserId: player.userId,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                soundPhase: "followUp",
                x: center.x,
                y: center.y,
                z: center.z,
              } as any);

              for (const target of getMiYunAffectedHostileTargets({
                state: this.state,
                source: sourcePlayer as any,
                sourceUserId: sourcePlayer.userId,
                center,
                storedUnitScale,
                rangeUnits: radiusUnits,
              })) {
                applyDamageToHostileTarget({
                  state: this.state,
                  source: sourcePlayer as any,
                  target,
                  baseDamage: e.value ?? 0,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName ?? buff.name,
                  effectType: "TIMED_SOURCE_CENTER_AOE_DAMAGE",
                  damageType: triggeredAbility?.damageType,
                  timestamp: now,
                });
              }

              buffsChanged = true;
              continue;
            }

            // TIMED_SELF_DAMAGE: delayed damage applied to the buff owner.
            if (e.type === "TIMED_SELF_DAMAGE") {
              const sourcePlayer = this.state.players.find((p) => p.userId === (buff as any).sourceUserId) ?? opp;
              const dmg = resolveScheduledDamage({
                source: sourcePlayer,
                target: player,
                base: e.value ?? 0,
                abilityId: buff.sourceAbilityId,
                damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
              });
              const {
                adjustedDamage: timedApply,
                redirectPlayer: timedRedirectPlayer,
                redirectAmt: timedRedirectAmt,
              } = preCheckRedirect(this.state, player as any, dmg);
              const timedResult = timedApply > 0
                ? applyDamageToTarget(player as any, timedApply)
                : { hpDamage: 0, shieldAbsorbed: 0 };
              if (timedResult.hpDamage > 0 || timedResult.shieldAbsorbed > 0) {
                processOnDamageTaken(this.state, player as any, timedResult.hpDamage, sourcePlayer.userId, timedResult.shieldAbsorbed);
              }
              if (timedRedirectPlayer && timedRedirectAmt > 0) {
                applyRedirectToOpponent(this.state, timedRedirectPlayer, timedRedirectAmt);
              }
              if (dmg > 0) {
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "DAMAGE",
                  actorUserId: sourcePlayer.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName ?? buff.name,
                  effectType: "TIMED_SELF_DAMAGE",
                  value: timedApply,
                  shieldAbsorbed: timedResult.shieldAbsorbed > 0 ? timedResult.shieldAbsorbed : undefined,
                });
              }
              buffsChanged = true;
              continue;
            }

            const range = e.range ?? 10;
            const angle = e.aoeAngle ?? 360;
            for (const target of getMiYunAffectedHostileTargets({
              state: this.state,
              source: player as any,
              sourceUserId: player.userId,
              center: player.position,
              storedUnitScale,
              rangeUnits: range,
              coneAngleDeg: angle < 360 ? angle : undefined,
            })) {

              if (
                target.kind === "player" &&
                tryApplyDodgeForHit({
                  state: this.state,
                  source: player,
                  target: target.target as any,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName ?? buff.name,
                  enabled: buff.sourceAbilityId === "wu_jianyu",
                  damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                })
              ) {
                buffsChanged = true;
                continue;
              }

              const appliedDamage = applyDamageToHostileTarget({
                state: this.state,
                source: player as any,
                target,
                baseDamage: e.value ?? 0,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                effectType: "TIMED_AOE_DAMAGE",
                damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                timestamp: now,
              });

              if (e.lifestealPct && e.lifestealPct > 0 && appliedDamage > 0) {
                const healRoll = resolveNonCritHealAmountRoll({
                  source: player as any,
                  target: player,
                  base: Math.floor(appliedDamage * e.lifestealPct),
                  scaleFlatHeal: false,
                });
                const applied = applyHealToTarget(player as any, healRoll.heal);
                if (applied > 0) {
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "TIMED_AOE_DAMAGE",
                    value: applied,
                    isCrit: healRoll.isCrit,
                  });
                }
              }

              if (target.kind === "player" && e.knockbackUnits && e.knockbackUnits > 0) {
                const dist = getHostileDamageTargetRangeDistance(player.position, target, storedUnitScale);
                if (dist <= 0) {
                  continue;
                }
                const opp = target.target;
                const knockbackResult = applyType3KnockbackControl({
                  state: this.state,
                  source: player,
                  target: opp,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName,
                  knockbackUnits: e.knockbackUnits,
                  controlDurationMs: Math.max(0, e.knockbackSilenceMs ?? 0),
                  mapCtx: this.mapCtx,
                  now,
                });

                if (knockbackResult.applied) {
                  const hadFuguang = opp.buffs.some((b: any) => b.buffId === 1012);
                  const brokenStealth = opp.buffs.filter(
                    (b: any) => b.buffId === 1012 || b.buffId === 1013 || (hadFuguang && isDunyingCompanion(b))
                  );
                  if (brokenStealth.length > 0) {
                    opp.buffs = opp.buffs.filter((b: any) => !brokenStealth.includes(b));
                    for (const b of brokenStealth) {
                      pushBuffExpired(this.state, {
                        targetUserId: opp.userId,
                        buffId: b.buffId,
                        buffName: b.name,
                        buffCategory: b.category,
                        sourceAbilityId: b.sourceAbilityId,
                        sourceAbilityName: b.sourceAbilityName,
                      });
                    }
                  }

                  if (knockbackResult.removedStuns) {
                    buffsChanged = true;
                  }
                }
              }

              buffsChanged = true;
            }

          }
        }
      }

      // Remove expired buffs (with special natural-expiry handling).
      const before = player.buffs.length;
      const naturallyExpired = player.buffs.filter((b) => now >= b.expiresAt);
      for (const expired of naturallyExpired) {
        removeLinkedShield(player as any, expired as any);
      }
      const zhenShanHeAbility = ABILITIES[ZHEN_SHAN_HE_ABILITY_ID];
      const xuanjianNaturallyExpired = naturallyExpired.filter(
        (b) => b.buffId === ZHEN_SHAN_HE_XUANJIAN_BUFF_ID && b.sourceAbilityId === ZHEN_SHAN_HE_ABILITY_ID
      );
      if (zhenShanHeAbility) {
        for (const expired of xuanjianNaturallyExpired) {
          transformExpiredXuanjian({
            state: this.state,
            ability: zhenShanHeAbility,
            target: player as any,
            sourceUserId: expired.sourceUserId ?? player.userId,
          });
          buffsChanged = true;
        }
      }
      const moheNaturallyExpired = naturallyExpired.filter((b) => isMoheKnockdown(b as any));
      for (const b of moheNaturallyExpired) {
        const maxHp = player.maxHp ?? 100;
        const threshold = maxHp * 0.3;
        if (player.hp < threshold) {
          const moheAbility = ABILITIES["mohe_wuliang"];
          if (moheAbility) {
            addBuff({
              state: this.state,
              sourceUserId: (b as any).sourceUserId ?? player.userId,
              targetUserId: player.userId,
              ability: moheAbility,
              buffTarget: player as any,
              buff: {
                buffId: 1202,
                name: "摩诃无量·眩晕",
                category: "DEBUFF",
                durationMs: 2_000,
                breakOnPlay: false,
                description: "眩晕：无法移动、跳跃和施放技能",
                effects: [{ type: "CONTROL" }],
              },
            });
          }
          buffsChanged = true;
        }
      }
      if (naturallyExpired.some((b) => isDisguiseBuff(b as any))) {
        buffsChanged = clearTargetSelectionsTargetingPlayer(this.state, player.userId) || buffsChanged;
      }
      for (const expired of naturallyExpired) {
        const sourceAbility = expired.sourceAbilityId ? ABILITIES[expired.sourceAbilityId] as any : null;
        if (
          sourceAbility?.type === "CHANNEL" &&
          sourceAbility?.channel?.source === "BUFF" &&
          sourceAbility.channel.buffId === expired.buffId
        ) {
          this.state.events.push({
            id: randomUUID(),
            timestamp: now,
            turn: this.state.turn,
            type: "ABILITY_SOUND",
            actorUserId: expired.sourceUserId ?? player.userId,
            targetUserId: player.userId,
            abilityId: expired.sourceAbilityId,
            abilityName: expired.sourceAbilityName,
            channelPhase: "complete",
          } as any);
        }
      }
      player.buffs = player.buffs.filter((b) => now < b.expiresAt);
      for (const expired of naturallyExpired) {
        pushBuffExpired(this.state, {
          targetUserId: player.userId,
          buffId: expired.buffId,
          buffName: expired.name,
          buffCategory: expired.category,
          sourceAbilityId: expired.sourceAbilityId,
          sourceAbilityName: expired.sourceAbilityName,
          sourceUserId: expired.sourceUserId,
        });
      }
      if (naturallyExpired.length > 0 || player.buffs.length !== before) buffsChanged = true;
      if (!hasActiveXinzhengChannelBuff(player as any, now)) {
        buffsChanged = removeXinzhengSongYanStacks(this.state, player as any) || buffsChanged;
      }

      if (!hasYuqiState(player as any, now)) {
        const lingeringZongQingQi = player.buffs.filter((b) => b.buffId === ZONG_QING_QI_BUFF_ID);
        if (lingeringZongQingQi.length > 0) {
          player.buffs = player.buffs.filter((b) => b.buffId !== ZONG_QING_QI_BUFF_ID);
          for (const buff of lingeringZongQingQi) {
            pushBuffExpired(this.state, {
              targetUserId: player.userId,
              buffId: buff.buffId,
              buffName: buff.name,
              buffCategory: buff.category,
              sourceAbilityId: buff.sourceAbilityId,
              sourceAbilityName: buff.sourceAbilityName,
              sourceUserId: buff.sourceUserId,
            });
          }
          buffsChanged = true;
        }
      }

      if (reconcileLinkedShieldTotal(player as any)) {
        buffsChanged = true;
      }

      // 无相诀 natural-expire check: if any snapshot DR tier expires naturally AND player hp < 10%, 贯体 heal 50%
      const wuxiangExpired = naturallyExpired.filter((b) => WU_XIANG_JUE_SNAPSHOT_BUFF_IDS.has(b.buffId));
      for (const _b of wuxiangExpired) {
        const wxMaxHp = player.maxHp ?? 100;
        if (player.hp < wxMaxHp * 0.1) {
          const wxHeal = Math.floor(wxMaxHp * 0.5);
          const wxApplied = applyHealToTarget(player as any, wxHeal);
          if (wxApplied > 0) {
            this.state.events.push({
              id: randomUUID(), timestamp: now, turn: this.state.turn,
              type: "HEAL",
              actorUserId: player.userId,
              targetUserId: player.userId,
              abilityId: "wu_xiang_jue",
              abilityName: "无相诀（贯体）",
              effectType: "DAMAGE_REDUCTION",
              value: wxApplied,
            });
            buffsChanged = true;
          }
        }
      }

      // 徐如林·回复 natural-expire: 贯体 heal caster 5 HP.
      // Always emit the HEAL event, even at full HP, so the heal float text
      // shows. (Full HP must never suppress healing visuals.)
      const xuRuLinExpired = naturallyExpired.filter(
        (b) => b.effects.some((e) => (e as any).type === "XU_RU_LIN_RESTORE"),
      );
      for (const xb of xuRuLinExpired) {
        const healVal = (xb.effects.find((e) => (e as any).type === "XU_RU_LIN_RESTORE") as any)?.value ?? 5;
        const healAmount = resolveMaxHpPercentHealAmount(player, healVal);
        const applied = applyHealToTarget(player as any, healAmount);
        const baseName = xb.sourceAbilityName ?? xb.name ?? "贯体";
        const guanTiName = baseName.includes("（贯体）") ? baseName : `${baseName}（贯体）`;
        this.state.events.push({
          id: randomUUID(), timestamp: now, turn: this.state.turn,
          type: "HEAL",
          actorUserId: player.userId,
          targetUserId: player.userId,
          abilityId: xb.sourceAbilityId,
          abilityName: guanTiName,
          effectType: "XU_RU_LIN_RESTORE",
          value: applied > 0 ? applied : healAmount,
        });
        buffsChanged = true;
      }

      // 孤影化双 natural-expire: restore hp and cooldowns from snapshot.
      const guYingExpired = naturallyExpired.filter((b) => b.buffId === 2714);
      for (const gyBuff of guYingExpired) {
        const snapshot = (gyBuff as any).snapshot as {
          hp: number;
          shield: number;
          cooldowns: Array<{
            instanceId: string;
            abilityId: string;
            cooldown: number;
            chargeCount?: number;
            chargeRegenTicksRemaining?: number;
            chargeLockTicks?: number;
          }>;
        } | undefined;
        if (!snapshot) continue;

        // Restore HP (can go up or down, capped at maxHp).
        const gyMaxHp = player.maxHp ?? 100;
        player.hp = Math.min(Math.max(0, snapshot.hp), gyMaxHp);

        // Restore ability cooldowns.
        for (const snap of snapshot.cooldowns) {
          const inst = (player.hand ?? []).find((a: any) => a.instanceId === snap.instanceId);
          if (inst) {
            inst.cooldown = snap.cooldown;
            if (snap.chargeCount !== undefined) inst.chargeCount = snap.chargeCount;
            if (snap.chargeRegenTicksRemaining !== undefined) inst.chargeRegenTicksRemaining = snap.chargeRegenTicksRemaining;
            if (snap.chargeLockTicks !== undefined) inst.chargeLockTicks = snap.chargeLockTicks;
          }
        }

        buffsChanged = true;
      }

      const hongMengExpired = naturallyExpired.filter(
        (buff) => buff.buffId === HONG_MENG_TIAN_JIN_BUFF_ID && buff.sourceAbilityId === HONG_MENG_TIAN_JIN_ABILITY_ID
      );
      if (hongMengExpired.length > 0) {
        const hongMengAbility = ABILITIES[HONG_MENG_TIAN_JIN_ABILITY_ID];
        const shuSeBuff = hongMengAbility?.buffs?.find((buff: any) => buff.buffId === SHU_SE_BUFF_ID);
        if (hongMengAbility && shuSeBuff) {
          for (const expired of hongMengExpired) {
            addBuff({
              state: this.state,
              sourceUserId: expired.sourceUserId ?? player.userId,
              targetUserId: player.userId,
              ability: hongMengAbility,
              buffTarget: player as any,
              buff: shuSeBuff,
            });
          }
          buffsChanged = true;
        }
      }

      // 洞烛机微 is only valid while 九霄风雷 is still active.
      const hasJiuXiaoBuff = player.buffs.some((buff) => buff.buffId === 2727);
      if (!hasJiuXiaoBuff) {
        const nextBuffs = player.buffs.filter((buff) => buff.buffId !== 2728);
        if (nextBuffs.length !== player.buffs.length) {
          player.buffs = nextBuffs;
          buffsChanged = true;
        }
      }
    });

    for (const entity of this.state.entities ?? []) {
      for (const buff of entity.buffs ?? []) {
        if (now >= buff.expiresAt) continue;
        if (buff.periodicMs === undefined || buff.lastTickAt === undefined) continue;
        if (now - buff.lastTickAt < buff.periodicMs) continue;

        buff.lastTickAt = now;
        const sourcePlayer = this.state.players.find((p) => p.userId === (buff.sourceUserId ?? entity.ownerUserId));
        for (const e of buff.effects) {
          if (e.type === "PERIODIC_DAMAGE") {
            if (blocksEnemyTargeting(entity as any) || hasDamageImmune(entity as any)) {
              buffsChanged = true;
              continue;
            }
            const dmg = resolveScheduledDamage({
              source: sourcePlayer ?? ({ userId: buff.sourceUserId ?? entity.ownerUserId, buffs: [] } as any),
              target: entity as any,
              base: (e.value ?? 0) * (buff.stacks ?? 1),
              abilityId: buff.sourceAbilityId,
              damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
            });
            if (dmg > 0) {
              const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(this.state, entity as any, dmg);
              const result = applyDamageToTarget(entity as any, adjustedDamage);
              this.state.events.push({
                id: randomUUID(),
                timestamp: now,
                turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: sourcePlayer?.userId ?? buff.sourceUserId ?? entity.ownerUserId,
                entityId: entity.id,
                entityName: entity.abilityName,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                effectType: "PERIODIC_DAMAGE",
                value: adjustedDamage,
                shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
              } as any);
              if (result.hpDamage > 0 || result.shieldAbsorbed > 0) {
                processOnDamageTaken(this.state, entity as any, result.hpDamage, sourcePlayer?.userId ?? buff.sourceUserId ?? entity.ownerUserId, result.shieldAbsorbed);
              }
              if (redirectPlayer && redirectAmt > 0) {
                applyRedirectToOpponent(this.state, redirectPlayer, redirectAmt);
              }
            }
            buffsChanged = true;
          } else if (e.type === "PERIODIC_HEAL") {
            const healRoll = resolveHealAmountRoll({ source: sourcePlayer as any, target: entity as any, base: e.value ?? 0 });
            const applied = applyHealToTarget(entity as any, healRoll.heal);
            if (applied > 0) {
              this.state.events.push({
                id: randomUUID(),
                timestamp: now,
                turn: this.state.turn,
                type: "HEAL",
                actorUserId: sourcePlayer?.userId ?? buff.sourceUserId ?? entity.ownerUserId,
                entityId: entity.id,
                entityName: entity.abilityName,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                effectType: "PERIODIC_HEAL",
                value: applied,
                isCrit: healRoll.isCrit,
              } as any);
            }
            buffsChanged = true;
          }
        }
      }

      const before = entity.buffs?.length ?? 0;
      const naturallyExpired = (entity.buffs ?? []).filter((b) => now >= b.expiresAt);
      for (const expired of naturallyExpired) {
        removeLinkedShield(entity as any, expired as any);
      }
      entity.buffs = (entity.buffs ?? []).filter((b) => now < b.expiresAt);
      for (const expired of naturallyExpired) {
        pushBuffExpired(this.state, {
          targetUserId: entity.userId,
          buffId: expired.buffId,
          buffName: expired.name,
          buffCategory: expired.category,
          sourceAbilityId: expired.sourceAbilityId,
          sourceAbilityName: expired.sourceAbilityName,
          sourceUserId: expired.sourceUserId,
        });
      }
      if (naturallyExpired.length > 0 || (entity.buffs?.length ?? 0) !== before) {
        buffsChanged = true;
      }
      if (reconcileLinkedShieldTotal(entity as any)) {
        buffsChanged = true;
      }
    }

    // 1d. 毒圈 — poison zone damage (arena timed mode, yumen staged mode)
    if ((this.isArenaMode || this.isYumenMode) && this.state.safeZone) {
      if (this.isArenaMode) {
        const elapsedMs = now - this.zoneStartedAt;
        const { currentHalf, dps, shrinking, shrinkProgress, nextChangeIn } = this.computeSafeZone(elapsedMs);
        this.state.safeZone.currentHalf = currentHalf;
        this.state.safeZone.currentDiameter = currentHalf * 2;
        this.state.safeZone.dps = dps;
        this.state.safeZone.shrinking = shrinking;
        this.state.safeZone.shrinkProgress = shrinkProgress;
        this.state.safeZone.nextChangeIn = nextChangeIn;
      } else if (this.isYumenMode) {
        this.updateRandomSafeZone(now);
      }

      const currentHalf = this.state.safeZone.currentHalf;
      const dps = this.state.safeZone.dps;
      const zoneShape = this.state.safeZone.shape === "circle" ? "circle" : "square";
      const cx = this.state.safeZone.centerX;
      const cy = this.state.safeZone.centerY;

      if (this.isYumenMode) {
        for (const player of this.state.players) {
          const outsideSafeZone = this.isOutsideZone(player.position.x, player.position.y, cx, cy, currentHalf, zoneShape);
          buffsChanged = this.syncYumenKuangShaBuff(player as any, outsideSafeZone, now) || buffsChanged;
        }
      }

      // Apply damage once per second
      if (dps > 0 && now - this.lastZoneDamageAt >= 1000) {
        this.lastZoneDamageAt = now;
        for (const player of this.state.players) {
          if (player.hp <= 0 || hasActiveYumenSpectatorBuff(player as any, now)) continue;
          if (this.isOutsideZone(player.position.x, player.position.y, cx, cy, currentHalf, zoneShape)) {
            const zoneDamage = this.isYumenMode ? dps * getYumenKuangShaDamageMultiplier(player as any, now) : dps;
            const szResult = applyPiercingDamageToTarget(player as any, zoneDamage);
            this.state.events.push({
              id: randomUUID(), timestamp: now, turn: this.state.turn,
              type: "DAMAGE",
              actorUserId: player.userId,
              targetUserId: player.userId,
              abilityId: "yumen_sandstorm",
              abilityName: "狂沙",
              effectType: "PERIODIC_DAMAGE",
              value: szResult.totalDamage,
              damageType: YUMEN_PIERCING_DAMAGE_TYPE,
            });
            buffsChanged = true; // triggers HP + event broadcast
          }
        }
      }
    }

    // 1e. Ground zone damage ticks (e.g. 狂龙乱舞)
    if (this.state.groundZones && this.state.groundZones.length > 0) {
      const activeZones: GroundZone[] = [];
      for (const zone of this.state.groundZones) {
        // ── Pre-step: 天绝地灭 grow radius ─────────────────────────────────
        if (zone.abilityId === "tian_jue_di_mie" && (zone as any).growEndRadius !== undefined) {
          const startedAt = (zone as any).growStartedAt ?? zone.lastTickAt;
          const growMs = (zone as any).growDurationMs ?? 1;
          const t = Math.min(1, Math.max(0, (now - startedAt) / growMs));
          zone.radius = (zone as any).growStartRadius + ((zone as any).growEndRadius - (zone as any).growStartRadius) * t;
          zone.height = zone.radius;
        }
        if (zone.abilityId === LV_YE_MAN_SHENG_ABILITY_ID) {
          const lvYeTargetUserId = (zone as any).followTargetUserId ?? zone.ownerUserId;
          const lvYeTarget = this.state.players.find((p) => p.userId === lvYeTargetUserId);
          if (!lvYeTarget || !hasLvYeManShengBuff(lvYeTarget, now)) {
            continue;
          }
        }

        // ── Pre-step: follow-target zones (振翅图南/飞刃回转) ──────────────
        if (zone.abilityId === LV_YE_MAN_SHENG_ABILITY_ID && (zone as any).followTargetUserId) {
          const fp = this.state.players.find((p) => p.userId === (zone as any).followTargetUserId);
          if (fp && (fp.hp ?? 0) > 0) {
            zone.x = fp.position.x;
            zone.y = fp.position.y;
            zone.z = fp.position.z ?? zone.z;
          }
        } else if ((zone as any).followTargetUserId && (zone as any).followSpeedPerTick !== undefined) {
          const fp = this.state.players.find((p) => p.userId === (zone as any).followTargetUserId);
          if (fp && (fp.hp ?? 0) > 0) {
            const dxF = fp.position.x - zone.x;
            const dyF = fp.position.y - zone.y;
            const lenF = Math.sqrt(dxF * dxF + dyF * dyF);
            const stepF = (zone as any).followSpeedPerTick as number;
            const followTriggerRadius = Math.max(0, zone.radius - gameplayUnitsToWorldUnits(1, storedUnitScale));
            if (lenF > zone.radius + 0.0001) {
              delete (zone as any).followTargetUserId;
            } else if (lenF > followTriggerRadius + 0.0001) {
              const moveStep = Math.min(stepF, lenF - followTriggerRadius);
              if (moveStep >= lenF) {
                zone.x = fp.position.x;
                zone.y = fp.position.y;
              } else if (lenF > 0.0001) {
                zone.x += (dxF / lenF) * moveStep;
                zone.y += (dyF / lenF) * moveStep;
              }
            }
            zone.z = fp.position.z ?? zone.z;
          }
        }
        // ── 天绝地灭 expire → pull + explode ─────────────────────────────
        if (now >= zone.expiresAt && zone.abilityId === "tian_jue_di_mie" && (zone as any).explodeOnExpire) {
          const explodeDmg = (zone as any).explodeDamage ?? 10;
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId)
            ?? ({ userId: zone.ownerUserId, buffs: [] } as any);
          for (const hostile of getMiYunAffectedHostileTargets({
            state: this.state,
            source: owner as any,
            sourceUserId: zone.ownerUserId,
            center: { x: zone.x, y: zone.y, z: zone.z },
            storedUnitScale,
            radiusWorld: zone.radius,
          })) {
            // NOTE: damage immunity + 盾立 reflect is handled inside applyDamageToHostileTarget.

            const targetPos = getHostileDamageTargetPosition(hostile);
            const dxE = targetPos.x - zone.x;
            const dyE = targetPos.y - zone.y;
            const targetRadius = hostile.kind === "entity" ? Math.max(0, Number(hostile.target.radius ?? 0)) : 0;
            const distE = Math.sqrt(dxE * dxE + dyE * dyE);

            // Skip pull when the host is damage-immune (盾立) so we don't move them.
            const skipPullForImmune =
              hostile.kind === "player" && hasDamageImmune(hostile.target as any);

            if (hostile.kind === "player" && !skipPullForImmune) {
              const pullSpeed = (zone as any).pullSpeedPerTick ?? gameplayUnitsToWorldUnits(20, storedUnitScale) / 30;
              const pullTicks = Math.max(1, Math.ceil(distE / pullSpeed));
              const dirX = distE > 0.0001 ? -dxE / distE : 0;
              const dirY = distE > 0.0001 ? -dyE / distE : 0;
              (hostile.target as any).activeDash = {
                abilityId: "tian_jue_di_mie",
                vxPerTick: dirX * Math.min(pullSpeed, distE / pullTicks),
                vyPerTick: dirY * Math.min(pullSpeed, distE / pullTicks),
                forceVzPerTick: 0,
                maxUpVz: 0,
                maxDownVz: 0,
                ticksRemaining: pullTicks,
                vzPerTick: 0,
              };
            }

            const dealt = applyDamageToHostileTarget({
              state: this.state,
              source: owner as any,
              target: hostile,
              baseDamage: explodeDmg,
              abilityId: "tian_jue_di_mie",
              abilityName: "天绝地灭",
              effectType: "DAMAGE",
              timestamp: now,
            });
            if (dealt > 0) {
              buffsChanged = true;
            }
          }
          continue; // drop the zone
        }
        // ── 疾电叱羽 expire by HP or time ──────────────────────────────────
        if (zone.abilityId === "ji_dian_chi_yu" && (zone.hp !== undefined && zone.hp <= 0)) {
          // Clear the linked buff from all allies (zone is dropped)
          const allyBid = (zone as any).allyBuffId ?? 2620;
          for (const p of this.state.players) {
            const idx = (p.buffs as any[]).findIndex((b: any) =>
              b.buffId === allyBid && (b as any).linkedZoneId === zone.id
            );
            if (idx >= 0) {
              const removed = p.buffs[idx];
              p.buffs.splice(idx, 1);
              pushBuffExpired(this.state, {
                targetUserId: p.userId,
                buffId: removed.buffId,
                buffName: removed.name,
                buffCategory: removed.category,
                sourceAbilityId: removed.sourceAbilityId,
                sourceAbilityName: removed.sourceAbilityName,
              });
              buffsChanged = true;
            }
          }
          continue; // drop the zone
        }
        if (now >= zone.expiresAt) {
          // Natural time expire: clear ji_dian buffs as well
          if (zone.abilityId === "ji_dian_chi_yu") {
            const allyBid = (zone as any).allyBuffId ?? 2620;
            for (const p of this.state.players) {
              const idx = (p.buffs as any[]).findIndex((b: any) =>
                b.buffId === allyBid && (b as any).linkedZoneId === zone.id
              );
              if (idx >= 0) {
                const removed = p.buffs[idx];
                p.buffs.splice(idx, 1);
                pushBuffExpired(this.state, {
                  targetUserId: p.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
                buffsChanged = true;
              }
            }
          }
          continue; // expired — drop it
        }
        activeZones.push(zone);

        if (zone.abilityId === XI_BING_YU_ABILITY_ID) {
          const pickupTargetUserId = (zone as any).pickupTargetUserId as string | undefined;
          const pickupTarget = pickupTargetUserId
            ? this.state.players.find((player) => player.userId === pickupTargetUserId)
            : undefined;
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          let zoneConsumed = false;

          if (pickupTarget && pickupTarget.hp > 0) {
            const dx = pickupTarget.position.x - zone.x;
            const dy = pickupTarget.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((pickupTarget.position.z ?? 0) - zoneZ) <= zoneHeight;

            if (inZone) {
              zoneConsumed = true;
              const buffIndex = pickupTarget.buffs.findIndex(
                (buff: any) => buff.buffId === XI_BING_YU_BUFF_ID && buff.expiresAt > now
              );
              if (buffIndex !== -1) {
                const removed = pickupTarget.buffs[buffIndex];
                removeLinkedShield(pickupTarget as any, removed as any);
                pickupTarget.buffs.splice(buffIndex, 1);
                pushBuffExpired(this.state, {
                  targetUserId: pickupTarget.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
                buffsChanged = true;
              }
            }
          }

          if (zoneConsumed) {
            activeZones.pop();
            continue;
          }

          continue;
        }

        // ── 疾电叱羽 enter/exit (allies only) ──────────────────────────────
        if (zone.abilityId === "ji_dian_chi_yu") {
          const allyBid = (zone as any).allyBuffId ?? 2620;
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          if (owner) {
            const dxJ = owner.position.x - zone.x;
            const dyJ = owner.position.y - zone.y;
            const inside = Math.sqrt(dxJ * dxJ + dyJ * dyJ) <= zone.radius;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === allyBid && (b as any).linkedZoneId === zone.id && b.expiresAt > now);
            if (inside && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["ji_dian_chi_yu"] ?? { id: "ji_dian_chi_yu", name: "疾电叱羽" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: allyBid,
                  name: "疾电叱羽",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  description: "受到的所有伤害转移至疾电叱羽阵",
                  effects: [{ type: "JI_DIAN_REDIRECT" }],
                  linkedZoneId: zone.id,
                } as any,
              });
              buffsChanged = true;
            } else if (!inside && hasBuff) {
              const idx = (owner.buffs as any[]).findIndex((b: any) =>
                b.buffId === allyBid && (b as any).linkedZoneId === zone.id
              );
              if (idx >= 0) {
                const removed = owner.buffs[idx];
                owner.buffs.splice(idx, 1);
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
                buffsChanged = true;
              }
            }
          }
          continue; // ji_dian zone does not deal periodic damage
        }

        // Enter/exit zones: check every frame — no interval gate needed
        if (zone.abilityId === SHENGTAIJI_ZONE_ID || zone.abilityId === "sheng_tai_ji") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          const isInsideZone = (p: any) => {
            const dx = p.position.x - zone.x;
            const dy = p.position.y - zone.y;
            const inRadius = Math.sqrt(dx * dx + dy * dy) <= zone.radius;
            const pz = p.position.z ?? 0;
            const inHeight = Math.abs(pz - zoneZ) <= zoneHeight;
            return inRadius && inHeight;
          };
          const zoneSourceAbilityId = zone.abilityId === SHENGTAIJI_ZONE_ID ? "qionglong_huasheng" : zone.abilityId;
          const zoneSourceAbilityName = zone.abilityId === SHENGTAIJI_ZONE_ID ? "穹隆化生" : zone.abilityName ?? "生太极";
          const zoneAbility = (ABILITIES[zoneSourceAbilityId] ?? { id: zoneSourceAbilityId, name: zoneSourceAbilityName }) as any;

          if (owner && owner.hp > 0) {
            const ownerInside = isInsideZone(owner);
            const ownerHasBuff = owner.buffs.some((b: any) => b.buffId === SHENGTAIJI_PULSE_BUFF_ID && b.expiresAt > now);
            if (ownerInside && !ownerHasBuff) {
              // Cleanse CC on enter
              const ccRemoved = owner.buffs.filter((b: any) =>
                b.effects?.some((e: any) => e.type === "CONTROL" || e.type === "ATTACK_LOCK")
              );
              owner.buffs = owner.buffs.filter((b: any) =>
                !b.effects?.some((e: any) => e.type === "CONTROL" || e.type === "ATTACK_LOCK")
              );
              for (const removed of ccRemoved) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: zoneAbility,
                buffTarget: owner as any,
                buff: {
                  buffId: SHENGTAIJI_PULSE_BUFF_ID,
                  name: "生太极",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  breakOnPlay: false,
                  effects: [{ type: "CONTROL_IMMUNE" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!ownerInside && ownerHasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === SHENGTAIJI_PULSE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== SHENGTAIJI_PULSE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }

          for (const target of this.state.players) {
            if (target.userId === zone.ownerUserId) continue;
            if (target.hp <= 0) continue;
            const targetInside = isInsideZone(target);
            const targetHasBuff = target.buffs.some((b: any) => b.buffId === SHENGTAIJI_ENEMY_SLOW_BUFF_ID && b.expiresAt > now);
            if (targetInside && !targetHasBuff) {
              const hasRootSlowImmune = target.buffs.some((b: any) =>
                b.effects?.some((e: any) => e.type === "ROOT_SLOW_IMMUNE")
              );
              if (!hasRootSlowImmune) {
                addBuff({
                  state: this.state,
                  sourceUserId: zone.ownerUserId,
                  targetUserId: target.userId,
                  ability: zoneAbility,
                  buffTarget: target as any,
                  buff: {
                    buffId: SHENGTAIJI_ENEMY_SLOW_BUFF_ID,
                    name: "生太极·迟滞",
                    category: "DEBUFF",
                    durationMs: zone.expiresAt - now,
                    breakOnPlay: false,
                    effects: [{ type: "SLOW", value: 0.4 }],
                  } as any,
                });
                buffsChanged = true;
              }
            } else if (!targetInside && targetHasBuff) {
              const removed = target.buffs.find((b: any) => b.buffId === SHENGTAIJI_ENEMY_SLOW_BUFF_ID);
              target.buffs = target.buffs.filter((b: any) => b.buffId !== SHENGTAIJI_ENEMY_SLOW_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: target.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 冲阴阳: owner inside → 内功减伤30%; outside → remove
        if (zone.abilityId === "chong_yin_yang") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          if (owner && owner.hp > 0) {
            const dx = owner.position.x - zone.x;
            const dy = owner.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((owner.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === CHONG_YIN_YANG_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["chong_yin_yang"] ?? { id: "chong_yin_yang", name: "冲阴阳" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: CHONG_YIN_YANG_ZONE_BUFF_ID,
                  name: "冲阴阳",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [{ type: "DAMAGE_REDUCTION", value: 0.3, damageType: "内功" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === CHONG_YIN_YANG_ZONE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== CHONG_YIN_YANG_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 凌太虚: owner inside → 外功减伤30%; outside → remove
        if (zone.abilityId === "ling_tai_xu") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          if (owner && owner.hp > 0) {
            const dx = owner.position.x - zone.x;
            const dy = owner.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((owner.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === LING_TAI_XU_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["ling_tai_xu"] ?? { id: "ling_tai_xu", name: "凌太虚" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: LING_TAI_XU_ZONE_BUFF_ID,
                  name: "凌太虚",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [{ type: "DAMAGE_REDUCTION", value: 0.3, damageType: "外功" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === LING_TAI_XU_ZONE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== LING_TAI_XU_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 碎星辰: owner inside → 外功会心提高10%、外功会心效果提高15%; outside → remove
        if (zone.abilityId === "sui_xing_chen") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          if (owner && owner.hp > 0) {
            const dx = owner.position.x - zone.x;
            const dy = owner.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((owner.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === SUI_XING_CHEN_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["sui_xing_chen"] ?? { id: "sui_xing_chen", name: "碎星辰" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: SUI_XING_CHEN_ZONE_BUFF_ID,
                  name: "碎星辰",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [
                    { type: "CRIT_CHANCE_BONUS", value: 10, damageType: "外功" } as any,
                    { type: "CRIT_EFFECT_BONUS", value: 0.15, damageType: "外功" } as any,
                  ],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === SUI_XING_CHEN_ZONE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== SUI_XING_CHEN_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 破苍穹: owner inside → 内功会心提高10%、内功会心效果提高15%; outside → remove
        if (zone.abilityId === "po_cang_qiong") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          if (owner && owner.hp > 0) {
            const dx = owner.position.x - zone.x;
            const dy = owner.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((owner.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === PO_CANG_QIONG_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["po_cang_qiong"] ?? { id: "po_cang_qiong", name: "破苍穹" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: PO_CANG_QIONG_ZONE_BUFF_ID,
                  name: "破苍穹",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [
                    { type: "CRIT_CHANCE_BONUS", value: 10, damageType: "内功" } as any,
                    { type: "CRIT_EFFECT_BONUS", value: 0.15, damageType: "内功" } as any,
                  ],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === PO_CANG_QIONG_ZONE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== PO_CANG_QIONG_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 吞日月: enemies inside → 封轻功; outside → remove
        if (zone.abilityId === "tun_ri_yue") {
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? zone.radius;
          for (const target of this.state.players) {
            if (target.userId === zone.ownerUserId) continue;
            if (target.hp <= 0) continue;
            const dx = target.position.x - zone.x;
            const dy = target.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((target.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = target.buffs.some((b: any) => b.buffId === TUN_RI_YUE_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: target.userId,
                ability: (ABILITIES["tun_ri_yue"] ?? { id: "tun_ri_yue", name: "吞日月" }) as any,
                buffTarget: target as any,
                buff: {
                  buffId: TUN_RI_YUE_ZONE_BUFF_ID,
                  name: "吞日月",
                  category: "DEBUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [{ type: "QINGGONG_SEAL" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = target.buffs.find((b: any) => b.buffId === TUN_RI_YUE_ZONE_BUFF_ID);
              target.buffs = target.buffs.filter((b: any) => b.buffId !== TUN_RI_YUE_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: target.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // Interval-based zones (镇山河 100ms pulse, damage zones)
        if (now - zone.lastTickAt >= zone.intervalMs) {
          zone.lastTickAt = now;

          if (zone.abilityId === ZHEN_SHAN_HE_ABILITY_ID) {
            const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
            const zhenShanHeAbility = ABILITIES[ZHEN_SHAN_HE_ABILITY_ID];
            const zoneZ = zone.z ?? 0;
            const zoneHeight = zone.height ?? zone.radius;

            if (owner && zhenShanHeAbility && owner.hp > 0) {
              const dx = owner.position.x - zone.x;
              const dy = owner.position.y - zone.y;
              const inRadius = Math.sqrt(dx * dx + dy * dy) <= zone.radius;
              const ownerZ = owner.position.z ?? 0;
              const inHeight = Math.abs(ownerZ - zoneZ) <= zoneHeight;

              if (inRadius && inHeight) {
                if (
                  pulseZhenShanHeTarget({
                    state: this.state,
                    ability: zhenShanHeAbility,
                    target: owner as any,
                    sourceUserId: zone.ownerUserId,
                    now,
                    zoneExpiresAt: zone.expiresAt,
                  })
                ) {
                  buffsChanged = true;
                }
              } else {
                // Player left zone: remove zone invulnerable buff if present
                const idx = owner.buffs.findIndex((b: any) => b.buffId === ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID && b.expiresAt > now);
                if (idx !== -1) {
                  const removed = owner.buffs[idx];
                  owner.buffs.splice(idx, 1);
                  pushBuffExpired(this.state, {
                    targetUserId: owner.userId,
                    buffId: removed.buffId,
                    buffName: removed.name,
                    buffCategory: removed.category,
                    sourceAbilityId: removed.sourceAbilityId,
                    sourceAbilityName: removed.sourceAbilityName,
                  });
                  buffsChanged = true;
                }
              }
            }
            continue;
          }

          if ((zone.damagePerInterval ?? 0) <= 0) {
            continue;
          }

          const owner = this.state.players.find(p => p.userId === zone.ownerUserId);
          let targetsHit = 0;
          const baseZoneTargets = getHostileDamageTargets(this.state, zone.ownerUserId).filter((target) => {
            if (blocksEnemyTargeting(target.target as any)) return false;
            const targetPosition = getHostileDamageTargetPosition(target);
            const dx = targetPosition.x - zone.x;
            const dy = targetPosition.y - zone.y;
            const hitRadius = zone.radius + (target.kind === "entity" ? Math.max(0, Number(target.target.radius ?? 0)) : 0);
            if (Math.sqrt(dx * dx + dy * dy) > hitRadius) return false;
            if (zone.height !== undefined) {
              const zoneZ = zone.z ?? 0;
              const targetZ = targetPosition.z ?? 0;
              if (Math.abs(targetZ - zoneZ) > zone.height) return false;
            }
            return true;
          });
          const zoneTargets = (() => {
            if (!hasMiYunConfusion(owner as any) || baseZoneTargets.length === 0) return baseZoneTargets;
            const candidatePool = getMiYunAreaCandidates({
              state: this.state,
              sourceUserId: zone.ownerUserId,
              center: { x: zone.x, y: zone.y, z: zone.z },
              radiusWorld: zone.radius,
              verticalHalfHeightWorld: zone.height ?? zone.radius,
            }).filter((candidate) => {
              if (zone.height === undefined) return true;
              const targetZ = getHostileDamageTargetPosition(candidate as HostileDamageTarget).z ?? 0;
              return Math.abs(targetZ - (zone.z ?? 0)) <= zone.height;
            });
            if (candidatePool.length === 0) return baseZoneTargets;
            return Array.from(
              { length: baseZoneTargets.length },
              () => candidatePool[Math.floor(Math.random() * candidatePool.length)] as HostileDamageTarget,
            );
          })();
          for (const target of zoneTargets) {
            if (zone.maxTargets !== undefined && targetsHit >= zone.maxTargets) break;
            if (
              target.kind === "player" &&
              tryApplyDodgeForHit({
                state: this.state,
                source: owner ?? ({ userId: zone.ownerUserId } as any),
                target: target.target as any,
                abilityId: zone.abilityId,
                abilityName: zone.abilityName,
                enabled: zone.abilityId === "kuang_long_luan_wu",
                damageType: (ABILITIES[zone.abilityId ?? ""] as any)?.damageType,
              })
            ) {
              targetsHit++;
              buffsChanged = true;
              continue;
            }
            applyDamageToHostileTarget({
              state: this.state,
              source: (owner ?? ({ userId: zone.ownerUserId, buffs: [] } as any)) as any,
              target,
              baseDamage: zone.damagePerInterval,
              abilityId: zone.abilityId,
              abilityName: zone.abilityName,
              effectType: "PERIODIC_DAMAGE",
              damageType: (ABILITIES[zone.abilityId ?? ""] as any)?.damageType,
              timestamp: now,
            });
            targetsHit++;
            buffsChanged = true;
          }
        }
      }
      const hadZones = this.state.groundZones.length;
      this.state.groundZones = activeZones;
      if (activeZones.length !== hadZones) buffsChanged = true;
    }

    // 1e2. Targetable entities (e.g. 逐云寒蕊): lifecycle + per-friendly stealth tracking.
    if (this.state.entities && this.state.entities.length > 0) {
      const ZHU_YUN_STEALTH_BUFF_ID = 2716;
      const ZHU_YUN_STEALTH_DURATION_MS = 2_000; // refreshed each tick while in zone (long enough to display in status bar)
      const STEALTH_GRANT_DELAY_MS = 1_000;
      const ATTACK_REARM_MS = 1_000;
      const ZHU_YUN_ABILITY_ID = "zhu_yun_han_rui";
      const zhuYunAbility = ABILITIES[ZHU_YUN_ABILITY_ID];

      // Helper: cascade-remove stealth buff from all players owned by this entity.
      const cascadeRemoveStealth = (entity: TargetEntity) => {
        for (const player of this.state.players) {
          const idx = player.buffs.findIndex(
            (b: any) =>
              b.buffId === ZHU_YUN_STEALTH_BUFF_ID &&
              b.sourceAbilityId === ZHU_YUN_ABILITY_ID &&
              b.sourceUserId === entity.ownerUserId
          );
          if (idx !== -1) {
            const removed = player.buffs[idx];
            player.buffs.splice(idx, 1);
            pushBuffExpired(this.state, {
              targetUserId: player.userId,
              buffId: removed.buffId,
              buffName: removed.name,
              buffCategory: removed.category,
              sourceAbilityId: removed.sourceAbilityId,
              sourceAbilityName: removed.sourceAbilityName,
            });
            buffsChanged = true;
          }
        }
      };

      const aliveEntities: TargetEntity[] = [];
      for (const entity of this.state.entities) {
        const isExpired = now >= entity.expiresAt;
        const isDead = entity.hp <= 0;
        if (isExpired || isDead) {
          cascadeRemoveStealth(entity);
          buffsChanged = true;
          continue;
        }

        if (entity.kind === "zhu_yun_han_rui") {
          const owner = this.state.players.find((p) => p.userId === entity.ownerUserId);
          // 1v1 today: friendlies = owner only. Loop on all players for forward compat.
          for (const player of this.state.players) {
            if (player.userId !== entity.ownerUserId) continue; // friendly check
            if (player.hp <= 0) continue;

            const dx = (player.position?.x ?? 0) - entity.position.x;
            const dy = (player.position?.y ?? 0) - entity.position.y;
            const inZone = Math.hypot(dx, dy) <= entity.radius;

            if (!entity.enteredAtByUser) entity.enteredAtByUser = {};
            if (!entity.rearmAtByUser) entity.rearmAtByUser = {};

            const hasStealth = player.buffs.some(
              (b: any) => isRuntimeBuffActive(b, now) && b.buffId === ZHU_YUN_STEALTH_BUFF_ID && b.sourceAbilityId === ZHU_YUN_ABILITY_ID && b.sourceUserId === entity.ownerUserId
            );

            if (!inZone) {
              // Left the zone (or never entered) — remove stealth, reset timers.
              entity.enteredAtByUser[player.userId] = 0;
              entity.rearmAtByUser[player.userId] = 0;
              if (hasStealth) {
                const idx = player.buffs.findIndex(
                  (b: any) => b.buffId === ZHU_YUN_STEALTH_BUFF_ID && b.sourceAbilityId === ZHU_YUN_ABILITY_ID && b.sourceUserId === entity.ownerUserId
                );
                if (idx !== -1) {
                  const removed = player.buffs[idx];
                  player.buffs.splice(idx, 1);
                  pushBuffExpired(this.state, {
                    targetUserId: player.userId,
                    buffId: removed.buffId,
                    buffName: removed.name,
                    buffCategory: removed.category,
                    sourceAbilityId: removed.sourceAbilityId,
                    sourceAbilityName: removed.sourceAbilityName,
                  });
                  buffsChanged = true;
                }
              }
              continue;
            }

            // In zone.
            const enteredAt = entity.enteredAtByUser[player.userId] ?? 0;
            if (enteredAt === 0) {
              entity.enteredAtByUser[player.userId] = now;
            }

            if (hasStealth) {
              // Refresh duration so it doesn't expire mid-tick.
              const buff = player.buffs.find(
                (b: any) => b.buffId === ZHU_YUN_STEALTH_BUFF_ID && b.sourceAbilityId === ZHU_YUN_ABILITY_ID && b.sourceUserId === entity.ownerUserId
              ) as any;
              if (buff) {
                buff.expiresAt = Math.min(entity.expiresAt, now + ZHU_YUN_STEALTH_DURATION_MS);
              }
            } else {
              // Detect attack-break: if we previously had stealth this tick session, set rearm.
              const wasStealthed = (entity as any)._lastHadStealth?.[player.userId] === true;
              if (wasStealthed) {
                entity.rearmAtByUser[player.userId] = now + ATTACK_REARM_MS;
              }
              const rearmAt = entity.rearmAtByUser[player.userId] ?? 0;
              const enteredAtNow = entity.enteredAtByUser[player.userId] ?? now;
              const earliestGrantAt = Math.max(enteredAtNow + STEALTH_GRANT_DELAY_MS, rearmAt);
              if (now >= earliestGrantAt && zhuYunAbility) {
                const stealthBuff = (zhuYunAbility.buffs ?? []).find((b: any) => b.buffId === ZHU_YUN_STEALTH_BUFF_ID);
                if (stealthBuff) {
                  addBuff({
                    state: this.state,
                    sourceUserId: entity.ownerUserId,
                    targetUserId: player.userId,
                    ability: zhuYunAbility,
                    buffTarget: player as any,
                    buff: { ...stealthBuff, durationMs: Math.min(entity.expiresAt - now, ZHU_YUN_STEALTH_DURATION_MS) } as any,
                  });
                  buffsChanged = true;
                }
              }
            }

            // Track stealth presence for next-tick break detection.
            if (!(entity as any)._lastHadStealth) (entity as any)._lastHadStealth = {};
            (entity as any)._lastHadStealth[player.userId] = player.buffs.some(
              (b: any) => isRuntimeBuffActive(b, now) && b.buffId === ZHU_YUN_STEALTH_BUFF_ID && b.sourceAbilityId === ZHU_YUN_ABILITY_ID && b.sourceUserId === entity.ownerUserId
            );
          }
          // Suppress unused-var lint (owner var helps debugging context).
          void owner;
        }

        aliveEntities.push(entity);
      }
      const hadEntities = this.state.entities.length;
      this.state.entities = aliveEntities;
      if (aliveEntities.length !== hadEntities) buffsChanged = true;
    }

    // 1f. Process STACK_ON_HIT_DAMAGE procs for all damage events this tick
    // Collect unique targets that were hit (excluding stack-proc damage itself)
    {
      if (this.stackProcScanIndex > this.state.events.length) {
        this.stackProcScanIndex = this.state.events.length;
      }
      const thisTickEvents = this.state.events.slice(this.stackProcScanIndex);
      const hitTargetIds = new Set<string>();
      const outgoingAttackEventsByActor = new Map<string, any[]>();
      const lvYeRetaliatedPairs = new Set<string>();
      for (const evt of thisTickEvents) {
        if (
          evt.type === "DAMAGE" &&
          evt.damageType !== YUMEN_PIERCING_DAMAGE_TYPE &&
          evt.effectType !== "STACK_ON_HIT_DAMAGE" &&
          (evt.value ?? 0) > 0 &&
          evt.targetUserId
        ) {
          hitTargetIds.add(evt.targetUserId);
        }
        if (isRuYiAttackTriggerEvent(evt)) {
          const actorEvents = outgoingAttackEventsByActor.get(evt.actorUserId) ?? [];
          actorEvents.push(evt);
          outgoingAttackEventsByActor.set(evt.actorUserId, actorEvents);
        }

        if (
          evt.type === "DAMAGE" &&
          (evt.value ?? 0) > 0 &&
          evt.actorUserId &&
          evt.targetUserId &&
          evt.actorUserId !== evt.targetUserId
        ) {
          const protector = this.state.players.find((p) => p.userId === evt.targetUserId);
          const attacker = this.state.players.find((p) => p.userId === evt.actorUserId);
          if (!protector || !attacker) continue;
          if ((protector.hp ?? 0) <= 0 || (attacker.hp ?? 0) <= 0) continue;
          if (!hasLvYeManShengBuff(protector as any, now)) continue;

          const radiusWorld = gameplayUnitsToWorldUnits(LV_YE_MAN_SHENG_RADIUS_UNITS, storedUnitScale);
          const dx = attacker.position.x - protector.position.x;
          const dy = attacker.position.y - protector.position.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= radiusWorld - 0.0001) continue;

          const pairKey = `${evt.actorUserId}:${evt.targetUserId}`;
          if (lvYeRetaliatedPairs.has(pairKey)) continue;
          lvYeRetaliatedPairs.add(pairKey);

          let awayX = dx;
          let awayY = dy;
          let knockbackSource = protector as any;
          if (dist <= 0.0001) {
            const dash = attacker.activeDash;
            const fallbackX = -Number(dash?.vxPerTick ?? protector.facing?.x ?? 1);
            const fallbackY = -Number(dash?.vyPerTick ?? protector.facing?.y ?? 0);
            const fallbackLen = Math.hypot(fallbackX, fallbackY);
            awayX = fallbackLen > 0.0001 ? fallbackX / fallbackLen : 1;
            awayY = fallbackLen > 0.0001 ? fallbackY / fallbackLen : 0;
            knockbackSource = {
              ...protector,
              position: {
                ...protector.position,
                x: protector.position.x - awayX,
                y: protector.position.y - awayY,
              },
            };
          } else {
            awayX /= dist;
            awayY /= dist;
          }

          const knockbackDistance = Math.max(0, radiusWorld - dist);
          const controlDurationMs = knockbackDistance > 0
            ? Math.max(100, Math.ceil((knockbackDistance / gameplayUnitsToWorldUnits(LV_YE_MAN_SHENG_KNOCKBACK_SPEED_UNITS_PER_SEC, storedUnitScale)) * 1000))
            : 100;
          const knockbackResult = applyType3KnockbackControl({
            state: this.state,
            source: knockbackSource,
            target: attacker as any,
            abilityId: LV_YE_MAN_SHENG_ABILITY_ID,
            abilityName: "绿野蔓生",
            knockbackUnits: knockbackDistance,
            controlDurationMs,
            mapCtx: this.mapCtx,
            now,
          });
          if (knockbackResult.applied) {
            buffsChanged = true;
          }

          const lvYeAbility = ABILITIES[LV_YE_MAN_SHENG_ABILITY_ID] as any;
          const lvYeEffect = Array.isArray(lvYeAbility?.effects)
            ? lvYeAbility.effects.find((entry: any) => entry?.type === "PLACE_LV_YE_MAN_SHENG_FIELD")
            : null;
          const retaliateDamage = applyDamageToHostileTarget({
            state: this.state,
            source: protector as any,
            target: { kind: "player", target: attacker } as any,
            baseDamage: Number(lvYeEffect?.retaliateDamage ?? 3),
            abilityId: LV_YE_MAN_SHENG_ABILITY_ID,
            abilityName: "绿野蔓生",
            effectType: "DAMAGE",
            timestamp: now,
          });
          if (retaliateDamage > 0) {
            buffsChanged = true;
          }
        }
      }
      for (const targetId of hitTargetIds) {
        const targetPlayer = this.state.players.find((p) => p.userId === targetId);
        if (!targetPlayer || targetPlayer.hp <= 0) continue;

        if (tryRemoveWufangRootOnHit(this.state, targetPlayer as any, now)) {
          buffsChanged = true;
        }
        if (tryRemoveSanCaiRootOnHit(this.state, targetPlayer as any, now)) {
          buffsChanged = true;
        }

        const actor = this.state.players.find((p) => p.userId !== targetId);
        for (let bi = targetPlayer.buffs.length - 1; bi >= 0; bi--) {
          const stackBuff = targetPlayer.buffs[bi];
          if ((stackBuff.stacks ?? 0) <= 0) continue;
          for (const e of stackBuff.effects) {
            if (e.type === "STACK_ON_HIT_DAMAGE") {
              if (stackBuff.procCooldownMs !== undefined && stackBuff.lastProcAt !== undefined) {
                if (now - stackBuff.lastProcAt < stackBuff.procCooldownMs) break;
              }
              const stackSource = this.state.players.find((p) => p.userId === (stackBuff.sourceUserId ?? "")) ?? actor;
              const stackDamageRoll = resolveScheduledDamageRoll({
                source: stackSource as any,
                target: targetPlayer as any,
                base: e.value ?? 0,
                abilityId: stackBuff.sourceAbilityId,
                damageType: (ABILITIES[stackBuff.sourceAbilityId ?? ""] as any)?.damageType,
              });
              const dmg = stackDamageRoll.damage;
              const {
                adjustedDamage: stackApply,
                redirectPlayer: stackRedirectPlayer,
                redirectAmt: stackRedirectAmt,
              } = preCheckRedirect(this.state, targetPlayer as any, dmg);
              const stackResult = stackApply > 0
                ? applyDamageToTarget(targetPlayer as any, stackApply)
                : { hpDamage: 0, shieldAbsorbed: 0 };
              if (stackResult.hpDamage > 0 || stackResult.shieldAbsorbed > 0) {
                processOnDamageTaken(
                  this.state,
                  targetPlayer as any,
                  stackResult.hpDamage,
                  stackBuff.sourceUserId ?? actor?.userId,
                  stackResult.shieldAbsorbed,
                );
              }
              if (stackRedirectPlayer && stackRedirectAmt > 0) {
                applyRedirectToOpponent(this.state, stackRedirectPlayer, stackRedirectAmt);
              }
              stackBuff.stacks = (stackBuff.stacks ?? 1) - 1;
              stackBuff.lastProcAt = now;
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: stackBuff.sourceUserId ?? actor?.userId ?? targetId,
                targetUserId: targetId,
                abilityId: stackBuff.sourceAbilityId,
                abilityName: stackBuff.sourceAbilityName ?? stackBuff.name,
                effectType: "STACK_ON_HIT_DAMAGE",
                value: stackApply,
                isCrit: stackDamageRoll.isCrit,
                shieldAbsorbed: stackResult.shieldAbsorbed > 0 ? stackResult.shieldAbsorbed : undefined,
              });
              if (stackBuff.stacks <= 0) {
                targetPlayer.buffs.splice(bi, 1);
                pushBuffExpired(this.state, {
                  targetUserId: targetId,
                  buffId: stackBuff.buffId,
                  buffName: stackBuff.name,
                  buffCategory: stackBuff.category,
                  sourceAbilityId: stackBuff.sourceAbilityId,
                  sourceAbilityName: stackBuff.sourceAbilityName,
                });
              }
              buffsChanged = true;
              break;
            } else if (e.type === "STACK_ON_HIT_GUAN_TI_HEAL") {
              if (stackBuff.procCooldownMs !== undefined && stackBuff.lastProcAt !== undefined) {
                if (now - stackBuff.lastProcAt < stackBuff.procCooldownMs) break;
              }
              const healBase = e.value ?? 0;
              const healApplied = applyHealToTarget(targetPlayer as any, resolveMaxHpPercentHealAmount(targetPlayer, healBase));
              stackBuff.stacks = (stackBuff.stacks ?? 1) - 1;
              stackBuff.lastProcAt = now;
              if (healApplied > 0) {
                const guanTiName = stackBuff.name.includes("（贯体）") ? stackBuff.name : `${stackBuff.name}（贯体）`;
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: targetId,
                  targetUserId: targetId,
                  abilityId: stackBuff.sourceAbilityId,
                  abilityName: guanTiName,
                  effectType: "STACK_ON_HIT_GUAN_TI_HEAL",
                  value: healApplied,
                });
              }
              if (stackBuff.stacks <= 0) {
                targetPlayer.buffs.splice(bi, 1);
                pushBuffExpired(this.state, {
                  targetUserId: targetId,
                  buffId: stackBuff.buffId,
                  buffName: stackBuff.name,
                  buffCategory: stackBuff.category,
                  sourceAbilityId: stackBuff.sourceAbilityId,
                  sourceAbilityName: stackBuff.sourceAbilityName,
                });
              }
              buffsChanged = true;
              break;
            }
          }
        }

        // 应天授命 (YING_TIAN_SHIELD): on each hit, accumulate damage and heal 6% of lost HP
        for (const ytBuff of targetPlayer.buffs) {
          if (!isRuntimeBuffActive(ytBuff as any, now)) continue;
          const ytEffect = ytBuff.effects.find((e) => e.type === "YING_TIAN_SHIELD");
          if (!ytEffect) continue;
          let tickDmg = 0;
          for (const evt of thisTickEvents) {
            if (
              evt.type === "DAMAGE" &&
              evt.targetUserId === targetId &&
              (evt.value ?? 0) > 0 &&
              evt.damageType !== YUMEN_PIERCING_DAMAGE_TYPE &&
              evt.effectType !== "YING_TIAN_SHIELD"
            ) {
              tickDmg += evt.value ?? 0;
            }
          }
          if (tickDmg > 0) {
            (ytBuff as any).yingTianAccum = ((ytBuff as any).yingTianAccum ?? 0) + tickDmg;
          }
          const ytMaxHp = targetPlayer.maxHp ?? 100;
          const ytLostHp = ytMaxHp - targetPlayer.hp;
          if (tickDmg > 0 && ytLostHp > 0) {
            const ytHealPct = ytEffect.value ?? 0.06;
            const ytHealAmt = Math.floor(ytLostHp * ytHealPct);
            const ytApplied = applyHealToTarget(targetPlayer as any, ytHealAmt);
            if (ytApplied > 0) {
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "HEAL",
                actorUserId: targetId,
                targetUserId: targetId,
                abilityId: ytBuff.sourceAbilityId,
                abilityName: `${ytBuff.sourceAbilityName ?? ytBuff.name}（贯体）`,
                effectType: "YING_TIAN_SHIELD",
                value: ytApplied,
              });
              buffsChanged = true;
            }
          }
          break;
        }
      }

      for (const [actorUserId, attackEvents] of outgoingAttackEventsByActor.entries()) {
        const actor = this.state.players.find((p) => p.userId === actorUserId);
        if (!actor || actor.hp <= 0) continue;

        const targetPlayer = attackEvents
          .map((evt) => this.state.players.find((p) => p.userId === evt.targetUserId))
          .find((candidate): candidate is typeof actor => !!candidate && candidate.hp > 0 && !blocksEnemyTargeting(candidate));
        if (!targetPlayer) continue;

        for (let bi = actor.buffs.length - 1; bi >= 0; bi--) {
          const triggerBuff = actor.buffs[bi] as any;
          if (!triggerBuff.effects?.some((e: any) => e.type === "APPLY_RECORDED_CONTROL_ON_ATTACK")) {
            continue;
          }

          const recordedControls = Array.isArray(triggerBuff.recordedControls)
            ? triggerBuff.recordedControls
            : [];
          if (recordedControls.length > 0) {
            applyRuYiRecordedControls({
              state: this.state,
              source: actor as any,
              target: targetPlayer as any,
              recordedControls,
            });
          }

          actor.buffs.splice(bi, 1);
          pushBuffExpired(this.state, {
            targetUserId: actor.userId,
            buffId: triggerBuff.buffId,
            buffName: triggerBuff.name,
            buffCategory: triggerBuff.category,
            sourceAbilityId: triggerBuff.sourceAbilityId,
            sourceAbilityName: triggerBuff.sourceAbilityName,
          });
          buffsChanged = true;
          break;
        }
      }

      // 徐如林 (actor-side proc): for each unique attacker that dealt damage,
      // if they have the parent XU_RU_LIN_PROC buff and don't already have the
      // child XU_RU_LIN_RESTORE buff, 50% chance to apply the 1s child buff.
      const hitActorIds = new Set<string>();
      for (const evt of thisTickEvents) {
        if (evt.type === "DAMAGE" && (evt.value ?? 0) > 0 && evt.actorUserId) {
          // Skip self-inflicted (e.g. STACK_ON_HIT_DAMAGE on the receiver itself).
          if (evt.targetUserId && evt.actorUserId === evt.targetUserId) continue;
          hitActorIds.add(evt.actorUserId);
        }
      }
      for (const actorId of hitActorIds) {
        const actor = this.state.players.find((p) => p.userId === actorId);
        if (!actor || actor.hp <= 0) continue;
        const parent = actor.buffs.find(
          (b) => b.effects.some((e) => (e as any).type === "XU_RU_LIN_PROC") && b.expiresAt > now,
        );
        if (!parent) continue;
        const alreadyHasChild = actor.buffs.some(
          (b) => b.effects.some((e) => (e as any).type === "XU_RU_LIN_RESTORE") && b.expiresAt > now,
        );
        if (alreadyHasChild) continue;
        if (Math.random() >= 0.5) continue;

        const xulinAbility = ABILITIES["xu_ru_lin"];
        const childBuffDef = (xulinAbility?.buffs ?? []).find(
          (b: any) => Array.isArray(b.effects) && b.effects.some((e: any) => e.type === "XU_RU_LIN_RESTORE"),
        );
        if (!xulinAbility || !childBuffDef) continue;
        addBuff({
          state: this.state,
          sourceUserId: actor.userId,
          targetUserId: actor.userId,
          ability: xulinAbility as any,
          buffTarget: actor as any,
          buff: childBuffDef as any,
        });
        buffsChanged = true;
      }

      this.stackProcScanIndex = this.state.events.length;
    }

    combatStatusChanged = syncCombatStatusFromEvents(this.state, eventDiffStart) || combatStatusChanged;

    // 2. Check win condition. Testing mode keeps the same battle running by
    // restoring everyone when any player hits 0 HP.
    const winStart = performance.now();
    if (this.isYumenMode) {
      const defeatedUserIds = this.state.players
        .filter((player: any) => player.hp <= 0 && player.yumenDefeated !== true && !hasActiveYumenSpectatorBuff(player as any, now))
        .map((player) => player.userId);
      const defeatedUserIdSet = new Set(defeatedUserIds);
      const defeatAnnouncements = collectDefeatAnnouncementsFromEvents(
        this.state,
        eventDiffStart,
        defeatedUserIds,
        { includeHistoricalFallback: false, allowUnattributed: true, recentDamageFallbackMs: 3000 },
      );

      if (defeatedUserIds.length > 0) {
        if (this.state.safeZone?.autoFullHeal === true) {
          this.state.safeZone.autoFullHeal = false;
        }

        const rewardedAttackers = new Set<string>();
        for (const announcement of defeatAnnouncements) {
          const attackerUserId = announcement.attackerUserId ?? null;
          if (!attackerUserId || rewardedAttackers.has(attackerUserId)) continue;
          if (this.applyYumenKillReward(attackerUserId, defeatedUserIdSet, now)) {
            rewardedAttackers.add(attackerUserId);
            buffsChanged = true;
          }
        }

        for (const defeatedUserId of defeatedUserIds) {
          const defeatedPlayer = this.state.players.find((player) => player.userId === defeatedUserId);
          const result = this.applyYumenDeathState(defeatedPlayer as any, now);
          if (result.changed) {
            buffsChanged = true;
            handStateChanged = handStateChanged || result.handChanged;
            consumableStateChanged = consumableStateChanged || result.consumablesChanged;
            movementStateChanged = true;
            combatStatusChanged = true;
          }
        }

        this.state.gameOver = false;
        delete (this.state as any).winnerUserId;
        this.pushYumenDefeatEvents(defeatAnnouncements, now);

        for (const announcement of defeatAnnouncements) {
          void broadcastDefeatSystemChat(this.gameId, announcement.defeatedUserId, announcement.attackerUserId).catch((err) => {
            console.error(`[GameLoop] Failed to broadcast defeat chat for ${this.gameId}:`, err);
          });
        }
      }

      if (!this.state.gameOver && this.state.safeZone?.autoSettle === true && countYumenAlivePlayers(this.state, now) <= 1) {
        const yumenResults = buildYumenResults(this.state, now);
        this.state.gameOver = true;
        this.state.winnerUserId = yumenResults.winnerUserId;
        (this.state as any).yumenResults = yumenResults;
        this.state.events.push({
          id: randomUUID(),
          timestamp: now,
          turn: this.state.turn,
          type: "YUMEN_GAME_END",
          actorUserId: yumenResults.winnerUserId ?? "system",
          winnerUserId: yumenResults.winnerUserId,
        });
      }
    } else {
      const defeatedUserIds = this.state.players.filter((player) => player.hp <= 0).map((player) => player.userId);
      const defeatAnnouncements = collectDefeatAnnouncementsFromEvents(this.state, eventDiffStart, defeatedUserIds);
      if (resetDefeatedPlayersForTesting(this.state)) {
        for (const announcement of defeatAnnouncements) {
          void broadcastDefeatSystemChat(this.gameId, announcement.defeatedUserId, announcement.attackerUserId).catch((err) => {
            console.error(`[GameLoop] Failed to broadcast defeat chat for ${this.gameId}:`, err);
          });
        }
        buffsChanged = true;
      } else {
        checkGameOver(this.state);
      }
    }
    const winTime = performance.now() - winStart;

    // 3. Broadcast position updates (throttled to reduce bandwidth)
    let broadcastTime = 0;
    this.ticksSinceBroadcast++;
    if (this.ticksSinceBroadcast >= this.broadcastTickInterval) {
      const bcastStart = performance.now();
      // Increment version only on broadcasts
      this.state.version = (this.state.version ?? 0) + 1;
      
      // Send position + facing + cooldown changes (lightweight diff)
      const diff: Array<{ path: string; value: any }> = [];
      const lastBroadcastSignatures = ((this as any)._lastBroadcastSignatures ??= {} as Record<string, string>);
      const lastCountdownBroadcastValues = ((this as any)._lastCountdownBroadcastValues ??= {} as Record<string, number>);
      const roundForBroadcast = (value: any, decimals = 3) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return value;
        const scale = 10 ** decimals;
        return Math.round(numeric * scale) / scale;
      };
      const compactPosition = (position: any) => ({
        x: roundForBroadcast(position?.x),
        y: roundForBroadcast(position?.y),
        ...(typeof position?.z === "number" ? { z: roundForBroadcast(position.z) } : {}),
      });
      const compactFacing = (facing: any) => ({
        x: roundForBroadcast(facing?.x ?? 0, 4),
        y: roundForBroadcast(facing?.y ?? 1, 4),
      });
      const compactActiveDash = (dash: any) => dash ? {
        abilityId: dash.abilityId,
        ...(typeof dash.startedAt === "number" ? { startedAt: dash.startedAt } : {}),
        vxPerTick: roundForBroadcast(dash.vxPerTick, 5),
        vyPerTick: roundForBroadcast(dash.vyPerTick, 5),
        ...(typeof dash.vzPerTick === "number" ? { vzPerTick: roundForBroadcast(dash.vzPerTick, 5) } : {}),
        ...(typeof dash.forceVzPerTick === "number" ? { forceVzPerTick: roundForBroadcast(dash.forceVzPerTick, 5) } : {}),
        ...(dash.lingRanCastLift === true ? { lingRanCastLift: true } : {}),
        ...(typeof dash.hitTargetUserId === "string" ? { hitTargetUserId: dash.hitTargetUserId } : {}),
        ...(typeof dash.hitTargetEntityId === "string" ? { hitTargetEntityId: dash.hitTargetEntityId } : {}),
        ticksRemaining: Math.max(0, Number(dash.ticksRemaining ?? 0)),
      } : null;
      const compactActiveChannel = (channel: any) => channel ? {
        abilityId: channel.abilityId,
        abilityName: channel.abilityName,
        instanceId: channel.instanceId,
        ...(typeof channel.targetUserId === "string" ? { targetUserId: channel.targetUserId } : {}),
        ...(typeof channel.entityTargetId === "string" ? { entityTargetId: channel.entityTargetId } : {}),
        startedAt: channel.startedAt,
        durationMs: channel.durationMs,
        ...(typeof channel.tickIntervalMs === "number" ? { tickIntervalMs: channel.tickIntervalMs } : {}),
        ...(typeof channel.consumableId === "string" ? { consumableId: channel.consumableId } : {}),
        ...(channel.cancelOnMove === true ? { cancelOnMove: true } : {}),
        ...(channel.cancelOnJump === true ? { cancelOnJump: true } : {}),
        ...(typeof channel.cancelOnOutOfRange === "number" ? { cancelOnOutOfRange: channel.cancelOnOutOfRange } : {}),
        ...(channel.forwardChannel === false ? { forwardChannel: false } : {}),
        ...(channel.lockMovement === true ? { lockMovement: true } : {}),
        ...(channel.interruptible === false ? { interruptible: false } : {}),
      } : null;
      const pushPatchIfChanged = (path: string, value: any) => {
        const signature = JSON.stringify(value ?? null);
        if (lastBroadcastSignatures[path] === signature) return;
        lastBroadcastSignatures[path] = signature;
        diff.push({ path, value });
      };
      const pushCountdownBoundaryIfChanged = (path: string, value: any) => {
        const current = Math.max(0, Math.ceil(Number(value ?? 0)));
        const previous = lastCountdownBroadcastValues[path];
        lastCountdownBroadcastValues[path] = current;
        if (
          previous === undefined ||
          (previous <= 0 && current > 0) ||
          (previous > 0 && current <= 0) ||
          current > previous
        ) {
          pushPatchIfChanged(path, current);
        }
      };
      this.state.players.forEach((p, pidx) => {
        pushPatchIfChanged(`/players/${pidx}/position`, compactPosition(p.position));
        // Include facing in compact movement updates so clients can render
        // authoritative direction indicators for both players in real time.
        pushPatchIfChanged(`/players/${pidx}/facing`, compactFacing(p.facing ?? { x: 0, y: 1 }));
        // Include activeDash only when active OR transitioning to null
        if (p.activeDash) {
          const compactDash = compactActiveDash(p.activeDash);
          const dashSignature = JSON.stringify({ ...compactDash, ticksRemaining: undefined });
          (this as any)._lastActiveDashSig = (this as any)._lastActiveDashSig ?? {};
          if ((this as any)._lastActiveDashSig[pidx] !== dashSignature) {
            pushPatchIfChanged(`/players/${pidx}/activeDash`, compactDash);
            (this as any)._lastActiveDashSig[pidx] = dashSignature;
          }
          (this as any)._hadActiveDash = (this as any)._hadActiveDash ?? {};
          (this as any)._hadActiveDash[pidx] = true;
        } else if ((this as any)._hadActiveDash?.[pidx]) {
          pushPatchIfChanged(`/players/${pidx}/activeDash`, null);
          (this as any)._hadActiveDash[pidx] = false;
          if ((this as any)._lastActiveDashSig) {
            (this as any)._lastActiveDashSig[pidx] = null;
          }
        }
        // Keep channel UI in sync, but only send when channel payload actually changes.
        // Sending activeChannel every broadcast tick can cause frontend progress bars to resync too often.
        (this as any)._lastActiveChannelSig = (this as any)._lastActiveChannelSig ?? {};
        const prevChannelSig = (this as any)._lastActiveChannelSig[pidx] ?? null;
        const compactChannel = compactActiveChannel(p.activeChannel);
        const nextChannelSig = compactChannel ? JSON.stringify(compactChannel) : null;

        if (nextChannelSig !== prevChannelSig) {
          pushPatchIfChanged(`/players/${pidx}/activeChannel`, compactChannel);
          (this as any)._lastActiveChannelSig[pidx] = nextChannelSig;
        }
      });
      // Append per-ability cooldown patches so clients stay in sync
      this.state.players.forEach((p, pidx) => {
        pushCountdownBoundaryIfChanged(`/players/${pidx}/globalGcdTicks`, (p as any).globalGcdTicks ?? 0);
        pushPatchIfChanged(`/players/${pidx}/visualGcd`, (p as any).visualGcd ?? null);
        pushPatchIfChanged(`/players/${pidx}/specialAbilityStates`, (p as any).specialAbilityStates ?? {});
        p.hand.forEach((ability, cidx) => {
          pushCountdownBoundaryIfChanged(`/players/${pidx}/hand/${cidx}/cooldown`, ability.cooldown);
          if ((ability as any).chargeCount !== undefined) {
            pushPatchIfChanged(`/players/${pidx}/hand/${cidx}/chargeCount`, (ability as any).chargeCount);
          }
          if ((ability as any).chargeRegenTicksRemaining !== undefined) {
            pushCountdownBoundaryIfChanged(`/players/${pidx}/hand/${cidx}/chargeRegenTicksRemaining`, (ability as any).chargeRegenTicksRemaining);
          }
          if ((ability as any).chargeLockTicks !== undefined) {
            pushCountdownBoundaryIfChanged(`/players/${pidx}/hand/${cidx}/chargeLockTicks`, (ability as any).chargeLockTicks);
          }
        });
      });

      // Append safe zone state so frontend can render the shrinking boundary
      if (this.state.safeZone) {
        pushPatchIfChanged("/safeZone", this.state.safeZone);
      }

      if (this.state.playArea) {
        pushPatchIfChanged("/playArea", this.state.playArea);
      }

      // Append ground zones so frontend can render persistent damage areas
      if (this.state.groundZones !== undefined) {
        pushPatchIfChanged("/groundZones", this.state.groundZones);
      }

      // Append targetable entities so frontend stays in sync on creation,
      // HP loss, natural expiry (12s), and destruction.
      if (this.state.entities !== undefined) {
        pushPatchIfChanged("/entities", this.state.entities);
      }

      // Append buff arrays whenever they changed (expiry or periodic effects)
      // or when new events were emitted this tick (e.g. pure channel completion).
      const hasNewEvents = this.state.events.length > eventDiffStart;
      const eventsPruned = this.pruneEventHistoryForBroadcast();
      if (buffsChanged || hasNewEvents || channelStateChanged || eventsPruned || combatStatusChanged || handStateChanged || consumableStateChanged) {
        this.state.players.forEach((p, pidx) => {
          pushPatchIfChanged(`/players/${pidx}/buffs`, p.buffs);
          if (handStateChanged) {
            pushPatchIfChanged(`/players/${pidx}/hand`, p.hand);
          }
          if (consumableStateChanged) {
            pushPatchIfChanged(`/players/${pidx}/consumableCounts`, (p as any).consumableCounts ?? {});
            pushPatchIfChanged(`/players/${pidx}/consumableCooldowns`, (p as any).consumableCooldowns ?? {});
          }
        });
        // Also push hp patches if periodic effects changed them
        this.state.players.forEach((p, pidx) => {
          pushPatchIfChanged(`/players/${pidx}/hp`, p.hp);
          pushPatchIfChanged(`/players/${pidx}/shield`, p.shield ?? 0);
          pushPatchIfChanged(`/players/${pidx}/inCombat`, p.inCombat === true);
          pushPatchIfChanged(`/players/${pidx}/combatLinks`, (p as any).combatLinks ?? {});
        });

        if (eventsPruned) {
          diff.push({ path: "/events", value: this.state.events });
        } else {
          // Include each new game event as an individual diff patch so the frontend
          // can spawn per-event floating numbers with proper labels + no combining.
          for (let i = eventDiffStart; i < this.state.events.length; i++) {
            diff.push({ path: `/events/${i}`, value: this.state.events[i] });
          }
        }
      }
      
      if (diff.length > 0 || this.state.gameOver) {
        // During gameplay, send compact movement-only broadcasts
        if (!this.state.gameOver) {
          broadcastGameUpdate({
            gameId: this.gameId,
            version: this.state.version,
            diff,
            isMovementOnly: true, // Compact format - skip events/timestamp for speed
          });
        } else {
          // Add gameOver + winnerUserId into the diff so frontend state.gameOver updates immediately via WS
          diff.push({ path: "/gameOver", value: true });
          if (this.state.winnerUserId) {
            diff.push({ path: "/winnerUserId", value: this.state.winnerUserId });
          }
          if ((this.state as any).yumenResults) {
            diff.push({ path: "/yumenResults", value: (this.state as any).yumenResults });
          }
          // Capture broadcast payload before the async save so we close over the
          // correct values even if the loop is stopped/cleared before .then() fires.
          const broadcastPayload = {
            gameId:       this.gameId,
            version:      this.state.version,
            diff,
            gameOver:     this.state.gameOver,
            winnerUserId: this.state.winnerUserId,
            timestamp:    Date.now(),
          };
          // Save to DB FIRST, then broadcast. This guarantees battle/complete can
          // read gameOver=true from DB before the frontend even receives the WS message.
          this.saveToDB()
            .then(()  => broadcastGameUpdate(broadcastPayload))
            .catch(() => broadcastGameUpdate(broadcastPayload)); // broadcast even if save fails
        }
      }
      
      broadcastTime = performance.now() - bcastStart;
      this.ticksSinceBroadcast = 0;
    }

    // 4. Auto-save to DB (every 50 ticks ≈ 0.8s intervals to reduce DB load on free VM)
    let saveTime = 0;
    if (this.state.version % 50 === 0) {
      const saveStart = performance.now();
      this.saveToDB();
      saveTime = performance.now() - saveStart;
    }

    const tickTotal = performance.now() - tickStart;

    // One-shot: log tick execution time on dash start/end
    const anyDashing = this.state.players.some(p => !!p.activeDash);
    if (anyDashing) {
      const tr = this.state.players.find(p => p.activeDash)?.activeDash?.ticksRemaining;
      if (tr === 59) {
        console.log(`[TICK-PERF] tick()=${tickTotal.toFixed(1)}ms  move=${moveTime.toFixed(1)}ms  broadcast=${broadcastTime.toFixed(1)}ms  save=${saveTime.toFixed(1)}ms  broadcastInterval=${this.broadcastTickInterval}`);
      }
    }

    if (tickTotal >= 80 || moveTime >= 40 || broadcastTime >= 40) {
      recordLagProbe("game-loop-slow-tick", {
        gameId: this.gameId,
        version: this.state.version ?? null,
        tickMs: roundLagMs(tickTotal),
        moveMs: roundLagMs(moveTime),
        broadcastMs: roundLagMs(broadcastTime),
        saveScheduleMs: roundLagMs(saveTime),
        playerCount: this.state.players.length,
        entityCount: this.state.entities?.length ?? 0,
        eventCount: this.state.events.length,
        broadcastInterval: this.broadcastTickInterval,
        buffsPerPlayer: this.state.players.map((player) => player.buffs?.length ?? 0),
      });
    }

  }

  /**
   * Broadcast game state diff to all connected players
   */
  private broadcast(prevState: GameState) {
    const diff = diffState(prevState, this.state);

    broadcastGameUpdate({
      gameId: this.gameId,
      version: this.state.version,
      diff,
      gameOver: this.state.gameOver,
      winnerUserId: this.state.winnerUserId,
      timestamp: Date.now(),
    });
  }

  /**
   * Save game state to database
   */
  private async saveToDB() {
    const saveStartedAt = performance.now();
    const version = this.state.version ?? null;
    let saved = false;
    let missingGame = false;
    try {
      const game = await GameSession.findByIdAndUpdate(
        this.gameId,
        { state: this.state },
        { new: false }
      );

      if (!game) {
        missingGame = true;
        console.warn(
          `[GameLoop] Game ${this.gameId} not found in DB, stopping loop`
        );
        this.stop();
      } else {
        saved = true;
      }
    } catch (err) {
      console.error(`[GameLoop] Error saving game ${this.gameId}:`, err);
      recordLagProbe("game-loop-db-save-error", {
        gameId: this.gameId,
        version,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't stop the loop on save errors - just log and continue
      // This prevents cascading failures
    } finally {
      const saveMs = performance.now() - saveStartedAt;
      if (saveMs >= 100) {
        recordLagProbe("game-loop-db-save-slow", {
          gameId: this.gameId,
          version,
          saveMs: roundLagMs(saveMs),
          saved,
          missingGame,
          playerCount: this.state.players.length,
          eventCount: this.state.events.length,
        });
      }
    }
  }

  /**
   * Stop the game loop
   */
  private stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    clearTimeout(this.tickInterval);

    // Final save to DB
    this.saveToDB();
  }

  /**
   * Get current game state snapshot (for ability casting validation)
   */
  getState(): GameState {
    const cloneStartedAt = performance.now();
    const cloned = structuredClone(this.state);
    const cloneMs = performance.now() - cloneStartedAt;
    if (cloneMs >= 50) {
      recordLagProbe("game-loop-clone-slow", {
        gameId: this.gameId,
        operation: "getState",
        version: this.state.version ?? null,
        cloneMs: roundLagMs(cloneMs),
        playerCount: this.state.players.length,
        entityCount: this.state.entities?.length ?? 0,
        eventCount: this.state.events.length,
      });
    }
    return cloned;
  }

  /**
   * Expose map context for LOS validation in ability cast path.
   */
  getMapCtx(): MapContext {
    this.syncDynamicMapContext();
    return this.mapCtx;
  }

  /**
   * Check in-memory gameOver flag — used by battle/complete to bypass the
   * DB-flush race condition (saveToDB is fire-and-forget so DB may lag behind).
   */
  static getInMemoryGameOver(gameId: string): { gameOver: boolean; winnerUserId?: string } | null {
    const loop = activeLoops.get(gameId);
    if (!loop) return null;
    return { gameOver: loop.state.gameOver, winnerUserId: loop.state.winnerUserId };
  }

  /**
   * Update game state from external changes (ability cast, etc.)
   * Called by gameplay routes
   */
  updateState(newState: GameState) {
    const cloneStartedAt = performance.now();
    this.state = structuredClone(newState);
    const cloneMs = performance.now() - cloneStartedAt;
    if (cloneMs >= 50) {
      recordLagProbe("game-loop-clone-slow", {
        gameId: this.gameId,
        operation: "updateState",
        version: this.state.version ?? null,
        cloneMs: roundLagMs(cloneMs),
        playerCount: this.state.players.length,
        entityCount: this.state.entities?.length ?? 0,
        eventCount: this.state.events.length,
      });
    }
    this.syncDynamicMapContext();
    if (this.stackProcScanIndex > this.state.events.length) {
      this.stackProcScanIndex = this.state.events.length;
    }
  }

  /**
   * Get distance between two players
   */
  getPlayerDistance(): number {
    const p1 = this.state.players[0];
    const p2 = this.state.players[1];
    return calculateDistance(p1.position, p2.position, this.state.unitScale);
  }

  /**
   * Check if ability is in range
   */
  isAbilityInRange(playerIndex: number, range?: number): boolean {
    if (!range) return true; // No range restriction

    const distance = this.getPlayerDistance();
    return distance <= range;
  }
}
