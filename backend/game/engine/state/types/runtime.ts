// backend/game/engine/state/types/runtime.ts

import { PlayerID } from "./common";
import { CardInstance } from "./cards";
import { ActiveBuff } from "./buffs";
import { GameEvent } from "./events";

export interface PlayerState {
  userId: PlayerID;
  hp: number;
  hand: CardInstance[];
  buffs: ActiveBuff[];
}

export interface GameState {
  version: number;

  players: PlayerState[];
  deck: CardInstance[];
  discard: CardInstance[];

  turn: number;
  activePlayerIndex: number;

  gameOver: boolean;
  winnerUserId?: PlayerID;

  events: GameEvent[];
}
