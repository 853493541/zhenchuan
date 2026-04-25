import * as fs from "fs";
import * as path from "path";

export type BuffAttribute = "未选择" | "无" | "阴性" | "阳性" | "毒性" | "外功" | "持续伤害" | "混元" | "蛊" | "点穴";

export const BUFF_ATTRIBUTES: BuffAttribute[] = ["未选择", "无", "阴性", "阳性", "毒性", "外功", "持续伤害", "混元", "蛊", "点穴"];

export type BuffPropertyType = "减伤" | "无敌" | "闪避" | "外功闪避";

export const BUFF_PROPERTY_TYPES: BuffPropertyType[] = ["减伤", "无敌", "闪避", "外功闪避"];

export interface BuffProperty {
  type: BuffPropertyType;
  value?: number;       // for 减伤: 0–100
  noOverride?: boolean; // for 减伤: 不可被顶
}

export interface BuffEditorOverrideEntry {
  attribute: BuffAttribute;
  hidden?: boolean;
  name?: string;
  description?: string;
  properties?: BuffProperty[];
  durationMs?: number;
}

interface StoredBuffEditorOverrideEntry {
  attribute?: BuffAttribute;
  hidden?: boolean;
  name?: string;
  description?: string;
  durationMs?: number;
}

interface StoredBuffEditorOverrides {
  version: number;
  updatedAt: string | null;
  buffs: Record<string, BuffAttribute | StoredBuffEditorOverrideEntry>;
}

const OVERRIDE_FILE_VERSION = 3;

function resolveOverrideFilePath() {
  const candidates = [
    path.resolve(process.cwd(), "game/abilities/buff-attribute-overrides.json"),
    path.resolve(process.cwd(), "backend/game/abilities/buff-attribute-overrides.json"),
    path.resolve(__dirname, "buff-attribute-overrides.json"),
    path.resolve(__dirname, "../../../game/abilities/buff-attribute-overrides.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function isValidAttribute(value: unknown): value is BuffAttribute {
  return typeof value === "string" && (BUFF_ATTRIBUTES as string[]).includes(value);
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDurationMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  // 100ms min (0.1s), 300s max
  return Math.max(100, Math.min(300_000, Math.round(value)));
}

function normalizeProperties(value: unknown): BuffProperty[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: BuffProperty[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const type = (item as Record<string, unknown>).type;
    if (type !== "减伤" && type !== "无敌" && type !== "闪避" && type !== "外功闪避") continue;
    const prop: BuffProperty = { type: type as BuffPropertyType };
    if (type === "减伤") {
      const rawValue = (item as Record<string, unknown>).value;
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        prop.value = Math.max(0, Math.min(100, rawValue));
      }
      const rawNoOverride = (item as Record<string, unknown>).noOverride;
      if (typeof rawNoOverride === "boolean") {
        prop.noOverride = rawNoOverride;
      }
    }
    if (type === "闪避" || type === "外功闪避") {
      const rawValue = (item as Record<string, unknown>).value;
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        prop.value = Math.max(0, Math.min(100, Math.round(rawValue)));
      }
    }
    result.push(prop);
  }
  // Return [] for explicitly-empty arrays (sentinel: user cleared all properties)
  return result;
}

function normalizeName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAttribute(value: unknown, treatLegacyWuAsUnselected: boolean) {
  if (typeof value !== "string") return null;

  if (treatLegacyWuAsUnselected && value === "无") {
    return "未选择" as BuffAttribute;
  }

  return isValidAttribute(value) ? value : null;
}

