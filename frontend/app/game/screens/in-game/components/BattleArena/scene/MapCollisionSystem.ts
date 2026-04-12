/**
 * MapCollisionSystem — BVH-based collision matching export-reader.js exactly.
 *
 * Operates in export-unit space (the raw coordinate system from full.rh.json).
 * Provides:
 *   - resolveSphereCollision(center, radius, velocity) — sphere vs triangle mesh
 *   - getSupportGroundY(center) — downward raycast + terrain heightmap
 *
 * Callers must convert between game coordinates and export coordinates using
 * the RENDER_SF / GROUP_POS constants exported from ExportedMapScene.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/* ════════════════════════ Terrain height config ════════════════════════ */

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

/* ════════════════════════ Class ════════════════════════ */

export class MapCollisionSystem {
  shellBVH: MeshBVH | null = null;
  shellGeometry: THREE.BufferGeometry | null = null;

  /* Terrain */
  private heightmaps = new Map<string, Float32Array>();
  private hmConfig: HeightmapConfig | null = null;
  private regionWorldSize = 0;

  /* Reusable scratch objects (avoid GC) */
  private readonly _hitTarget = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
  private readonly _push   = new THREE.Vector3();
  private readonly _normal = new THREE.Vector3();
  private readonly _ray    = new THREE.Ray();
  private readonly _triA   = new THREE.Vector3();
  private readonly _triB   = new THREE.Vector3();
  private readonly _triC   = new THREE.Vector3();
  private readonly _edgeA  = new THREE.Vector3();
  private readonly _edgeB  = new THREE.Vector3();
  /* LOS raycast scratch */
  private readonly _losRay    = new THREE.Ray();
  private readonly _losOrigin = new THREE.Vector3();
  private readonly _losDir    = new THREE.Vector3();

  /* ─── Init ─── */

