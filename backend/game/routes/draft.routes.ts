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
import { createStartingConsumableCounts } from "../services/gameplay/consumableService";
import { completeTournamentBattle } from "../services/tournament/tournamentResultService";
import { GameLoop } from "../engine/loop/GameLoop";
import { ABILITIES } from "../abilities/abilities";
import { broadcastGameUpdate } from "../services/broadcast";
import { diffState } from "../services/flow/stateDiff";
import { EXPORTED_MAP_HEIGHT, EXPORTED_MAP_WIDTH } from "../map/exportedMap";
import { isExportedMapMode, isYumen1v1BasicMode, normalizeGameMode } from "../modes";
import type { AbilityInstance } from "../engine/state/types";
import {
  NEW_WORLD_UNIT_SCALE,
  STARTING_ATTACK_DAMAGE,
  STARTING_BATTLE_HP,
  STARTING_CRIT_CHANCE_PCT,
  STARTING_DEFENSE_PCT,
  STARTING_HUAJIN_PCT,
} from "../engine/state/types";
import {
  YUMEN_SAFE_ZONE_TOTAL_CIRCLES,
  getYumenSafeZoneCircleNumber,
  getYumenSafeZoneDps,
  getYumenSafeZoneInitialWaitMs,
  normalizeYumenSafeZoneDamageMode,
  normalizeYumenSafeZoneTimelineMode,
  type YumenSafeZoneDamageMode,
  type YumenSafeZoneTimelineMode,
} from "../engine/utils/yumenSafeZone";

const router = express.Router();

function getPurpleCombatStats(maxHp = STARTING_BATTLE_HP) {
  const safeMaxHp = Math.max(1, Math.floor(Number(maxHp) || STARTING_BATTLE_HP));
  return {
    hp: safeMaxHp,
    maxHp: safeMaxHp,
    attackDamage: STARTING_ATTACK_DAMAGE,
    waiGongCritChancePct: STARTING_CRIT_CHANCE_PCT,
    neiGongCritChancePct: STARTING_CRIT_CHANCE_PCT,
    critChancePct: STARTING_CRIT_CHANCE_PCT,
    defensePct: STARTING_DEFENSE_PCT,
    huajinPct: STARTING_HUAJIN_PCT,
  };
}

function hasPurpleBattleStats(player: any) {
  return (
    Number(player?.maxHp ?? 0) === STARTING_BATTLE_HP &&
    Number(player?.attackDamage ?? 0) === STARTING_ATTACK_DAMAGE &&
    Number(player?.waiGongCritChancePct ?? player?.critChancePct ?? 0) === STARTING_CRIT_CHANCE_PCT &&
    Number(player?.neiGongCritChancePct ?? player?.critChancePct ?? 0) === STARTING_CRIT_CHANCE_PCT &&
    Number(player?.defensePct ?? 0) === STARTING_DEFENSE_PCT &&
    Number(player?.huajinPct ?? 0) === STARTING_HUAJIN_PCT
  );
}

function shouldReinitializeExistingBattleLoop(state: any) {
  const players = Array.isArray(state?.players) ? state.players : [];
  if (state?.gameOver || players.length === 0 || players.every(hasPurpleBattleStats)) return false;
  const hasActivity =
    (state?.events?.length ?? 0) > 0 ||
    players.some((player: any) =>
      (player.buffs?.length ?? 0) > 0 ||
      (player.shield ?? 0) > 0 ||
      !!player.activeChannel ||
      !!player.activeDash ||
      (player.hand ?? []).some((card: any) => Number(card?.cooldown ?? 0) > 0)
    );
  return !hasActivity;
}

function isCommonAbilityCard(card: any): boolean {
  const abilityId = card?.abilityId ?? card?.id;
  const def = abilityId ? ABILITIES[abilityId] : undefined;
  if (def) return !!def.isCommon;
  return !!card?.isCommon;
}

function getDraftCardAbilityId(card: any): string | null {
  const abilityId = card?.abilityId ?? card?.id;
  return typeof abilityId === "string" && abilityId.trim() ? abilityId.trim() : null;
}

function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(min, Math.min(max, numericValue));
}

function getYumenFullSafeZoneRadius() {
  return Math.hypot(EXPORTED_MAP_WIDTH / 2, EXPORTED_MAP_HEIGHT / 2);
}

function getYumenStagedSafeZoneDps(zone: any) {
  return getYumenSafeZoneDps(zone);
}

function createYumenSafeZone(state: any) {
  const fullHalf = getYumenFullSafeZoneRadius();
  const existing = state?.safeZone ?? {};
  const existingHalf = existing.shape === "circle" ? existing.currentHalf : fullHalf;
  const allowedPhases = new Set(["idle", "waiting", "countdown", "shrinking", "complete"]);
  const phase = allowedPhases.has(existing.phase) ? existing.phase : "idle";
  const currentHalf = clampFiniteNumber(existingHalf, fullHalf, 0, fullHalf);
  const currentDiameter = currentHalf * 2;
  const inferredStageIndex = currentDiameter <= 25 ? 4 : currentDiameter <= 50 ? 3 : currentDiameter <= 100 ? 2 : currentDiameter <= 200 ? 1 : 0;
  const zone: any = {
    shape: "circle",
    centerX: clampFiniteNumber(existing.centerX, EXPORTED_MAP_WIDTH / 2, 0, EXPORTED_MAP_WIDTH),
    centerY: clampFiniteNumber(existing.centerY, EXPORTED_MAP_HEIGHT / 2, 0, EXPORTED_MAP_HEIGHT),
    currentHalf,
    currentDiameter,
    dps: Math.max(0, clampFiniteNumber(existing.dps, 0, 0, 999)),
    shrinking: existing.shrinking === true && phase === "shrinking",
    shrinkProgress: clampFiniteNumber(existing.shrinkProgress, 0, 0, 1),
    nextChangeIn: Math.max(0, Math.round(clampFiniteNumber(existing.nextChangeIn, 0, 0, 9999))),
    phase,
    circleNumber: Math.max(3, Math.floor(clampFiniteNumber(existing.circleNumber, 3, 3, YUMEN_SAFE_ZONE_TOTAL_CIRCLES))),
    totalCircles: YUMEN_SAFE_ZONE_TOTAL_CIRCLES,
    fullPoison: existing.fullPoison === true || phase === "complete" || currentHalf <= 0,
    timelineMode: normalizeYumenSafeZoneTimelineMode(existing.timelineMode),
    damageMode: normalizeYumenSafeZoneDamageMode(existing.damageMode),
    stageIndex: Math.max(0, Math.floor(clampFiniteNumber(existing.stageIndex, inferredStageIndex, 0, 99))),
    targetVisible: existing.targetVisible === true,
    paused: existing.paused === true && (phase === "waiting" || phase === "countdown" || phase === "shrinking"),
  };
  for (const key of ["targetStageIndex", "phaseStartedAt", "phaseEndsAt", "targetDiameter", "targetHalf", "targetCenterX", "targetCenterY", "shrinkStartHalf", "shrinkStartCenterX", "shrinkStartCenterY", "pausedAt", "pausedRemainingMs"]) {
    if (Number.isFinite(Number(existing[key]))) zone[key] = Number(existing[key]);
  }
  if (zone.paused) {
    const remainingMs = Math.max(0, Number(zone.pausedRemainingMs ?? (Number(zone.phaseEndsAt ?? Date.now()) - Date.now())));
    zone.pausedRemainingMs = remainingMs;
    zone.nextChangeIn = remainingMs / 1000;
  } else {
    delete zone.pausedAt;
    delete zone.pausedRemainingMs;
  }
  if (zone.phase !== "waiting" && zone.phase !== "countdown" && zone.phase !== "shrinking") {
    zone.nextChangeIn = 0;
    zone.targetVisible = false;
    zone.shrinking = false;
    zone.shrinkProgress = 0;
    zone.paused = false;
    delete zone.pausedAt;
    delete zone.pausedRemainingMs;
  }
  zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
  zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
  zone.fullPoison = zone.phase === "complete" || zone.currentHalf <= 0;
  zone.dps = getYumenStagedSafeZoneDps(zone);
  return zone;
}

