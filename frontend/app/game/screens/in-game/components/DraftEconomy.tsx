/**
 * DraftEconomy - Shows gold, level, and other economy info
 */

"use client";

import type { PlayerEconomy } from "../types";
import styles from "./DraftEconomy.module.css";

type Props = {
  eco: PlayerEconomy;
  battleNumber: number;
};

export default function DraftEconomy({ eco, battleNumber }: Props) {
  return (
    <div className={styles.economy}>
      <div className={styles.stat}>
        <span className={styles.label}>Gold</span>
        <span className={styles.value}>{eco.gold}</span>
      </div>

      <div className={styles.stat}>
        <span className={styles.label}>Level</span>
        <span className={styles.value}>{eco.level}</span>
      </div>

      <div className={styles.stat}>
        <span className={styles.label}>Battle</span>
        <span className={styles.value}>{battleNumber} / 8</span>
      </div>

      <div className={styles.info}>
        <p>• Refresh: 1 gold</p>
        <p>• Interest: 1 per 10 gold (max 5)</p>
        <p>• Select 6 abilities to continue</p>
      </div>
    </div>
  );
}