  /** Build BVH from flat triangle buffer (x y z × 3 per triangle, export-unit space). */
  initBVH(trianglesFlat: Float32Array | number[]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      trianglesFlat instanceof Float32Array
        ? new THREE.BufferAttribute(trianglesFlat, 3)
        : new THREE.Float32BufferAttribute(trianglesFlat, 3),
    );
    this.shellGeometry = geo;
    this.shellBVH = new MeshBVH(geo);
  }

  /** Store heightmap tiles + config for terrain ground queries. */
  initTerrain(config: HeightmapConfig, heightmaps: Map<string, Float32Array>) {
    this.hmConfig = config;
    this.heightmaps = heightmaps;
    this.regionWorldSize = config.regionSize * config.unitScaleX;
  }

  /* ─── Sphere collision (port of export-reader.js CollisionSystem.resolveSphereCollision) ─── */

  resolveSphereCollision(
    center: THREE.Vector3,
    radius: number,
    velocity: THREE.Vector3,
  ): { onGround: boolean; hitDistance: number } {
    if (!this.shellBVH) return { onGround: false, hitDistance: Infinity };

    let onGround = false;
    let hitDistance = Infinity;

    for (let i = 0; i < 5; i++) {
      this._hitTarget.point.set(0, 0, 0);
      this._hitTarget.distance = Infinity;
      this._hitTarget.faceIndex = -1;

      const hit = this.shellBVH.closestPointToPoint(
        center, this._hitTarget, 0, radius + 220,
      );
      if (!hit) break;

      hitDistance = Math.min(hitDistance, hit.distance);
      if (hit.distance >= radius) break;

      this._push.subVectors(center, hit.point);
      let len = this._push.length();
      const normal = this._getFaceNormal(hit.faceIndex, this._normal);
      const isHorizontalSurface = !!normal && Math.abs(normal.y) >= 0.58;
      const verticalRatio = len > 1e-6 ? this._push.y / len : 0;
      const isFloorContact   = isHorizontalSurface && verticalRatio > 0.2;
      const isCeilingContact = isHorizontalSurface && verticalRatio < -0.2;

      if (!isFloorContact) {
        // Flatten push to horizontal
        this._push.y = 0;
        len = this._push.length();

        if (len < 1e-6 && normal) {
          this._push.set(normal.x, 0, normal.z);
          len = this._push.length();
        }
        if (len < 1e-6) {
          this._push.set(center.x - hit.point.x, 0, center.z - hit.point.z);
          len = this._push.length();
        }
        if (isCeilingContact && velocity.y > 0) velocity.y = 0;
      }

      if (len < 1e-6) {
        if (!isFloorContact) continue;
        this._push.set(0, 1, 0);
        len = 1;
      }

      const penetration = radius - hit.distance + 0.6;
      this._push.multiplyScalar(penetration / len);
      center.add(this._push);

      if (isFloorContact && this._push.y > 0) {
        onGround = true;
        if (velocity.y < 0) velocity.y = 0;
      }
    }

    return { onGround, hitDistance };
  }

  /* ─── LOS check ─── */

  /**
   * Check line-of-sight between two points in BVH (export-unit) space.
   * `from` and `to` should be pre-converted to export-unit coords (e.g. via the
   * same transform used by resolveSphereCollision callers).
   * `radius` is the player radius in export units — used as near/far margin
   * to avoid self-intersection at both ends of the ray.
   * Returns true = LOS is blocked by geometry.
   */
  checkLOS(from: THREE.Vector3, to: THREE.Vector3, radius: number): boolean {
    if (!this.shellBVH) return false;
    this._losDir.subVectors(to, from);
    const dist = this._losDir.length();
    if (dist < 1e-4) return false;
    this._losDir.multiplyScalar(1 / dist);
    this._losRay.origin.copy(from);
    this._losRay.direction.copy(this._losDir);
    const near = radius;
    const far  = dist - radius;
    if (far <= near) return false;
    const hit = (this.shellBVH as any).raycastFirst(this._losRay, THREE.DoubleSide, near, far);
    return !!hit;
  }

  /* ─── Ground support (port of export-reader.js CollisionSystem.getSupportGroundY) ─── */

  getSupportGroundY(center: THREE.Vector3): number | null {
    const shellY   = this._sampleShellGroundY(center);
    const terrainY = this._getTerrainHeightAt(center.x, center.z);

    if (shellY === null && terrainY === null) return null;
    if (shellY === null) return terrainY;
    if (terrainY === null) return shellY;
    return Math.max(shellY, terrainY);
  }

  /* ─── Private helpers ─── */

  private _getFaceNormal(faceIndex: number, out: THREE.Vector3): THREE.Vector3 | null {
    const pos = this.shellGeometry?.getAttribute('position');
    if (!pos || faceIndex < 0) return null;

    const i0 = faceIndex * 3;
    if (i0 + 2 >= pos.count) return null;

    this._triA.fromBufferAttribute(pos, i0);
    this._triB.fromBufferAttribute(pos, i0 + 1);
    this._triC.fromBufferAttribute(pos, i0 + 2);

    this._edgeA.subVectors(this._triB, this._triA);
    this._edgeB.subVectors(this._triC, this._triA);
    out.crossVectors(this._edgeA, this._edgeB);

    const lenSq = out.lengthSq();
    if (lenSq < 1e-10) return null;
    out.multiplyScalar(1 / Math.sqrt(lenSq));
    return out;
  }

  /** Raycast down from sphere center to find shell ground surface. */
  private _sampleShellGroundY(center: THREE.Vector3): number | null {
    if (!this.shellBVH) return null;

    const maxRise = 72;
    const maxDrop = 12000;

    this._ray.origin.set(center.x, center.y + maxRise, center.z);
    this._ray.direction.set(0, -1, 0);

    let hit = this.shellBVH.raycastFirst(this._ray, THREE.DoubleSide, 0, maxDrop + maxRise);
    if (hit?.point && Number.isFinite(hit.point.y)) return hit.point.y;

    // Recovery ray when player is far below expected support
    this._ray.origin.set(center.x, center.y + 2600, center.z);
    hit = this.shellBVH.raycastFirst(this._ray, THREE.DoubleSide, 0, 16000);
    if (!hit?.point || !Number.isFinite(hit.point.y)) return null;
    if (hit.point.y > center.y + maxRise) return null;
    return hit.point.y;
  }

  /** Bilinear terrain heightmap sampling (port of terrain.js getHeightAt). */
  private _getTerrainHeightAt(worldX: number, worldZ: number): number | null {
    if (!this.hmConfig) return null;

    const cfg = this.hmConfig;
    const localX = worldX - cfg.worldOriginX;
    const localZ = (-worldZ) - cfg.worldOriginY; // RH→LH: negate Z for heightmap lookup
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
