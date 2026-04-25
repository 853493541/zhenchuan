import * as fs from "fs";
import * as path from "path";

import { Ability } from "../engine/state/types";
import { AbilityEffect, BuffEffect } from "../engine/state/types/effects";

export type AbilityWithDescription = Ability & { description: string };
export type AbilityRecord = Record<string, AbilityWithDescription>;

export type AbilityPropertyId =
  | "allowWhileControlled"
  | "allowWhileKnockedBack"
  | "cleanseRootSlow"
  | "cannotCastWhileRooted"
  | "requiresGrounded"
  | "requiresStanding"
  | "qinggong"
  | "allowGroundCastWithoutTarget"
  | "ignoreFacingRequirement"
  | "noGcd"
  | "isCommon"
  | "reverseChannel"
  | "channelCanMove"
  | "channelCanJump";

export const ABILITY_RARITIES = ["精巧", "卓越", "珍奇", "稀世"] as const;
export type AbilityRarity = (typeof ABILITY_RARITIES)[number];

export const SCHOOL_TAGS = [
  "七秀", "万花", "五毒", "长歌", "药宗", "天策", "少林", "明教",
  "苍云", "纯阳", "唐门", "藏剑", "丐帮", "霸刀", "蓬莱", "凌雪",
  "衍天", "刀宗", "万灵", "段氏", "通用",
] as const;
export type AbilitySchool = (typeof SCHOOL_TAGS)[number];

