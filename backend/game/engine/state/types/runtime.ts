// backend/game/engine/state/types/runtime.ts

import { PlayerID } from "./common";
import { AbilityInstance } from "./abilities";
import { ActiveBuff } from "./buffs";
import { GameEvent } from "./events";

export interface PlayerState {
  userId: PlayerID;
  hp: number;
  maxHp?: number;
  attackDamage?: number;
  shield?: number;
  waiGongCritChancePct?: number;
  neiGongCritChancePct?: number;
  critChancePct?: number;
  defensePct?: number;
  huajinPct?: number;
  poFangPct?: number;
  hasteRatePct?: number;
  hand: AbilityInstance[];
  specialAbilityStates?: Record<string, AbilityInstance>;
  globalGcdTicks?: number;
  visualGcd?: {
    id: string;
    name: string;
    kind: "base" | "qinggong" | "houyao";
    startedAt: number;
    durationMs: number;
  };
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
