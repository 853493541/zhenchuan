import { randomUUID } from "crypto";
import { subscriptionManager, type ChatMessagePayload } from "../../websocket/GameSubscriptionManager";
import { normalizeStoredUserDisplayName, User } from "../../models/User";
import GameSession from "../models/GameSession";
import type { GameState } from "../engine/state/types";

const recentDefeatBroadcasts = new Map<string, number>();

export type DefeatAnnouncement = { defeatedUserId: string; attackerUserId: string };

export function createChatMessageId(userId: string, timestamp: number): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${String(userId).slice(-6)}-${suffix}`;
}

export async function persistAndBroadcastChatMessage(gameId: string, chat: ChatMessagePayload, membershipUserId?: string) {
  try {
    const filter: Record<string, unknown> = { _id: gameId };
    if (membershipUserId) filter.players = membershipUserId;
    await GameSession.updateOne(
      filter,
      { $push: { chatMessages: chat } }
    );
  } catch (err) {
    console.error(`[CHAT] Failed to persist chat message for game ${gameId}:`, err);
  }

  subscriptionManager.broadcast(gameId, {
    type: "CHAT_MESSAGE",
    timestamp: chat.timestamp,
    chat,
  });
}

export function collectDefeatAnnouncementsFromEvents(
  state: GameState,
  eventStartIndex: number,
  explicitDefeatedUserIds?: string[],
): DefeatAnnouncement[] {
  const eventWindow = state.events.slice(Math.max(0, eventStartIndex));
  const defeatedUserIds = new Set<string>();

  for (const userId of explicitDefeatedUserIds ?? []) {
    if (userId) defeatedUserIds.add(userId);
  }

  if (!explicitDefeatedUserIds) {
    for (const player of state.players) {
      if (player.hp <= 0) defeatedUserIds.add(player.userId);
    }
  }

  for (const event of eventWindow as any[]) {
    if (event?.type !== "HEAL" || event?.abilityId !== "testing_full_heal") continue;
    const defeatedUserId = event.targetUserId || event.actorUserId;
    if (defeatedUserId) defeatedUserIds.add(defeatedUserId);
  }

  const announcements: DefeatAnnouncement[] = [];
  for (const defeatedUserId of defeatedUserIds) {
    const recentDamage = [...eventWindow]
      .reverse()
      .find((event: any) => event?.type === "DAMAGE" && event.targetUserId === defeatedUserId && event.actorUserId && event.actorUserId !== defeatedUserId)
      ?? [...state.events]
        .reverse()
        .find((event: any) => event?.type === "DAMAGE" && event.targetUserId === defeatedUserId && event.actorUserId && event.actorUserId !== defeatedUserId);
    if (!recentDamage) continue;
    announcements.push({ defeatedUserId, attackerUserId: String((recentDamage as any).actorUserId) });
  }

  return announcements;
}

async function resolvePlayerDisplayNames(gameId: string, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const game = await GameSession.findById(gameId).select("playerNames state.players.userId state.players.username").lean();
  const users = await User.find({ _id: { $in: ids } }).select("displayName username").lean();
  const byId = new Map<string, string>();

  for (const user of users) {
    const userId = String((user as any)._id);
    byId.set(userId, normalizeStoredUserDisplayName((user as any).username, (user as any).displayName));
  }

  for (const userId of ids) {
    if (byId.has(userId)) continue;
    const statePlayer = (game as any)?.state?.players?.find((player: any) => player?.userId === userId);
    const fallback = (game as any)?.playerNames?.[userId] ?? statePlayer?.username ?? `User${userId.slice(-4)}`;
    byId.set(userId, fallback);
  }

  return byId;
}

export async function broadcastDefeatSystemChat(gameId: string, defeatedUserId: string, attackerUserId: string) {
  if (!defeatedUserId || !attackerUserId || defeatedUserId === attackerUserId) return;
  const timestamp = Date.now();
  const duplicateKey = `${gameId}:${defeatedUserId}:${attackerUserId}`;
  const lastBroadcastAt = recentDefeatBroadcasts.get(duplicateKey) ?? 0;
  if (timestamp - lastBroadcastAt < 1500) return;
  recentDefeatBroadcasts.set(duplicateKey, timestamp);
  if (recentDefeatBroadcasts.size > 200) {
    const cutoff = timestamp - 60_000;
    for (const [key, value] of recentDefeatBroadcasts.entries()) {
      if (value < cutoff) recentDefeatBroadcasts.delete(key);
    }
  }
  const names = await resolvePlayerDisplayNames(gameId, [defeatedUserId, attackerUserId]);
  const defeatedName = names.get(defeatedUserId) ?? `User${defeatedUserId.slice(-4)}`;
  const attackerName = names.get(attackerUserId) ?? `User${attackerUserId.slice(-4)}`;
  const chat: ChatMessagePayload = {
    id: `${timestamp}-system-${randomUUID().slice(0, 8)}`,
    channel: "system",
    userId: "system",
    username: "系统",
    school: null,
    text: `【${defeatedName}】被【${attackerName}】重伤，黯然离去。`,
    timestamp,
    variant: "system",
  };
  await persistAndBroadcastChatMessage(gameId, chat);
}