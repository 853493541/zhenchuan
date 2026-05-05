import { buildAbilityPreload } from "./abilityPreload";
import { loadBuffEditorOverrides } from "./buffEditorOverrides";
import { buildBuffEditorSnapshot, clearBuffHiddenOverride, setBuffHidden, type BuffEditorEntry } from "./buffTagSystem";

export interface HiddenBuffEntry extends BuffEditorEntry {
  defaultHidden: boolean;
  manualHidden: boolean;
  manuallyVisible: boolean;
}

export interface HiddenBuffSnapshot {
  updatedAt: string | null;
  buffs: HiddenBuffEntry[];
}

export type HiddenBuffMode = "manual-include" | "manual-exclude" | "clear";

export function buildHiddenBuffSnapshot(): HiddenBuffSnapshot {
  const buffSnapshot = buildBuffEditorSnapshot();
  const baseBuffs = buildAbilityPreload({ applyBuffEditorOverrides: false }).buffs;
  const { overrides, updatedAt } = loadBuffEditorOverrides();
  const baseHiddenById = new Map<number, boolean>(
    baseBuffs.map((buff) => [buff.buffId, buff.hiddenInStatusBar === true])
  );

  const buffs = buffSnapshot.buffs
    .map((entry): HiddenBuffEntry => {
      const overrideHidden = overrides[String(entry.buffId)]?.hidden;
      return {
        ...entry,
        defaultHidden: baseHiddenById.get(entry.buffId) === true,
        manualHidden: overrideHidden === true,
        manuallyVisible: overrideHidden === false,
      };
    })
    .sort((left, right) => {
      const hiddenDelta = Number(right.hidden) - Number(left.hidden);
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

export function setHiddenBuffOverride(buffId: number, mode: HiddenBuffMode) {
  if (mode === "manual-include") {
    return setBuffHidden(buffId, true);
  }
  if (mode === "manual-exclude") {
    return setBuffHidden(buffId, false);
  }
  return clearBuffHiddenOverride(buffId);
}