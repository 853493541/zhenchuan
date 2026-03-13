// backend/game/services/playService.ts
/**
 * Gameplay actions: play card / pass turn
 */

import GameSession from "../../models/GameSession";
import { CARDS } from "../../cards/cards";
import { applyEffects } from "../../engine/flow/play/executeCard";
import { resolveTurnEnd } from "../../engine/flow/turn/advanceTurn";
import { validatePlayCard, validateCastAbility } from "../../engine/rules/validateAction";
import { GameState } from "../../engine/state/types";
import { GameLoop } from "../../engine/loop/GameLoop";

import { pushEvent } from "../flow/events";
import { diffState } from "../flow/stateDiff";
import { applyOnPlayBuffEffects } from "../../engine/flow/play/onPlayEffects";
import { broadcastGameUpdate } from "../broadcast";
import { globalTimer } from "../../../utils/timing";
import { gameStateCache } from "../gameStateCache";

/* ================= EVENT PRUNING ================= */

function pruneOldEvents(state: GameState, keepTurns = 10) {
  const minTurn = state.turn - keepTurns;
  state.events = state.events.filter((e) => e.turn >= minTurn);
}

/* ================= PLAY CARD ================= */

export async function playCard(
  gameId: string,
  userId: string,
  cardInstanceId: string
) {
  const startTime = performance.now();
  globalTimer.start(`play_card_${gameId}`);

  // Check if this is a real-time battle
  const loop = GameLoop.get(gameId);

  if (loop) {
    // ✅ REAL-TIME BATTLE LOGIC
    return await playCastAbility(loop, gameId, userId, cardInstanceId);
  } else {
    // ✅ TURN-BASED BATTLE LOGIC (legacy draft phase)
    return await playCardTurnBased(gameId, userId, cardInstanceId);
  }
}

/**
 * Real-time battle: Cast ability with range validation
 */
async function playCastAbility(
  loop: GameLoop,
  gameId: string,
  userId: string,
  cardInstanceId: string
) {
  const state = loop.getState();
  const playerIndex = state.players.findIndex((p) => p.userId === userId);

  if (playerIndex === -1) {
    throw new Error("Not in this game");
  }

  // Validate ability can be cast (cooldown, range, silence)
  validateCastAbility(state, playerIndex, cardInstanceId);

  const prevState: GameState = structuredClone(state);

  const player = state.players[playerIndex];
  const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
  
  if (idx === -1) {
    throw new Error("ERR_CARD_NOT_IN_HAND");
  }
  
  const played = player.hand[idx];
  console.log("[playCastAbility] DEBUG - played card:", {
    instanceId: played.instanceId,
    cardId: played.cardId,
    id: (played as any).id,
    keys: Object.keys(played),
  });
  // Card can be referenced by either .cardId or .id (depending on how it was populated)
  const cardId = played.cardId || (played as any).id;
  const card = CARDS[cardId];
  
  if (!card) {
    throw new Error("ERR_CARD_NOT_FOUND");
  }

  const targetIndex = card.target === 'SELF' ? playerIndex : (playerIndex === 0 ? 1 : 0);

  // Apply ability effects
  applyEffects(state, card, playerIndex, targetIndex);
  applyOnPlayBuffEffects(state, playerIndex);

  // Set cooldown (abilities are on shorter cooldowns during real-time)
  // In real-time, cooldowns are in milliseconds tracked by game loop
  // For now, use similar cooldown system: 3 ticks (~50ms at 60 Hz)
  played.cooldown = 3;

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
    `[CastAbility] Player ${playerIndex} cast ${card.name} in game ${gameId}`
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
async function playCardTurnBased(
  gameId: string,
  userId: string,
  cardInstanceId: string
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
  validatePlayCard(state, playerIndex, cardInstanceId);

  const player = state.players[playerIndex];
  const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
  const played = player.hand[idx];

  // Card can be referenced by either .cardId or .id (depending on how it was populated)
  const cardId = played.cardId || (played as any).id;
  const card = CARDS[cardId];
  const targetIndex =
    card.target === "SELF" ? playerIndex : playerIndex === 0 ? 1 : 0;

  applyEffects(state, card, playerIndex, targetIndex);
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
    `[Timing] PlayCard ${gameId}: DBFetch=${dbFetchTime.toFixed(2)}ms (${cacheStatus}), Diff=${diffTime.toFixed(2)}ms, Total=${totalTime?.toFixed(2) || "?"}ms, Patches=${diff.length}`
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
