// backend/game/engine/state/types/effects.ts

import { TurnPhase, ScheduledTarget, ScheduledTurnOf } from "./scheduling";
import { TargetType } from "./abilities";

export type EffectType =
  | "DAMAGE"
  | "HEAL"
  | "SHIELD"
  | "DRAW"
  | "COOLDOWN_SLOW"
  | "DAMAGE_REDUCTION"
  | "DAMAGE_TAKEN_INCREASE"
  | "DAMAGE_MULTIPLIER"
  | "HEAL_REDUCTION"
  | "UNTARGETABLE"
  | "INVULNERABLE"
  | "STEALTH"
  | "ATTACK_LOCK"
  | "CONTROL"
  | "SILENCE"
  | "SILENCE_IMMUNE"
  | "QINGGONG_SEAL"
  | "KNOCKBACK_IMMUNE"
  | "CONTROL_IMMUNE"
  | "DASH_TURN_LOCK"
  | "DASH_TURN_OVERRIDE"
  | "DISPLACEMENT"
  | "INTERRUPT_IMMUNE"
  | "ROOT_SLOW_IMMUNE"
  | "DODGE"
  | "DELAYED_DAMAGE"
  | "CLEANSE"
  | "FENGLAI_CHANNEL"
  | "WUJIAN_CHANNEL"
  | "DRAW_REDUCTION"
  | "ON_PLAY_DAMAGE"
  | "XINZHENG_CHANNEL"
  | "BONUS_DAMAGE_IF_TARGET_HP_GT"
  | "SCHEDULED_DAMAGE"
  | "DASH"
  | "DIRECTIONAL_DASH"
  | "AOE_APPLY_BUFFS"
  | "JUMP_BOOST"
  | "GROUND_TARGET_DASH"
  | "PERIODIC_DAMAGE"
  | "PERIODIC_HEAL"
  | "PERIODIC_GUAN_TI_HEAL"
  | "CHANNEL_AOE_TICK"
  | "TIMED_AOE_DAMAGE"
  | "TIMED_SELF_DAMAGE"
  | "TIMED_SELF_HEAL"
  | "TIMED_AOE_DAMAGE_IF_SELF_HP_GT"
  | "TIMED_GUAN_TI_HEAL"
  | "TIMED_PULL_TARGET_TO_FRONT"
  | "PLACE_GROUND_ZONE"
  | "PLACE_SHENGTAIJI_ZONE"
  | "BAIZU_AOE"
  | "WUFANG_XINGJIN_AOE"
  | "BANG_DA_GOU_TOU"
  | "STACK_ON_HIT_DAMAGE"
  | "STACK_ON_HIT_GUAN_TI_HEAL"
  | "INSTANT_GUAN_TI_HEAL"
  | "KNOCKED_BACK"
  | "PULLED"
  | "SPEED_BOOST"
  // Level 0 control (removable by cleanse)
  | "ROOT"
  | "SLOW"
  // Jump enhancements
  | "MULTI_JUMP"
  // Knockback: force a dash on the target away from the caster
  | "KNOCKBACK_DASH"
  // Dispel one BUFF-category buff per listed attribute from the target
  | "DISPEL_BUFF_ATTRIBUTE"
  // Cleanse DEBUFF-category buffs from self/friendly by attribute
  | "CLEANSE_DEBUFF_ATTRIBUTE"
  // Immediately settle remaining DoT damage from own debuffs on target (玉石俱焚)
  | "SETTLE_SOURCE_DOTS"
  // Apply DoT debuffs from the caster's equipped ability slots (芙蓉并蒂)
  | "APPLY_SLOT_DOTS"
  // Block all incoming damage while active (雷霆震怒 stun)
  | "DAMAGE_IMMUNE"
  // Self-centered AoE ROOT (三才化生)
  | "SAN_CAI_HUA_SHENG_AOE"
  // 银月斩: damage + DoT with 烈日斩 synergy
  | "YIN_YUE_ZHAN"
  // 烈日斩: damage with 银月斩 synergy + apply debuff
  | "LIE_RI_ZHAN"
  // 横扫六合: AoE damage + DoT with single-hit bonus
  | "HENG_SAO_LIU_HE_AOE"
  // 啸如虎: while this buff is active, HP cannot drop below 1 (cannot be killed)
  | "MIN_HP_1"
  // 五蕴皆空·聂云缩减: reduces the caster's 蹑云逐月 dash distance and duration by 70%
  | "NIEYUN_DASH_REDUCTION"
  // 玄水蛊·毒手: redirects 55% of incoming HP damage to the opponent (source of 毒手)
  | "DAMAGE_REDIRECT_55"
  // 极乐引: instant AOE pull all enemies within range to 1 unit in front of caster, then stun
  | "JILE_YIN_AOE_PULL"
  // 临时飞爪: ground-target dash with no CC-immunity buff (controls can stop it, casting allowed)
  | "LIN_SHI_FEI_ZHUA_DASH"
  // 化蝶 Phase 1: diagonal dash (up + forward) over 1 second
  | "HUA_DIE_PHASE1"
  // Flat bonus damage taken (added to base damage, not multiplicative)
  | "DAMAGE_TAKEN_FLAT"
  // 剑主天地: 1 damage + stacking dot, detonates at 3 stacks
  | "JIAN_ZHU_TIAN_DI_STRIKE"
  // 破风: 1 damage + 破风 debuff + 流血, extra stack if CONTROL_IMMUNE
  | "PO_FENG_STRIKE"
  // 外功闪避: dodge chance that only applies to non-内功 (physical / untyped) attacks
  | "PHYSICAL_DODGE"
  // 无相诀: scaling damage reduction based on current HP percentage
  | "DAMAGE_REDUCTION_HP_SCALING"
  // 斩无常: immune to abilities with isProjectile:true
  | "PROJECTILE_IMMUNE"
  // 应天授命: unlimited shield + periodic true-damage settle mechanic
  | "YING_TIAN_SHIELD"
  // 灭: conditional damage (2 or 12) + MIN_HP_1 buff if caster HP < 10%
  | "MIE_STRIKE"
  // 斩无常: periodic 贯体 heal to nearby allies within range
  | "CHANNEL_AOE_TICK_DAMAGE"
  // 孤影化双: snapshot HP+cooldowns and apply buff; GameLoop restores on expiry
  | "GU_YING_HUA_SHUANG"
  // 逐云寒蕊: place targetable HP-bearing zone entity below caster + grant control immunity
  | "PLACE_ZHU_YUN_HAN_RUI"
  // 沧月: 1 damage + 2s knockdown on primary target, knock back others within 6u for 30u
  | "CANG_YUE_AOE"
  // 徐如林 (parent self-buff): on dealing damage, 50% chance to apply XU_RU_LIN_RESTORE
  | "XU_RU_LIN_PROC"
  // 徐如林·回复 (child self-buff): on natural expire, heal caster 5
  | "XU_RU_LIN_RESTORE"
  // Position lock: while active, Z (vertical) position and gravity are suspended.
  // Used together with CONTROL for an "anchor in mid-air" lock (亢龙·定身, 龙啸九天).
  | "Z_LOCK"
  // 抱残式: jump peak-height multiplier (e.g. 0.5 = 50% jump height)
  | "JUMP_NERF"
  // 拿云式: true damage that ignores DR/shield/dodge but is blocked by INVULNERABLE
  | "TRUE_DAMAGE"
  // 龙啸九天: cleanse self, apply 龙威/龙啸九天/定身 buffs, AOE 6u damage + slow knockback
  | "LONG_XIAO_JIU_TIAN_AOE"
  // 驭羽骋风: cleanse self + vertical dash up 12u in 1s
  | "YU_YU_DASH"
  // 梯云纵: while active, jumps are 3× high (stacks multiplicatively with MULTI_JUMP)
  | "TI_YUN_ZONG_JUMP"
  // 梯云纵: refresh 赑云逐月 cooldown on cast
  | "TI_YUN_ZONG_REFRESH"
  // 疾电叱羽: place an HP-bearing redirect zone below caster (allies inside redirect dmg to zone)
  | "PLACE_JI_DIAN_ZONE"
  // 疾电叱羽 ally buff: while active, all incoming damage is redirected to the linked zone
  | "JI_DIAN_REDIRECT"
  // 乘黄之威: forward dash 12u + flip facing 180° + apply 恐惧 to enemies in 6u/120° cone behind
  | "CHENG_HUANG_DASH"
  // 恐惧: silence + forced walk away from sourceUserId
  | "FEARED"
  // 蚀心蛊: lose control and either march in a stored direction or stand still
  | "SHI_XIN_GU"
  // 蚀心: repeat-hit marker that halves the next 蚀心蛊 duration
  | "SHI_XIN_MARK"
  // 鸿蒙天禁: hidden untargetable / invulnerable state that still allows actions
  | "HONG_MENG_TIAN_JIN"
  // 曙色: temporarily cannot receive 鸿蒙天禁 again
  | "HONG_MENG_TIAN_JIN_IMMUNE"
  // 盾立: reflect explicit player-targeted enemy casts back to the original caster
  | "DUN_LI_REFLECT"
  // 振翅图南 / 飞刃回转: place a damage zone that follows a target at fixed speed
  | "PLACE_FOLLOW_ZONE"
  // 天绝地灭: place a growing zone that pulls + explodes on expire
  | "PLACE_GROW_PULL_ZONE"
  // 连环弩: channel a 3-tick beam (1/2/3 dmg) on target with knockback when target is too close
  | "LIAN_HUAN_NU_TICK"
  // 如意法: next eligible attack applies the recorded control package
  | "APPLY_RECORDED_CONTROL_ON_ATTACK"
  // 游风飘踪 / 如意法 custom cleanse-and-control handlers
  | "YOU_FENG_PIAO_ZONG"
  | "RU_YI_FA";

