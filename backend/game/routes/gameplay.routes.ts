import express from "express";
import { cancelActiveChannelCast, cancelPlayerBuff, playAbility, passTurn, useConsumable } from "../services";
import { getUserIdFromCookie } from "./auth";
import type { GameState, MovementInput, TargetSelection } from "../engine/state/types";
import { ABILITIES } from "../abilities/abilities";
import GameSession from "../models/GameSession";
import { normalizeStoredUserDisplayName, User } from "../../models/User";
import { broadcastGameUpdate } from "../services/broadcast";
import { ensureBattleLoop, getBattleLoopHydrationDiagnostics } from "../services/battleLoopRuntime";
import { GameLoop } from "../engine/loop/GameLoop";
import { randomUUID } from "crypto";
import { NEW_WORLD_UNIT_SCALE } from "../engine/state/types";
import { blocksCardTargeting } from "../engine/rules/guards";
import { isYumen1v1BasicMode } from "../modes";
import { hasActiveYumenSpectatorBuff } from "../engine/utils/yumenSafeZone";
import { recordLagProbe } from "../../utils/lagProbe";

const router = express.Router();
const pendingLeaveEndTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function finalizeLeaveEnd(gameId: string, endedByUserId: string, endsAt: number) {
  const game = await GameSession.findById(gameId);
  if (!game) return;

  const loop = GameLoop.get(gameId);
  const state = loop?.getState() ?? game.state;
  if (!state || state.gameOver === true) return;

  const notice = (state as any).leaveNotice;
  if (!notice || notice.userId !== endedByUserId || notice.endsAt !== endsAt) return;

  state.gameOver = true;
  delete (state as any).winnerUserId;
  (state as any).endedByUserId = endedByUserId;
  state.version = (state.version ?? 0) + 1;

  loop?.updateState(state);
  GameLoop.stop(gameId);

  game.state = state as any;
  game.markModified("state");
  await game.save();

  broadcastGameUpdate({
    gameId,
    version: state.version,
    diff: [
      { path: "/gameOver", value: true },
      { path: "/winnerUserId", value: undefined },
      { path: "/endedByUserId", value: endedByUserId },
    ],
    gameOver: true,
    timestamp: Date.now(),
  });
}

function scheduleLeaveEnd(gameId: string, endedByUserId: string, endsAt: number) {
  const existing = pendingLeaveEndTimers.get(gameId);
  if (existing) clearTimeout(existing);

  const delayMs = Math.max(0, endsAt - Date.now());
  const timer = setTimeout(() => {
    pendingLeaveEndTimers.delete(gameId);
    void finalizeLeaveEnd(gameId, endedByUserId, endsAt).catch((err: any) => {
      console.error("[game/end] delayed finalize failed:", err?.message ?? err);
    });
  }, delayMs);
  timer.unref?.();
  pendingLeaveEndTimers.set(gameId, timer);
}

const ERROR_MESSAGES: Record<string, string> = {
  ERR_INVALID_PAYLOAD: "Invalid request payload",
  ERR_NOT_AUTHENTICATED: "Not authenticated",
  ERR_NOT_FOUND: "Not found",
  ERR_NOT_IN_GAME: "Not in this game",
  ERR_BATTLE_NOT_IN_PROGRESS: "Battle not in progress",
  ERR_INVALID_GAME_STATE: "Invalid game state",
  ERR_GAME_LOOP: "Game loop error",
  ERR_PICKUP_NOT_FOUND: "Pickup not found or already claimed",
  ERR_PICKUP_TOO_FAR: "Too far away to interact",
  ERR_PICKUP_CLAIM_TOO_FAR: "Too far away to pick up",
  ERR_PICKUP_HAND_FULL: "只能拾取6个技能",
  ERR_YUMEN_SPECTATOR_LOCKED: "观战中无法调整技能栏",
  ERR_ABILITY_NOT_FOUND: "Ability definition not found",
  ERR_CONSUMABLE_NOT_FOUND: "Consumable definition not found",
  ERR_CONSUMABLE_NOT_IMPLEMENTED: "Consumable is not implemented yet",
  ERR_CONSUMABLE_EMPTY: "Consumable is out of stock",
  ERR_CONSUMABLE_COOLDOWN: "Consumable is on cooldown",
  ERR_CONSUMABLE_IN_COMBAT: "Consumable cannot be used in combat",
  ERR_CONSUMABLE_CONTROLLED: "Consumable cannot be used while controlled",
  ERR_CONSUMABLE_DASHING: "Consumable cannot be used while dashing",
  ERR_INTERNAL: "Internal server error",
};

function toErrorCode(err: any): string {
  const raw = typeof err === "string" ? err : String(err?.message ?? "");
  if (/^ERR_[A-Z0-9_]+$/.test(raw)) return raw;
  if (raw === "Not in this game") return "ERR_NOT_IN_GAME";
  if (raw === "Battle not in progress") return "ERR_BATTLE_NOT_IN_PROGRESS";
  return "ERR_INTERNAL";
}

