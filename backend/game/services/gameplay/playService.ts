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
import { autoDrawAtTurnStart } from "../flow/draw";
import { pushEvent } from "../flow/events";
import { diffState } from "../flow/stateDiff";
import { applyOnPlayBuffEffects } from "../../engine/flow/play/onPlayEffects";
import { broadcastGameUpdate } from "../broadcast";

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
  const game = await GameSession.findById(gameId);
  if (!game || !game.state) throw new Error("Game not found");

  const state = game.state as GameState;
  if (!state.events) state.events = [];

  const prevState: GameState = structuredClone(state);

  const playerIndex = state.players.findIndex((p) => p.userId === userId);
  validatePlayCard(state, playerIndex, cardInstanceId);

  const player = state.players[playerIndex];
  const idx = player.hand.findIndex((c) => c.instanceId === cardInstanceId);
  const [played] = player.hand.splice(idx, 1);

  const card = CARDS[played.cardId];
  const targetIndex =
    card.target === "SELF" ? playerIndex : playerIndex === 0 ? 1 : 0;

  applyEffects(state, card, playerIndex, targetIndex);
  applyOnPlayBuffEffects(state, playerIndex);

  state.discard.push(played);

  state.version = (state.version ?? 0) + 1;

  pruneOldEvents(state, 10);

  const diff = diffState(prevState, state);

  game.state = state;
  game.markModified("state");
  await game.save();

  // Broadcast to all connected WebSocket clients
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    events: state.events,
    gameOver: state.gameOver,
    winnerUserId: state.winnerUserId,
  });

  return {
    version: state.version,
    diff,
    events: state.events,
  };
}

/* ================= PASS TURN ================= */

export async function passTurn(gameId: string, userId: string) {
  const game = await GameSession.findById(gameId);
  if (!game || !game.state) throw new Error("Game not found");

  const state = game.state as GameState;
  if (!state.events) state.events = [];

  const prevState: GameState = structuredClone(state);

  pushEvent(state, {
    turn: state.turn,
    type: "END_TURN",
    actorUserId: userId,
  });

  resolveTurnEnd(state);
  autoDrawAtTurnStart(state);

  state.version = (state.version ?? 0) + 1;

  pruneOldEvents(state, 10);

  const diff = diffState(prevState, state);

  game.state = state;
  game.markModified("state");
  await game.save();

  // Broadcast to all connected WebSocket clients
  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff,
    events: state.events,
    gameOver: state.gameOver,
    winnerUserId: state.winnerUserId,
  });

  return {
    version: state.version,
    diff,
    events: state.events,
  };
}
