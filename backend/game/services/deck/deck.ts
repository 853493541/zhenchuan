// backend/game/services/deck.ts
/**
 * Deck construction & shuffling.
 * Pure utilities — no DB, no game flow.
 */

import { AbilityInstance } from "../../engine/state/types";
import { ABILITIES } from "../../abilities/abilities";
import { randomUUID } from "crypto";

export function buildDeck(): AbilityInstance[] {
  const deck: AbilityInstance[] = [];

  const pushN = (abilityId: string, n: number) => {
    if (!ABILITIES[abilityId]) {
      throw new Error(`Unknown ability id in deck: ${abilityId}`);
    }
    for (let i = 0; i < n; i++) {
      deck.push({ instanceId: randomUUID(), abilityId, cooldown: 0 });
    }
  };

  // 基础攻击
  pushN("jianpo_xukong", 6);
  pushN("sanhuan_taoyue", 6);

  // 控制 / 压制
  pushN("mohe_wuliang", 4);
  pushN("shengsi_jie", 4);
  pushN("chan_xiao", 4);
  pushN("wufang_xingjin", 3);
  pushN("bang_da_gou_tou", 3);
  pushN("jieyang", 3);

  // 解控 / 防御
  pushN("jiru_feng", 4);
  pushN("sanliu_xia", 4);
  pushN("que_ta_zhi", 3);

  // 生存 / 回复
  pushN("fengxiu_diang", 4);

  // 受控可用
  pushN("anchen_misan", 3);

  // 持续伤害 / 节奏
  pushN("fenglai_wushan", 2);
  pushN("wu_jianyu", 2);
  pushN("baizu", 3);

  // 强化 / 爆发
  pushN("nuwa_butian", 2);

  // PATCH 0.3
  pushN("fuguang_lueying", 3);
  pushN("da_shizi_hou", 3);
  pushN("qionglong_huasheng", 3);
  pushN("zhen_shan_he", 2);
  pushN("taxingxing", 3);
  pushN("zhuiming_jian", 3);
  pushN("xinzheng", 2);
  pushN("tiandi_wuji", 3);
  pushN("yun_qi_song", 3);
  pushN("zhuo_ying_shi", 3);
  pushN("shou_ru_shan", 3);

  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
