/**
 * Draft phase routes - shop, selection, refresh, finalization
 */

import express from "express";
import { randomUUID } from "crypto";
import GameSession from "../models/GameSession";
import { getUserIdFromCookie } from "./auth";
import { generateShop, REFRESH_COST } from "../services/economy/economyService";
import { getIncomePerRound } from "../services/economy/economyService";
import { initializeBattleState, generatePickups, generateArenaPickups } from "../services/battle/battleService";
import { completeTournamentBattle } from "../services/tournament/tournamentResultService";
import { GameLoop } from "../engine/loop/GameLoop";
import { ABILITIES } from "../abilities/abilities";
import { broadcastGameUpdate } from "../services/broadcast";
import { diffState } from "../services/flow/stateDiff";
import type { AbilityInstance } from "../engine/state/types";
import { resolveGameMap, toBattleMapConfig } from "../map/gameMapResolver";

const router = express.Router();

function isCommonAbilityCard(card: any): boolean {
  const abilityId = card?.abilityId ?? card?.id;
  const def = abilityId ? ABILITIES[abilityId] : undefined;
  if (def) return !!def.isCommon;
  return !!card?.isCommon;
}

function toSelectedInstancesFromHand(hand: any[]): AbilityInstance[] {
  return (hand ?? [])
    .filter((card: any) => !isCommonAbilityCard(card))
    .map((card: any) => {
      const abilityId = card?.abilityId ?? card?.id;
      return {
        instanceId: card?.instanceId ?? randomUUID(),
        abilityId,
        cooldown: 0,
      } as AbilityInstance;
    })
    .filter((card: AbilityInstance) => !!card.abilityId);
}

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
      shop: shop.abilities,
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
 * Body: { gameId, abilityInstanceId, destination: "selected" | "bench" }
 */
