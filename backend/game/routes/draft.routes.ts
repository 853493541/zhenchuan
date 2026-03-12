/**
 * Draft phase routes - shop, selection, refresh, finalization
 */

import express from "express";
import GameSession from "../models/GameSession";
import { getUserIdFromCookie } from "./auth";
import { generateShop, REFRESH_COST } from "../services/economy/economyService";
import { getIncomePerRound } from "../services/economy/economyService";
import { initializeBattleState } from "../services/battle/battleService";
import { completeTournamentBattle } from "../services/tournament/tournamentResultService";

const router = express.Router();

/**
 * GET /draft/shop - Get current shop for this player
 */
router.get("/draft/shop/:gameId", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.params;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "DRAFT") return res.status(400).json({ error: "Not in draft phase" });

    const playerIndex = game.players.indexOf(userId);
    const shop = game.tournament.shop[userId];
    const eco = game.tournament.economy[userId];

    res.json({
      shop: shop.cards,
      locked: shop.locked,
      gold: eco.gold,
      level: eco.level,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/select - Select an ability from shop to add to selection
 * Body: { gameId, cardInstanceId }
 */
router.post("/draft/select", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardInstanceId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "DRAFT") return res.status(400).json({ error: "Not in draft phase" });

    const shop = game.tournament.shop[userId];
    const selected = game.tournament.selectedAbilities[userId];

    // Check if already selected 6 abilities
    if (selected.length >= 6) {
      return res.status(400).json({ error: "Already selected 6 abilities" });
    }

    // Find card in shop
    const cardIndex = shop.cards.findIndex((c: any) => c.instanceId === cardInstanceId);
    if (cardIndex === -1) {
      return res.status(400).json({ error: "Card not in shop" });
    }

    // Move card from shop to selected
    const [card] = shop.cards.splice(cardIndex, 1);
    selected.push(card);

    // Remove locked status for this position
    shop.locked.splice(cardIndex, 1);

    game.markModified("tournament");
    await game.save();

    res.json({
      selectedAbilities: selected,
      shop: shop.cards,
      locked: shop.locked,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/refresh - Refresh shop (costs 1 gold)
 * Body: { gameId }
 */
router.post("/draft/refresh", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "DRAFT") return res.status(400).json({ error: "Not in draft phase" });

    const eco = game.tournament.economy[userId];

    // Check gold
    if (eco.gold < REFRESH_COST) {
      return res.status(400).json({ error: "Not enough gold to refresh" });
    }

    // Deduct gold and refresh shop
    eco.gold -= REFRESH_COST;
    const newCards = generateShop(eco.level);

    game.tournament.shop[userId] = {
      cards: newCards,
      locked: [false, false, false, false, false],
    };

    game.markModified("tournament");
    await game.save();

    res.json({
      shop: newCards,
      gold: eco.gold,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/lock - Toggle lock on a shop card (prevents refresh removal)
 * Body: { gameId, cardIndex }
 */
router.post("/draft/lock", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardIndex } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });

    const shop = game.tournament.shop[userId];

    if (cardIndex < 0 || cardIndex >= shop.locked.length) {
      return res.status(400).json({ error: "Invalid card index" });
    }

    shop.locked[cardIndex] = !shop.locked[cardIndex];

    game.markModified("tournament");
    await game.save();

    res.json({ locked: shop.locked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/finalize - Finalize draft selection and move to battle
 * Both players must finalize before battle starts
 * Body: { gameId }
 */
router.post("/draft/finalize", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "DRAFT") return res.status(400).json({ error: "Not in draft phase" });

    const selected = game.tournament.selectedAbilities[userId];

    // Check if player has selected exactly 6 abilities
    if (selected.length !== 6) {
      return res.status(400).json({ error: `Must select exactly 6 abilities (currently ${selected.length})` });
    }

    // Mark this player as ready
    if (!game.draftReady) game.draftReady = {};
    (game.draftReady as any)[userId] = true;

    // Check if both players are ready
    const bothReady =
      Object.keys(game.draftReady as any).length === 2 &&
      Object.values(game.draftReady as any).every((v) => v === true);

    if (bothReady) {
      // Transition to battle
      game.tournament.phase = "BATTLE";
      game.draftReady = {};

      // Create new battle state with selected abilities
      // (actual battle state will be created by battle initiation route)
    }

    game.markModified("tournament");
    await game.save();

    res.json({ status: "ready", battleStarting: bothReady });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /battle/start - Initialize and start a new battle
 * Called after draft finalization
 * Body: { gameId }
 */
router.post("/battle/start", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not ready for battle" });

    // Initialize battle state
    const playerIds = game.players as [string, string];
    const battleState = initializeBattleState(game.tournament, playerIds);

    // Award gold income to both players
    for (const playerId of playerIds) {
      const eco = game.tournament.economy[playerId];
      const income = getIncomePerRound(eco.gold);
      eco.gold += income;
    }

    // Update game state with new battle
    game.state = battleState;
    game.markModified("tournament");

    await game.save();

    res.json({ status: "battle_started" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /battle/complete - Handle battle completion and tournament progression
 * Called when a battle ends (someone's HP reaches 0 or 20 turns pass)
 * Body: { gameId }
 */
router.post("/battle/complete", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (!game.state.gameOver) return res.status(400).json({ error: "Battle not over yet" });

    // Handle tournament battle completion (apply damage, advance to next battle/draft)
    const updatedTournament = completeTournamentBattle(game.state, game.tournament);
    game.tournament = updatedTournament;

    // If tournament is over, update game over flag
    if (game.tournament.phase === "GAME_OVER") {
      game.state.gameOver = true;
      game.state.winnerUserId = game.tournament.winnerId;
    } else if (game.tournament.phase === "DRAFT") {
      // Reset state for next draft phase
      game.state = {
        version: 1,
        turn: 0,
        activePlayerIndex: 0,
        deck: [],
        discard: [],
        gameOver: false,
        players: [],
        events: [],
      };
    }

    game.markModified("tournament");
    await game.save();

    res.json({
      status: game.tournament.phase === "GAME_OVER" ? "tournament_complete" : "next_draft_ready",
      tournamentWinner: game.tournament.winnerId,
      battleNumber: game.tournament.battleNumber,
      gameHp: game.tournament.gameHp,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
