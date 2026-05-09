// backend/game/services/playService.ts
/**
 * Gameplay actions: play ability / pass turn
 */

import GameSession from "../../models/GameSession";
import { ABILITIES } from "../../abilities/abilities";
import { applyEffects } from "../../engine/flow/play/executeAbility";
import { resolveTurnEnd } from "../../engine/flow/turn/advanceTurn";
import { validatePlayAbility, validateCastAbility } from "../../engine/rules/validateAction";
import { GameState } from "../../engine/state/types";
import { GameLoop } from "../../engine/loop/GameLoop";
import { ensureBattleLoop } from "../battleLoopRuntime";

import { pushEvent } from "../flow/events";
import { diffState } from "../flow/stateDiff";
import { applyOnPlayBuffEffects } from "../../engine/flow/play/onPlayEffects";
import { breakOnPlay } from "../../engine/flow/play/breakOnPlay";
import { broadcastGameUpdate } from "../broadcast";
import { globalTimer } from "../../../utils/timing";
import { gameStateCache } from "../gameStateCache";
import { addBuff, cancelAnyBuffForTesting, cancelManualBuff, pushBuffExpired } from "../../engine/effects/buffRuntime";
import { applyDamageToTarget, removeLinkedShield } from "../../engine/utils/health";
import { resolveScheduledDamage, resolveScheduledDamageRoll } from "../../engine/utils/combatMath";
import { getAbilityRangeBonusFromBuffs } from "../../engine/utils/abilityRange";
import { getOrCreateSpecialAbilityState, isSpecialAbilityBarAbility } from "../../engine/utils/specialAbilityBar";
import { hasYuqiState } from "../../engine/utils/yuqi";
import { removeYuqiStateBuffs } from "../../engine/effects/buffRuntime";
import { getHasteAdjustedTimingMs } from "../../engine/utils/haste";
import { syncCombatStatusFromEvents } from "../../engine/utils/combatStatus";

/* ================= EVENT PRUNING ================= */

function pruneOldEvents(state: GameState, keepTurns = 10) {
  const minTurn = state.turn - keepTurns;
  state.events = state.events.filter((e) => e.turn >= minTurn);
}

const TEST_COOLDOWN_CAP_TICKS = 90; // 3 seconds at 30Hz
const SERVER_TICK_RATE = 30;
const BASE_GCD_SECONDS = 1.19;
const BASE_GCD_TICKS = Math.round(BASE_GCD_SECONDS * SERVER_TICK_RATE);
const BASE_GCD_MS = BASE_GCD_SECONDS * 1000;
const QINGGONG_GCD_TICKS = 3 * SERVER_TICK_RATE;
const QINGGONG_GCD_MS = 3000;
const HOUYAO_ABILITY_ID = "houyao";
const HOUYAO_GCD_TICKS = 2 * SERVER_TICK_RATE;
const HOUYAO_GCD_MS = 2000;
const HOUYAO_GCD_EXEMPT_ABILITY_IDS = new Set([
  HOUYAO_ABILITY_ID,
  "fuyao_zhishang",
  "nieyun_zhuyue",
  "lingxiao_lansheng",
  "yingfeng_huilang",
  "yaotai_zhenhe",
]);

function clampCooldownTicksForTesting(ticks: number | undefined): number {
  if (ticks === undefined) return 0;
  if (ticks <= 0) return 0;
  return Math.min(ticks, TEST_COOLDOWN_CAP_TICKS);
}

function hasChargeSystem(ability: any): boolean {
  return Number(ability?.maxCharges ?? 0) > 1;
}

function getAbilityIdFromInstance(instance: any): string {
  return String(instance?.abilityId || instance?.id || "");
}

function getRuntimeAbilityInstances(player: any): any[] {
  return [
    ...(Array.isArray(player?.hand) ? player.hand : []),
    ...Object.values(player?.specialAbilityStates ?? {}),
  ];
}

function isQinggongAbility(ability: any): boolean {
  return ability?.qinggong === true || ability?.qinggongGcdImmune === true;
}

function isQinggongGcdImmune(ability: any): boolean {
  return ability?.qinggongGcdImmune === true;
}

function applyMinimumAbilityLock(instance: any, ability: any, ticks: number) {
  if (!ability || ticks <= 0) return;
  if (hasChargeSystem(ability)) {
    ensureChargeRuntime(instance, ability);
    instance.chargeLockTicks = Math.max(instance.chargeLockTicks ?? 0, ticks);
    instance.cooldown = Math.max(instance.cooldown ?? 0, instance.chargeLockTicks);
    return;
  }
  instance.cooldown = Math.max(instance.cooldown ?? 0, ticks);
}

function setVisualGcd(player: any, name: string, kind: "base" | "qinggong" | "houyao", durationMs: number) {
  const startedAt = Date.now();
  player.visualGcd = {
    id: `${kind}-${startedAt}`,
    name,
    kind,
    startedAt,
    durationMs,
  };
}

