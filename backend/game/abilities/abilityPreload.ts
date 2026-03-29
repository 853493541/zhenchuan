import { ABILITIES } from "./abilities";

/**
 * Frontend-facing preload payload.
 * - Display only
 * - No engine logic
 * - O(1) lookup friendly
 * - Backend is the single source of truth for ALL text
 */
export function buildAbilityPreload() {
  const abilities: any[] = [];
  const buffs: any[] = [];

  const TEST_COOLDOWN_CAP_TICKS = 150; // 5 seconds at 30Hz
  const clampCooldownTicksForTesting = (ticks: number | undefined) => {
    if (ticks === undefined) return 0;
    if (ticks <= 0) return 0;
    return Math.min(ticks, TEST_COOLDOWN_CAP_TICKS);
  };

  for (const ability of Object.values(ABILITIES)) {
    const cardPayload = {
      id: ability.id,
      name: ability.name,
      description: ability.description,
      type: ability.type,
      gcd: !!(ability as any).gcd,
      target: ability.target,
      effects: ability.effects ?? [],

      // Range data for client-side ability readiness check
      range:    (ability as any).range,
      minRange: (ability as any).minRange,

      // Cooldown length for arc display
      cooldownTicks: clampCooldownTicksForTesting((ability as any).cooldownTicks),

      // Charge metadata (for multi-charge abilities)
      maxCharges: (ability as any).maxCharges,
      chargeRecoveryTicks: clampCooldownTicksForTesting((ability as any).chargeRecoveryTicks),
      chargeCastLockTicks: (ability as any).chargeCastLockTicks,

      // Common movement abilities are always shown regardless of draft
      isCommon: !!(ability as any).isCommon,

      // Opponent-target abilities require facing by default unless explicitly disabled.
      faceDirection:
        ability.target === "OPPONENT"
          ? (ability as any).faceDirection !== false
          : !!(ability as any).faceDirection,

      // Grounded-only cast check for client-side readiness/validation.
      requiresGrounded: !!(ability as any).requiresGrounded,

      // 轻功 tag: blocked by 封轻功.
      qinggong: !!(ability as any).qinggong,

      // Hybrid cast abilities may be cast on ground without a selected target.
      allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,
    };

    abilities.push(cardPayload);

    if (Array.isArray(ability.buffs)) {
      for (const buff of ability.buffs) {
        buffs.push({
          buffId: buff.buffId,
          name: buff.name,
          category: buff.category,

          durationMs: buff.durationMs,
          breakOnPlay: buff.breakOnPlay ?? false,
          initialStacks: buff.initialStacks,

          description: buff.description ?? "无",
          effects: buff.effects ?? [],

          // UI helpers
          sourceAbilityId: ability.id,
          sourceAbilityName: ability.name,
        });
      }
    }
  }

  // Runtime-generated buff metadata (not declared directly in ABILITIES).
  buffs.push({
    buffId: 1202,
    name: "摩诃无量·眩晕",
    category: "DEBUFF",
    durationMs: 2_000,
    breakOnPlay: false,
    description: "眩晕：无法移动、跳跃和施放技能",
    effects: [{ type: "CONTROL" }],
    sourceAbilityId: "mohe_wuliang",
    sourceAbilityName: "摩诃无量",
  });

  buffs.push({
    buffId: 1310,
    name: "生太极·护体",
    category: "BUFF",
    durationMs: 3_000,
    breakOnPlay: false,
    description: "免疫等级1控制",
    effects: [{ type: "CONTROL_IMMUNE" }],
    sourceAbilityId: "qionglong_huasheng",
    sourceAbilityName: "穹隆化生",
  });

  buffs.push({
    buffId: 1311,
    name: "生太极·迟滞",
    category: "DEBUFF",
    durationMs: 3_000,
    breakOnPlay: false,
    description: "移动速度降低40%",
    effects: [{ type: "SLOW", value: 0.4 }],
    sourceAbilityId: "qionglong_huasheng",
    sourceAbilityName: "穹隆化生",
  });

  const abilityMap = Object.fromEntries(
    abilities.map((c) => [c.id, c])
  );

  const buffMap = Object.fromEntries(
    buffs.map((b) => [b.buffId, b])
  );

  return {
    abilities,
    abilityMap,
    buffs,
    buffMap,
  };
}
