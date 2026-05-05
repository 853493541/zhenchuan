import { BuffProperty, loadBuffEditorOverrides, saveBuffEditorOverrides } from "./buffEditorOverrides";
import { buildBuffEditorSnapshot, type BuffEditorEntry } from "./buffTagSystem";

export interface DamageReductionOverrideEntry extends BuffEditorEntry {
  damageReductionValue: number;
  manualCanOverride: boolean;
  manualNoOverride: boolean;
  canOverride: boolean;
}

export interface DamageReductionOverrideSnapshot {
  updatedAt: string | null;
  buffs: DamageReductionOverrideEntry[];
}

function getDamageReductionProperty(properties: BuffProperty[] | undefined) {
  return properties?.find((property) => property.type === "减伤") ?? null;
}

function normalizeDamageReductionValue(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100));
}

export function buildDamageReductionOverrideSnapshot(): DamageReductionOverrideSnapshot {
  const buffSnapshot = buildBuffEditorSnapshot();
  const { overrides, updatedAt } = loadBuffEditorOverrides();

  const buffs = buffSnapshot.buffs
    .flatMap((entry): DamageReductionOverrideEntry[] => {
      if (entry.hidden) return [];

      const override = overrides[String(entry.buffId)];
      const overrideDr = getDamageReductionProperty(override?.properties);
      const baseDr = getDamageReductionProperty(entry.baseProperties);
      const effectiveDr = override?.properties !== undefined ? overrideDr : baseDr;
      if (!effectiveDr) return [];

      const manualNoOverride = overrideDr?.noOverride === true;
      const manualCanOverride = overrideDr !== null && overrideDr !== undefined && overrideDr.noOverride !== true;

      return [{
        ...entry,
        damageReductionValue: normalizeDamageReductionValue(effectiveDr.value),
        manualCanOverride,
        manualNoOverride,
        canOverride: !manualNoOverride,
      }];
    })
    .sort((left, right) => {
      const noOverrideDelta = Number(right.manualNoOverride) - Number(left.manualNoOverride);
      if (noOverrideDelta !== 0) return noOverrideDelta;
      const canOverrideDelta = Number(right.manualCanOverride) - Number(left.manualCanOverride);
      if (canOverrideDelta !== 0) return canOverrideDelta;
      const valueDelta = right.damageReductionValue - left.damageReductionValue;
      if (valueDelta !== 0) return valueDelta;
      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });

  return {
    updatedAt,
    buffs,
  };
}

export type DamageReductionOverrideMode = "can-override" | "no-override" | "clear";

export function setDamageReductionOverride(buffId: number, mode: DamageReductionOverrideMode) {
  const snapshot = buildDamageReductionOverrideSnapshot();
  const entry = snapshot.buffs.find((candidate) => candidate.buffId === buffId);
  if (!entry) {
    throw new Error("ERR_BUFF_NOT_FOUND");
  }

  const { overrides } = loadBuffEditorOverrides();
  const buffIdKey = String(buffId);
  const current = overrides[buffIdKey] ?? { attribute: "未选择" as const };
  const next = { ...current };
  const nonDamageReductionProperties = (current.properties ?? []).filter(
    (property) => property.type !== "减伤"
  );

  if (mode === "clear") {
    if (nonDamageReductionProperties.length > 0) {
      next.properties = nonDamageReductionProperties;
    } else {
      delete next.properties;
    }
  } else {
    next.properties = [
      ...nonDamageReductionProperties,
      {
        type: "减伤",
        value: entry.damageReductionValue,
        noOverride: mode === "no-override",
      },
    ];
  }

  overrides[buffIdKey] = next;
  return saveBuffEditorOverrides(overrides);
}
