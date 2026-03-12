/**
 * Tournament service - manages tournament state, draft phases, economy, and battle progression
 */

import { TournamentState, STARTING_GAME_HP, STARTING_GOLD, LOSER_DAMAGE_BY_BATTLE } from "../../engine/state/types";
import { PlayerID } from "../../engine/state/types/common";
import { generateShop } from "./economyService";

/**
 * Initialize tournament state for a new match
 * Called when game starts
 */
export function initializeTournament(playerIds: [PlayerID, PlayerID]): TournamentState {
  const tournament: TournamentState = {
    battleNumber: 1,
    gameHp: {
      [playerIds[0]]: STARTING_GAME_HP,
      [playerIds[1]]: STARTING_GAME_HP,
    },
    economy: {
      [playerIds[0]]: {
        gold: STARTING_GOLD,
        level: 1,
        experience: 0,
      },
      [playerIds[1]]: {
        gold: STARTING_GOLD,
        level: 1,
        experience: 0,
      },
    },
    selectedAbilities: {
      [playerIds[0]]: [],
      [playerIds[1]]: [],
    },
    bench: {
      [playerIds[0]]: [],
      [playerIds[1]]: [],
    },
    battleHistory: [],
    shop: {
      [playerIds[0]]: {
        cards: generateShop(1),
        locked: [false, false, false, false, false],
      },
      [playerIds[1]]: {
        cards: generateShop(1),
        locked: [false, false, false, false, false],
      },
    },
    phase: "DRAFT",
  };
  
  console.log("[initializeTournament] Created tournament:", {
    phase: tournament.phase,
    battleNumber: tournament.battleNumber,
    player0Hp: tournament.gameHp[playerIds[0]],
    player1Hp: tournament.gameHp[playerIds[1]],
  });
  
  return tournament;
}

/**
 * Get damage dealt to loser of a battle
 */
export function getLoserDamage(battleNumber: number): number {
  return LOSER_DAMAGE_BY_BATTLE[battleNumber] ?? 30;
}

/**
 * Complete a battle and update tournament state
 * - Award damage to loser
 * - Advance to next battle or end game
 * - Update economy (gold income)
 */
export function completeBattle(
  tournament: TournamentState,
  winnerId: PlayerID,
  loserId: PlayerID
): TournamentState {
  // Record battle result
  const damage = getLoserDamage(tournament.battleNumber);
  tournament.gameHp[loserId] -= damage;

  tournament.battleHistory.push({
    battleNumber: tournament.battleNumber,
    winnerId,
    damageDealt: damage,
  });

  // Check if game is over (someone reached 0 HP)
  if (tournament.gameHp[loserId] <= 0) {
    tournament.phase = "GAME_OVER";
    tournament.winnerId = winnerId;
    return tournament;
  }

  // Move to next battle
  tournament.battleNumber += 1;

  if (tournament.battleNumber > 8) {
    // After 8 battles, determine winner by HP
    const player0 = Object.keys(tournament.gameHp)[0] as PlayerID;
    const player1 = Object.keys(tournament.gameHp)[1] as PlayerID;
    
    tournament.phase = "GAME_OVER";
    tournament.winnerId =
      tournament.gameHp[player0] > tournament.gameHp[player1] ? player0 : player1;
    return tournament;
  }

  // Regenerate shops for next draft
  // NOTE: selectedAbilities, bench, and gold persist across battles
  tournament.phase = "DRAFT";
  const playerIds = Object.keys(tournament.gameHp) as PlayerID[];
  
  console.log("[completeBattle] Transitioning to next draft:");
  console.log("  Battle completed:", tournament.battleNumber);
  console.log("  Game HP:", tournament.gameHp);
  
  for (const playerId of playerIds) {
    const eco = tournament.economy[playerId];
    const selectedCount = tournament.selectedAbilities[playerId]?.length || 0;
    const benchCount = tournament.bench[playerId]?.length || 0;
    console.log(`  Player ${playerId}: Selected=${selectedCount}, Bench=${benchCount}, Gold=${eco.gold}`);
    
    tournament.shop[playerId] = {
      cards: generateShop(eco.level),
      locked: [false, false, false, false, false, false],
    };
  }
  
  console.log("[completeBattle] Next draft ready with persisted selectedAbilities and bench");

  return tournament;
}

/**
 * Add gold income to player (called after battle)
 */
export function awardGoldIncome(
  tournament: TournamentState,
  playerId: PlayerID,
  baseIncome: number
): void {
  const eco = tournament.economy[playerId];
  if (eco) {
    eco.gold += baseIncome;
  }
}