function getActiveChannelTickIntervalMs(ability: any): number | undefined {
  const explicitInterval = Number(ability?.channelTickIntervalMs ?? ability?.channel?.tickIntervalMs ?? 0);
  if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
    return explicitInterval;
  }

  const hasLianHuanNuTick = Array.isArray(ability?.channelEffects) && ability.channelEffects.some(
    (effect: any) => effect?.type === "LIAN_HUAN_NU_TICK"
  );
  return hasLianHuanNuTick ? 1_000 : undefined;
}

function getChargeRecoveryTicks(ability: any): number {
  return Math.max(
    1,
    clampCooldownTicksForTesting((ability as any).chargeRecoveryTicks ?? ability.cooldownTicks ?? 1)
  );
}

function normalizeChargeRegenQueue(instance: any, ability: any) {
  if (!hasChargeSystem(ability)) return;

  const maxCharges = Math.max(0, Number(ability.maxCharges ?? 0));
  const recoveryTicks = getChargeRecoveryTicks(ability);
  const clampedChargeCount = Math.max(0, Math.min(maxCharges, Number(instance.chargeCount ?? maxCharges)));
  const missingCharges = Math.max(0, maxCharges - clampedChargeCount);

  let queue: number[] = Array.isArray(instance._chargeRegenQueueTicks)
    ? instance._chargeRegenQueueTicks
        .map((ticks: any) => Math.max(0, Number(ticks) || 0))
        .filter((ticks: number) => ticks > 0)
    : [];

  if (queue.length === 0 && missingCharges > 0) {
    const seededRemaining = Math.max(0, Number(instance.chargeRegenTicksRemaining ?? 0));
    if (seededRemaining > 0) {
      queue.push(seededRemaining);
    }
  }

  while (queue.length < missingCharges) {
    queue.push(recoveryTicks);
  }
  if (queue.length > missingCharges) {
    queue = queue.slice(0, missingCharges);
  }

  instance.chargeCount = clampedChargeCount;
  instance._chargeRegenQueueTicks = queue;
  instance.chargeRegenTicksRemaining = queue.length > 0
    ? Math.max(0, Math.ceil(Math.min(...queue)))
    : 0;
}

function ensureChargeRuntime(instance: any, ability: any) {
  if (!hasChargeSystem(ability)) return;
  const maxCharges = Math.max(0, Number(ability.maxCharges ?? 0));
  if (typeof instance.chargeCount !== "number") instance.chargeCount = maxCharges;
  if (typeof instance.chargeRegenTicksRemaining !== "number") instance.chargeRegenTicksRemaining = 0;
  if (typeof instance.chargeLockTicks !== "number") instance.chargeLockTicks = 0;
  normalizeChargeRegenQueue(instance, ability);
}

function consumeAbilityUseRuntime(instance: any, ability: any, applyBaseCooldown: boolean) {
  if (hasChargeSystem(ability)) {
    ensureChargeRuntime(instance, ability);
    const maxCharges = Math.max(1, Number(ability.maxCharges ?? 1));
    const recoveryTicks = getChargeRecoveryTicks(ability);
    const castLockTicks = Math.max(0, Number((ability as any).chargeCastLockTicks ?? 0));

    instance.chargeCount = Math.max(0, (instance.chargeCount ?? maxCharges) - 1);
    instance.chargeLockTicks = Math.max(instance.chargeLockTicks ?? 0, castLockTicks);
    normalizeChargeRegenQueue(instance, ability);

    if ((instance._chargeRegenQueueTicks?.length ?? 0) <= 0) {
      instance._chargeRegenProgress = 0;
    }

    if (instance.chargeCount <= 0) {
      instance.cooldown = Math.max(0, instance.chargeRegenTicksRemaining ?? recoveryTicks);
    } else if (instance.chargeLockTicks > 0) {
      instance.cooldown = Math.max(0, instance.chargeLockTicks ?? 0);
    } else {
      instance.cooldown = 0;
    }
    return;
  }

  if (applyBaseCooldown) {
    instance.cooldown = clampCooldownTicksForTesting(ability.cooldownTicks ?? 3);
  }
}

const BANG_DA_GOU_TOU_ABILITY_ID = "bang_da_gou_tou";
const BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID = 1333;
const BANG_DA_GOU_TOU_COOLDOWN_TICKS = 16 * 30;
const LONG_YIN_ABILITY_ID = "long_yin";

