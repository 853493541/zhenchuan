import express from "express";
import { playAbility, passTurn } from "../services";
import { getUserIdFromCookie } from "./auth";
import { GameLoop } from "../engine/loop/GameLoop";
import type { MovementInput } from "../engine/state/types";
import { ABILITIES } from "../abilities/abilities";
import GameSession from "../models/GameSession";
import { broadcastGameUpdate } from "../services/broadcast";
import { randomUUID } from "crypto";
import { NEW_WORLD_UNIT_SCALE } from "../engine/state/types";

const router = express.Router();

router.post("/play", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityInstanceId, targetUserId, groundTarget, entityTargetId } = req.body;
    console.log(`[PLAY] Starting - userId: ${userId}, gameId: ${gameId}`);

    const patch = await playAbility(gameId, userId, abilityInstanceId, targetUserId, groundTarget, entityTargetId);
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
      let input: MovementInput | null = direction
        ? {
            up:   direction.up   === true,
            down: direction.down === true,
            left: direction.left === true,
            right: direction.right === true,
            jump: direction.jump === true,
            dx: typeof direction.dx === 'number' ? direction.dx : undefined,
            dy: typeof direction.dy === 'number' ? direction.dy : undefined,
          }
        : null;

      // Always apply the client-reported facing even when no movement keys are pressed
      // (needed so A/D turning in traditional mode updates server-side facing for abilities)
      const facingField = req.body.facing;
      if (facingField && typeof facingField.x === 'number' && typeof facingField.y === 'number') {
        if (input) {
          input.facing = { x: facingField.x, y: facingField.y };
        } else {
          // No movement but we still want to update facing — send a facing-only input
          input = {
            up: false,
            down: false,
            left: false,
            right: false,
            jump: false,
            facing: { x: facingField.x, y: facingField.y },
          };
        }
      }

      const seq = typeof req.body.seq === 'number' ? req.body.seq : undefined;
      loop.setPlayerInput(playerIndex, input, seq);
      
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

/**
 * POST /ping - Lightweight ping for RTT measurement
 * Responds immediately for latency testing
 */
router.post("/ping", async (req, res) => {
  res.json({ pong: true });
});

/* ======================== PICKUP SYSTEM ======================== */

const PICKUP_INTERACT_RANGE = 5;  // gameplay units — must be within this distance to start channeling
const PICKUP_CLAIM_RANGE    = 20; // gameplay units — can claim after channeling even if walked away
const MAX_DRAFT_HAND = 6;        // draft-ability cap (common abilities excluded)

/**
 * POST /gameplay/pickup/inspect
 * Player inspects a pickup book. Backend validates range and returns ability details.
 * The 0.5s channel animation is handled on the frontend before calling this.
 * Body: { gameId, pickupId }
 */
