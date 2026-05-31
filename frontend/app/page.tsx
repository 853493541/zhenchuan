"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import styles from "./page.module.css";
import { getGameModeLabel, type GameMode, YUMEN_1V1_BASIC_MODE } from "./game/gameModes";
import { toastSuccess } from "./components/toast/toast";

type ResourceCategory = "app" | "icons" | "sounds" | "fonts" | "game" | "map";

type PackageAsset = {
  url: string;
  size: number;
  category: ResourceCategory;
  packagePath: string;
  contentType?: string;
};

type PackageManifest = {
  cacheName?: string;
  assets?: PackageAsset[];
  totalAssets?: number;
  totalBytes?: number;
};

type TarEntry = {
  name: string;
  size: number;
  data: Uint8Array;
};

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
const AUTO_JOIN_ENABLED_STORAGE_KEY = "zhenchuan.home.autoJoinEnabled";
const RESOURCE_PACK_FALLBACK_CACHE_NAME = "zhenchuan-resource-pack-v1";
const RESOURCE_PACK_READY_STORAGE_KEY = "zhenchuan.resourcePack.ready.v1";
const RESOURCE_PACK_DOWNLOADED_AT_STORAGE_KEY = "zhenchuan.resourcePack.downloadedAt.v1";
const tarTextDecoder = new TextDecoder();
const VALID_START_MODES = new Set<StartMode>([
  ...PRIMARY_MODES.map((option) => option.value),
  ...LEGACY_MODES.map((option) => option.value),
]);

const startModeLabel = (mode: StartMode) => getGameModeLabel(mode);
const isLegacyMode = (mode: StartMode) => LEGACY_MODES.some((option) => option.value === mode);

function getLobbyMaxPlayers(mode: unknown) {
  if (mode === YUMEN_1V1_BASIC_MODE || mode === undefined || mode === null) return 6;
  if (mode === 'pubg') return 5;
  return 2;
}

function toAbsoluteUrl(url: string) {
  return new URL(url, window.location.origin).toString();
}

function decodeTarText(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  return tarTextDecoder.decode(end >= 0 ? bytes.subarray(0, end) : bytes).trim();
}

