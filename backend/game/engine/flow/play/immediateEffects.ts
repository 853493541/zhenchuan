// engine/flow/applyImmediateEffects.ts
import { randomUUID } from "crypto";
import { resolveEffectTargetIndex } from "../../utils/targeting";
import { blocksEnemyTargeting, isAlwaysSelfEffect, isEnemyEffect, shouldSkipDueToDodge, hasKnockbackImmune, hasKnockedBackImmune, hasDamageImmune, blocksControlByImmunity, isRuntimeBuffActive } from "../../rules/guards";
import {
  handleDamage,
  handleBonusDamageIfHpGt,
  handleHeal,
  handleDraw,
  handleCleanse,
  handleChannelEffect,
  handleDash,
  handleDirectionalDash,
} from "../../effects/handlers";
import {
  captureAndCleanseControls,
  type CapturedControlKind,
  type CapturedControlSnapshot,
} from "../../effects/definitions/Cleanse";
import { gameplayUnitsToWorldUnits, worldUnitsToGameplayUnits } from "../../state/types";
import { resolveAttackDamageBase, resolveHealAmountRoll, resolveNonCritHealAmountRoll, resolveRawDamageWithCrit, resolveScheduledDamage, resolveScheduledDamageRoll } from "../../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget, getMaxHp, removeLinkedShield, resolveMaxHpPercentHealAmount } from "../../utils/health";
import { addBuff, pushBuffExpired } from "../../effects/buffRuntime";
import {
  applyZhenShanHeSelfCastBuff,
  pulseZhenShanHeTarget,
  ZHEN_SHAN_HE_ABILITY_ID,
} from "../../effects/definitions/ZhenShanHe";
import { getGroundHeightForMap, resolveMapCollisions, type MapContext } from "../../loop/movement";
import { loadBuffEditorOverrides } from "../../../abilities/buffEditorOverrides";
import { ABILITIES } from "../../../abilities/abilities";
import { applyDashRuntimeBuff, DASH_CC_IMMUNE_BUFF_ID } from "../../effects/definitions/DirectionalDash";
import { processOnDamageTaken, preCheckRedirect, applyRedirectToOpponent } from "../../effects/onDamageHooks";
import { getDunLiReflectVictim } from "../../effects/dunLiReflect";
import { getAbilityRangeBonusFromBuffs, getEffectiveAbilityRange } from "../../utils/abilityRange";
import { removeDisguiseBuffs, SAND_DISGUISE_BUFF_ID } from "../../utils/disguise";
import {
  CHU_HE_HAN_JIE_WALL_DURATION_MS,
  CHU_HE_HAN_JIE_WALL_HEIGHT_UNITS,
  CHU_HE_HAN_JIE_WALL_HP,
  CHU_HE_HAN_JIE_WALL_KIND,
  CHU_HE_HAN_JIE_WALL_LENGTH_UNITS,
  CHU_HE_HAN_JIE_WALL_THICKNESS_UNITS,
  resolveEnemyChuHeHanJieWallCollision,
} from "../../utils/chuHeHanJieWall";
import { triggerYunSanBlink } from "../../utils/yunSan";
import { buildStolenBuffDefinition, isQinYinGongMingBuffStealable } from "../../../abilities/qinYinGongMing";
import { rerollMiYunAreaTargets } from "../../utils/miyun";

const WUFANG_ROOT_BUFF_ID = 1330;
const WUFANG_HIT_PROTECT_BUFF_ID = 1331;
const WUFANG_HIT_PROTECT_RATIO = 0.5;
const WUFANG_HUISHEN_BUFF_ID = 1336;

const BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID = 1332;
const BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID = 1333;
const BANG_DA_GOU_TOU_ROOT_BUFF_ID = 1334;
const BANG_DA_GOU_TOU_CONTROL_BUFF_ID = 1335;

const SAN_CAI_ROOT_BUFF_ID = 2509;
const SAN_CAI_PROTECT_BUFF_ID = 2510;
const SAN_CAI_HIT_PROTECT_RATIO = 0.5;
const YIN_YUE_ZAN_DOT_BUFF_ID = 2511;
const LIE_RI_ZHAN_DEBUFF_ID = 2512;
const HENG_SAO_DOT_BUFF_ID = 2513;

const YOU_FENG_IMMUNITY_BUFF_ID = 2631;
const YOU_FENG_TARGET_BUFF_IDS: Record<CapturedControlKind, number> = {
  root: 2632,
  freeze: 2633,
  stun: 2634,
  knockdown: 2635,
};

const RU_YI_IMMUNITY_BUFF_ID = 2636;
const RU_YI_MARKER_BUFF_ID = 2637;
const RU_YI_TARGET_BUFF_IDS: Record<CapturedControlKind, number> = {
  root: 2638,
  freeze: 2639,
  stun: 2640,
  knockdown: 2641,
};

const SHI_XIN_GU_BUFF_ID = 2643;
const SHI_XIN_MARK_BUFF_ID = 2644;
const HONG_MENG_TIAN_JIN_BUFF_ID = 2645;
const SHU_SE_BUFF_ID = 2646;
const HONG_MENG_CLEANSE_ATTRIBUTES = ["阴性", "阳性", "混元", "毒性", "持续伤害"];
const STANDARD_KNOCKBACK_BUFF_ID = 9101;
const SHOU_QUE_BUFF_ID = 2652;
const WU_XIANG_JUE_FIFTY_BUFF_ID = 2710;
const WU_XIANG_JUE_SIXTY_BUFF_ID = 2731;
const WU_XIANG_JUE_SEVENTY_BUFF_ID = 2732;
const WU_XIANG_JUE_EIGHTY_BUFF_ID = 2733;
const WU_XIANG_JUE_NINETY_BUFF_ID = 2734;
const SHESHEN_REDIRECT_BUFF_ID = 2737;
const SHESHEN_BEAR_BUFF_ID = 2738;
const YUAN_GUARD_BUFF_ID = 2739;
const YUAN_BEAR_BUFF_ID = 2740;
const SHENGTAIJI_ZONE_ABILITY_ID = "qionglong_huasheng_zone";
const SHENGTAIJI_PULSE_BUFF_ID = 1310;
const SHENGTAIJI_ENEMY_SLOW_BUFF_ID = 1311;
const ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID = 1323;
const CHONG_YIN_YANG_ZONE_BUFF_ID = 2701;
const LING_TAI_XU_ZONE_BUFF_ID = 2702;
const TUN_RI_YUE_ZONE_BUFF_ID = 2703;
const SUI_XING_CHEN_ZONE_BUFF_ID = 2704;
const PO_CANG_QIONG_ZONE_BUFF_ID = 2705;

const QI_FIELD_ZONE_ABILITY_IDS = new Set([
  SHENGTAIJI_ZONE_ABILITY_ID,
  "sheng_tai_ji",
  "tun_ri_yue",
  ZHEN_SHAN_HE_ABILITY_ID,
  "po_cang_qiong",
  "sui_xing_chen",
  "ling_tai_xu",
  "chong_yin_yang",
]);

const MECHANISM_ZONE_ABILITY_IDS = new Set(["tian_jue_di_mie"]);

function getWuXiangJueSnapshotBuffId(player: { hp?: number; maxHp?: number }) {
  const maxHp = player.maxHp ?? 100;
  if (maxHp <= 0) return WU_XIANG_JUE_FIFTY_BUFF_ID;
  const hp = Math.max(0, player.hp ?? maxHp);
  const hpPct = hp / maxHp;
  if (hpPct <= 0.1) return WU_XIANG_JUE_NINETY_BUFF_ID;
  if (hpPct <= 0.25) return WU_XIANG_JUE_EIGHTY_BUFF_ID;
  if (hpPct <= 0.5) return WU_XIANG_JUE_SEVENTY_BUFF_ID;
  if (hpPct <= 0.75) return WU_XIANG_JUE_SIXTY_BUFF_ID;
  return WU_XIANG_JUE_FIFTY_BUFF_ID;
}

function expireImmediateBuffById(state: any, target: any, buffId: number) {
  let removedAny = false;
  while (true) {
    const idx = (target.buffs ?? []).findIndex((buff: any) => buff?.buffId === buffId);
    if (idx === -1) break;
    const [removed] = target.buffs.splice(idx, 1);
    pushBuffExpired(state, {
      targetUserId: target.userId,
      buffId: removed.buffId,
      buffName: removed.name,
      buffCategory: removed.category,
      sourceAbilityId: removed.sourceAbilityId,
      sourceAbilityName: removed.sourceAbilityName,
    });
    removedAny = true;
  }
  return removedAny;
}

function clearDestroyedGroundZoneBuffs(state: any, zone: any) {
  const players = state.players ?? [];
  const owner = players.find((player: any) => player.userId === zone.ownerUserId);

  if (zone.abilityId === SHENGTAIJI_ZONE_ABILITY_ID || zone.abilityId === "sheng_tai_ji") {
    for (const player of players) {
      expireImmediateBuffById(state, player, SHENGTAIJI_PULSE_BUFF_ID);
      expireImmediateBuffById(state, player, SHENGTAIJI_ENEMY_SLOW_BUFF_ID);
    }
    return;
  }

  if (zone.abilityId === ZHEN_SHAN_HE_ABILITY_ID) {
    if (owner) {
      expireImmediateBuffById(state, owner, ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID);
    }
    return;
  }

  if (zone.abilityId === "chong_yin_yang") {
    if (owner) expireImmediateBuffById(state, owner, CHONG_YIN_YANG_ZONE_BUFF_ID);
    return;
  }

  if (zone.abilityId === "ling_tai_xu") {
    if (owner) expireImmediateBuffById(state, owner, LING_TAI_XU_ZONE_BUFF_ID);
    return;
  }

  if (zone.abilityId === "sui_xing_chen") {
    if (owner) expireImmediateBuffById(state, owner, SUI_XING_CHEN_ZONE_BUFF_ID);
    return;
  }

  if (zone.abilityId === "po_cang_qiong") {
    if (owner) expireImmediateBuffById(state, owner, PO_CANG_QIONG_ZONE_BUFF_ID);
    return;
  }

  if (zone.abilityId === "tun_ri_yue") {
    for (const player of players) {
      if (player.userId === zone.ownerUserId) continue;
      expireImmediateBuffById(state, player, TUN_RI_YUE_ZONE_BUFF_ID);
    }
  }
}

function destroyGroundZonesInRange(params: {
  state: any;
  sourceUserId: string;
  center: { x: number; y: number; z?: number };
  radius: number;
  ownerMode: "enemy-only" | "ally-only" | "any";
  destroyQiFields: boolean;
  destroyMechanisms: boolean;
}) {
  const { state, sourceUserId, center, radius, ownerMode, destroyQiFields, destroyMechanisms } = params;
  const zones = Array.isArray(state.groundZones) ? state.groundZones : [];
  if (zones.length === 0) {
    return { destroyedZones: [] as any[], destroyedFriendlyQiFields: 0 };
  }

  const keptZones: any[] = [];
  const destroyedZones: any[] = [];
  let destroyedFriendlyQiFields = 0;

  for (const zone of zones) {
    const isFriendly = zone.ownerUserId === sourceUserId;
    if (ownerMode === "enemy-only" && isFriendly) {
      keptZones.push(zone);
      continue;
    }
    if (ownerMode === "ally-only" && !isFriendly) {
      keptZones.push(zone);
      continue;
    }

    const abilityId = String(zone.abilityId ?? "");
    const isQiField = destroyQiFields && QI_FIELD_ZONE_ABILITY_IDS.has(abilityId);
    const isMechanism = destroyMechanisms && MECHANISM_ZONE_ABILITY_IDS.has(abilityId);
    if (!isQiField && !isMechanism) {
      keptZones.push(zone);
      continue;
    }

    const dx = (zone.x ?? 0) - center.x;
    const dy = (zone.y ?? 0) - center.y;
    if (Math.hypot(dx, dy) > radius) {
      keptZones.push(zone);
      continue;
    }
    if (Math.abs(Number(zone.z ?? 0) - Number(center.z ?? 0)) > radius) {
      keptZones.push(zone);
      continue;
    }

    destroyedZones.push(zone);
    if (isQiField && isFriendly) {
      destroyedFriendlyQiFields += 1;
    }
  }

  if (destroyedZones.length > 0) {
    state.groundZones = keptZones;
    for (const zone of destroyedZones) {
      clearDestroyedGroundZoneBuffs(state, zone);
    }
  }

  return { destroyedZones, destroyedFriendlyQiFields };
}

function syncStolenBuffRuntime(params: {
  sourcePlayer: any;
  stolenBuff: any;
  appliedBuff: any;
  stolenShieldAmount?: number;
}) {
  const { sourcePlayer, stolenBuff, appliedBuff, stolenShieldAmount } = params;

  appliedBuff.expiresAt = stolenBuff.expiresAt;
  if (stolenBuff.periodicMs !== undefined) appliedBuff.periodicMs = stolenBuff.periodicMs;
  if (stolenBuff.periodicStartImmediate !== undefined) appliedBuff.periodicStartImmediate = stolenBuff.periodicStartImmediate;
  if (stolenBuff.lastTickAt !== undefined) appliedBuff.lastTickAt = stolenBuff.lastTickAt;
  if (stolenBuff.stageIndex !== undefined) appliedBuff.stageIndex = stolenBuff.stageIndex;
  if (stolenBuff.appliedAt !== undefined) appliedBuff.appliedAt = stolenBuff.appliedAt;
  if (stolenBuff.firedDelayIndices) appliedBuff.firedDelayIndices = [...stolenBuff.firedDelayIndices];
  if (stolenBuff.stacks !== undefined) appliedBuff.stacks = stolenBuff.stacks;
  if (stolenBuff.maxStacks !== undefined) appliedBuff.maxStacks = stolenBuff.maxStacks;
  if (stolenBuff.procCooldownMs !== undefined) appliedBuff.procCooldownMs = stolenBuff.procCooldownMs;
  if (stolenBuff.lastProcAt !== undefined) appliedBuff.lastProcAt = stolenBuff.lastProcAt;
  if (stolenBuff.forcedMovementMode !== undefined) appliedBuff.forcedMovementMode = stolenBuff.forcedMovementMode;
  if (stolenBuff.forcedMoveDirection) {
    appliedBuff.forcedMoveDirection = { ...stolenBuff.forcedMoveDirection };
  }
  if (stolenBuff.sourceAbilityId) appliedBuff.sourceAbilityId = stolenBuff.sourceAbilityId;
  if (stolenBuff.sourceAbilityName) appliedBuff.sourceAbilityName = stolenBuff.sourceAbilityName;

  const nextShieldAmount = typeof stolenShieldAmount === "number" ? stolenShieldAmount : stolenBuff.shieldAmount;
  if (typeof nextShieldAmount === "number") {
    const previousShield = appliedBuff.shieldAmount ?? 0;
    const nextShield = nextShieldAmount;
    const shieldDelta = nextShield - previousShield;
    if (shieldDelta !== 0) {
      sourcePlayer.shield = Math.max(0, (sourcePlayer.shield ?? 0) + shieldDelta);
    }
    appliedBuff.shieldAmount = nextShield;
  }
}

type ImmediateEnemyDamageTarget =
  | { kind: "player"; target: any }
  | { kind: "entity"; target: any };

function isImmediateEntityTarget(target: any): boolean {
  return !!target && typeof target.id === "string" && typeof target.ownerUserId === "string";
}

function getImmediateEnemyStatusTargetDistance(
  center: { x: number; y: number },
  target: ImmediateEnemyDamageTarget
) {
  const dx = (target.target.position?.x ?? 0) - center.x;
  const dy = (target.target.position?.y ?? 0) - center.y;
  const rawDistance = Math.hypot(dx, dy);
  if (target.kind !== "entity") return rawDistance;
  return Math.max(0, rawDistance - Math.max(0, Number(target.target.radius ?? 0)));
}

function getImmediateEnemyTargetVerticalAllowance(target: ImmediateEnemyDamageTarget, radius: number) {
  return radius + (target.kind === "entity" ? Math.max(0, Number(target.target.radius ?? 0)) : 0);
}

function isImmediateEnemyTargetInsideAoeCylinder(
  center: { x: number; y: number; z?: number },
  target: ImmediateEnemyDamageTarget,
  radius: number,
) {
  if (getImmediateEnemyStatusTargetDistance(center, target) > radius) return false;
  const centerZ = Number(center.z ?? 0);
  const targetZ = Number(target.target.position?.z ?? 0);
  return Math.abs(targetZ - centerZ) <= getImmediateEnemyTargetVerticalAllowance(target, radius);
}

function getImmediateEnemyBuffTargets(
  state: any,
  sourceUserId: string,
  center: { x: number; y: number; z?: number },
  radius: number,
  rerollForMiYun: boolean = true,
): ImmediateEnemyDamageTarget[] {
  const targets: ImmediateEnemyDamageTarget[] = [];

  for (const victim of state.players ?? []) {
    if (victim.userId === sourceUserId) continue;
    if ((victim.hp ?? 0) <= 0) continue;
    if (blocksEnemyTargeting(victim)) continue;
    const target = { kind: "player", target: victim } satisfies ImmediateEnemyDamageTarget;
    if (!isImmediateEnemyTargetInsideAoeCylinder(center, target, radius)) continue;
    targets.push(target);
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;
    if (entity.ownerUserId === sourceUserId) continue;
    if (blocksEnemyTargeting(entity as any)) continue;
    const target = { kind: "entity", target: entity } satisfies ImmediateEnemyDamageTarget;
    if (!isImmediateEnemyTargetInsideAoeCylinder(center, target, radius)) continue;
    targets.push(target);
  }

  if (!rerollForMiYun) return targets;

  const source = (state.players ?? []).find((candidate: any) => candidate.userId === sourceUserId);
  const rerolledTargets = rerollMiYunAreaTargets({
    state,
    source,
    sourceUserId,
    originalSlotCount: targets.length,
    center,
    radiusWorld: radius,
    verticalHalfHeightWorld: radius,
  });
  return (rerolledTargets as ImmediateEnemyDamageTarget[] | null) ?? targets;
}

function isImmediateStealthBuff(buff: any) {
  return Array.isArray(buff?.effects) && buff.effects.some((effect: any) => effect?.type === "STEALTH");
}

function isImmediateDunyingCompanion(buff: any) {
  return buff?.buffId === 1021;
}

