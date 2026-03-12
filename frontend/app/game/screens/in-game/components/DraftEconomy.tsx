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
        <span className={styles.label}>💰 金币</span>
        <span className={styles.value}>{eco.gold}</span>
      </div>

      <div className={styles.stat}>
        <span className={styles.label}>⭐ 等级</span>
        <span className={styles.value}>{eco.level}</span>
      </div>

      <div className={styles.stat}>
        <span className={styles.label}>⚔️ 战斗</span>
        <span className={styles.value}>{battleNumber} / 8</span>
      </div>

      <div className={styles.info}>
        <p>• 刷新: 1个金币</p>
        <p>• 利息: 每10金币1个 (最多5)</p>
        <p>• 选择6个能力出战</p>
      </div>
    </div>
  );
}