export const DAMAGE_TYPES = ["外功", "内功", "无"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export type TagGroupId = "rarity" | "school" | "damageType";

export interface TagGroupDefinition {
  label: string;
  values: readonly string[];
}

export const TAG_GROUP_DEFINITIONS: Record<TagGroupId, TagGroupDefinition> = {
  rarity: { label: "稀有度", values: ABILITY_RARITIES },
  school: { label: "门派", values: SCHOOL_TAGS },
  damageType: { label: "伤害类型", values: DAMAGE_TYPES },
};

export interface AbilityEditorOverrideEntry {
  properties?: Partial<Record<AbilityPropertyId, boolean>>;
  numeric?: Record<string, number>;
  /** tag group → tag value (e.g. { rarity: "稀世", school: "少林" }) */
  tags?: Record<string, string>;
}

export type AbilityEditorOverrideMap = Record<string, AbilityEditorOverrideEntry>;

export interface AbilityEditorPropertyDefinition {
  id: AbilityPropertyId;
  label: string;
  description: string;
  group: string;
}

export interface AbilityEditorPropertyState extends AbilityEditorPropertyDefinition {
  enabled: boolean;
  baseEnabled: boolean;
  overridden: boolean;
}

export interface AbilityEditorStat {
  id: string;
  label: string;
  value: string;
}

export interface AbilityEditorNumericSetting {
  id: string;
  label: string;
  description: string;
  value: number;
  baseValue: number;
  overridden: boolean;
  step?: number;
}

export interface AbilityEditorChannelInfo {
  mode: "FORWARD" | "REVERSE";
  label: string;
  properties: AbilityEditorPropertyState[];
  activePropertyIds: AbilityPropertyId[];
  availablePropertyIds: AbilityPropertyId[];
  timingSettings: AbilityEditorNumericSetting[];
  derivedStats: AbilityEditorStat[];
}

export interface AbilityEditorAbilityEntry {
  id: string;
  name: string;
  description: string;
  type: Ability["type"];
  target: Ability["target"];
  hasOverrides: boolean;
  tags: Record<string, string>;
  stats: AbilityEditorStat[];
  activePropertyIds: AbilityPropertyId[];
  availablePropertyIds: AbilityPropertyId[];
  properties: AbilityEditorPropertyState[];
  coreSettings: AbilityEditorNumericSetting[];
  damageSettings: AbilityEditorNumericSetting[];
  channelInfo?: AbilityEditorChannelInfo;
}

interface AbilityPropertyDefinition extends AbilityEditorPropertyDefinition {
  isApplicable: (ability: AbilityWithDescription) => boolean;
  getValue: (ability: AbilityWithDescription) => boolean;
  setValue: (ability: AbilityWithDescription, enabled: boolean) => void;
}

interface AbilityNumericFieldDefinition {
  id: string;
  label: string;
  description: string;
  order: number;
  step?: number;
  getValue: (ability: AbilityWithDescription) => number;
  setValue: (ability: AbilityWithDescription, value: number) => void;
}

interface StoredAbilityEditorOverrides {
  version: number;
  updatedAt: string | null;
  abilities: AbilityEditorOverrideMap | Record<string, Partial<Record<AbilityPropertyId, boolean>>>;
}

interface ChannelAccessor {
  kind: "pure" | "buff";
  getMode: (ability: AbilityWithDescription) => "FORWARD" | "REVERSE";
  setMode: (ability: AbilityWithDescription, mode: "FORWARD" | "REVERSE") => void;
  getDurationMs: (ability: AbilityWithDescription) => number;
  setDurationMs: (ability: AbilityWithDescription, value: number) => void;
  getCancelOnMove: (ability: AbilityWithDescription) => boolean;
  setCancelOnMove: (ability: AbilityWithDescription, value: boolean) => void;
  getCancelOnJump: (ability: AbilityWithDescription) => boolean;
  setCancelOnJump: (ability: AbilityWithDescription, value: boolean) => void;
  getTickCount: (ability: AbilityWithDescription) => number | null;
  setTickCount: (ability: AbilityWithDescription, value: number) => void;
  getIntervalMs: (ability: AbilityWithDescription) => number | null;
}

const OVERRIDE_FILE_VERSION = 1;
const LEGACY_GCD_PROPERTY_ID = "gcd";
const MS_PER_GAME_TICK = 1000 / 30;

const DAMAGE_VALUE_EFFECT_LABELS: Partial<Record<AbilityEffect["type"], string>> = {
  DAMAGE: "直接伤害",
  BONUS_DAMAGE_IF_TARGET_HP_GT: "追加伤害",
  PERIODIC_DAMAGE: "持续伤害",
  CHANNEL_AOE_TICK: "引导范围伤害",
  TIMED_AOE_DAMAGE: "延时范围伤害",
  TIMED_SELF_DAMAGE: "延时自身伤害",
  TIMED_AOE_DAMAGE_IF_SELF_HP_GT: "条件延时范围伤害",
  BAIZU_AOE: "范围初始伤害",
  ON_PLAY_DAMAGE: "出招触发伤害",
  STACK_ON_HIT_DAMAGE: "层数触发伤害",
  STACK_ON_HIT_GUAN_TI_HEAL: "层数触发贯体回血",
  SCHEDULED_DAMAGE: "计划伤害",
  DELAYED_DAMAGE: "延时伤害",
};

const DAMAGE_VALUE_EFFECT_TYPES = new Set<AbilityEffect["type"]>([
  "DAMAGE",
  "BONUS_DAMAGE_IF_TARGET_HP_GT",
  "PERIODIC_DAMAGE",
  "CHANNEL_AOE_TICK",
  "TIMED_AOE_DAMAGE",
  "TIMED_SELF_DAMAGE",
  "TIMED_AOE_DAMAGE_IF_SELF_HP_GT",
  "BAIZU_AOE",
  "ON_PLAY_DAMAGE",
  "STACK_ON_HIT_DAMAGE",
  "SCHEDULED_DAMAGE",
  "DELAYED_DAMAGE",
]);

function hasEffectFlag(
  ability: AbilityWithDescription,
  flag: "allowWhileControlled" | "allowWhileKnockedBack" | "cleanseRootSlow",
  effectType?: AbilityEffect["type"]
) {
  return Array.isArray(ability.effects)
    ? ability.effects.some((effect) => {
        if (effectType && effect.type !== effectType) return false;
        return (effect as any)[flag] === true;
      })
    : false;
}

function hasEffectType(
  ability: AbilityWithDescription,
  effectType: AbilityEffect["type"]
) {
  return Array.isArray(ability.effects)
    ? ability.effects.some((effect) => effect.type === effectType)
    : false;
}

function stripEffectFlag(
  ability: AbilityWithDescription,
  flag: "allowWhileControlled" | "allowWhileKnockedBack" | "cleanseRootSlow",
  effectType?: AbilityEffect["type"]
) {
  if (!Array.isArray(ability.effects) || ability.effects.length === 0) {
    return;
  }

  ability.effects = ability.effects.map((effect) => {
    if (effectType && effect.type !== effectType) {
      return effect;
    }

    if ((effect as any)[flag] !== true) {
      return effect;
    }

    const nextEffect = { ...effect } as Record<string, unknown>;
    delete nextEffect[flag];
    return nextEffect as unknown as AbilityEffect;
  });
}

function setBooleanAbilityField(
  ability: AbilityWithDescription,
  field:
    | "gcd"
    | "isCommon"
    | "qinggong"
    | "cannotCastWhileRooted"
    | "requiresGrounded"
    | "requiresStanding"
    | "allowGroundCastWithoutTarget",
  enabled: boolean
) {
  if (enabled) {
    (ability as any)[field] = true;
    return;
  }

  delete (ability as any)[field];
}

function isDamageValueEffectType(type: AbilityEffect["type"]): boolean {
  return DAMAGE_VALUE_EFFECT_TYPES.has(type);
}

function getDamageEffectLabel(type: AbilityEffect["type"]) {
  return DAMAGE_VALUE_EFFECT_LABELS[type] ?? "伤害";
}

function getValueAtPath(root: unknown, path: Array<string | number>): unknown {
  let current: any = root;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key as keyof typeof current];
  }
  return current;
}

