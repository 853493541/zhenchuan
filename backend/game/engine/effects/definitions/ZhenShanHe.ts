import { Ability, ActiveBuff, GameState, PlayerState } from "../../state/types";
import { addBuff, pushBuffExpired } from "../buffRuntime";
import { loadBuffEditorOverrides } from "../../../abilities/buffEditorOverrides";

export const ZHEN_SHAN_HE_ABILITY_ID = "zhen_shan_he";
export const ZHEN_SHAN_HE_INVULNERABLE_BUFF_ID = 1320;
export const ZHEN_SHAN_HE_XUANJIAN_BUFF_ID = 1321;
export const ZHEN_SHAN_HE_HUASHENGSHI_BUFF_ID = 1322;
export const ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID = 1323;

const ZHEN_SHAN_HE_SELF_INVULNERABLE_DURATION_MS = 2_000;
const ZHEN_SHAN_HE_ZONE_INVULNERABLE_DURATION_MS = 100;
const ZHEN_SHAN_HE_XUANJIAN_DURATION_MS = 12_000;
export const ZHEN_SHAN_HE_HUASHENGSHI_DURATION_MS = 180_000;

function getActiveBuff(target: PlayerState, buffId: number, now: number): ActiveBuff | undefined {
  return target.buffs.find((buff) => buff.buffId === buffId && buff.expiresAt > now);
}

function refreshInvulnerableBuff(params: {
  state: GameState;
  ability: Ability;
  target: PlayerState;
  sourceUserId: string;
  now: number;
  buffId: number;
  durationMs: number;
  description: string;
}) {
  const { state, ability, target, sourceUserId, now, buffId, durationMs, description } = params;
  const existing = getActiveBuff(target, buffId, now);

  if (existing) {
    existing.name = "镇山河";
    existing.category = "BUFF";
    existing.effects = [{ type: "INVULNERABLE" }];
    existing.expiresAt = now + durationMs;
    existing.appliedAt = now;
    existing.appliedAtTurn = state.turn;
    existing.breakOnPlay = false;
    existing.sourceUserId = sourceUserId;
    existing.sourceAbilityId = ability.id;
    existing.sourceAbilityName = ability.name;
    return true;
  }

  addBuff({
    state,
    sourceUserId,
    targetUserId: target.userId,
    ability,
    buffTarget: target,
    buff: {
      buffId,
      name: "镇山河",
      category: "BUFF",
      durationMs,
      breakOnPlay: false,
      description,
      effects: [{ type: "INVULNERABLE" }],
    },
  });

  return true;
}

export function applyZhenShanHeSelfCastBuff(params: {
  state: GameState;
  ability: Ability;
  target: PlayerState;
  sourceUserId: string;
  now: number;
}) {
  return refreshInvulnerableBuff({
    ...params,
    buffId: ZHEN_SHAN_HE_INVULNERABLE_BUFF_ID,
    durationMs: ZHEN_SHAN_HE_SELF_INVULNERABLE_DURATION_MS,
    description: "施放后至少获得2秒无敌，敌方技能会正常消耗，但不会对你造成伤害或附加效果。",
  });
}

export function pulseZhenShanHeTarget(params: {
  state: GameState;
  ability: Ability;
  target: PlayerState;
  sourceUserId: string;
  now: number;
}) {
  const { state, ability, target, sourceUserId, now } = params;

  if ((target.hp ?? 0) <= 0) {
    return false;
  }

  if (getActiveBuff(target, ZHEN_SHAN_HE_HUASHENGSHI_BUFF_ID, now)) {
    return false;
  }

  let changed = false;
  if (!getActiveBuff(target, ZHEN_SHAN_HE_INVULNERABLE_BUFF_ID, now)) {
    changed = refreshInvulnerableBuff({
      state,
      ability,
      target,
      sourceUserId,
      now,
      buffId: ZHEN_SHAN_HE_ZONE_INVULNERABLE_BUFF_ID,
      durationMs: ZHEN_SHAN_HE_ZONE_INVULNERABLE_DURATION_MS,
      description: "位于镇山河区域内时每0.1秒刷新0.1秒无敌效果。",
    });
  }

  if (!getActiveBuff(target, ZHEN_SHAN_HE_XUANJIAN_BUFF_ID, now)) {
    addBuff({
      state,
      sourceUserId,
      targetUserId: target.userId,
      ability,
      buffTarget: target,
      buff: {
        buffId: ZHEN_SHAN_HE_XUANJIAN_BUFF_ID,
        name: "玄剑",
        category: "DEBUFF",
        durationMs: ZHEN_SHAN_HE_XUANJIAN_DURATION_MS,
        breakOnPlay: false,
        description: "镇山河入场标记。自然结束后转为【化生势】。",
        effects: [],
      },
    });
    changed = true;
  }

  // Cleanse DEBUFF-category buffs with these attributes from the target each pulse.
  const CLEANSE_ATTRS = ["外功", "阴性", "混元", "阳性", "毒性", "点穴"];
  const { overrides: buffOverrides } = loadBuffEditorOverrides();
  for (const attr of CLEANSE_ATTRS) {
    let idx: number;
    while ((idx = target.buffs.findIndex((b: any) => {
      if (b.category !== "DEBUFF") return false;
      const entry = buffOverrides[String(b.buffId)];
      return entry?.attribute === attr;
    })) !== -1) {
      const removed = target.buffs[idx];
      target.buffs.splice(idx, 1);
      pushBuffExpired(state, {
        targetUserId: target.userId,
        buffId: removed.buffId,
        buffName: removed.name,
        buffCategory: removed.category,
        sourceAbilityId: removed.sourceAbilityId,
        sourceAbilityName: removed.sourceAbilityName,
      });
    }
  }

  return changed;
}

export function transformExpiredXuanjian(params: {
  state: GameState;
  ability: Ability;
  target: PlayerState;
  sourceUserId: string;
}) {
  const { state, ability, target, sourceUserId } = params;

  addBuff({
    state,
    sourceUserId,
    targetUserId: target.userId,
    ability,
    buffTarget: target,
    buff: {
      buffId: ZHEN_SHAN_HE_HUASHENGSHI_BUFF_ID,
      name: "化生势",
      category: "DEBUFF",
      durationMs: ZHEN_SHAN_HE_HUASHENGSHI_DURATION_MS,
      breakOnPlay: false,
      description: "期间无法再次获得镇山河区域效果。",
      effects: [],
    },
  });
}