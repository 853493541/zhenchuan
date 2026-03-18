/**
 * Determines whether a ability is playable in current UI state.
 * UI-agnostic on purpose.
 */
export function isAbilityPlayable(params: {
  ability: { gcdCost?: number; name?: string; id?: string } | undefined;
  remainingGcd: number | undefined;
}): boolean {
  const { ability, remainingGcd } = params;

  console.groupCollapsed("[isAbilityPlayable]");

  console.log("ability =", ability);
  console.log("remainingGcd =", remainingGcd);

  if (!ability) {
    console.warn("❌ ability is undefined → NOT playable");
    console.groupEnd();
    return false;
  }

  if (remainingGcd === undefined) {
    console.warn("❌ remainingGcd is undefined → NOT playable");
    console.groupEnd();
    return false;
  }

  const cost = ability.gcdCost;

  console.log("ability.gcdCost =", cost);

  if (cost === undefined) {
    console.warn("❌ ability.gcdCost is undefined → NOT playable");
    console.groupEnd();
    return false;
  }

  const playable = remainingGcd >= cost;

  console.log(
    `GCD check: remainingGcd (${remainingGcd}) >= cost (${cost}) →`,
    playable ? "✅ PLAYABLE" : "❌ NOT playable"
  );

  console.groupEnd();
  return playable;
}
