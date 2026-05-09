import { ABILITIES } from "../../abilities/abilities";
import { randomUUID } from "crypto";
import { addBuff, pushBuffExpired } from "../../engine/effects/buffRuntime";
import type { ActiveBuff, GameState, PlayerState } from "../../engine/state/types";
import { resolveNonCritHealAmountRoll } from "../../engine/utils/combatMath";
import { SAND_DISGUISE_BUFF_ID, SAND_DISGUISE_CONSUMABLE_ID } from "../../engine/utils/disguise";
import { applyHealToTarget, removeLinkedShield } from "../../engine/utils/health";
import {
  YUE_YING_SHA_ABILITY,
  YUE_YING_SHA_BUFF,
  YUE_YING_SHA_BUFF_ID,
  YUE_YING_SHA_CONSUMABLE_ID,
  YUE_YING_SHA_CONSUMABLE_NAME,
} from "../../engine/utils/yueYingSha";
import { ensureBattleLoop } from "../battleLoopRuntime";
import { broadcastGameUpdate } from "../broadcast";
import { diffState } from "../flow/stateDiff";

export type ConsumableId =
  | "beng_dai"
  | "jin_chuang_yao"
  | "yue_ying_sha"
  | "sha_shi_wei_zhuang"
  | "guan_mu_wei_zhuang"
  | "wa_guan_wei_zhuang"
  | "sha_xing_xie"
  | "ma_cao"
  | "yi_jie_wu_qi_he"
  | "er_jie_wu_qi_he"
  | "san_jie_wu_qi_he"
  | "tian_jie_wu_qi_he";

export const STARTING_CONSUMABLE_COUNTS: Record<ConsumableId, number> = {
  beng_dai: 12,
  jin_chuang_yao: 8,
  yue_ying_sha: 4,
  sha_shi_wei_zhuang: 4,
  guan_mu_wei_zhuang: 0,
  wa_guan_wei_zhuang: 0,
  sha_xing_xie: 0,
  ma_cao: 0,
  yi_jie_wu_qi_he: 0,
  er_jie_wu_qi_he: 0,
  san_jie_wu_qi_he: 0,
  tian_jie_wu_qi_he: 0,
};

export function createStartingConsumableCounts(): Record<ConsumableId, number> {
  return { ...STARTING_CONSUMABLE_COUNTS };
}

type ConsumableDefinition = {
  id: ConsumableId;
  name: string;
  cooldownMs: number;
  usableInCombat: boolean;
  implemented?: boolean;
  breaksDisguise?: boolean;
  requiresGrounded?: boolean;
  healBase?: number;
  channel?: {
    durationMs: number;
    tickIntervalMs?: number;
    healBase?: number;
    applyDisguiseOnComplete?: boolean;
    forwardChannel?: boolean;
    lockMovement?: boolean;
    cancelOnMove?: boolean;
    cancelOnJump?: boolean;
  };
};

