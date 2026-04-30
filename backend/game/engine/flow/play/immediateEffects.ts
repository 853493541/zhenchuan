// engine/flow/applyImmediateEffects.ts
import { randomUUID } from "crypto";
import { resolveEffectTargetIndex } from "../../utils/targeting";
import { blocksEnemyTargeting, isEnemyEffect, shouldSkipDueToDodge, hasKnockbackImmune, hasDamageImmune, blocksControlByImmunity } from "../../rules/guards";
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
import { resolveScheduledDamage } from "../../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget, removeLinkedShield } from "../../utils/health";
import { addBuff, pushBuffExpired } from "../../effects/buffRuntime";
import {
  applyZhenShanHeSelfCastBuff,
  pulseZhenShanHeTarget,
  ZHEN_SHAN_HE_ABILITY_ID,
} from "../../effects/definitions/ZhenShanHe";
import { getGroundHeightForMap, type MapContext } from "../../loop/movement";
import { loadBuffEditorOverrides } from "../../../abilities/buffEditorOverrides";
import { ABILITIES } from "../../../abilities/abilities";
import { applyDashRuntimeBuff, DASH_CC_IMMUNE_BUFF_ID } from "../../effects/definitions/DirectionalDash";
import { processOnDamageTaken, preCheckRedirect, applyRedirectToOpponent } from "../../effects/onDamageHooks";

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

function getImmediateEnemyBuffTargets(
  state: any,
  sourceUserId: string,
  center: { x: number; y: number },
  radius: number
): ImmediateEnemyDamageTarget[] {
  const targets: ImmediateEnemyDamageTarget[] = [];

  for (const victim of state.players ?? []) {
    if (victim.userId === sourceUserId) continue;
    if ((victim.hp ?? 0) <= 0) continue;
    if (blocksEnemyTargeting(victim)) continue;
    if (getImmediateEnemyStatusTargetDistance(center, { kind: "player", target: victim }) > radius) continue;
    targets.push({ kind: "player", target: victim });
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;
    if (entity.ownerUserId === sourceUserId) continue;
    if (blocksEnemyTargeting(entity as any)) continue;
    if (getImmediateEnemyStatusTargetDistance(center, { kind: "entity", target: entity }) > radius) continue;
    targets.push({ kind: "entity", target: entity });
  }

  return targets;
}

function getExplicitEnemyEntityTarget(state: any, sourceUserId: string, entityTargetId?: string) {
  if (!entityTargetId || !Array.isArray(state.entities)) return null;
  const entity = state.entities.find((candidate: any) => candidate.id === entityTargetId);
  if (!entity || entity.hp <= 0 || entity.ownerUserId === sourceUserId) return null;
  return entity;
}

function getExplicitEnemyPlayerTarget(state: any, sourceUserId: string, targetUserId?: string) {
  if (!targetUserId || !Array.isArray(state.players)) return null;
  const target = state.players.find((candidate: any) => candidate.userId === targetUserId);
  if (!target || target.userId === sourceUserId || (target.hp ?? 0) <= 0) return null;
  if (blocksEnemyTargeting(target)) return null;
  return target;
}

