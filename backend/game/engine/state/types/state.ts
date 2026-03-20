// backend/game/engine/state/types/state.ts
// ==================== GAME STATE ====================

import type { PlayerID } from "./common";
import type { AbilityInstance } from "./abilities";
import type { ActiveBuff } from "./buffs";
import type { GameEvent } from "./events";
import type { Position, Velocity } from "./position";

// ==================== PICKUP ====================

export interface PickupItem {
  id: string;
  abilityId: string;
  position: { x: number; y: number };
}

export interface PlayerState {
  userId: PlayerID;

  hp: number;
  maxHp?: number;

  /** abilities in hand */
  hand: AbilityInstance[];

  /** active buffs on player */
  buffs: ActiveBuff[];

  /* ================= REAL-TIME POSITION & MOVEMENT ================= */

  /** Current position on 2D arena (x, y) */
  position: Position;

  /** Current velocity (units per tick) */
  velocity: Velocity;

  /**
   * Base movement speed (units per tick when moving)
   * Default: 0.5 units/tick
   * Can be modified by buffs
   */
  moveSpeed: number;

  /**
   * Number of jumps consumed in the current airtime (0 = grounded).
   * Resets to 0 on landing. Max 2 (double-jump).
   */
  jumpCount?: number;

  /**
   * True when the current airtime was initiated by a power jump (扶摇直上).
   * Uses separate steeper gravity so the power jump arc is distinct.
   * Cleared on landing.
   */
  isPowerJump?: boolean;

  /**
   * Last movement facing direction (unit vector).
   * Updated whenever the player has a non-trivial movement input.
   * Used by directional dashes so TOWARD means "where I'm facing".
   */
  facing?: { x: number; y: number };
}

export interface GameState {
  /** increments on every authoritative state mutation */
  version: number;

  players: PlayerState[];

  /** global turn counter */
  turn: number;

  /** index into players[] */
  activePlayerIndex: number;

  gameOver: boolean;
  winnerUserId?: PlayerID;

  /** append-only event log */
  events: GameEvent[];

  /** ability books scattered across the map, removed when claimed */
  pickups: PickupItem[];

  /** legacy deck support (unused in arena mode) */
  deck?: AbilityInstance[];
}
