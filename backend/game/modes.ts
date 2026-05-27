export const YUMEN_1V1_BASIC_MODE = "yumen-1v1-basic" as const;
export const DEFAULT_GAME_MODE = YUMEN_1V1_BASIC_MODE;

export type GameMode = "arena" | "pubg" | "collision-test" | typeof YUMEN_1V1_BASIC_MODE;

export function isYumen1v1BasicMode(mode: unknown): mode is typeof YUMEN_1V1_BASIC_MODE {
  return mode === YUMEN_1V1_BASIC_MODE;
}

export function isExportedMapMode(mode: unknown): mode is "collision-test" | typeof YUMEN_1V1_BASIC_MODE {
  return mode === "collision-test" || mode === YUMEN_1V1_BASIC_MODE;
}

export function normalizeGameMode(mode: unknown): GameMode {
  if (mode === "arena" || mode === "pubg" || mode === "collision-test" || mode === YUMEN_1V1_BASIC_MODE) {
    return mode;
  }
  return "arena";
}