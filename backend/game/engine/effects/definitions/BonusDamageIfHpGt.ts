// backend/game/engine/effects/handlers/handleBonusDamageIfHpGt.ts

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { blocksEnemyTargeting } from "../../rules/guards";
import { resolveScheduledDamageRoll } from "../../utils/combatMath";
import { applyDamageToTarget } from "../../utils/health";
import { pushEvent } from "../events";
import { applyRedirectToOpponent, preCheckRedirect, processOnDamageTaken } from "../onDamageHooks";

export function handleBonusDamageIfHpGt(
  state: GameState,
  source: { userId: string; hp: number; buffs: ActiveBuff[] },
  target: { userId: string; hp: number; buffs: ActiveBuff[] },
  opponentHpAtCardStart: number,
  ability: Ability,
  effect: AbilityEffect
) {
  const threshold = effect.threshold ?? 0;
  const bonus = effect.value ?? 0;

  if (opponentHpAtCardStart <= threshold || bonus <= 0) return;

  if (blocksEnemyTargeting(target)) {
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

  const damageRoll = resolveScheduledDamageRoll({
    source,
    target,
    base: bonus,
    abilityId: ability.id,
    damageType: (ability as any).damageType,
  });
  const final = damageRoll.damage;

  let eventDamage = final;
  let shieldAbsorbed = 0;

  if (final > 0) {
    const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(state, target as any, final);
    eventDamage = adjustedDamage;
    if (adjustedDamage > 0) {
      const result = applyDamageToTarget(target as any, adjustedDamage);
      shieldAbsorbed = result.shieldAbsorbed;
      if (result.hpDamage > 0 || result.shieldAbsorbed > 0) {
        processOnDamageTaken(state, target as any, result.hpDamage, source.userId, result.shieldAbsorbed);
      }
    }
    if (redirectPlayer && redirectAmt > 0) {
      applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
    }
  }

  pushEvent(state, {
    turn: state.turn,
    type: "DAMAGE",
    actorUserId: source.userId,
    targetUserId: target.userId,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType: "DAMAGE",
    value: eventDamage,
    isCrit: damageRoll.isCrit,
    shieldAbsorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
  });
}
