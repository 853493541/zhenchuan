// backend/game/abilities/abilities.ts

import { Ability } from "../engine/state/types";

export const ABILITIES: Record<string, Ability & { description: string }> = {
  /* ================= 通用技能 (common abilities — always in every player's hand) ================= */

  menghu_xiasha: {
    id: "menghu_xiasha",
    name: "回风扫叶",
    description: "造成1点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    range: 4,
    gcd: true,
    cooldownTicks: 0,
    effects: [{ type: "DAMAGE", value: 1 }],
    isCommon: true,
  },

  nieyun_zhuyue: {
    id: "nieyun_zhuyue",
    name: "蹑云逐月",
    description: "向对手方向冲刺20格",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds at 60 Hz
    qinggong: true,
    effects: [{ type: "DIRECTIONAL_DASH", value: 20, dirMode: "TOWARD", durationTicks: 30 }],
    isCommon: true,
  },

  yingfeng_huilang: {
    id: "yingfeng_huilang",
    name: "迎风回浪",
    description: "向身后方向冲刺10格",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds at 60 Hz
    qinggong: true,
    effects: [{ type: "DIRECTIONAL_DASH", value: 10, dirMode: "AWAY", durationTicks: 21 }],
    isCommon: true,
  },

  lingxiao_lansheng: {
    id: "lingxiao_lansheng",
    name: "凌霄揽胜",
    description: "向左侧冲刺7格",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds at 60 Hz
    qinggong: true,
    effects: [{ type: "DIRECTIONAL_DASH", value: 7, dirMode: "PERP_LEFT", durationTicks: 30 }],
    isCommon: true,
  },

  yaotai_zhenhe: {
    id: "yaotai_zhenhe",
    name: "瑶台枕鹤",
    description: "向右侧冲刺7格",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds at 60 Hz
    qinggong: true,
    effects: [{ type: "DIRECTIONAL_DASH", value: 7, dirMode: "PERP_RIGHT", durationTicks: 30 }],
    isCommon: true,
  },

  fuyao_zhishang: {
    id: "fuyao_zhishang",
    name: "扶摇直上",
    description: "获得【弹跳】：下次跳跃高度提升至12单位",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds at 60 Hz
    qinggong: true,
    requiresGrounded: true,
    effects: [],
    buffs: [
      {
        buffId: 9001,
        name: "弹跳",
        category: "BUFF",
        durationMs: 30_000,  // consumed by movement.ts on next jump; 30-second fallback expiry
        description: "下次跳跃高度提升至12单位",
        effects: [{ type: "JUMP_BOOST" }],
        applyTo: "SELF",
      },
    ],
    isCommon: true,
  },

  houyao: {
    id: "houyao",
    name: "后撤",
    description: "向身后方向后撤2.7格（持续1秒）\n只能在地面施放",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 0,
    gcd: false,
    qinggong: true,
    requiresGrounded: true,
    effects: [{ type: "DIRECTIONAL_DASH", value: 2.7, dirMode: "AWAY", durationTicks: 30 }],
    isCommon: true,
  },

  ji: {
    id: "ji",
    name: "疾",
    description: "向前冲刺37格（1秒），对冲刺路径上的敌方单位造成10点伤害",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    qinggong: true,
    effects: [
      {
        type: "DIRECTIONAL_DASH",
        value: 37,
        dirMode: "TOWARD",
        durationTicks: 30,
        routeDamage: 10,
        routeRadius: 2,
      },
    ],
    isCommon: false,
  },

  yuqi: {
    id: "yuqi",
    name: "御骑",
    description: "【占位技能】",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    effects: [],
    isCommon: true,
  },

  /* ================= 基础攻击 ================= */

  jianpo_xukong: {
    id: "jianpo_xukong",
    name: "剑破虚空",
    description: "需要目标，正面180°\n造成10点伤害并附加【剑破虚空】2秒（减速20%，无法施展轻功）\n叠加【急曲】18秒：每3秒受到1点伤害，最多3层",
    type: "ATTACK",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    faceDirection: true,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 2201,
        name: "剑破虚空",
        category: "DEBUFF",
        durationMs: 2_000,
        description: "减速20%，无法施展轻功招式",
        effects: [
          { type: "SLOW", value: 0.2 },
          { type: "QINGGONG_SEAL" },
        ],
      },
      {
        buffId: 2202,
        name: "急曲",
        category: "DEBUFF",
        durationMs: 18_000,
        periodicMs: 3_000,  // fires every 3 seconds
        initialStacks: 1,
        maxStacks: 3,
        description: "每3秒受到1点伤害（最多3层）",
        effects: [{ type: "PERIODIC_DAMAGE", value: 1 }],
      },
    ],
  },

  sanhuan_taoyue: {
    id: "sanhuan_taoyue",
    name: "三环套月",
    description: "造成3点伤害，并叠加【三环套月】；叠满3层时引爆并额外造成3点伤害（持续10秒）",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 0,
    gcd: true,
    range: 4,
    effects: [
      { type: "DAMAGE", value: 3 },
    ],
    buffs: [
      {
        buffId: 3001,
        name: "三环套月",
        category: "DEBUFF",
        durationMs: 10_000,
        initialStacks: 1,
        maxStacks: 3,
        description: "叠满3层时引爆造成额外伤害",
        effects: [],
      },
    ],
  },

  baizu: {
    id: "baizu",
    name: "百足",
    description: "可选目标或地面施放（范围6）\n命中后立刻造成5点伤害\n附加【百足】18秒：每3秒造成6点伤害，结束时额外造成5点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    range: 25,
    cooldownTicks: 300,
    gcd: true,
    faceDirection: false,
    allowGroundCastWithoutTarget: true,
    effects: [{ type: "BAIZU_AOE", value: 5, range: 6 }],
    buffs: [
      {
        buffId: 1001,
        name: "百足",
        category: "DEBUFF",
        durationMs: 18_000,
        periodicMs: 3_000,  // fires every 3 seconds
        description: "每3秒受到6点伤害，结束时额外受到5点伤害",
        effects: [
          { type: "PERIODIC_DAMAGE", value: 6 },
          { type: "TIMED_SELF_DAMAGE", value: 5, delayMs: 18_000 },
        ],
      },
    ],
  },

  /* ================= 控制 / 压制 ================= */

  mohe_wuliang: {
    id: "mohe_wuliang",
    name: "摩诃无量",
    description: "造成10点伤害并击倒3秒；击倒自然结束时若目标气血低于30%，额外眩晕2秒",
    type: "CONTROL",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1002,
        name: "摩诃无量",
        category: "DEBUFF",
        durationMs: 3_000,
        description: "倒地：无法移动、跳跃和施放技能",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  shengsi_jie: {
    id: "shengsi_jie",
    name: "生死劫",
    description: "造成1点伤害\n附加【日劫】眩晕4秒\n附加【月劫】治疗效果降低50%",
    type: "CONTROL",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 1 }],
    buffs: [
      {
        buffId: 1221,
        name: "月劫",
        category: "DEBUFF",
        durationMs: 15_000, // 15 seconds
        description: "受到治疗效果降低50%",
        effects: [{ type: "HEAL_REDUCTION", value: 0.5 }],
      },
      {
        buffId: 1003,
        name: "日劫",
        category: "DEBUFF",
        durationMs: 4_000,
        description: "眩晕",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  chan_xiao: {
    id: "chan_xiao",
    name: "蟾啸",
    description: "造成10点伤害\n目标沉默2秒\n附加【蟾啸】16秒：每2秒受到1点伤害",
    type: "CONTROL",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1025,
        name: "蟾啸",
        category: "DEBUFF",
        durationMs: 16_000,
        periodicMs: 2_000,
        description: "每2秒受到1点伤害",
        effects: [{ type: "PERIODIC_DAMAGE", value: 1 }],
      },
      {
        buffId: 1004,
        name: "蟾啸迷心",
        category: "DEBUFF",
        durationMs: 2_000,
        description: "无法使用技能",
        effects: [{ type: "SILENCE" }],
      },
    ],
  },

  da_shizi_hou: {
    id: "da_shizi_hou",
    name: "大狮子吼",
    description: "怒吼震慑周围敌人，眩晕5秒并降低其技能冷却回复50%",
    type: "CONTROL",
    target: "SELF",
    range: 8,
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "AOE_APPLY_BUFFS", range: 8 }],
    buffs: [
      {
        buffId: 1005,
        name: "大狮子吼",
        category: "DEBUFF",
        durationMs: 5_000, // 5 seconds
        description: "眩晕5秒，冷却回复速度降低50%",
        effects: [
          { type: "CONTROL" },
          { type: "COOLDOWN_SLOW", value: 0.5 },
        ],
      },
    ],
  },

  /* ================= 解控 / 防御 ================= */

  jiru_feng: {
    id: "jiru_feng",
    name: "疾如风",
    description: "解除控制（等级1）\n5秒内免疫控制（不含击退/拉拽），移动速度提升100%",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    qinggong: true,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
    ],
    buffs: [
      {
        buffId: 1033,
        name: "疾如风",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        description: "免疫控制；移动速度+100%",
        effects: [
          { type: "CONTROL_IMMUNE" },
          { type: "SPEED_BOOST", value: 1.0 },
        ],
      },
    ],
  },

  sanliu_xia: {
    id: "sanliu_xia",
    name: "散流霞",
    description: "解控并向前翻越10尺\n起跳获得【散流霞隐藏】1秒：不可选中且自我沉默\n落地后获得【散流霞】5秒：不可选中、移动速度提高20%，首秒无治疗，随后4秒内回复5次贯体（每次2%）",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
      {
        type: "DIRECTIONAL_DASH",
        value: 10,
        dirMode: "TOWARD",
        durationTicks: 30,
        arcPeakHeight: 2.5,
        allowWhileControlled: true,
      },
    ],
    buffs: [
      {
        buffId: 1008,
        name: "散流霞隐藏",
        category: "BUFF",
        durationMs: 1_000,
        description: "不可选中，无法施展技能",
        effects: [
          { type: "UNTARGETABLE" },
          { type: "SILENCE" },
        ],
      },
    ],
  },

  que_ta_zhi: {
    id: "que_ta_zhi",
    name: "鹊踏枝",
    description: "解除等级1控制\n获得【素衿】3.5秒：免疫等级1控制\n获得【鹊踏枝】5秒：70%闪避率\n2层充能，每层5秒恢复，施放间隔1秒",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 0,
    maxCharges: 2,
    chargeRecoveryTicks: 150,
    chargeCastLockTicks: 30,
    gcd: false,
    effects: [{ type: "CLEANSE", allowWhileControlled: true }],
    buffs: [
      {
        buffId: 1030,
        name: "鹊踏枝",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        description: "被命中几率降低70%",
        effects: [{ type: "DODGE_NEXT", chance: 0.7 }],
      },
      {
        buffId: 1031,
        name: "素衿",
        category: "BUFF",
        durationMs: 3_500,
        description: "免控",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  /* ================= 生存 / 回复 ================= */

  fengxiu_diang: {
    id: "fengxiu_diang",
    name: "风袖低昂",
    description: "恢复50点生命值\n获得【天地低昂】10秒：受到伤害降低40%",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "HEAL", value: 50 }],
    buffs: [
      {
        buffId: 1009,
        name: "天地低昂",
        category: "BUFF",
        durationMs: 10_000, // 10 seconds
        description: "受到伤害降低40%",
        effects: [{ type: "DAMAGE_REDUCTION", value: 0.4 }],
      },
    ],
  },

  qionglong_huasheng: {
    id: "qionglong_huasheng",
    name: "穹隆化生",
    description: "向前冲刺2秒（可转向）\n施放时解除锁足与减速\n冲刺期间沉默且免疫等级1/2控制\n结束时恢复10点气血并展开【生太极】24秒",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [
      {
        type: "CLEANSE",
        cleanseRootSlow: true,
      },
      {
        type: "DIRECTIONAL_DASH",
        value: 25,
        dirMode: "TOWARD",
        durationTicks: 60,
        speedPerTick: 0.4166667,
        steerByFacing: true,
      },
    ],
    buffs: [
      {
        buffId: 1010,
        name: "穹隆化生",
        category: "BUFF",
        durationMs: 2_000,
        description: "冲刺期间沉默且免疫等级1/2控制",
        effects: [{ type: "SILENCE" }, { type: "CONTROL_IMMUNE" }, { type: "KNOCKBACK_IMMUNE" }],
      },
    ],
  },

  /* ================= 隐身 / 干扰 ================= */

  anchen_misan: {
    id: "anchen_misan",
    name: "暗尘弥散",
    description: "隐身5秒，移动速度提升100%，受到伤害降低20%",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [{ type: "DRAW", value: 2, allowWhileControlled: true }],
    buffs: [
      {
        buffId: 1011,
        name: "暗尘弥散",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        breakOnPlay: true,
        description: "隐身，移动速度提升100%，受到伤害降低20%",
        effects: [
          { type: "STEALTH" },
          { type: "SPEED_BOOST", value: 1 },
          { type: "DAMAGE_REDUCTION", value: 0.2 },
        ],
      },
    ],
  },

  fuguang_lueying: {
    id: "fuguang_lueying",
    name: "浮光掠影",
    description: "隐身20秒；前5秒遁影减速50%",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    requiresGrounded: true,
    effects: [],
    buffs: [
      {
        buffId: 1012,
        name: "浮光掠影",
        category: "BUFF",
        durationMs: 20_000, // 20 seconds
        breakOnPlay: true,
        description: "隐身20秒",
        effects: [{ type: "STEALTH" }],
      },
      {
        buffId: 1021,
        name: "遁影",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        breakOnPlay: false,
        description: "前5秒移动不破隐，移动速度降低50%",
        effects: [{ type: "SLOW", value: 0.5 }],
      },
    ],
  },

  tiandi_wuji: {
    id: "tiandi_wuji",
    name: "天地无极",
    description: "对前方20尺目标造成2点伤害\n隐身3秒",
    type: "ATTACK",
    target: "OPPONENT",
    faceDirection: true,
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 2 }],
    buffs: [
      {
        buffId: 1013,
        name: "天地无极",
        category: "BUFF",
        durationMs: 3_000, // 3 seconds
        breakOnPlay: true,
        description: "隐身",
        effects: [{ type: "STEALTH" }],
        applyTo: "SELF",
      },
    ],
  },

  /* ================= 运功 / 节奏 ================= */

  fenglai_wushan: {
    id: "fenglai_wushan",
    name: "风来吴山",
    description: "在5秒内，对10尺内目标造成10次伤害",
    originalDescription:
      "发动旋风般的重剑攻击，5秒内对周围10尺内的最多10个目标造成共计10次伤害。在此过程中你无法跳跃，不受控制招式影响（被拉除外）。",
    type: "CHANNEL",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 1014,
        name: "不工",
        category: "BUFF",
        description: "运功中：不受技能控制",
        durationMs: 5_000,   // 5 seconds total channel
        periodicMs: 625,     // 5000 / 8 = 625ms per hit → 8 total hits
        breakOnPlay: true,   // interrupted when player casts another ability
        cancelOnJump: false,
        effects: [
          { type: "CONTROL_IMMUNE" },
          { type: "INTERRUPT_IMMUNE" },
          { type: "CHANNEL_AOE_TICK", value: 8, range: 10 },
        ],
      },
    ],
  },

  wu_jianyu: {
    id: "wu_jianyu",
    name: "无间狱",
    description: "修罗附体\n3秒后正面180°/10码造成5伤害\n4秒后正面180°/10码造成5伤害\n5秒后正面180°/10码造成5伤害\n同时360°/10码造成10伤害并击退3码，击退期间沉默0.8秒\n所有伤害30%吸血",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 1016,
        name: "无间狱",
        category: "BUFF",
        description: "修罗附体",
        durationMs: 10_000, // 10 seconds
        effects: [
          // t+3s: front 180° cone, range 10, 5 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 3_000,
            value: 5,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+4s: front 180° cone, range 10, 5 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 4_000,
            value: 5,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+5s: front 180° cone, range 10, 5 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 5_000,
            value: 5,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+5s: full 360° circle, range 10, 10 damage, knockback 3 + 0.8s silence, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 5_000,
            value: 10,
            aoeAngle: 360,
            range: 10,
            lifestealPct: 0.3,
            knockbackUnits: 3,
            knockbackSilenceMs: 800,
          },
        ],
      },
    ],
  },

  xinzheng: {
    id: "xinzheng",
    name: "心诤",
    description: "逆读条3秒，期间免控；每0.5秒对前方180°/6尺造成2点伤害；结束时额外对前方180°/12尺造成10点伤害",
    type: "CHANNEL",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 1017,
        name: "心诤",
        category: "BUFF",
        durationMs: 3_000,
        periodicMs: 500,
        breakOnPlay: true,
        description: "免疫控制",
        cancelOnMove: false,
        cancelOnJump: false,
        effects: [
          { type: "CONTROL_IMMUNE" },
          { type: "INTERRUPT_IMMUNE" },
          { type: "CHANNEL_AOE_TICK", value: 2, range: 6, aoeAngle: 180 },
          { type: "TIMED_AOE_DAMAGE", delayMs: 3_000, value: 10, range: 12, aoeAngle: 180 },
        ],
      },
    ],
  },

  /* ================= 爆发 / 强化 ================= */

  nuwa_butian: {
    id: "nuwa_butian",
    name: "女娲补天",
    description: "持续20秒：伤害提升100%，免疫锁足与减速，移动速度降低50%，受到伤害降低50%",
    type: "STANCE",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [],
    buffs: [
      {
        buffId: 1019,
        name: "女娲补天",
        category: "BUFF",
        durationMs: 20_000, // 20 seconds
        description: "伤害提升100%，免疫锁足与减速，移动速度降低50%，受到伤害降低50%",
        effects: [
          { type: "DAMAGE_MULTIPLIER", value: 2 },
          { type: "DAMAGE_REDUCTION", value: 0.5 },
          { type: "ROOT_SLOW_IMMUNE" },
          { type: "SLOW", value: 0.5 },
        ],
      },
    ],
  },

  taxingxing: {
    id: "taxingxing",
    name: "踏星行",
    description: "轻功化形5秒：以12.5尺/秒向前冲刺（可转向）\n施放时解除锁足与减速\n起跳抬升8尺，撞墙后立刻下坠\n期间沉默并免疫等级1/2控制\n期间闪避率65%",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    qinggong: true,
    effects: [
      {
        type: "CLEANSE",
        cleanseRootSlow: true,
      },
      {
        type: "DIRECTIONAL_DASH",
        value: 62.5,
        dirMode: "TOWARD",
        durationTicks: 150,
        speedPerTick: 0.4166667,
        steerByFacing: true,
        snapUpUnits: 8,
        wallDiveOnBlock: true,
        diveVzPerTick: -0.45,
      },
    ],
    buffs: [
      {
        buffId: 1020,
        name: "踏星行",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        description: "沉默；免疫等级1/2控制",
        effects: [
          { type: "CONTROL_IMMUNE" },
          { type: "KNOCKBACK_IMMUNE" },
          { type: "DODGE_NEXT", chance: 0.65 },
          { type: "SILENCE" },
        ],
      },
    ],
  },

  /* ================= 其他 ================= */

  zhuiming_jian: {
    id: "zhuiming_jian",
    name: "追命箭",
    description: "需要目标，运功2秒（正读条）\n需要站立施放，移动或跳跃会中断\n完成时造成15点伤害；若自身气血高于60，额外造成9点伤害",
    type: "CHANNEL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    range: 25,
    requiresGrounded: true,
    requiresStanding: true,
    effects: [],
    buffs: [],
    channelDurationMs: 2_000,
    channelCancelOnMove: true,
    channelCancelOnJump: true,
    channelCancelOnOutOfRange: 25,
    channelForward: true,
    channelEffects: [
      { type: "TIMED_AOE_DAMAGE", value: 15, range: 50 },
      { type: "TIMED_AOE_DAMAGE_IF_SELF_HP_GT", value: 9, threshold: 60, range: 50 },
    ],
  } as any,

  /* ================= 位移 ================= */

  zhenshen_xingsi: {
    id: "zhenshen_xingsi",
    name: "龙牙",
    description: "需要目标，冲向敌人（最远20码）\n施放时造成20点伤害",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    range: 20,
    effects: [
      { type: "DAMAGE", value: 20 },
      { type: "DASH", value: 8 },
    ],
  },

  niao_xiang_bi_kong: {
    id: "niao_xiang_bi_kong",
    name: "鸟翔碧空",
    description: "获得【鸟翔碧空】15秒：跳跃次数上限提升至5次",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds
    gcd: true,
    qinggong: true,
    requiresGrounded: true,
    effects: [],
    buffs: [
      {
        buffId: 9002,
        name: "鸟翔碧空",
        category: "BUFF",
        durationMs: 15_000, // 15 seconds
        description: "跳跃次数上限提升至5次",
        effects: [{ type: "MULTI_JUMP", value: 5 }],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 千蝶吐瑞 — 8s reverse channel, 0.5s periodic heal, control immune
  // ──────────────────────────────────────────────────────────────────────────
  qiandie_turui: {
    id: "qiandie_turui",
    name: "千蝶吐瑞",
    description: "逆读条8秒，每0.5秒回复3点气血；运功期间免控，移动会打断并失去效果",
    type: "CHANNEL",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    requiresGrounded: true,
    effects: [],
    buffs: [
      {
        buffId: 2003,
        name: "千蝶吐瑞",
        category: "BUFF",
        durationMs: 8_000,
        periodicMs: 500,
        breakOnPlay: true,
        cancelOnMove: true,
        cancelOnJump: true,
        description: "运功中：持续回复，免控",
        effects: [
          { type: "CONTROL_IMMUNE" },
          { type: "INTERRUPT_IMMUNE" },
          { type: "PERIODIC_HEAL", value: 3 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 笑醉狂 — 9s channel: cleanse + 50% dmg reduction + control immune + 贯体 HoT
  // ──────────────────────────────────────────────────────────────────────────
  xiao_zui_kuang: {
    id: "xiao_zui_kuang",
    name: "笑醉狂",
    description: "解控，运功9秒，减伤50%，免控，贯体每秒回复5%气血，完整运功额外回复30%气血",
    type: "CHANNEL",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    requiresGrounded: true,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
    ],
    buffs: [
      {
        buffId: 2001,
        name: "笑醉狂",
        category: "BUFF",
        durationMs: 9_000,
        periodicMs: 1_000,
        breakOnPlay: true,
        cancelOnMove: true,
        cancelOnJump: true,
        description: "不受控制招式效果影响，受到伤害降低50%",
        effects: [
          { type: "DAMAGE_REDUCTION", value: 0.5 },
          { type: "CONTROL_IMMUNE" },
          { type: "INTERRUPT_IMMUNE" },
          { type: "PERIODIC_GUAN_TI_HEAL", value: 5 },
          { type: "TIMED_GUAN_TI_HEAL", delayMs: 9_000, value: 30 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 狂龙乱舞 — 2s channel then place a ground damage zone
  // ──────────────────────────────────────────────────────────────────────────
  kuang_long_luan_wu: {
    id: "kuang_long_luan_wu",
    name: "狂龙乱舞",
    description: "运功2秒，于前方2尺处唤起雷云，雷云半径8尺，每0.5秒造成4点伤害，持续6秒",
    type: "CHANNEL",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    requiresGrounded: true,
    effects: [],
    buffs: [],
    channelDurationMs: 2_000,
    channelCancelOnMove: true,
    channelCancelOnJump: true,
    channelForward: true,
    channelEffects: [
      { type: "PLACE_GROUND_ZONE", value: 4, range: 8 },
    ],
  } as any,

  // ──────────────────────────────────────────────────────────────────────────
  // 云飞玉皇 — 2s channel (pure: no buffs), 20dmg on completion + 10 bonus if in 4u
  // ──────────────────────────────────────────────────────────────────────────
  yun_fei_yu_huang: {
    id: "yun_fei_yu_huang",
    name: "云飞玉皇",
    description: "需要目标，运功2秒（不可移动），对目标造成20点伤害；运功完成时目标在4码内额外造成10点伤害",
    type: "CHANNEL",
    target: "OPPONENT",
    cooldownTicks: 150,
    gcd: true,
    range: 8,
    requiresGrounded: true,
    effects: [],
    buffs: [],
    // Channel-specific fields (read by playService as `any`)
    channelDurationMs: 2_000,
    channelCancelOnMove: true,
    channelCancelOnJump: true,
    channelCancelOnOutOfRange: 8,
    channelForward: true,
    channelEffects: [
      { type: "TIMED_AOE_DAMAGE", value: 20, range: 50 },
      { type: "TIMED_AOE_DAMAGE", value: 10, range: 4 },
    ],
  } as any,

  // ──────────────────────────────────────────────────────────────────────────
  // 孔雀翎 — instant, applies 受击 debuff (8 stacks, 0.5s proc rate-limit, 6s) + slow (6s)
  // ──────────────────────────────────────────────────────────────────────────
  kong_que_ling: {
    id: "kong_que_ling",
    name: "孔雀翎",
    description: "范围25，即刻对目标造成3点伤害，并附加【孔雀翎受击】（8层，每次受攻击触发额外3点伤害）和【孔雀翎】（减速50%），各持续6秒",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 600,
    gcd: true,
    range: 25,
    effects: [
      { type: "DAMAGE", value: 3 },
    ],
    buffs: [
      {
        buffId: 2004,
        name: "孔雀翎受击",
        category: "DEBUFF",
        durationMs: 6_000,
        breakOnPlay: false,
        initialStacks: 8,
        maxStacks: 8,
        procCooldownMs: 500,
        description: "每次受攻击触发3点额外伤害（每0.5秒至多触发一次），剩余层数见图标",
        effects: [
          { type: "STACK_ON_HIT_DAMAGE", value: 3 },
        ],
      },
      {
        buffId: 2005,
        name: "孔雀翎",
        category: "DEBUFF",
        durationMs: 6_000,
        breakOnPlay: false,
        description: "移动速度降低50%",
        effects: [
          { type: "SLOW", value: 0.5 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 新增技能组（3-12）
  // ──────────────────────────────────────────────────────────────────────────
  weituo_xianchu: {
    id: "weituo_xianchu",
    name: "韦陀献杵",
    description: "需要目标，正面180°\n瞬发造成5点伤害\n附加【韦陀献杵易伤】5秒：受到伤害提高10%\n自身获得【韦陀献杵防御】5秒：受到伤害降低10%\n可在移动与跳跃中施放",
    type: "ATTACK",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    faceDirection: true,
    effects: [{ type: "DAMAGE", value: 5 }],
    buffs: [
      {
        buffId: 2301,
        name: "韦陀献杵易伤",
        category: "DEBUFF",
        durationMs: 5_000,
        description: "受到伤害提高10%",
        effects: [{ type: "DAMAGE_TAKEN_INCREASE", value: 0.1 }],
      },
      {
        buffId: 2302,
        name: "韦陀献杵防御",
        category: "BUFF",
        durationMs: 5_000,
        description: "受到伤害降低10%",
        applyTo: "SELF",
        effects: [{ type: "DAMAGE_REDUCTION", value: 0.1 }],
      },
    ],
  },

  leizhenzi: {
    id: "leizhenzi",
    name: "雷震子",
    description: "需要目标，正面180°\n附加【雷震子】4秒：眩晕",
    type: "CONTROL",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    faceDirection: true,
    effects: [],
    buffs: [
      {
        buffId: 2303,
        name: "雷震子",
        category: "DEBUFF",
        durationMs: 4_000,
        description: "眩晕",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  zhuan_qiankun: {
    id: "zhuan_qiankun",
    name: "转乾坤",
    description: "解除等级1控制\n获得【转乾坤减伤】8秒：减伤60%，抗沉默\n获得【转乾坤免控】4秒：免疫等级1控制\n不触发GCD",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [{ type: "CLEANSE", allowWhileControlled: true }],
    buffs: [
      {
        buffId: 2304,
        name: "转乾坤减伤",
        category: "BUFF",
        durationMs: 8_000,
        description: "受到伤害降低60%，免疫沉默",
        effects: [
          { type: "DAMAGE_REDUCTION", value: 0.6 },
          { type: "SILENCE_IMMUNE" },
        ],
      },
      {
        buffId: 2305,
        name: "转乾坤免控",
        category: "BUFF",
        durationMs: 4_000,
        description: "免疫等级1控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  duoming_gu: {
    id: "duoming_gu",
    name: "夺命蛊",
    description: "瞬发自我施放\n获得【夺命蛊】12秒：受到伤害提高30%，造成伤害提高30%\n不触发GCD",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [],
    buffs: [
      {
        buffId: 2306,
        name: "夺命蛊",
        category: "DEBUFF",
        durationMs: 12_000,
        description: "受到伤害提高30%，造成伤害提高30%",
        effects: [
          { type: "DAMAGE_TAKEN_INCREASE", value: 0.3 },
          { type: "DAMAGE_MULTIPLIER", value: 1.3 },
        ],
      },
    ],
  },

  dican_longxiang: {
    id: "dican_longxiang",
    name: "帝骖龙翔",
    description: "自我施放\n使8尺范围内敌方获得【帝骖龙翔】5秒：眩晕",
    type: "CONTROL",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "AOE_APPLY_BUFFS", range: 8 }],
    buffs: [
      {
        buffId: 2307,
        name: "帝骖龙翔",
        category: "DEBUFF",
        durationMs: 5_000,
        description: "眩晕",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  huayu_suxin: {
    id: "huayu_suxin",
    name: "花语酥心",
    description: "自我施放\n获得【花语酥心】5秒：每秒回复6点气血（贯体）",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 2308,
        name: "花语酥心",
        category: "BUFF",
        durationMs: 5_000,
        periodicMs: 1_000,
        description: "每秒回复6点气血（贯体）",
        effects: [{ type: "PERIODIC_GUAN_TI_HEAL", value: 6 }],
      },
    ],
  },

  dienong_zu: {
    id: "dienong_zu",
    name: "蝶弄足",
    description: "解除锁足、减速、等级1控制\n获得【迅影】15秒：移速提高55%\n获得【音韵】3秒：免疫等级1控制\n不触发GCD",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true, cleanseRootSlow: true },
    ],
    buffs: [
      {
        buffId: 2309,
        name: "迅影",
        category: "BUFF",
        durationMs: 15_000,
        description: "移动速度提高55%",
        effects: [{ type: "SPEED_BOOST", value: 0.55 }],
      },
      {
        buffId: 2310,
        name: "音韵",
        category: "BUFF",
        durationMs: 3_000,
        description: "免疫等级1控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  changzhen: {
    id: "changzhen",
    name: "长针",
    description: "自我施放，正读条3秒\n必须站立施放，移动或跳跃会中断\n运功完成时瞬间回复20点气血\n触发GCD但无冷却",
    type: "CHANNEL",
    target: "SELF",
    cooldownTicks: 0,
    gcd: true,
    requiresGrounded: true,
    requiresStanding: true,
    effects: [],
    buffs: [],
    channelDurationMs: 3_000,
    channelCancelOnMove: true,
    channelCancelOnJump: true,
    channelForward: true,
    channelEffects: [
      { type: "TIMED_SELF_HEAL", value: 20 },
    ],
  } as any,

  xinglou_yueying: {
    id: "xinglou_yueying",
    name: "星楼月影",
    description: "解除等级1控制\n获得【星楼月影】8秒：免疫等级1控制\n不触发GCD",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [{ type: "CLEANSE", allowWhileControlled: true }],
    buffs: [
      {
        buffId: 2311,
        name: "星楼月影",
        category: "BUFF",
        durationMs: 8_000,
        description: "免疫等级1控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  duangu_jue: {
    id: "duangu_jue",
    name: "锻骨诀",
    description: "解除等级1控制\n获得【折骨】8秒：免疫根骨减速与等级1/2/3控制\n不触发GCD",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [{ type: "CLEANSE", allowWhileControlled: true }],
    buffs: [
      {
        buffId: 2312,
        name: "折骨",
        category: "BUFF",
        durationMs: 8_000,
        description: "免疫根骨减速与等级1/2/3控制",
        effects: [
          { type: "ROOT_SLOW_IMMUNE" },
          { type: "CONTROL_IMMUNE" },
          { type: "KNOCKBACK_IMMUNE" },
          { type: "SILENCE_IMMUNE" },
        ],
      },
    ],
  },

  zuowang_wuwo: {
    id: "zuowang_wuwo",
    name: "坐忘无我",
    description: "自我施放\n获得【坐忘无我】120秒：提供5点护盾",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 2313,
        name: "坐忘无我",
        category: "BUFF",
        durationMs: 120_000,
        description: "提供5点护盾",
        effects: [{ type: "SHIELD", value: 5 }],
      },
    ],
  },

  guchong_xianji: {
    id: "guchong_xianji",
    name: "蛊虫献祭",
    description:
      "自我施放（当前气血需大于35，不计护盾）\n解除等级1控制\n立即对自身造成30点伤害\n获得【献祭护盾】10秒：提供50点护盾并每秒回复3%气血（贯体）\n若献祭护盾被打破则该效果提前结束\n获得【献祭控制免疫】5秒：免疫等级1控制\n不触发GCD",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    minSelfHpExclusive: 35,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
      { type: "DAMAGE", value: 30 },
    ],
    buffs: [
      {
        buffId: 2314,
        name: "献祭护盾",
        category: "BUFF",
        durationMs: 10_000,
        periodicMs: 1_000,
        description: "提供50点护盾，并每秒回复3点气血",
        effects: [
          { type: "SHIELD", value: 50 },
          { type: "PERIODIC_GUAN_TI_HEAL", value: 3 },
        ],
      },
      {
        buffId: 2315,
        name: "献祭控制免疫",
        category: "BUFF",
        durationMs: 5_000,
        description: "免疫等级1控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 化血镖 — no cooldown, stackable DoT (max 2 stacks, 24s, 1 dmg/3s per stack)
  // ──────────────────────────────────────────────────────────────────────────
  hua_xue_biao: {
    id: "hua_xue_biao",
    name: "化血镖",
    description: "范围25，无冷却，附加【化血镖】毒效果，最多2层，每层每3秒造成1点伤害，持续24秒",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 0,
    gcd: true,
    range: 25,
    effects: [],
    buffs: [
      {
        buffId: 2006,
        name: "化血镖",
        category: "DEBUFF",
        durationMs: 24_000,
        periodicMs: 3_000,
        breakOnPlay: false,
        initialStacks: 1,
        maxStacks: 2,
        description: "每3秒造成1点伤害（叠层则倍增），最多叠加2层，持续24秒",
        effects: [
          { type: "PERIODIC_DAMAGE", value: 1 },
        ],
      },
    ],
  },
};
