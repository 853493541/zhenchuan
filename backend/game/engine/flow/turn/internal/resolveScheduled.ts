// backend/game/engine/flow/turn/scheduledDamage.ts

import { GameState, ActiveBuff } from "../../../state/types";
import { shouldDodge, hasUntargetable } from "../../../rules/guards";
import { resolveScheduledDamage, resolveHealAmount } from "../../../utils/combatMath";
import { pushDamageEvent, pushHealEvent } from "./combatEvents";
import {
  getBuffSourceCardId,
  getBuffSourceCardNameWithDebug,
} from "./buffOrigin";

export function applyScheduledDamage(
  state: GameState,
  phase: "TURN_START" | "TURN_END",
  ownerIndex: number
) {
  const owner = state.players[ownerIndex];
  const enemy = state.players[ownerIndex === 0 ? 1 : 0];

  for (const buff of owner.buffs) {
    if (buff.stageIndex == null) buff.stageIndex = 0;

    const scheduled = buff.effects.filter((e) => e.type === "SCHEDULED_DAMAGE");
    const stage = scheduled[buff.stageIndex];
    if (!stage) continue;

    const isOwnersTurn = ownerIndex === state.activePlayerIndex;

    if (stage.when !== phase) continue;
    if (stage.turnOf === "OWNER" && !isOwnersTurn) continue;
    if (stage.turnOf === "ENEMY" && isOwnersTurn) continue;

    const target = stage.target === "SELF" ? owner : enemy;

    if (target.userId !== owner.userId) {
      if (hasUntargetable(target) || shouldDodge(target)) {
        pushDamageEvent({
          state,
          actorUserId: owner.userId,
          targetUserId: target.userId,
          cardId: getBuffSourceCardId(buff),
          cardName: getBuffSourceCardNameWithDebug(buff, stage.debug),
          value: 0,
          effectType: "SCHEDULED_DAMAGE",
        });
        buff.stageIndex += 1;
        continue;
      }
    }

    const dmg = resolveScheduledDamage({
      source: owner,
      target,
      base: stage.value ?? 0,
    });

    target.hp = Math.max(0, target.hp - dmg);

    pushDamageEvent({
      state,
      actorUserId: owner.userId,
      targetUserId: target.userId,
      cardId: getBuffSourceCardId(buff),
      cardName: getBuffSourceCardNameWithDebug(buff, stage.debug),
      value: dmg,
      effectType: "SCHEDULED_DAMAGE",
    });

    // OPTIONAL LIFESTEAL
    if (stage.lifestealPct && dmg > 0) {
      const heal = Math.floor(dmg * stage.lifestealPct);
      const before = owner.hp;

      owner.hp = Math.min(100, owner.hp + heal);
      const applied = owner.hp - before;

      if (applied > 0) {
        pushHealEvent({
          state,
          actorUserId: owner.userId,
          targetUserId: owner.userId,
          cardId: getBuffSourceCardId(buff),
          cardName: getBuffSourceCardNameWithDebug(buff, "吸血"),
          value: applied,
        });
      }
    }

    buff.stageIndex += 1;
  }
}

/**
 * Small helper used by legacy channeling in end-turn phase.
 * (kept here to avoid circular imports)
 */
export function applyLegacyHeal(params: {
  state: GameState;
  owner: { userId: string; hp: number; buffs: ActiveBuff[] };
  buff: ActiveBuff;
  base: number;
}) {
  const { state, owner, buff, base } = params;

  const heal = resolveHealAmount({ target: owner, base });
  const before = owner.hp;
  owner.hp = Math.min(100, owner.hp + heal);
  const applied = Math.max(0, owner.hp - before);

  if (applied > 0) {
    pushHealEvent({
      state,
      actorUserId: owner.userId,
      targetUserId: owner.userId,
      cardId: getBuffSourceCardId(buff),
      cardName: getBuffSourceCardNameWithDebug(buff, "吸血"),
      value: applied,
    });
  }
}
