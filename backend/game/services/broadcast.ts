/**
 * Game broadcast helper
 * Notifies all connected WebSocket clients of state changes
 */

import { subscriptionManager, DiffPatch, GameMessage } from "../../websocket/GameSubscriptionManager";

export interface BroadcastParams {
  gameId: string;
  version: number;
  diff: DiffPatch[];
  events?: any[];
  gameOver?: boolean;
  winnerUserId?: string;
  timestamp?: number;
  isMovementOnly?: boolean; // Compact format for position broadcasts
}

export function broadcastGameUpdate(params: BroadcastParams) {
  const { gameId, version, diff, events, gameOver, winnerUserId, timestamp, isMovementOnly } = params;

  // Compact message for movement-only updates (no events, no timestamp)
  if (isMovementOnly) {
    const message: GameMessage = {
      type: "STATE_DIFF",
      version,
      diff,
    } as GameMessage;
    subscriptionManager.broadcast(gameId, message);
  } else {
    // Full message for other updates
    const message: GameMessage = {
      type: gameOver ? "GAME_OVER" : "STATE_DIFF",
      version,
      diff,
      events,
      timestamp,
      ...(gameOver && { winnerUserId }),
    } as GameMessage;
    subscriptionManager.broadcast(gameId, message);
  }
}