const CONSUMABLES: Record<ConsumableId, ConsumableDefinition> = {
  beng_dai: {
    id: "beng_dai",
    name: "绷带",
    cooldownMs: 0,
    usableInCombat: false,
    breaksDisguise: false,
    channel: {
      durationMs: 10_000,
      tickIntervalMs: 1_000,
      healBase: 1.93,
    },
  },
  jin_chuang_yao: {
    id: "jin_chuang_yao",
    name: "金疮药",
    cooldownMs: 120_000,
    usableInCombat: true,
    healBase: 48.3,
  },
  yue_ying_sha: {
    id: YUE_YING_SHA_CONSUMABLE_ID,
    name: YUE_YING_SHA_CONSUMABLE_NAME,
    cooldownMs: 30_000,
    usableInCombat: true,
    implemented: true,
    requiresGrounded: true,
  },
  sha_shi_wei_zhuang: {
    id: SAND_DISGUISE_CONSUMABLE_ID,
    name: "砂石伪装",
    cooldownMs: 0,
    usableInCombat: false,
    channel: {
      durationMs: 2_000,
      forwardChannel: true,
      lockMovement: false,
      cancelOnMove: true,
      cancelOnJump: true,
      applyDisguiseOnComplete: true,
    },
  },
  guan_mu_wei_zhuang: {
    id: "guan_mu_wei_zhuang",
    name: "灌木伪装",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  wa_guan_wei_zhuang: {
    id: "wa_guan_wei_zhuang",
    name: "瓦罐伪装",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  sha_xing_xie: {
    id: "sha_xing_xie",
    name: "沙行蝎",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  ma_cao: {
    id: "ma_cao",
    name: "马草",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  yi_jie_wu_qi_he: {
    id: "yi_jie_wu_qi_he",
    name: "一阶武器盒",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  er_jie_wu_qi_he: {
    id: "er_jie_wu_qi_he",
    name: "二阶武器盒",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  san_jie_wu_qi_he: {
    id: "san_jie_wu_qi_he",
    name: "三阶武器盒",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
  tian_jie_wu_qi_he: {
    id: "tian_jie_wu_qi_he",
    name: "天阶武器盒",
    cooldownMs: 0,
    usableInCombat: false,
    implemented: false,
  },
};

const STEALTH_BREAK_BUFF_IDS = new Set([1011, 1012, 1013, SAND_DISGUISE_BUFF_ID, YUE_YING_SHA_BUFF_ID]);
const FUGUANG_COMPANION_BUFF_ID = 1021;
const SHI_FANG_XUAN_JI_BUFF_ID = 2642;
const BLOCKING_CONSUMABLE_EFFECTS = new Set(["ROOT", "CONTROL", "KNOCKED_BACK", "PULLED", "DISPLACEMENT", "FEARED", "FREEZE"]);

function getConsumableDefinition(rawId: unknown): ConsumableDefinition | null {
  const id = String(rawId ?? "") as ConsumableId;
  return CONSUMABLES[id] ?? null;
}

function getConsumableCooldowns(player: PlayerState): Record<string, { expiresAt: number }> {
  const raw = (player as any).consumableCooldowns;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    (player as any).consumableCooldowns = {};
    return (player as any).consumableCooldowns;
  }

  for (const [id, entry] of Object.entries(raw)) {
    const expiresAt = Number((entry as any)?.expiresAt ?? 0);
    if (!id || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      delete raw[id];
    } else {
      raw[id] = { expiresAt };
    }
  }

  return raw as Record<string, { expiresAt: number }>;
}

function getConsumableCounts(player: PlayerState): Record<ConsumableId, number> {
  const raw = (player as any).consumableCounts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const next = createStartingConsumableCounts();
    (player as any).consumableCounts = next;
    return next;
  }

  for (const consumableId of Object.keys(STARTING_CONSUMABLE_COUNTS) as ConsumableId[]) {
    const value = Number(raw[consumableId] ?? STARTING_CONSUMABLE_COUNTS[consumableId]);
    raw[consumableId] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : STARTING_CONSUMABLE_COUNTS[consumableId];
  }

  return raw as Record<ConsumableId, number>;
}

function getBuffBackedChannelInfo(buff: ActiveBuff): { ability: any; mode: "FORWARD" | "REVERSE" } | null {
  const findForAbility = (ability: any) => {
    if (
      ability?.type !== "CHANNEL" ||
      !Array.isArray(ability.buffs) ||
      ability.buffs.length === 0 ||
      ability.applyBuffsOnComplete === true ||
      ability.applyBuffsOnChannelStart === true
    ) {
      return null;
    }

    const channelBuff = ability.buffs.find((candidate: any) => candidate?.buffId === buff?.buffId);
    if (!channelBuff) return null;
    return {
      ability,
      mode: channelBuff.forwardChannel === true ? "FORWARD" as const : "REVERSE" as const,
    };
  };

  const sourceAbilityId = String((buff as any)?.sourceAbilityId ?? "");
  if (sourceAbilityId) {
    const info = findForAbility((ABILITIES as any)[sourceAbilityId]);
    if (info) return info;
  }

  for (const ability of Object.values(ABILITIES)) {
    const info = findForAbility(ability as any);
    if (info) return info;
  }
  return null;
}

function hasBuffBackedForwardChannel(player: PlayerState): boolean {
  return (player.buffs ?? []).some((buff) => getBuffBackedChannelInfo(buff as any)?.mode === "FORWARD");
}

function breakReverseChannels(state: GameState, player: PlayerState): boolean {
  let changed = false;

  if (player.activeChannel?.forwardChannel === false) {
    player.activeChannel = undefined;
    changed = true;
  }

  if (!Array.isArray(player.buffs) || player.buffs.length === 0) return changed;

  const remainingBuffs: ActiveBuff[] = [];
  for (const buff of player.buffs as ActiveBuff[]) {
    const channelInfo = getBuffBackedChannelInfo(buff);
    if (channelInfo?.mode !== "REVERSE") {
      remainingBuffs.push(buff);
      continue;
    }

    removeLinkedShield(player as any, buff as any);
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
      sourceUserId: buff.sourceUserId,
    });
    changed = true;
  }

  if (changed) {
    player.buffs = remainingBuffs;
  }
  return changed;
}

function breakStealthForConsumable(state: GameState, player: PlayerState, consumable: ConsumableDefinition): boolean {
  if (consumable.channel?.forwardChannel === true) return false;
  if (!Array.isArray(player.buffs) || player.buffs.length === 0) return false;

  const hadFuguang = player.buffs.some((buff) => buff.buffId === 1012);
  const removedBuffs: ActiveBuff[] = [];
  const remainingBuffs: ActiveBuff[] = [];

  for (const buff of player.buffs as ActiveBuff[]) {
    if (buff.buffId === SAND_DISGUISE_BUFF_ID && consumable.breaksDisguise === false) {
      remainingBuffs.push(buff);
      continue;
    }
    const removesStealth = STEALTH_BREAK_BUFF_IDS.has(buff.buffId) ||
      buff.buffId === SHI_FANG_XUAN_JI_BUFF_ID ||
      (hadFuguang && buff.buffId === FUGUANG_COMPANION_BUFF_ID);
    if (!removesStealth) {
      remainingBuffs.push(buff);
      continue;
    }
    removedBuffs.push(buff);
  }

  if (removedBuffs.length === 0) return false;

  player.buffs = remainingBuffs;
  for (const buff of removedBuffs) {
    removeLinkedShield(player as any, buff as any);
    pushBuffExpired(state, {
      targetUserId: player.userId,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
      sourceAbilityId: buff.sourceAbilityId,
      sourceAbilityName: buff.sourceAbilityName,
      sourceUserId: buff.sourceUserId,
    });
  }

  return true;
}

function hasConsumableBlockingControl(player: PlayerState): boolean {
  return (player.buffs ?? []).some((buff: any) =>
    Array.isArray(buff.effects) &&
    buff.effects.some((effect: any) => BLOCKING_CONSUMABLE_EFFECTS.has(effect?.type))
  );
}

function validateConsumableUse(player: PlayerState, consumable: ConsumableDefinition, now: number) {
  if (consumable.implemented === false) throw new Error("ERR_CONSUMABLE_NOT_IMPLEMENTED");
  if ((player.hp ?? 0) <= 0) throw new Error("ERR_CONTROLLED");
  if ((player as any).activeDash) throw new Error("ERR_CONSUMABLE_DASHING");
  if ((getConsumableCounts(player)[consumable.id] ?? 0) <= 0) throw new Error("ERR_CONSUMABLE_EMPTY");

  if (consumable.requiresGrounded === true) {
    const jumpCount = (player as any).jumpCount ?? 0;
    const vz = (player as any).velocity?.vz ?? 0;
    const groundedCastLockUntil = (player as any).groundedCastLockUntil ?? 0;

    if (jumpCount > 0 || Math.abs(vz) > 0.01 || groundedCastLockUntil > now) {
      throw new Error("ERR_REQUIRES_GROUNDED");
    }
  }

  if (hasConsumableBlockingControl(player)) throw new Error("ERR_CONSUMABLE_CONTROLLED");
  if (player.activeChannel && player.activeChannel.forwardChannel !== false) throw new Error("ERR_CHANNELING");
  if (hasBuffBackedForwardChannel(player)) throw new Error("ERR_CHANNELING");
  if (!consumable.usableInCombat && player.inCombat === true) throw new Error("ERR_CONSUMABLE_IN_COMBAT");

  const cooldowns = getConsumableCooldowns(player);
  const cooldownExpiresAt = Number(cooldowns[consumable.id]?.expiresAt ?? 0);
  if (Number.isFinite(cooldownExpiresAt) && cooldownExpiresAt > now) {
    throw new Error("ERR_CONSUMABLE_COOLDOWN");
  }
}

function applyInstantConsumableHeal(state: GameState, player: PlayerState, consumable: ConsumableDefinition, now: number) {
  const healRoll = resolveNonCritHealAmountRoll({
    source: player as any,
    target: player as any,
    base: consumable.healBase ?? 0,
  });
  const applied = applyHealToTarget(player as any, healRoll.heal);
  if (applied <= 0) return;

  state.events.push({
    id: randomUUID(),
    timestamp: now,
    turn: state.turn,
    type: "HEAL",
    actorUserId: player.userId,
    targetUserId: player.userId,
    abilityId: consumable.id,
    abilityName: consumable.name,
    effectType: "HEAL",
    value: applied,
    isCrit: false,
    suppressCritLabel: true,
  } as any);
}

function applyYueYingShaBuff(state: GameState, player: PlayerState) {
  addBuff({
    state,
    sourceUserId: player.userId,
    targetUserId: player.userId,
    ability: YUE_YING_SHA_ABILITY,
    buffTarget: player as any,
    buff: YUE_YING_SHA_BUFF,
  });
}

function startConsumableChannel(player: PlayerState, consumable: ConsumableDefinition, now: number) {
  const channel = consumable.channel;
  if (!channel) return;
  const effects: any[] = [];
  if (channel.healBase !== undefined) {
    effects.push({ type: "PERIODIC_HEAL", value: channel.healBase });
  }
  if (channel.applyDisguiseOnComplete === true) {
    effects.push({ type: "APPLY_DISGUISE_BUFF" });
  }

  player.activeChannel = {
    abilityId: consumable.id,
    abilityName: consumable.name,
    instanceId: consumable.id,
    targetUserId: player.userId,
    startedAt: now,
    durationMs: channel.durationMs,
    tickIntervalMs: channel.tickIntervalMs,
    lastTickAt: now,
    completedTickCount: 0,
    cancelOnMove: channel.cancelOnMove ?? channel.forwardChannel !== true,
    cancelOnJump: channel.cancelOnJump ?? true,
    forwardChannel: channel.forwardChannel ?? false,
    lockMovement: channel.lockMovement === true,
    consumableId: consumable.id,
    effects,
    cooldownTicks: 0,
    interruptible: true,
  };
}

export async function useConsumable(gameId: string, userId: string, rawConsumableId: unknown) {
  const loop = await ensureBattleLoop(gameId);
  if (!loop) throw new Error("ERR_BATTLE_NOT_IN_PROGRESS");

  const consumable = getConsumableDefinition(rawConsumableId);
  if (!consumable) throw new Error("ERR_CONSUMABLE_NOT_FOUND");

  const state = loop.getState();
  const playerIndex = state.players.findIndex((player) => player.userId === userId);
  if (playerIndex === -1) throw new Error("ERR_NOT_IN_GAME");
  if (state.gameOver) throw new Error("ERR_GAME_OVER");

  const now = Date.now();
  const player = state.players[playerIndex];
  validateConsumableUse(player, consumable, now);

  const prevState: GameState = structuredClone(state);
  const consumableCounts = getConsumableCounts(player);
  consumableCounts[consumable.id] = Math.max(0, Number(consumableCounts[consumable.id] ?? 0) - 1);
  breakReverseChannels(state, player);
  breakStealthForConsumable(state, player, consumable);

  if (consumable.healBase !== undefined) {
    applyInstantConsumableHeal(state, player, consumable, now);
  }

  if (consumable.id === YUE_YING_SHA_CONSUMABLE_ID) {
    applyYueYingShaBuff(state, player);
  }

  if (consumable.channel) {
    startConsumableChannel(player, consumable, now);
  }

  if (consumable.cooldownMs > 0) {
    getConsumableCooldowns(player)[consumable.id] = { expiresAt: now + consumable.cooldownMs };
  }

  state.version = (state.version ?? 0) + 1;
  loop.updateState(state);

  const diff = diffState(prevState, state);
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    timestamp: now,
  });

  return {
    version: state.version,
    diff,
    events: state.events,
    serverTimestamp: now,
  };
}
