"use client";

import HealthBar from "../HealthBar";
import StatusBar from "../StatusBar";
import styles from "./styles.module.css";
import type { PlayerState } from "@/app/game/screens/in-game/types";

const MAX_HP = 100;

type Props = {
  opponent: PlayerState;
  currentTurn: number;
};

export default function OpponentArea({
  opponent,
  currentTurn: _currentTurn,
}: Props) {
  return (
    <div className={styles.enemyHalf} data-label="OpponentArea">
      {/* ================= PLAYER NAME ================= */}
      <div className={styles.playerName}>
        {opponent.username || "Opponent"}
      </div>

      {/* ================= TOP ROW: HEALTH ================= */}
      <div className={styles.topRow}>
        {/* ENEMY HEALTH + GCD */}
        <HealthBar
          hp={opponent.hp}
          maxHp={MAX_HP}
          side="enemy"
          gcd={opponent.gcd}
        />
      </div>

      {/* ================= ENEMY BUFFS / DEBUFFS ================= */}
      <div className={styles.section} data-label="Enemy Status">
        <StatusBar
          buffs={opponent.buffs}
        />
      </div>
    </div>
  );
}
