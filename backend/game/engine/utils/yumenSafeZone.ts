import type { Ability, BuffDefinition, SafeZone } from "../state/types";

export const YUMEN_SAFE_ZONE_FIRST_CIRCLE = 3;
export const YUMEN_SAFE_ZONE_TOTAL_CIRCLES = 8;
export const YUMEN_SAFE_ZONE_TARGET_DIAMETERS = [200, 100, 50, 25, 0] as const;
export const YUMEN_SAFE_ZONE_INITIAL_WAIT_MS = 76_000;
export const YUMEN_SAFE_ZONE_COUNTDOWN_MS = [63_000, 50_000, 40_000, 28_000, 60_000] as const;
export const YUMEN_SAFE_ZONE_SHRINK_MS = [64_000, 52_000, 40_000, 30_000, 1_000] as const;
export const YUMEN_SAFE_ZONE_WAIT_MS = [60_000, 50_000, 40_000, 25_000, 0] as const;
export const YUMEN_SAFE_ZONE_FAST_PHASE_MS = 5_000;
export const YUMEN_SAFE_ZONE_FULL_DAMAGE_BY_CIRCLE: Record<number, number> = {
  3: 6852,
  4: 12000,
  5: 22000,
  6: 40019,
  7: 71706,
  8: 109931,
};

export type YumenSafeZoneTimelineMode = "fast" | "full";
export type YumenSafeZoneDamageMode = "test" | "full";

export function normalizeYumenSafeZoneTimelineMode(value: unknown): YumenSafeZoneTimelineMode {
  return value === "full" ? "full" : "fast";
}

export function normalizeYumenSafeZoneDamageMode(value: unknown): YumenSafeZoneDamageMode {
  return value === "full" ? "full" : "test";
}

export const YUMEN_KUANG_SHA_BUFF_ID = 990200;
export const YUMEN_KUANG_SHA_BUFF: BuffDefinition = {
  buffId: YUMEN_KUANG_SHA_BUFF_ID,
  name: "狂沙",
  category: "DEBUFF",
  durationMs: 2_500,
  breakOnPlay: false,
  description: "当前处于玉门关毒圈之外。此状态仅用于提示。",
  effects: [],
};

export const YUMEN_ZHUI_MING_BUFF_ID = 990201;
export const YUMEN_ZHUI_MING_STACK_INTERVAL_MS = 10_000;
export const YUMEN_ZHUI_MING_DAMAGE_INCREASE_PER_STACK = 0.2;
export const YUMEN_KUANG_SHA_HEAL_MULTIPLIER = 0.3;
export const YUMEN_PIERCING_DAMAGE_TYPE = "穿透伤害";
export const YUMEN_SPECTATOR_BUFF_ID = 990202;
export const YUMEN_ZHANYI_BUFF_ID = 990203;
export const YUMEN_ZHANYI_ABILITY_ID = "yumen_zhanyi";
export const YUMEN_ZHANYI_DURATION_MS = 30_000;
export const YUMEN_ZHANYI_HEAL_PER_TICK = 16_130;

export const YUMEN_ZHUI_MING_BUFF: BuffDefinition = {
  buffId: YUMEN_ZHUI_MING_BUFF_ID,
  name: "追命",
  category: "DEBUFF",
  durationMs: 30_000,
  breakOnPlay: false,
  initialStacks: 1,
  maxStacks: 5,
  description: "处于狂沙中每10秒叠加一层，持续30秒，最多5层。每层使毒圈伤害提高20%。",
  effects: [],
};

export const YUMEN_SPECTATOR_BUFF: BuffDefinition = {
  buffId: YUMEN_SPECTATOR_BUFF_ID,
  name: "观战中",
  category: "DEBUFF",
  durationMs: 7 * 24 * 60 * 60 * 1000,
  breakOnPlay: false,
  description: "已重伤离场，仅可移动观战。",
  effects: [
    { type: "STEALTH" },
    { type: "UNTARGETABLE" },
    { type: "INVULNERABLE" },
    { type: "DAMAGE_IMMUNE" },
    { type: "SPEED_BOOST", value: 1 },
    { type: "MULTI_JUMP", value: 999 },
  ],
};

export const YUMEN_ZHANYI_BUFF: BuffDefinition = {
  buffId: YUMEN_ZHANYI_BUFF_ID,
  name: "战意",
  category: "BUFF",
  durationMs: YUMEN_ZHANYI_DURATION_MS,
  periodicMs: 1_000,
  breakOnPlay: false,
  description: "重伤敌方玩家后获得，每秒回复气血，不会会心。",
  effects: [{ type: "PERIODIC_HEAL", value: YUMEN_ZHANYI_HEAL_PER_TICK, noCrit: true, scaleFlatHeal: false }],
};

export const YUMEN_SPECTATOR_ABILITY: Ability = {
  id: "yumen_spectator",
  name: "玉门观战",
  type: "SUPPORT",
  target: "SELF",
  effects: [],
  buffs: [YUMEN_SPECTATOR_BUFF],
};

export const YUMEN_ZHANYI_ABILITY: Ability = {
  id: YUMEN_ZHANYI_ABILITY_ID,
  name: "战意",
  type: "SUPPORT",
  target: "SELF",
  effects: [],
  buffs: [YUMEN_ZHANYI_BUFF],
};

const YUMEN_KUANG_SHA_REDUCED_HEAL_ABILITY_IDS = new Set(["fengxiu_diang", "changzhen", "qiandie_turui", YUMEN_ZHANYI_ABILITY_ID]);

