import type { ActiveBuff, BuffDefinition } from "../engine/state/types";

import { buildAbilityPreload } from "./abilityPreload";
import { loadBuffEditorOverrides, saveBuffEditorOverrides } from "./buffEditorOverrides";
import { buildBuffEditorSnapshot, type BuffEditorEntry } from "./buffTagSystem";

export interface QinYinGongMingEntry extends BuffEditorEntry {
  defaultStealable: boolean;
  manualStealable: boolean;
  manuallyExcluded: boolean;
  stealable: boolean;
}

export interface QinYinGongMingSnapshot {
  updatedAt: string | null;
  buffs: QinYinGongMingEntry[];
}

function isDefaultStealable(entry: Pick<BuffEditorEntry, "attribute">) {
  return entry.attribute !== "未选择" && entry.attribute !== "无";
}

export function buildQinYinGongMingSnapshot(): QinYinGongMingSnapshot {
  const buffSnapshot = buildBuffEditorSnapshot();
  const { overrides, updatedAt } = loadBuffEditorOverrides();

  const buffs = buffSnapshot.buffs
    .filter((entry) => entry.category === "BUFF" && !entry.hidden)
    .map((entry) => {
      const manualStealable = overrides[String(entry.buffId)]?.qinYinGongMingStealable === true;
      const manuallyExcluded = overrides[String(entry.buffId)]?.qinYinGongMingUnstealable === true;
      const defaultStealable = isDefaultStealable(entry);

      return {
        ...entry,
        defaultStealable,
        manualStealable,
        manuallyExcluded,
        stealable: defaultStealable || manualStealable,
      };
    })
    .sort((left, right) => {
      const selectedDelta = Number(right.stealable) - Number(left.stealable);
      if (selectedDelta !== 0) return selectedDelta;
      const excludedDelta = Number(right.manuallyExcluded) - Number(left.manuallyExcluded);
      if (excludedDelta !== 0) return excludedDelta;
      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });

  return {
    updatedAt,
    buffs,
  };
}

export function isQinYinGongMingBuffStealable(buffId: number): boolean {
  const snapshot = buildQinYinGongMingSnapshot();
  return snapshot.buffs.some((entry) => entry.buffId === buffId && entry.stealable);
}

export function buildStolenBuffDefinition(buff: ActiveBuff): BuffDefinition {
  const remainingDurationMs = Math.max(1, (buff.expiresAt ?? Date.now()) - Date.now());
  const preloadBuff = buildAbilityPreload().buffs.find((entry) => entry.buffId === buff.buffId);

  return {
    buffId: buff.buffId,
    name: buff.name,
    category: buff.category,
    durationMs: remainingDurationMs,
    periodicMs: buff.periodicMs,
    periodicStartImmediate: buff.periodicStartImmediate,
    breakOnPlay: buff.breakOnPlay,
    cancelOnMove: buff.cancelOnMove,
    cancelOnJump: buff.cancelOnJump,
    cancelOnOutOfRange: buff.cancelOnOutOfRange,
    forwardChannel: buff.forwardChannel,
    procCooldownMs: buff.procCooldownMs,
    description: preloadBuff?.description ?? buff.name,
    originalDescription: preloadBuff?.originalDescription,
    effects: (buff.effects ?? []).map((effect) => ({ ...effect })),
  };
}

export type QinYinGongMingOverrideMode = "manual-include" | "manual-exclude" | "clear";

export function setQinYinGongMingBuffOverride(buffId: number, mode: QinYinGongMingOverrideMode) {
  const snapshot = buildBuffEditorSnapshot();
  if (!snapshot.buffs.some((entry) => entry.buffId === buffId)) {
    throw new Error("ERR_BUFF_NOT_FOUND");
  }

  const { overrides } = loadBuffEditorOverrides();
  const buffIdKey = String(buffId);
  const current = overrides[buffIdKey] ?? { attribute: "未选择" as const };
  const next = { ...current };

  if (mode === "manual-include") {
    next.qinYinGongMingStealable = true;
    delete next.qinYinGongMingUnstealable;
  } else if (mode === "manual-exclude") {
    next.qinYinGongMingUnstealable = true;
    delete next.qinYinGongMingStealable;
  } else {
    delete next.qinYinGongMingStealable;
    delete next.qinYinGongMingUnstealable;
  }

  overrides[buffIdKey] = next;
  return saveBuffEditorOverrides(overrides);
}