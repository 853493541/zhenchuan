// backend/game/engine/state/types/state.ts
// ==================== GAME STATE ====================

import type { PlayerID } from "./common";
import type { CardInstance } from "./cards";
import type { ActiveBuff } from "./buffs";
import type { GameEvent } from "./events";

export interface PlayerState {
  userId: PlayerID;

  hp: number;

  /** cards in hand */
  hand: CardInstance[];

  /** active buffs on player */
  buffs: ActiveBuff[];

  /**
   * GCD (Global Cooldown / action resource)
   * - Resets at start of this player's turn
   * - Playing cards consumes GCD
   * - If gcd < card.gcdCost → cannot play
   *
   * Current rule (v0):
   * - Each player gets exactly 1 GCD per turn
   */
  gcd: number;
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
}