function resetYumenSafeZone(now: number) {
  const fullHalf = getYumenFullSafeZoneRadius();
  return {
    shape: "circle",
    centerX: EXPORTED_MAP_WIDTH / 2,
    centerY: EXPORTED_MAP_HEIGHT / 2,
    currentHalf: fullHalf,
    currentDiameter: fullHalf * 2,
    dps: 0,
    shrinking: false,
    shrinkProgress: 0,
    nextChangeIn: 0,
    phase: "idle",
    timelineMode: "fast",
    damageMode: "test",
    stageIndex: 0,
    circleNumber: 3,
    totalCircles: YUMEN_SAFE_ZONE_TOTAL_CIRCLES,
    fullPoison: false,
    phaseStartedAt: now,
    phaseEndsAt: now,
    targetVisible: false,
    paused: false,
  };
}

function startYumenSafeZone(state: any, now: number, options?: { timelineMode?: YumenSafeZoneTimelineMode; damageMode?: YumenSafeZoneDamageMode }) {
  const zone = createYumenSafeZone(state);
  if (zone.phase === "complete" || zone.currentHalf <= 0) {
    Object.assign(zone, resetYumenSafeZone(now));
  }
  zone.timelineMode = normalizeYumenSafeZoneTimelineMode(options?.timelineMode ?? zone.timelineMode);
  zone.damageMode = normalizeYumenSafeZoneDamageMode(options?.damageMode ?? zone.damageMode);
  zone.phase = "waiting";
  zone.phaseStartedAt = now;
  const initialWaitMs = getYumenSafeZoneInitialWaitMs(zone.timelineMode);
  zone.phaseEndsAt = now + initialWaitMs;
  zone.nextChangeIn = initialWaitMs / 1000;
  zone.shrinking = false;
  zone.shrinkProgress = 0;
  zone.targetVisible = false;
  zone.paused = false;
  delete zone.pausedAt;
  delete zone.pausedRemainingMs;
  zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
  zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
  zone.fullPoison = false;
  delete zone.targetStageIndex;
  delete zone.targetDiameter;
  delete zone.targetHalf;
  delete zone.targetCenterX;
  delete zone.targetCenterY;
  delete zone.shrinkStartHalf;
  delete zone.shrinkStartCenterX;
  delete zone.shrinkStartCenterY;
  zone.dps = getYumenStagedSafeZoneDps(zone);
  return zone;
}

function setYumenSafeZoneDamageMode(state: any, damageMode: YumenSafeZoneDamageMode) {
  const zone = createYumenSafeZone(state);
  zone.damageMode = normalizeYumenSafeZoneDamageMode(damageMode);
  zone.dps = getYumenStagedSafeZoneDps(zone);
  return zone;
}

function stopYumenSafeZone(state: any, now: number) {
  const zone = createYumenSafeZone(state);
  zone.phase = "idle";
  zone.phaseStartedAt = now;
  zone.phaseEndsAt = now;
  zone.nextChangeIn = 0;
  zone.shrinking = false;
  zone.shrinkProgress = 0;
  zone.targetVisible = false;
  zone.paused = false;
  delete zone.pausedAt;
  delete zone.pausedRemainingMs;
  zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
  zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
  zone.fullPoison = zone.currentHalf <= 0;
  delete zone.targetStageIndex;
  delete zone.targetDiameter;
  delete zone.targetHalf;
  delete zone.targetCenterX;
  delete zone.targetCenterY;
  delete zone.shrinkStartHalf;
  delete zone.shrinkStartCenterX;
  delete zone.shrinkStartCenterY;
  zone.dps = getYumenStagedSafeZoneDps(zone);
  return zone;
}

function pauseYumenSafeZone(state: any, now: number) {
  const zone = createYumenSafeZone(state);
  const phaseActive = zone.phase === "waiting" || zone.phase === "countdown" || zone.phase === "shrinking";
  if (!phaseActive) return zone;
  const remainingMs = Math.max(0, Number(zone.phaseEndsAt ?? now) - now);
  const elapsedMs = Math.max(0, Number(zone.phaseEndsAt ?? now) - Number(zone.phaseStartedAt ?? now) - remainingMs);
  zone.paused = true;
  zone.pausedAt = now;
  zone.pausedRemainingMs = remainingMs;
  zone.phaseStartedAt = now - elapsedMs;
  zone.phaseEndsAt = now + remainingMs;
  zone.nextChangeIn = remainingMs / 1000;
  zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
  zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
  zone.fullPoison = zone.currentHalf <= 0;
  zone.dps = getYumenStagedSafeZoneDps(zone);
  return zone;
}