function setValueAtPath(
  root: Record<string, unknown>,
  path: Array<string | number>,
  value: number
) {
  let current: any = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    current = current[path[index] as keyof typeof current];
    if (current == null) {
      throw new Error("ERR_INVALID_ABILITY_NUMERIC_FIELD");
    }
  }

  current[path[path.length - 1] as keyof typeof current] = value;
}

function formatSecondsFromTicks(ticks: number | undefined) {
  if (ticks === undefined || ticks <= 0) return "无冷却";

  const seconds = ticks / 30;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1).replace(/\.0$/, "")}秒`;
}

function formatSecondsFromMs(ms: number) {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}秒`;
}

function formatGameTicksFromMs(ms: number) {
  const ticks = ms / MS_PER_GAME_TICK;
  return `${Number.isInteger(ticks) ? ticks : ticks.toFixed(1).replace(/\.0$/, "")} Tick`;
}

function createNumericFieldDefinition(params: {
  id: string;
  label: string;
  description: string;
  order: number;
  path: Array<string | number>;
  step?: number;
}) {
  const { id, label, description, order, path, step } = params;

  return {
    id,
    label,
    description,
    order,
    step,
    getValue: (ability: AbilityWithDescription) => Number(getValueAtPath(ability, path) ?? 0),
    setValue: (ability: AbilityWithDescription, value: number) => {
      setValueAtPath(ability as unknown as Record<string, unknown>, path, value);
    },
  } satisfies AbilityNumericFieldDefinition;
}

function getChannelAccessor(ability: AbilityWithDescription): ChannelAccessor | null {
  if (ability.type !== "CHANNEL") {
    return null;
  }

  if (Array.isArray(ability.buffs) && ability.buffs.length > 0) {
    const buffIndex = 0;
    return {
      kind: "buff",
      getMode: (targetAbility) =>
        (targetAbility.buffs?.[buffIndex] as any)?.forwardChannel === true ? "FORWARD" : "REVERSE",
      setMode: (targetAbility, mode) => {
        (targetAbility.buffs?.[buffIndex] as any).forwardChannel = mode === "FORWARD";
      },
      getDurationMs: (targetAbility) => targetAbility.buffs?.[buffIndex]?.durationMs ?? 0,
      setDurationMs: (targetAbility, value) => {
        if (!targetAbility.buffs?.[buffIndex]) {
          throw new Error("ERR_INVALID_ABILITY_NUMERIC_FIELD");
        }
        targetAbility.buffs[buffIndex].durationMs = value;
      },
      getCancelOnMove: (targetAbility) => targetAbility.buffs?.[buffIndex]?.cancelOnMove === true,
      setCancelOnMove: (targetAbility, value) => {
        if (!targetAbility.buffs?.[buffIndex]) {
          throw new Error("ERR_INVALID_ABILITY_NUMERIC_FIELD");
        }
        targetAbility.buffs[buffIndex].cancelOnMove = value;
      },
      getCancelOnJump: (targetAbility) => targetAbility.buffs?.[buffIndex]?.cancelOnJump === true,
      setCancelOnJump: (targetAbility, value) => {
        if (!targetAbility.buffs?.[buffIndex]) {
          throw new Error("ERR_INVALID_ABILITY_NUMERIC_FIELD");
        }
        targetAbility.buffs[buffIndex].cancelOnJump = value;
      },
      getTickCount: (targetAbility) => {
        const channelBuff = targetAbility.buffs?.[buffIndex];
        if (!channelBuff?.periodicMs || channelBuff.periodicMs <= 0) return null;
        return channelBuff.durationMs / channelBuff.periodicMs;
      },
      setTickCount: (targetAbility, value) => {
        const channelBuff = targetAbility.buffs?.[buffIndex];
        if (!channelBuff) {
          throw new Error("ERR_INVALID_ABILITY_NUMERIC_FIELD");
        }
        const clampedValue = Math.max(1, Math.round(value));
        channelBuff.periodicMs = Math.max(1, Math.round(channelBuff.durationMs / clampedValue));
      },
      getIntervalMs: (targetAbility) => targetAbility.buffs?.[buffIndex]?.periodicMs ?? null,
    };
  }

  return {
    kind: "pure",
    getMode: (targetAbility) => (((targetAbility as any).channelForward ?? true) ? "FORWARD" : "REVERSE"),
    setMode: (targetAbility, mode) => {
      (targetAbility as any).channelForward = mode === "FORWARD";
    },
    getDurationMs: (targetAbility) => (targetAbility as any).channelDurationMs ?? 2_000,
    setDurationMs: (targetAbility, value) => {
      (targetAbility as any).channelDurationMs = value;
    },
    getCancelOnMove: (targetAbility) => ((targetAbility as any).channelCancelOnMove ?? true) === true,
    setCancelOnMove: (targetAbility, value) => {
      (targetAbility as any).channelCancelOnMove = value;
    },
    getCancelOnJump: (targetAbility) => ((targetAbility as any).channelCancelOnJump ?? true) === true,
    setCancelOnJump: (targetAbility, value) => {
      (targetAbility as any).channelCancelOnJump = value;
    },
    getTickCount: () => null,
    setTickCount: () => {
      throw new Error("ERR_INVALID_ABILITY_NUMERIC_FIELD");
    },
    getIntervalMs: () => null,
  };
}

