// backend/game/engine/state/types/buffs.ts

import { BuffEffect } from "./effects";

/* ================= Buff Core ================= */

export type BuffCategory = "BUFF" | "DEBUFF";
export type BuffApplyTo = "SELF" | "OPPONENT";

/** @deprecated use durationMs instead — kept for backwards-compat with any serialised data */
export type BuffTickOn = "TURN_START" | "TURN_END";

/* ================= Buff Definition ================= */

export interface BuffDefinition {
  buffId: number;
  name: string;
  category: BuffCategory;
  /**
   * How long the buff lasts in milliseconds.
   * e.g. 5 seconds = 5000, 10 seconds = 10000
   */
  durationMs: number;
  /**
   * For periodic effects (DoT / HoT): how often the effect fires, in ms.
   * e.g. 3000 = fires every 3 seconds.
   * Omit for passive buffs that have no periodic component.
   */
  periodicMs?: number;
  breakOnPlay?: boolean;
  description: string;
  effects: BuffEffect[];
  applyTo?: BuffApplyTo;
  originalDescription?: string;
}

/* ================= Active Buff (Runtime) ================= */

export interface ActiveBuff {
  buffId: number;
  name: string;
  category: BuffCategory;

  effects: BuffEffect[];

  sourceAbilityId?: string;
  sourceAbilityName?: string;

  /**
   * Absolute Date.now() ms when this buff expires.
   * GameLoop removes the buff once Date.now() >= expiresAt.
   */
  expiresAt: number;

  /**
   * For periodic effects: absolute Date.now() ms of the last periodic tick.
   * Initialised to appliedAt so the first tick fires periodicMs after application.
   */
  lastTickAt?: number;

  /**
   * Mirror of BuffDefinition.periodicMs — stored on ActiveBuff so the GameLoop
   * doesn't need to look up the definition each tick.
   */
  periodicMs?: number;

  stageIndex?: number;
  appliedAtTurn?: number;
  breakOnPlay?: boolean;

  /**
   * Wall-clock ms (Date.now()) when this buff was applied.
   * Used by TIMED_AOE_DAMAGE effects to fire once after a fixed delay.
   */
  appliedAt?: number;

  /**
   * Indices into `effects[]` for TIMED_AOE_DAMAGE entries that have already fired.
   * Prevents re-firing when the same trigger delay is reached on subsequent ticks.
   */
  firedDelayIndices?: number[];
}
