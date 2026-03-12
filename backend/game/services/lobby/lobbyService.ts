// backend/game/services/lobbyService.ts
/**
 * Lobby lifecycle: create / join / start / get
 */

import GameSession from "../../models/GameSession";
import { User } from "../../../models/User";
import { GameState } from "../../engine/state/types";
import { buildDeck, shuffle } from "../deck/deck";
import { draw } from "../flow/draw";

/**
 * Helper: fetch username by user ID
 */
async function getUsernameById(userId: string): Promise<string> {
  const user = await User.findById(userId).lean();
  const username = user?.username || `User${userId.slice(-4)}`;
  console.log(`[getUsernameById] userId=${userId} -> username=${username}`);
  return username;
}

export async function createGame(userId: string) {
  const username = await getUsernameById(userId);
  const deck = shuffle(buildDeck());

  const state: GameState = {
    /** authoritative state version */
    version: 1,

    turn: 0,
    activePlayerIndex: 0,

    deck,
    discard: [],
    gameOver: false,

    players: [
      {
        userId,
        hp: 100,
        hand: [],
        buffs: [],

        /**
         * GCD
         * - Game not started yet
         * - No active turn, so no GCD available
         */
        gcd: 0,
      },
    ],

    events: [],
  };

  draw(state, 0, 6);

  const created = await GameSession.create({
    players: [userId],
    state,
    started: false,
    playerNames: {
      [userId]: username,
    },
  });

  console.log(`[createGame] Created game ${created._id} with playerNames:`, created.playerNames);
  
  const obj = created.toObject();
  if (!obj.playerNames) obj.playerNames = {};
  
  return obj;
}

export async function joinGame(gameId: string, userId: string) {
  const username = await getUsernameById(userId);
  const game = await GameSession.findById(gameId);
  if (!game) throw new Error("Game not found");

  if (game.players.includes(userId)) {
    console.log(`[joinGame] User already in game`);
    const obj = game.toObject();
    if (!obj.playerNames) obj.playerNames = {};
    return obj;
  }
  if (game.players.length >= 2) throw new Error("Game already full");

  console.log(`[joinGame] Adding user ${userId} (${username}) to game ${gameId}`);
  game.players.push(userId);
  
  // Ensure playerNames exists and add the new player
  if (!game.playerNames) {
    game.playerNames = {};
  }
  (game.playerNames as any)[userId] = username;
  
  console.log(`[joinGame] playerNames before save:`, game.playerNames);
  
  // Mark field as modified so Mongoose persists the change
  game.markModified('playerNames');
  
  await game.save();
  
  const saved = await GameSession.findById(gameId);
  if (!saved) throw new Error("Failed to retrieve game after save");
  
  const result = saved.toObject();
  if (!result.playerNames) result.playerNames = {};
  
  console.log(`[joinGame] playerNames in response:`, result.playerNames);
  
  return result;
}

export async function startGame(gameId: string, userId: string) {
  const game = await GameSession.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (game.players[0] !== userId) throw new Error("Only host can start");
  if (game.players.length !== 2) throw new Error("Game not ready");

  const deck = shuffle(buildDeck());

  const state: GameState = {
    /** authoritative state version */
    version: 1,

    turn: 0,
    activePlayerIndex: 0,

    deck,
    discard: [],
    gameOver: false,

    players: [
      {
        userId: game.players[0],
        hp: 100,
        hand: [],
        buffs: [],

        /**
         * GCD
         * - Active player at game start
         * - Gets exactly 1 GCD for their first turn
         */
        gcd: 1,
      },
      {
        userId: game.players[1],
        hp: 100,
        hand: [],
        buffs: [],

        /**
         * GCD
         * - Not the active player yet
         * - Will be set to 1 when their turn starts
         */
        gcd: 0,
      },
    ],

    events: [],
  };

  draw(state, 0, 6);
  draw(state, 1, 6);

  game.state = state;
  game.started = true;
  await game.save();
  return game;
}

export async function getGame(gameId: string, userId: string) {
  const game = await GameSession.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (!game.players.includes(userId)) throw new Error("Not your game");
  return game;
}
