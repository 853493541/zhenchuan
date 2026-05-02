export function getSpecialAbilityBarIds(player: { buffs?: any[] }, now: number = Date.now()): string[] {
  const ids: string[] = [];
  for (const buff of player.buffs ?? []) {
    if (!buff || (buff.expiresAt ?? 0) <= now) continue;
    for (const effect of buff.effects ?? []) {
      if (effect?.type !== "SPECIAL_ABILITY_BAR" || !Array.isArray(effect.abilityIds)) continue;
      for (const abilityId of effect.abilityIds) {
        if (typeof abilityId === "string" && abilityId && !ids.includes(abilityId)) {
          ids.push(abilityId);
        }
      }
    }
  }
  return ids;
}

export function isSpecialAbilityBarAbility(player: { buffs?: any[] }, abilityId: string, now: number = Date.now()): boolean {
  return getSpecialAbilityBarIds(player, now).includes(abilityId);
}

export function getOrCreateSpecialAbilityState(
  player: { specialAbilityStates?: Record<string, any> },
  abilityId: string,
) {
  const states = ((player as any).specialAbilityStates ??= {});
  const existing = states[abilityId];
  if (existing && typeof existing === "object") {
    return existing;
  }

  const created = { instanceId: abilityId, abilityId, cooldown: 0 };
  states[abilityId] = created;
  return created;
}
