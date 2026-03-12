import express from "express";
import { playCard, passTurn } from "../services";
import { getUserIdFromCookie } from "./auth";

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

export default router;
