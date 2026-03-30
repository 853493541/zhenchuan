// backend/game/engine/effects/categories.ts

import { EffectType } from "../../state/types/effects";

export const EFFECT_CATEGORY_MAP: Record<EffectType, string> = {
  DAMAGE: "DEBUFF",
  HEAL: "BUFF",
  DRAW: "BUFF",
  COOLDOWN_SLOW: "DEBUFF",
  CLEANSE: "BUFF",

  DAMAGE_REDUCTION: "BUFF",
  DAMAGE_TAKEN_INCREASE: "DEBUFF",
  DAMAGE_MULTIPLIER: "BUFF",

  UNTARGETABLE: "BUFF",
  STEALTH: "BUFF",
  CONTROL_IMMUNE: "BUFF",
  KNOCKBACK_IMMUNE: "BUFF",
  INTERRUPT_IMMUNE: "BUFF",
  ROOT_SLOW_IMMUNE: "BUFF",
  DODGE_NEXT: "BUFF",
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
  AOE_APPLY_BUFFS: "DEBUFF",
  JUMP_BOOST: "BUFF",

  /* ================= CONTROL LEVELS ================= */
  KNOCKED_BACK: "DEBUFF",  // Level 2 — NOT removable by cleanse
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
  // Stack-based on-hit debuff
  STACK_ON_HIT_DAMAGE: "DEBUFF",
};

export function getEffectCategory(type: EffectType): string {
  return EFFECT_CATEGORY_MAP[type] ?? "BUFF";
}
