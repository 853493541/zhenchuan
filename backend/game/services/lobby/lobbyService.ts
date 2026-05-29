// backend/game/services/lobbyService.ts
/**
 * Lobby lifecycle: create / join / start / get
 */

import GameSession from "../../models/GameSession";
import { normalizeStoredUserDisplayName, User } from "../../../models/User";
import { GameState, STARTING_ATTACK_DAMAGE, STARTING_BATTLE_HP, STARTING_CRIT_CHANCE_PCT, STARTING_DEFENSE_PCT, STARTING_HUAJIN_PCT } from "../../engine/state/types";
import { initializeTournament } from "../economy/tournamentService";
import { attachPlayerNamesToBattleState, initializeBattleState } from "../battle/battleService";
import { BASE_HASTE_RATE_PCT } from "../../engine/utils/haste";
import { DEFAULT_GAME_MODE, isYumen1v1BasicMode, type GameMode, normalizeGameMode } from "../../modes";

type PlayerProfile = {
  displayName: string;
  school: string | null;
};

async function getPlayerProfileById(userId: string): Promise<PlayerProfile> {
  const user = await User.findById(userId).select("displayName username school").lean();
  const displayName = user ? normalizeStoredUserDisplayName(user.username, user.displayName) : `User${userId.slice(-4)}`;
  const school = typeof user?.school === "string" ? user.school : null;
  console.log(`[getPlayerProfileById] userId=${userId} -> displayName=${displayName}, school=${school ?? "-"}`);
  return { displayName, school };
}

function setGamePlayerMetadata(game: any, userId: string, profile: PlayerProfile): boolean {
  let changed = false;
  if (!game.playerNames) game.playerNames = {};
  if (!game.playerSchools) game.playerSchools = {};

  if (game.playerNames[userId] !== profile.displayName) {
    game.playerNames[userId] = profile.displayName;
    changed = true;
  }
  if (profile.school && game.playerSchools[userId] !== profile.school) {
    game.playerSchools[userId] = profile.school;
    changed = true;
  }
  return changed;
}

function getMaxPlayersForMode(mode: unknown) {
  const normalizedMode = normalizeGameMode(mode ?? DEFAULT_GAME_MODE);
  if (isYumen1v1BasicMode(normalizedMode)) return 6;
  if (normalizedMode === "pubg") return 5;
  return 2;
}

export async function createGame(userId: string, mode: GameMode = DEFAULT_GAME_MODE) {
  const profile = await getPlayerProfileById(userId);

  const state: GameState = {
    /** authoritative state version */
    version: 1,

    turn: 0,
    activePlayerIndex: 0,

    gameOver: false,

    players: [
      {
        userId,
        hp: STARTING_BATTLE_HP,
        maxHp: STARTING_BATTLE_HP,
        attackDamage: STARTING_ATTACK_DAMAGE,
        shield: 0,
        waiGongCritChancePct: STARTING_CRIT_CHANCE_PCT,
        neiGongCritChancePct: STARTING_CRIT_CHANCE_PCT,
        critChancePct: STARTING_CRIT_CHANCE_PCT,
        defensePct: STARTING_DEFENSE_PCT,
        huajinPct: STARTING_HUAJIN_PCT,
        hasteRatePct: BASE_HASTE_RATE_PCT,
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
    mode,
    playerNames: {
      [userId]: profile.displayName,
    },
    playerSchools: {
      ...(profile.school ? { [userId]: profile.school } : {}),
    },
  });

  console.log(`[createGame] Created game ${created._id} with playerNames:`, created.playerNames);
  
  const obj = created.toObject();
  if (!obj.playerNames) obj.playerNames = {};
  if (!obj.playerSchools) obj.playerSchools = {};
  
  return obj;
}

export async function joinGame(gameId: string, userId: string) {
  const profile = await getPlayerProfileById(userId);
  const game = await GameSession.findById(gameId);
  if (!game) throw new Error("Game not found");

  if (game.players.includes(userId)) {
    console.log(`[joinGame] User already in game`);
    if (setGamePlayerMetadata(game, userId, profile)) {
      game.markModified('playerNames');
      game.markModified('playerSchools');
      await game.save();
    }
    const obj = game.toObject();
    if (!obj.playerNames) obj.playerNames = {};
    if (!obj.playerSchools) obj.playerSchools = {};
    return obj;
  }
  const maxPlayers = getMaxPlayersForMode((game as any).mode);
  if (game.players.length >= maxPlayers) throw new Error("Game already full");

  console.log(`[joinGame] Adding user ${userId} (${profile.displayName}) to game ${gameId}`);
  game.players.push(userId);
  
  setGamePlayerMetadata(game, userId, profile);
  
  console.log(`[joinGame] playerNames before save:`, game.playerNames);
  
  // Mark field as modified so Mongoose persists the change
  game.markModified('playerNames');
  game.markModified('playerSchools');
  
  await game.save();
  
  const saved = await GameSession.findById(gameId);
  if (!saved) throw new Error("Failed to retrieve game after save");
  
  const result = saved.toObject();
  if (!result.playerNames) result.playerNames = {};
  if (!result.playerSchools) result.playerSchools = {};
  
  console.log(`[joinGame] playerNames in response:`, result.playerNames);
  
  // Auto-start only when the mode-specific room is full.
  if (result.autoStart && saved.players.length >= getMaxPlayersForMode((saved as any).mode)) {
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
  const maxPlayers = getMaxPlayersForMode((game as any).mode);
  if (game.players.length > maxPlayers) throw new Error(`Maximum ${maxPlayers} players allowed`);

  const tournament = initializeTournament(game.players as string[]);
  tournament.phase = "BATTLE";

  // Initialize battle state for all players (common abilities only, draft skipped)
  const gameMode = normalizeGameMode((game as any).mode ?? 'arena');
  const state = attachPlayerNamesToBattleState(
    initializeBattleState(tournament, game.players as string[], gameMode),
    game.playerNames as Record<string, string> | undefined
  );

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