function resumeYumenSafeZone(state: any, now: number) {
  const zone = createYumenSafeZone(state);
  const phaseActive = zone.phase === "waiting" || zone.phase === "countdown" || zone.phase === "shrinking";
  if (!phaseActive || zone.paused !== true) return zone;
  const remainingMs = Math.max(0, Number(zone.pausedRemainingMs ?? (Number(zone.phaseEndsAt ?? now) - now)));
  const elapsedMs = Math.max(0, Number(zone.phaseEndsAt ?? now) - Number(zone.phaseStartedAt ?? now) - remainingMs);
  zone.paused = false;
  delete zone.pausedAt;
  delete zone.pausedRemainingMs;
  zone.phaseStartedAt = now - elapsedMs;
  zone.phaseEndsAt = now + remainingMs;
  zone.nextChangeIn = remainingMs / 1000;
  zone.circleNumber = getYumenSafeZoneCircleNumber(zone);
  zone.totalCircles = YUMEN_SAFE_ZONE_TOTAL_CIRCLES;
  zone.fullPoison = zone.currentHalf <= 0;
  zone.dps = getYumenStagedSafeZoneDps(zone);
  return zone;
}

function normalizeYumenPlayArea(input: any) {
  const minSize = 12;
  const rawMinX = clampFiniteNumber(input?.minX, 0, 0, EXPORTED_MAP_WIDTH);
  const rawMaxX = clampFiniteNumber(input?.maxX, EXPORTED_MAP_WIDTH, 0, EXPORTED_MAP_WIDTH);
  const rawMinY = clampFiniteNumber(input?.minY, 0, 0, EXPORTED_MAP_HEIGHT);
  const rawMaxY = clampFiniteNumber(input?.maxY, EXPORTED_MAP_HEIGHT, 0, EXPORTED_MAP_HEIGHT);
  let minX = Math.min(rawMinX, rawMaxX);
  let maxX = Math.max(rawMinX, rawMaxX);
  let minY = Math.min(rawMinY, rawMaxY);
  let maxY = Math.max(rawMinY, rawMaxY);

  if (maxX - minX < minSize) {
    const centerX = (minX + maxX) / 2;
    minX = clampFiniteNumber(centerX - minSize / 2, 0, 0, EXPORTED_MAP_WIDTH - minSize);
    maxX = minX + minSize;
  }
  if (maxY - minY < minSize) {
    const centerY = (minY + maxY) / 2;
    minY = clampFiniteNumber(centerY - minSize / 2, 0, 0, EXPORTED_MAP_HEIGHT - minSize);
    maxY = minY + minSize;
  }

  return { minX, minY, maxX, maxY };
}

function applyYumenStateUpdate(gameId: string, game: any, updater: (state: any) => Array<{ path: string; value: any }>) {
  let liveVersion = game.state.version ?? 0;
  const gameLoop = GameLoop.get(gameId);
  const targetState = gameLoop ? gameLoop.getState() : game.state;
  const diff = updater(targetState);
  targetState.version = (targetState.version ?? 0) + 1;
  liveVersion = targetState.version;
  if (gameLoop) {
    gameLoop.updateState(targetState);
  }
  broadcastGameUpdate({ gameId, version: liveVersion, diff, timestamp: Date.now() });
  game.state = targetState;
  game.markModified("state");
  void game.save().catch((err: any) => {
    console.error("[cheat/yumen-state] async save failed:", err?.message ?? err);
  });
  return { liveVersion, diff };
}

function dedupeDraftCardsByAbility<T extends Record<string, any>>(cards: T[]): T[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const abilityId = getDraftCardAbilityId(card);
    if (!abilityId) return true;
    if (seen.has(abilityId)) return false;
    seen.add(abilityId);
    return true;
  });
}

function toSelectedInstancesFromHand(hand: any[]): AbilityInstance[] {
  return normalizeDraftCardSlots((hand ?? []).filter((card: any) => !isCommonAbilityCard(card)))
    .map((card: any, fallbackIndex: number) => {
      const abilityId = card?.abilityId ?? card?.id;
      return {
        instanceId: card?.instanceId ?? randomUUID(),
        abilityId,
        cooldown: 0,
        slotIndex: normalizeDraftSlotIndex(card?.slotIndex, fallbackIndex),
      } as AbilityInstance;
    })
    .filter((card: AbilityInstance) => !!card.abilityId);
}

const DRAFT_ABILITY_SLOT_COUNT = 6;
const DRAFT_ABILITY_LIMIT_ERROR = "只能拾取6个技能";

function normalizeDraftSlotIndex(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(DRAFT_ABILITY_SLOT_COUNT - 1, fallback));
  return Math.max(0, Math.min(DRAFT_ABILITY_SLOT_COUNT - 1, Math.round(numeric)));
}

function normalizeDraftCardSlots<T extends Record<string, any>>(cards: T[]): T[] {
  const assigned: Array<T | undefined> = Array.from({ length: DRAFT_ABILITY_SLOT_COUNT });
  const pending: T[] = [];

  dedupeDraftCardsByAbility(cards).forEach((card, fallbackIndex) => {
    const hasExplicitSlot = card?.slotIndex !== undefined && Number.isFinite(Number(card.slotIndex));
    const slotIndex = normalizeDraftSlotIndex(card?.slotIndex, fallbackIndex);
    if (hasExplicitSlot && !assigned[slotIndex]) {
      assigned[slotIndex] = { ...card, slotIndex };
      return;
    }
    pending.push(card);
  });

  pending.forEach((card) => {
    const openIndex = assigned.findIndex((slot) => !slot);
    if (openIndex >= 0) {
      assigned[openIndex] = { ...card, slotIndex: openIndex };
    }
  });

  return assigned.filter(Boolean) as T[];
}

function getFirstAvailableDraftSlot(cards: Array<Record<string, any>>): number | null {
  const normalized = normalizeDraftCardSlots(cards);
  if (normalized.length >= DRAFT_ABILITY_SLOT_COUNT) return null;
  const occupied = new Set(normalized.map((card) => normalizeDraftSlotIndex(card.slotIndex, 0)));
  for (let slotIndex = 0; slotIndex < DRAFT_ABILITY_SLOT_COUNT; slotIndex += 1) {
    if (!occupied.has(slotIndex)) return slotIndex;
  }
  return null;
}

