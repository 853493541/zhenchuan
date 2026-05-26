/**
 * WebSocket server setup
 * Handles WebSocket upgrade, authentication, and message handling
 */

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { subscriptionManager, type ChatMessagePayload } from "./GameSubscriptionManager";
import GameSession from "../game/models/GameSession";
import { normalizeStoredUserDisplayName, User } from "../models/User";
import { createChatMessageId, persistAndBroadcastChatMessage } from "../game/services/chatMessages";

export interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  username?: string;
  school?: string | null;
  gameId?: string;
  isAlive?: boolean;
  terminatedByHeartbeat?: boolean;
}

const WS_DEBUG_LOGS = process.env.WS_DEBUG_LOGS === "1";
const MAX_CHAT_MESSAGE_LENGTH = 180;
const wsLog = (...args: any[]) => {
  if (WS_DEBUG_LOGS) console.log(...args);
};

function extractUserIdFromUrl(url: string): {
  gameId: string;
  token: string;
} | null {
  // ws://localhost:5000/ws?gameId=123&token=abc
  const urlObj = new URL(url, "http://localhost");
  const gameId = urlObj.searchParams.get("gameId");
  const token = urlObj.searchParams.get("token");

  if (!gameId || !token) return null;
  return { gameId, token };
}

function verifyToken(token: string): { userId: string } | null {
  try {
    const secret = process.env.JWT_SECRET || "your-secret";
    const decoded = jwt.verify(token, secret) as { uid?: string; userId?: string };
    const userId = decoded.uid || decoded.userId;
    if (!userId) return null;
    return { userId };
  } catch (err: any) {
    console.error(`[WS] Token verification failed: ${err.message}`);
    return null;
  }
}

function sanitizeChatText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

function getPlayerUsername(game: any, userId: string): string {
  return game?.playerNames?.[userId]
    ?? game?.state?.players?.find((player: any) => player?.userId === userId)?.username
    ?? `User${String(userId).slice(-4)}`;
}

function getPlayerSchool(game: any, userId: string): string | null {
  const school = game?.playerSchools?.[userId];
  return typeof school === "string" ? school : null;
}

async function loadGameMembership(gameId: string, userId: string): Promise<{ ok: boolean; username?: string; school?: string | null }> {
  const game = await GameSession.findById(gameId).select("players playerNames playerSchools state").lean();
  if (!game) return { ok: false };
  const players = Array.isArray((game as any).players) ? (game as any).players : [];
  if (!players.includes(userId)) return { ok: false };
  return { ok: true, username: getPlayerUsername(game, userId), school: getPlayerSchool(game, userId) };
}

async function broadcastMapChat(ws: AuthenticatedWebSocket, message: any) {
  const gameId = ws.gameId;
  const userId = ws.userId;
  if (!gameId || !userId) return;

  const text = sanitizeChatText(message.text);
  if (!text) return;

  const timestamp = Date.now();
  const currentUser = await User.findById(userId).select("displayName username school").lean();
  const username = currentUser ? normalizeStoredUserDisplayName(currentUser.username, currentUser.displayName) : ws.username || `User${String(userId).slice(-4)}`;
  const school = typeof currentUser?.school === "string" ? currentUser.school : ws.school ?? null;
  const chat: ChatMessagePayload = {
    id: createChatMessageId(userId, timestamp),
    channel: "map",
    userId,
    username,
    school,
    text,
    timestamp,
    variant: "user",
  };

  await persistAndBroadcastChatMessage(gameId, chat, userId);
}