function parseTarSize(bytes: Uint8Array) {
  const value = decodeTarText(bytes).replace(/\0/g, "").trim();
  const parsed = Number.parseInt(value || "0", 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isEmptyTarBlock(bytes: Uint8Array) {
  for (const byte of bytes) {
    if (byte !== 0) return false;
  }
  return true;
}

async function readTarGzipEntries(file: File, onEntry: (entry: TarEntry) => Promise<void>) {
  const DecompressionStreamCtor = (window as any).DecompressionStream;
  if (!DecompressionStreamCtor) throw new Error("当前浏览器不支持本地资源包解压");

  const stream = file.stream().pipeThrough(new DecompressionStreamCtor("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (isEmptyTarBlock(header)) break;

    const name = decodeTarText(header.subarray(0, 100));
    const prefix = decodeTarText(header.subarray(345, 500));
    const entryName = prefix ? `${prefix}/${name}` : name;
    const size = parseTarSize(header.subarray(124, 136));
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!entryName || dataEnd > bytes.length) throw new Error("资源包文件损坏");

    await onEntry({ name: entryName, size, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
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
  const [autoJoinEnabled, setAutoJoinEnabled] = useState(true);
  const [resourcePackGateReady, setResourcePackGateReady] = useState(false);
  const [resourcePackGateChecking, setResourcePackGateChecking] = useState(true);
  const [selectedStartMode, setSelectedStartMode] = useState<StartMode>(YUMEN_1V1_BASIC_MODE);
  const [openModeMenu, setOpenModeMenu] = useState<'primary' | 'legacy' | null>(null);
  const [resourcePackOverlay, setResourcePackOverlay] = useState<{ action: "download" | "check"; nonce: number } | null>(null);
  const [resourcePackImporting, setResourcePackImporting] = useState(false);
  const [resourcePackImportError, setResourcePackImportError] = useState<string | null>(null);
  const previousGameIds = useRef<Set<string>>(new Set());
  const hasAutoJoined = useRef(false);
  const previousGateReadyRef = useRef(false);
  const gateToastInitializedRef = useRef(false);
  const packageInputRef = useRef<HTMLInputElement | null>(null);
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
      const savedAutoJoinEnabled = window.localStorage.getItem(AUTO_JOIN_ENABLED_STORAGE_KEY);
      if (savedAutoJoinEnabled !== null) {
        setAutoJoinEnabled(savedAutoJoinEnabled !== "0");
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

  const canViewLegacyModes = me?.isAdmin === true;

  const checkResourcePackGate = useRef<() => Promise<void>>(async () => {});

  checkResourcePackGate.current = async () => {
    setResourcePackGateChecking(true);
    try {
      const previouslyReady = (() => {
        try {
          return window.localStorage.getItem(RESOURCE_PACK_READY_STORAGE_KEY) === "true";
        } catch {
          return false;
        }
      })();
      if (previouslyReady) {
        // Keep UX consistent with the resource-pack page's own 100% pass marker.
        setResourcePackGateReady(true);
      }
      if (!("caches" in window)) {
        setResourcePackGateReady(false);
        return;
      }
      const manifestRes = await fetch("/resource-pack/manifest", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!manifestRes.ok) {
        setResourcePackGateReady(false);
        return;
      }
      const manifest = await manifestRes.json().catch(() => null) as { assets?: Array<{ url: string }>; cacheName?: string } | null;
      const assets = Array.isArray(manifest?.assets)
        ? manifest!.assets.filter((asset) => typeof asset?.url === "string" && asset.url.length > 0)
        : [];
      if (assets.length === 0) {
        setResourcePackGateReady(false);
        return;
      }
      const cacheName = typeof manifest?.cacheName === "string" && manifest.cacheName
        ? manifest.cacheName
        : RESOURCE_PACK_FALLBACK_CACHE_NAME;
      const cache = await caches.open(cacheName);
      const origin = window.location.origin;
      let readyCount = 0;
      await Promise.all(assets.map(async (asset) => {
        const absoluteUrl = new URL(asset.url, origin).toString();
        const hit =
          (await cache.match(absoluteUrl, { ignoreVary: true }))
          ?? (await cache.match(asset.url, { ignoreVary: true }));
        if (hit) readyCount += 1;
      }));
      const strictReady = readyCount === assets.length;
      if (strictReady) {
        try {
          window.localStorage.setItem(RESOURCE_PACK_READY_STORAGE_KEY, "true");
        } catch {
          // Ignore storage write errors.
        }
      } else {
        try {
          window.localStorage.removeItem(RESOURCE_PACK_READY_STORAGE_KEY);
        } catch {
          // Ignore storage write errors.
        }
      }
      setResourcePackGateReady(strictReady);
    } catch {
      setResourcePackGateReady(false);
    } finally {
      setResourcePackGateChecking(false);
    }
  };

  useEffect(() => {
    if (canViewLegacyModes) return;
    if (isLegacyMode(selectedStartMode)) {
      selectStartMode(YUMEN_1V1_BASIC_MODE);
    }
    if (openModeMenu === 'legacy') {
      setOpenModeMenu(null);
    }
  }, [canViewLegacyModes, openModeMenu, selectedStartMode]);

  useEffect(() => {
    void checkResourcePackGate.current();
  }, []);

  useEffect(() => {
    if (!gateToastInitializedRef.current) {
      previousGateReadyRef.current = resourcePackGateReady;
      gateToastInitializedRef.current = true;
      return;
    }
    if (!previousGateReadyRef.current && resourcePackGateReady) {
      toastSuccess("资源已验证完整");
    }
    previousGateReadyRef.current = resourcePackGateReady;
  }, [resourcePackGateReady]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data as { type?: string; ready?: boolean } | null;
      if (!payload) return;
      if (payload.type !== "resource-pack-gate") return;
      if (payload.ready === true) {
        setResourcePackGateReady(true);
        setResourcePackGateChecking(false);
        return;
      }
      if (payload.ready === false) {
        setResourcePackGateReady(false);
        setResourcePackGateChecking(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
      if (meRef.current && autoJoinEnabled && resourcePackGateReady && !resourcePackGateChecking && !hasAutoJoined.current) {
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
  }, [autoJoinEnabled, resourcePackGateChecking, resourcePackGateReady, router]); // `me` intentionally NOT in deps — use meRef.current inside fetchWaitingGames

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

  const closeResourcePackOverlay = () => {
    setResourcePackOverlay(null);
    // Explicit close after user-operated panel actions triggers one gate refresh.
    void checkResourcePackGate.current();
  };

  const importOfflinePack = async (file: File | null) => {
    if (!file) return;
    if (!("caches" in window)) {
      setResourcePackImportError("当前浏览器不支持本地缓存");
      return;
    }

    setResourcePackImporting(true);
    setResourcePackImportError(null);
    try {
      const cache = await caches.open(RESOURCE_PACK_FALLBACK_CACHE_NAME);
      let packageManifest: PackageManifest | null = null;
      let packageAssetsByPath = new Map<string, PackageAsset>();
      let imported = 0;

      await readTarGzipEntries(file, async (entry) => {
        if (entry.name === "manifest.json") {
          packageManifest = JSON.parse(tarTextDecoder.decode(entry.data)) as PackageManifest;
          const packageAssets = Array.isArray(packageManifest.assets) ? packageManifest.assets : [];
          packageAssetsByPath = new Map(packageAssets.map((asset) => [asset.packagePath, asset]));
          return;
        }

        const asset = packageAssetsByPath.get(entry.name);
        if (!asset) return;
        const headers = new Headers();
        if (asset.contentType) headers.set("Content-Type", asset.contentType);
        headers.set("Content-Length", String(entry.size));
        await cache.put(toAbsoluteUrl(asset.url), new Response(entry.data, { status: 200, headers }));
        imported += 1;
      });

      if (!packageManifest || packageAssetsByPath.size === 0) throw new Error("资源包缺少 manifest.json");
      if (imported !== packageAssetsByPath.size) {
        throw new Error(`导入数量 ${imported} / ${packageAssetsByPath.size}`);
      }

      try {
        window.localStorage.setItem(RESOURCE_PACK_DOWNLOADED_AT_STORAGE_KEY, new Date().toISOString());
      } catch {
        // Ignore localStorage write errors.
      }

      await checkResourcePackGate.current();
    } catch (err) {
      setResourcePackImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setResourcePackImporting(false);
    }
  };

  const toggleAutoJoin = () => {
    setAutoJoinEnabled((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(AUTO_JOIN_ENABLED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage write errors and keep in-memory selection.
      }
      return next;
    });
    hasAutoJoined.current = false;
  };

  const roomJoinGateBlocked = resourcePackGateChecking || !resourcePackGateReady;
  const showResourcePackSetup = !resourcePackGateReady;

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
          {showResourcePackSetup ? (
            <>
              <button
                className={`${styles.createBtn} ${styles.createBtnResourcePack}`}
                onClick={() => openResourcePack("download")}
              >
                下载资源包
              </button>
              <button
                className={`${styles.createBtn} ${styles.createBtnResourceImport}`}
                onClick={() => packageInputRef.current?.click()}
                disabled={resourcePackImporting}
              >
                {resourcePackImporting ? "上传离线包中…" : "上传离线包"}
              </button>
              <button
                className={`${styles.createBtn} ${styles.createBtnResourceCheck}`}
                onClick={() => openResourcePack("check")}
              >
                校验
              </button>
            </>
          ) : (
            <>
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
              {canViewLegacyModes && (
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
              )}
              <button
                className={`${styles.createBtn} ${styles.createBtnPrimary}`}
                onClick={startSelectedMode}
                disabled={loading}
              >
                {loading ? "创建中…" : "开始"}
              </button>
              <button
                className={`${styles.createBtn} ${autoJoinEnabled ? styles.createBtnAutoJoinOn : styles.createBtnAutoJoinOff}`}
                onClick={toggleAutoJoin}
                type="button"
              >
                自动加入：{autoJoinEnabled ? "开启" : "关闭"}
              </button>
              <button
                className={`${styles.createBtn} ${styles.createBtnResourceCheck}`}
                onClick={() => openResourcePack("check")}
                type="button"
              >
                资源管理器
              </button>
            </>
          )}
          <input
            ref={packageInputRef}
            type="file"
            accept=".tgz,.tar.gz,application/gzip,application/x-gzip"
            className={styles.hiddenFileInput}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              void importOfflinePack(file);
            }}
          />
        </div>
        {resourcePackImportError && (
          <div className={styles.resourceImportError}>{`离线包加载失败：${resourcePackImportError}`}</div>
        )}
        {!showResourcePackSetup && (
          <div className={styles.bigStartWrap}>
            <button
              className={styles.bigStartBtn}
              onClick={startSelectedMode}
              disabled={loading}
            >
              {loading ? "创建中…" : `创建 ${startModeLabel(selectedStartMode)}`}
            </button>
          </div>
        )}
      </div>

      {resourcePackOverlay && (
        <div className={styles.resourcePackOverlay} role="presentation">
          <section className={styles.resourcePackPanel} role="dialog" aria-modal="true" aria-label={resourcePackOverlay.action === "download" ? "下载资源包" : "校验资源包"}>
            <button
              type="button"
              className={styles.resourcePackClose}
              onClick={closeResourcePackOverlay}
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

      {resourcePackGateReady && (
        <div className={styles.list}>
          {waitingGames.length === 0 && (
            <p className={styles.empty}>暂无可加入的房间</p>
          )}

          {waitingGames.map((g) => {
          const isMine = me && g.players?.[0] === me.uid;
          const maxPlayers = getLobbyMaxPlayers(g.mode);
          const playersJoined = Array.isArray(g.players) ? g.players.length : 0;
          const roomFull = playersJoined >= maxPlayers;
          const roomJoinDisabled = roomJoinGateBlocked || roomFull;

          return (
            <div
              key={g._id}
              className={`${styles.card} ${styles.waiting} ${
                isMine ? styles.mine : ""
              } ${roomJoinDisabled ? styles.waitingLocked : ""}`}
              onClick={() => {
                if (roomJoinDisabled) return;
                router.push(`/game/room?gameId=${g._id}`);
              }}
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
              <div className={styles.status}>
                {roomJoinGateBlocked ? "⚪ 需先完成校验（100%）" : roomFull ? "已满" : "🟢 等待加入"}
              </div>

              {/* 时间（右下角，仅分钟级） */}
              <div className={styles.time}>
                {g.createdAt ? timeAgo(g.createdAt) : ""}
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
