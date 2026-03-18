// backend/game/engine/effects/handlers/eventHelpers.ts

import { randomUUID } from "crypto";
import { GameState, GameEvent } from "../state/types";

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