function buildDamageFieldDefinitions(baseAbility: AbilityWithDescription) {
  const definitions: AbilityNumericFieldDefinition[] = [];

  baseAbility.effects.forEach((effect, effectIndex) => {
    if (isDamageValueEffectType(effect.type) && typeof effect.value === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.value`,
          label: getDamageEffectLabel(effect.type),
          description: `技能效果 ${effectIndex + 1}`,
          order: 200 + effectIndex,
          path: ["effects", effectIndex, "value"],
          step: 1,
        })
      );
    }

    if (effect.type === "DIRECTIONAL_DASH" && typeof effect.routeDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.routeDamage`,
          label: "冲刺路径伤害",
          description: `技能效果 ${effectIndex + 1}`,
          order: 240 + effectIndex,
          path: ["effects", effectIndex, "routeDamage"],
          step: 1,
        })
      );
    }
  });

  (baseAbility.buffs ?? []).forEach((buff, buffIndex) => {
    buff.effects.forEach((effect: BuffEffect, effectIndex) => {
      if (isDamageValueEffectType(effect.type) && typeof effect.value === "number") {
        definitions.push(
          createNumericFieldDefinition({
            id: `buffs.${buffIndex}.effects.${effectIndex}.value`,
            label: `${buff.name} · ${getDamageEffectLabel(effect.type)}`,
            description: `来自 Buff ${buff.name}`,
            order: 300 + buffIndex * 20 + effectIndex,
            path: ["buffs", buffIndex, "effects", effectIndex, "value"],
            step: 1,
          })
        );
      }
    });
  });

  return definitions;
}

function buildCoreFieldDefinitions(baseAbility: AbilityWithDescription) {
  const definitions: AbilityNumericFieldDefinition[] = [
    createNumericFieldDefinition({
      id: "cooldownTicks",
      label: "冷却 Tick",
      description: "30 Tick = 1 秒",
      order: 10,
      path: ["cooldownTicks"],
      step: 1,
    }),
  ];

  if (typeof baseAbility.range === "number") {
    definitions.push(
      createNumericFieldDefinition({
        id: "range",
        label: "施放范围",
        description: "技能最大施放距离（尺）",
        order: 20,
        path: ["range"],
        step: 1,
      })
    );
  }

  if (typeof baseAbility.minRange === "number") {
    definitions.push(
      createNumericFieldDefinition({
        id: "minRange",
        label: "最小距离",
        description: "技能最小施放距离（尺）",
        order: 25,
        path: ["minRange"],
        step: 1,
      })
    );
  }

  return definitions;
}

function buildChannelTimingFieldDefinitions(baseAbility: AbilityWithDescription) {
  const channelAccessor = getChannelAccessor(baseAbility);
  if (!channelAccessor) {
    return [];
  }

  const definitions: AbilityNumericFieldDefinition[] = [
    {
      id: "channel.durationMs",
      label: "读条时长 (ms)",
      description: "读条总时长，单位毫秒",
      order: 40,
      step: 100,
      getValue: (ability) => channelAccessor.getDurationMs(ability),
      setValue: (ability, value) => {
        channelAccessor.setDurationMs(ability, Math.max(0, Math.round(value)));
      },
    },
  ];

  if (channelAccessor.kind === "buff" && channelAccessor.getTickCount(baseAbility) !== null) {
    definitions.push({
      id: "channel.tickCount",
      label: "读条跳数",
      description: "逆读条总共会跳多少次伤害或治疗",
      order: 50,
      step: 1,
      getValue: (ability) => channelAccessor.getTickCount(ability) ?? 0,
      setValue: (ability, value) => {
        channelAccessor.setTickCount(ability, value);
      },
    });
  }

  return definitions;
}

function buildAllNumericFieldDefinitions(baseAbility: AbilityWithDescription) {
  return [
    ...buildCoreFieldDefinitions(baseAbility),
    ...buildChannelTimingFieldDefinitions(baseAbility),
    ...buildDamageFieldDefinitions(baseAbility),
  ].sort((left, right) => left.order - right.order);
}

