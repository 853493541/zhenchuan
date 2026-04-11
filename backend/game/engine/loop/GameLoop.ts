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

import { GameState, MovementInput, GroundZone, calculateDistance } from "../state/types";
import { checkGameOver } from "../flow/turn/checkGameOver";
import { broadcastGameUpdate } from "../../services/broadcast";
import { diffState } from "../../services/flow/stateDiff";
import GameSession from "../../models/GameSession";
import { applyMovement, resolveMapCollisions, MapContext } from "./movement";
import { addBuff, pushBuffExpired } from "../effects/buffRuntime";
import { resolveScheduledDamage, resolveHealAmount } from "../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget, removeLinkedShield } from "../utils/health";
import { randomUUID } from "crypto";
import { worldMap } from "../../map/worldMap";
import { arenaMap } from "../../map/arenaMap";
import { exportedMap } from "../../map/exportedMap";
import { getCollisionTestExportedSystem } from "../../map/exportedMapCollision";
import { ABILITIES } from "../../abilities/abilities";
import { blocksCardTargeting, hasUntargetable, shouldDodge } from "../rules/guards";
import type { MapObject } from "../state/types/map";
import { breakOnPlay } from "../flow/play/breakOnPlay";

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

/** Check if line-of-sight between two 2D positions is blocked by any map object. */
function isLOSBlocked(
  ax: number, ay: number,
  bx: number, by: number,
  objects: MapObject[]
): boolean {
  for (const obj of objects) {
    if (segmentIntersectsAABB(ax, ay, bx, by, obj.x, obj.y, obj.x + obj.w, obj.y + obj.d)) {
      return true;
    }
  }
  return false;
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
}): boolean {
  const { state, source, target, abilityId, abilityName, enabled } = params;
  if (!enabled) return false;
  if (source.userId === target.userId) return false;
  if (!shouldDodge(target as any)) return false;

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

const SHENGTAIJI_ZONE_ID = "qionglong_huasheng_zone";
const SHENGTAIJI_PULSE_BUFF_ID = 1310;
const SHENGTAIJI_ENEMY_SLOW_BUFF_ID = 1311;

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
      // Export-reader avatar: radius 57 export units = ~0.32 game units (doubled: 0.64)
      playerRadius: config?.mode === 'collision-test' ? 0.64 : undefined,
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
  setPlayerInput(playerIndex: number, input: MovementInput | null) {
    if (input?.jump) {
      const player = this.state.players[playerIndex];
      if (player) {
        // Short lock window for requiresGrounded casts to close jump/cast race.
        player.groundedCastLockUntil = Date.now() + 250;
      }
    }
    this.playerInputs.set(playerIndex, input);
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
      const dashAbilityIdBefore = player.activeDash?.abilityId;
      applyMovement(player, input, this.tickRate, this.mapCtx);

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
          height: 10,
          radius: 8,
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
        if (hasBuffEffect(player as any, "SILENCE")) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // cancelOnOutOfRange check
        if (ch.cancelOnOutOfRange !== undefined) {
          const dist = calculateDistance(player.position, target.position);
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
        if (
          channelAbility?.target === "OPPONENT" &&
          isLOSBlocked(
            player.position.x,
            player.position.y,
            target.position.x,
            target.position.y,
            this.mapCtx.objects,
          )
        ) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // Channel completion
        const chNow = Date.now();
        if (chNow >= ch.startedAt + ch.durationMs) {
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
              const dist = calculateDistance(player.position, target.position);
              if (dist <= range && target.hp > 0) {
                if (player.userId !== target.userId && hasUntargetable(target as any)) {
                  continue;
                }
                const dmg = resolveScheduledDamage({ source: player, target, base: e.value ?? 0 });
                applyDamageToTarget(target as any, dmg);
                if (dmg > 0) {
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
                    value: dmg,
                  });
                }
              }
            } else if (e.type === "TIMED_AOE_DAMAGE_IF_SELF_HP_GT") {
              const threshold = (e as any).threshold ?? 0;
              const range = e.range ?? 50;
              if (player.hp <= threshold) continue;
              const dist = calculateDistance(player.position, target.position);
              if (dist > range || target.hp <= 0) continue;
              if (player.userId !== target.userId && hasUntargetable(target as any)) continue;
              const dmg = resolveScheduledDamage({ source: player, target, base: e.value ?? 0 });
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
            } else if (e.type === "PLACE_GROUND_ZONE") {
              const facing = player.facing ?? { x: 0, y: 1 };
              const zoneX = player.position.x + facing.x * 6;
              const zoneY = player.position.y + facing.y * 6;
              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: player.userId,
                x: zoneX,
                y: zoneY,
                radius: e.range ?? 8,
                expiresAt: chNow + 6000,
                damagePerInterval: e.value ?? 4,
                intervalMs: 500,
                lastTickAt: chNow,
                abilityId: ch.abilityId,
                abilityName: ch.abilityName,
                maxTargets: 5,
              } as GroundZone);
            }
          }

          // Set cooldown on the consumed ability instance (still in hand)
          const ability = player.hand.find((a) => a.instanceId === ch.instanceId);
          if (ability) {
            ability.cooldown = Math.max(ability.cooldown ?? 0, ch.cooldownTicks ?? 0);
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

          if (ability.chargeLockTicks > 0) {
            ability.chargeLockTicks--;
          }

          const recoveryTicks = Math.max(
            1,
            Number(abilityDef?.chargeRecoveryTicks ?? abilityDef?.cooldownTicks ?? 1)
          );

          if (ability.chargeCount < maxCharges) {
            if (ability.chargeRegenTicksRemaining <= 0) {
              ability.chargeRegenTicksRemaining = recoveryTicks;
              ability._chargeRegenProgress = 0;
            }

            ability._chargeRegenProgress = (ability._chargeRegenProgress ?? 0) + cooldownRate;
            while (ability._chargeRegenProgress >= 1 && ability.chargeRegenTicksRemaining > 0) {
              ability.chargeRegenTicksRemaining--;
              ability._chargeRegenProgress -= 1;
            }

            if (ability.chargeRegenTicksRemaining <= 0) {
              ability.chargeCount = Math.min(maxCharges, ability.chargeCount + 1);
              if (ability.chargeCount < maxCharges) {
                ability.chargeRegenTicksRemaining = recoveryTicks;
                ability._chargeRegenProgress = 0;
              } else {
                ability.chargeRegenTicksRemaining = 0;
                ability._chargeRegenProgress = 0;
              }
            }
          } else {
            ability.chargeRegenTicksRemaining = 0;
            ability._chargeRegenProgress = 0;
          }

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
          const dist = calculateDistance(player.position, opp.position);
          return dist > b.cancelOnOutOfRange;
        });
        for (const removed of removedByRange) {
          removeLinkedShield(player as any, removed as any);
        }
        player.buffs = player.buffs.filter((b: any) => {
          if (b.cancelOnOutOfRange === undefined) return true;
          const dist = calculateDistance(player.position, opp.position);
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
      if (hasBuffEffect(player as any, "SILENCE")) {
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
                const stackMult = buff.stacks ?? 1;
                const dmg = resolveScheduledDamage({
                  source: opp,
                  target: player,
                  base: (e.value ?? 0) * stackMult,
                });
                applyDamageToTarget(player as any, dmg);
                if (dmg > 0) {
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "DAMAGE",
                    actorUserId: opp.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "PERIODIC_DAMAGE",
                    value: dmg,
                  });
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
                const dx = opp.position.x - player.position.x;
                const dy = opp.position.y - player.position.y;
                const dz = (opp.position.z ?? 0) - (player.position.z ?? 0);
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist <= range && opp.hp > 0) {
                  if (player.userId !== opp.userId && hasUntargetable(opp as any)) {
                    continue;
                  }
                  const angle = (e as any).aoeAngle ?? 360;
                  if (angle < 360 && dist > 0) {
                    const facing = player.facing ?? { x: 0, y: 1 };
                    const dot = (facing.x * dx + facing.y * dy) / dist;
                    const halfAngleRad = (angle / 2) * (Math.PI / 180);
                    if (dot < Math.cos(halfAngleRad)) {
                      continue;
                    }
                  }
                  // Task 7: channel ticks stop applying through structures
                  if (isLOSBlocked(
                    player.position.x,
                    player.position.y,
                    opp.position.x,
                    opp.position.y,
                    this.mapCtx.objects,
                  )) {
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
                    })
                  ) {
                    buffsChanged = true;
                    continue;
                  }
                  const dmg = resolveScheduledDamage({
                    source: player,
                    target: opp,
                    base: e.value ?? 0,
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
                      effectType: "CHANNEL_AOE_TICK",
                      value: dmg,
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

            // 无间狱: each timed strike is treated as a fresh cast for stealth break only.
            if (e.type === "TIMED_AOE_DAMAGE" && buff.sourceAbilityId === "wu_jianyu") {
              const beforeBuffCount = player.buffs.length;
              const wuJianAbility = ABILITIES["wu_jianyu"];
              if (wuJianAbility) {
                breakOnPlay(player as any, wuJianAbility as any);
                if (player.buffs.length !== beforeBuffCount) {
                  buffsChanged = true;
                }
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
              const zoneX = player.position.x + facing.x * 6;
              const zoneY = player.position.y + facing.y * 6;
              if (!this.state.groundZones) this.state.groundZones = [];
              this.state.groundZones.push({
                id: randomUUID(),
                ownerUserId: player.userId,
                x: zoneX,
                y: zoneY,
                radius: e.range ?? 8,
                expiresAt: now + 6000,
                damagePerInterval: e.value ?? 4,
                intervalMs: 500,
                lastTickAt: now,
                abilityId: buff.sourceAbilityId,
                abilityName: buff.sourceAbilityName ?? buff.name,
                maxTargets: 5,
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

            // Range check (3D — height matters)
            const range = e.range ?? 10;
            const dx = opp.position.x - player.position.x;
            const dy = opp.position.y - player.position.y;
            const dz = (opp.position.z ?? 0) - (player.position.z ?? 0);
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > range) continue;

            // Cone angle check (skip for full-circle 360°)
            const angle = e.aoeAngle ?? 360;
            if (angle < 360 && dist > 0) {
              const facing = player.facing ?? { x: 0, y: 1 };
              const dot = (facing.x * dx + facing.y * dy) / dist;
              const halfAngleRad = (angle / 2) * (Math.PI / 180);
              if (dot < Math.cos(halfAngleRad)) continue;
            }

            if (player.userId !== opp.userId && hasUntargetable(opp as any)) {
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

            // Knockback + silence
            const targetIsKnockedDown = opp.buffs.some((b) => isMoheKnockdown(b as any));
            if (e.knockbackUnits && e.knockbackUnits > 0 && dist > 0 && !targetIsKnockedDown) {
              const removedStuns = removeStunDebuffsFromPlayer(this.state, opp as any);
              opp.position = {
                ...opp.position,
                x: opp.position.x + (dx / dist) * e.knockbackUnits,
                y: opp.position.y + (dy / dist) * e.knockbackUnits,
              };
              // Resolve collisions so player doesn't end up inside a wall
              resolveMapCollisions(opp, this.mapCtx);
              if (e.knockbackSilenceMs && e.knockbackSilenceMs > 0) {
                opp.buffs.push({
                  buffId: 9101,
                  name: "击退",
                  category: "DEBUFF",
                  effects: [{ type: "KNOCKED_BACK" }],
                  expiresAt: now + e.knockbackSilenceMs,
                  breakOnPlay: false,
                  sourceAbilityId: buff.sourceAbilityId,
                  sourceAbilityName: buff.sourceAbilityName,
                });
              }

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

              if (removedStuns) {
                buffsChanged = true;
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
      const moheNaturallyExpired = naturallyExpired.filter((b) => isMoheKnockdown(b as any));
      for (const b of moheNaturallyExpired) {
        const maxHp = player.maxHp ?? 100;
        const threshold = maxHp * 0.3;
        if (player.hp < threshold) {
          const stunBuff = {
            buffId: 1202,
            name: "摩诃无量·眩晕",
            category: "DEBUFF",
            effects: [{ type: "CONTROL" }],
            expiresAt: now + 2_000,
            breakOnPlay: false,
            sourceUserId: (b as any).sourceUserId,
            sourceAbilityId: "mohe_wuliang",
            sourceAbilityName: "摩诃无量",
            appliedAtTurn: this.state.turn,
            appliedAt: now,
          } as any;

          player.buffs.push(stunBuff);
          this.state.events.push({
            id: randomUUID(),
            timestamp: now,
            turn: this.state.turn,
            type: "BUFF_APPLIED",
            actorUserId: (b as any).sourceUserId ?? player.userId,
            targetUserId: player.userId,
            abilityId: "mohe_wuliang",
            abilityName: "摩诃无量",
            buffId: stunBuff.buffId,
            buffName: stunBuff.name,
            buffCategory: stunBuff.category,
            appliedAtTurn: this.state.turn,
          } as any);
          buffsChanged = true;
        }
      }
      player.buffs = player.buffs.filter((b) => now < b.expiresAt);
      if (player.buffs.length !== before) buffsChanged = true;
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
        if (now - zone.lastTickAt >= zone.intervalMs) {
          zone.lastTickAt = now;

          if (zone.abilityId === SHENGTAIJI_ZONE_ID) {
            const owner = this.state.players.find((p) => p.userId === zone.ownerUserId);
            const zoneZ = zone.z ?? 0;
            const zoneHeight = zone.height ?? 10;
            const isInsideZone = (p: any) => {
              const dx = p.position.x - zone.x;
              const dy = p.position.y - zone.y;
              const inRadius = Math.sqrt(dx * dx + dy * dy) <= zone.radius;
              const pz = p.position.z ?? 0;
              const inHeight = Math.abs(pz - zoneZ) <= zoneHeight;
              return inRadius && inHeight;
            };

            if (owner && owner.hp > 0 && isInsideZone(owner)) {
              owner.buffs = owner.buffs.filter(
                (b: any) =>
                  !b.effects?.some(
                    (e: any) => e.type === "CONTROL" || e.type === "ATTACK_LOCK"
                  )
              );

              const pulseExpiresAt = now + 3_000;
              const pulse = owner.buffs.find(
                (b: any) =>
                  b.buffId === SHENGTAIJI_PULSE_BUFF_ID &&
                  b.sourceAbilityId === "qionglong_huasheng"
              );
              if (pulse) {
                pulse.expiresAt = pulseExpiresAt;
                pulse.appliedAt = now;
              } else {
                owner.buffs.push({
                  buffId: SHENGTAIJI_PULSE_BUFF_ID,
                  name: "生太极·护体",
                  category: "BUFF",
                  effects: [{ type: "CONTROL_IMMUNE" }],
                  expiresAt: pulseExpiresAt,
                  appliedAt: now,
                  breakOnPlay: false,
                  sourceUserId: zone.ownerUserId,
                  sourceAbilityId: "qionglong_huasheng",
                  sourceAbilityName: "穹隆化生",
                } as any);
              }
              buffsChanged = true;
            }

            for (const target of this.state.players) {
              if (target.userId === zone.ownerUserId) continue;
              if (target.hp <= 0) continue;
              if (!isInsideZone(target)) continue;

              const hasRootSlowImmune = target.buffs.some((b: any) =>
                b.effects?.some((e: any) => e.type === "ROOT_SLOW_IMMUNE")
              );
              if (hasRootSlowImmune) continue;

              const slowExpiresAt = now + 3_000;
              const slow = target.buffs.find(
                (b: any) =>
                  b.buffId === SHENGTAIJI_ENEMY_SLOW_BUFF_ID &&
                  b.sourceAbilityId === "qionglong_huasheng"
              );
              if (slow) {
                slow.expiresAt = slowExpiresAt;
                slow.appliedAt = now;
              } else {
                target.buffs.push({
                  buffId: SHENGTAIJI_ENEMY_SLOW_BUFF_ID,
                  name: "生太极·迟滞",
                  category: "DEBUFF",
                  effects: [{ type: "SLOW", value: 0.4 }],
                  expiresAt: slowExpiresAt,
                  appliedAt: now,
                  breakOnPlay: false,
                  sourceUserId: zone.ownerUserId,
                  sourceAbilityId: "qionglong_huasheng",
                  sourceAbilityName: "穹隆化生",
                } as any);
              }
              buffsChanged = true;
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
            if (hasUntargetable(target as any)) continue;
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
            });
            applyDamageToTarget(target as any, dmg);
            if (dmg > 0) {
              this.state.events.push({
                id: randomUUID(), timestamp: now, turn: this.state.turn,
                type: "DAMAGE",
                actorUserId: zone.ownerUserId,
                targetUserId: target.userId,
                abilityId: zone.abilityId,
                abilityName: zone.abilityName,
                effectType: "PERIODIC_DAMAGE",
                value: dmg,
              });
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
        if (evt.type === "DAMAGE" && evt.effectType !== "STACK_ON_HIT_DAMAGE" && evt.targetUserId) {
          hitTargetIds.add(evt.targetUserId);
        }
      }
      for (const targetId of hitTargetIds) {
        const targetPlayer = this.state.players.find((p) => p.userId === targetId);
        if (!targetPlayer || targetPlayer.hp <= 0) continue;
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
            }
          }
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
        // Keep channel UI in sync: include activeChannel when active OR when it just cleared.
        if (p.activeChannel) {
          diff.push({
            path: `/players/${pidx}/activeChannel`,
            value: p.activeChannel,
          });
          (this as any)._hadActiveChannel = (this as any)._hadActiveChannel ?? {};
          (this as any)._hadActiveChannel[pidx] = true;
        } else if ((this as any)._hadActiveChannel?.[pidx]) {
          diff.push({
            path: `/players/${pidx}/activeChannel`,
            value: null,
          });
          (this as any)._hadActiveChannel[pidx] = false;
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
    return calculateDistance(p1.position, p2.position);
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
