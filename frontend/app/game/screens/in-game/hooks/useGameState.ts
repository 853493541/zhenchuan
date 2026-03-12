"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardInstance, GameResponse } from "../types";

/* ================= DIFF APPLY ================= */

type DiffPatch = {
  path: string;
  value: any;
};

function applyDiff<T extends object>(prev: T, diff: DiffPatch[]): T {
  const next = structuredClone(prev);

  for (const { path, value } of diff) {
    // full replace
    if (path === "/") {
      return value;
    }

    const keys = path.split("/").filter(Boolean);
    let target: any = next;

    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
      if (target == null) return next;
    }

    const lastKey = keys[keys.length - 1];
    if (value === undefined) {
      delete target[lastKey];
    } else {
      target[lastKey] = value;
    }
  }

  return next;
}

/* ================= WEBSOCKET MESSAGE TYPES ================= */

type WSMessage = {
  type: "STATE_DIFF" | "GAME_OVER" | "PONG";
  version?: number;
  diff?: DiffPatch[];
  events?: any[];
  winnerUserId?: string;
};

/* ================= HOOK ================= */

export function useGameState(gameId: string, selfUserId: string, initialAuthToken?: string) {
  const [game, setGame] = useState<GameResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);

  // track last known version
  const versionRef = useRef<number>(0);
  
  // WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /* ================= INITIAL SNAPSHOT ================= */

  const fetchInitialGame = useCallback(async () => {
    const res = await fetch(`/api/game/${gameId}`, {
      credentials: "include",
    });

    if (!res.ok) {
      setLoading(false);
      return;
    }

    const full = await res.json();
    versionRef.current = full.state.version;
    setGame(full);
    setLoading(false);
  }, [gameId]);

  useEffect(() => {
    fetchInitialGame();
  }, [fetchInitialGame]);

  /* ================= WEBSOCKET CONNECTION ================= */

  const connectWebSocket = useCallback(async () => {
    if (wsRef.current) return; // Already connecting/connected

    let token = initialAuthToken;

    // If no token provided, try to fetch it
    if (!token) {
      try {
        console.log("[WS] 1️⃣ Fetching token from /api/auth/token...");
        const res = await fetch("/api/auth/token", {
          credentials: "include",
        });

        console.log(`[WS] 2️⃣ Token endpoint response: ${res.status}`);

        if (!res.ok) {
          const err = await res.text();
          console.error("[WS] ❌ Token endpoint failed:", res.status, err);
          // Retry after delay
          if (!reconnectTimeoutRef.current) {
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
          }
          return;
        }

        const data = await res.json();
        token = data.token;

        if (!token) {
          console.error("[WS] ❌ No token in response:", data);
          return;
        }
        console.log(`[WS] 3️⃣ Got token: ${token.substring(0, 30)}...`);
      } catch (err) {
        console.error("[WS] ❌ Failed to fetch token:", err);
        // Retry after delay
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
        }
        return;
      }
    }

    // Build WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/ws?gameId=${gameId}&token=${token}`;

    console.log(`[WS] 4️⃣ Creating WebSocket connection`);
    console.log(`[WS] Protocol: ${protocol}`);
    console.log(`[WS] Host: ${window.location.host}`);
    console.log(`[WS] GameID: ${gameId}`);
    console.log(`[WS] URL: ${wsUrl.substring(0, 100)}...`);

    const ws = new WebSocket(wsUrl);

    console.log(`[WS] 5️⃣ WebSocket object created, readyState: ${ws.readyState}`);
    console.log(`[WS] Initial state check - ReadyState ${ws.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);
    console.log(`[WS] URL being attempted:`, wsUrl);
    console.log(`[WS] Full request details:`, {
      url: wsUrl,
      protocol: protocol,
      host: window.location.host,
      secured: window.location.protocol === "https:"
    });

    // Track readyState changes
    const stateCheckInterval = setInterval(() => {
      if (ws.readyState !== 0) {
        console.log(`[WS] ⚠️ ReadyState changed to ${ws.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);
        clearInterval(stateCheckInterval);
      }
    }, 100);

    // Set a timeout to see if connection never opens
    const connectionTimeoutRef = setTimeout(() => {
      console.error(`[WS] ❌ Connection timeout after 5 seconds - readyState: ${ws.readyState}`);
      console.error(`[WS] URL was: ${wsUrl}`);
      console.error(`[WS] If readyState=0, connection is stuck in CONNECTING state`);
      console.error(`[WS] If readyState=3, connection was closed`);
    }, 5000);

    ws.onopen = () => {
      clearTimeout(connectionTimeoutRef);
      clearInterval(stateCheckInterval);
      console.log("[WS] 6️⃣✅ WebSocket OPENED successfully!");
      console.log("[WS] Connection established - readyState:", ws.readyState);
      wsRef.current = ws;

      // Clear reconnect timeout if it was set
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Start heartbeat
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "PING" }));
        }
      }, 25000); // Every 25 seconds
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);

        if (message.type === "PONG") {
          // Keep-alive pong, ignore
          return;
        }

        if (message.type === "STATE_DIFF" || message.type === "GAME_OVER") {
          if (!message.diff || message.diff.length === 0) return;

          versionRef.current = message.version ?? 0;

          setGame((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              state: applyDiff(prev.state, message.diff!),
            };
          });

          console.log(
            `[WS] Received ${message.diff.length} patches (v${message.version})`
          );
        }
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(connectionTimeoutRef);
      clearInterval(stateCheckInterval);
      console.error("[WS] 7️⃣❌ WebSocket ERROR event fired!");
      console.error("[WS] Error details:");
      console.error("  - Error object:", err);
      console.error("  - Error message:", (err as any)?.message);
      console.error("  - ReadyState:", ws.readyState, "(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)");
      console.error("  - URL:", ws.url);
      console.error("  - Protocol negotiated:", ws.protocol);
      console.error("  - Extensions:", (ws as any).extensions);
      
      // Check if it's a network error
      if ((err as any)?.code === 'ECONNREFUSED' || (err as any)?.message?.includes('refused')) {
        console.error("[WS] ⚠️ Connection refused - backend might not be accepting connections");
      }
    };

    ws.onclose = () => {
      clearTimeout(connectionTimeoutRef);
      clearInterval(stateCheckInterval);
      console.log("[WS] 8️⃣ WebSocket CLOSE event fired");
      console.log("[WS] Closure details:", {
        code: (ws as any).code,
        reason: (ws as any).reason,
        wasClean: (ws as any).wasClean,
        readyState: ws.readyState
      });
      console.log("[WS] Closure reason explanation:");
      const code = (ws as any).code;
      if (code === 1000) console.log("  - Normal closure");
      else if (code === 1001) console.log("  - Going away");
      else if (code === 1002) console.log("  - Protocol error");
      else if (code === 1003) console.log("  - Unsupported data");
      else if (code === 1006) console.log("  - Abnormal closure (no close frame received)");
      else if (code === 1007) console.log("  - Invalid frame payload");
      else if (code === 1008) console.log("  - Policy violation");
      else if (code === 1011) console.log("  - Unexpected error on server");
      else console.log(`  - Unknown code: ${code}`);
      
      wsRef.current = null;

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Try to reconnect after 2 seconds
      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectWebSocket();
        }, 2000);
      }
    };
  }, [gameId, initialAuthToken]);

  // Connect WebSocket when game is loaded
  useEffect(() => {
    if (game && !wsRef.current) {
      connectWebSocket();
    }

    return () => {
      // Cleanup on unmount
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [game, connectWebSocket]);

  /* ================= GUARDS ================= */

  if (!game) {
    return {
      loading,
      state: null,
      me: null,
      opponent: null,
      isMyTurn: false,
      isWinner: false,
      playCard: async () => ({ ok: false }),
      endTurn: async () => ({ ok: false }),
    };
  }

  const state = game.state;
  const players = state.players;

  const meIndex = players.findIndex(
    (p) => p.userId === selfUserId
  );
  const opponentIndex = meIndex === 0 ? 1 : 0;

  const me = players[meIndex];
  const opponent = players[opponentIndex];

  const isMyTurn = state.activePlayerIndex === meIndex;
  const isWinner = state.winnerUserId === selfUserId;

  /* ================= PLAY CARD ================= */

  const playCard = async (card: CardInstance) => {
    if (!isMyTurn || playing || state.gameOver) {
      return { ok: false };
    }

    setPlaying(true);
    try {
      const res = await fetch("/api/game/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          gameId,
          cardInstanceId: card.instanceId,
        }),
      });

      if (!res.ok) {
        return { ok: false, error: await res.text() };
      }

      const patch = await res.json();
      versionRef.current = patch.version;

      setGame((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          state: applyDiff(prev.state, patch.diff),
        };
      });

      return { ok: true };
    } finally {
      setPlaying(false);
    }
  };

  /* ================= END TURN ================= */

  const endTurn = async () => {
    if (!isMyTurn || playing || state.gameOver) {
      return { ok: false };
    }

    setPlaying(true);
    try {
      const res = await fetch("/api/game/pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameId }),
      });

      if (!res.ok) {
        return { ok: false, error: await res.text() };
      }

      const patch = await res.json();
      versionRef.current = patch.version;

      setGame((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          state: applyDiff(prev.state, patch.diff),
        };
      });

      return { ok: true };
    } finally {
      setPlaying(false);
    }
  };

  return {
    loading,
    state,
    me,
    opponent,
    isMyTurn,
    isWinner,
    playCard,
    endTurn,
  };
}
