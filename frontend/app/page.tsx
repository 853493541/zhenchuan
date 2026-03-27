"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function HomePage() {
  const router = useRouter();

  const [waitingGames, setWaitingGames] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'arena' | 'pubg'>('arena');
  const previousGameIds = useRef<Set<string>>(new Set());
  const hasAutoJoined = useRef(false);
  // Keep me in a ref so the polling closure always sees the latest value
  // without adding `me` to the effect dependency (which caused re-mount loops)
  const meRef = useRef<any>(null);
  useEffect(() => { meRef.current = me; }, [me]);

  /* =========================================================
     Utils：时间显示（仅显示"多少分钟前 / 刚刚"）
     - 不显示秒
     - 不显示小时
     - 房间 10 分钟后删除，够用
  ========================================================= */
  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const min = Math.floor(diff / 60000);

    if (min <= 0) return "刚刚";
    return `${min} 分钟前`;
  };

  /* 房间号缩短显示：#123 */
  const shortId = (id: string) => id.slice(-3);

  /* =========================================================
     获取当前用户（仅用于判断是否是自己的房间）
  ========================================================= */
  const fetchMe = async () => {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setMe(data.user);
    }
  };

  /* =========================================================
     仅获取等待中的房间
  ========================================================= */
  const fetchWaitingGames = async () => {
    const res = await fetch("/api/game/waiting", {
      credentials: "include",
    });

    if (res.ok) {
      const games = await res.json();
      setWaitingGames(games);
      
      // Auto-join logic: detect new room created by another player
      if (meRef.current && !hasAutoJoined.current) {
        const currentGameIds = new Set<string>(games.map((g: any) => g._id as string));
        
        // Find a new room that is not created by me
        for (const gameId of currentGameIds) {
          if (!previousGameIds.current.has(gameId)) {
            const game = games.find((g: any) => g._id === gameId);
            // Only auto-join if the room creator is not me
            if (game && game.players?.[0] !== meRef.current.uid) {
              hasAutoJoined.current = true;
              router.push(`/game/room?gameId=${gameId}`);
              return;
            }
          }
        }
        
        // Update previous game IDs for next poll
        previousGameIds.current = currentGameIds;
      }
    }
  };

  useEffect(() => {
    fetchMe(); // called once on mount
  }, []);

  useEffect(() => {
    fetchWaitingGames();

    const t = setInterval(fetchWaitingGames, 3000);
    return () => clearInterval(t);
  }, [router]); // `me` intentionally NOT in deps — use meRef.current inside fetchWaitingGames

  /* =========================================================
     创建房间
  ========================================================= */
  const createGame = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: selectedMode }),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      router.push(`/game/room?gameId=${data._id}`);
    } finally {
      setLoading(false);
    }
  };

  /* =========================================================
     UI
  ========================================================= */
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>对战大厅</h1>

      {/* Mode selector */}
      <div className={styles.modeSelector}>
        <button
          className={`${styles.modeBtn} ${selectedMode === 'arena' ? styles.modeBtnActive : ''}`}
          onClick={() => setSelectedMode('arena')}
        >
          竞技场
        </button>
        <button
          className={`${styles.modeBtn} ${selectedMode === 'pubg' ? styles.modeBtnActive : ''}`}
          onClick={() => setSelectedMode('pubg')}
        >
          吃鸡
        </button>
      </div>

      <button
        className={styles.createBtn}
        onClick={createGame}
        disabled={loading}
      >
        {loading ? "创建中…" : "创建房间"}
      </button>

      <div className={styles.list}>
        {waitingGames.length === 0 && (
          <p className={styles.empty}>暂无可加入的房间</p>
        )}

        {waitingGames.map((g) => {
          const isMine = me && g.players?.[0] === me.uid;

          return (
            <div
              key={g._id}
              className={`${styles.card} ${styles.waiting} ${
                isMine ? styles.mine : ""
              }`}
              onClick={() =>
                router.push(`/game/room?gameId=${g._id}`)
              }
            >
              {/* 标题 */}
              <div className={styles.cardTitle}>
                {isMine ? "我的房间" : "开放房间"} #{shortId(g._id)}
              </div>

              {/* 模式 */}
              <div className={styles.modeBadge}>
                {g.mode === 'arena' ? '竞技场' : '吃鸡'}
              </div>

              {/* 人数 */}
              <div className={styles.playerCount}>
                当前人数：{g.players.length} / 2
              </div>

              {/* 状态 */}
              <div className={styles.status}>🟢 等待加入</div>

              {/* 时间（右下角，仅分钟级） */}
              <div className={styles.time}>
                {g.createdAt ? timeAgo(g.createdAt) : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
