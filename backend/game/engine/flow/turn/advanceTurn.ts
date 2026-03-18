// backend/game/engine/flow/turnResolver.ts

import { GameState } from "../../state/types";
import { resolveTurnEndImpl } from "./end";

/**
 * Public engine entry point for turn resolution.
 * Keep this file stable as an import boundary.
 */
export function resolveTurnEnd(state: GameState) {
  resolveTurnEndImpl(state);
}