function insertDraftCardAtSlot<T extends Record<string, any>>(cards: T[], card: T, preferredSlotIndex?: number | null): T[] | null {
  const normalizedCards = normalizeDraftCardSlots(cards);

  const cardAbilityId = getDraftCardAbilityId(card);
  const existingIndex = cardAbilityId
    ? normalizedCards.findIndex((existing) => getDraftCardAbilityId(existing) === cardAbilityId)
    : -1;
  if (existingIndex >= 0) {
    const nextCards = normalizedCards.map((existing, fallbackIndex) => ({
      ...existing,
      slotIndex: normalizeDraftSlotIndex(existing.slotIndex, fallbackIndex),
    }));
    const existingCard = nextCards[existingIndex];
    const fromSlotIndex = normalizeDraftSlotIndex(existingCard.slotIndex, existingIndex);
    const targetSlotIndex = preferredSlotIndex === null || preferredSlotIndex === undefined
      ? fromSlotIndex
      : normalizeDraftSlotIndex(preferredSlotIndex, fromSlotIndex);
    const occupiedIndex = nextCards.findIndex((existing, index) => index !== existingIndex && normalizeDraftSlotIndex(existing.slotIndex, 0) === targetSlotIndex);
    nextCards[existingIndex] = {
      ...existingCard,
      slotIndex: targetSlotIndex,
    };
    if (occupiedIndex >= 0) {
      nextCards[occupiedIndex] = {
        ...nextCards[occupiedIndex],
        slotIndex: fromSlotIndex,
      };
    }
    return normalizeDraftCardSlots(nextCards);
  }

  const firstOpenSlot = getFirstAvailableDraftSlot(normalizedCards);
  if (firstOpenSlot === null) return null;

  const targetSlotIndex = preferredSlotIndex === null || preferredSlotIndex === undefined
    ? firstOpenSlot
    : normalizeDraftSlotIndex(preferredSlotIndex, firstOpenSlot);
  const nextCards = normalizedCards.map((existing, fallbackIndex) => ({
    ...existing,
    slotIndex: normalizeDraftSlotIndex(existing.slotIndex, fallbackIndex),
  }));
  const occupiedIndex = nextCards.findIndex((existing) => normalizeDraftSlotIndex(existing.slotIndex, 0) === targetSlotIndex);
  if (occupiedIndex >= 0) {
    nextCards[occupiedIndex] = {
      ...nextCards[occupiedIndex],
      slotIndex: firstOpenSlot,
    };
  }
  nextCards.push({ ...card, slotIndex: targetSlotIndex });
  return normalizeDraftCardSlots(nextCards);
}

