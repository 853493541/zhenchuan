/**
 * Manages WebSocket subscriptions for games
 * Tracks which clients are connected to which games
 * Broadcasts state changes to all connected clients
 */

import { WebSocket } from "ws";
import GameSession from "../game/models/GameSession";

export type DiffPatch = {
  path: string;
  value: any;
};

export type GameMessage = {
  type: "STATE_DIFF" | "GAME_OVER" | "PING";
  version?: number;
  diff?: DiffPatch[];
  events?: any[];
  winnerUserId?: string;
  timestamp?: number; // Server timestamp for RTT measurement
};

interface SubscribedClient {
  ws: WebSocket;
  userId: string;
  gameId: string;
}

export class GameSubscriptionManager {
  private clients: Map<WebSocket, SubscribedClient> = new Map();
  private gameClients: Map<string, Set<WebSocket>> = new Map();
  
  // Track disbandment timeouts (gameId -> timeoutId)
  // Only disband waiting rooms after 30 sec of no clients
  private disbandTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly DISBAND_GRACE_PERIOD = 30 * 1000; // 30 seconds

  /**
   * Subscribe a client to a game
   */
  subscribe(ws: WebSocket, gameId: string, userId: string) {
    const client: SubscribedClient = { ws, userId, gameId };
    this.clients.set(ws, client);

    if (!this.gameClients.has(gameId)) {
      this.gameClients.set(gameId, new Set());
    }
    this.gameClients.get(gameId)!.add(ws);

    // Cancel any pending disbandment if someone reconnects
    const timeout = this.disbandTimeouts.get(gameId);
    if (timeout) {
      clearTimeout(timeout);
      this.disbandTimeouts.delete(gameId);
      console.log(`[WS] Cancelled disbandment for game ${gameId} (client reconnected)`);
    }

    console.log(
      `[WS] User ${userId} subscribed to game ${gameId}. Total: ${this.gameClients.get(gameId)!.size}`
    );
  }

  /**
   * Unsubscribe a client
   */
  unsubscribe(ws: WebSocket) {
    const client = this.clients.get(ws);
    if (!client) return;

    const gameClients = this.gameClients.get(client.gameId);
    if (gameClients) {
      gameClients.delete(ws);
      if (gameClients.size === 0) {
        this.gameClients.delete(client.gameId);
        // Schedule disbandment with grace period instead of immediate deletion
        // This prevents instant disbandment when host temporarily disconnects
        this.scheduleDisband(client.gameId);
      }
    }

    this.clients.delete(ws);
    console.log(
      `[WS] User ${client.userId} unsubscribed from game ${client.gameId}`
    );
  }

  /**
   * Schedule a waiting room for disbandment after grace period
   */
  private scheduleDisband(gameId: string) {
    // Cancel any existing timeout for this game
    const existingTimeout = this.disbandTimeouts.get(gameId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new disbandment
    const timeout = setTimeout(async () => {
      console.log(
        `[WS] Grace period expired for game ${gameId}, checking if empty...`
      );
      await this.disbandEmptyRoom(gameId);
      this.disbandTimeouts.delete(gameId);
    }, this.DISBAND_GRACE_PERIOD);

    this.disbandTimeouts.set(gameId, timeout);
    console.log(
      `[WS] Scheduled disbandment for game ${gameId} in ${this.DISBAND_GRACE_PERIOD / 1000}s`
    );
  }

  /**
   * Disband a waiting room if it has no connected clients
   * Only disbands rooms that haven't started yet
   * Double-checks that room is actually empty before deletion
   */
  private async disbandEmptyRoom(gameId: string) {
    try {
      const game = await GameSession.findById(gameId);
      if (!game) return;

      // Only disband waiting rooms (not started games)
      if (game.started) {
        console.log(`[WS] Game ${gameId} is already started, keeping it`);
        return;
      }

      // Verify no clients are connected (still empty after grace period)
      if (this.getGameClientCount(gameId) === 0) {
        await GameSession.findByIdAndDelete(gameId);
        console.log(
          `[WS] ✨ Disbanded empty waiting room ${gameId} (after grace period)`
        );
      } else {
        console.log(
          `[WS] Game ${gameId} is no longer empty, cancelling disbandment`
        );
      }
    } catch (err) {
      console.error(`[WS] Error disbanding room ${gameId}:`, err);
    }
  }

  /**
   * Broadcast a message to all clients in a game
   */
  broadcast(gameId: string, message: GameMessage) {
    const clients = this.gameClients.get(gameId);
    if (!clients) return;

    const payload = JSON.stringify(message);
    const deadSockets: WebSocket[] = [];

    clients.forEach((ws) => {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(payload);
      } else {
        deadSockets.push(ws);
      }
    });

    // Clean up dead connections
    deadSockets.forEach((ws) => this.unsubscribe(ws));
  }

  /**
   * Get connected clients count for a game
   */
  getGameClientCount(gameId: string): number {
    return this.gameClients.get(gameId)?.size ?? 0;
  }

  /**
   * Check if a client is connected
   */
  isConnected(gameId: string, userId: string): boolean {
    const clients = this.gameClients.get(gameId);
    if (!clients) return false;

    for (const ws of clients) {
      const client = this.clients.get(ws);
      if (client?.userId === userId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cleanup: clear all pending disbandment timeouts
   * Call this when server is shutting down
   */
  cleanup() {
    this.disbandTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.disbandTimeouts.clear();
    console.log("[WS] Cleaned up pending disbandment timeouts");
  }
}

// Singleton instance
export const subscriptionManager = new GameSubscriptionManager();
