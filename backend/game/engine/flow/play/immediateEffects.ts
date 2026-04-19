// engine/flow/applyImmediateEffects.ts
import { randomUUID } from "crypto";
import { resolveEffectTargetIndex } from "../../utils/targeting";
import { blocksEnemyTargeting, isEnemyEffect, shouldSkipDueToDodge } from "../../rules/guards";
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
import { gameplayUnitsToWorldUnits } from "../../state/types";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { applyDamageToTarget } from "../../utils/health";
import { addBuff, pushBuffExpired } from "../../effects/buffRuntime";
import {
  applyZhenShanHeSelfCastBuff,
  pulseZhenShanHeTarget,
  ZHEN_SHAN_HE_ABILITY_ID,
} from "../../effects/definitions/ZhenShanHe";
import { getGroundHeightForMap, type MapContext } from "../../loop/movement";

const WUFANG_ROOT_BUFF_ID = 1330;
const WUFANG_HIT_PROTECT_BUFF_ID = 1331;
const WUFANG_HIT_PROTECT_RATIO = 0.5;
const WUFANG_HUISHEN_BUFF_ID = 1336;

const BANG_DA_GOU_TOU_XINCHU_YI_BUFF_ID = 1332;
const BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID = 1333;
const BANG_DA_GOU_TOU_ROOT_BUFF_ID = 1334;
const BANG_DA_GOU_TOU_CONTROL_BUFF_ID = 1335;

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
    groundTarget?: { x: number; y: number };
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

  for (const effect of ability.effects) {
    const effTargetIndex = resolveEffectTargetIndex(
      targetIndex,
      playerIndex,
      effect.applyTo
    );
    const effTarget = state.players[effTargetIndex];
    const enemyApplied = isEnemyEffect(source, effTarget, effect);

    if (shouldSkipDueToDodge(abilityDodged, enemyApplied)) continue;

    switch (effect.type) {
      case "DAMAGE":
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

      case "DASH":
        handleDash(state, source, effTarget, enemyApplied, ability, effect);
        break;

      case "DIRECTIONAL_DASH": {
        // Always targets self — the opponent position is used only for orientation
        const oppIdx = playerIndex === 0 ? 1 : 0;
        const oppPos = state.players[oppIdx].position;
        handleDirectionalDash(state, source, oppPos, ability, effect);
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
          : { x: target.position.x, y: target.position.y };
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
          z: castContext?.groundTarget ? (source.position?.z ?? 0) : (target.position?.z ?? 0),
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

        for (const victim of state.players) {
          if (victim.userId === source.userId) continue;
          if ((victim.hp ?? 0) <= 0) continue;

          const dx = (victim.position?.x ?? 0) - center.x;
          const dy = (victim.position?.y ?? 0) - center.y;
          if (Math.hypot(dx, dy) > radius) continue;
          if (blocksEnemyTargeting(victim)) continue;

          const dmg = resolveScheduledDamage({
            source,
            target: victim,
            base: effect.value ?? 0,
          });
          applyDamageToTarget(victim as any, dmg);

          if (dmg > 0) {
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
              value: dmg,
            });
          }

          if (baizuBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.userId,
              ability,
              buffTarget: victim,
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
          : { x: target.position.x, y: target.position.y };
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
          z: castContext?.groundTarget ? (source.position?.z ?? 0) : (target.position?.z ?? 0),
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

        for (const victim of state.players) {
          if (victim.userId === source.userId) continue;
          if ((victim.hp ?? 0) <= 0) continue;

          const dx = (victim.position?.x ?? 0) - center.x;
          const dy = (victim.position?.y ?? 0) - center.y;
          if (Math.hypot(dx, dy) > radius) continue;
          if (blocksEnemyTargeting(victim)) continue;
          hitAtLeastOneEnemy = true;

          const dmg = resolveScheduledDamage({
            source,
            target: victim,
            base: effect.value ?? 0,
          });
          applyDamageToTarget(victim as any, dmg);

          if (dmg > 0) {
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
              value: dmg,
            });
          }

          if (rootBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.userId,
              ability,
              buffTarget: victim,
              buff: rootBuff,
            });

            const appliedRoot = victim.buffs.find(
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
                targetUserId: victim.userId,
                ability,
                buffTarget: victim,
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
        } else {
          const dmg = resolveScheduledDamage({
            source,
            target: victim,
            base: reachDamage,
          });
          applyDamageToTarget(victim as any, dmg);
          if (dmg > 0) {
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
              value: dmg,
            });
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
        for (const victim of state.players) {
          if (victim.userId === source.userId) continue;
          if ((victim.hp ?? 0) <= 0) continue;
          if (blocksEnemyTargeting(victim)) continue;

          const dx = (victim.position?.x ?? 0) - (source.position?.x ?? 0);
          const dy = (victim.position?.y ?? 0) - (source.position?.y ?? 0);
          if (Math.hypot(dx, dy) > radius) continue;

          for (const buffDef of ability.buffs) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.userId,
              ability,
              buffTarget: victim,
              buff: buffDef,
            });
          }
        }
        break;
      }

      default:
        break;
    }
  }
}
