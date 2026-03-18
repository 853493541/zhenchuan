// engine/flow/applyCard.ts

import { GameState, Card } from "../../state/types";
import { getEnemy } from "../../utils/targeting";
import { pushEvent } from "../../../services/flow/events";

import { breakOnPlay } from "./breakOnPlay";
import { computeCardDodge } from "../../rules/dodge";
import { applyImmediateEffects } from "./immediateEffects";
import { applyCardBuffs } from "./buffs";
import { checkGameOver } from "../turn/checkGameOver";

export function applyCard(
  state: GameState,
  card: Card,
  playerIndex: number,
  targetIndex: number
) {
  if (state.gameOver) return;

  const source = state.players[playerIndex];
  const target = state.players[targetIndex];
  const enemy = getEnemy(state, playerIndex);

  /**
   * ================= GCD SPEND =================
   * Validation already happened in validatePlayCard
   * This is the single authoritative place where GCD is consumed
   */
  pushEvent(state, {
    turn: state.turn,
    type: "PLAY_CARD",
    actorUserId: source.userId,
    targetUserId: target.userId,
    cardId: card.id,
    cardName: card.name,
  });

  breakOnPlay(source);

  const opponentHpAtStart = target.hp;
  const cardDodged = computeCardDodge(card, target);

  applyImmediateEffects({
    state,
    card,
    source,
    target,
    enemy,
    playerIndex,
    targetIndex,
    opponentHpAtStart,
    cardDodged,
  });

  applyCardBuffs({
    state,
    card,
    source,
    target,
    cardDodged,
  });

  checkGameOver(state);
}