router.post("/pickup/inspect", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, pickupId } = req.body;

    if (!gameId || !pickupId) {
      return res.status(400).json({ error: "gameId and pickupId required" });
    }

    const loop = GameLoop.get(gameId);
    if (!loop) {
      return res.status(400).json({ error: "Battle not in progress" });
    }

    const state = loop.getState();
    const playerIndex = state.players.findIndex((p) => p.userId === userId);
    if (playerIndex === -1) {
      return res.status(403).json({ error: "Not in this game" });
    }

    const pickup = (state.pickups ?? []).find((p) => p.id === pickupId);
    if (!pickup) {
      return res.status(404).json({ error: "Pickup not found or already claimed" });
    }

    // Check distance (3D — includes Z height)
    const player = state.players[playerIndex];
    const storedUnitScale = state.unitScale ?? NEW_WORLD_UNIT_SCALE;
    const interactRange = PICKUP_INTERACT_RANGE * storedUnitScale;
    const dx = player.position.x - pickup.position.x;
    const dy = player.position.y - pickup.position.y;
    const dz = player.position.z ?? 0;
    if (dx * dx + dy * dy + dz * dz > interactRange * interactRange) {
      return res.status(400).json({ error: "Too far away to interact" });
    }

    const abilityDef = ABILITIES[pickup.abilityId];
    if (!abilityDef) {
      return res.status(400).json({ error: "Ability definition not found" });
    }

    res.json({
      pickupId: pickup.id,
      abilityId: pickup.abilityId,
      name: abilityDef.name,
      description: (abilityDef as any).description ?? "",
      type: abilityDef.type,
    });
  } catch (err: any) {
    console.error("[pickup/inspect] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /gameplay/pickup/claim
 * Player picks up the ability book. Validates range + hand capacity, then adds to hand.
 * Body: { gameId, pickupId }
 */
router.post("/pickup/claim", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, pickupId } = req.body;

    if (!gameId || !pickupId) {
      return res.status(400).json({ error: "gameId and pickupId required" });
    }

    const loop = GameLoop.get(gameId);
    if (!loop) {
      return res.status(400).json({ error: "Battle not in progress" });
    }

    const loopState = loop.getState();
    const playerIndex = loopState.players.findIndex((p) => p.userId === userId);
    if (playerIndex === -1) {
      return res.status(403).json({ error: "Not in this game" });
    }

    const pickupIdx = (loopState.pickups ?? []).findIndex((p) => p.id === pickupId);
    if (pickupIdx === -1) {
      return res.status(404).json({ error: "Pickup not found or already claimed" });
    }

    const pickup = loopState.pickups[pickupIdx];

    // Check distance — claim allows up to PICKUP_CLAIM_RANGE so player can walk away after channeling
    const player = loopState.players[playerIndex];
    const storedUnitScale = loopState.unitScale ?? NEW_WORLD_UNIT_SCALE;
    const claimRange = PICKUP_CLAIM_RANGE * storedUnitScale;
    const dx = player.position.x - pickup.position.x;
    const dy = player.position.y - pickup.position.y;
    const dz = player.position.z ?? 0;
    if (dx * dx + dy * dy + dz * dz > claimRange * claimRange) {
      return res.status(400).json({ error: "Too far away to pick up" });
    }

    // Check hand capacity (count only non-common draft abilities)
    const draftCount = player.hand.filter((h: any) => {
      const aid = h.abilityId ?? (h as any).id ?? h.instanceId;
      const def = ABILITIES[aid];
      return def && !(def as any).isCommon;
    }).length;
    if (draftCount >= MAX_DRAFT_HAND) {
      return res.status(400).json({ error: "你已经有6个技能，无法再拾取" });
    }

    const abilityDef = ABILITIES[pickup.abilityId];
    if (!abilityDef) {
      return res.status(400).json({ error: "Ability definition not found" });
    }

    const newInstance = {
      instanceId: randomUUID(),
      abilityId:  pickup.abilityId,
      cooldown:   0,
    };
    const fullCard = { ...abilityDef, ...newInstance };

    // Remove pickup and add ability to hand in live state
    loopState.pickups.splice(pickupIdx, 1);
    loopState.players[playerIndex] = {
      ...loopState.players[playerIndex],
      hand: [...loopState.players[playerIndex].hand, fullCard],
    };
    loop.updateState(loopState);

    // Persist to DB
    const game = await GameSession.findById(gameId);
    if (game) {
      game.state.players[playerIndex] = {
        ...game.state.players[playerIndex],
        hand: loopState.players[playerIndex].hand,
      };
      game.state.pickups = loopState.pickups;
      if (game.tournament?.selectedAbilities?.[userId]) {
        game.tournament.selectedAbilities[userId].push(newInstance);
        game.markModified("tournament");
      }
      game.markModified("state");
      game.markModified("state.players");
      game.markModified("state.pickups");
      await game.save();
    }

    // Broadcast updated hand + pickups to all clients
    broadcastGameUpdate({
      gameId,
      version: loopState.version,
      diff: [
        { path: `/players/${playerIndex}/hand`, value: loopState.players[playerIndex].hand },
        { path: "/pickups", value: loopState.pickups },
      ],
      timestamp: Date.now(),
    });

    res.json({
      ok: true,
      abilityId: pickup.abilityId,
      name: abilityDef.name,
      hand: loopState.players[playerIndex].hand,
    });
  } catch (err: any) {
    console.error("[pickup/claim] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
