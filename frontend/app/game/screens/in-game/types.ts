/* =========================================================
   Ability / Core Types
========================================================= */

export interface AbilityInstance {
  instanceId: string;
  abilityId: string;
  cooldown?: number;
  chargeCount?: number;
  chargeRegenTicksRemaining?: number;
  chargeLockTicks?: number;
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
  /** Wall-clock ms when the buff was applied (from server). */
  appliedAt?: number;
  /** Optional: interval in ms for periodic DoT/HoT effects. */
  periodicMs?: number;
  /** Optional: last time the periodic effect fired (ms). */
  lastTickAt?: number;

  appliedAtTurn?: number;

  breakOnPlay?: boolean;
  cancelOnMove?: boolean;
  cancelOnJump?: boolean;
  cancelOnOutOfRange?: number;
  forwardChannel?: boolean;

  sourceAbilityId?: string;
  sourceAbilityName?: string;
  sourceUserId?: string;

  /** Current stack count for stackable debuffs (e.g. \u5b54\u96c0\u7fce) */
  stacks?: number;
}

/* =========================================================
   Active Channel (mirror of backend ActiveChannel)
========================================================= */

export interface ActiveChannel {
  abilityId: string;
  abilityName: string;
  instanceId: string;
  targetUserId: string;
  startedAt: number;
  durationMs: number;
  cancelOnMove?: boolean;
  cancelOnJump?: boolean;
  cancelOnOutOfRange?: number;
  forwardChannel?: boolean;
  effects: Array<{ type: string; value?: number; range?: number; threshold?: number }>;
  cooldownTicks: number;
}

/* =========================================================
   Player State
========================================================= */

export interface PlayerState {
  userId: string;
  username?: string;
  hp: number;
  maxHp?: number;
  shield?: number;
  hand: AbilityInstance[];
  buffs: ActiveBuff[];
  position?: { x: number; y: number; z?: number };
  velocity?: { vx: number; vy: number; vz?: number };
  moveSpeed?: number;
  jumpCount?: number;
  facing?: { x: number; y: number };
  activeChannel?: ActiveChannel;
}

/* =========================================================
   Public Game Events (Action History)
========================================================= */

export type GameEventType =
  | "PLAY_ABILITY"
  | "DAMAGE"
  | "HEAL"
  | "DODGE"
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

/* =========================================================
   Safe Zone (poison zone / shrinking circle)
========================================================= */

export interface SafeZone {
  centerX: number;
  centerY: number;
  currentHalf: number;
  dps: number;
  shrinking: boolean;
  shrinkProgress: number;
  nextChangeIn: number;
}

export interface GroundZone {
  id: string;
  ownerUserId: string;
  x: number;
  y: number;
  z?: number;
  height?: number;
  radius: number;
  expiresAt: number;
  damagePerInterval: number;
  intervalMs: number;
  lastTickAt: number;
  abilityId?: string;
  abilityName?: string;
  maxTargets?: number;
}

export interface GameState {
  turn: number;
  activePlayerIndex: number;

  gameOver: boolean;
  winnerUserId?: string;

  players: PlayerState[];
  events: GameEvent[];
  pickups?: PickupItem[];
  safeZone?: SafeZone;
  groundZones?: GroundZone[];
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
  exportPackageName?: string | null;
}

export interface RuntimeMapObject {
  id: string;
  type: 'building' | 'rock' | 'mountain' | 'hill_high' | 'hill_low';
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}

export interface RuntimeMapResponse {
  mode: string;
  exportPackageName?: string | null;
  map: {
    width: number;
    height: number;
    spawnCenterX: number;
    spawnCenterY: number;
    source: string;
    objects: RuntimeMapObject[];
  };
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
