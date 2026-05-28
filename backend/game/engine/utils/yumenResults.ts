import type { GameState } from "../state/types";
import { hasActiveYumenSpectatorBuff } from "./yumenSafeZone";

export const YUMEN_RESULT_AUTO_LEAVE_MS = 30_000;

type YumenRankCandidate = {
  userId: string;
  username: string;
  alive: boolean;
  defeatedAt: number;
  kills: number;
  damage: number;
};

function getYumenPlayerDisplayName(state: any, player: any): string {
  if (typeof player?.username === "string" && player.username.trim()) return player.username.trim();
  const userId = String(player?.userId ?? "");
  const playerNames = state?.playerNames && typeof state.playerNames === "object" ? state.playerNames : {};
  const stateName = playerNames[userId];
  if (typeof stateName === "string" && stateName.trim()) return stateName.trim();
  return userId ? `User${userId.slice(-4)}` : "玩家";
}

function collectYumenEventStats(state: any): Record<string, { kills: number; damage: number }> {
  const stats: Record<string, { kills: number; damage: number }> = {};
  const ensure = (userId: string) => (stats[userId] ??= { kills: 0, damage: 0 });
  for (const event of state?.events ?? []) {
    if (!event || typeof event !== "object") continue;
    if (event.type === "YUMEN_DEFEAT" && typeof event.attackerUserId === "string" && event.attackerUserId !== event.defeatedUserId) {
      ensure(event.attackerUserId).kills += 1;
      continue;
    }
    if (event.type === "DAMAGE" && typeof event.actorUserId === "string" && event.actorUserId !== event.targetUserId) {
      const value = Number(event.value ?? 0);
      const shieldAbsorbed = Number(event.shieldAbsorbed ?? 0);
      const totalDamage = (Number.isFinite(value) ? Math.max(0, value) : 0) + (Number.isFinite(shieldAbsorbed) ? Math.max(0, shieldAbsorbed) : 0);
      if (totalDamage > 0) ensure(event.actorUserId).damage += totalDamage;
    }
  }
  return stats;
}

function getYumenDefeatedAtFromEvents(state: any, userId: string): number {
  let defeatedAt = 0;
  for (const event of state?.events ?? []) {
    if (event?.type === "YUMEN_DEFEAT" && (event.defeatedUserId === userId || event.targetUserId === userId)) {
      defeatedAt = Math.max(defeatedAt, Number(event.timestamp ?? 0));
    }
  }
  return defeatedAt;
}

function hasUnrevivedYumenDefeatEvent(state: any, userId: string): boolean {
  let latestDefeatAt = 0;
  let latestReviveAt = 0;
  for (const event of state?.events ?? []) {
    if (!event || typeof event !== "object") continue;
    if (event.type === "YUMEN_DEFEAT" && (event.defeatedUserId === userId || event.targetUserId === userId)) {
      latestDefeatAt = Math.max(latestDefeatAt, Number(event.timestamp ?? 0));
      continue;
    }
    if (event.type === "YUMEN_REVIVE" && (event.revivedUserId === userId || event.targetUserId === userId)) {
      latestReviveAt = Math.max(latestReviveAt, Number(event.timestamp ?? 0));
    }
  }
  return latestDefeatAt > latestReviveAt;
}

function isYumenPlayerAlive(state: GameState | any, player: any, now: number): boolean {
  if (!player || typeof player !== "object") return false;
  if (Number(player.hp ?? 0) <= 0) return false;
  if (player.yumenDefeated === true) return false;
  if (hasActiveYumenSpectatorBuff(player, now)) return false;
  const userId = String(player.userId ?? "");
  if (!userId) return false;
  if (hasUnrevivedYumenDefeatEvent(state, userId)) return false;
  return true;
}

export function countYumenAlivePlayers(state: GameState | any, now = Date.now()): number {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players.filter((player: any) => isYumenPlayerAlive(state, player, now)).length;
}

export function buildYumenResults(state: GameState | any, endedAt = Date.now()) {
  const players = Array.isArray(state?.players) ? state.players : [];
  const stats = collectYumenEventStats(state);
  const ranked: YumenRankCandidate[] = players.map((player: any) => {
    const userId = String(player?.userId ?? "");
    const playerStats = stats[userId] ?? { kills: 0, damage: 0 };
    const defeatedAt = Number(player?.yumenDefeatedAt ?? 0) || getYumenDefeatedAtFromEvents(state, userId);
    return {
      userId,
      username: getYumenPlayerDisplayName(state, player),
      alive: isYumenPlayerAlive(state, player, endedAt),
      defeatedAt,
      kills: Math.max(0, Math.round(playerStats.kills)),
      damage: Math.max(0, Math.round(playerStats.damage)),
    };
  }).filter((row: YumenRankCandidate) => row.userId);

  ranked.sort((a: YumenRankCandidate, b: YumenRankCandidate) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.defeatedAt !== b.defeatedAt) return b.defeatedAt - a.defeatedAt;
    if (a.kills !== b.kills) return b.kills - a.kills;
    if (a.damage !== b.damage) return b.damage - a.damage;
    return a.username.localeCompare(b.username, "zh-Hans-CN");
  });

  const attendeeCount = ranked.length;
  const rows = ranked.map((row: YumenRankCandidate, index: number) => {
    const score = Math.max(1, attendeeCount - index);
    return {
      rank: index + 1,
      userId: row.userId,
      username: row.username,
      kills: row.kills,
      damage: row.damage,
      score,
      reward: score * 20,
    };
  });

  return {
    endedAt,
    autoLeaveAt: endedAt + YUMEN_RESULT_AUTO_LEAVE_MS,
    winnerUserId: rows[0]?.userId,
    rows,
  };
}