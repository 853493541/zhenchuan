import { randomUUID } from "crypto";
import { calculateDistance, type GameEvent, type GameState, type PlayerState } from "../state/types";

export const COMBAT_STATUS_RANGE_UNITS = 60;
export const COMBAT_STATUS_TIMEOUT_MS = 3_000;
export const COMBAT_STATUS_CHECK_INTERVAL_MS = 3_000;

type CombatStatusLink = { lastActionAt: number };

function getCombatLinks(player: PlayerState): Record<string, CombatStatusLink> {
  const rawLinks = (player as any).combatLinks;
  if (!rawLinks || typeof rawLinks !== "object" || Array.isArray(rawLinks)) {
    (player as any).combatLinks = {};
    return (player as any).combatLinks;
  }

  for (const [userId, link] of Object.entries(rawLinks)) {
    const lastActionAt = Number((link as CombatStatusLink | undefined)?.lastActionAt ?? 0);
    if (!userId || !Number.isFinite(lastActionAt) || lastActionAt <= 0) {
      delete rawLinks[userId];
    } else {
      rawLinks[userId] = { lastActionAt };
    }
  }
  return rawLinks as Record<string, CombatStatusLink>;
}

function emitCombatStatusEvent(params: {
  state: GameState;
  player: PlayerState;
  inCombat: boolean;
  relatedUserId?: string;
  timestamp: number;
}) {
  const { state, player, inCombat, relatedUserId, timestamp } = params;
  state.events.push({
    id: randomUUID(),
    timestamp,
    turn: state.turn,
    type: "COMBAT_STATUS",
    actorUserId: player.userId,
    targetUserId: player.userId,
    combatStatus: inCombat ? "enter" : "exit",
    inCombat,
    relatedUserId,
  } as GameEvent);
}

function setCombatFlag(params: {
  state: GameState;
  player: PlayerState;
  relatedUserId?: string;
  timestamp: number;
}) {
  const { state, player, relatedUserId, timestamp } = params;
  const links = getCombatLinks(player);
  const nextInCombat = Object.keys(links).length > 0;
  const previousInCombat = player.inCombat === true;
  player.inCombat = nextInCombat;
  if (!nextInCombat) {
    (player as any).combatLinks = {};
  }
  if (previousInCombat !== nextInCombat) {
    emitCombatStatusEvent({ state, player, inCombat: nextInCombat, relatedUserId, timestamp });
  }
}

function getPlayerMap(state: GameState): Map<string, PlayerState> {
  return new Map((state.players ?? []).map((player) => [player.userId, player]));
}

function arePlayersWithinCombatRange(state: GameState, first: PlayerState, second: PlayerState): boolean {
  if (!first.position || !second.position) return false;
  return calculateDistance(first.position, second.position, state.unitScale) <= COMBAT_STATUS_RANGE_UNITS;
}

export function recordCombatActivity(params: {
  state: GameState;
  actorUserId?: string;
  targetUserId?: string;
  timestamp?: number;
  requireRange?: boolean;
  refreshTimerOnlyInRange?: boolean;
}) {
  const { state, actorUserId, targetUserId, requireRange = false, refreshTimerOnlyInRange = false } = params;
  if (!actorUserId || !targetUserId || actorUserId === targetUserId) return false;

  const playersById = getPlayerMap(state);
  const actor = playersById.get(actorUserId);
  const target = playersById.get(targetUserId);
  if (!actor || !target) return false;
  const withinRange = arePlayersWithinCombatRange(state, actor, target);
  if (requireRange && !withinRange) return false;

  const timestamp = Number.isFinite(params.timestamp) ? Number(params.timestamp) : Date.now();
  const actorLinks = getCombatLinks(actor);
  const targetLinks = getCombatLinks(target);
  const previousLastActionAt = Math.max(actorLinks[target.userId]?.lastActionAt ?? 0, targetLinks[actor.userId]?.lastActionAt ?? 0);
  const shouldRefreshTimer = !refreshTimerOnlyInRange || withinRange;
  let lastActionAt = timestamp;
  if (!shouldRefreshTimer) {
    lastActionAt = previousLastActionAt > 0 ? previousLastActionAt : timestamp - COMBAT_STATUS_TIMEOUT_MS;
  }
  actorLinks[target.userId] = { lastActionAt };
  targetLinks[actor.userId] = { lastActionAt };

  setCombatFlag({ state, player: actor, relatedUserId: target.userId, timestamp });
  setCombatFlag({ state, player: target, relatedUserId: actor.userId, timestamp });
  return true;
}

function eventCountsAsDamageActivity(event: any): boolean {
  const damageValue = Number(event?.value ?? 0);
  const shieldAbsorbed = Number(event?.shieldAbsorbed ?? 0);
  return damageValue > 0 || shieldAbsorbed > 0;
}

export function syncCombatStatusFromEvents(state: GameState, startIndex: number, endIndex = state.events.length): boolean {
  let changed = false;
  const boundedStart = Math.max(0, Math.min(startIndex, state.events.length));
  const boundedEnd = Math.max(boundedStart, Math.min(endIndex, state.events.length));

  for (let index = boundedStart; index < boundedEnd; index++) {
    const event = state.events[index] as any;
    if (!event || typeof event !== "object") continue;

    if (event.type === "DAMAGE" && eventCountsAsDamageActivity(event)) {
      changed = recordCombatActivity({
        state,
        actorUserId: event.actorUserId,
        targetUserId: event.targetUserId,
        timestamp: event.timestamp,
        refreshTimerOnlyInRange: true,
      }) || changed;
      continue;
    }

    if (event.type === "BUFF_APPLIED" && event.buffCategory === "DEBUFF") {
      changed = recordCombatActivity({
        state,
        actorUserId: event.actorUserId,
        targetUserId: event.targetUserId,
        timestamp: event.timestamp,
        requireRange: true,
      }) || changed;
    }
  }

  return changed;
}

export function expireCombatStatusLinks(state: GameState, timestamp = Date.now()): boolean {
  const playersById = getPlayerMap(state);
  const removedRelatedByPlayer = new Map<string, string>();
  let changed = false;

  for (const player of state.players ?? []) {
    const links = getCombatLinks(player);
    for (const combatantUserId of Object.keys(links)) {
      const combatant = playersById.get(combatantUserId);
      const reverseLinks = combatant ? getCombatLinks(combatant) : null;
      const reverseLink = reverseLinks?.[player.userId];
      const lastActionAt = Math.max(links[combatantUserId]?.lastActionAt ?? 0, reverseLink?.lastActionAt ?? 0);
      const stale = timestamp - lastActionAt >= COMBAT_STATUS_TIMEOUT_MS;
      const outOfRange = !combatant || !arePlayersWithinCombatRange(state, player, combatant);
      const dead = (player.hp ?? 0) <= 0 || ((combatant?.hp ?? 1) <= 0);

      if (!combatant || stale || outOfRange || dead) {
        delete links[combatantUserId];
        if (reverseLinks) delete reverseLinks[player.userId];
        removedRelatedByPlayer.set(player.userId, combatantUserId);
        if (combatant) removedRelatedByPlayer.set(combatant.userId, player.userId);
        changed = true;
      }
    }
  }

  for (const player of state.players ?? []) {
    const before = player.inCombat === true;
    setCombatFlag({
      state,
      player,
      relatedUserId: removedRelatedByPlayer.get(player.userId),
      timestamp,
    });
    changed = changed || before !== (player.inCombat === true);
  }

  return changed;
}
