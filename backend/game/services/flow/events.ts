// backend/game/services/events.ts
/**
 * Public game event emitter.
 */

import { GameState, GameEvent } from "../../engine/state/types";
import { randomUUID } from "crypto";

export function pushEvent(
  state: GameState,
  e: Omit<GameEvent, "id" | "timestamp">
) {
  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    ...e,
  });
}
