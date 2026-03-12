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
    
    res.json(game);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