function buildAbilityEditorStats(ability: AbilityWithDescription): AbilityEditorStat[] {
  const stats: AbilityEditorStat[] = [
    {
      id: "cooldownTicks",
      label: "冷却",
      value: formatSecondsFromTicks(ability.cooldownTicks),
    },
  ];

  if (typeof ability.range === "number") {
    stats.push({
      id: "range",
      label: "范围",
      value: `${ability.range}尺`,
    });
  }

  if (typeof ability.minRange === "number") {
    stats.push({
      id: "minRange",
      label: "最小距离",
      value: `${ability.minRange}尺`,
    });
  }

  const channelAccessor = getChannelAccessor(ability);
  if (channelAccessor) {
    stats.push({
      id: "channelMode",
      label: "读条",
      value: channelAccessor.getMode(ability) === "REVERSE" ? "逆读条" : "正读条",
    });
  }

  return stats;
}

function buildChannelDerivedStats(ability: AbilityWithDescription): AbilityEditorStat[] {
  const channelAccessor = getChannelAccessor(ability);
  if (!channelAccessor) {
    return [];
  }

  const durationMs = channelAccessor.getDurationMs(ability);
  const stats: AbilityEditorStat[] = [
    {
      id: "channel.durationSeconds",
      label: "总时长",
      value: `${durationMs}ms / ${formatSecondsFromMs(durationMs)}`,
    },
    {
      id: "channel.durationTicks",
      label: "总 Tick",
      value: formatGameTicksFromMs(durationMs),
    },
  ];

  const tickCount = channelAccessor.getTickCount(ability);
  const intervalMs = channelAccessor.getIntervalMs(ability);
  if (tickCount !== null) {
    stats.push({
      id: "channel.tickCount",
      label: "跳数",
      value: `${Number.isInteger(tickCount) ? tickCount : tickCount.toFixed(2).replace(/\.00$/, "")}`,
    });
  }

  if (intervalMs !== null) {
    stats.push({
      id: "channel.intervalMs",
      label: "每跳间隔",
      value: `${intervalMs}ms / ${formatSecondsFromMs(intervalMs)}`,
    });
  }

  return stats;
}

function normalizeAbilityOverrideEntry(rawEntry: unknown): AbilityEditorOverrideEntry | null {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  const legacyProperties = rawEntry as Partial<Record<string, unknown>>;
  const entryRecord = rawEntry as Record<string, unknown>;
  const rawProperties =
    "properties" in entryRecord && entryRecord.properties && typeof entryRecord.properties === "object"
      ? (entryRecord.properties as Partial<Record<string, unknown>>)
      : legacyProperties;
  const rawNumeric =
    "numeric" in entryRecord && entryRecord.numeric && typeof entryRecord.numeric === "object"
      ? (entryRecord.numeric as Record<string, unknown>)
      : {};

  const properties: Partial<Record<AbilityPropertyId, boolean>> = {};
  for (const [propertyId, enabled] of Object.entries(rawProperties)) {
    if (propertyId === LEGACY_GCD_PROPERTY_ID && typeof enabled === "boolean") {
      properties.noGcd = !enabled;
      continue;
    }

    if (abilityPropertyDefinitionMap[propertyId as AbilityPropertyId] && typeof enabled === "boolean") {
      properties[propertyId as AbilityPropertyId] = enabled;
    }
  }

  const numeric: Record<string, number> = {};
  for (const [numericId, value] of Object.entries(rawNumeric)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      numeric[numericId] = value;
    }
  }

  // Parse new tags map
  const rawTagsField =
    "tags" in entryRecord && entryRecord.tags && typeof entryRecord.tags === "object"
      ? (entryRecord.tags as Record<string, unknown>)
      : {};
  const parsedTags: Record<string, string> = {};
  for (const [groupId, val] of Object.entries(rawTagsField)) {
    const groupDef = TAG_GROUP_DEFINITIONS[groupId as TagGroupId];
    if (groupDef && typeof val === "string" && (groupDef.values as readonly string[]).includes(val)) {
      parsedTags[groupId] = val;
    }
  }

  // Migrate legacy top-level rarity → tags.rarity
  if ("rarity" in entryRecord && typeof entryRecord.rarity === "string" && !parsedTags.rarity) {
    const legacyRarity = entryRecord.rarity as string;
    if ((ABILITY_RARITIES as readonly string[]).includes(legacyRarity)) {
      parsedTags.rarity = legacyRarity;
    }
  }

  const tags = Object.keys(parsedTags).length > 0 ? parsedTags : undefined;

  if (Object.keys(properties).length === 0 && Object.keys(numeric).length === 0 && !tags) {
    return null;
  }

  return {
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    numeric: Object.keys(numeric).length > 0 ? numeric : undefined,
    tags,
  };
}

