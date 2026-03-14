/**
 * Economy service - handles shop generation, gold management, interest, etc.
 * TFT-based economic system
 */

import { CARDS } from "../../cards/cards";
import {
  LEVEL_UP_COSTS,
  RARITY_POOLS,
  GOLD_PER_ROUND,
} from "../../engine/state/types";
import { CardInstance } from "../../engine/state/types";
import { randomUUID } from "crypto";

/**
 * Calculate interest income based on unspent gold
 * TFT Rule: 1 gold per 10 unspent, capped at 5
 */
export function calculateInterest(gold: number): number {
  const interest = Math.floor(gold / 10);
  return Math.min(interest, 5);
}

/**
 * Get rarity distribution for a shop level
 * Returns an array of 6 random card rarities
 */
function getRandomRarities(level: number): number[] {
  const distribution = RARITY_POOLS[level] || RARITY_POOLS[10];
  const pool: number[] = [];

  // Build a pool of rarities based on percentages
  for (const [rarity, percentage] of Object.entries(distribution)) {
    const count = Math.round(6 * percentage);
    for (let i = 0; i < count; i++) {
      pool.push(parseInt(rarity));
    }
  }

  // Ensure exactly 6 rarities
  while (pool.length < 6) {
    const rarity = parseInt(
      Object.keys(distribution).sort(
        (a, b) => distribution[parseInt(b)] - distribution[parseInt(a)]
      )[0]
    );
    pool.push(rarity);
  }
  pool.length = 6;

  // Shuffle
  return pool.sort(() => Math.random() - 0.5);
}

/**
 * Get all cards at a specific rarity level
 * Cards without a rarity field default to rarity 1
 */
function getCardsByRarity(rarity: number): string[] {
  return Object.values(CARDS)
    .filter((card: any) => (card.rarity ?? 1) === rarity && !card.isCommon)
    .map((card: any) => card.id);
}

/**
 * Generate a shop for a player at a given level
 * Creates 6 random ability cards
 */
export function generateShop(level: number): CardInstance[] {
  const rarities = getRandomRarities(level);
  const shop: CardInstance[] = [];

  for (const rarity of rarities) {
    const cards = getCardsByRarity(rarity);
    if (cards.length === 0) {
      // Fallback to rarity 1 if no cards at this rarity
      const fallbackCards = getCardsByRarity(1);
      const randomCardId =
        fallbackCards[Math.floor(Math.random() * fallbackCards.length)];
      shop.push({ instanceId: randomUUID(), cardId: randomCardId, cooldown: 0 });
    } else {
      const randomCardId = cards[Math.floor(Math.random() * cards.length)];
      shop.push({ instanceId: randomUUID(), cardId: randomCardId, cooldown: 0 });
    }
  }

  return shop;
}

/**
 * Get cost to level up from current level
 */
export function getLevelUpCost(currentLevel: number): number {
  return LEVEL_UP_COSTS[currentLevel + 1] ?? 10;
}

/**
 * Calculate gold income for a round
 * Base 5 + interest on unspent gold
 */
export function getIncomePerRound(unspentGold: number): number {
  return GOLD_PER_ROUND + calculateInterest(unspentGold);
}

/**
 * Validate shop refresh cost
 * TFT: 1 gold per refresh
 */
export const REFRESH_COST = 1;
