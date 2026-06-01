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
  | "canCastWhileMounted"
  | "qinggong"
  | "qinggongGcdImmune"
  | "hasteUnaffected"
  | "allowGroundCastWithoutTarget"
  | "ignoreFacingRequirement"
  | "noGcd"
  | "isCommon"
  | "reverseChannel"
  | "channelCanMove"
  | "channelCanJump"
  | "channelNotInterruptible";

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
  description?: string;
  descriptionReviewStatus?: DescriptionReviewStatus;
  adControlStatus?: DescriptionReviewStatus;
  cooldownReviewStatus?: DescriptionReviewStatus;
  /** tag group → tag value (e.g. { rarity: "稀世", school: "少林" }) */
  tags?: Record<string, string>;
  /** Whether this ability is a ranged projectile (blocked by PROJECTILE_IMMUNE) */
  isProjectile?: boolean;
  /** Whether this ability is whitelisted from 盾立 reflect (damage immunity still applies) */
  dunLiWhitelisted?: boolean;
  /** Whether this ability ignores target dodge chance. */
  ignoreDodge?: boolean;
  /** Whether this ability can be cast while disarmed. False is a meaningful manual exclusion. */
  noWeaponRequired?: boolean;
}

export type AbilityEditorOverrideMap = Record<string, AbilityEditorOverrideEntry>;
export type DescriptionReviewStatus = "fixed" | "needs-more" | "unfixed";

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
  isProjectile: boolean;
  manualIsProjectile: boolean;
  manuallyProjectileExcluded: boolean;
  dunLiWhitelisted: boolean;
  manualDunLiWhitelisted: boolean;
  manuallyDunLiExcluded: boolean;
  stats: AbilityEditorStat[];
  activePropertyIds: AbilityPropertyId[];
  availablePropertyIds: AbilityPropertyId[];
  properties: AbilityEditorPropertyState[];
  coreSettings: AbilityEditorNumericSetting[];
  damageSettings: AbilityEditorNumericSetting[];
  adControlStatus: DescriptionReviewStatus;
  cooldownReviewStatus: DescriptionReviewStatus;
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

