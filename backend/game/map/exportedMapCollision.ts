import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

const EXPORT_SCAN_DEPTH = 7;
const PACKAGE_NAME = "Ctest-2026-04-10T23-11-25-797Z";
const BASE_RENDER_SF = 0.005557531566779299;
const MAP_SCALE = 2.4;

export const EXPORTED_COLLISION_RENDER_SF = BASE_RENDER_SF * MAP_SCALE;
export const EXPORTED_COLLISION_GROUP_POS_X = -308.44;
export const EXPORTED_COLLISION_GROUP_POS_Y = -3.01;
export const EXPORTED_COLLISION_GROUP_POS_Z = 1682.71;
export const COLLISION_TEST_PLAYER_RADIUS = 0.64;
export const EXPORTED_COLLISION_RADIUS = COLLISION_TEST_PLAYER_RADIUS / EXPORTED_COLLISION_RENDER_SF;

interface HeightmapConfig {
  worldOriginX: number;
  worldOriginY: number;
  regionSize: number;
  unitScaleX: number;
  unitScaleY: number;
  regionGridX: number;
  regionGridY: number;
  heightmapResolution: number;
  heightMax: number;
  heightMin: number;
}

type EntityRecord = {
  mesh?: string;
  matrix?: number[];
};

export class ExportedMapCollisionSystem {
  shellBVH: MeshBVH | null = null;
  shellGeometry: THREE.BufferGeometry | null = null;

  private heightmaps = new Map<string, Float32Array>();
  private hmConfig: HeightmapConfig | null = null;
  private regionWorldSize = 0;

  private readonly hitTarget = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
  private readonly push = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly triA = new THREE.Vector3();
  private readonly triB = new THREE.Vector3();
  private readonly triC = new THREE.Vector3();
  private readonly edgeA = new THREE.Vector3();
  private readonly edgeB = new THREE.Vector3();

