// backend/game/engine/flow/turn/gameOver.ts

import { GameState } from "../../state/types";

/**
 * Check if battle is over (someone's HP reached 0)
 * For tournament games: don't set gameOver yet, battle/complete endpoint handles tournament progression
 * For non-tournament games: set gameOver to end the game
 */
export function checkGameOver(state: GameState) {
  for (const p of state.players) {
    if (p.hp <= 0) {
      // Find winner (the other player)
      const winner = state.players.find((x) => x.userId !== p.userId);
      if (winner) {
        state.winnerUserId = winner.userId;
      }

      // Mark battle as over so frontend knows to call battle/complete
      state.gameOver = true;
      return true;
    }
  }
  return false;
}
