/**
 * Battle initialization service
 * Handles creating game state for a new battle from drafted abilities
 */

import { GameState, PlayerState } from "../../engine/state/types";
import { TournamentState } from "../../engine/state/types";
import { STARTING_BATTLE_HP } from "../../engine/state/types";
import { PlayerID } from "../../engine/state/types/common";
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

  // Create "decks" from selected abilities
  // Shuffle and draw initial hands
  const deck0Shuffled = abilities0
    .map((a) => ({ ...a, instanceId: randomUUID() })) // Create new instances for this battle
    .sort(() => Math.random() - 0.5);

  const deck1Shuffled = abilities1
    .map((a) => ({ ...a, instanceId: randomUUID() }))
    .sort(() => Math.random() - 0.5);

  // Draw opening hands (3 cards each for now - can adjust)
  const hand0 = deck0Shuffled.splice(0, 3);
  const hand1 = deck1Shuffled.splice(0, 3);

  // Remaining cards go to deck
  const state: GameState = {
    version: 1,
    turn: 0,
    activePlayerIndex: 0,

    deck: [...deck0Shuffled, ...deck1Shuffled], // Shared deck (not really used, abilities stay in hand)
    discard: [],
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
