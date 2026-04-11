// engine/rules/dodge.ts
import { Ability } from "../state/types";
import { shouldDodge } from "./guards";

export function computeAbilityDodge(ability: Ability, target: any): boolean {
  if (ability.target !== "OPPONENT") return false;
  return shouldDodge(target);
}
