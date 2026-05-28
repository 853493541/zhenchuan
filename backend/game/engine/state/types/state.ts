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
  shape?: "square" | "circle";
  centerX: number;
  centerY: number;
  currentHalf: number;
  currentDiameter?: number;
  dps: number;
  /** Is the zone currently shrinking? */
  shrinking: boolean;
  /** If shrinking: progress 0→1. If paused: 0 */
  shrinkProgress: number;
  /** Seconds until next phase change (shrink start or shrink end) */
  nextChangeIn: number;
  phase?: "idle" | "waiting" | "countdown" | "shrinking" | "complete";
  timelineMode?: "fast" | "full";
  damageMode?: "test" | "full";
  autoFullHeal?: boolean;
  autoSettle?: boolean;
  circleNumber?: number;
  totalCircles?: number;
  fullPoison?: boolean;
  stageIndex?: number;
  targetStageIndex?: number;
  phaseStartedAt?: number;
  phaseEndsAt?: number;
  targetDiameter?: number;
  targetHalf?: number;
  targetCenterX?: number;
  targetCenterY?: number;
  targetVisible?: boolean;
  paused?: boolean;
  pausedAt?: number;
  pausedRemainingMs?: number;
  manualShrinking?: boolean;
  lastShrinkAt?: number;
  shrinkStartHalf?: number;
  shrinkStartCenterX?: number;
  shrinkStartCenterY?: number;
}

export interface PlayAreaBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface YumenResultRow {
  rank: number;
  userId: PlayerID;
  username: string;
  kills: number;
  damage: number;
  score: number;
  reward: number;
}

export interface YumenResults {
  endedAt: number;
  autoLeaveAt: number;
  winnerUserId?: PlayerID;
  rows: YumenResultRow[];
}

// ==================== ACTIVE CHANNEL ====================

export interface ActiveChannel {
  abilityId: string;
  abilityName: string;
  instanceId: string;
  targetUserId?: string;
  entityTargetId?: string;
  /** Date.now() ms when channel started */
  startedAt: number;
  /** Total channel duration in ms */
  durationMs: number;
  /** Optional reverse-channel tick interval in ms. */
  tickIntervalMs?: number;
  /** Last wall-clock tick fired for periodic active-channel effects. */
  lastTickAt?: number;
  /** Number of periodic active-channel ticks already resolved. */
  completedTickCount?: number;
  /** Set when the channel belongs to the consumable system rather than an ability. */
  consumableId?: string;
  cancelOnMove?: boolean;
  cancelOnJump?: boolean;
  /** Cancel if distance to opponent exceeds this (units) */
  cancelOnOutOfRange?: number;
  /** true = forward-fill bar (0→100%), false = drain bar (100→0%) */
  forwardChannel?: boolean;
  /** If true, movement input is ignored while this active channel is running. */
  lockMovement?: boolean;
  /** Effects to fire on channel completion */
  effects: AbilityEffect[];
  /** Cooldown ticks to set on the ability instance after completion */
  cooldownTicks: number;
  /** Buffs applied at channel start that should be removed when the channel ends or is canceled. */
  startedBuffIds?: number[];
  /** If false, this channel cannot be interrupted by interrupt abilities. */
  interruptible?: boolean;
}

export type TargetSelection =
  | { kind: "self"; userId: PlayerID }
  | { kind: "player"; userId: PlayerID }
  | { kind: "entity"; entityId: string };

export interface PlayerState {
  userId: PlayerID;

  hp: number;
  maxHp?: number;
  attackDamage?: number;
  shield?: number;
  /** Runtime 外功会心 percentage (0-100). */
  waiGongCritChancePct?: number;
  /** Runtime 内功会心 percentage (0-100). */
  neiGongCritChancePct?: number;
  /** Runtime crit chance percentage used by combat resolution (0-100). */
  critChancePct?: number;
  /** Runtime 防御力 percentage (0-100). Applied to base damage before crit/DR. */
  defensePct?: number;
  /** Runtime 化劲 percentage (0-100). Applied at the end of damage calculation. */
  huajinPct?: number;
  /** Runtime 加速率 percentage shown to players. Timing uses a separate reduction constant. */
  hasteRatePct?: number;

  /** abilities in hand */
  hand: AbilityInstance[];

  /** Runtime state for temporary special-bar abilities that must keep cooldown/GCD without living in hand. */
  specialAbilityStates?: Record<string, AbilityInstance>;

  /** Shared GCD lock for abilities that trigger public cooldown, including temporary special-bar skills. */
  globalGcdTicks?: number;

  /** Frontend-only visual GCD bar payload; overwritten whenever a new GCD display should start. */
  visualGcd?: {
    id: string;
    name: string;
    kind: "base" | "qinggong" | "houyao";
    startedAt: number;
    durationMs: number;
  };

  /** active buffs on player */
  buffs: ActiveBuff[];

  /** Date.now() ms when the player most recently entered 玉门关狂沙. */
  yumenKuangShaStartedAt?: number;

  /** Current player-selected target, used for target-of-target UI. */
  targetSelection?: TargetSelection;

  /** True while this player has at least one active 战斗中 link. */
  inCombat?: boolean;

  /** Symmetric player combat links, keyed by the other player's userId. */
  combatLinks?: Record<PlayerID, { lastActionAt: number }>;

  /** Consumable cooldowns keyed by consumable id; expiresAt is an absolute Date.now() ms timestamp. */
  consumableCooldowns?: Record<string, { expiresAt: number }>;

