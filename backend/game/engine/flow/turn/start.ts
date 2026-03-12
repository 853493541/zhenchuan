// backend/game/engine/flow/turn/startTurnEffects.ts

import { GameState, ActiveBuff } from "../../state/types";
import {
  resolveScheduledDamage,
  resolveHealAmount,
} from "../../utils/combatMath";
import {
  pushDamageEvent,
  pushHealEvent,
} from "./internal/combatEvents";
import {
  getBuffSourceCardId,
  getBuffSourceCardName,
} from "./internal/buffOrigin";

export function applyStartTurnEffects(params: {
  state: GameState;
  me: { userId: string; hp: number; buffs: ActiveBuff[]; gcd: number; hand: any[] };
  enemy: { userId: string; hp: number; buffs: ActiveBuff[] };
}) {
  const { state, me, enemy } = params;

  /**
   * ================= COOLDOWN DECREMENT =================
   * Decrement cooldowns on all cards in hand at start of turn
   */
  for (const card of me.hand) {
    if (card.cooldown > 0) {
      card.cooldown -= 1;
    }
  }

  /**
   * ================= GCD REFILL =================
   * Start of active player's turn
   * Current rule (v0):
   * - Always reset to exactly 1
   */
  me.gcd = 1;

  for (const buff of me.buffs) {
    for (const e of buff.effects) {
      if (e.type === "START_TURN_DAMAGE") {
        const dmg = resolveScheduledDamage({
          source: enemy,
          target: me,
          base: e.value ?? 0,
        });

        me.hp = Math.max(0, me.hp - dmg);

        pushDamageEvent({
          state,
          actorUserId: enemy.userId,
          targetUserId: me.userId,
          cardId: getBuffSourceCardId(buff),
          cardName: getBuffSourceCardName(buff),
          value: dmg,
          effectType: "SCHEDULED_DAMAGE",
        });
      }

      if (e.type === "START_TURN_HEAL") {
        const heal = resolveHealAmount({
          target: me,
          base: e.value ?? 0,
        });

        const before = me.hp;
        me.hp = Math.min(100, me.hp + heal);
        const applied = Math.max(0, me.hp - before);

        if (applied > 0) {
          pushHealEvent({
            state,
            actorUserId: me.userId,
            targetUserId: me.userId,
            cardId: getBuffSourceCardId(buff),
            cardName: getBuffSourceCardName(buff),
            value: applied,
          });
        }
      }
    }
  }
}
