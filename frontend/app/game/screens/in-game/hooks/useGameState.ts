"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AbilityInstance, GameResponse } from "../types";

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
  type: "STATE_DIFF" | "GAME_OVER" | "PONG" | "PING";
  version?: number;
  diff?: DiffPatch[];
  events?: any[];
  winnerUserId?: string;
  timestamp?: number; // Server timestamp for RTT measurement
  serverTimestamp?: number;
};

const ABSOLUTE_SERVER_TIME_KEYS = new Set([
  "expiresAt",
  "appliedAt",
  "startedAt",
  "lastTickAt",
  "timestamp",
]);

function normalizeServerTimes<T>(value: T, offsetMs: number): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeServerTimes(entry, offsetMs)) as T;
  }

  const normalized: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value as Record<string, any>)) {
    if (typeof entry === "number" && ABSOLUTE_SERVER_TIME_KEYS.has(key)) {
      normalized[key] = entry + offsetMs;
      continue;
    }
    normalized[key] = normalizeServerTimes(entry, offsetMs);
  }

  return normalized as T;
}

function normalizeDiffTimestamps(diff: DiffPatch[], offsetMs: number): DiffPatch[] {
  return diff.map((patch) => ({
    ...patch,
    value: normalizeServerTimes(patch.value, offsetMs),
  }));
}

function normalizeGamePayloadTimestamps<T extends { state?: any }>(payload: T, offsetMs: number): T {
  if (!payload?.state) return payload;
  return {
    ...payload,
    state: normalizeServerTimes(payload.state, offsetMs),
  };
}

/* ================= HOOK ================= */

