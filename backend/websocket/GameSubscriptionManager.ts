/**
 * Manages WebSocket subscriptions for games
 * Tracks which clients are connected to which games
 * Broadcasts state changes to all connected clients
 */

import { WebSocket } from "ws";

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
};

interface SubscribedClient {
  ws: WebSocket;
  userId: string;
  gameId: string;
}

export class GameSubscriptionManager {
  private clients: Map<WebSocket, SubscribedClient> = new Map();
  private gameClients: Map<string, Set<WebSocket>> = new Map();

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
      }
    }

    this.clients.delete(ws);
    console.log(
      `[WS] User ${client.userId} unsubscribed from game ${client.gameId}`
    );
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
}

// Singleton instance
export const subscriptionManager = new GameSubscriptionManager();
