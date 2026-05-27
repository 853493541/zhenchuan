/* =========================================================
   Ability / Core Types
========================================================= */

export interface AbilityInstance {
  instanceId: string;
  abilityId: string;
  cooldown?: number;
  _cooldownSyncedAt?: number;
  chargeCount?: number;
  chargeRegenTicksRemaining?: number;
  _chargeRegenTicksRemainingSyncedAt?: number;
  chargeLockTicks?: number;
  _chargeLockTicksSyncedAt?: number;
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
  abilityIds?: string[];
  buffIds?: number[];
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
  targetUserId?: string;
  entityTargetId?: string;
  startedAt: number;
  durationMs: number;
  tickIntervalMs?: number;
  lastTickAt?: number;
  completedTickCount?: number;
  consumableId?: string;
  cancelOnMove?: boolean;
  cancelOnJump?: boolean;
  cancelOnOutOfRange?: number;
  forwardChannel?: boolean;
  lockMovement?: boolean;
  effects: Array<{ type: string; value?: number; range?: number; threshold?: number }>;
  cooldownTicks: number;
}

export type TargetSelection =
  | { kind: "self"; userId: string }
  | { kind: "player"; userId: string }
  | { kind: "entity"; entityId: string };

/* =========================================================
   Player State
========================================================= */

export interface PlayerState {
  userId: string;
  username?: string;
  hp: number;
  maxHp?: number;
  attackDamage?: number;
  shield?: number;
  waiGongCritChancePct?: number;
  neiGongCritChancePct?: number;
  critChancePct?: number;
  defensePct?: number;
  huajinPct?: number;
  hasteRatePct?: number;
  hand: AbilityInstance[];
  specialAbilityStates?: Record<string, AbilityInstance>;
  globalGcdTicks?: number;
  _globalGcdSyncedAt?: number;
  visualGcd?: {
    id: string;
    name: string;
    kind: "base" | "qinggong" | "houyao";
    startedAt: number;
    durationMs: number;
  };
  buffs: ActiveBuff[];
  targetSelection?: TargetSelection;
  inCombat?: boolean;
  combatLinks?: Record<string, { lastActionAt: number }>;
  consumableCooldowns?: Record<string, { expiresAt: number }>;
  consumableCounts?: Record<string, number>;
  position?: { x: number; y: number; z?: number };
  velocity?: { vx: number; vy: number; vz?: number };
  moveSpeed?: number;
  jumpCount?: number;
  tiYunZongPenaltyConsumed?: boolean;
  facing?: { x: number; y: number };
  activeChannel?: ActiveChannel;
}

/* =========================================================
   Public Game Events (Action History)
========================================================= */

export type GameEventType =
  | "PLAY_ABILITY"
  | "ABILITY_SOUND"
  | "DAMAGE"
  | "HEAL"
  | "DODGE"
  | "BUFF_APPLIED"
  | "BUFF_EXPIRED"
  | "COMBAT_STATUS"
  | "END_TURN";

export interface GameEvent {
  id: string;
  turn: number;
  type: GameEventType;
  actorUserId: string;
  targetUserId?: string;
  entityId?: string;
  entityName?: string;

  abilityId?: string;
  abilityName?: string;
  channelPhase?: "start" | "complete";

  value?: number;
  shieldAbsorbed?: number;
  isCrit?: boolean;

  buffId?: number;
  buffName?: string;
  buffCategory?: BuffCategory;

  combatStatus?: "enter" | "exit";
  inCombat?: boolean;
  relatedUserId?: string;

  timestamp: number;
}

/* =========================================================
   In-game Chat
========================================================= */

export type ChatChannel = "map" | "system" | "battle";

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  userId: string;
  username: string;
  school?: string | null;
  targetUserId?: string;
  targetUsername?: string;
  targetSchool?: string | null;
  abilityName?: string;
  value?: number;
  isCrit?: boolean;
  battleLogType?: "hit" | "damage";
  text: string;
  timestamp: number;
  variant?: "user" | "system" | "battle";
}

/* =========================================================
   Game State
========================================================= */

/* =========================================================
   Safe Zone (poison zone / shrinking circle)
========================================================= */

export interface SafeZone {
  shape?: 'square' | 'circle';
  centerX: number;
  centerY: number;
  currentHalf: number;
  dps: number;
  shrinking: boolean;
  shrinkProgress: number;
  nextChangeIn: number;
  manualShrinking?: boolean;
  lastShrinkAt?: number;
  shrinkStartHalf?: number;
}

export interface PlayAreaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
  pickupTargetUserId?: string;
}

export interface TargetEntity {
  id: string;
  userId: string;
  kind: string;
  ownerUserId: string;
  position: { x: number; y: number; z?: number };
  radius: number;
  hp: number;
  maxHp: number;
  shield?: number;
  buffs: ActiveBuff[];
  spawnedAt?: number;
  expiresAt: number;
  abilityId?: string;
  abilityName?: string;
  wallHalfLength?: number;
  wallHalfThickness?: number;
  wallHeight?: number;
  wallTangent?: { x: number; y: number };
  wallNormal?: { x: number; y: number };
}

export interface GameState {
  turn: number;
  activePlayerIndex: number;
  unitScale?: number;

  gameOver: boolean;
  winnerUserId?: string;
  leaveNotice?: {
    userId: string;
    username: string;
    endsAt: number;
  };

  players: PlayerState[];
  events: GameEvent[];
  pickups?: PickupItem[];
  safeZone?: SafeZone;
  playArea?: PlayAreaBounds;
  groundZones?: GroundZone[];
  entities?: TargetEntity[];
}

/* =========================================================
   API Response Wrapper
========================================================= */

export interface GameResponse {
  _id: string;
  players: string[];
  state: GameState;
  playerNames?: Record<string, string>;
  playerSchools?: Record<string, string>;
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
