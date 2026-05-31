export const YUMENGUAN_CLASSIC_MODE = "yumenguan-classic" as const;
export const TEST_MODE = "test" as const;
export const LEGACY_YUMEN_1V1_BASIC_MODE = "yumen-1v1-basic" as const;
export const LEGACY_COLLISION_TEST_MODE = "collision-test" as const;
export const DEFAULT_GAME_MODE = YUMENGUAN_CLASSIC_MODE;

export type GameMode = "arena" | "pubg" | typeof TEST_MODE | typeof YUMENGUAN_CLASSIC_MODE;

export function isYumen1v1BasicMode(mode: unknown): mode is typeof YUMENGUAN_CLASSIC_MODE {
  return mode === YUMENGUAN_CLASSIC_MODE || mode === LEGACY_YUMEN_1V1_BASIC_MODE;
}

export function isExportedMapMode(mode: unknown): mode is typeof TEST_MODE | typeof YUMENGUAN_CLASSIC_MODE {
  return (
    mode === TEST_MODE ||
    mode === LEGACY_COLLISION_TEST_MODE ||
    mode === YUMENGUAN_CLASSIC_MODE ||
    mode === LEGACY_YUMEN_1V1_BASIC_MODE
  );
}

export function normalizeGameMode(mode: unknown): GameMode {
  if (mode === "arena" || mode === "pubg" || mode === TEST_MODE || mode === YUMENGUAN_CLASSIC_MODE) {
    return mode;
  }
  if (mode === LEGACY_COLLISION_TEST_MODE) return TEST_MODE;
  if (mode === LEGACY_YUMEN_1V1_BASIC_MODE) return YUMENGUAN_CLASSIC_MODE;
  return "arena";
}