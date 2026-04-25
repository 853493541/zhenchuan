// backend/game/engine/state/types/abilities.ts

import { AbilityEffect } from "./effects";
import { BuffDefinition } from "./buffs";
export type AbilityType =
  | "ATTACK"
  | "SUPPORT"
  | "CONTROL"
  | "STANCE"
  | "CHANNEL";

export type TargetType = "SELF" | "OPPONENT";

export interface Ability {
  id: string;
  name: string;
  type: AbilityType;
  target: TargetType;

  /**
   * If true, casting this ability triggers a 1.5-second draft GCD on other
   * draft abilities that also have gcd:true.
   */
  gcd?: boolean;

  effects: AbilityEffect[];
  buffs?: BuffDefinition[];

  /**
   * Original design / source description (not shown to players)
   * Used for dev reference and future ability versioning
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
    * At 30 Hz: 30 ticks = 1 second. Default 3 ticks if unset.
   */
  cooldownTicks?: number;

  /**
   * Movement component of ability
   * - distance: how many units to move
   * - when: before (gap closer), after (kite), or during cast
   */
  /**
   * If true, this ability cannot be cast while the player is airborne (z > 0.5).
   */
  requiresGrounded?: boolean;

  /**
   * If true, this ability can still be cast while under removable level-1 control.
   */
  allowWhileControlled?: boolean;

  /**
   * If true, this ability can still be cast while under level-2 knockback / push control.
   */
  allowWhileKnockedBack?: boolean;

  /**
   * If true, this ability can still be cast while being pulled (PULLED effect from enemy).
   */
  allowWhilePulled?: boolean;

  /**
   * If true, this ability can still be cast while being displaced (DISPLACEMENT effect — dashes, pulls).
   */
  allowWhileDisplaced?: boolean;

  /**
   * If true, this ability's cleanse effect may also remove root and slow.
   */
  cleanseRootSlow?: boolean;

  /**
   * If true, this ability cannot be cast while under ROOT.
   */
  cannotCastWhileRooted?: boolean;

  /**
   * If true, this ability can only be cast while grounded and not moving.
   */
  requiresStanding?: boolean;

  /**
   * Optional minimum current HP (exclusive) required to cast.
   * Shields are not counted for this check.
   */
  minSelfHpExclusive?: number;

  /**
   * If true, this ability can only be cast if the target is within 180° of the
   * player's facing direction. Set to false for 360° abilities.
   */
  faceDirection?: boolean;

  canMove?: {
    distance: number;
    when: "BEFORE" | "AFTER" | "DURING";
  };

  /**
   * If true, this ability fires a physical projectile that travels to the target.
   * Players with PROJECTILE_IMMUNE buff will not take damage from such abilities.
   */
  isProjectile?: boolean;

  /**
   * If true this ability is a common movement ability given to every player
   * automatically. It will NOT appear in the draft shop.
   */
  isCommon?: boolean;

  /**
   * 轻功技能标记。
   * 被【封轻功】时，带此标记的技能不可施放。
   */
  qinggong?: boolean;

  /**
   * Allows this opponent-targeted ability to be cast on a ground point
   * even when no target is selected.
   */
  allowGroundCastWithoutTarget?: boolean;

  /**
   * Charge system for abilities like 鹊踏枝.
   */
  maxCharges?: number;

  /**
   * Ticks needed to recover one charge.
   */
  chargeRecoveryTicks?: number;

  /**
   * Minimal delay (ticks) between two consecutive casts when charges remain.
   */
  chargeCastLockTicks?: number;

  /**
   * If true, this ability ignores the target's dodge chance entirely.
   * 无视闪避.
   */
  ignoreDodge?: boolean;
}

export interface AbilityInstance {
  instanceId: string;
  abilityId: string;
  
  /**
   * Cooldown for this ability instance
   * - Starts at 0 (ready to play)
   * - Increments to 1 when played
   * - Decrements each turn
   * - Can play when cooldown === 0
   */
  cooldown: number;

  /** Current available charges for charge-based abilities. */
  chargeCount?: number;

  /** Remaining ticks until next charge is recovered. */
  chargeRegenTicksRemaining?: number;

  /** Remaining lock ticks between two casts while charges remain. */
  chargeLockTicks?: number;
}
