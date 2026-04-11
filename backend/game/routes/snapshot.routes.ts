import express from "express";
import GameSession from "../models/GameSession";
import { gameStateCache } from "../services/gameStateCache";
import { resolveGameMap } from "../map/gameMapResolver";

const router = express.Router();

// Track last logged phase per game to reduce spam
const lastLoggedPhase = new Map<string, string>();

router.get("/:id/map", async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.id);
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const mode = ((game as any).mode ?? 'arena') as 'arena' | 'pubg';
    const resolvedMap = resolveGameMap(mode, (game as any).exportPackageName ?? null);

    res.json({
      mode,
      exportPackageName: resolvedMap.exportPackageName,
      map: {
        width: resolvedMap.width,
        height: resolvedMap.height,
        spawnCenterX: resolvedMap.spawnCenterX,
        spawnCenterY: resolvedMap.spawnCenterY,
        source: resolvedMap.source,
        objects: resolvedMap.objects,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.id);
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    // Prime the cache with this game state
    if (game.state) {
      gameStateCache.set(req.params.id, game.state as any);
    }
    
    // Convert to plain object to ensure all fields are properly serialized
    const gameObj = game.toObject();
    
    // Ensure playerNames exists (for backward compatibility with old games)
    if (!gameObj.playerNames) {
      gameObj.playerNames = {};
    }
    
    // Only log when phase changes (reduce spam)
    const currentPhase = gameObj.tournament?.phase || "NO_TOURNAMENT";
    const lastPhase = lastLoggedPhase.get(req.params.id);
    if (lastPhase !== currentPhase) {
      lastLoggedPhase.set(req.params.id, currentPhase);
      console.log(`[snapshot] GET /${req.params.id} - Phase changed to ${currentPhase}`);
    }

    // Explicitly return all fields including tournament
    res.json({
      _id: gameObj._id,
      players: gameObj.players,
      state: gameObj.state,
      playerNames: gameObj.playerNames,
      tournament: gameObj.tournament, // EXPLICITLY INCLUDE
      started: gameObj.started,
      mode: (gameObj as any).mode ?? 'arena',
      exportPackageName: (gameObj as any).exportPackageName ?? null,
    });
  } catch (err: any) {
    console.error("[snapshot] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
