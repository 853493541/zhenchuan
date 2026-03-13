import express from "express";
import { playCard, passTurn } from "../services";
import { getUserIdFromCookie } from "./auth";
import { GameLoop } from "../engine/loop/GameLoop";
import type { MovementInput } from "../engine/state/types";

const router = express.Router();

router.post("/play", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardInstanceId } = req.body;
    console.log(`[PLAY] Starting - userId: ${userId}, gameId: ${gameId}`);

    const patch = await playCard(gameId, userId, cardInstanceId);
    console.log(`[PLAY] ✅ Complete - version: ${patch.version}`);
    res.json(patch);
  } catch (err: any) {
    console.error(`[PLAY] ❌ ERROR: ${err.message}`);
    console.error(`[PLAY] Stack: ${err.stack}`);
    res.status(400).send(err.message);
  }
});

router.post("/pass", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;
    console.log(`[PASS] Starting - userId: ${userId}, gameId: ${gameId}`);

    const patch = await passTurn(gameId, userId);
    console.log(`[PASS] ✅ Complete - version: ${patch.version}`);
    res.json(patch);
  } catch (err: any) {
    console.error(`[PASS] ❌ ERROR: ${err.message}`);
    console.error(`[PASS] Stack: ${err.stack}`);
    res.status(400).send(err.message);
  }
});

/**
 * POST /movement - Update player movement input (WASD)
 * Sends current pressed keys to game loop
 * Body: { gameId, direction: null | { up, down, left, right } }
 */
router.post("/movement", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, direction } = req.body;

    const loop = GameLoop.get(gameId);
    if (!loop) {
      return res.status(400).json({ error: "Battle not in progress" });
    }

    // Get player index
    const state = loop.getState();
    const playerIndex = state.players.findIndex((p) => p.userId === userId);
    if (playerIndex === -1) {
      return res.status(403).json({ error: "Not in this game" });
    }

    // Update movement input
    const input: MovementInput | null = direction
      ? {
          up: direction.up === true,
          down: direction.down === true,
          left: direction.left === true,
          right: direction.right === true,
        }
      : null;

    loop.setPlayerInput(playerIndex, input);
    res.json({ success: true });
  } catch (err: any) {
    console.error(`[MOVEMENT] ❌ ERROR: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

export default router;