function sendGameError(res: express.Response, status: number, code: string, message?: string, extra?: Record<string, any>) {
  return res.status(status).json({
    error: code,
    code,
    message: message ?? ERROR_MESSAGES[code] ?? code,
    ...(extra ?? {}),
  });
}

function sendCaughtGameError(res: express.Response, err: any, status = 400) {
  const code = toErrorCode(err);
  return sendGameError(res, status, code, ERROR_MESSAGES[code] ?? err?.message ?? code);
}

type UiLayoutPosition = { left: number; top: number };
type UiLayoutViewport = { w: number; h: number };
type UiChatLayoutPayload = {
  panelSize: { width: number; height: number };
  settings?: { fontFamily: "simhei"; fontSize: number; backgroundOpacity: number };
  settingsModalSize?: { width: number; height: number };
  windows?: Array<{ id: string; name: string; channels: Array<"map" | "system" | "battle">; lockedName?: boolean; lockedDelete?: boolean }>;
  activeWindowId?: string;
  detachedWindows?: Array<{ id: string; windowIds: string[]; activeWindowId: string }>;
  detachedPanelSizes?: Record<string, { width: number; height: number }>;
};
type UiLayoutPayload = {
  positions: Record<string, UiLayoutPosition>;
  viewport: UiLayoutViewport | null;
  chat: UiChatLayoutPayload | null;
};

type MartialPresetPlan = {
  id: string;
  name: string;
  slots: Array<string | null>;
  updatedAt: string;
};

const MARTIAL_PRESET_LIMIT = 8;
const MARTIAL_PRESET_SLOT_COUNT = 6;

const CHAT_LAYOUT_DEFAULTS: UiChatLayoutPayload = {
  panelSize: { width: 548, height: 236 },
};
const DEFAULT_CHAT_WINDOWS: NonNullable<UiChatLayoutPayload["windows"]> = [
  { id: "combined", name: "综合", channels: ["map", "system"], lockedName: true, lockedDelete: true },
  { id: "map", name: "地图", channels: ["map"] },
  { id: "system", name: "系统", channels: ["system"] },
  { id: "battle", name: "战斗", channels: ["battle"] },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.max(min, Math.min(max, numeric)));
}

function sanitizeChatSettingsPayload(raw: unknown): NonNullable<UiChatLayoutPayload["settings"]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  return {
    fontFamily: "simhei",
    fontSize: normalizeNumberInRange(candidate.fontSize, 18, 15, 20),
    backgroundOpacity: normalizeNumberInRange(candidate.backgroundOpacity, 50, 0, 100),
  };
}

function sanitizeChatSettingsModalSizePayload(raw: unknown): NonNullable<UiChatLayoutPayload["settingsModalSize"]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  return {
    width: normalizeNumberInRange(candidate.width, 705, Math.round(705 * 0.5), Math.round(705 * 2)),
    height: normalizeNumberInRange(candidate.height, 495, Math.round(495 * 0.5), Math.round(495 * 2)),
  };
}

function sanitizeChatWindowName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? Array.from(value.trim()).slice(0, 8).join("") : "";
  return name || fallback;
}

function sanitizeChatWindowsPayload(raw: unknown): NonNullable<UiChatLayoutPayload["windows"]> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const defaultsById = new Map(DEFAULT_CHAT_WINDOWS.map((entry) => [entry.id, entry]));
  const usedIds = new Set<string>();
  const windows: NonNullable<UiChatLayoutPayload["windows"]> = [];

  for (const defaultWindow of DEFAULT_CHAT_WINDOWS) {
    const saved = raw.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as any).id === defaultWindow.id) as Record<string, unknown> | undefined;
    const channels = Array.isArray(saved?.channels)
      ? saved.channels.filter((channel): channel is "map" | "system" | "battle" => channel === "map" || channel === "system" || channel === "battle")
      : defaultWindow.channels;
    windows.push({
      ...defaultWindow,
      name: defaultWindow.lockedName ? defaultWindow.name : sanitizeChatWindowName(saved?.name, defaultWindow.name),
      channels: [...new Set(channels)],
    });
    usedIds.add(defaultWindow.id);
  }

  for (const entry of raw) {
    const candidate = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    const id = typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 48) : "";
    if (!id || usedIds.has(id) || defaultsById.has(id)) continue;
    const channels = Array.isArray(candidate?.channels)
      ? candidate.channels.filter((channel): channel is "map" | "system" | "battle" => channel === "map" || channel === "system" || channel === "battle")
      : [];
    windows.push({
      id,
      name: sanitizeChatWindowName(candidate?.name, `窗口${windows.length + 1}`),
      channels: [...new Set(channels)],
    });
    usedIds.add(id);
    if (windows.length >= 8) break;
  }

  return windows.slice(0, 8);
}

