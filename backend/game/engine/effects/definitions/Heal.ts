// backend/game/engine/effects/handlers/handleHeal.ts

import {
  GameState,
  Card,
  CardEffect,
  ActiveBuff,
} from "../../state/types";
import { resolveHealAmount } from "../../utils/combatMath";
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
  card: Card,
  effect: CardEffect
) {
  const base = effect.value ?? 0;

  const final = resolveHealAmount({
    target,
    base,
  });

  const before = target.hp;
  target.hp = Math.min(100, target.hp + final);
  const applied = Math.max(0, target.hp - before);

  if (applied > 0) {
    pushEvent(state, {
      turn: state.turn,
      type: "HEAL",
      actorUserId: source.userId,
      targetUserId: target.userId,
      cardId: card.id,
      cardName: card.name,
      effectType: "HEAL",
      value: applied,
    });
  }
}
