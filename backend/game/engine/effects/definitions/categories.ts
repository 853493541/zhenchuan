// backend/game/engine/effects/categories.ts

import { EffectType } from "../../state/types/effects";

export const EFFECT_CATEGORY_MAP: Record<EffectType, string> = {
  DAMAGE: "DEBUFF",
  HEAL: "BUFF",
  DRAW: "BUFF",
  CLEANSE: "BUFF",

  DAMAGE_REDUCTION: "BUFF",
  DAMAGE_MULTIPLIER: "BUFF",

  UNTARGETABLE: "BUFF",
  STEALTH: "BUFF",
  CONTROL_IMMUNE: "BUFF",
  DODGE_NEXT: "BUFF",
  START_TURN_HEAL: "BUFF",

  HEAL_REDUCTION: "DEBUFF",
  ATTACK_LOCK: "DEBUFF",
  SILENCE: "DEBUFF",
  DELAYED_DAMAGE: "DEBUFF",
  START_TURN_DAMAGE: "DEBUFF",
  CONTROL: "DEBUFF",

  // ✅ Channel buffs are BUFFs (self-cast)
  FENGLAI_CHANNEL: "BUFF",
  WUJIAN_CHANNEL: "BUFF",

  /* ================= PATCH 0.3 ================= */
  DRAW_REDUCTION: "DEBUFF",
  ON_PLAY_DAMAGE: "DEBUFF",
  XINZHENG_CHANNEL: "BUFF",
  BONUS_DAMAGE_IF_TARGET_HP_GT: "DEBUFF",

  /* ================= PATCH 0.5 ================= */
  SCHEDULED_DAMAGE: "DEBUFF",
};

export function getEffectCategory(type: EffectType): string {
  return EFFECT_CATEGORY_MAP[type] ?? "BUFF";
}
