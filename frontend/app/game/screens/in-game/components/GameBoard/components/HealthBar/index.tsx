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

function formatGameAmount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 10000) {
    const wan = Math.round((Math.abs(value) / 10000) * 10) / 10;
    const text = Number.isInteger(wan) ? String(wan) : wan.toFixed(1).replace(/\.0$/, "");
    return `${value < 0 ? "-" : ""}${text}万`;
  }
  return String(Math.round(value));
}

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

      <span className={styles.hpText}>{formatGameAmount(hp)}/{formatGameAmount(maxHp)}</span>

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
          {delta > 0 ? `+${formatGameAmount(delta)}` : `-${formatGameAmount(Math.abs(delta))}`}
        </span>
      )}
    </div>
  );
}
