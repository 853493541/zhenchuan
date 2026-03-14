// backend/game/cards/cards.ts

import { Card } from "../engine/state/types";

export const CARDS: Record<string, Card & { description: string }> = {
  /* ================= 通用技能 (common abilities — always in every player's hand) ================= */

  menghu_xiasha: {
    id: "menghu_xiasha",
    name: "回风扫叶",
    description: "造成1点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 0,
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
    gcdCost: 0,
    cooldownTicks: 1800, // 30 seconds at 60 Hz
    effects: [{ type: "DIRECTIONAL_DASH", value: 20, dirMode: "TOWARD" }],
    isCommon: true,
  },

  yingfeng_huilang: {
    id: "yingfeng_huilang",
    name: "迎风回浪",
    description: "向远离对手的方向冲刺10格",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    cooldownTicks: 1800, // 30 seconds at 60 Hz
    effects: [{ type: "DIRECTIONAL_DASH", value: 10, dirMode: "AWAY" }],
    isCommon: true,
  },

  lingxiao_lansheng: {
    id: "lingxiao_lansheng",
    name: "凌霄揽胜",
    description: "向左侧冲刺7格",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    cooldownTicks: 1800, // 30 seconds at 60 Hz
    effects: [{ type: "DIRECTIONAL_DASH", value: 7, dirMode: "PERP_LEFT" }],
    isCommon: true,
  },

  yaotai_zhenhe: {
    id: "yaotai_zhenhe",
    name: "瑶台枕鹤",
    description: "向右侧冲刺7格",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    cooldownTicks: 1800, // 30 seconds at 60 Hz
    effects: [{ type: "DIRECTIONAL_DASH", value: 7, dirMode: "PERP_RIGHT" }],
    isCommon: true,
  },

  fuyao_zhishang: {
    id: "fuyao_zhishang",
    name: "扶摇直上",
    description: "获得【弹跳】：下次跳跃高度提升至12单位",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    cooldownTicks: 1800, // 30 seconds at 60 Hz
    effects: [],
    buffs: [
      {
        buffId: 9001,
        name: "弹跳",
        category: "BUFF",
        duration: 999, // consumed by movement.ts on next jump, not by turn-tick
        tickOn: "TURN_START",
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
    gcdCost: 0,
    cooldownTicks: 60, // 1 second at 60 Hz
    effects: [{ type: "DIRECTIONAL_DASH", value: 1, dirMode: "AWAY" }],
    isCommon: true,
  },

  yuqi: {
    id: "yuqi",
    name: "御骑",
    description: "【占位技能】",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    cooldownTicks: 1800,
    effects: [],
    isCommon: true,
  },

  /* ================= 基础攻击 ================= */

  jianpo_xukong: {
    id: "jianpo_xukong",
    name: "剑破虚空",
    description: "造成10点伤害\n使目标每回合受到2点伤害，持续3回合",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1022,
        name: "急曲",
        category: "DEBUFF",
        duration: 3,
        tickOn: "TURN_START",
        description: "回合开始时受到3点伤害",
        effects: [{ type: "START_TURN_DAMAGE", value: 3 }],
      },
    ],
  },

  sanhuan_taoyue: {
    id: "sanhuan_taoyue",
    name: "三环套月",
    description: "造成5点伤害\n抽一张牌",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [
      { type: "DAMAGE", value: 5 },
      { type: "DRAW", value: 1 },
    ],
  },

  baizu: {
    id: "baizu",
    name: "百足",
    description: "造成3点伤害\n对手每个回合开始时受到8点伤害，持续3个回合",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [{ type: "DAMAGE", value: 3 }],
    buffs: [
      {
        buffId: 1001,
        name: "百足",
        category: "DEBUFF",
        duration: 3,
        tickOn: "TURN_START",
        description: "回合开始时受到8点伤害",
        effects: [{ type: "START_TURN_DAMAGE", value: 8 }],
      },
    ],
  },

  /* ================= 控制 / 压制 ================= */

  mohe_wuliang: {
    id: "mohe_wuliang",
    name: "摩诃无量",
    description: "造成10点伤害\n击倒1个回合",
    type: "CONTROL",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1002,
        name: "摩诃无量",
        category: "DEBUFF",
        duration: 1,
        tickOn: "TURN_END",
        description: "击倒",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  shengsi_jie: {
    id: "shengsi_jie",
    name: "生死劫",
    description: "造成2点伤害\n【控制】目标1个回合\n【减疗】3个回合",
    type: "CONTROL",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [{ type: "DAMAGE", value: 2 }],
    buffs: [
      {
        buffId: 1021,
        name: "月劫",
        category: "DEBUFF",
        duration: 3,
        tickOn: "TURN_END",
        description: "受到治疗效果降低50%",
        effects: [{ type: "HEAL_REDUCTION", value: 0.5 }],
      },
      {
        buffId: 1003,
        name: "日劫",
        category: "DEBUFF",
        duration: 1,
        tickOn: "TURN_END",
        description: "眩晕",
        effects: [{ type: "CONTROL" }],
      },
    ],
  },

  chan_xiao: {
    id: "chan_xiao",
    name: "蟾啸",
    description: "造成10点伤害\n目标1回合无法使用卡牌\n每回合开始时受到2点伤害，持续3回合。",
    type: "CONTROL",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [{ type: "DAMAGE", value: 10 }],
    buffs: [
      {
        buffId: 1025,
        name: "蟾啸",
        category: "DEBUFF",
        duration: 3,
        tickOn: "TURN_START",
        description: "回合开始时受到2点伤害",
        effects: [{ type: "START_TURN_DAMAGE", value: 2 }],
      },
      {
        buffId: 1004,
        name: "蟾啸迷心",
        category: "DEBUFF",
        duration: 1,
        tickOn: "TURN_END",
        description: "无法使用卡牌",
        effects: [{ type: "SILENCE" }],
      },
    ],
  },

  da_shizi_hou: {
    id: "da_shizi_hou",
    name: "大狮子吼",
    description: "眩晕目标1回合\n使其下个回合抽卡数量减一",
    type: "CONTROL",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [],
    buffs: [
      {
        buffId: 1005,
        name: "大狮子吼",
        category: "DEBUFF",
        duration: 1,
        tickOn: "TURN_END",
        description: "眩晕，下回合抽卡数量减一",
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
    description: "使目标每次使用卡牌时受到3点伤害，持续3个回合",
    type: "CONTROL",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [],
    buffs: [
      {
        buffId: 1006,
        name: "绛唇珠袖",
        category: "DEBUFF",
        duration: 3,
        tickOn: "TURN_END",
        description: "使用卡牌则受到3点伤害",
        effects: [{ type: "ON_PLAY_DAMAGE", value: 3 }],
      },
    ],
  },

  /* ================= 解控 / 防御 ================= */

  jiru_feng: {
    id: "jiru_feng",
    name: "疾如风",
    description: "解控\n免疫控制1回合\n抽一张牌",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    effects: [
      { type: "CLEANSE", allowWhileControlled: true },
      { type: "DRAW", value: 1, allowWhileControlled: true },
    ],
    buffs: [
      {
        buffId: 1033,
        name: "疾如风",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
        description: "免疫控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  sanliu_xia: {
    id: "sanliu_xia",
    name: "散流霞",
    description: "解控\n抽2张牌\n恢复10点生命值\n【不可选中】一回合",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
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
        duration: 1,
        tickOn: "TURN_START",
        breakOnPlay: true,
        description: "无法被卡牌选中",
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
    gcdCost: 0,
    effects: [{ type: "CLEANSE", allowWhileControlled: true }],
    buffs: [
      {
        buffId: 1030,
        name: "鹊踏枝",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
        description: "被命中几率降低70%",
        effects: [{ type: "DODGE_NEXT", chance: 0.7 }],
      },
      {
        buffId: 1031,
        name: "素衿",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
        description: "免控",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  /* ================= 生存 / 回复 ================= */

  fengxiu_diang: {
    id: "fengxiu_diang",
    name: "风袖低昂",
    description: "恢复60点生命值\n减伤40%，持续2回合",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 1,
    effects: [{ type: "HEAL", value: 60 }],
    buffs: [
      {
        buffId: 1009,
        name: "风袖低昂",
        category: "BUFF",
        duration: 2,
        tickOn: "TURN_START",
        description: "受到伤害降低40%",
        effects: [{ type: "DAMAGE_REDUCTION", value: 0.4 }],
      },
    ],
  },

  qionglong_huasheng: {
    id: "qionglong_huasheng",
    name: "穹隆化生",
    description: "抽1张牌\n恢复10点生命值\n免控1回合",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 1,
    effects: [
      { type: "DRAW", value: 1 },
      { type: "HEAL", value: 10 },
    ],
    buffs: [
      {
        buffId: 1010,
        name: "生太极",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
        description: "免疫控制",
        effects: [{ type: "CONTROL_IMMUNE" }],
      },
    ],
  },

  /* ================= 隐身 / 干扰 ================= */

  anchen_misan: {
    id: "anchen_misan",
    name: "暗尘弥散",
    description: "抽2张牌\n隐身1回合",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    effects: [{ type: "DRAW", value: 2, allowWhileControlled: true }],
    buffs: [
      {
        buffId: 1011,
        name: "暗尘弥散",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
        breakOnPlay: true,
        description: "隐身",
        effects: [{ type: "STEALTH" }],
      },
    ],
  },

  fuguang_lueying: {
    id: "fuguang_lueying",
    name: "浮光掠影",
    description: "隐身2回合\n期间无法抽卡",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 0,
    effects: [],
    buffs: [
      {
        buffId: 1012,
        name: "浮光掠影",
        category: "BUFF",
        duration: 2,
        tickOn: "TURN_START",
        breakOnPlay: true,
        description: "隐身2回合，期间无法抽卡",
        effects: [
          { type: "STEALTH" },
          { type: "DRAW_REDUCTION", value: 1 },
        ],
      },
    ],
  },

  tiandi_wuji: {
    id: "tiandi_wuji",
    name: "天地无极",
    description: "造成5点伤害\n隐身1回合",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [{ type: "DAMAGE", value: 5 }],
    buffs: [
      {
        buffId: 1013,
        name: "天地无极",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
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
    description: "持续运功，玩家回合开始/结束时造成8点伤害",
    originalDescription:
      "发动旋风般的重剑攻击，5秒内对周围10尺内的最多10个目标造成共计8次伤害。在此过程中你无法跳跃，不受控制招式影响（被拉除外）。",
    type: "CHANNEL",
    target: "SELF",
    gcdCost: 1,
    effects: [],
    buffs: [
      {
        buffId: 1014,
        name: "不工",
        category: "BUFF",
        description: "不受卡牌控制",
        duration: 1,
        tickOn: "TURN_START",
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
    description: "修罗附体\n延迟1回合造成4/6/15/15伤害\n30%吸血",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 1,
    effects: [],
    buffs: [
      {
        buffId: 1016,
        name: "无间狱",
        category: "BUFF",
        description: "修罗附体",
        duration: 2,
        tickOn: "TURN_START",
        effects: [
          {
            type: "SCHEDULED_DAMAGE",
            value: 0,
            when: "TURN_END",
            turnOf: "OWNER",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 0,
            when: "TURN_START",
            turnOf: "ENEMY",
            target: "ENEMY",
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 4,
            when: "TURN_END",
            turnOf: "ENEMY",
            target: "ENEMY",
            lifestealPct: 0.3,
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 6,
            when: "TURN_START",
            turnOf: "OWNER",
            target: "ENEMY",
            lifestealPct: 0.3,
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 15,
            when: "TURN_START",
            turnOf: "ENEMY",
            target: "ENEMY",
            lifestealPct: 0.3,
          },
          {
            type: "SCHEDULED_DAMAGE",
            value: 15,
            when: "TURN_END",
            turnOf: "ENEMY",
            target: "ENEMY",
            lifestealPct: 0.3,
          },
        ],
      },
    ],
  },

  xinzheng: {
    id: "xinzheng",
    name: "心诤",
    description: "舞棍1回合\n期间免疫控制\n造成4/6/10点伤害",
    type: "CHANNEL",
    target: "SELF",
    gcdCost: 1,
    effects: [],
    buffs: [
      {
        buffId: 1017,
        name: "心诤",
        category: "BUFF",
        duration: 1,
        tickOn: "TURN_START",
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
    description: "造成伤害提升100%\n受到伤害降低50%\n下回合开始时抽卡减一，持续4回合",
    type: "STANCE",
    target: "SELF",
    gcdCost: 0,
    effects: [],
    buffs: [
      {
        buffId: 1019,
        name: "女娲补天",
        category: "BUFF",
        duration: 4,
        tickOn: "TURN_START",
        description: "造成伤害提升100%，受到伤害降低50%，期间抽卡减一",
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
    description: "抽2张牌\n被命中几率降低65%且免疫控制，期间无法使用卡牌，持续1回合",
    type: "SUPPORT",
    target: "SELF",
    gcdCost: 1,
    effects: [{ type: "DRAW", value: 2 }],
    buffs: [
      {
        buffId: 1020,
        name: "踏星行",
        category: "DEBUFF",
        duration: 1,
        tickOn: "TURN_START",
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
    description: "造成20点伤害\n目标生命值高于60时额外造成10点伤害",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [
      { type: "DAMAGE", value: 20 },
      {
        type: "BONUS_DAMAGE_IF_TARGET_HP_GT",
        value: 10,
        threshold: 60,
      },
    ],
  },

  quye_duanchou: {
    id: "quye_duanchou",
    name: "驱夜断愁",
    description: "造成8点伤害\n回复4点生命值",
    type: "ATTACK",
    target: "OPPONENT",
    gcdCost: 1,
    effects: [
      { type: "DAMAGE", value: 8 },
      { type: "HEAL", value: 4, applyTo: "SELF" },
    ],
  },

  /* ================= 位移 ================= */

  zhenshen_xingsi: {
    id: "zhenshen_xingsi",
    name: "龙牙",
    description: "冲向敌人（最远20码）\n距离内冲向敌方位置",
    type: "CONTROL",
    target: "OPPONENT",
    gcdCost: 1,
    range: 20,
    effects: [
      { type: "DASH", value: 8 },
    ],
  },
};
