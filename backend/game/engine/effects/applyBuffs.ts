// backend/game/engine/effects/handlers/handleApplyBuffs.ts

import { GameState, Card, ActiveBuff } from "../state/types";
import { blocksEnemyTargeting } from "../rules/guards";
import { addBuff } from "./buffRuntime";

/**
 * APPLY CARD-DEFINED BUFFS
 *
 * IMPORTANT ENGINE CONTRACT:
 * - guards.ts requires targets to have { buffs: ActiveBuff[] }
 * - system.addBuff mutates an ActiveBuff onto buffTarget
 *
 * Therefore:
 * - source / target / actualTarget MUST include buffs
 * - NO partial objects (no { userId } only)
 */
export function handleApplyBuffs(params: {
  state: GameState;
  card: Card;
  source: { userId: string; buffs: ActiveBuff[] };
  target: { userId: string; buffs: ActiveBuff[] };
  isEnemyEffect: boolean;
}) {
  const { state, card, source, target, isEnemyEffect } = params;

  if (!Array.isArray(card.buffs) || card.buffs.length === 0) return;

  for (const buff of card.buffs) {
    let actualTarget: { userId: string; buffs: ActiveBuff[] };

    // Explicit buff-level targeting wins
    if (buff.applyTo === "SELF") {
      actualTarget = source;
    } else if (buff.applyTo === "OPPONENT") {
      actualTarget = target;
    } else {
      // Backward-compatible default
      actualTarget = card.target === "SELF" ? source : target;
    }

    // Enemy buffs can be blocked by avoidance rules
    if (
      actualTarget === target &&
      isEnemyEffect &&
      blocksEnemyTargeting(actualTarget)
    ) {
      continue;
    }

    addBuff({
      state,
      sourceUserId: source.userId,
      targetUserId: actualTarget.userId,
      card,
      buffTarget: actualTarget,
      buff,
    });
  }
}
