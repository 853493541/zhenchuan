"use client";

import HealthBar from "../HealthBar";
import StatusBar from "../StatusBar";
import styles from "./styles.module.css";

import type {
  PlayerState,
} from "@/app/game/screens/in-game/types";

const MAX_HP = 100;

type Props = {
  me: PlayerState;
  isMyTurn: boolean;
};

export default function PlayerArea({
  me,
  isMyTurn: _isMyTurn,
}: Props) {
  return (
    <div className={styles.playerHalf}>
      {/* PLAYER NAME */}
      <div className={styles.playerName}>
        You {me.username ? `(${me.username})` : ""}
      </div>

      {/* Everything bottom-aligned as one stack */}
      <div className={styles.bottomStack}>
        {/* RESERVED STATUS SLOT (keeps space even when empty) */}
        <div className={styles.statusSlot}>
          <StatusBar buffs={me.buffs} />
        </div>

        {/* HP + GCD */}
        <HealthBar
          hp={me.hp}
          maxHp={MAX_HP}
          side="player"
          gcd={me.gcd}
        />
      </div>
    </div>
  );
}
