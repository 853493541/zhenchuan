import express from "express";

import preloadRoutes from "./preload.routes";
import lobbyRoutes from "./lobby.routes";
import draftRoutes from "./draft.routes";
import gameplayRoutes from "./gameplay.routes";
import snapshotRoutes from "./snapshot.routes";
import diffRoutes from "./diff.routes";

const router = express.Router();

/* REQUEST LOGGER FOR GAME ROUTES */
router.use((req, res, next) => {
  const path = req.path;
  const method = req.method;
  
  // Only log game-related endpoints (skip preload and movement data endpoints)
  if (!path.includes('data') && !path.includes('movement')) {
    console.log(`[GameRouter] 📥 Incoming: ${method} ${path}`);
  }
  
  next();
});

/* ORDER MATTERS */
router.use(preloadRoutes);
router.use(lobbyRoutes);
router.use(draftRoutes);
router.use(gameplayRoutes);
router.use(diffRoutes);
router.use(snapshotRoutes);

export default router;
