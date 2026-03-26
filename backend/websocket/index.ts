/**
 * WebSocket server setup
 * Handles WebSocket upgrade, authentication, and message handling
 */

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { subscriptionManager } from "./GameSubscriptionManager";

export interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  gameId?: string;
  isAlive?: boolean;
}

const WS_DEBUG_LOGS = process.env.WS_DEBUG_LOGS === "1";
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

export function setupWebSocket(server: HTTPServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  console.log("🔌 WebSocket server initialized on path /ws");

  // Log when clients try to connect but before they authenticate
  wss.on("connection", (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
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

    ws.userId = verified.userId;
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
    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "PING":
            // Echo back PONG with the same timestamp for RTT measurement
            ws.send(JSON.stringify({ type: "PONG", timestamp: message.timestamp }));
            ws.isAlive = true;
            break;

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
    ws.on("close", () => {
      wsLog(
        `[WS] User ${ws.userId} disconnected from game ${ws.gameId}`
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
        ws.terminate();
        subscriptionManager.unsubscribe(ws);
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
