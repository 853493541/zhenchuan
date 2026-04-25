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

export const ABILITY_RARITIES = ["精巧", "卓越", "珍奇", "稀世"] as const;
export type AbilityRarity = (typeof ABILITY_RARITIES)[number];

export const RARITY_COLOR: Record<AbilityRarity, string> = {
  "精巧": "#69db7c",   // green
  "卓越": "#74c0fc",   // blue
  "珍奇": "#cc5de8",   // purple
  "稀世": "#ff922b",   // orange
};

export const SCHOOL_TAGS = [
  "少林", "万花", "天策", "纯阳", "七秀", "藏剑", "五毒", "唐门",
  "丐帮", "明教", "苍云", "长歌", "霸刀", "蓬莱", "凌雪", "衍天",
  "药宗", "刀宗", "万灵", "段氏", "通用",
] as const;
export type AbilitySchool = (typeof SCHOOL_TAGS)[number];

export const SCHOOL_COLOR: Record<AbilitySchool, string> = {
  "七秀": "#f9a8d4",  // light pink
  "万花": "#b197fc",  // purple
  "五毒": "#60a5fa",  // blue
  "长歌": "#63e6be",  // 青色 / light green
  "药宗": "#20c997",  // darker 青色
  "天策": "#ff922b",  // orange
  "少林": "#fbbf24",  // between orange and yellow
  "明教": "#f87171",  // light red
  "苍云": "#b08060",  // 褐色
  "纯阳": "#a5d8ff",  // light blue
  "唐门": "#339af0",  // darker blue
  "藏剑": "#ffe066",  // light yellow
  "丐帮": "#ffa94d",  // between yellow and orange
  "霸刀": "#4dabf7",  // dark blue but lighter
  "蓬莱": "#ced4da",  // gray white
  "凌雪": "#e03131",  // dark red
  "衍天": "#d0bfff",  // light purple
  "刀宗": "#adb5bd",  // gray white, darker than 蓬莱
  "万灵": "#fab005",  // golden
  "段氏": "#868e96",  // gray
  "通用": "#94a3b8",  // medium gray (visible on both dark/light)
};

export const DAMAGE_TYPES = ["外功", "内功", "无"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const DAMAGE_TYPE_COLOR: Record<DamageType, string> = {
  "外功": "#ffa94d",  // orange — physical
  "内功": "#74c0fc",  // blue — magical
  "无":   "#868e96",  // gray — none
};

export type TagGroupId = "rarity" | "school" | "damageType";

export interface TagGroupDefinition {
  label: string;
  values: readonly string[];
  getColor?: (value: string) => string | undefined;
}

export const TAG_GROUP_DEFINITIONS: Record<TagGroupId, TagGroupDefinition> = {
  rarity: {
    label: "稀有度",
    values: ABILITY_RARITIES,
    getColor: (v) => RARITY_COLOR[v as AbilityRarity],
  },
  school: {
    label: "门派",
    values: SCHOOL_TAGS,
    getColor: (v) => SCHOOL_COLOR[v as AbilitySchool],
  },
  damageType: {
    label: "伤害类型",
    values: DAMAGE_TYPES,
    getColor: (v) => DAMAGE_TYPE_COLOR[v as DamageType],
  },
};

export type AbilityEditorAbility = {
  id: string;
  name: string;
  description: string;
  type: "ATTACK" | "SUPPORT" | "CONTROL" | "STANCE" | "CHANNEL";
  target: "SELF" | "OPPONENT";
  hasOverrides: boolean;
  tags: Record<string, string>;
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

