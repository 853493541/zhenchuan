/**
 * Battle initialization service
 * Handles creating game state for a new battle from drafted abilities
 */

import { GameState, PlayerState } from "../../engine/state/types";
import { TournamentState } from "../../engine/state/types";
import { STARTING_BATTLE_HP } from "../../engine/state/types";
import { PlayerID } from "../../engine/state/types/common";
import { AbilityInstance } from "../../engine/state/types/abilities";
import { ABILITIES } from "../../abilities/abilities";
import { randomUUID } from "crypto";

// Arena dimensions (must match frontend arena size)
const ARENA_WIDTH = 100;
const ARENA_HEIGHT = 100;

/** IDs of common abilities that every player always has, regardless of draft. */
const COMMON_ABILITY_IDS = [
  "menghu_xiasha",
  "fuyao_zhishang",
  "nieyun_zhuyue",
  "lingxiao_lansheng",
  "yaotai_zhenhe",
  "yingfeng_huilang",
  "houyao",
  "yuqi",
];

function makeCommonAbilities(): AbilityInstance[] {
  return COMMON_ABILITY_IDS.map((id) => ({
    instanceId: randomUUID(),
    abilityId: id,
    cooldown: 0,
  }));
}

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
  const hand0: AbilityInstance[] = [
    ...abilities0.map((a) => ({ ...a, instanceId: randomUUID(), cooldown: 0 })),
    ...makeCommonAbilities(),
  ];

  const hand1: AbilityInstance[] = [
    ...abilities1.map((a) => ({ ...a, instanceId: randomUUID(), cooldown: 0 })),
    ...makeCommonAbilities(),
  ];

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

        // ✅ Real-time 2D arena positioning
        // Player 0 starts on left side
        position: {
          x: ARENA_WIDTH * 0.25,
          y: ARENA_HEIGHT / 2,
        },
        velocity: { vx: 0, vy: 0 },
        facing: { x: 1, y: 0 },
        moveSpeed: 0.25, // 7.5 units/sec at 30 Hz (0.25 u/tick)
      },
      {
        userId: player1Id,
        hp: STARTING_BATTLE_HP,
        hand: hand1,
        buffs: [],

        // Player 1 starts on right side
        position: {
          x: ARENA_WIDTH * 0.75,
          y: ARENA_HEIGHT / 2,
        },
        velocity: { vx: 0, vy: 0 },
        facing: { x: -1, y: 0 },
        moveSpeed: 0.25, // 7.5 units/sec at 30 Hz
      },
    ],

    events: [],
  };

  return state;
}
