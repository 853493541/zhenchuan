"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClientCrashRecorder } from "@/app/game/diagnostics/clientCrashRecorder";
import { getClientLatencyRecorder } from "@/app/game/diagnostics/clientLatencyRecorder";
import type { AbilityInstance, GameResponse, TargetSelection } from "../types";

/* ================= DIFF APPLY ================= */

type DiffPatch = {
  path: string;
  value: any;
};

function applyDiff<T extends object>(prev: T, diff: DiffPatch[]): T {
  let next: any = prev;

  for (const { path, value } of diff) {
    // full replace
    if (path === "/") {
      next = value;
      continue;
    }

    const keys = path.split("/").filter(Boolean);
    if (keys.length === 0) continue;

    const root = Array.isArray(next) ? [...next] : { ...next };
    let sourceCursor: any = next;
    let targetCursor: any = root;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const sourceChild = sourceCursor?.[key];
      if (sourceChild == null) {
        targetCursor = null;
        break;
      }
      const clonedChild = Array.isArray(sourceChild) ? [...sourceChild] : { ...sourceChild };
      targetCursor[key] = clonedChild;
      sourceCursor = sourceChild;
      targetCursor = clonedChild;
    }

    if (targetCursor == null) continue;

    const lastKey = keys[keys.length - 1];
    if (value === undefined) {
      delete targetCursor[lastKey];
    } else {
      targetCursor[lastKey] = value;
    }

    next = root;
  }

  return next;
}

/* ================= WEBSOCKET MESSAGE TYPES ================= */

type WSMessage = {
  type: "STATE_DIFF" | "GAME_OVER" | "PONG" | "PING" | "PLAYER_DISCONNECTED" | "PLAYER_RECONNECTED";
  version?: number;
  diff?: DiffPatch[];
  events?: any[];
  winnerUserId?: string;
  userId?: string;
  username?: string;
  endsAt?: number;
  timestamp?: number; // Server timestamp for RTT measurement
  serverTimestamp?: number;
  clientSentAt?: number;
  sequence?: number;
  serverReceivedAt?: number;
  serverSentAt?: number;
  serverProcessingMs?: number;
};

