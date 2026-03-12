"use client";

import HealthBar from "../HealthBar";
import StatusBar from "../StatusBar";
import Hand from "./Hand";
import styles from "./styles.module.css";

import type {
  PlayerState,
  CardInstance,
} from "@/app/game/screens/in-game/types";

const MAX_HP = 100;

type Props = {
  me: PlayerState;
  currentTurn: number;
  isMyTurn: boolean;
  onPlayCard: (card: CardInstance) => void;
};

export default function PlayerArea({
  me,
  currentTurn,
  isMyTurn,
  onPlayCard,
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
          <StatusBar buffs={me.buffs} currentTurn={currentTurn} />
        </div>

        {/* HP + GCD */}
        <HealthBar
          hp={me.hp}
          maxHp={MAX_HP}
          side="player"
          gcd={me.gcd}
        />

        {/* HAND */}
        <div className={styles.handZone}>
          <Hand
            cards={me.hand}
            remainingGcd={me.gcd}
            onPlayCard={onPlayCard}
            isMyTurn={isMyTurn}
          />
        </div>
      </div>
    </div>
  );
}