export function useGameState(gameId: string, selfUserId: string, initialAuthToken?: string) {
  const [game, setGame] = useState<GameResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [rtt, setRtt] = useState<number | null>(null); // Network latency

  // track last known version
  const versionRef = useRef<number>(0);
  // Per-opponent position buffers, keyed by userId. Updated directly in WS handler
  // to bypass React setState + re-render delay (~16-32ms).
  const opponentPositionBufferRef = useRef<Map<string, Array<{ t: number; pos: { x: number; y: number } }>>>(new Map());
  const meIndexRef = useRef<number>(-1); // set once when game loads, never changes
  // Stable index→userId mapping so WS handler can resolve opponents without stale closure
  const playerIdsRef = useRef<string[]>([]);
  const rttRef = useRef<number | null>(null);
  const serverTimeOffsetRef = useRef<number>(0);
  
  // WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const updateServerTimeOffset = useCallback((serverTimestamp?: number, clientReceivedAt = Date.now()) => {
    if (typeof serverTimestamp !== "number" || !Number.isFinite(serverTimestamp)) {
      return serverTimeOffsetRef.current;
    }

    const oneWayLatencyMs = rttRef.current !== null ? Math.max(0, rttRef.current / 2) : 0;
    serverTimeOffsetRef.current = clientReceivedAt - (serverTimestamp + oneWayLatencyMs);
    return serverTimeOffsetRef.current;
  }, []);

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
    const snapshotReceivedAt = Date.now();
    const offsetMs = updateServerTimeOffset(full.serverTimestamp, snapshotReceivedAt);
    const normalizedFull = normalizeGamePayloadTimestamps(full, offsetMs);
    console.log("[useGameState] Snapshot fetched:", {
      hasGame: !!normalizedFull,
      hasTournament: !!normalizedFull.tournament,
      tournamentPhase: normalizedFull.tournament?.phase,
      gameId: normalizedFull._id,
    });

    versionRef.current = normalizedFull.state.version ?? 0;
    // Compute and cache meIndex + playerIds so WS handler can identify opponent patches
    meIndexRef.current = normalizedFull.state.players.findIndex((p: any) => p.userId === selfUserId);
    playerIdsRef.current = normalizedFull.state.players.map((p: any) => p.userId as string);
    setGame(normalizedFull);
    setLoading(false);
  }, [gameId, selfUserId, updateServerTimeOffset]);

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

      // Heartbeat + RTT measurement every second
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "PING", timestamp: Date.now() }));
        }
      }, 1000); // Every 1 second (was 25 seconds)
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        const receiveTime = performance.now();
        const receiveDateNow = Date.now();

        if (message.type === "PONG") {
          // Measure RTT from ping/pong
          if (message.timestamp) {
            const rttValue = receiveDateNow - message.timestamp;
            rttRef.current = rttValue;
            setRtt((prev) => (prev === rttValue ? prev : rttValue));
          }
          updateServerTimeOffset(message.serverTimestamp, receiveDateNow);
          return;
        }

        if (message.type === "STATE_DIFF" || message.type === "GAME_OVER") {
          if (!message.diff || message.diff.length === 0) return;

          const offsetMs = updateServerTimeOffset(message.timestamp, receiveDateNow);
          const normalizedDiff = normalizeDiffTimestamps(message.diff, offsetMs);



          // Push opponent position patches IMMEDIATELY with accurate timestamp.
          // This bypasses React setState + re-render + useEffect delay (~16-32ms variable).
          // We track all players by userId so it works with N players.
          for (const patch of normalizedDiff) {
            const match = patch.path.match(/^\/players\/(\d+)\/position$/);
            if (match && patch.value?.x !== undefined) {
              const pIdx = parseInt(match[1]);
              if (pIdx !== meIndexRef.current) {
                const userId = playerIdsRef.current[pIdx];
                if (userId) {
                  const buf = opponentPositionBufferRef.current.get(userId) ?? [];
                  buf.push({ t: receiveTime, pos: patch.value });
                  const cutoff = receiveTime - 1000;
                  opponentPositionBufferRef.current.set(userId, buf.filter(e => e.t >= cutoff));
                }
              }
            }
          }

          versionRef.current = message.version ?? 0;

          setGame((prev) => {
            if (!prev) return prev;
            
            // Separate tournament and state patches based on path prefix
            const tournamentKeys = ["phase", "economy", "selectedAbilities", "bench", "shop", "battleNumber"];
            const tournamentPatches = normalizedDiff.filter(p => {
              const firstKey = p.path.split("/").filter(Boolean)[0] ?? ""; // handles /key and //key paths
              return tournamentKeys.includes(firstKey);
            });
            const statePatches = normalizedDiff.filter(p => !tournamentPatches.includes(p));
            
            let updated = prev;
            
            // Apply state patches to game.state
            if (statePatches.length > 0) {
              updated = {
                ...updated,
                state: applyDiff(updated.state, statePatches),
              };
            }
            
            // Apply tournament patches to game.tournament
            if (tournamentPatches.length > 0 && updated.tournament) {
              updated = {
                ...updated,
                tournament: applyDiff(updated.tournament, tournamentPatches),
              };
            }

            // Keep index->userId and me index synced after every diff apply
            playerIdsRef.current = updated.state.players.map((p: any) => p.userId as string);
            meIndexRef.current = updated.state.players.findIndex((p: any) => p.userId === selfUserId);
            
            return updated;
          });

          // Disabled: spam during testing
          // console.log(
          //   `[WS] Received ${message.diff.length} patches (v${message.version})`
          // );
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

      // Try to reconnect after 2 seconds; fetch a fresh snapshot so any
      // state changes that happened while WS was down are recovered.
      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          fetchInitialGame();
          connectWebSocket();
        }, 2000);
      }
    };
  }, [gameId, initialAuthToken, fetchInitialGame, selfUserId, updateServerTimeOffset]);

  // Connect WebSocket when game is loaded — connect once, keep alive, only close on unmount
  useEffect(() => {
    if (!game || loading) return; // Wait until game data is loaded
    if (wsRef.current) return;   // Already connected
    connectWebSocket();
    // NO cleanup here — cleanup is handled by the separate unmount effect below
  }, [gameId, loading]);

  // Cleanup only on unmount or gameId change (NOT on loading/refetch changes)
  useEffect(() => {
    return () => {
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
  }, [gameId]);

  /* ================= GUARDS ================= */

  if (!game) {
    return {
      loading,
      state: null,
      me: null,
      opponent: null,
      opponents: [],
      isMyTurn: false,
      isWinner: false,
      playAbility: async () => ({ ok: false }),
      endTurn: async () => ({ ok: false }),
      rtt,
    };
  }

  const state = game.state;
  const players = state.players;

  const meIndex = players.findIndex(
    (p) => p.userId === selfUserId
  );

  // Guard: if player not found in state, return safe defaults
  if (meIndex === -1 || !players[meIndex]) {
    return {
      loading: false,
      state,
      tournament: game?.tournament,
      me: null,
      opponent: null,
      opponents: [],
      isMyTurn: false,
      isWinner: false,
      playAbility: async () => ({ ok: false }),
      endTurn: async () => ({ ok: false }),
      rtt,
      refetch: fetchInitialGame,
    };
  }

  const me = {
    ...players[meIndex],
    username: game.playerNames?.[players[meIndex].userId],
  };

  // All other players (opponents) — supports 1v1 and N-player modes
  const opponents = players
    .filter((_, i) => i !== meIndex)
    .map(p => ({ ...p, username: game.playerNames?.[p.userId] }));

  // Keep 'opponent' as backward-compat alias for the first opponent
  const opponent = opponents[0] ?? null;

  const isMyTurn = state.activePlayerIndex === meIndex;
  const isWinner = state.winnerUserId === selfUserId;

  /* ================= PLAY CARD ================= */

  const playAbility = async (
    ability: AbilityInstance,
    targetUserId?: string,
    groundTarget?: { x: number; y: number },
  ) => {
    // Real-time battles: no turn restrictions (both players act simultaneously)
    // Turn-based (draft): must be your turn
    const isRealTimeBattle = game?.tournament?.phase === "BATTLE";
    const turnCheckPassed = isRealTimeBattle || isMyTurn;

    if (!turnCheckPassed || playing || state.gameOver) {
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
          abilityInstanceId: ability.instanceId,
          targetUserId,
          groundTarget,
        }),
      });

      if (!res.ok) {
        return { ok: false, error: await res.text() };
      }

      const patch = await res.json();
      const offsetMs = updateServerTimeOffset(patch.serverTimestamp, Date.now());
      const normalizedDiff = normalizeDiffTimestamps(patch.diff, offsetMs);
      versionRef.current = patch.version;

      setGame((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          state: applyDiff(prev.state, normalizedDiff),
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
      const offsetMs = updateServerTimeOffset(patch.serverTimestamp, Date.now());
      const normalizedDiff = normalizeDiffTimestamps(patch.diff, offsetMs);
      versionRef.current = patch.version;

      setGame((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          state: applyDiff(prev.state, normalizedDiff),
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
    tournament: game?.tournament,
    gameMode: game?.mode,
    me,
    opponent,
    opponents,
    isMyTurn,
    isWinner,
    playAbility,
    endTurn,
    rtt,
    refetch: fetchInitialGame,
    opponentPositionBufferRef, // Map<userId, buffer[]> — bypasses React render delay
  };
}
