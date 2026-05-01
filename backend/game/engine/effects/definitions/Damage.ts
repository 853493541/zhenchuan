// backend/game/engine/effects/handlers/handleDamage.ts

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { blocksEnemyTargeting, hasDamageImmune } from "../../rules/guards";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { applyDamageToTarget, applyHealToTarget } from "../../utils/health";
import { pushEvent } from "../events";
import { processOnDamageTaken, preCheckRedirect, applyRedirectToOpponent } from "../onDamageHooks";
import { getDunLiReflectVictim } from "../dunLiReflect";

/**
 * Handle immediate DAMAGE effects.
 *
 * IMPORTANT (engine contract):
 * - guards.ts expects target to have { buffs: ActiveBuff[] }
 * - combatMath expects source/target to have { buffs: ActiveBuff[] }
 * - Therefore source/target here MUST include buffs
 */
export function handleDamage(
  state: GameState,
  source: { userId: string; hp: number; buffs: ActiveBuff[] },
  target: { userId: string; hp: number; buffs: ActiveBuff[] },
  isEnemyEffect: boolean,
  ability: Ability,
  effect: AbilityEffect
) {
  // Enemy targeting can be blocked (e.g. untargetable / dodge-style buffs)
  if (isEnemyEffect && blocksEnemyTargeting(target)) {
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: 0,
    });
    return;
  }

  // 雷霆震怒 damage immunity: block all incoming enemy damage.
  // 盾立 reflect: if victim is a 盾立 holder, redirect this damage to the source.
  if (isEnemyEffect && hasDamageImmune(target)) {
    const reflectVictim = getDunLiReflectVictim(state, source.userId, target as any, ability);
    if (reflectVictim) {
      handleDamage(state, target as any, reflectVictim as any, true, ability, effect);
    }
    return;
  }

  // PROJECTILE_IMMUNE (斩无常): block damage from projectile abilities
  if (isEnemyEffect && (ability as any).isProjectile === true &&
    target.buffs.some((b) => b.effects.some((e) => (e as any).type === "PROJECTILE_IMMUNE") && b.expiresAt > Date.now())
  ) {
    return;
  }

  const base = effect.value ?? 0;

  const final = resolveScheduledDamage({
    source,
    target,
    base,
    abilityId: ability.id,
    damageType: (ability as any).damageType,
  });

  if (final > 0) {
    // Pre-damage: split redirect so A's DAMAGE event shows net (45%) value.
    const { adjustedDamage, redirectPlayer, redirectAmt } = preCheckRedirect(
      state,
      target,
      final
    );
    const damageToApply = adjustedDamage;

    let shieldAbsorbed = 0;
    if (damageToApply > 0) {
      const result = applyDamageToTarget(target as any, damageToApply);
      shieldAbsorbed = result.shieldAbsorbed;
      // Post-damage hooks (七星拱瑞 freeze-break, etc.)
      processOnDamageTaken(state, target as any, result.hpDamage, source.userId);
    }

    // Apply the 55% redirect to the opponent (B) directly.
    if (redirectPlayer && redirectAmt > 0) {
      applyRedirectToOpponent(state, redirectPlayer, redirectAmt);
    }

    // Emit A's DAMAGE event with the net value so the float matches actual HP loss.
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: adjustedDamage,
      shieldAbsorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
    });

    // Lifesteal: heal source for a fraction of damage applied (post-mitigation).
    // Emit the HEAL event even at full HP so the heal float is always visible.
    const ls = (effect as any).lifestealPct as number | undefined;
    if (ls && ls > 0 && damageToApply > 0) {
      const healAmt = Math.floor(damageToApply * ls);
      if (healAmt > 0) {
        applyHealToTarget(source as any, healAmt);
        pushEvent(state, {
          turn: state.turn,
          type: "HEAL",
          actorUserId: source.userId,
          targetUserId: source.userId,
          abilityId: ability.id,
          abilityName: ability.name,
          effectType: "DAMAGE",
          value: healAmt,
        });
      }
    }
  } else {
    // final === 0 (dodge / immune): still emit the zero-damage event.
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DAMAGE",
      value: 0,
    });
  }
}
