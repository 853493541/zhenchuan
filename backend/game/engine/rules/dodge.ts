// engine/rules/dodge.ts
import { Card } from "../state/types";
import { shouldDodge } from "./guards";

export function computeCardDodge(card: Card, target: any): boolean {
  if (card.target !== "OPPONENT") return false;
  return shouldDodge(target);
}
