"use client";

import { createContext, useContext } from "react";

export type GamePreload = {
  cards: any[]; // display-only, backend authoritative
};

const GamePreloadContext = createContext<GamePreload | null>(null);

export function GamePreloadProvider({
  value,
  children,
}: {
  value: GamePreload;
  children: React.ReactNode;
}) {
  return (
    <GamePreloadContext.Provider value={value}>
      {children}
    </GamePreloadContext.Provider>
  );
}

/* ================= HOOK ================= */

export function useGamePreload(): GamePreload {
  const ctx = useContext(GamePreloadContext);
  if (!ctx) {
    throw new Error(
      "useGamePreload must be used inside <GamePreloadProvider>"
    );
  }
  return ctx;
}