function clearChannelStartBuffs(
  state: GameState,
  player: { userId: string; buffs: any[] },
  channel?: { abilityId?: string; startedBuffIds?: number[] }
) {
  const startedBuffIds = channel?.startedBuffIds ?? [];
  if (startedBuffIds.length === 0) return false;

  let removedAny = false;
  const remainingBuffs: any[] = [];
  for (const buff of player.buffs ?? []) {
    const matchesStartedBuff =
      startedBuffIds.includes(buff.buffId) &&
      (buff.sourceAbilityId ?? channel?.abilityId) === channel?.abilityId;
    if (!matchesStartedBuff) {
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
    removedAny = true;
  }

  if (removedAny) {
    player.buffs = remainingBuffs;
  }
  return removedAny;
}

function cancelActiveChannel(
  state: GameState,
  player: { activeChannel?: any; buffs: any[]; userId: string }
) {
  const channel = player.activeChannel;
  if (!channel) return false;
  clearChannelStartBuffs(state, player, channel);
  player.activeChannel = undefined;
  return true;
}

function getBuffBackedChannelInfo(buff: any): { ability: any; mode: "FORWARD" | "REVERSE" } | null {
  const getInfo = (ability: any) => {
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

  const sourceAbilityId = String(buff?.sourceAbilityId ?? "");
  if (sourceAbilityId) {
    const info = getInfo(ABILITIES[sourceAbilityId] as any);
    if (info) return info;
  }

  for (const ability of Object.values(ABILITIES)) {
    const info = getInfo(ability as any);
    if (info) return info;
  }
  return null;
}

function breakReverseChannelBuffsOnSuccessfulCast(
  state: GameState,
  player: { userId: string; buffs?: any[] },
  playedAbilityId: string,
): boolean {
  if (!Array.isArray(player.buffs) || player.buffs.length === 0) return false;

  let removedAny = false;
  const remainingBuffs: any[] = [];
  for (const buff of player.buffs) {
    const channelInfo = getBuffBackedChannelInfo(buff);
    const isReverseChannel = channelInfo?.mode === "REVERSE";
    const isDifferentAbility = channelInfo?.ability?.id !== playedAbilityId;
    if (!isReverseChannel || !isDifferentAbility) {
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
    removedAny = true;
  }

  if (removedAny) {
    player.buffs = remainingBuffs;
  }
  return removedAny;
}

/* ================= PLAY CARD ================= */

export async function playAbility(
  gameId: string,
  userId: string,
  abilityInstanceId: string,
  targetUserId?: string,
  groundTarget?: { x: number; y: number; z?: number },
  entityTargetId?: string,
  movementIntent?: boolean,
) {
  const startTime = performance.now();
  globalTimer.start(`play_card_${gameId}`);

  // Check if this is a real-time battle
  const loop = await ensureBattleLoop(gameId);

  if (loop) {
    // ✅ REAL-TIME BATTLE LOGIC
    return await playCastAbility(loop, gameId, userId, abilityInstanceId, targetUserId, groundTarget, entityTargetId, movementIntent);
  } else {
    // ✅ TURN-BASED BATTLE LOGIC (legacy draft phase)
    return await playAbilityTurnBased(gameId, userId, abilityInstanceId);
  }
}

/**
 * Real-time battle: Cast ability with range validation
 */
async function playCastAbility(
  loop: GameLoop,
  gameId: string,
  userId: string,
  abilityInstanceId: string,
  targetUserId?: string,
  groundTarget?: { x: number; y: number; z?: number },
  entityTargetId?: string,
  movementIntent?: boolean,
) {
  const state = loop.getState();
  const playerIndex = state.players.findIndex((p) => p.userId === userId);

  if (playerIndex === -1) {
    throw new Error("Not in this game");
  }

  // Validate ability can be cast (cooldown, range, silence, grounded lock)
  const mapCtx = loop.getMapCtx();
  const validatedCast = validateCastAbility(state, playerIndex, abilityInstanceId, {
    pendingJump: loop.hasPendingJump(playerIndex),
    movementIntent: movementIntent ?? loop.hasMovementIntent(playerIndex),
    targetUserId,
    entityTargetId,
    groundTarget,
    mapObjects: mapCtx.objects,
    // Use BVH-based LOS for collision-test mode (accurate geometry vs entity AABBs)
    collisionSystem: mapCtx.collisionSystem ?? null,
    minLOSBlockH: mapCtx.collisionSystem ? 5.5 : 0,
  });
  const resolvedTargetUserId = validatedCast?.targetUserId ?? targetUserId;
  const resolvedEntityTargetId = validatedCast?.entityTargetId ?? entityTargetId;
  const confusionRetargeted = validatedCast?.confusionRetargeted === true;

  const prevState: GameState = structuredClone(state);

  const player = state.players[playerIndex];
  // Accept instanceId or abilityId (common abilities may arrive as abilityId)
  let idx = player.hand.findIndex(
    (c) => c.instanceId === abilityInstanceId || (c.abilityId ?? (c as any).id) === abilityInstanceId
  );

  // Auto-inject common abilities missing from hand (legacy games)
  if (idx === -1) {
    const commonAbility = ABILITIES[abilityInstanceId];
    if (commonAbility && (commonAbility as any).isCommon) {
      const injected: any = { instanceId: abilityInstanceId, abilityId: abilityInstanceId, cooldown: 0 };
      if (hasChargeSystem(commonAbility)) {
        injected.chargeCount = Number((commonAbility as any).maxCharges ?? 0);
        injected.chargeRegenTicksRemaining = 0;
        injected.chargeLockTicks = 0;
      }
      player.hand.push(injected);
      idx = player.hand.length - 1;
    }
  }

  const temporarySpecialAbility = idx === -1 &&
    ABILITIES[abilityInstanceId] &&
    (ABILITIES[abilityInstanceId] as any).specialBarAbility === true &&
    isSpecialAbilityBarAbility(player as any, abilityInstanceId);

  if (idx === -1 && !temporarySpecialAbility) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }
  
  const played = temporarySpecialAbility
    ? (getOrCreateSpecialAbilityState(player as any, abilityInstanceId) as any)
    : player.hand[idx];
  console.log("[playCastAbility] DEBUG - played ability:", {
    instanceId: played.instanceId,
    abilityId: played.abilityId,
    id: (played as any).id,
    keys: Object.keys(played),
  });
  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = played.abilityId || (played as any).id;
  const ability = ABILITIES[abilityId];
  
  if (!ability) {
    throw new Error("ERR_ABILITY_NOT_FOUND");
  }

  ensureChargeRuntime(played, ability);

  if ((ability as any).requiresStanding) {
    player.velocity = {
      ...(player.velocity as any),
      vx: 0,
      vy: 0,
    } as any;
  }

  const yuqiMounted = hasYuqiState(player as any);
  const togglesOffYuqi = abilityId === "yuqi" && yuqiMounted;

  if (togglesOffYuqi) {
    breakOnPlay(player as any, ability as any);
    breakReverseChannelBuffsOnSuccessfulCast(state, player as any, abilityId);
    removeYuqiStateBuffs({
      state,
      targetUserId: player.userId,
      target: player as any,
    });

    pushEvent(state, {
      turn: state.turn,
      type: "PLAY_ABILITY",
      actorUserId: player.userId,
      targetUserId: player.userId,
      abilityId,
      abilityName: ability.name,
    });

    consumeAbilityUseRuntime(played, ability, true);
  } else {

    const isFriendlyTargetAbility =
      ability.target === "OPPONENT" && (ability as any).friendlyTarget === true;
    let targetIndex =
      ability.target === 'SELF' || isFriendlyTargetAbility
        ? playerIndex
        : (playerIndex === 0 ? 1 : 0);
    if (ability.target === "OPPONENT" && resolvedTargetUserId) {
      const explicitTargetIdx = state.players.findIndex((p) => p.userId === resolvedTargetUserId);
      if (explicitTargetIdx >= 0) {
        targetIndex = explicitTargetIdx;
      }
    }
    const target = state.players[targetIndex];
    const targetEntity = resolvedEntityTargetId
      ? (state.entities ?? []).find((entity: any) => entity.id === resolvedEntityTargetId) ?? null
      : null;

    // Pure channels are driven by activeChannel in GameLoop and apply cooldown on completion.
    // applyBuffsOnComplete:true marks channel abilities whose buffs[] apply on finish, not on cast.
    const isPureChannel = ability.type === "CHANNEL" && (
      !ability.buffs || ability.buffs.length === 0 ||
      (ability as any).applyBuffsOnComplete === true ||
      (ability as any).applyBuffsOnChannelStart === true
    );
    if (isPureChannel) {
      breakOnPlay(player as any, ability as any);
      breakReverseChannelBuffsOnSuccessfulCast(state, player as any, abilityId);
      const channelRangeBonus = getAbilityRangeBonusFromBuffs(player.buffs);
      const channelCancelOnOutOfRange = typeof (ability as any).channelCancelOnOutOfRange === "number"
        ? (ability as any).channelCancelOnOutOfRange + channelRangeBonus
        : (ability as any).channelCancelOnOutOfRange;

      const rawChannelDurationMs = (ability as any).channelDurationMs ?? 2_000;
      const rawChannelTickIntervalMs = getActiveChannelTickIntervalMs(ability as any);
      const channelTickIntervalMs = rawChannelTickIntervalMs !== undefined
        ? getHasteAdjustedTimingMs(rawChannelTickIntervalMs, ability as any)
        : undefined;

      player.activeChannel = {
        abilityId,
        abilityName: ability.name,
        instanceId: played.instanceId,
        targetUserId: targetEntity ? undefined : target.userId,
        entityTargetId: targetEntity?.id,
        startedAt: Date.now(),
        durationMs: getHasteAdjustedTimingMs(rawChannelDurationMs, ability as any),
        ...(channelTickIntervalMs !== undefined ? { tickIntervalMs: channelTickIntervalMs } : {}),
        cancelOnMove: (ability as any).channelCancelOnMove ?? true,
        cancelOnJump: (ability as any).channelCancelOnJump ?? true,
        cancelOnOutOfRange: channelCancelOnOutOfRange,
        forwardChannel: (ability as any).channelForward ?? true,
        lockMovement: (ability as any).channelLockMovement === true,
        effects: (ability as any).channelEffects ?? [],
        cooldownTicks: clampCooldownTicksForTesting(ability.cooldownTicks ?? 150),
        interruptible: (ability as any).channelNotInterruptible !== true,
      };

      if (abilityId === "jiu_xiao_feng_lei" && player.activeDash?.lingRanCastLift === true) {
        const sustainVzPerTick = Number(player.activeDash.vzPerTick ?? player.activeDash.forceVzPerTick ?? 0);
        if (sustainVzPerTick > 0.0001) {
          player.lingRanCastLiftSustainChannelAbilityId = abilityId;
          player.lingRanCastLiftSustainVzPerTick = sustainVzPerTick;
        }
      }

      if ((ability as any).applyBuffsOnChannelStart === true) {
        const startedBuffIds: number[] = [];
        const startBuffIdSet = Array.isArray((ability as any).channelStartBuffIds)
          ? new Set((ability as any).channelStartBuffIds)
          : null;
        for (const buffDef of (ability.buffs ?? [])) {
          if (startBuffIdSet && !startBuffIdSet.has(buffDef.buffId)) continue;
          const applyTarget =
            buffDef.applyTo === "SELF" ? player
            : buffDef.applyTo === "OPPONENT" ? (targetEntity ?? target)
            : (ability.target === "SELF" ? player : (targetEntity ?? target));
          if (!applyTarget) continue;
          addBuff({
            state,
            sourceUserId: player.userId,
            targetUserId: (applyTarget as any).userId,
            ability,
            buffTarget: applyTarget as any,
            buff: buffDef,
          });
          startedBuffIds.push(buffDef.buffId);
        }
        if (startedBuffIds.length > 0) {
          player.activeChannel.startedBuffIds = startedBuffIds;
        }
      }

      pushEvent(state, {
        turn: state.turn,
        type: "PLAY_ABILITY",
        actorUserId: player.userId,
        targetUserId: targetEntity ? undefined : target.userId,
        entityId: targetEntity?.id,
        entityName: targetEntity?.abilityName,
        abilityId,
        abilityName: ability.name,
        channelPhase: player.activeChannel.forwardChannel === true ? "start" : undefined,
      });

      // If a pure channel ever uses charge metadata, consume a charge at cast start.
      if (hasChargeSystem(ability)) {
        consumeAbilityUseRuntime(played, ability, false);
      }

      // ── 傍花随柳 on-play trigger (channel cast counts as "出招") ─────────────
      {
        const BANG_HUA_BUFF_ID = 2611;
        const bangHuaNow = Date.now();
        const bangHuaIdx = (player.buffs as any[]).findIndex(
          (b: any) => b.buffId === BANG_HUA_BUFF_ID && b.expiresAt > bangHuaNow
        );
        if (bangHuaIdx >= 0) {
          const bangHuaBuff = (player.buffs as any[])[bangHuaIdx];
          const currentStacks = bangHuaBuff.stacks ?? 1;
          const opp = state.players.find((p) => p.userId !== player.userId);
          const isLastStack = currentStacks <= 1;
          if (opp) {
            // Always: consume 1 stack and deal 2 damage
            if (isLastStack) {
              (player.buffs as any[]).splice(bangHuaIdx, 1);
            } else {
              bangHuaBuff.stacks = currentStacks - 1;
            }
            const triggerDamageRoll = resolveScheduledDamageRoll({
              source: opp as any,
              target: player as any,
              base: 2,
              abilityId: "bang_hua_sui_liu",
              damageType: (ABILITIES["bang_hua_sui_liu"] as any)?.damageType,
            });
            const triggerDamage = triggerDamageRoll.damage;
            applyDamageToTarget(player as any, triggerDamage);
            pushEvent(state, {
              turn: state.turn,
              type: "DAMAGE",
              actorUserId: opp.userId,
              targetUserId: player.userId,
              abilityId: "bang_hua_sui_liu",
              abilityName: "傍花随柳",
              effectType: "BANG_HUA_TRIGGER",
              value: triggerDamage,
              isCrit: triggerDamageRoll.isCrit,
            } as any);
            // Last stack: also apply 束发 silence 4s
            if (isLastStack) {
              addBuff({
                state,
                sourceUserId: opp.userId,
                targetUserId: player.userId,
                ability: ABILITIES["bang_hua_sui_liu"] as any ?? { id: "bang_hua_sui_liu", name: "傍花随柳" },
                buffTarget: player as any,
                buff: {
                  buffId: 2612,
                  name: "束发",
                  category: "DEBUFF",
                  durationMs: 4_000,
                  description: "沉默4秒",
                  effects: [{ type: "SILENCE" }],
                } as any,
              });
            }
          }
        }
      }
    } else {
      const castStartedAt = Date.now();

      breakOnPlay(player as any, ability as any);
      breakReverseChannelBuffsOnSuccessfulCast(state, player as any, abilityId);

      // Apply ability effects
      applyEffects(state, ability, playerIndex, targetIndex, mapCtx, {
        targetUserId: resolvedTargetUserId,
        groundTarget,
        entityTargetId: resolvedEntityTargetId,
        ignoreTargetAllegiance: confusionRetargeted,
        forceEnemyApplied: confusionRetargeted ? ((ability as any).friendlyTarget !== true) : undefined,
      });
      applyOnPlayBuffEffects(state, playerIndex);

      pushEvent(state, {
        turn: state.turn,
        type: "PLAY_ABILITY",
        actorUserId: player.userId,
        targetUserId: targetEntity ? undefined : target.userId,
        entityId: targetEntity?.id,
        entityName: targetEntity?.abilityName,
        abilityId,
        abilityName: ability.name,
      });

      const upgradedBangDaGouTouCast =
        ability.id === BANG_DA_GOU_TOU_ABILITY_ID &&
        state.players[targetIndex]?.buffs?.some(
          (b: any) =>
            b.buffId === BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID &&
            b.sourceAbilityId === BANG_DA_GOU_TOU_ABILITY_ID &&
            (b.appliedAt ?? 0) >= castStartedAt - 250
        );
      const longYinCritTriggered =
        ability.id === LONG_YIN_ABILITY_ID &&
        state.events.some(
        (evt: any) =>
          evt?.type === "DAMAGE" &&
          evt.actorUserId === player.userId &&
          evt.abilityId === LONG_YIN_ABILITY_ID &&
          evt.isCrit === true &&
          (evt.timestamp ?? 0) >= castStartedAt - 250
        );

      // Set runtime cooldown/charges after ability is consumed.
      consumeAbilityUseRuntime(played, ability, true);

      if (upgradedBangDaGouTouCast) {
        played.cooldown = Math.max(played.cooldown ?? 0, BANG_DA_GOU_TOU_COOLDOWN_TICKS);
      }
      if (longYinCritTriggered) {
        played.cooldown = 0;
        (played as any)._cooldownProgress = 0;
      }
    }
  }

  // 绛唇珠袖 trigger: if the caster has the 绛唇珠袖 debuff and just cast a qinggong ability,
  // immediately apply 绛唇珠袖·沉默 (SILENCE 2s) and deal 1 damage.
  const JIANG_CHUN_DEBUFF_ID = 2323;
  if (isQinggongAbility(ability)) {
    const jiangBuff = (player as any).buffs?.find(
      (b: any) => b.buffId === JIANG_CHUN_DEBUFF_ID && b.expiresAt > Date.now()
    );
    if (jiangBuff) {
      const jiangAbility = ABILITIES["jiang_chun_zhu_xiu"] as any;
      const silenceBuff = jiangAbility?.buffs?.find((b: any) => b.buffId === 2324);
      const opp = (state as any).players?.find((p: any) => p.userId !== player.userId);
      if (jiangAbility && silenceBuff && opp) {
        addBuff({
          state: state as any,
          sourceUserId: opp.userId,
          targetUserId: player.userId,
          ability: jiangAbility,
          buffTarget: player as any,
          buff: silenceBuff,
        });
        const dmg = resolveScheduledDamage({ source: opp, target: player as any, base: 1, abilityId: "jiang_chun_zhu_xiu" });
        if (dmg > 0) applyDamageToTarget(player as any, dmg);
      }
    }
  }

  const runtimeAbilities = getRuntimeAbilityInstances(player);

  if (abilityId === HOUYAO_ABILITY_ID) {
    for (const inst of runtimeAbilities) {
      const instCardId = getAbilityIdFromInstance(inst);
      if (!instCardId || HOUYAO_GCD_EXEMPT_ABILITY_IDS.has(instCardId)) continue;
      const instCard = ABILITIES[instCardId];
      applyMinimumAbilityLock(inst, instCard, HOUYAO_GCD_TICKS);
    }
    setVisualGcd(player, "后撤调息时间", "houyao", HOUYAO_GCD_MS);
  } else if ((ability as any).gcd === true) {
    (player as any).globalGcdTicks = Math.max(
      Math.max(0, Number((player as any).globalGcdTicks ?? 0)),
      BASE_GCD_TICKS,
    );
    for (const inst of runtimeAbilities) {
      const instCardId = getAbilityIdFromInstance(inst);
      const instCard = ABILITIES[instCardId];
      if (instCard && (instCard as any).gcd === true) {
        applyMinimumAbilityLock(inst, instCard, BASE_GCD_TICKS);
      }
    }
    setVisualGcd(player, "基础调息时间", "base", BASE_GCD_MS);

    if (isQinggongAbility(ability) && !isQinggongGcdImmune(ability)) {
      for (const inst of runtimeAbilities) {
        const instCardId = getAbilityIdFromInstance(inst);
        if (!instCardId || instCardId === abilityId) continue;
        const instCard = ABILITIES[instCardId];
        if (isQinggongAbility(instCard) && !isQinggongGcdImmune(instCard)) {
          applyMinimumAbilityLock(inst, instCard, QINGGONG_GCD_TICKS);
        }
      }
      setVisualGcd(player, "轻功调息时间", "qinggong", QINGGONG_GCD_MS);
    }
  }

  syncCombatStatusFromEvents(state, prevState.events.length);

  state.version = (state.version ?? 0) + 1;

  // Update game loop with new state
  loop.updateState(state);

  const diff = diffState(prevState, state);

  // Broadcast HP/state changes to ALL players immediately.
  // The GameLoop only broadcasts positions every tick, so without this the
  // opponent would never see HP changes from ability casts.
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    timestamp: Date.now(),
  });

  console.log(
    `[CastAbility] Player ${playerIndex} cast ${ability.name} in game ${gameId}`
  );

  return {
    version: state.version,
    diff,
    events: state.events,
    serverTimestamp: Date.now(),
  };
}

