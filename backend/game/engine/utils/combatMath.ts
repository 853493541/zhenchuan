// backend/game/engine/utils/combatMath.ts

import { ActiveBuff } from "../state/types";

const BASE_CRIT_DAMAGE_MULTIPLIER = 1.75;

export type DamageRoll = {
  damage: number;
  isCrit: boolean;
};

function roundDamage(value: number): number {
  return Math.round(value * 100) / 100;
}

function getSourceCritChancePct(source: { critChancePct?: number } | undefined): number {
  const raw = Number(source?.critChancePct ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

export function resolveRawDamageWithCritRoll(params: {
  source?: { critChancePct?: number };
  base: number;
}): DamageRoll {
  const base = Math.max(0, Number(params.base ?? 0));
  if (base <= 0) return { damage: 0, isCrit: false };

  const critChancePct = getSourceCritChancePct(params.source);
  const isCrit = Math.random() < (critChancePct / 100);
  const critMultiplier = isCrit ? BASE_CRIT_DAMAGE_MULTIPLIER : 1;
  return {
    damage: roundDamage(base * critMultiplier),
    isCrit,
  };
}

export function resolveRawDamageWithCrit(params: {
  source?: { critChancePct?: number };
  base: number;
}) {
  return resolveRawDamageWithCritRoll(params).damage;
}

function allEffects(target: { buffs: ActiveBuff[] }) {
  return target.buffs.flatMap((b) => b.effects);
}

export function resolveScheduledDamageRoll(params: {
  source: { buffs: ActiveBuff[]; critChancePct?: number };
  target: { buffs: ActiveBuff[]; hp?: number; maxHp?: number };
  base: number;
  /** When provided, DAMAGE_MULTIPLIER effects with restrictToAbilityId are only applied if they match. */
  abilityId?: string;
  /** When provided, DAMAGE_REDUCTION effects with a damageType filter only apply if they match. */
  damageType?: string;
}): DamageRoll {
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

  // DAMAGE REDUCTION — apply all matching effects (typed or untyped).
  // A typed effect (e.g. damageType:"内功") only applies when params.damageType matches exactly.
  // An untyped effect applies to all damage.
  const matchingReductions = allEffects(params.target).filter((e) => {
    if (e.type !== "DAMAGE_REDUCTION") return false;
    if ((e as any).damageType) {
      return (e as any).damageType === params.damageType;
    }
    return true;
  });
  for (const dr of matchingReductions) {
    dmg *= 1 - (dr.value ?? 0);
  }

  // DAMAGE_REDUCTION_HP_SCALING (无相诀): dynamic DR based on target HP%
  const hpScalingDR = allEffects(params.target).find((e) => e.type === "DAMAGE_REDUCTION_HP_SCALING");
  if (hpScalingDR) {
    const hp = params.target.hp ?? 100;
    const maxHp = params.target.maxHp ?? 100;
    const hpPct = maxHp > 0 ? hp / maxHp : 1;
    const dynamicDR = hpPct > 0.75 ? 0.5 : hpPct > 0.5 ? 0.6 : hpPct > 0.25 ? 0.7 : 0.8;
    dmg *= 1 - dynamicDR;
  }

  // DAMAGE TAKEN INCREASE (e.g. 易伤): summed across all buffs, multiplied by stacks.
  const takenIncSum = params.target.buffs.reduce((sum, buff) => {
    const e = buff.effects.find((eff) => eff.type === "DAMAGE_TAKEN_INCREASE");
    if (!e) return sum;
    const stacks = buff.stacks ?? 1;
    return sum + (e.value ?? 0) * stacks;
  }, 0);
  if (takenIncSum > 0) dmg *= 1 + takenIncSum;

  // DAMAGE TAKEN FLAT (e.g. 破风 — fixed bonus added after multipliers)
  const flatBonusList = allEffects(params.target).filter((e) => e.type === "DAMAGE_TAKEN_FLAT");
  for (const fb of flatBonusList) {
    dmg += (fb.value ?? 0);
  }

  return resolveRawDamageWithCritRoll({ source: params.source, base: dmg });
}

export function resolveScheduledDamage(params: {
  source: { buffs: ActiveBuff[]; critChancePct?: number };
  target: { buffs: ActiveBuff[]; hp?: number; maxHp?: number };
  base: number;
  abilityId?: string;
  damageType?: string;
}) {
  return resolveScheduledDamageRoll(params).damage;
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
