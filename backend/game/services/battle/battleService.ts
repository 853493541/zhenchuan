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
const PUBG_WIDTH = 2000;
const PUBG_HEIGHT = 2000;
const ARENA_WIDTH = 200;
const ARENA_HEIGHT = 200;

// Five spawn positions for PUBG-style battle royale
// First two are 20 units apart, facing each other near center
const PUBG_SPAWN_POSITIONS: Array<{ x: number; y: number }> = [
  { x: 990,  y: 1000 }, // P0 — left of center
  { x: 1010, y: 1000 }, // P1 — right of center (20u apart)
  { x: 1000, y: 1000 }, // Center
  { x: 250,  y: 1750 }, // SW
  { x: 1750, y: 1750 }, // SE
];

// Spawn positions for Arena mode — 20 units apart, facing each other at center of 200×200 map
const ARENA_SPAWN_POSITIONS: Array<{ x: number; y: number }> = [
  { x:  90, y: 100 }, // P0 — left of center
  { x: 110, y: 100 }, // P1 — right of center (20u apart)
  { x: 100, y: 100 }, // Center (fallback)
];

// Keep SPAWN_POSITIONS as alias for pubg (backward compat)
const SPAWN_POSITIONS = PUBG_SPAWN_POSITIONS;

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

// ── Arena-mode pickup positions (200×200 map) ─────────────────────────────
// Tight clusters near each spawn + scattered across the circular arena.
const ARENA_PICKUP_SPAWN_POSITIONS: Array<{ x: number; y: number }> = [
  // Near P0 spawn (90, 100)
  { x:  90, y:  88 }, { x:  78, y:  94 }, { x:  78, y: 106 },
  { x:  90, y: 112 }, { x: 102, y:  94 }, { x: 102, y: 106 },
  // Near P1 spawn (110, 100)
  { x: 110, y:  88 }, { x:  98, y:  94 }, { x:  98, y: 106 },
  { x: 110, y: 112 }, { x: 122, y:  94 }, { x: 122, y: 106 },
  // NW quadrant
  { x:  30, y:  30 }, { x:  50, y:  20 }, { x:  20, y:  50 }, { x:  40, y:  40 },
  // NE quadrant
  { x: 170, y:  30 }, { x: 150, y:  20 }, { x: 180, y:  50 }, { x: 160, y:  40 },
  // SW quadrant
  { x:  30, y: 170 }, { x:  50, y: 180 }, { x:  20, y: 150 }, { x:  40, y: 160 },
  // SE quadrant
  { x: 170, y: 170 }, { x: 150, y: 180 }, { x: 180, y: 150 }, { x: 160, y: 160 },
  // N/S mid-lane
  { x:  96, y:  22 }, { x: 104, y:  22 }, { x:  96, y: 178 }, { x: 104, y: 178 },
  // W/E mid-lane
  { x:  22, y:  96 }, { x:  22, y: 104 }, { x: 178, y:  96 }, { x: 178, y: 104 },
];
const ARENA_NEAR_SPAWN_COUNT = 12; // first 12 positions are near-spawn

function generateArenaPickups(): PickupItem[] {
  const nonCommonIds = Object.values(ABILITIES)
    .filter((a) => !(a as any).isCommon && a.id)
    .map((a) => a.id);

  if (nonCommonIds.length === 0) return [];

  const pickups: PickupItem[] = [];

  ARENA_PICKUP_SPAWN_POSITIONS.forEach((center, idx) => {
    const clusterSize = idx < ARENA_NEAR_SPAWN_COUNT ? 5 : 3;
    for (let i = 0; i < clusterSize; i++) {
      const angle  = (Math.PI * 2 * i / clusterSize) + (Math.random() - 0.5) * (Math.PI / clusterSize);
      const radius = idx < ARENA_NEAR_SPAWN_COUNT
        ? 1 + Math.random() * 3   // tight near spawn
        : 1 + Math.random() * 4;
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

export { generateArenaPickups };
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
  playerIds: PlayerID[],
  mode: 'arena' | 'pubg' = 'pubg'
): GameState {
  const isArena = mode === 'arena';
  const mapWidth  = isArena ? ARENA_WIDTH  : PUBG_WIDTH;
  const mapHeight = isArena ? ARENA_HEIGHT : PUBG_HEIGHT;
  const spawnList = isArena ? ARENA_SPAWN_POSITIONS : PUBG_SPAWN_POSITIONS;

  const players: PlayerState[] = playerIds.map((id, i) => {
    const spawn = spawnList[i % spawnList.length];

    // Face toward map center
    const dx = mapWidth  / 2 - spawn.x;
    const dy = mapHeight / 2 - spawn.y;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;

    const abilities = tournament.selectedAbilities[id] ?? [];
    const hand: AbilityInstance[] = [
      ...abilities.map((a) => ({ ...a, instanceId: randomUUID(), cooldown: 0 })),
      ...makeCommonAbilities(),
    ];

    return {
      userId: id,
      hp: STARTING_BATTLE_HP,
      hand,
      buffs: [],
      position: { x: spawn.x, y: spawn.y },
      velocity: { vx: 0, vy: 0 },
      facing: { x: dx / mag, y: dy / mag },
      moveSpeed: 0.1666667,
    };
  });

  const state: GameState = {
    version: 1,
    turn: 0,
    activePlayerIndex: 0,
    gameOver: false,
    players,
    events: [],
    pickups: isArena ? generateArenaPickups() : generatePickups(),
  };

  return state;
}
