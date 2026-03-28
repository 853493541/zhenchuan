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
    effects: [{ type: "DIRECTIONAL_DASH", value: 20, dirMode: "TOWARD", durationTicks: 30 }],
    isCommon: true,
  },

  yingfeng_huilang: {
    id: "yingfeng_huilang",
    name: "迎风回浪",
    description: "向远离对手的方向冲刺10格",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300, // 30 seconds at 60 Hz
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
    description: "向后撤步1格（快速位移脱身）",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 60, // 1 second at 60 Hz
    effects: [{ type: "DIRECTIONAL_DASH", value: 1, dirMode: "AWAY", durationTicks: 3 }],
    isCommon: true,
  },

  ji: {
    id: "ji",
    name: "疾",
    description: "向前冲刺37格（1秒）",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    effects: [{ type: "DIRECTIONAL_DASH", value: 37, dirMode: "TOWARD", durationTicks: 30 }],
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
    description: "造成10点伤害\n每3秒受到3点伤害，持续15秒",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1022,
        name: "急曲",
        category: "DEBUFF",
        durationMs: 15_000, // 15 seconds
        periodicMs: 3_000,  // fires every 3 seconds
        description: "每3秒受到3点伤害",
        effects: [{ type: "PERIODIC_DAMAGE", value: 3 }],
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
    description: "造成3点伤害\n每3秒受到8点伤害，持续15秒",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 3 }],
    buffs: [
      {
        buffId: 1001,
        name: "百足",
        category: "DEBUFF",
        durationMs: 15_000, // 15 seconds
        periodicMs: 3_000,  // fires every 3 seconds
        description: "每3秒受到8点伤害",
        effects: [{ type: "PERIODIC_DAMAGE", value: 8 }],
      },
    ],
  },

  /* ================= 控制 / 压制 ================= */

  mohe_wuliang: {
    id: "mohe_wuliang",
    name: "摩诃无量",
    description: "造成10点伤害\n击倒5秒",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1002,
        name: "摩诃无量",
        category: "DEBUFF",
        durationMs: 5_000, // 5 seconds
        description: "击倒",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  shengsi_jie: {
    id: "shengsi_jie",
    name: "生死劫",
    description: "造成2点伤害\n【控制】目标5秒\n【减疗】15秒",
    type: "CONTROL",
    target: "OPPONENT",
    range: 20,
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 2 }],
    buffs: [
      {
        buffId: 1021,
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
        durationMs: 5_000, // 5 seconds
        description: "眩晕",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  chan_xiao: {
    id: "chan_xiao",
    name: "蟾啸",
    description: "造成10点伤害\n目标5秒无法使用技能\n每3秒受到2点伤害，持续15秒",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1025,
        name: "蟾啸",
        category: "DEBUFF",
        durationMs: 15_000, // 15 seconds
        periodicMs: 3_000,  // fires every 3 seconds
        description: "每3秒受到2点伤害",
        effects: [{ type: "PERIODIC_DAMAGE", value: 2 }],
      },
      {
        buffId: 1004,
        name: "蟾啸迷心",
        category: "DEBUFF",
        durationMs: 5_000, // 5 seconds
        description: "无法使用技能",
        effects: [{ type: "SILENCE" }],
      },
    ],
  },

  da_shizi_hou: {
    id: "da_shizi_hou",
    name: "大狮子吼",
    description: "眩晕目标5秒",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 1005,
        name: "大狮子吼",
        category: "DEBUFF",
        durationMs: 5_000, // 5 seconds
        description: "眩晕5秒",
        effects: [
          { type: "CONTROL" },
          { type: "DRAW_REDUCTION", value: 1 },
        ],
      },
    ],
  },

  jiangchun_zhuxiu: {
    id: "jiangchun_zhuxiu",
    name: "绛唇珠袖",
    description: "使目标每次使用技能时受到3点伤害，持续15秒",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [],
    buffs: [
      {
        buffId: 1006,
        name: "绛唇珠袖",
        category: "DEBUFF",
        durationMs: 15_000, // 15 seconds
        description: "使用技能则受到3点伤害",
        effects: [{ type: "ON_PLAY_DAMAGE", value: 3 }],
      },
    ],
  },

  /* ================= 解控 / 防御 ================= */

  jiru_feng: {
    id: "jiru_feng",
    name: "疾如风",
    description: "解控\n免疫控制（不含击退/拉拽）5秒\n移动速度提升100%",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
      { type: "DRAW", value: 1, allowWhileControlled: true },
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
    description: "解控\n恢复10点生命值\n【不可选中】5秒",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
      { type: "DRAW", value: 1, allowWhileControlled: true },
      { type: "HEAL", value: 10, allowWhileControlled: true },
    ],
    buffs: [
      {
        buffId: 1007,
        name: "散流霞",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        breakOnPlay: true,
        description: "无法被技能选中",
        effects: [{ type: "UNTARGETABLE" }],
      },
    ],
  },

  que_ta_zhi: {
    id: "que_ta_zhi",
    name: "鹊踏枝",
    description: "解控\n被命中概率降低70%和免控1回合",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
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
        durationMs: 5_000, // 5 seconds
        description: "免控",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  /* ================= 生存 / 回复 ================= */

  fengxiu_diang: {
    id: "fengxiu_diang",
    name: "风袖低昂",
    description: "恢复60点生命值\n减伤40%，持续10秒",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "HEAL", value: 60 }],
    buffs: [
      {
        buffId: 1009,
        name: "风袖低昂",
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
    description: "恢复10点生命值\n免控5秒",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [
      { type: "DRAW", value: 1 },
      { type: "HEAL", value: 10 },
    ],
    buffs: [
      {
        buffId: 1010,
        name: "生太极",
        category: "BUFF",
        durationMs: 5_000, // 5 seconds
        description: "免疫控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  /* ================= 隐身 / 干扰 ================= */

  anchen_misan: {
    id: "anchen_misan",
    name: "暗尘弥散",
    description: "隐身5秒，移动速度提升100%",
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
        description: "隐身，移动速度提升100%",
        effects: [{ type: "STEALTH" }, { type: "SPEED_BOOST", value: 1 }],
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
          { type: "CHANNEL_AOE_TICK", value: 8, range: 10 },
        ],
      },
    ],
  },

  wu_jianyu: {
    id: "wu_jianyu",
    name: "无间狱",
    description: "修罗附体\n3秒后正面180°/10码造成5伤害\n4秒后正面180°/10码造成8伤害\n5秒后正面180°/10码造成10伤害\n同时360°/10码造成10伤害并击退3码，击退期间沉默0.8秒\n所有伤害30%吸血",
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
            value: 1,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+4s: front 180° cone, range 10, 8 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 4_000,
            value: 1,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+5s: front 180° cone, range 10, 10 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 5_000,
            value: 1,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+5s: full 360° circle, range 10, 10 damage, knockback 3 + 0.8s silence, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 5_000,
            value: 2,
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
    description: "造成伤害提升100%\n受到伤害降低50%，持续20秒",
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
        description: "造成伤害提升100%，受到伤害降低50%，持续20秒",
        effects: [
          { type: "DAMAGE_MULTIPLIER", value: 2 },
          { type: "DAMAGE_REDUCTION", value: 0.5 },
          { type: "DRAW_REDUCTION", value: 1 },
        ],
      },
    ],
  },

  taxingxing: {
    id: "taxingxing",
    name: "踏星行",
    description: "被命中几率降低65%且免疫控制，期间无法使用技能，持续5秒",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: true,
    effects: [{ type: "DRAW", value: 2 }],
    buffs: [
      {
        buffId: 1020,
        name: "踏星行",
        category: "DEBUFF",
        durationMs: 5_000, // 5 seconds
        description: "被命中几率降低65%，免疫控制，沉默",
        effects: [
          { type: "DODGE_NEXT", chance: 0.65 },
          { type: "CONTROL_IMMUNE" },
          { type: "SILENCE" },
        ],
      },
    ],
  },

  /* ================= 其他 ================= */

  zhuiming_jian: {
    id: "zhuiming_jian",
    name: "追命箭",
    description: "需要目标，运功2秒（正读条），完成时造成15点伤害；若自身气血高于60，额外造成9点伤害",
    type: "CHANNEL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    range: 25,
    requiresGrounded: true,
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

  quye_duanchou: {
    id: "quye_duanchou",
    name: "驱夜断愁",
    description: "造成8点伤害\n回复4点生命值",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [
      { type: "DAMAGE", value: 8 },
      { type: "HEAL", value: 4, applyTo: "SELF" },
    ],
  },

  /* ================= 位移 ================= */

  zhenshen_xingsi: {
    id: "zhenshen_xingsi",
    name: "龙牙",
    description: "冲向敌人（最远20码）\n距离内冲向敌方位置，造成10点伤害",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    range: 20,
    effects: [
      { type: "DAMAGE", value: 10 },
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
    gcd: false,
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
    effects: [],
    buffs: [
      {
        buffId: 2002,
        name: "狂龙乱舞",
        category: "BUFF",
        durationMs: 2_000,
        breakOnPlay: true,
        cancelOnJump: true,
        description: "运功中",
        effects: [
          { type: "PLACE_GROUND_ZONE", delayMs: 2_000, value: 4, range: 8 },
        ],
      },
    ],
  },

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
