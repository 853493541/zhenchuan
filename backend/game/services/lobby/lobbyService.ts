// backend/game/services/lobbyService.ts
/**
 * Lobby lifecycle: create / join / start / get
 */

import GameSession from "../../models/GameSession";
import { User } from "../../../models/User";
import { GameState } from "../../engine/state/types";
import { initializeTournament } from "../economy/tournamentService";
import { initializeBattleState } from "../battle/battleService";

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

  const state: GameState = {
    /** authoritative state version */
    version: 1,

    turn: 0,
    activePlayerIndex: 0,

    gameOver: false,

    players: [
      {
        userId,
        hp: 100,
        hand: [],
        buffs: [],

        // Draft phase doesn't use position, but we need these fields
        position: { x: 0, y: 0 },
        velocity: { vx: 0, vy: 0 },
        moveSpeed: 0,
      },
    ],

    events: [],
    pickups: [],
  };

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
  
  // Auto-start if enabled and room is full (2 for dev, up to 5 for PUBG)
  if (result.autoStart && saved.players.length >= 2) {
    console.log(`[joinGame] Auto-starting game (autoStart=${result.autoStart})`);
    const startedGame = await startGame(gameId, saved.players[0]);
    return startedGame;
  }
  
  return result;
}

export async function startGame(gameId: string, userId: string) {
  const game = await GameSession.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (game.players[0] !== userId) throw new Error("Only host can start");
  if (game.players.length < 2) throw new Error("Need at least 2 players to start");
  if (game.players.length > 5) throw new Error("Maximum 5 players allowed");

  const tournament = initializeTournament(game.players as string[]);
  tournament.phase = "BATTLE";

  // Initialize battle state for all players (common abilities only, draft skipped)
  const state = initializeBattleState(tournament, game.players as string[]);

  game.state = state;
  game.tournament = tournament;
  game.started = true;
  
  // Mark tournament as modified so Mongoose persists it
  game.markModified('tournament');
  
  console.log("[startGame] Before save, game.tournament:", {
    exists: !!game.tournament,
    phase: game.tournament?.phase,
  });
  
  try {
    const savedGame = await game.save();
    
    console.log("[startGame] After save, savedGame.tournament:", {
      exists: !!savedGame.tournament,
      phase: savedGame.tournament?.phase,
    });
    
    console.log(`[startGame] Game ${game._id} started with tournament:`, {
      battleNumber: tournament.battleNumber,
      phase: tournament.phase,
    });
    
    return savedGame;
  } catch (error: any) {
    console.error("[startGame] ERROR saving game:", error.message);
    throw error;
  }
}

export async function getGame(gameId: string, userId: string) {
  const game = await GameSession.findById(gameId);
  if (!game) throw new Error("Game not found");
  if (!game.players.includes(userId)) throw new Error("Not your game");
  return game;
}
