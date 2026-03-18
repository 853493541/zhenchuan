// backend/game/engine/utils/targeting.ts
/**
 * Targeting helpers.
 *
 * Responsibilities:
 * - Resolve who an effect should apply to
 * - Resolve enemy player relative to a player index
 *
 * ❗ Pure helpers
 * ❗ No state mutation
 * ❗ No events
 */

import { GameState, TargetType } from "../state/types";

/**
 * Get the enemy player relative to playerIndex
 */
export function getEnemy(state: GameState, playerIndex: number) {
  return state.players[playerIndex === 0 ? 1 : 0];
}

/**
 * Resolve the actual target index for an effect.
 *
 * Rules:
 * - If applyTo is undefined → use card target (already resolved by caller)
 * - SELF → playerIndex
 * - OPPONENT → the other player
 */
export function resolveEffectTargetIndex(
  cardTargetIndex: number,
  playerIndex: number,
  applyTo: TargetType | undefined
) {
  if (!applyTo) return cardTargetIndex;

  return applyTo === "SELF"
    ? playerIndex
    : playerIndex === 0
    ? 1
    : 0;
}