function removeImmediateStealthBuffs(state: any, target: any) {
  const removed: any[] = [];

  target.buffs = (target.buffs ?? []).filter((buff: any) => {
    if (!isImmediateStealthBuff(buff)) return true;
    removed.push(buff);
    return false;
  });

  if (removed.some((buff) => buff?.buffId === 1012 || buff?.sourceAbilityId === "fuguang_lueying")) {
    const companionRemoved = (target.buffs ?? []).filter((buff: any) => isImmediateDunyingCompanion(buff));
    if (companionRemoved.length > 0) {
      target.buffs = target.buffs.filter((buff: any) => !isImmediateDunyingCompanion(buff));
      removed.push(...companionRemoved);
    }
  }

  for (const buff of removed) {
    removeLinkedShield(target as any, buff as any);
    pushBuffExpired(state, {
      targetUserId: target.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
    });
  }

  return removed.length > 0;
}

function dispelBuffAttributesFromTarget(params: {
  state: any;
  target: any;
  attributes: string[];
  count: number;
  buffOverrides: Record<string, any>;
}) {
  const { state, target, attributes, count, buffOverrides } = params;
  if (!target || !Array.isArray(target.buffs) || attributes.length === 0 || count <= 0) return;

  for (const attr of attributes) {
    let dispelled = 0;
    while (dispelled < count) {
      const idx = target.buffs.findIndex((b: any) => {
        if (b.category !== "BUFF") return false;
        const entry = buffOverrides[String(b.buffId)];
        return entry?.attribute === attr;
      });
      if (idx === -1) break;
      const removed = target.buffs[idx];
      removeLinkedShield(target as any, removed);
      target.buffs.splice(idx, 1);
      pushBuffExpired(state, {
        targetUserId: target.userId,
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

function getExplicitEntityTarget(state: any, entityTargetId?: string) {
  if (!entityTargetId || !Array.isArray(state.entities)) return null;
  const entity = state.entities.find((candidate: any) => candidate.id === entityTargetId);
  if (!entity || entity.hp <= 0) return null;
  return entity;
}

function getExplicitFriendlyEntityTarget(state: any, sourceUserId: string, entityTargetId?: string) {
  const entity = getExplicitEntityTarget(state, entityTargetId);
  if (!entity || entity.hp <= 0 || entity.ownerUserId !== sourceUserId) return null;
  return entity;
}

function getExplicitEnemyPlayerTarget(
  state: any,
  sourceUserId: string,
  targetUserId?: string,
  ignoreTargetAllegiance?: boolean,
) {
  if (!targetUserId || !Array.isArray(state.players)) return null;
  const target = state.players.find((candidate: any) => candidate.userId === targetUserId);
  if (!target || target.userId === sourceUserId || (target.hp ?? 0) <= 0) return null;
  if (ignoreTargetAllegiance) return target;
  if (blocksEnemyTargeting(target)) return null;
  return target;
}

function getExplicitPlayerTarget(state: any, targetUserId?: string) {
  if (!targetUserId || !Array.isArray(state.players)) return null;
  const target = state.players.find((candidate: any) => candidate.userId === targetUserId);
  if (!target || (target.hp ?? 0) <= 0) return null;
  return target;
}

function resolveFriendlySupportTarget(state: any, source: any, castContext?: {
  targetUserId?: string;
  entityTargetId?: string;
  ignoreTargetAllegiance?: boolean;
}) {
  if (castContext?.ignoreTargetAllegiance === true) {
    const confusionEntityTarget = getExplicitEntityTarget(state, castContext?.entityTargetId);
    if (confusionEntityTarget) return confusionEntityTarget;

    const confusionPlayerTarget = getExplicitPlayerTarget(state, castContext?.targetUserId);
    if (confusionPlayerTarget) return confusionPlayerTarget;

    return source;
  }

  const friendlyEntityTarget = getExplicitFriendlyEntityTarget(
    state,
    source.userId,
    castContext?.entityTargetId,
  );
  if (friendlyEntityTarget) return friendlyEntityTarget;

  const playerTarget = getExplicitPlayerTarget(state, castContext?.targetUserId);
  if (playerTarget && playerTarget.userId === source.userId) {
    return playerTarget;
  }

  return source;
}

function pushImmediateHpAdjustmentEvent(params: {
  state: any;
  ability: any;
  sourceUserId: string;
  target: any;
  beforeHp: number;
  effectType: string;
}) {
  const { state, ability, sourceUserId, target, beforeHp, effectType } = params;
  const afterHp = Number(target?.hp ?? beforeHp);
  const delta = Math.round((afterHp - beforeHp) * 100) / 100;
  if (Math.abs(delta) <= 0.0001) return;

  const baseEvent = {
    id: randomUUID(),
    timestamp: Date.now(),
    turn: state.turn,
    actorUserId: sourceUserId,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType,
    value: Math.abs(delta),
  } as any;

  if (typeof target?.id === "string") {
    state.events.push({
      ...baseEvent,
      type: delta < 0 ? "DAMAGE" : "HEAL",
      entityId: target.id,
      entityName: target.abilityName,
    });
    return;
  }

  state.events.push({
    ...baseEvent,
    type: delta < 0 ? "DAMAGE" : "HEAL",
    targetUserId: target.userId,
  });
}

function applyImmediateGuanTiHeal(params: {
  state: any;
  ability: any;
  sourceUserId: string;
  target: any;
  percent: number;
}) {
  const { state, ability, sourceUserId, target, percent } = params;
  const amount = resolveMaxHpPercentHealAmount(target, percent);
  const applied = applyHealToTarget(target as any, amount);
  if (applied <= 0) return;

  const guanTiName = ability.name.includes("（贯体）") ? ability.name : `${ability.name}（贯体）`;

  const baseEvent = {
    id: randomUUID(),
    timestamp: Date.now(),
    turn: state.turn,
    type: "HEAL",
    actorUserId: sourceUserId,
    abilityId: ability.id,
    abilityName: guanTiName,
    effectType: "INSTANT_GUAN_TI_HEAL",
    value: applied,
  } as any;

  if (typeof target?.id === "string") {
    state.events.push({
      ...baseEvent,
      entityId: target.id,
      entityName: target.abilityName,
    });
    return;
  }

  state.events.push({
    ...baseEvent,
    targetUserId: target.userId,
  });
}

function getSourceFacingUnit(source: any) {
  const rawX = Number(source?.facing?.x ?? 0);
  const rawY = Number(source?.facing?.y ?? 1);
  const length = Math.hypot(rawX, rawY) || 1;
  return {
    x: rawX / length,
    y: rawY / length,
  };
}

function getForwardConeEnemyTargets(params: {
  state: any;
  source: any;
  rangeUnits: number;
  coneAngleDeg: number;
}) {
  const { state, source, rangeUnits, coneAngleDeg } = params;
  const radius = gameplayUnitsToWorldUnits(rangeUnits, state.unitScale);
  const facing = getSourceFacingUnit(source);
  const halfAngleCos = Math.cos((coneAngleDeg / 2) * Math.PI / 180);

  const coneTargets = getImmediateEnemyBuffTargets(state, source.userId, source.position, radius, false).filter((candidate) => {
    const dx = (candidate.target.position?.x ?? 0) - source.position.x;
    const dy = (candidate.target.position?.y ?? 0) - source.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.0001) return true;
    const dot = (facing.x * dx + facing.y * dy) / distance;
    return dot >= halfAngleCos;
  });

  const rerolledTargets = rerollMiYunAreaTargets({
    state,
    source,
    sourceUserId: source.userId,
    originalSlotCount: coneTargets.length,
    center: source.position,
    radiusWorld: radius,
    verticalHalfHeightWorld: radius,
    coneAngleDeg,
    facing,
  });
  return (rerolledTargets as ImmediateEnemyDamageTarget[] | null) ?? coneTargets;
}

function pullImmediateTargetTowardAnchor(params: {
  state: any;
  ability: any;
  source: any;
  target: ImmediateEnemyDamageTarget;
  anchor: { x: number; y: number; z: number };
  mapCtx?: MapContext;
}) {
  const {
    state,
    ability,
    source,
    target,
    anchor,
    mapCtx,
  } = params;
  const pullTarget = target.target as any;
  if (target.kind === "player" && hasKnockbackImmune(pullTarget as any)) {
    return false;
  }

  const dx = anchor.x - pullTarget.position.x;
  const dy = anchor.y - pullTarget.position.y;
  const distance = Math.hypot(dx, dy);
  const pullSpeedPerTick = gameplayUnitsToWorldUnits(20, state.unitScale) / 30;
  const ticksNeeded = Math.max(
    1,
    distance > 0.0001 ? Math.ceil(distance / pullSpeedPerTick) : 1,
  );
  const stepDistance = distance > 0.0001 ? Math.min(pullSpeedPerTick, distance / ticksNeeded) : 0;
  const dirX = distance > 0.0001 ? dx / distance : 0;
  const dirY = distance > 0.0001 ? dy / distance : 0;
  const targetGroundZ = getGroundHeightForMap(
    pullTarget.position.x,
    pullTarget.position.y,
    pullTarget.position.z ?? 0,
    mapCtx,
  );
  const currentZ = pullTarget.position.z ?? targetGroundZ;
  const verticalDelta = anchor.z - currentZ;
  const durationMs = Math.max(1, Math.ceil(ticksNeeded * (1000 / 30)));

  if (distance <= 0.0001 && Math.abs(verticalDelta) <= 0.0001) {
    return false;
  }

  pullTarget.activeDash = {
    abilityId: ability.id,
    vxPerTick: dirX * stepDistance,
    vyPerTick: dirY * stepDistance,
    forceVzPerTick: verticalDelta / ticksNeeded,
    maxUpVz: 999,
    maxDownVz: -999,
    ticksRemaining: ticksNeeded,
  } as any;

  if (target.kind === "player") {
    applyPlayerPullDashRuntimeBuff({
      state,
      ability,
      target: pullTarget,
      durationMs,
    });
  }

  return true;
}

function swapImmediatePlayerPositions(params: {
  state: any;
  source: any;
  target: any;
  mapCtx?: MapContext;
}) {
  const { state, source, target, mapCtx } = params;
  const sourcePosition = { ...source.position };
  const targetPosition = { ...target.position };

  source.position = { ...targetPosition };
  target.position = { ...sourcePosition };
  source.velocity = { ...source.velocity, vx: 0, vy: 0, vz: 0 };
  target.velocity = { ...target.velocity, vx: 0, vy: 0, vz: 0 };
  source.activeDash = undefined;
  target.activeDash = undefined;

  resolveMapCollisions(source as any, mapCtx);
  resolveMapCollisions(target as any, mapCtx);

  const playerRadius = mapCtx?.playerRadius ?? 2;
  resolveEnemyChuHeHanJieWallCollision({
    state,
    actorUserId: source.userId,
    position: source.position,
    radius: playerRadius,
    actorBaseZ: source.position.z ?? 0,
    actorHeight: 1.5,
  });
  resolveEnemyChuHeHanJieWallCollision({
    state,
    actorUserId: target.userId,
    position: target.position,
    radius: playerRadius,
    actorBaseZ: target.position.z ?? 0,
    actorHeight: 1.5,
  });
}

function applyImmediateKnockback(params: {
  state: any;
  ability: any;
  source: any;
  target: ImmediateEnemyDamageTarget;
  distanceUnits: number;
  durationTicks: number;
  knockedBackBuffId?: number;
}) {
  const { state, ability, source, target, distanceUnits, durationTicks, knockedBackBuffId } = params;
  const kbTarget = target.target as any;
  const dx = kbTarget.position.x - source.position.x;
  const dy = kbTarget.position.y - source.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return false;
  if (target.kind === "player" && hasKnockedBackImmune(kbTarget)) return false;

  const dirX = dx / distance;
  const dirY = dy / distance;
  const knockbackDistance = gameplayUnitsToWorldUnits(distanceUnits, state.unitScale);
  const moveTicks = Math.max(1, durationTicks);

  delete kbTarget.activeDash;
  if (kbTarget.velocity) {
    kbTarget.velocity.vx = 0;
    kbTarget.velocity.vy = 0;
    kbTarget.velocity.vz = 0;
  }

  kbTarget.activeDash = {
    abilityId: ability.id,
    vxPerTick: (dirX * knockbackDistance) / moveTicks,
    vyPerTick: (dirY * knockbackDistance) / moveTicks,
    stopOnWall: true,
    forceVzPerTick: 0,
    maxUpVz: 0,
    maxDownVz: 0,
    ticksRemaining: moveTicks,
    vzPerTick: 0,
  } as any;

  if (target.kind === "player" && typeof knockedBackBuffId === "number") {
    const knockedBackBuff = knockedBackBuffId === STANDARD_KNOCKBACK_BUFF_ID
      ? buildStandardKnockbackBuff(Math.max(1, Math.ceil((moveTicks * 1000) / 30)))
      : getAbilityBuffDefinition(ability, knockedBackBuffId);
    if (knockedBackBuff) {
      addBuff({
        state,
        sourceUserId: source.userId,
        targetUserId: kbTarget.userId,
        ability,
        buffTarget: kbTarget,
        buff: knockedBackBuffId === STANDARD_KNOCKBACK_BUFF_ID
          ? knockedBackBuff
          : {
              ...knockedBackBuff,
              durationMs: Math.max(1, Math.ceil((moveTicks * 1000) / 30)),
            },
      });
    }
  }

  return true;
}

function getRandomUnitDirection() {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

const SHI_XIN_GU_STANDSTILL_EFFECT_TYPES = new Set([
  "CONTROL",
  "ROOT",
  "ATTACK_LOCK",
  "FEARED",
  "KNOCKED_BACK",
  "PULLED",
]);

function shouldShiXinGuForceStandstill(target: any, mapCtx?: MapContext, now: number = Date.now()) {
  const hasLiveControlDebuff = (target?.buffs ?? []).some((buff: any) => {
    if ((buff.expiresAt ?? 0) <= now) return false;
    if (buff.category !== "DEBUFF") return false;
    if (typeof buff.name === "string" && buff.name.includes("倒地")) return true;
    return Array.isArray(buff.effects) && buff.effects.some((effect: any) =>
      SHI_XIN_GU_STANDSTILL_EFFECT_TYPES.has(effect?.type)
    );
  });
  if (hasLiveControlDebuff) return true;

  const px = Number(target?.position?.x ?? 0);
  const py = Number(target?.position?.y ?? 0);
  const pz = Number(target?.position?.z ?? 0);
  const groundZ = mapCtx ? getGroundHeightForMap(px, py, pz, mapCtx) : pz;
  return Number(target?.jumpCount ?? 0) > 0 || pz > groundZ + 0.05;
}

function getAbilityBuffDefinition(ability: any, buffId: number) {
  return Array.isArray(ability.buffs)
    ? ability.buffs.find((buff: any) => buff.buffId === buffId)
    : undefined;
}

function buildStandardKnockbackBuff(durationMs: number) {
  return {
    buffId: STANDARD_KNOCKBACK_BUFF_ID,
    name: "击退",
    category: "DEBUFF",
    durationMs,
    breakOnPlay: false,
    description: "被击退中，行动受限",
    effects: [{ type: "KNOCKED_BACK" }],
  } as any;
}

function applyPlayerPullDashRuntimeBuff(params: {
  state: any;
  ability: any;
  target: any;
  durationMs: number;
}) {
  const { state, ability, target, durationMs } = params;
  target.velocity = {
    ...target.velocity,
    vx: 0,
    vy: 0,
    vz: 0,
  };
  target.isPowerJump = false;
  target.isPowerJumpCombined = false;
  applyDashRuntimeBuff({
    state,
    target,
    durationMs: durationMs + 100,
    effects: [
      { type: "CONTROL_IMMUNE" },
      { type: "KNOCKBACK_IMMUNE" },
      { type: "DISPLACEMENT" },
      { type: "DASH_TURN_LOCK" },
    ] as any,
    sourceAbilityId: ability.id,
    sourceAbilityName: ability.name,
  });
}

function cleanseDebuffsByAttributes(params: {
  state: any;
  target: any;
  attributes: string[];
  count: number;
}) {
  const { state, target, attributes, count } = params;
  const { overrides } = loadBuffEditorOverrides();
  for (const attribute of attributes) {
    let removed = 0;
    while (removed < count) {
      const idx = target.buffs.findIndex((buff: any) => {
        if (buff.category !== "DEBUFF") return false;
        return overrides[String(buff.buffId)]?.attribute === attribute;
      });
      if (idx === -1) break;
      const removedBuff = target.buffs[idx];
      removeLinkedShield(target as any, removedBuff);
      target.buffs.splice(idx, 1);
      pushBuffExpired(state, {
        targetUserId: target.userId,
        buffId: removedBuff.buffId,
        buffName: removedBuff.name,
        buffCategory: removedBuff.category,
        sourceAbilityId: removedBuff.sourceAbilityId,
        sourceAbilityName: removedBuff.sourceAbilityName,
        sourceUserId: removedBuff.sourceUserId,
      });
      removed++;
    }
  }
}

function applyCapturedControlsToPlayerTarget(params: {
  state: any;
  ability: any;
  source: any;
  target: any;
  snapshots: CapturedControlSnapshot[];
  buffIdsByKind: Record<CapturedControlKind, number>;
  durationMode?: "remaining" | "full";
  forcedDurationMs?: number;
}) {
  const { state, ability, source, target, snapshots, buffIdsByKind, durationMode, forcedDurationMs } = params;
  if (!target || target.userId === source.userId || (target.hp ?? 0) <= 0 || blocksEnemyTargeting(target)) {
    return;
  }

  const effectiveRange = getEffectiveAbilityRange(ability as any, source?.buffs);
  if (typeof effectiveRange === "number") {
    const dx = (target.position?.x ?? 0) - (source.position?.x ?? 0);
    const dy = (target.position?.y ?? 0) - (source.position?.y ?? 0);
    const distanceGameplay = worldUnitsToGameplayUnits(Math.hypot(dx, dy), state.unitScale);
    if (distanceGameplay > effectiveRange) {
      return;
    }
  }

  for (const snapshot of snapshots) {
    const buffId = buffIdsByKind[snapshot.kind];
    const buffDef = getAbilityBuffDefinition(ability, buffId);
    if (!buffDef) continue;
    addBuff({
      state,
      sourceUserId: source.userId,
      targetUserId: target.userId,
      ability,
      buffTarget: target,
      buff: {
        ...buffDef,
        durationMs: Math.max(
          1,
          forcedDurationMs ?? (durationMode === "full" ? snapshot.fullDurationMs : snapshot.remainingMs),
        ),
      } as any,
    });
  }
}

function getImmediateEnemyDamageTargets(
  state: any,
  sourceUserId: string,
  center: { x: number; y: number; z?: number },
  radius: number
): ImmediateEnemyDamageTarget[] {
  const targets: ImmediateEnemyDamageTarget[] = [];

  for (const victim of state.players ?? []) {
    if (victim.userId === sourceUserId) continue;
    if ((victim.hp ?? 0) <= 0) continue;
    if (blocksEnemyTargeting(victim)) continue;

    const target = { kind: "player", target: victim } satisfies ImmediateEnemyDamageTarget;
    if (!isImmediateEnemyTargetInsideAoeCylinder(center, target, radius)) continue;
    targets.push(target);
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;
    if (entity.ownerUserId === sourceUserId) continue;
    if (blocksEnemyTargeting(entity as any)) continue;

    const target = { kind: "entity", target: entity } satisfies ImmediateEnemyDamageTarget;
    if (!isImmediateEnemyTargetInsideAoeCylinder(center, target, radius)) continue;
    targets.push(target);
  }

  const source = (state.players ?? []).find((candidate: any) => candidate.userId === sourceUserId);
  const rerolledTargets = rerollMiYunAreaTargets({
    state,
    source,
    sourceUserId,
    originalSlotCount: targets.length,
    center,
    radiusWorld: radius,
    verticalHalfHeightWorld: radius,
  });
  return (rerolledTargets as ImmediateEnemyDamageTarget[] | null) ?? targets;
}

function applyImmediateDamageToEnemyTarget(params: {
  state: any;
  source: any;
  ability: any;
  target: ImmediateEnemyDamageTarget;
  baseDamage: number;
  effectType: string;
  now: number;
}) {
  const { state, source, ability, target, baseDamage, effectType, now } = params;
  if (blocksEnemyTargeting(target.target as any)) return 0;
  if (hasDamageImmune(target.target as any)) {
    // 盾立 reflect: redirect this damage to the original caster.
    if (target.kind === "player") {
      const reflectVictim = getDunLiReflectVictim(
        state,
        source.userId,
        target.target,
        ability,
      );
      if (reflectVictim) {
        return applyImmediateDamageToEnemyTarget({
          state,
          source: target.target as any,
          ability,
          target: { kind: "player", target: reflectVictim },
          baseDamage,
          effectType,
          now,
        });
      }
    }
    return 0;
  }

  const damageTarget = target.target;
  const damageRoll = resolveScheduledDamageRoll({
    source,
    target: damageTarget,
    base: baseDamage,
    abilityId: ability.id,
    damageType: (ability as any).damageType,
  });
  const resolvedDamage = damageRoll.damage;
  if (resolvedDamage <= 0) {
    if (damageRoll.fullyReducedByDamageReduction === true) {
      state.events.push({
        id: randomUUID(),
        timestamp: now,
        turn: state.turn,
        type: "DAMAGE",
        actorUserId: source.userId,
        ...(target.kind === "player"
          ? { targetUserId: target.target.userId }
          : { entityId: target.target.id, entityName: target.target.abilityName }),
        abilityId: ability.id,
        abilityName: ability.name,
        effectType,
        value: 0,
        suppressCritLabel: true,
        displayZeroDamage: true,
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
      timestamp: now,
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: victim.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType,
      value: appliedDamage,
      isCrit: damageRoll.isCrit,
      shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
    });
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
    timestamp: now,
    turn: state.turn,
    type: "DAMAGE",
    actorUserId: source.userId,
    entityId: entity.id,
    entityName: entity.abilityName,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType,
    value: appliedDamage,
    isCrit: damageRoll.isCrit,
    shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
  });
  if (result.hpDamage > 0 || result.shieldAbsorbed > 0) {
    processOnDamageTaken(state, entity as any, result.hpDamage, source.userId, result.shieldAbsorbed);
  }
  if (redirectPlayer && redirectAmt > 0) {
    applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
  }
  return appliedDamage;
}

export function applyImmediateEffects(params: {
  state: any;
  ability: any;
  source: any;
  target: any;
  enemy: any;
  playerIndex: number;
  targetIndex: number;
  opponentHpAtStart: number;
  abilityDodged: boolean;
  mapCtx?: MapContext;
  castContext?: {
    targetUserId?: string;
    groundTarget?: { x: number; y: number; z?: number };
    entityTargetId?: string;
    ignoreTargetAllegiance?: boolean;
    forceEnemyApplied?: boolean;
  };
}) {
  const {
    state,
    ability,
    source,
    target,
    enemy,
    playerIndex,
    targetIndex,
    opponentHpAtStart,
    abilityDodged,
    mapCtx,
    castContext,
  } = params;
  const explicitEntityTarget = getExplicitEntityTarget(state, castContext?.entityTargetId);

  // 太极无极 stacking trigger: capture pre-damage CC state on target
  let taiJiCcOnTarget = false;
  if (ability.id === "tai_ji_wu_ji") {
    const tt = state.players[targetIndex];
    if (tt && tt.userId !== source.userId && (tt.hp ?? 0) > 0) {
      taiJiCcOnTarget = (tt.buffs ?? []).some((b: any) =>
        b.expiresAt > Date.now() &&
        b.effects?.some((e: any) =>
          e.type === "CONTROL" || e.type === "ROOT" || e.type === "FREEZE"
        )
      );
    }
  }

  // ── 雷霆震怒 pre-strip: knockdown / pushback / pull bypass DAMAGE_IMMUNE and strip the buff first ──
  const LEI_TING_BUFF_ID = 2506;
  const DISPLACEMENT_EFFECT_TYPES = new Set(["KNOCKED_BACK", "KNOCKBACK_DASH"]);
  const hasDisplacementEffect = ability.effects.some(
    (e: any) => DISPLACEMENT_EFFECT_TYPES.has(e.type)
  );
  if (hasDisplacementEffect) {
    const oppTarget = state.players[targetIndex];
    if (oppTarget && oppTarget.userId !== source.userId) {
      const leiTingBuff = oppTarget.buffs?.find((b: any) => b.buffId === LEI_TING_BUFF_ID);
      if (leiTingBuff) {
        oppTarget.buffs = oppTarget.buffs.filter((b: any) => b.buffId !== LEI_TING_BUFF_ID);
        // Emit BUFF_EXPIRED event
        (state.events as any[]).push({
          id: randomUUID(),
          timestamp: Date.now(),
          turn: state.turn,
          type: "BUFF_EXPIRED",
          actorUserId: oppTarget.userId,
          targetUserId: oppTarget.userId,
          abilityId: leiTingBuff.sourceAbilityId,
          abilityName: leiTingBuff.sourceAbilityName,
          buffId: leiTingBuff.buffId,
          buffName: leiTingBuff.name,
          buffCategory: leiTingBuff.category,
        });
      }
    }
  }

  const lingRanTianFengActive = (source.buffs ?? []).some((buff: any) =>
    buff.expiresAt > Date.now() &&
    buff.effects?.some((effect: any) => effect.type === "LING_RAN_TIAN_FENG_STATE")
  );
  if (lingRanTianFengActive || ability.id === "ling_ran_tian_feng") {
    source.lingRanTianFengCharges = 1;
  }

  for (const effect of ability.effects) {
    const effTargetIndex = resolveEffectTargetIndex(
      targetIndex,
      playerIndex,
      effect.applyTo
    );
    const playerEffTarget = state.players[effTargetIndex];
    const enemyApplied =
      effect.applyTo === "SELF" || isAlwaysSelfEffect(effect.type)
        ? false
        : (castContext?.forceEnemyApplied ?? isEnemyEffect(source, playerEffTarget, effect));
    // When an entity is the explicit target of a hostile effect, route the
    // effect (dash, control, damage) at the entity instead of the opposing
    // player so dashes home in on dummies / 逐云寒蕊 etc.
    const effTarget: any = explicitEntityTarget ?? playerEffTarget;

    // TRUE_DAMAGE bypasses dodge; all other enemy-applied effects skip on dodge.
    if ((effect as any).type !== "TRUE_DAMAGE" && shouldSkipDueToDodge(abilityDodged, enemyApplied)) continue;

    // PROJECTILE_IMMUNE: skip all enemy-targeted effects from projectile abilities
    if (
      enemyApplied &&
      (ability as any).isProjectile === true &&
      effTarget.buffs.some(
        (b: any) =>
          isRuntimeBuffActive(b) &&
          b.effects.some((e: any) => e.type === "PROJECTILE_IMMUNE") &&
          b.expiresAt > Date.now()
      )
    ) {
      continue;
    }

    switch (effect.type) {
      case "DAMAGE":
        // Entity-targeted damage: route to TargetEntity HP instead of player.
        if (explicitEntityTarget && enemyApplied) {
          {
            const appliedDmg = applyImmediateDamageToEnemyTarget({
              state,
              source,
              ability,
              target: { kind: "entity", target: explicitEntityTarget },
              baseDamage: effect.value ?? 0,
              effectType: "DAMAGE",
              now: Date.now(),
            });
            const ls = (effect as any).lifestealPct as number | undefined;
            if (ls && ls > 0 && appliedDmg && appliedDmg > 0) {
              const healRoll = resolveNonCritHealAmountRoll({
                source,
                target: source,
                base: Math.floor(appliedDmg * ls),
                scaleFlatHeal: false,
              });
              if (healRoll.heal > 0) {
                applyHealToTarget(source as any, healRoll.heal);
                state.events.push({
                  id: randomUUID(),
                  timestamp: Date.now(),
                  turn: state.turn,
                  type: "HEAL",
                  actorUserId: source.userId,
                  targetUserId: source.userId,
                  abilityId: ability.id,
                  abilityName: ability.name,
                  effectType: "DAMAGE",
                  value: healRoll.heal,
                  isCrit: healRoll.isCrit,
                });
              }
            }
          }
            break;
        }
        handleDamage(state, source, effTarget, enemyApplied, ability, effect);
        break;

      case "BONUS_DAMAGE_IF_TARGET_HP_GT":
        handleBonusDamageIfHpGt(
          state,
          source,
          target,
          opponentHpAtStart,
          ability,
          effect
        );
        break;

      case "HEAL":
        handleHeal(state, source, effTarget, ability, effect);
        break;

      case "INSTANT_GUAN_TI_HEAL": {
        const healBase = resolveMaxHpPercentHealAmount(effTarget, effect.value ?? 0);
        const healApplied = applyHealToTarget(effTarget, healBase);
        if (healApplied > 0) {
          const guanTiName = ability.name.includes("（贯体）") ? ability.name : `${ability.name}（贯体）`;
          state.events.push({
            id: randomUUID(),
            timestamp: Date.now(),
            turn: state.turn,
            type: "HEAL",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: guanTiName,
            effectType: "INSTANT_GUAN_TI_HEAL",
            value: healApplied,
          });
        }
        break;
      }

      case "DRAW":
        handleDraw(state, source, effect);
        break;

      case "CLEANSE":
        {
          const abilityRootFlag = (ability as any).cleanseRootSlow;
          const effectRootFlag = (effect as any).cleanseRootSlow;
          const resolvedRootFlag =
            effectRootFlag === true || effectRootFlag === false
              ? effectRootFlag
              : (abilityRootFlag === true || abilityRootFlag === false ? abilityRootFlag : undefined);

          handleCleanse(
            source,
            resolvedRootFlag === undefined ? undefined : { cleanseRootSlow: resolvedRootFlag === true }
          );
        }
        break;

      case "YOU_FENG_PIAO_ZONG": {
        const hadCleanseableControl = (source.buffs ?? []).some((buff: any) => {
          const effects = Array.isArray(buff?.effects) ? buff.effects : [];
          const hasRoot = effects.some((e: any) => e?.type === "ROOT");
          const hasControl = effects.some((e: any) => e?.type === "CONTROL");
          const hasAttackLock = effects.some((e: any) => e?.type === "ATTACK_LOCK");
          const isMoheKnockdown = buff?.buffId === 1002 && buff?.sourceAbilityId === "mohe_wuliang";
          const isNamedKnockdown = typeof buff?.name === "string" && buff.name.includes("倒地");
          return hasRoot || hasControl || hasAttackLock || isMoheKnockdown || isNamedKnockdown;
        });

        const capturedControls = captureAndCleanseControls(source, Date.now());
        (source as any)._youFengNoControlRemoved = !hadCleanseableControl;

        const immunityBuff = getAbilityBuffDefinition(ability, YOU_FENG_IMMUNITY_BUFF_ID);
        if (immunityBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: immunityBuff,
          });
        }

        if (capturedControls.length === 0) break;

        const reflectTarget = getExplicitEnemyPlayerTarget(
          state,
          source.userId,
          castContext?.targetUserId,
          castContext?.ignoreTargetAllegiance,
        );
        if (!reflectTarget) break;

        applyCapturedControlsToPlayerTarget({
          state,
          ability,
          source,
          target: reflectTarget,
          snapshots: capturedControls,
          buffIdsByKind: YOU_FENG_TARGET_BUFF_IDS,
          forcedDurationMs: 5_000,
        });
        break;
      }

      case "RU_YI_FA": {
        const capturedControls = captureAndCleanseControls(source, Date.now());
        const immunityBuff = getAbilityBuffDefinition(ability, RU_YI_IMMUNITY_BUFF_ID);
        if (immunityBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: immunityBuff,
          });
        }

        if (capturedControls.length === 0) break;

        const markerBuff = getAbilityBuffDefinition(ability, RU_YI_MARKER_BUFF_ID);
        if (!markerBuff) break;

        addBuff({
          state,
          sourceUserId: source.userId,
          targetUserId: source.userId,
          ability,
          buffTarget: source,
          buff: {
            ...markerBuff,
            recordedControls: capturedControls.map((snapshot) => ({ ...snapshot })),
          } as any,
        });
        break;
      }

      case "SHI_XIN_GU": {
        const selectedTarget =
          getExplicitPlayerTarget(state, castContext?.targetUserId) ??
          ((target?.hp ?? 0) > 0 ? target : null);
        if (!selectedTarget) break;
        if (abilityDodged && selectedTarget.userId !== source.userId) break;

        const mainBuff = getAbilityBuffDefinition(ability, SHI_XIN_GU_BUFF_ID);
        if (!mainBuff) break;

        const now = Date.now();
        const hasRecencyMarker = (selectedTarget.buffs ?? []).some(
          (buff: any) => buff.buffId === SHI_XIN_MARK_BUFF_ID && (buff.expiresAt ?? 0) > now
        );

        let durationMs = Number(mainBuff.durationMs ?? 6_000);
        if (selectedTarget.userId === source.userId) {
          durationMs *= 0.5;
        }
        if (hasRecencyMarker) {
          durationMs *= 0.5;
        }
        durationMs = Math.max(500, Math.round(durationMs));

        const forcedMovementMode = shouldShiXinGuForceStandstill(selectedTarget, mapCtx, now)
          ? "standstill"
          : Math.random() < 0.5
            ? "direction"
            : "standstill";
        const forcedMoveDirection =
          forcedMovementMode === "direction" ? getRandomUnitDirection() : undefined;

        addBuff({
          state,
          sourceUserId: source.userId,
          targetUserId: selectedTarget.userId,
          ability,
          buffTarget: selectedTarget,
          buff: {
            ...mainBuff,
            durationMs,
            forcedMovementMode,
            forcedMoveDirection,
          } as any,
        });

        const recencyBuff = getAbilityBuffDefinition(ability, SHI_XIN_MARK_BUFF_ID);
        if (recencyBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: selectedTarget.userId,
            ability,
            buffTarget: selectedTarget,
            buff: recencyBuff,
          });
        }
        break;
      }

      case "HONG_MENG_TIAN_JIN": {
        const selectedTarget =
          getExplicitPlayerTarget(state, castContext?.targetUserId) ??
          ((target?.hp ?? 0) > 0 ? target : null);
        if (!selectedTarget) break;

        if (selectedTarget.userId === source.userId) {
          cleanseDebuffsByAttributes({
            state,
            target: selectedTarget,
            attributes: HONG_MENG_CLEANSE_ATTRIBUTES,
            count: 2,
          });
        }

        const hasShuSe = (selectedTarget.buffs ?? []).some(
          (buff: any) => buff.buffId === SHU_SE_BUFF_ID && (buff.expiresAt ?? 0) > Date.now()
        );
        if (hasShuSe) break;

        const mainBuff = getAbilityBuffDefinition(ability, HONG_MENG_TIAN_JIN_BUFF_ID);
        if (!mainBuff) break;

        addBuff({
          state,
          sourceUserId: source.userId,
          targetUserId: selectedTarget.userId,
          ability,
          buffTarget: selectedTarget,
          buff: mainBuff,
        });
        break;
      }

      case "DASH":
        handleDash(state, source, effTarget, enemyApplied, ability, effect);
        break;

      case "DIRECTIONAL_DASH": {
        // Always targets self — the opponent (or explicit entity) position is used only for orientation
        const oppIdx = playerIndex === 0 ? 1 : 0;
        const oppPos = (explicitEntityTarget && enemyApplied)
          ? explicitEntityTarget.position
          : state.players[oppIdx].position;
        handleDirectionalDash(state, source, oppPos, ability, effect);
        break;
      }

      case "GROUND_TARGET_DASH": {
        // Compute direction from source to the explicit ground target.
        const gTargetX = castContext?.groundTarget?.x;
        const gTargetY = castContext?.groundTarget?.y;
        if (gTargetX === undefined || gTargetY === undefined) break;
        const gDx = gTargetX - source.position.x;
        const gDy = gTargetY - source.position.y;
        const gLen = Math.sqrt(gDx * gDx + gDy * gDy);
        if (gLen > 0.01) {
          source.facing = { x: gDx / gLen, y: gDy / gLen };
        }
        const clickDistGpu = worldUnitsToGameplayUnits(gLen, state.unitScale);
        const cappedValue = gLen > 0.01 ? clickDistGpu : 0;
        // Proportional durationTicks at 40 u/sec so short dashes aren't slowed down
        const cappedDurationTicks = Math.max(1, Math.round((cappedValue / 40) * 30));
        const gtdEffect = { ...effect, type: "DIRECTIONAL_DASH" as const, dirMode: "TOWARD" as const, value: cappedValue, durationTicks: cappedDurationTicks };
        handleDirectionalDash(state, source, { x: gTargetX, y: gTargetY }, ability, gtdEffect);
        // Height targeting: if groundTarget has an explicit Z, force dash to climb/descend to that height.
        const gTargetZ = castContext?.groundTarget?.z;
        if (gTargetZ !== undefined && source.activeDash) {
          const heightDiff = gTargetZ - (source.position.z ?? 0);
          if (Math.abs(heightDiff) > 0.1) {
            const vzForce = heightDiff / cappedDurationTicks;
            source.activeDash.forceVzPerTick = vzForce;
            // Relax angle caps so tall targets are always reachable
            if (vzForce > 0) source.activeDash.maxUpVz = Math.max(source.activeDash.maxUpVz, vzForce);
            if (vzForce < 0) source.activeDash.maxDownVz = Math.min(source.activeDash.maxDownVz, vzForce);
          }
        }
        break;
      }

      case "KNOCKBACK_DASH": {
        // Apply a forced dash to the target — pushing them away from the source.
        // Uses addBuff for proper status bar display, immunity checks, and 递减.
        const kbTarget = effTarget; // the opponent
        if (!kbTarget) break;
        const kdx = kbTarget.position.x - source.position.x;
        const kdy = kbTarget.position.y - source.position.y;
        const kdist = Math.sqrt(kdx * kdx + kdy * kdy);
        if (kdist < 0.001) break; // no direction to push

        // Check knockback immunity before committing (addBuff would also catch it,
        // but we need to know whether to set activeDash).
        if (hasKnockedBackImmune(kbTarget)) break;

        const kbDirX = kdx / kdist;
        const kbDirY = kdy / kdist;
        const kbDistance = gameplayUnitsToWorldUnits(effect.value ?? 12, state.unitScale);
        // durationTicks = movement ticks only (12u ÷ 20u/sec × 30tick/sec = 18 ticks)
        const moveTicks = effect.durationTicks ?? 18;

        // Clear any existing dash on the target and freeze velocity
        delete (kbTarget as any).activeDash;
        if ((kbTarget as any).velocity) {
          (kbTarget as any).velocity.vx = 0;
          (kbTarget as any).velocity.vy = 0;
        }

        (kbTarget as any).activeDash = {
          abilityId: ability.id,
          vxPerTick: kbDirX * kbDistance / moveTicks,
          vyPerTick: kbDirY * kbDistance / moveTicks,
          forceVzPerTick: 0,
          maxUpVz: 0,
          maxDownVz: 0,
          ticksRemaining: moveTicks,
          wallStunMs: effect.wallStunMs ?? 0,
          vzPerTick: 0,  // suppress vz capture on first tick
        };

        // Store caster userId so GameLoop can find it when applying the wall stun
        (kbTarget as any)._wallKnockSourceUserId = source.userId;

        // Apply KNOCKED_BACK debuff via official addBuff (shows in status bar, triggers events)
        // Duration 1000ms so target is locked for a full second even after movement ends
        addBuff({
          state,
          sourceUserId: source.userId,
          targetUserId: kbTarget.userId,
          ability,
          buffTarget: kbTarget,
          buff: buildStandardKnockbackBuff(1_000),
        });
        break;
      }

      case "HUN_YA_NU_TAO": {
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 6, state.unitScale);
        const kbDistance = gameplayUnitsToWorldUnits(effect.value ?? 6, state.unitScale);
        const moveTicks = Math.max(1, Number(effect.durationTicks ?? 15));
        const fallbackFacing = getSourceFacingUnit(source);

        for (const candidate of getImmediateEnemyBuffTargets(state, source.userId, source.position, radius)) {
          if (candidate.kind !== "player") continue;
          const kbTarget = candidate.target as any;
          if (!kbTarget || hasKnockedBackImmune(kbTarget)) continue;
          const kdx = kbTarget.position.x - source.position.x;
          const kdy = kbTarget.position.y - source.position.y;
          const kdist = Math.sqrt(kdx * kdx + kdy * kdy);
          const kbDirX = kdist > 0.001 ? kdx / kdist : fallbackFacing.x;
          const kbDirY = kdist > 0.001 ? kdy / kdist : fallbackFacing.y;

          delete kbTarget.activeDash;
          if (kbTarget.velocity) {
            kbTarget.velocity.vx = 0;
            kbTarget.velocity.vy = 0;
          }

          kbTarget.activeDash = {
            abilityId: ability.id,
            vxPerTick: (kbDirX * kbDistance) / moveTicks,
            vyPerTick: (kbDirY * kbDistance) / moveTicks,
            forceVzPerTick: 0,
            maxUpVz: 0,
            maxDownVz: 0,
            ticksRemaining: moveTicks,
            vzPerTick: 0,
          };
          kbTarget._hunYaNuTaoSourceUserId = source.userId;
          if (kbTarget.activeChannel) {
            kbTarget.activeChannel = undefined;
          }
        }
        break;
      }

      case "WUJIAN_CHANNEL":
      case "XINZHENG_CHANNEL":
        handleChannelEffect(state, source, enemy, ability, effect);
        break;

      case "BAIZU_AOE": {
        const now = Date.now();
        const center = castContext?.groundTarget
          ? { x: castContext.groundTarget.x, y: castContext.groundTarget.y, z: castContext.groundTarget.z ?? source.position?.z ?? 0 }
          : (explicitEntityTarget
            ? { x: explicitEntityTarget.position.x, y: explicitEntityTarget.position.y, z: explicitEntityTarget.position.z ?? 0 }
            : { x: target.position.x, y: target.position.y, z: target.position.z ?? 0 });
        const storedUnitScale = state.unitScale;
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 6, storedUnitScale);
        const baizuBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.name === "百足")
          : null;

        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: center.x,
          y: center.y,
          z: center.z ?? 0,
          height: radius,
          radius,
          expiresAt: now + 500,
          damagePerInterval: 0,
          intervalMs: 1_000,
          lastTickAt: now,
          abilityId: "baizu_marker",
          abilityName: "百足",
          maxTargets: 0,
        });

        for (const victim of getImmediateEnemyDamageTargets(state, source.userId, center, radius)) {
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: victim,
            baseDamage: effect.value ?? 0,
            effectType: "DAMAGE",
            now,
          });

          if (baizuBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.target.userId,
              ability,
              buffTarget: victim.target,
              buff: baizuBuff,
            });
          }
        }
        break;
      }

      case "WUFANG_XINGJIN_AOE": {
        const now = Date.now();
        const center = castContext?.groundTarget
          ? { x: castContext.groundTarget.x, y: castContext.groundTarget.y, z: castContext.groundTarget.z ?? source.position?.z ?? 0 }
          : (explicitEntityTarget
            ? { x: explicitEntityTarget.position.x, y: explicitEntityTarget.position.y, z: explicitEntityTarget.position.z ?? 0 }
            : { x: target.position.x, y: target.position.y, z: target.position.z ?? 0 });
        const storedUnitScale = state.unitScale;
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 6, storedUnitScale);
        const rootBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) =>
              b.buffId === WUFANG_ROOT_BUFF_ID ||
              (Array.isArray(b.effects) && b.effects.some((e: any) => e.type === "ROOT"))
            )
          : null;
        const protectBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === WUFANG_HIT_PROTECT_BUFF_ID)
          : null;
        const huishenBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === WUFANG_HUISHEN_BUFF_ID)
          : null;
        let hitAtLeastOneEnemy = false;

        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: center.x,
          y: center.y,
          z: center.z ?? 0,
          height: radius,
          radius,
          expiresAt: now + 500,
          damagePerInterval: 0,
          intervalMs: 1_000,
          lastTickAt: now,
          abilityId: "wufang_xingjin_marker",
          abilityName: ability.name,
          maxTargets: 0,
        });

        for (const victim of getImmediateEnemyDamageTargets(state, source.userId, center, radius)) {
          hitAtLeastOneEnemy = true;
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: victim,
            baseDamage: effect.value ?? 0,
            effectType: "DAMAGE",
            now,
          });
          if (rootBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.target.userId,
              ability,
              buffTarget: victim.target,
              buff: rootBuff,
            });

            const appliedRoot = victim.target.buffs.find(
              (b: any) =>
                b.buffId === WUFANG_ROOT_BUFF_ID &&
                b.expiresAt > now &&
                (b.appliedAt ?? 0) >= now - 250
            );
            if (appliedRoot) {
              const appliedRootDurationMs = Math.max(
                1,
                appliedRoot.expiresAt - (appliedRoot.appliedAt ?? now)
              );
              const protectDurationMs = Math.max(
                1,
                Math.round(appliedRootDurationMs * WUFANG_HIT_PROTECT_RATIO)
              );

              addBuff({
                state,
                sourceUserId: source.userId,
                targetUserId: victim.target.userId,
                ability,
                buffTarget: victim.target,
                buff: protectBuff
                  ? { ...protectBuff, durationMs: protectDurationMs }
                  : {
                      buffId: WUFANG_HIT_PROTECT_BUFF_ID,
                      name: "被击不会解除五方锁足",
                      category: "DEBUFF",
                      durationMs: protectDurationMs,
                      description: "存在期间，五方行尽锁足不会因受击解除",
                      effects: [],
                    },
              });
            }
          }
        }

        if (hitAtLeastOneEnemy && huishenBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: huishenBuff,
          });
        }
        break;
      }

      case "BANG_DA_GOU_TOU": {
        const now = Date.now();
        const reachDamage = Math.max(0, Number(effect.value ?? 10));
        const victim = effTarget;
        if (!victim || victim.userId === source.userId || (victim.hp ?? 0) <= 0) break;
        if (blocksEnemyTargeting(victim)) break;

        const bangDaRootBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === BANG_DA_GOU_TOU_ROOT_BUFF_ID)
          : null;
        const bangDaControlBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === BANG_DA_GOU_TOU_CONTROL_BUFF_ID)
          : null;
        const xinchuYiBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID)
          : null;
        const xinchuErBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID)
          : null;

        const hasXinchuYi = victim.buffs.some(
          (b: any) => b.buffId === BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID && b.expiresAt > now
        );

        if (hasXinchuYi) {
          const removedXinchuYi = victim.buffs.filter(
            (b: any) => b.buffId === BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID
          );
          if (removedXinchuYi.length > 0) {
            victim.buffs = victim.buffs.filter(
              (b: any) => b.buffId !== BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID
            );
            for (const removed of removedXinchuYi) {
              pushBuffExpired(state, {
                targetUserId: victim.userId,
                buffId: removed.buffId,
                buffName: removed.name,
                buffCategory: removed.category,
                sourceAbilityId: removed.sourceAbilityId,
                sourceAbilityName: removed.sourceAbilityName,
              });
            }
          }

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: victim.userId,
            ability,
            buffTarget: victim,
            buff: bangDaControlBuff ?? {
              buffId: BANG_DA_GOU_TOU_CONTROL_BUFF_ID,
              name: "棒打狗头·定身",
              category: "DEBUFF",
              durationMs: 2_000,
              description: "定身：无法移动、跳跃和施放技能",
              effects: [{ type: "CONTROL" }],
            },
          });

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: victim.userId,
            ability,
            buffTarget: victim,
            buff: xinchuErBuff ?? {
              buffId: BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID,
              name: "心怵·二",
              category: "DEBUFF",
              durationMs: 6_000,
              description: "受到伤害增加6%",
              effects: [{ type: "DAMAGE_TAKEN_INCREASE", value: 0.06 }],
            },
          });
        } else {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: victim.userId,
            ability,
            buffTarget: victim,
            buff: bangDaRootBuff ?? {
              buffId: BANG_DA_GOU_TOU_ROOT_BUFF_ID,
              name: "棒打狗头·锁足",
              category: "DEBUFF",
              durationMs: 2_000,
              description: "锁足：无法移动和转向",
              effects: [{ type: "ROOT" }],
            },
          });

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: victim.userId,
            ability,
            buffTarget: victim,
            buff: xinchuYiBuff ?? {
              buffId: BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID,
              name: "心怵·一",
              category: "DEBUFF",
              durationMs: 6_000,
              description: "受到伤害增加6%",
              effects: [{ type: "DAMAGE_TAKEN_INCREASE", value: 0.06 }],
            },
          });
        }

        handleDash(
          state,
          source,
          victim,
          true,
          ability,
          { type: "DASH", value: ability.range ?? 20 }
        );

        if (source.activeDash && source.activeDash.abilityId === ability.id) {
          source.activeDash.hitTargetUserId = victim.userId;
          source.activeDash.hitDamageOnComplete = reachDamage;
          source.activeDash.hitEffectTypeOnComplete = "DAMAGE";
        } else if (!hasDamageImmune(victim as any)) {
          const dmg = resolveScheduledDamage({
            source,
            target: victim,
            base: reachDamage,
            abilityId: ability.id,
            damageType: (ability as any).damageType,
          });
          if (dmg > 0) {
            const { adjustedDamage: adjBg, redirectPlayer: rtBg, redirectAmt: raBg } = preCheckRedirect(state, victim as any, dmg);
            const applyBg = adjBg;
            const resultBg = applyBg > 0
              ? applyDamageToTarget(victim as any, applyBg)
              : { hpDamage: 0, shieldAbsorbed: 0 };
            state.events.push({
              id: randomUUID(),
              timestamp: now,
              turn: state.turn,
              type: "DAMAGE",
              actorUserId: source.userId,
              targetUserId: victim.userId,
              abilityId: ability.id,
              abilityName: ability.name,
              effectType: "DAMAGE",
              value: applyBg,
              shieldAbsorbed: (resultBg.shieldAbsorbed ?? 0) > 0 ? resultBg.shieldAbsorbed : undefined,
            });
            if (resultBg.hpDamage > 0 || resultBg.shieldAbsorbed > 0) {
              processOnDamageTaken(state, victim as any, resultBg.hpDamage, source.userId, resultBg.shieldAbsorbed);
            }
            if (rtBg && raBg > 0) {
              applyRedirectToOpponent(state, rtBg, raBg);
            }
          }
        }

        break;
      }

      case "PLACE_GROUND_ZONE": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const facing = source.facing ?? { x: 0, y: 1 };
        const zoneOffset = gameplayUnitsToWorldUnits(effect.zoneOffsetUnits ?? 6, storedUnitScale);
        const center = castContext?.groundTarget
          ? { x: castContext.groundTarget.x, y: castContext.groundTarget.y }
          : {
              x: (source.position?.x ?? 0) + facing.x * zoneOffset,
              y: (source.position?.y ?? 0) + facing.y * zoneOffset,
            };
        const zoneZ = getGroundHeightForMap(center.x, center.y, source.position?.z ?? 0, mapCtx);
        const zoneRadius = gameplayUnitsToWorldUnits(effect.range ?? 8, storedUnitScale);
        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: center.x,
          y: center.y,
          z: zoneZ,
          height: zoneRadius,
          radius: zoneRadius,
          expiresAt: now + (effect.zoneDurationMs ?? 6_000),
          damagePerInterval: effect.value ?? 4,
          intervalMs: effect.zoneIntervalMs ?? 500,
          lastTickAt: now,
          abilityId: ability.id,
          abilityName: ability.name,
          maxTargets: effect.maxTargets,
        });

        if (ability.id === ZHEN_SHAN_HE_ABILITY_ID) {
          applyZhenShanHeSelfCastBuff({
            state,
            ability,
            target: source,
            sourceUserId: source.userId,
            now,
          });
          pulseZhenShanHeTarget({
            state,
            ability,
            target: source,
            sourceUserId: source.userId,
            now,
          });
        }
        break;
      }

              case "PLACE_XI_BING_YU_ZONE": {
                const now = Date.now();
                const storedUnitScale = state.unitScale;
                const zoneTarget = explicitEntityTarget ?? target;
                const offsetDistance = gameplayUnitsToWorldUnits(effect.zoneOffsetUnits ?? 6, storedUnitScale);
                const randomAngle = Math.random() * Math.PI * 2;
                const center = {
                  x: zoneTarget.position.x + Math.cos(randomAngle) * offsetDistance,
                  y: zoneTarget.position.y + Math.sin(randomAngle) * offsetDistance,
                };
                const zoneZ = getGroundHeightForMap(center.x, center.y, zoneTarget.position?.z ?? source.position?.z ?? 0, mapCtx);
                const zoneRadius = gameplayUnitsToWorldUnits(effect.range ?? 1, storedUnitScale);

                if (!state.groundZones) state.groundZones = [];
                state.groundZones.push({
                  id: randomUUID(),
                  ownerUserId: source.userId,
                  x: center.x,
                  y: center.y,
                  z: zoneZ,
                  height: zoneRadius,
                  radius: zoneRadius,
                  expiresAt: now + (effect.zoneDurationMs ?? 5_000),
                  damagePerInterval: 0,
                  intervalMs: 1_000,
                  lastTickAt: now,
                  abilityId: ability.id,
                  abilityName: ability.name,
                  pickupTargetUserId: zoneTarget.userId,
                } as any);

                break;
              }

      case "AOE_APPLY_BUFFS": {
        if (!Array.isArray(ability.buffs) || ability.buffs.length === 0) break;
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 10, state.unitScale);
        for (const victim of getImmediateEnemyBuffTargets(state, source.userId, source.position, radius)) {
          for (const buffDef of ability.buffs) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.target.userId,
              ability,
              buffTarget: victim.target,
              buff: buffDef,
            });
          }
        }
        break;
      }

      case "XIA_LIU_BAO_SHI_AOE": {
        const now = Date.now();
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 6, state.unitScale);
        const attrs: string[] = (effect as any).attributes ?? ["阳性", "混元", "阴性", "毒性"];
        const dispelCount: number = (effect as any).count ?? 1;
        const { overrides: buffOverrides } = loadBuffEditorOverrides();
        const disarmBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === 2723 || b.name === "霞流宝石")
          : null;

        for (const victim of getImmediateEnemyDamageTargets(state, source.userId, source.position, radius)) {
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: victim,
            baseDamage: effect.value ?? 0,
            effectType: "DAMAGE",
            now,
          });

          dispelBuffAttributesFromTarget({
            state,
            target: victim.target,
            attributes: attrs,
            count: dispelCount,
            buffOverrides,
          });

          if (disarmBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.target.userId,
              ability,
              buffTarget: victim.target,
              buff: disarmBuff,
            });
          }
        }
        break;
      }

      case "HAN_RU_LEI_AOE": {
        const abilityBuffs = Array.isArray(ability.buffs) ? ability.buffs : [];
        const selfBuffs = abilityBuffs.filter((buffDef: any) => buffDef.applyTo !== "OPPONENT");
        const enemyBuffs = abilityBuffs.filter((buffDef: any) => buffDef.applyTo === "OPPONENT");

        for (const buffDef of selfBuffs) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source as any,
            buff: buffDef,
          });
        }

        const radius = gameplayUnitsToWorldUnits(effect.range ?? 15, state.unitScale);
        for (const victim of getImmediateEnemyBuffTargets(state, source.userId, source.position, radius)) {
          if (victim.kind !== "player") continue;
          removeImmediateStealthBuffs(state, victim.target);
          for (const buffDef of enemyBuffs) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.target.userId,
              ability,
              buffTarget: victim.target,
              buff: buffDef,
            });
          }
        }
        break;
      }

      case "DISPEL_BUFF_ATTRIBUTE": {
        // Remove BUFF-category buffs per listed attribute from the target.
        // count (default 1) controls how many per attribute to remove.
        // Respects dodge via the shouldSkipDueToDodge check above (which runs before switch).
        if (!enemyApplied) break;
        const dispelTarget = getDunLiReflectVictim(state, source.userId, effTarget as any, ability) ?? effTarget;
        const { overrides: buffOverrides } = loadBuffEditorOverrides();
        const attrs: string[] = (effect as any).attributes ?? [];
        const dispelCount: number = (effect as any).count ?? 1;
        dispelBuffAttributesFromTarget({
          state,
          target: dispelTarget,
          attributes: attrs,
          count: dispelCount,
          buffOverrides,
        });
        break;
      }

      case "CLEANSE_DEBUFF_ATTRIBUTE": {
        // Remove DEBUFF-category buffs from self/friendly by attribute.
        // count (default 1) controls how many per attribute to remove.
        const { overrides: cleanseBOvr } = loadBuffEditorOverrides();
        const cleanseAttrs: string[] = (effect as any).attributes ?? [];
        const removeCount: number = (effect as any).count ?? 1;
        for (const attr of cleanseAttrs) {
          let removed = 0;
          while (removed < removeCount) {
            const idx = effTarget.buffs.findIndex((b: any) => {
              if (b.category !== "DEBUFF") return false;
              const entry = cleanseBOvr[String(b.buffId)];
              return entry?.attribute === attr;
            });
            if (idx === -1) break;
            const removedBuff = effTarget.buffs[idx];
            removeLinkedShield(effTarget as any, removedBuff);
            effTarget.buffs.splice(idx, 1);
            pushBuffExpired(state, {
              targetUserId: effTarget.userId,
              buffId: removedBuff.buffId,
              buffName: removedBuff.name,
              buffCategory: removedBuff.category,
              sourceAbilityId: removedBuff.sourceAbilityId,
              sourceAbilityName: removedBuff.sourceAbilityName,
            });
            removed++;
          }
        }
        break;
      }

      case "REMOVE_SELF_BUFFS": {
        const removeIds = new Set((effect as any).buffIds ?? []);
        if (removeIds.size === 0) break;

        if (removeIds.has(SAND_DISGUISE_BUFF_ID)) {
          removeIds.delete(SAND_DISGUISE_BUFF_ID);
          removeDisguiseBuffs(state, source as any, Date.now());
        }

        source.buffs = source.buffs.filter((buff: any) => {
          if (!removeIds.has(buff.buffId)) return true;
          removeLinkedShield(source as any, buff);
          pushBuffExpired(state, {
            targetUserId: source.userId,
            buffId: buff.buffId,
            buffName: buff.name,
            buffCategory: buff.category,
            sourceAbilityId: buff.sourceAbilityId,
            sourceAbilityName: buff.sourceAbilityName,
          });
          return false;
        });
        break;
      }

      case "SETTLE_SOURCE_DOTS": {
        // Immediately settle remaining periodic-damage from own debuffs on the target.
        // For each matching active DEBUFF with PERIODIC_DAMAGE on effTarget:
        //   damage = remaining_ticks * damage_per_tick, then remove the buff.
        if (!enemyApplied) break;
        const settleSrcIds: string[] = (effect as any).sourceAbilityIds ?? [];
        const settleNow = Date.now();
        const buffsToSettle = effTarget.buffs.filter((b: any) =>
          b.category === "DEBUFF" &&
          b.sourceUserId === source.userId &&
          settleSrcIds.includes(b.sourceAbilityId ?? "") &&
          b.periodicMs !== undefined &&
          b.effects?.some((e: any) => e.type === "PERIODIC_DAMAGE")
        );
        for (const settleBuff of buffsToSettle) {
          const remainingMs = Math.max(0, settleBuff.expiresAt - settleNow);
          const remainingTicks = Math.max(0, Math.ceil(remainingMs / settleBuff.periodicMs));
          const dmgPerTick = settleBuff.effects.find((e: any) => e.type === "PERIODIC_DAMAGE")?.value ?? 0;
          const totalDmg = remainingTicks * dmgPerTick;
          // Remove the buff first
          const idx = effTarget.buffs.indexOf(settleBuff);
          if (idx !== -1) effTarget.buffs.splice(idx, 1);
          pushBuffExpired(state, {
            targetUserId: effTarget.userId,
            buffId: settleBuff.buffId,
            buffName: settleBuff.name,
            buffCategory: settleBuff.category,
            sourceAbilityId: settleBuff.sourceAbilityId,
            sourceAbilityName: settleBuff.sourceAbilityName,
          });
          // Deal the remaining damage as a single hit, attributed to the source DoT ability
          if (totalDmg > 0 && !hasDamageImmune(effTarget as any)) {
            const settDmg = resolveScheduledDamage({ source, target: effTarget, base: totalDmg, abilityId: ability.id, damageType: (ability as any).damageType });
            if (settDmg > 0) {
              const { adjustedDamage: adjSett, redirectPlayer: rtSett, redirectAmt: raSett } = preCheckRedirect(state, effTarget as any, settDmg);
              const applySett = adjSett;
              const resultSett = applySett > 0
                ? applyDamageToTarget(effTarget as any, applySett)
                : { hpDamage: 0, shieldAbsorbed: 0 };
              state.events.push({
                id: randomUUID(),
                timestamp: settleNow,
                turn: state.turn,
                type: "DAMAGE",
                actorUserId: source.userId,
                targetUserId: effTarget.userId,
                abilityId: settleBuff.sourceAbilityId ?? ability.id,
                abilityName: settleBuff.sourceAbilityName ?? settleBuff.name,
                effectType: "SETTLE_DOT",
                value: applySett,
                shieldAbsorbed: (resultSett.shieldAbsorbed ?? 0) > 0 ? resultSett.shieldAbsorbed : undefined,
              });
              if (resultSett.hpDamage > 0 || resultSett.shieldAbsorbed > 0) {
                processOnDamageTaken(state, effTarget as any, resultSett.hpDamage, source.userId, resultSett.shieldAbsorbed);
              }
              if (rtSett && raSett > 0) {
                applyRedirectToOpponent(state, rtSett, raSett);
              }
            }
          }
        }
        break;
      }

      case "APPLY_SLOT_DOTS": {
        // Apply DoT debuffs from the caster's equipped ability slots.
        if (!enemyApplied) break;
        const slotIds: string[] = (effect as any).slotAbilityIds ?? [];
        const sourceHand: any[] = (source as any).hand ?? [];
        for (const slotAbilityId of slotIds) {
          const hasInSlot = sourceHand.some(
            (inst: any) => (inst.abilityId || inst.id) === slotAbilityId
          );
          if (!hasInSlot) continue;
          const slotAbility = (ABILITIES as any)[slotAbilityId] as any;
          if (!slotAbility?.buffs?.length) continue;
          const dotBuff = slotAbility.buffs.find((b: any) =>
            b.effects?.some((e: any) => e.type === "PERIODIC_DAMAGE")
          );
          if (!dotBuff) continue;
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: effTarget.userId,
            ability: slotAbility,
            buffTarget: effTarget,
            buff: dotBuff,
          });
        }
        break;
      }

      case "SAN_CAI_HUA_SHENG_AOE": {
        // Self-centered AoE ROOT: up to maxTargets (6) enemies within range (8 units)
        const now = Date.now();
        const center = source.position;
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 8, state.unitScale);
        const rootBuffDef = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === SAN_CAI_ROOT_BUFF_ID)
          : null;
        const protectBuffDef = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === SAN_CAI_PROTECT_BUFF_ID)
          : null;

        const nearby: Array<{ victim: ImmediateEnemyDamageTarget; dist: number }> = [];
        for (const victim of getImmediateEnemyBuffTargets(state, source.userId, center, radius)) {
          nearby.push({
            victim,
            dist: getImmediateEnemyStatusTargetDistance(center, victim),
          });
        }
        nearby.sort((a, b) => a.dist - b.dist);
        const maxT = effect.maxTargets ?? 6;
        const targets = nearby.slice(0, maxT).map((x) => x.victim.target);

        for (const victim of targets) {
          if (!rootBuffDef) continue;
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: victim.userId,
            ability,
            buffTarget: victim,
            buff: rootBuffDef,
          });

          const appliedRoot = victim.buffs.find(
            (b: any) =>
              b.buffId === SAN_CAI_ROOT_BUFF_ID &&
              b.expiresAt > now &&
              (b.appliedAt ?? 0) >= now - 250
          );
          if (appliedRoot && protectBuffDef) {
            const appliedDurationMs = Math.max(1, appliedRoot.expiresAt - (appliedRoot.appliedAt ?? now));
            const protectDurationMs = Math.round(appliedDurationMs * SAN_CAI_HIT_PROTECT_RATIO);
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.userId,
              ability,
              buffTarget: victim,
              buff: { ...protectBuffDef, durationMs: protectDurationMs },
            });
          }
        }
        break;
      }

      case "YIN_YUE_ZHAN": {
        // 银月斩: deal damage + apply DoT. If target has 烈日斩, all damage doubled.
        if (!enemyApplied) break;
        const now = Date.now();
        const hasLieRi = effTarget.buffs.some((b: any) => isRuntimeBuffActive(b, now) && b.buffId === LIE_RI_ZHAN_DEBUFF_ID);
        const mult = hasLieRi ? 2 : 1;

        const baseDmg = (effect.value ?? 2) * mult;
        const yyzDmg = resolveScheduledDamage({ source, target: effTarget, base: baseDmg, abilityId: ability.id, damageType: (ability as any).damageType });
        if (yyzDmg > 0) {
          const { adjustedDamage: adjYyz, redirectPlayer: rtYyz, redirectAmt: raYyz } = preCheckRedirect(state, effTarget as any, yyzDmg);
          const applyYyz = adjYyz;
          const resultYyz = applyYyz > 0
            ? applyDamageToTarget(effTarget as any, applyYyz)
            : { hpDamage: 0, shieldAbsorbed: 0 };
          state.events.push({
            id: randomUUID(), timestamp: now, turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "DAMAGE",
            value: applyYyz,
            shieldAbsorbed: (resultYyz.shieldAbsorbed ?? 0) > 0 ? resultYyz.shieldAbsorbed : undefined,
          });
          if (resultYyz.hpDamage > 0 || resultYyz.shieldAbsorbed > 0) {
            processOnDamageTaken(state, effTarget as any, resultYyz.hpDamage, source.userId, resultYyz.shieldAbsorbed);
          }
          if (rtYyz && raYyz > 0) {
            applyRedirectToOpponent(state, rtYyz, raYyz);
          }
        }
        const dotBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === YIN_YUE_ZAN_DOT_BUFF_ID)
          : null;
        if (dotBuff) {
          const effectiveDot = hasLieRi
            ? {
                ...dotBuff,
                effects: (dotBuff.effects as any[]).map((e: any) =>
                  e.type === "PERIODIC_DAMAGE" ? { ...e, value: (e.value ?? 0) * 2 } : e
                ),
              }
            : dotBuff;
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: effTarget.userId,
            ability,
            buffTarget: effTarget,
            buff: effectiveDot,
          });
        }
        break;
      }

      case "LIE_RI_ZHAN": {
        // 烈日斩: deal damage + apply 15% extra damage debuff. If target has 银月斩, damage doubled.
        if (!enemyApplied) break;
        const now = Date.now();
        const hasYinYue = effTarget.buffs.some((b: any) => isRuntimeBuffActive(b, now) && b.buffId === YIN_YUE_ZAN_DOT_BUFF_ID);
        const mult = hasYinYue ? 2 : 1;

        const baseDmg = (effect.value ?? 4) * mult;
        const lrzDmg = resolveScheduledDamage({ source, target: effTarget, base: baseDmg, abilityId: ability.id, damageType: (ability as any).damageType });
        if (lrzDmg > 0) {
          const { adjustedDamage: adjLrz, redirectPlayer: rtLrz, redirectAmt: raLrz } = preCheckRedirect(state, effTarget as any, lrzDmg);
          const applyLrz = adjLrz;
          const resultLrz = applyLrz > 0
            ? applyDamageToTarget(effTarget as any, applyLrz)
            : { hpDamage: 0, shieldAbsorbed: 0 };
          state.events.push({
            id: randomUUID(), timestamp: now, turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "DAMAGE",
            value: applyLrz,
            shieldAbsorbed: (resultLrz.shieldAbsorbed ?? 0) > 0 ? resultLrz.shieldAbsorbed : undefined,
          });
          if (resultLrz.hpDamage > 0 || resultLrz.shieldAbsorbed > 0) {
            processOnDamageTaken(state, effTarget as any, resultLrz.hpDamage, source.userId, resultLrz.shieldAbsorbed);
          }
          if (rtLrz && raLrz > 0) {
            applyRedirectToOpponent(state, rtLrz, raLrz);
          }
        }
        const debuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === LIE_RI_ZHAN_DEBUFF_ID)
          : null;
        if (debuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: effTarget.userId,
            ability,
            buffTarget: effTarget,
            buff: debuff,
          });
        }
        break;
      }

      case "HENG_SAO_LIU_HE_AOE": {
        // 横扫六合: AoE 5 units sphere. Deal 2 damage each. If only 1 enemy hit, initial damage doubled (4).
        if (!enemyApplied) break;
        const now = Date.now();
        const center = source.position;
        const radius = gameplayUnitsToWorldUnits(effect.range ?? 5, state.unitScale);
        const dotBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === HENG_SAO_DOT_BUFF_ID)
          : null;

        const victims = getImmediateEnemyDamageTargets(state, source.userId, center, radius);

        const singleHitBonus = victims.length === 1;

        for (const victim of victims) {
          const baseDmg = singleHitBonus ? (effect.value ?? 2) * 2 : (effect.value ?? 2);
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: victim,
            baseDamage: baseDmg,
            effectType: "DAMAGE",
            now,
          });

          if (dotBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.target.userId,
              ability,
              buffTarget: victim.target,
              buff: dotBuff,
            });
          }
        }
        break;
      }

      // ─── 极乐引: AOE pull all enemies within range toward caster using activeDash ───────
      case "JILE_YIN_AOE_PULL": {
        const jileRange = gameplayUnitsToWorldUnits(effect.value ?? 10, state.unitScale);
        const jileStunBuffDef = ability.buffs?.find((b: any) => b.buffId === 2608);
        // Pull speed: 20 gameplay units/sec (same as DASH)
        const PULL_SPEED_WORLD_PER_TICK = gameplayUnitsToWorldUnits(20, state.unitScale) / 30;
        const STOP_DISTANCE = gameplayUnitsToWorldUnits(1, state.unitScale);
        for (const candidate of getImmediateEnemyBuffTargets(state, source.userId, source.position, jileRange)) {
          const target = candidate.target as any;
          const jileReflectVictim = candidate.kind === "player"
            ? getDunLiReflectVictim(state, source.userId, target, ability)
            : null;
          const pullSource = jileReflectVictim ? target : source;
          const pullTarget = jileReflectVictim ?? target;
          const cdx = pullTarget.position.x - pullSource.position.x;
          const cdy = pullTarget.position.y - pullSource.position.y;
          const cdist = Math.hypot(cdx, cdy);
          if (cdist <= STOP_DISTANCE) continue; // already close enough
          // Check knockback immunity (pull = forced movement)
          if (hasKnockbackImmune(pullTarget as any)) continue;
          const dirX = cdx / cdist;
          const dirY = cdy / cdist;
          // Pull toward caster: velocity is negative of direction (toward caster)
          const travelDist = cdist - STOP_DISTANCE;
          const ticksNeeded = Math.max(1, Math.ceil(travelDist / PULL_SPEED_WORLD_PER_TICK));
          const durationMs = Math.ceil(ticksNeeded * (1000 / 30));
          if (candidate.kind === "player" || jileReflectVictim) {
            // Set activeDash on the target flying toward the pull source.
            pullTarget.activeDash = {
              abilityId: "ji_le_yin",
              vxPerTick: -dirX * PULL_SPEED_WORLD_PER_TICK,
              vyPerTick: -dirY * PULL_SPEED_WORLD_PER_TICK,
              ticksRemaining: ticksNeeded,
            } as any;
          } else if (candidate.kind === "entity") {
            // Entities use their own simple activeDash (no input/jump/collision).
            pullTarget.activeDash = {
              abilityId: "ji_le_yin",
              vxPerTick: -dirX * PULL_SPEED_WORLD_PER_TICK,
              vyPerTick: -dirY * PULL_SPEED_WORLD_PER_TICK,
              ticksRemaining: ticksNeeded,
            };
          }
          // Apply stun immediately — it will still be active after pull ends
          if (jileStunBuffDef) {
            addBuff({
              state,
              sourceUserId: pullSource.userId,
              targetUserId: pullTarget.userId,
              ability,
              buffTarget: pullTarget,
              buff: jileStunBuffDef,
            });
          }
          if (candidate.kind === "player" || jileReflectVictim) {
            applyPlayerPullDashRuntimeBuff({
              state,
              ability,
              target: pullTarget,
              durationMs,
            });
          }
        }
        break;
      }

      // ─── 沧月: 1 dmg + 2s knockdown on primary, knock back others within 6u ───
      case "CANG_YUE_AOE": {
        const now = Date.now();
        const primary = explicitEntityTarget && enemyApplied ? explicitEntityTarget : effTarget;
        if (!primary || primary.userId === source.userId || (primary.hp ?? 0) <= 0) break;
        if (blocksEnemyTargeting(primary)) break;

        // 1) Primary damage (1)
        applyImmediateDamageToEnemyTarget({
          state,
          source,
          ability,
          target: isImmediateEntityTarget(primary)
            ? { kind: "entity", target: primary }
            : { kind: "player", target: primary },
          baseDamage: 1,
          effectType: "DAMAGE",
          now,
        });

        // 2) Knockdown on primary (CONTROL 2s) — uses official addBuff for 递减/immunity
        const knockdownBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === 1340)
          : null;
        if (knockdownBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: primary.userId,
            ability,
            buffTarget: primary,
            buff: knockdownBuff,
          });
        }

        // 3) AOE knockback on OTHER enemies within 6u of primary
        const storedUnitScale = state.unitScale;
        const aoeRadius = gameplayUnitsToWorldUnits(Math.max(0, Number(effect.range ?? 6)), storedUnitScale);
        const kbDistance = gameplayUnitsToWorldUnits(Math.max(0, Number(effect.value ?? 30)), storedUnitScale);
        const kbTicks = Math.max(1, Number(effect.durationTicks ?? 30));
        const center = { x: primary.position.x, y: primary.position.y, z: primary.position.z ?? 0 };
        for (const candidate of getImmediateEnemyBuffTargets(state, source.userId, center, aoeRadius)) {
          const t: any = candidate.target;
          if (t === primary) continue; // exclude primary
          if (hasKnockedBackImmune(t)) continue;
          // Knockback direction = caster -> victim (away from caster).
          // Entity dash now uses the velocity-free collision helper, so
          // this no longer crashes the loop.
          const dx = t.position.x - source.position.x;
          const dy = t.position.y - source.position.y;
          let dist = Math.hypot(dx, dy);
          let dirX: number;
          let dirY: number;
          if (dist < 0.0001) {
            // Victim is on top of caster — fall back to caster facing
            const fx = source.facing?.x ?? 0;
            const fy = source.facing?.y ?? 1;
            const flen = Math.hypot(fx, fy);
            dirX = flen > 0.0001 ? fx / flen : 1;
            dirY = flen > 0.0001 ? fy / flen : 0;
          } else {
            dirX = dx / dist;
            dirY = dy / dist;
          }

          // Clear any existing dash + freeze velocity (players only; entities have no velocity)
          delete (t as any).activeDash;
          if ((t as any).velocity) {
            (t as any).velocity.vx = 0;
            (t as any).velocity.vy = 0;
          }
          (t as any).activeDash = {
            abilityId: ability.id,
            vxPerTick: (dirX * kbDistance) / kbTicks,
            vyPerTick: (dirY * kbDistance) / kbTicks,
            forceVzPerTick: 0,
            maxUpVz: 0,
            maxDownVz: 0,
            ticksRemaining: kbTicks,
            vzPerTick: 0,
          };

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: t.userId,
            ability,
            buffTarget: t,
            buff: buildStandardKnockbackBuff(Math.max(1_000, Math.ceil((kbTicks * 1000) / 30))),
          });
        }
        break;
      }

      // ─── 拿云式: true damage that ignores DR/shield/dodge but is blocked
      // by INVULNERABLE/UNTARGETABLE/DAMAGE_IMMUNE. ─────────────────────────
      case "TRUE_DAMAGE": {
        const tdTarget = effTarget;
        const isSelfDamage = tdTarget?.userId === source.userId;
        if (!tdTarget || (isSelfDamage && effect.applyTo !== "SELF") || (tdTarget.hp ?? 0) <= 0) break;
        // Honor invulnerable / untargetable / damage immune.
        if (!isSelfDamage && (blocksEnemyTargeting(tdTarget) || hasDamageImmune(tdTarget))) {
          state.events.push({
            id: randomUUID(),
            timestamp: Date.now(),
            turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: tdTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "TRUE_DAMAGE",
            value: 0,
          });
          break;
        }
        const rawValue = Number(effect.value ?? 0);
        const td = (effect as any).percentOfTargetMaxHp === true
          ? Math.floor(getMaxHp(tdTarget) * (Math.max(0, rawValue) / 100))
          : (effect as any).noCrit === true
            ? Math.max(0, Math.floor(rawValue))
            : resolveRawDamageWithCrit({
                source,
                base: resolveAttackDamageBase(source, rawValue),
                damageType: (ability as any).damageType,
              });
        if (td <= 0) break;
        // Bypass shield: subtract directly from hp.
        const before = tdTarget.hp;
        tdTarget.hp = Math.max(0, before - td);
        const dealt = before - tdTarget.hp;
        state.events.push({
          id: randomUUID(),
          timestamp: Date.now(),
          turn: state.turn,
          type: "DAMAGE",
          actorUserId: source.userId,
          targetUserId: tdTarget.userId,
          abilityId: ability.id,
          abilityName: ability.name,
          effectType: "TRUE_DAMAGE",
          value: dealt,
        });
        break;
      }

      // ─── 驭羽骋风: cleanse all controls, vertical dash up 12u in 1s. ─
      case "YU_YU_DASH": {
        handleCleanse(source, { cleanseRootSlow: true });
        const upUnits = Math.max(0, Number(effect.value ?? 12));
        const upWorld = gameplayUnitsToWorldUnits(upUnits, state.unitScale);
        const dashTicks = Math.max(1, Number(effect.durationTicks ?? 30));
        if (source.velocity) {
          source.velocity.vx = 0;
          source.velocity.vy = 0;
          source.velocity.vz = 0;
        }
        // NOTE: do NOT set vzPerTick — movement.ts captures it from
        // forceVzPerTick on the first dash tick. Setting it explicitly to 0
        // skips that capture and the dash never rises.
        source.activeDash = {
          abilityId: ability.id,
          vxPerTick: 0,
          vyPerTick: 0,
          lingRanCastLift: true,
          sustainWhileChannelAbilityId: "jiu_xiao_feng_lei",
          forceVzPerTick: upWorld / dashTicks,
          maxUpVz: upWorld / dashTicks + 0.1,
          maxDownVz: -0.1,
          ticksRemaining: dashTicks,
        } as any;
        // Reset jump state so the player can land cleanly after the upward dash.
        (source as any).jumpCount = 0;
        state.events.push({
          id: randomUUID(), timestamp: Date.now(), turn: state.turn,
          type: "DASH",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
        } as any);
        break;
      }

      // ─── 凌然天风: vertical rise up 9u in 0.5s, no dash runtime buff. ───
      case "LING_RAN_TIAN_FENG_CAST": {
        const upUnits = Math.max(0, Number(effect.value ?? 9));
        const upWorld = gameplayUnitsToWorldUnits(upUnits, state.unitScale);
        const dashTicks = Math.max(1, Number(effect.durationTicks ?? 15));
        if (source.velocity) {
          source.velocity.vx = 0;
          source.velocity.vy = 0;
          source.velocity.vz = 0;
        }
        source.activeDash = {
          abilityId: ability.id,
          vxPerTick: 0,
          vyPerTick: 0,
          lingRanCastLift: true,
          sustainWhileChannelAbilityId: "jiu_xiao_feng_lei",
          forceVzPerTick: upWorld / dashTicks,
          maxUpVz: upWorld / dashTicks + 0.1,
          maxDownVz: -0.1,
          ticksRemaining: dashTicks,
        } as any;
        source.jumpCount = 0;
        source.lingRanTianFengCharges = 1;
        state.events.push({
          id: randomUUID(), timestamp: Date.now(), turn: state.turn,
          type: "DASH",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
        } as any);
        break;
      }

      // ─── 梯云纵: refresh 蹑云逐月 cooldown on caster. ───────────────────
      case "TI_YUN_ZONG_REFRESH": {
        const tiYunAbility = ABILITIES[ability.id] as any;
        const sourceInCombat = (source as any).inCombat === true;
        const buffId = sourceInCombat ? 9004 : 9003;
        const buff = tiYunAbility?.buffs?.find?.((entry: any) => entry.buffId === buffId);
        if (buff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability: tiYunAbility ?? ability,
            buffTarget: source as any,
            buff,
          });
        }
        if (!sourceInCombat) {
          const inst = (source as any).hand?.find?.(
            (a: any) => a.abilityId === "nieyun_zhuyue",
          );
          if (inst) {
            inst.cooldown = 0;
            inst._cooldownProgress = 0;
          }
        }
        break;
      }

      // ─── 疾电叱羽: place HP-bearing redirect zone below caster. ────────
      case "PLACE_JI_DIAN_ZONE": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const hpVal = Math.max(1, Number(effect.value ?? 40));
        const rangeUnits = Number((effect as any).range ?? 8);
        const radius = gameplayUnitsToWorldUnits(rangeUnits, storedUnitScale);
        const durationMs = Number((effect as any).zoneDurationMs ?? 8_000);
        if (!state.groundZones) state.groundZones = [];
        const zoneId = randomUUID();
        state.groundZones.push({
          id: zoneId,
          ownerUserId: source.userId,
          x: source.position.x,
          y: source.position.y,
          z: source.position.z ?? 0,
          height: radius,
          radius,
          expiresAt: now + durationMs,
          damagePerInterval: 0,
          intervalMs: 200,
          lastTickAt: now,
          abilityId: "ji_dian_chi_yu",
          abilityName: "疾电叱羽",
          hp: hpVal,
          maxHp: hpVal,
          allyBuffId: 2620,
        } as any);
        state.events.push({
          id: randomUUID(), timestamp: now, turn: state.turn,
          type: "DASH",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
        } as any);
        break;
      }

      // ─── 乘黄之威: forward dash 12u + flip facing 180° + cone 恐惧. ─────
      case "CHENG_HUANG_DASH": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const distUnits = Math.max(0, Number(effect.value ?? 12));
        const distWorld = gameplayUnitsToWorldUnits(distUnits, storedUnitScale);
        const dashTicks = Math.max(1, Number(effect.durationTicks ?? 18));
        const fX = source.facing?.x ?? 0;
        const fY = source.facing?.y ?? 1;
        const len = Math.sqrt(fX * fX + fY * fY) || 1;
        const dirX = fX / len;
        const dirY = fY / len;
        if (source.velocity) {
          source.velocity.vx = 0;
          source.velocity.vy = 0;
        }
        // Schedule the post-dash flip + cone fear via a marker buff that
        // GameLoop picks up on dash end. Simpler: store on the activeDash itself.
        source.activeDash = {
          abilityId: ability.id,
          vxPerTick: (dirX * distWorld) / dashTicks,
          vyPerTick: (dirY * distWorld) / dashTicks,
          forceVzPerTick: 0,
          maxUpVz: 0,
          maxDownVz: 0,
          ticksRemaining: dashTicks,
          chengHuangFlipAndFear: true,
        } as any;
        state.events.push({
          id: randomUUID(), timestamp: now, turn: state.turn,
          type: "DASH",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
        } as any);
        break;
      }

      case "LONG_ZHAN_YU_YE": {
        const coneTargets = getForwardConeEnemyTargets({
          state,
          source,
          rangeUnits: Math.max(0, Number(effect.value ?? 10)),
          coneAngleDeg: Number((effect as any).coneAngleDeg ?? 60),
        });
        const facing = getSourceFacingUnit(source);
        const anchorOffset = gameplayUnitsToWorldUnits(1, state.unitScale);
        const anchorX = source.position.x + facing.x * anchorOffset;
        const anchorY = source.position.y + facing.y * anchorOffset;
        const anchorGroundZ = getGroundHeightForMap(anchorX, anchorY, source.position.z ?? 0, mapCtx);
        const anchorZ = Math.max(anchorGroundZ, source.position.z ?? anchorGroundZ);
        for (const candidate of coneTargets) {
          pullImmediateTargetTowardAnchor({
            state,
            ability,
            source,
            target: candidate,
            anchor: { x: anchorX, y: anchorY, z: anchorZ },
            mapCtx,
          });
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: candidate,
            baseDamage: 3.4187,
            effectType: "DAMAGE",
            now: Date.now(),
          });
        }
        break;
      }

      case "QIAN_LONG_WU_YONG": {
        const now = Date.now();
        const coneTargets = getForwardConeEnemyTargets({
          state,
          source,
          rangeUnits: Math.max(0, Number(effect.value ?? 8)),
          coneAngleDeg: Number((effect as any).coneAngleDeg ?? 60),
        });
        for (const candidate of coneTargets) {
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: candidate,
            baseDamage: 2,
            effectType: "QIAN_LONG_WU_YONG",
            now,
          });
        }
        break;
      }

      case "DOU_ZHUAN_XING_YI": {
        const swapTarget = getExplicitEnemyPlayerTarget(
          state,
          source.userId,
          castContext?.targetUserId,
          castContext?.ignoreTargetAllegiance,
        )
          ?? ((enemy && enemy.userId !== source.userId) ? enemy : null);
        if (!swapTarget || hasKnockbackImmune(swapTarget as any)) {
          break;
        }
        swapImmediatePlayerPositions({
          state,
          source,
          target: swapTarget,
          mapCtx,
        });
        break;
      }

      case "QIN_YIN_GONG_MING": {
        if (!enemyApplied || !effTarget || isImmediateEntityTarget(effTarget)) {
          break;
        }

        const stealTarget = getDunLiReflectVictim(state, source.userId, effTarget as any, ability) ?? effTarget;
        if (!stealTarget || stealTarget.userId === source.userId || (stealTarget.hp ?? 0) <= 0 || blocksEnemyTargeting(stealTarget as any)) {
          break;
        }

        const stealCount = Math.max(0, Number((effect as any).count ?? 2));
        const stealableBuffs = (stealTarget.buffs ?? [])
          .filter((buff: any) => buff.category === "BUFF" && isQinYinGongMingBuffStealable(Number(buff.buffId)))
          .slice(0, stealCount);

        for (const stolenBuff of stealableBuffs) {
          const idx = (stealTarget.buffs ?? []).indexOf(stolenBuff);
          if (idx === -1) continue;

          const buffDefinition = buildStolenBuffDefinition(stolenBuff);
          const stolenShieldAmount = typeof stolenBuff.shieldAmount === "number"
            ? Math.max(0, Math.floor(stolenBuff.shieldAmount))
            : undefined;

          removeLinkedShield(stealTarget as any, stolenBuff);
          stealTarget.buffs.splice(idx, 1);
          pushBuffExpired(state, {
            targetUserId: stealTarget.userId,
            buffId: stolenBuff.buffId,
            buffName: stolenBuff.name,
            buffCategory: stolenBuff.category,
            sourceAbilityId: stolenBuff.sourceAbilityId,
            sourceAbilityName: stolenBuff.sourceAbilityName,
          });

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: buffDefinition,
          });

          const appliedBuff = [...(source.buffs ?? [])].reverse().find((buff: any) => buff.buffId === stolenBuff.buffId);
          if (appliedBuff) {
            syncStolenBuffRuntime({
              sourcePlayer: source,
              stolenBuff,
              appliedBuff,
              stolenShieldAmount,
            });
          }
        }

        break;
      }

      case "SHOU_QUE_SHI": {
        const shouQueTarget: ImmediateEnemyDamageTarget | null = enemyApplied
          ? (explicitEntityTarget
            ? { kind: "entity", target: explicitEntityTarget }
            : effTarget
              ? { kind: "player", target: effTarget }
              : null)
          : null;
        const now = Date.now();
        const empowered = (source.buffs ?? []).some(
          (buff: any) => buff.buffId === SHOU_QUE_BUFF_ID && (buff.expiresAt ?? 0) > now,
        );
        const baseDamage = Math.max(0, Number(effect.value ?? 2));
        const damage = empowered ? baseDamage * 1.3 : baseDamage;

        if (shouQueTarget && !(abilityDodged && shouQueTarget.kind === "player")) {
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: shouQueTarget,
            baseDamage: damage,
            effectType: "SHOU_QUE_SHI",
            now,
          });

          if (empowered) {
            applyImmediateKnockback({
              state,
              ability,
              source,
              target: shouQueTarget,
              distanceUnits: 2,
              durationTicks: 6,
              knockedBackBuffId: STANDARD_KNOCKBACK_BUFF_ID,
            });
          }
        }

        const selfBuff = getAbilityBuffDefinition(ability, SHOU_QUE_BUFF_ID);
        if (selfBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: selfBuff,
          });
        }
        break;
      }

      // ─── 振翅图南 / 飞刃回转: place follow-target damage zone. ──────────
      case "PLACE_FOLLOW_ZONE": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const dmg = Math.max(0, Number(effect.value ?? 1));
        const rangeUnits = Number((effect as any).range ?? 5);
        const radius = gameplayUnitsToWorldUnits(rangeUnits, storedUnitScale);
        const durationMs = Number((effect as any).zoneDurationMs ?? 6_000);
        const intervalMs = Number((effect as any).zoneIntervalMs ?? 500);
        const followSpeedUnitsPerSec = Number((effect as any).followSpeedUnitsPerSec ?? 5);
        const followSpeedPerTick = gameplayUnitsToWorldUnits(followSpeedUnitsPerSec, storedUnitScale) / 30;

        // Resolve placement: prefer selected target, fall back to ground hover.
        let cx: number;
        let cy: number;
        let cz: number;
        let followUid: string | undefined;
        const enemyTarget = (enemy && enemy.userId !== source.userId) ? enemy : null;
        const followTarget = enemyTarget
          ? (getDunLiReflectVictim(state, source.userId, enemyTarget as any, ability) ?? enemyTarget)
          : null;
        if (followTarget) {
          cx = followTarget.position.x;
          cy = followTarget.position.y;
          cz = followTarget.position.z ?? 0;
          followUid = followTarget.userId;
        } else if (castContext?.groundTarget) {
          cx = castContext.groundTarget.x;
          cy = castContext.groundTarget.y;
          cz = castContext.groundTarget.z ?? source.position.z ?? 0;
        } else {
          cx = source.position.x;
          cy = source.position.y;
          cz = source.position.z ?? 0;
        }

        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: cx,
          y: cy,
          z: cz,
          height: radius,
          radius,
          expiresAt: now + durationMs,
          damagePerInterval: dmg,
          intervalMs,
          lastTickAt: now,
          abilityId: ability.id,
          abilityName: ability.name,
          followTargetUserId: followUid,
          followSpeedPerTick,
        } as any);
        break;
      }

      // ─── 天绝地灭: growing ground-target zone that pulls + explodes. ────
      case "PLACE_GROW_PULL_ZONE": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const explodeDmg = Math.max(0, Number(effect.value ?? 10));
        const startUnits = Number((effect as any).range ?? 6);
        const endUnits = Number((effect as any).maxRange ?? 15);
        const startRadius = gameplayUnitsToWorldUnits(startUnits, storedUnitScale);
        const endRadius = gameplayUnitsToWorldUnits(endUnits, storedUnitScale);
        const durationMs = Number((effect as any).zoneDurationMs ?? 9_000);
        const growUnitsPerSec = Number((effect as any).growUnitsPerSec ?? 4);
        const growDurationMs = Math.max(1, ((endUnits - startUnits) / growUnitsPerSec) * 1000);

        let cx: number;
        let cy: number;
        let cz: number;
        const selectedTarget = explicitEntityTarget
          ?? ((castContext?.targetUserId && enemy?.userId === castContext.targetUserId) ? enemy : null);
        if (selectedTarget) {
          cx = selectedTarget.position.x;
          cy = selectedTarget.position.y;
          cz = selectedTarget.position.z ?? source.position.z ?? 0;
        } else if (castContext?.groundTarget) {
          cx = castContext.groundTarget.x;
          cy = castContext.groundTarget.y;
          cz = castContext.groundTarget.z ?? source.position.z ?? 0;
        } else {
          cx = source.position.x + (source.facing?.x ?? 0) * gameplayUnitsToWorldUnits(20, storedUnitScale);
          cy = source.position.y + (source.facing?.y ?? 0) * gameplayUnitsToWorldUnits(20, storedUnitScale);
          cz = source.position.z ?? 0;
        }

        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: cx,
          y: cy,
          z: cz,
          height: startRadius,
          radius: startRadius,
          expiresAt: now + durationMs,
          damagePerInterval: 0,
          intervalMs: 1_000,
          lastTickAt: now,
          abilityId: "tian_jue_di_mie",
          abilityName: "天绝地灭",
          growStartRadius: startRadius,
          growEndRadius: endRadius,
          growStartedAt: now,
          growDurationMs,
          explodeOnExpire: true,
          explodeDamage: explodeDmg,
          pullSpeedPerTick: gameplayUnitsToWorldUnits(40, storedUnitScale) / 30,
        } as any);
        break;
      }

      // ─── 龙啸九天: cleanse self, apply 龙威 + 龙啸九天 + 定身 buffs,
      // destroy enemy 气场/机关 within 6u, then AOE 6u: 1 damage + slow knockback. ─
      case "LONG_XIAO_JIU_TIAN_AOE": {
        const now = Date.now();
        // 1) Cleanse self of CONTROL / ATTACK_LOCK / ROOT (also SLOW via flag).
        handleCleanse(source, { cleanseRootSlow: true });

        // 2) Apply self-buffs: 龙威 (1349), 龙啸九天 (1350), 定身 (1351).
        const selfBuffIds = [1349, 1350, 1351];
        for (const bid of selfBuffIds) {
          const buffDef = (ability.buffs ?? []).find((b: any) => b.buffId === bid);
          if (!buffDef) continue;
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: buffDef,
          });
        }

        // 3) Stop self movement entirely (the 1s self-stuck).
        if ((source as any).velocity) {
          (source as any).velocity.vx = 0;
          (source as any).velocity.vy = 0;
          (source as any).velocity.vz = 0;
        }
        delete (source as any).activeDash;

        // 4) AOE: 1 damage + slow knockback to enemies within 6u of caster.
        const aoeRadius = gameplayUnitsToWorldUnits(Math.max(0, Number(effect.range ?? 6)), state.unitScale);
        const kbDistance = gameplayUnitsToWorldUnits(Math.max(0, Number(effect.value ?? 10)), state.unitScale);
        const kbTicks = Math.max(1, Number(effect.durationTicks ?? 300));

        destroyGroundZonesInRange({
          state,
          sourceUserId: source.userId,
          center: source.position,
          radius: aoeRadius,
          ownerMode: "enemy-only",
          destroyQiFields: true,
          destroyMechanisms: true,
        });

        for (const candidate of getImmediateEnemyBuffTargets(
          state,
          source.userId,
          source.position,
          aoeRadius,
        )) {
          const t: any = candidate.target;
          if (!t || t.userId === source.userId || (t.hp ?? 0) <= 0) continue;
          if (blocksEnemyTargeting(t)) continue;

          // Damage 1
          applyImmediateDamageToEnemyTarget({
            state,
            source,
            ability,
            target: isImmediateEntityTarget(t)
              ? { kind: "entity", target: t }
              : { kind: "player", target: t },
            baseDamage: 1,
            effectType: "DAMAGE",
            now,
          });

          // Slow knockback away from caster
          if (hasKnockedBackImmune(t)) continue;

          // 盾立 reflect: redirect knockback back to caster.
          const kbReflectVictim = getDunLiReflectVictim(state, source.userId, t, ability);
          const kbVictim: any = kbReflectVictim ?? t;
          // Compute direction so the victim is pushed AWAY from the other player.
          const otherPos = kbReflectVictim ? t.position : source.position;
          const dx = kbVictim.position.x - otherPos.x;
          const dy = kbVictim.position.y - otherPos.y;
          let dist = Math.hypot(dx, dy);
          let dirX: number; let dirY: number;
          if (dist < 0.0001) {
            const fx = source.facing?.x ?? 0;
            const fy = source.facing?.y ?? 1;
            const flen = Math.hypot(fx, fy);
            dirX = flen > 0.0001 ? fx / flen : 1;
            dirY = flen > 0.0001 ? fy / flen : 0;
          } else {
            dirX = dx / dist;
            dirY = dy / dist;
          }

          delete (kbVictim as any).activeDash;
          if ((kbVictim as any).velocity) {
            (kbVictim as any).velocity.vx = 0;
            (kbVictim as any).velocity.vy = 0;
          }
          (kbVictim as any).activeDash = {
            abilityId: ability.id,
            vxPerTick: (dirX * kbDistance) / kbTicks,
            vyPerTick: (dirY * kbDistance) / kbTicks,
            forceVzPerTick: 0,
            maxUpVz: 0,
            maxDownVz: 0,
            ticksRemaining: kbTicks,
            vzPerTick: 0,
          };

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: kbVictim.userId,
            ability,
            buffTarget: kbVictim,
            buff: buildStandardKnockbackBuff(Math.max(1_000, Math.ceil((kbTicks * 1000) / 30))),
          });
        }
        break;
      }

      // ─── 人剑合一: destroy all nearby 气场; if any friendly 气场 were
      // destroyed, apply 破势 (定身 5s) to enemy players within 13u. ───────
      case "REN_JIAN_HE_YI_AOE": {
        const aoeRadius = gameplayUnitsToWorldUnits(Math.max(0, Number(effect.range ?? 13)), state.unitScale);
        const { destroyedFriendlyQiFields } = destroyGroundZonesInRange({
          state,
          sourceUserId: source.userId,
          center: source.position,
          radius: aoeRadius,
          ownerMode: "any",
          destroyQiFields: true,
          destroyMechanisms: false,
        });

        if (destroyedFriendlyQiFields <= 0) {
          break;
        }

        const poShiBuff = (ability.buffs ?? []).find((b: any) => b.buffId === 2735);
        if (!poShiBuff) {
          break;
        }

        for (const candidate of getImmediateEnemyBuffTargets(
          state,
          source.userId,
          source.position,
          aoeRadius,
        )) {
          if (candidate.kind !== "player") continue;
          const target: any = candidate.target;
          if (!target || target.userId === source.userId || (target.hp ?? 0) <= 0) continue;
          if (blocksEnemyTargeting(target)) continue;

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: target.userId,
            ability,
            buffTarget: target,
            buff: poShiBuff,
          });
        }
        break;
      }

      case "SHESHEN_JUE": {
        const friendlyTarget = resolveFriendlySupportTarget(state, source, castContext);
        if (!friendlyTarget || (friendlyTarget.hp ?? 0) <= 0) break;

        handleCleanse(friendlyTarget as any, { cleanseRootSlow: true });

        const redirectBuff = (ability.buffs ?? []).find((buff: any) => buff.buffId === SHESHEN_REDIRECT_BUFF_ID);
        if (redirectBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: friendlyTarget.userId,
            ability,
            buffTarget: friendlyTarget,
            buff: {
              ...redirectBuff,
              redirectUserId: source.userId,
              protectedTargetUserId: friendlyTarget.userId,
              protectedEntityId: friendlyTarget.id,
            },
          });
        }

        const bearBuff = (ability.buffs ?? []).find((buff: any) => buff.buffId === SHESHEN_BEAR_BUFF_ID);
        if (bearBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: {
              ...bearBuff,
              protectedTargetUserId: friendlyTarget.userId,
              protectedEntityId: friendlyTarget.id,
            },
          });
        }
        break;
      }

      case "YUAN_GUARD": {
        const friendlyTarget = resolveFriendlySupportTarget(state, source, castContext);
        if (!friendlyTarget || (friendlyTarget.hp ?? 0) <= 0) break;

        const storedUnitScale = state.unitScale;
        const targetPosition = friendlyTarget.position ?? source.position;
        const dashDx = (targetPosition.x ?? source.position.x) - source.position.x;
        const dashDy = (targetPosition.y ?? source.position.y) - source.position.y;
        const dashDistance = Math.hypot(dashDx, dashDy);
        const dashTicks = Math.max(1, Number(effect.durationTicks ?? 15));
        const targetZ = targetPosition.z ?? source.position.z ?? 0;
        const currentZ = source.position.z ?? targetZ;
        const stopDistance = gameplayUnitsToWorldUnits(1, storedUnitScale);
        const desiredDistance = dashDistance > stopDistance ? stopDistance : 0;
        const travelDistance = Math.max(0, dashDistance - desiredDistance);
        const dashDirX = dashDistance > 0.0001 ? dashDx / dashDistance : 0;
        const dashDirY = dashDistance > 0.0001 ? dashDy / dashDistance : 0;

        if (travelDistance > 0.0001 || Math.abs(targetZ - currentZ) > 0.0001) {
          if (dashDistance > 0.0001) {
            source.facing = { x: dashDirX, y: dashDirY };
          }
          if (source.velocity) {
            source.velocity.vx = 0;
            source.velocity.vy = 0;
            source.velocity.vz = 0;
          }
          source.activeDash = {
            abilityId: ability.id,
            vxPerTick: (dashDirX * travelDistance) / dashTicks,
            vyPerTick: (dashDirY * travelDistance) / dashTicks,
            forceVzPerTick: (targetZ - currentZ) / dashTicks,
            maxUpVz: 999,
            maxDownVz: -999,
            ticksRemaining: dashTicks,
            vzPerTick: 0,
            yuanTargetUserId: friendlyTarget.id ? undefined : friendlyTarget.userId,
            yuanTargetEntityId: friendlyTarget.id,
            yuanKnockbackRangeUnits: Math.max(0, Number(effect.range ?? 6)),
            yuanKnockbackDistanceUnits: Math.max(0, Number(effect.value ?? 6)),
            yuanKnockbackTicks: dashTicks,
            yuanLandingRangeUnits: 4,
          } as any;
          state.events.push({
            id: randomUUID(),
            timestamp: Date.now(),
            turn: state.turn,
            type: "DASH",
            actorUserId: source.userId,
            targetUserId: source.userId,
            abilityId: ability.id,
            abilityName: ability.name,
          } as any);
        }

        const yuanGuardBuff = (ability.buffs ?? []).find((buff: any) => buff.buffId === YUAN_GUARD_BUFF_ID);
        if (yuanGuardBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: friendlyTarget.userId,
            ability,
            buffTarget: friendlyTarget,
            buff: {
              ...yuanGuardBuff,
              redirectUserId: source.userId,
              protectedTargetUserId: friendlyTarget.userId,
              protectedEntityId: friendlyTarget.id,
            },
          });
        }

        const yuanBearBuff = (ability.buffs ?? []).find((buff: any) => buff.buffId === YUAN_BEAR_BUFF_ID);
        if (yuanBearBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: {
              ...yuanBearBuff,
              protectedTargetUserId: friendlyTarget.userId,
              protectedEntityId: friendlyTarget.id,
            },
          });
        }
        break;
      }

      case "TING_FENG_CHUI_XUE": {
        const friendlyTarget = resolveFriendlySupportTarget(state, source, castContext);
        if (!friendlyTarget || (friendlyTarget.hp ?? 0) <= 0) break;

        const sameTarget = friendlyTarget.userId === source.userId;
        const sourceHpBefore = Number(source.hp ?? 0);
        const targetHpBefore = Number(friendlyTarget.hp ?? 0);
        const averageHp = Math.floor((sourceHpBefore + targetHpBefore) / 2);
        const participants = sameTarget ? [source] : [source, friendlyTarget];

        for (const participant of participants) {
          const maxHp = participant.maxHp ?? 100;
          participant.hp = Math.max(0, Math.min(maxHp, averageHp));
        }

        for (const participant of participants) {
          applyImmediateGuanTiHeal({
            state,
            ability,
            sourceUserId: source.userId,
            target: participant,
            percent: Number(effect.value ?? 20),
          });
        }
        break;
      }

      // ─── 临时飞爪: ground-target dash without dash CC-immunity buff ────────
      case "LIN_SHI_FEI_ZHUA_DASH": {
        // Always use mouse ground-target position — NEVER fall back to opponent position
        const gTargetX2 = castContext?.groundTarget?.x;
        const gTargetY2 = castContext?.groundTarget?.y;
        if (gTargetX2 === undefined || gTargetY2 === undefined) break;
        const tX = gTargetX2;
        const tY = gTargetY2;
        const gDx2 = tX - source.position.x;
        const gDy2 = tY - source.position.y;
        const gLen2 = Math.sqrt(gDx2 * gDx2 + gDy2 * gDy2);
        const linActualWorld = gLen2;
        if (gLen2 > 0.01) {
          source.facing = { x: gDx2 / gLen2, y: gDy2 / gLen2 };
        }
        // Speed: 20 units/sec → ticks = (dist / 20) * 30
        const linActualGpu = worldUnitsToGameplayUnits(linActualWorld, state.unitScale);
        const linDurationTicks = Math.max(1, Math.round((linActualGpu / 20) * 30));
        const linDirX = gLen2 > 0.01 ? gDx2 / gLen2 : source.facing?.x ?? 0;
        const linDirY = gLen2 > 0.01 ? gDy2 / gLen2 : source.facing?.y ?? 1;
        source.velocity.vx = 0;
        source.velocity.vy = 0;
        source.activeDash = {
          abilityId: ability.id,
          vxPerTick: linDirX * linActualWorld / linDurationTicks,
          vyPerTick: linDirY * linActualWorld / linDurationTicks,
          maxUpVz: 0.3,
          maxDownVz: -0.3,
          ticksRemaining: linDurationTicks,
          ccStopsMe: true,
        } as any;
        // Height targeting
        const linTargetZ = castContext?.groundTarget?.z;
        if (linTargetZ !== undefined) {
          const linHDiff = linTargetZ - (source.position.z ?? 0);
          if (Math.abs(linHDiff) > 0.1) {
            (source.activeDash as any).forceVzPerTick = linHDiff / linDurationTicks;
          }
        }
        // NOTE: intentionally NO applyDashRuntimeBuff — no CC immunity while dashing
        state.events.push({
          id: randomUUID(), timestamp: Date.now(), turn: state.turn,
          type: "DASH",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
        } as any);
        break;
      }

      // ─── 化蝶 Phase 1: diagonal dash (up 4u + forward 2u over 30 ticks) ──
      case "HUA_DIE_PHASE1": {
        const fLen3 = source.facing
          ? Math.sqrt(source.facing.x * source.facing.x + source.facing.y * source.facing.y)
          : 0;
        const fX3 = fLen3 > 0.01 ? source.facing!.x / fLen3 : 0;
        const fY3 = fLen3 > 0.01 ? source.facing!.y / fLen3 : 1;
        const p1Ticks = 30; // 1 second
        const p1ForwardWorld = gameplayUnitsToWorldUnits(2, state.unitScale);
        const p1UpWorld = gameplayUnitsToWorldUnits(4, state.unitScale);
        source.velocity.vx = 0;
        source.velocity.vy = 0;
        source.activeDash = {
          abilityId: "hua_die",
          vxPerTick: fX3 * p1ForwardWorld / p1Ticks,
          vyPerTick: fY3 * p1ForwardWorld / p1Ticks,
          forceVzPerTick: p1UpWorld / p1Ticks,
          maxUpVz: p1UpWorld / p1Ticks + 0.1,
          maxDownVz: -0.1,
          ticksRemaining: p1Ticks,
        } as any;
        // Apply dash runtime buff for Phase 1 (CC immune during phase 1)
        applyDashRuntimeBuff({
          state,
          target: source,
          durationMs: Math.ceil(p1Ticks * (1000 / 30)) + 200,
          effects: [
            { type: "CONTROL_IMMUNE" },
            { type: "KNOCKBACK_IMMUNE" },
            { type: "DISPLACEMENT" },
            { type: "DASH_TURN_LOCK" },
          ],
          sourceAbilityId: ability.id,
          sourceAbilityName: ability.name,
        });
        state.events.push({
          id: randomUUID(), timestamp: Date.now(), turn: state.turn,
          type: "DASH",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
        } as any);
        break;
      }

      // ─── 剑主天地: stacking dot, detonate at 3 stacks ─────────────────────
      case "JIAN_ZHU_TIAN_DI_STRIKE": {
        if (!enemyApplied) break;
        const jztdBuffDef = ability.buffs?.find((b: any) => b.buffId === 2614);
        const existing2614 = effTarget.buffs.find((b: any) => b.buffId === 2614);
        if (existing2614 && (existing2614.stacks ?? 1) >= (jztdBuffDef?.maxStacks ?? 3)) {
          // Detonate: remove buff and deal total remaining DoT immediately
          const dmgPerTick2 = jztdBuffDef?.effects?.find((e: any) => e.type === "PERIODIC_DAMAGE")?.value ?? 1;
          const remainingMs2 = Math.max(0, existing2614.expiresAt - Date.now());
          const periodicMs2 = existing2614.periodicMs ?? jztdBuffDef?.periodicMs ?? 3000;
          const remainTicks2 = Math.max(0, Math.ceil(remainingMs2 / periodicMs2));
          const burstDmg = remainTicks2 * dmgPerTick2 + 1; // +1 for the hit itself
          effTarget.buffs = effTarget.buffs.filter((b: any) => b.buffId !== 2614);
          pushBuffExpired(state, {
            targetUserId: effTarget.userId,
            buffId: 2614,
            buffName: "剑主天地·急曲",
            buffCategory: "DEBUFF",
            sourceAbilityId: ability.id,
            sourceAbilityName: ability.name,
          });
          const finalBurst = resolveScheduledDamage({ source, target: effTarget, base: burstDmg, abilityId: ability.id, damageType: (ability as any).damageType });
          if (finalBurst > 0 && !hasDamageImmune(effTarget as any)) {
            const { adjustedDamage: adjBurst, redirectPlayer: rtBurst, redirectAmt: raBurst } = preCheckRedirect(state, effTarget as any, finalBurst);
            const applyBurst = adjBurst;
            const resultBurst = applyBurst > 0
              ? applyDamageToTarget(effTarget as any, applyBurst)
              : { hpDamage: 0, shieldAbsorbed: 0 };
            state.events.push({
              id: randomUUID(), timestamp: Date.now(), turn: state.turn,
              type: "DAMAGE",
              actorUserId: source.userId,
              targetUserId: effTarget.userId,
              abilityId: ability.id,
              abilityName: ability.name,
              effectType: "DAMAGE",
              value: applyBurst,
              shieldAbsorbed: (resultBurst.shieldAbsorbed ?? 0) > 0 ? resultBurst.shieldAbsorbed : undefined,
            } as any);
            if (resultBurst.hpDamage > 0 || resultBurst.shieldAbsorbed > 0) {
              processOnDamageTaken(state, effTarget as any, resultBurst.hpDamage, source.userId, resultBurst.shieldAbsorbed);
            }
            if (rtBurst && raBurst > 0) {
              applyRedirectToOpponent(state, rtBurst, raBurst);
            }
          }
          // After detonation, apply one fresh stack of the DoT buff
          if (jztdBuffDef) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: effTarget.userId,
              ability,
              buffTarget: effTarget,
              buff: jztdBuffDef,
            });
          }
        } else {
          // Normal hit: 1 damage + apply/stack buff 2614
          const dmg1 = resolveScheduledDamage({ source, target: effTarget, base: 1, abilityId: ability.id, damageType: (ability as any).damageType });
          if (dmg1 > 0 && !hasDamageImmune(effTarget as any)) {
            const { adjustedDamage: adjJ1, redirectPlayer: rtJ1, redirectAmt: raJ1 } = preCheckRedirect(state, effTarget as any, dmg1);
            const applyJ1 = adjJ1;
            const resultJ1 = applyJ1 > 0
              ? applyDamageToTarget(effTarget as any, applyJ1)
              : { hpDamage: 0, shieldAbsorbed: 0 };
            state.events.push({
              id: randomUUID(), timestamp: Date.now(), turn: state.turn,
              type: "DAMAGE",
              actorUserId: source.userId,
              targetUserId: effTarget.userId,
              abilityId: ability.id,
              abilityName: ability.name,
              effectType: "DAMAGE",
              value: applyJ1,
              shieldAbsorbed: (resultJ1.shieldAbsorbed ?? 0) > 0 ? resultJ1.shieldAbsorbed : undefined,
            } as any);
            if (resultJ1.hpDamage > 0 || resultJ1.shieldAbsorbed > 0) {
              processOnDamageTaken(state, effTarget as any, resultJ1.hpDamage, source.userId, resultJ1.shieldAbsorbed);
            }
            if (rtJ1 && raJ1 > 0) {
              applyRedirectToOpponent(state, rtJ1, raJ1);
            }
          }
          if (jztdBuffDef) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: effTarget.userId,
              ability,
              buffTarget: effTarget,
              buff: jztdBuffDef,
            });
          }
        }
        break;
      }

      // ─── 破风: 1 damage + 破风 debuff + 流血, extra 流血 if CONTROL_IMMUNE ──
      case "PO_FENG_STRIKE": {
        if (!enemyApplied) break;
        const pfDmg = resolveScheduledDamage({ source, target: effTarget, base: 1, abilityId: ability.id, damageType: (ability as any).damageType });
        if (pfDmg > 0 && !hasDamageImmune(effTarget as any)) {
          const { adjustedDamage: adjPf, redirectPlayer: rtPf, redirectAmt: raPf } = preCheckRedirect(state, effTarget as any, pfDmg);
          const applyPf = adjPf;
          const resultPf = applyPf > 0
            ? applyDamageToTarget(effTarget as any, applyPf)
            : { hpDamage: 0, shieldAbsorbed: 0 };
          state.events.push({
            id: randomUUID(), timestamp: Date.now(), turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "DAMAGE",
            value: applyPf,
            shieldAbsorbed: (resultPf.shieldAbsorbed ?? 0) > 0 ? resultPf.shieldAbsorbed : undefined,
          } as any);
          if (resultPf.hpDamage > 0 || resultPf.shieldAbsorbed > 0) {
            processOnDamageTaken(state, effTarget as any, resultPf.hpDamage, source.userId, resultPf.shieldAbsorbed);
          }
          if (rtPf && raPf > 0) {
            applyRedirectToOpponent(state, rtPf, raPf);
          }
        }
        // Apply 破风 (flat damage-taken debuff)
        const pfWindBuffDef = ability.buffs?.find((b: any) => b.buffId === 2615);
        if (pfWindBuffDef) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: effTarget.userId,
            ability,
            buffTarget: effTarget,
            buff: pfWindBuffDef,
          });
        }
        // Apply 流血 (bleed DoT)
        const pfBleedBuffDef = ability.buffs?.find((b: any) => b.buffId === 2616);
        if (pfBleedBuffDef) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: effTarget.userId,
            ability,
            buffTarget: effTarget,
            buff: pfBleedBuffDef,
          });
          // If target has CONTROL_IMMUNE, apply an extra stack of 流血
          if (blocksControlByImmunity("CONTROL", effTarget as any)) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: effTarget.userId,
              ability,
              buffTarget: effTarget,
              buff: pfBleedBuffDef,
            });
          }
        }
        break;
      }

      case "MIE_STRIKE": {
        // 灭: deal 2 dmg normally; if caster hp < 10% maxHp → deal 12 dmg + apply 灭 buff (MIN_HP_1, 3s)
        if (!effTarget || (effTarget.hp ?? 0) <= 0 || blocksEnemyTargeting(effTarget)) break;
        if (hasDamageImmune(effTarget as any)) break;
        const mieMaxHp = source.maxHp ?? 100;
        const mieIsLowHp = source.hp < mieMaxHp * 0.1;
        const mieBase = mieIsLowHp ? 12 : (effect.value ?? 2);
        const mieDmg = resolveScheduledDamage({
          source,
          target: effTarget,
          base: mieBase,
          abilityId: ability.id,
          damageType: (ability as any).damageType,
        });
        if (mieDmg > 0) {
          const { adjustedDamage: mieAdj, redirectPlayer: mieRt, redirectAmt: mieRa } = preCheckRedirect(state, effTarget as any, mieDmg);
          const mieApply = mieAdj;
          const mieResult = applyDamageToTarget(effTarget as any, mieApply);
          state.events.push({
            id: randomUUID(),
            timestamp: Date.now(),
            turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "MIE_STRIKE",
            value: mieApply,
            shieldAbsorbed: (mieResult.shieldAbsorbed ?? 0) > 0 ? mieResult.shieldAbsorbed : undefined,
          });
          if (mieResult.hpDamage > 0 || mieResult.shieldAbsorbed > 0) {
            processOnDamageTaken(state, effTarget as any, mieResult.hpDamage, source.userId, mieResult.shieldAbsorbed);
          }
          if (mieRt && mieRa > 0) {
            applyRedirectToOpponent(state, mieRt, mieRa);
          }
        }
        if (mieIsLowHp) {
          const mieBuff = Array.isArray(ability.buffs) ? ability.buffs.find((b: any) => b.buffId === 2713) : null;
          if (mieBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: source.userId,
              ability,
              buffTarget: source,
              buff: mieBuff,
            });
          }
        }
        break;
      }

      case "GU_YING_HUA_SHUANG": {
        // Snapshot current HP and all ability cooldowns, then apply the buff.
        // On buff expiry in GameLoop, HP and cooldowns will be restored.
        const guYingBuff = (ability.buffs ?? []).find((b: any) => b.buffId === 2714);
        if (guYingBuff) {
          const snapshot = {
            hp: source.hp,
            shield: source.shield ?? 0,
            cooldowns: (source.hand ?? []).map((a: any) => ({
              instanceId: a.instanceId,
              abilityId: a.abilityId,
              cooldown: a.cooldown ?? 0,
              chargeCount: a.chargeCount,
              chargeRegenTicksRemaining: a.chargeRegenTicksRemaining,
              chargeLockTicks: a.chargeLockTicks,
            })),
          };

          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: guYingBuff,
          });

          // Attach snapshot to the live buff object so GameLoop can restore on expiry.
          const liveBuff = source.buffs.find((b: any) => b.buffId === 2714);
          if (liveBuff) {
            (liveBuff as any).snapshot = snapshot;
          }
        }
        break;
      }

      case "PLACE_ZHU_YUN_HAN_RUI": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const radius = gameplayUnitsToWorldUnits(10, storedUnitScale);
        const px = source.position?.x ?? 0;
        const py = source.position?.y ?? 0;
        const pz = source.position?.z ?? 0;
        const groundZ = getGroundHeightForMap(px, py, pz, mapCtx);

        if (!state.entities) state.entities = [];
        const entityId = randomUUID();
        const entityUserId = `entity:${entityId}`;
        // Drop self instance below caster (snap to ground).
        const entity = {
          id: entityId,
          userId: entityUserId,
          kind: "zhu_yun_han_rui",
          ownerUserId: source.userId,
          position: { x: px, y: py, z: groundZ },
          radius,
          hp: 50,
          maxHp: 50,
          shield: 0,
          buffs: [],
          expiresAt: now + 12_000,
          abilityId: ability.id,
          abilityName: ability.name,
          enteredAtByUser: {},
          rearmAtByUser: {},
        };
        state.entities.push(entity);

        const entityImmuneBuff = (ability.buffs ?? []).find((b: any) => b.buffId === 2717);
        if (entityImmuneBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: entity.userId,
            ability,
            buffTarget: entity as any,
            buff: { ...entityImmuneBuff, durationMs: entity.expiresAt - now },
          });
        }

        // Apply control-immune buff (2715) to the caster.
        const immuneBuff = (ability.buffs ?? []).find((b: any) => b.buffId === 2715);
        if (immuneBuff) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: source.userId,
            ability,
            buffTarget: source,
            buff: immuneBuff,
          });
        }
        break;
      }

      case "PLACE_CHU_HE_HAN_JIE_WALL": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const halfLength = gameplayUnitsToWorldUnits(CHU_HE_HAN_JIE_WALL_LENGTH_UNITS / 2, storedUnitScale);
        const halfThickness = gameplayUnitsToWorldUnits(CHU_HE_HAN_JIE_WALL_THICKNESS_UNITS / 2, storedUnitScale);
        const wallHeight = gameplayUnitsToWorldUnits(CHU_HE_HAN_JIE_WALL_HEIGHT_UNITS, storedUnitScale);
        const facing = source.facing ?? { x: 0, y: 1 };
        const facingLen = Math.hypot(facing.x, facing.y);
        const tangentX = facingLen > 1e-6 ? facing.x / facingLen : 0;
        const tangentY = facingLen > 1e-6 ? facing.y / facingLen : 1;
        const normalX = -tangentY;
        const normalY = tangentX;
        const px = source.position?.x ?? 0;
        const py = source.position?.y ?? 0;
        const pz = source.position?.z ?? 0;
        const groundZ = getGroundHeightForMap(px, py, pz, mapCtx);
        const wallStartDistance = gameplayUnitsToWorldUnits(1, storedUnitScale);

        if (!state.entities) state.entities = [];
        const entityId = randomUUID();
        state.entities.push({
          id: entityId,
          userId: `entity:${entityId}`,
          kind: CHU_HE_HAN_JIE_WALL_KIND,
          ownerUserId: source.userId,
          position: {
            x: px + tangentX * (wallStartDistance + halfLength),
            y: py + tangentY * (wallStartDistance + halfLength),
            z: groundZ,
          },
          radius: halfLength,
          hp: CHU_HE_HAN_JIE_WALL_HP,
          maxHp: CHU_HE_HAN_JIE_WALL_HP,
          shield: 0,
          buffs: [],
          spawnedAt: now,
          expiresAt: now + CHU_HE_HAN_JIE_WALL_DURATION_MS,
          abilityId: ability.id,
          abilityName: ability.name,
          wallHalfLength: halfLength,
          wallHalfThickness: halfThickness,
          wallHeight,
          wallTangent: { x: tangentX, y: tangentY },
          wallNormal: { x: normalX, y: normalY },
        } as any);
        break;
      }

      case "PLACE_LV_YE_MAN_SHENG_FIELD": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const radius = gameplayUnitsToWorldUnits(6, storedUnitScale);
        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: source.position.x,
          y: source.position.y,
          z: source.position.z ?? 0,
          height: radius,
          radius,
          expiresAt: now + 6_000,
          damagePerInterval: 0,
          intervalMs: 250,
          lastTickAt: now,
          abilityId: ability.id,
          abilityName: ability.name,
          followTargetUserId: source.userId,
          followSpeedPerTick: gameplayUnitsToWorldUnits(60, storedUnitScale) / 30,
        } as any);
        break;
      }

      case "XIANG_JI_BI_LUO": {
        if (!enemyApplied || !effTarget || isImmediateEntityTarget(effTarget)) break;
        if (blocksEnemyTargeting(effTarget as any)) break;

        // Pre-classify the ability's declared buffs:
        //   - silence buffs apply ONLY on a successful interrupt
        //   - non-silence buffs (e.g. 惊惧 slow on 剑飞惊天) apply ONLY on FAILURE
        //     (i.e. when interrupt does not land — target was immune or had no
        //      interruptible channel). This makes 剑飞 mutually exclusive between
        //      惊惧 (fail) and 沉默 (success).
        const allBuffs = (ability.buffs ?? []) as any[];
        const silenceBuffs = allBuffs.filter(
          (b) => b.effects?.some((e: any) => e.type === "SILENCE")
        );
        const nonSilenceBuffs = allBuffs.filter(
          (b) => !b.effects?.some((e: any) => e.type === "SILENCE")
        );

        const applyFailureBuffs = () => {
          for (const buff of nonSilenceBuffs) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: effTarget.userId,
              ability,
              buffTarget: effTarget as any,
              buff,
            });
          }
        };

        // 1. Interrupt immunity gates the interrupt + silence chain.
        //    SILENCE_IMMUNE also confers interrupt immunity by design.
        const hasInterruptImmune = (effTarget.buffs ?? []).some((b: any) =>
          b.effects?.some((e: any) => e.type === "SILENCE_IMMUNE")
        );
        if (hasInterruptImmune) {
          applyFailureBuffs();
          break;
        }

        // 2. Find the target's current channel (active or buff-source) and
        //    its interruptible flag.
        let channelInterruptible = false;
        let cancelActive = false;
        let buffChannelToRemove: any = null;

        if (effTarget.activeChannel) {
          const ac = effTarget.activeChannel;
          const acAbility = ABILITIES[ac.abilityId];
          const flag = ac.interruptible !== undefined
            ? ac.interruptible
            : (acAbility?.channel?.interruptible !== false);
          if (flag) {
            channelInterruptible = true;
            cancelActive = true;
          }
        } else {
          for (const b of (effTarget.buffs ?? [])) {
            const srcAbilityId = (b as any).sourceAbilityId as string | undefined;
            if (!srcAbilityId) continue;
            const srcAbility = ABILITIES[srcAbilityId];
            const ch = srcAbility?.channel;
            if (!ch || ch.source !== "BUFF" || ch.buffId !== b.buffId) continue;
            if (ch.interruptible !== false) {
              channelInterruptible = true;
              buffChannelToRemove = b;
            }
            break;
          }
        }

        if (!channelInterruptible) {
          applyFailureBuffs();
          break;
        }

        // 3. Successful interrupt — cancel channel.
        if (cancelActive) {
          const ac = effTarget.activeChannel;
          const startedBuffIds = ac?.startedBuffIds ?? [];
          if (startedBuffIds.length > 0) {
            const remaining: any[] = [];
            for (const buff of (effTarget.buffs ?? [])) {
              const matchesStarted =
                startedBuffIds.includes(buff.buffId) &&
                (buff.sourceAbilityId ?? ac?.abilityId) === ac?.abilityId;
              if (!matchesStarted) {
                remaining.push(buff);
                continue;
              }
              removeLinkedShield(effTarget as any, buff as any);
              pushBuffExpired(state, {
                targetUserId: effTarget.userId,
                buffId: buff.buffId,
                buffName: buff.name,
                buffCategory: buff.category,
                sourceAbilityId: buff.sourceAbilityId,
                sourceAbilityName: buff.sourceAbilityName,
                sourceUserId: buff.sourceUserId,
              });
            }
            effTarget.buffs = remaining;
          }
          effTarget.activeChannel = undefined;
        } else if (buffChannelToRemove) {
          removeLinkedShield(effTarget as any, buffChannelToRemove as any);
          effTarget.buffs = effTarget.buffs.filter((b: any) => b !== buffChannelToRemove);
          pushBuffExpired(state, {
            targetUserId: effTarget.userId,
            buffId: buffChannelToRemove.buffId,
            buffName: buffChannelToRemove.name,
            buffCategory: buffChannelToRemove.category,
            sourceAbilityId: buffChannelToRemove.sourceAbilityId,
            sourceAbilityName: buffChannelToRemove.sourceAbilityName,
            sourceUserId: buffChannelToRemove.sourceUserId,
          });
        }

        // 4. Apply silence buff(s) on successful interrupt.
        for (const sb of silenceBuffs) {
          addBuff({
            state,
            sourceUserId: source.userId,
            targetUserId: effTarget.userId,
            ability,
            buffTarget: effTarget as any,
            buff: sb,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  // ── 徐如林: apply parent buff (1343) to caster on cast ──
  if (ability.id === "xu_ru_lin") {
    const parent = (ability.buffs ?? []).find((b: any) => b.buffId === 1343);
    if (parent) {
      addBuff({
        state,
        sourceUserId: source.userId,
        targetUserId: source.userId,
        ability,
        buffTarget: source,
        buff: parent,
      });
    }
  }

  if (ability.id === "wu_xiang_jue") {
    const snapshotBuffId = getWuXiangJueSnapshotBuffId(source);
    const snapshotBuff = (ability.buffs ?? []).find((b: any) => b.buffId === snapshotBuffId);
    if (snapshotBuff) {
      addBuff({
        state,
        sourceUserId: source.userId,
        targetUserId: source.userId,
        ability,
        buffTarget: source,
        buff: snapshotBuff,
      });
    }
  }

  // ── 太极无极: if target was under STUN/ROOT/FREEZE at cast, apply
  // stacking 太极无极 debuff (DAMAGE_TAKEN_INCREASE 0.2, 12s, max 5 stacks).
  if (ability.id === "tai_ji_wu_ji" && taiJiCcOnTarget) {
    const tjTarget = state.players[targetIndex];
    if (tjTarget && tjTarget.userId !== source.userId && (tjTarget.hp ?? 0) > 0) {
      const stackBuffDef = (ability.buffs ?? []).find((b: any) => b.buffId === 1348);
      if (stackBuffDef) {
        addBuff({
          state,
          sourceUserId: source.userId,
          targetUserId: tjTarget.userId,
          ability,
          buffTarget: tjTarget,
          buff: stackBuffDef,
        });
      }
    }
  }

  if (ability.id === "jieyang" && enemy?.position) {
    triggerYunSanBlink({
      state,
      source,
      targetPosition: enemy.position,
      triggerAbilityId: ability.id,
      mapCtx,
    });
  }
}