  initBVH(trianglesFlat: Float32Array | number[]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      trianglesFlat instanceof Float32Array
        ? new THREE.BufferAttribute(trianglesFlat, 3)
        : new THREE.Float32BufferAttribute(trianglesFlat, 3),
    );
    this.shellGeometry = geometry;
    this.shellBVH = new MeshBVH(geometry);
  }

  initTerrain(config: HeightmapConfig, heightmaps: Map<string, Float32Array>) {
    this.hmConfig = config;
    this.heightmaps = heightmaps;
    this.regionWorldSize = config.regionSize * config.unitScaleX;
  }

  resolveSphereCollision(center: THREE.Vector3, radius: number, velocity: THREE.Vector3): { onGround: boolean; hitDistance: number } {
    if (!this.shellBVH) return { onGround: false, hitDistance: Infinity };

    let onGround = false;
    let hitDistance = Infinity;
    const bvh = this.shellBVH as any;

    for (let i = 0; i < 5; i++) {
      this.hitTarget.point.set(0, 0, 0);
      this.hitTarget.distance = Infinity;
      this.hitTarget.faceIndex = -1;

      const hit = bvh.closestPointToPoint(center, this.hitTarget, 0, radius + 220) as
        | { point: THREE.Vector3; distance: number; faceIndex: number }
        | null;
      if (!hit) break;

      hitDistance = Math.min(hitDistance, hit.distance);
      if (hit.distance >= radius) break;

      this.push.subVectors(center, hit.point);
      let len = this.push.length();
      const normal = this.getFaceNormal(hit.faceIndex, this.normal);
      const isHorizontalSurface = !!normal && Math.abs(normal.y) >= 0.58;
      const verticalRatio = len > 1e-6 ? this.push.y / len : 0;
      const isFloorContact = isHorizontalSurface && verticalRatio > 0.2;
      const isCeilingContact = isHorizontalSurface && verticalRatio < -0.2;

      if (!isFloorContact) {
        this.push.y = 0;
        len = this.push.length();

        if (len < 1e-6 && normal) {
          this.push.set(normal.x, 0, normal.z);
          len = this.push.length();
        }
        if (len < 1e-6) {
          this.push.set(center.x - hit.point.x, 0, center.z - hit.point.z);
          len = this.push.length();
        }
        if (isCeilingContact && velocity.y > 0) velocity.y = 0;
      }

      if (len < 1e-6) {
        if (!isFloorContact) continue;
        this.push.set(0, 1, 0);
        len = 1;
      }

      const penetration = radius - hit.distance + 0.6;
      this.push.multiplyScalar(penetration / len);
      center.add(this.push);

      if (isFloorContact && this.push.y > 0) {
        onGround = true;
        if (velocity.y < 0) velocity.y = 0;
      }
    }

    return { onGround, hitDistance };
  }

  getSupportGroundY(center: THREE.Vector3): number | null {
    const shellY = this.sampleShellGroundY(center);
    const terrainY = this.getTerrainHeightAt(center.x, center.z);

    if (shellY === null && terrainY === null) return null;
    if (shellY === null) return terrainY;
    if (terrainY === null) return shellY;
    return Math.max(shellY, terrainY);
  }

  private getFaceNormal(faceIndex: number, out: THREE.Vector3): THREE.Vector3 | null {
    const position = this.shellGeometry?.getAttribute("position");
    if (!position || faceIndex < 0) return null;

    const i0 = faceIndex * 3;
    if (i0 + 2 >= position.count) return null;

    this.triA.fromBufferAttribute(position, i0);
    this.triB.fromBufferAttribute(position, i0 + 1);
    this.triC.fromBufferAttribute(position, i0 + 2);

    this.edgeA.subVectors(this.triB, this.triA);
    this.edgeB.subVectors(this.triC, this.triA);
    out.crossVectors(this.edgeA, this.edgeB);

    const lenSq = out.lengthSq();
    if (lenSq < 1e-10) return null;
    out.multiplyScalar(1 / Math.sqrt(lenSq));
    return out;
  }

  private sampleShellGroundY(center: THREE.Vector3): number | null {
    if (!this.shellBVH) return null;
    const bvh = this.shellBVH as any;

    const maxRise = 72;
    const maxDrop = 12000;

    this.ray.origin.set(center.x, center.y + maxRise, center.z);
    this.ray.direction.set(0, -1, 0);

    let hit = bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, maxDrop + maxRise) as
      | { point?: THREE.Vector3 }
      | null;
    if (hit?.point && Number.isFinite(hit.point.y)) return hit.point.y;

    this.ray.origin.set(center.x, center.y + 2600, center.z);
    hit = bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, 16000) as { point?: THREE.Vector3 } | null;
    if (!hit?.point || !Number.isFinite(hit.point.y)) return null;
    if (hit.point.y > center.y + maxRise) return null;
    return hit.point.y;
  }

  private getTerrainHeightAt(worldX: number, worldZ: number): number | null {
    if (!this.hmConfig) return null;

    const cfg = this.hmConfig;
    const localX = worldX - cfg.worldOriginX;
    const localZ = -worldZ - cfg.worldOriginY;
    const rx = Math.floor(localX / this.regionWorldSize);
    const ry = Math.floor(localZ / this.regionWorldSize);

    if (rx < 0 || rx >= cfg.regionGridX || ry < 0 || ry >= cfg.regionGridY) return null;

    const hd = this.heightmaps.get(`${rx}_${ry}`);
    if (!hd) return null;

    const inX = localX - rx * this.regionWorldSize;
    const inZ = localZ - ry * this.regionWorldSize;
    const hmX = inX / cfg.unitScaleX;
    const hmY = inZ / cfg.unitScaleY;
    const hmRes = cfg.heightmapResolution;

    const x0 = Math.max(0, Math.min(Math.floor(hmX), hmRes - 2));
    const y0 = Math.max(0, Math.min(Math.floor(hmY), hmRes - 2));
    const fx = hmX - x0;
    const fy = hmY - y0;

    const h00 = hd[y0 * hmRes + x0];
    const h10 = hd[y0 * hmRes + x0 + 1];
    const h01 = hd[(y0 + 1) * hmRes + x0];
    const h11 = hd[(y0 + 1) * hmRes + x0 + 1];

    const hInterp =
      h00 * (1 - fx) * (1 - fy) +
      h10 * fx * (1 - fy) +
      h01 * (1 - fx) * fy +
      h11 * fx * fy;

    return hInterp * (cfg.heightMax - cfg.heightMin) + cfg.heightMin;
  }
}

let cachedCollisionSystem: ExportedMapCollisionSystem | null | undefined;

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function isPackageRoot(absPath: string): boolean {
  return isDirectory(absPath)
    && fs.existsSync(path.join(absPath, "manifest.json"))
    && isDirectory(path.join(absPath, "map-data"));
}

