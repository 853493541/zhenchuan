/**
 * DraftShop - Displays 5 available ability cards in shop
 */

"use client";

import type { Shop, CardInstance } from "../types";
import { useState } from "react";
import styles from "./DraftShop.module.css";

type Props = {
  shop: Shop;
  cardMap: Record<string, any>;
  onSelectCard: (card: CardInstance) => Promise<void>;
  onLockCard: (index: number) => Promise<void>;
  loading: boolean;
};

export default function DraftShop({
  shop,
  cardMap,
  onSelectCard,
  onLockCard,
  loading,
}: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className={styles.shop}>
      <h2>Shop</h2>
      <div className={styles.cards}>
        {shop.cards.map((card, idx) => {
          const cardDef = cardMap[card.cardId];
          if (!cardDef) return null;

          return (
            <div
              key={card.instanceId}
              className={`${styles.card} ${
                shop.locked[idx] ? styles.locked : ""
              }`}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className={styles.cardContent}>
                <h3>{cardDef.name}</h3>
                <p className={styles.type}>{cardDef.type}</p>
                <p className={styles.description}>
                  {cardDef.description}
                </p>
              </div>

              {hoveredIndex === idx && (
                <div className={styles.actions}>
                  <button
                    className={styles.selectBtn}
                    onClick={() => onSelectCard(card)}
                    disabled={loading}
                  >
                    Select
                  </button>
                  <button
                    className={`${styles.lockBtn} ${
                      shop.locked[idx] ? styles.isLocked : ""
                    }`}
                    onClick={() => onLockCard(idx)}
                    disabled={loading}
                    title={shop.locked[idx] ? "Locked" : "Lock"}
                  >
                    {shop.locked[idx] ? "🔒" : "🔓"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
