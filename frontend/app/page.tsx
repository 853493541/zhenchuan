"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import styles from "./page.module.css";
import { getGameModeLabel, type GameMode, YUMEN_1V1_BASIC_MODE } from "./game/gameModes";

type StartMode = GameMode | 'export-viewer';

const PRIMARY_MODES: Array<{ value: Extract<StartMode, GameMode>; label: string }> = [
  { value: YUMEN_1V1_BASIC_MODE, label: getGameModeLabel(YUMEN_1V1_BASIC_MODE) },
  { value: 'test', label: getGameModeLabel('test') },
];

const LEGACY_MODES: Array<{ value: StartMode; label: string }> = [
  { value: 'pubg', label: getGameModeLabel('pubg') },
  { value: 'arena', label: getGameModeLabel('arena') },
  { value: 'export-viewer', label: getGameModeLabel('export-viewer') },
];

const START_MODE_STORAGE_KEY = "zhenchuan.home.selectedStartMode";
const VALID_START_MODES = new Set<StartMode>([
  ...PRIMARY_MODES.map((option) => option.value),
  ...LEGACY_MODES.map((option) => option.value),
]);

const startModeLabel = (mode: StartMode) => getGameModeLabel(mode);

function getLobbyMaxPlayers(mode: unknown) {
  if (mode === YUMEN_1V1_BASIC_MODE || mode === undefined || mode === null) return 6;
  if (mode === 'pubg') return 5;
  return 2;
}

