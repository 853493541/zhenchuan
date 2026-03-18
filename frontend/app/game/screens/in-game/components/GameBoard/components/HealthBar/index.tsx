"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./styles.module.css";

type Props = {
  hp: number;
  maxHp: number;
  side: "player" | "enemy";

  /** NEW: remaining GCD for this player */
  gcd?: number;
};

export default function HealthBar({
  hp,
  maxHp,
  side,
  gcd,
}: Props) {
  const prevHp = useRef(hp);
  const [delta, setDelta] = useState<number | null>(null);

  /* ================= HYBRID DELTA LOGIC ================= */
  useEffect(() => {
    const diff = hp - prevHp.current;
    if (diff !== 0) {
      setDelta(diff);

      const timer = setTimeout(() => {
        setDelta(null);
      }, 1400);

      prevHp.current = hp;
      return () => clearTimeout(timer);
    }
  }, [hp]);

  return (
    <div className={`${styles.hpBar} ${styles[side]}`}>
      <span className={styles.hpIcon}>❤️</span>

      <div className={styles.hpTrack}>
        <div
          className={styles.hpFill}
          style={{ width: `${(hp / maxHp) * 100}%` }}
        />
      </div>

      <span className={styles.hpText}>{hp}</span>

      {/* ================= GCD PILL ================= */}
      <span className={styles.gcdPill}>
        GCD:{String(gcd)}
      </span>

      {/* ================= HP DELTA ================= */}
      {delta !== null && (
        <span
          className={`${styles.hpDelta} ${
            delta > 0 ? styles.heal : styles.damage
          }`}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </div>
  );
}
