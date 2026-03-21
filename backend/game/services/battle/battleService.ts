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

// Pickup spawn positions — clusters near each player spawn (P0≈985,1000 | P1≈1015,1000)
// so books appear within arm's reach without needing to walk far.
const PICKUP_SPAWN_POSITIONS: Array<{ x: number; y: number }> = [
  // ── Very close to P0 spawn (985,1000) ──
  { x:  985, y:  987 }, { x:  973, y:  993 }, { x:  973, y: 1007 },
  { x:  985, y: 1013 }, { x:  997, y:  993 }, { x:  997, y: 1007 },
  // ── Very close to P1 spawn (1015,1000) ──
  { x: 1015, y:  987 }, { x: 1003, y:  993 }, { x: 1003, y: 1007 },
  { x: 1015, y: 1013 }, { x: 1027, y:  993 }, { x: 1027, y: 1007 },
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
 * Generate ability pickup clusters spread around the map.
 * Each spawn position becomes a cluster of BOOKS_PER_CLUSTER books placed within
 * a small radius around the center — creating "resource pack" groups.
 * Near-spawn clusters (first 12 positions) get 5 books; the rest get 4.
 * Total: 12×5 + 60×4 = 300 books per battle.
 */
const BOOKS_PER_CLUSTER      = 4;
const NEAR_SPAWN_CLUSTER_SIZE = 5;
const NEAR_SPAWN_COUNT        = 12; // number of near-spawn positions at the top of the list

function generatePickups(): PickupItem[] {
  const nonCommonIds = Object.values(ABILITIES)
    .filter((a) => !(a as any).isCommon && a.id)
    .map((a) => a.id);

  if (nonCommonIds.length === 0) return [];

  const pickups: PickupItem[] = [];

  PICKUP_SPAWN_POSITIONS.forEach((center, idx) => {
    const clusterSize = idx < NEAR_SPAWN_COUNT ? NEAR_SPAWN_CLUSTER_SIZE : BOOKS_PER_CLUSTER;
    for (let i = 0; i < clusterSize; i++) {
      const angle  = (Math.PI * 2 * i / clusterSize) + (Math.random() - 0.5) * (Math.PI / clusterSize);
      // Near-spawn clusters: tighter radius so books overlap player start area
      const radius = idx < NEAR_SPAWN_COUNT
        ? 2 + Math.random() * 6   // 2–8 world units from center
        : 3 + Math.random() * 9;  // 3–12 world units from center
      pickups.push({
        id: randomUUID(),
        abilityId: nonCommonIds[Math.floor(Math.random() * nonCommonIds.length)],
        position: {
          x: Math.round(center.x + Math.cos(angle) * radius),
          y: Math.round(center.y + Math.sin(angle) * radius),
        },
      });
    }
  });

  return pickups;
}

/** Export so draft.routes can inject pickups into existing loops that predate the pickup system. */
export { generatePickups };
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
