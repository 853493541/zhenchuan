// backend/game/engine/effects/handlers/handleChannelEffect.ts

import {
  GameState,
  Ability,
  AbilityEffect,
  ActiveBuff,
} from "../../state/types";
import { blocksEnemyTargeting } from "../../rules/guards";
import { resolveScheduledDamage, resolveHealAmount } from "../../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget } from "../../utils/health";
import { pushEvent } from "../events";

/**
 * LEGACY CHANNEL IMMEDIATE EFFECTS
 *
 * IMPORTANT ENGINE CONTRACT:
 * - guards.ts requires { buffs: ActiveBuff[] }
 * - combatMath requires { buffs: ActiveBuff[] }
 *
 * Therefore source / enemy MUST include buffs.
 */
export function handleChannelEffect(
  state: GameState,
  source: { userId: string; hp: number; buffs: ActiveBuff[] },
  enemy: { userId: string; hp: number; buffs: ActiveBuff[] },
  ability: Ability,
  effect: AbilityEffect
) {
  // 心证：no immediate tick
  if (effect.type === "XINZHENG_CHANNEL") return;

  // Only 无间狱 has immediate tick
  if (effect.type !== "WUJIAN_CHANNEL") return;

  if (blocksEnemyTargeting(enemy)) {
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: enemy.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: 0,
    });
  } else {
    const dmg = resolveScheduledDamage({
      source,
      target: enemy,
      base: 10,
    });

    applyDamageToTarget(enemy as any, dmg);

    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: enemy.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: dmg,
    });
  }

  // 无间狱 immediate self-heal
  const heal = resolveHealAmount({ target: source, base: 3 });
  const applied = applyHealToTarget(source as any, heal);

  if (applied > 0) {
    pushEvent(state, {
      turn: state.turn,
      type: "HEAL",
      actorUserId: source.userId,
      targetUserId: source.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "HEAL",
      value: applied,
    });
  }
}
