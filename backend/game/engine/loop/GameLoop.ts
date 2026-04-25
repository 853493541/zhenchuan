// backend/game/engine/loop/GameLoop.ts
/**
 * Real-time game loop for 2D arena battles
 * Runs at fixed tick rate (configured per game, 30 Hz on current VM)
 * Handles:
 * - Player movement
 * - Ability casting
 * - Buff updates
 * - Win condition checks
 */

import { GameState, MovementInput, GroundZone, calculateDistance, gameplayUnitsToWorldUnits, normalizeStoredUnitScale } from "../state/types";
import { checkGameOver } from "../flow/turn/checkGameOver";
import { broadcastGameUpdate } from "../../services/broadcast";
import { diffState } from "../../services/flow/stateDiff";
import GameSession from "../../models/GameSession";
import { applyMovement, resolveMapCollisions, MapContext, getGroundHeightForMap } from "./movement";
import { addBuff, pushBuffExpired } from "../effects/buffRuntime";
import { resolveScheduledDamage, resolveHealAmount } from "../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget, removeLinkedShield } from "../utils/health";
import { randomUUID } from "crypto";
import { worldMap } from "../../map/worldMap";
import { arenaMap } from "../../map/arenaMap";
import { exportedMap } from "../../map/exportedMap";
import { COLLISION_TEST_PLAYER_RADIUS, getCollisionTestExportedSystem } from "../../map/exportedMapCollision";
import { ABILITIES } from "../../abilities/abilities";
import { loadBuffEditorOverrides } from "../../abilities/buffEditorOverrides";
import { blocksCardTargeting, blocksEnemyTargeting, hasKnockbackImmune, hasUntargetable, hasDamageImmune, shouldDodge, shouldDodgeForAbility } from "../rules/guards";
import type { MapObject } from "../state/types/map";
import { applyTriggeredFollowUpPlayRules, breakOnPlay } from "../flow/play/breakOnPlay";
import { applyDashRuntimeBuff } from "../effects/definitions/DirectionalDash";
import { processOnDamageTaken, preCheckRedirect, applyRedirectToOpponent } from "../effects/onDamageHooks";
import {
  pulseZhenShanHeTarget,
  transformExpiredXuanjian,
  ZHEN_SHAN_HE_ABILITY_ID,
  ZHEN_SHAN_HE_XUANJIAN_BUFF_ID,
  ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID,
} from "../effects/definitions/ZhenShanHe";

/** 2D segment vs AABB intersection test (for LOS checks). */
function segmentIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 1e-8) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dy) < 1e-8) {
    if (y1 < minY || y1 > maxY) return false;
  } else {
    let t1 = (minY - y1) / dy;
    let t2 = (maxY - y1) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Check if line-of-sight between two 2D positions is blocked by any map object.
 *  minBlockH: objects shorter than this are ignored (ground-level terrain bumps).
 *  casterZ / targetZ: feet heights; eyeHeight is added to get eye-level.
 *  An object is skipped only when both players' eye-levels clear its top.
 */
const LOS_EYE_HEIGHT = 1.5; // game units above feet
function isLOSBlocked(
  ax: number, ay: number,
  bx: number, by: number,
  objects: MapObject[],
  minBlockH: number = 0,
  casterZ: number = 0,
  targetZ: number = 0,
): string | null { // returns blocking entity id or null
  const casterEye = casterZ + LOS_EYE_HEIGHT;
  const targetEye = targetZ + LOS_EYE_HEIGHT;
  for (const obj of objects) {
    if (obj.h < minBlockH) continue;
    // Skip if both eye-levels clear the object's top
    if (obj.h <= Math.min(casterEye, targetEye)) continue;
    if (segmentIntersectsAABB(ax, ay, bx, by, obj.x - 0.5, obj.y - 0.5, obj.x + obj.w + 0.5, obj.y + obj.d + 0.5)) {
      return obj.id;
    }
  }
  return null;
}

/** Check if target is within the caster's forward 180-degree hemisphere. */
function isInFacingHemisphere(
  player: { position: { x: number; y: number }; facing?: { x: number; y: number } },
  target: { position: { x: number; y: number } }
): boolean {
  const f = player.facing;
  if (!f) return true;
  const dx = target.position.x - player.position.x;
  const dy = target.position.y - player.position.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return true;
  return (f.x * dx + f.y * dy) >= 0;
}

/**
 * Facing rule:
 * - Opponent-targeted abilities require 180° facing by default.
 * - Set faceDirection:false to explicitly opt out.
 */
function requiresFacing(ability: { target?: string; faceDirection?: boolean }): boolean {
  if (ability.target === "OPPONENT") return ability.faceDirection !== false;
  return ability.faceDirection === true;
}

function isDunyingCompanion(buff: { buffId: number; name?: string; sourceAbilityId?: string }): boolean {
  return buff.buffId === 1021 && (buff.name === "遁影" || buff.sourceAbilityId === "fuguang_lueying");
}

function hasBuffEffect(player: { buffs: Array<{ effects: Array<{ type: string }> }> }, type: string): boolean {
  return player.buffs.some((b) => b.effects.some((e) => e.type === type));
}

function tryApplyDodgeForHit(params: {
  state: GameState;
  source: { userId: string };
  target: { userId: string; buffs: any[] };
  abilityId?: string;
  abilityName?: string;
  enabled: boolean;
  damageType?: string;
}): boolean {
  const { state, source, target, abilityId, abilityName, enabled, damageType } = params;
  if (!enabled) return false;
  if (source.userId === target.userId) return false;
  if (!shouldDodgeForAbility(target as any, damageType)) return false;

  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    turn: state.turn,
    type: "DODGE",
    actorUserId: target.userId,
    targetUserId: source.userId,
    abilityId,
    abilityName,
  } as any);
  return true;
}

const CHANNEL_BUFF_IDS = new Set([1014, 1017, 2001, 2003]);

function isChannelBuffRuntime(buff: { buffId: number }): boolean {
  return CHANNEL_BUFF_IDS.has(buff.buffId);
}

function isMoheKnockdown(buff: { buffId: number; sourceAbilityId?: string }): boolean {
  return buff.buffId === 1002 && buff.sourceAbilityId === "mohe_wuliang";
}

function isStunDebuff(buff: {
  buffId: number;
  sourceAbilityId?: string;
  category?: string;
  effects?: Array<{ type: string }>;
}): boolean {
  if (isMoheKnockdown(buff)) return false;
  if (buff.category !== "DEBUFF") return false;
  return Array.isArray(buff.effects) && buff.effects.some((e) => e.type === "CONTROL");
}

const WUFANG_XINGJIN_ROOT_BUFF_ID = 1330;
const WUFANG_XINGJIN_HIT_PROTECT_BUFF_ID = 1331;
const WUFANG_XINGJIN_REMOVE_ON_HIT_CHANCE = 0.5;
const SAN_CAI_HUA_SHENG_ROOT_BUFF_ID = 2509;
const SAN_CAI_HUA_SHENG_PROTECT_BUFF_ID = 2510;
const SAN_CAI_HUA_SHENG_REMOVE_ON_HIT_CHANCE = 0.5;
const PULL_CHANNEL_QINGGONG_SEAL_CONFIG: Record<string, { buffId: number; buffName: string; durationMs: number }> = {
  zhuo_ying_shi: { buffId: 2403, buffName: "滞影", durationMs: 5_000 },
};

// After the pull completes (activeDash cleared), apply a stun to the target.
// NOTE: 极乐引 is now an instant AOE and no longer uses this channel-pull mechanism.
// The config is kept but empty; the code below won't fire for any current ability.
const PULL_CHANNEL_POST_STUN_CONFIG: Record<string, { buffId: number; buffName: string; durationMs: number }> = {
};

function tryRemoveWufangRootOnHit(state: GameState, target: any, now: number): boolean {
  if (!Array.isArray(target?.buffs) || target.buffs.length === 0) return false;

  const hasProtect = target.buffs.some(
    (b: any) => b.buffId === WUFANG_XINGJIN_HIT_PROTECT_BUFF_ID && b.expiresAt > now
  );
  if (hasProtect) return false;

  const rootBuff = target.buffs.find(
    (b: any) => b.buffId === WUFANG_XINGJIN_ROOT_BUFF_ID && b.expiresAt > now
  );
  if (!rootBuff) return false;

  if (Math.random() > WUFANG_XINGJIN_REMOVE_ON_HIT_CHANCE) return false;

  target.buffs = target.buffs.filter((b: any) => b !== rootBuff);
  pushBuffExpired(state, {
    targetUserId: target.userId,
    buffId: rootBuff.buffId,
    buffName: rootBuff.name,
    buffCategory: rootBuff.category,
    sourceAbilityId: rootBuff.sourceAbilityId,
    sourceAbilityName: rootBuff.sourceAbilityName,
  });
  return true;
}

function tryRemoveSanCaiRootOnHit(state: GameState, target: any, now: number): boolean {
  if (!Array.isArray(target?.buffs) || target.buffs.length === 0) return false;

  const hasProtect = target.buffs.some(
    (b: any) => b.buffId === SAN_CAI_HUA_SHENG_PROTECT_BUFF_ID && b.expiresAt > now
  );
  if (hasProtect) return false;

  const rootBuff = target.buffs.find(
    (b: any) => b.buffId === SAN_CAI_HUA_SHENG_ROOT_BUFF_ID && b.expiresAt > now
  );
  if (!rootBuff) return false;

  if (Math.random() > SAN_CAI_HUA_SHENG_REMOVE_ON_HIT_CHANCE) return false;

  target.buffs = target.buffs.filter((b: any) => b !== rootBuff);
  pushBuffExpired(state, {
    targetUserId: target.userId,
    buffId: rootBuff.buffId,
    buffName: rootBuff.name,
    buffCategory: rootBuff.category,
    sourceAbilityId: rootBuff.sourceAbilityId,
    sourceAbilityName: rootBuff.sourceAbilityName,
  });
  return true;
}

function removeStunDebuffsFromPlayer(state: GameState, target: any): boolean {
  const stunBuffs = (target.buffs ?? []).filter((b: any) => isStunDebuff(b));
  if (stunBuffs.length === 0) return false;

  target.buffs = target.buffs.filter((b: any) => !isStunDebuff(b));
  for (const b of stunBuffs) {
    pushBuffExpired(state, {
      targetUserId: target.userId,
      buffId: b.buffId,
      buffName: b.name,
      buffCategory: b.category,
      sourceAbilityId: b.sourceAbilityId,
      sourceAbilityName: b.sourceAbilityName,
    });
  }
  return true;
}

function applyType3KnockbackControl(params: {
  state: GameState;
  source: any;
  target: any;
  abilityId?: string;
  abilityName?: string;
  knockbackUnits: number;
  controlDurationMs: number;
  mapCtx: MapContext;
  now: number;
}) {
  const {
    state,
    source,
    target,
    abilityId,
    abilityName,
    knockbackUnits,
    controlDurationMs,
    mapCtx,
    now,
  } = params;

  if (knockbackUnits <= 0) {
    return { applied: false, removedStuns: false };
  }

  if (target.buffs.some((b: any) => isMoheKnockdown(b))) {
    return { applied: false, removedStuns: false };
  }

  if (source.userId !== target.userId && blocksEnemyTargeting(target)) {
    return { applied: false, removedStuns: false };
  }

  if (hasKnockbackImmune(target)) {
    return { applied: false, removedStuns: false };
  }

  if (hasBuffEffect(target, "KNOCKED_BACK")) {
    return { applied: false, removedStuns: false };
  }

  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.0001) {
    return { applied: false, removedStuns: false };
  }

  const removedStuns = removeStunDebuffsFromPlayer(state, target);

  target.position = {
    ...target.position,
    x: target.position.x + (dx / dist) * knockbackUnits,
    y: target.position.y + (dy / dist) * knockbackUnits,
  };
  resolveMapCollisions(target, mapCtx);

  if (controlDurationMs > 0) {
    const knockbackBuff = {
      buffId: 9101,
      name: "击退",
      category: "DEBUFF",
      effects: [{ type: "KNOCKED_BACK" }],
      expiresAt: now + controlDurationMs,
      breakOnPlay: false,
      sourceAbilityId: abilityId,
      sourceAbilityName: abilityName,
      appliedAtTurn: state.turn,
      appliedAt: now,
    } as any;

    target.buffs.push(knockbackBuff);
    applyDashRuntimeBuff({
      state,
      target,
      durationMs: controlDurationMs,
      effects: [{ type: "CONTROL_IMMUNE" }] as any,
      sourceAbilityId: abilityId,
      sourceAbilityName: abilityName,
      appliedAt: now,
    });
    state.events.push({
      id: randomUUID(),
      timestamp: now,
      turn: state.turn,
      type: "BUFF_APPLIED",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId,
      abilityName,
      buffId: knockbackBuff.buffId,
      buffName: knockbackBuff.name,
      buffCategory: knockbackBuff.category,
      appliedAtTurn: state.turn,
    } as any);
  }

  return { applied: true, removedStuns };
}

const SHENGTAIJI_ZONE_ID = "qionglong_huasheng_zone";
const SHENGTAIJI_PULSE_BUFF_ID = 1310;
const SHENGTAIJI_ENEMY_SLOW_BUFF_ID = 1311;
const CHONG_YIN_YANG_ZONE_BUFF_ID = 2701;
const LING_TAI_XU_ZONE_BUFF_ID = 2702;
const TUN_RI_YUE_ZONE_BUFF_ID = 2703;

export interface GameLoopConfig {
  tickRate?: number; // Hz (default 60)
  mode?: "arena" | "pubg" | "collision-test";
}

/**
 * Singleton game loop instances per game ID
 */
const activeLoops = new Map<string, GameLoop>();

