// backend/game/engine/utils/combatMath.ts

import { ActiveBuff } from "../state/types";

function allEffects(target: { buffs: ActiveBuff[] }) {
  return target.buffs.flatMap((b) => b.effects);
}

export function resolveScheduledDamage(params: {
  source: { buffs: ActiveBuff[] };
  target: { buffs: ActiveBuff[] };
  base: number;
}) {
  let dmg = params.base;

  // DAMAGE MULTIPLIER (e.g. 女娲补天, 夺命蛊)
  // Stack additively by bonus portion: 2.0 and 1.3 => 1 + (1.0 + 0.3) = 2.3
  const multipliers = allEffects(params.source)
    .filter((e) => e.type === "DAMAGE_MULTIPLIER")
    .map((e) => e.value ?? 1);
  if (multipliers.length > 0) {
    const additiveMultiplier = 1 + multipliers.reduce((sum, value) => sum + (value - 1), 0);
    dmg *= Math.max(0, additiveMultiplier);
  }

  // DAMAGE REDUCTION (e.g. 风袖低昂)
  const dr = allEffects(params.target).find((e) => e.type === "DAMAGE_REDUCTION");
  if (dr) dmg *= 1 - (dr.value ?? 0);

  // DAMAGE TAKEN INCREASE (e.g. 易伤)
  const takenInc = allEffects(params.target).find((e) => e.type === "DAMAGE_TAKEN_INCREASE");
  if (takenInc) dmg *= 1 + (takenInc.value ?? 0);

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