export async function cancelActiveChannelCast(gameId: string, userId: string) {
  const loop = await ensureBattleLoop(gameId);
  if (!loop) {
    throw new Error("ERR_BATTLE_NOT_IN_PROGRESS");
  }

  const state = loop.getState();
  const playerIndex = state.players.findIndex((p) => p.userId === userId);
  if (playerIndex === -1) {
    throw new Error("ERR_NOT_IN_GAME");
  }

  const player = state.players[playerIndex] as any;
  const prevState: GameState = structuredClone(state);
  const cancelled = cancelActiveChannel(state, player);

  if (cancelled) {
    state.version = (state.version ?? 0) + 1;
    loop.updateState(state);
    const diff = diffState(prevState, state);
    broadcastGameUpdate({
      gameId,
      version: state.version,
      diff,
      timestamp: Date.now(),
    });
    return {
      version: state.version,
      diff,
      events: state.events,
      serverTimestamp: Date.now(),
    };
  }

  return {
    version: state.version ?? 0,
    diff: [],
    events: state.events,
    serverTimestamp: Date.now(),
  };
}

/**
 * Turn-based battle: Original behavior
 */
async function playAbilityTurnBased(
  gameId: string,
  userId: string,
  abilityInstanceId: string
) {
  const dbFetchStart = performance.now();

  // Try cache first, then fall back to DB
  let state = gameStateCache.get(gameId);
  let cacheHit = true;

  if (!state) {
    cacheHit = false;
    const game = await GameSession.findById(gameId);
    if (!game || !game.state) throw new Error("Game not found");
    state = game.state as GameState;
  }

  const dbFetchTime = performance.now() - dbFetchStart;

  if (!state.events) state.events = [];

  const prevState: GameState = structuredClone(state);

  const playerIndex = state.players.findIndex((p) => p.userId === userId);
  validatePlayAbility(state, playerIndex, abilityInstanceId);

  const player = state.players[playerIndex];
  const idx = player.hand.findIndex((c) => c.instanceId === abilityInstanceId);
  const played = player.hand[idx];

  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = played.abilityId || (played as any).id;
  const ability = ABILITIES[abilityId];
  const targetIndex =
    ability.target === "SELF" ? playerIndex : playerIndex === 0 ? 1 : 0;

  applyEffects(state, ability, playerIndex, targetIndex);
  applyOnPlayBuffEffects(state, playerIndex);

  // Set cooldown after ability is used (2 turn cooldown)
  played.cooldown = 2;

  state.version = (state.version ?? 0) + 1;

  pruneOldEvents(state, 10);

  const diffStart = performance.now();
  const diff = diffState(prevState, state);
  const diffTime = performance.now() - diffStart;

  // Update cache with new state
  gameStateCache.update(gameId, state);

  // Broadcast BEFORE waiting for DB save (fire-and-forget)
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    events: state.events,
    gameOver: state.gameOver,
    winnerUserId: state.winnerUserId,
    timestamp: Date.now(),
  });

  // Save to DB in background (don't wait for it)
  GameSession.findByIdAndUpdate(gameId, { state }, { new: true }).catch(
    (err) => {
      console.error(`[DB] Failed to save game ${gameId}:`, err.message);
    }
  );

  const totalTime = globalTimer.log(`play_card_${gameId}`);
  const cacheStatus = cacheHit ? "HIT" : "MISS";

  console.log(
    `[Timing] PlayAbility ${gameId}: DBFetch=${dbFetchTime.toFixed(2)}ms (${cacheStatus}), Diff=${diffTime.toFixed(2)}ms, Total=${totalTime?.toFixed(2) || "?"}ms, Patches=${diff.length}`
  );

  return {
    version: state.version,
    diff,
    events: state.events,
    serverTimestamp: Date.now(),
  };
}

