// backend/game/engine/effects/handlers/handleDamage.ts

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { blocksEnemyTargeting, hasDamageImmune } from "../../rules/guards";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { applyDamageToTarget } from "../../utils/health";
import { pushEvent } from "../events";
import { processOnDamageTaken, preCheckRedirect, applyRedirectToOpponent } from "../onDamageHooks";

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
    damageType: (ability as any).damageType,
  });

  if (final > 0) {
    // Pre-damage: split redirect so A's DAMAGE event shows net (45%) value.
    const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(
      state,
      target,
      final
    );
    const damageToApply = redirectPlayer ? adjustedDamage : final;

    if (damageToApply > 0) {
      const { hpDamage: actualHpDamage } = applyDamageToTarget(target as any, damageToApply);
      // Post-damage hooks (七星拱瑞 freeze-break, etc.)
      processOnDamageTaken(state, target as any, actualHpDamage, source.userId);
    }

    // Apply the 55% redirect to the opponent (B) directly.
    if (redirectPlayer && redirectAmt > 0) {
      applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
    }

    // Emit A's DAMAGE event with the net value so the float matches actual HP loss.
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: redirectPlayer ? adjustedDamage : final,
    });
  } else {
    // final === 0 (dodge / immune): still emit the zero-damage event.
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
  }
}
