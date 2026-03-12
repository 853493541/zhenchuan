/**
 * Tournament-level state (meta-game, distinct from individual battles)
 * Tracks: HP pools, draft/economy, battle counts, rarity progression
 */

import type { PlayerID } from "./common";
import type { CardInstance } from "./cards";

/* ================= Economy (TFT-based) ================= */

export interface PlayerEconomy {
  /** Current available gold to spend */
  gold: number;

  /** Current shop level (1-10) */
  level: number;

  /** Accumulated gold for interest calculation */
  experience: number; // not used yet, leaving room for future complexity
}

export interface Shop {
  /** Cards available for purchase this round (5 cards) */
  cards: CardInstance[];

  /** Cards locked from refresh (TFT mechanic) */
  locked: boolean[];
}

/* ================= Battle Progression ================= */

export interface BattleInstance {
  /** Which battle number (1-8) */
  battleNumber: number;

  /** Winner of this battle (userId) */
  winnerId?: PlayerID;

  /** Damage dealt to loser's game HP */
  damageDealt?: number;
}

/* ================= Tournament State (persist across battles) ================= */

export interface TournamentState {
  /** Current battle number (1-8) */
  battleNumber: number;

  /** Each player's persistent HP pool (decreases with each loss) */
  gameHp: Record<PlayerID, number>;

  /** Each player's economy state */
  economy: Record<PlayerID, PlayerEconomy>;

  /** Each player's selected 6 abilities for current battle */
  selectedAbilities: Record<PlayerID, CardInstance[]>;

  /** Each player's benched abilities (12 slots max, persist across battles) */
  bench: Record<PlayerID, CardInstance[]>;

  /** History of battles completed */
  battleHistory: BattleInstance[];

  /** Current shop state (shown during draft phase) */
  shop: Record<PlayerID, Shop>;

  /** Game phase: "DRAFT" | "BATTLE" | "GAME_OVER" */
  phase: "DRAFT" | "BATTLE" | "GAME_OVER";

  /** Game winner (when gameHp of one player reaches 0) */
  winnerId?: PlayerID;
}

/* ================= Constants (move to separate file later) ================= */

export const LOSER_DAMAGE_BY_BATTLE: Record<number, number> = {
  1: 15,
  2: 15,
  3: 20,
  4: 20,
  5: 25,
  6: 25,
  7: 30,
  8: 30,
};

export const STARTING_GAME_HP = 100;
export const STARTING_BATTLE_HP = 30;
export const STARTING_GOLD = 5;
export const GOLD_PER_ROUND = 5; // Income earned per battle

export const LEVEL_UP_COSTS: Record<number, number> = {
  1: 0, // already level 1
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
};

// TFT rarity progression by shop level
export const RARITY_POOLS: Record<number, Record<number, number>> = {
  1: { 1: 1.0, 2: 0, 3: 0, 4: 0, 5: 0 },
  2: { 1: 1.0, 2: 0, 3: 0, 4: 0, 5: 0 },
  3: { 1: 0.75, 2: 0.25, 3: 0, 4: 0, 5: 0 },
  4: { 1: 0.55, 2: 0.3, 3: 0.15, 4: 0, 5: 0 },
  5: { 1: 0.45, 2: 0.33, 3: 0.2, 4: 0.02, 5: 0 },
  6: { 1: 0.3, 2: 0.4, 3: 0.25, 4: 0.05, 5: 0 },
  7: { 1: 0.19, 2: 0.3, 3: 0.35, 4: 0.15, 5: 0.01 },
  8: { 1: 0.18, 2: 0.25, 3: 0.32, 4: 0.22, 5: 0.03 },
  9: { 1: 0.1, 2: 0.2, 3: 0.25, 4: 0.35, 5: 0.1 },
  10: { 1: 0.05, 2: 0.1, 3: 0.2, 4: 0.4, 5: 0.25 },
};
