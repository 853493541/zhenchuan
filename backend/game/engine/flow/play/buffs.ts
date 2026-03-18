// engine/flow/applyAbilityBuffs.ts

import { GameState, Ability, ActiveBuff } from "../../state/types";
import {
  shouldSkipDueToDodge,
  blocksNewBuffByUntargetable,
  blocksControlByImmunity,
} from "../../rules/guards";
import { handleApplyBuffs } from "../../effects/handlers";

/**
 * Apply persistent buffs defined on a ability (ability.buffs).
 *
 * IMPORTANT:
 * - ability.buffs contains BuffDefinition[] (static definitions)
 * - ActiveBuffs exist on players (runtime) and are created ONLY by handlers
 *
 * Rules preserved:
 * - Dodge cancels enemy-applied buffs only
 * - Untargetable blocks enemy-applied NEW buffs
 * - Control immunity blocks CONTROL buffs only
 * - Buffs are applied one-by-one (legacy behavior)
 */
export function applyAbilityBuffs(params: {
  state: GameState;
  ability: Ability;
  source: { userId: string; buffs: ActiveBuff[] };
  target: { userId: string; buffs: ActiveBuff[] };
  abilityDodged: boolean;
}) {
  const { state, ability, source, target, abilityDodged } = params;

  if (!Array.isArray(ability.buffs) || ability.buffs.length === 0) return;

  const buffTarget = ability.target === "SELF" ? source : target;
  const enemyApplied = buffTarget.userId !== source.userId;

  // Dodge cancels enemy-applied buffs only
  if (shouldSkipDueToDodge(abilityDodged, enemyApplied)) return;

  // Untargetable blocks enemy-applied NEW buffs (guard needs target.buffs)
  if (blocksNewBuffByUntargetable(source, buffTarget)) return;

  for (const buff of ability.buffs) {
    const isControl =
      Array.isArray(buff.effects) &&
      buff.effects.some((e) => e.type === "CONTROL");

    // Control immunity blocks CONTROL buffs (guard needs target.buffs)
    if (isControl && blocksControlByImmunity("CONTROL", buffTarget)) {
      continue;
    }

    // Legacy behavior: apply buffs one-by-one
    const originalBuffs: Ability["buffs"] = ability.buffs;
    ability.buffs = [buff];

    handleApplyBuffs({
      state,
      ability,
      source,
      target: buffTarget,
      isEnemyEffect: enemyApplied,
    });

    ability.buffs = originalBuffs;
  }
}