function sanitizeDetachedChatWindowsPayload(raw: unknown, windows: NonNullable<UiChatLayoutPayload["windows"]>): NonNullable<UiChatLayoutPayload["detachedWindows"]> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const validWindowIds = new Set(windows.map((entry) => entry.id));
  const assignedWindowIds = new Set<string>();
  const detachedWindows: NonNullable<UiChatLayoutPayload["detachedWindows"]> = [];
  const usedIds = new Set<string>();

  for (const entry of raw) {
    const candidate = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    const id = typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 64) : "";
    if (!id || usedIds.has(id)) continue;
    const rawWindowIds = Array.isArray(candidate?.windowIds)
      ? candidate.windowIds
      : typeof candidate?.windowId === "string"
      ? [candidate.windowId]
      : [];
    const windowIds = rawWindowIds
      .filter((windowId): windowId is string => typeof windowId === "string")
      .map((windowId) => windowId.trim().slice(0, 48))
      .filter((windowId) => windowId !== "combined" && validWindowIds.has(windowId) && !assignedWindowIds.has(windowId));
    if (windowIds.length === 0) continue;
    windowIds.forEach((windowId) => assignedWindowIds.add(windowId));
    const activeWindowCandidate = typeof candidate?.activeWindowId === "string" ? candidate.activeWindowId.trim() : "";
    detachedWindows.push({
      id,
      windowIds,
      activeWindowId: windowIds.includes(activeWindowCandidate) ? activeWindowCandidate : windowIds[0],
    });
    usedIds.add(id);
    if (detachedWindows.length >= 6) break;
  }

  return detachedWindows;
}

function sanitizeDetachedChatPanelSizesPayload(raw: unknown, detachedWindows: NonNullable<UiChatLayoutPayload["detachedWindows"]> | undefined): NonNullable<UiChatLayoutPayload["detachedPanelSizes"]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !detachedWindows?.length) return undefined;
  const validDetachedIds = new Set(detachedWindows.map((entry) => entry.id));
  const sizes: NonNullable<UiChatLayoutPayload["detachedPanelSizes"]> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!validDetachedIds.has(id) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const size = value as Record<string, unknown>;
    sizes[id] = {
      width: normalizeNumberInRange(size.width, CHAT_LAYOUT_DEFAULTS.panelSize.width, 120, 1400),
      height: normalizeNumberInRange(size.height, CHAT_LAYOUT_DEFAULTS.panelSize.height, 92, 1000),
    };
  }
  return Object.keys(sizes).length > 0 ? sizes : undefined;
}

function sanitizeChatLayoutPayload(raw: unknown): UiChatLayoutPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const panelCandidate = candidate.panelSize && typeof candidate.panelSize === "object" && !Array.isArray(candidate.panelSize)
    ? candidate.panelSize as Record<string, unknown>
    : {};

  const payload: UiChatLayoutPayload = {
    panelSize: {
      width: normalizeNumberInRange(panelCandidate.width, CHAT_LAYOUT_DEFAULTS.panelSize.width, 120, 1400),
      height: normalizeNumberInRange(panelCandidate.height, CHAT_LAYOUT_DEFAULTS.panelSize.height, 92, 1000),
    },
  };
  const settings = sanitizeChatSettingsPayload(candidate.settings);
  if (settings) payload.settings = settings;
  const settingsModalSize = sanitizeChatSettingsModalSizePayload(candidate.settingsModalSize);
  if (settingsModalSize) payload.settingsModalSize = settingsModalSize;
  const windows = sanitizeChatWindowsPayload(candidate.windows);
  if (windows) {
    payload.windows = windows;
    const activeWindowId = typeof candidate.activeWindowId === "string" ? candidate.activeWindowId.trim() : "";
    payload.activeWindowId = windows.some((entry) => entry.id === activeWindowId) ? activeWindowId : windows[0]?.id;
    const detachedWindows = sanitizeDetachedChatWindowsPayload(candidate.detachedWindows, windows);
    if (detachedWindows) {
      payload.detachedWindows = detachedWindows;
      const detachedPanelSizes = sanitizeDetachedChatPanelSizesPayload(candidate.detachedPanelSizes, detachedWindows);
      if (detachedPanelSizes) payload.detachedPanelSizes = detachedPanelSizes;
    }
  }
  return payload;
}

function mergeChatLayout(existing: UiChatLayoutPayload | null, incoming: UiChatLayoutPayload | null): UiChatLayoutPayload | null {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const merged: UiChatLayoutPayload = {
    panelSize: incoming.panelSize ?? existing.panelSize,
  };
  const settings = incoming.settings ?? existing.settings;
  if (settings) merged.settings = settings;
  const settingsModalSize = incoming.settingsModalSize ?? existing.settingsModalSize;
  if (settingsModalSize) merged.settingsModalSize = settingsModalSize;
  const windows = incoming.windows ?? existing.windows;
  if (windows) {
    merged.windows = windows;
    const activeWindowId = incoming.windows ? incoming.activeWindowId : existing.activeWindowId;
    merged.activeWindowId = windows.some((entry) => entry.id === activeWindowId) ? activeWindowId : windows[0]?.id;
  }
  const detachedWindows = incoming.detachedWindows ?? existing.detachedWindows;
  if (detachedWindows) merged.detachedWindows = detachedWindows;
  const detachedPanelSizes = incoming.detachedPanelSizes ?? existing.detachedPanelSizes;
  if (detachedPanelSizes) merged.detachedPanelSizes = detachedPanelSizes;
  return merged;
}

