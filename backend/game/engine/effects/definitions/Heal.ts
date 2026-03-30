// backend/game/engine/effects/handlers/handleHeal.ts

import {
  GameState,
  Ability,
  AbilityEffect,
  ActiveBuff,
} from "../../state/types";
import { resolveHealAmount } from "../../utils/combatMath";
import { applyHealToTarget } from "../../utils/health";
import { pushEvent } from "../events";

/**
 * HEAL EFFECT HANDLER
 *
 * ENGINE CONTRACT:
 * - combatMath.resolveHealAmount requires target to have { buffs: ActiveBuff[] }
 * - Therefore target MUST include buffs
 */
export function handleHeal(
  state: GameState,
  source: { userId: string; hp: number; buffs: ActiveBuff[] },
  target: { userId: string; hp: number; buffs: ActiveBuff[] },
  ability: Ability,
  effect: AbilityEffect
) {
  const base = effect.value ?? 0;

  const final = resolveHealAmount({
    target,
    base,
  });

  const applied = applyHealToTarget(target as any, final);

  if (applied > 0) {
    pushEvent(state, {
      turn: state.turn,
      type: "HEAL",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "HEAL",
      value: applied,
    });
  }
}
