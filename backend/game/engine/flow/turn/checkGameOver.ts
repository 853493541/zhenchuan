// backend/game/engine/flow/turn/gameOver.ts

import { GameState } from "../../state/types";

/**
 * Check if battle is over (someone's HP reached 0)
 * For tournament games: don't set gameOver yet, battle/complete endpoint handles tournament progression
 * For non-tournament games: set gameOver to end the game
 */
export function checkGameOver(state: GameState) {
  const alive = state.players.filter((p) => p.hp > 0);
  if (alive.length <= 1) {
    state.winnerUserId = alive[0]?.userId;
    state.gameOver = true;
    return true;
  }
  return false;
}
