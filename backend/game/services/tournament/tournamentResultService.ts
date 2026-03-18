/**
 * Tournament result handling - called when a battle ends
 * Applies damage to game HP, advances tournament state
 */

import { GameState, TournamentState } from "../../engine/state/types";
import { completeBattle, getLoserDamage, awardGoldIncome } from "../economy/tournamentService";
import { GOLD_PER_ROUND } from "../../engine/state/types";
import { PlayerID } from "../../engine/state/types/common";

/**
 * Handle battle completion within the tournament
 * Called when a battle's gameOver flag is set to true
 */
export function completeTournamentBattle(
  battleState: GameState,
  tournament: TournamentState
): TournamentState {
  if (!battleState.gameOver || !battleState.winnerUserId) {
    return tournament;
  }

  const winnerId = battleState.winnerUserId as PlayerID;
  const loserId = battleState.players.find((p) => p.userId !== winnerId)?.userId as PlayerID;

  // Award gold income to both players
  for (const playerId of [winnerId, loserId]) {
    awardGoldIncome(tournament, playerId, GOLD_PER_ROUND);
  }

  // Complete battle in tournament (applies damage, advances to next battle/draft)
  completeBattle(tournament, winnerId, loserId);

  return tournament;
}