function normalizeAbilityEditorOverrideMap(rawOverrides: unknown) {
  const sanitizedOverrides: AbilityEditorOverrideMap = {};

  if (!rawOverrides || typeof rawOverrides !== "object") {
    return sanitizedOverrides;
  }

  for (const [abilityId, rawEntry] of Object.entries(rawOverrides as Record<string, unknown>)) {
    const normalizedEntry = normalizeAbilityOverrideEntry(rawEntry);
    if (normalizedEntry) {
      sanitizedOverrides[abilityId] = normalizedEntry;
    }
  }

  return sanitizedOverrides;
}

function resolveOverrideFilePath() {
  const candidates = [
    path.resolve(process.cwd(), "game/abilities/ability-property-overrides.json"),
    path.resolve(process.cwd(), "backend/game/abilities/ability-property-overrides.json"),
    path.resolve(__dirname, "ability-property-overrides.json"),
    path.resolve(__dirname, "../../../game/abilities/ability-property-overrides.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const abilityPropertyDefinitions: AbilityPropertyDefinition[] = [
  {
    id: "allowWhileControlled",
    label: "受控时仍可施放",
    description: "被眩晕、定身施法锁等一级控制影响时，仍允许施放。",
    group: "施放例外",
    isApplicable: () => true,
    getValue: (ability) =>
      (ability as any).allowWhileControlled === true ||
      hasEffectFlag(ability, "allowWhileControlled"),
    setValue: (ability, enabled) => {
      (ability as any).allowWhileControlled = enabled;
      if (!enabled) {
        stripEffectFlag(ability, "allowWhileControlled");
      }
    },
  },
  {
    id: "allowWhileKnockedBack",
    label: "击退中仍可施放",
    description: "被拉拽、击退等二级位移控制影响时，仍允许施放。",
    group: "施放例外",
    isApplicable: () => true,
    getValue: (ability) =>
      (ability as any).allowWhileKnockedBack === true ||
      hasEffectFlag(ability, "allowWhileKnockedBack"),
    setValue: (ability, enabled) => {
      (ability as any).allowWhileKnockedBack = enabled;
      if (!enabled) {
        stripEffectFlag(ability, "allowWhileKnockedBack");
      }
    },
  },
  {
    id: "cleanseRootSlow",
    label: "净化定身和减速",
    description: "如果该技能包含驱散效果，则允许同时清除定身与减速。",
    group: "施放例外",
    isApplicable: (ability) => hasEffectType(ability, "CLEANSE"),
    getValue: (ability) =>
      (ability as any).cleanseRootSlow === true ||
      hasEffectFlag(ability, "cleanseRootSlow", "CLEANSE"),
    setValue: (ability, enabled) => {
      (ability as any).cleanseRootSlow = enabled;
      if (!enabled) {
        stripEffectFlag(ability, "cleanseRootSlow", "CLEANSE");
      }
    },
  },
  {
    id: "cannotCastWhileRooted",
    label: "锁足中不可施放",
    description: "角色处于锁足(ROOT)时不可施放该技能。",
    group: "施放限制",
    isApplicable: () => true,
    getValue: (ability) => !!(ability as any).cannotCastWhileRooted,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "cannotCastWhileRooted", enabled);
    },
  },
  {
    id: "requiresGrounded",
    label: "必须落地施放",
    description: "角色在空中或起跳锁定阶段时不可施放。",
    group: "施放限制",
    isApplicable: () => true,
    getValue: (ability) => !!ability.requiresGrounded,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "requiresGrounded", enabled);
    },
  },
  {
    id: "requiresStanding",
    label: "必须站立施放",
    description: "角色必须站立且不横向移动时才能施放。",
    group: "施放限制",
    isApplicable: () => true,
    getValue: (ability) => !!ability.requiresStanding,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "requiresStanding", enabled);
    },
  },
  {
    id: "qinggong",
    label: "视为轻功",
    description: "会受到封轻功效果限制。",
    group: "施放限制",
    isApplicable: () => true,
    getValue: (ability) => !!ability.qinggong,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "qinggong", enabled);
    },
  },
  {
    id: "allowGroundCastWithoutTarget",
    label: "可对地施放",
    description: "对敌方技能允许不选目标，直接选地面点施放。",
    group: "目标与朝向",
    isApplicable: (ability) => ability.target === "OPPONENT",
    getValue: (ability) => !!ability.allowGroundCastWithoutTarget,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "allowGroundCastWithoutTarget", enabled);
    },
  },
  {
    id: "ignoreFacingRequirement",
    label: "无需正面朝向",
    description: "对敌方技能施放时，不再要求目标位于正面 180°。",
    group: "目标与朝向",
    isApplicable: (ability) => ability.target === "OPPONENT",
    getValue: (ability) => ability.target === "OPPONENT" && ability.faceDirection === false,
    setValue: (ability, enabled) => {
      if (enabled) {
        ability.faceDirection = false;
        return;
      }

      delete ability.faceDirection;
    },
  },
  {
    id: "noGcd",
    label: "不触发GCD",
    description: "施放后不会让其他带公共调息的技能进入 1.5 秒公共冷却。",
    group: "施放例外",
    isApplicable: () => true,
    getValue: (ability) => ability.gcd !== true,
    setValue: (ability, enabled) => {
      if (enabled) {
        delete ability.gcd;
        return;
      }

      ability.gcd = true;
    },
  },
  {
    id: "isCommon",
    label: "通用技能",
    description: "新对局中会作为通用技能发给双方，而不是出现在招式池里。",
    group: "分类",
    isApplicable: () => true,
    getValue: (ability) => !!ability.isCommon,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "isCommon", enabled);
    },
  },
  {
    id: "reverseChannel",
    label: "逆读条",
    description: "开启后读条从满到空；关闭则为正读条。",
    group: "读条",
    isApplicable: (ability) => getChannelAccessor(ability) !== null,
    getValue: (ability) => getChannelAccessor(ability)?.getMode(ability) === "REVERSE",
    setValue: (ability, enabled) => {
      const channelAccessor = getChannelAccessor(ability);
      if (!channelAccessor) return;
      channelAccessor.setMode(ability, enabled ? "REVERSE" : "FORWARD");
    },
  },
  {
    id: "channelCanMove",
    label: "移动不中断",
    description: "运功期间移动不会打断读条。",
    group: "读条",
    isApplicable: (ability) => getChannelAccessor(ability) !== null,
    getValue: (ability) => {
      const channelAccessor = getChannelAccessor(ability);
      return channelAccessor ? channelAccessor.getCancelOnMove(ability) === false : false;
    },
    setValue: (ability, enabled) => {
      const channelAccessor = getChannelAccessor(ability);
      if (!channelAccessor) return;
      channelAccessor.setCancelOnMove(ability, !enabled);
    },
  },
  {
    id: "channelCanJump",
    label: "跳跃不中断",
    description: "运功期间跳跃或腾空不会打断读条。",
    group: "读条",
    isApplicable: (ability) => getChannelAccessor(ability) !== null,
    getValue: (ability) => {
      const channelAccessor = getChannelAccessor(ability);
      return channelAccessor ? channelAccessor.getCancelOnJump(ability) === false : false;
    },
    setValue: (ability, enabled) => {
      const channelAccessor = getChannelAccessor(ability);
      if (!channelAccessor) return;
      channelAccessor.setCancelOnJump(ability, !enabled);
    },
  },
];