function resolveExportRoots(): string[] {
  const raw =
    process.env.EXPORT_VIEWER_ROOTS ||
    process.env.FULL_EXPORTS_ROOTS ||
    process.env.FULL_EXPORT_ROOTS ||
    "";

  const envRoots = raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));

  const cwd = process.cwd();
  const defaults = [
    path.resolve(cwd, "public/game/exported-maps"),
    path.resolve(cwd, "frontend/public/game/exported-maps"),
    path.resolve(cwd, "frontend/public/game"),
    path.resolve(cwd, "frontend/public"),
    path.resolve(cwd, "../frontend/public/game/exported-maps"),
    path.resolve(cwd, "../frontend/public/game"),
    path.resolve(cwd, "../frontend/public"),
    path.resolve(cwd, "../../frontend/public/game/exported-maps"),
    path.resolve(path.join(os.homedir(), "Desktop", "JX3FullExports")),
  ];

  const roots: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [...envRoots, ...defaults]) {
    const abs = path.resolve(candidate);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (isDirectory(abs)) roots.push(abs);
  }

  return roots;
}

function resolvePackageRoot(packageName: string): string {
  const roots = resolveExportRoots();
  for (const root of roots) {
    const direct = path.join(root, packageName);
    if (isPackageRoot(direct)) return direct;
    if (path.basename(root) === packageName && isPackageRoot(root)) return root;
  }

  const stack = roots.map((dir) => ({ dir, depth: 0 }));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (current.depth > EXPORT_SCAN_DEPTH) continue;
    if (path.basename(current.dir) === packageName && isPackageRoot(current.dir)) return current.dir;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  throw new Error(`Unable to resolve exported package ${packageName}`);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function normalizeMeshName(raw: string | undefined): string {
  let name = String(raw || "").trim().replace(/\\/g, "/");
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (slash >= 0) name = name.slice(slash + 1);
  if (!name) return "";
  if (!name.toLowerCase().endsWith(".glb")) name += ".glb";
  return name;
}

function resolveSidecarPath(mapDataRoot: string, relPath: string): string {
  const segments = relPath.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  return path.join(mapDataRoot, ...segments);
}

function extractShellTriangles(sidecarJson: any): number[] {
  const trianglesFlat: number[] = [];
  const shells = Array.isArray(sidecarJson?.shells) ? sidecarJson.shells : [];
  for (const shell of shells) {
    const triangles = Array.isArray(shell?.triangles) ? shell.triangles : [];
    for (const tri of triangles) {
      if (!Array.isArray(tri) || tri.length < 9) continue;
      const values = tri.slice(0, 9).map(Number);
      if (!values.every(Number.isFinite)) continue;
      trianglesFlat.push(...values);
    }
  }
  return trianglesFlat;
}

function loadWorldTriangles(packageRoot: string): number[] {
  const mapDataRoot = path.join(packageRoot, "map-data");
  const entities = readJsonFile<EntityRecord[]>(path.join(mapDataRoot, "entities", "full.rh.json"));
  const collisionIndexPath = path.join(mapDataRoot, "mesh-collision-index.json");
  const collisionIndex = fs.existsSync(collisionIndexPath) ? readJsonFile<any>(collisionIndexPath) : null;

  const sidecarByMeshKey = new Map<string, string>();
  if (Array.isArray(collisionIndex?.entries)) {
    for (const entry of collisionIndex.entries) {
      const meshName = normalizeMeshName(entry?.mesh);
      const sidecarRel = String(entry?.sidecar || "").trim();
      if (!meshName || !sidecarRel) continue;
      sidecarByMeshKey.set(meshName.toLowerCase(), sidecarRel);
    }
  }

  const triangleCache = new Map<string, number[]>();
  const worldFlat: number[] = [];
  const triA = new THREE.Vector3();
  const triB = new THREE.Vector3();
  const triC = new THREE.Vector3();
  const worldMatrix = new THREE.Matrix4();

  for (const entity of entities) {
    const meshName = normalizeMeshName(entity?.mesh);
    if (!meshName) continue;

    const matrix = Array.isArray(entity?.matrix) ? entity.matrix.map(Number) : null;
    if (!matrix || matrix.length !== 16 || !matrix.every(Number.isFinite)) continue;

    const meshKey = meshName.toLowerCase();
    if (!triangleCache.has(meshKey)) {
      const sidecarRel = sidecarByMeshKey.get(meshKey) || `meshes/${meshName}.collision.json`;
      const sidecarPath = resolveSidecarPath(mapDataRoot, sidecarRel);
      if (!fs.existsSync(sidecarPath)) {
        triangleCache.set(meshKey, []);
      } else {
        const sidecarJson = readJsonFile<any>(sidecarPath);
        triangleCache.set(meshKey, extractShellTriangles(sidecarJson));
      }
    }

    const triangles = triangleCache.get(meshKey);
    if (!triangles || triangles.length === 0) continue;

    worldMatrix.fromArray(matrix);
    for (let i = 0; i < triangles.length; i += 9) {
      triA.set(triangles[i], triangles[i + 1], triangles[i + 2]).applyMatrix4(worldMatrix);
      triB.set(triangles[i + 3], triangles[i + 4], triangles[i + 5]).applyMatrix4(worldMatrix);
      triC.set(triangles[i + 6], triangles[i + 7], triangles[i + 8]).applyMatrix4(worldMatrix);

      worldFlat.push(
        triA.x, triA.y, triA.z,
        triB.x, triB.y, triB.z,
        triC.x, triC.y, triC.z,
      );
    }
  }

  return worldFlat;
}

function loadTerrain(packageRoot: string): { config: HeightmapConfig | null; heightmaps: Map<string, Float32Array> } {
  const mapConfigPath = path.join(packageRoot, "map-data", "map-config.json");
  if (!fs.existsSync(mapConfigPath)) {
    return { config: null, heightmaps: new Map<string, Float32Array>() };
  }

  const mapConfig = readJsonFile<any>(mapConfigPath);
  const cfg = mapConfig?.landscape;
  if (!cfg) {
    return { config: null, heightmaps: new Map<string, Float32Array>() };
  }

  const mapDataRoot = path.join(packageRoot, "map-data");
  const mapName = String(mapConfig?.name || "");
  const regionGridX = Number(cfg.regionGridX ?? 0);
  const regionGridY = Number(cfg.regionGridY ?? 0);
  const heightmaps = new Map<string, Float32Array>();

  for (let ry = 0; ry < regionGridY; ry++) {
    for (let rx = 0; rx < regionGridX; rx++) {
      const key = `${String(rx).padStart(3, "0")}_${String(ry).padStart(3, "0")}`;
      const binName = `${mapName}_${key}.bin`;
      const binPath = path.join(mapDataRoot, "heightmap", binName);
      if (!fs.existsSync(binPath)) continue;

      const bytes = fs.readFileSync(binPath);
      const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      heightmaps.set(`${rx}_${ry}`, new Float32Array(raw));
    }
  }

  return {
    config: {
      worldOriginX: Number(cfg.worldOriginX),
      worldOriginY: Number(cfg.worldOriginY),
      regionSize: Number(cfg.regionSize),
      unitScaleX: Number(cfg.unitScaleX ?? cfg.unitScale),
      unitScaleY: Number(cfg.unitScaleY ?? cfg.unitScale),
      regionGridX,
      regionGridY,
      heightmapResolution: Number(cfg.heightmapResolution || 513),
      heightMax: Number(cfg.heightMax),
      heightMin: Number(cfg.heightMin),
    },
    heightmaps,
  };
}

export function getCollisionTestExportedSystem(): ExportedMapCollisionSystem | null {
  if (cachedCollisionSystem !== undefined) return cachedCollisionSystem;

  try {
    const packageRoot = resolvePackageRoot(PACKAGE_NAME);
    const worldTrianglesFlat = loadWorldTriangles(packageRoot);
    if (worldTrianglesFlat.length === 0) {
      throw new Error("No exported shell triangles were loaded.");
    }

    const system = new ExportedMapCollisionSystem();
    system.initBVH(new Float32Array(worldTrianglesFlat));

    const terrain = loadTerrain(packageRoot);
    if (terrain.config && terrain.heightmaps.size > 0) {
      system.initTerrain(terrain.config, terrain.heightmaps);
    }

    console.log(
      `[exportedMapCollision] Loaded package ${PACKAGE_NAME} with ${Math.floor(worldTrianglesFlat.length / 9)} shell triangles and ${terrain.heightmaps.size} terrain tiles.`,
    );
    cachedCollisionSystem = system;
  } catch (error) {
    cachedCollisionSystem = null;
    console.error("[exportedMapCollision] Failed to initialize server-side BVH collision:", error);
  }

  return cachedCollisionSystem;
}