function getAbilityBuffDefinition(ability: any, buffId: number) {
  return Array.isArray(ability.buffs)
    ? ability.buffs.find((buff: any) => buff.buffId === buffId)
    : undefined;
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

  if (typeof ability?.range === "number") {
    const dx = (target.position?.x ?? 0) - (source.position?.x ?? 0);
    const dy = (target.position?.y ?? 0) - (source.position?.y ?? 0);
    const distanceGameplay = worldUnitsToGameplayUnits(Math.hypot(dx, dy), state.unitScale);
    if (distanceGameplay > ability.range) {
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
  center: { x: number; y: number },
  radius: number
): ImmediateEnemyDamageTarget[] {
  const targets: ImmediateEnemyDamageTarget[] = [];

  for (const victim of state.players ?? []) {
    if (victim.userId === sourceUserId) continue;
    if ((victim.hp ?? 0) <= 0) continue;
    if (blocksEnemyTargeting(victim)) continue;
    if (hasDamageImmune(victim as any)) continue;

    const dx = (victim.position?.x ?? 0) - center.x;
    const dy = (victim.position?.y ?? 0) - center.y;
    if (Math.hypot(dx, dy) > radius) continue;
    targets.push({ kind: "player", target: victim });
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;
    if (entity.ownerUserId === sourceUserId) continue;
    if (blocksEnemyTargeting(entity as any)) continue;
    if (hasDamageImmune(entity as any)) continue;

    const dx = (entity.position?.x ?? 0) - center.x;
    const dy = (entity.position?.y ?? 0) - center.y;
    if (Math.hypot(dx, dy) > radius + Math.max(0, Number(entity.radius ?? 0))) continue;
    targets.push({ kind: "entity", target: entity });
  }

  return targets;
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
  if (hasDamageImmune(target.target as any)) return 0;

  const damageTarget = target.target;
  const resolvedDamage = resolveScheduledDamage({
    source,
    target: damageTarget,
    base: baseDamage,
    damageType: (ability as any).damageType,
  });
  if (resolvedDamage <= 0) return 0;

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
      shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
    });
    if (result.hpDamage > 0) {
      processOnDamageTaken(state, victim as any, result.hpDamage, source.userId);
    }
    if (redirectPlayer && redirectAmt > 0) {
      applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
    }
    return appliedDamage;
  }

  const entity = target.target;
  const result = resolvedDamage > 0
    ? applyDamageToTarget(entity as any, resolvedDamage)
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
    value: resolvedDamage,
    shieldAbsorbed: (result.shieldAbsorbed ?? 0) > 0 ? result.shieldAbsorbed : undefined,
  });
  if (result.hpDamage > 0) {
    processOnDamageTaken(state, entity as any, result.hpDamage, source.userId);
  }
  return resolvedDamage;
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
  const explicitEntityTarget = getExplicitEnemyEntityTarget(
    state,
    source.userId,
    castContext?.entityTargetId,
  );

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

  for (const effect of ability.effects) {
    const effTargetIndex = resolveEffectTargetIndex(
      targetIndex,
      playerIndex,
      effect.applyTo
    );
    const playerEffTarget = state.players[effTargetIndex];
    const enemyApplied = isEnemyEffect(source, playerEffTarget, effect);
    // When an entity is the explicit target of a hostile effect, route the
    // effect (dash, control, damage) at the entity instead of the opposing
    // player so dashes home in on dummies / 逐云寒蕊 etc.
    const effTarget: any = (explicitEntityTarget && enemyApplied)
      ? explicitEntityTarget
      : playerEffTarget;

    // TRUE_DAMAGE bypasses dodge; all other enemy-applied effects skip on dodge.
    if ((effect as any).type !== "TRUE_DAMAGE" && shouldSkipDueToDodge(abilityDodged, enemyApplied)) continue;

    // PROJECTILE_IMMUNE: skip all enemy-targeted effects from projectile abilities
    if (
      enemyApplied &&
      (ability as any).isProjectile === true &&
      effTarget.buffs.some(
        (b: any) =>
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
              const healAmt = Math.floor(appliedDmg * ls);
              if (healAmt > 0) {
                applyHealToTarget(source as any, healAmt);
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
                  value: healAmt,
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
        // 贯体 heal: bypass HEAL_REDUCTION, apply directly
        const healBase = effect.value ?? 0;
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
        handleCleanse(source, {
          cleanseRootSlow:
            (ability as any).cleanseRootSlow === true ||
            (effect as any).cleanseRootSlow === true,
        });
        break;

      case "YOU_FENG_PIAO_ZONG": {
        const capturedControls = captureAndCleanseControls(source, Date.now());

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
        // Compute direction from source to the ground target (or to opponent/entity if no ground target).
        const oppIdx2 = playerIndex === 0 ? 1 : 0;
        const oppPos2 = (explicitEntityTarget && enemyApplied)
          ? explicitEntityTarget.position
          : state.players[oppIdx2].position;
        const fallbackTargetX = effTarget?.position?.x ?? oppPos2.x ?? source.position.x;
        const fallbackTargetY = effTarget?.position?.y ?? oppPos2.y ?? source.position.y;
        const gTargetX = castContext?.groundTarget?.x ?? fallbackTargetX;
        const gTargetY = castContext?.groundTarget?.y ?? fallbackTargetY;
        const gDx = gTargetX - source.position.x;
        const gDy = gTargetY - source.position.y;
        const gLen = Math.sqrt(gDx * gDx + gDy * gDy);
        if (gLen > 0.01) {
          source.facing = { x: gDx / gLen, y: gDy / gLen };
        }
        // Cap dash distance: if click is closer than max range, only dash that far
        const clickDistGpu = worldUnitsToGameplayUnits(gLen, state.unitScale);
        const cappedValue = gLen > 0.01 ? Math.min(effect.value ?? 20, clickDistGpu) : (effect.value ?? 20);
        // Proportional durationTicks at 40 u/sec so short dashes aren't slowed down
        const cappedDurationTicks = Math.max(1, Math.round((cappedValue / 40) * 30));
        const gtdEffect = { ...effect, type: "DIRECTIONAL_DASH" as const, dirMode: "TOWARD" as const, value: cappedValue, durationTicks: cappedDurationTicks };
        handleDirectionalDash(state, source, oppPos2, ability, gtdEffect);
        // Height targeting: if groundTarget has an explicit Z, force dash to climb/descend to that height
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

        // Apply the KNOCKED_BACK buff via official system (checks immunity).
        // If immune, addBuff silently returns — skip setting the activeDash too.
        const knockedBackBuffDef = ability.buffs?.find((b: any) => b.buffId === 9201);
        if (!knockedBackBuffDef) break;

        // Check knockback immunity before committing (addBuff would also catch it,
        // but we need to know whether to set activeDash).
        if (hasKnockbackImmune(kbTarget)) break;

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
          buff: { ...knockedBackBuffDef, durationMs: 1_000 },
        });
        break;
      }

      case "WUJIAN_CHANNEL":
      case "XINZHENG_CHANNEL":
        handleChannelEffect(state, source, enemy, ability, effect);
        break;

      case "BAIZU_AOE": {
        const now = Date.now();
        const center = castContext?.groundTarget
          ? { x: castContext.groundTarget.x, y: castContext.groundTarget.y }
          : (explicitEntityTarget
            ? { x: explicitEntityTarget.position.x, y: explicitEntityTarget.position.y }
            : { x: target.position.x, y: target.position.y });
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
          z: castContext?.groundTarget
            ? (source.position?.z ?? 0)
            : (explicitEntityTarget ? (explicitEntityTarget.position?.z ?? 0) : (target.position?.z ?? 0)),
          height: gameplayUnitsToWorldUnits(10, storedUnitScale),
          radius,
          expiresAt: now + 1_000,
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
          ? { x: castContext.groundTarget.x, y: castContext.groundTarget.y }
          : (explicitEntityTarget
            ? { x: explicitEntityTarget.position.x, y: explicitEntityTarget.position.y }
            : { x: target.position.x, y: target.position.y });
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
          z: castContext?.groundTarget
            ? (source.position?.z ?? 0)
            : (explicitEntityTarget ? (explicitEntityTarget.position?.z ?? 0) : (target.position?.z ?? 0)),
          height: gameplayUnitsToWorldUnits(10, storedUnitScale),
          radius,
          expiresAt: now + 1_000,
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
            if (resultBg.hpDamage > 0) {
              processOnDamageTaken(state, victim as any, resultBg.hpDamage, source.userId);
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

        if (!state.groundZones) state.groundZones = [];
        state.groundZones.push({
          id: randomUUID(),
          ownerUserId: source.userId,
          x: center.x,
          y: center.y,
          z: zoneZ,
          height: gameplayUnitsToWorldUnits(effect.zoneHeight ?? 10, storedUnitScale),
          radius: gameplayUnitsToWorldUnits(effect.range ?? 8, storedUnitScale),
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

      case "DISPEL_BUFF_ATTRIBUTE": {
        // Remove BUFF-category buffs per listed attribute from the target.
        // count (default 1) controls how many per attribute to remove.
        // Respects dodge via the shouldSkipDueToDodge check above (which runs before switch).
        if (!enemyApplied) break;
        const { overrides: buffOverrides } = loadBuffEditorOverrides();
        const attrs: string[] = (effect as any).attributes ?? [];
        const dispelCount: number = (effect as any).count ?? 1;
        for (const attr of attrs) {
          let dispelled = 0;
          while (dispelled < dispelCount) {
            const idx = effTarget.buffs.findIndex((b: any) => {
              if (b.category !== "BUFF") return false;
              const entry = buffOverrides[String(b.buffId)];
              return entry?.attribute === attr;
            });
            if (idx === -1) break;
            const removed = effTarget.buffs[idx];
            removeLinkedShield(effTarget as any, removed);
            effTarget.buffs.splice(idx, 1);
            pushBuffExpired(state, {
              targetUserId: effTarget.userId,
              buffId: removed.buffId,
              buffName: removed.name,
              buffCategory: removed.category,
              sourceAbilityId: removed.sourceAbilityId,
              sourceAbilityName: removed.sourceAbilityName,
            });
            dispelled++;
          }
        }
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
            const settDmg = resolveScheduledDamage({ source, target: effTarget, base: totalDmg, damageType: (ability as any).damageType });
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
              if (resultSett.hpDamage > 0) {
                processOnDamageTaken(state, effTarget as any, resultSett.hpDamage, source.userId);
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
        const hasLieRi = effTarget.buffs.some((b: any) => b.buffId === LIE_RI_ZHAN_DEBUFF_ID);
        const mult = hasLieRi ? 2 : 1;

        const baseDmg = (effect.value ?? 2) * mult;
        const yyzDmg = resolveScheduledDamage({ source, target: effTarget, base: baseDmg, damageType: (ability as any).damageType });
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
          if (resultYyz.hpDamage > 0) {
            processOnDamageTaken(state, effTarget as any, resultYyz.hpDamage, source.userId);
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
        const hasYinYue = effTarget.buffs.some((b: any) => b.buffId === YIN_YUE_ZAN_DOT_BUFF_ID);
        const mult = hasYinYue ? 2 : 1;

        const baseDmg = (effect.value ?? 4) * mult;
        const lrzDmg = resolveScheduledDamage({ source, target: effTarget, base: baseDmg, damageType: (ability as any).damageType });
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
          if (resultLrz.hpDamage > 0) {
            processOnDamageTaken(state, effTarget as any, resultLrz.hpDamage, source.userId);
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
        const jilePulledBuffDef = ability.buffs?.find((b: any) => b.buffId === 9203);
        // Pull speed: 20 gameplay units/sec (same as DASH)
        const PULL_SPEED_WORLD_PER_TICK = gameplayUnitsToWorldUnits(20, state.unitScale) / 30;
        const STOP_DISTANCE = gameplayUnitsToWorldUnits(1, state.unitScale);
        for (const candidate of getImmediateEnemyBuffTargets(state, source.userId, source.position, jileRange)) {
          const target = candidate.target as any;
          const cdx = target.position.x - source.position.x;
          const cdy = target.position.y - source.position.y;
          const cdist = Math.hypot(cdx, cdy);
          if (cdist <= STOP_DISTANCE) continue; // already close enough
          // Check knockback immunity (pull = forced movement)
          if (target.buffs?.some((b: any) => b.effects?.some((e: any) => e.type === "KNOCKBACK_IMMUNE"))) continue;
          const dirX = cdx / cdist;
          const dirY = cdy / cdist;
          // Pull toward caster: velocity is negative of direction (toward caster)
          const travelDist = cdist - STOP_DISTANCE;
          const ticksNeeded = Math.max(1, Math.ceil(travelDist / PULL_SPEED_WORLD_PER_TICK));
          const durationMs = Math.ceil(ticksNeeded * (1000 / 30));
          if (candidate.kind === "player") {
            // Set activeDash on the target flying toward caster
            target.activeDash = {
              abilityId: "ji_le_yin",
              vxPerTick: -dirX * PULL_SPEED_WORLD_PER_TICK,
              vyPerTick: -dirY * PULL_SPEED_WORLD_PER_TICK,
              ticksRemaining: ticksNeeded,
            } as any;
          } else if (candidate.kind === "entity") {
            // Entities use their own simple activeDash (no input/jump/collision).
            target.activeDash = {
              abilityId: "ji_le_yin",
              vxPerTick: -dirX * PULL_SPEED_WORLD_PER_TICK,
              vyPerTick: -dirY * PULL_SPEED_WORLD_PER_TICK,
              ticksRemaining: ticksNeeded,
            };
          }
          // Apply PULLED buff (blocks casting during pull; expires naturally)
          if (jilePulledBuffDef) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: target.userId,
              ability,
              buffTarget: target,
              buff: { ...jilePulledBuffDef, durationMs },
            });
          }
          // Apply stun immediately — it will still be active after pull ends
          if (jileStunBuffDef) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: target.userId,
              ability,
              buffTarget: target,
              buff: jileStunBuffDef,
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
        const knockedBackBuff = Array.isArray(ability.buffs)
          ? ability.buffs.find((b: any) => b.buffId === 1341)
          : null;
        const center = { x: primary.position.x, y: primary.position.y };
        for (const candidate of getImmediateEnemyBuffTargets(state, source.userId, center, aoeRadius)) {
          const t: any = candidate.target;
          if (t === primary) continue; // exclude primary
          if (hasKnockbackImmune(t)) continue;
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

          if (knockedBackBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: t.userId,
              ability,
              buffTarget: t,
              buff: { ...knockedBackBuff, durationMs: Math.max(1_000, Math.ceil((kbTicks * 1000) / 30)) },
            });
          }
        }
        break;
      }

      // ─── 拿云式: true damage that ignores DR/shield/dodge but is blocked
      // by INVULNERABLE/UNTARGETABLE/DAMAGE_IMMUNE. ─────────────────────────
      case "TRUE_DAMAGE": {
        const tdTarget = effTarget;
        if (!tdTarget || tdTarget.userId === source.userId || (tdTarget.hp ?? 0) <= 0) break;
        // Honor invulnerable / untargetable / damage immune.
        if (blocksEnemyTargeting(tdTarget) || hasDamageImmune(tdTarget)) {
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
        const td = Math.max(0, Math.floor(effect.value ?? 0));
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

      // ─── 梯云纵: refresh 蹑云逐月 cooldown on caster. ───────────────────
      case "TI_YUN_ZONG_REFRESH": {
        const inst = (source as any).hand?.find?.(
          (a: any) => a.abilityId === "nieyun_zhuyue",
        );
        if (inst) {
          inst.cooldown = 0;
          inst._cooldownProgress = 0;
        }
        break;
      }

      // ─── 疾电叱羽: place HP-bearing redirect zone below caster. ────────
      case "PLACE_JI_DIAN_ZONE": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const hpVal = Math.max(1, Number(effect.value ?? 40));
        const rangeUnits = Number((effect as any).range ?? 8);
        const durationMs = Number((effect as any).zoneDurationMs ?? 8_000);
        if (!state.groundZones) state.groundZones = [];
        const zoneId = randomUUID();
        state.groundZones.push({
          id: zoneId,
          ownerUserId: source.userId,
          x: source.position.x,
          y: source.position.y,
          z: source.position.z ?? 0,
          height: gameplayUnitsToWorldUnits(20, storedUnitScale),
          radius: gameplayUnitsToWorldUnits(rangeUnits, storedUnitScale),
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

      // ─── 振翅图南 / 飞刃回转: place follow-target damage zone. ──────────
      case "PLACE_FOLLOW_ZONE": {
        const now = Date.now();
        const storedUnitScale = state.unitScale;
        const dmg = Math.max(0, Number(effect.value ?? 1));
        const rangeUnits = Number((effect as any).range ?? 5);
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
        if (enemyTarget) {
          cx = enemyTarget.position.x;
          cy = enemyTarget.position.y;
          cz = enemyTarget.position.z ?? 0;
          followUid = enemyTarget.userId;
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
          height: gameplayUnitsToWorldUnits(10, storedUnitScale),
          radius: gameplayUnitsToWorldUnits(rangeUnits, storedUnitScale),
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
          height: gameplayUnitsToWorldUnits(20, storedUnitScale),
          radius: gameplayUnitsToWorldUnits(startUnits, storedUnitScale),
          expiresAt: now + durationMs,
          damagePerInterval: 0,
          intervalMs: 1_000,
          lastTickAt: now,
          abilityId: "tian_jue_di_mie",
          abilityName: "天绝地灭",
          growStartRadius: gameplayUnitsToWorldUnits(startUnits, storedUnitScale),
          growEndRadius: gameplayUnitsToWorldUnits(endUnits, storedUnitScale),
          growStartedAt: now,
          growDurationMs,
          explodeOnExpire: true,
          explodeDamage: explodeDmg,
          pullSpeedPerTick: gameplayUnitsToWorldUnits(40, storedUnitScale) / 30,
        } as any);
        break;
      }

      // ─── 龙啸九天: cleanse self, apply 龙威 + 龙啸九天 + 定身 buffs,
      // AOE 6u: 1 damage + slow knockback (10u over `durationTicks` ticks). ─
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
        const knockedBackBuff = (ability.buffs ?? []).find((b: any) => b.buffId === 1352);

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
          if (hasKnockbackImmune(t)) continue;
          const dx = t.position.x - source.position.x;
          const dy = t.position.y - source.position.y;
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

          if (knockedBackBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: t.userId,
              ability,
              buffTarget: t,
              buff: { ...knockedBackBuff, durationMs: Math.max(1_000, Math.ceil((kbTicks * 1000) / 30)) },
            });
          }
        }
        break;
      }

      // ─── 临时飞爪: ground-target dash without dash CC-immunity buff ────────
      case "LIN_SHI_FEI_ZHUA_DASH": {
        // Always use mouse ground-target position — NEVER fall back to opponent position
        const gTargetX2 = castContext?.groundTarget?.x;
        const gTargetY2 = castContext?.groundTarget?.y;
        const hasGroundTarget = gTargetX2 !== undefined && gTargetY2 !== undefined;
        const tX = hasGroundTarget ? gTargetX2! : source.position.x + (source.facing?.x ?? 0) * gameplayUnitsToWorldUnits(effect.value ?? 40, state.unitScale);
        const tY = hasGroundTarget ? gTargetY2! : source.position.y + (source.facing?.y ?? 1) * gameplayUnitsToWorldUnits(effect.value ?? 40, state.unitScale);
        const gDx2 = tX - source.position.x;
        const gDy2 = tY - source.position.y;
        const gLen2 = Math.sqrt(gDx2 * gDx2 + gDy2 * gDy2);
        const linMaxDistWorld = gameplayUnitsToWorldUnits(effect.value ?? 40, state.unitScale);
        const linActualWorld = Math.min(linMaxDistWorld, gLen2 > 0.01 ? gLen2 : linMaxDistWorld);
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
          const periodicMs2 = jztdBuffDef?.periodicMs ?? 3000;
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
          const finalBurst = resolveScheduledDamage({ source, target: effTarget, base: burstDmg, damageType: (ability as any).damageType });
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
            if (resultBurst.hpDamage > 0) {
              processOnDamageTaken(state, effTarget as any, resultBurst.hpDamage, source.userId);
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
          const dmg1 = resolveScheduledDamage({ source, target: effTarget, base: 1, damageType: (ability as any).damageType });
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
            if (resultJ1.hpDamage > 0) {
              processOnDamageTaken(state, effTarget as any, resultJ1.hpDamage, source.userId);
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

      // ─── 破风: 2 damage + 破风 debuff + 流血, extra 流血 if CONTROL_IMMUNE ──
      case "PO_FENG_STRIKE": {
        if (!enemyApplied) break;
        const pfDmg = resolveScheduledDamage({ source, target: effTarget, base: 2, damageType: (ability as any).damageType });
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
          if (resultPf.hpDamage > 0) {
            processOnDamageTaken(state, effTarget as any, resultPf.hpDamage, source.userId);
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
          if (mieResult.hpDamage > 0) {
            processOnDamageTaken(state, effTarget as any, mieResult.hpDamage, source.userId);
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
}