function sanitizeUiLayoutPayload(raw: unknown): UiLayoutPayload {
  const fallback: UiLayoutPayload = { positions: {}, viewport: null, chat: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const container = raw as { positions?: unknown; viewport?: unknown; chat?: unknown };
  const positionsSource =
    container.positions && typeof container.positions === "object" && !Array.isArray(container.positions)
      ? container.positions as Record<string, unknown>
      : raw as Record<string, unknown>;

  const positions: Record<string, UiLayoutPosition> = {};
  for (const [key, value] of Object.entries(positionsSource)) {
    if (key === "chat-clear-dialog") continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Partial<UiLayoutPosition>;
    if (!isFiniteNumber(candidate.left) || !isFiniteNumber(candidate.top)) continue;
    positions[key] = {
      left: Math.round(candidate.left),
      top: Math.round(candidate.top),
    };
  }

  const viewportCandidate = container.viewport;
  const viewport =
    viewportCandidate && typeof viewportCandidate === "object" && !Array.isArray(viewportCandidate)
    && isFiniteNumber((viewportCandidate as Partial<UiLayoutViewport>).w)
    && isFiniteNumber((viewportCandidate as Partial<UiLayoutViewport>).h)
    && (viewportCandidate as Partial<UiLayoutViewport>).w! > 0
    && (viewportCandidate as Partial<UiLayoutViewport>).h! > 0
      ? {
          w: Math.round((viewportCandidate as UiLayoutViewport).w),
          h: Math.round((viewportCandidate as UiLayoutViewport).h),
        }
      : null;

  return { positions, viewport, chat: sanitizeChatLayoutPayload(container.chat) };
}

function sanitizeMartialPresetName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? Array.from(value.trim()).slice(0, 8).join("") : "";
  return name || fallback;
}

function sanitizeMartialPresetSlots(raw: unknown): Array<string | null> {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return Array.from({ length: MARTIAL_PRESET_SLOT_COUNT }, (_, index) => {
    const value = source[index];
    if (typeof value !== "string") return null;
    const abilityId = value.trim();
    if (!abilityId || seen.has(abilityId)) return null;
    seen.add(abilityId);
    return abilityId ? abilityId : null;
  });
}

function sanitizeMartialPresetsPayload(raw: unknown): MartialPresetPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MARTIAL_PRESET_LIMIT).map((entry, index) => {
    const plan = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const id = typeof plan.id === "string" && plan.id.trim() ? plan.id.trim().slice(0, 64) : randomUUID();
    const fallbackName = `预设${index + 1}`;
    const updatedAtCandidate = typeof plan.updatedAt === "string" && !Number.isNaN(Date.parse(plan.updatedAt))
      ? plan.updatedAt
      : new Date().toISOString();
    return {
      id,
      name: sanitizeMartialPresetName(plan.name, fallbackName),
      slots: sanitizeMartialPresetSlots(plan.slots),
      updatedAt: updatedAtCandidate,
    };
  });
}

function sanitizeChatHistory(raw: unknown, displayNameByUserId: Map<string, string> = new Map()) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const candidate = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
    const channel = candidate.channel === "system" ? "system" : candidate.channel === "map" ? "map" : null;
    const userId = typeof candidate.userId === "string" && candidate.userId ? candidate.userId : "";
    const username = displayNameByUserId.get(userId)
      ?? (typeof candidate.username === "string" && candidate.username.trim() ? candidate.username.trim() : `User${userId.slice(-4)}`);
    const school = typeof candidate.school === "string" ? candidate.school : null;
    const variant = candidate.variant === "system" || userId === "system" ? "system" : "user";
    const text = typeof candidate.text === "string" ? candidate.text.slice(0, variant === "system" ? 240 : 180) : "";
    const timestamp = typeof candidate.timestamp === "number" && Number.isFinite(candidate.timestamp) ? candidate.timestamp : 0;
    if (!id || !channel || !userId || !text.trim() || timestamp <= 0) return null;
    return { id, channel, userId, username, school, text, timestamp, variant };
  }).filter(Boolean);
}

