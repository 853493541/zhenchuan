// backend/game/engine/flow/onPlay.ts

import { GameState } from "../../state/types";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { pushEvent } from "../../../services/flow/events";

/**
 * Apply ON_PLAY_DAMAGE effects from active buffs.
 * Engine-level responsibility.
 */
export function applyOnPlayBuffEffects(
  state: GameState,
  playerIndex: number
) {
  const player = state.players[playerIndex];
  if (!player.buffs) return;

  for (const buff of player.buffs) {
    if (!buff.effects) continue;

    for (const effect of buff.effects) {
      if (effect.type !== "ON_PLAY_DAMAGE") continue;

      const base = effect.value ?? 0;
      if (base <= 0) continue;

      const dmg = resolveScheduledDamage({
        source: player,
        target: player,
        base,
      });

      if (dmg <= 0) continue;

      player.hp = Math.max(0, player.hp - dmg);

      pushEvent(state, {
        turn: state.turn,
        type: "DAMAGE",
        actorUserId: player.userId,
        targetUserId: player.userId,
        value: dmg,
      });
    }
  }
}
