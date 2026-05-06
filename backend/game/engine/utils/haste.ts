import type { Ability, BuffDefinition } from "../state/types";

export const BASE_HASTE_RATE_PCT = 23.54;
export const HASTE_TIMING_REDUCTION_PCT = 16.2;
export const HASTE_TIMING_FACTOR = 1 - HASTE_TIMING_REDUCTION_PCT / 100;

function isHasteUnaffectedAbility(ability: Ability | any): boolean {
  return ability?.hasteUnaffected === true;
}

function hasPeriodicDamage(buff: BuffDefinition | any): boolean {
  return Array.isArray(buff?.effects) && buff.effects.some((effect: any) => effect?.type === "PERIODIC_DAMAGE");
}

function isChannelPeriodicBuff(ability: Ability | any, buff: BuffDefinition | any): boolean {
  return ability?.type === "CHANNEL" && typeof buff?.periodicMs === "number" && buff.periodicMs > 0;
}

function getStableTickCount(durationMs: number, periodicMs: number): number | null {
  if (!Number.isFinite(durationMs) || !Number.isFinite(periodicMs) || durationMs <= 0 || periodicMs <= 0) {
    return null;
  }

  const rawTickCount = durationMs / periodicMs;
  const roundedTickCount = Math.round(rawTickCount);
  if (roundedTickCount < 1 || Math.abs(rawTickCount - roundedTickCount) > 0.001) {
    return null;
  }

  return roundedTickCount;
}

export function getHasteAdjustedTimingMs(valueMs: number, ability: Ability | any): number {
  if (isHasteUnaffectedAbility(ability)) return valueMs;
  if (!Number.isFinite(valueMs) || valueMs <= 0) return valueMs;
  return Math.max(1, Math.round(valueMs * HASTE_TIMING_FACTOR));
}

export function getHasteAdjustedPeriodicTiming(params: {
  ability: Ability | any;
  durationMs: number;
  periodicMs?: number;
}) {
  const { ability, durationMs, periodicMs } = params;
  const adjustedDurationMs = getHasteAdjustedTimingMs(durationMs, ability);

  if (periodicMs === undefined || !Number.isFinite(periodicMs) || periodicMs <= 0 || isHasteUnaffectedAbility(ability)) {
    return { durationMs: adjustedDurationMs, periodicMs };
  }

  let adjustedPeriodicMs = getHasteAdjustedTimingMs(periodicMs, ability);
  const stableTickCount = getStableTickCount(durationMs, periodicMs);
  if (stableTickCount !== null) {
    adjustedPeriodicMs = Math.max(1, Math.floor(adjustedDurationMs / stableTickCount));
  }

  return { durationMs: adjustedDurationMs, periodicMs: adjustedPeriodicMs };
}

export function shouldApplyHasteToBuffTiming(ability: Ability | any, buff: BuffDefinition | any): boolean {
  if (isHasteUnaffectedAbility(ability)) return false;
  return isChannelPeriodicBuff(ability, buff) || hasPeriodicDamage(buff);
}

function getHasteAdjustedBuffEffects(ability: Ability | any, buff: BuffDefinition | any) {
  if (!Array.isArray(buff?.effects) || isHasteUnaffectedAbility(ability)) return buff.effects;

  return buff.effects.map((effect: any) => {
    if (!Number.isFinite(effect?.delayMs) || effect.delayMs <= 0) return effect;
    return {
      ...effect,
      delayMs: getHasteAdjustedTimingMs(effect.delayMs, ability),
    };
  });
}

export function getHasteAdjustedBuffTiming<T extends BuffDefinition>(ability: Ability | any, buff: T): T {
  if (!shouldApplyHasteToBuffTiming(ability, buff)) return buff;

  const adjustedTiming = getHasteAdjustedPeriodicTiming({
    ability,
    durationMs: buff.durationMs,
    periodicMs: buff.periodicMs,
  });

  return {
    ...buff,
    durationMs: adjustedTiming.durationMs,
    effects: getHasteAdjustedBuffEffects(ability, buff) as T["effects"],
    ...(adjustedTiming.periodicMs !== undefined ? { periodicMs: adjustedTiming.periodicMs } : {}),
  };
}
