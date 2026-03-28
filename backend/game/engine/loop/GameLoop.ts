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
import { pushBuffExpired } from "../effects/buffRuntime";
import { resolveScheduledDamage, resolveHealAmount } from "../utils/combatMath";
import { randomUUID } from "crypto";
import { worldMap } from "../../map/worldMap";
import { arenaMap } from "../../map/arenaMap";
import { ABILITIES } from "../../abilities/abilities";
import type { MapObject } from "../state/types/map";

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

export interface GameLoopConfig {
  tickRate?: number; // Hz (default 60)
  mode?: "arena" | "pubg";
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
    this.tickRate = config?.tickRate ?? 30;
    this.broadcastTickInterval = Math.max(1, Math.round(this.tickRate / 30));
    this.isArenaMode = config?.mode === 'arena';

    // Select map based on game mode
    const map = this.isArenaMode ? arenaMap : worldMap;
    this.mapCtx = {
      objects: map.objects,
      width: map.width,
      height: map.height,
      circular: false,
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
    this.playerInputs.set(playerIndex, input);
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
    this.state.players.forEach((player, idx) => {
      const input = this.playerInputs.get(idx) ?? null;
      applyMovement(player, input, this.tickRate, this.mapCtx);

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
            player.buffs = player.buffs.filter((b) => b.buffId !== 1012);
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

        // cancelOnOutOfRange check
        if (ch.cancelOnOutOfRange !== undefined) {
          const dist = calculateDistance(player.position, target.position);
          if (dist > ch.cancelOnOutOfRange) {
            player.activeChannel = undefined;
            channelStateChanged = true;
            continue;
          }
        }

        // Task 8: cancel forward-facing channels if target leaves 180° front arc
        if (channelAbility?.faceDirection && !isInFacingHemisphere(player as any, target as any)) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // Task 7: cancel channel if target is behind structures (LOS blocked)
        if (isLOSBlocked(
          player.position.x,
          player.position.y,
          target.position.x,
          target.position.y,
          this.mapCtx.objects,
        )) {
          player.activeChannel = undefined;
          channelStateChanged = true;
          continue;
        }

        // Channel completion
        const chNow = Date.now();
        if (chNow >= ch.startedAt + ch.durationMs) {
          for (const e of ch.effects) {
            if (e.type === "TIMED_AOE_DAMAGE") {
              const range = e.range ?? 50;
              const dist = calculateDistance(player.position, target.position);
              if (dist <= range && target.hp > 0) {
                const dmg = resolveScheduledDamage({ source: player, target, base: e.value ?? 0 });
                target.hp = Math.max(0, target.hp - dmg);
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
              const dmg = resolveScheduledDamage({ source: player, target, base: e.value ?? 0 });
              target.hp = Math.max(0, target.hp - dmg);
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
            }
          }

          // Set cooldown on the consumed ability instance (still in hand)
          const ability = player.hand.find((a) => a.instanceId === ch.instanceId);
          if (ability) {
            ability.cooldown = Math.max(ability.cooldown ?? 0, ch.cooldownTicks ?? 0);
          }

          // Forward channel completion counts as the cast "taking effect" and breaks stealth.
          if (ch.forwardChannel) {
            player.buffs = player.buffs.filter((b) => ![1011, 1012, 1013].includes(b.buffId));
          }

          player.activeChannel = undefined;
          channelStateChanged = true;
        }
      }
    }

    // 1b. Decrement ability cooldowns each tick
    this.state.players.forEach((player) => {
      player.hand.forEach((ability) => {
        if (ability.cooldown > 0) ability.cooldown--;
      });
    });

    // 1c. Wall-clock buff expiry + periodic effects (DoT / HoT)
    const now = Date.now();
    // Pre-seed buffsChanged: true if movement consumed any buff (e.g. JUMP_BOOST splice)
    let buffsChanged = this.state.players.some(
      (p, idx) => (p.buffs?.length ?? 0) !== buffCountsBefore[idx]
    ) || channelStateChanged;

    // Cancel channel buffs whose out-of-range condition is exceeded (e.g. 云飞玉皇)
    if (this.state.players.length === 2) {
      for (let idx = 0; idx < 2; idx++) {
        const player = this.state.players[idx];
        const opp = this.state.players[idx === 0 ? 1 : 0];
        const before = player.buffs.length;
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

      for (const buff of player.buffs) {
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
                player.hp = Math.max(0, player.hp - dmg);
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
                player.hp = Math.min(player.maxHp ?? 100, player.hp + heal);
                if (heal > 0) {
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: buff.sourceAbilityName ?? buff.name,
                    effectType: "PERIODIC_HEAL",
                    value: heal,
                  });
                }
                buffsChanged = true;
              } else if (e.type === "PERIODIC_GUAN_TI_HEAL") {
                // 贯体 heal: bypasses HEAL_REDUCTION; value is % of maxHp per tick
                const pct = (e.value ?? 0) / 100;
                const healAmt = Math.floor((player.maxHp ?? 100) * pct);
                player.hp = Math.min(player.maxHp ?? 100, player.hp + healAmt);
                if (healAmt > 0) {
                  this.state.events.push({
                    id: randomUUID(), timestamp: now, turn: this.state.turn,
                    type: "HEAL",
                    actorUserId: player.userId,
                    targetUserId: player.userId,
                    abilityId: buff.sourceAbilityId,
                    abilityName: "笑醉狂（贯体）",
                    effectType: "PERIODIC_GUAN_TI_HEAL",
                    value: healAmt,
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
                  const dmg = resolveScheduledDamage({
                    source: player,
                    target: opp,
                    base: e.value ?? 0,
                  });
                  opp.hp = Math.max(0, opp.hp - dmg);
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
              e.type !== "TIMED_GUAN_TI_HEAL" &&
              e.type !== "PLACE_GROUND_ZONE"
            ) continue;
            if (e.delayMs === undefined) continue;
            if (buff.firedDelayIndices?.includes(effIdx)) continue;
            if (now < buff.appliedAt + e.delayMs) continue;

            // Mark this effect as fired
            if (!buff.firedDelayIndices) buff.firedDelayIndices = [];
            buff.firedDelayIndices.push(effIdx);

            // TIMED_GUAN_TI_HEAL: completion heal bypassing HEAL_REDUCTION
            if (e.type === "TIMED_GUAN_TI_HEAL") {
              const pct = (e.value ?? 0) / 100;
              const healAmt = Math.floor((player.maxHp ?? 100) * pct);
              player.hp = Math.min(player.maxHp ?? 100, player.hp + healAmt);
              if (healAmt > 0) {
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: "笑醉狂（贯体）",
                  effectType: "TIMED_GUAN_TI_HEAL",
                  value: healAmt,
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

            // Apply damage
            const dmg = resolveScheduledDamage({
              source: player,
              target: opp,
              base: e.value ?? 0,
            });
            opp.hp = Math.max(0, opp.hp - dmg);

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
              player.hp = Math.min(player.maxHp ?? 100, player.hp + healAmt);
              if (healAmt > 0) {
                this.state.events.push({
                  id: randomUUID(), timestamp: now, turn: this.state.turn,
                  type: "HEAL",
                  actorUserId: player.userId,
                  targetUserId: player.userId,
                  abilityId: buff.sourceAbilityId,
                  abilityName: buff.sourceAbilityName ?? buff.name,
                  effectType: "TIMED_AOE_DAMAGE",
                  value: healAmt,
                });
              }
            }

            // Knockback + silence
            if (e.knockbackUnits && e.knockbackUnits > 0 && dist > 0) {
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
              const brokenStealth = opp.buffs.filter((b) => b.buffId === 1012 || b.buffId === 1013);
              if (brokenStealth.length > 0) {
                opp.buffs = opp.buffs.filter((b) => b.buffId !== 1012 && b.buffId !== 1013);
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
            }

            buffsChanged = true;
          }
        }
      }

      // Remove expired buffs
      const before = player.buffs.length;
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
            player.hp = Math.max(0, player.hp - dps);
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
          const owner = this.state.players.find(p => p.userId === zone.ownerUserId);
          let targetsHit = 0;
          for (const target of this.state.players) {
            if (target.userId === zone.ownerUserId) continue;
            if (target.hp <= 0) continue;
            if (zone.maxTargets !== undefined && targetsHit >= zone.maxTargets) break;
            const dx = target.position.x - zone.x;
            const dy = target.position.y - zone.y;
            if (Math.sqrt(dx * dx + dy * dy) > zone.radius) continue;
            const dmg = resolveScheduledDamage({
              source: owner ?? target,
              target,
              base: zone.damagePerInterval,
            });
            target.hp = Math.max(0, target.hp - dmg);
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
      const thisTickEvents = this.state.events.slice(eventsBefore);
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
              targetPlayer.hp = Math.max(0, targetPlayer.hp - dmg);
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
