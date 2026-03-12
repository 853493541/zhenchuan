/* =========================================================
   Card / Core Types
========================================================= */

export interface CardInstance {
  instanceId: string;
  cardId: string;
  cooldown?: number;
}

/* =========================================================
   Buff System (ALIGNED WITH BACKEND)
========================================================= */

export type BuffCategory = "BUFF" | "DEBUFF";

export type BuffEffect = {
  type: string;
  value?: number;
  chance?: number;
  repeatTurns?: number;
  durationTurns?: number;
  breakOnPlay?: boolean;
};

/**
 * Runtime buff applied by cards
 * (direct mirror of backend ActiveBuff)
 */
export interface ActiveBuff {
  buffId: number;
  name: string;
  category: BuffCategory;

  effects: BuffEffect[];

  appliedAtTurn: number;
  expiresAtTurn: number;

  breakOnPlay?: boolean;

  sourceCardId?: string;
  sourceCardName?: string;
}

/* =========================================================
   Player State
========================================================= */

export interface PlayerState {
  userId: string;
  username?: string;
  hp: number;
  hand: CardInstance[];
  buffs: ActiveBuff[];
}

/* =========================================================
   Public Game Events (Action History)
========================================================= */

export type GameEventType =
  | "PLAY_CARD"
  | "DAMAGE"
  | "HEAL"
  | "BUFF_APPLIED"
  | "BUFF_EXPIRED"
  | "END_TURN";

export interface GameEvent {
  id: string;
  turn: number;
  type: GameEventType;
  actorUserId: string;
  targetUserId?: string;

  cardId?: string;
  cardName?: string;

  value?: number;

  buffId?: number;
  buffName?: string;
  buffCategory?: BuffCategory;

  timestamp: number;
}

/* =========================================================
   Game State
========================================================= */

export interface GameState {
  turn: number;
  activePlayerIndex: number;

  deck: CardInstance[];
  discard: CardInstance[];

  gameOver: boolean;
  winnerUserId?: string;

  players: PlayerState[];
  events: GameEvent[];
}

/* =========================================================
   API Response Wrapper
========================================================= */

export interface GameResponse {
  _id: string;
  players: string[];
  state: GameState;
  playerNames?: Record<string, string>;
  tournament?: TournamentState;
}

/* =========================================================
   Tournament / Draft / Economy
========================================================= */

export interface PlayerEconomy {
  gold: number;
  level: number;
  experience: number;
}

export interface Shop {
  cards: CardInstance[];
  locked: boolean[];
}

export interface TournamentState {
  battleNumber: number;
  gameHp: Record<string, number>;
  economy: Record<string, PlayerEconomy>;
  selectedAbilities: Record<string, CardInstance[]>;
  battleHistory: any[];
  shop: Record<string, Shop>;
  phase: "DRAFT" | "BATTLE" | "GAME_OVER";
  winnerId?: string;
}
