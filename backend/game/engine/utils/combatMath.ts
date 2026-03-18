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

  // DAMAGE MULTIPLIER (e.g. 女娲补天)
  const boost = allEffects(params.source).find((e) => e.type === "DAMAGE_MULTIPLIER");
  if (boost) dmg *= boost.value ?? 1;

  // DAMAGE REDUCTION (e.g. 风袖低昂)
  const dr = allEffects(params.target).find((e) => e.type === "DAMAGE_REDUCTION");
  if (dr) dmg *= 1 - (dr.value ?? 0);

  return Math.max(0, Math.floor(dmg));
}

export function resolveHealAmount(params: {
  target: { buffs: ActiveBuff[] };
  base: number;
}) {
  let heal = params.base;

  const hr = allEffects(params.target).find((e) => e.type === "HEAL_REDUCTION");
  if (hr) heal *= 1 - (hr.value ?? 0);

  return Math.max(0, Math.floor(heal));
}
