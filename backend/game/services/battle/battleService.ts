/**
 * Battle initialization service
 * Handles creating game state for a new battle from drafted abilities
 */

import { GameState, PlayerState } from "../../engine/state/types";
import { TournamentState } from "../../engine/state/types";
import { STARTING_BATTLE_HP } from "../../engine/state/types";
import { PlayerID } from "../../engine/state/types/common";
import { CardInstance } from "../../engine/state/types/cards";
import { CARDS } from "../../cards/cards";
import { randomUUID } from "crypto";

/**
 * Create a new battle game state from drafted abilities
 * Called when transitioning from draft to battle
 */
export function initializeBattleState(
  tournament: TournamentState,
  playerIds: [PlayerID, PlayerID]
): GameState {
  const player0Id = playerIds[0];
  const player1Id = playerIds[1];

  const abilities0 = tournament.selectedAbilities[player0Id];
  const abilities1 = tournament.selectedAbilities[player1Id];

  // Create fresh instances of abilities for this battle with cooldown reset
  const hand0: CardInstance[] = abilities0
    .map((a) => ({ ...a, instanceId: randomUUID(), cooldown: 0 }));

  const hand1: CardInstance[] = abilities1
    .map((a) => ({ ...a, instanceId: randomUUID(), cooldown: 0 }));

  // All abilities in hand - no deck, no drawing, reusable with cooldowns
  const state: GameState = {
    version: 1,
    turn: 0,
    activePlayerIndex: 0,

    gameOver: false,

    players: [
      {
        userId: player0Id,
        hp: STARTING_BATTLE_HP,
        hand: hand0,
        buffs: [],
        gcd: 1, // Active player gets 1 GCD to start
      },
      {
        userId: player1Id,
        hp: STARTING_BATTLE_HP,
        hand: hand1,
        buffs: [],
        gcd: 0, // Will be set to 1 when turn starts
      },
    ],

    events: [],
  };

  return state;
}
