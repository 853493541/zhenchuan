"use client";

import AnimatedHandSlot from "./AnimatedHandSlot";
import Card from "../../../../Card";
import styles from "./styles.module.css";

import type { CardInstance } from "@/app/game/screens/in-game/types";

type Props = {
  cards: CardInstance[];
  remainingGcd?: number;                 // ✅ SAFE
  onPlayCard: (card: CardInstance) => void;
  isMyTurn: boolean;
};

export default function Hand({
  cards,
  remainingGcd,
  onPlayCard,
  isMyTurn,
}: Props) {
  return (
    <div className={styles.hand}>
      {cards.map((card) => (
        <AnimatedHandSlot key={card.instanceId}>
          <Card
            cardId={card.cardId}
            card={card.card}              // card data
            remainingGcd={remainingGcd}   // 🔑 MAY BE UNDEFINED — SAFE
            cooldown={card.cooldown}      // NEW: show cooldown
            variant={isMyTurn ? "hand" : "disabled"}
            onClick={isMyTurn ? () => onPlayCard(card) : undefined}
          />
        </AnimatedHandSlot>
      ))}
    </div>
  );
}
