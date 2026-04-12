'use client';

/**
 * ExportedMapScene — Full exported 3D map renderer matching export-reader.js exactly.
 *
 * Loads: entities/full.rh.json + mesh-map.json + texture-map.json + meshes/*.glb
 *        terrain heightmaps + terrain-textures + collision sidecars + sky dome
 *
 * Matches entities.js: GLTFLoader → per-GLB texture-map lookup → albedo (SRGB, flipY=false)
 *   + MRE with R↔B channel swizzle → normal maps with normalScale(1,-1) → blend modes
 * Matches terrain.js: heightmap .bin → geometry with UVs → terrain-textures/index.json PNGs
 * Matches export-reader.js collision: shell wireframe (green) + part box wireframe (orange)
 */

import { useEffect, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MapCollisionSystem } from './MapCollisionSystem';

const PACKAGE_NAME = 'Ctest-2026-04-10T23-11-25-797Z';
const DATA_PATH = `/full-exports/${encodeURIComponent(PACKAGE_NAME)}/map-data`;

const SF = 0.005557531566779299;
const MAP_SCALE = 2.4;  // 2.4× scale so map is larger relative to character
export const RENDER_SF = SF * MAP_SCALE;

// Alignment: game coord (gx,gy) in Three.js = (gx - width/2, 0, height/2 - gy)  [z-flip removed]
// Export entity at (ex, ey, ez_rh) in Three.js = (ex*RENDER_SF + GROUP_POS_X, ey*RENDER_SF + GROUP_POS_Y, ez_rh*RENDER_SF + GROUP_POS_Z)
// GROUP_POS derived from median entity (18664.5, _, -122778.5) → game (214, 228); scaled from MAP_SCALE=2 reference
export const GROUP_POS_X = -308.44;
export const GROUP_POS_Y = -3.01;   // Terrain at city center (game 214,228) → y=0
export const GROUP_POS_Z = 1682.71;  // No Z-flip: entities at native RH z, aligned with worldHalf-gy

interface ExportedMapSceneProps {
  worldWidth: number;
  worldHeight: number;
  showCollisionShells?: boolean;
  /** Shows only the collision wireframe on a black background — hides all visual mesh/terrain. */
  blueprintMode?: boolean;
  onCollisionSystemReady?: (sys: MapCollisionSystem) => void;
}

