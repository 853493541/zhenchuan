// backend/game/engine/flow/turn/legacyEndTurnChannels.ts

import { GameState, ActiveBuff } from "../../../state/types";
import { shouldDodge } from "../../../rules/guards";
import { resolveScheduledDamageRoll } from "../../../utils/combatMath";
import { applyDamageToTarget } from "../../../utils/health";
import { pushDamageEvent } from "./combatEvents";
import { getBuffSourceAbilityId, getBuffSourceAbilityName } from "./buffOrigin";
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
          const damageRoll = resolveScheduledDamageRoll({
            source: current,
            target: other,
            base: 10,
            abilityId: getBuffSourceAbilityId(buff),
          });
          const dmg = damageRoll.damage;
          applyDamageToTarget(other as any, dmg);

          pushDamageEvent({
            state,
            actorUserId: current.userId,
            targetUserId: other.userId,
            abilityId: getBuffSourceAbilityId(buff),
            abilityName: getBuffSourceAbilityName(buff),
            value: dmg,
            isCrit: damageRoll.isCrit,
          });
        }
      }

      if (e.type === "WUJIAN_CHANNEL") {
        if (!shouldDodge(other)) {
          const damageRoll = resolveScheduledDamageRoll({
            source: current,
            target: other,
            base: 10,
            abilityId: getBuffSourceAbilityId(buff),
          });
          const dmg = damageRoll.damage;
          applyDamageToTarget(other as any, dmg);

          pushDamageEvent({
            state,
            actorUserId: current.userId,
            targetUserId: other.userId,
            abilityId: getBuffSourceAbilityId(buff),
            abilityName: getBuffSourceAbilityName(buff),
            value: dmg,
            isCrit: damageRoll.isCrit,
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
          const damageRoll = resolveScheduledDamageRoll({
            source: current,
            target: other,
            base: 5,
            abilityId: getBuffSourceAbilityId(buff),
          });
          const dmg = damageRoll.damage;
          applyDamageToTarget(other as any, dmg);

          pushDamageEvent({
            state,
            actorUserId: current.userId,
            targetUserId: other.userId,
            abilityId: getBuffSourceAbilityId(buff),
            abilityName: getBuffSourceAbilityName(buff),
            value: dmg,
            isCrit: damageRoll.isCrit,
          });
        }
      }
    }
  }
}
