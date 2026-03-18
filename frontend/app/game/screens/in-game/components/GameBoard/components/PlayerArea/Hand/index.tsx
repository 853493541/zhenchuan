"use client";

import AnimatedHandSlot from "./AnimatedHandSlot";
import Ability from "../../../../Ability";
import styles from "./styles.module.css";

import type { AbilityInstance } from "@/app/game/screens/in-game/types";

type Props = {
  abilities: AbilityInstance[];
  remainingGcd?: number;                 // ✅ SAFE
  onPlayCard: (ability: AbilityInstance) => void;
  isMyTurn: boolean;
};

export default function Hand({
  abilities,
  remainingGcd,
  onPlayCard,
  isMyTurn,
}: Props) {
  return (
    <div className={styles.hand}>
      {abilities.map((ability) => (
        <AnimatedHandSlot key={ability.instanceId}>
          <Ability
            abilityId={ability.abilityId}
            remainingGcd={remainingGcd}   // 🔑 MAY BE UNDEFINED — SAFE
            cooldown={ability.cooldown}      // NEW: show cooldown
            variant={isMyTurn ? "hand" : "disabled"}
            onClick={isMyTurn ? () => onPlayCard(ability) : undefined}
          />
        </AnimatedHandSlot>
      ))}
    </div>
  );
}
