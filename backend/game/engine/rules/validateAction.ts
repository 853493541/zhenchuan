// backend/game/engine/rules/validateAction.ts

import { GameState } from "../state/types";
import { CARDS } from "../../cards/cards";
import { blocksCardTargeting } from "./guards";
import { calculateDistance } from "../state/types";

/* =========================================================
   INTERNAL HELPERS
========================================================= */

function hasEffect(player: { buffs: any[] }, type: string) {
  return player.buffs.some((b: any) =>
    b.effects.some((e: any) => e.type === type)
  );
}

/* =========================================================
   VALIDATE PLAY CARD (REAL-TIME BATTLE)
========================================================= */

/**
 * Validate ability cast in real-time battle
 * Checks: cooldown, range, silence
 */
export function validateCastAbility(
  state: GameState,
  playerIndex: number,
  cardInstanceId: string
) {
  if (state.gameOver) {
    throw new Error("ERR_GAME_OVER");
  }

  const player = state.players[playerIndex];

  const instance = player.hand.find((c) => c.instanceId === cardInstanceId);
  if (!instance) {
    throw new Error("ERR_CARD_NOT_IN_HAND");
  }

  console.log("[validateCastAbility] DEBUG - card instance:", {
    instanceId: instance.instanceId,
    cardId: instance.cardId,
    id: (instance as any).id,
    keys: Object.keys(instance).slice(0, 10),
  });

  // Card can be referenced by either .cardId or .id (depending on how it was populated)
  const cardId = instance.cardId || (instance as any).id;
  const card = CARDS[cardId];
  if (!card) {
    throw new Error("ERR_CARD_NOT_FOUND");
  }

  /* ================= COOLDOWN ================= */
  if (instance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= SILENCE ================= */
  if (hasEffect(player, "SILENCE")) {
    throw new Error("ERR_SILENCED");
  }

  /* ================= RANGE CHECK ================= */
  if (card.range !== undefined) {
    const distance = calculateDistance(
      state.players[playerIndex].position,
      state.players[playerIndex === 0 ? 1 : 0].position
    );

    if (distance > card.range) {
      throw new Error("ERR_OUT_OF_RANGE");
    }

    if (card.minRange !== undefined && distance < card.minRange) {
      throw new Error("ERR_TOO_CLOSE");
    }
  }

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */
  if (card.target === "OPPONENT") {
    const enemyIndex = playerIndex === 0 ? 1 : 0;
    const enemy = state.players[enemyIndex];

    if (blocksCardTargeting(enemy)) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
  }

  // ✅ All validations passed
}

/* =========================================================
   VALIDATE PLAY CARD (TURN-BASED - Legacy)
========================================================= */

export function validatePlayCard(
  state: GameState,
  playerIndex: number,
  cardInstanceId: string
) {
  if (state.gameOver) {
    throw new Error("ERR_GAME_OVER");
  }

  if (state.activePlayerIndex !== playerIndex) {
    throw new Error("ERR_NOT_YOUR_TURN");
  }

  const player = state.players[playerIndex];

  const instance = player.hand.find((c) => c.instanceId === cardInstanceId);
  if (!instance) {
    throw new Error("ERR_CARD_NOT_IN_HAND");
  }

  // Card can be referenced by either .cardId or .id (depending on how it was populated)
  const cardId = instance.cardId || (instance as any).id;
  const card = CARDS[cardId];
  if (!card) {
    throw new Error("ERR_CARD_NOT_FOUND");
  }

  /* ================= COOLDOWN ================= */

  if (instance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= GCD ================= */

  if (player.gcd < card.gcdCost) {
    throw new Error("ERR_NO_GCD");
  }

  /* ================= SILENCE ================= */

  if (hasEffect(player, "SILENCE")) {
    throw new Error("ERR_SILENCED");
  }

  /* ================= CONTROL / ATTACK_LOCK ================= */

  const isControlled =
    hasEffect(player, "CONTROL") || hasEffect(player, "ATTACK_LOCK");

  const allowsOverride =
    Array.isArray(card.effects) &&
    card.effects.some((e) => e.allowWhileControlled === true);

  if (isControlled && !allowsOverride) {
    throw new Error("ERR_CONTROLLED");
  }

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */

  // Only applies to opponent-targeted cards
  if (card.target === "OPPONENT") {
    const enemyIndex = playerIndex === 0 ? 1 : 0;
    const enemy = state.players[enemyIndex];

    if (blocksCardTargeting(enemy)) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
  }

  // ✅ All validations passed
}
