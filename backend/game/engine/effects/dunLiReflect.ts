// backend/game/engine/effects/dunLiReflect.ts
//
// 盾立 (Dun Li) reflect — central helper used by every damage / knockback path.
//
// A 盾立 holder:
//   1. Has DAMAGE_IMMUNE (incoming damage is blocked).
//   2. Has DUN_LI_REFLECT — any damage / knockback that would have hit them is
//      instead redirected at the original caster.
//   3. The whitelist (ability.dunLiWhitelisted === true) skips reflection but
//      keeps the damage immunity.

export const DUN_LI_REFLECT_EFFECT_TYPE = "DUN_LI_REFLECT";

export function hasDunLiReflectFlag(target: any): boolean {
  if (!target || !Array.isArray(target.buffs)) return false;
  const now = Date.now();
  return target.buffs.some(
    (b: any) =>
      (b?.expiresAt ?? 0) > now &&
      Array.isArray(b?.effects) &&
      b.effects.some((e: any) => e?.type === DUN_LI_REFLECT_EFFECT_TYPE),
  );
}

export function isAbilityDunLiWhitelisted(ability: any): boolean {
  return !!(ability && (ability as any).dunLiWhitelisted === true);
}

/**
 * If the victim has 盾立 reflect and the ability is not whitelisted, return the
 * source player (who should receive the damage / knockback instead).
 * Otherwise return null.
 *
 * Skips if the source player itself has DUN_LI_REFLECT (avoid ping-pong).
 */
export function getDunLiReflectVictim(
  state: any,
  sourceUserId: string | undefined,
  victim: any,
  ability: any,
): any | null {
  if (!sourceUserId || !victim) return null;
  if (!victim.userId || victim.userId === sourceUserId) return null;
  if (isAbilityDunLiWhitelisted(ability)) return null;
  if (!hasDunLiReflectFlag(victim)) return null;
  const reflected = state?.players?.find((p: any) => p.userId === sourceUserId);
  if (!reflected) return null;
  // Avoid infinite ping-pong if the original caster also has reflect.
  if (hasDunLiReflectFlag(reflected)) return null;
  return reflected;
}
