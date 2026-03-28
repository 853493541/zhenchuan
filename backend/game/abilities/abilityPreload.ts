import { ABILITIES } from "./abilities";

/**
 * Frontend-facing preload payload.
 * - Display only
 * - No engine logic
 * - O(1) lookup friendly
 * - Backend is the single source of truth for ALL text
 */
export function buildAbilityPreload() {
  const abilities: any[] = [];
  const buffs: any[] = [];

  for (const ability of Object.values(ABILITIES)) {
    const cardPayload = {
      id: ability.id,
      name: ability.name,
      description: ability.description,
      type: ability.type,
      gcd: !!(ability as any).gcd,
      target: ability.target,
      effects: ability.effects ?? [],

      // Range data for client-side ability readiness check
      range:    (ability as any).range,
      minRange: (ability as any).minRange,

      // Cooldown length for arc display
      cooldownTicks: (ability as any).cooldownTicks ?? 0,

      // Common movement abilities are always shown regardless of draft
      isCommon: !!(ability as any).isCommon,
    };

    abilities.push(cardPayload);

    if (Array.isArray(ability.buffs)) {
      for (const buff of ability.buffs) {
        buffs.push({
          buffId: buff.buffId,
          name: buff.name,
          category: buff.category,

          durationMs: buff.durationMs,
          breakOnPlay: buff.breakOnPlay ?? false,
          initialStacks: buff.initialStacks,

          description: buff.description ?? "无",
          effects: buff.effects ?? [],

          // UI helpers
          sourceAbilityId: ability.id,
          sourceAbilityName: ability.name,
        });
      }
    }
  }

  const abilityMap = Object.fromEntries(
    abilities.map((c) => [c.id, c])
  );

  const buffMap = Object.fromEntries(
    buffs.map((b) => [b.buffId, b])
  );

  return {
    abilities,
    abilityMap,
    buffs,
    buffMap,
  };
}
