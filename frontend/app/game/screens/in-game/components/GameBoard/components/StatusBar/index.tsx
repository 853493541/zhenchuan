"use client";

import { useState, useEffect, useRef } from "react";
import { getBuffIconBackgroundImage } from "@/app/lib/buffIcons";
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
  onCancelBuff?: (buffId: number) => Promise<void> | void;
  allowAnyCancel?: boolean;
  showNames?: boolean;
  showTimers?: boolean;
  compact?: boolean;
  playerScale?: boolean;
  borderlessIcons?: boolean;
  maxPerRow?: number;
  categoryFilter?: "BUFF" | "DEBUFF";
  visibilityMode?: "visible" | "hidden-only" | "all";
  onCopyBuffName?: (name: string) => void;
};

type ResolvedBuff = {
  buffId: number;
  name: string;
  shortName: string;
  category: "BUFF" | "DEBUFF";
  description: string;
  expiresAt: number;
  iconPath?: string;
  attribute?: string;
  manualCancelable?: boolean;
  hideTimer?: boolean;
  stacks?: number; // live stack count for stackable debuffs
  appliedAt?: number;
  originalOrder: number;
};

type ActiveHint = {
  buff: ResolvedBuff;
  anchorRect: DOMRect;
  showRemainingTime: boolean;
};

const ALWAYS_SHOW_STACK_BADGE = new Set([990100, 990101, 990102]);
const MINUTE_MARK = "′";
const SECOND_MARK = "″";

function compareApplicationOrder(a: ResolvedBuff, b: ResolvedBuff): number {
  if (a.appliedAt !== undefined && b.appliedAt !== undefined && a.appliedAt !== b.appliedAt) {
    return a.appliedAt - b.appliedAt;
  }
  return a.originalOrder - b.originalOrder;
}

function formatTimer(secsLeft: number): { text: string; className: string; urgent: boolean } {
  if (secsLeft >= 60) {
    return {
      text: `${Math.max(1, Math.ceil(secsLeft / 60))}${MINUTE_MARK}`,
      className: styles.minuteTime,
      urgent: false,
    };
  }
  const displaySeconds = Math.max(0, Math.floor(secsLeft));
  return {
    text: `${displaySeconds}${SECOND_MARK}`,
    className: styles.secondTime,
    urgent: secsLeft < 2,
  };
}

