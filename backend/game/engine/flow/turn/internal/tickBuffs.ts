// backend/game/engine/flow/turn/buffTicks.ts

import { GameState, ActiveBuff } from "../../../state/types";
import { pushBuffExpired } from "../../../effects/buffRuntime";

export function tickBuffs(
  player: { userId: string; buffs: ActiveBuff[] },
  phase: "TURN_START" | "TURN_END"
) {
  for (const buff of player.buffs) {
    if (buff.tickOn === phase) {
      buff.remaining -= 1;
    }
  }
}

export function cleanupExpiredBuffs(
  state: GameState,
  player: { userId: string; buffs: ActiveBuff[] }
) {
  const before = player.buffs.slice();

  player.buffs = player.buffs.filter((b) => b.remaining > 0);

  for (const old of before) {
    if (!player.buffs.some((b) => b.buffId === old.buffId)) {
      pushBuffExpired(state, {
        targetUserId: player.userId,
        buffId: old.buffId,
        buffName: old.name,
        buffCategory: old.category,
        sourceCardId: old.sourceCardId,
        sourceCardName: old.sourceCardName,
      });
    }
  }
}
