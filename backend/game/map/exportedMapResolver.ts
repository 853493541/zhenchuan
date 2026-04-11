import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MapObject, MapObjectType } from "../engine/state/types/map";

const EXPORT_SCAN_DEPTH = 7;
const MAX_IMPORTED_OBJECTS = 2400;

type ExportPackageCandidate = {
  packageName: string;
  createdAt: number;
  packageRoot: string;
};

export type ExportCollisionMap = {
  packageName: string;
  width: number;
  height: number;
  spawnCenterX: number;
  spawnCenterY: number;
  objects: MapObject[];
  sourceObjectCount: number;
};

type CacheEntry = {
  packageRoot: string;
  mtimeMs: number;
  map: ExportCollisionMap;
};

const collisionCache = new Map<string, CacheEntry>();

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveExportRoots(): string[] {
  const raw =
    process.env.EXPORT_VIEWER_ROOTS ||
    process.env.FULL_EXPORTS_ROOTS ||
    process.env.FULL_EXPORT_ROOTS ||
    "";

  const envRoots = raw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => path.resolve(s));

  const cwd = process.cwd();
  const defaults = [
    path.resolve(cwd, "public/game/exported-maps"),
    path.resolve(cwd, "frontend/public/game/exported-maps"),
    path.resolve(cwd, "frontend/public/game"),
    path.resolve(cwd, "frontend/public"),
    path.resolve(cwd, "../frontend/public/game/exported-maps"),
    path.resolve(cwd, "../frontend/public/game"),
    path.resolve(cwd, "../frontend/public"),
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../../frontend/public/game/exported-maps"),
    path.resolve(path.join(os.homedir(), "Desktop", "JX3FullExports")),
  ];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [...envRoots, ...defaults]) {
    const abs = path.resolve(candidate);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (isDirectory(abs)) out.push(abs);
  }

  return out;
}

function readManifestPackage(packageRoot: string): ExportPackageCandidate | null {
  const manifestPath = path.join(packageRoot, "manifest.json");
  const mapDataPath = path.join(packageRoot, "map-data");

  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) return null;
  if (!isDirectory(mapDataPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    const packageName = String(manifest?.packageName || path.basename(packageRoot)).trim();
    if (!packageName) return null;

    const createdAtRaw = Number(manifest?.createdAt);
    const createdAt = Number.isFinite(createdAtRaw)
      ? createdAtRaw
      : fs.statSync(manifestPath).mtimeMs;

    return {
      packageName,
      createdAt,
      packageRoot,
    };
  } catch {
    return null;
  }
}

