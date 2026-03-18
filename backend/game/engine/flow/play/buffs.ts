// engine/flow/applyCardBuffs.ts

import { GameState, Card, ActiveBuff } from "../../state/types";
import {
  shouldSkipDueToDodge,
  blocksNewBuffByUntargetable,
  blocksControlByImmunity,
} from "../../rules/guards";
import { handleApplyBuffs } from "../../effects/handlers";

/**
 * Apply persistent buffs defined on a card (card.buffs).
 *
 * IMPORTANT:
 * - card.buffs contains BuffDefinition[] (static definitions)
 * - ActiveBuffs exist on players (runtime) and are created ONLY by handlers
 *
 * Rules preserved:
 * - Dodge cancels enemy-applied buffs only
 * - Untargetable blocks enemy-applied NEW buffs
 * - Control immunity blocks CONTROL buffs only
 * - Buffs are applied one-by-one (legacy behavior)
 */
export function applyCardBuffs(params: {
  state: GameState;
  card: Card;
  source: { userId: string; buffs: ActiveBuff[] };
  target: { userId: string; buffs: ActiveBuff[] };
  cardDodged: boolean;
}) {
  const { state, card, source, target, cardDodged } = params;

  if (!Array.isArray(card.buffs) || card.buffs.length === 0) return;

  const buffTarget = card.target === "SELF" ? source : target;
  const enemyApplied = buffTarget.userId !== source.userId;

  // Dodge cancels enemy-applied buffs only
  if (shouldSkipDueToDodge(cardDodged, enemyApplied)) return;

  // Untargetable blocks enemy-applied NEW buffs (guard needs target.buffs)
  if (blocksNewBuffByUntargetable(source, buffTarget)) return;

  for (const buff of card.buffs) {
    const isControl =
      Array.isArray(buff.effects) &&
      buff.effects.some((e) => e.type === "CONTROL");

    // Control immunity blocks CONTROL buffs (guard needs target.buffs)
    if (isControl && blocksControlByImmunity("CONTROL", buffTarget)) {
      continue;
    }

    // Legacy behavior: apply buffs one-by-one
    const originalBuffs: Card["buffs"] = card.buffs;
    card.buffs = [buff];

    handleApplyBuffs({
      state,
      card,
      source,
      target: buffTarget,
      isEnemyEffect: enemyApplied,
    });

    card.buffs = originalBuffs;
  }
}
