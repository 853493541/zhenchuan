import fs from "node:fs/promises";
import path from "node:path";

export type ResourceCategory = "icons" | "sounds" | "fonts" | "game" | "app" | "map";

export type ResourcePackAsset = {
  url: string;
  size: number;
  category: ResourceCategory;
};

export type ResourcePackFile = ResourcePackAsset & {
  filePath: string;
  packagePath: string;
  contentType: string;
};

export const RESOURCE_PACK_CACHE_NAME = "zhenchuan-resource-pack-v1";

const PUBLIC_ASSET_EXTENSIONS = new Set([
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".json",
  ".bin",
  ".glb",
  ".gltf",
  ".ogg",
  ".wem",
  ".mp3",
  ".wav",
  ".woff2",
  ".js",
  ".html",
  ".txt",
]);


const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".bin": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ogg": "audio/ogg",
  ".wem": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
};

const PUBLIC_TOOL_FILES = [
  "export-reader.html",
  "full-validator.html",
  "mesh-inspector.html",
  "resource-pack-sw.js",
] as const;

function encodeUrlPath(pathLike: string) {
  return pathLike
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildAssetUrl(baseUrl: string, relPath: string) {
  const normalizedBase = baseUrl === "/" ? "" : baseUrl.replace(/\/+$/, "");
  const encodedRelPath = encodeUrlPath(relPath);
  return `${normalizedBase}/${encodedRelPath}`.replace(/^\/\//, "/");
}

function categoryForPublicPath(relPath: string): ResourceCategory {
  const normalized = relPath.replace(/\\/g, "/");
  const first = normalized.split("/")[0];
  if (first === "icons") return "icons";
  if (first === "fonts") return "fonts";
  if (first === "sounds" || normalized.startsWith("game/sounds/")) return "sounds";
  return "game";
}

function contentTypeForPath(filePath: string) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function collectFiles(
  root: string,
  baseUrl: string,
  extensions: Set<string>,
  category?: ResourceCategory,
  includeFile?: (relPath: string) => boolean,
) {
  const assets: Array<Omit<ResourcePackFile, "packagePath">> = [];

  async function walk(dir: string) {
    let entries: Array<import("node:fs").Dirent> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        return;
      }
      if (!entry.isFile()) return;
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) return;
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) return;
      const relPath = path.relative(root, fullPath);
      if (includeFile && !includeFile(relPath)) return;
      assets.push({
        url: buildAssetUrl(baseUrl, relPath),
        size: stat.size,
        category: category ?? categoryForPublicPath(relPath),
        filePath: fullPath,
        contentType: contentTypeForPath(fullPath),
      });
    }));
  }

  await walk(root);
  return assets;
}

async function collectSpecificFiles(
  root: string,
  relPaths: readonly string[],
  category: ResourceCategory,
) {
  const assets: Array<Omit<ResourcePackFile, "packagePath">> = [];

  await Promise.all(relPaths.map(async (relPath) => {
    const fullPath = path.join(root, relPath);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat?.isFile()) return;
    assets.push({
      url: buildAssetUrl("/", relPath),
      size: stat.size,
      category,
      filePath: fullPath,
      contentType: contentTypeForPath(fullPath),
    });
  }));

  return assets;
}

export async function collectResourcePackFiles(): Promise<ResourcePackFile[]> {
  const cwd = process.cwd();
  const publicRoot = path.join(cwd, "public");
  const exportedMapsRoot = path.join(publicRoot, "game", "exported-maps");

  const publicAssets = (await Promise.all([
    collectFiles(path.join(publicRoot, "icons"), "/icons", PUBLIC_ASSET_EXTENSIONS, "icons"),
    collectFiles(path.join(publicRoot, "fonts"), "/fonts", PUBLIC_ASSET_EXTENSIONS, "fonts"),
    collectFiles(path.join(publicRoot, "js"), "/js", PUBLIC_ASSET_EXTENSIONS, "app"),
    collectFiles(path.join(publicRoot, "lib"), "/lib", PUBLIC_ASSET_EXTENSIONS, "app"),
    collectSpecificFiles(publicRoot, PUBLIC_TOOL_FILES, "app"),
    collectFiles(
      path.join(publicRoot, "game"),
      "/game",
      PUBLIC_ASSET_EXTENSIONS,
      undefined,
      (relPath) => !relPath.replace(/\\/g, "/").startsWith("exported-maps/"),
    ),
    collectFiles(exportedMapsRoot, "/full-exports", PUBLIC_ASSET_EXTENSIONS, "map"),
  ])).flat();
  const assetsByUrl = new Map<string, Omit<ResourcePackFile, "packagePath">>();
  for (const asset of publicAssets) {
    assetsByUrl.set(asset.url, asset);
  }

  return Array.from(assetsByUrl.values())
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((asset, index) => ({
      ...asset,
      packagePath: `assets/${String(index + 1).padStart(5, "0")}.bin`,
    }));
}

export function buildResourcePackManifest(files: ResourcePackFile[]) {
  const assets: ResourcePackAsset[] = files.map(({ url, size, category }) => ({ url, size, category }));
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    cacheName: RESOURCE_PACK_CACHE_NAME,
    assets,
    totalAssets: assets.length,
    totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
  };
}
