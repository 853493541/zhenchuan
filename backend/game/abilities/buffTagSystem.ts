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
  /** Effective duration in ms (override if set, else code-defined). */
  durationMs: number | null;
  /** Code-defined duration in ms (read-only). */
  baseDurationMs: number | null;
  /** Properties set by the user override (saved to JSON). */
  properties: BuffProperty[];
  /** Properties auto-derived from the buff's effects[] in code — never saved, always read-only. */
  baseProperties: BuffProperty[];
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

/**
 * Derive base display properties from a buff's effects array.
 * DAMAGE_REDUCTION → 减伤 (value * 100, rounded)
 * INVULNERABLE    → 无敌
 * DODGE_NEXT      → 闪避 (value = count)
 */
function extractBaseProperties(effects: Array<{ type: string; value?: number }> | undefined): BuffProperty[] {
  if (!Array.isArray(effects)) return [];
  const result: BuffProperty[] = [];

  const dr = effects.find((e) => e.type === "DAMAGE_REDUCTION");
  if (dr) {
    result.push({
      type: "减伤",
      value: typeof dr.value === "number" ? Math.round(dr.value * 100) : undefined,
    });
  }

  const invuln = effects.find((e) => e.type === "INVULNERABLE");
  if (invuln) {
    result.push({ type: "无敌" });
  }

  const dodge = effects.find((e) => e.type === "DODGE_NEXT");
  if (dodge) {
    // DODGE_NEXT stores probability in 'chance' (0.0–1.0), not 'value'
    const chanceVal = (dodge as unknown as { chance?: number }).chance;
    result.push({
      type: "闪避",
      value: typeof chanceVal === "number" ? Math.round(chanceVal * 100) : 60,
    });
  }

  return result;
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
  // Allow empty array [] as a valid override sentinel (means user explicitly removed all properties)
  const normalizedProperties = Array.isArray(entry.properties) ? entry.properties : undefined;
  const normalizedDurationMs = typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
    ? Math.max(100, Math.min(300_000, Math.round(entry.durationMs)))
    : undefined;

  if (normalizedAttribute === "\u672a\u9009\u62e9" && normalizedHidden === undefined && !normalizedName && !normalizedDescription && normalizedProperties === undefined && normalizedDurationMs === undefined) {
    return null;
  }

  return {
    attribute: normalizedAttribute,
    ...(normalizedHidden === undefined ? {} : { hidden: normalizedHidden }),
    ...(normalizedName ? { name: normalizedName } : {}),
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    ...(normalizedProperties !== undefined ? { properties: normalizedProperties } : {}),
    ...(normalizedDurationMs !== undefined ? { durationMs: normalizedDurationMs } : {}),
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
    const baseDurationMs: number | null = typeof buff.durationMs === "number" ? buff.durationMs : null;

    entries.push({
      buffId: buff.buffId,
      name: buff.name,
      category,
      attribute,
      hidden,
      description: override?.description ?? normalizeDescription(buff.description) ?? "\u65e0",
      iconPath: buff.iconPath ?? undefined,
      sourceAbilityName: buff.sourceAbilityName ?? undefined,
      baseDurationMs,
      durationMs: override?.durationMs !== undefined ? override.durationMs : baseDurationMs,
      properties: override?.properties ?? [],
      baseProperties: extractBaseProperties(buff.effects),
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

export function setBuffDurationMs(buffId: number, durationMs: number): string {
  const clamped = Math.max(100, Math.min(300_000, Math.round(durationMs)));
  return updateBuffOverride(buffId, (currentOverride, baseName, baseDescription, baseHidden) =>
    sanitizeOverrideEntry(
      { ...currentOverride, durationMs: clamped },
      baseName,
      baseDescription,
      baseHidden
    )
  );
}
