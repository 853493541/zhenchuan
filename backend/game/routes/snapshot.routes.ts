import express from "express";
import GameSession from "../models/GameSession";
import { gameStateCache } from "../services/gameStateCache";

const router = express.Router();

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
    
    console.log(`[snapshot] GET /${req.params.id}`, {
      hasTournament: !!gameObj.tournament,
      tournamentPhase: gameObj.tournament?.phase,
      battleNumber: gameObj.tournament?.battleNumber,
      playerNames: Object.keys(gameObj.playerNames),
    });

    // Explicitly return all fields including tournament
    res.json({
      _id: gameObj._id,
      players: gameObj.players,
      state: gameObj.state,
      playerNames: gameObj.playerNames,
      tournament: gameObj.tournament, // EXPLICITLY INCLUDE
      started: gameObj.started,
    });
  } catch (err: any) {
    console.error("[snapshot] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
