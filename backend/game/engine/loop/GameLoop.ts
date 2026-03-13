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
    if (loop && !loop.isRunning) {
      activeLoops.delete(gameId);
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
    this.state.players.forEach((player, idx) => {
      const input = this.playerInputs.get(idx) ?? null;
      applyMovement(player, input, this.tickRate);
    });
    const moveTime = performance.now() - moveStart;

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
      
      // Send only position changes (lightweight diff, no structuredClone)
      const diff = this.state.players.map((p) => ({
        path: `/players/${this.state.players.indexOf(p)}/position`,
        value: p.position,
      }));
      
      // During gameplay, send compact movement-only broadcasts
      if (!this.state.gameOver) {
        broadcastGameUpdate({
          gameId: this.gameId,
          version: this.state.version,
          diff,
          isMovementOnly: true, // Compact format - skip events/timestamp for speed
        });
      } else {
        // When game ends, send full broadcast with winner info
        broadcastGameUpdate({
          gameId: this.gameId,
          version: this.state.version,
          diff,
          gameOver: this.state.gameOver,
          winnerUserId: this.state.winnerUserId,
          timestamp: Date.now(),
        });
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