export function isDescriptionReviewStatus(value: unknown): value is DescriptionReviewStatus {
  return value === "fixed" || value === "needs-more" || value === "unfixed";
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

function isPureChannelAbility(ability: AbilityWithDescription) {
  if (ability.type !== "CHANNEL") {
    return false;
  }

  return (
    !Array.isArray(ability.buffs) ||
    ability.buffs.length === 0 ||
    (ability as any).applyBuffsOnComplete === true ||
    (ability as any).applyBuffsOnChannelStart === true
  );
}

const OVERRIDE_FILE_VERSION = 1;
const LEGACY_GCD_PROPERTY_ID = "gcd";
const MS_PER_GAME_TICK = 1000 / 30;

const DAMAGE_VALUE_EFFECT_LABELS: Partial<Record<AbilityEffect["type"], string>> = {
  DAMAGE: "直接伤害倍率",
  BANG_DA_GOU_TOU: "棒打狗头伤害倍率",
  HENG_SAO_LIU_HE_AOE: "横扫六合伤害倍率",
  WUFANG_XINGJIN_AOE: "五方行尽伤害倍率",
  BONUS_DAMAGE_IF_TARGET_HP_GT: "追加伤害倍率",
  PERIODIC_DAMAGE: "持续伤害倍率",
  CHANNEL_AOE_TICK: "引导范围伤害倍率",
  TIMED_AOE_DAMAGE: "延时范围伤害倍率",
  TIMED_SELF_DAMAGE: "延时自身伤害倍率",
  TIMED_SOURCE_CENTER_AOE_DAMAGE: "携带者延时范围伤害倍率",
  TIMED_AOE_DAMAGE_IF_SELF_HP_GT: "条件延时范围伤害倍率",
  BAIZU_AOE: "范围初始伤害倍率",
  XIA_LIU_BAO_SHI_AOE: "自身范围伤害倍率",
  ON_PLAY_DAMAGE: "出招触发伤害倍率",
  STACK_ON_HIT_DAMAGE: "层数触发伤害倍率",
  STACK_ON_HIT_GUAN_TI_HEAL: "层数触发贯体回血",
  SCHEDULED_DAMAGE: "计划伤害倍率",
  DELAYED_DAMAGE: "延时伤害倍率",
  YIN_YUE_ZHAN: "银月斩伤害倍率",
  LIE_RI_ZHAN: "烈日斩伤害倍率",
  MIE_STRIKE: "灭伤害倍率",
  SHOU_QUE_SHI: "守缺式伤害倍率",
  TRUE_DAMAGE: "真实伤害数值",
  PLACE_GROUND_ZONE: "法阵每跳伤害倍率",
  PLACE_FOLLOW_ZONE: "法阵每跳伤害倍率",
  PLACE_GROW_PULL_ZONE: "爆炸伤害倍率",
  CHANNEL_AOE_TICK_DAMAGE: "引导范围伤害倍率",
};

const DAMAGE_VALUE_EFFECT_TYPES = new Set<AbilityEffect["type"]>([
  "DAMAGE",
  "BANG_DA_GOU_TOU",
  "HENG_SAO_LIU_HE_AOE",
  "WUFANG_XINGJIN_AOE",
  "BONUS_DAMAGE_IF_TARGET_HP_GT",
  "PERIODIC_DAMAGE",
  "CHANNEL_AOE_TICK",
  "TIMED_AOE_DAMAGE",
  "TIMED_SELF_DAMAGE",
  "TIMED_SOURCE_CENTER_AOE_DAMAGE",
  "TIMED_AOE_DAMAGE_IF_SELF_HP_GT",
  "BAIZU_AOE",
  "XIA_LIU_BAO_SHI_AOE",
  "ON_PLAY_DAMAGE",
  "STACK_ON_HIT_DAMAGE",
  "SCHEDULED_DAMAGE",
  "DELAYED_DAMAGE",
  "YIN_YUE_ZHAN",
  "LIE_RI_ZHAN",
  "MIE_STRIKE",
  "SHOU_QUE_SHI",
  "TRUE_DAMAGE",
  "PLACE_GROUND_ZONE",
  "PLACE_FOLLOW_ZONE",
  "PLACE_GROW_PULL_ZONE",
  "CHANNEL_AOE_TICK_DAMAGE",
]);

function hasEffectFlag(
  ability: AbilityWithDescription,
  flag: "allowWhileControlled" | "allowWhileKnockedBack" | "allowWhileDashing" | "allowWhilePulled" | "cleanseRootSlow",
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
  flag: "allowWhileControlled" | "allowWhileKnockedBack" | "allowWhileDashing" | "allowWhilePulled" | "cleanseRootSlow",
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
    | "qinggongGcdImmune"
    | "hasteUnaffected"
    | "cannotCastWhileRooted"
    | "requiresGrounded"
    | "requiresStanding"
    | "canCastWhileMounted"
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

  if (!isPureChannelAbility(ability) && Array.isArray(ability.buffs) && ability.buffs.length > 0) {
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

function buildRuntimeChannelInfo(ability: AbilityWithDescription): Ability["channel"] | undefined {
  const channelAccessor = getChannelAccessor(ability);
  if (!channelAccessor) {
    return undefined;
  }

  const tickIntervalMs = channelAccessor.getIntervalMs(ability);
  const buffId =
    channelAccessor.kind === "buff" && Array.isArray(ability.buffs) && ability.buffs.length > 0
      ? ability.buffs[0]?.buffId
      : undefined;

  return {
    source: channelAccessor.kind === "buff" ? "BUFF" : "ACTIVE",
    mode: channelAccessor.getMode(ability),
    durationMs: channelAccessor.getDurationMs(ability),
    cancelOnMove: channelAccessor.getCancelOnMove(ability),
    cancelOnJump: channelAccessor.getCancelOnJump(ability),
    ...(typeof tickIntervalMs === "number" && tickIntervalMs > 0 ? { tickIntervalMs } : {}),
    ...(typeof buffId === "number" ? { buffId } : {}),
    interruptible: (ability as any).channelNotInterruptible !== true,
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
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 200 + effectIndex,
          path: ["effects", effectIndex, "value"],
          step: 0.1,
        })
      );
    }
    if (effect.type === "DIRECTIONAL_DASH" && typeof effect.routeDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.routeDamage`,
          label: "冲刺路径伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 240 + effectIndex,
          path: ["effects", effectIndex, "routeDamage"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "qian_long_wu_yong" && effect.type === "QIAN_LONG_WU_YONG" && typeof (effect as any).damageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.damageValue`,
          label: "潜龙勿用伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 246 + effectIndex,
          path: ["effects", effectIndex, "damageValue"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "jiu_zhuan_gui_yi" && effect.type === "KNOCKBACK_DASH" && typeof (effect as any).wallHitDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.wallHitDamage`,
          label: "九转归一伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 撞墙时伤害倍率会乘以攻击力`,
          order: 247 + effectIndex,
          path: ["effects", effectIndex, "wallHitDamage"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "lie_ri_zhan" && effect.type === "LIE_RI_ZHAN" && typeof (effect as any).extraDamageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.extraDamageValue`,
          label: "烈日斩额外伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 额外伤害倍率会乘以攻击力`,
          order: 248 + effectIndex,
          path: ["effects", effectIndex, "extraDamageValue"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "po_feng" && effect.type === "PO_FENG_STRIKE" && typeof (effect as any).strikeDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.strikeDamage`,
          label: "破风伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 249 + effectIndex,
          path: ["effects", effectIndex, "strikeDamage"],
          step: 0.1,
        })
      );
    }

    if (effect.type === "CANG_YUE_AOE" && typeof (effect as any).damageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.damageValue`,
          label: "沧月伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 245 + effectIndex,
          path: ["effects", effectIndex, "damageValue"],
          step: 0.1,
        })
      );
    }

    if (effect.type === "AOE_APPLY_BUFFS" && typeof (effect as any).damageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.damageValue`,
          label: baseAbility.id === "dican_longxiang" ? "帝骖龙翔伤害倍率" : "范围伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 246 + effectIndex,
          path: ["effects", effectIndex, "damageValue"],
          step: 0.01,
        })
      );
    }

    if (baseAbility.id === "han_di" && effect.type === "GROUND_TARGET_DASH" && typeof (effect as any).aoeDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.aoeDamage`,
          label: "撼地伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 落地范围伤害倍率会乘以攻击力`,
          order: 247 + effectIndex,
          path: ["effects", effectIndex, "aoeDamage"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "yue_chao_zhan_bo" && effect.type === "DASH" && typeof (effect as any).landingDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.landingDamage`,
          label: "跃潮斩波伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 落地范围伤害倍率会乘以攻击力`,
          order: 248 + effectIndex,
          path: ["effects", effectIndex, "landingDamage"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "he_gui_gu_shan" && effect.type === "DIRECTIONAL_DASH") {
      if (typeof (effect as any).landDamage === "number") {
        definitions.push(
          createNumericFieldDefinition({
            id: `effects.${effectIndex}.landDamage`,
            label: "鹤归孤山伤害倍率",
            description: `技能效果 ${effectIndex + 1} · 落地范围伤害倍率会乘以攻击力`,
            order: 249 + effectIndex,
            path: ["effects", effectIndex, "landDamage"],
            step: 0.1,
          })
        );
      }
      if (typeof (effect as any).closeBonusDamage === "number") {
        definitions.push(
          createNumericFieldDefinition({
            id: `effects.${effectIndex}.closeBonusDamage`,
            label: "鹤归孤山额外伤害倍率",
            description: `技能效果 ${effectIndex + 1} · 近距额外伤害倍率会乘以攻击力`,
            order: 250 + effectIndex,
            path: ["effects", effectIndex, "closeBonusDamage"],
            step: 0.1,
          })
        );
      }
    }

    if (baseAbility.id === "long_zhan_yu_ye" && effect.type === "LONG_ZHAN_YU_YE" && typeof (effect as any).damageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.damageValue`,
          label: "龙战于野伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 251 + effectIndex,
          path: ["effects", effectIndex, "damageValue"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "yu_shi_ju_fen" && effect.type === "SETTLE_SOURCE_DOTS" && typeof (effect as any).settleMultiplier === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.settleMultiplier`,
          label: "玉石俱焚额外伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 吞噬持续伤害的结算倍率`,
          order: 252 + effectIndex,
          path: ["effects", effectIndex, "settleMultiplier"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "yin_yue_zhan" && effect.type === "YIN_YUE_ZHAN" && typeof (effect as any).extraDamageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.extraDamageValue`,
          label: "银月斩额外伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 额外伤害倍率会乘以攻击力`,
          order: 253 + effectIndex,
          path: ["effects", effectIndex, "extraDamageValue"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "jian_zhu_tian_di" && effect.type === "JIAN_ZHU_TIAN_DI_STRIKE" && typeof (effect as any).strikeDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.strikeDamage`,
          label: "剑主天地伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 直接伤害倍率会乘以攻击力`,
          order: 254 + effectIndex,
          path: ["effects", effectIndex, "strikeDamage"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "ren_jian_he_yi" && effect.type === "REN_JIAN_HE_YI_AOE" && typeof (effect as any).explodeDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.explodeDamage`,
          label: "人剑合一引爆伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 引爆伤害倍率会乘以攻击力`,
          order: 255 + effectIndex,
          path: ["effects", effectIndex, "explodeDamage"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "mie" && effect.type === "MIE_STRIKE" && typeof (effect as any).extraDamageValue === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.extraDamageValue`,
          label: "灭额外伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 低血量额外伤害倍率会乘以攻击力`,
          order: 256 + effectIndex,
          path: ["effects", effectIndex, "extraDamageValue"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "lv_ye_man_sheng" && effect.type === "PLACE_LV_YE_MAN_SHENG_FIELD" && typeof (effect as any).retaliateDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `effects.${effectIndex}.retaliateDamage`,
          label: "绿野蔓生伤害倍率",
          description: `技能效果 ${effectIndex + 1} · 反击伤害倍率会乘以攻击力`,
          order: 257 + effectIndex,
          path: ["effects", effectIndex, "retaliateDamage"],
          step: 0.1,
        })
      );
    }

  });

  ((baseAbility as any).channelEffects ?? []).forEach((effect: AbilityEffect, effectIndex: number) => {
    if (isDamageValueEffectType(effect.type) && typeof (effect as any).value === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `channelEffects.${effectIndex}.value`,
          label: `读条完成 · ${getDamageEffectLabel(effect.type)}`,
          description: `读条完成效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
          order: 260 + effectIndex,
          path: ["channelEffects", effectIndex, "value"],
          step: 0.1,
        })
      );
    }

    if (baseAbility.id === "lian_huan_nu" && effect.type === "LIAN_HUAN_NU_TICK") {
      const tickFields: Array<{ key: string; label: string; orderOffset: number }> = [
        { key: "tickDamage1", label: "连环弩第一段伤害倍率", orderOffset: 1 },
        { key: "tickDamage2", label: "连环弩第二段伤害倍率", orderOffset: 2 },
        { key: "tickDamage3", label: "连环弩第三段伤害倍率", orderOffset: 3 },
      ];
      for (const field of tickFields) {
        if (typeof (effect as any)[field.key] !== "number") continue;
        definitions.push(
          createNumericFieldDefinition({
            id: `channelEffects.${effectIndex}.${field.key}`,
            label: field.label,
            description: `读条完成效果 ${effectIndex + 1} · 伤害倍率会乘以攻击力`,
            order: 270 + effectIndex * 4 + field.orderOffset,
            path: ["channelEffects", effectIndex, field.key],
            step: 0.1,
          })
        );
      }
    }

    if (baseAbility.id === "yin_qiao" && effect.type === "TIMED_AOE_DAMAGE" && typeof (effect as any).extraPerStackDamage === "number") {
      definitions.push(
        createNumericFieldDefinition({
          id: `channelEffects.${effectIndex}.extraPerStackDamage`,
          label: "引窍额外伤害倍率",
          description: `读条完成效果 ${effectIndex + 1} · 每层绝脉额外伤害倍率会乘以攻击力`,
          order: 271 + effectIndex,
          path: ["channelEffects", effectIndex, "extraPerStackDamage"],
          step: 0.1,
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
            description: `来自 Buff ${buff.name} · 伤害倍率会乘以攻击力`,
            order: 300 + buffIndex * 20 + effectIndex,
            path: ["buffs", buffIndex, "effects", effectIndex, "value"],
            step: 0.1,
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

  if (Number(baseAbility.maxCharges ?? 0) > 1) {
    definitions.push(
      createNumericFieldDefinition({
        id: "chargeRecoveryTicks",
        label: "充能 Tick",
        description: "每层充能恢复时间，30 Tick = 1 秒",
        order: 11,
        path: ["chargeRecoveryTicks"],
        step: 1,
      })
    );
  }

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

  // Parse top-level isProjectile field
  const isProjectile =
    "isProjectile" in entryRecord && typeof entryRecord.isProjectile === "boolean"
      ? entryRecord.isProjectile
      : undefined;

  // Parse top-level dunLiWhitelisted field
  const dunLiWhitelisted =
    "dunLiWhitelisted" in entryRecord && typeof entryRecord.dunLiWhitelisted === "boolean"
      ? entryRecord.dunLiWhitelisted
      : undefined;

  // Parse top-level ignoreDodge field
  const ignoreDodge =
    "ignoreDodge" in entryRecord && typeof entryRecord.ignoreDodge === "boolean"
      ? entryRecord.ignoreDodge
      : undefined;

  // Parse top-level noWeaponRequired field
  const noWeaponRequired =
    "noWeaponRequired" in entryRecord && typeof entryRecord.noWeaponRequired === "boolean"
      ? entryRecord.noWeaponRequired
      : undefined;
  const description = "description" in entryRecord && typeof entryRecord.description === "string"
    ? entryRecord.description
    : undefined;
  const descriptionReviewStatus = isDescriptionReviewStatus(entryRecord.descriptionReviewStatus)
    ? entryRecord.descriptionReviewStatus
    : undefined;
  const adControlStatus = isDescriptionReviewStatus(entryRecord.adControlStatus)
    ? entryRecord.adControlStatus
    : undefined;
  const cooldownReviewStatus = isDescriptionReviewStatus(entryRecord.cooldownReviewStatus)
    ? entryRecord.cooldownReviewStatus
    : undefined;

  if (
    Object.keys(properties).length === 0 &&
    Object.keys(numeric).length === 0 &&
    description === undefined &&
    descriptionReviewStatus === undefined &&
    adControlStatus === undefined &&
    cooldownReviewStatus === undefined &&
    !tags &&
    isProjectile === undefined &&
    dunLiWhitelisted === undefined &&
    ignoreDodge === undefined &&
    noWeaponRequired === undefined
  ) {
    return null;
  }

  return {
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    numeric: Object.keys(numeric).length > 0 ? numeric : undefined,
    description,
    descriptionReviewStatus,
    adControlStatus,
    cooldownReviewStatus,
    tags,
    isProjectile,
    dunLiWhitelisted,
    ignoreDodge,
    noWeaponRequired,
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
    description: "会受到封轻功效果限制，并可参与轻功公共调息规则。",
    group: "施放限制",
    isApplicable: () => true,
    getValue: (ability) => !!ability.qinggong,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "qinggong", enabled);
    },
  },
  {
    id: "qinggongGcdImmune",
    label: "不受轻功GCD",
    description: "仍视为轻功，但不会触发或受到 3 秒轻功公共调息。",
    group: "施放例外",
    isApplicable: () => true,
    getValue: (ability) => !!ability.qinggongGcdImmune,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "qinggongGcdImmune", enabled);
    },
  },
  {
    id: "hasteUnaffected",
    label: "不受加速",
    description: "开启后该技能的读条、逆读条和持续伤害时间不会被加速率缩短。",
    group: "施放例外",
    isApplicable: () => true,
    getValue: (ability) => !!(ability as any).hasteUnaffected,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "hasteUnaffected", enabled);
    },
  },
  {
    id: "canCastWhileMounted",
    label: "可以马上施展",
    description: "角色处于骑御状态时，仍可施放该技能。",
    group: "施放例外",
    isApplicable: () => true,
    getValue: (ability) => !!(ability as any).canCastWhileMounted,
    setValue: (ability, enabled) => {
      setBooleanAbilityField(ability, "canCastWhileMounted", enabled);
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
    description: "施放后不会让其他带公共调息的技能进入基础公共冷却。",
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
  {
    id: "channelNotInterruptible",
    label: "不可被打断",
    description: "启用后本读条免克被打断类技能（如《翔极碧落》，《剑飞惊天》）中断。默认关闭，即读条可被打断。",
    group: "读条",
    isApplicable: (ability) => getChannelAccessor(ability) !== null,
    getValue: (ability) => (ability as any).channelNotInterruptible === true,
    setValue: (ability, enabled) => {
      if (enabled) {
        (ability as any).channelNotInterruptible = true;
      } else {
        delete (ability as any).channelNotInterruptible;
      }
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

    if (typeof abilityOverrides?.description === "string") {
      nextAbility.description = abilityOverrides.description;
    }

    // Apply damageType tag to the resolved ability object so it is available at runtime
    if (abilityOverrides?.tags?.damageType) {
      (nextAbility as any).damageType = abilityOverrides.tags.damageType;
    }

    // Apply isProjectile flag so the game engine can check it at runtime
    if (abilityOverrides?.isProjectile === true) {
      (nextAbility as any).isProjectile = true;
    } else if (abilityOverrides && "isProjectile" in abilityOverrides && !abilityOverrides.isProjectile) {
      (nextAbility as any).isProjectile = false;
    }

    // Apply dunLiWhitelisted flag — abilities flagged here will not be reflected by 盾立
    if (abilityOverrides?.dunLiWhitelisted === true) {
      (nextAbility as any).dunLiWhitelisted = true;
    } else if (abilityOverrides && "dunLiWhitelisted" in abilityOverrides && !abilityOverrides.dunLiWhitelisted) {
      (nextAbility as any).dunLiWhitelisted = false;
    }

    // Apply ignoreDodge so dodge resolution can treat the ability as guaranteed-hit.
    if (abilityOverrides?.ignoreDodge === true) {
      (nextAbility as any).ignoreDodge = true;
    } else if (abilityOverrides && "ignoreDodge" in abilityOverrides && abilityOverrides.ignoreDodge === false) {
      delete (nextAbility as any).ignoreDodge;
    }

    // Apply noWeaponRequired so disarm validation and preload can see editor overrides.
    if (abilityOverrides?.noWeaponRequired === true) {
      (nextAbility as any).noWeaponRequired = true;
    } else if (abilityOverrides && "noWeaponRequired" in abilityOverrides && abilityOverrides.noWeaponRequired === false) {
      delete (nextAbility as any).noWeaponRequired;
    }

    const runtimeChannelInfo = buildRuntimeChannelInfo(nextAbility);
    if (runtimeChannelInfo) {
      nextAbility.channel = runtimeChannelInfo;
    } else {
      delete nextAbility.channel;
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
    overrides?.description !== undefined ||
    overrides?.descriptionReviewStatus !== undefined ||
    overrides?.adControlStatus !== undefined ||
    overrides?.cooldownReviewStatus !== undefined ||
    channelTimingSettings.some((setting) => setting.overridden) ||
    (overrides?.tags ? Object.keys(overrides.tags).length > 0 : false) ||
    overrides?.isProjectile !== undefined ||
    overrides?.dunLiWhitelisted !== undefined ||
    overrides?.ignoreDodge !== undefined;

  return {
    id: ability.id,
    name: ability.name,
    description: ability.description,
    type: ability.type,
    target: ability.target,
    hasOverrides,
    tags: overrides?.tags ?? {},
    isProjectile: (ability as any).isProjectile === true,
    manualIsProjectile: overrides?.isProjectile === true,
    manuallyProjectileExcluded: overrides?.isProjectile === false,
    dunLiWhitelisted: (ability as any).dunLiWhitelisted === true,
    manualDunLiWhitelisted: overrides?.dunLiWhitelisted === true,
    manuallyDunLiExcluded: overrides?.dunLiWhitelisted === false,
    stats: buildAbilityEditorStats(ability),
    activePropertyIds: properties.filter((property) => property.enabled).map((property) => property.id),
    availablePropertyIds: properties.filter((property) => !property.enabled).map((property) => property.id),
    properties,
    coreSettings,
    damageSettings,
    adControlStatus: overrides?.adControlStatus ?? "unfixed",
    cooldownReviewStatus: overrides?.cooldownReviewStatus ?? "unfixed",
    channelInfo,
  } satisfies AbilityEditorAbilityEntry;
}