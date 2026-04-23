import { resolveBuffIconPath } from "../lib/buffIcons";

export type PropertyCatalogItem = {
  id: string;
  label: string;
  description: string;
  group: string;
};

export type AbilityPropertyState = PropertyCatalogItem & {
  enabled: boolean;
  baseEnabled: boolean;
  overridden: boolean;
};

export type AbilityEditorStat = {
  id: string;
  label: string;
  value: string;
};

export type AbilityEditorNumericSetting = {
  id: string;
  label: string;
  description: string;
  value: number;
  baseValue: number;
  overridden: boolean;
  step?: number;
};

export type AbilityEditorChannelInfo = {
  mode: "FORWARD" | "REVERSE";
  label: string;
  properties: AbilityPropertyState[];
  activePropertyIds: string[];
  availablePropertyIds: string[];
  timingSettings: AbilityEditorNumericSetting[];
  derivedStats: AbilityEditorStat[];
};

export type AbilityEditorAbility = {
  id: string;
  name: string;
  description: string;
  type: "ATTACK" | "SUPPORT" | "CONTROL" | "STANCE" | "CHANNEL";
  target: "SELF" | "OPPONENT";
  hasOverrides: boolean;
  stats: AbilityEditorStat[];
  activePropertyIds: string[];
  availablePropertyIds: string[];
  properties: AbilityPropertyState[];
  coreSettings: AbilityEditorNumericSetting[];
  damageSettings: AbilityEditorNumericSetting[];
  channelInfo?: AbilityEditorChannelInfo;
};

export type AbilityEditorSnapshot = {
  updatedAt: string | null;
  propertyCatalog: PropertyCatalogItem[];
  abilities: AbilityEditorAbility[];
};

// ─── Buff editor types ───────────────────────────────────────────────────────

export type BuffAttribute = "未选择" | "无" | "阴性" | "阳性" | "毒性" | "外功" | "持续伤害" | "混元" | "蛊" | "点穴";

export const BUFF_ATTRIBUTES: BuffAttribute[] = ["未选择", "无", "阴性", "阳性", "毒性", "外功", "持续伤害", "混元", "蛊", "点穴"];

export type BuffPropertyType = "减伤" | "无敌" | "闪避";

export const BUFF_PROPERTY_TYPES: BuffPropertyType[] = ["减伤", "无敌", "闪避"];

export interface BuffProperty {
  type: BuffPropertyType;
  value?: number;       // for 减伤: 0–100
  noOverride?: boolean; // for 减伤: 不可被顶
}

export type BuffEditorEntry = {
  buffId: number;
  name: string;
  category: "BUFF" | "DEBUFF";
  attribute: BuffAttribute;
  hidden: boolean;
  description: string;
  iconPath?: string;
  sourceAbilityName?: string;
  /** Duration in ms as exposed by the editor (override value if set, else base). */
  durationMs: number | null;
  /** Duration in ms from the code definition (read-only). */
  baseDurationMs: number | null;
  /** Properties set by the user override (saved to JSON). */
  properties: BuffProperty[];
  /** Properties auto-derived from the buff's effects[] in code — never saved, always read-only. */
  baseProperties: BuffProperty[];
};

export type BuffEditorSnapshot = {
  updatedAt: string | null;
  buffs: BuffEditorEntry[];
};

export function getBuffSubtitle(entry: Pick<BuffEditorEntry, "category" | "attribute">): string {
  // No valid attribute → no tag at all
  const validAttr = entry.attribute !== "未选择" && entry.attribute !== "无";
  if (!validAttr) return "";
  // BUFF: 属性气劲（drop 有利）
  if (entry.category === "BUFF") return `${entry.attribute}气劲`;
  // DEBUFF: 属性不利气劲
  return `${entry.attribute}不利气劲`;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

export const abilityTypeLabel: Record<AbilityEditorAbility["type"], string> = {
  ATTACK: "攻击",
  SUPPORT: "辅助",
  CONTROL: "控制",
  STANCE: "架势",
  CHANNEL: "读条",
};

export const targetTypeLabel: Record<AbilityEditorAbility["target"], string> = {
  SELF: "自身",
  OPPONENT: "敌方",
};

export function getAbilityIconByName(abilityName: string) {
  return `/icons/${abilityName}.png`;
}

export function getBuffIconPath(entry: Pick<BuffEditorEntry, "name" | "iconPath">): string {
  return resolveBuffIconPath(entry.name, entry.iconPath);
}

export function parseNumericDraft(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatUpdatedAt(value: string | null) {
  if (!value) return "尚未保存过覆盖配置";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "保存时间未知";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getSimpleDescription(description: string) {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] ?? description.trim();
}

export function getStatValue(stats: AbilityEditorStat[], id: string) {
  return stats.find((stat) => stat.id === id)?.value;
}

