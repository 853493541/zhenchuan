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
import type { MapContext } from "../../loop/movement";

export function applyEffects(
  state: GameState,
  ability: Ability,
  playerIndex: number,
  targetIndex: number,
  mapCtx?: MapContext,
  castContext?: {
    targetUserId?: string;
    groundTarget?: { x: number; y: number; z?: number };
    entityTargetId?: string;
  }
) {
  applyAbility(state, ability, playerIndex, targetIndex, mapCtx, castContext);
}