/* ────────────────────── Texture caches (module-level singletons) ────────────────────── */
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function loadTextureCached(pngName: string): THREE.Texture {
  if (!textureCache.has(pngName)) {
    const tex = textureLoader.load(`${DATA_PATH}/textures/${encodeURIComponent(pngName)}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    textureCache.set(pngName, tex);
  }
  return textureCache.get(pngName)!;
}

function loadTextureCachedLinear(pngName: string): THREE.Texture {
  const key = pngName + '_linear';
  if (!textureCache.has(key)) {
    const tex = textureLoader.load(`${DATA_PATH}/textures/${encodeURIComponent(pngName)}`);
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    textureCache.set(key, tex);
  }
  return textureCache.get(key)!;
}

/** MRE texture with R↔B channel swizzle: game MRE (M=R,R=G,E=B) → THREE (x=R,R=G,M=B) */
function loadMRECached(pngName: string): THREE.Texture {
  const key = pngName + '_mre';
  if (!textureCache.has(key)) {
    const tex = textureLoader.load(
      `${DATA_PATH}/textures/${encodeURIComponent(pngName)}`,
      (t: THREE.Texture) => {
        const canvas = document.createElement('canvas');
        const img = t.image as HTMLImageElement;
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i]; px[i] = px[i + 2]; px[i + 2] = r; // swap R↔B
        }
        ctx.putImageData(d, 0, 0);
        t.image = canvas;
        t.needsUpdate = true;
      }
    );
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    textureCache.set(key, tex);
  }
  return textureCache.get(key)!;
}

/* ────────────────────── Mesh-name normalisation (matches export-reader) ────────────────────── */

function normalizeMeshName(raw: string | undefined): string {
  let name = String(raw || '').trim().replace(/\\/g, '/');
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (slash >= 0) name = name.slice(slash + 1);
  if (!name) return '';
  if (!name.toLowerCase().endsWith('.glb')) name += '.glb';
  return name;
}

function encodePathSegments(pathLike: string): string {
  return String(pathLike || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

/* ────────────────────── Main Component ────────────────────── */

export default function ExportedMapScene({ worldWidth, worldHeight, showCollisionShells = false, blueprintMode = false, onCollisionSystemReady }: ExportedMapSceneProps) {
  const { scene, gl } = useThree();
  const groupRef = useRef<THREE.Group | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null); // entity + terrain meshes
  const shellLinesRef = useRef<THREE.LineSegments | null>(null);
  const boxLinesRef = useRef<THREE.LineSegments | null>(null);

  // Match export-reader renderer settings
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.5;  // Slightly brighter than export-reader's 1.25
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    return () => {
      gl.toneMapping = THREE.NoToneMapping;
      gl.toneMappingExposure = 1.0;
    };
  }, [gl]);

  // Toggle collision visibility
  useEffect(() => {
    if (shellLinesRef.current) shellLinesRef.current.visible = showCollisionShells || blueprintMode;
  }, [showCollisionShells, blueprintMode]);
  useEffect(() => {
    if (boxLinesRef.current) boxLinesRef.current.visible = false;
  }, []);

  // Blueprint mode: hide content, show wireframe in cyan; restore when off
  useEffect(() => {
    if (contentGroupRef.current) contentGroupRef.current.visible = !blueprintMode;
    if (shellLinesRef.current) {
      const mat = shellLinesRef.current.material as THREE.LineBasicMaterial;
      mat.color.set(blueprintMode ? 0x00ffff : 0x3fd56d);
      mat.opacity = blueprintMode ? 1.0 : 0.65;
    }
  }, [blueprintMode]);

  useEffect(() => {
    const group = new THREE.Group();
    group.name = 'exported-map';
    group.scale.setScalar(RENDER_SF);  // Uniform scale, no Z-flip (data is already RH)
    group.position.set(GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z);
    groupRef.current = group;

    // Separate sub-group for entity + terrain meshes so blueprint mode can hide them
    const contentGroup = new THREE.Group();
    contentGroup.name = 'exported-map-content';
    contentGroupRef.current = contentGroup;
    group.add(contentGroup);
    scene.add(group);

    let disposed = false;

    (async () => {
      try {
        const [entities, meshMap, mapConfig, textureMap, terrainTexIndex] = await Promise.all([
          fetchJson(`${DATA_PATH}/entities/full.rh.json`),
          fetchJson(`${DATA_PATH}/mesh-map.json`),
          fetchJson(`${DATA_PATH}/map-config.json`),
          fetchJson(`${DATA_PATH}/texture-map.json`).catch(() => null),
          fetchJson(`${DATA_PATH}/terrain-textures/index.json`).catch(() => null),
        ]);
        if (disposed) return;

        const entityStats = await loadEntities(contentGroup, entities, meshMap, textureMap, disposed);
        if (disposed) return;

        const terrainResult = await loadTerrain(contentGroup, mapConfig, terrainTexIndex, disposed);
        if (disposed) return;

        const collisionResult = await loadCollision(group, entities, meshMap, disposed, shellLinesRef, boxLinesRef);
        if (disposed) return;

        // Build collision system (BVH + terrain)
        if (collisionResult.worldTrianglesFlat.length > 0) {
          const collisionSystem = new MapCollisionSystem();
          collisionSystem.initBVH(new Float32Array(collisionResult.worldTrianglesFlat));
          if (terrainResult.heightmaps.size > 0 && mapConfig.landscape) {
            const cfg = mapConfig.landscape;
            collisionSystem.initTerrain(
              {
                worldOriginX: cfg.worldOriginX,
                worldOriginY: cfg.worldOriginY,
                regionSize: cfg.regionSize,
                unitScaleX: cfg.unitScaleX ?? cfg.unitScale,
                unitScaleY: cfg.unitScaleY ?? cfg.unitScale,
                regionGridX: cfg.regionGridX,
                regionGridY: cfg.regionGridY,
                heightmapResolution: cfg.heightmapResolution || 513,
                heightMax: cfg.heightMax,
                heightMin: cfg.heightMin,
              },
              terrainResult.heightmaps,
            );
          }
          console.log('[ExportedMapScene] BVH collision system ready —',
            collisionResult.stats.shells, 'shell tris,',
            terrainResult.heightmaps.size, 'terrain tiles');
          onCollisionSystemReady?.(collisionSystem);
        }

        console.log(
          `[ExportedMapScene] LOADED — ` +
          `${entityStats.glbs} GLBs, ${entityStats.instances} instances, ${entityStats.submeshes} submeshes | ` +
          `${terrainResult.stats.tiles} terrain tiles (${terrainResult.stats.textured} textured) | ` +
          `collision: ${collisionResult.stats.sidecars} sidecars, ${collisionResult.stats.shells} shell tris, ${collisionResult.stats.partBoxes} part boxes`
        );
      } catch (err) {
        console.error('[ExportedMapScene] Load error:', err);
      }
    })();

    return () => {
      disposed = true;
      disposeGroup(group);
      scene.remove(group);
      groupRef.current = null;
    };
  }, [scene]);

  return (
    <>
      {!blueprintMode && <SkyDome />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[worldWidth, worldHeight]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Sky Dome
   ════════════════════════════════════════════════════════════ */

function SkyDome() {
  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#4488cc') },
      horizonColor: { value: new THREE.Color('#c8b888') },
      bottomColor: { value: new THREE.Color('#d4c5a0') },
      exponent: { value: 0.5 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      uniform float exponent;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        vec3 col = mix(horizonColor, topColor, t);
        if (h < 0.0) col = mix(horizonColor, bottomColor, min(-h * 3.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  }), []);

  return (
    <mesh renderOrder={-1} frustumCulled={false} material={skyMat}>
      <sphereGeometry args={[1800, 32, 16]} />
    </mesh>
  );
}

/* ════════════════════════════════════════════════════════════
   Entity Loading — GLBs + texture-map.json PBR textures
   Matches entities.js: loadGLB() with texture-map per-subset
   ════════════════════════════════════════════════════════════ */

function isValidGeometry(geometry: THREE.BufferGeometry): boolean {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) return false;
  const arr = (posAttr as THREE.BufferAttribute).array;
  let maxAbs = 0;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
    const a = Math.abs(arr[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs > 50000) return false;
  try {
    geometry.computeBoundingSphere();
    const r = geometry.boundingSphere?.radius ?? 0;
    if (!Number.isFinite(r) || r <= 0 || r > 50000) return false;
  } catch { return false; }
  return true;
}

function isValidTransformMatrix(m: number[]): boolean {
  if (!Array.isArray(m) || m.length !== 16) return false;
  for (const v of m) { if (!Number.isFinite(v)) return false; }
  const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
  if (sx < 0.01 || sy < 0.01 || sz < 0.01) return false;
  if (sx > 20 || sy > 20 || sz > 20) return false;
  return true;
}

async function loadEntities(
  group: THREE.Group,
  entities: any[],
  meshMap: Record<string, string>,
  textureMap: Record<string, any> | null,
  disposed: boolean,
) {
  const loader = new GLTFLoader();
  const stats = { glbs: 0, instances: 0, submeshes: 0 };

  // Group entities by GLB path
  const glbGroups = new Map<string, Array<{ matrix: number[] }>>();
  for (const entity of entities) {
    const m = entity.matrix;
    if (!Array.isArray(m) || m.length !== 16) continue;
    const glbRel = meshMap[entity.mesh];
    if (!glbRel) continue;
    const glbPath = `${DATA_PATH}/${glbRel}`;
    if (!glbGroups.has(glbPath)) glbGroups.set(glbPath, []);
    glbGroups.get(glbPath)!.push({ matrix: m });
  }

  // Load each unique GLB with proper PBR materials
  type MeshPart = { geometry: THREE.BufferGeometry; material: THREE.Material };
  const glbCache = new Map<string, MeshPart[]>();

  for (const [glbPath, instances] of glbGroups) {
    if (disposed) return stats;

    try {
      let meshParts: MeshPart[];

      if (glbCache.has(glbPath)) {
        meshParts = glbCache.get(glbPath)!;
      } else {
        const glbName = glbPath.split('/').pop() || '';
        const texInfo = textureMap ? textureMap[glbName] : null;
        const subsetTextures = texInfo?.subsets as any[] | undefined;

        const gltf = await loadGLTF(loader, glbPath);
        const parts: MeshPart[] = [];
        let meshIdx = 0;

        gltf.scene.traverse((child: any) => {
          if (!child.isMesh) return;
          const geometry = child.geometry as THREE.BufferGeometry;
          if (!isValidGeometry(geometry)) { meshIdx++; return; }

          // Determine texture set for this primitive (per-subset or global)
          const subTex = (subsetTextures && meshIdx < subsetTextures.length)
            ? subsetTextures[meshIdx]
            : texInfo;

          const hasColors = geometry.hasAttribute('color');
          const matOpts: any = {
            color: hasColors ? 0xffffff : 0xccbbaa,
            vertexColors: hasColors,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide,
          };

          if (subTex) {
            if (subTex.albedo) {
              matOpts.map = loadTextureCached(subTex.albedo);
              matOpts.color = 0xffffff;
              matOpts.vertexColors = false;
            }
            if (subTex.mre) {
              const mreTex = loadMRECached(subTex.mre);
              matOpts.roughnessMap = mreTex;
              matOpts.metalnessMap = mreTex;
              matOpts.roughness = 1.0;
              matOpts.metalness = 1.0;
            }
            if (subTex.normal) {
              matOpts.normalMap = loadTextureCachedLinear(subTex.normal);
              matOpts.normalScale = new THREE.Vector2(1, -1);
            }

            const blendMode = subTex.blendMode || texInfo?.blendMode || 0;
            if (blendMode === 1 && matOpts.map) {
              const alphaRef = subTex.alphaRef != null ? subTex.alphaRef : 128;
              matOpts.alphaTest = alphaRef / 255.0;
              matOpts.transparent = false;
              matOpts.side = THREE.DoubleSide;
            } else if (blendMode === 2 && matOpts.map) {
              matOpts.transparent = true;
              matOpts.blending = THREE.AdditiveBlending;
              matOpts.depthWrite = false;
            }
          }

          const material = new THREE.MeshStandardMaterial(matOpts);
          parts.push({ geometry, material });
          meshIdx++;
        });

        glbCache.set(glbPath, parts);
        meshParts = parts;
        stats.glbs++;
      }

      if (meshParts.length === 0) continue;

      // Build valid transform matrices (column-major RH format)
      const matrices: THREE.Matrix4[] = [];
      for (const inst of instances) {
        if (!isValidTransformMatrix(inst.matrix)) continue;
        const mat4 = new THREE.Matrix4().fromArray(inst.matrix);
        matrices.push(mat4);
      }
      if (matrices.length === 0) continue;

      // Create InstancedMesh per submesh
      for (const { geometry, material } of meshParts) {
        const inst = new THREE.InstancedMesh(geometry, material, matrices.length);
        inst.castShadow = true;
        inst.receiveShadow = true;
        for (let i = 0; i < matrices.length; i++) {
          inst.setMatrixAt(i, matrices[i]);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        group.add(inst);
        stats.submeshes++;
      }
      stats.instances += matrices.length;
    } catch {
      // Skip broken GLBs
    }
  }

  return stats;
}

function loadGLTF(loader: GLTFLoader, url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

/* ════════════════════════════════════════════════════════════
   Terrain Loading — Heightmaps + pre-baked terrain textures
   Matches terrain.js: createRegionMesh + createTerrainMaterial
   Only loads tiles that exist (guided by terrain-textures/index.json regions).
   ════════════════════════════════════════════════════════════ */

async function loadTerrain(
  group: THREE.Group,
  mapConfig: any,
  terrainTexIndex: any | null,
  disposed: boolean,
) {
  const cfg = mapConfig.landscape;
  if (!cfg) return { stats: { tiles: 0, textured: 0 }, heightmaps: new Map<string, Float32Array>() };

  const stats = { tiles: 0, textured: 0 };
  const heightmaps = new Map<string, Float32Array>();
  const mapName = mapConfig.name || '';
  const hmRes = cfg.heightmapResolution || 513;
  const regionWorldSize = cfg.regionSize * cfg.unitScaleX;
  const gx = cfg.regionGridX;
  const gy = cfg.regionGridY;
  const step = 4;
  const gridSize = Math.floor((hmRes - 1) / step) + 1; // 129

  // Only iterate regions that actually have data (avoids 404s for missing tiles)
  const validRegions = new Set<string>();
  if (terrainTexIndex?.regions) {
    for (const key of Object.keys(terrainTexIndex.regions)) validRegions.add(key);
  }

  for (let ry = 0; ry < gy; ry++) {
    for (let rx = 0; rx < gx; rx++) {
      if (disposed) return { stats, heightmaps };
      const regionKey = `${rx}_${ry}`;
      // Skip regions without terrain data to avoid 404 noise
      if (validRegions.size > 0 && !validRegions.has(regionKey)) continue;

      const key = `${String(rx).padStart(3, '0')}_${String(ry).padStart(3, '0')}`;
      const binName = `${mapName}_${key}.bin`;
      try {
        const res = await fetch(`${DATA_PATH}/heightmap/${encodeURIComponent(binName)}`);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const hd = new Float32Array(buf);
        heightmaps.set(`${rx}_${ry}`, hd);

        const regionOriginX = cfg.worldOriginX + rx * regionWorldSize;
        const regionOriginZ = cfg.worldOriginY + ry * regionWorldSize;

        const positions = new Float32Array(gridSize * gridSize * 3);
        const uvs = new Float32Array(gridSize * gridSize * 2);

        let vi = 0;
        for (let gy2 = 0; gy2 < gridSize; gy2++) {
          for (let gx2 = 0; gx2 < gridSize; gx2++) {
            const hmX = Math.min(gx2 * step, hmRes - 1);
            const hmY = Math.min(gy2 * step, hmRes - 1);
            const heightNorm = hd[hmY * hmRes + hmX];
            const height = heightNorm * (cfg.heightMax - cfg.heightMin) + cfg.heightMin;
            const worldX = regionOriginX + hmX * cfg.unitScaleX;
            const worldZ = regionOriginZ + hmY * cfg.unitScaleY;

            positions[vi * 3] = worldX;
            positions[vi * 3 + 1] = height;
            positions[vi * 3 + 2] = -worldZ; // LH→RH: negate Z

            // UV: per-region 0..1 (matches terrain.js per-tile texture)
            uvs[vi * 2] = hmX / (hmRes - 1);
            uvs[vi * 2 + 1] = hmY / (hmRes - 1);
            vi++;
          }
        }

        // Height-based vertex colors (fallback)
        const colors = new Float32Array(gridSize * gridSize * 3);
        for (let i = 0; i < gridSize * gridSize; i++) {
          const h = positions[i * 3 + 1];
          let r: number, g: number, b: number;
          if (h < -500) { r = 0.45; g = 0.42; b = 0.35; }
          else if (h < 200) { const t = (h + 500) / 700; r = 0.45 + t * 0.30; g = 0.42 + t * 0.20; b = 0.35 + t * 0.05; }
          else if (h < 1000) { const t = (h - 200) / 800; r = 0.75 + t * 0.08; g = 0.62 + t * 0.05; b = 0.40 - t * 0.02; }
          else if (h < 3000) { const t = (h - 1000) / 2000; r = 0.83 - t * 0.20; g = 0.67 - t * 0.15; b = 0.38 - t * 0.03; }
          else { r = 0.55; g = 0.50; b = 0.45; }
          colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
        }

        const indices: number[] = [];
        for (let gy3 = 0; gy3 < gridSize - 1; gy3++) {
          for (let gx3 = 0; gx3 < gridSize - 1; gx3++) {
            const a = gy3 * gridSize + gx3;
            const b2 = a + 1;
            const c = (gy3 + 1) * gridSize + gx3;
            const d = c + 1;
            indices.push(a, b2, c);
            indices.push(b2, d, c);
          }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Use pre-baked terrain texture if available (matches terrain.js createTerrainMaterial)
        const texInfo = terrainTexIndex?.regions?.[regionKey];
        let material: THREE.MeshStandardMaterial;

        if (texInfo?.color) {
          const texPath = `${DATA_PATH}/terrain-textures/${encodeURIComponent(texInfo.color)}`;
          const texture = textureLoader.load(texPath);
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.generateMipmaps = true;
          material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.85,
            metalness: 0.0,
            side: THREE.DoubleSide,
            flatShading: false,
          });
          stats.textured++;
        } else {
          material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.0,
            side: THREE.DoubleSide,
            flatShading: false,
          });
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        group.add(mesh);
        stats.tiles++;
      } catch {
        // Skip missing terrain tiles
      }
    }
  }

  return { stats, heightmaps };
}

/* ════════════════════════════════════════════════════════════
   Collision Visualization — matches export-reader.js exactly
   Shell triangles (green wireframe) + Part box edges (orange wireframe)
   ════════════════════════════════════════════════════════════ */

async function loadCollision(
  group: THREE.Group,
  entities: any[],
  meshMap: Record<string, string>,
  disposed: boolean,
  shellLinesRef: React.MutableRefObject<THREE.LineSegments | null>,
  boxLinesRef: React.MutableRefObject<THREE.LineSegments | null>,
) {
  const stats = { sidecars: 0, shells: 0, partBoxes: 0 };

  // Group entities by normalized mesh key (lowercase GLB filename)
  const entityByMesh = new Map<string, any[]>();
  for (const entity of entities) {
    if (!Array.isArray(entity?.matrix) || entity.matrix.length !== 16) continue;
    const meshName = normalizeMeshName(entity?.mesh);
    if (!meshName) continue;
    const key = meshName.toLowerCase();
    if (!entityByMesh.has(key)) entityByMesh.set(key, []);
    entityByMesh.get(key)!.push(entity);
  }

  // Load collision index
  let collisionIndex: any = null;
  try {
    collisionIndex = await fetchJson(`${DATA_PATH}/mesh-collision-index.json`);
  } catch { /* no index */ }

  // Build sidecar path map from index
  const sidecarPathByKey = new Map<string, string>();
  if (Array.isArray(collisionIndex?.entries)) {
    for (const entry of collisionIndex.entries) {
      const meshName = normalizeMeshName(entry?.mesh);
      const sidecarRel = String(entry?.sidecar || '').trim();
      if (!meshName || !sidecarRel) continue;
      sidecarPathByKey.set(meshName.toLowerCase(), sidecarRel);
    }
  }

  // Load sidecars and extract triangles + part boxes
  type SidecarData = { trianglesFlat: number[]; partBoxes: Array<{ cx: number; cz: number; w: number; d: number; baseY: number; topY: number }> };
  const sidecarDataByKey = new Map<string, SidecarData>();

  for (const meshKey of entityByMesh.keys()) {
    if (disposed) return { stats, worldTrianglesFlat: [] as number[] };
    const entitiesForMesh = entityByMesh.get(meshKey)!;
    const meshName = normalizeMeshName(entitiesForMesh[0].mesh);
    const fromIndex = sidecarPathByKey.get(meshKey);
    const sidecarRel = fromIndex || `meshes/${meshName}.collision.json`;
    const sidecarUrl = `${DATA_PATH}/${encodePathSegments(sidecarRel)}`;

    try {
      const sidecarJson = await fetchJson(sidecarUrl);
      const parsed = extractSidecarData(sidecarJson);
      if (parsed.trianglesFlat.length > 0 || parsed.partBoxes.length > 0) {
        sidecarDataByKey.set(meshKey, parsed);
        stats.sidecars++;
      }
    } catch { /* skip missing */ }
  }

  // Transform collision data by entity matrices and accumulate world-space geometry
  const worldFlat: number[] = [];
  const partBoxLineFlat: number[] = [];
  const _triA = new THREE.Vector3();
  const _triB = new THREE.Vector3();
  const _triC = new THREE.Vector3();
  const _boxCorners = Array.from({ length: 8 }, () => new THREE.Vector3());

  for (const entity of entities) {
    if (!Array.isArray(entity?.matrix) || entity.matrix.length !== 16) continue;
    const meshName = normalizeMeshName(entity?.mesh);
    const meshKey = meshName.toLowerCase();
    const sidecarData = sidecarDataByKey.get(meshKey);
    if (!sidecarData) continue;

    // Entity matrix is already column-major Three.js Matrix4
    const worldMatrix = new THREE.Matrix4().fromArray(entity.matrix);

    // Transform shell triangles
    const tris = sidecarData.trianglesFlat;
    for (let i = 0; i < tris.length; i += 9) {
      _triA.set(tris[i], tris[i+1], tris[i+2]).applyMatrix4(worldMatrix);
      _triB.set(tris[i+3], tris[i+4], tris[i+5]).applyMatrix4(worldMatrix);
      _triC.set(tris[i+6], tris[i+7], tris[i+8]).applyMatrix4(worldMatrix);
      worldFlat.push(
        _triA.x, _triA.y, _triA.z,
        _triB.x, _triB.y, _triB.z,
        _triC.x, _triC.y, _triC.z,
      );
    }

    // Transform part box edges
    for (const box of sidecarData.partBoxes) {
      appendPartBoxEdges(partBoxLineFlat, box, worldMatrix, _boxCorners);
      stats.partBoxes++;
    }
  }

  stats.shells = Math.floor(worldFlat.length / 9);

  // Build shell wireframe (green) — EdgesGeometry at 20° threshold
  if (worldFlat.length > 0) {
    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(worldFlat, 3));
    const edges = new THREE.EdgesGeometry(shellGeo, 20);
    const shellLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x3fd56d, transparent: true, opacity: 0.65, depthTest: true }),
    );
    shellLines.renderOrder = 2;
    shellLines.visible = false;  // toggled via props
    shellLinesRef.current = shellLines;
    group.add(shellLines);
    shellGeo.dispose(); // only edges geometry is used
  }

  // Build part box wireframe (orange)
  if (partBoxLineFlat.length > 0) {
    const boxGeo = new THREE.BufferGeometry();
    boxGeo.setAttribute('position', new THREE.Float32BufferAttribute(partBoxLineFlat, 3));
    const boxLines = new THREE.LineSegments(
      boxGeo,
      new THREE.LineBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.92, depthTest: true }),
    );
    boxLines.renderOrder = 4;
    boxLines.visible = false;  // toggled via props
    boxLinesRef.current = boxLines;
    group.add(boxLines);
  }

  return { stats, worldTrianglesFlat: worldFlat };
}

function extractSidecarData(sidecarJson: any) {
  const trianglesFlat: number[] = [];
  const partBoxes: Array<{ cx: number; cz: number; w: number; d: number; baseY: number; topY: number }> = [];

  const shells = Array.isArray(sidecarJson?.shells) ? sidecarJson.shells : [];
  for (const shell of shells) {
    const tris = Array.isArray(shell?.triangles) ? shell.triangles : [];
    for (const tri of tris) {
      if (!Array.isArray(tri) || tri.length < 9) continue;
      const vals = tri.slice(0, 9).map(Number);
      if (!vals.every(Number.isFinite)) continue;
      trianglesFlat.push(...vals);
    }
  }

  const rawParts = Array.isArray(sidecarJson?.parts) ? sidecarJson.parts : [];
  for (const part of rawParts) {
    const cx = Number(part?.localCx); const cz = Number(part?.localCz);
    const w = Number(part?.localW); const d = Number(part?.localD);
    const baseY = Number(part?.localBaseY); const topY = Number(part?.localTopY);
    if (![cx, cz, w, d, baseY, topY].every(Number.isFinite)) continue;
    if (w <= 0 || d <= 0 || topY < baseY) continue;
    partBoxes.push({ cx, cz, w, d, baseY, topY });
  }

  return { trianglesFlat, partBoxes };
}

function appendPartBoxEdges(
  flatOut: number[],
  box: { cx: number; cz: number; w: number; d: number; baseY: number; topY: number },
  worldMatrix: THREE.Matrix4,
  corners: THREE.Vector3[],
) {
  const halfW = box.w * 0.5;
  const halfD = box.d * 0.5;
  const minX = box.cx - halfW, maxX = box.cx + halfW;
  const minZ = box.cz - halfD, maxZ = box.cz + halfD;
  const minY = box.baseY, maxY = box.topY;

  corners[0].set(minX, minY, minZ).applyMatrix4(worldMatrix);
  corners[1].set(maxX, minY, minZ).applyMatrix4(worldMatrix);
  corners[2].set(maxX, minY, maxZ).applyMatrix4(worldMatrix);
  corners[3].set(minX, minY, maxZ).applyMatrix4(worldMatrix);
  corners[4].set(minX, maxY, minZ).applyMatrix4(worldMatrix);
  corners[5].set(maxX, maxY, minZ).applyMatrix4(worldMatrix);
  corners[6].set(maxX, maxY, maxZ).applyMatrix4(worldMatrix);
  corners[7].set(minX, maxY, maxZ).applyMatrix4(worldMatrix);

  const edges: [number, number][] = [
    [0,1],[1,2],[2,3],[3,0], // bottom
    [4,5],[5,6],[6,7],[7,4], // top
    [0,4],[1,5],[2,6],[3,7], // vertical
  ];
  for (const [a, b] of edges) {
    flatOut.push(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z);
  }
}

/* ════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════ */

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function disposeGroup(group: THREE.Group) {
  group.traverse((child: any) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        if (m.normalMap) m.normalMap.dispose();
        if (m.roughnessMap) m.roughnessMap.dispose();
        if (m.metalnessMap) m.metalnessMap.dispose();
        m.dispose();
      }
    }
  });
}
