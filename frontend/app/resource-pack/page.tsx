"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, Download, PackageCheck, RotateCcw, Trash2, Upload, X } from "lucide-react";
import styles from "./page.module.css";

type ResourceCategory = "app" | "icons" | "sounds" | "fonts" | "game" | "map";

type ResourceAsset = {
  url: string;
  size: number;
  category: ResourceCategory;
};

type ResourceManifest = {
  cacheName?: string;
  assets?: ResourceAsset[];
  totalAssets?: number;
  totalBytes?: number;
};

type PackageAsset = ResourceAsset & {
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

type DownloadStatus = "idle" | "checking" | "ready" | "downloading" | "importing" | "done" | "failed";
type DialogMode = "download" | "check" | null;

const CACHE_NAME = "zhenchuan-resource-pack-v1";
const READY_STORAGE_KEY = "zhenchuan.resourcePack.ready.v1";
const DOWNLOADED_AT_STORAGE_KEY = "zhenchuan.resourcePack.downloadedAt.v1";
const VERIFIED_AT_STORAGE_KEY = "zhenchuan.resourcePack.verifiedAt.v1";
const DOWNLOAD_CONCURRENCY = 4;

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  app: "程序",
  icons: "图标",
  sounds: "音效",
  fonts: "字体",
  game: "游戏",
  map: "地图",
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "计算中";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

function statusText(status: DownloadStatus) {
  if (status === "done") return "已完成";
  if (status === "downloading") return "下载中";
  if (status === "importing") return "导入中";
  if (status === "checking") return "校验中";
  if (status === "failed") return "有失败";
  return "待下载";
}

function toAbsoluteUrl(url: string) {
  return new URL(url, window.location.origin).toString();
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  }));
}

async function registerResourceWorker() {
  if (!("serviceWorker" in navigator)) return false;
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5_000));
  const registration = await Promise.race([
    navigator.serviceWorker.register("/resource-pack-sw.js", { scope: "/" }).catch(() => null),
    timeout,
  ]);
  if (!registration) return false;

  await Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    timeout,
  ]);
  return true;
}

async function loadPackAssets() {
  const manifestResponse = await fetch("/resource-pack/manifest", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
  const manifest = await manifestResponse.json() as ResourceManifest;

  const byUrl = new Map<string, ResourceAsset>();
  for (const asset of manifest.assets ?? []) {
    byUrl.set(asset.url, asset);
  }
  return Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url));
}

const tarTextDecoder = new TextDecoder();

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

