"use client";

import { useState, useEffect } from "react";
import styles from "./styles.module.css";
import StatusHint from "./Hint";

import { useGamePreload } from "../../../../preload/GamePreloadContext";
import type { ActiveBuff } from "@/app/game/screens/in-game/types";

type Props = {
  buffs?: ActiveBuff[];

  /** optional — tooltip clamps to arena if provided */
  arenaRef?: React.RefObject<HTMLDivElement>;
};

type ResolvedBuff = {
  buffId: number;
  name: string;
  shortName: string;
  category: "BUFF" | "DEBUFF";
  description: string;
  remaining: number; // seconds (remaining ticks * 5)
  isLastTick: boolean;
};

type ActiveHint = {
  name: string;
  description: string;
  remaining: number;
  anchorRect: DOMRect;
};

export default function StatusBar({
  buffs = [],
  arenaRef,
}: Props) {
  const preload = useGamePreload();
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null);

  // Per-buff local countdown in seconds. Only ever decreases — stale server data
  // (e.g. from the 3-second REST poll) can never make the timer jump back up.
  const [localSecs, setLocalSecs] = useState<Record<number, number>>({});

  const resolved: ResolvedBuff[] = buffs
    .map((b) => {
      const meta = preload?.buffMap?.[b.buffId];
      if (!meta) return null;

      const remainingTicks = Math.max(0, b.remaining);
      const remainingSec   = remainingTicks * 5;
      const shortName      = meta.name.length > 2 ? meta.name.slice(0, 2) : meta.name;

      return {
        buffId:      b.buffId,
        name:        meta.name,
        shortName,
        category:    meta.category,
        description: meta.description ?? "\u65e0",
        remaining:   remainingSec,
        isLastTick:  remainingTicks === 1,
      };
    })
    .filter(Boolean) as ResolvedBuff[];

  // Sync from server: only move the timer DOWN — never up. This keeps the display
  // monotonically decreasing even when a stale REST snapshot arrives out-of-order.
  useEffect(() => {
    setLocalSecs((prev) => {
      const next: Record<number, number> = {};
      for (const b of resolved) {
        const current = prev[b.buffId];
        next[b.buffId] =
          current !== undefined ? Math.min(current, b.remaining) : b.remaining;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffs]); // raw buffs dep: only fires when actual server data changes

  // Local 1-second countdown between server ticks
  useEffect(() => {
    const id = setInterval(() => {
      setLocalSecs((prev) => {
        const next: Record<number, number> = {};
        for (const key in prev) {
          next[+key] = Math.max(0, prev[+key] - 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const buffsPos = resolved.filter((b) => b.category === "BUFF");
  const buffsNeg = resolved.filter((b) => b.category === "DEBUFF");

  function openHint(anchorRect: DOMRect, b: ResolvedBuff) {
    setActiveHint({
      name:        b.name,
      description: b.description,
      remaining:   localSecs[b.buffId] ?? b.remaining,
      anchorRect,
    });
  }

  function closeHint() {
    setActiveHint(null);
  }

  function renderBuff(b: ResolvedBuff) {
    const colorClass  = b.category === "BUFF" ? styles.buffText : styles.debuffText;
    const displaySecs = localSecs[b.buffId] ?? b.remaining;

    return (
      <div key={b.buffId} className={styles.buffItem}>
        {/* NAME */}
        <div className={`${styles.buffName} ${colorClass}`}>
          {b.shortName}
        </div>

        {/* ICON — hover anchor */}
        <div
          className={`${styles.buffIcon} ${
            b.category === "BUFF" ? styles.buffBorder : styles.debuffBorder
          }`}
          style={{
            backgroundImage: `url(/game/icons/buffs/${b.name}.png)`,
          }}
          onMouseEnter={(e) =>
            openHint(e.currentTarget.getBoundingClientRect(), b)
          }
          onMouseLeave={closeHint}
        />

        {/* REMAINING — locally counting down every second */}
        <div
          className={`${styles.buffTurns} ${colorClass} ${
            b.isLastTick ? styles.lastTurn : ""
          }`}
        >
          {displaySecs}
        </div>
      </div>
    );
  }

  const arenaRect = arenaRef?.current
    ? arenaRef.current.getBoundingClientRect()
    : undefined;

  return (
    <>
      <div className={styles.statusBar}>
        <div className={styles.statusRow}>
          {buffsPos.slice(0, 6).map(renderBuff)}
        </div>
        <div className={styles.statusRow}>
          {buffsNeg.slice(0, 6).map(renderBuff)}
        </div>
      </div>

      {activeHint && (
        <StatusHint
          name={activeHint.name}
          description={activeHint.description}
          remainingTurns={activeHint.remaining}
          anchorRect={activeHint.anchorRect}
          arenaRect={arenaRect}
        />
      )}
    </>
  );
}
