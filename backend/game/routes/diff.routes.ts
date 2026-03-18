import express from "express";
import GameSession from "../models/GameSession";
import { getUserIdFromCookie } from "./auth";

const router = express.Router();

router.get("/:id/diff", async (req, res) => {
  try {
    getUserIdFromCookie(req); // auth check
    const sinceVersion = Number(req.query.sinceVersion ?? 0);

    const game = await GameSession.findById(req.params.id);
    if (!game || !game.state) {
      return res.status(404).json({ error: "Game not found" });
    }

    const state = game.state;

    if (state.version <= sinceVersion) {
      return res.json({ version: state.version, diff: [] });
    }

    res.json({
      version: state.version,
      diff: [{ path: "/", value: state }],
    });
  } catch (err: any) {
    res.status(400).send(err.message);
  }
});

export default router;
