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
import { addBuff } from "../../effects/buffRuntime";

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
