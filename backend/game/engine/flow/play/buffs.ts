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
  abilityDodged: boolean;
}) {
  const { state, ability, source, target, abilityDodged } = params;

  // 百足/五方行尽/棒打狗头/大狮子吼 buff application is handled via custom immediate effect logic.
  // 撼地 stun is applied by the post-dash GameLoop handler (only when enemy is within AOE range on landing).
  // 九转归一 buffs are applied manually in immediateEffects (KNOCKED_BACK) and GameLoop (羽化 wall stun).
  // 鹤归孤山 stun is applied by the post-dash GameLoop handler; only its own buffs[0] stun is excluded.
  // 绛唇珠袖: only buff 2323 (debuff) is applied at cast time; buff 2324 (silence) is trigger-only.
  // 银月斩/烈日斩/横扫六合: buff application handled in custom effect handlers (synergy logic).
  // 三才化生: buff application handled in SAN_CAI_HUA_SHENG_AOE handler.
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
  const abilityBuffTarget = ability.target === "SELF" ? source : target;
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
      : buff.applyTo === "OPPONENT" ? target
      : abilityBuffTarget;
    const localEnemyApplied = localBuffTarget.userId !== source.userId;

    const isControl =
      Array.isArray(buff.effects) &&
      buff.effects.some((e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK");

    // Control immunity blocks CONTROL buffs (guard needs target.buffs)
    if (isControl && blocksControlByImmunity("CONTROL", localBuffTarget)) {
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
