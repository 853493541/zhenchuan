// backend/game/engine/utils/combatMath.ts

import { ActiveBuff, STARTING_ATTACK_DAMAGE } from "../state/types";
import { getActiveRuntimeBuffs } from "../rules/guards";

const BASE_CRIT_DAMAGE_MULTIPLIER = 1.75;
const FLAT_HEAL_SCALE = 10_000;

export type DamageRoll = {
  damage: number;
  isCrit: boolean;
  fullyReducedByDamageReduction?: boolean;
};

type TargetSideDamageResult = {
  damage: number;
  fullyReducedByDamageReduction: boolean;
};

type DamageTarget = { buffs: ActiveBuff[]; hp?: number; maxHp?: number; defensePct?: number; huajinPct?: number };
type DamageSource = {
  buffs: ActiveBuff[];
  critChancePct?: number;
  waiGongCritChancePct?: number;
  neiGongCritChancePct?: number;
  attackDamage?: number;
};

export type HealRoll = {
  heal: number;
  isCrit: boolean;
};

function roundDamage(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getAttackDamage(source: { attackDamage?: number; buffs?: ActiveBuff[] } | undefined): number {
  const raw = Number(source?.attackDamage ?? STARTING_ATTACK_DAMAGE);
  const baseAttackDamage = Number.isFinite(raw) && raw > 0 ? raw : STARTING_ATTACK_DAMAGE;
  let attackDamageBonus = 0;
  for (const buff of getActiveRuntimeBuffs({ buffs: source?.buffs ?? [] })) {
    const stacks = Math.max(1, Number(buff.stacks ?? 1));
    for (const effect of buff.effects ?? []) {
      if (effect.type !== "ATTACK_DAMAGE_MULTIPLIER") continue;
      const value = Number(effect.value ?? 1);
      if (!Number.isFinite(value)) continue;
      attackDamageBonus += (value - 1) * stacks;
    }
  }
  return Math.max(0, baseAttackDamage * Math.max(0, 1 + attackDamageBonus));
}

export function resolveAttackDamageBase(source: { attackDamage?: number; buffs?: ActiveBuff[] } | undefined, multiplier: number): number {
  const rawMultiplier = Number(multiplier ?? 0);
  if (!Number.isFinite(rawMultiplier) || rawMultiplier <= 0) return 0;
  return rawMultiplier * getAttackDamage(source);
}

function getCritBonusPctFromBuffs(
  source:
    | {
        buffs?: ActiveBuff[];
      }
    | undefined,
  damageType?: string,
): number {
  let total = 0;
  const buffs = getActiveRuntimeBuffs({ buffs: source?.buffs ?? [] });
  for (const buff of buffs) {
    const stacks = Math.max(1, Number(buff.stacks ?? 1));
    for (const eff of buff.effects ?? []) {
      if (eff.type !== "CRIT_CHANCE_BONUS") continue;
      const effDamageType = (eff as any).damageType as string | undefined;
      if (effDamageType && effDamageType !== damageType) continue;
      total += Number(eff.value ?? 0) * stacks;
    }
  }
  if (!Number.isFinite(total)) return 0;
  return total;
}

function getCritEffectBonusFromBuffs(
  source:
    | {
        buffs?: ActiveBuff[];
      }
    | undefined,
  damageType?: string,
): number {
  let total = 0;
  const buffs = getActiveRuntimeBuffs({ buffs: source?.buffs ?? [] });
  for (const buff of buffs) {
    const stacks = Math.max(1, Number(buff.stacks ?? 1));
    for (const eff of buff.effects ?? []) {
      if (eff.type !== "CRIT_EFFECT_BONUS") continue;
      const effDamageType = (eff as any).damageType as string | undefined;
      if (effDamageType && effDamageType !== damageType) continue;
      total += Number(eff.value ?? 0) * stacks;
    }
  }
  if (!Number.isFinite(total)) return 0;
  return total;
}

function getSourceCritChancePct(
  source:
    | {
        critChancePct?: number;
        waiGongCritChancePct?: number;
        neiGongCritChancePct?: number;
        buffs?: ActiveBuff[];
      }
    | undefined,
  damageType?: string,
): number {
  let raw = Number(source?.critChancePct ?? 0);
  if (damageType === "外功") {
    raw = Number(source?.waiGongCritChancePct ?? source?.critChancePct ?? 0);
  } else if (damageType === "内功") {
    raw = Number(source?.neiGongCritChancePct ?? source?.critChancePct ?? 0);
  }
  raw += getCritBonusPctFromBuffs(source, damageType);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

function getSourceCritDamageMultiplier(
  source:
    | {
        buffs?: ActiveBuff[];
      }
    | undefined,
  damageType?: string,
): number {
  const raw = BASE_CRIT_DAMAGE_MULTIPLIER + getCritEffectBonusFromBuffs(source, damageType);
  if (!Number.isFinite(raw)) return BASE_CRIT_DAMAGE_MULTIPLIER;
  return Math.max(0, raw);
}

export function resolveRawDamageWithCritRoll(params: {
  source?: {
    critChancePct?: number;
    waiGongCritChancePct?: number;
    neiGongCritChancePct?: number;
    buffs?: ActiveBuff[];
  };
  base: number;
  damageType?: string;
}): DamageRoll {
  const base = Math.max(0, Number(params.base ?? 0));
  if (base <= 0) return { damage: 0, isCrit: false };

  const critChancePct = getSourceCritChancePct(params.source, params.damageType);
  const isCrit = Math.random() < (critChancePct / 100);
  const critMultiplier = isCrit ? getSourceCritDamageMultiplier(params.source, params.damageType) : 1;
  return {
    damage: roundDamage(base * critMultiplier),
    isCrit,
  };
}

export function resolveRawDamageWithCrit(params: {
  source?: {
    critChancePct?: number;
    waiGongCritChancePct?: number;
    neiGongCritChancePct?: number;
    buffs?: ActiveBuff[];
  };
  base: number;
  damageType?: string;
}) {
  return resolveRawDamageWithCritRoll(params).damage;
}

function allEffects(target: { buffs: ActiveBuff[] }) {
  return getActiveRuntimeBuffs(target).flatMap((b) => b.effects);
}

function getTargetDefensePct(target: DamageTarget): number {
  const baseDefense = Number(target.defensePct ?? 0);
  if (!Number.isFinite(baseDefense) || baseDefense <= 0) return 0;

  let multiplier = 1;
  for (const buff of getActiveRuntimeBuffs({ buffs: target.buffs ?? [] })) {
    const stacks = Math.max(1, Number(buff.stacks ?? 1));
    for (const effect of buff.effects ?? []) {
      if (effect.type !== "DEFENSE_MULTIPLIER") continue;
      const value = Number(effect.value ?? (effect as any).defenseMultiplier ?? 1);
      if (!Number.isFinite(value)) continue;
      multiplier *= Math.pow(Math.max(0, value), stacks);
    }
  }

  return Math.max(0, Math.min(100, baseDefense * multiplier));
}

function getTargetHuajinPct(target: DamageTarget): number {
  const raw = Number(target.huajinPct ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.min(100, raw));
}

function applyHuajin(damage: number, target: DamageTarget): number {
  const huajinPct = getTargetHuajinPct(target);
  if (huajinPct <= 0 || damage <= 0) return damage;
  return roundDamage(damage * Math.max(0, 1 - huajinPct / 100));
}

function applyTargetSideDamageModifiers(params: {
  target: DamageTarget;
  base: number;
  damageType?: string;
}): TargetSideDamageResult {
  let dmg = params.base;

  const defensePct = getTargetDefensePct(params.target);
  if (defensePct > 0) {
    dmg *= Math.max(0, 1 - defensePct / 100);
  }

  const takenIncSum = getActiveRuntimeBuffs(params.target).reduce((sum, buff) => {
    const e = buff.effects.find((eff) => eff.type === "DAMAGE_TAKEN_INCREASE");
    if (!e) return sum;
    const stacks = buff.stacks ?? 1;
    return sum + (e.value ?? 0) * stacks;
  }, 0);
  if (takenIncSum > 0) dmg *= 1 + takenIncSum;

  const flatBonusList = allEffects(params.target).filter((e) => e.type === "DAMAGE_TAKEN_FLAT");
  for (const fb of flatBonusList) {
    dmg += (fb.value ?? 0);
  }

  const totalDamageReduction = allEffects(params.target).reduce((sum, effect) => {
    if (effect.type !== "DAMAGE_REDUCTION") return sum;
    if ((effect as any).damageType && (effect as any).damageType !== params.damageType) {
      return sum;
    }
    const value = Number(effect.value ?? 0);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  if (totalDamageReduction > 0) {
    dmg *= Math.max(0, 1 - totalDamageReduction);
  }

  return {
    damage: roundDamage(Math.max(0, dmg)),
    fullyReducedByDamageReduction: params.base > 0 && totalDamageReduction >= 1,
  };
}

export function resolveRedirectedDamageToTarget(params: {
  target: DamageTarget;
  base: number;
  damageType?: string;
}) {
  return applyHuajin(applyTargetSideDamageModifiers(params).damage, params.target);
}

export function resolveScheduledDamageRoll(params: {
  source: DamageSource;
  target: DamageTarget;
  base: number;
  /** When provided, DAMAGE_MULTIPLIER effects with restrictToAbilityId are only applied if they match. */
  abilityId?: string;
  /** When provided, DAMAGE_REDUCTION effects with a damageType filter only apply if they match. */
  damageType?: string;
}): DamageRoll {
  let dmg = resolveAttackDamageBase(params.source, params.base);

  // DAMAGE MULTIPLIER (e.g. 女娲补天, 夺命蛊, 听雷·伤)
  // Stack additively by bonus portion per stack: value 1.1 with 3 stacks = +30%
  // If a buff effect has restrictToAbilityId set, it only applies when abilityId matches.
  let dmgMultiBonus = 0;
  for (const buff of getActiveRuntimeBuffs(params.source)) {
    const dmEff = buff.effects.find((e) => e.type === "DAMAGE_MULTIPLIER");
    if (dmEff) {
      if ((dmEff as any).restrictToAbilityId && (dmEff as any).restrictToAbilityId !== params.abilityId) continue;
      dmgMultiBonus += ((dmEff.value ?? 1) - 1) * (buff.stacks ?? 1);
    }
  }
  if (dmgMultiBonus > 0) {
    dmg *= Math.max(0, 1 + dmgMultiBonus);
  }

  const targetSideDamage = applyTargetSideDamageModifiers({
    target: params.target,
    base: dmg,
    damageType: params.damageType,
  });

  const damageRoll = resolveRawDamageWithCritRoll({
    source: params.source,
    base: targetSideDamage.damage,
    damageType: params.damageType,
  });

  return {
    ...damageRoll,
    damage: applyHuajin(damageRoll.damage, params.target),
    fullyReducedByDamageReduction: targetSideDamage.fullyReducedByDamageReduction,
  };
}

export function resolveScheduledDamage(params: {
  source: DamageSource;
  target: DamageTarget;
  base: number;
  abilityId?: string;
  damageType?: string;
}) {
  return resolveScheduledDamageRoll(params).damage;
}

export function resolveHealAmount(params: {
  source?: {
    critChancePct?: number;
    waiGongCritChancePct?: number;
    neiGongCritChancePct?: number;
    buffs?: ActiveBuff[];
  };
  target: { buffs: ActiveBuff[] };
  base: number;
  scaleFlatHeal?: boolean;
}) {
  return resolveHealAmountRoll(params).heal;
}

export function resolveNonCritHealAmountRoll(params: {
  source?: {
    critChancePct?: number;
    waiGongCritChancePct?: number;
    neiGongCritChancePct?: number;
    buffs?: ActiveBuff[];
  };
  target: { buffs: ActiveBuff[] };
  base: number;
  scaleFlatHeal?: boolean;
}): HealRoll {
  let heal = Math.max(0, Number(params.base ?? 0));
  if (params.scaleFlatHeal !== false) {
    heal *= FLAT_HEAL_SCALE;
  }

  // Sum HEAL_REDUCTION across all buffs, multiplied by stack count for stackable debuffs.
  const totalHealReduction = getActiveRuntimeBuffs(params.target).reduce((sum, buff) => {
    const hr = buff.effects.find((e) => e.type === "HEAL_REDUCTION");
    if (!hr) return sum;
    const stacks = buff.stacks ?? 1;
    return sum + (hr.value ?? 0) * stacks;
  }, 0);
  if (totalHealReduction > 0) heal *= Math.max(0, 1 - totalHealReduction);

  return {
    heal: Math.max(0, Math.floor(heal)),
    isCrit: false,
  };
}

export function resolveHealAmountRoll(params: {
  source?: {
    critChancePct?: number;
    waiGongCritChancePct?: number;
    neiGongCritChancePct?: number;
    buffs?: ActiveBuff[];
  };
  target: { buffs: ActiveBuff[] };
  base: number;
  scaleFlatHeal?: boolean;
}): HealRoll {
  const baseHeal = resolveNonCritHealAmountRoll(params).heal;
  if (baseHeal <= 0) {
    return { heal: 0, isCrit: false };
  }

  const critChancePct = getSourceCritChancePct(params.source, "内功");
  const isCrit = Math.random() < (critChancePct / 100);
  const critMultiplier = isCrit ? getSourceCritDamageMultiplier(params.source, "内功") : 1;

  return {
    heal: Math.max(0, Math.floor(baseHeal * critMultiplier)),
    isCrit,
  };
}