/* ================= PASS TURN ================= */

export async function passTurn(gameId: string, userId: string) {
  const startTime = performance.now();
  globalTimer.start(`pass_turn_${gameId}`);

  const dbFetchStart = performance.now();

  // Try cache first, then fall back to DB
  let state = gameStateCache.get(gameId);
  let cacheHit = true;

  if (!state) {
    cacheHit = false;
    const game = await GameSession.findById(gameId);
    if (!game || !game.state) throw new Error("Game not found");
    state = game.state as GameState;
  }

  const dbFetchTime = performance.now() - dbFetchStart;

  if (!state.events) state.events = [];

  const prevState: GameState = structuredClone(state);

  pushEvent(state, {
    turn: state.turn,
    type: "END_TURN",
    actorUserId: userId,
  });

  resolveTurnEnd(state);

  state.version = (state.version ?? 0) + 1;

  pruneOldEvents(state, 10);

  const diffStart = performance.now();
  const diff = diffState(prevState, state);
  const diffTime = performance.now() - diffStart;

  // Update cache with new state
  gameStateCache.update(gameId, state);

  // Broadcast BEFORE waiting for DB save (fire-and-forget)
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    events: state.events,
    gameOver: state.gameOver,
    winnerUserId: state.winnerUserId,
    timestamp: Date.now(), // Use Date.now for network round-trip (matches client)
  });

  // Save to DB in background (don't wait for it)
  GameSession.findByIdAndUpdate(gameId, { state }, { new: true }).catch((err) => {
    console.error(`[DB] Failed to save game ${gameId}:`, err.message);
  });

  const totalTime = globalTimer.log(`pass_turn_${gameId}`);
  const cacheStatus = cacheHit ? "HIT" : "MISS";

  console.log(
    `[Timing] PassTurn ${gameId}: DBFetch=${dbFetchTime.toFixed(2)}ms (${cacheStatus}), Diff=${diffTime.toFixed(2)}ms, Total=${totalTime?.toFixed(2) || '?'}ms, Patches=${diff.length}`
  );

  return {
    version: state.version,
    diff,
    events: state.events,
    serverTimestamp: Date.now(),
  };
}

