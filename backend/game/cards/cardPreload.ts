import { CARDS } from "./cards";

/**
 * Frontend-facing preload payload.
 * - Display only
 * - No engine logic
 * - O(1) lookup friendly
 * - Backend is the single source of truth for ALL text
 */
export function buildCardPreload() {
  const cards: any[] = [];
  const buffs: any[] = [];

  for (const card of Object.values(CARDS)) {
    const cardPayload = {
      id: card.id,
      name: card.name,
      description: card.description,
      type: card.type,
      target: card.target,
      effects: card.effects ?? [],

      // ✅ FIX: include static GCD COST in preload
      gcdCost: card.gcdCost ?? 0,

      // Range data for client-side ability readiness check
      range:    (card as any).range,
      minRange: (card as any).minRange,
    };

    cards.push(cardPayload);

    if (Array.isArray(card.buffs)) {
      for (const buff of card.buffs) {
        buffs.push({
          buffId: buff.buffId,
          name: buff.name,
          category: buff.category,

          duration: buff.duration,
          breakOnPlay: buff.breakOnPlay ?? false,

          description: buff.description ?? "无",
          effects: buff.effects ?? [],

          // UI helpers
          sourceCardId: card.id,
          sourceCardName: card.name,
        });
      }
    }
  }

  const cardMap = Object.fromEntries(
    cards.map((c) => [c.id, c])
  );

  const buffMap = Object.fromEntries(
    buffs.map((b) => [b.buffId, b])
  );

  return {
    cards,
    cardMap,
    buffs,
    buffMap,
  };
}
