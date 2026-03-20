/**
 * Battle initialization service
 * Handles creating game state for a new battle from drafted abilities
 */

import { GameState, PlayerState, PickupItem } from "../../engine/state/types";
import { TournamentState } from "../../engine/state/types";
import { STARTING_BATTLE_HP } from "../../engine/state/types";
import { PlayerID } from "../../engine/state/types/common";
import { AbilityInstance } from "../../engine/state/types/abilities";
import { ABILITIES } from "../../abilities/abilities";
import { randomUUID } from "crypto";

// Arena dimensions (must match backend arena size)
const ARENA_WIDTH = 2000;
const ARENA_HEIGHT = 2000;

// Pickup spawn positions — spread across the 2000×2000 map with several clusters
// near each player's spawn (P0 ≈ 985,1000 | P1 ≈ 1015,1000).
const PICKUP_SPAWN_POSITIONS: Array<{ x: number; y: number }> = [
  // ── Near P0 spawn ──
  { x:  920, y: 1000 }, { x:  900, y:  940 }, { x:  900, y: 1060 },
  { x:  870, y: 1000 }, { x:  950, y:  920 }, { x:  950, y: 1080 },
  // ── Near P1 spawn ──
  { x: 1080, y: 1000 }, { x: 1100, y:  940 }, { x: 1100, y: 1060 },
  { x: 1130, y: 1000 }, { x: 1050, y:  920 }, { x: 1050, y: 1080 },
  // ── NW quadrant ──
  { x:  250, y:  250 }, { x:  500, y:  200 }, { x:  200, y:  500 },
  { x:  450, y:  450 }, { x:  700, y:  250 }, { x:  250, y:  700 },
  { x:  600, y:  500 }, { x:  350, y:  600 }, { x:  750, y:  650 },
  { x:  150, y:  350 },
  // ── NE quadrant ──
  { x: 1750, y:  250 }, { x: 1500, y:  200 }, { x: 1800, y:  500 },
  { x: 1550, y:  450 }, { x: 1300, y:  250 }, { x: 1750, y:  700 },
  { x: 1400, y:  500 }, { x: 1650, y:  600 }, { x: 1250, y:  650 },
  { x: 1850, y:  350 },
  // ── SW quadrant ──
  { x:  250, y: 1750 }, { x:  500, y: 1800 }, { x:  200, y: 1500 },
  { x:  450, y: 1550 }, { x:  700, y: 1750 }, { x:  250, y: 1300 },
  { x:  600, y: 1500 }, { x:  350, y: 1400 }, { x:  750, y: 1350 },
  { x:  150, y: 1650 },
  // ── SE quadrant ──
  { x: 1750, y: 1750 }, { x: 1500, y: 1800 }, { x: 1800, y: 1500 },
  { x: 1550, y: 1550 }, { x: 1300, y: 1750 }, { x: 1750, y: 1300 },
  { x: 1400, y: 1500 }, { x: 1650, y: 1400 }, { x: 1250, y: 1350 },
  { x: 1850, y: 1650 },
  // ── N corridor ──
  { x:  700, y:  300 }, { x: 1000, y:  150 }, { x: 1300, y:  300 },
  { x:  850, y:  430 }, { x: 1150, y:  430 },
  // ── S corridor ──
  { x:  700, y: 1700 }, { x: 1000, y: 1850 }, { x: 1300, y: 1700 },
  { x:  850, y: 1570 }, { x: 1150, y: 1570 },
  // ── W corridor ──
  { x:  150, y:  700 }, { x:  300, y: 1000 }, { x:  150, y: 1300 },
  { x:  430, y:  850 }, { x:  430, y: 1150 },
  // ── E corridor ──
  { x: 1850, y:  700 }, { x: 1700, y: 1000 }, { x: 1850, y: 1300 },
  { x: 1570, y:  850 }, { x: 1570, y: 1150 },
];

/**
 * Generate random ability pickups scattered around the map.
 * Abilities are drawn with repetition from the non-common pool (multiple books can
 * share the same ability). Positions are shuffled so no two books overlap.
 */
const PICKUP_COUNT = 60;

function generatePickups(): PickupItem[] {
  const nonCommonIds = Object.values(ABILITIES)
    .filter((a) => !(a as any).isCommon && a.id)
    .map((a) => a.id);

  if (nonCommonIds.length === 0) return [];

  // Shuffle spawn positions
  const positions = [...PICKUP_SPAWN_POSITIONS];
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  const count = Math.min(PICKUP_COUNT, positions.length);
  const pickups: PickupItem[] = [];
  for (let i = 0; i < count; i++) {
    // Pick a random ability with repetition allowed
    const abilityId = nonCommonIds[Math.floor(Math.random() * nonCommonIds.length)];
    pickups.push({
      id: randomUUID(),
      abilityId,
      position: positions[i],
    });
  }
  return pickups;
}

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

        // Player 0 starts slightly west of center
        position: {
          x: ARENA_WIDTH / 2 - 15,
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

        // Player 1 starts slightly east of center
        position: {
          x: ARENA_WIDTH / 2 + 15,
          y: ARENA_HEIGHT / 2,
        },
        velocity: { vx: 0, vy: 0 },
        facing: { x: -1, y: 0 },
        moveSpeed: 0.25, // 7.5 units/sec at 30 Hz
      },
    ],

    events: [],
    pickups: generatePickups(),
  };

  return state;
}