router.get("/:gameId/chat", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const game = await GameSession.findById(req.params.gameId).select("players chatMessages").lean();
    if (!game) {
      return sendGameError(res, 404, "ERR_NOT_FOUND");
    }

    const players = Array.isArray((game as any).players) ? (game as any).players.map(String) : [];
    if (!players.includes(userId)) {
      return sendGameError(res, 403, "ERR_NOT_IN_GAME");
    }

    const chatUserIds = [...new Set(
      (Array.isArray((game as any).chatMessages) ? (game as any).chatMessages : [])
        .map((message: any) => typeof message?.userId === "string" ? message.userId : "")
        .filter((id: string) => id && id !== "system")
    )];
    const users = chatUserIds.length > 0
      ? await User.find({ _id: { $in: chatUserIds } }).select("displayName username").lean()
      : [];
    const displayNameByUserId = new Map<string, string>();
    for (const user of users) {
      const id = String((user as any)._id);
      displayNameByUserId.set(id, normalizeStoredUserDisplayName((user as any).username, (user as any).displayName));
    }

    return res.json({ messages: sanitizeChatHistory((game as any).chatMessages, displayNameByUserId) });
  } catch (err: any) {
    console.error(`[CHAT_HISTORY_GET] ❌ ERROR: ${err.message}`);
    console.error(`[CHAT_HISTORY_GET] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err, 401);
  }
});

router.get("/ui-layout", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const user = await User.findById(userId).select("battleArenaUiLayout").lean();
    if (!user) {
      return sendGameError(res, 401, "ERR_NOT_AUTHENTICATED");
    }

    return res.json(sanitizeUiLayoutPayload((user as any).battleArenaUiLayout));
  } catch (err: any) {
    console.error(`[UI_LAYOUT_GET] ❌ ERROR: ${err.message}`);
    console.error(`[UI_LAYOUT_GET] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err, 401);
  }
});

router.put("/ui-layout", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const user = await User.findById(userId).select("battleArenaUiLayout").lean();
    if (!user) {
      return sendGameError(res, 401, "ERR_NOT_AUTHENTICATED");
    }

    const existingLayout = sanitizeUiLayoutPayload((user as any).battleArenaUiLayout);
    const layout = sanitizeUiLayoutPayload(req.body);
    const chat = mergeChatLayout(existingLayout.chat, layout.chat);
    const battleArenaUiLayout = {
      positions: layout.positions,
      viewport: layout.viewport,
      chat,
      updatedAt: new Date(),
    };
    await User.updateOne({ _id: userId }, { $set: { battleArenaUiLayout } });

    return res.json({ ...layout, chat });
  } catch (err: any) {
    console.error(`[UI_LAYOUT_PUT] ❌ ERROR: ${err.message}`);
    console.error(`[UI_LAYOUT_PUT] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

router.get("/martial-presets", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const user = await User.findById(userId).select("battleArenaMartialPresets").lean();
    if (!user) {
      return sendGameError(res, 401, "ERR_NOT_AUTHENTICATED");
    }

    return res.json({ plans: sanitizeMartialPresetsPayload((user as any).battleArenaMartialPresets) });
  } catch (err: any) {
    console.error(`[MARTIAL_PRESETS_GET] ❌ ERROR: ${err.message}`);
    console.error(`[MARTIAL_PRESETS_GET] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err, 401);
  }
});

