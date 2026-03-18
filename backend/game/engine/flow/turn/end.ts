// backend/game/engine/flow/turn/resolveTurnEndImpl.ts

import { GameState } from "../../state/types";
import { applyScheduledDamage } from "./internal/resolveScheduled";
import { applyLegacyEndTurnChannels } from "./internal/endTurnChannels.legacy";
import { tickBuffs, cleanupExpiredBuffs } from "./internal/tickBuffs";
import { applyStartTurnEffects } from "./start";
import { checkGameOver } from "./checkGameOver";

export function resolveTurnEndImpl(state: GameState) {
  if (state.gameOver) return;

  const currentIndex = state.activePlayerIndex;
  const otherIndex = currentIndex === 0 ? 1 : 0;

  const current = state.players[currentIndex];
  const other = state.players[otherIndex];

  /* ================= END OF TURN ================= */

  applyScheduledDamage(state, "TURN_END", 0);
  applyScheduledDamage(state, "TURN_END", 1);

  applyLegacyEndTurnChannels({ state, current, other });

  tickBuffs(current, "TURN_END");
  cleanupExpiredBuffs(state, current);

  /* ================= ADVANCE TURN ================= */

  state.turn += 1;
  state.activePlayerIndex =
    (state.activePlayerIndex + 1) % state.players.length;

  const me = state.players[state.activePlayerIndex];
  const enemy = state.players[state.activePlayerIndex === 0 ? 1 : 0];

  /* ================= START OF TURN ================= */

  applyScheduledDamage(state, "TURN_START", 0);
  applyScheduledDamage(state, "TURN_START", 1);

  tickBuffs(me, "TURN_START");
  cleanupExpiredBuffs(state, me);

  applyStartTurnEffects({ state, me, enemy });

  /* ================= GAME OVER ================= */

  checkGameOver(state);
}
