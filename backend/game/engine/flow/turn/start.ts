// backend/game/engine/flow/turn/startTurnEffects.ts

import { GameState, ActiveBuff } from "../../state/types";
import {
  resolveScheduledDamageRoll,
  resolveHealAmountRoll,
} from "../../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget } from "../../utils/health";
import {
  pushDamageEvent,
  pushHealEvent,
} from "./internal/combatEvents";
import {
  getBuffSourceAbilityId,
  getBuffSourceAbilityName,
} from "./internal/buffOrigin";

export function applyStartTurnEffects(params: {
  state: GameState;
  me: { userId: string; hp: number; buffs: ActiveBuff[]; hand: any[] };
  enemy: { userId: string; hp: number; buffs: ActiveBuff[] };
}) {
  const { state, me, enemy } = params;

  /**
   * ================= COOLDOWN DECREMENT =================
   * Decrement cooldowns on all abilities in hand at start of turn
   */
  for (const ability of me.hand) {
    if (ability.cooldown > 0) {
      ability.cooldown -= 1;
    }
  }

  /**
   * ================= GCD REFILL =================
   * Start of active player's turn
   * Current rule (v0):
   * - Always reset to exactly 1
   */
  for (const buff of me.buffs) {
    for (const e of buff.effects) {
      if (e.type === "PERIODIC_DAMAGE") {
        const damageRoll = resolveScheduledDamageRoll({
          source: enemy,
          target: me,
          base: e.value ?? 0,
          abilityId: getBuffSourceAbilityId(buff),
        });
        const dmg = damageRoll.damage;

        applyDamageToTarget(me as any, dmg);

        pushDamageEvent({
          state,
          actorUserId: enemy.userId,
          targetUserId: me.userId,
          abilityId: getBuffSourceAbilityId(buff),
          abilityName: getBuffSourceAbilityName(buff),
          value: dmg,
          isCrit: damageRoll.isCrit,
          effectType: "SCHEDULED_DAMAGE",
        });
      }

      if (e.type === "PERIODIC_HEAL") {
        const healRoll = resolveHealAmountRoll({
          source: me,
          target: me,
          base: e.value ?? 0,
        });

        const applied = applyHealToTarget(me as any, healRoll.heal);

        if (applied > 0) {
          pushHealEvent({
            state,
            actorUserId: me.userId,
            targetUserId: me.userId,
            abilityId: getBuffSourceAbilityId(buff),
            abilityName: getBuffSourceAbilityName(buff),
            value: applied,
            isCrit: healRoll.isCrit,
          });
        }
      }
    }
  }
}
