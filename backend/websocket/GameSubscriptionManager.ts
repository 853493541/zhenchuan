/**
 * Manages WebSocket subscriptions for games
 * Tracks which clients are connected to which games
 * Broadcasts state changes to all connected clients
 */

import { WebSocket } from "ws";
import GameSession from "../game/models/GameSession";
import { performance } from "node:perf_hooks";
import { recordLagProbe, roundLagMs } from "../utils/lagProbe";

export type DiffPatch = {
  path: string;
  value: any;
};

export type ChatChannel = "map" | "system";

export type ChatMessagePayload = {
  id: string;
  channel: ChatChannel;
  userId: string;
  username: string;
  school?: string | null;
  text: string;
  timestamp: number;
  variant?: "user" | "system";
};

export type GameMessage = {
  type: "STATE_DIFF" | "GAME_OVER" | "PING" | "PLAYER_DISCONNECTED" | "PLAYER_RECONNECTED" | "CHAT_MESSAGE";
  version?: number;
  diff?: DiffPatch[];
  events?: any[];
  winnerUserId?: string;
  userId?: string;
  username?: string;
  chat?: ChatMessagePayload;
  endsAt?: number;
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

    void this.broadcastPlayerPresence(gameId, userId, "PLAYER_RECONNECTED");
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

    if (!this.isConnected(client.gameId, client.userId) && this.getGameClientCount(client.gameId) > 0) {
      void this.broadcastPlayerPresence(client.gameId, client.userId, "PLAYER_DISCONNECTED");
    }
  }

  private async broadcastPlayerPresence(
    gameId: string,
    userId: string,
    type: "PLAYER_DISCONNECTED" | "PLAYER_RECONNECTED",
  ) {
    try {
      const game = await GameSession.findById(gameId);
      if (!game || !game.started) return;
      const state = game.state as any;
      if (state?.gameOver || state?.leaveNotice) return;

      const username =
        (game as any).playerNames?.[userId] ??
        state?.players?.find((player: any) => player?.userId === userId)?.username ??
        `User${String(userId).slice(-4)}`;

      this.broadcast(gameId, {
        type,
        userId,
        username,
        endsAt: type === "PLAYER_DISCONNECTED" ? Date.now() + 5_000 : undefined,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`[WS] Failed to broadcast ${type} for ${gameId}/${userId}:`, err);
    }
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

    const startedAt = performance.now();
    const payload = JSON.stringify(message);
    const stringifyMs = performance.now() - startedAt;
    const deadSockets: WebSocket[] = [];
    let sentCount = 0;

    const sendStartedAt = performance.now();

    clients.forEach((ws) => {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(payload);
        sentCount++;
      } else {
        deadSockets.push(ws);
      }
    });
    const sendMs = performance.now() - sendStartedAt;
    const totalMs = performance.now() - startedAt;

    if (totalMs >= 40 || stringifyMs >= 20 || sendMs >= 30 || payload.length >= 250_000) {
      recordLagProbe("websocket-broadcast", {
        gameId,
        messageType: message.type,
        version: message.version ?? null,
        diffCount: message.diff?.length ?? 0,
        eventCount: Array.isArray(message.events) ? message.events.length : 0,
        clientCount: clients.size,
        sentCount,
        deadSocketCount: deadSockets.length,
        payloadBytes: Buffer.byteLength(payload, "utf8"),
        stringifyMs: roundLagMs(stringifyMs),
        sendMs: roundLagMs(sendMs),
        totalMs: roundLagMs(totalMs),
      });
    }

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
