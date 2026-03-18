/**
 * Determines whether a card is playable in current UI state.
 * UI-agnostic on purpose.
 */
export function isCardPlayable(params: {
  card: { gcdCost?: number; name?: string; id?: string } | undefined;
  remainingGcd: number | undefined;
}): boolean {
  const { card, remainingGcd } = params;

  console.groupCollapsed("[isCardPlayable]");

  console.log("card =", card);
  console.log("remainingGcd =", remainingGcd);

  if (!card) {
    console.warn("❌ card is undefined → NOT playable");
    console.groupEnd();
    return false;
  }

  if (remainingGcd === undefined) {
    console.warn("❌ remainingGcd is undefined → NOT playable");
    console.groupEnd();
    return false;
  }

  const cost = card.gcdCost;

  console.log("card.gcdCost =", cost);

  if (cost === undefined) {
    console.warn("❌ card.gcdCost is undefined → NOT playable");
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