export default function ResourcePackPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<ResourceAsset[]>([]);
  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [completed, setCompleted] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [processedBytes, setProcessedBytes] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [storageText, setStorageText] = useState("");
  const [workerReady, setWorkerReady] = useState(false);
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [downloadStartedAt, setDownloadStartedAt] = useState<number | null>(null);
  const [downloadNow, setDownloadNow] = useState(() => Date.now());
  const [embedded, setEmbedded] = useState(false);
  const packageInputRef = useRef<HTMLInputElement | null>(null);
  const queryActionHandledRef = useRef(false);

  const totalBytes = useMemo(
    () => assets.reduce((sum, asset) => sum + (Number.isFinite(asset.size) ? asset.size : 0), 0),
    [assets],
  );
  const progressPct = assets.length === 0 ? 0 : Math.round((completed / assets.length) * 100);
  const cachePct = assets.length === 0 ? 0 : Math.round((cachedCount / assets.length) * 100);
  const elapsedMs = downloadStartedAt ? Math.max(0, downloadNow - downloadStartedAt) : 0;
  const speedBytesPerSecond = status === "downloading" && elapsedMs > 0 ? downloadedBytes / (elapsedMs / 1000) : 0;
  const remainingBytes = Math.max(0, totalBytes - processedBytes);
  const etaText = status === "downloading" && speedBytesPerSecond > 0
    ? formatDuration((remainingBytes / speedBytesPerSecond) * 1000)
    : "计算中";
  const primaryDownloadLabel = status === "done" ? "重新下载资源包" : status === "downloading" ? "下载中" : "下载资源包";
  const busy = status === "downloading" || status === "checking" || status === "importing";
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<ResourceCategory, number>> = {};
    for (const asset of assets) counts[asset.category] = (counts[asset.category] ?? 0) + 1;
    return counts;
  }, [assets]);

  useEffect(() => {
    if (status !== "downloading") return;
    const timer = window.setInterval(() => setDownloadNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [status]);

  const refreshStorage = useCallback(async () => {
    if (!navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    const usage = typeof estimate.usage === "number" ? estimate.usage : 0;
    const quota = typeof estimate.quota === "number" ? estimate.quota : 0;
    setStorageText(quota > 0 ? `${formatBytes(usage)} / ${formatBytes(quota)}` : formatBytes(usage));
  }, []);

  const checkCache = useCallback(async (nextAssets: ResourceAsset[]) => {
    if (!("caches" in window)) {
      setCachedCount(0);
      setCompleted(0);
      setProcessedBytes(0);
      setStatus("ready");
      await refreshStorage();
      return;
    }
    setStatus("checking");
    setCompleted(0);
    setCachedCount(0);
    setProcessedBytes(0);
    const cache = await caches.open(CACHE_NAME);
    let cached = 0;
    let checked = 0;
    let cachedBytes = 0;
    await runWithConcurrency(nextAssets, 12, async (asset) => {
      const match = await cache.match(toAbsoluteUrl(asset.url), { ignoreVary: true });
      if (match) {
        cached += 1;
        cachedBytes += Number.isFinite(asset.size) ? asset.size : 0;
        setCachedCount(cached);
        setProcessedBytes(cachedBytes);
      }
      checked += 1;
      setCompleted(checked);
    });
    setCachedCount(cached);
    const complete = nextAssets.length > 0 && cached === nextAssets.length;
    if (complete) {
      const now = new Date().toISOString();
      window.localStorage.setItem(READY_STORAGE_KEY, "true");
      window.localStorage.setItem(VERIFIED_AT_STORAGE_KEY, now);
      setVerifiedAt(now);
    } else {
      window.localStorage.removeItem(READY_STORAGE_KEY);
      window.localStorage.removeItem(VERIFIED_AT_STORAGE_KEY);
    }
    setStatus(complete ? "done" : "ready");
    const savedAt = window.localStorage.getItem(DOWNLOADED_AT_STORAGE_KEY);
    const savedVerifiedAt = window.localStorage.getItem(VERIFIED_AT_STORAGE_KEY);
    setDownloadedAt(savedAt);
    setVerifiedAt(savedVerifiedAt);
    await refreshStorage();
  }, [refreshStorage]);

  const load = useCallback(async () => {
    setStatus("checking");
    setFailures([]);
    try {
      const nextAssets = await loadPackAssets();
      setAssets(nextAssets);
      await checkCache(nextAssets);
      void registerResourceWorker().then((registered) => setWorkerReady(registered));
    } catch (err) {
      setStatus("failed");
      setFailures([err instanceof Error ? err.message : String(err)]);
    }
  }, [checkCache]);

  useEffect(() => {
    setEmbedded(new URLSearchParams(window.location.search).get("embed") === "1");
    void load();
  }, [load]);

  const downloadPack = useCallback(async () => {
    const nextAssets = assets.length > 0 ? assets : await loadPackAssets();
    setAssets(nextAssets);
    setDialogMode("download");
    setStatus("downloading");
    setFailures([]);
    setCompleted(0);
    setCachedCount(0);
    setDownloadedBytes(0);
    setProcessedBytes(0);
    const startedAt = Date.now();
    setDownloadStartedAt(startedAt);
    setDownloadNow(startedAt);

    try {
      const registered = await registerResourceWorker();
      setWorkerReady(registered);
      const cache = await caches.open(CACHE_NAME);
      let cached = 0;
      let processed = 0;
      const failed: string[] = [];

      await runWithConcurrency(nextAssets, DOWNLOAD_CONCURRENCY, async (asset) => {
        const assetSize = Number.isFinite(asset.size) && asset.size > 0 ? asset.size : 0;
        try {
          const absoluteUrl = toAbsoluteUrl(asset.url);
          const alreadyCached = await cache.match(absoluteUrl, { ignoreVary: true });
          if (!alreadyCached) {
            const response = await fetch(absoluteUrl, {
              cache: "reload",
              credentials: "same-origin",
            });
            if (!response.ok) throw new Error(`${response.status}`);
            const contentLength = Number(response.headers.get("content-length"));
            const expectedBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : assetSize;
            const cachePromise = cache.put(absoluteUrl, response.clone());
            let streamedBytes = 0;

            if (response.body) {
              const reader = response.body.getReader();
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                const chunkBytes = chunk.value.byteLength;
                streamedBytes += chunkBytes;
                processed += chunkBytes;
                setDownloadedBytes((value) => value + chunkBytes);
                setProcessedBytes(processed);
                setDownloadNow(Date.now());
              }
            }

            await cachePromise;

            if (!response.body || streamedBytes === 0) {
              processed += expectedBytes;
              setDownloadedBytes((value) => value + expectedBytes);
              setProcessedBytes(processed);
            } else if (expectedBytes > streamedBytes) {
              processed += expectedBytes - streamedBytes;
              setProcessedBytes(processed);
            }
          } else {
            processed += assetSize;
            setProcessedBytes(processed);
          }
          cached += 1;
          setCachedCount(cached);
        } catch (err) {
          failed.push(`${asset.url} (${err instanceof Error ? err.message : String(err)})`);
          setFailures([...failed].slice(-12));
        } finally {
          setCompleted((value) => value + 1);
        }
      });

      if (failed.length > 0) {
        setStatus("failed");
      } else {
        const now = new Date().toISOString();
        window.localStorage.setItem(READY_STORAGE_KEY, "true");
        window.localStorage.setItem(DOWNLOADED_AT_STORAGE_KEY, now);
        window.localStorage.setItem(VERIFIED_AT_STORAGE_KEY, now);
        setDownloadedAt(now);
        setVerifiedAt(now);
        setStatus("done");
      }
      await refreshStorage();
    } catch (err) {
      setStatus("failed");
      setFailures([err instanceof Error ? err.message : String(err)]);
    } finally {
      setDownloadNow(Date.now());
    }
  }, [assets, refreshStorage]);

  const downloadPackageFile = useCallback(() => {
    const link = document.createElement("a");
    link.href = "/resource-pack/package";
    link.download = "zhenchuan-resource-pack.tgz";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  const importPackageFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!("caches" in window)) {
      setStatus("failed");
      setFailures(["当前浏览器不支持本地缓存"]);
      return;
    }

    setDialogMode(null);
    setStatus("importing");
    setFailures([]);
    setCompleted(0);
    setCachedCount(0);
    setDownloadedBytes(file.size);
    setProcessedBytes(0);
    setDownloadStartedAt(Date.now());
    setDownloadNow(Date.now());

    try {
      const registered = await registerResourceWorker();
      setWorkerReady(registered);
      const cache = await caches.open(CACHE_NAME);
      let packageManifest: PackageManifest | null = null;
      let packageAssetsByPath = new Map<string, PackageAsset>();
      let imported = 0;
      let processed = 0;
      const failed: string[] = [];

      await readTarGzipEntries(file, async (entry) => {
        if (entry.name === "manifest.json") {
          packageManifest = JSON.parse(tarTextDecoder.decode(entry.data)) as PackageManifest;
          const packageAssets = Array.isArray(packageManifest.assets) ? packageManifest.assets : [];
          packageAssetsByPath = new Map(packageAssets.map((asset) => [asset.packagePath, asset]));
          setAssets(packageAssets.map(({ url, size, category }) => ({ url, size, category })));
          return;
        }

        const asset = packageAssetsByPath.get(entry.name);
        if (!asset) return;
        try {
          const headers = new Headers();
          if (asset.contentType) headers.set("Content-Type", asset.contentType);
          headers.set("Content-Length", String(entry.size));
          await cache.put(toAbsoluteUrl(asset.url), new Response(entry.data, { status: 200, headers }));
          imported += 1;
          processed += Number.isFinite(asset.size) ? asset.size : entry.size;
          setCachedCount(imported);
          setCompleted(imported);
          setProcessedBytes(processed);
          setDownloadNow(Date.now());
        } catch (err) {
          failed.push(`${asset.url} (${err instanceof Error ? err.message : String(err)})`);
          setFailures([...failed].slice(-12));
        }
      });

      if (!packageManifest || packageAssetsByPath.size === 0) throw new Error("资源包缺少 manifest.json");
      if (failed.length > 0 || imported !== packageAssetsByPath.size) {
        setStatus("failed");
        if (imported !== packageAssetsByPath.size) {
          setFailures((current) => [...current, `导入数量 ${imported} / ${packageAssetsByPath.size}`].slice(-12));
        }
        return;
      }

      const now = new Date().toISOString();
      window.localStorage.setItem(READY_STORAGE_KEY, "true");
      window.localStorage.setItem(DOWNLOADED_AT_STORAGE_KEY, now);
      window.localStorage.setItem(VERIFIED_AT_STORAGE_KEY, now);
      setDownloadedAt(now);
      setVerifiedAt(now);
      setStatus("done");
      await refreshStorage();
    } catch (err) {
      window.localStorage.removeItem(READY_STORAGE_KEY);
      setStatus("failed");
      setFailures([err instanceof Error ? err.message : String(err)]);
    } finally {
      setDownloadNow(Date.now());
      setDownloadStartedAt(null);
    }
  }, [refreshStorage]);

  const clearPack = useCallback(async () => {
    if ("caches" in window) await caches.delete(CACHE_NAME);
    window.localStorage.removeItem(READY_STORAGE_KEY);
    window.localStorage.removeItem(DOWNLOADED_AT_STORAGE_KEY);
    window.localStorage.removeItem(VERIFIED_AT_STORAGE_KEY);
    setCachedCount(0);
    setCompleted(0);
    setDownloadedBytes(0);
    setProcessedBytes(0);
    setDownloadedAt(null);
    setVerifiedAt(null);
    setStatus("ready");
    await refreshStorage();
  }, [refreshStorage]);

  const verifyPack = useCallback(async () => {
    const nextAssets = assets.length > 0 ? assets : await loadPackAssets();
    setAssets(nextAssets);
    setDialogMode("check");
    setFailures([]);
    await checkCache(nextAssets);
  }, [assets, checkCache]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (action !== "download" && action !== "check") return;
    if (queryActionHandledRef.current || assets.length === 0 || busy) return;
    queryActionHandledRef.current = true;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (action === "download") void downloadPack();
      if (action === "check") void verifyPack();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assets.length, busy, downloadPack, verifyPack]);

  const canCloseDialog = !busy;
  const dialogTitle = dialogMode === "check" ? "校验资源包" : "下载资源包";
  const dialogProgressLabel = dialogMode === "check" ? "校验进度" : "下载进度";

  return (
    <main className={`${styles.page} ${embedded ? styles.pageEmbedded : ""}`}>
      {!embedded && (
        <header className={styles.header}>
          <button type="button" className={styles.backButton} onClick={() => router.push("/")}>返回</button>
          <div>
            <h1 className={styles.title}>资源包</h1>
            <p className={styles.subtitle}>地图、图标、音效、本地程序缓存</p>
          </div>
        </header>
      )}

      <section className={styles.toolbar}>
        <button type="button" className={styles.primaryButton} onClick={() => void downloadPack()} disabled={busy}>
          <Download size={18} aria-hidden="true" />
          {primaryDownloadLabel}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={downloadPackageFile} disabled={busy || assets.length === 0}>
          <Archive size={17} aria-hidden="true" />
          下载离线包
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => packageInputRef.current?.click()} disabled={busy}>
          <Upload size={17} aria-hidden="true" />
          导入离线包
        </button>
        <input
          ref={packageInputRef}
          type="file"
          accept=".tgz,.tar.gz,application/gzip,application/x-gzip"
          className={styles.hiddenFileInput}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            void importPackageFile(file);
          }}
        />
        <button type="button" className={styles.secondaryButton} onClick={() => void verifyPack()} disabled={busy || assets.length === 0}>
          <RotateCcw size={17} aria-hidden="true" />
          校验
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => void clearPack()} disabled={busy}>
          <Trash2 size={17} aria-hidden="true" />
          清除
        </button>
      </section>

      <section className={styles.statusGrid}>
        <div className={styles.statBox}>
          <span className={styles.statLabel}>状态</span>
          <strong className={styles.statValue}>{statusText(status)}</strong>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statLabel}>文件</span>
          <strong className={styles.statValue}>{cachedCount} / {assets.length}</strong>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statLabel}>大小</span>
          <strong className={styles.statValue}>{formatBytes(totalBytes)}</strong>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statLabel}>浏览器缓存</span>
          <strong className={styles.statValue}>{storageText || "-"}</strong>
        </div>
      </section>

      <section className={styles.progressSection}>
        <div className={styles.progressTop}>
          <span>{cachedCount} / {assets.length}</span>
          <span>{cachePct}%</span>
        </div>
        <div className={styles.progressTrack} aria-label="资源包缓存完整度">
          <div className={styles.progressFill} style={{ width: `${cachePct}%` }} />
        </div>
        <div className={styles.packMeta}>
          <span><PackageCheck size={16} aria-hidden="true" />{workerReady ? "缓存服务已启用" : "缓存服务不可用"}</span>
          <span><CheckCircle2 size={16} aria-hidden="true" />本次下载 {formatBytes(downloadedBytes)}</span>
          <span>最后完成 {downloadedAt ? new Date(downloadedAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</span>
          <span>最后校验 {verifiedAt ? new Date(verifiedAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</span>
        </div>
      </section>

      <section className={styles.categoryBar} aria-label="资源分类">
        {(Object.keys(CATEGORY_LABELS) as ResourceCategory[]).map((category) => (
          <span key={category} className={styles.categoryPill}>{CATEGORY_LABELS[category]} {categoryCounts[category] ?? 0}</span>
        ))}
      </section>

      {failures.length > 0 && (
        <section className={styles.failureBox}>
          <h2>失败文件</h2>
          {failures.map((failure) => <p key={failure}>{failure}</p>)}
        </section>
      )}

      {dialogMode && !embedded && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.modalPanel} role="dialog" aria-modal="true" aria-labelledby="resource-pack-dialog-title">
            <div className={styles.modalHeader}>
              <div>
                <h2 id="resource-pack-dialog-title">{dialogTitle}</h2>
                <p>{dialogMode === "check" ? "检查本机缓存是否已经拥有当前资源包" : "把资源写入浏览器本地缓存"}</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setDialogMode(null)}
                disabled={!canCloseDialog}
                aria-label="关闭"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.modalStats}>
              <div>
                <span>状态</span>
                <strong>{statusText(status)}</strong>
              </div>
              <div>
                <span>已缓存</span>
                <strong>{cachedCount} / {assets.length}</strong>
              </div>
              <div>
                <span>速度</span>
                <strong>{status === "downloading" ? `${formatBytes(speedBytesPerSecond)}/s` : "-"}</strong>
              </div>
              <div>
                <span>预计剩余</span>
                <strong>{status === "downloading" ? etaText : "-"}</strong>
              </div>
            </div>

            <div className={styles.modalProgressTop}>
              <span>{dialogProgressLabel}</span>
              <span>{progressPct}%</span>
            </div>
            <div className={styles.progressTrack} aria-label={dialogProgressLabel}>
              <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
            </div>
            <div className={styles.modalProgressTop}>
              <span>缓存完整度</span>
              <span>{cachePct}%</span>
            </div>
            <div className={styles.cacheTrack} aria-label="缓存完整度">
              <div className={styles.cacheFill} style={{ width: `${cachePct}%` }} />
            </div>

            <div className={styles.modalFoot}>
              <span>资源大小 {formatBytes(totalBytes)}</span>
              <span>本次下载 {formatBytes(downloadedBytes)}</span>
              <button type="button" className={styles.secondaryButton} onClick={() => setDialogMode(null)} disabled={!canCloseDialog}>完成</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}