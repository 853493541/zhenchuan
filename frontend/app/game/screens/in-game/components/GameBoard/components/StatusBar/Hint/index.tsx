"use client";

import { useLayoutEffect, useRef, useState } from "react";
import styles from "./styles.module.css";

type Props = {
  name: string;
  description?: string;
  remainingTurns: number;
  anchorRect: DOMRect;
  arenaRect?: DOMRect;
};

export default function StatusHint({
  name,
  description,
  remainingTurns,
  anchorRect,
  arenaRect,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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
      <div className={styles.title}>{name}</div>
      <div className={styles.desc}>{description || "无"}</div>
      <div className={styles.time}>
        剩余时间：{Math.max(0, remainingTurns).toFixed(1)}s
      </div>
    </div>
  );
}
