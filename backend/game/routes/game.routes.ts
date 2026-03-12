import express from "express";

import preloadRoutes from "./preload.routes";
import lobbyRoutes from "./lobby.routes";
import draftRoutes from "./draft.routes";
import gameplayRoutes from "./gameplay.routes";
import snapshotRoutes from "./snapshot.routes";
import diffRoutes from "./diff.routes";

const router = express.Router();

/* ORDER MATTERS */
router.use(preloadRoutes);
router.use(lobbyRoutes);
router.use(draftRoutes);
router.use(gameplayRoutes);
router.use(diffRoutes);
router.use(snapshotRoutes);

export default router;