function splitDraftAndCommonCards(hand: any[]): { draftCards: any[]; commonCards: any[] } {
  const draftCards = (hand ?? []).filter((card: any) => !isCommonAbilityCard(card));
  const commonCards = (hand ?? []).filter((card: any) => isCommonAbilityCard(card));
  return { draftCards: normalizeDraftCardSlots(draftCards), commonCards };
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
    if (destination === "selected" && getFirstAvailableDraftSlot(selected) === null) {
      return res.status(400).json({ error: DRAFT_ABILITY_LIMIT_ERROR });
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
      ability.slotIndex = getFirstAvailableDraftSlot(selected);
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
    if (to === "selected" && getFirstAvailableDraftSlot(selected) === null) {
      return res.status(400).json({ error: DRAFT_ABILITY_LIMIT_ERROR });
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
      ability.slotIndex = getFirstAvailableDraftSlot(selected);
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
      const player0Selected = normalizeDraftCardSlots(game.tournament.selectedAbilities[player0Id] ?? []);
      const player1Selected = normalizeDraftCardSlots(game.tournament.selectedAbilities[player1Id] ?? []);

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
      const player0Hand = player0Selected?.map((cardInstance: any, index: number) => {
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
          slotIndex: normalizeDraftSlotIndex(cardInstance.slotIndex, index),
        };
      }).filter((c: any) => c !== null) || [];

      const player1Hand = player1Selected?.map((cardInstance: any, index: number) => {
        const abilityDef = ABILITIES[cardInstance.abilityId];
        if (!abilityDef) {
          console.error(`[draft/finalize] ❌ Ability definition not found: ${cardInstance.abilityId}`);
          return null;
        }
        return {
          ...abilityDef,
          instanceId: cardInstance.instanceId,
          cooldown: cardInstance.cooldown || 0,
          slotIndex: normalizeDraftSlotIndex(cardInstance.slotIndex, index),
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

      const unitScale = game.state.unitScale ?? NEW_WORLD_UNIT_SCALE;
      game.state.players[0].moveSpeed = 0.1666667 * unitScale;
      game.state.players[1].moveSpeed = 0.1666667 * unitScale;

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

    // ✅ CHECK IF GAME LOOP ALREADY STARTED (prevent duplicate from second player)
    let existingLoop = GameLoop.get(gameId);
    if (existingLoop && shouldReinitializeExistingBattleLoop(existingLoop.getState())) {
      console.warn(`[battle/start] Reinitializing unstarted battle loop with purple defaults for ${gameId}`);
      GameLoop.stop(gameId);
      existingLoop = undefined;
    }
    if (existingLoop) {
      // The loop may have been started before the pickup system was added.
      // Retroactively inject pickups if the loop state is empty so claim/inspect work.
      // Exported-map modes no longer use pickups at all.
      const ls = existingLoop.getState();
      const mode = normalizeGameMode((game as any).mode ?? 'arena');
      const isArena = mode === 'arena';
      if (isExportedMapMode(mode)) {
        if ((ls.pickups ?? []).length > 0) {
          ls.pickups = [];
          existingLoop.updateState(ls);
          await GameSession.findByIdAndUpdate(gameId, { "state.pickups": [] });
        }
      } else if (!ls.pickups || ls.pickups.length === 0) {
        ls.pickups = isArena ? generateArenaPickups() : generatePickups();
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
    const gameMode = normalizeGameMode((game as any).mode ?? 'arena');
    const battleState = initializeBattleState(game.tournament, playerIds, gameMode);

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
    GameLoop.start(gameId, battleState, { tickRate: 30, mode: gameMode });
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
    let shouldStartNextBattleLoop = false;
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
      game.state = initializeBattleState(game.tournament, allPlayers, normalizeGameMode((game as any).mode ?? 'arena'));
      shouldStartNextBattleLoop = true;
    }

    game.markModified("state");
    game.markModified("tournament");
    await game.save();

    if (shouldStartNextBattleLoop && !GameLoop.get(gameId)) {
      const gameMode = normalizeGameMode((game as any).mode ?? 'arena');
      GameLoop.start(gameId, game.state, { tickRate: 30, mode: gameMode });
      console.log(`[battle/complete] Started next battle GameLoop for ${gameId}`);
    }

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
 * Body: { gameId, abilityId, slotIndex? }
 */
router.post("/cheat/add-ability", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityId, slotIndex } = req.body;

    if (!abilityId) return res.status(400).json({ error: "abilityId required" });

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const abilityDef = ABILITIES[abilityId];
    if (!abilityDef) return res.status(400).json({ error: `Ability '${abilityId}' not found` });
    if (abilityDef.isCommon) return res.status(400).json({ error: "Common abilities are already in every hand" });
    if ((abilityDef as any).specialBarAbility === true || (abilityDef as any).hiddenFromDraft === true) {
      return res.status(400).json({ error: "Hidden sub-abilities cannot be added from cheat panel" });
    }

    const playerIndex = game.players.indexOf(userId);

    const sourceHand = game.state.players[playerIndex].hand || [];
    const preferredSlotIndex = slotIndex === null || slotIndex === undefined ? null : normalizeDraftSlotIndex(slotIndex, 0);

    // Create new ability instance
    const newInstance: AbilityInstance = {
      instanceId: randomUUID(),
      abilityId,
      cooldown: 0,
      slotIndex: preferredSlotIndex ?? undefined,
    };

    const fullCard = { ...abilityDef, instanceId: newInstance.instanceId, abilityId, cooldown: 0, slotIndex: preferredSlotIndex ?? undefined };

    // Apply to live loop first so the UI updates immediately (no DB-save wait).
    let livePlayerIndex = playerIndex;
    let handSource = [...sourceHand];
    let liveHand = (() => {
      const { draftCards, commonCards } = splitDraftAndCommonCards(handSource);
      const nextDraftCards = insertDraftCardAtSlot(draftCards, fullCard, preferredSlotIndex);
      if (!nextDraftCards) return null;
      return [...nextDraftCards, ...commonCards];
    })();
    if (!liveHand) {
      return res.status(400).json({ error: DRAFT_ABILITY_LIMIT_ERROR });
    }
    let liveVersion = game.state.version ?? 0;

    const gameLoop = GameLoop.get(gameId);
    if (gameLoop) {
      const loopState = gameLoop.getState();
      const loopPlayerIdx = loopState.players.findIndex((p: any) => p.userId === userId);
      if (loopPlayerIdx !== -1) {
        livePlayerIndex = loopPlayerIdx;
        handSource = [...(loopState.players[loopPlayerIdx].hand || [])];
        const loopPreferredSlotIndex = slotIndex === null || slotIndex === undefined ? null : normalizeDraftSlotIndex(slotIndex, 0);
        newInstance.slotIndex = loopPreferredSlotIndex ?? undefined;
        fullCard.slotIndex = loopPreferredSlotIndex ?? undefined;
        const { draftCards, commonCards } = splitDraftAndCommonCards(handSource);
        const nextDraftCards = insertDraftCardAtSlot(draftCards, fullCard, loopPreferredSlotIndex);
        if (!nextDraftCards) {
          return res.status(400).json({ error: DRAFT_ABILITY_LIMIT_ERROR });
        }
        liveHand = [...nextDraftCards, ...commonCards];
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
    game.tournament.selectedAbilities[userId] = toSelectedInstancesFromHand(liveHand);
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

    const draftCards = handSource
      .filter((card: any) => !isCommonAbilityCard(card))
      .map((card: any, fallbackIndex: number) => ({
        ...card,
        slotIndex: normalizeDraftSlotIndex(card?.slotIndex, fallbackIndex),
      }));
    const commonCards = handSource.filter((card: any) => isCommonAbilityCard(card));
    const fromIndex = draftCards.findIndex((card: any) => (card.instanceId ?? card.id) === instanceId);
    if (fromIndex === -1) {
      return res.status(404).json({ error: "Draft ability not found in hand" });
    }

    const clampedToIndex = normalizeDraftSlotIndex(toIndex, fromIndex);
    const moved = draftCards[fromIndex];
    const fromSlotIndex = normalizeDraftSlotIndex(moved?.slotIndex, fromIndex);
    const targetCard = draftCards.find((card: any, index: number) => index !== fromIndex && normalizeDraftSlotIndex(card?.slotIndex, index) === clampedToIndex);
    moved.slotIndex = clampedToIndex;
    if (targetCard) {
      targetCard.slotIndex = fromSlotIndex;
    }
    draftCards.sort((a: any, b: any) => normalizeDraftSlotIndex(a?.slotIndex, 0) - normalizeDraftSlotIndex(b?.slotIndex, 0));
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
 * POST /cheat/yumen/play-area - Update 玉门关 hard movement boundary.
 * Body: { gameId, playArea: { minX, minY, maxX, maxY } }
 */
router.post("/cheat/yumen/play-area", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, playArea } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const normalizedPlayArea = normalizeYumenPlayArea(playArea);
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      state.playArea = normalizedPlayArea;
      return [{ path: "/playArea", value: normalizedPlayArea }];
    });
    res.json({ ok: true, version: liveVersion, playArea: normalizedPlayArea });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/start-shrink - Start fast staged 玉门关 poison-zone shrink.
 * Body: { gameId, damageMode? }
 */
router.post("/cheat/yumen/start-shrink", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, damageMode } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const startedAt = Date.now();
    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = startYumenSafeZone(state, startedAt, { timelineMode: "fast", damageMode: normalizeYumenSafeZoneDamageMode(damageMode) });
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/start-full-shrink - Start full timeline 玉门关 poison-zone shrink.
 * Body: { gameId }
 */
router.post("/cheat/yumen/start-full-shrink", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const startedAt = Date.now();
    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = startYumenSafeZone(state, startedAt, { timelineMode: "full", damageMode: "full" });
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/damage-mode - Switch yumen poison-zone damage mode live.
 * Body: { gameId, damageMode }
 */
router.post("/cheat/yumen/damage-mode", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, damageMode } = req.body;
    const normalizedDamageMode = normalizeYumenSafeZoneDamageMode(damageMode);

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = setYumenSafeZoneDamageMode(state, normalizedDamageMode);
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/stop-shrink - Stop staged 玉门关 poison-zone shrink.
 * Body: { gameId }
 */
router.post("/cheat/yumen/stop-shrink", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const stoppedAt = Date.now();
    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = stopYumenSafeZone(state, stoppedAt);
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/pause-shrink - Pause staged 玉门关 poison-zone shrink in-place.
 * Body: { gameId }
 */
router.post("/cheat/yumen/pause-shrink", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const pausedAt = Date.now();
    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = pauseYumenSafeZone(state, pausedAt);
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/resume-shrink - Resume staged 玉门关 poison-zone shrink after pause.
 * Body: { gameId }
 */
router.post("/cheat/yumen/resume-shrink", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const resumedAt = Date.now();
    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = resumeYumenSafeZone(state, resumedAt);
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/yumen/reset-shrink - Reset staged 玉门关 poison-zone shrink.
 * Body: { gameId }
 */
router.post("/cheat/yumen/reset-shrink", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!isYumen1v1BasicMode((game as any).mode)) return res.status(400).json({ error: "Only available in 玉门关（1v1）：基础" });
    if (game.tournament?.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const resetAt = Date.now();
    let updatedSafeZone: any;
    const { liveVersion } = applyYumenStateUpdate(String(gameId), game, (state) => {
      updatedSafeZone = resetYumenSafeZone(resetAt);
      state.safeZone = updatedSafeZone;
      return [{ path: "/safeZone", value: updatedSafeZone }];
    });
    res.json({ ok: true, version: liveVersion, safeZone: updatedSafeZone });
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
 * POST /cheat/reset-cooldowns - Set both players' hand cooldowns/charges and consumable cooldowns to ready
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
    const pushHandRuntimeDiffs = (playerIndex: number, previousHand: any[], nextHand: any[]) => {
      if ((previousHand?.length ?? 0) !== (nextHand?.length ?? 0)) {
        diff.push({ path: `/players/${playerIndex}/hand`, value: nextHand });
        return;
      }
      const hasDifferentSlots = nextHand.some((nextCard: any, cardIndex: number) => {
        const previousCard = previousHand?.[cardIndex] ?? {};
        return (previousCard.instanceId ?? previousCard.abilityId) !== (nextCard.instanceId ?? nextCard.abilityId);
      });
      if (hasDifferentSlots) {
        diff.push({ path: `/players/${playerIndex}/hand`, value: nextHand });
        return;
      }
      nextHand.forEach((nextCard: any, cardIndex: number) => {
        const previousCard = previousHand?.[cardIndex] ?? {};
        for (const field of ["cooldown", "chargeLockTicks", "chargeRegenTicksRemaining"]) {
          const previousValue = Math.max(0, Number(previousCard[field] ?? 0));
          const nextValue = Math.max(0, Number(nextCard[field] ?? 0));
          if (previousValue !== nextValue) {
            diff.push({ path: `/players/${playerIndex}/hand/${cardIndex}/${field}`, value: nextCard[field] });
          }
        }
        if (previousCard.chargeCount !== nextCard.chargeCount) {
          diff.push({ path: `/players/${playerIndex}/hand/${cardIndex}/chargeCount`, value: nextCard.chargeCount });
        }
      });
    };

    let liveVersion = game.state.version ?? 0;
    let diff: Array<{ path: string; value: any }> = [];
    const gameLoop = GameLoop.get(gameId);

    if (gameLoop) {
      const loopState = gameLoop.getState();
      loopState.players = loopState.players.map((p: any, idx: number) => {
        const previousHand = p.hand ?? [];
        const hand = resetHand(p.hand ?? []);
        pushHandRuntimeDiffs(idx, previousHand, hand);
        diff.push({ path: `/players/${idx}/consumableCooldowns`, value: {} });
        return {
          ...p,
          hand,
          consumableCooldowns: {},
        };
      });
      loopState.version = (loopState.version ?? 0) + 1;
      liveVersion = loopState.version;
      gameLoop.updateState(loopState);
    } else {
      game.state.players = game.state.players.map((p: any, idx: number) => {
        const previousHand = p.hand ?? [];
        const hand = resetHand(p.hand ?? []);
        pushHandRuntimeDiffs(idx, previousHand, hand);
        diff.push({ path: `/players/${idx}/consumableCooldowns`, value: {} });
        return {
          ...p,
          hand,
          consumableCooldowns: {},
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
      consumableCooldowns: {},
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
 * POST /cheat/refill-consumables - Reset both players' consumable inventory to the starting stock.
 * Body: { gameId }
 */
router.post("/cheat/refill-consumables", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    let liveVersion = game.state.version ?? 0;
    const diff: Array<{ path: string; value: any }> = [];
    const gameLoop = GameLoop.get(gameId);

    if (gameLoop) {
      const loopState = gameLoop.getState();
      loopState.players = loopState.players.map((p: any, idx: number) => {
        const consumableCounts = createStartingConsumableCounts();
        diff.push({ path: `/players/${idx}/consumableCounts`, value: consumableCounts });
        return {
          ...p,
          consumableCounts,
        };
      });
      loopState.version = (loopState.version ?? 0) + 1;
      liveVersion = loopState.version;
      gameLoop.updateState(loopState);
    } else {
      game.state.players = game.state.players.map((p: any, idx: number) => {
        const consumableCounts = createStartingConsumableCounts();
        diff.push({ path: `/players/${idx}/consumableCounts`, value: consumableCounts });
        return {
          ...p,
          consumableCounts,
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
      consumableCounts: createStartingConsumableCounts(),
    }));

    game.markModified("state");
    game.markModified("state.players");

    void game.save().catch((err: any) => {
      console.error("[cheat/refill-consumables] async save failed:", err?.message ?? err);
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

/**
 * POST /cheat/set-crit-chance - Set both players' combat preset stats.
 * Body: { gameId, critChancePct? , waiGongCritChancePct?, neiGongCritChancePct?, defensePct?, huajinPct?, maxHp?, attackDamage? }
 * - If critChancePct is provided, both split values are set to that value.
 */
router.post("/cheat/set-crit-chance", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, critChancePct, waiGongCritChancePct, neiGongCritChancePct, defensePct, huajinPct, maxHp, attackDamage } = req.body;

    const hasLegacy = critChancePct !== undefined;
    const hasDefense = defensePct !== undefined;
    const hasHuajin = huajinPct !== undefined;
    const hasMaxHp = maxHp !== undefined;
    const hasAttackDamage = attackDamage !== undefined;
    const legacy = Number(critChancePct);
    const waiRaw = waiGongCritChancePct !== undefined ? Number(waiGongCritChancePct) : legacy;
    const neiRaw = neiGongCritChancePct !== undefined ? Number(neiGongCritChancePct) : legacy;
    const defenseRaw = Number(defensePct);
    const huajinRaw = Number(huajinPct);
    const maxHpRaw = Number(maxHp);
    const attackDamageRaw = Number(attackDamage);

    if (!Number.isFinite(waiRaw) || !Number.isFinite(neiRaw) || (!hasLegacy && waiGongCritChancePct === undefined && neiGongCritChancePct === undefined)) {
      return res.status(400).json({ error: "Provide critChancePct or waiGongCritChancePct/neiGongCritChancePct as numbers" });
    }
    if (hasDefense && !Number.isFinite(defenseRaw)) {
      return res.status(400).json({ error: "defensePct must be a number" });
    }
    if (hasHuajin && !Number.isFinite(huajinRaw)) {
      return res.status(400).json({ error: "huajinPct must be a number" });
    }
    if (hasMaxHp && (!Number.isFinite(maxHpRaw) || maxHpRaw <= 0)) {
      return res.status(400).json({ error: "maxHp must be a positive number" });
    }
    if (hasAttackDamage && (!Number.isFinite(attackDamageRaw) || attackDamageRaw <= 0)) {
      return res.status(400).json({ error: "attackDamage must be a positive number" });
    }

    const boundedWaiCrit = Math.max(0, Math.min(100, waiRaw));
    const boundedNeiCrit = Math.max(0, Math.min(100, neiRaw));
    const boundedDefense = Math.max(0, Math.min(100, defenseRaw));
    const boundedHuajin = Math.max(0, Math.min(100, huajinRaw));
    const boundedMaxHp = Math.max(1, Math.floor(maxHpRaw));
    const boundedAttackDamage = Math.max(1, Math.floor(attackDamageRaw));

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    let liveVersion = game.state.version ?? 0;
    const diff: Array<{ path: string; value: any }> = [];
    const gameLoop = GameLoop.get(gameId);

    if (gameLoop) {
      const loopState = gameLoop.getState();
      loopState.players = loopState.players.map((p: any, idx: number) => {
        diff.push({ path: `/players/${idx}/waiGongCritChancePct`, value: boundedWaiCrit });
        diff.push({ path: `/players/${idx}/neiGongCritChancePct`, value: boundedNeiCrit });
        diff.push({ path: `/players/${idx}/critChancePct`, value: boundedWaiCrit });
        if (hasDefense) diff.push({ path: `/players/${idx}/defensePct`, value: boundedDefense });
        if (hasHuajin) diff.push({ path: `/players/${idx}/huajinPct`, value: boundedHuajin });
        if (hasMaxHp) {
          diff.push({ path: `/players/${idx}/maxHp`, value: boundedMaxHp });
          diff.push({ path: `/players/${idx}/hp`, value: boundedMaxHp });
        }
        if (hasAttackDamage) diff.push({ path: `/players/${idx}/attackDamage`, value: boundedAttackDamage });
        return {
          ...p,
          waiGongCritChancePct: boundedWaiCrit,
          neiGongCritChancePct: boundedNeiCrit,
          // Keep legacy field for compatibility with old clients.
          critChancePct: boundedWaiCrit,
          ...(hasDefense ? { defensePct: boundedDefense } : {}),
          ...(hasHuajin ? { huajinPct: boundedHuajin } : {}),
          ...(hasMaxHp ? { maxHp: boundedMaxHp, hp: boundedMaxHp } : {}),
          ...(hasAttackDamage ? { attackDamage: boundedAttackDamage } : {}),
        };
      });
      loopState.version = (loopState.version ?? 0) + 1;
      liveVersion = loopState.version;
      gameLoop.updateState(loopState);
    } else {
      game.state.players = game.state.players.map((p: any, idx: number) => {
        diff.push({ path: `/players/${idx}/waiGongCritChancePct`, value: boundedWaiCrit });
        diff.push({ path: `/players/${idx}/neiGongCritChancePct`, value: boundedNeiCrit });
        diff.push({ path: `/players/${idx}/critChancePct`, value: boundedWaiCrit });
        if (hasDefense) diff.push({ path: `/players/${idx}/defensePct`, value: boundedDefense });
        if (hasHuajin) diff.push({ path: `/players/${idx}/huajinPct`, value: boundedHuajin });
        if (hasMaxHp) {
          diff.push({ path: `/players/${idx}/maxHp`, value: boundedMaxHp });
          diff.push({ path: `/players/${idx}/hp`, value: boundedMaxHp });
        }
        if (hasAttackDamage) diff.push({ path: `/players/${idx}/attackDamage`, value: boundedAttackDamage });
        return {
          ...p,
          waiGongCritChancePct: boundedWaiCrit,
          neiGongCritChancePct: boundedNeiCrit,
          critChancePct: boundedWaiCrit,
          ...(hasDefense ? { defensePct: boundedDefense } : {}),
          ...(hasHuajin ? { huajinPct: boundedHuajin } : {}),
          ...(hasMaxHp ? { maxHp: boundedMaxHp, hp: boundedMaxHp } : {}),
          ...(hasAttackDamage ? { attackDamage: boundedAttackDamage } : {}),
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

    res.json({
      ok: true,
      waiGongCritChancePct: boundedWaiCrit,
      neiGongCritChancePct: boundedNeiCrit,
      ...(hasDefense ? { defensePct: boundedDefense } : {}),
      ...(hasHuajin ? { huajinPct: boundedHuajin } : {}),
      ...(hasMaxHp ? { maxHp: boundedMaxHp, hp: boundedMaxHp } : {}),
      ...(hasAttackDamage ? { attackDamage: boundedAttackDamage } : {}),
    });

    game.state.players = game.state.players.map((p: any) => ({
      ...p,
      waiGongCritChancePct: boundedWaiCrit,
      neiGongCritChancePct: boundedNeiCrit,
      critChancePct: boundedWaiCrit,
      ...(hasDefense ? { defensePct: boundedDefense } : {}),
      ...(hasHuajin ? { huajinPct: boundedHuajin } : {}),
      ...(hasMaxHp ? { maxHp: boundedMaxHp, hp: boundedMaxHp } : {}),
      ...(hasAttackDamage ? { attackDamage: boundedAttackDamage } : {}),
    }));
    game.markModified("state");
    game.markModified("state.players");

    void game.save().catch((err: any) => {
      console.error("[cheat/set-crit-chance] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/spawn-dummy - Spawn a target dummy entity at a world position.
 * Body: { gameId, side: "enemy" | "ally", x, y, z, maxHp? }
 *  - side="enemy": ownerUserId set to opponent's userId (or synthetic), so the
 *    caller treats it as an enemy and can target/damage it.
 *  - side="ally":  ownerUserId set to caller's userId; the caller's opponent
 *    treats it as their enemy.
 * Dummies default to 126万 HP, can override maxHp, have no intrinsic immunities,
 * and persist 10 minutes.
 */
router.post("/cheat/spawn-dummy", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, side, x, y, z, maxHp } = req.body;

    if (side !== "enemy" && side !== "ally") {
      return res.status(400).json({ error: "side must be 'enemy' or 'ally'" });
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: "x/y must be numbers" });
    }
    const zNum = Number.isFinite(z) ? Number(z) : 0;
    const dummyMaxHp = Number.isFinite(maxHp) ? Math.max(1, Math.floor(Number(maxHp))) : 1_260_000;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const opponentUserId = (game.players as string[]).find((id) => id !== userId);

    const ownerUserId = side === "ally"
      ? userId
      : (opponentUserId ?? `dummy-opponent:${gameId}`);

    const now = Date.now();
    const entityId = randomUUID();
    const entityUserId = `entity:${entityId}`;
    const kind = side === "ally" ? "test_dummy_ally" : "test_dummy_enemy";

    const gameLoop = GameLoop.get(gameId);
    const liveState: any = gameLoop ? gameLoop.getState() : game.state;
    const storedUnitScale = liveState.unitScale ?? 1;
    // 1.5 yards radius for visibility/click hit-area
    const radius = 1.5 * storedUnitScale;

    const dummy = {
      id: entityId,
      userId: entityUserId,
      kind,
      ownerUserId,
      position: { x: Number(x), y: Number(y), z: zNum },
      radius,
      ...getPurpleCombatStats(dummyMaxHp),
      shield: 0,
      buffs: [],
      statsPreset: "purple",
      expiresAt: now + 600_000,
      enteredAtByUser: {},
      rearmAtByUser: {},
    };

    if (gameLoop) {
      const loopState: any = gameLoop.getState();
      const entities = [...(loopState.entities ?? []), dummy];
      loopState.entities = entities;
      loopState.version = (loopState.version ?? 0) + 1;
      gameLoop.updateState(loopState);
      broadcastGameUpdate({
        gameId,
        version: loopState.version,
        diff: [{ path: "/entities", value: entities }],
        timestamp: Date.now(),
      });
    } else {
      const entities = [...((game.state as any).entities ?? []), dummy];
      (game.state as any).entities = entities;
      game.state.version = (game.state.version ?? 0) + 1;
      broadcastGameUpdate({
        gameId,
        version: game.state.version,
        diff: [{ path: "/entities", value: entities }],
        timestamp: Date.now(),
      });
    }

    res.json({ ok: true, entityId });

    (game.state as any).entities = [...((game.state as any).entities ?? []).filter((e: any) => e.id !== entityId), dummy];
    game.markModified("state");
    void game.save().catch((err: any) => {
      console.error("[cheat/spawn-dummy] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const DUMMY_KINDS = new Set(["test_dummy_ally", "test_dummy_enemy"]);

/**
 * POST /cheat/restore-dummies - Restore all target dummies to full HP, reset shields.
 * Body: { gameId }
 */
router.post("/cheat/restore-dummies", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const gameLoop = GameLoop.get(gameId);
    const target: any = gameLoop ? gameLoop.getState() : game.state;
    const entities = ((target.entities ?? []) as any[]).map((e: any) => {
      if (!DUMMY_KINDS.has(e.kind)) return e;
      const restoreMaxHp = Number(e.maxHp) === 100 ? 100 : STARTING_BATTLE_HP;
      return { ...e, ...getPurpleCombatStats(restoreMaxHp), shield: 0, statsPreset: "purple" };
    });
    target.entities = entities;
    target.version = (target.version ?? 0) + 1;
    if (gameLoop) gameLoop.updateState(target);

    broadcastGameUpdate({
      gameId,
      version: target.version,
      diff: [{ path: "/entities", value: entities }],
      timestamp: Date.now(),
    });

    res.json({ ok: true });

    (game.state as any).entities = entities;
    game.markModified("state");
    void game.save().catch((err: any) => {
      console.error("[cheat/restore-dummies] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/clear-dummy-debuffs - Drop all DEBUFF buffs from target dummies.
 * Body: { gameId }
 */
router.post("/cheat/clear-dummy-debuffs", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const gameLoop = GameLoop.get(gameId);
    const target: any = gameLoop ? gameLoop.getState() : game.state;
    const entities = ((target.entities ?? []) as any[]).map((e: any) => {
      if (!DUMMY_KINDS.has(e.kind)) return e;
      return { ...e, buffs: (e.buffs ?? []).filter((b: any) => b.category !== "DEBUFF") };
    });
    target.entities = entities;
    target.version = (target.version ?? 0) + 1;
    if (gameLoop) gameLoop.updateState(target);

    broadcastGameUpdate({
      gameId,
      version: target.version,
      diff: [{ path: "/entities", value: entities }],
      timestamp: Date.now(),
    });

    res.json({ ok: true });

    (game.state as any).entities = entities;
    game.markModified("state");
    void game.save().catch((err: any) => {
      console.error("[cheat/clear-dummy-debuffs] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /cheat/clear-dummies - Remove ALL target dummy entities from the game.
 * Body: { gameId }
 */
router.post("/cheat/clear-dummies", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;

    const game = await GameSession.findById(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!game.players.includes(userId)) return res.status(403).json({ error: "Not in this game" });
    if (!game.tournament) return res.status(400).json({ error: "Tournament not started" });
    if (game.tournament.phase !== "BATTLE") return res.status(400).json({ error: "Not in battle phase" });

    const gameLoop = GameLoop.get(gameId);
    const target: any = gameLoop ? gameLoop.getState() : game.state;
    const entities = ((target.entities ?? []) as any[]).filter(
      (e: any) => !DUMMY_KINDS.has(e.kind),
    );
    target.entities = entities;
    target.version = (target.version ?? 0) + 1;
    if (gameLoop) gameLoop.updateState(target);

    broadcastGameUpdate({
      gameId,
      version: target.version,
      diff: [{ path: "/entities", value: entities }],
      timestamp: Date.now(),
    });

    res.json({ ok: true });

    (game.state as any).entities = entities;
    game.markModified("state");
    void game.save().catch((err: any) => {
      console.error("[cheat/clear-dummies] async save failed:", err?.message ?? err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
