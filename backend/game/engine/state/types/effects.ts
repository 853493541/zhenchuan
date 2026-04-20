// backend/game/engine/state/types/effects.ts

import { TurnPhase, ScheduledTarget, ScheduledTurnOf } from "./scheduling";
import { TargetType } from "./abilities";

export type EffectType =
  | "DAMAGE"
  | "HEAL"
  | "SHIELD"
  | "DRAW"
  | "COOLDOWN_SLOW"
  | "DAMAGE_REDUCTION"
  | "DAMAGE_TAKEN_INCREASE"
  | "DAMAGE_MULTIPLIER"
  | "HEAL_REDUCTION"
  | "UNTARGETABLE"
  | "INVULNERABLE"
  | "STEALTH"
  | "ATTACK_LOCK"
  | "CONTROL"
  | "SILENCE"
  | "SILENCE_IMMUNE"
  | "QINGGONG_SEAL"
  | "KNOCKBACK_IMMUNE"
  | "CONTROL_IMMUNE"
  | "DASH_TURN_LOCK"
  | "DASH_TURN_OVERRIDE"
  | "DISPLACEMENT"
  | "INTERRUPT_IMMUNE"
  | "ROOT_SLOW_IMMUNE"
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
  | "AOE_APPLY_BUFFS"
  | "JUMP_BOOST"
  | "GROUND_TARGET_DASH"
  | "PERIODIC_DAMAGE"
  | "PERIODIC_HEAL"
  | "PERIODIC_GUAN_TI_HEAL"
  | "CHANNEL_AOE_TICK"
  | "TIMED_AOE_DAMAGE"
  | "TIMED_SELF_DAMAGE"
  | "TIMED_SELF_HEAL"
  | "TIMED_AOE_DAMAGE_IF_SELF_HP_GT"
  | "TIMED_GUAN_TI_HEAL"
  | "TIMED_PULL_TARGET_TO_FRONT"
  | "PLACE_GROUND_ZONE"
  | "PLACE_SHENGTAIJI_ZONE"
  | "BAIZU_AOE"
  | "WUFANG_XINGJIN_AOE"
  | "BANG_DA_GOU_TOU"
  | "STACK_ON_HIT_DAMAGE"
  | "STACK_ON_HIT_GUAN_TI_HEAL"
  | "INSTANT_GUAN_TI_HEAL"
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
  maxTargets?: number;

  allowWhileControlled?: boolean;
  allowWhileKnockedBack?: boolean;
  cleanseRootSlow?: boolean;
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

  /** For zone placement effects: custom zone duration in ms. */
  zoneDurationMs?: number;

  /** For zone placement effects: custom tick interval in ms. */
  zoneIntervalMs?: number;

  /** For zone placement effects: offset from caster in gameplay units. */
  zoneOffsetUnits?: number;

  /** For zone placement effects: vertical effective height in gameplay units. */
  zoneHeight?: number;

  /**
   * For DIRECTIONAL_DASH: when true, dash heading is steered by live facing every tick.
   */
  steerByFacing?: boolean;

  /**
   * For DIRECTIONAL_DASH: explicit horizontal speed in units/tick.
   * If omitted, speed is derived from value / durationTicks.
   */
  speedPerTick?: number;

  /**
   * For DIRECTIONAL_DASH: instant vertical snap up on dash start.
   */
  snapUpUnits?: number;

  /**
   * For DIRECTIONAL_DASH: if blocked by wall/obstacle, switch to downward dive.
   */
  wallDiveOnBlock?: boolean;

  /**
   * For wall-dive dashes: downward vz applied when wall collision is detected.
   */
  diveVzPerTick?: number;

  /**
   * For DIRECTIONAL_DASH: extra damage applied to enemies intersecting the dash route.
   * Processed immediately on cast.
   */
  routeDamage?: number;

  /**
   * For DIRECTIONAL_DASH route damage: collision radius around dash path.
   */
  routeRadius?: number;

  /**
   * For DIRECTIONAL_DASH: optional arc peak height in world units.
   * When set, dash vertical movement follows a jump-like arc instead of flat inertia.
   */
  arcPeakHeight?: number;
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

  /**
   * For zone placement effects: custom zone duration in ms.
   */
  zoneDurationMs?: number;

  /**
   * For zone placement effects: vertical effective height.
   */
  zoneHeight?: number;
};
