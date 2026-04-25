// engine/rules/dodge.ts
import { Ability } from "../state/types";
import { shouldDodgeForAbility } from "./guards";

export function computeAbilityDodge(ability: Ability, target: any): boolean {
  if (ability.target !== "OPPONENT") return false;
  if (ability.ignoreDodge) return false;
  const damageType: string | undefined = (ability as any).damageType;
  return shouldDodgeForAbility(target, damageType);
}