export function setupWebSocket(server: HTTPServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  console.log("🔌 WebSocket server initialized on path /ws");

  // Log when clients try to connect but before they authenticate
  wss.on("connection", async (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    wsLog("[WS] Backend: 1️⃣ New connection attempt received!");
    wsLog("[WS] Backend: Connection details:");
    wsLog("[WS]   - URL:", req.url);
    wsLog("[WS]   - Method:", req.method);
    wsLog("[WS]   - Headers:", {
      host: req.headers.host,
      origin: req.headers.origin,
      "user-agent": req.headers["user-agent"],
      upgrade: req.headers.upgrade,
      connection: req.headers.connection,
    });
    wsLog("[WS]   - Remote address:", req.socket.remoteAddress);
    
    // Extract and verify credentials
    const credentials = extractUserIdFromUrl(req.url || "");
    if (!credentials) {
      wsLog(`[WS] Backend: 2️⃣❌ Missing gameId or token in URL: ${req.url}`);
      ws.close(4000, "Missing gameId or token");
      return;
    }

    wsLog(`[WS] Backend: 3️⃣ Extracted - gameId: ${credentials.gameId}`);
    wsLog(`[WS] Backend: Token: ${credentials.token.substring(0, 30)}...`);
    wsLog(`[WS] Backend: 4️⃣ Verifying token...`);

    const verified = verifyToken(credentials.token);
    if (!verified) {
      wsLog("[WS] Backend: 5️⃣❌ Token verification failed!");
      ws.close(4001, "Invalid token");
      return;
    }

    let membership: { ok: boolean; username?: string; school?: string | null };
    try {
      membership = await loadGameMembership(credentials.gameId, verified.userId);
    } catch (err) {
      console.error(`[WS] Game membership lookup failed for ${credentials.gameId}/${verified.userId}:`, err);
      ws.close(1011, "Game membership lookup failed");
      return;
    }

    if (!membership.ok) {
      wsLog(`[WS] Backend: 5️⃣❌ User ${verified.userId} is not in game ${credentials.gameId}`);
      ws.close(4003, "Not in game");
      return;
    }

    ws.userId = verified.userId;
    ws.username = membership.username;
    ws.school = membership.school ?? null;
    ws.gameId = credentials.gameId;
    ws.isAlive = true;

    wsLog(
      `[WS] Backend: 6️⃣✅ User ${ws.userId} connected to game ${ws.gameId}`
    );

    // Subscribe to game updates
    wsLog("[WS] Backend: 7️⃣ Adding to subscription manager...");
    subscriptionManager.subscribe(ws, credentials.gameId, verified.userId);
    wsLog("[WS] Backend: 8️⃣ Subscription complete!");

    // Handle incoming messages
    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        const serverReceivedAt = Date.now();

        switch (message.type) {
          case "PING": {
            const serverSentAt = Date.now();
            ws.send(JSON.stringify({
              type: "PONG",
              timestamp: message.timestamp,
              clientSentAt: typeof message.clientSentAt === "number" ? message.clientSentAt : message.timestamp,
              sequence: typeof message.sequence === "number" ? message.sequence : undefined,
              serverReceivedAt,
              serverSentAt,
              serverTimestamp: serverSentAt,
              serverProcessingMs: serverSentAt - serverReceivedAt,
            }));
            ws.isAlive = true;
            break;
          }

          case "CHAT_MESSAGE": {
            if (message.channel === "map") {
              await broadcastMapChat(ws, message);
            }
            ws.isAlive = true;
            break;
          }

          default:
            wsLog(`[WS] Unknown message type: ${message.type}`);
        }
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    });

    // Handle ping/pong for keepalive
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Handle disconnect
    ws.on("close", (code: number, reason: Buffer) => {
      console.warn(
        `[WS] User ${ws.userId} disconnected from game ${ws.gameId}`,
        {
          code,
          reason: reason.toString("utf8").slice(0, 120),
          wasAlive: ws.isAlive === true,
          terminatedByHeartbeat: ws.terminatedByHeartbeat === true,
        }
      );
      subscriptionManager.unsubscribe(ws);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error:`, err);
    });
  });

  // Log WebSocket server-level errors
  wss.on("error", (err) => {
    console.error("[WS] WebSocket Server Error:", err);
  });

  // Log when server is closed
  wss.on("close", () => {
    wsLog("[WS] WebSocket Server closed");
  });

  // Heartbeat interval to detect dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: AuthenticatedWebSocket) => {
      if (ws.isAlive === false) {
        ws.terminatedByHeartbeat = true;
        console.warn(`[WS] Terminating inactive client ${ws.userId} for game ${ws.gameId}`);
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 10000); // 10 seconds

  // Cleanup on server close
  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  return wss;
}
