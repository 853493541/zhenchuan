/**
 * SelectedAbilities - Shows the 6 selected abilities
 */

"use client";

import type { CardInstance } from "../types";
import { useState } from "react";
import styles from "./SelectedAbilities.module.css";

type Props = {
  selected: CardInstance[];
  cardMap: Record<string, any>;
  onMoveToBench?: (cardInstanceId: string) => Promise<void>;
  loading?: boolean;
};

export default function SelectedAbilities({ 
  selected, 
  cardMap,
  onMoveToBench,
  loading = false,
}: Props) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (cardId: string) => {
    setFailedImages(prev => new Set([...prev, cardId]));
  };
  return (
    <div className={styles.container}>
      <h2 className={styles.title}>⚔️ 出战阵容</h2>
      <div className={styles.slotGrid}>
        {Array.from({ length: 6 }).map((_, idx) => {
          const card = selected[idx];
          const cardDef = card ? cardMap[card.cardId] : null;

          return (
            <div 
              key={idx} 
              className={`${styles.slot} ${card ? styles.selected : styles.empty}`}
              onClick={() => card && onMoveToBench && onMoveToBench(card.instanceId)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (card && onMoveToBench) {
                  onMoveToBench(card.instanceId);
                }
              }}
              style={card && onMoveToBench ? { cursor: "pointer" } : {}}
              title={card ? "左键点击或右键移到备战区" : ""}
            >
              {cardDef ? (
                <>
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
                  </div>
                </>
              ) : (
                <div className={styles.emptySlot}>
                  <span>位置 {idx + 1}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