type DisconnectPrompt = {
  userId: string;
  username: string;
  endsAt: number;
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

async function readBackendError(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `ERR_HTTP_${res.status}`;
  try {
    const data = JSON.parse(text);
    return String(data.code ?? data.error ?? data.message ?? text);
  } catch {
    return text;
  }
}

/* ================= HOOK ================= */

export function useGameState(gameId: string, selfUserId: string, initialAuthToken?: string) {
  const [game, setGame] = useState<GameResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disconnectPrompt, setDisconnectPrompt] = useState<DisconnectPrompt | null>(null);
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
  const hasServerTimeSyncRef = useRef<boolean>(false);
  
  // WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastChecklistPongAtRef = useRef<number>(0);
  const lastChecklistDiffAtRef = useRef<number>(0);
  const lastStateDiffReceiveAtRef = useRef<number | null>(null);
  const pingSeqRef = useRef(0);
  const pendingPingsRef = useRef<Map<number, { clientSentAt: number; clientPerfSentAt: number }>>(new Map());
  const crashRecorderRef = useRef(getClientCrashRecorder());
  const latencyRecorderRef = useRef(getClientLatencyRecorder());

  const updateServerTimeOffset = useCallback((serverTimestamp?: number, clientReceivedAt = Date.now()) => {
    if (typeof serverTimestamp !== "number" || !Number.isFinite(serverTimestamp)) {
      return serverTimeOffsetRef.current;
    }

    const oneWayLatencyMs = rttRef.current !== null
      ? Math.max(0, Math.min(rttRef.current / 2, 120))
      : 0;
    const observedOffset = clientReceivedAt - (serverTimestamp + oneWayLatencyMs);

    if (!hasServerTimeSyncRef.current) {
      serverTimeOffsetRef.current = observedOffset;
      hasServerTimeSyncRef.current = true;
      return serverTimeOffsetRef.current;
    }

    // Smooth offset changes to avoid timestamp jitter affecting channel UI pace.
    serverTimeOffsetRef.current = serverTimeOffsetRef.current * 0.85 + observedOffset * 0.15;
    return serverTimeOffsetRef.current;
  }, []);

  const recordHttpTiming = useCallback((
    operation: string,
    clientStartedAt: number,
    clientStartedPerf: number,
    res: Response,
    extra?: Record<string, unknown>,
  ) => {
    latencyRecorderRef.current.recordHttpSample(operation, {
      gameId,
      ok: res.ok,
      status: res.status,
      clientStartedAt,
      clientCompletedAt: Date.now(),
      durationMs: performance.now() - clientStartedPerf,
      rttMs: rttRef.current,
      ...extra,
    });
  }, [gameId]);

  useEffect(() => {
    crashRecorderRef.current.startSession({
      gameId,
      userId: selfUserId,
      route: typeof window !== "undefined" ? window.location.pathname : "/game/in-game",
    });
    latencyRecorderRef.current.startSession({
      gameId,
      userId: selfUserId,
      route: typeof window !== "undefined" ? window.location.pathname : "/game/in-game",
    });
    crashRecorderRef.current.recordConnectionChecklist("session-start", { gameId, userId: selfUserId }, true);
  }, [gameId, selfUserId]);

  /* ================= INITIAL SNAPSHOT ================= */

  const fetchInitialGame = useCallback(async () => {
    const requestStartedAt = Date.now();
    const requestStartedPerf = performance.now();
    crashRecorderRef.current.recordBehavior("snapshot-fetch-start", { gameId });
    const res = await fetch(`/api/game/${gameId}`, {
      credentials: "include",
    });

    if (!res.ok) {
      const error = await readBackendError(res);
      latencyRecorderRef.current.recordHttpSample("snapshot", {
        gameId,
        ok: false,
        status: res.status,
        error,
        clientStartedAt: requestStartedAt,
        clientCompletedAt: Date.now(),
        durationMs: performance.now() - requestStartedPerf,
      });
      crashRecorderRef.current.recordBehavior("snapshot-fetch-failed", { gameId, status: res.status, error });
      setLoadError(error);
      setGame(null);
      setLoading(false);
      return;
    }

    const full = await res.json();
    const snapshotReceivedAt = Date.now();
    const offsetMs = updateServerTimeOffset(full.serverTimestamp, snapshotReceivedAt);
    const normalizedFull = normalizeGamePayloadTimestamps(full, offsetMs);
    latencyRecorderRef.current.recordHttpSample("snapshot", {
      gameId,
      ok: true,
      status: res.status,
      clientStartedAt: requestStartedAt,
      clientCompletedAt: snapshotReceivedAt,
      durationMs: performance.now() - requestStartedPerf,
      serverTimestamp: full.serverTimestamp,
      estimatedClockOffsetMs: offsetMs,
      version: normalizedFull.state?.version,
      playerCount: normalizedFull.state?.players?.length,
      mode: normalizedFull.mode,
    });
    console.log("[useGameState] Snapshot fetched:", {
      hasGame: !!normalizedFull,
      hasTournament: !!normalizedFull.tournament,
      tournamentPhase: normalizedFull.tournament?.phase,
      gameId: normalizedFull._id,
    });

    versionRef.current = normalizedFull.state.version ?? 0;
    const meIndex = normalizedFull.state.players.findIndex((p: any) => p.userId === selfUserId);
    const playerIds = normalizedFull.state.players.map((p: any) => p.userId as string);
    crashRecorderRef.current.updateContext({
      gameId,
      userId: selfUserId,
      gameMode: normalizedFull.mode,
      tournamentPhase: normalizedFull.tournament?.phase,
      battleNumber: normalizedFull.tournament?.battleNumber,
      stateVersion: versionRef.current,
      playerCount: normalizedFull.state.players.length,
    });
    latencyRecorderRef.current.updateContext({
      gameId,
      userId: selfUserId,
      gameMode: normalizedFull.mode,
      tournamentPhase: normalizedFull.tournament?.phase,
      battleNumber: normalizedFull.tournament?.battleNumber,
      stateVersion: versionRef.current,
      playerCount: normalizedFull.state.players.length,
    });
    crashRecorderRef.current.recordBehavior("snapshot-fetch-ok", {
      gameId,
      version: versionRef.current,
      phase: normalizedFull.tournament?.phase,
      playerCount: normalizedFull.state.players.length,
    });
    crashRecorderRef.current.recordConnectionChecklist("snapshot-ok", {
      gameId,
      version: versionRef.current,
      phase: normalizedFull.tournament?.phase,
      playerCount: normalizedFull.state.players.length,
      meIndex,
      hasSelf: meIndex !== -1,
    }, true);
    // Compute and cache meIndex + playerIds so WS handler can identify opponent patches
    meIndexRef.current = meIndex;
    playerIdsRef.current = playerIds;
    setGame(normalizedFull);
    setLoadError(null);
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
        crashRecorderRef.current.recordWebSocketEvent("token-fetch-start", { gameId });
        const tokenFetchStartedAt = Date.now();
        const tokenFetchStartedPerf = performance.now();
        const res = await fetch("/api/auth/token", {
          credentials: "include",
        });
        latencyRecorderRef.current.recordHttpSample("auth-token", {
          gameId,
          ok: res.ok,
          status: res.status,
          clientStartedAt: tokenFetchStartedAt,
          clientCompletedAt: Date.now(),
          durationMs: performance.now() - tokenFetchStartedPerf,
        });

        console.log(`[WS] 2️⃣ Token endpoint response: ${res.status}`);

        if (!res.ok) {
          const err = await res.text();
          console.error("[WS] ❌ Token endpoint failed:", res.status, err);
          crashRecorderRef.current.recordWebSocketEvent("token-fetch-failed", { gameId, status: res.status, error: err });
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
          crashRecorderRef.current.recordWebSocketEvent("token-missing", { gameId });
          return;
        }
        console.log("[WS] 3️⃣ Got token from endpoint");
        crashRecorderRef.current.recordWebSocketEvent("token-fetch-ok", { gameId });
      } catch (err) {
        console.error("[WS] ❌ Failed to fetch token:", err);
        crashRecorderRef.current.recordWebSocketEvent("token-fetch-error", { gameId, error: err });
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
    const safeWsUrl = `${protocol}://${window.location.host}/ws?gameId=${gameId}&token=[redacted]`;

    console.log(`[WS] 4️⃣ Creating WebSocket connection`);
    console.log(`[WS] Protocol: ${protocol}`);
    console.log(`[WS] Host: ${window.location.host}`);
    console.log(`[WS] GameID: ${gameId}`);
    console.log(`[WS] URL: ${safeWsUrl}`);
    crashRecorderRef.current.recordWebSocketEvent("connecting", {
      gameId,
      protocol,
      host: window.location.host,
    });
    latencyRecorderRef.current.recordWebSocketLifecycle("connecting", {
      gameId,
      protocol,
      host: window.location.host,
    });

    const ws = new WebSocket(wsUrl);

    console.log(`[WS] 5️⃣ WebSocket object created, readyState: ${ws.readyState}`);
    console.log(`[WS] Initial state check - ReadyState ${ws.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);
    console.log(`[WS] URL being attempted:`, safeWsUrl);
    console.log(`[WS] Full request details:`, {
      url: safeWsUrl,
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
      console.error(`[WS] URL was: ${safeWsUrl}`);
      console.error(`[WS] If readyState=0, connection is stuck in CONNECTING state`);
      console.error(`[WS] If readyState=3, connection was closed`);
      crashRecorderRef.current.recordWebSocketEvent("connect-timeout", { gameId, readyState: ws.readyState });
      latencyRecorderRef.current.recordWebSocketLifecycle("connect-timeout", { gameId, readyState: ws.readyState });
    }, 5000);

    ws.onopen = () => {
      clearTimeout(connectionTimeoutRef);
      clearInterval(stateCheckInterval);
      console.log("[WS] 6️⃣✅ WebSocket OPENED successfully!");
      console.log("[WS] Connection established - readyState:", ws.readyState);
      wsRef.current = ws;
      crashRecorderRef.current.recordWebSocketEvent("open", { gameId, readyState: ws.readyState });
      latencyRecorderRef.current.recordWebSocketLifecycle("open", { gameId, readyState: ws.readyState });
      crashRecorderRef.current.recordConnectionChecklist("ws-open", { gameId, readyState: ws.readyState, version: versionRef.current }, true);

      // Clear reconnect timeout if it was set
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Heartbeat + RTT measurement every second
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const sequence = ++pingSeqRef.current;
          const clientSentAt = Date.now();
          const clientPerfSentAt = performance.now();
          pendingPingsRef.current.set(sequence, { clientSentAt, clientPerfSentAt });
          if (pendingPingsRef.current.size > 30) {
            const oldest = pendingPingsRef.current.keys().next().value;
            if (typeof oldest === "number") pendingPingsRef.current.delete(oldest);
          }
          ws.send(JSON.stringify({
            type: "PING",
            timestamp: clientSentAt,
            clientSentAt,
            clientPerfNow: clientPerfSentAt,
            sequence,
          }));
        }
      }, 1000); // Every 1 second (was 25 seconds)
    };

    ws.onmessage = (event) => {
      try {
        const rawMessage = typeof event.data === "string" ? event.data : String(event.data);
        const parseStartedAt = performance.now();
        const message: WSMessage = JSON.parse(rawMessage);
        const receiveTime = performance.now();
        const parseMs = receiveTime - parseStartedAt;
        const receiveDateNow = Date.now();
        const payloadBytes = rawMessage.length;

        if (message.type === "PONG") {
          // Measure RTT from ping/pong
          const pendingPing = typeof message.sequence === "number"
            ? pendingPingsRef.current.get(message.sequence)
            : undefined;
          const clientSentAt = pendingPing?.clientSentAt ?? message.clientSentAt ?? message.timestamp;
          if (typeof message.sequence === "number") {
            pendingPingsRef.current.delete(message.sequence);
          }
          if (clientSentAt) {
            const rttValue = receiveDateNow - clientSentAt;
            rttRef.current = rttValue;
            setRtt((prev) => (prev === rttValue ? prev : rttValue));
          }
          const offsetMs = updateServerTimeOffset(message.serverTimestamp, receiveDateNow);
          const serverReceivedClientClock = typeof message.serverReceivedAt === "number"
            ? message.serverReceivedAt + offsetMs
            : undefined;
          const serverSentClientClock = typeof message.serverSentAt === "number"
            ? message.serverSentAt + offsetMs
            : undefined;
          latencyRecorderRef.current.recordPingSample({
            gameId,
            sequence: message.sequence,
            clientSentAt,
            clientReceivedAt: receiveDateNow,
            clientPerfSentAt: pendingPing?.clientPerfSentAt,
            clientPerfReceivedAt: receiveTime,
            serverReceivedAt: message.serverReceivedAt,
            serverSentAt: message.serverSentAt,
            serverTimestamp: message.serverTimestamp,
            serverProcessingMs: message.serverProcessingMs,
            rttMs: rttRef.current,
            estimatedClockOffsetMs: offsetMs,
            estimatedClientToServerMs: typeof serverReceivedClientClock === "number" && typeof clientSentAt === "number"
              ? serverReceivedClientClock - clientSentAt
              : undefined,
            estimatedServerToClientMs: typeof serverSentClientClock === "number"
              ? receiveDateNow - serverSentClientClock
              : undefined,
            pendingPingCount: pendingPingsRef.current.size,
            payloadBytes,
            parseMs,
            readyState: ws.readyState,
            visibilityState: document.visibilityState,
          });
          crashRecorderRef.current.recordWebSocketMessage({ type: "PONG", version: versionRef.current });
          if (receiveDateNow - lastChecklistPongAtRef.current >= 10_000) {
            lastChecklistPongAtRef.current = receiveDateNow;
            crashRecorderRef.current.recordConnectionChecklist("pong", {
              gameId,
              rtt: rttRef.current,
              version: versionRef.current,
              readyState: ws.readyState,
            });
          }
          return;
        }

        if (message.type === "PLAYER_DISCONNECTED") {
          crashRecorderRef.current.recordWebSocketEvent("player-disconnected", {
            gameId,
            userId: message.userId,
            username: message.username,
            endsAt: message.endsAt,
          });
          if (message.userId && message.userId !== selfUserId) {
            const promptEndsAt = Date.now() + 5_000;
            setDisconnectPrompt({
              userId: message.userId,
              username: message.username ?? "对方",
              endsAt: Math.min(message.endsAt ?? promptEndsAt, promptEndsAt),
            });
          }
          return;
        }

        if (message.type === "PLAYER_RECONNECTED") {
          crashRecorderRef.current.recordWebSocketEvent("player-reconnected", {
            gameId,
            userId: message.userId,
            username: message.username,
          });
          if (message.userId) {
            setDisconnectPrompt((prev) => prev?.userId === message.userId ? null : prev);
          }
          return;
        }

        if (message.type === "STATE_DIFF" || message.type === "GAME_OVER") {
          if (!message.diff || message.diff.length === 0) return;
          crashRecorderRef.current.recordWebSocketMessage({
            type: message.type,
            version: message.version,
            diffCount: message.diff.length,
            eventCount: message.events?.length,
            samplePaths: message.diff.slice(0, 8).map((patch) => patch.path),
          });
          if (message.type === "GAME_OVER" || receiveDateNow - lastChecklistDiffAtRef.current >= 5_000) {
            lastChecklistDiffAtRef.current = receiveDateNow;
            crashRecorderRef.current.recordConnectionChecklist("state-diff", {
              gameId,
              type: message.type,
              version: message.version,
              diffCount: message.diff.length,
              eventCount: message.events?.length,
              readyState: ws.readyState,
            }, message.type === "GAME_OVER");
          }

          const offsetMs = hasServerTimeSyncRef.current
            ? serverTimeOffsetRef.current
            : updateServerTimeOffset(message.timestamp, receiveDateNow);
          const normalizedDiff = normalizeDiffTimestamps(message.diff, offsetMs);
          const previousDiffAt = lastStateDiffReceiveAtRef.current;
          lastStateDiffReceiveAtRef.current = receiveDateNow;
          const serverMessageAt = typeof message.timestamp === "number" ? message.timestamp : undefined;
          latencyRecorderRef.current.recordStateDiffSample({
            gameId,
            type: message.type,
            version: message.version,
            diffCount: message.diff.length,
            eventCount: message.events?.length,
            payloadBytes,
            parseMs,
            intervalMs: previousDiffAt === null ? undefined : receiveDateNow - previousDiffAt,
            serverTimestamp: serverMessageAt,
            receiveLagMs: typeof serverMessageAt === "number" ? receiveDateNow - (serverMessageAt + offsetMs) : undefined,
            rttMs: rttRef.current,
            samplePaths: message.diff.slice(0, 6).map((patch) => patch.path),
            readyState: ws.readyState,
            visibilityState: document.visibilityState,
          });



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
          crashRecorderRef.current.updateContext({ stateVersion: versionRef.current });

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
        crashRecorderRef.current.recordWebSocketEvent("message-parse-error", { gameId, error: err });
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
      console.error("  - URL:", safeWsUrl);
      console.error("  - Protocol negotiated:", ws.protocol);
      console.error("  - Extensions:", (ws as any).extensions);
      crashRecorderRef.current.recordWebSocketEvent("error", {
        gameId,
        readyState: ws.readyState,
        message: (err as any)?.message,
      });
      latencyRecorderRef.current.recordWebSocketLifecycle("error", {
        gameId,
        readyState: ws.readyState,
        message: (err as any)?.message,
      });
      
      // Check if it's a network error
      if ((err as any)?.code === 'ECONNREFUSED' || (err as any)?.message?.includes('refused')) {
        console.error("[WS] ⚠️ Connection refused - backend might not be accepting connections");
      }
    };

    ws.onclose = (event) => {
      clearTimeout(connectionTimeoutRef);
      clearInterval(stateCheckInterval);
      console.log("[WS] 8️⃣ WebSocket CLOSE event fired");
      console.log("[WS] Closure details:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        readyState: ws.readyState
      });
      console.log("[WS] Closure reason explanation:");
      const code = event.code;
      if (code === 1000) console.log("  - Normal closure");
      else if (code === 1001) console.log("  - Going away");
      else if (code === 1002) console.log("  - Protocol error");
      else if (code === 1003) console.log("  - Unsupported data");
      else if (code === 1006) console.log("  - Abnormal closure (no close frame received)");
      else if (code === 1007) console.log("  - Invalid frame payload");
      else if (code === 1008) console.log("  - Policy violation");
      else if (code === 1011) console.log("  - Unexpected error on server");
      else console.log(`  - Unknown code: ${code}`);
      crashRecorderRef.current.recordDisconnect({
        gameId,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        readyState: ws.readyState,
      });
      latencyRecorderRef.current.recordWebSocketLifecycle("close", {
        gameId,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        readyState: ws.readyState,
      });
      crashRecorderRef.current.recordConnectionChecklist("ws-close", {
        gameId,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        readyState: ws.readyState,
        version: versionRef.current,
      }, true);
      
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
        crashRecorderRef.current.recordWebSocketEvent("cleanup-close", { gameId, readyState: wsRef.current.readyState });
        latencyRecorderRef.current.recordWebSocketLifecycle("cleanup-close", { gameId, readyState: wsRef.current.readyState });
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
      loadError,
      disconnectPrompt,
      state: null,
      tournament: null,
      gameMode: undefined,
      me: null,
      opponent: null,
      opponents: [],
      isMyTurn: false,
      isWinner: false,
      playAbility: async () => ({ ok: false }),
      cancelBuff: async () => ({ ok: false }),
      cancelChannel: async () => ({ ok: false }),
      useConsumable: async () => ({ ok: false }),
      updateTargetSelection: async () => ({ ok: false }),
      endTurn: async () => ({ ok: false }),
      rtt,
      refetch: fetchInitialGame,
      clearDisconnectPrompt: () => setDisconnectPrompt(null),
      opponentPositionBufferRef,
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
      loadError,
      disconnectPrompt,
      state,
      tournament: game?.tournament,
      gameMode: game?.mode,
      me: null,
      opponent: null,
      opponents: [],
      isMyTurn: false,
      isWinner: false,
      playAbility: async () => ({ ok: false }),
      cancelBuff: async () => ({ ok: false }),
      cancelChannel: async () => ({ ok: false }),
      useConsumable: async () => ({ ok: false }),
      updateTargetSelection: async () => ({ ok: false }),
      endTurn: async () => ({ ok: false }),
      rtt,
      refetch: fetchInitialGame,
      clearDisconnectPrompt: () => setDisconnectPrompt(null),
      opponentPositionBufferRef,
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
    groundTarget?: { x: number; y: number; z?: number },
    entityTargetId?: string,
    movementIntent?: boolean,
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
      const requestStartedAt = Date.now();
      const requestStartedPerf = performance.now();
      const res = await fetch("/api/game/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          gameId,
          abilityInstanceId: ability.instanceId,
          targetUserId,
          groundTarget,
          entityTargetId,
          movementIntent,
        }),
      });

      if (!res.ok) {
        recordHttpTiming("play-ability", requestStartedAt, requestStartedPerf, res, {
          abilityInstanceId: ability.instanceId,
          targetUserId,
          entityTargetId,
          movementIntent,
        });
        return { ok: false, error: await readBackendError(res) };
      }

      const patch = await res.json();
      recordHttpTiming("play-ability", requestStartedAt, requestStartedPerf, res, {
        abilityInstanceId: ability.instanceId,
        targetUserId,
        entityTargetId,
        movementIntent,
        serverTimestamp: patch.serverTimestamp,
        version: patch.version,
        diffCount: patch.diff?.length,
      });
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

  const cancelBuff = async (buffId: number, options?: { entityTargetId?: string }) => {
    if (playing || state.gameOver) {
      return { ok: false };
    }

    setPlaying(true);
    try {
      const requestStartedAt = Date.now();
      const requestStartedPerf = performance.now();
      const res = await fetch("/api/game/buff/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameId, buffId, entityTargetId: options?.entityTargetId }),
      });

      if (!res.ok) {
        recordHttpTiming("cancel-buff", requestStartedAt, requestStartedPerf, res, {
          buffId,
          entityTargetId: options?.entityTargetId,
        });
        return { ok: false, error: await readBackendError(res) };
      }

      const patch = await res.json();
      recordHttpTiming("cancel-buff", requestStartedAt, requestStartedPerf, res, {
        buffId,
        entityTargetId: options?.entityTargetId,
        serverTimestamp: patch.serverTimestamp,
        version: patch.version,
        diffCount: patch.diff?.length,
      });
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
      const requestStartedAt = Date.now();
      const requestStartedPerf = performance.now();
      const res = await fetch("/api/game/pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameId }),
      });

      if (!res.ok) {
        recordHttpTiming("end-turn", requestStartedAt, requestStartedPerf, res);
        return { ok: false, error: await readBackendError(res) };
      }

      const patch = await res.json();
      recordHttpTiming("end-turn", requestStartedAt, requestStartedPerf, res, {
        serverTimestamp: patch.serverTimestamp,
        version: patch.version,
        diffCount: patch.diff?.length,
      });
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

  const cancelChannel = async () => {
    if (playing || state.gameOver) {
      return { ok: false };
    }

    setPlaying(true);
    try {
      const requestStartedAt = Date.now();
      const requestStartedPerf = performance.now();
      const res = await fetch("/api/game/channel/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameId }),
      });

      if (!res.ok) {
        recordHttpTiming("cancel-channel", requestStartedAt, requestStartedPerf, res);
        return { ok: false, error: await readBackendError(res) };
      }

      const patch = await res.json();
      recordHttpTiming("cancel-channel", requestStartedAt, requestStartedPerf, res, {
        serverTimestamp: patch.serverTimestamp,
        version: patch.version,
        diffCount: patch.diff?.length,
      });
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

  const useConsumable = async (consumableId: string) => {
    if (playing || state.gameOver) {
      return { ok: false };
    }

    setPlaying(true);
    try {
      const requestStartedAt = Date.now();
      const requestStartedPerf = performance.now();
      const res = await fetch("/api/game/consumable/use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameId, consumableId }),
      });

      if (!res.ok) {
        recordHttpTiming("use-consumable", requestStartedAt, requestStartedPerf, res, { consumableId });
        return { ok: false, error: await readBackendError(res) };
      }

      const patch = await res.json();
      recordHttpTiming("use-consumable", requestStartedAt, requestStartedPerf, res, {
        consumableId,
        serverTimestamp: patch.serverTimestamp,
        version: patch.version,
        diffCount: patch.diff?.length,
      });
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

  const updateTargetSelection = async (selection: TargetSelection | null) => {
    if (state.gameOver) {
      return { ok: false };
    }

    const requestStartedAt = Date.now();
    const requestStartedPerf = performance.now();
    const res = await fetch("/api/game/target/selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ gameId, selection: selection ?? { kind: "none" } }),
    });

    if (!res.ok) {
      recordHttpTiming("target-selection", requestStartedAt, requestStartedPerf, res, {
        selectionKind: selection?.kind ?? "none",
      });
      return { ok: false, error: await readBackendError(res) };
    }

    const patch = await res.json();
    recordHttpTiming("target-selection", requestStartedAt, requestStartedPerf, res, {
      selectionKind: selection?.kind ?? "none",
      serverTimestamp: patch.serverTimestamp,
      version: patch.version,
      diffCount: patch.diff?.length,
    });
    const offsetMs = updateServerTimeOffset(patch.serverTimestamp, Date.now());
    const normalizedDiff = normalizeDiffTimestamps(patch.diff ?? [], offsetMs);
    versionRef.current = patch.version;

    if (normalizedDiff.length > 0) {
      setGame((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          state: applyDiff(prev.state, normalizedDiff),
        };
      });
    }

    return { ok: true };
  };

  return {
    loading,
    loadError,
    disconnectPrompt,
    state,
    tournament: game?.tournament,
    gameMode: game?.mode,
    me,
    opponent,
    opponents,
    isMyTurn,
    isWinner,
    playAbility,
    cancelBuff,
    cancelChannel,
    useConsumable,
    updateTargetSelection,
    endTurn,
    rtt,
    refetch: fetchInitialGame,
    clearDisconnectPrompt: () => setDisconnectPrompt(null),
    opponentPositionBufferRef, // Map<userId, buffer[]> — bypasses React render delay
  };
}