/**
 * Immediate ability effects
 */
export interface AbilityEffect {
  type: EffectType;
  value?: number;
  chance?: number;
  repeatTurns?: number;
  maxTargets?: number;

  allowWhileControlled?: boolean;
  allowWhileKnockedBack?: boolean;
  allowWhilePulled?: boolean;
  allowWhileDisplaced?: boolean;
  cleanseRootSlow?: boolean;
  applyTo?: TargetType;

  threshold?: number;

  /** Direction mode for DIRECTIONAL_DASH effects */
  dirMode?: "TOWARD" | "AWAY" | "PERP_LEFT" | "PERP_RIGHT";

  /**
   * For DIRECTIONAL_DASH: how many game-loop ticks the dash lasts.
    * Defaults to Math.round(distance * 1.5) (≈ 30 ticks for 20 units at 30 Hz).
   * Set explicitly on abilities where exact timing matters.
   */
  durationTicks?: number;

  /** Range (units) for CHANNEL_AOE_TICK — target must be within this distance */
  range?: number;

  /** For zone placement effects: custom zone duration in ms. */
  zoneDurationMs?: number;

  /** For zone placement effects: custom tick interval in ms. */
  zoneIntervalMs?: number;

  /** For zone placement effects: offset from caster in gameplay units. */
  zoneOffsetUnits?: number;

