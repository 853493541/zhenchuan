// engine/flow/applyAbilityBuffs.ts

import { GameState, Ability, ActiveBuff } from "../../state/types";
import {
  shouldSkipDueToDodge,
  blocksNewBuffByUntargetable,
  blocksControlByImmunity,
} from "../../rules/guards";
import { handleApplyBuffs } from "../../effects/handlers";

/**
 * Apply persistent buffs defined on a ability (ability.buffs).
 *
 * IMPORTANT:
 * - ability.buffs contains BuffDefinition[] (static definitions)
 * - ActiveBuffs exist on players (runtime) and are created ONLY by handlers
 *
 * Rules preserved:
 * - Dodge cancels enemy-applied buffs only
 * - Untargetable blocks enemy-applied NEW buffs
 * - Control immunity blocks CONTROL buffs only
 * - Buffs are applied one-by-one (legacy behavior)
 */
export function applyAbilityBuffs(params: {
  state: GameState;
  ability: Ability;
  source: { userId: string; buffs: ActiveBuff[] };
  target: { userId: string; buffs: ActiveBuff[] };
  entityTarget?: { userId: string; buffs: ActiveBuff[] } | null;
  abilityDodged: boolean;
}) {
  const { state, ability, source, target, entityTarget, abilityDodged } = params;

  // 百足/五方行尽/棒打狗头/大狮子吼 buff application is handled via custom immediate effect logic.
  // 撼地 stun is applied by the post-dash GameLoop handler (only when enemy is within AOE range on landing).
  // 九转归一 buffs are applied manually in immediateEffects (KNOCKED_BACK) and GameLoop (羽化 wall stun).
  // 鹤归孤山 stun is applied by the post-dash GameLoop handler; only its own buffs[0] stun is excluded.
  // 绛唇珠袖: only buff 2323 (debuff) is applied at cast time; buff 2324 (silence) is trigger-only.
  // 银月斩/烈日斩/横扫六合: buff application handled in custom effect handlers (synergy logic).
  // 三才化生: buff application handled in SAN_CAI_HUA_SHENG_AOE handler.
  // 极乐引: SELF-cast AOE; buffs applied manually in JILE_YIN_AOE_PULL handler to enemies only.
  // 化蝶: buff 2613 (stealth/immune) applied in GameLoop when Phase 2 starts, NOT on cast.
  // 剑主天地: buff 2614 applied/managed in JIAN_ZHU_TIAN_DI_STRIKE handler (detonation logic).
  // 破风: buffs 2615/2616 applied in PO_FENG_STRIKE handler (conditional extra bleed stack).
  if (
    ability.id === "baizu" ||
    ability.id === "han_di" ||
    ability.id === "jiu_zhuan_gui_yi" ||
    ability.id === "he_gui_gu_shan" ||
    ability.id === "jiang_chun_zhu_xiu" ||
    ability.id === "wufang_xingjin" ||
    ability.id === "yin_yue_zhan" ||
    ability.id === "lie_ri_zhan" ||
    ability.id === "heng_sao_liu_he" ||
    ability.id === "san_cai_hua_sheng" ||
    ability.id === "ji_le_yin" ||
    ability.id === "hua_die" ||
    ability.id === "jian_zhu_tian_di" ||
    ability.id === "po_feng" ||
    ability.id === "ji_dian_chi_yu" ||
    ability.id === "cheng_huang_zhi_wei" ||
    ability.id === "shi_xin_gu" ||
    ability.id === "hong_meng_tian_jin" ||
    ability.id === "you_feng_piao_zong" ||
    ability.id === "ru_yi_fa" ||
    ability.id === "gu_ying_hua_shuang" ||
    ability.id === "zhu_yun_han_rui" ||
    ability.id === "cang_yue" ||
    ability.id === "xu_ru_lin" ||
    ability.id === "tai_ji_wu_ji" ||
    ability.id === "long_xiao_jiu_tian" ||
    (Array.isArray(ability.effects) &&
      ability.effects.some((e: any) =>
        e.type === "AOE_APPLY_BUFFS" ||
        e.type === "WUFANG_XINGJIN_AOE" ||
        e.type === "BANG_DA_GOU_TOU"
      ))
  ) {
    return;
  }

  if (!Array.isArray(ability.buffs) || ability.buffs.length === 0) return;

  // Ability-level target (used as fallback when buff has no applyTo override)
  const abilityBuffTarget = ability.target === "SELF" ? source : (entityTarget ?? target);
  const abilityEnemyApplied = abilityBuffTarget.userId !== source.userId;

  // Dodge cancels enemy-applied buffs only (ability-level check)
  if (shouldSkipDueToDodge(abilityDodged, abilityEnemyApplied)) return;

  // Untargetable blocks enemy-applied NEW buffs (ability-level check)
  if (blocksNewBuffByUntargetable(source, abilityBuffTarget)) return;

  for (const buff of ability.buffs) {
    // Per-buff applyTo override: a buff can specify "SELF" or "OPPONENT" regardless
    // of the ability's target field (e.g. 云飞玉皇 channels a self-buff while targeting an enemy)
    const localBuffTarget =
      buff.applyTo === "SELF" ? source
      : buff.applyTo === "OPPONENT" ? (entityTarget ?? target)
      : abilityBuffTarget;
    const localEnemyApplied = localBuffTarget.userId !== source.userId;

    const isControl =
      Array.isArray(buff.effects) &&
      buff.effects.some((e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK");

    // Control immunity blocks CONTROL buffs (guard needs target.buffs)
    if (isControl && blocksControlByImmunity("CONTROL", localBuffTarget)) {
      continue;
    }

    // PROJECTILE_IMMUNE: skip enemy-applied buffs from projectile abilities
    if (
      localEnemyApplied &&
      (ability as any).isProjectile === true &&
      localBuffTarget.buffs.some(
        (b: any) =>
          b.effects.some((e: any) => e.type === "PROJECTILE_IMMUNE") &&
          b.expiresAt > Date.now()
      )
    ) {
      continue;
    }

    // Legacy behavior: apply buffs one-by-one
    const originalBuffs: Ability["buffs"] = ability.buffs;
    ability.buffs = [buff];

    handleApplyBuffs({
      state,
      ability,
      source,
      target: localBuffTarget,
      isEnemyEffect: localEnemyApplied,
    });

    ability.buffs = originalBuffs;
  }
}
