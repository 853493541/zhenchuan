// backend/game/engine/effects/categories.ts

import { EffectType } from "../../state/types/effects";

export const EFFECT_CATEGORY_MAP: Record<EffectType, string> = {
  DAMAGE: "DEBUFF",
  HEAL: "BUFF",
  SHIELD: "BUFF",
  DRAW: "BUFF",
  COOLDOWN_SLOW: "DEBUFF",
  CLEANSE: "BUFF",

  DAMAGE_REDUCTION: "BUFF",
  DAMAGE_TAKEN_INCREASE: "DEBUFF",
  DAMAGE_MULTIPLIER: "BUFF",

  UNTARGETABLE: "BUFF",
  INVULNERABLE: "BUFF",
  STEALTH: "BUFF",
  CONTROL_IMMUNE: "BUFF",
  KNOCKBACK_IMMUNE: "BUFF",
  DASH_TURN_LOCK: "BUFF",
  DASH_TURN_OVERRIDE: "BUFF",
  DISPLACEMENT: "BUFF",
  INTERRUPT_IMMUNE: "BUFF",
  ROOT_SLOW_IMMUNE: "BUFF",
  DODGE: "BUFF",
  PERIODIC_HEAL: "BUFF",

  HEAL_REDUCTION: "DEBUFF",
  ATTACK_LOCK: "DEBUFF",
  SILENCE: "DEBUFF",
  SILENCE_IMMUNE: "BUFF",
  QINGGONG_SEAL: "DEBUFF",
  DELAYED_DAMAGE: "DEBUFF",
  PERIODIC_DAMAGE: "DEBUFF",
  CHANNEL_AOE_TICK: "BUFF",
  CONTROL: "DEBUFF",

  // ✅ Channel buffs are BUFFs (self-cast)
  FENGLAI_CHANNEL: "BUFF",
  WUJIAN_CHANNEL: "BUFF",
  TIMED_AOE_DAMAGE: "BUFF",
  TIMED_SELF_DAMAGE: "DEBUFF",
  TIMED_SELF_HEAL: "BUFF",
  TIMED_AOE_DAMAGE_IF_SELF_HP_GT: "BUFF",
  TIMED_PULL_TARGET_TO_FRONT: "DEBUFF",

  /* ================= PATCH 0.3 ================= */
  DRAW_REDUCTION: "DEBUFF",
  ON_PLAY_DAMAGE: "DEBUFF",
  XINZHENG_CHANNEL: "BUFF",
  BONUS_DAMAGE_IF_TARGET_HP_GT: "DEBUFF",

  /* ================= PATCH 0.5 ================= */
  SCHEDULED_DAMAGE: "DEBUFF",

  /* ================= REAL-TIME MOVEMENT ================= */
  DASH: "BUFF",
  DIRECTIONAL_DASH: "BUFF",
  GROUND_TARGET_DASH: "BUFF",
  AOE_APPLY_BUFFS: "DEBUFF",
  JUMP_BOOST: "BUFF",

  /* ================= CONTROL LEVELS ================= */
  KNOCKED_BACK: "DEBUFF",  // Level 2 — NOT removable by cleanse
  PULLED: "DEBUFF",         // Level 2 — NOT removable by cleanse (being pulled by enemy)
  SPEED_BOOST: "BUFF",
  // Level 0 — removable by cleanse
  ROOT: "DEBUFF",
  SLOW: "DEBUFF",
  // Jump enhancements
  MULTI_JUMP: "BUFF",
  // 贯体 healing
  PERIODIC_GUAN_TI_HEAL: "BUFF",
  TIMED_GUAN_TI_HEAL: "BUFF",
  // Ground zone placement
  PLACE_GROUND_ZONE: "BUFF",
  PLACE_SHENGTAIJI_ZONE: "BUFF",
  BAIZU_AOE: "DEBUFF",
  WUFANG_XINGJIN_AOE: "DEBUFF",
  BANG_DA_GOU_TOU: "DEBUFF",
  // Stack-based on-hit debuff
  STACK_ON_HIT_DAMAGE: "DEBUFF",
  // Stack-based on-hit heal (贯体)
  STACK_ON_HIT_GUAN_TI_HEAL: "BUFF",
  // Instant 贯体 heal bypassing HEAL_REDUCTION
  INSTANT_GUAN_TI_HEAL: "BUFF",
  // Knockback dash (九转归一): force target away, stun if wall hit
  KNOCKBACK_DASH: "DEBUFF",
  // Dispel one BUFF-category buff per listed attribute from the target
  DISPEL_BUFF_ATTRIBUTE: "DEBUFF",
  // Cleanse DEBUFF-category buffs from self/friendly by attribute
  CLEANSE_DEBUFF_ATTRIBUTE: "BUFF",
  // Immediately settle remaining DoT damage from own debuffs on target
  SETTLE_SOURCE_DOTS: "DEBUFF",
  // Apply DoT debuffs from caster's ability slots
  APPLY_SLOT_DOTS: "DEBUFF",
  // Block all incoming damage (雷霆震怒 stun package)
  DAMAGE_IMMUNE: "DEBUFF",
  // 三才化生 self-centered AoE ROOT
  SAN_CAI_HUA_SHENG_AOE: "DEBUFF",
  // 银月斩 custom handler
  YIN_YUE_ZHAN: "DEBUFF",
  // 烈日斩 custom handler
  LIE_RI_ZHAN: "DEBUFF",
  // 横扫六合 AoE handler
  HENG_SAO_LIU_HE_AOE: "DEBUFF",
  // 啸如虎: cannot die
  MIN_HP_1: "BUFF",
  // 五蕴皆空·聂云缩减: reduce 蹑云逐月 dash
  NIEYUN_DASH_REDUCTION: "DEBUFF",
  // 玄水蛊·毒手: redirect marker
  DAMAGE_REDIRECT_55: "DEBUFF",
  // 极乐引: instant AOE pull
  JILE_YIN_AOE_PULL: "DEBUFF",
  // 临时飞爪: no-buff ground dash
  LIN_SHI_FEI_ZHUA_DASH: "BUFF",
  // 化蝶 Phase 1: diagonal dash
  HUA_DIE_PHASE1: "BUFF",
  // 破风: flat damage taken bonus
  DAMAGE_TAKEN_FLAT: "DEBUFF",
  // 剑主天地: stacking dot strike
  JIAN_ZHU_TIAN_DI_STRIKE: "DEBUFF",
  // 破风: strike handler
  PO_FENG_STRIKE: "DEBUFF",
  // 外功闪避: dodge only physical / untyped attacks
  PHYSICAL_DODGE: "BUFF",
  // 无相诀: scaling DR based on current HP%
  DAMAGE_REDUCTION_HP_SCALING: "BUFF",
  // 斩无常: immune to isProjectile abilities
  PROJECTILE_IMMUNE: "BUFF",
  // 应天授命: unlimited shield + true-damage settle per second
  YING_TIAN_SHIELD: "BUFF",
  // 斩无常: periodic 贯体 heal to nearby allies in range
  CHANNEL_AOE_TICK_DAMAGE: "BUFF",
  // 灭: conditional damage handler
  MIE_STRIKE: "DEBUFF",
  // 孤影化双: snapshot + buff application
  GU_YING_HUA_SHUANG: "BUFF",
  // 逐云寒蕊: places targetable HP-bearing zone entity
  PLACE_ZHU_YUN_HAN_RUI: "BUFF",
};

export function getEffectCategory(type: EffectType): string {
  return EFFECT_CATEGORY_MAP[type] ?? "BUFF";
}
