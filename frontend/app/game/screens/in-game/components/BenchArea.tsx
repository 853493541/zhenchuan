/**
 * BenchArea - Shows 8 benched abilities that persist across battles
 * Can move to selected, sell for gold, or hover to see stats
 */

"use client";

import type { CardInstance } from "../types";
import { useState } from "react";
import styles from "./BenchArea.module.css";

type Props = {
  bench: CardInstance[];
  cardMap: Record<string, any>;
  onMoveToSelected: (cardInstanceId: string) => Promise<void>;
  onSell: (cardInstanceId: string) => Promise<void>;
  loading: boolean;
  fullSlots?: number; // How many slots currently used (for UI feedback)
};

export default function BenchArea({
  bench,
  cardMap,
  onMoveToSelected,
  onSell,
  loading,
  fullSlots = 0,
}: Props) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (cardId: string) => {
    setFailedImages(prev => new Set([...prev, cardId]));
  };
  const benchSlots = Array.from({ length: 8 }, (_, i) => {
    const card = bench[i];
    return { index: i, card };
  });

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>备战区 {fullSlots}/8</h3>
      <div className={styles.grid}>
        {benchSlots.map(({ index, card }) => {
          if (!card) {
            return (
              <div key={index} className={`${styles.card} ${styles.empty}`}>
                <div className={styles.emptySlot}>{index + 1}</div>
              </div>
            );
          }

          const cardDef = cardMap[card.cardId];

          return (
            <div
              key={card.instanceId}
              className={styles.card}
              onClick={() => onMoveToSelected(card.instanceId)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSell(card.instanceId);
              }}
              style={{ cursor: "pointer" }}
              title="左键移到选择栏 或右键出售"
            >
              {!failedImages.has(card.cardId) ? (
                <img 
                  src={`/game/icons/Skills/${cardDef?.name}.png`} 
                  alt={cardDef?.name} 
                  className={styles.portrait}
                  onError={() => handleImageError(card.cardId)}
                />
              ) : (
                <div className={styles.portrait}>
                  <div className={styles.portraitInner}>{cardDef?.name?.charAt(0) || "?"}</div>
                </div>
              )}
              <div className={styles.cardInfo}>
                <h3 className={styles.cardName}>{cardDef?.name || "Unknown"}</h3>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
