// backend/game/engine/state/types/events.ts

import { PlayerID } from "./common";
import { EffectType } from "./effects";
import { BuffCategory } from "./buffs";

export type GameEventType =
  | "PLAY_ABILITY"
  | "END_TURN"
  | "DAMAGE"
  | "DODGE"
  | "HEAL"
  | "BUFF_APPLIED"
  | "BUFF_EXPIRED"
  | "DASH";

export interface GameEvent {
  id: string;
  timestamp: number;

  turn: number;
  type: GameEventType;

  actorUserId: PlayerID;
  targetUserId?: PlayerID;
  entityId?: string;
  entityName?: string;

  abilityId?: string;
  abilityName?: string;
  abilityInstanceId?: string;

  effectType?: EffectType;
  value?: number;
  /** Amount of damage absorbed by the target's shield (化解). */
  shieldAbsorbed?: number;

  buffId?: number;
  buffName?: string;
  buffCategory?: BuffCategory;

  appliedAtTurn?: number;
  expiresAtTurn?: number;
}
