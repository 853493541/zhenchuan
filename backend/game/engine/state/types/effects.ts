// backend/game/engine/state/types/effects.ts

import { TurnPhase, ScheduledTarget, ScheduledTurnOf } from "./scheduling";
import { TargetType } from "./abilities";

export type EffectType =
  | "DAMAGE"
  | "HEAL"
  | "DRAW"
  | "DAMAGE_REDUCTION"
  | "DAMAGE_MULTIPLIER"
  | "HEAL_REDUCTION"
  | "UNTARGETABLE"
  | "STEALTH"
  | "ATTACK_LOCK"
  | "CONTROL"
  | "SILENCE"
  | "CONTROL_IMMUNE"
  | "DODGE_NEXT"
  | "DELAYED_DAMAGE"
  | "CLEANSE"
  | "FENGLAI_CHANNEL"
  | "WUJIAN_CHANNEL"
  | "DRAW_REDUCTION"
  | "ON_PLAY_DAMAGE"
  | "XINZHENG_CHANNEL"
  | "BONUS_DAMAGE_IF_TARGET_HP_GT"
  | "SCHEDULED_DAMAGE"
  | "DASH"
  | "DIRECTIONAL_DASH"
  | "JUMP_BOOST"
  | "PERIODIC_DAMAGE"
  | "PERIODIC_HEAL"
  | "PERIODIC_GUAN_TI_HEAL"
  | "CHANNEL_AOE_TICK"
  | "TIMED_AOE_DAMAGE"
  | "TIMED_AOE_DAMAGE_IF_SELF_HP_GT"
  | "TIMED_GUAN_TI_HEAL"
  | "PLACE_GROUND_ZONE"
  | "STACK_ON_HIT_DAMAGE"
  | "KNOCKED_BACK"
  | "SPEED_BOOST"
  // Level 0 control (removable by cleanse)
  | "ROOT"
  | "SLOW"
  // Jump enhancements
  | "MULTI_JUMP";

/**
 * Immediate ability effects
 */
export interface AbilityEffect {
  type: EffectType;
  value?: number;
  chance?: number;
  repeatTurns?: number;

  allowWhileControlled?: boolean;
  allowWhileKnockedBack?: boolean;
  applyTo?: TargetType;

  threshold?: number;

  /** Direction mode for DIRECTIONAL_DASH effects */
  dirMode?: "TOWARD" | "AWAY" | "PERP_LEFT" | "PERP_RIGHT";

  /**
   * For DIRECTIONAL_DASH: how many game-loop ticks the dash lasts.
    * Defaults to Math.round(distance * 1.5) (≈ 30 ticks for 20 units at 30 Hz).
   * Set explicitly on abilities where exact timing matters.
   */
  durationTicks?: number;

  /** Range (units) for CHANNEL_AOE_TICK — target must be within this distance */
  range?: number;
}

// Fields only used on BuffEffect (not AbilityEffect) are declared below.

/**
 * Buff-contained effects
 */
export type BuffEffect = Omit<AbilityEffect, "allowWhileControlled"> & {
  when?: TurnPhase;
  target?: ScheduledTarget;
  turnOf?: ScheduledTurnOf;

  lifestealPct?: number;
  debug?: string;

  /**
   * For TIMED_AOE_DAMAGE: fires once this many ms after the buff was applied.
   * e.g. 3000 = fires 3 seconds after the buff starts.
   */
  delayMs?: number;

  /**
   * For TIMED_AOE_DAMAGE: cone angle in degrees.
   * 180 = front hemisphere (facing direction), 360 = full circle.
   * Defaults to 360 if omitted.
   */
  aoeAngle?: number;

  /**
   * For TIMED_AOE_DAMAGE: push target this many units away from the caster on hit.
   */
  knockbackUnits?: number;

  /**
   * For TIMED_AOE_DAMAGE: silence the knocked-back target for this many ms.
   */
  knockbackSilenceMs?: number;
};
