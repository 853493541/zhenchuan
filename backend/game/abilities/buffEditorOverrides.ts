import * as fs from "fs";
import * as path from "path";

export type BuffAttribute = "未选择" | "无" | "阴性" | "阳性" | "毒性" | "外功" | "持续伤害" | "混元" | "蛊" | "点穴";

export const BUFF_ATTRIBUTES: BuffAttribute[] = ["未选择", "无", "阴性", "阳性", "毒性", "外功", "持续伤害", "混元", "蛊", "点穴"];

export interface BuffEditorOverrideEntry {
  attribute: BuffAttribute;
  hidden?: boolean;
  name?: string;
  description?: string;
}

interface StoredBuffEditorOverrideEntry {
  attribute?: BuffAttribute;
  hidden?: boolean;
  name?: string;
  description?: string;
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

  if (attribute === "未选择" && hidden === undefined && !name && !description) {
    return null;
  }

  return {
    attribute,
    ...(hidden === undefined ? {} : { hidden }),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
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