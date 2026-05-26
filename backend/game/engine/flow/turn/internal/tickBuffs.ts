// backend/game/engine/flow/turn/buffTicks.ts

import { GameState, ActiveBuff } from "../../../state/types";
import { pushBuffExpired } from "../../../effects/buffRuntime";
import { removeLinkedShield } from "../../../utils/health";

/**
 * Remove any buffs that have passed their expiresAt wall-clock time.
 * Called during turn-based flow as a safety cleanup.
 * (Real-time battles are handled by GameLoop using Date.now() directly.)
 */
export function cleanupExpiredBuffs(
  state: GameState,
  player: { userId: string; buffs: ActiveBuff[] }
) {
  const now = Date.now();
  const before = player.buffs.slice();
  const expired = before.filter((b) => now >= b.expiresAt);

  for (const buff of expired) {
    removeLinkedShield(player as any, buff as any);
  }
  player.buffs = before.filter((b) => now < b.expiresAt);

  for (const old of expired) {
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: old.buffId,
      buffName: old.name,
      buffCategory: old.category,
      sourceAbilityId: old.sourceAbilityId,
      sourceAbilityName: old.sourceAbilityName,
      sourceUserId: old.sourceUserId,
    });
  }
}

/**
 * @deprecated No longer needed — buffs expire by wall-clock time, not turn ticks.
 * Kept as a no-op to avoid breaking call-sites until they are updated.
 */
export function tickBuffs(
  _player: { userId: string; buffs: ActiveBuff[] },
  _phase: "TURN_START" | "TURN_END"
) {
  // no-op
}