export const YUMEN_SAFE_ZONE_ABILITY: Ability = {
  id: "yumen_sandstorm",
  name: "玉门关风暴",
  type: "SUPPORT",
  target: "SELF",
  effects: [],
  buffs: [YUMEN_KUANG_SHA_BUFF, YUMEN_ZHUI_MING_BUFF],
};

function isActiveBuff(buff: any, now = Date.now()): boolean {
  const expiresAt = Number(buff?.expiresAt ?? 0);
  return !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > now;
}

export function hasActiveYumenKuangSha(target: { buffs?: any[] } | undefined | null, now = Date.now()): boolean {
  return Array.isArray(target?.buffs) && target!.buffs.some((buff: any) => buff?.buffId === YUMEN_KUANG_SHA_BUFF_ID && isActiveBuff(buff, now));
}

export function hasActiveYumenSpectatorBuff(target: { buffs?: any[] } | undefined | null, now = Date.now()): boolean {
  return Array.isArray(target?.buffs) && target!.buffs.some((buff: any) => buff?.buffId === YUMEN_SPECTATOR_BUFF_ID && isActiveBuff(buff, now));
}

export function getYumenZhuiMingStacks(target: { buffs?: any[] } | undefined | null, now = Date.now()): number {
  if (!Array.isArray(target?.buffs)) return 0;
  const buff = target!.buffs.find((entry: any) => entry?.buffId === YUMEN_ZHUI_MING_BUFF_ID && isActiveBuff(entry, now));
  return Math.max(0, Math.min(YUMEN_ZHUI_MING_BUFF.maxStacks ?? 5, Math.floor(Number(buff?.stacks ?? 0))));
}

export function getYumenKuangShaDamageMultiplier(target: { buffs?: any[] } | undefined | null, now = Date.now()): number {
  return 1 + getYumenZhuiMingStacks(target, now) * YUMEN_ZHUI_MING_DAMAGE_INCREASE_PER_STACK;
}

export function applyYumenKuangShaHealPenalty(abilityId: string | undefined, target: { buffs?: any[] } | undefined | null, rawHeal: number, now = Date.now()): number {
  if (!abilityId || !YUMEN_KUANG_SHA_REDUCED_HEAL_ABILITY_IDS.has(abilityId) || !hasActiveYumenKuangSha(target, now)) {
    return rawHeal;
  }
  return Math.max(0, Math.floor(Number(rawHeal ?? 0) * YUMEN_KUANG_SHA_HEAL_MULTIPLIER));
}

export function getYumenSafeZoneCircleNumber(zone: Pick<SafeZone, "phase" | "stageIndex" | "targetStageIndex" | "currentHalf"> | any): number {
  const phase = zone?.phase;
  if (phase === "complete" || Number(zone?.currentHalf ?? 1) <= 0) return YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
  const rawIndex = phase === "countdown" || phase === "shrinking"
    ? Number(zone?.targetStageIndex ?? (Number(zone?.stageIndex ?? 0) + 1))
    : Number(zone?.stageIndex ?? 0);
  const stageIndex = Math.max(0, Math.floor(Number.isFinite(rawIndex) ? rawIndex : 0));
  return Math.max(YUMEN_SAFE_ZONE_FIRST_CIRCLE, Math.min(YUMEN_SAFE_ZONE_TOTAL_CIRCLES, YUMEN_SAFE_ZONE_FIRST_CIRCLE + stageIndex));
}

export function getYumenSafeZoneDps(zone: Pick<SafeZone, "phase" | "stageIndex" | "targetStageIndex" | "currentHalf"> | any): number {
  if (!zone || zone.phase === "idle") return 0;
  const circleNumber = getYumenSafeZoneCircleNumber(zone);
  if (normalizeYumenSafeZoneDamageMode(zone.damageMode) === "full") {
    return YUMEN_SAFE_ZONE_FULL_DAMAGE_BY_CIRCLE[circleNumber] ?? circleNumber;
  }
  return circleNumber;
}

export function getYumenSafeZoneInitialWaitMs(timelineMode: unknown): number {
  return normalizeYumenSafeZoneTimelineMode(timelineMode) === "fast" ? YUMEN_SAFE_ZONE_FAST_PHASE_MS : YUMEN_SAFE_ZONE_INITIAL_WAIT_MS;
}

export function getYumenSafeZoneCountdownMs(stageIndex: number, timelineMode?: unknown): number {
  if (normalizeYumenSafeZoneTimelineMode(timelineMode) === "fast") return YUMEN_SAFE_ZONE_FAST_PHASE_MS;
  const index = Math.max(0, Math.floor(Number(stageIndex) || 0));
  return YUMEN_SAFE_ZONE_COUNTDOWN_MS[index] ?? 0;
}

export function getYumenSafeZoneShrinkMs(stageIndex: number, timelineMode?: unknown): number {
  const index = Math.max(0, Math.floor(Number(stageIndex) || 0));
  if (normalizeYumenSafeZoneTimelineMode(timelineMode) === "fast") {
    return index === YUMEN_SAFE_ZONE_TARGET_DIAMETERS.length - 1 ? 1_000 : YUMEN_SAFE_ZONE_FAST_PHASE_MS;
  }
  return YUMEN_SAFE_ZONE_SHRINK_MS[index] ?? 1_000;
}

export function getYumenSafeZoneWaitMs(stageIndex: number, timelineMode?: unknown): number {
  if (normalizeYumenSafeZoneTimelineMode(timelineMode) === "fast") return YUMEN_SAFE_ZONE_FAST_PHASE_MS;
  const index = Math.max(0, Math.floor(Number(stageIndex) || 0));
  return YUMEN_SAFE_ZONE_WAIT_MS[Math.max(0, index - 1)] ?? 0;
}
