import express from "express";
import {
  createGame,
  joinGame,
  startGame,
} from "../services";
import GameSession from "../models/GameSession";
import { getUserIdFromCookie } from "./auth";

const router = express.Router();

router.post("/create", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { mode } = req.body;
    const validMode = mode === 'pubg' ? 'pubg' : mode === 'collision-test' ? 'collision-test' : 'arena';
    const game = await createGame(userId, validMode);
    res.json(game);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/join/:id", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const game = await joinGame(req.params.id, userId);
    res.json(game);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/start", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;
    const game = await startGame(gameId, userId);
    res.json(game);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/toggle-autostart/:id", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const gameId = req.params.id;
    
    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (game.players[0] !== userId) return res.status(403).json({ error: "Only host can change this" });
    if (game.started) return res.status(400).json({ error: "Game already started" });
    
    game.autoStart = !game.autoStart;
    await game.save();
    
    const result = game.toObject();
    if (!result.playerNames) result.playerNames = {};
    
    console.log(`[toggle-autostart] Game ${gameId} autoStart=${game.autoStart}`);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/waiting", async (_req, res) => {
  try {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - TWO_HOURS);

    await GameSession.deleteMany({
      updatedAt: { $lt: cutoff },
    });

    const games = await GameSession.find({
      started: false,
      players: { $size: 1 },
    }).sort({ createdAt: -1 });

    res.json(games);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