const abilityPropertyDefinitionMap = Object.fromEntries(
  abilityPropertyDefinitions.map((definition) => [definition.id, definition])
) as Record<AbilityPropertyId, AbilityPropertyDefinition>;

export function listAbilityPropertyDefinitions(): AbilityEditorPropertyDefinition[] {
  return abilityPropertyDefinitions.map(({ id, label, description, group }) => ({
    id,
    label,
    description,
    group,
  }));
}

export function getAbilityPropertyDefinition(propertyId: AbilityPropertyId) {
  return abilityPropertyDefinitionMap[propertyId];
}

export function getAbilityNumericFieldDefinition(baseAbility: AbilityWithDescription, fieldId: string) {
  return buildAllNumericFieldDefinitions(baseAbility).find((definition) => definition.id === fieldId);
}

export function loadAbilityEditorOverrides(): {
  overrides: AbilityEditorOverrideMap;
  updatedAt: string | null;
} {
  const filePath = resolveOverrideFilePath();

  if (!fs.existsSync(filePath)) {
    return {
      overrides: {},
      updatedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<StoredAbilityEditorOverrides>;

    return {
      overrides: normalizeAbilityEditorOverrideMap(parsed.abilities ?? {}),
      updatedAt:
        typeof parsed.updatedAt === "string" || parsed.updatedAt === null ? parsed.updatedAt : null,
    };
  } catch (error) {
    console.error("[AbilityEditor] Failed to read ability property overrides", error);
    return {
      overrides: {},
      updatedAt: null,
    };
  }
}

export function saveAbilityEditorOverrides(overrides: AbilityEditorOverrideMap) {
  const filePath = resolveOverrideFilePath();
  const updatedAt = new Date().toISOString();
  const payload: StoredAbilityEditorOverrides = {
    version: OVERRIDE_FILE_VERSION,
    updatedAt,
    abilities: overrides,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  return updatedAt;
}

export function buildResolvedAbilities(baseAbilities: AbilityRecord, overrides: AbilityEditorOverrideMap) {
  const resolvedAbilities: AbilityRecord = {};

  for (const [abilityId, baseAbility] of Object.entries(baseAbilities)) {
    const nextAbility = structuredClone(baseAbility);
    const abilityOverrides = overrides[abilityId];

    if (abilityOverrides?.properties) {
      for (const [propertyId, enabled] of Object.entries(abilityOverrides.properties)) {
        if (typeof enabled !== "boolean") continue;

        const definition = abilityPropertyDefinitionMap[propertyId as AbilityPropertyId];
        if (!definition || !definition.isApplicable(nextAbility)) {
          continue;
        }

        definition.setValue(nextAbility, enabled);
      }
    }

    if (abilityOverrides?.numeric) {
      for (const definition of buildAllNumericFieldDefinitions(baseAbility)) {
        const value = abilityOverrides.numeric[definition.id];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        definition.setValue(nextAbility, value);
      }
    }

    // Apply damageType tag to the resolved ability object so it is available at runtime
    if (abilityOverrides?.tags?.damageType) {
      (nextAbility as any).damageType = abilityOverrides.tags.damageType;
    }

    resolvedAbilities[abilityId] = nextAbility;
  }

  return resolvedAbilities;
}

export function buildAbilityEditorEntry(params: {
  ability: AbilityWithDescription;
  baseAbility: AbilityWithDescription;
  overrides?: AbilityEditorOverrideEntry;
}) {
  const { ability, baseAbility, overrides } = params;
  const propertyOverrides = overrides?.properties ?? {};
  const numericOverrides = overrides?.numeric ?? {};

  const properties = abilityPropertyDefinitions
    .filter((definition) => definition.isApplicable(baseAbility))
    .map((definition) => {
      const enabled = definition.getValue(ability);
      const baseEnabled = definition.getValue(baseAbility);
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        group: definition.group,
        enabled,
        baseEnabled,
        overridden: Object.prototype.hasOwnProperty.call(propertyOverrides, definition.id),
      } satisfies AbilityEditorPropertyState;
    });

  const coreSettings = buildCoreFieldDefinitions(baseAbility).map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    value: definition.getValue(ability),
    baseValue: definition.getValue(baseAbility),
    overridden: Object.prototype.hasOwnProperty.call(numericOverrides, definition.id),
    step: definition.step,
  })) satisfies AbilityEditorNumericSetting[];

  const damageSettings = buildDamageFieldDefinitions(baseAbility).map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    value: definition.getValue(ability),
    baseValue: definition.getValue(baseAbility),
    overridden: Object.prototype.hasOwnProperty.call(numericOverrides, definition.id),
    step: definition.step,
  })) satisfies AbilityEditorNumericSetting[];

  const channelAccessor = getChannelAccessor(ability);
  const channelProperties = properties.filter((property) => property.group === "读条");
  const channelTimingSettings = buildChannelTimingFieldDefinitions(baseAbility).map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    value: definition.getValue(ability),
    baseValue: definition.getValue(baseAbility),
    overridden: Object.prototype.hasOwnProperty.call(numericOverrides, definition.id),
    step: definition.step,
  })) satisfies AbilityEditorNumericSetting[];

  const channelInfo = channelAccessor
    ? {
        mode: channelAccessor.getMode(ability),
        label: channelAccessor.getMode(ability) === "REVERSE" ? "逆读条" : "正读条",
        properties: channelProperties,
        activePropertyIds: channelProperties.filter((property) => property.enabled).map((property) => property.id),
        availablePropertyIds: channelProperties.filter((property) => !property.enabled).map((property) => property.id),
        timingSettings: channelTimingSettings,
        derivedStats: buildChannelDerivedStats(ability),
      }
    : undefined;

  const hasOverrides =
    properties.some((property) => property.overridden) ||
    coreSettings.some((setting) => setting.overridden) ||
    damageSettings.some((setting) => setting.overridden) ||
    channelTimingSettings.some((setting) => setting.overridden) ||
    (overrides?.tags ? Object.keys(overrides.tags).length > 0 : false);

  return {
    id: ability.id,
    name: ability.name,
    description: ability.description,
    type: ability.type,
    target: ability.target,
    hasOverrides,
    tags: overrides?.tags ?? {},
    stats: buildAbilityEditorStats(ability),
    activePropertyIds: properties.filter((property) => property.enabled).map((property) => property.id),
    availablePropertyIds: properties.filter((property) => !property.enabled).map((property) => property.id),
    properties,
    coreSettings,
    damageSettings,
    channelInfo,
  } satisfies AbilityEditorAbilityEntry;
}