"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./styles.module.css";

type Me = {
  uid: string;
  username: string;
};

type GameData = {
  _id: string;
  players: string[];
  playerNames?: Record<string, string>;
  started: boolean;
  autoStart?: boolean;
};

export default function RoomPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameId = searchParams.get("gameId");

  const [game, setGame] = useState<GameData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadingGame, setLoadingGame] = useState(true);
  const hasAttemptedJoin = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  /* =========================================================
     获取当前用户
  ========================================================= */
  const fetchMe = async () => {
    const res = await fetch("/api/auth/me", {
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      setMe(data.user);
    }
  };

  /* =========================================================
     获取房间信息（轮询）
  ========================================================= */
  const fetchGame = async () => {
    if (!gameId) return;

    const res = await fetch(`/api/game/${gameId}`, {
      credentials: "include",
    });

    if (res.ok) {
      setGame(await res.json());
    }

    setLoadingGame(false);
  };

  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    if (!gameId) return;

    hasAttemptedJoin.current = false; // Reset for new game
    fetchGame();
    const t = setInterval(fetchGame, 2000);
    return () => clearInterval(t);
  }, [gameId]);

  /* =========================================================
     WebSocket 连接（保持在房间）
  ========================================================= */
  useEffect(() => {
    if (!gameId || !me) return;

    const connectWebSocket = async () => {
      if (wsRef.current) return; // Already connecting/connected

      try {
        // Fetch auth token
        const res = await fetch("/api/auth/token", {
          credentials: "include",
        });

        if (!res.ok) {
          console.error("[WS] Failed to fetch token:", res.status);
          return;
        }

        const data = await res.json();
        const token = data.token;

        if (!token) {
          console.error("[WS] No token in response");
          return;
        }

        // Build WebSocket URL
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = `${protocol}://${window.location.host}/ws?gameId=${gameId}&token=${token}`;

        console.log(`[WS Room] Connecting to ${wsUrl.substring(0, 80)}...`);

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`[WS Room] ✅ Connected to game ${gameId}`);
          wsRef.current = ws;
        };

        ws.onerror = (err) => {
          console.error("[WS Room] Connection error:", err);
        };

        ws.onclose = () => {
          console.log("[WS Room] 🔌 Disconnected");
          wsRef.current = null;
        };

        ws.onmessage = () => {
          // Room just listens for disconnect, no message handling needed
        };
      } catch (err) {
        console.error("[WS Room] Failed to connect:", err);
      }
    };

    connectWebSocket();

    return () => {
      // Cleanup on unmount or when leaving room
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [gameId, me]);

  /* =========================================================
     自动加入房间（如果还未加入）- 只尝试一次
  ========================================================= */
  useEffect(() => {
    if (!gameId || !me || !game) return;
    if (hasAttemptedJoin.current) return;

    const playerIds: string[] = Array.isArray(game.players)
      ? game.players
      : [];

    const isInGame = playerIds.includes(me.uid);
    const isHost = playerIds[0] === me.uid;

    // Auto-join if not already in game and not the host
    if (!isInGame && !isHost) {
      hasAttemptedJoin.current = true;

      (async () => {
        try {
          const res = await fetch(`/api/game/join/${gameId}`, {
            method: "POST",
            credentials: "include",
          });

          if (res.ok) {
            const updated = await res.json();
            setGame(updated);
          }
        } catch (err) {
          console.error("Auto-join error:", err);
        }
      })();
    }

    // Mark host as already joined
    if (isHost) {
      hasAttemptedJoin.current = true;
    }
  }, [gameId, me, game?.players, game?.started]);

  /* =========================================================
     游戏开始后自动跳转（任何玩家）
  ========================================================= */
  useEffect(() => {
    if (!gameId || !game || !me) return;

    const playerIds: string[] = Array.isArray(game.players)
      ? game.players
      : [];

    const isInGame = playerIds.includes(me.uid);

    if (game.started && isInGame) {
      router.replace(`/game/in-game?gameId=${gameId}`);
    }
  }, [game, me, gameId, router]);

  /* =========================================================
     加入房间
  ========================================================= */
  const joinGame = async () => {
    const res = await fetch(`/api/game/join/${gameId}`, {
      method: "POST",
      credentials: "include",
    });

    if (!res.ok) {
      alert(await res.text());
      return;
    }

    fetchGame();
  };

  /* =========================================================
     开始游戏（房主）
  ========================================================= */
  const startGame = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameId }),
      });

      if (!res.ok) throw new Error(await res.text());

      router.push(`/game/in-game?gameId=${gameId}`);
    } finally {
      setStarting(false);
    }
  };

  /* =========================================================
     切换自动开始
  ========================================================= */
  const toggleAutoStart = async () => {
    try {
      const res = await fetch(`/api/game/toggle-autostart/${gameId}`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        alert(await res.text());
        return;
      }

      const updated = await res.json();
      setGame(updated);
    } catch (err) {
      console.error("Error toggling autostart:", err);
    }
  };

  /* =========================================================
     派生状态
  ========================================================= */
  const playerIds: string[] = Array.isArray(game?.players)
    ? game.players
    : [];

  const playersJoined = playerIds.length;
  const ready = playersJoined === 2;

  const myId = me?.uid;
  const isInGame = !!(myId && playerIds.includes(myId));
  const isHost = playerIds[0] === myId;

  const canJoin =
    !!me && !isInGame && playersJoined < 2 && !loadingGame;

  /* =========================================================
     UI
  ========================================================= */
  if (!gameId) {
    return <div className={styles.page}>缺少房间信息</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>等待对手</h1>
        <p className={styles.subtitle}>{playersJoined} / 2 玩家已准备</p>

        <div className={styles.playerList}>
          {[0, 1].map((slot) => {
            const uid = playerIds[slot];
            const username = game?.playerNames?.[uid] || "Unknown";
            const isMe = uid && uid === myId;
            const isEmpty = !uid;

            return (
              <div
                key={slot}
                className={`${styles.playerSlot} ${
                  isEmpty ? styles.empty : styles.filled
                } ${isMe ? styles.you : ""}`}
              >
                {isEmpty ? (
                  <div className={styles.emptyState}>
                    <span className={styles.waitingDot}>⌛</span>
                    <span>等待玩家</span>
                  </div>
                ) : (
                  <div className={styles.playerInfo}>
                    <span className={styles.badge}>
                      {slot === 0 ? "房主" : "玩家"}
                    </span>
                    <span className={styles.username}>
                      {isMe ? "你" : username}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isHost && !ready && (
          <div className={styles.optionSection}>
            <label className={styles.optionLabel}>
              <input
                type="checkbox"
                checked={game?.autoStart !== false}
                onChange={toggleAutoStart}
                className={styles.optionCheckbox}
              />
              <span>人满时自动开始</span>
            </label>
          </div>
        )}

        <div className={styles.actionArea}>
          {!isInGame && canJoin && (
            <button className={styles.primaryBtn} onClick={joinGame}>
              加入房间
            </button>
          )}

          {ready && isHost && !game?.autoStart && (
            <button
              className={styles.primaryBtn}
              onClick={startGame}
              disabled={starting}
            >
              {starting ? "启动中…" : "开始游戏"}
            </button>
          )}

          {ready && game?.autoStart && (
            <p className={styles.statusMsg}>即将自动开始…</p>
          )}

          {ready && !isHost && (
            <p className={styles.statusMsg}>
              {game?.autoStart !== false
                ? "等待游戏开始…"
                : "等待房主开始…"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
