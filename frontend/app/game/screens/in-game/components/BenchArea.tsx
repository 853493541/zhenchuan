/**
 * BenchArea - Shows 12 benched abilities that persist across battles
 * Can move to selected, sell for gold, or hover to see stats
 */

"use client";

import type { CardInstance } from "../types";
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
  const benchSlots = Array.from({ length: 12 }, (_, i) => {
    const card = bench[i];
    return { index: i, card };
  });

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>备战区 {fullSlots}/12</h3>
      <div className={styles.grid}>
        {benchSlots.map(({ index, card }) => {
          if (!card) {
            return (
              <div key={index} className={styles.emptySlot}>
                <div className={styles.slotNumber}>{index + 1}</div>
              </div>
            );
          }

          const cardDef = cardMap[card.cardId];
          const cost = cardDef?.cost || 1;
          const rarity = cardDef?.rarity || "common";

          return (
            <div
              key={card.instanceId}
              className={`${styles.benchCard} ${styles[`rarity-${rarity}`]}`}
            >
              <div className={styles.cardContent}>
                <div className={styles.cardName}>{cardDef?.name || "Unknown"}</div>
                <div className={styles.cardCost}>${cost}</div>
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.moveBtn}
                  onClick={() => onMoveToSelected(card.instanceId)}
                  disabled={loading}
                  title="移到选择栏"
                >
                  ➜ 选
                </button>
                <button
                  className={styles.sellBtn}
                  onClick={() => onSell(card.instanceId)}
                  disabled={loading}
                  title="出售获得金币"
                >
                  💰 卖
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
