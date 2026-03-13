// backend/game/engine/state/types/effects.ts

import { TurnPhase, ScheduledTarget, ScheduledTurnOf } from "./scheduling";
import { TargetType } from "./cards";

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
  | "START_TURN_DAMAGE"
  | "START_TURN_HEAL"
  | "CLEANSE"
  | "FENGLAI_CHANNEL"
  | "WUJIAN_CHANNEL"
  | "DRAW_REDUCTION"
  | "ON_PLAY_DAMAGE"
  | "XINZHENG_CHANNEL"
  | "BONUS_DAMAGE_IF_TARGET_HP_GT"
  | "SCHEDULED_DAMAGE"
  | "DASH";

/**
 * Immediate card effects
 */
export interface CardEffect {
  type: EffectType;
  value?: number;
  chance?: number;
  repeatTurns?: number;

  allowWhileControlled?: boolean;
  applyTo?: TargetType;

  threshold?: number;
}

/**
 * Buff-contained effects
 */
export type BuffEffect = Omit<CardEffect, "allowWhileControlled"> & {
  when?: TurnPhase;
  target?: ScheduledTarget;
  turnOf?: ScheduledTurnOf;

  lifestealPct?: number;
  debug?: string;
};
