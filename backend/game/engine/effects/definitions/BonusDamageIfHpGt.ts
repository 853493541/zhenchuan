// backend/game/engine/effects/handlers/handleBonusDamageIfHpGt.ts

import { GameState, Card, CardEffect, ActiveBuff } from "../../state/types";
import { blocksEnemyTargeting } from "../../rules/guards";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { pushEvent } from "../events";

export function handleBonusDamageIfHpGt(
  state: GameState,
  source: { userId: string; hp: number; buffs: ActiveBuff[] },
  target: { userId: string; hp: number; buffs: ActiveBuff[] },
  opponentHpAtCardStart: number,
  card: Card,
  effect: CardEffect
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
      cardId: card.id,
      cardName: card.name,
      effectType: "DAMAGE",
      value: 0,
    });
    return;
  }

  const final = resolveScheduledDamage({
    source,
    target,
    base: bonus,
  });

  if (final > 0) {
    target.hp = Math.max(0, target.hp - final);
  }

  pushEvent(state, {
    turn: state.turn,
    type: "DAMAGE",
    actorUserId: source.userId,
    targetUserId: target.userId,
    cardId: card.id,
    cardName: card.name,
    effectType: "DAMAGE",
    value: final,
  });
}
