// backend/game/engine/flow/applyEffects.ts

/**
 * Public engine entry point for ability execution.
 *
 * DO NOT put logic here.
 * This file exists to:
 * - provide a stable import path
 * - shield callers from internal refactors
 * - define the engine’s execution boundary
 */

import { GameState, Ability } from "../../state/types";
import { applyAbility } from "./PlayAbility";

export function applyEffects(
  state: GameState,
  ability: Ability,
  playerIndex: number,
  targetIndex: number,
  castContext?: {
    targetUserId?: string;
    groundTarget?: { x: number; y: number };
  }
) {
  applyAbility(state, ability, playerIndex, targetIndex, castContext);
}
