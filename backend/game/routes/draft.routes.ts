/**
 * Draft phase routes - shop, selection, refresh, finalization
 */

import express from "express";
import { randomUUID } from "crypto";
import GameSession from "../models/GameSession";
import { getUserIdFromCookie } from "./auth";
import { generateShop, REFRESH_COST } from "../services/economy/economyService";
import { getIncomePerRound } from "../services/economy/economyService";
import { initializeBattleState } from "../services/battle/battleService";
import { completeTournamentBattle } from "../services/tournament/tournamentResultService";
import { GameLoop } from "../engine/loop/GameLoop";
import { CARDS } from "../cards/cards";
import { broadcastGameUpdate } from "../services/broadcast";
import { diffState } from "../services/flow/stateDiff";
import type { CardInstance } from "../engine/state/types";

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
 * Body: { gameId, cardInstanceId, destination: "selected" | "bench" }
 */
router.post("/draft/select", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardInstanceId, destination = "selected" } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "DRAFT") return res.status(400).json({ error: "Not in draft phase" });

    const shop = game.tournament.shop[userId];
    const selected = game.tournament.selectedAbilities[userId];
    const bench = game.tournament.bench[userId];

    // Check destination capacity
    if (destination === "selected" && selected.length >= 6) {
      return res.status(400).json({ error: "选择栏已满(最多6个)" });
    }
    if (destination === "bench" && bench.length >= 8) {
      return res.status(400).json({ error: "备战区已满 (最多8个)" });
    }

    // Find card in shop
    const cardIndex = shop.cards.findIndex((c: any) => c.instanceId === cardInstanceId);
    if (cardIndex === -1) {
      return res.status(400).json({ error: "卡牌不在商店中" });
    }

    // Move card from shop to destination
    const [card] = shop.cards.splice(cardIndex, 1);
    if (destination === "selected") {
      selected.push(card);
    } else {
      bench.push(card);
    }

    // Remove locked status for this position
    shop.locked.splice(cardIndex, 1);

    game.markModified("tournament");
    await game.save();

    res.json({
      selectedAbilities: selected,
      bench: bench,
      shop: shop.cards,
      locked: shop.locked,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/move - Move card between selected and bench
 * Body: { gameId, cardInstanceId, from: "selected" | "bench", to: "selected" | "bench" }
 */
router.post("/draft/move", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardInstanceId, from, to } = req.body;

    if (!from || !to || from === to) {
      return res.status(400).json({ error: "Invalid move" });
    }

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });

    const selected = game.tournament.selectedAbilities[userId];
    const bench = game.tournament.bench[userId];

    // Check destination capacity
    if (to === "selected" && selected.length >= 6) {
      return res.status(400).json({ error: "选择栏已满(最多6个)" });
    }
    if (to === "bench" && bench.length >= 8) {
      return res.status(400).json({ error: "备战区已满 (最多8个)" });
    }

    // Find and move card
    const fromArray = from === "selected" ? selected : bench;
    const cardIdx = fromArray.findIndex((c: CardInstance) => c.instanceId === cardInstanceId);
    if (cardIdx === -1) {
      return res.status(400).json({ error: "卡牌不存在" });
    }

    const [card] = fromArray.splice(cardIdx, 1);
    if (to === "selected") {
      selected.push(card);
    } else {
      bench.push(card);
    }

    game.markModified("tournament");
    await game.save();

    res.json({
      selectedAbilities: selected,
      bench: bench,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/sell - Sell a benched card for gold
 * Body: { gameId, cardInstanceId }
 */
router.post("/draft/sell", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardInstanceId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });

    const bench = game.tournament.bench[userId];
    const eco = game.tournament.economy[userId];

    // Find and remove card from bench
    const cardIdx = bench.findIndex((c: CardInstance) => c.instanceId === cardInstanceId);
    if (cardIdx === -1) {
      return res.status(400).json({ error: "卡牌不在备战区" });
    }

    const [card] = bench.splice(cardIdx, 1);
    
    // Get card cost from preload data (default 3 if not found)
    const cardCost = 3; // You could look this up from card definitions
    eco.gold += cardCost;

    game.markModified("tournament");
    await game.save();

    res.json({
      bench: bench,
      gold: eco.gold,
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
    console.log("[draft/finalize] 🔔 ENDPOINT CALLED");
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    const playerName = game?.playerNames?.[userId] || "unknown";
    console.log(`[draft/finalize] ⏱️ ${playerName} (${userId}) clicked Ready for game: ${gameId}`);

    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "DRAFT") return res.status(400).json({ error: "Not in draft phase" });

    const selected = game.tournament.selectedAbilities[userId];

    // Players can go to battle with any number of cards (including 0)
    // Mark this player as ready
    if (!game.draftReady) game.draftReady = {};
    (game.draftReady as any)[userId] = true;

    // Check if both players are ready
    const bothReady =
      Object.keys(game.draftReady as any).length === 2 &&
      Object.values(game.draftReady as any).every((v) => v === true);

    console.log(`[draft/finalize] 📊 Draft ready status: ${Object.values(game.draftReady as any).length}/2 players ready`);
    console.log(`[draft/finalize] 📊 Ready players: ${Object.keys(game.draftReady as any).map((id: string) => game.playerNames?.[id] || id).join(", ")}`);
    
    if (bothReady) {
      console.log(`[draft/finalize] ✅ BOTH PLAYERS READY! Transitioning to BATTLE...`);
    } else {
      console.log(`[draft/finalize] ⏳ Waiting for other player...`);
    }

    // ✅ CRITICAL: Capture state BEFORE making any changes
    const prevState = bothReady ? structuredClone(game.state) : null;
    const prevTournament = bothReady ? structuredClone(game.tournament) : null;

    if (bothReady) {
      // Transition to battle
      game.tournament.phase = "BATTLE";
      game.draftReady = {};

      // Put selected abilities into player hands
      const player0Id = game.players[0];
      const player1Id = game.players[1];
      const player0Selected = game.tournament.selectedAbilities[player0Id];
      const player1Selected = game.tournament.selectedAbilities[player1Id];

      console.log("[draft/finalize] DEBUG - selectedAbilities structure:", {
        player0Id,
        player1Id,
        player0SelectedLength: player0Selected?.length || 0,
        player1SelectedLength: player1Selected?.length || 0,
        player0SelectedCards: player0Selected?.map((c: any) => c.cardId) || [],
        player1SelectedCards: player1Selected?.map((c: any) => c.cardId) || [],
      });

      // ✅ CRITICAL: Look up full Card definitions from CARDS database
      // selectedAbilities has {cardId, instanceId, cooldown} - we need {cardId, instanceId, cooldown, ...cardDefinition}
      const player0Hand = player0Selected?.map((cardInstance: any) => {
        const cardDef = CARDS[cardInstance.cardId];
        if (!cardDef) {
          console.error(`[draft/finalize] ❌ Card definition not found: ${cardInstance.cardId}`);
          return null;
        }
        // Merge card definition with instance metadata (preserving cooldown, instanceId)
        return {
          ...cardDef,
          instanceId: cardInstance.instanceId,
          cooldown: cardInstance.cooldown || 0,
        };
      }).filter((c: any) => c !== null) || [];

      const player1Hand = player1Selected?.map((cardInstance: any) => {
        const cardDef = CARDS[cardInstance.cardId];
        if (!cardDef) {
          console.error(`[draft/finalize] ❌ Card definition not found: ${cardInstance.cardId}`);
          return null;
        }
        return {
          ...cardDef,
          instanceId: cardInstance.instanceId,
          cooldown: cardInstance.cooldown || 0,
        };
      }).filter((c: any) => c !== null) || [];

      console.log("[draft/finalize] After loading Card definitions:", {
        player0HandLength: player0Hand?.length || 0,
        player1HandLength: player1Hand?.length || 0,
        player0HandCards: player0Hand?.map((c: any) => ({ id: c.id, name: c.name })) || [],
        player1HandCards: player1Hand?.map((c: any) => ({ id: c.id, name: c.name })) || [],
      });

      // Update game state with serialized hand
      game.state.players[0].hand = player0Hand;
      game.state.players[1].hand = player1Hand;

      // ✅ Initialize arena positions when phase transitions to BATTLE
      // This ensures both players have position data immediately, even before /battle/start is called
      const ARENA_WIDTH = 100;
      const ARENA_HEIGHT = 100;
      
      if (!game.state.players[0].position) {
        game.state.players[0].position = {
          x: ARENA_WIDTH * 0.25,
          y: ARENA_HEIGHT / 2,
        };
      }
      if (!game.state.players[1].position) {
        game.state.players[1].position = {
          x: ARENA_WIDTH * 0.75,
          y: ARENA_HEIGHT / 2,
        };
      }

      // Initialize velocity if not present
      if (!game.state.players[0].velocity) {
        game.state.players[0].velocity = { vx: 0, vy: 0 };
      }
      if (!game.state.players[1].velocity) {
        game.state.players[1].velocity = { vx: 0, vy: 0 };
      }

      game.state.players[0].moveSpeed = 0.25;
      game.state.players[1].moveSpeed = 0.25;

      // Force Mongoose to recognize nested changes
      game.state.players[0] = {
        ...game.state.players[0],
        hand: player0Hand,
      };
      game.state.players[1] = {
        ...game.state.players[1],
        hand: player1Hand,
      };
      game.markModified("state");
      game.markModified("state.players");

      console.log("[draft/finalize] Both players ready, transitioning to BATTLE phase");
      console.log(`[draft/finalize] Player 0 hand: ${game.state.players[0].hand.length} cards`);
      console.log(`[draft/finalize] Player 1 hand: ${game.state.players[1].hand.length} cards`);
    }

    game.markModified("tournament");
    await game.save();

    console.log("[draft/finalize] DEBUG - After save to DB:", {
      player0HandLength: game.state.players[0].hand?.length || 0,
      player1HandLength: game.state.players[1].hand?.length || 0,
      player0HandCards: game.state.players[0].hand?.map((c: any) => ({ id: c.id, name: c.name })) || [],
      player1HandCards: game.state.players[1].hand?.map((c: any) => ({ id: c.id, name: c.name })) || [],
      player0Position: game.state.players[0].position,
      player1Position: game.state.players[1].position,
    });

    // ✅ Broadcast BATTLE phase transition to both players immediately
    if (bothReady && prevState && prevTournament) {
      const diff = diffState(prevState, game.state);
      // Also broadcast tournament phase change
      const tournamentDiff = diffState(prevTournament, game.tournament);
      const allDiffs = [...diff, ...tournamentDiff];
      console.log(`[draft/finalize] Broadcasting BATTLE phase with ${allDiffs.length} patches (${diff.length} state + ${tournamentDiff.length} tournament)`);
      broadcastGameUpdate({
        gameId: gameId,
        version: game.state.version,
        diff: allDiffs,
        timestamp: Date.now(),
      });
    }

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
    // Disabled: spam during testing
    // console.log(`[battle/start] ⏱️ RECEIVED`);
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    // Disabled: spam during testing
    // console.log(`[battle/start] 📋 Fetching game ${gameId}...`);
    const game = await GameSession.findById(gameId);
    // Disabled: spam during testing
    
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not ready for battle" });

    // ✅ CHECK IF GAME LOOP ALREADY STARTED (prevent duplicate from second player)
    if (GameLoop.get(gameId)) {
      // Disabled: spam during testing
      // console.log(`[battle/start] ⏩ GameLoop already running for ${gameId}, skipping start`);
      return res.json({ status: "battle_already_started" });
    }
    // Disabled: spam during testing
    // console.log(`[battle/start] ✅ No existing GameLoop, proceeding to start new one`);

    const playerIds = game.players as [string, string];
    // Disabled: spam during testing
    // console.log(`[battle/start] Starting battle for ${gameId}, players: ${playerIds.join(", ")}`);

    // Use the hands from game.state.players (finalized in draft)
    const player0Hand = (game.state.players[0]?.hand || []) as any[];
    const player1Hand = (game.state.players[1]?.hand || []) as any[];

    // Disabled: spam during testing
    // console.log(`[battle/start] Finalized hands: P0=${player0Hand.length} cards, P1=${player1Hand.length} cards`);

    // Create battle state with positions + use finalized hands
    const playerIds_arr = [playerIds[0], playerIds[1]] as [string, string];
    // Disabled: spam during testing
    // console.log(`[battle/start] 🔧 Initializing battle state...`);
    const battleState = initializeBattleState(game.tournament, playerIds_arr);
    // console.log(`[battle/start] ✅ Battle state initialized`);

    // Override hands — preserve instanceId but reset cooldowns for a fresh battle
    battleState.players[0].hand = player0Hand.map((c: any) => ({ ...c, cooldown: 0 }));
    battleState.players[1].hand = player1Hand.map((c: any) => ({ ...c, cooldown: 0 }));

    // Disabled: spam during testing
    // console.log(`[battle/start] Battle initialized for gameId ${gameId}`);

    // Award gold income
    for (const playerId of playerIds) {
      const eco = game.tournament.economy[playerId];
      const income = getIncomePerRound(eco.gold);
      eco.gold += income;
    }

    // Save to DB before starting loop
    game.state = battleState;
    game.markModified("state");
    game.markModified("tournament");
    await game.save();

    // Disabled: spam during testing
    // console.log(`[battle/start] Saved to DB, now starting GameLoop`);

    // ✅ START LOOP (only once)
    // Reduced to 2Hz to prevent event loop blocking on free VM
    // At 10Hz (100ms/tick), event loop can't process other requests (player 2 gets 503s)
    // At 2Hz (500ms/tick), gives event loop 400ms to handle other requests
    GameLoop.start(gameId, battleState, { tickRate: 30 });
    // Disabled: spam during testing
    // console.log(`[battle/start] ✅ GameLoop started for ${gameId}`);

    res.json({ status: "battle_started" });
  } catch (err: any) {
    // Disabled: spam during testing
    // console.error("[battle/start] ❌ ERROR:", err.message);
    console.error(err.stack);
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

    // Idempotent: if already transitioned away from BATTLE, return success without re-processing
    if (!game.state.gameOver && game.tournament.phase !== "BATTLE") {
      return res.json({
        status: game.tournament.phase === "GAME_OVER" ? "tournament_complete" : "next_draft_ready",
        tournamentWinner: game.tournament.winnerId,
        battleNumber:     game.tournament.battleNumber,
        gameHp:           game.tournament.gameHp,
      });
    }

    if (!game.state.gameOver) {
      // DB might not have flushed yet — fall back to the loop's in-memory state
      const memState = GameLoop.getInMemoryGameOver(gameId);
      if (memState?.gameOver) {
        // Sync it into the document so the rest of this handler works normally
        game.state.gameOver = true;
        game.state.winnerUserId = memState.winnerUserId;
        game.markModified("state");
      } else {
        return res.status(400).json({ error: "Battle not over yet" });
      }
    }

    // Capture previous state for diff broadcast
    const prevState      = structuredClone(game.state);
    const prevTournament = structuredClone(game.tournament);

    // Handle tournament battle completion (apply damage, advance to next battle/draft)
    const updatedTournament = completeTournamentBattle(game.state, game.tournament);
    game.tournament = updatedTournament;

    // ✅ STOP GAME LOOP
    GameLoop.stop(gameId);
    console.log(`[battle/complete] Stopped GameLoop for ${gameId}`);

    // If tournament is over, update game over flag
    if (game.tournament.phase === "GAME_OVER") {
      game.state.gameOver = true;
      game.state.winnerUserId = game.tournament.winnerId;
      // Keep players array for GameOverModal to access
    } else if (game.tournament.phase === "DRAFT") {
      // DRAFT DISABLED: skip draft phase and go directly to next battle
      game.tournament.phase = "BATTLE";
      // Clear selectedAbilities so the cheat window starts fresh each battle
      const [p0, p1] = game.players as [string, string];
      game.tournament.selectedAbilities[p0] = [];
      game.tournament.selectedAbilities[p1] = [];
      // Initialize fresh battle state with only common abilities
      game.state = initializeBattleState(game.tournament, [p0, p1]);
    }

    game.markModified("state");
    game.markModified("tournament");
    await game.save();

    // ✅ Broadcast phase change to BOTH players so neither needs to manually refresh
    const stateDiff      = diffState(prevState, game.state);
    const tournamentDiff = diffState(prevTournament, game.tournament);
    const allDiffs       = [...stateDiff, ...tournamentDiff];
    if (allDiffs.length > 0) {
      broadcastGameUpdate({
        gameId,
        version: game.state.version,
        diff:    allDiffs,
        timestamp: Date.now(),
      });
      console.log(`[battle/complete] Broadcast ${allDiffs.length} patches (phase → ${game.tournament.phase})`);
    }

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

/**
 * POST /cheat/add-ability - CHEAT: Add any ability directly to player's hand during battle
 * Used for testing when draft phase is disabled
 * Body: { gameId, cardId }
 */
router.post("/cheat/add-ability", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, cardId } = req.body;

    if (!cardId) return res.status(400).json({ error: "cardId required" });

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const cardDef = CARDS[cardId];
    if (!cardDef) return res.status(400).json({ error: `Card '${cardId}' not found` });
    if (cardDef.isCommon) return res.status(400).json({ error: "Common abilities are already in every hand" });

    const playerIndex = game.players.indexOf(userId);

    // Create new card instance
    const newInstance: CardInstance = {
      instanceId: randomUUID(),
      cardId,
      cooldown: 0,
    };

    // Track in tournament.selectedAbilities for persistence across battles
    game.tournament.selectedAbilities[userId].push(newInstance);

    // Add full merged card to live game state hand
    const fullCard = { ...cardDef, instanceId: newInstance.instanceId, cardId, cooldown: 0 };
    game.state.players[playerIndex] = {
      ...game.state.players[playerIndex],
      hand: [...(game.state.players[playerIndex].hand || []), fullCard],
    };

    game.markModified("tournament");
    game.markModified("state");
    game.markModified("state.players");
    await game.save();

    // Update live GameLoop in-memory state
    const gameLoop = GameLoop.get(gameId);
    if (gameLoop) {
      gameLoop.updateState(game.state);
    }

    // Broadcast hand update to all connected clients
    broadcastGameUpdate({
      gameId,
      version: game.state.version,
      diff: [{ path: `/players/${playerIndex}/hand`, value: game.state.players[playerIndex].hand }],
      timestamp: Date.now(),
    });

    res.json({ ok: true, hand: game.state.players[playerIndex].hand });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
