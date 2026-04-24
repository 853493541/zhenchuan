// backend/game/engine/effects/handlers/handleDamage.ts

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { blocksEnemyTargeting, hasDamageImmune } from "../../rules/guards";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { applyDamageToTarget } from "../../utils/health";
import { pushEvent } from "../events";
import { processOnDamageTaken } from "../onDamageHooks";

/**
 * Handle immediate DAMAGE effects.
 *
 * IMPORTANT (engine contract):
 * - guards.ts expects target to have { buffs: ActiveBuff[] }
 * - combatMath expects source/target to have { buffs: ActiveBuff[] }
 * - Therefore source/target here MUST include buffs
 */
export function handleDamage(
  state: GameState,
  source: { userId: string; hp: number; buffs: ActiveBuff[] },
  target: { userId: string; hp: number; buffs: ActiveBuff[] },
  isEnemyEffect: boolean,
  ability: Ability,
  effect: AbilityEffect
) {
  // Enemy targeting can be blocked (e.g. untargetable / dodge-style buffs)
  if (isEnemyEffect && blocksEnemyTargeting(target)) {
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: 0,
    });
    return;
  }

  // 雷霆震怒 damage immunity: block all incoming enemy damage
  if (isEnemyEffect && hasDamageImmune(target)) {
    return;
  }

  const base = effect.value ?? 0;

  const final = resolveScheduledDamage({
    source,
    target,
    base,
    abilityId: ability.id,
  });

  if (final > 0) {
    const { hpDamage: actualHpDamage } = applyDamageToTarget(target as any, final);

    // Trigger on-damage effects (七星拱瑞 break, 玄水蛊 redirect) for ALL
    // damage sources — no isEnemyEffect restriction.
    processOnDamageTaken(state, target as any, actualHpDamage, source.userId);
  } else {
    // final === 0: still run applyDamageToTarget for event consistency
  }

  pushEvent(state, {
    turn: state.turn,
    type: "DAMAGE",
    actorUserId: source.userId,
    targetUserId: target.userId,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType: "DAMAGE",
    value: final,
  });
}
