// backend/game/engine/state/types/events.ts

import { PlayerID } from "./common";
import { EffectType } from "./effects";
import { BuffCategory } from "./buffs";

export type GameEventType =
  | "PLAY_ABILITY"
  | "ABILITY_SOUND"
  | "END_TURN"
  | "DAMAGE"
  | "DODGE"
  | "HEAL"
  | "BUFF_APPLIED"
  | "BUFF_EXPIRED"
  | "COMBAT_STATUS"
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
  channelPhase?: "start" | "complete";
  soundPhase?: "counter" | "dashComplete" | "followUp";
  x?: number;
  y?: number;
  z?: number;
  hideAbilityName?: boolean;
  suppressCritLabel?: boolean;
  displayZeroDamage?: boolean;

  effectType?: EffectType;
  value?: number;
  /** Amount of damage absorbed by the target's shield (化解). */
  shieldAbsorbed?: number;
  isCrit?: boolean;

  buffId?: number;
  buffName?: string;
  buffCategory?: BuffCategory;

  combatStatus?: "enter" | "exit";
  inCombat?: boolean;
  relatedUserId?: PlayerID;

  appliedAtTurn?: number;
  expiresAtTurn?: number;
}
