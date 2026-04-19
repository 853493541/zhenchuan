// Legacy file for storing card definitions. Will be refactored into a more data-driven format in the future.

import { Ability } from "../engine/state/types";

export const ABILITIES: Record<string, Ability & { description: string }> = {
  /* ================= 通用技能 (common abilities — always in every player's hand) ================= */

  menghu_xiasha: {
    id: "menghu_xiasha",
    name: "回风扫叶",
    description: "造成1点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    range: 100,
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
        durationMs: 300_000, // consumed by movement.ts on next jump; 5-minute fallback expiry
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
    description: "造成5点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [
      { type: "DAMAGE", value: 5 },
      { type: "DRAW", value: 1 },
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
    description: "解控\n免疫控制5秒",
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
        description: "免疫控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
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
        effects: [{ type: "CONTROL_IMMUNE" }, { type: "DASH_TURN_OVERRIDE" }],
      },
    ],
  },

  zhen_shan_he: {
    id: "zhen_shan_he",
    name: "镇山河",
    description: "展开镇山河8秒，自身立即获得2秒无敌。区域内友方每0.1秒刷新0.1秒无敌；首次获得区域效果时附加【玄剑】12秒，结束后转为【化生势】180秒，期间无法再次获得镇山河效果",
    type: "SUPPORT",
    target: "SELF",
    cooldownTicks: 300,
    gcd: false,
    allowWhileControlled: true,
    effects: [
      {
        type: "PLACE_GROUND_ZONE",
        value: 0,
        range: 8,
        zoneDurationMs: 8_000,
        zoneIntervalMs: 100,
        zoneOffsetUnits: 0,
        zoneHeight: 10,
      },
    ],
    buffs: [],
  } as any,

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
    description: "持续5秒运功，每次轮换时对敌人造成8点伤害",
    originalDescription:
      "发动旋风般的重剑攻击，5秒内对周围10尺内的最多10个目标造成共计8次伤害。在此过程中你无法跳跃，不受控制招式影响（被拉除外）。",
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
        description: "不受技能控制",
        durationMs: 5_000, // 5 seconds
        breakOnPlay: true,
        effects: [
          { type: "CONTROL_IMMUNE" },
          {
            type: "SCHEDULED_DAMAGE",
            value: 8,
            when: "TURN_END",
            turnOf: "OWNER",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 8,
            when: "TURN_START",
            turnOf: "ENEMY",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 8,
            when: "TURN_END",
            turnOf: "ENEMY",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 8,
            when: "TURN_START",
            turnOf: "OWNER",
            target: "ENEMY",
          },
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
            value: 5,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+4s: front 180° cone, range 10, 8 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 4_000,
            value: 8,
            aoeAngle: 180,
            range: 10,
            lifestealPct: 0.3,
          },
          // t+5s: front 180° cone, range 10, 10 damage, 30% lifesteal
          {
            type: "TIMED_AOE_DAMAGE",
            delayMs: 5_000,
            value: 10,
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
    description: "舞棍5秒\n期间免疫控制\n造成4/6/10点伤害",
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
        durationMs: 5_000, // 5 seconds
        breakOnPlay: true,
        description: "免疫控制",
        effects: [
          { type: "CONTROL_IMMUNE" },
          {
            type: "SCHEDULED_DAMAGE",
            value: 4,
            when: "TURN_END",
            turnOf: "OWNER",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 6,
            when: "TURN_START",
            turnOf: "ENEMY",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 10,
            when: "TURN_END",
            turnOf: "ENEMY",
            target: "ENEMY",
          },
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
          { type: "DASH_TURN_OVERRIDE" },
          { type: "SILENCE" },
        ],
      },
    ],
  },

  /* ================= 其他 ================= */

  zhuiming_jian: {
    id: "zhuiming_jian",
    name: "追命箭",
    description: "造成20点伤害\n目标生命值高于60时额外造成10点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    effects: [
      { type: "DAMAGE", value: 20 },
      {
        type: "BONUS_DAMAGE_IF_TARGET_HP_GT",
        value: 10,
        threshold: 60,
      },
    ],
  },

  /* ================= 位移 ================= */

  zhenshen_xingsi: {
    id: "zhenshen_xingsi",
    name: "龙牙",
    description: "冲向敌人（最远20码）\n距离内冲向敌方位置",
    type: "CONTROL",
    target: "OPPONENT",
    cooldownTicks: 300,
    gcd: true,
    range: 20,
    effects: [
      { type: "DASH", value: 8 },
    ],
  },
};
