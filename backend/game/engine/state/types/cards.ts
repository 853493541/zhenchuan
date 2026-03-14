// backend/game/engine/state/types/cards.ts

import { CardEffect } from "./effects";
import { BuffDefinition } from "./buffs";

export type CardType =
  | "ATTACK"
  | "SUPPORT"
  | "CONTROL"
  | "STANCE"
  | "CHANNEL";

export type TargetType = "SELF" | "OPPONENT";

export interface Card {
  id: string;
  name: string;
  type: CardType;
  target: TargetType;

  /**
   * If true, casting this ability triggers a 1.5-second draft GCD on other
   * draft abilities that also have gcd:true.
   */
  gcd?: boolean;

  effects: CardEffect[];
  buffs?: BuffDefinition[];

  /**
   * Original design / source description (not shown to players)
   * Used for dev reference and future card versioning
   */
  originalDescription?: string;

  /* ================= REAL-TIME RANGE SYSTEM ================= */

  /**
   * Maximum distance (units) to cast this ability
   * If players are further apart than this, ability cannot be cast
   */
  range?: number;

  /**
   * Minimum distance (units) to cast this ability
   * For melee attacks, this is 0
   * For gap closers, might be 0 (can cast from any distance)
   * For abilities you must cast from distance, this is > 0
   */
  minRange?: number;

  /**
   * Casting time in milliseconds
   * 0 or undefined = instant cast
   * > 0 = channel time before ability triggers
   */
  castTime?: number;

  /**
   * How this ability targets in real-time
   * - INSTANT: affects enemy at cast time (no aiming)
   * - POINT_CLICK: player clicks a coordinate on arena
   * - DIRECTION: ability goes in direction player is facing
   */
  targetingType?: "INSTANT" | "POINT_CLICK" | "DIRECTION";

  /**
   * Number of game-loop ticks before this ability can be used again.
   * At 60 Hz: 60 ticks = 1 second. Default 3 ticks if unset.
   */
  cooldownTicks?: number;

  /**
   * Movement component of ability
   * - distance: how many units to move
   * - when: before (gap closer), after (kite), or during cast
   */
  canMove?: {
    distance: number;
    when: "BEFORE" | "AFTER" | "DURING";
  };

  /**
   * If true this card is a common movement ability given to every player
   * automatically. It will NOT appear in the draft shop.
   */
  isCommon?: boolean;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
  
  /**
   * Cooldown for this card instance
   * - Starts at 0 (ready to play)
   * - Increments to 1 when played
   * - Decrements each turn
   * - Can play when cooldown === 0
   */
  cooldown: number;
}
