// backend/game/engine/rules/guards.ts

import { ActiveBuff, BuffEffect, EffectType } from "../state/types";

/* =========================================================
   BUFF HELPERS
========================================================= */

function allEffects(target: { buffs: ActiveBuff[] }): BuffEffect[] {
  return target.buffs.flatMap((b) => b.effects);
}

function hasEffect(target: { buffs: ActiveBuff[] }, type: EffectType) {
  return allEffects(target).some((e) => e.type === type);
}

function sumChances(target: { buffs: ActiveBuff[] }, type: EffectType) {
  return allEffects(target)
    .filter((e) => e.type === type)
    .reduce((sum, e) => sum + (e.chance ?? 0), 0);
}

/* =========================================================
   BASIC BUFF GUARDS
========================================================= */

/**
 * Dodge check (stacking)
 * - stacks chance from multiple DODGE_NEXT effects
 * - probabilistic
 */
export function shouldDodge(target: { buffs: ActiveBuff[] }) {
  const chance = sumChances(target, "DODGE_NEXT");
  if (chance <= 0) return false;
  return Math.random() < chance;
}

/**
 * Untargetable (hard immunity)
 * - blocks enemy effects
 * - blocks new enemy buffs
 */
export function hasUntargetable(target: { buffs: ActiveBuff[] }) {
  return hasEffect(target, "UNTARGETABLE");
}

/**
 * Stealth (targeting-only)
 * - blocks card targeting
 * - DOES NOT block damage ticks, channel ticks, or buffs
 */
export function hasStealth(target: { buffs: ActiveBuff[] }) {
  return hasEffect(target, "STEALTH");
}

/**
 * Hard block for enemy-applied EFFECTS
 * - used during effect resolution
 * - ONLY untargetable applies here
 */
export function blocksEnemyTargeting(target: { buffs: ActiveBuff[] }) {
  return hasUntargetable(target);
}

/**
 * Targeting block (card play validation)
 * - used BEFORE card is played
 * - stealth + untargetable both apply
 */
export function blocksCardTargeting(target: { buffs: ActiveBuff[] }) {
  return hasUntargetable(target) || hasStealth(target);
}

/* =========================================================
   EFFECT TARGETING RULES
========================================================= */

/**
 * Effects that are ALWAYS self-side,
 * regardless of card.target
 */
export function isAlwaysSelfEffect(effectType: EffectType) {
  return (
    effectType === "DRAW" ||
    effectType === "CLEANSE" ||
    effectType === "FENGLAI_CHANNEL" ||
    effectType === "WUJIAN_CHANNEL" ||
    effectType === "XINZHENG_CHANNEL"
  );
}

/**
 * Determines whether an effect is applied to the enemy
 */
export function isEnemyEffect(
  source: { userId: string },
  target: { userId: string },
  effect: { type: EffectType }
) {
  if (isAlwaysSelfEffect(effect.type)) return false;
  return target.userId !== source.userId;
}

/* =========================================================
   SKIP / BLOCK LOGIC
========================================================= */

/**
 * Skip logic due to dodge
 * - dodge only cancels enemy-applied effects
 */
export function shouldSkipDueToDodge(
  cardDodged: boolean,
  isEnemyEffect: boolean
) {
  return cardDodged && isEnemyEffect;
}

/**
 * Untargetable blocks NEW enemy-applied buffs
 */
export function blocksNewBuffByUntargetable(
  source: { userId: string },
  target: { userId: string; buffs: ActiveBuff[] }
) {
  return target.userId !== source.userId && hasUntargetable(target);
}

/**
 * Control immunity blocks CONTROL effects only
 */
export function blocksControlByImmunity(
  effectType: EffectType,
  target: { buffs: ActiveBuff[] }
) {
  if (effectType !== "CONTROL") return false;
  return allEffects(target).some((e) => e.type === "CONTROL_IMMUNE");
}
