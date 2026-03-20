// backend/game/engine/loop/GameLoop.ts
/**
 * Real-time game loop for 2D arena battles
 * Runs at fixed tick rate (~60 Hz or 16ms per tick)
 * Handles:
 * - Player movement
 * - Ability casting
 * - Buff updates
 * - Win condition checks
 */

import { GameState, MovementInput, calculateDistance } from "../state/types";
import { checkGameOver } from "../flow/turn/checkGameOver";
import { broadcastGameUpdate } from "../../services/broadcast";
import { diffState } from "../../services/flow/stateDiff";
import GameSession from "../../models/GameSession";
import { applyMovement } from "./movement";
import { pushBuffExpired } from "../effects/buffRuntime";
import { resolveScheduledDamage, resolveHealAmount } from "../utils/combatMath";
import { randomUUID } from "crypto";

export interface GameLoopConfig {
  tickRate?: number; // Hz (default 60)
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
  private broadcastTickInterval = 1; // Broadcast every tick for consistent client-side prediction

  constructor(gameId: string, state: GameState, config?: GameLoopConfig) {
    this.gameId = gameId;
    this.state = structuredClone(state);
    this.tickRate = config?.tickRate ?? 60;

    // Initialize player input buffers
    this.state.players.forEach((_, idx) => {
      this.playerInputs.set(idx, null);
    });
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

    this.tickInterval = setInterval(() => {
      try {
        this.tick();
        // Yield to event loop to prevent blocking other requests
        setImmediate(() => {});
      } catch (err) {
        console.error(`[GameLoop] Error in tick for ${this.gameId}:`, err);
        this.stop();
      }
    }, tickDuration);
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

    // 1. Apply player movement
    const moveStart = performance.now();
    // Track buff count per player before movement — applyMovement may splice JUMP_BOOST
    const buffCountsBefore = this.state.players.map((p) => p.buffs?.length ?? 0);
    this.state.players.forEach((player, idx) => {
      const input = this.playerInputs.get(idx) ?? null;
      applyMovement(player, input, this.tickRate);
      // Clear the one-shot jump flag so it fires only once per press
      if (input?.jump) {
        this.playerInputs.set(idx, { ...input, jump: false });
      }
    });
    const moveTime = performance.now() - moveStart;

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
    );

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
                const dmg = resolveScheduledDamage({
                  source: opp,
                  target: player,
                  base: e.value ?? 0,
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
              } else if (e.type === "CHANNEL_AOE_TICK") {
                // Channel AOE: deal damage to opponent if within range
                const range = e.range ?? 10;
                const dist = calculateDistance(player.position, opp.position);
                if (dist <= range && opp.hp > 0) {
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
            if (e.type !== "TIMED_AOE_DAMAGE") continue;
            if (e.delayMs === undefined) continue;
            if (buff.firedDelayIndices?.includes(effIdx)) continue;
            if (now < buff.appliedAt + e.delayMs) continue;

            // Mark this effect as fired
            if (!buff.firedDelayIndices) buff.firedDelayIndices = [];
            buff.firedDelayIndices.push(effIdx);

            if (opp.hp <= 0) continue;

            // Range check
            const range = e.range ?? 10;
            const dx = opp.position.x - player.position.x;
            const dy = opp.position.y - player.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
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

      // Append buff arrays whenever they changed (expiry or periodic effects)
      if (buffsChanged) {
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
        for (let i = eventsBefore; i < this.state.events.length; i++) {
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

    // Timing logs disabled to reduce backend load
    // const tickTotal = performance.now() - tickStart;
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
    clearInterval(this.tickInterval);

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
