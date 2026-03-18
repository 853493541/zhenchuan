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
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (cardId: string) => {
    setFailedImages(prev => new Set([...prev, cardId]));
  };

  return (
    <div className={styles.shop}>
      <h2 className={styles.title}>🛒 商店</h2>
      <div className={styles.grid}>
        {shop.cards.map((card, idx) => {
          const cardDef = cardMap[card.cardId];
          if (!cardDef) return null;

          return (
            <div
              key={card.instanceId}
              className={styles.card}
              onClick={() => !loading && onSelectCard(card, "bench")}
            >
              {!failedImages.has(card.cardId) ? (
                <img 
                  src={`/game/icons/Skills/${cardDef.name}.png`} 
                  alt={cardDef.name} 
                  className={styles.portrait}
                  onError={() => handleImageError(card.cardId)}
                />
              ) : (
                <div className={styles.portrait}>
                  <div className={styles.portraitInner}>{cardDef.name.charAt(0)}</div>
                </div>
              )}
              <div className={styles.cardInfo}>
                <h3 className={styles.cardName}>{cardDef.name}</h3>
                <p className={styles.description}>
                  {cardDef.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
