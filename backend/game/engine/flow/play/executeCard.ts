// backend/game/engine/flow/applyEffects.ts

/**
 * Public engine entry point for card execution.
 *
 * DO NOT put logic here.
 * This file exists to:
 * - provide a stable import path
 * - shield callers from internal refactors
 * - define the engine’s execution boundary
 */

import { GameState, Card } from "../../state/types";
import { applyCard } from "./PlayCard";

export function applyEffects(
  state: GameState,
  card: Card,
  playerIndex: number,
  targetIndex: number
) {
  applyCard(state, card, playerIndex, targetIndex);
}
