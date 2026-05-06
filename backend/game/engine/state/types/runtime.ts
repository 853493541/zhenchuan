// backend/game/engine/state/types/runtime.ts

import { PlayerID } from "./common";
import { AbilityInstance } from "./abilities";
import { ActiveBuff } from "./buffs";
import { GameEvent } from "./events";

export interface PlayerState {
  userId: PlayerID;
  hp: number;
  waiGongCritChancePct?: number;
  neiGongCritChancePct?: number;
  critChancePct?: number;
  defensePct?: number;
  hand: AbilityInstance[];
  specialAbilityStates?: Record<string, AbilityInstance>;
  globalGcdTicks?: number;
  buffs: ActiveBuff[];
}

export interface GameState {
  version: number;

  players: PlayerState[];
  deck: AbilityInstance[];
  discard: AbilityInstance[];

  turn: number;
  activePlayerIndex: number;

  gameOver: boolean;
  winnerUserId?: PlayerID;

  events: GameEvent[];
}