  /** Remaining consumable inventory counts keyed by consumable id. */
  consumableCounts?: Record<string, number>;

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
   * 凌然天风 special-jump charges remaining (0 or 1 while the buff is active).
   */
  lingRanTianFengCharges?: number;

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
   * 梯云纵 jump penalty: when 梯云纵 buff is active, the FIRST jump of an
   * airborne sequence consumes 2 jumps instead of 1 (preventing 梯云纵 + 二段跳).
   * Reset to false on landing; remains true after a dash that resets jumpCount.
   */
  tiYunZongPenaltyConsumed?: boolean;

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
    lingRanCastLift?: boolean;
    sustainWhileChannelAbilityId?: string;
    speedPerTick?: number; // optional steering speed (units/tick)
    steerByFacing?: boolean;
    wallDiveOnBlock?: boolean;
    stopOnWall?: boolean;
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
    hitTargetEntityId?: string;
    hitDamageOnComplete?: number;
    hitEffectTypeOnComplete?: string;
    ticksRemaining: number;
  };

  /** Active channel (e.g. 云飞玉皇). Set at cast, cleared on completion or cancel. */
  activeChannel?: ActiveChannel;

  /**
   * Intentional 凌然天风 -> 九霄风雷 bug interaction state.
   * While the matching channel remains active, movement.ts keeps or recreates the
   * Lingran cast-lift upward dash instead of letting it end normally.
   */
  lingRanCastLiftSustainChannelAbilityId?: string;
  lingRanCastLiftSustainVzPerTick?: number;

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

  // ── HP-bearing zones (e.g. 疾电叱羽) ──
  hp?: number;
  maxHp?: number;
  /** Buff id granted to allies inside the zone (e.g. 疾电叱羽 redirect buff). */
  allyBuffId?: number;

  // ── Follow-target zones (振翅图南, 飞刃回转) ──
  /** When set, zone re-centers each tick toward this player at followSpeedPerTick. */
  followTargetUserId?: string;
  /** World units per tick (30Hz tick). */
  followSpeedPerTick?: number;

  // ── Growing zones (天绝地灭) ──
  /** Initial radius (world units). When set, radius interpolates to growEndRadius over growDurationMs. */
  growStartRadius?: number;
  growEndRadius?: number;
  growStartedAt?: number;
  growDurationMs?: number;

  // ── Explode-on-expire (天绝地灭) ──
  /** When zone expires naturally, pull all enemies inside toward center then deal explodeDamage. */
  explodeOnExpire?: boolean;
  explodeDamage?: number;
  /** Pull speed in world units per tick during the pull phase. */
  pullSpeedPerTick?: number;
  /** Tick count during the pull phase, after which the explosion damage is applied. */
  pullTicksRemaining?: number;
}

/**
 * A targetable, HP-bearing entity placed by an ability.
 * Unlike GroundZone (procedural area), TargetEntity can be selected and
 * attacked by enemies. First example: 逐云寒蕊 (zhu_yun_han_rui).
 */
export interface TargetEntity {
  id: string;
  /** Synthetic combat id so entities can reuse shared buff/combat helpers. */
  userId: PlayerID;
  /** Entity kind discriminator (e.g. "zhu_yun_han_rui"). */
  kind: string;
  /** Player who created it; usually allies of this user benefit, enemies attack it. */
  ownerUserId: string;
  /** World-unit position. */
  position: Position;
  /** Effect/zone radius in world units (also serves as click hit-area). */
  radius: number;
  /** Current hit points. Reaches 0 → entity is destroyed. */
  hp: number;
  maxHp: number;
  shield?: number;
  /** Runtime buffs/debuffs currently affecting the entity. */
  buffs: ActiveBuff[];
  /** Wall-clock ms when the entity was created. */
  spawnedAt?: number;
  /** Wall-clock ms timestamp at which entity expires naturally. */
  expiresAt: number;
  /** Source ability metadata (for display + buff cleanup). */
  abilityId?: string;
  abilityName?: string;
  /** Optional oriented-wall geometry (used by 楚河汉界). All values are world units. */
  wallHalfLength?: number;
  wallHalfThickness?: number;
  wallHeight?: number;
  wallTangent?: { x: number; y: number };
  wallNormal?: { x: number; y: number };
  /** Per-tick runtime: when each player entered the zone (ms timestamp; 0 = not in zone). */
  enteredAtByUser?: Record<string, number>;
  /** Per-tick runtime: earliest ms timestamp the player can be re-stealthed after attack-break. */
  rearmAtByUser?: Record<string, number>;
  /** Active forced movement (e.g. pull, knockback). Tick-based; cleared on completion. */
  activeDash?: {
    abilityId?: string;
    vxPerTick: number;
    vyPerTick: number;
    forceVzPerTick?: number;
    stopOnWall?: boolean;
    ticksRemaining: number;
  };
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
  yumenResults?: YumenResults;
  leaveNotice?: {
    userId: PlayerID;
    username: string;
    endsAt: number;
  };

  /** append-only event log */
  events: GameEvent[];

  /** ability books scattered across the map, removed when claimed */
  pickups: PickupItem[];

  /** poison zone (毒圈) — shrinking safe area */
  safeZone?: SafeZone;

  /** Hard movement boundary for editable 1v1 modes. */
  playArea?: PlayAreaBounds;

  /** persistent ground damage zones (e.g. 狂龙乱舞) */
  groundZones?: GroundZone[];

  /** HP-bearing targetable entities placed by abilities (e.g. 逐云寒蕊). */
  entities?: TargetEntity[];

  /** legacy deck support (unused in arena mode) */
  deck?: AbilityInstance[];
}
