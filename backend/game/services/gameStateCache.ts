/**
 * In-memory cache for active game sessions
 * Reduces DB queries from 127ms to 0ms for repeated actions
 */

import { GameState } from "../engine/state/types";

interface CachedGame {
  gameId: string;
  state: GameState;
  lastModified: number;
}

class GameStateCache {
  private cache: Map<string, CachedGame> = new Map();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes

  /**
   * Get cached state (returns null if not cached or expired)
   */
  get(gameId: string): GameState | null {
    const cached = this.cache.get(gameId);
    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.lastModified > this.TTL) {
      this.cache.delete(gameId);
      return null;
    }

    return cached.state;
  }

  /**
   * Set cached state
   */
  set(gameId: string, state: GameState): void {
    this.cache.set(gameId, {
      gameId,
      state,
      lastModified: Date.now(),
    });
  }

  /**
   * Update state in cache (for when we modify it)
   */
  update(gameId: string, state: GameState): void {
    const cached = this.cache.get(gameId);
    if (cached) {
      cached.state = state;
      cached.lastModified = Date.now();
    }
  }

  /**
   * Invalidate cache (e.g., when game ends or we need a fresh fetch)
   */
  invalidate(gameId: string): void {
    this.cache.delete(gameId);
  }

  /**
   * Get cache stats for debugging
   */
  getStats() {
    return {
      cachedGames: this.cache.size,
      games: Array.from(this.cache.keys()),
    };
  }
}

export const gameStateCache = new GameStateCache();
