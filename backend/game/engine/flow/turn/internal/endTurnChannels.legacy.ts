// backend/game/engine/flow/turn/legacyEndTurnChannels.ts

import { GameState, ActiveBuff } from "../../../state/types";
import { shouldDodge } from "../../../rules/guards";
import { resolveScheduledDamage } from "../../../utils/combatMath";
import { pushDamageEvent } from "./combatEvents";
import { getBuffSourceCardId, getBuffSourceCardName } from "./buffOrigin";
import { applyLegacyHeal } from "./resolveScheduled";

export function applyLegacyEndTurnChannels(params: {
  state: GameState;
  current: { userId: string; hp: number; buffs: ActiveBuff[] };
  other: { userId: string; hp: number; buffs: ActiveBuff[] };
}) {
  const { state, current, other } = params;

  for (const buff of current.buffs) {
    for (const e of buff.effects) {
      if (e.type === "FENGLAI_CHANNEL") {
        if (!shouldDodge(other)) {
          const dmg = resolveScheduledDamage({
            source: current,
            target: other,
            base: 10,
          });
          other.hp = Math.max(0, other.hp - dmg);

          pushDamageEvent({
            state,
            actorUserId: current.userId,
            targetUserId: other.userId,
            cardId: getBuffSourceCardId(buff),
            cardName: getBuffSourceCardName(buff),
            value: dmg,
          });
        }
      }

      if (e.type === "WUJIAN_CHANNEL") {
        if (!shouldDodge(other)) {
          const dmg = resolveScheduledDamage({
            source: current,
            target: other,
            base: 10,
          });
          other.hp = Math.max(0, other.hp - dmg);

          pushDamageEvent({
            state,
            actorUserId: current.userId,
            targetUserId: other.userId,
            cardId: getBuffSourceCardId(buff),
            cardName: getBuffSourceCardName(buff),
            value: dmg,
          });
        }

        // WUJIAN self heal
        applyLegacyHeal({
          state,
          owner: current,
          buff,
          base: 3,
        });
      }

      if (e.type === "XINZHENG_CHANNEL") {
        if (!shouldDodge(other)) {
          const dmg = resolveScheduledDamage({
            source: current,
            target: other,
            base: 5,
          });
          other.hp = Math.max(0, other.hp - dmg);

          pushDamageEvent({
            state,
            actorUserId: current.userId,
            targetUserId: other.userId,
            cardId: getBuffSourceCardId(buff),
            cardName: getBuffSourceCardName(buff),
            value: dmg,
          });
        }
      }
    }
  }
}
