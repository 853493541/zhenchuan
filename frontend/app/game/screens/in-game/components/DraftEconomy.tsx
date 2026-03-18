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
    <div className={styles.container}>
      {/* Gold - Prominent Display */}
      <div className={`${styles.section} ${styles.goldSection}`}>
        <div className={styles.goldDisplay}>
          <span className={styles.goldLabel}>💰 金币</span>
          <span className={styles.goldValue}>{eco.gold}</span>
        </div>
      </div>

      {/* Level and Battle Info */}
      <div className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>⭐ 等级</span>
          <span className={styles.value}>{eco.level}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>⚔️ 战斗</span>
          <span className={styles.value}>{battleNumber} / 8</span>
        </div>
      </div>

      {/* Tips */}
      <div className={styles.section}>
        <div className={styles.header}>阶段说明</div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span>🔄 刷新</span>
            <span className={styles.statValue}>1金</span>
          </div>
          <div className={styles.stat}>
            <span>📊 利息</span>
            <span className={styles.statValue}>每10金+1</span>
          </div>
          <div className={styles.stat}>
            <span>📋 选择</span>
            <span className={styles.statValue}>6个能力</span>
          </div>
        </div>
      </div>
    </div>
  );
}
