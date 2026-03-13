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

// Arena dimensions (must match frontend arena size)
const ARENA_WIDTH = 100;
const ARENA_HEIGHT = 100;

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

        // ✅ Real-time 2D arena positioning
        // Player 0 starts on left side
        position: {
          x: ARENA_WIDTH * 0.25,
          y: ARENA_HEIGHT / 2,
        },
        velocity: { vx: 0, vy: 0 },
        moveSpeed: 1.0, // units per tick at 60Hz = ~60 units/second
      },
      {
        userId: player1Id,
        hp: STARTING_BATTLE_HP,
        hand: hand1,
        buffs: [],
        gcd: 0, // Will be set to 1 when turn starts

        // Player 1 starts on right side
        position: {
          x: ARENA_WIDTH * 0.75,
          y: ARENA_HEIGHT / 2,
        },
        velocity: { vx: 0, vy: 0 },
        moveSpeed: 1.0,
      },
    ],

    events: [],
  };

  return state;
}
