export const SCHOOL_TAGS = [
  "少林", "万花", "天策", "纯阳", "七秀", "藏剑", "五毒", "唐门",
  "丐帮", "明教", "苍云", "长歌", "霸刀", "蓬莱", "凌雪", "衍天",
  "药宗", "刀宗", "万灵", "段氏", "通用",
] as const;

export type SchoolTag = (typeof SCHOOL_TAGS)[number];

export const SCHOOL_COLOR: Record<SchoolTag, string> = {
  "七秀": "#f9a8d4",
  "万花": "#b197fc",
  "五毒": "#60a5fa",
  "长歌": "#63e6be",
  "药宗": "#20c997",
  "天策": "#ff922b",
  "少林": "#fbbf24",
  "明教": "#f87171",
  "苍云": "#b08060",
  "纯阳": "#a5d8ff",
  "唐门": "#339af0",
  "藏剑": "#ffe066",
  "丐帮": "#ffa94d",
  "霸刀": "#4dabf7",
  "蓬莱": "#ced4da",
  "凌雪": "#e03131",
  "衍天": "#d0bfff",
  "刀宗": "#adb5bd",
  "万灵": "#fab005",
  "段氏": "#868e96",
  "通用": "#94a3b8",
};

const SCHOOL_SET = new Set<string>(SCHOOL_TAGS);

export function isSchoolTag(value: unknown): value is SchoolTag {
  return typeof value === "string" && SCHOOL_SET.has(value);
}

export function getSchoolColor(value: unknown, fallback = "#70edbd") {
  return isSchoolTag(value) ? SCHOOL_COLOR[value] : fallback;
}