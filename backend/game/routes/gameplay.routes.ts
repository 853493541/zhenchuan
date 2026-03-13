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

    if (!gameId || !userId) {
      console.error('[MOVEMENT] Missing gameId or userId');
      return res.status(400).json({ error: "Missing gameId or userId" });
    }

    const loop = GameLoop.get(gameId);
    if (!loop) {
      console.warn(`[MOVEMENT] GameLoop not active for ${gameId}`);
      // Return 400 instead of crashing - battle may be pending start
      return res.status(400).json({ error: "Battle not in progress" });
    }

    try {
      // Get player index
      const state = loop.getState();
      if (!state || !state.players) {
        console.error('[MOVEMENT] Invalid game state');
        return res.status(400).json({ error: "Invalid game state" });
      }

      const playerIndex = state.players.findIndex((p) => p.userId === userId);
      if (playerIndex === -1) {
        console.warn(`[MOVEMENT] User ${userId} not found in game ${gameId}`);
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
      
      // Return current position immediately so client can update without waiting for broadcast
      // Also include any pending input so client can predict the next position
      const player = state.players[playerIndex];
      res.json({ 
        success: true,
        position: player.position,
        velocity: player.velocity,
        input: input // Send input back so client can predict next position
      });
    } catch (loopErr: any) {
      console.error(`[MOVEMENT] GameLoop error: ${loopErr.message}`);
      console.error(loopErr.stack);
      res.status(500).json({ error: "GameLoop error: " + loopErr.message });
    }
  } catch (err: any) {
    console.error(`[MOVEMENT] ❌ ERROR: ${err.message}`);
    console.error(err.stack);
    res.status(400).json({ error: err.message });
  }
});

export default router;
