// backend/game/engine/state/types/state.ts
// ==================== GAME STATE ====================

import type { PlayerID } from "./common";
import type { AbilityInstance } from "./abilities";
import type { ActiveBuff } from "./buffs";
import type { GameEvent } from "./events";
import type { AbilityEffect } from "./effects";
import type { Position, Velocity } from "./position";

// ==================== PICKUP ====================

export interface PickupItem {
  id: string;
  abilityId: string;
  position: { x: number; y: number };
}

export interface SafeZone {
  centerX: number;
  centerY: number;
  currentHalf: number;
  dps: number;
  /** Is the zone currently shrinking? */
  shrinking: boolean;
  /** If shrinking: progress 0→1. If paused: 0 */
  shrinkProgress: number;
  /** Seconds until next phase change (shrink start or shrink end) */
  nextChangeIn: number;
}

// ==================== ACTIVE CHANNEL ====================

export interface ActiveChannel {
  abilityId: string;
  abilityName: string;
  instanceId: string;
  targetUserId: string;
  /** Date.now() ms when channel started */
  startedAt: number;
  /** Total channel duration in ms */
  durationMs: number;
  cancelOnMove?: boolean;
  cancelOnJump?: boolean;
  /** Cancel if distance to opponent exceeds this (units) */
  cancelOnOutOfRange?: number;
  /** true = forward-fill bar (0→100%), false = drain bar (100→0%) */
  forwardChannel?: boolean;
  /** Effects to fire on channel completion */
  effects: AbilityEffect[];
  /** Cooldown ticks to set on the ability instance after completion */
  cooldownTicks: number;
}

export interface PlayerState {
  userId: PlayerID;

  hp: number;
  maxHp?: number;
  shield?: number;

  /** abilities in hand */
  hand: AbilityInstance[];

  /** active buffs on player */
  buffs: ActiveBuff[];

  /* ================= REAL-TIME POSITION & MOVEMENT ================= */

  /** Current position on 2D arena (x, y) */
  position: Position;

  /** Current velocity (units per tick) */
  velocity: Velocity;

  /**
   * Base movement speed (units per tick when moving)
   * Default: 0.5 units/tick
   * Can be modified by buffs
   */
  moveSpeed: number;

  /**
   * Number of jumps consumed in the current airtime (0 = grounded).
   * Resets to 0 on landing. Max 2 (double-jump).
   */
  jumpCount?: number;

  /**
   * True when the current airtime was initiated by a power jump (扶摇直上).
   * Uses separate steeper gravity so the power jump arc is distinct.
   * Cleared on landing.
   */
  isPowerJump?: boolean;

  /**
   * True when the current airtime was initiated by a combined 扶摇直上 + 鸟翔碧空 jump.
   * Peak height 24u, same duration as power jump. Takes precedence over isPowerJump.
   * Cleared on landing.
   */
  isPowerJumpCombined?: boolean;

  /**
    * Remaining travel budget for the current jump phase (world units).
    * Upward jumps arm a 2-unit budget that locks on the first airborne direction input.
    * Directional jumps arm a larger budget immediately at jump start.
   */
  airNudgeRemaining?: number;

  /**
    * Remaining ticks for the current jump-phase travel animation.
   * At 30Hz, 30 ticks = 1.0s.
   */
  airNudgeTicksRemaining?: number;

  /**
    * Locked direction for the current jump-phase travel.
   */
  airNudgeDir?: { x: number; y: number };

  /**
    * Once a jump phase chooses a direction, ignore later WASD changes until the
    * next jump or landing. Upward jumps set this on the first airborne input;
    * directional jumps set it immediately at jump start.
   */
  airDirectionLocked?: boolean;

  /**
   * Latest airborne/special-movement planar speed snapshot (world units per tick).
    * Used so follow-up jump phases can scale from the actual non-dash airborne
    * speed state that launched them instead of always falling back to base run
    * speed. Completed dashes clear this carry so post-dash jumps use restored
    * movement speed.
   * Cleared on landing.
   */
  airborneSpeedCarry?: number;

  /**
   * Last movement facing direction (unit vector).
   * Updated whenever the player has a non-trivial movement input.
   * Used by directional dashes so TOWARD means "where I'm facing".
   */
  facing?: { x: number; y: number };

  /**
   * Active animated dash (蹑云逐月 / 惯性 system).
   * When set, movement.ts drives the player along this trajectory each tick
   * instead of processing normal input. Gravity is suspended and the vertical
   * velocity is captured on the FIRST game-loop tick (not at cast time) so
   * that any pending jump input is processed first.
   */
  activeDash?: {
    abilityId: string;
    vxPerTick: number;    // horizontal X step per tick (units/tick)
    vyPerTick: number;    // horizontal Y step per tick (units/tick)
    speedPerTick?: number; // optional steering speed (units/tick)
    steerByFacing?: boolean;
    wallDiveOnBlock?: boolean;
    wallStunMs?: number;     // if >0 and wall blocks the dash, stop and stun for this duration
    wallBlocked?: boolean;   // set by movement.ts when a wall hit is detected
    snapUpUnits?: number;
    diveVzPerTick?: number;
    vzPerTick?: number;   // undefined = not yet captured; set on first tick of dash
    forceVzPerTick?: number; // optional fixed starting vertical velocity for arc dashes
    useArcGravity?: boolean; // when true, apply dash-local gravity to vzPerTick each tick
    arcGravityUpPerTick?: number;
    arcGravityDownPerTick?: number;
    maxUpVz:   number;    // per-tick upward vz cap (positive)
    maxDownVz: number;    // per-tick downward vz cap (negative)
    hitTargetUserId?: string;
    hitDamageOnComplete?: number;
    hitEffectTypeOnComplete?: string;
    ticksRemaining: number;
  };

  /** Active channel (e.g. 云飞玉皇). Set at cast, cleared on completion or cancel. */
  activeChannel?: ActiveChannel;

  /**
   * Anti-race cast lock after jump input is queued.
   * Prevents requiresGrounded abilities from being cast in the same instant as jump.
   */
  groundedCastLockUntil?: number;
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
  /** increments on every authoritative state mutation */
  version: number;

  /** Stored units per gameplay unit. Collision-test = 1, legacy modes = 2.2. */
  unitScale?: number;

  players: PlayerState[];

  /** global turn counter */
  turn: number;

  /** index into players[] */
  activePlayerIndex: number;

  gameOver: boolean;
  winnerUserId?: PlayerID;

  /** append-only event log */
  events: GameEvent[];

  /** ability books scattered across the map, removed when claimed */
  pickups: PickupItem[];

  /** poison zone (毒圈) — shrinking safe area */
  safeZone?: SafeZone;

  /** persistent ground damage zones (e.g. 狂龙乱舞) */
  groundZones?: GroundZone[];

  /** legacy deck support (unused in arena mode) */
  deck?: AbilityInstance[];
}
