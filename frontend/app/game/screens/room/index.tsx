"use client";

import { useEffect, useState } from "react";
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

    fetchGame();
    const t = setInterval(fetchGame, 2000);
    return () => clearInterval(t);
  }, [gameId]);

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
      <h1 className={styles.title}>房间等待中</h1>

      <div className={styles.info}>
        <div>房间号：#{gameId.slice(-3)}</div>
        <div>当前人数：{playersJoined} / 2</div>
      </div>

      {/* 玩家列表 */}
      <div className={styles.playerList}>
        {[0, 1].map((slot) => {
          const uid = playerIds[slot];
          const username = game?.playerNames?.[uid] || "Unknown";
          const isMe = uid && uid === myId;

          return (
            <div key={slot} className={styles.playerSlot}>
              {uid ? (
                <>
                  <span>
                    {slot === 0 ? "👑 房主" : "👤 玩家"}{" "}
                    {isMe ? "（你）" : username}
                  </span>
                </>
              ) : (
                <span className={styles.emptySlot}>
                  ⭕ 等待玩家加入
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 状态提示 */}
      {isHost && (
        <p className={styles.host}>🟢 你是房主</p>
      )}

      {!isHost && isInGame && (
        <p className={styles.joined}>🔵 你已加入房间</p>
      )}

      {/* 操作按钮 */}
      {canJoin && (
        <button className={styles.primaryBtn} onClick={joinGame}>
          加入房间
        </button>
      )}

      {/* 房主自动开始切换 */}
      {isHost && !ready && (
        <div className={styles.toggleSection}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={game?.autoStart !== false}
              onChange={toggleAutoStart}
              className={styles.toggleCheckbox}
            />
            <span>
              {game?.autoStart !== false
                ? "✓ 人满自动开始"
                : "✗ 手动开始"}
            </span>
          </label>
        </div>
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
        <p className={styles.waiting}>
          👥 人满，游戏自动开始中…
        </p>
      )}

      {ready && !isHost && (
        <p className={styles.waiting}>
          {game?.autoStart !== false
            ? "👥 人满，游戏即将开始…"
            : "🔵 等待房主开始游戏…"}
        </p>
      )}
    </div>
  );
}