export default function StatusBar({
  buffs = [],
  arenaRef,
  showDebug = false,
  debugLabel = '?',
  onCancelBuff,
  allowAnyCancel = false,
  showNames = true,
  showTimers = true,
  compact = false,
  playerScale = false,
  borderlessIcons = false,
  maxPerRow = 10,
  categoryFilter,
  visibilityMode = "visible",
  onCopyBuffName,
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
    const now = Date.now();
    const seededSecs: Record<number, number> = {};
    for (const b of buffs) {
      expiresAtRef.current[b.buffId] = b.expiresAt;
      seededSecs[b.buffId] = Math.max(0, (b.expiresAt - now) / 1000);
    }
    for (const idStr of Object.keys(expiresAtRef.current)) {
      if (!currentIds.has(+idStr)) delete expiresAtRef.current[+idStr];
    }
    setLocalSecs(seededSecs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffs]);

  function getRemainingSeconds(buff: Pick<ResolvedBuff, "buffId" | "expiresAt">): number {
    return localSecs[buff.buffId] ?? Math.max(0, (buff.expiresAt - Date.now()) / 1000);
  }

  // Recompute display values from wall-clock every 100ms for smooth decimals.
  useEffect(() => {
    const id = setInterval(() => {
      const next: Record<number, number> = {};
      for (const [idStr, exp] of Object.entries(expiresAtRef.current)) {
        next[+idStr] = Math.max(0, (exp - Date.now()) / 1000);
      }
      setLocalSecs(next);
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Resolve metadata for currently-live buffs.
  const resolved: ResolvedBuff[] = buffs
    .map((b, originalOrder) => {
      const meta = preload?.buffMap?.[b.buffId];
      if (!meta) return null;
      const hiddenInStatusBar = meta.hiddenInStatusBar === true;
      if (visibilityMode === "visible" && hiddenInStatusBar) return null;
      if (visibilityMode === "hidden-only" && !hiddenInStatusBar) return null;
      const shortName = meta.name.length > 2 ? meta.name.slice(0, 2) : meta.name;
      const attribute = typeof meta.attribute === "string" && meta.attribute !== "未选择" && meta.attribute !== "无"
        ? meta.attribute
        : undefined;
      return {
        buffId:      b.buffId,
        name:        meta.name,
        shortName,
        category:    meta.category,
        description: meta.description ?? "无",
        expiresAt:   b.expiresAt,
        iconPath:    meta.iconPath,
        attribute,
        manualCancelable: meta.manualCancelable === true,
        hideTimer: meta.hideTimerInStatusBar === true,
        stacks:      b.stacks,
        appliedAt:   b.appliedAt,
        originalOrder,
      };
    })
    .filter(Boolean) as ResolvedBuff[];

  // Only show buffs whose local countdown hasn't reached 0 yet.
  // This hides the buff immediately when the timer drains, without waiting
  // up to 5 s for the server to send the removal.
  const visibleResolved = resolved.filter((b) => {
    return getRemainingSeconds(b) > 0;
  }).sort(compareApplicationOrder);

  const buffsPos = visibleResolved.filter((b) => b.category === "BUFF");
  const buffsNeg = visibleResolved.filter((b) => b.category === "DEBUFF");
  const statusRows = categoryFilter === "BUFF"
    ? [buffsPos]
    : categoryFilter === "DEBUFF"
    ? [buffsNeg]
    : [buffsPos, buffsNeg];
  const singleRow = statusRows.length === 1;

  function openHint(anchorRect: DOMRect, b: ResolvedBuff, showRemainingTime: boolean) {
    setActiveHint({
      buff:       b,
      anchorRect,
      showRemainingTime,
    });
  }

  function closeHint() {
    setActiveHint(null);
  }

  function renderBuff(b: ResolvedBuff) {
    const colorClass  = b.category === "BUFF" ? styles.buffText : styles.debuffText;
    const secsLeft    = getRemainingSeconds(b);
    const showRemainingTime = showTimers && !b.hideTimer;
    const timer       = showRemainingTime ? formatTimer(secsLeft) : null;
    const urgent      = timer?.urgent === true;
    const canManualCancel = !!onCancelBuff && (allowAnyCancel || (b.category === "BUFF" && b.manualCancelable === true));
    const cancelCursor = allowAnyCancel && canManualCancel ? "pointer" : canManualCancel ? "context-menu" : undefined;

    return (
      <div
        key={b.buffId}
        className={`${styles.buffItem} ${urgent ? styles.urgentBuffItem : ""}`}
      >
        {showNames && (
          <div className={`${styles.buffName} ${colorClass}`}>
            {b.shortName}
          </div>
        )}

        <div className={styles.iconWrapper}>
          <div
            className={styles.buffIcon}
            style={{
              backgroundImage: getBuffIconBackgroundImage(b.name, b.iconPath),
              cursor: cancelCursor,
            }}
            onMouseEnter={(e) => openHint(e.currentTarget.getBoundingClientRect(), b, showRemainingTime)}
            onMouseLeave={closeHint}
            onMouseDown={(e) => {
              if (!e.ctrlKey || e.button !== 0 || !onCopyBuffName) return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              if (e.ctrlKey && onCopyBuffName) {
                e.preventDefault();
                e.stopPropagation();
                onCopyBuffName(b.name);
                return;
              }
              if (!allowAnyCancel || !canManualCancel || !onCancelBuff) return;
              e.preventDefault();
              e.stopPropagation();
              closeHint();
              void onCancelBuff(b.buffId);
            }}
            onContextMenu={(e) => {
              if (!canManualCancel || !onCancelBuff) return;
              e.preventDefault();
              e.stopPropagation();
              closeHint();
              void onCancelBuff(b.buffId);
            }}
          />
          {b.stacks !== undefined && (b.stacks >= 2 || ALWAYS_SHOW_STACK_BADGE.has(b.buffId)) && (
            <span className={styles.stackBadge}>{b.stacks}</span>
          )}
        </div>

        {timer && (
          <div
            className={`${styles.buffTurns} ${timer.className}`}
          >
            {timer.text}
          </div>
        )}
      </div>
    );
  }

  const arenaRect = arenaRef?.current
    ? arenaRef.current.getBoundingClientRect()
    : undefined;

  return (
    <>
      <div className={`${styles.statusBar} ${compact ? styles.compactStatusBar : ""} ${playerScale ? styles.playerStatusBar : ""} ${singleRow ? styles.singleRowStatusBar : ""}`}>
        {statusRows.map((row, index) => (
          <div key={categoryFilter ?? index} className={styles.statusRow}>
            {row.slice(0, maxPerRow).map(renderBuff)}
          </div>
        ))}
      </div>

      {activeHint && (
        <StatusHint
          name={activeHint.buff.name}
          description={activeHint.buff.description}
          remainingTurns={getRemainingSeconds(activeHint.buff)}
          showRemainingTime={activeHint.showRemainingTime}
          attribute={activeHint.buff.attribute}
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
            const dispSecs = localSecs[b.buffId] ?? secsLeft;
            return (
              <div key={b.buffId} style={{
                borderTop: '1px solid rgba(255,255,255,0.12)',
                paddingTop: 2,
                marginTop: 3,
              }}>
                <span style={{ color: b.category === 'DEBUFF' ? '#ff6666' : '#66ccff' }}>
                  {b.name}
                </span>{' '}(id:{b.buffId})<br />
                {b.stacks !== undefined && <>stacks: <b>{b.stacks}</b><br /></>}
                expiresAt: <b>{new Date(b.expiresAt).toLocaleTimeString()}</b><br />
                calc: <b>{secsLeft.toFixed(1)}s</b> | display: <b>{dispSecs.toFixed(1)}s</b>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
