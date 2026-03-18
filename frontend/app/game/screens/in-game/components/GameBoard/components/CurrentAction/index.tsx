"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./styles.module.css";
import type { GameEvent } from "@/app/game/screens/in-game/types";
import Card from "../../../Card";

/* ================= PROPS ================= */

type Props = {
  events: GameEvent[] | undefined | null;
  myUserId: string;
  gameVersion?: number;
};

/* ================= COMPONENT ================= */

export default function CurrentAction({
  events,
  myUserId,
  gameVersion,
}: Props) {
  const [cards, setCards] = useState<GameEvent[]>([]);
  const seenPlayEventIds = useRef<Set<string>>(new Set());
  const lastVersion = useRef<number | undefined>(undefined);

  /* ================= DEVICE DETECTION ================= */

  const isPhone =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;

  /* ================= VERSION RESET ================= */

  useEffect(() => {
    if (
      gameVersion !== undefined &&
      lastVersion.current !== gameVersion
    ) {
      // HARD RESET on version change
      seenPlayEventIds.current.clear();
      setCards([]);
      lastVersion.current = gameVersion;
    }
  }, [gameVersion]);

  /* ================= UPDATE LOGIC (FIXED) ================= */

  useEffect(() => {
    if (!Array.isArray(events)) return;

    // collect ALL unseen PLAY_CARD events
    const newPlays = events.filter(
      (e) =>
        e.type === "PLAY_CARD" &&
        !seenPlayEventIds.current.has(e.id)
    );

    if (newPlays.length === 0) return;

    // mark all as seen
    newPlays.forEach((e) =>
      seenPlayEventIds.current.add(e.id)
    );

    // enqueue ALL new plays instead of collapsing to latest
    setCards((prev) => {
      const limit = isPhone ? 1 : 3;

      // newest first so animation + stacking still work
      const incoming = [...newPlays].reverse();

      return [...incoming, ...prev].slice(0, limit);
    });
  }, [events, isPhone]);

  /* ================= RENDER ================= */

  return (
    <div className={styles.arena}>
      {cards.map((e, idx) => {
        const isMe = e.actorUserId === myUserId;

        return (
          <div
            key={e.id}
            className={[
              styles.cardWrap,
              isMe ? styles.me : styles.enemy,
              idx === 0 &&
                (isMe
                  ? styles.enterFromBottom
                  : styles.enterFromTop),
              !isPhone && idx === 2 && styles.fadeOut,
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              transform: isPhone
                ? "translateY(0)"
                : `translateX(calc(-1 * ${idx} * var(--card-shift)))`,
            }}
          >
            <Card cardId={e.cardId} variant="arena" />
          </div>
        );
      })}
    </div>
  );
}