export class GameLoop {
  private gameId: string;
  private state: GameState;
  private isRunning = false;
  private tickRate: number; // Hz
  private tickInterval: any;
  private playerInputs: Map<number, MovementInput | null> = new Map();
  private playerInputSeq: Map<number, number> = new Map();
  private lastBroadcast = 0;
  private ticksSinceBroadcast = 0;
  // Broadcast cadence in ticks. Derived from tickRate to keep roughly 30Hz net updates.
  private broadcastTickInterval = 1;
  // ── 毒圈 (Poison zone) ──
  private zoneStartedAt = 0;
  private lastZoneDamageAt = 0;
  private isArenaMode = false;
  private mapCtx: MapContext;
  // Index into state.events for STACK_ON_HIT_DAMAGE scanning.
  // Prevents missing immediate cast damage that lands between loop ticks.
  private stackProcScanIndex = 0;
  // Pending post-pull stuns: keyed by targetUserId; fires when activeDash clears.
  private readonly pendingPostPullStuns = new Map<
    string,
    { sourceUserId: string; abilityId: string; abilityName: string }
  >();

  // Phase table: each phase defines a time window, zone size transition, and DPS.
  static ZONE_PHASES = [
    { startTime: 0,     endTime: 10000, fromHalf: 100, toHalf: 100, dps: 0 },
    { startTime: 10000, endTime: 30000, fromHalf: 100, toHalf: 50,  dps: 1 },
    { startTime: 30000, endTime: 40000, fromHalf: 50,  toHalf: 50,  dps: 1 },
    { startTime: 40000, endTime: 50000, fromHalf: 50,  toHalf: 25,  dps: 5 },
    { startTime: 50000, endTime: 60000, fromHalf: 25,  toHalf: 25,  dps: 5 },
    { startTime: 60000, endTime: 65000, fromHalf: 25,  toHalf: 0,   dps: 10 },
  ];

  constructor(gameId: string, state: GameState, config?: GameLoopConfig) {
    this.gameId = gameId;
    this.state = structuredClone(state);
    this.state.unitScale = normalizeStoredUnitScale(this.state.unitScale ?? (config?.mode === 'collision-test' ? 1 : undefined));
    this.stackProcScanIndex = this.state.events?.length ?? 0;
    this.tickRate = config?.tickRate ?? 30;
    this.broadcastTickInterval = Math.max(1, Math.round(this.tickRate / 30));
    this.isArenaMode = config?.mode === 'arena';

    // Select map based on game mode
    const map = config?.mode === 'collision-test' ? exportedMap : this.isArenaMode ? arenaMap : worldMap;
    const collisionSystem = config?.mode === 'collision-test' ? getCollisionTestExportedSystem() : null;
    this.mapCtx = {
      objects: map.objects,
      width: map.width,
      height: map.height,
      circular: false,
      unitScale: this.state.unitScale,
      playerRadius: config?.mode === 'collision-test' ? COLLISION_TEST_PLAYER_RADIUS : undefined,
      collisionSystem,
    };

    // Initialize safe zone for arena mode
    if (this.isArenaMode) {
      this.zoneStartedAt = Date.now();
      this.lastZoneDamageAt = Date.now();
      const mapCenter = map.width / 2;
      this.state.safeZone = {
        centerX: mapCenter,
        centerY: mapCenter,
        currentHalf: mapCenter,
        dps: 0,
        shrinking: false,
        shrinkProgress: 0,
        nextChangeIn: 10,
      };
    }

    // Initialize player input buffers
    this.state.players.forEach((_, idx) => {
      this.playerInputs.set(idx, null);
    });
  }

  /** Compute safe zone size and damage from elapsed time */
  private computeSafeZone(elapsedMs: number) {
    for (let i = 0; i < GameLoop.ZONE_PHASES.length; i++) {
      const phase = GameLoop.ZONE_PHASES[i];
      if (elapsedMs < phase.endTime) {
        const duration = phase.endTime - phase.startTime;
        const t = Math.min(1, Math.max(0, (elapsedMs - phase.startTime) / duration));
        const currentHalf = phase.fromHalf + (phase.toHalf - phase.fromHalf) * t;
        const shrinking = phase.fromHalf !== phase.toHalf;
        const shrinkProgress = shrinking ? t : 0;
        const nextChangeIn = (phase.endTime - elapsedMs) / 1000;
        return { currentHalf, dps: phase.dps, shrinking, shrinkProgress, nextChangeIn };
      }
    }
    return { currentHalf: 0, dps: 10, shrinking: false, shrinkProgress: 0, nextChangeIn: 0 };
  }

  /** Return true if player position is outside the safe zone */
  private isOutsideZone(px: number, py: number, cx: number, cy: number, half: number) {
    return px < cx - half || px > cx + half || py < cy - half || py > cy + half;
  }

  /**
   * Start the game loop for a game
   */
  static start(
    gameId: string,
    state: GameState,
    config?: GameLoopConfig
  ): GameLoop {
    let loop = activeLoops.get(gameId);

    if (loop && loop.isRunning) {
      console.warn(`[GameLoop] Game ${gameId} already has an active loop`);
      return loop;
    }

    loop = new GameLoop(gameId, state, config);
    loop.run();
    activeLoops.set(gameId, loop);

    console.log(`[GameLoop] Started for game ${gameId} at ${loop.tickRate} Hz`);
    return loop;
  }

  /**
   * Stop the game loop
   */
  static stop(gameId: string) {
    const loop = activeLoops.get(gameId);
    if (loop) {
      loop.stop();
      activeLoops.delete(gameId);
      console.log(`[GameLoop] Stopped for game ${gameId}`);
    }
  }

  /**
   * Get active loop for a game
   */
  static get(gameId: string): GameLoop | undefined {
    const loop = activeLoops.get(gameId);
    // Do NOT delete from activeLoops here — getInMemoryGameOver needs to read
    // the terminal state after the loop stops. Only static stop() cleans up.
    if (!loop || !loop.isRunning) {
      return undefined;
    }
    return loop;
  }

  /**
   * Queue player movement input
   * Called when client sends WASD input
   */
  setPlayerInput(playerIndex: number, input: MovementInput | null, seq?: number) {
    if (typeof seq === "number") {
      const lastSeq = this.playerInputSeq.get(playerIndex);
      if (typeof lastSeq === "number" && seq < lastSeq) {
        return;
      }
      this.playerInputSeq.set(playerIndex, seq);
    }

    const pendingInput = this.playerInputs.get(playerIndex) ?? null;
    let nextInput = input;

    // Jump is a one-shot pulse, so keep it latched until the loop tick consumes it.
    if (pendingInput?.jump && !nextInput?.jump) {
      nextInput = nextInput ? { ...nextInput, jump: true } : pendingInput;
    }

    if (nextInput?.jump) {
      const player = this.state.players[playerIndex];
      if (player) {
        // Short lock window for requiresGrounded casts to close jump/cast race.
        player.groundedCastLockUntil = Date.now() + 250;
      }
    }
    this.playerInputs.set(playerIndex, nextInput);
  }

  hasPendingJump(playerIndex: number): boolean {
    const input = this.playerInputs.get(playerIndex);
    return input?.jump === true;
  }

  /**
   * Main game loop - runs every tick
   */
  private run() {
    if (this.isRunning) {
      console.warn(`[GameLoop] ${this.gameId} already running`);
      return;
    }

    this.isRunning = true;
    const tickDuration = 1000 / this.tickRate;
    console.log(`[GameLoop] Using adaptive timer loop — tickDuration=${tickDuration.toFixed(2)}ms`);

    let lastTickTime = performance.now();
    const MAX_TICKS_PER_CALLBACK = 6;
    const runTicks = () => {
      if (!this.isRunning) return;
      let ticksProcessed = 0;

      while (ticksProcessed < MAX_TICKS_PER_CALLBACK) {
        const now = performance.now();
        if (lastTickTime + tickDuration > now) break;
        lastTickTime += tickDuration;
        ticksProcessed++;
        try {
          this.tick();
        } catch (err) {
          console.error(`[GameLoop] Error in tick for ${this.gameId}:`, err);
          this.stop();
          return;
        }
        if (!this.isRunning) return;
      }

      const now = performance.now();
      if (now - lastTickTime > tickDuration * MAX_TICKS_PER_CALLBACK) {
        lastTickTime = now;
      }

      const delayMs = Math.max(1, Math.ceil(lastTickTime + tickDuration - now));
      this.tickInterval = setTimeout(runTicks, delayMs);
    };

    this.tickInterval = setTimeout(runTicks, Math.max(1, Math.ceil(tickDuration)));
  }

