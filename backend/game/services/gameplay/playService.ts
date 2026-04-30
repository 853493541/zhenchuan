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

import { pushEvent } from "../flow/events";
import { diffState } from "../flow/stateDiff";
import { applyOnPlayBuffEffects } from "../../engine/flow/play/onPlayEffects";
import { broadcastGameUpdate } from "../broadcast";
import { globalTimer } from "../../../utils/timing";
import { gameStateCache } from "../gameStateCache";
import { addBuff } from "../../engine/effects/buffRuntime";
import { applyDamageToTarget } from "../../engine/utils/health";
import { resolveScheduledDamage } from "../../engine/utils/combatMath";

/* ================= EVENT PRUNING ================= */

function pruneOldEvents(state: GameState, keepTurns = 10) {
  const minTurn = state.turn - keepTurns;
  state.events = state.events.filter((e) => e.turn >= minTurn);
}

const TEST_COOLDOWN_CAP_TICKS = 150; // 5 seconds at 30Hz

function clampCooldownTicksForTesting(ticks: number | undefined): number {
  if (ticks === undefined) return 0;
  if (ticks <= 0) return 0;
  return Math.min(ticks, TEST_COOLDOWN_CAP_TICKS);
}

function hasChargeSystem(ability: any): boolean {
  return Number(ability?.maxCharges ?? 0) > 1;
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

/* ================= PLAY CARD ================= */

export async function playAbility(
  gameId: string,
  userId: string,
  abilityInstanceId: string,
  targetUserId?: string,
  groundTarget?: { x: number; y: number; z?: number },
  entityTargetId?: string
) {
  const startTime = performance.now();
  globalTimer.start(`play_card_${gameId}`);

  // Check if this is a real-time battle
  const loop = GameLoop.get(gameId);

  if (loop) {
    // ✅ REAL-TIME BATTLE LOGIC
    return await playCastAbility(loop, gameId, userId, abilityInstanceId, targetUserId, groundTarget, entityTargetId);
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
  entityTargetId?: string
) {
  const state = loop.getState();
  const playerIndex = state.players.findIndex((p) => p.userId === userId);

  if (playerIndex === -1) {
    throw new Error("Not in this game");
  }

  // Validate ability can be cast (cooldown, range, silence, grounded lock)
  const mapCtx = loop.getMapCtx();
  validateCastAbility(state, playerIndex, abilityInstanceId, {
    pendingJump: loop.hasPendingJump(playerIndex),
    targetUserId,
    entityTargetId,
    groundTarget,
    mapObjects: mapCtx.objects,
    // Use BVH-based LOS for collision-test mode (accurate geometry vs entity AABBs)
    collisionSystem: mapCtx.collisionSystem ?? null,
    minLOSBlockH: mapCtx.collisionSystem ? 5.5 : 0,
  });

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

  if (idx === -1) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }
  
  const played = player.hand[idx];
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

  let targetIndex = ability.target === 'SELF' ? playerIndex : (playerIndex === 0 ? 1 : 0);
  if (ability.target === "OPPONENT" && targetUserId) {
    const explicitTargetIdx = state.players.findIndex((p) => p.userId === targetUserId);
    if (explicitTargetIdx >= 0) {
      targetIndex = explicitTargetIdx;
    }
  }
  const target = state.players[targetIndex];
  const targetEntity = entityTargetId
    ? (state.entities ?? []).find((entity: any) => entity.id === entityTargetId) ?? null
    : null;

  // Pure channels are driven by activeChannel in GameLoop and apply cooldown on completion.
  // applyBuffsOnComplete:true marks channel abilities whose buffs[] apply on finish, not on cast.
  const isPureChannel = ability.type === "CHANNEL" && (
    !ability.buffs || ability.buffs.length === 0 ||
    (ability as any).applyBuffsOnComplete === true ||
    (ability as any).applyBuffsOnChannelStart === true
  );
  if (isPureChannel) {
    player.activeChannel = {
      abilityId,
      abilityName: ability.name,
      instanceId: played.instanceId,
      targetUserId: targetEntity ? undefined : target.userId,
      entityTargetId: targetEntity?.id,
      startedAt: Date.now(),
      durationMs: (ability as any).channelDurationMs ?? 2_000,
      cancelOnMove: (ability as any).channelCancelOnMove ?? true,
      cancelOnJump: (ability as any).channelCancelOnJump ?? true,
      cancelOnOutOfRange: (ability as any).channelCancelOnOutOfRange,
      forwardChannel: (ability as any).channelForward ?? true,
      effects: (ability as any).channelEffects ?? [],
      cooldownTicks: clampCooldownTicksForTesting(ability.cooldownTicks ?? 150),
    };

    if ((ability as any).applyBuffsOnChannelStart === true) {
      const startedBuffIds: number[] = [];
      for (const buffDef of (ability.buffs ?? [])) {
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
          applyDamageToTarget(player as any, 2);
          pushEvent(state, {
            turn: state.turn,
            type: "DAMAGE",
            actorUserId: opp.userId,
            targetUserId: player.userId,
            abilityId: "bang_hua_sui_liu",
            abilityName: "傍花随柳",
            effectType: "BANG_HUA_TRIGGER",
            value: 2,
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

    // Apply ability effects
    applyEffects(state, ability, playerIndex, targetIndex, mapCtx, {
      targetUserId,
      groundTarget,
      entityTargetId,
    });
    applyOnPlayBuffEffects(state, playerIndex);

    const upgradedBangDaGouTouCast =
      ability.id === BANG_DA_GOU_TOU_ABILITY_ID &&
      state.players[targetIndex]?.buffs?.some(
        (b: any) =>
          b.buffId === BANG_DA_GOU_TOU_XINCHU_ER_BUFF_ID &&
          b.sourceAbilityId === BANG_DA_GOU_TOU_ABILITY_ID &&
          (b.appliedAt ?? 0) >= castStartedAt - 250
      );

    // Set runtime cooldown/charges after ability is consumed.
    consumeAbilityUseRuntime(played, ability, true);

    if (upgradedBangDaGouTouCast) {
      played.cooldown = Math.max(played.cooldown ?? 0, BANG_DA_GOU_TOU_COOLDOWN_TICKS);
    }
  }

  // 绛唇珠袖 trigger: if the caster has the 绛唇珠袖 debuff and just cast a qinggong ability,
  // immediately apply 绛唇珠袖·沉默 (SILENCE 2s) and deal 1 damage.
  const JIANG_CHUN_DEBUFF_ID = 2323;
  if ((ability as any).qinggong === true) {
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
        const dmg = resolveScheduledDamage({ source: opp, target: player as any, base: 1 });
        if (dmg > 0) applyDamageToTarget(player as any, dmg);
      }
    }
  }

  // 轻功 GCD: casting any 轻功 ability imposes a 3-second minimum cooldown on the other 3
  const QINGGONG_IDS = new Set(['nieyun_zhuyue', 'lingxiao_lansheng', 'yaotai_zhenhe', 'yingfeng_huilang']);
  const QINGGONG_GCD_TICKS = 90; // 3 s × 30 Hz
  if (QINGGONG_IDS.has(abilityId)) {
    for (const inst of player.hand) {
      const instCardId = (inst as any).abilityId || (inst as any).id;
      if (instCardId !== abilityId && QINGGONG_IDS.has(instCardId)) {
        inst.cooldown = Math.max(inst.cooldown, QINGGONG_GCD_TICKS);
      }
    }
  }

  // Global GCD: casting any gcd:true ability imposes a 1.5-second minimum CD on other gcd:true abilities
  const DRAFT_GCD_TICKS = 45; // 1.5 s × 30 Hz
  if ((ability as any).gcd === true) {
    for (const inst of player.hand) {
      const instCardId = (inst as any).abilityId || (inst as any).id;
      const instCard = ABILITIES[instCardId];
      if (instCard && (instCard as any).gcd === true) {
        if (hasChargeSystem(instCard)) {
          ensureChargeRuntime(inst, instCard);
          inst.chargeLockTicks = Math.max(inst.chargeLockTicks ?? 0, DRAFT_GCD_TICKS);
          inst.cooldown = Math.max(inst.cooldown ?? 0, inst.chargeLockTicks);
        } else {
          inst.cooldown = Math.max(inst.cooldown ?? 0, DRAFT_GCD_TICKS);
        }
      }
    }
  }

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
