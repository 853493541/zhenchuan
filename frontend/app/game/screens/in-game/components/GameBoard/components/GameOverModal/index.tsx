"use client";

import styles from "./styles.module.css";

type Props = {
  isWinner: boolean;
  onExit: () => void;
};

export default function GameOverModal({
  isWinner,
  onExit,
}: Props) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div
          className={`${styles.title} ${
            isWinner ? styles.win : styles.lose
          }`}
        >
          {isWinner ? "🐔 你赢了！" : "🪦 你输了"}
        </div>

        <button
          className={styles.exitBtn}
          onClick={onExit}
        >
          返回大厅
        </button>
      </div>
    </div>
  );
}
