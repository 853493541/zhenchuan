import express from "express";
import GameSession from "../models/GameSession";
import { gameStateCache } from "../services/gameStateCache";
import { ensureBattleLoop } from "../services/battleLoopRuntime";

const router = express.Router();

// Track last logged phase per game to reduce spam
const lastLoggedPhase = new Map<string, string>();

router.get("/:id", async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.id);
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    const loop = await ensureBattleLoop(req.params.id, game);
    const liveState = loop?.getState() ?? game.state;
    if (liveState) {
      gameStateCache.set(req.params.id, liveState as any);
    }
    
    // Convert to plain object to ensure all fields are properly serialized
    const gameObj = game.toObject();
    
    // Ensure playerNames exists (for backward compatibility with old games)
    if (!gameObj.playerNames) {
      gameObj.playerNames = {};
    }
    if (!gameObj.playerSchools) {
      gameObj.playerSchools = {};
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
      state: liveState,
      serverTimestamp: Date.now(),
      playerNames: gameObj.playerNames,
      playerSchools: gameObj.playerSchools,
      tournament: gameObj.tournament, // EXPLICITLY INCLUDE
      started: gameObj.started,
      mode: (gameObj as any).mode ?? 'arena',
    });
  } catch (err: any) {
    console.error("[snapshot] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
