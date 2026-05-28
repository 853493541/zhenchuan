// backend/game/engine/flow/turn/gameOver.ts

import { randomUUID } from "crypto";
import { GameState } from "../../state/types";
import { isYumen1v1BasicMode } from "../../../modes";

/**
 * Check if battle is over (someone's HP reached 0)
 * For tournament games: don't set gameOver yet, battle/complete endpoint handles tournament progression
 * For non-tournament games: set gameOver to end the game
 */
export function resetDefeatedPlayersForTesting(state: GameState): boolean {
  if (isYumen1v1BasicMode((state as any).mode)) return false;

  const defeatedPlayers = state.players.filter((player) => player.hp <= 0);
  if (defeatedPlayers.length === 0) return false;

  const now = Date.now();
  for (const player of defeatedPlayers) {
    const maxHp = Math.max(1, Number(player.maxHp ?? player.hp ?? 100));
    const healAmount = Math.max(0, maxHp - Math.max(0, Number(player.hp ?? 0)));
    player.hp = maxHp;

    if (healAmount > 0) {
      state.events.push({
        id: randomUUID(),
        timestamp: now,
        turn: state.turn,
        type: "HEAL",
        actorUserId: player.userId,
        targetUserId: player.userId,
        abilityId: "testing_full_heal",
        abilityName: "测试重置",
        effectType: "TESTING_FULL_HEAL" as any,
        value: healAmount,
      });
    }
  }

  state.gameOver = false;
  delete (state as any).winnerUserId;
  return true;
}

export function checkGameOver(state: GameState) {
  return resetDefeatedPlayersForTesting(state);
}
