import { ABILITIES } from "./abilities";
import { applyPropertyOverridesToEffects, BuffEditorOverrideEntry, loadBuffEditorOverrides } from "./buffEditorOverrides";

const BUFF_ICON_PATH_OVERRIDES: Record<string, string> = {
  "心诤": "/icons/心诤-buff.png",
  "散流霞": "/icons/散流霞-buff.png",
  "长针": "/icons/长针-buff.png",
  "风袖低昂": "/icons/风袖低昂-buff.png",
};

function hasEffectFlag(
  ability: { effects?: Array<Record<string, unknown>> },
  flag: "allowWhileControlled" | "allowWhileKnockedBack" | "cleanseRootSlow",
  effectType?: string
) {
  return Array.isArray(ability.effects)
    ? ability.effects.some((effect) => {
        if (effectType && effect.type !== effectType) return false;
        return effect[flag] === true;
      })
    : false;
}

/**
 * Frontend-facing preload payload.
 * - Display only
 * - No engine logic
 * - O(1) lookup friendly
 * - Backend is the single source of truth for ALL text
 */
export function buildAbilityPreload(options?: { applyBuffEditorOverrides?: boolean }) {
  const abilities: any[] = [];
  const buffs: any[] = [];
  const applyBuffEditorOverrides = options?.applyBuffEditorOverrides !== false;
  const { overrides: buffEditorOverrides } = applyBuffEditorOverrides
    ? loadBuffEditorOverrides()
    : { overrides: {} as Record<string, BuffEditorOverrideEntry> };

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

      // Standing-only cast check (no horizontal movement and not airborne).
      requiresStanding: !!(ability as any).requiresStanding,

      // Optional self HP gate (exclusive), shields are not counted.
      minSelfHpExclusive:
        typeof (ability as any).minSelfHpExclusive === "number"
          ? (ability as any).minSelfHpExclusive
          : undefined,

      // 轻功 tag: blocked by 封轻功.
      qinggong: !!(ability as any).qinggong,

      // Hybrid cast abilities may be cast on ground without a selected target.
      allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,

      // Some mobility skills are explicitly blocked while rooted.
      cannotCastWhileRooted: !!(ability as any).cannotCastWhileRooted,

      // Editor/runtime cast exception flags.
      allowWhileControlled:
        (ability as any).allowWhileControlled === true ||
        hasEffectFlag(ability as any, "allowWhileControlled"),

      allowWhileKnockedBack:
        (ability as any).allowWhileKnockedBack === true ||
        hasEffectFlag(ability as any, "allowWhileKnockedBack"),

      cleanseRootSlow:
        (ability as any).cleanseRootSlow === true ||
        hasEffectFlag(ability as any, "cleanseRootSlow", "CLEANSE"),
    };

    abilities.push(cardPayload);

    if (Array.isArray(ability.buffs)) {
      for (const buff of ability.buffs) {
        const buffPayload: any = {
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
        };
        if (buff.buffId === 1008) {
          buffPayload.hiddenInStatusBar = true;
        }
        if (Array.isArray(buff.effects) && buff.effects.some((effect) => effect?.type === "DASH_TURN_OVERRIDE")) {
          buffPayload.hiddenInStatusBar = true;
        }
        buffs.push(buffPayload);
      }
    }
  }

  // Runtime-generated buff metadata (not declared directly in ABILITIES).
  buffs.push({
    buffId: 1007,
    name: "散流霞",
    category: "BUFF",
    durationMs: 5_000,
    breakOnPlay: false,
    description: "不可选中，移动速度提高20%，首秒无治疗，随后每秒回复2%最大气血",
    effects: [
      { type: "UNTARGETABLE" },
      { type: "SPEED_BOOST", value: 0.2 },
      { type: "PERIODIC_GUAN_TI_HEAL", value: 2 },
    ],
    sourceAbilityId: "sanliu_xia",
    sourceAbilityName: "散流霞",
  });

  buffs.push({
    buffId: 999900,
    name: "位移中",
    category: "BUFF",
    breakOnPlay: false,
    description: "冲刺期间无法转向、无法施放技能或轻功，并免疫控制与击退。所有 dash 共用这一运行态。",
    effects: [
      { type: "CONTROL_IMMUNE" },
      { type: "KNOCKBACK_IMMUNE" },
      { type: "DISPLACEMENT" },
      { type: "DASH_TURN_LOCK" },
    ],
    iconPath: "/icons/蹑云逐月.png",
  });

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
    buffId: 990100,
    name: "锁足抗性",
    category: "BUFF",
    durationMs: 10_000,
    breakOnPlay: false,
    description: "10秒内锁足递减。每次锁足成功后层数+1并刷新计时，下一次锁足持续时间按0.5^层数递减。",
    effects: [],
  });

  buffs.push({
    buffId: 990101,
    name: "眩晕抗性",
    category: "BUFF",
    durationMs: 10_000,
    breakOnPlay: false,
    description: "10秒内眩晕递减。每次眩晕成功后层数+1并刷新计时，下一次眩晕持续时间按0.5^层数递减。击倒不计入眩晕递减。",
    effects: [],
  });

  buffs.push({
    buffId: 990102,
    name: "锁招抗性",
    category: "BUFF",
    durationMs: 10_000,
    breakOnPlay: false,
    description: "10秒内锁招递减。每次沉默或同类锁招成功后层数+1并刷新计时，下一次持续时间按0.5^层数递减。封轻功不参与这一递减。",
    effects: [],
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

  buffs.push({
    buffId: 1320,
    name: "镇山河",
    category: "BUFF",
    durationMs: 2_000,
    breakOnPlay: false,
    description: "施放后至少获得2秒无敌，敌方技能会正常消耗，但不会对你造成伤害或附加效果。",
    effects: [{ type: "INVULNERABLE" }],
    sourceAbilityId: "zhen_shan_he",
    sourceAbilityName: "镇山河",
  });

  buffs.push({
    buffId: 1323,
    name: "镇山河",
    category: "BUFF",
    durationMs: 100,
    breakOnPlay: false,
    description: "位于镇山河区域内时每0.1秒刷新0.1秒无敌效果。",
    effects: [{ type: "INVULNERABLE" }],
    sourceAbilityId: "zhen_shan_he",
    sourceAbilityName: "镇山河",
  });

  buffs.push({
    buffId: 1321,
    name: "玄剑",
    category: "DEBUFF",
    durationMs: 12_000,
    breakOnPlay: false,
    description: "镇山河入场标记。自然结束后转为【化生势】。",
    effects: [],
    sourceAbilityId: "zhen_shan_he",
    sourceAbilityName: "镇山河",
  });

  buffs.push({
    buffId: 1322,
    name: "化生势",
    category: "DEBUFF",
    durationMs: 180_000,
    breakOnPlay: false,
    description: "期间无法再次获得镇山河区域效果。",
    effects: [],
    sourceAbilityId: "zhen_shan_he",
    sourceAbilityName: "镇山河",
  });

  // 2316 春泥护花 is declared on the ability itself (buildAbilityPreload auto-includes it)
  // 2317 圣明佑 dodge buff — auto-included from ability
  // 2318 太阴指 dodge buff — auto-included from ability

  // 2403 滞影 — dynamically applied by GameLoop on 捉影式 channel completion
  buffs.push({
    buffId: 2403,
    name: "滞影",
    category: "DEBUFF",
    durationMs: 5_000,
    breakOnPlay: false,
    description: "封轻功：无法施展轻功招式",
    effects: [{ type: "QINGGONG_SEAL" }],
    sourceAbilityId: "zhuo_ying_shi",
    sourceAbilityName: "捉影式",
  });

  for (const buff of buffs) {
    const override = buffEditorOverrides[String(buff.buffId)];
    if (!buff.iconPath) {
      buff.iconPath = BUFF_ICON_PATH_OVERRIDES[buff.name] ?? `/icons/${buff.name}.png`;
    }
    if (override?.name) {
      buff.name = override.name;
    }
    if (override?.description) {
      buff.description = override.description;
    }
    if (typeof override?.hidden === "boolean") {
      buff.hiddenInStatusBar = override.hidden;
    }
    // Apply duration override so the engine uses the editor-set duration
    if (typeof override?.durationMs === "number") {
      buff.durationMs = override.durationMs;
    }
    // Apply property overrides to effects (so UI snapshot reflects actual engine values)
    if (override?.properties !== undefined) {
      buff.effects = applyPropertyOverridesToEffects(buff, override.properties);
    }
  }

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
