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
  timestamp?: number; // When the action was processed for RTT measurement
}

export function broadcastGameUpdate(params: BroadcastParams) {
  const { gameId, version, diff, events, gameOver, winnerUserId, timestamp } = params;

  const message: GameMessage = {
    type: gameOver ? "GAME_OVER" : "STATE_DIFF",
    version,
    diff,
    events,
    timestamp,
    ...(gameOver && { winnerUserId }),
  } as GameMessage;

  subscriptionManager.broadcast(gameId, message);

  // Disabled: too much spam in logs
  // console.log(
  //   `[Broadcast] Game ${gameId} v${version}: ${diff.length} patches, ${events?.length || 0} events`
  // );
}
