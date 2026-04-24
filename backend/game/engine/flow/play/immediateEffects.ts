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

      case "GROUND_TARGET_DASH": {
        // Compute direction from source to the ground target (or to opponent if no ground target).
        // Then set source.facing to that direction and call handleDirectionalDash with TOWARD.
        const gTargetX = castContext?.groundTarget?.x ?? effTarget.position?.x ?? source.position.x;
        const gTargetY = castContext?.groundTarget?.y ?? effTarget.position?.y ?? source.position.y;
        const gDx = gTargetX - source.position.x;
        const gDy = gTargetY - source.position.y;
        const gLen = Math.sqrt(gDx * gDx + gDy * gDy);
        if (gLen > 0.01) {
          source.facing = { x: gDx / gLen, y: gDy / gLen };
        }
        const oppIdx2 = playerIndex === 0 ? 1 : 0;
        const oppPos2 = state.players[oppIdx2].position;
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
          if (hasDamageImmune(victim as any)) continue;

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
          if (hasDamageImmune(victim as any)) continue;
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
        } else if (!hasDamageImmune(victim as any)) {
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
            const dmg = resolveScheduledDamage({ source, target: effTarget, base: totalDmg });
            applyDamageToTarget(effTarget as any, dmg);
            if (dmg > 0) {
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
                value: dmg,
              });
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

        const nearby: any[] = [];
        for (const victim of state.players) {
          if (victim.userId === source.userId) continue;
          if ((victim.hp ?? 0) <= 0) continue;
          const dx = (victim.position?.x ?? 0) - center.x;
          const dy = (victim.position?.y ?? 0) - center.y;
          if (Math.hypot(dx, dy) > radius) continue;
          if (blocksEnemyTargeting(victim)) continue;
          nearby.push({ victim, dist: Math.hypot(dx, dy) });
        }
        nearby.sort((a, b) => a.dist - b.dist);
        const maxT = effect.maxTargets ?? 6;
        const targets = nearby.slice(0, maxT).map((x) => x.victim);

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
        const dmg = resolveScheduledDamage({ source, target: effTarget, base: baseDmg });
        applyDamageToTarget(effTarget as any, dmg);
        if (dmg > 0) {
          state.events.push({
            id: randomUUID(), timestamp: now, turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "DAMAGE",
            value: dmg,
          });
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
        const dmg = resolveScheduledDamage({ source, target: effTarget, base: baseDmg });
        applyDamageToTarget(effTarget as any, dmg);
        if (dmg > 0) {
          state.events.push({
            id: randomUUID(), timestamp: now, turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "DAMAGE",
            value: dmg,
          });
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

        const victims: any[] = [];
        for (const victim of state.players) {
          if (victim.userId === source.userId) continue;
          if ((victim.hp ?? 0) <= 0) continue;
          const dx = (victim.position?.x ?? 0) - center.x;
          const dy = (victim.position?.y ?? 0) - center.y;
          if (Math.hypot(dx, dy) > radius) continue;
          if (blocksEnemyTargeting(victim)) continue;
          if (hasDamageImmune(victim as any)) continue;
          victims.push(victim);
        }

        const singleHitBonus = victims.length === 1;

        for (const victim of victims) {
          const baseDmg = singleHitBonus ? (effect.value ?? 2) * 2 : (effect.value ?? 2);
          const dmg = resolveScheduledDamage({ source, target: victim, base: baseDmg });
          applyDamageToTarget(victim as any, dmg);
          if (dmg > 0) {
            state.events.push({
              id: randomUUID(), timestamp: now, turn: state.turn,
              type: "DAMAGE",
              actorUserId: source.userId,
              targetUserId: victim.userId,
              abilityId: ability.id,
              abilityName: ability.name,
              effectType: "DAMAGE",
              value: dmg,
            });
          }

          if (dotBuff) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: victim.userId,
              ability,
              buffTarget: victim,
              buff: dotBuff,
            });
          }
        }
        break;
      }

      // ─── 极乐引: instant self-cast AOE pull all enemies within range to 1 unit in front ──
      case "JILE_YIN_AOE_PULL": {
        const jileRange = gameplayUnitsToWorldUnits(effect.value ?? 10, state.unitScale);
        const jileStunBuffDef = ability.buffs?.find((b: any) => b.buffId === 2608);
        for (const candidate of state.players as any[]) {
          if (candidate.userId === source.userId) continue;
          if ((candidate.hp ?? 0) <= 0) continue;
          if (blocksEnemyTargeting(candidate)) continue;
          const cdx = candidate.position.x - source.position.x;
          const cdy = candidate.position.y - source.position.y;
          const cdist = Math.hypot(cdx, cdy);
          if (cdist > jileRange) continue;
          // Pull to 1 unit away from caster in the direction of the enemy
          // (so if enemy is behind, they land 1u behind; if in front, 1u in front)
          const pullDist = gameplayUnitsToWorldUnits(1, state.unitScale);
          if (cdist > 0.001) {
            const dirX = cdx / cdist;
            const dirY = cdy / cdist;
            candidate.position.x = source.position.x + dirX * pullDist;
            candidate.position.y = source.position.y + dirY * pullDist;
          }
          candidate.position.z = source.position.z ?? 0;
          // Apply stun buff to enemy (NOT to self — applyAbilityBuffs is excluded for ji_le_yin)
          if (jileStunBuffDef) {
            addBuff({
              state,
              sourceUserId: source.userId,
              targetUserId: candidate.userId,
              ability,
              buffTarget: candidate,
              buff: jileStunBuffDef,
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
          const finalBurst = resolveScheduledDamage({ source, target: effTarget, base: burstDmg });
          if (finalBurst > 0 && !hasDamageImmune(effTarget as any)) {
            applyDamageToTarget(effTarget as any, finalBurst);
            state.events.push({
              id: randomUUID(), timestamp: Date.now(), turn: state.turn,
              type: "DAMAGE",
              actorUserId: source.userId,
              targetUserId: effTarget.userId,
              abilityId: ability.id,
              abilityName: ability.name,
              effectType: "DAMAGE",
              value: finalBurst,
            } as any);
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
          const dmg1 = resolveScheduledDamage({ source, target: effTarget, base: 1 });
          if (dmg1 > 0 && !hasDamageImmune(effTarget as any)) {
            applyDamageToTarget(effTarget as any, dmg1);
            state.events.push({
              id: randomUUID(), timestamp: Date.now(), turn: state.turn,
              type: "DAMAGE",
              actorUserId: source.userId,
              targetUserId: effTarget.userId,
              abilityId: ability.id,
              abilityName: ability.name,
              effectType: "DAMAGE",
              value: dmg1,
            } as any);
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
        const pfDmg = resolveScheduledDamage({ source, target: effTarget, base: 2 });
        if (pfDmg > 0 && !hasDamageImmune(effTarget as any)) {
          applyDamageToTarget(effTarget as any, pfDmg);
          state.events.push({
            id: randomUUID(), timestamp: Date.now(), turn: state.turn,
            type: "DAMAGE",
            actorUserId: source.userId,
            targetUserId: effTarget.userId,
            abilityId: ability.id,
            abilityName: ability.name,
            effectType: "DAMAGE",
            value: pfDmg,
          } as any);
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

      default:
        break;
    }
  }
}
