// backend/game/engine/state/types/buffs.ts

import { BuffEffect } from "./effects";
import { TurnPhase } from "./scheduling";

/* ================= Buff Core ================= */

export type BuffCategory = "BUFF" | "DEBUFF";
export type BuffApplyTo = "SELF" | "OPPONENT";
export type BuffTickOn = TurnPhase;

/* ================= Buff Definition ================= */

export interface BuffDefinition {
  buffId: number;
  name: string;
  category: BuffCategory;
  duration: number;
  tickOn: BuffTickOn;
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

  sourceCardId?: string;
  sourceCardName?: string;

  /** remaining turns */
  remaining: number;
  tickOn: BuffTickOn;

  stageIndex?: number;
  appliedAtTurn?: number;
  breakOnPlay?: boolean;
}
