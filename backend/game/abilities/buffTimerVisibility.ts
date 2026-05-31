import { loadBuffEditorOverrides, saveBuffEditorOverrides } from "./buffEditorOverrides";
import { buildBuffEditorSnapshot, type BuffEditorEntry } from "./buffTagSystem";

export interface BuffTimerVisibilityEntry extends BuffEditorEntry {
  manuallyHidden: boolean;
  manuallyVisible: boolean;
  displaysTimer: boolean;
}

export interface BuffTimerVisibilitySnapshot {
  updatedAt: string | null;
  buffs: BuffTimerVisibilityEntry[];
}

export type BuffTimerVisibilityMode = "manual-include" | "manual-exclude" | "clear";

export function buildBuffTimerVisibilitySnapshot(): BuffTimerVisibilitySnapshot {
  const buffSnapshot = buildBuffEditorSnapshot();
  const { overrides, updatedAt } = loadBuffEditorOverrides();

  const buffs = buffSnapshot.buffs
    .filter((entry) => !entry.hidden)
    .map((entry): BuffTimerVisibilityEntry => {
      const override = overrides[String(entry.buffId)];
      const manuallyVisible = override?.timerVisible === true;
      const manuallyHidden = override?.timerVisible === false;

      return {
        ...entry,
        manuallyHidden,
        manuallyVisible,
        displaysTimer: !manuallyHidden,
      };
    })
    .sort((left, right) => {
      const hiddenDelta = Number(right.manuallyHidden) - Number(left.manuallyHidden);
      if (hiddenDelta !== 0) return hiddenDelta;
      const visibleDelta = Number(right.manuallyVisible) - Number(left.manuallyVisible);
      if (visibleDelta !== 0) return visibleDelta;
      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });

  return {
    updatedAt,
    buffs,
  };
}

export function setBuffTimerVisibilityOverride(buffId: number, mode: BuffTimerVisibilityMode) {
  const snapshot = buildBuffEditorSnapshot();
  const entry = snapshot.buffs.find((candidate) => candidate.buffId === buffId);
  if (!entry || entry.hidden) {
    throw new Error("ERR_BUFF_NOT_FOUND");
  }

  const { overrides } = loadBuffEditorOverrides();
  const buffIdKey = String(buffId);
  const current = overrides[buffIdKey] ?? { attribute: "未选择" as const };
  const next = { ...current };

  if (mode === "manual-include") {
    next.timerVisible = true;
  } else if (mode === "manual-exclude") {
    next.timerVisible = false;
  } else {
    delete next.timerVisible;
  }

  overrides[buffIdKey] = next;
  return saveBuffEditorOverrides(overrides);
}