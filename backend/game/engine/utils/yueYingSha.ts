import type { Ability, BuffDefinition } from "../state/types";

export const YUE_YING_SHA_CONSUMABLE_ID = "yue_ying_sha";
export const YUE_YING_SHA_CONSUMABLE_NAME = "月影沙";
export const YUE_YING_SHA_BUFF_ID = 980002;

export const YUE_YING_SHA_ABILITY: Ability = {
  id: YUE_YING_SHA_CONSUMABLE_ID,
  name: YUE_YING_SHA_CONSUMABLE_NAME,
  type: "SUPPORT",
  target: "SELF",
  effects: [],
  hasteUnaffected: true,
};

export const YUE_YING_SHA_BUFF: BuffDefinition = {
  buffId: YUE_YING_SHA_BUFF_ID,
  name: YUE_YING_SHA_CONSUMABLE_NAME,
  category: "BUFF",
  durationMs: 7_000,
  breakOnPlay: true,
  description: "进入隐身并提高30%移动速度，期间无法跳跃；普通施放会结束该状态，受到命中也会立即结束。",
  effects: [
    { type: "STEALTH" },
    { type: "SPEED_BOOST", value: 0.3 },
    { type: "NO_JUMP" },
  ],
};