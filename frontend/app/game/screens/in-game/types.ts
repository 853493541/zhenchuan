/* =========================================================
   Ability / Core Types
========================================================= */

export interface AbilityInstance {
  instanceId: string;
  abilityId: string;
  cooldown?: number;
}

/* =========================================================
   Pickup (ability book on the ground)
========================================================= */

export interface PickupItem {
  id: string;
  abilityId: string;
  position: { x: number; y: number };
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
 * Runtime buff applied by abilities
 * (direct mirror of backend ActiveBuff)
 */
export interface ActiveBuff {
  buffId: number;
  name: string;
  category: BuffCategory;

  effects: BuffEffect[];

  /** Absolute Date.now() ms when this buff expires. */
  expiresAt: number;
  /** Optional: interval in ms for periodic DoT/HoT effects. */
  periodicMs?: number;
  /** Optional: last time the periodic effect fired (ms). */
  lastTickAt?: number;

  appliedAtTurn?: number;

  breakOnPlay?: boolean;

  sourceAbilityId?: string;
  sourceAbilityName?: string;
}

/* =========================================================
   Player State
========================================================= */

export interface PlayerState {
  userId: string;
  username?: string;
  hp: number;
  hand: AbilityInstance[];
  buffs: ActiveBuff[];
  position?: { x: number; y: number; z?: number };
  velocity?: { vx: number; vy: number; vz?: number };
  moveSpeed?: number;
  jumpCount?: number;
  facing?: { x: number; y: number };
}

/* =========================================================
   Public Game Events (Action History)
========================================================= */

export type GameEventType =
  | "PLAY_ABILITY"
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

  abilityId?: string;
  abilityName?: string;

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

  gameOver: boolean;
  winnerUserId?: string;

  players: PlayerState[];
  events: GameEvent[];
  pickups?: PickupItem[];
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
  mode?: string;
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
  abilities: AbilityInstance[];
  locked: boolean[];
}

export interface TournamentState {
  battleNumber: number;
  gameHp: Record<string, number>;
  economy: Record<string, PlayerEconomy>;
  selectedAbilities: Record<string, AbilityInstance[]>;
  bench: Record<string, AbilityInstance[]>; // New: 12-slot bench area
  battleHistory: any[];
  shop: Record<string, Shop>;
  phase: "DRAFT" | "BATTLE" | "GAME_OVER";
  winnerId?: string;
}
