"use client";

import { useLayoutEffect, useRef, useState } from "react";
import styles from "./styles.module.css";

type Props = {
  name: string;
  description?: string;
  remainingTurns: number;
  attribute?: string;
  anchorRect: DOMRect;
  arenaRect?: DOMRect;
};

function formatRemainingTime(totalSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}时 ${minutes}分 ${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分 ${seconds}秒`;
  }
  return `${seconds}秒`;
}

export default function StatusHint({
  name,
  description,
  remainingTurns,
  attribute,
  anchorRect,
  arenaRect,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const remainingSeconds = Math.max(0, Math.floor(remainingTurns));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const hint = el.getBoundingClientRect();

    const GAP = 6;
    const SAFE = 8;
    const ABOVE_BUFFER = 20; // 🔑 THIS is the key fix

    const bounds =
      arenaRect ??
      new DOMRect(0, 0, window.innerWidth, window.innerHeight);

    const minX = bounds.left + SAFE;
    const maxX = bounds.right - hint.width - SAFE;
    const minY = bounds.top + SAFE;
    const maxY = bounds.bottom - hint.height - SAFE;

    /* =========================
       VERTICAL
       Prefer ABOVE, but bail early
    ========================= */

    const spaceAbove =
      anchorRect.top - bounds.top;

    let top: number;

    if (spaceAbove >= hint.height + GAP + ABOVE_BUFFER) {
      // enough comfortable space → above
      top = anchorRect.top - hint.height - GAP;
    } else {
      // otherwise → below
      top = anchorRect.bottom + GAP;
    }

    top = Math.min(Math.max(minY, top), maxY);

    /* =========================
       HORIZONTAL
       LEFT → RIGHT only
    ========================= */

    let left = anchorRect.right + GAP;

    if (left > maxX) {
      left = maxX;
    }

    left = Math.max(minX, left);

    setPos({ top, left });
  }, [name, description, remainingTurns, anchorRect, arenaRect]);

  return (
    <div
      ref={ref}
      className={styles.hint}
      style={
        pos
          ? { top: pos.top, left: pos.left }
          : { top: -9999, left: -9999 }
      }
    >
      <div className={styles.titleRow}>
        <div className={styles.title}>{name}</div>
        {attribute && <div className={styles.attributeBadge}>{attribute}气劲</div>}
      </div>
      <div className={styles.desc}>{description || "无"}</div>
      <div className={styles.time}>
        剩余时间：{remainingSeconds <= 0 ? "马上消亡" : formatRemainingTime(remainingSeconds)}
      </div>
    </div>
  );
}
