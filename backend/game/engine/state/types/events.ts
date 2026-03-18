// backend/game/engine/state/types/events.ts

import { PlayerID } from "./common";
import { EffectType } from "./effects";
import { BuffCategory } from "./buffs";

export type GameEventType =
  | "PLAY_CARD"
  | "END_TURN"
  | "DAMAGE"
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

  cardId?: string;
  cardName?: string;
  cardInstanceId?: string;

  effectType?: EffectType;
  value?: number;

  buffId?: number;
  buffName?: string;
  buffCategory?: BuffCategory;

  appliedAtTurn?: number;
  expiresAtTurn?: number;
}
