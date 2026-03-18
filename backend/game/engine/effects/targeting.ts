

import { GameState, TargetType } from "../state/types";

export function getEnemy(state: GameState, playerIndex: number) {
  return state.players[playerIndex === 0 ? 1 : 0];
}

export function resolveEffectTargetIndex(
  cardTargetIndex: number,
  playerIndex: number,
  applyTo: TargetType | undefined
) {
  if (!applyTo) return cardTargetIndex;
  return applyTo === "SELF" ? playerIndex : playerIndex === 0 ? 1 : 0;
}

export function hasUntargetable(p: { buffs: any[] }) {
  return p.buffs && p.buffs.some((b) => b.effects?.some((e: any) => e.type === "UNTARGETABLE"));
}
