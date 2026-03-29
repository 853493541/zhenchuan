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
  /**
   * When true and periodicMs is set, first periodic tick fires immediately on apply.
   */
  periodicStartImmediate?: boolean;
  breakOnPlay?: boolean;
  /** Cancel this buff (channel) when the player sends movement input */
  cancelOnMove?: boolean;
  /** Cancel this buff (channel) when the player jumps */
  cancelOnJump?: boolean;
  /** Cancel this buff (channel) if the nearest opponent exceeds this distance (units) */
  cancelOnOutOfRange?: number;
  /** When true, the channel bar fills forward (0→100%) rather than draining (100→0%) */
  forwardChannel?: boolean;
  /** Initial stack count for stackable debuffs (e.g. 孔雀翎) */
  initialStacks?: number;
  /** Maximum stack count; when re-applying an existing buff, stacks increment up to this value */
  maxStacks?: number;
  /** Minimum ms between STACK_ON_HIT_DAMAGE procs (rate-limit) */
  procCooldownMs?: number;
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

  /**
   * Mirror of BuffDefinition.periodicStartImmediate.
   */
  periodicStartImmediate?: boolean;

  stageIndex?: number;
  appliedAtTurn?: number;
  breakOnPlay?: boolean;
  /** Cancel this buff (channel) when the player sends movement input */
  cancelOnMove?: boolean;
  /** Cancel this buff (channel) when the player jumps */
  cancelOnJump?: boolean;
  /** Cancel this buff (channel) if the nearest opponent exceeds this distance (units) */
  cancelOnOutOfRange?: number;
  /** When true, the channel bar fills forward (0→100%) rather than draining (100→0%) */
  forwardChannel?: boolean;
  /** Who originally applied this buff (used for on-hit proc attribution) */
  sourceUserId?: string;
  /** Current stack count for stackable debuffs (decrements on each proc) */
  stacks?: number;
  /** Maximum stack count (mirror of BuffDefinition.maxStacks) */
  maxStacks?: number;
  /** Minimum ms between STACK_ON_HIT_DAMAGE procs (mirror of BuffDefinition.procCooldownMs) */
  procCooldownMs?: number;
  /** Wall-clock ms when this buff last fired a STACK_ON_HIT_DAMAGE proc */
  lastProcAt?: number;

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
