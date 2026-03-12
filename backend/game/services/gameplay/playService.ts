// backend/game/services/playService.ts
/**
 * Gameplay actions: play card / pass turn
 */

import GameSession from "../../models/GameSession";
import { CARDS } from "../../cards/cards";
import { applyEffects } from "../../engine/flow/play/executeCard";
import { resolveTurnEnd } from "../../engine/flow/turn/advanceTurn";
import { validatePlayCard } from "../../engine/rules/validateAction";
import { GameState } from "../../engine/state/types";

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
  const played = player.hand[idx]; // Don't remove from hand - abilities are reusable

  const card = CARDS[played.cardId];
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
    timestamp: Date.now(), // Use Date.now for network round-trip (matches client)
  });

  // Save to DB in background (don't wait for it)
  GameSession.findByIdAndUpdate(gameId, { state }, { new: true }).catch((err) => {
    console.error(`[DB] Failed to save game ${gameId}:`, err.message);
  });

  const totalTime = globalTimer.log(`play_card_${gameId}`);
  const cacheStatus = cacheHit ? "HIT" : "MISS";

  console.log(
    `[Timing] PlayCard ${gameId}: DBFetch=${dbFetchTime.toFixed(2)}ms (${cacheStatus}), Diff=${diffTime.toFixed(2)}ms, Total=${totalTime?.toFixed(2) || '?'}ms, Patches=${diff.length}`
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
