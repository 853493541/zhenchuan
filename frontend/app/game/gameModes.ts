export const YUMEN_1V1_BASIC_MODE = 'yumenguan-classic' as const;
export const TEST_MODE = 'test' as const;

export type GameMode = 'arena' | 'pubg' | typeof TEST_MODE | typeof YUMEN_1V1_BASIC_MODE;

export function isYumen1v1BasicMode(mode: unknown): mode is typeof YUMEN_1V1_BASIC_MODE {
  return mode === YUMEN_1V1_BASIC_MODE || mode === 'yumen-1v1-basic';
}

export function isExportedMapMode(mode: unknown): mode is typeof TEST_MODE | typeof YUMEN_1V1_BASIC_MODE {
  return mode === TEST_MODE || mode === 'collision-test' || mode === YUMEN_1V1_BASIC_MODE || mode === 'yumen-1v1-basic';
}

export function getGameModeLabel(mode: unknown): string {
  switch (mode) {
    case YUMEN_1V1_BASIC_MODE:
    case 'yumen-1v1-basic':
      return '玉门关：经典';
    case TEST_MODE:
    case 'collision-test':
      return '测试';
    case 'pubg':
      return '吃鸡';
    case 'arena':
      return '竞技场';
    case 'export-viewer':
      return 'export viewer';
    default:
      return '测试';
  }
}