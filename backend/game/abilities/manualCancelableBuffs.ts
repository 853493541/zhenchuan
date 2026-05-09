import { loadBuffEditorOverrides, saveBuffEditorOverrides } from "./buffEditorOverrides";
import { buildBuffEditorSnapshot, type BuffEditorEntry } from "./buffTagSystem";

export interface ManualCancelableBuffEntry extends BuffEditorEntry {
  manualCancelable: boolean;
  manuallyExcluded: boolean;
  canManualCancel: boolean;
}

export interface ManualCancelableBuffSnapshot {
  updatedAt: string | null;
  buffs: ManualCancelableBuffEntry[];
}

export type ManualCancelableBuffMode = "manual-include" | "manual-exclude" | "clear";

const RUNTIME_MANUAL_CANCELABLE_BUFF_IDS = new Set([980001]);

export function isBuffManualCancelable(buffId: number): boolean {
  if (RUNTIME_MANUAL_CANCELABLE_BUFF_IDS.has(buffId)) return true;
  const { overrides } = loadBuffEditorOverrides();
  return overrides[String(buffId)]?.manualCancelable === true;
}

export function buildManualCancelableBuffSnapshot(): ManualCancelableBuffSnapshot {
  const buffSnapshot = buildBuffEditorSnapshot();
  const { overrides, updatedAt } = loadBuffEditorOverrides();

  const buffs = buffSnapshot.buffs
    .filter((entry) => entry.category === "BUFF" && !entry.hidden)
    .map((entry): ManualCancelableBuffEntry => {
      const override = overrides[String(entry.buffId)];
      const manualCancelable = override?.manualCancelable === true;
      const manuallyExcluded = override?.manualCancelExcluded === true;

      return {
        ...entry,
        manualCancelable,
        manuallyExcluded,
        canManualCancel: manualCancelable,
      };
    })
    .sort((left, right) => {
      const enabledDelta = Number(right.canManualCancel) - Number(left.canManualCancel);
      if (enabledDelta !== 0) return enabledDelta;
      const excludedDelta = Number(right.manuallyExcluded) - Number(left.manuallyExcluded);
      if (excludedDelta !== 0) return excludedDelta;
      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });

  return {
    updatedAt,
    buffs,
  };
}

export function setManualCancelableBuffOverride(buffId: number, mode: ManualCancelableBuffMode) {
  const snapshot = buildBuffEditorSnapshot();
  const entry = snapshot.buffs.find((candidate) => candidate.buffId === buffId);
  if (!entry || entry.category !== "BUFF") {
    throw new Error("ERR_BUFF_NOT_FOUND");
  }

  const { overrides } = loadBuffEditorOverrides();
  const buffIdKey = String(buffId);
  const current = overrides[buffIdKey] ?? { attribute: "未选择" as const };
  const next = { ...current };

  if (mode === "manual-include") {
    next.manualCancelable = true;
    delete next.manualCancelExcluded;
  } else if (mode === "manual-exclude") {
    next.manualCancelExcluded = true;
    delete next.manualCancelable;
  } else {
    delete next.manualCancelable;
    delete next.manualCancelExcluded;
  }

  overrides[buffIdKey] = next;
  return saveBuffEditorOverrides(overrides);
}