  /**
   * Single tick of the game loop
   */
  private tick() {
    const tickStart = performance.now();
    const storedUnitScale = normalizeStoredUnitScale(this.state.unitScale);

    if (this.state.gameOver) {
      this.stop();
      return;
    }

    // Track new events for this entire tick (including activeChannel completion).
    const eventDiffStart = this.state.events.length;

    // 1. Apply player movement
    const moveStart = performance.now();
    // Track buff count per player before movement — applyMovement may splice JUMP_BOOST
    const buffCountsBefore = this.state.players.map((p) => p.buffs?.length ?? 0);
    let movementStateChanged = false;
    this.state.players.forEach((player, idx) => {
      const input = this.playerInputs.get(idx) ?? null;
      const dashStateBefore = player.activeDash ? { ...player.activeDash } : undefined;
      const dashAbilityIdBefore = player.activeDash?.abilityId;
      applyMovement(player, input, this.tickRate, this.mapCtx);

      if (dashStateBefore && !player.activeDash && dashStateBefore.hitTargetUserId) {
        const reachAbilityId = dashStateBefore.abilityId;
        const reachAbility = ABILITIES[reachAbilityId] as any;
        const reachTarget = this.state.players.find(
          (p) => p.userId === dashStateBefore.hitTargetUserId
        );

        if (reachAbility && reachTarget && (reachTarget.hp ?? 0) > 0 && !blocksEnemyTargeting(reachTarget) && !hasDamageImmune(reachTarget as any)) {
          const reachDamage = Math.max(0, Number(dashStateBefore.hitDamageOnComplete ?? 0));
          if (reachDamage > 0) {
            const finalDamage = resolveScheduledDamage({
              source: player,
              target: reachTarget,
              base: reachDamage,
              damageType: (reachAbility as any)?.damageType,
            });
            if (finalDamage > 0) {
              const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(
                this.state, reachTarget as any, finalDamage
              );
              const reachApply = redirectPlayer ? adjustedDamage : finalDamage;
              const reachResult = reachApply > 0
                ? applyDamageToTarget(reachTarget as any, reachApply)
                : { hpDamage: 0 };
              this.state.events.push({
                id: randomUUID(),
                timestamp: Date.now(),
                turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: player.userId,
                targetUserId: reachTarget.userId,
                abilityId: reachAbility.id,
                abilityName: reachAbility.name,
                effectType: dashStateBefore.hitEffectTypeOnComplete ?? "DAMAGE",
                value: reachApply,
              } as any);
              if (reachResult.hpDamage > 0) {
                processOnDamageTaken(this.state, reachTarget as any, reachResult.hpDamage, player.userId);
              }
              if (redirectPlayer && redirectAmt > 0) {
                applyRedirectToOpponent(this.state, redirectPlayer, redirectAmt);
              }
            }
          }
        }
      }

      // 穹隆化生: apply end-of-charge heal + 生太极 zone when directional dash naturally ends.
      if (dashAbilityIdBefore === "qionglong_huasheng" && !player.activeDash) {
        const dashEndNow = Date.now();
        const healed = applyHealToTarget(player as any, 10);
        if (healed > 0) {
          this.state.events.push({
            id: randomUUID(),
            timestamp: dashEndNow,
            turn: this.state.turn,
            type: "HEAL",
            actorUserId: player.userId,
            targetUserId: player.userId,
            abilityId: "qionglong_huasheng",
            abilityName: "穹隆化生（贯体）",
            effectType: "TIMED_SELF_HEAL",
            value: healed,
          } as any);
        }

        if (!this.state.groundZones) this.state.groundZones = [];
        this.state.groundZones.push({
          id: randomUUID(),
          ownerUserId: player.userId,
          x: player.position.x,
          y: player.position.y,
          z: player.position.z ?? 0,
          height: gameplayUnitsToWorldUnits(10, storedUnitScale),
          radius: gameplayUnitsToWorldUnits(8, storedUnitScale),
          expiresAt: dashEndNow + 24_000,
          damagePerInterval: 0,
          intervalMs: 3_000,
          lastTickAt: dashEndNow - 3_000,
          abilityId: SHENGTAIJI_ZONE_ID,
          abilityName: "生太极",
          maxTargets: 0,
        } as GroundZone);
        movementStateChanged = true;
      }

      if (dashAbilityIdBefore === "sanliu_xia" && !player.activeDash) {
        const sanliuAbility = ABILITIES["sanliu_xia"] as any;
        if (sanliuAbility) {
          addBuff({
            state: this.state,
            sourceUserId: player.userId,
            targetUserId: player.userId,
            ability: sanliuAbility,
            buffTarget: player as any,
            buff: {
              buffId: 1007,
              name: "散流霞",
              category: "BUFF",
              durationMs: 5_000,
              periodicMs: 1_000,
              periodicStartImmediate: false,
              breakOnPlay: false,
              description: "不可选中，移动速度提高20%，首秒无治疗，随后每秒回复2%最大气血",
              effects: [
                { type: "UNTARGETABLE" },
                { type: "SPEED_BOOST", value: 0.2 },
                { type: "PERIODIC_GUAN_TI_HEAL", value: 2 },
              ],
            } as any,
          });
          movementStateChanged = true;
        }
      }

      // 撼地: when dash ends, apply stun to enemies within 5u
      if (dashAbilityIdBefore === "han_di" && !player.activeDash) {
        const hanDiAbility = ABILITIES["han_di"] as any;
        if (hanDiAbility) {
          const stunBuff = hanDiAbility.buffs?.[0];
          if (stunBuff) {
            const stunRadius = gameplayUnitsToWorldUnits(5, storedUnitScale);
            for (const opp of this.state.players as any[]) {
              if (opp.userId === player.userId) continue;
              if ((opp.hp ?? 0) <= 0) continue;
              if (blocksEnemyTargeting(opp)) continue;
              const hdx = opp.position.x - player.position.x;
              const hdy = opp.position.y - player.position.y;
              if (Math.hypot(hdx, hdy) > stunRadius) continue;
              addBuff({
                state: this.state,
                sourceUserId: player.userId,
                targetUserId: opp.userId,
                ability: hanDiAbility,
                buffTarget: opp,
                buff: stunBuff,
              });
              // 1 impact damage on landing
              const hdDmg = resolveScheduledDamage({ source: player, target: opp, base: 1, damageType: (ABILITIES["han_di"] as any)?.damageType });
              if (hdDmg > 0) applyDamageToTarget(opp, hdDmg);
            }
            movementStateChanged = true;
          }
        }
      }

      // 跃潮斩波: when dash ends, deal 15 damage to enemies within 8u
      if (dashAbilityIdBefore === "yue_chao_zhan_bo" && !player.activeDash) {
        const yczbAbility = ABILITIES["yue_chao_zhan_bo"] as any;
        if (yczbAbility) {
          const landRadius = gameplayUnitsToWorldUnits(8, storedUnitScale);
          for (const opp of this.state.players as any[]) {
            if (opp.userId === player.userId) continue;
            if ((opp.hp ?? 0) <= 0) continue;
            if (blocksEnemyTargeting(opp)) continue;
            const ydx = opp.position.x - player.position.x;
            const ydy = opp.position.y - player.position.y;
            if (Math.hypot(ydx, ydy) > landRadius) continue;
            const dmg = resolveScheduledDamage({ source: player, target: opp, base: 15, damageType: (ABILITIES["yue_chao_zhan_bo"] as any)?.damageType });
            applyDamageToTarget(opp, dmg);
            if (dmg > 0) {
              this.state.events.push({
                id: randomUUID(), timestamp: Date.now(), turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: player.userId,
                targetUserId: opp.userId,
                abilityId: "yue_chao_zhan_bo",
                abilityName: yczbAbility.name,
                effectType: "DAMAGE",
                value: dmg,
              } as any);
            }
          }
          movementStateChanged = true;
        }
      }

      // 九转归一: when the knockback dash ends AND wall was hit, apply 羽化 stun
      if (dashAbilityIdBefore === "jiu_zhuan_gui_yi" && !player.activeDash) {        const stunMs: number = (player as any)._wallKnockStunMs ?? 0;
        if (stunMs > 0) {
          const jiuAbility = ABILITIES["jiu_zhuan_gui_yi"] as any;
          const yuHuaBuff = jiuAbility?.buffs?.find((b: any) => b.buffId === 9202);
          if (jiuAbility && yuHuaBuff) {
            // Remove the KNOCKED_BACK phase debuff so it doesn't overlap
            player.buffs = player.buffs.filter((b) => b.buffId !== 9201);
            const sourceId: string = (player as any)._wallKnockSourceUserId ?? player.userId;
            // addBuff handles: 递减, CONTROL_IMMUNE check, BUFF_APPLIED event, status bar
            addBuff({
              state: this.state,
              sourceUserId: sourceId,
              targetUserId: player.userId,
              ability: jiuAbility,
              buffTarget: player as any,
              buff: { ...yuHuaBuff, durationMs: stunMs },
            });
            movementStateChanged = true;
          }
        }
        delete (player as any)._wallKnockStunMs;
        delete (player as any)._wallKnockAbilityId;
        delete (player as any)._wallKnockSourceUserId;
      }

      // 鹤归孤山: on dash end, deal damage + stun to nearby enemies, then give caster 0.5s dash buff
      if (dashAbilityIdBefore === "he_gui_gu_shan" && !player.activeDash) {
        const heAbility = ABILITIES["he_gui_gu_shan"] as any;
        if (heAbility) {
          const stunBuff = heAbility.buffs?.find((b: any) => b.buffId === 2325);
          const outerRadius = gameplayUnitsToWorldUnits(10, storedUnitScale);
          const innerRadius = gameplayUnitsToWorldUnits(4, storedUnitScale);
          for (const opp of this.state.players as any[]) {
            if (opp.userId === player.userId) continue;
            if ((opp.hp ?? 0) <= 0) continue;
            if (blocksEnemyTargeting(opp)) continue;
            const hdx = opp.position.x - player.position.x;
            const hdy = opp.position.y - player.position.y;
            const dist = Math.hypot(hdx, hdy);
            if (dist > outerRadius) continue;
            // Base 2 damage for all within 10u
            const baseDmg = resolveScheduledDamage({ source: player, target: opp, base: 2, damageType: (ABILITIES["he_gui_gu_shan"] as any)?.damageType });
            if (baseDmg > 0) {
              applyDamageToTarget(opp, baseDmg);
              this.state.events.push({
                id: randomUUID(), timestamp: Date.now(), turn: this.state.turn,
                type: "DAMAGE", actorUserId: player.userId, targetUserId: opp.userId,
                abilityId: "he_gui_gu_shan", abilityName: heAbility.name,
                effectType: "DAMAGE", value: baseDmg,
              } as any);
            }
            // Extra 2 damage for within 4u
            if (dist <= innerRadius) {
              const extraDmg = resolveScheduledDamage({ source: player, target: opp, base: 2, damageType: (ABILITIES["he_gui_gu_shan"] as any)?.damageType });
              if (extraDmg > 0) {
                applyDamageToTarget(opp, extraDmg);
                this.state.events.push({
                  id: randomUUID(), timestamp: Date.now(), turn: this.state.turn,
                  type: "DAMAGE", actorUserId: player.userId, targetUserId: opp.userId,
                  abilityId: "he_gui_gu_shan", abilityName: heAbility.name,
                  effectType: "DAMAGE", value: extraDmg,
                } as any);
              }
            }
            // Stun via addBuff (handles 递减, CONTROL_IMMUNE, status bar)
            if (stunBuff) {
              addBuff({
                state: this.state,
                sourceUserId: player.userId,
                targetUserId: opp.userId,
                ability: heAbility,
                buffTarget: opp,
                buff: stunBuff,
              });
            }
          }
          // Grant caster 0.5s of post-landing dash CC immunity (冲势)
          applyDashRuntimeBuff({
            state: this.state,
            target: player as any,
            durationMs: 500,
            effects: [
              { type: "CONTROL_IMMUNE" },
              { type: "KNOCKBACK_IMMUNE" },
            ],
            sourceAbilityId: "he_gui_gu_shan",
            sourceAbilityName: heAbility.name,
          });
          movementStateChanged = true;
        }
      }

      // 化蝶 Phase 2: when Phase 1 dash ends, start the forward 27u dash + apply stealth/immune buff
      if (dashAbilityIdBefore === "hua_die" && !player.activeDash && !(player as any)._huaDieP2Done) {
        (player as any)._huaDieP2Done = true;
        const huaDieAbility = ABILITIES["hua_die"] as any;
        const huaDieBuffDef = huaDieAbility?.buffs?.find((b: any) => b.buffId === 2613);
        if (huaDieBuffDef) {
          addBuff({
            state: this.state,
            sourceUserId: player.userId,
            targetUserId: player.userId,
            ability: huaDieAbility ?? { id: "hua_die", name: "化蝶" },
            buffTarget: player as any,
            buff: huaDieBuffDef,
          });
        }
        // Phase 2: forward 27 units over 30 ticks
        const fLen4 = player.facing
          ? Math.sqrt(player.facing.x * player.facing.x + player.facing.y * player.facing.y)
          : 0;
        const fX4 = fLen4 > 0.01 ? player.facing!.x / fLen4 : 0;
        const fY4 = fLen4 > 0.01 ? player.facing!.y / fLen4 : 1;
        const p2Ticks = 30;
        const p2ForwardWorld = gameplayUnitsToWorldUnits(27, storedUnitScale);
        player.velocity.vx = 0;
        player.velocity.vy = 0;
        player.activeDash = {
          abilityId: "hua_die_p2",
          vxPerTick: fX4 * p2ForwardWorld / p2Ticks,
          vyPerTick: fY4 * p2ForwardWorld / p2Ticks,
          forceVzPerTick: 0,
          maxUpVz: 0.05,
          maxDownVz: -0.3,
          ticksRemaining: p2Ticks,
        } as any;
        applyDashRuntimeBuff({
          state: this.state,
          target: player as any,
          durationMs: Math.ceil(p2Ticks * (1000 / 30)) + 300,
          effects: [
            { type: "CONTROL_IMMUNE" },
            { type: "KNOCKBACK_IMMUNE" },
            { type: "DISPLACEMENT" },
            { type: "DASH_TURN_LOCK" },
          ],
          sourceAbilityId: "hua_die_p2",
          sourceAbilityName: "化蝶",
        });
        movementStateChanged = true;
      }

      // 化蝶 Phase 2 cleanup
      if (dashAbilityIdBefore === "hua_die_p2" && !player.activeDash) {
        (player as any)._huaDieP2Done = false;
      }

      // Cancel channel buffs based on input — read BEFORE clearing the one-shot jump flag
      if (input) {
        const isMoving =
          !!input.up ||
          !!input.down ||
          !!input.left ||
          !!input.right ||
          (input.dx !== undefined && input.dx !== 0) ||
          (input.dy !== undefined && input.dy !== 0);

        // 风来吴山 jump-lock: jump input is ignored while buff 1014 is active,
        // and must not count as a jump-cancel trigger.
        const jumpLockedByChannel = player.buffs.some((b) => b.buffId === 1014);
        const isJumping = !!input.jump && !jumpLockedByChannel;

        if (isMoving) player.buffs = player.buffs.filter((b) => !b.cancelOnMove);
        if (isJumping) player.buffs = player.buffs.filter((b) => !b.cancelOnJump);

        // 浮光掠影(1012):
        // - first 5s: moving does not break
        // - jump always breaks
        // - after 5s: moving breaks
        const fuguangStealth = player.buffs.find((b) => b.buffId === 1012);
        if (fuguangStealth) {
          const stealthAgeMs = Date.now() - (fuguangStealth.appliedAt ?? Date.now());
          const breakByMove = isMoving && stealthAgeMs >= 5_000;
          const breakByJump = isJumping;
          if (breakByMove || breakByJump) {
            player.buffs = player.buffs.filter((b) => b.buffId !== 1012 && !isDunyingCompanion(b));
          }
        }

        // Cancel activeChannel on move/jump
        if (player.activeChannel) {
          if (player.activeChannel.cancelOnMove && isMoving) player.activeChannel = undefined;
          else if (player.activeChannel.cancelOnJump && isJumping) player.activeChannel = undefined;
        }
      }

      // Post-pull stun (极乐引): when the pull's activeDash ends, apply 眩晕.
      // NOTE: 极乐引 is now instant AOE, so this block will never fire — kept for safety.
      if (dashStateBefore && !player.activeDash && this.pendingPostPullStuns.has(player.userId)) {
        const pendingStun = this.pendingPostPullStuns.get(player.userId)!;
        this.pendingPostPullStuns.delete(player.userId);
        const stunCfg = PULL_CHANNEL_POST_STUN_CONFIG[pendingStun.abilityId];
        if (stunCfg && (player.hp ?? 0) > 0) {
          const abilityRef = ABILITIES[pendingStun.abilityId] as any ?? { id: pendingStun.abilityId, name: pendingStun.abilityName };
          addBuff({
            state: this.state,
            sourceUserId: pendingStun.sourceUserId,
            targetUserId: player.userId,
            ability: abilityRef,
            buffTarget: player as any,
            buff: {
              buffId: stunCfg.buffId,
              name: stunCfg.buffName,
              category: "DEBUFF",
              durationMs: stunCfg.durationMs,
              effects: [{ type: "CONTROL" }],
            } as any,
          });
          movementStateChanged = true;
        }
      }

      // Clear the one-shot jump flag so it fires only once per press
      if (input?.jump) {
        this.playerInputs.set(idx, { ...input, jump: false });
      }
    });
    const moveTime = performance.now() - moveStart;

    // 1a-ch. Process active channels: out-of-range / LOS cancel + completion
    let channelStateChanged = false;
    if (this.state.players.length === 2) {
      for (let idx = 0; idx < 2; idx++) {
        const player = this.state.players[idx];
        if (!player.activeChannel) continue;

        const ch = player.activeChannel;
        const opp = this.state.players[idx === 0 ? 1 : 0];
        const target = this.state.players.find((p) => p.userId === ch.targetUserId) ?? opp;
        const channelAbility = (ABILITIES as any)[ch.abilityId] as any;

        // Silence interrupts pure active channels.
        if (hasBuffEffect(player as any, "SILENCE") || hasBuffEffect(player as any, "DISPLACEMENT")) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // cancelOnOutOfRange check
        if (ch.cancelOnOutOfRange !== undefined) {
          const dist = calculateDistance(player.position, target.position, storedUnitScale);
          if (dist > ch.cancelOnOutOfRange) {
            player.activeChannel = undefined;
            channelStateChanged = true;
            continue;
          }
        }

        // Target lost (stealth / untargetable) cancels opponent-targeted channels.
        if (channelAbility?.target === "OPPONENT" && blocksCardTargeting(target as any)) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // Task 8: cancel forward-facing channels if target leaves 180° front arc
        if (channelAbility && requiresFacing(channelAbility) && !isInFacingHemisphere(player as any, target as any)) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // Task 7: cancel opponent-targeted channels if LOS is blocked by structures.
        const _losBlockedChannel = channelAbility?.target === "OPPONENT" && (() => {
          const pz = (player.position as any).z ?? 0;
          const tz = (target.position as any).z ?? 0;
          if (this.mapCtx.collisionSystem) {
            return this.mapCtx.collisionSystem.checkLOS(
              player.position.x, player.position.y, pz,
              target.position.x, target.position.y, tz,
              this.mapCtx.width, this.mapCtx.height,
            );
          }
          return !!isLOSBlocked(
            player.position.x, player.position.y,
            target.position.x, target.position.y,
            this.mapCtx.objects, 0, pz, tz,
          );
        })();
        if (_losBlockedChannel) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // Channel completion
        const chNow = Date.now();
        if (chNow >= ch.startedAt + ch.durationMs) {
          let channelEffectDodged = false;
          for (const e of ch.effects) {
            if (e.type === "TIMED_SELF_HEAL") {
              const heal = resolveHealAmount({ target: player, base: e.value ?? 0 });
              const applied = applyHealToTarget(player as any, heal);
              if (applied > 0) {
                this.state.events.push({
                  id: randomUUID(),
                  timestamp: chNow,
                  turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: ch.abilityId,
                  abilityName: ch.abilityName,
                  effectType: "TIMED_SELF_HEAL",
                  value: applied,
                });
              }
            } else if (e.type === "TIMED_AOE_DAMAGE") {
              const range = e.range ?? 50;
              const dist = calculateDistance(player.position, target.position, storedUnitScale);
              if (dist <= range && target.hp > 0) {
                if (player.userId !== target.userId && blocksEnemyTargeting(target as any)) {
                  channelEffectDodged = true;
                  continue;
                }
                if (player.userId !== target.userId && hasDamageImmune(target as any)) {
                  channelEffectDodged = true;
                  continue;
                }
                // PROJECTILE_IMMUNE: block channel-completion damage from projectile abilities
                if (
                  player.userId !== target.userId &&
                  (ABILITIES[ch.abilityId] as any)?.isProjectile === true &&
                  (target.buffs as any[]).some(
                    (b: any) =>
                      b.effects.some((ef: any) => ef.type === "PROJECTILE_IMMUNE") &&
                      b.expiresAt > chNow
                  )
                ) {
                  channelEffectDodged = true;
                  continue;
                }
                // Dodge check: if target has DODGE (or PHYSICAL_DODGE for 外功), the whole channel completion misses
                if (player.userId !== target.userId && shouldDodgeForAbility(target as any, (ABILITIES[ch.abilityId] as any)?.damageType)) {
                  channelEffectDodged = true;
                  this.state.events.push({
                    id: randomUUID(), timestamp: chNow, turn: this.state.turn,
                    type: "DODGE",
                    actorUserId: target.userId,
                    targetUserId: player.userId,
                    abilityId: ch.abilityId,
                    abilityName: ch.abilityName,
                  } as any);
                  continue;
                }
                const dmg = resolveScheduledDamage({ source: player, target, base: e.value ?? 0, damageType: (ABILITIES[ch.abilityId] as any)?.damageType });
                if (dmg > 0) {
                  const { adjustedDamage: adjTimed, redirectPlayer: rtTimed, redirectAmt: raTimed } =
                    preCheckRedirect(this.state, target as any, dmg);
                  const timedApply = rtTimed ? adjTimed : dmg;
                  const timedResult = timedApply > 0
                    ? applyDamageToTarget(target as any, timedApply)
                    : { hpDamage: 0 };
                  this.state.events.push({
                    id: randomUUID(),
                    timestamp: chNow,
                    turn: this.state.turn,
                    type: "DAMAGE",
                    actorUserId: player.userId,
                    targetUserId: target.userId,
                    abilityId: ch.abilityId,
                    abilityName: ch.abilityName,
                    effectType: "TIMED_AOE_DAMAGE",
                    value: timedApply,
                  });
                  if (timedResult.hpDamage > 0) {
                    processOnDamageTaken(this.state, target as any, timedResult.hpDamage, player.userId);
                  }
                  if (rtTimed && raTimed > 0) {
                    applyRedirectToOpponent(this.state, rtTimed, raTimed);
                  }
                }
              }
            } else if (e.type === "TIMED_AOE_DAMAGE_IF_SELF_HP_GT") {
              const threshold = (e as any).threshold ?? 0;
              const range = e.range ?? 50;
              if (player.hp <= threshold) continue;
              const dist = calculateDistance(player.position, target.position, storedUnitScale);
              if (dist > range || target.hp <= 0) continue;
              if (player.userId !== target.userId && blocksEnemyTargeting(target as any)) continue;
              // PROJECTILE_IMMUNE: block bonus channel-completion damage from projectile abilities
              if (
                player.userId !== target.userId &&
                (ABILITIES[ch.abilityId] as any)?.isProjectile === true &&
                (target.buffs as any[]).some(
                  (b: any) =>
                    b.effects.some((ef: any) => ef.type === "PROJECTILE_IMMUNE") &&
                    b.expiresAt > chNow
                )
              ) continue;
              const dmg = resolveScheduledDamage({ source: player, target, base: e.value ?? 0, damageType: (ABILITIES[ch.abilityId] as any)?.damageType });
              applyDamageToTarget(target as any, dmg);
              if (dmg > 0) {
                this.state.events.push({
                  id: randomUUID(), timestamp: chNow, turn: this.state.turn,
                  type: "DAMAGE",
                  actorUserId: player.userId,
                  targetUserId: target.userId,
                  abilityId: ch.abilityId,
                  abilityName: ch.abilityName,
                  effectType: "TIMED_AOE_DAMAGE_IF_SELF_HP_GT",
                  value: dmg,
                });
              }
            } else if (e.type === "TIMED_PULL_TARGET_TO_FRONT") {
              if (player.userId === target.userId || target.hp <= 0) continue;
              if (blocksEnemyTargeting(target as any)) continue;
              if (hasKnockbackImmune(target as any)) continue;

              // 雷霆震怒 interaction: pull also strips the buff first
              const leiTingIdx = (target.buffs as any[]).findIndex((b: any) => b.buffId === 2506);
              if (leiTingIdx !== -1) {
                const leiTingBuff = (target.buffs as any[])[leiTingIdx];
                (target.buffs as any[]).splice(leiTingIdx, 1);
                pushBuffExpired(this.state, {
                  targetUserId: target.userId,
                  buffId: leiTingBuff.buffId,
                  buffName: leiTingBuff.name,
                  buffCategory: leiTingBuff.category,
                  sourceAbilityId: leiTingBuff.sourceAbilityId,
                  sourceAbilityName: leiTingBuff.sourceAbilityName,
                });
              }

              const facing = player.facing ?? { x: 0, y: 1 };
              const facingLen = Math.hypot(facing.x, facing.y);
              const nx = facingLen > 0.0001 ? facing.x / facingLen : 0;
              const ny = facingLen > 0.0001 ? facing.y / facingLen : 1;
              const maxPullUnits = Math.max(0, Number(e.value ?? 20));
              const basePullDurationTicks = Math.max(
                1,
                Math.round(Number((e as any).durationTicks ?? this.tickRate))
              );

              // Pull toward a point 1 unit in front of the caster, but move with timed speed.
              const anchorOffset = gameplayUnitsToWorldUnits(1, storedUnitScale);
              const anchorX = player.position.x + nx * anchorOffset;
              const anchorY = player.position.y + ny * anchorOffset;

              const anchorGroundZ = getGroundHeightForMap(
                anchorX,
                anchorY,
                target.position.z ?? 0,
                this.mapCtx
              );
              const casterZ = player.position.z ?? anchorGroundZ;
              const anchorZ = Math.max(anchorGroundZ, casterZ);

              const toAnchorX = anchorX - target.position.x;
              const toAnchorY = anchorY - target.position.y;
              const distanceToAnchor = Math.hypot(toAnchorX, toAnchorY);
              const maxPullDistance = gameplayUnitsToWorldUnits(maxPullUnits, storedUnitScale);
              const pullDistance = Math.min(distanceToAnchor, maxPullDistance);
              const pullDurationTicks = maxPullDistance > 0
                ? Math.max(1, Math.round(basePullDurationTicks * (pullDistance / maxPullDistance)))
                : basePullDurationTicks;
              const pullDurationMs = Math.max(
                1,
                Math.round((pullDurationTicks * 1000) / this.tickRate)
              );

              const dirX = distanceToAnchor > 0.0001 ? toAnchorX / distanceToAnchor : nx;
              const dirY = distanceToAnchor > 0.0001 ? toAnchorY / distanceToAnchor : ny;

              const targetGroundZ = getGroundHeightForMap(
                target.position.x,
                target.position.y,
                target.position.z ?? 0,
                this.mapCtx
              );
              const currentZ = target.position.z ?? targetGroundZ;
              const pullRatio = distanceToAnchor > 0.0001
                ? pullDistance / distanceToAnchor
                : 1;
              const targetZ = currentZ + (anchorZ - currentZ) * pullRatio;
              const verticalDelta = targetZ - currentZ;

              if (pullDistance > 0.0001 || Math.abs(verticalDelta) > 0.0001) {
                target.activeDash = {
                  abilityId: ch.abilityId,
                  vxPerTick: (dirX * pullDistance) / pullDurationTicks,
                  vyPerTick: (dirY * pullDistance) / pullDurationTicks,
                  forceVzPerTick: verticalDelta / pullDurationTicks,
                  maxUpVz: 999,
                  maxDownVz: -999,
                  ticksRemaining: pullDurationTicks,
                } as any;

                target.velocity = {
                  ...target.velocity,
                  vx: 0,
                  vy: 0,
                  vz: 0,
                };
                target.isPowerJump = false;
                target.isPowerJumpCombined = false;

                applyDashRuntimeBuff({
                  state: this.state,
                  target: target as any,
                  durationMs: pullDurationMs + 100,
                  effects: [
                    { type: "CONTROL_IMMUNE" },
                    { type: "KNOCKBACK_IMMUNE" },
                    { type: "DISPLACEMENT" },
                    { type: "DASH_TURN_LOCK" },
                  ] as any,
                  sourceAbilityId: ch.abilityId,
                  sourceAbilityName: ch.abilityName,
                  appliedAt: chNow,
                });

                // Register post-pull stun if configured for this ability.
                if (PULL_CHANNEL_POST_STUN_CONFIG[ch.abilityId]) {
                  this.pendingPostPullStuns.set(target.userId, {
                    sourceUserId: player.userId,
                    abilityId: ch.abilityId,
                    abilityName: ch.abilityName,
                  });
                }
              }

              resolveMapCollisions(target as any, this.mapCtx);

              const sealConfig = PULL_CHANNEL_QINGGONG_SEAL_CONFIG[ch.abilityId];
              if (sealConfig) {
                addBuff({
                  state: this.state,
                  sourceUserId: player.userId,
                  targetUserId: target.userId,
                  ability: (channelAbility ?? { id: ch.abilityId, name: ch.abilityName }) as any,
                  buffTarget: target as any,
                  buff: {
                    buffId: sealConfig.buffId,
                    name: sealConfig.buffName,
                    category: "DEBUFF",
                    durationMs: sealConfig.durationMs,
                    description: "无法施展轻功招式",
                    effects: [{ type: "QINGGONG_SEAL" }],
                  } as any,
                });
              }
            } else if (e.type === "DISPEL_BUFF_ATTRIBUTE") {
              // Dispel BUFF-category buffs from target by attribute (used by channel abilities like 少明指)
              // Skip if the preceding TIMED_AOE_DAMAGE was dodged/blocked
              if (channelEffectDodged) continue;
              if (target && target.hp > 0 && !blocksEnemyTargeting(target as any)) {
                const { overrides: chDispelOvr } = loadBuffEditorOverrides();
                const chAttrs: string[] = (e as any).attributes ?? [];
                const chDispelCount: number = (e as any).count ?? 1;
                for (const attr of chAttrs) {
                  let dispelled = 0;
                  while (dispelled < chDispelCount) {
                    const idx = (target.buffs as any[]).findIndex((b: any) => {
                      if (b.category !== "BUFF") return false;
                      const entry = chDispelOvr[String(b.buffId)];
                      return entry?.attribute === attr;
                    });
                    if (idx === -1) break;
                    const removed = (target.buffs as any[])[idx];
                    removeLinkedShield(target as any, removed);
                    (target.buffs as any[]).splice(idx, 1);
                    pushBuffExpired(this.state, {
                      targetUserId: target.userId,
                      buffId: removed.buffId,
                      buffName: removed.name,
                      buffCategory: removed.category,
                      sourceAbilityId: removed.sourceAbilityId,
                      sourceAbilityName: removed.sourceAbilityName,
                    });
                    dispelled++;
                  }
                }
              }
            } else if (e.type === "PLACE_GROUND_ZONE") {
              const facing = player.facing ?? { x: 0, y: 1 };
              const zoneOffset = gameplayUnitsToWorldUnits(e.zoneOffsetUnits ?? 6, storedUnitScale);
              const zoneX = player.position.x + facing.x * zoneOffset;
              const zoneY = player.position.y + facing.y * zoneOffset;
              const zoneZ = getGroundHeightForMap(zoneX, zoneY, player.position.z ?? 0, this.mapCtx);
              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: player.userId,
                x: zoneX,
                y: zoneY,
                z: zoneZ,
                height: gameplayUnitsToWorldUnits(e.zoneHeight ?? 10, storedUnitScale),
                radius: gameplayUnitsToWorldUnits(e.range ?? 8, storedUnitScale),
                expiresAt: chNow + (e.zoneDurationMs ?? 6_000),
                damagePerInterval: e.value ?? 4,
                intervalMs: e.zoneIntervalMs ?? 500,
                lastTickAt: chNow,
                abilityId: ch.abilityId,
                abilityName: ch.abilityName,
                maxTargets: e.maxTargets,
              } as GroundZone);
            }
          }

          // Set cooldown on the consumed ability instance (still in hand)
          const ability = player.hand.find((a) => a.instanceId === ch.instanceId);
          if (ability) {
            ability.cooldown = Math.max(ability.cooldown ?? 0, ch.cooldownTicks ?? 0);
          }

          // applyBuffsOnComplete: apply buffs[] to opponent on channel finish (not on cast)
          if ((channelAbility as any)?.applyBuffsOnComplete === true) {
            const buffDefs = (channelAbility as any)?.buffs ?? [];
            const oppAlive = target && (target.hp ?? 0) > 0;
            for (const buffDef of buffDefs) {
              const applyTarget = buffDef.applyTo === "SELF" ? player : target;
              if (applyTarget !== player && (!oppAlive || blocksEnemyTargeting(target as any))) continue;
              addBuff({
                state: this.state,
                sourceUserId: player.userId,
                targetUserId: (applyTarget as any).userId,
                ability: channelAbility as any,
                buffTarget: applyTarget as any,
                buff: buffDef,
              });
            }
          }

          // Forward channel completion counts as the cast "taking effect" and breaks stealth.
          if (ch.forwardChannel) {
            const hadFuguang = player.buffs.some((b) => b.buffId === 1012);
            player.buffs = player.buffs.filter(
              (b) => ![1011, 1012, 1013].includes(b.buffId) && !(hadFuguang && isDunyingCompanion(b))
            );
          }

          player.activeChannel = undefined;
          channelStateChanged = true;
        }
      }
    }

    // 1b. Decrement ability cooldowns each tick
    this.state.players.forEach((player) => {
      const cooldownSlowSum = player.buffs
        .flatMap((b) => b.effects)
        .filter((e: any) => e.type === "COOLDOWN_SLOW")
        .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
      const cooldownRate = Math.max(0, 1 - cooldownSlowSum);

      player.hand.forEach((ability: any) => {
        const abilityId = ability.abilityId || ability.id;
        const abilityDef = (ABILITIES as any)[abilityId];
        const maxCharges = Math.max(0, Number(abilityDef?.maxCharges ?? 0));

        if (maxCharges > 1) {
          if (typeof ability.chargeCount !== "number") ability.chargeCount = maxCharges;
          if (typeof ability.chargeRegenTicksRemaining !== "number") ability.chargeRegenTicksRemaining = 0;
          if (typeof ability.chargeLockTicks !== "number") ability.chargeLockTicks = 0;

          const recoveryTicks = Math.max(
            1,
            Number(abilityDef?.chargeRecoveryTicks ?? abilityDef?.cooldownTicks ?? 1)
          );

          ability.chargeCount = Math.max(0, Math.min(maxCharges, Number(ability.chargeCount ?? maxCharges)));
          const missingCharges = Math.max(0, maxCharges - ability.chargeCount);

          let regenQueue: number[] = Array.isArray(ability._chargeRegenQueueTicks)
            ? ability._chargeRegenQueueTicks
                .map((ticks: any) => Math.max(0, Number(ticks) || 0))
                .filter((ticks: number) => ticks > 0)
            : [];

          if (regenQueue.length === 0 && missingCharges > 0) {
            const seededRemaining = Math.max(0, Number(ability.chargeRegenTicksRemaining ?? 0));
            if (seededRemaining > 0) {
              regenQueue.push(seededRemaining);
            }
          }

          while (regenQueue.length < missingCharges) {
            regenQueue.push(recoveryTicks);
          }
          if (regenQueue.length > missingCharges) {
            regenQueue = regenQueue.slice(0, missingCharges);
          }

          if (ability.chargeLockTicks > 0) {
            ability.chargeLockTicks--;
          }

          if (regenQueue.length > 0) {
            ability._chargeRegenProgress = (ability._chargeRegenProgress ?? 0) + cooldownRate;
            while (ability._chargeRegenProgress >= 1) {
              regenQueue = regenQueue.map((ticks) => ticks - 1);
              ability._chargeRegenProgress -= 1;
            }

            const completedCharges = regenQueue.reduce(
              (count: number, ticks: number) => count + (ticks <= 0 ? 1 : 0),
              0
            );

            if (completedCharges > 0) {
              ability.chargeCount = Math.min(maxCharges, ability.chargeCount + completedCharges);
              regenQueue = regenQueue.filter((ticks) => ticks > 0);
            }
          } else {
            ability._chargeRegenProgress = 0;
          }

          ability._chargeRegenQueueTicks = regenQueue;
          ability.chargeRegenTicksRemaining = regenQueue.length > 0
            ? Math.max(0, Math.ceil(Math.min(...regenQueue)))
            : 0;

          if (ability.chargeCount <= 0) {
            ability.cooldown = Math.max(0, ability.chargeRegenTicksRemaining ?? 0);
          } else if (ability.chargeLockTicks > 0) {
            ability.cooldown = Math.max(0, ability.chargeLockTicks ?? 0);
          } else {
            ability.cooldown = 0;
          }

          return;
        }

        if (ability.cooldown > 0) {
          ability._cooldownProgress = (ability._cooldownProgress ?? 0) + cooldownRate;
          while (ability._cooldownProgress >= 1 && ability.cooldown > 0) {
            ability.cooldown--;
            ability._cooldownProgress -= 1;
          }
        } else {
          ability._cooldownProgress = 0;
        }
      });
    });

    // 1c. Wall-clock buff expiry + periodic effects (DoT / HoT)
    const now = Date.now();
    // Pre-seed buffsChanged: true if movement consumed any buff (e.g. JUMP_BOOST splice)
    let buffsChanged = this.state.players.some(
      (p, idx) => (p.buffs?.length ?? 0) !== buffCountsBefore[idx]
    ) || channelStateChanged || movementStateChanged;

    // Cancel channel buffs whose out-of-range condition is exceeded (e.g. 云飞玉皇)
    if (this.state.players.length === 2) {
      for (let idx = 0; idx < 2; idx++) {
        const player = this.state.players[idx];
        const opp = this.state.players[idx === 0 ? 1 : 0];
        const before = player.buffs.length;
        const removedByRange = player.buffs.filter((b: any) => {
          if (b.cancelOnOutOfRange === undefined) return false;
          const dist = calculateDistance(player.position, opp.position, storedUnitScale);
          return dist > b.cancelOnOutOfRange;
        });
        for (const removed of removedByRange) {
          removeLinkedShield(player as any, removed as any);
        }
        player.buffs = player.buffs.filter((b: any) => {
          if (b.cancelOnOutOfRange === undefined) return true;
          const dist = calculateDistance(player.position, opp.position, storedUnitScale);
          return dist <= b.cancelOnOutOfRange;
        });
        if (player.buffs.length !== before) buffsChanged = true;
      }
    }

    // Track event count before damage processing so we can diff-patch new events
    const eventsBefore = this.state.events.length;

    this.state.players.forEach((player, pidx) => {
      const oppIdx = pidx === 0 ? 1 : 0;
      const opp = this.state.players[oppIdx];

      // Silence interrupts runtime channel buffs unless the buff itself is interrupt-immune.
      if (hasBuffEffect(player as any, "SILENCE") || hasBuffEffect(player as any, "DISPLACEMENT")) {
        const removedBySilence = player.buffs.filter(
          (b) => isChannelBuffRuntime(b as any) && !b.effects.some((e: any) => e.type === "INTERRUPT_IMMUNE")
        );
        if (removedBySilence.length > 0) {
          for (const removed of removedBySilence) {
            removeLinkedShield(player as any, removed as any);
          }
          player.buffs = player.buffs.filter((b) => !removedBySilence.includes(b));
          for (const b of removedBySilence) {
            pushBuffExpired(this.state, {
              targetUserId: player.userId,
              buffId: b.buffId,
              buffName: b.name,
              buffCategory: b.category,
              sourceAbilityId: b.sourceAbilityId,
              sourceAbilityName: b.sourceAbilityName,
            });
          }
          buffsChanged = true;
        }
      }

      for (const buff of player.buffs) {
        if (now >= buff.expiresAt) continue;
        // Fire periodic effects (DoT / HoT) if interval has elapsed
        if (buff.periodicMs !== undefined && buff.lastTickAt !== undefined) {
          if (now - buff.lastTickAt >= buff.periodicMs) {
            buff.lastTickAt = now;
            for (const e of buff.effects) {
              if (e.type === "PERIODIC_DAMAGE") {
                if (opp.userId !== player.userId && (blocksEnemyTargeting(player as any) || hasDamageImmune(player as any))) {
                  buffsChanged = true;
                  continue;
                }
                const stackMult = buff.stacks ?? 1;
                const dmg = resolveScheduledDamage({
                  source: opp,
                  target: player,
                  base: (e.value ?? 0) * stackMult,
                  damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                });
                if (dmg > 0) {
                  const { adjustedDamage: adjPeri, redirectPlayer: rtPeri, redirectAmt: raPeri } =
                    preCheckRedirect(this.state, player as any, dmg);
                  const periApply = rtPeri ? adjPeri : dmg;
                  const periResult = periApply > 0
                    ? applyDamageToTarget(player as any, periApply)
                    : { hpDamage: 0 };
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "DAMAGE",
                    actorUserId: opp.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "PERIODIC_DAMAGE",
                    value: periApply,
                  });
                  if (periResult.hpDamage > 0) {
                    processOnDamageTaken(this.state, player as any, periResult.hpDamage, opp.userId);
                  }
                  if (rtPeri && raPeri > 0) {
                    applyRedirectToOpponent(this.state, rtPeri, raPeri);
                  }
                }
                buffsChanged = true;
              } else if (e.type === "PERIODIC_HEAL") {
                const heal = resolveHealAmount({ target: player, base: e.value ?? 0 });
                const applied = applyHealToTarget(player as any, heal);
                if (applied > 0) {
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "PERIODIC_HEAL",
                    value: applied,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "PERIODIC_GUAN_TI_HEAL") {
                // 贯体 heal: bypasses HEAL_REDUCTION; value is % of maxHp per tick
                const pct = (e.value ?? 0) / 100;
                const healAmt = Math.floor((player.maxHp ?? 100) * pct);
                const applied = applyHealToTarget(player as any, healAmt);
                if (applied > 0) {
                  const baseName = buff.sourceAbilityName ?? buff.name ?? "贯体";
                  const guanTiName = baseName.includes("（贯体）") ? baseName : `${baseName}（贯体）`;
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: guanTiName,
                    effectType: "PERIODIC_GUAN_TI_HEAL",
                    value: applied,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "CHANNEL_AOE_TICK") {
                // Channel AOE: deal damage to opponent if within range
                const range = e.range ?? 10;
                const dist = calculateDistance(player.position, opp.position, storedUnitScale);
                if (dist <= range && opp.hp > 0) {
                  if (player.userId !== opp.userId && blocksEnemyTargeting(opp as any)) {
                    continue;
                  }
                  const angle = (e as any).aoeAngle ?? 360;
                  if (angle < 360 && dist > 0) {
                    const facing = player.facing ?? { x: 0, y: 1 };
                    const dx = opp.position.x - player.position.x;
                    const dy = opp.position.y - player.position.y;
                    const planarDist = Math.sqrt(dx * dx + dy * dy);
                    const dot = planarDist > 0.0001 ? (facing.x * dx + facing.y * dy) / planarDist : 1;
                    const halfAngleRad = (angle / 2) * (Math.PI / 180);
                    if (dot < Math.cos(halfAngleRad)) {
                      continue;
                    }
                  }
                  // Task 7: channel ticks stop applying through structures
                  const _losBlockedTick = (() => {
                    const pz = (player.position as any).z ?? 0;
                    const oz = (opp.position as any).z ?? 0;
                    if (this.mapCtx.collisionSystem) {
                      return this.mapCtx.collisionSystem.checkLOS(
                        player.position.x, player.position.y, pz,
                        opp.position.x, opp.position.y, oz,
                        this.mapCtx.width, this.mapCtx.height,
                      );
                    }
                    return !!isLOSBlocked(
                      player.position.x, player.position.y,
                      opp.position.x, opp.position.y,
                      this.mapCtx.objects, 0, pz, oz,
                    );
                  })();
                  if (_losBlockedTick) {
                    player.activeChannel = undefined;
                    channelStateChanged = true;
                    continue;
                  }
                  if (
                    tryApplyDodgeForHit({
                      state: this.state,
                      source: player,
                      target: opp as any,
                      abilityId: buff.sourceAbilityId,
                      abilityName: buff.sourceAbilityName ?? buff.name,
                      enabled: buff.sourceAbilityId === "fenglai_wushan",
                      damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                    })
                  ) {
                    buffsChanged = true;
                    continue;
                  }
                  const dmg = resolveScheduledDamage({
                    source: player,
                    target: opp,
                    base: e.value ?? 0,
                    damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
                  });
                  if (dmg > 0) {
                    const { adjustedDamage: adjAoe, redirectPlayer: rtAoe, redirectAmt: raAoe } =
                      preCheckRedirect(this.state, opp as any, dmg);
                    const aoeApply = rtAoe ? adjAoe : dmg;
                    const aoeResult = aoeApply > 0
                      ? applyDamageToTarget(opp as any, aoeApply)
                      : { hpDamage: 0 };
                    this.state.events.push({
                      id: randomUUID(), timestamp: now, turn: this.state.turn,
                      type: "DAMAGE",
                      actorUserId: player.userId,
                      targetUserId: opp.userId,
                      abilityId: buff.sourceAbilityId,
                      abilityName: buff.sourceAbilityName ?? buff.name,
                      effectType: "CHANNEL_AOE_TICK",
                      value: aoeApply,
                    });
                    if (aoeResult.hpDamage > 0) {
                      processOnDamageTaken(this.state, opp as any, aoeResult.hpDamage, player.userId);
                    }
                    if (rtAoe && raAoe > 0) {
                      applyRedirectToOpponent(this.state, rtAoe, raAoe);
                    }
                  }
                  buffsChanged = true;
                }
              } else if (e.type === "CHANNEL_AOE_TICK_DAMAGE") {
                // 斩无常: AOE damage to enemies within range every tick
                const dmgRange = e.range ?? 4;
                const dmgVal = e.value ?? 1;
                const dist = calculateDistance(player.position, opp.position, storedUnitScale);
                if (dist <= gameplayUnitsToWorldUnits(dmgRange, storedUnitScale) && opp.hp > 0) {
                  const dmgResult = applyDamageToTarget(opp as any, dmgVal);
                  const dmgDealt = dmgResult.hpDamage + dmgResult.shieldAbsorbed;
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "DAMAGE",
                    actorUserId: player.userId,
                    targetUserId: opp.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "CHANNEL_AOE_TICK_DAMAGE",
                    value: dmgDealt,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "YING_TIAN_SHIELD") {
                // 应天授命: every 1s, settle accumulated shield-absorbed damage (capped at 20% maxHp) as true damage
                const yMaxHp = player.maxHp ?? 100;
                const accum: number = (buff as any).yingTianAccum ?? 0;
                const cap = yMaxHp * 0.2;
                const settle = Math.min(accum, cap);
                (buff as any).yingTianAccum = 0;
                if (settle > 0) {
                  // True damage — bypass DR and shields
                  const preHp = player.hp;
                  player.hp = Math.max(0, player.hp - settle);
                  const settledHpDmg = preHp - player.hp;
                  if (settledHpDmg > 0) {
                    this.state.events.push({
                      id: randomUUID(), timestamp: now, turn: this.state.turn,
                      type: "DAMAGE",
                      actorUserId: buff.sourceUserId ?? player.userId,
                      targetUserId: player.userId,
                      abilityId: buff.sourceAbilityId,
                      abilityName: buff.sourceAbilityName ?? buff.name,
                      effectType: "YING_TIAN_SHIELD",
                      value: settledHpDmg,
                    });
                  }
                  buffsChanged = true;
                }
              }
            }
          }
        }

        // Fire TIMED_AOE_DAMAGE effects (each fires exactly once at its delayMs offset)
        if (buff.appliedAt !== undefined) {
          for (let effIdx = 0; effIdx < buff.effects.length; effIdx++) {
            const e = buff.effects[effIdx];
            if (
              e.type !== "TIMED_AOE_DAMAGE" &&
              e.type !== "TIMED_SELF_DAMAGE" &&
              e.type !== "TIMED_GUAN_TI_HEAL" &&
              e.type !== "PLACE_GROUND_ZONE"
            ) continue;
            if (e.delayMs === undefined) continue;
            if (buff.firedDelayIndices?.includes(effIdx)) continue;
            if (now < buff.appliedAt + e.delayMs) continue;

            // Mark this effect as fired
            if (!buff.firedDelayIndices) buff.firedDelayIndices = [];
            buff.firedDelayIndices.push(effIdx);

            // Delayed follow-up attacks may have custom stealth-only break behavior.
            if (e.type === "TIMED_AOE_DAMAGE" && buff.sourceAbilityId) {
              const triggeredAbility = ABILITIES[buff.sourceAbilityId];
              if (triggeredAbility && applyTriggeredFollowUpPlayRules(player as any, triggeredAbility as any)) {
                buffsChanged = true;
              }
            }

            // TIMED_GUAN_TI_HEAL: completion heal bypassing HEAL_REDUCTION
            if (e.type === "TIMED_GUAN_TI_HEAL") {
              const pct = (e.value ?? 0) / 100;
              const healAmt = Math.floor((player.maxHp ?? 100) * pct);
              const applied = applyHealToTarget(player as any, healAmt);
              if (applied > 0) {
                const baseName = buff.sourceAbilityName ?? buff.name ?? "贯体";
                const guanTiName = baseName.includes("（贯体）") ? baseName : `${baseName}（贯体）`;
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: guanTiName,
                  effectType: "TIMED_GUAN_TI_HEAL",
                  value: applied,
                });
              }
              buffsChanged = true;
              continue;
            }

            // PLACE_GROUND_ZONE: place a persistent damage zone in front of caster
            if (e.type === "PLACE_GROUND_ZONE") {
              const facing = player.facing ?? { x: 0, y: 1 };
              const zoneOffset = gameplayUnitsToWorldUnits(e.zoneOffsetUnits ?? 6, storedUnitScale);
              const zoneX = player.position.x + facing.x * zoneOffset;
              const zoneY = player.position.y + facing.y * zoneOffset;
              const zoneZ = getGroundHeightForMap(zoneX, zoneY, player.position.z ?? 0, this.mapCtx);
              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: player.userId,
                x: zoneX,
                y: zoneY,
                z: zoneZ,
                height: gameplayUnitsToWorldUnits(e.zoneHeight ?? 10, storedUnitScale),
                radius: gameplayUnitsToWorldUnits(e.range ?? 8, storedUnitScale),
                expiresAt: now + (e.zoneDurationMs ?? 6_000),
                damagePerInterval: e.value ?? 4,
                intervalMs: e.zoneIntervalMs ?? 500,
                lastTickAt: now,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                maxTargets: e.maxTargets,
              } as GroundZone);
              buffsChanged = true;
              continue;
            }

            // TIMED_SELF_DAMAGE: delayed damage applied to the buff owner.
            if (e.type === "TIMED_SELF_DAMAGE") {
              const sourcePlayer = this.state.players.find((p) => p.userId === (buff as any).sourceUserId) ?? opp;
              const dmg = resolveScheduledDamage({
                source: sourcePlayer,
                target: player,
                base: e.value ?? 0,
                damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
              });
              applyDamageToTarget(player as any, dmg);
              if (dmg > 0) {
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "DAMAGE",
                  actorUserId: sourcePlayer.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName ?? buff.name,
                  effectType: "TIMED_SELF_DAMAGE",
                  value: dmg,
                });
              }
              buffsChanged = true;
              continue;
            }

            if (opp.hp <= 0) continue;

            // Range check (using gameplay units via calculateDistance)
            const range = e.range ?? 10;
            const dist = calculateDistance(player.position, opp.position, storedUnitScale);
            if (dist > range) continue;

            // Cone angle check (skip for full-circle 360°)
            const angle = e.aoeAngle ?? 360;
            if (angle < 360 && dist > 0) {
              const facing = player.facing ?? { x: 0, y: 1 };
              const rawDx = opp.position.x - player.position.x;
              const rawDy = opp.position.y - player.position.y;
              const rawDist2d = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
              const dot = rawDist2d > 0 ? (facing.x * rawDx + facing.y * rawDy) / rawDist2d : 0;
              const halfAngleRad = (angle / 2) * (Math.PI / 180);
              if (dot < Math.cos(halfAngleRad)) continue;
            }

            if (player.userId !== opp.userId && blocksEnemyTargeting(opp as any)) {
              continue;
            }

            if (
              tryApplyDodgeForHit({
                state: this.state,
                source: player,
                target: opp as any,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                enabled: buff.sourceAbilityId === "wu_jianyu",
                damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
              })
            ) {
              buffsChanged = true;
              continue;
            }

            // Apply damage
            const dmg = resolveScheduledDamage({
              source: player,
              target: opp,
              base: e.value ?? 0,
              damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType,
            });
            applyDamageToTarget(opp as any, dmg);

            if (dmg > 0) {
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: player.userId,
                targetUserId: opp.userId,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                effectType: "TIMED_AOE_DAMAGE",
                value: dmg,
              });
            }

            // Lifesteal
            if (e.lifestealPct && e.lifestealPct > 0 && dmg > 0) {
              const healAmt = Math.floor(dmg * e.lifestealPct);
              const applied = applyHealToTarget(player as any, healAmt);
              if (applied > 0) {
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName ?? buff.name,
                  effectType: "TIMED_AOE_DAMAGE",
                  value: applied,
                });
              }
            }

            // Type-3 knockback control.
            if (e.knockbackUnits && e.knockbackUnits > 0 && dist > 0) {
              const knockbackResult = applyType3KnockbackControl({
                state: this.state,
                source: player,
                target: opp,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName,
                knockbackUnits: e.knockbackUnits,
                controlDurationMs: Math.max(0, e.knockbackSilenceMs ?? 0),
                mapCtx: this.mapCtx,
                now,
              });

              if (knockbackResult.applied) {

                // Knockback breaks 浮光掠影(1012) and 天地无极(1013) stealth;
                // 暗尘弥散(1011) is immune to control-based stealth break.
                const hadFuguang = opp.buffs.some((b) => b.buffId === 1012);
                const brokenStealth = opp.buffs.filter(
                  (b) => b.buffId === 1012 || b.buffId === 1013 || (hadFuguang && isDunyingCompanion(b))
                );
                if (brokenStealth.length > 0) {
                  opp.buffs = opp.buffs.filter((b) => !brokenStealth.includes(b));
                  for (const b of brokenStealth) {
                    pushBuffExpired(this.state, {
                      targetUserId: opp.userId,
                      buffId: b.buffId,
                      buffName: b.name,
                      buffCategory: b.category,
                      sourceAbilityId: b.sourceAbilityId,
                      sourceAbilityName: b.sourceAbilityName,
                    });
                  }
                }

                if (knockbackResult.removedStuns) {
                  buffsChanged = true;
                }
              }
            }

            buffsChanged = true;
          }
        }
      }

      // Remove expired buffs (with special natural-expiry handling).
      const before = player.buffs.length;
      const naturallyExpired = player.buffs.filter((b) => now >= b.expiresAt);
      for (const expired of naturallyExpired) {
        removeLinkedShield(player as any, expired as any);
      }
      const zhenShanHeAbility = ABILITIES[ZHEN_SHAN_HE_ABILITY_ID];
      const xuanjianNaturallyExpired = naturallyExpired.filter(
        (b) => b.buffId === ZHEN_SHAN_HE_XUANJIAN_BUFF_ID && b.sourceAbilityId === ZHEN_SHAN_HE_ABILITY_ID
      );
      if (zhenShanHeAbility) {
        for (const expired of xuanjianNaturallyExpired) {
          transformExpiredXuanjian({
            state: this.state,
            ability: zhenShanHeAbility,
            target: player as any,
            sourceUserId: expired.sourceUserId ?? player.userId,
          });
          buffsChanged = true;
        }
      }
      const moheNaturallyExpired = naturallyExpired.filter((b) => isMoheKnockdown(b as any));
      for (const b of moheNaturallyExpired) {
        const maxHp = player.maxHp ?? 100;
        const threshold = maxHp * 0.3;
        if (player.hp < threshold) {
          const moheAbility = ABILITIES["mohe_wuliang"];
          if (moheAbility) {
            addBuff({
              state: this.state,
              sourceUserId: (b as any).sourceUserId ?? player.userId,
              targetUserId: player.userId,
              ability: moheAbility,
              buffTarget: player as any,
              buff: {
                buffId: 1202,
                name: "摩诃无量·眩晕",
                category: "DEBUFF",
                durationMs: 2_000,
                breakOnPlay: false,
                description: "眩晕：无法移动、跳跃和施放技能",
                effects: [{ type: "CONTROL" }],
              },
            });
          }
          buffsChanged = true;
        }
      }
      player.buffs = player.buffs.filter((b) => now < b.expiresAt);
      if (player.buffs.length !== before) buffsChanged = true;

      // 无相诀 natural-expire check: if buff 2710 expired naturally AND player hp < 10%, 贯体 heal 50%
      const wuxiangExpired = naturallyExpired.filter((b) => b.buffId === 2710);
      for (const _b of wuxiangExpired) {
        const wxMaxHp = player.maxHp ?? 100;
        if (player.hp < wxMaxHp * 0.1) {
          const wxHeal = Math.floor(wxMaxHp * 0.5);
          const wxApplied = applyHealToTarget(player as any, wxHeal);
          if (wxApplied > 0) {
            this.state.events.push({
              id: randomUUID(), timestamp: now, turn: this.state.turn,
              type: "HEAL",
              actorUserId: player.userId,
              targetUserId: player.userId,
              abilityId: "wu_xiang_jue",
              abilityName: "无相诀（贯体）",
              effectType: "DAMAGE_REDUCTION_HP_SCALING",
              value: wxApplied,
            });
            buffsChanged = true;
          }
        }
      }
    });

    // 1d. 毒圈 — poison zone damage (arena mode only, 1x per second)
    if (this.isArenaMode && this.state.safeZone) {
      const elapsedMs = now - this.zoneStartedAt;
      const { currentHalf, dps, shrinking, shrinkProgress, nextChangeIn } = this.computeSafeZone(elapsedMs);
      this.state.safeZone.currentHalf = currentHalf;
      this.state.safeZone.dps = dps;
      this.state.safeZone.shrinking = shrinking;
      this.state.safeZone.shrinkProgress = shrinkProgress;
      this.state.safeZone.nextChangeIn = nextChangeIn;

      // Apply damage once per second
      if (dps > 0 && now - this.lastZoneDamageAt >= 1000) {
        this.lastZoneDamageAt = now;
        const cx = this.state.safeZone.centerX;
        const cy = this.state.safeZone.centerY;
        for (const player of this.state.players) {
          if (player.hp <= 0) continue;
          if (this.isOutsideZone(player.position.x, player.position.y, cx, cy, currentHalf)) {
            applyDamageToTarget(player as any, dps);
            this.state.events.push({
              id: randomUUID(), timestamp: now, turn: this.state.turn,
              type: "DAMAGE",
              actorUserId: player.userId,
              targetUserId: player.userId,
              abilityName: "毒圈",
              effectType: "PERIODIC_DAMAGE",
              value: dps,
            });
            buffsChanged = true; // triggers HP + event broadcast
          }
        }
      }
    }

    // 1e. Ground zone damage ticks (e.g. 狂龙乱舞)
    if (this.state.groundZones && this.state.groundZones.length > 0) {
      const activeZones: GroundZone[] = [];
      for (const zone of this.state.groundZones) {
        if (now >= zone.expiresAt) continue; // expired — drop it
        activeZones.push(zone);
        // Enter/exit zones: check every frame — no interval gate needed
        if (zone.abilityId === SHENGTAIJI_ZONE_ID || zone.abilityId === "sheng_tai_ji") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? gameplayUnitsToWorldUnits(10, storedUnitScale);
          const isInsideZone = (p: any) => {
            const dx = p.position.x - zone.x;
            const dy = p.position.y - zone.y;
            const inRadius = Math.sqrt(dx * dx + dy * dy) <= zone.radius;
            const pz = p.position.z ?? 0;
            const inHeight = Math.abs(pz - zoneZ) <= zoneHeight;
            return inRadius && inHeight;
          };
          const zoneSourceAbilityId = zone.abilityId === SHENGTAIJI_ZONE_ID ? "qionglong_huasheng" : zone.abilityId;
          const zoneSourceAbilityName = zone.abilityId === SHENGTAIJI_ZONE_ID ? "穹隆化生" : zone.abilityName ?? "生太极";
          const zoneAbility = (ABILITIES[zoneSourceAbilityId] ?? { id: zoneSourceAbilityId, name: zoneSourceAbilityName }) as any;

          if (owner && owner.hp > 0) {
            const ownerInside = isInsideZone(owner);
            const ownerHasBuff = owner.buffs.some((b: any) => b.buffId === SHENGTAIJI_PULSE_BUFF_ID && b.expiresAt > now);
            if (ownerInside && !ownerHasBuff) {
              // Cleanse CC on enter
              const ccRemoved = owner.buffs.filter((b: any) =>
                b.effects?.some((e: any) => e.type === "CONTROL" || e.type === "ATTACK_LOCK")
              );
              owner.buffs = owner.buffs.filter((b: any) =>
                !b.effects?.some((e: any) => e.type === "CONTROL" || e.type === "ATTACK_LOCK")
              );
              for (const removed of ccRemoved) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: zoneAbility,
                buffTarget: owner as any,
                buff: {
                  buffId: SHENGTAIJI_PULSE_BUFF_ID,
                  name: "生太极",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  breakOnPlay: false,
                  effects: [{ type: "CONTROL_IMMUNE" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!ownerInside && ownerHasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === SHENGTAIJI_PULSE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== SHENGTAIJI_PULSE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }

          for (const target of this.state.players) {
            if (target.userId === zone.ownerUserId) continue;
            if (target.hp <= 0) continue;
            const targetInside = isInsideZone(target);
            const targetHasBuff = target.buffs.some((b: any) => b.buffId === SHENGTAIJI_ENEMY_SLOW_BUFF_ID && b.expiresAt > now);
            if (targetInside && !targetHasBuff) {
              const hasRootSlowImmune = target.buffs.some((b: any) =>
                b.effects?.some((e: any) => e.type === "ROOT_SLOW_IMMUNE")
              );
              if (!hasRootSlowImmune) {
                addBuff({
                  state: this.state,
                  sourceUserId: zone.ownerUserId,
                  targetUserId: target.userId,
                  ability: zoneAbility,
                  buffTarget: target as any,
                  buff: {
                    buffId: SHENGTAIJI_ENEMY_SLOW_BUFF_ID,
                    name: "生太极·迟滞",
                    category: "DEBUFF",
                    durationMs: zone.expiresAt - now,
                    breakOnPlay: false,
                    effects: [{ type: "SLOW", value: 0.4 }],
                  } as any,
                });
                buffsChanged = true;
              }
            } else if (!targetInside && targetHasBuff) {
              const removed = target.buffs.find((b: any) => b.buffId === SHENGTAIJI_ENEMY_SLOW_BUFF_ID);
              target.buffs = target.buffs.filter((b: any) => b.buffId !== SHENGTAIJI_ENEMY_SLOW_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: target.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 冲阴阳: owner inside → 内功减伤30%; outside → remove
        if (zone.abilityId === "chong_yin_yang") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? gameplayUnitsToWorldUnits(10, storedUnitScale);
          if (owner && owner.hp > 0) {
            const dx = owner.position.x - zone.x;
            const dy = owner.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((owner.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === CHONG_YIN_YANG_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["chong_yin_yang"] ?? { id: "chong_yin_yang", name: "冲阴阳" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: CHONG_YIN_YANG_ZONE_BUFF_ID,
                  name: "冲阴阳",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [{ type: "DAMAGE_REDUCTION", value: 0.3, damageType: "内功" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === CHONG_YIN_YANG_ZONE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== CHONG_YIN_YANG_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 凌太虚: owner inside → 外功减伤30%; outside → remove
        if (zone.abilityId === "ling_tai_xu") {
          const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? gameplayUnitsToWorldUnits(10, storedUnitScale);
          if (owner && owner.hp > 0) {
            const dx = owner.position.x - zone.x;
            const dy = owner.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((owner.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = owner.buffs.some((b: any) => b.buffId === LING_TAI_XU_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: owner.userId,
                ability: (ABILITIES["ling_tai_xu"] ?? { id: "ling_tai_xu", name: "凌太虚" }) as any,
                buffTarget: owner as any,
                buff: {
                  buffId: LING_TAI_XU_ZONE_BUFF_ID,
                  name: "凌太虚",
                  category: "BUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [{ type: "DAMAGE_REDUCTION", value: 0.3, damageType: "外功" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = owner.buffs.find((b: any) => b.buffId === LING_TAI_XU_ZONE_BUFF_ID);
              owner.buffs = owner.buffs.filter((b: any) => b.buffId !== LING_TAI_XU_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: owner.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // 吞日月: enemies inside → 封轻功; outside → remove
        if (zone.abilityId === "tun_ri_yue") {
          const zoneZ = zone.z ?? 0;
          const zoneHeight = zone.height ?? gameplayUnitsToWorldUnits(10, storedUnitScale);
          for (const target of this.state.players) {
            if (target.userId === zone.ownerUserId) continue;
            if (target.hp <= 0) continue;
            const dx = target.position.x - zone.x;
            const dy = target.position.y - zone.y;
            const inZone = Math.sqrt(dx * dx + dy * dy) <= zone.radius && Math.abs((target.position.z ?? 0) - zoneZ) <= zoneHeight;
            const hasBuff = target.buffs.some((b: any) => b.buffId === TUN_RI_YUE_ZONE_BUFF_ID && b.expiresAt > now);
            if (inZone && !hasBuff) {
              addBuff({
                state: this.state,
                sourceUserId: zone.ownerUserId,
                targetUserId: target.userId,
                ability: (ABILITIES["tun_ri_yue"] ?? { id: "tun_ri_yue", name: "吞日月" }) as any,
                buffTarget: target as any,
                buff: {
                  buffId: TUN_RI_YUE_ZONE_BUFF_ID,
                  name: "吞日月",
                  category: "DEBUFF",
                  durationMs: zone.expiresAt - now,
                  effects: [{ type: "QINGGONG_SEAL" }],
                } as any,
              });
              buffsChanged = true;
            } else if (!inZone && hasBuff) {
              const removed = target.buffs.find((b: any) => b.buffId === TUN_RI_YUE_ZONE_BUFF_ID);
              target.buffs = target.buffs.filter((b: any) => b.buffId !== TUN_RI_YUE_ZONE_BUFF_ID);
              if (removed) {
                pushBuffExpired(this.state, {
                  targetUserId: target.userId,
                  buffId: removed.buffId,
                  buffName: removed.name,
                  buffCategory: removed.category,
                  sourceAbilityId: removed.sourceAbilityId,
                  sourceAbilityName: removed.sourceAbilityName,
                });
              }
              buffsChanged = true;
            }
          }
          continue;
        }

        // Interval-based zones (镇山河 100ms pulse, damage zones)
        if (now - zone.lastTickAt >= zone.intervalMs) {
          zone.lastTickAt = now;

          if (zone.abilityId === ZHEN_SHAN_HE_ABILITY_ID) {
            const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
            const zhenShanHeAbility = ABILITIES[ZHEN_SHAN_HE_ABILITY_ID];
            const zoneZ = zone.z ?? 0;
            const zoneHeight = zone.height ?? gameplayUnitsToWorldUnits(10, storedUnitScale);

            if (owner && zhenShanHeAbility && owner.hp > 0) {
              const dx = owner.position.x - zone.x;
              const dy = owner.position.y - zone.y;
              const inRadius = Math.sqrt(dx * dx + dy * dy) <= zone.radius;
              const ownerZ = owner.position.z ?? 0;
              const inHeight = Math.abs(ownerZ - zoneZ) <= zoneHeight;

              if (inRadius && inHeight) {
                if (
                  pulseZhenShanHeTarget({
                    state: this.state,
                    ability: zhenShanHeAbility,
                    target: owner as any,
                    sourceUserId: zone.ownerUserId,
                    now,
                    zoneExpiresAt: zone.expiresAt,
                  })
                ) {
                  buffsChanged = true;
                }
              } else {
                // Player left zone: remove zone invulnerable buff if present
                const idx = owner.buffs.findIndex((b: any) => b.buffId === ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID && b.expiresAt > now);
                if (idx !== -1) {
                  const removed = owner.buffs[idx];
                  owner.buffs.splice(idx, 1);
                  pushBuffExpired(this.state, {
                    targetUserId: owner.userId,
                    buffId: removed.buffId,
                    buffName: removed.name,
                    buffCategory: removed.category,
                    sourceAbilityId: removed.sourceAbilityId,
                    sourceAbilityName: removed.sourceAbilityName,
                  });
                  buffsChanged = true;
                }
              }
            }
            continue;
          }

          if ((zone.damagePerInterval ?? 0) <= 0) {
            continue;
          }

          const owner = this.state.players.find(p => p.userId === zone.ownerUserId);
          let targetsHit = 0;
          for (const target of this.state.players) {
            if (target.userId === zone.ownerUserId) continue;
            if (target.hp <= 0) continue;
            if (zone.maxTargets !== undefined && targetsHit >= zone.maxTargets) break;
            if (blocksEnemyTargeting(target as any)) continue;
            if (hasDamageImmune(target as any)) continue;
            const dx = target.position.x - zone.x;
            const dy = target.position.y - zone.y;
            if (Math.sqrt(dx * dx + dy * dy) > zone.radius) continue;
            if (zone.height !== undefined) {
              const zoneZ = zone.z ?? 0;
              const targetZ = target.position.z ?? 0;
              if (Math.abs(targetZ - zoneZ) > zone.height) continue;
            }
            if (
              tryApplyDodgeForHit({
                state: this.state,
                source: owner ?? target,
                target: target as any,
                abilityId: zone.abilityId,
                abilityName: zone.abilityName,
                enabled: zone.abilityId === "kuang_long_luan_wu",
                damageType: (ABILITIES[zone.abilityId ?? ""] as any)?.damageType,
              })
            ) {
              targetsHit++;
              buffsChanged = true;
              continue;
            }
            const dmg = resolveScheduledDamage({
              source: owner ?? target,
              target,
              base: zone.damagePerInterval,
              damageType: (ABILITIES[zone.abilityId ?? ""] as any)?.damageType,
            });
            if (dmg > 0) {
              const { adjustedDamage: adjZone, redirectPlayer: rtZone, redirectAmt: raZone } =
                preCheckRedirect(this.state, target as any, dmg);
              const zoneApply = rtZone ? adjZone : dmg;
              const zoneResult = zoneApply > 0
                ? applyDamageToTarget(target as any, zoneApply)
                : { hpDamage: 0 };
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: zone.ownerUserId,
                targetUserId: target.userId,
                abilityId: zone.abilityId,
                abilityName: zone.abilityName,
                effectType: "PERIODIC_DAMAGE",
                value: zoneApply,
              });
              if (zoneResult.hpDamage > 0) {
                processOnDamageTaken(this.state, target as any, zoneResult.hpDamage, zone.ownerUserId);
              }
              if (rtZone && raZone > 0) {
                applyRedirectToOpponent(this.state, rtZone, raZone);
              }
            }
            targetsHit++;
            buffsChanged = true;
          }
        }
      }
      const hadZones = this.state.groundZones.length;
      this.state.groundZones = activeZones;
      if (activeZones.length !== hadZones) buffsChanged = true;
    }

    // 1f. Process STACK_ON_HIT_DAMAGE procs for all damage events this tick
    // Collect unique targets that were hit (excluding stack-proc damage itself)
    {
      if (this.stackProcScanIndex > this.state.events.length) {
        this.stackProcScanIndex = this.state.events.length;
      }
      const thisTickEvents = this.state.events.slice(this.stackProcScanIndex);
      const hitTargetIds = new Set<string>();
      for (const evt of thisTickEvents) {
        if (
          evt.type === "DAMAGE" &&
          evt.effectType !== "STACK_ON_HIT_DAMAGE" &&
          (evt.value ?? 0) > 0 &&
          evt.targetUserId
        ) {
          hitTargetIds.add(evt.targetUserId);
        }
      }
      for (const targetId of hitTargetIds) {
        const targetPlayer = this.state.players.find((p) => p.userId === targetId);
        if (!targetPlayer || targetPlayer.hp <= 0) continue;

        if (tryRemoveWufangRootOnHit(this.state, targetPlayer as any, now)) {
          buffsChanged = true;
        }
        if (tryRemoveSanCaiRootOnHit(this.state, targetPlayer as any, now)) {
          buffsChanged = true;
        }

        const actor = this.state.players.find((p) => p.userId !== targetId);
        // Iterate backwards so splice doesn't shift indices
        for (let bi = targetPlayer.buffs.length - 1; bi >= 0; bi--) {
          const stackBuff = targetPlayer.buffs[bi];
          if ((stackBuff.stacks ?? 0) <= 0) continue;
          for (const e of stackBuff.effects) {
            if (e.type === "STACK_ON_HIT_DAMAGE") {
              // Rate-limit: skip if within procCooldownMs of last proc
              if (stackBuff.procCooldownMs !== undefined && stackBuff.lastProcAt !== undefined) {
                if (now - stackBuff.lastProcAt < stackBuff.procCooldownMs) break;
              }
              const dmg = e.value ?? 0;
              applyDamageToTarget(targetPlayer as any, dmg);
              stackBuff.stacks = (stackBuff.stacks ?? 1) - 1;
              stackBuff.lastProcAt = now;
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: stackBuff.sourceUserId ?? actor?.userId ?? targetId,
                targetUserId: targetId,
                abilityId: stackBuff.sourceAbilityId,
                abilityName: stackBuff.sourceAbilityName ?? stackBuff.name,
                effectType: "STACK_ON_HIT_DAMAGE",
                value: dmg,
              });
              if (stackBuff.stacks <= 0) {
                targetPlayer.buffs.splice(bi, 1);
                pushBuffExpired(this.state, {
                  targetUserId: targetId,
                  buffId: stackBuff.buffId,
                  buffName: stackBuff.name,
                  buffCategory: stackBuff.category,
                  sourceAbilityId: stackBuff.sourceAbilityId,
                  sourceAbilityName: stackBuff.sourceAbilityName,
                });
              }
              buffsChanged = true;
              break; // one stack proc per hit per buff
            } else if (e.type === "STACK_ON_HIT_GUAN_TI_HEAL") {
              // Rate-limit: skip if within procCooldownMs of last proc
              if (stackBuff.procCooldownMs !== undefined && stackBuff.lastProcAt !== undefined) {
                if (now - stackBuff.lastProcAt < stackBuff.procCooldownMs) break;
              }
              const healBase = e.value ?? 0;
              // 贯体 heal: bypass HEAL_REDUCTION, apply directly
              const healApplied = applyHealToTarget(targetPlayer as any, healBase);
              stackBuff.stacks = (stackBuff.stacks ?? 1) - 1;
              stackBuff.lastProcAt = now;
              if (healApplied > 0) {
                const guanTiName = stackBuff.name.includes("（贯体）") ? stackBuff.name : `${stackBuff.name}（贯体）`;
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: targetId,
                  targetUserId: targetId,
                  abilityId: stackBuff.sourceAbilityId,
                  abilityName: guanTiName,
                  effectType: "STACK_ON_HIT_GUAN_TI_HEAL",
                  value: healApplied,
                });
              }
              if (stackBuff.stacks <= 0) {
                targetPlayer.buffs.splice(bi, 1);
                pushBuffExpired(this.state, {
                  targetUserId: targetId,
                  buffId: stackBuff.buffId,
                  buffName: stackBuff.name,
                  buffCategory: stackBuff.category,
                  sourceAbilityId: stackBuff.sourceAbilityId,
                  sourceAbilityName: stackBuff.sourceAbilityName,
                });
              }
              buffsChanged = true;
              break; // one stack proc per hit per buff
            }
          }
        }

        // 应天授命 (YING_TIAN_SHIELD): on each hit, accumulate damage and heal 6% of lost HP
        for (const ytBuff of targetPlayer.buffs) {
          const ytEffect = ytBuff.effects.find((e) => e.type === "YING_TIAN_SHIELD");
          if (!ytEffect) continue;
          // Accumulate this tick's damage for the periodic settle
          let tickDmg = 0;
          for (const evt of thisTickEvents) {
            if (evt.type === "DAMAGE" && evt.targetUserId === targetId && (evt.value ?? 0) > 0 &&
                evt.effectType !== "YING_TIAN_SHIELD") {
              tickDmg += evt.value ?? 0;
            }
          }
          if (tickDmg > 0) {
            (ytBuff as any).yingTianAccum = ((ytBuff as any).yingTianAccum ?? 0) + tickDmg;
          }
          // Heal 6% of lost HP (贯体)
          const ytMaxHp = targetPlayer.maxHp ?? 100;
          const ytLostHp = ytMaxHp - targetPlayer.hp;
          if (ytLostHp > 0) {
            const ytHealPct = ytEffect.value ?? 0.06;
            const ytHealAmt = Math.floor(ytLostHp * ytHealPct);
            const ytApplied = applyHealToTarget(targetPlayer as any, ytHealAmt);
            if (ytApplied > 0) {
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "HEAL",
                actorUserId: targetId,
                targetUserId: targetId,
                abilityId: ytBuff.sourceAbilityId,
                abilityName: `${ytBuff.sourceAbilityName ?? ytBuff.name}（贯体）`,
                effectType: "YING_TIAN_SHIELD",
                value: ytApplied,
              });
              buffsChanged = true;
            }
          }
          break; // only proc once per hit event (one 应天授命 buff)
        }
      }
      this.stackProcScanIndex = this.state.events.length;
    }

    // 2. Check win condition
    const winStart = performance.now();
    checkGameOver(this.state);
    const winTime = performance.now() - winStart;

    // 3. Broadcast position updates (throttled to reduce bandwidth)
    let broadcastTime = 0;
    this.ticksSinceBroadcast++;
    if (this.ticksSinceBroadcast >= this.broadcastTickInterval) {
      const bcastStart = performance.now();
      // Increment version only on broadcasts
      this.state.version = (this.state.version ?? 0) + 1;
      
      // Send position + facing + cooldown changes (lightweight diff)
      const diff: Array<{ path: string; value: any }> = [];
      this.state.players.forEach((p, pidx) => {
        diff.push({
          path: `/players/${pidx}/position`,
          value: p.position,
        });
        // Include facing in compact movement updates so clients can render
        // authoritative direction indicators for both players in real time.
        diff.push({
          path: `/players/${pidx}/facing`,
          value: p.facing ?? { x: 0, y: 1 },
        });
        // Include activeDash only when active OR transitioning to null
        if (p.activeDash) {
          diff.push({
            path: `/players/${pidx}/activeDash`,
            value: p.activeDash,
          });
          (this as any)._hadActiveDash = (this as any)._hadActiveDash ?? {};
          (this as any)._hadActiveDash[pidx] = true;
        } else if ((this as any)._hadActiveDash?.[pidx]) {
          diff.push({
            path: `/players/${pidx}/activeDash`,
            value: null,
          });
          (this as any)._hadActiveDash[pidx] = false;
        }
        // Keep channel UI in sync, but only send when channel payload actually changes.
        // Sending activeChannel every broadcast tick can cause frontend progress bars to resync too often.
        (this as any)._lastActiveChannelSig = (this as any)._lastActiveChannelSig ?? {};
        const prevChannelSig = (this as any)._lastActiveChannelSig[pidx] ?? null;
        const nextChannelSig = p.activeChannel ? JSON.stringify(p.activeChannel) : null;

        if (nextChannelSig !== prevChannelSig) {
          diff.push({
            path: `/players/${pidx}/activeChannel`,
            value: p.activeChannel ?? null,
          });
          (this as any)._lastActiveChannelSig[pidx] = nextChannelSig;
        }
      });
      // Append per-ability cooldown patches so clients stay in sync
      this.state.players.forEach((p, pidx) => {
        p.hand.forEach((ability, cidx) => {
          diff.push({
            path: `/players/${pidx}/hand/${cidx}/cooldown`,
            value: ability.cooldown,
          });
          if ((ability as any).chargeCount !== undefined) {
            diff.push({
              path: `/players/${pidx}/hand/${cidx}/chargeCount`,
              value: (ability as any).chargeCount,
            });
          }
          if ((ability as any).chargeRegenTicksRemaining !== undefined) {
            diff.push({
              path: `/players/${pidx}/hand/${cidx}/chargeRegenTicksRemaining`,
              value: (ability as any).chargeRegenTicksRemaining,
            });
          }
          if ((ability as any).chargeLockTicks !== undefined) {
            diff.push({
              path: `/players/${pidx}/hand/${cidx}/chargeLockTicks`,
              value: (ability as any).chargeLockTicks,
            });
          }
        });
      });

      // Append safe zone state so frontend can render the shrinking boundary
      if (this.state.safeZone) {
        diff.push({ path: "/safeZone", value: this.state.safeZone });
      }

      // Append ground zones so frontend can render persistent damage areas
      if (this.state.groundZones !== undefined) {
        diff.push({ path: "/groundZones", value: this.state.groundZones });
      }

      // Append buff arrays whenever they changed (expiry or periodic effects)
      // or when new events were emitted this tick (e.g. pure channel completion).
      const hasNewEvents = this.state.events.length > eventDiffStart;
      if (buffsChanged || hasNewEvents || channelStateChanged) {
        this.state.players.forEach((p, pidx) => {
          diff.push({
            path: `/players/${pidx}/buffs`,
            value: p.buffs,
          });
        });
        // Also push hp patches if periodic effects changed them
        this.state.players.forEach((p, pidx) => {
          diff.push({ path: `/players/${pidx}/hp`, value: p.hp });
          diff.push({ path: `/players/${pidx}/shield`, value: p.shield ?? 0 });
        });

        // Include each new game event as an individual diff patch so the frontend
        // can spawn per-event floating numbers with proper labels + no combining.
        for (let i = eventDiffStart; i < this.state.events.length; i++) {
          diff.push({ path: `/events/${i}`, value: this.state.events[i] });
        }
      }
      
      // During gameplay, send compact movement-only broadcasts
      if (!this.state.gameOver) {
        broadcastGameUpdate({
          gameId: this.gameId,
          version: this.state.version,
          diff,
          isMovementOnly: true, // Compact format - skip events/timestamp for speed
        });
      } else {
        // Add gameOver + winnerUserId into the diff so frontend state.gameOver updates immediately via WS
        diff.push({ path: "/gameOver", value: true });
        if (this.state.winnerUserId) {
          diff.push({ path: "/winnerUserId", value: this.state.winnerUserId });
        }
        // Capture broadcast payload before the async save so we close over the
        // correct values even if the loop is stopped/cleared before .then() fires.
        const broadcastPayload = {
          gameId:       this.gameId,
          version:      this.state.version,
          diff,
          gameOver:     this.state.gameOver,
          winnerUserId: this.state.winnerUserId,
          timestamp:    Date.now(),
        };
        // Save to DB FIRST, then broadcast. This guarantees battle/complete can
        // read gameOver=true from DB before the frontend even receives the WS message.
        this.saveToDB()
          .then(()  => broadcastGameUpdate(broadcastPayload))
          .catch(() => broadcastGameUpdate(broadcastPayload)); // broadcast even if save fails
      }
      
      broadcastTime = performance.now() - bcastStart;
      this.ticksSinceBroadcast = 0;
    }

    // 4. Auto-save to DB (every 50 ticks ≈ 0.8s intervals to reduce DB load on free VM)
    let saveTime = 0;
    if (this.state.version % 50 === 0) {
      const saveStart = performance.now();
      this.saveToDB();
      saveTime = performance.now() - saveStart;
    }

    // One-shot: log tick execution time on dash start/end
    const anyDashing = this.state.players.some(p => !!p.activeDash);
    if (anyDashing) {
      const tickTotal = performance.now() - tickStart;
      const tr = this.state.players.find(p => p.activeDash)?.activeDash?.ticksRemaining;
      if (tr === 59) {
        console.log(`[TICK-PERF] tick()=${tickTotal.toFixed(1)}ms  move=${moveTime.toFixed(1)}ms  broadcast=${broadcastTime.toFixed(1)}ms  save=${saveTime.toFixed(1)}ms  broadcastInterval=${this.broadcastTickInterval}`);
      }
    }

  }

  /**
   * Broadcast game state diff to all connected players
   */
  private broadcast(prevState: GameState) {
    const diff = diffState(prevState, this.state);

    broadcastGameUpdate({
      gameId: this.gameId,
      version: this.state.version,
      diff,
      gameOver: this.state.gameOver,
      winnerUserId: this.state.winnerUserId,
      timestamp: Date.now(),
    });
  }

  /**
   * Save game state to database
   */
  private async saveToDB() {
    try {
      const game = await GameSession.findByIdAndUpdate(
        this.gameId,
        { state: this.state },
        { new: false }
      );

      if (!game) {
        console.warn(
          `[GameLoop] Game ${this.gameId} not found in DB, stopping loop`
        );
        this.stop();
      }
    } catch (err) {
      console.error(`[GameLoop] Error saving game ${this.gameId}:`, err);
      // Don't stop the loop on save errors - just log and continue
      // This prevents cascading failures
    }
  }

  /**
   * Stop the game loop
   */
  private stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    clearTimeout(this.tickInterval);

    // Final save to DB
    this.saveToDB();
  }

  /**
   * Get current game state snapshot (for ability casting validation)
   */
  getState(): GameState {
    return structuredClone(this.state);
  }

  /**
   * Expose map context for LOS validation in ability cast path.
   */
  getMapCtx(): MapContext {
    return this.mapCtx;
  }

  /**
   * Check in-memory gameOver flag — used by battle/complete to bypass the
   * DB-flush race condition (saveToDB is fire-and-forget so DB may lag behind).
   */
  static getInMemoryGameOver(gameId: string): { gameOver: boolean; winnerUserId?: string } | null {
    const loop = activeLoops.get(gameId);
    if (!loop) return null;
    return { gameOver: loop.state.gameOver, winnerUserId: loop.state.winnerUserId };
  }

  /**
   * Update game state from external changes (ability cast, etc.)
   * Called by gameplay routes
   */
  updateState(newState: GameState) {
    this.state = structuredClone(newState);
    if (this.stackProcScanIndex > this.state.events.length) {
      this.stackProcScanIndex = this.state.events.length;
    }
  }

  /**
   * Get distance between two players
   */
  getPlayerDistance(): number {
    const p1 = this.state.players[0];
    const p2 = this.state.players[1];
    return calculateDistance(p1.position, p2.position, this.state.unitScale);
  }

  /**
   * Check if ability is in range
   */
  isAbilityInRange(playerIndex: number, range?: number): boolean {
    if (!range) return true; // No range restriction

    const distance = this.getPlayerDistance();
    return distance <= range;
  }
}