function normalizeOverrideEntry(
  value: BuffAttribute | StoredBuffEditorOverrideEntry | undefined,
  treatLegacyWuAsUnselected = false
): BuffEditorOverrideEntry | null {
  const normalizedAttribute = normalizeAttribute(value, treatLegacyWuAsUnselected);
  if (normalizedAttribute) {
    return { attribute: normalizedAttribute };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const attribute = normalizeAttribute(value.attribute, treatLegacyWuAsUnselected) ?? "未选择";
  const hidden = typeof value.hidden === "boolean" ? value.hidden : undefined;
  const name = normalizeName(value.name);
  const description = normalizeDescription(value.description);
  const properties = normalizeProperties((value as Record<string, unknown>).properties);
  const durationMs = normalizeDurationMs((value as Record<string, unknown>).durationMs);

  if (attribute === "\u672a\u9009\u62e9" && hidden === undefined && !name && !description && properties === undefined && durationMs === undefined) {
    return null;
  }

  return {
    attribute,
    ...(hidden === undefined ? {} : { hidden }),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    // Save even if empty [] \u2014 empty array is a valid sentinel meaning "user cleared all properties"
    ...(properties !== undefined ? { properties } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export function loadBuffEditorOverrides(): {
  overrides: Record<string, BuffEditorOverrideEntry>;
  updatedAt: string | null;
} {
  const filePath = resolveOverrideFilePath();

  if (!fs.existsSync(filePath)) {
    return { overrides: {}, updatedAt: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<StoredBuffEditorOverrides>;
    const rawBuffs = parsed.buffs ?? {};
    const overrides: Record<string, BuffEditorOverrideEntry> = {};
    const treatLegacyWuAsUnselected = typeof parsed.version === "number" ? parsed.version < OVERRIDE_FILE_VERSION : true;

    for (const [buffIdStr, rawEntry] of Object.entries(rawBuffs)) {
      const normalizedEntry = normalizeOverrideEntry(rawEntry, treatLegacyWuAsUnselected);
      if (normalizedEntry) {
        overrides[buffIdStr] = normalizedEntry;
      }
    }

    return {
      overrides,
      updatedAt:
        typeof parsed.updatedAt === "string" || parsed.updatedAt === null ? parsed.updatedAt : null,
    };
  } catch (error) {
    console.error("[BuffEditorOverrides] Failed to read buff overrides", error);
    return { overrides: {}, updatedAt: null };
  }
}

export function saveBuffEditorOverrides(overrides: Record<string, BuffEditorOverrideEntry>) {
  const filePath = resolveOverrideFilePath();
  const updatedAt = new Date().toISOString();
  const normalizedBuffs: StoredBuffEditorOverrides["buffs"] = {};

  for (const [buffIdStr, rawEntry] of Object.entries(overrides)) {
    const normalizedEntry = normalizeOverrideEntry(rawEntry);
    if (normalizedEntry) {
      normalizedBuffs[buffIdStr] = normalizedEntry;
    }
  }

  const payload: StoredBuffEditorOverrides = {
    version: OVERRIDE_FILE_VERSION,
    updatedAt,
    buffs: normalizedBuffs,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  return updatedAt;
}

/**
 * Apply property overrides to a buff's effects array.
 * Used both by abilityPreload (for UI display) and buffRuntime (for engine behavior).
 *
 * Mapping:
 *   减伤  → DAMAGE_REDUCTION  (value 0-100 → 0-1.0)
 *   无敌  → INVULNERABLE      (boolean presence)
 *   闪避  → DODGE             (value 0-100% → chance 0-1.0)
 */
export function applyPropertyOverridesToEffects(
  buff: { effects?: Array<{ type: string; value?: number; chance?: number }> },
  properties: BuffProperty[]
): Array<{ type: string; value?: number; chance?: number }> {
  const effects = [...(buff.effects || [])] as Array<{ type: string; value?: number; chance?: number }>;

  // 减伤 ↔ DAMAGE_REDUCTION
  const drProp = properties.find((p) => p.type === "减伤");
  const drIdx = effects.findIndex((e) => e.type === "DAMAGE_REDUCTION");
  if (drProp) {
    const val = drProp.value !== undefined
      ? drProp.value / 100
      : drIdx >= 0
        ? (effects[drIdx].value ?? 0)
        : 0;
    if (drIdx >= 0) {
      effects[drIdx] = { ...effects[drIdx], value: val };
    } else {
      effects.push({ type: "DAMAGE_REDUCTION", value: val });
    }
  } else if (drIdx >= 0) {
    effects.splice(drIdx, 1);
  }

  // 无敌 ↔ INVULNERABLE
  const wudiProp = properties.find((p) => p.type === "无敌");
  const invIdx = effects.findIndex((e) => e.type === "INVULNERABLE");
  if (wudiProp) {
    if (invIdx < 0) effects.push({ type: "INVULNERABLE" });
  } else if (invIdx >= 0) {
    effects.splice(invIdx, 1);
  }

  // 闪避 ↔ DODGE (uses 'chance' field, 0.0–1.0)
  const shanbiProp = properties.find((p) => p.type === "闪避");
  const dodgeIdx = effects.findIndex((e) => e.type === "DODGE");
  if (shanbiProp) {
    const chance = (shanbiProp.value !== undefined ? shanbiProp.value : 60) / 100;
    if (dodgeIdx >= 0) {
      // preserve existing fields, update/add chance
      const { value: _v, ...rest } = effects[dodgeIdx] as Record<string, unknown>;
      effects[dodgeIdx] = { ...rest, chance } as typeof effects[number];
    } else {
      effects.push({ type: "DODGE", chance });
    }
  } else if (dodgeIdx >= 0) {
    effects.splice(dodgeIdx, 1);
  }

  // 外功闪避 ↔ PHYSICAL_DODGE (uses 'chance' field, 0.0–1.0)
  const physDodgeProp = properties.find((p) => p.type === "外功闪避");
  const physDodgeIdx = effects.findIndex((e) => e.type === "PHYSICAL_DODGE");
  if (physDodgeProp) {
    const chance = (physDodgeProp.value !== undefined ? physDodgeProp.value : 60) / 100;
    if (physDodgeIdx >= 0) {
      const { value: _v, ...rest } = effects[physDodgeIdx] as Record<string, unknown>;
      effects[physDodgeIdx] = { ...rest, chance } as typeof effects[number];
    } else {
      effects.push({ type: "PHYSICAL_DODGE", chance });
    }
  } else if (physDodgeIdx >= 0) {
    effects.splice(physDodgeIdx, 1);
  }

  return effects;
}