router.put("/martial-presets", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const user = await User.findById(userId).select("_id").lean();
    if (!user) {
      return sendGameError(res, 401, "ERR_NOT_AUTHENTICATED");
    }

    const plans = sanitizeMartialPresetsPayload((req.body as any)?.plans);
    await User.updateOne({ _id: userId }, { $set: { battleArenaMartialPresets: plans } });

    return res.json({ plans });
  } catch (err: any) {
    console.error(`[MARTIAL_PRESETS_PUT] ❌ ERROR: ${err.message}`);
    console.error(`[MARTIAL_PRESETS_PUT] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

function normalizeTargetSelectionPayload(payload: any, state: GameState, userId: string): TargetSelection | undefined {
  if (!payload || payload.kind === "none") return undefined;

  if (payload.kind === "self") {
    return { kind: "self", userId };
  }

  if (payload.kind === "player" && typeof payload.userId === "string") {
    const targetPlayer = state.players.find((player) => player.userId === payload.userId);
    if (!targetPlayer) throw new Error("ERR_INVALID_PAYLOAD");
    if (targetPlayer.userId !== userId && blocksCardTargeting(targetPlayer as any)) return undefined;
    return targetPlayer.userId === userId ? { kind: "self", userId } : { kind: "player", userId: targetPlayer.userId };
  }

  if (payload.kind === "entity" && typeof payload.entityId === "string") {
    const targetEntity = (state.entities ?? []).find((entity: any) => entity?.id === payload.entityId && (entity.hp ?? 0) > 0);
    if (!targetEntity) throw new Error("ERR_INVALID_PAYLOAD");
    return { kind: "entity", entityId: targetEntity.id };
  }

  throw new Error("ERR_INVALID_PAYLOAD");
}

router.post("/play", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, abilityInstanceId, targetUserId, groundTarget, entityTargetId, movementIntent } = req.body;
    console.log(`[PLAY] Starting - userId: ${userId}, gameId: ${gameId}`);

    const patch = await playAbility(gameId, userId, abilityInstanceId, targetUserId, groundTarget, entityTargetId, typeof movementIntent === "boolean" ? movementIntent : undefined);
    console.log(`[PLAY] ✅ Complete - version: ${patch.version}`);
    res.json(patch);
  } catch (err: any) {
    console.error(`[PLAY] ❌ ERROR: ${err.message}`);
    console.error(`[PLAY] Stack: ${err.stack}`);
    sendCaughtGameError(res, err);
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
    sendCaughtGameError(res, err);
  }
});

router.post("/buff/cancel", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, buffId, entityTargetId } = req.body;
    const numericBuffId = Number(buffId);

    if (!gameId || !Number.isFinite(numericBuffId)) {
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const patch = await cancelPlayerBuff(gameId, userId, numericBuffId, { entityTargetId });
    return res.json(patch);
  } catch (err: any) {
    console.error(`[BUFF_CANCEL] ❌ ERROR: ${err.message}`);
    console.error(`[BUFF_CANCEL] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

router.post("/channel/cancel", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;
    if (!gameId || !userId) {
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }
    const patch = await cancelActiveChannelCast(gameId, userId);
    return res.json(patch);
  } catch (err: any) {
    console.error(`[CHANNEL_CANCEL] ❌ ERROR: ${err.message}`);
    console.error(`[CHANNEL_CANCEL] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

router.post("/consumable/use", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, consumableId } = req.body;
    if (!gameId || !userId || typeof consumableId !== "string") {
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const patch = await useConsumable(gameId, userId, consumableId);
    return res.json(patch);
  } catch (err: any) {
    console.error(`[CONSUMABLE_USE] ❌ ERROR: ${err.message}`);
    console.error(`[CONSUMABLE_USE] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

router.post("/target/selection", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, selection } = req.body;
    if (!gameId || !userId) {
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const loop = await ensureBattleLoop(gameId);
    if (!loop) {
      return sendGameError(res, 400, "ERR_BATTLE_NOT_IN_PROGRESS");
    }

    const state = loop.getState();
    const playerIndex = state.players.findIndex((player) => player.userId === userId);
    if (playerIndex === -1) {
      return sendGameError(res, 403, "ERR_NOT_IN_GAME");
    }

    const normalizedSelection = normalizeTargetSelectionPayload(selection, state, userId);
    const currentSelection = state.players[playerIndex].targetSelection;
    if (JSON.stringify(currentSelection ?? null) === JSON.stringify(normalizedSelection ?? null)) {
      return res.json({ version: state.version ?? 0, diff: [], events: state.events, serverTimestamp: Date.now() });
    }

    if (normalizedSelection) {
      state.players[playerIndex].targetSelection = normalizedSelection;
    } else {
      delete state.players[playerIndex].targetSelection;
    }
    state.version = (state.version ?? 0) + 1;
    loop.updateState(state);

    const diff = [
      { path: `/players/${playerIndex}/targetSelection`, value: normalizedSelection },
    ];

    void GameSession.findById(gameId).then((game) => {
      if (!game) return;
      game.state = state as any;
      game.markModified("state");
      return game.save();
    }).catch((err: any) => {
      console.error("[target/selection] async save failed:", err?.message ?? err);
    });

    broadcastGameUpdate({
      gameId,
      version: state.version,
      diff,
      timestamp: Date.now(),
    });

    return res.json({ version: state.version, diff, events: state.events, serverTimestamp: Date.now() });
  } catch (err: any) {
    console.error(`[TARGET_SELECTION] ❌ ERROR: ${err.message}`);
    console.error(`[TARGET_SELECTION] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

router.post("/end", async (req, res) => {
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId } = req.body;
    if (!gameId || !userId) {
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const game = await GameSession.findById(gameId);
    if (!game) {
      return sendGameError(res, 404, "ERR_NOT_FOUND", "Game not found");
    }
    if (!game.players.includes(userId)) {
      return sendGameError(res, 403, "ERR_NOT_IN_GAME");
    }

    const loop = await ensureBattleLoop(gameId, game);
    const state = loop?.getState() ?? game.state;
    if (!state) {
      return sendGameError(res, 400, "ERR_INVALID_GAME_STATE");
    }

    const existingNotice = (state as any).leaveNotice;
    if (existingNotice?.endsAt && existingNotice?.userId) {
      scheduleLeaveEnd(gameId, existingNotice.userId, existingNotice.endsAt);
      return res.json({
        ok: true,
        pending: true,
        version: state.version,
        diff: [{ path: "/leaveNotice", value: existingNotice }],
        serverTimestamp: Date.now(),
      });
    }

    const username = (game as any).playerNames?.[userId] ?? `User${String(userId).slice(-4)}`;
    const leaveNotice = { userId, username, endsAt: Date.now() + 5_000 };
    (state as any).leaveNotice = leaveNotice;
    state.version = (state.version ?? 0) + 1;

    loop?.updateState(state);
    game.state = state as any;
    game.markModified("state");
    void game.save().catch((err: any) => {
      console.error("[game/end] async save failed:", err?.message ?? err);
    });

    const diff = [
      { path: "/leaveNotice", value: leaveNotice },
    ];
    broadcastGameUpdate({
      gameId,
      version: state.version,
      diff,
      timestamp: Date.now(),
    });

    scheduleLeaveEnd(gameId, userId, leaveNotice.endsAt);

    return res.json({ ok: true, pending: true, version: state.version, diff, serverTimestamp: Date.now() });
  } catch (err: any) {
    console.error(`[GAME_END] ❌ ERROR: ${err.message}`);
    console.error(`[GAME_END] Stack: ${err.stack}`);
    return sendCaughtGameError(res, err);
  }
});

/**
 * POST /movement - Update player movement input (WASD)
 * Sends current pressed keys to game loop
 * Body: { gameId, direction: null | { up, down, left, right } }
 */
router.post("/movement", async (req, res) => {
  const serverReceivedAt = Date.now();
  try {
    const userId = getUserIdFromCookie(req);
    const { gameId, direction } = req.body;

    if (!gameId || !userId) {
      console.error('[MOVEMENT] Missing gameId or userId');
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const loop = await ensureBattleLoop(gameId);
    if (!loop) {
      const diagnostics = await getBattleLoopHydrationDiagnostics(gameId);
      console.warn(`[MOVEMENT] GameLoop not active for ${gameId}`, diagnostics);
      // Return 400 instead of crashing - battle may be pending start
      return sendGameError(res, 400, "ERR_BATTLE_NOT_IN_PROGRESS", undefined, { diagnostics });
    }

    try {
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
            backpedalOnly: direction.backpedalOnly === true,
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
      const movementClientSessionId = typeof req.body.movementClientSessionId === 'string'
        ? req.body.movementClientSessionId.slice(0, 128)
        : undefined;
      const movementClientStartedAt = typeof req.body.movementClientStartedAt === 'number' && Number.isFinite(req.body.movementClientStartedAt)
        ? req.body.movementClientStartedAt
        : undefined;
      const movementAck = loop.setPlayerInputForUser(
        userId,
        input,
        seq,
        movementClientSessionId
          ? { id: movementClientSessionId, startedAt: movementClientStartedAt ?? 0 }
          : undefined,
      );
      if (!movementAck) {
        console.warn(`[MOVEMENT] User ${userId} not found in game ${gameId}`);
        return sendGameError(res, 403, "ERR_NOT_IN_GAME");
      }
      
      // Return current position immediately so client can update without waiting for broadcast
      // Also include any pending input so client can predict the next position
      const serverRespondedAt = Date.now();
      const serverProcessingMs = serverRespondedAt - serverReceivedAt;
      if (serverProcessingMs >= 40) {
        recordLagProbe("movement-route-slow", {
          gameId,
          userId,
          seq: seq ?? null,
          accepted: movementAck.accepted,
          serverProcessingMs,
        });
      }
      res.json({ 
        success: true,
        accepted: movementAck.accepted,
        seq,
        position: movementAck.position,
        velocity: movementAck.velocity,
        input: input, // Send input back so client can predict next position
        serverReceivedAt,
        serverRespondedAt,
        serverTimestamp: serverRespondedAt,
        serverProcessingMs,
      });
    } catch (loopErr: any) {
      console.error(`[MOVEMENT] GameLoop error: ${loopErr.message}`);
      console.error(loopErr.stack);
      sendGameError(res, 500, "ERR_GAME_LOOP", loopErr.message);
    }
  } catch (err: any) {
    console.error(`[MOVEMENT] ❌ ERROR: ${err.message}`);
    console.error(err.stack);
    sendCaughtGameError(res, err);
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

function isCommonAbilityCard(card: any): boolean {
  const abilityId = card?.abilityId ?? card?.id;
  const def = abilityId ? ABILITIES[abilityId] : undefined;
  if (def) return !!(def as any).isCommon;
  return !!card?.isCommon;
}

function getDraftCardAbilityId(card: any): string | null {
  const abilityId = card?.abilityId ?? card?.id;
  return typeof abilityId === "string" && abilityId.trim() ? abilityId.trim() : null;
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

function normalizeDraftSlotIndex(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(MAX_DRAFT_HAND - 1, fallback));
  return Math.max(0, Math.min(MAX_DRAFT_HAND - 1, Math.round(numeric)));
}

function normalizeDraftCardSlots<T extends Record<string, any>>(cards: T[]): T[] {
  const assigned: Array<T | undefined> = Array.from({ length: MAX_DRAFT_HAND });
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
    if (openIndex >= 0) assigned[openIndex] = { ...card, slotIndex: openIndex };
  });
  return assigned.filter(Boolean) as T[];
}

function getFirstAvailableDraftSlot(cards: Array<Record<string, any>>): number | null {
  const normalized = normalizeDraftCardSlots(cards);
  if (normalized.length >= MAX_DRAFT_HAND) return null;
  const occupied = new Set(normalized.map((card) => normalizeDraftSlotIndex(card.slotIndex, 0)));
  for (let slotIndex = 0; slotIndex < MAX_DRAFT_HAND; slotIndex += 1) {
    if (!occupied.has(slotIndex)) return slotIndex;
  }
  return null;
}

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
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const loop = await ensureBattleLoop(gameId);
    if (!loop) {
      return sendGameError(res, 400, "ERR_BATTLE_NOT_IN_PROGRESS");
    }

    const state = loop.getState();
    const playerIndex = state.players.findIndex((p) => p.userId === userId);
    if (playerIndex === -1) {
      return sendGameError(res, 403, "ERR_NOT_IN_GAME");
    }

    const pickup = (state.pickups ?? []).find((p) => p.id === pickupId);
    if (!pickup) {
      return sendGameError(res, 404, "ERR_PICKUP_NOT_FOUND");
    }

    // Check distance (3D — includes Z height)
    const player = state.players[playerIndex];
    const storedUnitScale = state.unitScale ?? NEW_WORLD_UNIT_SCALE;
    const interactRange = PICKUP_INTERACT_RANGE * storedUnitScale;
    const dx = player.position.x - pickup.position.x;
    const dy = player.position.y - pickup.position.y;
    const dz = player.position.z ?? 0;
    if (dx * dx + dy * dy + dz * dz > interactRange * interactRange) {
      return sendGameError(res, 400, "ERR_PICKUP_TOO_FAR");
    }

    const abilityDef = ABILITIES[pickup.abilityId];
    if (!abilityDef) {
      return sendGameError(res, 400, "ERR_ABILITY_NOT_FOUND");
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
    sendCaughtGameError(res, err, 500);
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
      return sendGameError(res, 400, "ERR_INVALID_PAYLOAD");
    }

    const loop = await ensureBattleLoop(gameId);
    if (!loop) {
      return sendGameError(res, 400, "ERR_BATTLE_NOT_IN_PROGRESS");
    }

    const loopState = loop.getState();
    const playerIndex = loopState.players.findIndex((p) => p.userId === userId);
    if (playerIndex === -1) {
      return sendGameError(res, 403, "ERR_NOT_IN_GAME");
    }

    const pickupIdx = (loopState.pickups ?? []).findIndex((p) => p.id === pickupId);
    if (pickupIdx === -1) {
      return sendGameError(res, 404, "ERR_PICKUP_NOT_FOUND");
    }

    const pickup = loopState.pickups[pickupIdx];

    // Check distance — claim allows up to PICKUP_CLAIM_RANGE so player can walk away after channeling
    const player = loopState.players[playerIndex];
    const game = await GameSession.findById(gameId);
    if (isYumen1v1BasicMode((game as any)?.mode) && hasActiveYumenSpectatorBuff(player as any)) {
      return sendGameError(res, 400, "ERR_YUMEN_SPECTATOR_LOCKED");
    }
    const storedUnitScale = loopState.unitScale ?? NEW_WORLD_UNIT_SCALE;
    const claimRange = PICKUP_CLAIM_RANGE * storedUnitScale;
    const dx = player.position.x - pickup.position.x;
    const dy = player.position.y - pickup.position.y;
    const dz = player.position.z ?? 0;
    if (dx * dx + dy * dy + dz * dz > claimRange * claimRange) {
      return sendGameError(res, 400, "ERR_PICKUP_CLAIM_TOO_FAR");
    }

    const draftCards = player.hand.filter((card: any) => !isCommonAbilityCard(card));
    const commonCards = player.hand.filter((card: any) => isCommonAbilityCard(card));
    if (draftCards.some((card: any) => getDraftCardAbilityId(card) === pickup.abilityId)) {
      return sendGameError(res, 400, "ERR_PICKUP_ALREADY_LEARNED");
    }
    const firstOpenSlot = getFirstAvailableDraftSlot(draftCards);
    if (firstOpenSlot === null) {
      return sendGameError(res, 400, "ERR_PICKUP_HAND_FULL");
    }

    const abilityDef = ABILITIES[pickup.abilityId];
    if (!abilityDef) {
      return sendGameError(res, 400, "ERR_ABILITY_NOT_FOUND");
    }

    const newInstance = {
      instanceId: randomUUID(),
      abilityId:  pickup.abilityId,
      cooldown:   0,
      slotIndex:  firstOpenSlot,
    };
    const fullCard = { ...abilityDef, ...newInstance };

    // Remove pickup and add ability to hand in live state
    loopState.pickups.splice(pickupIdx, 1);
    loopState.players[playerIndex] = {
      ...loopState.players[playerIndex],
      hand: [...normalizeDraftCardSlots([...draftCards, fullCard]), ...commonCards],
    };
    loop.updateState(loopState);

    // Persist to DB
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
    sendCaughtGameError(res, err, 500);
  }
});

export default router;