router.post("/draft/select", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityInstanceId, destination = "selected" } = req.body;

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

    // Find ability in shop
    const abilityIndex = shop.abilities.findIndex((c: any) => c.instanceId === abilityInstanceId);
    if (abilityIndex === -1) {
      return res.status(400).json({ error: "技能不在商店中" });
    }

    // Move ability from shop to destination
    const [ability] = shop.abilities.splice(abilityIndex, 1);
    if (destination === "selected") {
      selected.push(ability);
    } else {
      bench.push(ability);
    }

    // Remove locked status for this position
    shop.locked.splice(abilityIndex, 1);

    game.markModified("tournament");
    await game.save();

    res.json({
      selectedAbilities: selected,
      bench: bench,
      shop: shop.abilities,
      locked: shop.locked,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /draft/move - Move ability between selected and bench
 * Body: { gameId, abilityInstanceId, from: "selected" | "bench", to: "selected" | "bench" }
 */
router.post("/draft/move", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityInstanceId, from, to } = req.body;

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

    // Find and move ability
    const fromArray = from === "selected" ? selected : bench;
    const abilityIdx = fromArray.findIndex((c: AbilityInstance) => c.instanceId === abilityInstanceId);
    if (abilityIdx === -1) {
      return res.status(400).json({ error: "技能不存在" });
    }

    const [ability] = fromArray.splice(abilityIdx, 1);
    if (to === "selected") {
      selected.push(ability);
    } else {
      bench.push(ability);
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
 * POST /draft/sell - Sell a benched ability for gold
 * Body: { gameId, abilityInstanceId }
 */
router.post("/draft/sell", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityInstanceId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });

    const bench = game.tournament.bench[userId];
    const eco = game.tournament.economy[userId];

    // Find and remove ability from bench
    const abilityIdx = bench.findIndex((c: AbilityInstance) => c.instanceId === abilityInstanceId);
    if (abilityIdx === -1) {
      return res.status(400).json({ error: "技能不在备战区" });
    }

    const [ability] = bench.splice(abilityIdx, 1);
    
    // Get ability cost from preload data (default 3 if not found)
    const cardCost = 3; // You could look this up from ability definitions
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
      abilities: newCards,
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
 * POST /draft/lock - Toggle lock on a shop ability (prevents refresh removal)
 * Body: { gameId, abilityIndex }
 */
router.post("/draft/lock", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityIndex } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });

    const shop = game.tournament.shop[userId];

    if (abilityIndex < 0 || abilityIndex >= shop.locked.length) {
      return res.status(400).json({ error: "Invalid ability index" });
    }

    shop.locked[abilityIndex] = !shop.locked[abilityIndex];

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

    // Players can go to battle with any number of abilities (including 0)
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
        player0SelectedCards: player0Selected?.map((c: any) => c.abilityId) || [],
        player1SelectedCards: player1Selected?.map((c: any) => c.abilityId) || [],
      });

      // ✅ CRITICAL: Look up full Ability definitions from ABILITIES database
      // selectedAbilities has {abilityId, instanceId, cooldown} - we need {abilityId, instanceId, cooldown, ...cardDefinition}
      const player0Hand = player0Selected?.map((cardInstance: any) => {
        const abilityDef = ABILITIES[cardInstance.abilityId];
        if (!abilityDef) {
          console.error(`[draft/finalize] ❌ Ability definition not found: ${cardInstance.abilityId}`);
          return null;
        }
        // Merge ability definition with instance metadata (preserving cooldown, instanceId)
        return {
          ...abilityDef,
          instanceId: cardInstance.instanceId,
          cooldown: cardInstance.cooldown || 0,
        };
      }).filter((c: any) => c !== null) || [];

      const player1Hand = player1Selected?.map((cardInstance: any) => {
        const abilityDef = ABILITIES[cardInstance.abilityId];
        if (!abilityDef) {
          console.error(`[draft/finalize] ❌ Ability definition not found: ${cardInstance.abilityId}`);
          return null;
        }
        return {
          ...abilityDef,
          instanceId: cardInstance.instanceId,
          cooldown: cardInstance.cooldown || 0,
        };
      }).filter((c: any) => c !== null) || [];

      console.log("[draft/finalize] After loading Ability definitions:", {
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
      const isArenaMode = (game as any).mode === 'arena';
      const mapCX = isArenaMode ? 100 : 1000;
      const mapCY = isArenaMode ? 100 : 1000;
      const spawnOffset = isArenaMode ? 10 : 15;
      
      if (!game.state.players[0].position) {
        game.state.players[0].position = {
          x: mapCX - spawnOffset,
          y: mapCY,
        };
      }
      if (!game.state.players[1].position) {
        game.state.players[1].position = {
          x: mapCX + spawnOffset,
          y: mapCY,
        };
      }

      // Initialize velocity if not present
      if (!game.state.players[0].velocity) {
        game.state.players[0].velocity = { vx: 0, vy: 0 };
      }
      if (!game.state.players[1].velocity) {
        game.state.players[1].velocity = { vx: 0, vy: 0 };
      }

      // Initialize facing if not present
      if (!game.state.players[0].facing) {
        game.state.players[0].facing = { x: 1, y: 0 };
      }
      if (!game.state.players[1].facing) {
        game.state.players[1].facing = { x: -1, y: 0 };
      }

      game.state.players[0].moveSpeed = 0.1666667;
      game.state.players[1].moveSpeed = 0.1666667;

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
      console.log(`[draft/finalize] Player 0 hand: ${game.state.players[0].hand.length} abilities`);
      console.log(`[draft/finalize] Player 1 hand: ${game.state.players[1].hand.length} abilities`);
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

    const gameMode = ((game as any).mode ?? 'arena') as 'arena' | 'pubg';
    const resolvedMap = resolveGameMap(gameMode, (game as any).exportPackageName ?? null);
    const battleMapConfig = toBattleMapConfig(resolvedMap);

    // ✅ CHECK IF GAME LOOP ALREADY STARTED (prevent duplicate from second player)
    const existingLoop = GameLoop.get(gameId);
    if (existingLoop) {
      // The loop may have been started before the pickup system was added.
      // Retroactively inject pickups if the loop state is empty so claim/inspect work.
      const ls = existingLoop.getState();
      if (!ls.pickups || ls.pickups.length === 0) {
        const isArena = gameMode === 'arena';
        ls.pickups = isArena ? generateArenaPickups() : generatePickups(battleMapConfig);
        existingLoop.updateState(ls);
        await GameSession.findByIdAndUpdate(gameId, { "state.pickups": ls.pickups });
      }
      return res.json({ status: "battle_already_started" });
    }
    // Disabled: spam during testing
    // console.log(`[battle/start] ✅ No existing GameLoop, proceeding to start new one`);

    const playerIds = game.players as string[];

    // Use the hands from game.state.players (finalized in draft)
    // Map from userId to finalized hand so we handle N players correctly
    const handByUserId: Record<string, any[]> = {};
    for (const ps of (game.state.players || [])) {
      handByUserId[(ps as any).userId] = (ps as any).hand || [];
    }

    // Create battle state with positions + use finalized hands
    const battleState = initializeBattleState(game.tournament, playerIds, gameMode, battleMapConfig);

    // Override hands — preserve instanceId but reset cooldowns for a fresh battle
    for (const ps of battleState.players) {
      const saved = handByUserId[ps.userId];
      if (saved) ps.hand = saved.map((c: any) => ({ ...c, cooldown: 0 }));
    }

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
    // Keep simulation at 30Hz for lower CPU usage on the VM.
    GameLoop.start(gameId, battleState, {
      tickRate: 30,
      mode: gameMode,
      map: {
        width: resolvedMap.width,
        height: resolvedMap.height,
        objects: resolvedMap.objects,
      },
    });
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
      const allPlayers = game.players as string[];
      for (const pid of allPlayers) {
        game.tournament.selectedAbilities[pid] = [];
      }
      // Initialize fresh battle state with only common abilities
      const gameMode = ((game as any).mode ?? 'arena') as 'arena' | 'pubg';
      const resolvedMap = resolveGameMap(gameMode, (game as any).exportPackageName ?? null);
      game.state = initializeBattleState(
        game.tournament,
        allPlayers,
        gameMode,
        toBattleMapConfig(resolvedMap),
      );
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
 * Body: { gameId, abilityId }
 */
router.post("/cheat/add-ability", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityId } = req.body;

    if (!abilityId) return res.status(400).json({ error: "abilityId required" });

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const abilityDef = ABILITIES[abilityId];
    if (!abilityDef) return res.status(400).json({ error: `Ability '${abilityId}' not found` });
    if (abilityDef.isCommon) return res.status(400).json({ error: "Common abilities are already in every hand" });

    const playerIndex = game.players.indexOf(userId);

    // Create new ability instance
    const newInstance: AbilityInstance = {
      instanceId: randomUUID(),
      abilityId,
      cooldown: 0,
    };

    const fullCard = { ...abilityDef, instanceId: newInstance.instanceId, abilityId, cooldown: 0 };

    // Apply to live loop first so the UI updates immediately (no DB-save wait).
    let livePlayerIndex = playerIndex;
    let liveHand = [...(game.state.players[playerIndex].hand || []), fullCard];
    let liveVersion = game.state.version ?? 0;

    const gameLoop = GameLoop.get(gameId);
    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        liveHand = [...(loopState.players[loopPlayerIdx].hand || []), fullCard];
        loopState.players[loopPlayerIdx] = {
          ...loopState.players[loopPlayerIdx],
          hand: liveHand,
        };
        loopState.version = (loopState.version ?? 0) + 1;
        liveVersion = loopState.version;
        gameLoop.updateState(loopState);
      }
    }

    // Push diff now (fast path for cheat UX)
    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff: [{ path: `/players/${livePlayerIndex}/hand`, value: liveHand }],
      timestamp: Date.now(),
    });

    res.json({ ok: true, hand: liveHand });

    // Persist asynchronously; cheat panel responsiveness should not wait for Mongo round-trip.
    game.tournament.selectedAbilities[userId].push(newInstance);
    game.state.players[playerIndex] = {
      ...game.state.players[playerIndex],
      hand: liveHand,
    };

    game.markModified("tournament");
    game.markModified("state");
    game.markModified("state.players");

    void game.save().catch((err: any) => {
      console.error("[cheat/add-ability] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/reorder-ability - Reorder drafted ability slots during battle
 * Body: { gameId, instanceId, toIndex }
 */
router.post("/cheat/reorder-ability", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, instanceId, toIndex } = req.body;

    if (!instanceId) return res.status(400).json({ error: "instanceId required" });
    if (!Number.isFinite(toIndex)) return res.status(400).json({ error: "toIndex must be a number" });

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const dbPlayerIndex = game.players.indexOf(userId);
    let livePlayerIndex = dbPlayerIndex;
    let liveVersion = game.state.version ?? 0;
    let handSource = [...(game.state.players[dbPlayerIndex].hand ?? [])];

    const gameLoop = GameLoop.get(gameId);
    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        handSource = [...(loopState.players[loopPlayerIdx].hand ?? [])];
      }
    }

    const draftCards = handSource.filter((card: any) => !isCommonAbilityCard(card));
    const commonCards = handSource.filter((card: any) => isCommonAbilityCard(card));
    const fromIndex = draftCards.findIndex((card: any) => (card.instanceId ?? card.id) === instanceId);
    if (fromIndex === -1) {
      return res.status(404).json({ error: "Draft ability not found in hand" });
    }

    const clampedToIndex = Math.max(0, Math.min(draftCards.length - 1, Number(toIndex)));
    if (fromIndex !== clampedToIndex) {
      const [moved] = draftCards.splice(fromIndex, 1);
      draftCards.splice(clampedToIndex, 0, moved);
    }
    const reorderedHand = [...draftCards, ...commonCards];

    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        loopState.players[loopPlayerIdx] = {
          ...loopState.players[loopPlayerIdx],
          hand: reorderedHand,
        };
        loopState.version = (loopState.version ?? 0) + 1;
        liveVersion = loopState.version;
        gameLoop.updateState(loopState);
      }
    }

    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff: [{ path: `/players/${livePlayerIndex}/hand`, value: reorderedHand }],
      timestamp: Date.now(),
    });

    res.json({ ok: true, hand: reorderedHand });

    game.state.players[dbPlayerIndex] = {
      ...game.state.players[dbPlayerIndex],
      hand: reorderedHand,
    };
    game.tournament.selectedAbilities[userId] = toSelectedInstancesFromHand(reorderedHand);

    game.markModified("state");
    game.markModified("state.players");
    game.markModified("tournament");

    void game.save().catch((err: any) => {
      console.error("[cheat/reorder-ability] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/discard-ability - Remove a drafted ability from hand during battle
 * Body: { gameId, instanceId }
 */
router.post("/cheat/discard-ability", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, instanceId } = req.body;

    if (!instanceId) return res.status(400).json({ error: "instanceId required" });

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const dbPlayerIndex = game.players.indexOf(userId);
    let livePlayerIndex = dbPlayerIndex;
    let liveVersion = game.state.version ?? 0;
    let handSource = [...(game.state.players[dbPlayerIndex].hand ?? [])];

    const gameLoop = GameLoop.get(gameId);
    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        handSource = [...(loopState.players[loopPlayerIdx].hand ?? [])];
      }
    }

    const draftCards = handSource.filter((card: any) => !isCommonAbilityCard(card));
    const commonCards = handSource.filter((card: any) => isCommonAbilityCard(card));
    const draftIndex = draftCards.findIndex((card: any) => (card.instanceId ?? card.id) === instanceId);
    if (draftIndex === -1) {
      return res.status(404).json({ error: "Draft ability not found in hand" });
    }

    draftCards.splice(draftIndex, 1);
    const updatedHand = [...draftCards, ...commonCards];

    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        loopState.players[loopPlayerIdx] = {
          ...loopState.players[loopPlayerIdx],
          hand: updatedHand,
        };
        loopState.version = (loopState.version ?? 0) + 1;
        liveVersion = loopState.version;
        gameLoop.updateState(loopState);
      }
    }

    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff: [{ path: `/players/${livePlayerIndex}/hand`, value: updatedHand }],
      timestamp: Date.now(),
    });

    res.json({ ok: true, hand: updatedHand });

    game.state.players[dbPlayerIndex] = {
      ...game.state.players[dbPlayerIndex],
      hand: updatedHand,
    };
    game.tournament.selectedAbilities[userId] = toSelectedInstancesFromHand(updatedHand);

    game.markModified("state");
    game.markModified("state.players");
    game.markModified("tournament");

    void game.save().catch((err: any) => {
      console.error("[cheat/discard-ability] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/discard-all - Remove all drafted abilities from hand during battle
 * Body: { gameId }
 */
router.post("/cheat/discard-all", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const dbPlayerIndex = game.players.indexOf(userId);
    let livePlayerIndex = dbPlayerIndex;
    let liveVersion = game.state.version ?? 0;
    let handSource = [...(game.state.players[dbPlayerIndex].hand ?? [])];

    const gameLoop = GameLoop.get(gameId);
    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        handSource = [...(loopState.players[loopPlayerIdx].hand ?? [])];
      }
    }

    const commonCards = handSource.filter((card: any) => isCommonAbilityCard(card));
    const updatedHand = [...commonCards];

    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        loopState.players[loopPlayerIdx] = {
          ...loopState.players[loopPlayerIdx],
          hand: updatedHand,
        };
        loopState.version = (loopState.version ?? 0) + 1;
        liveVersion = loopState.version;
        gameLoop.updateState(loopState);
      }
    }

    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff: [{ path: `/players/${livePlayerIndex}/hand`, value: updatedHand }],
      timestamp: Date.now(),
    });

    res.json({ ok: true, hand: updatedHand });

    game.state.players[dbPlayerIndex] = {
      ...game.state.players[dbPlayerIndex],
      hand: updatedHand,
    };
    game.tournament.selectedAbilities[userId] = [];

    game.markModified("state");
    game.markModified("state.players");
    game.markModified("tournament");

    void game.save().catch((err: any) => {
      console.error("[cheat/discard-all] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/full-heal - Restore both players to full HP (and clear shields)
 * Body: { gameId }
 */
router.post("/cheat/full-heal", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    let liveVersion = game.state.version ?? 0;
    let diff: Array<{ path: string; value: any }> = [];
    const gameLoop = GameLoop.get(gameId);

    if (gameLoop) {
      const loopState = gameLoop.getState();
      loopState.players = loopState.players.map((p: any, idx: number) => {
        const maxHp = Math.max(1, Number(p.maxHp ?? p.hp ?? 100));
        diff.push({ path: `/players/${idx}/hp`, value: maxHp });
        diff.push({ path: `/players/${idx}/shield`, value: 0 });
        return {
          ...p,
          hp: maxHp,
          shield: 0,
        };
      });
      loopState.gameOver = false;
      delete (loopState as any).winnerUserId;
      diff.push({ path: "/gameOver", value: false });
      diff.push({ path: "/winnerUserId", value: undefined });
      loopState.version = (loopState.version ?? 0) + 1;
      liveVersion = loopState.version;
      gameLoop.updateState(loopState);
    } else {
      game.state.players = game.state.players.map((p: any, idx: number) => {
        const maxHp = Math.max(1, Number(p.maxHp ?? p.hp ?? 100));
        diff.push({ path: `/players/${idx}/hp`, value: maxHp });
        diff.push({ path: `/players/${idx}/shield`, value: 0 });
        return {
          ...p,
          hp: maxHp,
          shield: 0,
        };
      });
      game.state.gameOver = false;
      delete (game.state as any).winnerUserId;
      diff.push({ path: "/gameOver", value: false });
      diff.push({ path: "/winnerUserId", value: undefined });
      game.state.version = (game.state.version ?? 0) + 1;
      liveVersion = game.state.version;
    }

    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff,
      timestamp: Date.now(),
    });

    res.json({ ok: true });

    game.state.players = game.state.players.map((p: any) => {
      const maxHp = Math.max(1, Number(p.maxHp ?? p.hp ?? 100));
      return {
        ...p,
        hp: maxHp,
        shield: 0,
      };
    });
    game.state.gameOver = false;
    delete (game.state as any).winnerUserId;

    game.markModified("state");
    game.markModified("state.players");

    void game.save().catch((err: any) => {
      console.error("[cheat/full-heal] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/reset-cooldowns - Set both players' hand cooldowns/charges to ready
 * Body: { gameId }
 */
router.post("/cheat/reset-cooldowns", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const resetHand = (hand: any[]) =>
      (hand ?? []).map((card: any) => {
        const abilityId = card?.abilityId ?? card?.id;
        const def = abilityId ? ABILITIES[abilityId] : undefined;
        const maxCharges = Math.max(0, Number((def as any)?.maxCharges ?? card?.maxCharges ?? 0));
        const nextCard: any = {
          ...card,
          cooldown: 0,
          chargeLockTicks: 0,
          chargeRegenTicksRemaining: 0,
        };
        if (maxCharges > 1) {
          nextCard.chargeCount = maxCharges;
        }
        return nextCard;
      });

    let liveVersion = game.state.version ?? 0;
    let diff: Array<{ path: string; value: any }> = [];
    const gameLoop = GameLoop.get(gameId);

    if (gameLoop) {
      const loopState = gameLoop.getState();
      loopState.players = loopState.players.map((p: any, idx: number) => {
        const hand = resetHand(p.hand ?? []);
        diff.push({ path: `/players/${idx}/hand`, value: hand });
        return {
          ...p,
          hand,
        };
      });
      loopState.version = (loopState.version ?? 0) + 1;
      liveVersion = loopState.version;
      gameLoop.updateState(loopState);
    } else {
      game.state.players = game.state.players.map((p: any, idx: number) => {
        const hand = resetHand(p.hand ?? []);
        diff.push({ path: `/players/${idx}/hand`, value: hand });
        return {
          ...p,
          hand,
        };
      });
      game.state.version = (game.state.version ?? 0) + 1;
      liveVersion = game.state.version;
    }

    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff,
      timestamp: Date.now(),
    });

    res.json({ ok: true });

    game.state.players = game.state.players.map((p: any) => ({
      ...p,
      hand: resetHand(p.hand ?? []),
    }));

    game.markModified("state");
    game.markModified("state.players");

    void game.save().catch((err: any) => {
      console.error("[cheat/reset-cooldowns] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/clear-buffs - Clear buffs/channels on both players
 * Body: { gameId }
 */
router.post("/cheat/clear-buffs", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    let liveVersion = game.state.version ?? 0;
    let diff: Array<{ path: string; value: any }> = [];
    const gameLoop = GameLoop.get(gameId);

    if (gameLoop) {
      const loopState = gameLoop.getState();
      loopState.players = loopState.players.map((p: any, idx: number) => {
        diff.push({ path: `/players/${idx}/buffs`, value: [] });
        diff.push({ path: `/players/${idx}/activeChannel`, value: undefined });
        return {
          ...p,
          buffs: [],
          activeChannel: undefined,
        };
      });
      loopState.version = (loopState.version ?? 0) + 1;
      liveVersion = loopState.version;
      gameLoop.updateState(loopState);
    } else {
      game.state.players = game.state.players.map((p: any, idx: number) => {
        diff.push({ path: `/players/${idx}/buffs`, value: [] });
        diff.push({ path: `/players/${idx}/activeChannel`, value: undefined });
        return {
          ...p,
          buffs: [],
          activeChannel: undefined,
        };
      });
      game.state.version = (game.state.version ?? 0) + 1;
      liveVersion = game.state.version;
    }

    broadcastGameUpdate({
      gameId,
      version: liveVersion,
      diff,
      timestamp: Date.now(),
    });

    res.json({ ok: true });

    game.state.players = game.state.players.map((p: any) => ({
      ...p,
      buffs: [],
      activeChannel: undefined,
    }));

    game.markModified("state");
    game.markModified("state.players");

    void game.save().catch((err: any) => {
      console.error("[cheat/clear-buffs] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
