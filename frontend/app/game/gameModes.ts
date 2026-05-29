export const YUMEN_1V1_BASIC_MODE = 'yumen-1v1-basic' as const;

export type GameMode = 'arena' | 'pubg' | 'collision-test' | typeof YUMEN_1V1_BASIC_MODE;

export function isYumen1v1BasicMode(mode: unknown): mode is typeof YUMEN_1V1_BASIC_MODE {
  return mode === YUMEN_1V1_BASIC_MODE;
}

export function isExportedMapMode(mode: unknown): mode is 'collision-test' | typeof YUMEN_1V1_BASIC_MODE {
  return mode === 'collision-test' || mode === YUMEN_1V1_BASIC_MODE;
}

export function getGameModeLabel(mode: unknown): string {
  switch (mode) {
    case YUMEN_1V1_BASIC_MODE:
      return '玉门关（6人）：基础';
    case 'collision-test':
      return '技能测试';
    case 'pubg':
      return '吃鸡';
    case 'arena':
      return '竞技场';
    case 'export-viewer':
      return 'export viewer';
    default:
      return '技能测试';
  }
}