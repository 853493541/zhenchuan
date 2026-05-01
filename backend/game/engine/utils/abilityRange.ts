import type { ActiveBuff, Ability } from "../state/types";

export function getAbilityRangeBonusFromBuffs(buffs: ActiveBuff[] | undefined): number {
  return (buffs ?? []).reduce((sum, buff) => {
    const bonus = (buff.effects ?? []).reduce((effectSum, effect) => {
      if (effect.type !== "RANGE_BOOST") return effectSum;
      return effectSum + Math.max(0, Number((effect as any).value ?? 0));
    }, 0);
    return sum + bonus;
  }, 0);
}

export function getEffectiveAbilityRange(ability: Ability | null | undefined, buffs: ActiveBuff[] | undefined): number | undefined {
  if (typeof ability?.range !== "number") return ability?.range;
  return ability.range + getAbilityRangeBonusFromBuffs(buffs);
}