import { GameLoop, type GameLoopConfig } from "../engine/loop/GameLoop";
import type { GameState } from "../engine/state/types";
import GameSession from "../models/GameSession";
import { normalizeGameMode } from "../modes";
import { gameStateCache } from "./gameStateCache";

type SupportedBattleMode = NonNullable<GameLoopConfig["mode"]>;
const hydrationByGameId = new Map<string, Promise<GameLoop | undefined>>();

function normalizeBattleMode(mode: unknown): SupportedBattleMode {
  return normalizeGameMode(mode);
}

function canHydrateBattleLoop(game: any): game is { state: GameState; tournament: { phase: string } } {
  return getBattleLoopHydrationBlocker(game) === null;
}

function getBattleLoopHydrationBlocker(game: any): string | null {
  if (!game) return "game_not_found";
  if (game?.tournament?.phase !== "BATTLE") return `phase_${game?.tournament?.phase ?? "missing"}`;
  if (!game?.state) return "missing_state";
  if (!Array.isArray(game.state.players)) return "missing_players";
  if (game.state.players.length <= 0) return "empty_players";
  if (game.state.gameOver === true) return "game_over";
  return null;
}

export async function getBattleLoopHydrationDiagnostics(gameId: string, existingGame?: any) {
  const activeLoop = GameLoop.get(gameId);
  const game = existingGame ?? (activeLoop ? undefined : await GameSession.findById(gameId));
  const blocker = activeLoop ? null : getBattleLoopHydrationBlocker(game);
  return {
    hasActiveLoop: !!activeLoop,
    canHydrate: blocker === null,
    blocker,
    phase: game?.tournament?.phase ?? null,
    hasState: !!game?.state,
    playerCount: Array.isArray(game?.state?.players) ? game.state.players.length : 0,
    gameOver: game?.state?.gameOver === true,
    mode: (game as any)?.mode ?? null,
  };
}

export async function ensureBattleLoop(gameId: string, existingGame?: any): Promise<GameLoop | undefined> {
  const activeLoop = GameLoop.get(gameId);
  if (activeLoop) return activeLoop;

  const inFlight = hydrationByGameId.get(gameId);
  if (inFlight) return inFlight;

  const hydration = (async () => {
    const alreadyActive = GameLoop.get(gameId);
    if (alreadyActive) return alreadyActive;

    const game = existingGame ?? await GameSession.findById(gameId);
    if (!canHydrateBattleLoop(game)) return undefined;

    const activeBeforeStart = GameLoop.get(gameId);
    if (activeBeforeStart) return activeBeforeStart;

    const mode = normalizeBattleMode((game as any).mode);
    const loop = GameLoop.start(gameId, game.state as GameState, { tickRate: 30, mode });
    gameStateCache.set(gameId, loop.getState());
    console.log(`[battleLoopRuntime] Hydrated GameLoop for ${gameId} from persisted battle state`);
    return loop;
  })();

  hydrationByGameId.set(gameId, hydration);
  try {
    return await hydration;
  } finally {
    if (hydrationByGameId.get(gameId) === hydration) {
      hydrationByGameId.delete(gameId);
    }
  }
}
