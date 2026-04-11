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

  // 百足/大狮子吼 buff application is handled via custom immediate AoE effect logic.
  if (
    ability.id === "baizu" ||
    Array.isArray(ability.effects) && ability.effects.some((e: any) => e.type === "AOE_APPLY_BUFFS")
  ) {
    return;
  }

  if (!Array.isArray(ability.buffs) || ability.buffs.length === 0) return;

  // Ability-level target (used as fallback when buff has no applyTo override)
  const abilityBuffTarget = ability.target === "SELF" ? source : target;
  const abilityEnemyApplied = abilityBuffTarget.userId !== source.userId;

  // Dodge cancels enemy-applied buffs only (ability-level check)
  if (shouldSkipDueToDodge(abilityDodged, abilityEnemyApplied)) return;

  // Untargetable blocks enemy-applied NEW buffs (ability-level check)
  if (blocksNewBuffByUntargetable(source, abilityBuffTarget)) return;

  for (const buff of ability.buffs) {
    // Per-buff applyTo override: a buff can specify "SELF" or "OPPONENT" regardless
    // of the ability's target field (e.g. 云飞玉皇 channels a self-buff while targeting an enemy)
    const localBuffTarget =
      buff.applyTo === "SELF" ? source
      : buff.applyTo === "OPPONENT" ? target
      : abilityBuffTarget;
    const localEnemyApplied = localBuffTarget.userId !== source.userId;

    const isControl =
      Array.isArray(buff.effects) &&
      buff.effects.some((e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK");

    // Control immunity blocks CONTROL buffs (guard needs target.buffs)
    if (isControl && blocksControlByImmunity("CONTROL", localBuffTarget)) {
      continue;
    }

    // Legacy behavior: apply buffs one-by-one
    const originalBuffs: Ability["buffs"] = ability.buffs;
    ability.buffs = [buff];

    handleApplyBuffs({
      state,
      ability,
      source,
      target: localBuffTarget,
      isEnemyEffect: localEnemyApplied,
    });

    ability.buffs = originalBuffs;
  }
}