function ModeDropdown({
  label,
  options,
  selectedMode,
  open,
  onToggle,
  onSelect,
  ariaLabel,
}: {
  label: string;
  options: Array<{ value: StartMode; label: string }>;
  selectedMode: StartMode;
  open: boolean;
  onToggle: () => void;
  onSelect: (mode: StartMode) => void;
  ariaLabel: string;
}) {
  const selectedOption = options.find((option) => option.value === selectedMode);
  return (
    <div className={styles.modeMenuWrap} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        if (open) onToggle();
      }
    }}>
      <button
        type="button"
        className={styles.modeMenuButton}
        onClick={onToggle}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span>{selectedOption?.label ?? label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.modeMenuList} role="menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.modeMenuItem} ${option.value === selectedMode ? styles.modeMenuItemActive : ''}`}
              onClick={() => onSelect(option.value)}
              role="menuitem"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();

  const [waitingGames, setWaitingGames] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStartMode, setSelectedStartMode] = useState<StartMode>(YUMEN_1V1_BASIC_MODE);
  const [openModeMenu, setOpenModeMenu] = useState<'primary' | 'legacy' | null>(null);
  const [resourcePackOverlay, setResourcePackOverlay] = useState<{ action: "download" | "check"; nonce: number } | null>(null);
  const previousGameIds = useRef<Set<string>>(new Set());
  const hasAutoJoined = useRef(false);
  // Keep me in a ref so the polling closure always sees the latest value
  // without adding `me` to the effect dependency (which caused re-mount loops)
  const meRef = useRef<any>(null);
  useEffect(() => { meRef.current = me; }, [me]);

  useEffect(() => {
    try {
      const savedMode = window.localStorage.getItem(START_MODE_STORAGE_KEY);
      if (savedMode && VALID_START_MODES.has(savedMode as StartMode)) {
        setSelectedStartMode(savedMode as StartMode);
      }
    } catch {
      // Ignore storage read errors and keep default mode.
    }
  }, []);

  const selectStartMode = (mode: StartMode) => {
    setSelectedStartMode(mode);
    try {
      window.localStorage.setItem(START_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage write errors and keep in-memory selection.
    }
  };

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
            const playersJoined = Array.isArray(game?.players) ? game.players.length : 0;
            const hasOpenSlot = playersJoined < getLobbyMaxPlayers(game?.mode);
            // Only auto-join if the room creator is not me
            if (game && hasOpenSlot && game.players?.[0] !== meRef.current.uid) {
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
  const createGame = async (mode: GameMode) => {
    setLoading(true);
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      router.push(`/game/room?gameId=${data._id}`);
    } finally {
      setLoading(false);
    }
  };

  const openExportViewer = () => {
    router.push("/export-reader.html");
  };

  const openResourcePack = (action: "download" | "check") => {
    setResourcePackOverlay({ action, nonce: Date.now() });
  };

  const startSelectedMode = () => {
    if (selectedStartMode === 'export-viewer') {
      openExportViewer();
      return;
    }
    void createGame(selectedStartMode);
  };

  /* =========================================================
     UI
  ========================================================= */
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>真传</h1>

      <div className={styles.createActions}>
        <div className={styles.createActionRow}>
          <ModeDropdown
            label={getGameModeLabel(YUMEN_1V1_BASIC_MODE)}
            options={PRIMARY_MODES}
            selectedMode={selectedStartMode}
            open={openModeMenu === 'primary'}
            onToggle={() => setOpenModeMenu((current) => current === 'primary' ? null : 'primary')}
            onSelect={(mode) => {
              selectStartMode(mode);
              setOpenModeMenu(null);
            }}
            ariaLabel="选择模式"
          />
          <ModeDropdown
            label="legacy modes"
            options={LEGACY_MODES}
            selectedMode={selectedStartMode}
            open={openModeMenu === 'legacy'}
            onToggle={() => setOpenModeMenu((current) => current === 'legacy' ? null : 'legacy')}
            onSelect={(mode) => {
              selectStartMode(mode);
              setOpenModeMenu(null);
            }}
            ariaLabel="legacy modes"
          />
          <button
            className={`${styles.createBtn} ${styles.createBtnPrimary}`}
            onClick={startSelectedMode}
            disabled={loading}
          >
            {loading ? "创建中…" : "开始"}
          </button>
          <button
            className={`${styles.createBtn} ${styles.createBtnResourcePack}`}
            onClick={() => openResourcePack("download")}
          >
            下载资源包
          </button>
          <button
            className={`${styles.createBtn} ${styles.createBtnResourceCheck}`}
            onClick={() => openResourcePack("check")}
          >
            校验
          </button>
        </div>
        <div className={styles.bigStartWrap}>
          <button
            className={styles.bigStartBtn}
            onClick={startSelectedMode}
            disabled={loading}
          >
            {loading ? "创建中…" : `开始 ${startModeLabel(selectedStartMode)}`}
          </button>
        </div>
      </div>

      {resourcePackOverlay && (
        <div className={styles.resourcePackOverlay} role="presentation">
          <section className={styles.resourcePackPanel} role="dialog" aria-modal="true" aria-label={resourcePackOverlay.action === "download" ? "下载资源包" : "校验资源包"}>
            <button
              type="button"
              className={styles.resourcePackClose}
              onClick={() => setResourcePackOverlay(null)}
              aria-label="关闭资源包窗口"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <iframe
              key={`${resourcePackOverlay.action}-${resourcePackOverlay.nonce}`}
              className={styles.resourcePackFrame}
              title={resourcePackOverlay.action === "download" ? "下载资源包" : "校验资源包"}
              src={`/resource-pack?action=${resourcePackOverlay.action}&embed=1&from=lobby&v=${resourcePackOverlay.nonce}`}
            />
          </section>
        </div>
      )}

      <div className={styles.list}>
        {waitingGames.length === 0 && (
          <p className={styles.empty}>暂无可加入的房间</p>
        )}

        {waitingGames.map((g) => {
          const isMine = me && g.players?.[0] === me.uid;
          const maxPlayers = getLobbyMaxPlayers(g.mode);
          const playersJoined = Array.isArray(g.players) ? g.players.length : 0;
          const roomFull = playersJoined >= maxPlayers;

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
                {getGameModeLabel(g.mode)}
              </div>

              {/* 人数 */}
              <div className={styles.playerCount}>
                当前人数：{playersJoined} / {maxPlayers}
              </div>

              {/* 状态 */}
              <div className={styles.status}>{roomFull ? "已满" : "🟢 等待加入"}</div>

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