  /** For zone placement effects: vertical effective height in gameplay units. */
  zoneHeight?: number;

  /**
   * For DIRECTIONAL_DASH: when true, dash heading is steered by live facing every tick.
   */
  steerByFacing?: boolean;

  /**
   * For DIRECTIONAL_DASH: explicit horizontal speed in units/tick.
   * If omitted, speed is derived from value / durationTicks.
   */
  speedPerTick?: number;

  /**
   * For DIRECTIONAL_DASH: instant vertical snap up on dash start.
   */
  snapUpUnits?: number;

  /**
   * For DIRECTIONAL_DASH: if blocked by wall/obstacle, switch to downward dive.
   */
  wallDiveOnBlock?: boolean;

  /**
   * For wall-dive dashes: downward vz applied when wall collision is detected.
   */
  diveVzPerTick?: number;

  /**
   * For DIRECTIONAL_DASH: extra damage applied to enemies intersecting the dash route.
   * Processed immediately on cast.
   */
  routeDamage?: number;

  /**
   * For DIRECTIONAL_DASH route damage: collision radius around dash path.
   */
  routeRadius?: number;

  /**
   * For KNOCKBACK_DASH: stun duration (ms) if target hits a wall during the dash.
   */
  wallStunMs?: number;

  /**
   * For DIRECTIONAL_DASH: optional arc peak height in world units.
   * When set, dash vertical movement follows a jump-like arc instead of flat inertia.
   */
  arcPeakHeight?: number;

  /**
   * For DISPEL_BUFF_ATTRIBUTE: list of buff attributes to dispel.
   * One BUFF-category buff per attribute will be removed from the target.
   * For CLEANSE_DEBUFF_ATTRIBUTE: list of attributes to cleanse from self/friendly.
   */
  attributes?: string[];

  /**
   * For CLEANSE_DEBUFF_ATTRIBUTE: how many buffs per attribute to remove. Defaults to 1.
   */
  count?: number;

  /**
   * For SETTLE_SOURCE_DOTS: the ability IDs whose DoT debuffs should be settled.
   */
  sourceAbilityIds?: string[];

  /**
   * For APPLY_SLOT_DOTS: the ability IDs to check in the caster's ability slot.
   */
  slotAbilityIds?: string[];

  /**
   * For DAMAGE_REDUCTION: when set, only applies to incoming damage of this type.
   * Values: "外功" | "内功" | "无"
   */
  damageType?: string;
}

// Fields only used on BuffEffect (not AbilityEffect) are declared below.

/**
 * Buff-contained effects
 */
export type BuffEffect = Omit<AbilityEffect, "allowWhileControlled"> & {
  when?: TurnPhase;
  target?: ScheduledTarget;
  turnOf?: ScheduledTurnOf;

  lifestealPct?: number;
  debug?: string;

  /**
   * For TIMED_AOE_DAMAGE: fires once this many ms after the buff was applied.
   * e.g. 3000 = fires 3 seconds after the buff starts.
   */
  delayMs?: number;

  /**
   * For TIMED_AOE_DAMAGE: cone angle in degrees.
   * 180 = front hemisphere (facing direction), 360 = full circle.
   * Defaults to 360 if omitted.
   */
  aoeAngle?: number;

  /**
   * For TIMED_AOE_DAMAGE: push target this many units away from the caster on hit.
   */
  knockbackUnits?: number;

  /**
   * For TIMED_AOE_DAMAGE: silence the knocked-back target for this many ms.
   */
  knockbackSilenceMs?: number;

  /**
   * For zone placement effects: custom zone duration in ms.
   */
  zoneDurationMs?: number;

  /**
   * For zone placement effects: vertical effective height.
   */
  zoneHeight?: number;

  /**
   * When set on a DAMAGE_MULTIPLIER (or similar) effect inside a buff,
   * the bonus only applies when the ability being cast matches this id.
   * e.g. '听雷·伤' buff should only boost damage from 'ting_lei' casts.
   */
  restrictToAbilityId?: string;
};
