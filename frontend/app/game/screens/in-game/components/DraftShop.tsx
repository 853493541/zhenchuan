/**
 * DraftShop - Displays 5 available ability cards in shop
 * Click card directly to buy and add to bench
 */

"use client";

import type { Shop, CardInstance } from "../types";
import { useState } from "react";
import styles from "./DraftShop.module.css";

type Props = {
  shop: Shop;
  cardMap: Record<string, any>;
  onSelectCard: (card: CardInstance, destination: "selected" | "bench") => Promise<void>;
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
      <h2>🛒 商店</h2>
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
              onClick={() => !loading && onSelectCard(card, "bench")}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className={styles.cardContent}>
                <div className={styles.cardName}>{cardDef.name}</div>
                <p className={styles.type}>{cardDef.type}</p>
                <p className={styles.description}>
                  {cardDef.description}
                </p>
              </div>

              {hoveredIndex === idx && (
                <div className={styles.cardOverlay}>
                  <div className={styles.buyHint}>点击购买</div>
                  <button
                    className={`${styles.lockBtn} ${
                      shop.locked[idx] ? styles.isLocked : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onLockCard(idx);
                    }}
                    disabled={loading}
                    title={shop.locked[idx] ? "已锁定" : "锁定"}
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
