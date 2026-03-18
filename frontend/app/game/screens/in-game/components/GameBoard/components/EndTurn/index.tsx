"use client";

import styles from "./styles.module.css";

type Props = {
  isMyTurn: boolean;
  onEndTurn: () => void;
};

export default function EndTurn({ isMyTurn, onEndTurn }: Props) {
  return (
    <div className={styles.wrap}>
      <button
        className={`${styles.endTurnBtn} ${
          isMyTurn ? styles.myTurn : styles.enemyTurn
        }`}
        disabled={!isMyTurn}
        onClick={onEndTurn}
      >
        {isMyTurn ? "结束回合" : "对手回合"}
      </button>
    </div>
  );
}