function resolveBuffCancelTarget(state: GameState, userId: string, entityTargetId?: string) {
  if (entityTargetId) {
    const entity = (state.entities ?? []).find((candidate: any) => candidate.id === entityTargetId);
    if (!entity) {
      throw new Error("ERR_INVALID_TARGET");
    }
    if (entity.kind !== "test_dummy_ally" || entity.ownerUserId !== userId) {
      throw new Error("ERR_BUFF_CANCEL_TARGET_NOT_ALLOWED");
    }
    return {
      targetUserId: entity.userId,
      target: entity,
      allowTestingCancel: true,
    };
  }

  const player = state.players.find((candidate) => candidate.userId === userId);
  if (!player) {
    throw new Error("Not in this game");
  }
  return {
    targetUserId: userId,
    target: player,
    allowTestingCancel: false,
  };
}

export async function cancelPlayerBuff(gameId: string, userId: string, buffId: number, options?: { entityTargetId?: string }) {
  if (!Number.isFinite(buffId)) {
    throw new Error("ERR_INVALID_BUFF_ID");
  }

  const loop = await ensureBattleLoop(gameId);
  if (loop) {
    const state = loop.getState();
    if (!state.events) state.events = [];
    const playerIndex = state.players.findIndex((player) => player.userId === userId);
    if (playerIndex === -1) {
      throw new Error("Not in this game");
    }

    const prevState: GameState = structuredClone(state);
    const cancelTarget = resolveBuffCancelTarget(state, userId, options?.entityTargetId);
    const removed = cancelTarget.allowTestingCancel
      ? cancelAnyBuffForTesting({
          state,
          targetUserId: cancelTarget.targetUserId,
          target: cancelTarget.target,
          buffId,
        })
      : cancelManualBuff({
          state,
          targetUserId: cancelTarget.targetUserId,
          target: cancelTarget.target,
          buffId,
        });
    if (!removed) {
      throw new Error("ERR_BUFF_NOT_CANCELABLE");
    }

    state.version = (state.version ?? 0) + 1;
    loop.updateState(state);
    const diff = diffState(prevState, state);

    broadcastGameUpdate({
      gameId,
      version: state.version,
      diff,
      events: state.events,
      timestamp: Date.now(),
    });

    return {
      version: state.version,
      diff,
      events: state.events,
      serverTimestamp: Date.now(),
    };
  }

  let state = gameStateCache.get(gameId);
  if (!state) {
    const game = await GameSession.findById(gameId);
    if (!game || !game.state) throw new Error("Game not found");
    state = game.state as GameState;
  }

  if (!state.events) state.events = [];
  const playerIndex = state.players.findIndex((player) => player.userId === userId);
  if (playerIndex === -1) {
    throw new Error("Not in this game");
  }

  const prevState: GameState = structuredClone(state);
  const cancelTarget = resolveBuffCancelTarget(state, userId, options?.entityTargetId);
  const removed = cancelTarget.allowTestingCancel
    ? cancelAnyBuffForTesting({
        state,
        targetUserId: cancelTarget.targetUserId,
        target: cancelTarget.target,
        buffId,
      })
    : cancelManualBuff({
        state,
        targetUserId: cancelTarget.targetUserId,
        target: cancelTarget.target,
        buffId,
      });
  if (!removed) {
    throw new Error("ERR_BUFF_NOT_CANCELABLE");
  }

  state.version = (state.version ?? 0) + 1;
  pruneOldEvents(state, 10);
  const diff = diffState(prevState, state);

  gameStateCache.update(gameId, state);
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    events: state.events,
    gameOver: state.gameOver,
    winnerUserId: state.winnerUserId,
    timestamp: Date.now(),
  });

  GameSession.findByIdAndUpdate(gameId, { state }, { new: true }).catch((err) => {
    console.error(`[DB] Failed to save game ${gameId}:`, err.message);
  });

  return {
    version: state.version,
    diff,
    events: state.events,
    serverTimestamp: Date.now(),
  };
}
