import express from "express";
import { buildAbilityPreload } from "../abilities/abilityPreload";

const router = express.Router();

router.get("/preload", (_req, res) => {
  try {
    const preload = buildAbilityPreload();
    res.json(preload);
  } catch (err: any) {
    console.error("[PRELOAD] failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
