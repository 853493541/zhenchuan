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

  // localSecs[buffId] = seconds remaining, counting down via setInterval.
  // Source of truth for display.
  const [localSecs, setLocalSecs] = useState<Record<number, number>>({});

  // Tracks the last expiresAt we synced per buffId to avoid resetting the
  // countdown on every 60Hz position diff (applyDiff gives buffs a new array
  // reference each frame even when nothing changed).
  const lastSyncRef = useRef<Record<number, number>>({}); // buffId → last expiresAt

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
      };
    })
    .filter(Boolean) as ResolvedBuff[];

  // Sync server state → localSecs.
  //
  // Gate: only reset the countdown when expiresAt changes for a given buff
  // (i.e., a new buff was applied or refreshed). Stable expiresAt = no reset.
  useEffect(() => {
    const currentIds = new Set(buffs.map((b) => b.buffId));

    const updates: Record<number, number> = {}; // buffId → new localSecs value
    for (const b of buffs) {
      const prev = lastSyncRef.current[b.buffId];
      if (prev !== b.expiresAt) {
        lastSyncRef.current[b.buffId] = b.expiresAt;
        updates[b.buffId] = Math.max(0, Math.ceil((b.expiresAt - Date.now()) / 1000));
      }
    }

    // Clean up tracking for removed buffs
    for (const idStr of Object.keys(lastSyncRef.current)) {
      if (!currentIds.has(+idStr)) {
        delete lastSyncRef.current[+idStr];
      }
    }

    if (Object.keys(updates).length === 0) return;

    setLocalSecs((prev) => {
      const next: Record<number, number> = {};
      for (const b of buffs) {
        next[b.buffId] = b.buffId in updates ? updates[b.buffId] : (prev[b.buffId] ?? 0);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffs]);

  // Count down every second between server ticks.
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
    const displaySecs = localSecs[b.buffId] ?? 0;
    const isLastTick  = displaySecs <= 5;

    return (
      <div key={b.buffId} className={styles.buffItem}>
        <div className={`${styles.buffName} ${colorClass}`}>
          {b.shortName}
        </div>

        <div
          className={`${styles.buffIcon} ${
            b.category === "BUFF" ? styles.buffBorder : styles.debuffBorder
          }`}
          style={{ backgroundImage: `url(/game/icons/buffs/${b.name}.png)` }}
          onMouseEnter={(e) => openHint(e.currentTarget.getBoundingClientRect(), b)}
          onMouseLeave={closeHint}
        />

        <div
          className={`${styles.buffTurns} ${colorClass} ${
            isLastTick ? styles.lastTurn : ""
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

      {showDebug && (
        <div style={{
          position: 'fixed',
          right: 4,
          ...(debugLabel === 'opp' ? { top: 4 } : { bottom: 4 }),
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
