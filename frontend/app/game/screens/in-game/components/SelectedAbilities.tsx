/**
 * SelectedAbilities - Shows the 6 selected abilities
 */

"use client";

import type { CardInstance } from "../types";
import styles from "./SelectedAbilities.module.css";

type Props = {
  selected: CardInstance[];
  cardMap: Record<string, any>;
};

export default function SelectedAbilities({ selected, cardMap }: Props) {
  return (
    <div className={styles.selection}>
      <h2>Your Lineup</h2>
      <div className={styles.slotGrid}>
        {Array.from({ length: 6 }).map((_, idx) => {
          const card = selected[idx];
          const cardDef = card ? cardMap[card.cardId] : null;

          return (
            <div key={idx} className={styles.slot}>
              {cardDef ? (
                <div className={styles.selectedCard}>
                  <h4>{cardDef.name}</h4>
                  <p className={styles.type}>{cardDef.type}</p>
                </div>
              ) : (
                <div className={styles.empty}>
                  <span>Slot {idx + 1}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