function scanRootPackages(root: string): ExportPackageCandidate[] {
  const out: ExportPackageCandidate[] = [];
  if (!isDirectory(root)) return out;

  const skipDirs = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    ".vscode",
    "test-results",
  ]);

  const stack: Array<{ dir: string; depth: number }> = [{
    dir: path.resolve(root),
    depth: 0,
  }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    const pkg = readManifestPackage(current.dir);
    if (pkg) {
      out.push(pkg);
      continue;
    }

    if (current.depth >= EXPORT_SCAN_DEPTH) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;
      stack.push({
        dir: path.join(current.dir, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return out;
}

function scanAllPackages(): ExportPackageCandidate[] {
  const roots = resolveExportRoots();
  return roots.flatMap((root) => scanRootPackages(root));
}

function resolvePackageByName(packageName: string): ExportPackageCandidate | null {
  let latest: ExportPackageCandidate | null = null;
  const normalized = packageName.trim().toLowerCase();
  if (!normalized) return null;

  for (const pkg of scanAllPackages()) {
    if (pkg.packageName.toLowerCase() !== normalized) continue;
    if (!latest || pkg.createdAt > latest.createdAt) latest = pkg;
  }

  return latest;
}

function resolveLatestPackage(): ExportPackageCandidate | null {
  let latest: ExportPackageCandidate | null = null;
  for (const pkg of scanAllPackages()) {
    if (!latest || pkg.createdAt > latest.createdAt) latest = pkg;
  }
  return latest;
}

export function resolveExportPackageName(requested: string): string | null {
  const pkg = resolvePackageByName(requested);
  return pkg?.packageName ?? null;
}

export function resolveLatestExportPackageName(): string | null {
  return resolveLatestPackage()?.packageName ?? null;
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeType(rawType: unknown): MapObjectType {
  const t = String(rawType ?? "").toLowerCase();
  if (t === "rock") return "rock";
  if (t === "mountain") return "mountain";
  if (t === "hill_high") return "hill_high";
  if (t === "hill_low") return "hill_low";
  return "building";
}

function sanitizeCollisionObjects(raw: unknown[]): MapObject[] {
  const objects: MapObject[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;

    const rec = entry as Record<string, unknown>;
    const x = toFiniteNumber(rec.x);
    const y = toFiniteNumber(rec.y);
    const w = toFiniteNumber(rec.w);
    const d = toFiniteNumber(rec.d);
    const h = toFiniteNumber(rec.h);

    if (
      x === null ||
      y === null ||
      w === null ||
      d === null ||
      h === null ||
      w <= 0 ||
      d <= 0 ||
      h <= 0
    ) {
      continue;
    }

    objects.push({
      id: String(rec.id ?? `obj_${objects.length}`),
      type: normalizeType(rec.type),
      x,
      y,
      w,
      d,
      h,
    });
  }

  return objects;
}

function deriveBounds(objects: MapObject[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const obj of objects) {
    if (obj.x < minX) minX = obj.x;
    if (obj.y < minY) minY = obj.y;
    if (obj.x + obj.w > maxX) maxX = obj.x + obj.w;
    if (obj.y + obj.d > maxY) maxY = obj.y + obj.d;
  }

  return { minX, minY, maxX, maxY };
}

function selectRuntimeObjects(objects: MapObject[]): MapObject[] {
  if (objects.length <= MAX_IMPORTED_OBJECTS) return objects;

  // Keep larger footprints first so runtime collision stays performant.
  const sorted = [...objects].sort((a, b) => (b.w * b.d) - (a.w * a.d));
  return sorted.slice(0, MAX_IMPORTED_OBJECTS);
}

export function loadExportCollisionMap(packageName: string): ExportCollisionMap | null {
  const resolved = resolvePackageByName(packageName);
  if (!resolved) return null;

  const collisionPath = path.join(resolved.packageRoot, "map-data", "collision.json");
  if (!fs.existsSync(collisionPath) || !fs.statSync(collisionPath).isFile()) return null;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(collisionPath).mtimeMs;
  } catch {
    return null;
  }

  const cached = collisionCache.get(resolved.packageName);
  if (
    cached &&
    cached.packageRoot === resolved.packageRoot &&
    Math.abs(cached.mtimeMs - mtimeMs) < 1e-3
  ) {
    return cached.map;
  }

  try {
    const raw = fs.readFileSync(collisionPath, "utf8");
    const parsed = JSON.parse(raw) as { objects?: unknown[] };

    const sourceObjects = sanitizeCollisionObjects(Array.isArray(parsed.objects) ? parsed.objects : []);
    if (sourceObjects.length === 0) return null;

    const bounds = deriveBounds(sourceObjects);
    const runtimeObjects = selectRuntimeObjects(sourceObjects);

    const width = Math.max(200, Math.ceil(bounds.maxX + 50));
    const height = Math.max(200, Math.ceil(bounds.maxY + 50));

    const map: ExportCollisionMap = {
      packageName: resolved.packageName,
      width,
      height,
      spawnCenterX: (bounds.minX + bounds.maxX) * 0.5,
      spawnCenterY: (bounds.minY + bounds.maxY) * 0.5,
      objects: runtimeObjects,
      sourceObjectCount: sourceObjects.length,
    };

    collisionCache.set(resolved.packageName, {
      packageRoot: resolved.packageRoot,
      mtimeMs,
      map,
    });

    return map;
  } catch {
    return null;
  }
}
