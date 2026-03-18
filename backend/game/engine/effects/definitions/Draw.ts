// backend/game/engine/effects/handlers/handleDraw.ts

import { GameState, CardEffect } from "../../state/types";

export function handleDraw(
  state: GameState,
  source: { hand: any[] },
  effect: CardEffect
) {
  // Draw mechanic disabled - abilities are reusable with cooldowns instead
  // This is a no-op placeholder for backward compatibility
}
