import { buildAbilityPreload } from "./abilityPreload";
import {
  BUFF_ATTRIBUTES,
  BuffAttribute,
  BuffEditorOverrideEntry,
  BuffProperty,
  BUFF_PROPERTY_TYPES,
  loadBuffEditorOverrides,
  saveBuffEditorOverrides,
} from "./buffEditorOverrides";

// ─── Types ──────────────────────────────────────────────────────────────────────────

export { BUFF_ATTRIBUTES, BUFF_PROPERTY_TYPES };
export type { BuffAttribute, BuffProperty };

export interface BuffEditorEntry {
  buffId: number;
  name: string;
  category: "BUFF" | "DEBUFF";
  attribute: BuffAttribute;
  hidden: boolean;
  description: string;
  iconPath?: string;
  sourceAbilityName?: string;
  properties: BuffProperty[];
}

export interface BuffEditorSnapshot {
  updatedAt: string | null;
  buffs: BuffEditorEntry[];
}

function normalizeName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function getEffectiveHidden(hidden: boolean | undefined, baseHidden: boolean) {
  return typeof hidden === "boolean" ? hidden : baseHidden;
}

function requireBaseBuff(buffId: number) {
  const { buffs } = buildAbilityPreload({ applyBuffEditorOverrides: false });
  const baseBuff = buffs.find((buff) => buff.buffId === buffId);

  if (!baseBuff) {
    throw new Error("ERR_BUFF_NOT_FOUND");
  }

  return baseBuff;
}

function sanitizeOverrideEntry(
  entry: BuffEditorOverrideEntry,
  baseName: string,
  baseDescription: string,
  baseHidden: boolean
): BuffEditorOverrideEntry | null {
  const effectiveHidden = getEffectiveHidden(entry.hidden, baseHidden);
  const normalizedAttribute: BuffAttribute = effectiveHidden ? "未选择" : entry.attribute;
  const name = normalizeName(entry.name);
  const normalizedName = name && name !== baseName ? name : undefined;
  const description = normalizeDescription(entry.description);
  const normalizedDescription = description && description !== baseDescription ? description : undefined;
  const normalizedHidden = typeof entry.hidden === "boolean" && entry.hidden !== baseHidden ? entry.hidden : undefined;
  const normalizedProperties = entry.properties && entry.properties.length > 0 ? entry.properties : undefined;

  if (normalizedAttribute === "未选择" && normalizedHidden === undefined && !normalizedName && !normalizedDescription && !normalizedProperties) {
    return null;
  }

  return {
    attribute: normalizedAttribute,
    ...(normalizedHidden === undefined ? {} : { hidden: normalizedHidden }),
    ...(normalizedName ? { name: normalizedName } : {}),
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    ...(normalizedProperties ? { properties: normalizedProperties } : {}),
  };
}

function updateBuffOverride(
  buffId: number,
  updater: (
    current: BuffEditorOverrideEntry,
    baseName: string,
    baseDescription: string,
    baseHidden: boolean
  ) => BuffEditorOverrideEntry | null
) {
  const baseBuff = requireBaseBuff(buffId);
  const baseName = normalizeName(baseBuff.name) ?? `Buff ${buffId}`;
  const baseDescription = normalizeDescription(baseBuff.description) ?? "无";
  const baseHidden = baseBuff.hiddenInStatusBar === true;
  const { overrides } = loadBuffEditorOverrides();
  const buffIdKey = String(buffId);
  const currentOverride = overrides[buffIdKey] ?? { attribute: "未选择" as BuffAttribute };
  const nextOverride = updater(currentOverride, baseName, baseDescription, baseHidden);

  if (nextOverride) {
    overrides[buffIdKey] = nextOverride;
  } else {
    delete overrides[buffIdKey];
  }

  return saveBuffEditorOverrides(overrides);
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export function buildBuffEditorSnapshot(): BuffEditorSnapshot {
  const { buffs: preloadBuffs } = buildAbilityPreload();
  const { overrides, updatedAt } = loadBuffEditorOverrides();

  // Deduplicate by buffId (keep first occurrence)
  const seen = new Set<number>();
  const entries: BuffEditorEntry[] = [];

  for (const buff of preloadBuffs) {
    if (seen.has(buff.buffId)) continue;
    seen.add(buff.buffId);

    const category: "BUFF" | "DEBUFF" =
      buff.category === "DEBUFF" ? "DEBUFF" : "BUFF";

    const override = overrides[String(buff.buffId)];
    const hidden = override?.hidden ?? buff.hiddenInStatusBar === true;
    const attribute: BuffAttribute = hidden ? "未选择" : override?.attribute ?? "未选择";

    entries.push({
      buffId: buff.buffId,
      name: buff.name,
      category,
      attribute,
      hidden,
      description: override?.description ?? normalizeDescription(buff.description) ?? "无",
      iconPath: buff.iconPath ?? undefined,
      sourceAbilityName: buff.sourceAbilityName ?? undefined,
      properties: override?.properties ?? [],
    });
  }

  return {
    updatedAt,
    buffs: entries,
  };
}

export function setBuffAttribute(buffId: number, attribute: BuffAttribute): string {
  return updateBuffOverride(buffId, (currentOverride, baseName, baseDescription, baseHidden) => {
    if (getEffectiveHidden(currentOverride.hidden, baseHidden)) {
      throw new Error("ERR_HIDDEN_BUFF_CANNOT_HAVE_ATTRIBUTE");
    }

    return sanitizeOverrideEntry({ ...currentOverride, attribute }, baseName, baseDescription, baseHidden);
  });
}

export function setBuffHidden(buffId: number, hidden: boolean): string {
  return updateBuffOverride(buffId, (currentOverride, baseName, baseDescription, baseHidden) =>
    sanitizeOverrideEntry({ ...currentOverride, hidden }, baseName, baseDescription, baseHidden)
  );
}

export function setBuffName(buffId: number, name: string): string {
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    throw new Error("ERR_INVALID_BUFF_NAME");
  }

  return updateBuffOverride(buffId, (currentOverride, baseName, baseDescription, baseHidden) =>
    sanitizeOverrideEntry(
      { ...currentOverride, name: normalizedName },
      baseName,
      baseDescription,
      baseHidden
    )
  );
}

export function setBuffDescription(buffId: number, description: string): string {
  const normalizedDescription = normalizeDescription(description);
  if (!normalizedDescription) {
    throw new Error("ERR_INVALID_BUFF_DESCRIPTION");
  }

  return updateBuffOverride(buffId, (currentOverride, baseName, baseDescription, baseHidden) =>
    sanitizeOverrideEntry(
      { ...currentOverride, description: normalizedDescription },
      baseName,
      baseDescription,
      baseHidden
    )
  );
}

export function setBuffProperties(buffId: number, properties: BuffProperty[]): string {
  return updateBuffOverride(buffId, (currentOverride, baseName, baseDescription, baseHidden) =>
    sanitizeOverrideEntry(
      { ...currentOverride, properties },
      baseName,
      baseDescription,
      baseHidden
    )
  );
}
