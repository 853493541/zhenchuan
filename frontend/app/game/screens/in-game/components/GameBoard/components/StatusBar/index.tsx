"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./styles.module.css";
import StatusHint from "./Hint";

import { useGamePreload } from "../../../../preload/GamePreloadContext";
import type { ActiveBuff } from "@/app/game/screens/in-game/types";

type Props = {
  buffs?: ActiveBuff[];

  /** optional — tooltip clamps to arena if provided */
  arenaRef?: React.RefObject<HTMLDivElement>;

  /** Show an on-screen debug panel with raw timing values. */
  showDebug?: boolean;
  /** Label shown in the debug panel to distinguish me vs opponent. */
  debugLabel?: string;
};

type ResolvedBuff = {
  buffId: number;
  name: string;
  shortName: string;
  category: "BUFF" | "DEBUFF";
  description: string;
  stacks?: number; // live stack count for stackable debuffs
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
  showDebug = false,
  debugLabel = '?',
}: Props) {
  const preload = useGamePreload();
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null);

  // localSecs[buffId] = seconds remaining as a decimal (e.g. 9.5, 0.3).
  // Recomputed from expiresAtRef every 100ms — no integer rounding until display.
  const [localSecs, setLocalSecs] = useState<Record<number, number>>({});

  // Source of truth: expiresAt (ms) per buffId, updated whenever the server sends
  // a new expiresAt.  Lives in a ref so the interval closure always reads the latest
  // value without needing to be recreated.
  const expiresAtRef = useRef<Record<number, number>>({});

  // Sync server expiresAt → expiresAtRef (and seed localSecs for new buffs).
  useEffect(() => {
    const currentIds = new Set(buffs.map((b) => b.buffId));
    for (const b of buffs) {
      expiresAtRef.current[b.buffId] = b.expiresAt;
    }
    for (const idStr of Object.keys(expiresAtRef.current)) {
      if (!currentIds.has(+idStr)) delete expiresAtRef.current[+idStr];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffs]);

  // Recompute display values from wall-clock every 100ms for smooth decimals.
  useEffect(() => {
    const id = setInterval(() => {
      const next: Record<number, number> = {};
      for (const [idStr, exp] of Object.entries(expiresAtRef.current)) {
        next[+idStr] = Math.max(0, (exp - Date.now()) / 1000);
      }
      setLocalSecs(next);
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Resolve metadata for currently-live buffs.
  const resolved: ResolvedBuff[] = buffs
    .map((b) => {
      const meta = preload?.buffMap?.[b.buffId];
      if (!meta) return null;
      const shortName = meta.name.length > 2 ? meta.name.slice(0, 2) : meta.name;
      return {
        buffId:      b.buffId,
        name:        meta.name,
        shortName,
        category:    meta.category,
        description: meta.description ?? "无",
        stacks:      b.stacks,
      };
    })
    .filter(Boolean) as ResolvedBuff[];

  // Only show buffs whose local countdown hasn't reached 0 yet.
  // This hides the buff immediately when the timer drains, without waiting
  // up to 5 s for the server to send the removal.
  const visibleResolved = resolved.filter((b) => {
    const secs = localSecs[b.buffId];
    return secs === undefined || secs > 0;
  });

  const buffsPos = visibleResolved.filter((b) => b.category === "BUFF");
  const buffsNeg = visibleResolved.filter((b) => b.category === "DEBUFF");

  function openHint(anchorRect: DOMRect, b: ResolvedBuff) {
    setActiveHint({
      name:        b.name,
      description: b.description,
      remaining:   localSecs[b.buffId] ?? 0,
      anchorRect,
    });
  }

  function closeHint() {
    setActiveHint(null);
  }

  function renderBuff(b: ResolvedBuff) {
    const colorClass  = b.category === "BUFF" ? styles.buffText : styles.debuffText;
    const secsLeft    = localSecs[b.buffId] ?? 0;
    const isLastTick  = secsLeft < 5;
    // Timer always shows countdown; stacks shown as icon overlay badge
    const timerStr    = secsLeft >= 5 ? String(Math.floor(secsLeft)) : secsLeft.toFixed(1);

    return (
      <div key={b.buffId} className={styles.buffItem}>
        <div className={`${styles.buffName} ${colorClass}`}>
          {b.shortName}
        </div>

        <div className={styles.iconWrapper}>
          <div
            className={`${styles.buffIcon} ${
              b.category === "BUFF" ? styles.buffBorder : styles.debuffBorder
            }`}
            style={{ backgroundImage: `url(/game/icons/buffs/${b.name}.png)` }}
            onMouseEnter={(e) => openHint(e.currentTarget.getBoundingClientRect(), b)}
            onMouseLeave={closeHint}
          />
          {b.stacks !== undefined && b.stacks >= 2 && (
            <span className={styles.stackBadge}>{b.stacks}</span>
          )}
        </div>

        <div
          className={`${styles.buffTurns} ${colorClass} ${
            isLastTick ? styles.lastTurn : ""
          }`}
        >
          {timerStr}
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

      {showDebug && (
        <div style={{
          position: 'fixed',
          right: 4,
          ...(debugLabel === 'opp' ? { top: 120 } : { bottom: 4 }),
          background: 'rgba(0,0,0,0.88)',
          color: '#00ff88',
          fontSize: 11,
          fontFamily: 'monospace',
          padding: '6px 8px',
          zIndex: 9999,
          pointerEvents: 'none',
          lineHeight: '1.6',
          border: '1px solid rgba(0,255,136,0.25)',
          borderRadius: 4,
          minWidth: 230,
          maxWidth: 290,
        }}>
          <div style={{ color: '#ffff00', marginBottom: 2 }}>
            [{debugLabel}] {new Date().toLocaleTimeString()}
          </div>
          {buffs.length === 0 && (
            <div style={{ color: '#888', marginTop: 2 }}>no buffs</div>
          )}
          {buffs.map(b => {
            const secsLeft = Math.max(0, (b.expiresAt - Date.now()) / 1000);
            const dispSecs = localSecs[b.buffId];
            return (
              <div key={b.buffId} style={{
                borderTop: '1px solid rgba(255,255,255,0.12)',
                paddingTop: 2,
                marginTop: 3,
              }}>
                <span style={{ color: b.category === 'DEBUFF' ? '#ff6666' : '#66ccff' }}>
                  {b.name}
                </span>{' '}(id:{b.buffId})<br />
                expiresAt: <b>{new Date(b.expiresAt).toLocaleTimeString()}</b><br />
                calc: <b>{secsLeft.toFixed(1)}s</b> | display: <b>{dispSecs ?? '?'}s</b>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
