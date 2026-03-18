import express from "express";
import { buildCardPreload } from "../cards/cardPreload";

const router = express.Router();

router.get("/preload", (_req, res) => {
  try {
    const preload = buildCardPreload();
    res.json(preload);
  } catch (err: any) {
    console.error("[PRELOAD] failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
