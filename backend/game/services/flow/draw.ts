// backend/game/services/draw.ts
/**
 * Card draw logic.
 * Includes DRAW_REDUCTION handling (buff-based).
 *
 * IMPORTANT CHANGE:
 * - We batch deck mutation into a SINGLE operation
 * - This prevents repeated intermediate mutations
 * - Still compatible with current diff engine
 */

import { GameState, ActiveBuff, BuffEffect } from "../../engine/state/types";

/**
 * Draw N cards for a player (batched)
 */
export function draw(state: GameState, playerIndex: number, n: number) {
  if (n <= 0) return;
  if (state.deck.length === 0) return;

  // ✅ take cards in one slice
  const drawn = state.deck.slice(0, n);

  // ✅ mutate deck ONCE
  state.deck = state.deck.slice(drawn.length);

  // ✅ append to hand
  state.players[playerIndex].hand.push(...drawn);
}

/**
 * Automatic draw at start of turn
 * - base draw = 1
 * - reduced by active DRAW_REDUCTION buff effects
 */
export function autoDrawAtTurnStart(state: GameState) {
  if (state.gameOver) return;

  const p = state.players[state.activePlayerIndex];
  if (p.hand.length >= 10) return;
  if (state.deck.length === 0) return;

  // Collect all DRAW_REDUCTION effects from active buffs
  const reductions: BuffEffect[] = p.buffs.flatMap((b: ActiveBuff) =>
    b.effects.filter((e) => e.type === "DRAW_REDUCTION")
  );

  const totalReduction = reductions.reduce(
    (sum, e) => sum + (e.value ?? 0),
    0
  );

  const n = Math.max(0, 1 - totalReduction);

  if (n > 0) {
    draw(state, state.activePlayerIndex, n);
  }
}
