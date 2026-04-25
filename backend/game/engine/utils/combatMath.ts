// backend/game/engine/utils/combatMath.ts

import { ActiveBuff } from "../state/types";

function allEffects(target: { buffs: ActiveBuff[] }) {
  return target.buffs.flatMap((b) => b.effects);
}

export function resolveScheduledDamage(params: {
  source: { buffs: ActiveBuff[] };
  target: { buffs: ActiveBuff[] };
  base: number;
  /** When provided, DAMAGE_MULTIPLIER effects with restrictToAbilityId are only applied if they match. */
  abilityId?: string;
  /** When provided, DAMAGE_REDUCTION effects with a damageType filter only apply if they match. */
  damageType?: string;
}) {
  let dmg = params.base;

  // DAMAGE MULTIPLIER (e.g. 女娲补天, 夺命蛊, 听雷·伤)
  // Stack additively by bonus portion per stack: value 1.1 with 3 stacks = +30%
  // If a buff effect has restrictToAbilityId set, it only applies when abilityId matches.
  let dmgMultiBonus = 0;
  for (const buff of params.source.buffs) {
    const dmEff = buff.effects.find((e) => e.type === "DAMAGE_MULTIPLIER");
    if (dmEff) {
      if ((dmEff as any).restrictToAbilityId && (dmEff as any).restrictToAbilityId !== params.abilityId) continue;
      dmgMultiBonus += ((dmEff.value ?? 1) - 1) * (buff.stacks ?? 1);
    }
  }
  if (dmgMultiBonus > 0) {
    dmg *= Math.max(0, 1 + dmgMultiBonus);
  }

  // DAMAGE REDUCTION (e.g. 惊鸿游龙)
  // If the effect has a damageType restriction, only apply when incoming damageType matches.
  const dr = allEffects(params.target).find((e) => {
    if (e.type !== "DAMAGE_REDUCTION") return false;
    if ((e as any).damageType) {
      return (e as any).damageType === params.damageType;
    }
    return true;
  });
  if (dr) dmg *= 1 - (dr.value ?? 0);

  // DAMAGE TAKEN INCREASE (e.g. 易伤)
  const takenInc = allEffects(params.target).find((e) => e.type === "DAMAGE_TAKEN_INCREASE");
  if (takenInc) dmg *= 1 + (takenInc.value ?? 0);

  // DAMAGE TAKEN FLAT (e.g. 破风 — fixed bonus added after multipliers)
  const flatBonusList = allEffects(params.target).filter((e) => e.type === "DAMAGE_TAKEN_FLAT");
  for (const fb of flatBonusList) {
    dmg += (fb.value ?? 0);
  }

  return Math.max(0, Math.floor(dmg));
}

export function resolveHealAmount(params: {
  target: { buffs: ActiveBuff[] };
  base: number;
}) {
  let heal = params.base;

  // Sum HEAL_REDUCTION across all buffs, multiplied by stack count for stackable debuffs.
  const totalHealReduction = params.target.buffs.reduce((sum, buff) => {
    const hr = buff.effects.find((e) => e.type === "HEAL_REDUCTION");
    if (!hr) return sum;
    const stacks = buff.stacks ?? 1;
    return sum + (hr.value ?? 0) * stacks;
  }, 0);
  if (totalHealReduction > 0) heal *= Math.max(0, 1 - totalHealReduction);

  return Math.max(0, Math.floor(heal));
}
