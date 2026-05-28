'use client';

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Ground from './Ground';
import MapObjects from './MapObjects';
import Character from './Character';
import PickupBooks from './PickupBooks';
import AoeZone from './AoeZone';
import TargetEntityVisual from './TargetEntityVisual';
import CameraRig from './CameraRig';
import type { PickupItem, GroundZone, TargetEntity, PlayAreaBounds, SafeZone } from '../../../types';
import { getMapForMode } from '../worldMap';
import ExportedMapScene, { GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z, RENDER_SF_XZ, RENDER_SF_Y, type SceneLoadTimingEvent } from './ExportedMapScene';
import type { MapCollisionSystem } from './MapCollisionSystem';
import { isExportedMapMode, isYumen1v1BasicMode } from '../../../../../gameModes';

// Colors for up to 5 opponents (index 0 = primary, etc.)
const OPP_COLORS = ['#cc3333', '#cc8800', '#9933cc', '#cc3388'];
const OPP_EMISSIVES = ['#440000', '#332200', '#220044', '#330022'];

const LEGACY_STORED_UNIT_SCALE = 2.2;
const COLLISION_TEST_VIS_RADIUS = 0.384;
const CHANNEL_RING_WAIST_Z = 1.0;
const YUMEN_SAFE_ZONE_RING_CLEARANCE = 0.34;
const YUMEN_SAFE_ZONE_LINE_XRAY_DISTANCE = 50;
const YUMEN_BOUNDARY_LINE_VISIBLE_DISTANCE = 30;

type SafeZoneDisplayMode = 'terrain' | 'topDown';
type LinePoint = [number, number, number];
type NearbyLineSegment = { key: string; points: [LinePoint, LinePoint] };

function distancePointToLineSegment2D(px: number, pz: number, a: LinePoint, b: LinePoint): number {
  const abX = b[0] - a[0];
  const abZ = b[2] - a[2];
  const lengthSq = abX * abX + abZ * abZ;
  if (lengthSq <= 1e-6) return Math.hypot(px - a[0], pz - a[2]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abX + (pz - a[2]) * abZ) / lengthSq));
  return Math.hypot(px - (a[0] + abX * t), pz - (a[2] + abZ * t));
}

function buildNearbyLineSegments(points: LinePoint[] | null | undefined, playerSceneX: number, playerSceneZ: number, distance: number, keyPrefix: string): NearbyLineSegment[] {
  if (!points || points.length < 2) return [];
  const segments: NearbyLineSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (distancePointToLineSegment2D(playerSceneX, playerSceneZ, a, b) <= distance) {
      segments.push({ key: `${keyPrefix}-${index}`, points: [a, b] });
    }
  }
  return segments;
}

function nearbySegmentSignature(segments: NearbyLineSegment[]): string {
  const pointSignature = (point: LinePoint) => `${point[0].toFixed(2)},${point[1].toFixed(2)},${point[2].toFixed(2)}`;
  return segments.map((segment) => `${segment.key}:${pointSignature(segment.points[0])}>${pointSignature(segment.points[1])}`).join('|');
}

function getStoredUnitScale(mode?: string): number {
  return isExportedMapMode(mode) ? 1 : LEGACY_STORED_UNIT_SCALE;
}

const STEALTH_BUFF_IDS = new Set([1011, 1012, 1013, 1021]);
const SANLIU_XIA_BUFF_IDS = new Set([1007, 1008]);
const ZHU_YUN_HIDE_BUFF_IDS = new Set([2716]);
const SHI_FANG_XUAN_JI_BUFF_ID = 2642;
const HONG_MENG_TIAN_JIN_BUFF_ID = 2645;
const DISGUISE_BUFF_IDS = new Set([980001]);
const YUMEN_SPECTATOR_BUFF_ID = 990202;

function isActiveBuffClient(buff: any, now = Date.now()): boolean {
  const expiresAt = Number(buff?.expiresAt ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return true;
  return expiresAt > now;
}

function activeBuffsClient(buffs?: any[]): any[] {
  if (!Array.isArray(buffs) || buffs.length === 0) return [];
  const now = Date.now();
  return buffs.filter((buff) => isActiveBuffClient(buff, now));
}

function hasStealthBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    (b.effects ?? []).some((e: any) => e.type === 'STEALTH') ||
    STEALTH_BUFF_IDS.has(b?.buffId) ||
    (typeof b?.name === 'string' && (b.name.includes('隐身') || b.name.includes('遁影')))
  );
}

function hasSanliuXiaBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    SANLIU_XIA_BUFF_IDS.has(b?.buffId) ||
    ZHU_YUN_HIDE_BUFF_IDS.has(b?.buffId) ||
    (typeof b?.name === 'string' && b.name.includes('散流霞'))
  );
}

function hasZhuYunHideBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => ZHU_YUN_HIDE_BUFF_IDS.has(b?.buffId));
}

function hasDisguiseBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    DISGUISE_BUFF_IDS.has(b?.buffId) ||
    (b.effects ?? []).some((e: any) => e.type === 'DISGUISE') ||
    (typeof b?.name === 'string' && b.name.includes('伪装'))
  );
}

function hasHongMengTianJinBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    b?.buffId === HONG_MENG_TIAN_JIN_BUFF_ID ||
    (b.effects ?? []).some((e: any) => e.type === 'HONG_MENG_TIAN_JIN') ||
    (typeof b?.name === 'string' && b.name.includes('鸿蒙天禁'))
  );
}

function shouldHideByStealthFromEnemyView(buffs?: any[]): boolean {
  return (hasStealthBuff(buffs) && !hasSanliuXiaBuff(buffs)) || hasHongMengTianJinBuff(buffs);
}

function hasYumenSpectatorBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    b?.buffId === YUMEN_SPECTATOR_BUFF_ID ||
    (typeof b?.name === 'string' && b.name.includes('观战中'))
  );
}

function hasShiFangXuanJiBuff(buffs?: any[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    b?.buffId === SHI_FANG_XUAN_JI_BUFF_ID ||
    (typeof b?.name === 'string' && b.name.includes('十方玄机'))
  );
}

interface PlayerInfo {
  userId: string;
  username?: string;
  position: { x: number; y: number; z?: number };
  hp: number;
  shield?: number;
  maxHp?: number;
  facing?: { x: number; y: number };
  buffs?: any[];
  hand?: any[];
  yumenDefeated?: boolean;
}

type ScreenBounds = { cx: number; topY: number; baseY: number; rs: number };

interface ArenaSceneProps {
  me: PlayerInfo;
  /** All non-me players, including hidden ones, for entity owner-name lookup. */
  allOpponents?: PlayerInfo[];
  /** All non-me players */
  opponents: PlayerInfo[];
  yumenSpectatorUserIds?: string[];
  selectedTargetId: string | null;
  onSelectTarget?: (userId: string) => void;
  pickups: PickupItem[];
  meChanneling: boolean;
  /** Radius of the local player's channel ring in game units (default 10) */
  meChannelRadius?: number;
  /** Which opponent userId is channeling (if any) */
  channelingOpponentId?: string | null;
  /** Radius of the channeling opponent's ring in game units (default 10) */
  channelingOpponentRadius?: number;
  /** Whether the local player has selected themselves (shows facing arc) */
  selectedSelf?: boolean;
  // Refs for live updates without re-renders
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z: number }>;
  camYawRef: MutableRefObject<number>;
  camPitchRef: MutableRefObject<number>;
  camZoomRef: MutableRefObject<number>;
  cameraMoveCommandActiveRef?: MutableRefObject<boolean>;
  cameraLookInputVersionRef?: MutableRefObject<number>;
  manualCameraLookActiveRef?: MutableRefObject<boolean>;
  onCameraDebugEvent?: (entry: {
    type: string;
    message: string;
    camera: { x: number; y: number; z: number };
    lookTarget: { x: number; y: number; z: number };
    pivot: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    zoom: number;
    desiredDistance: number;
    actualDistance: number;
    wallClamp: boolean;
    probeClamp: boolean;
    groundClamp: boolean;
    recenter: boolean;
    wallDebug?: {
      hitCount: number;
      sampleCount: number;
      hitMask: string;
      spanX: number;
      spanY: number;
      minDistance: number | null;
      maxDistance: number | null;
      rawDistance: number | null;
      retainedDistance: number | null;
      clearMs: number;
      pendingExpandDistance: number | null;
      pendingExpandMs: number;
    };
    probeDebug?: {
      hitCount: number;
      sampleCount: number;
      hitMask: string;
      minDistance: number | null;
      maxDistance: number | null;
      rawDistance: number | null;
      retainedDistance: number | null;
    };
  }) => void;
  meFacingRef: MutableRefObject<{ x: number; y: number }>;
  maxHp: number;
  meScreenBoundsRef?: MutableRefObject<ScreenBounds | null>;
  oppScreenBoundsRef?: MutableRefObject<ScreenBounds | null>;
  opponentScreenBoundsRef?: MutableRefObject<Record<string, ScreenBounds>>;
  entityScreenBoundsRef?: MutableRefObject<Record<string, ScreenBounds>>;
  mode?: string;
  safeZone?: SafeZone;
  showFutureSafeZone?: boolean;
  safeZoneDisplayMode?: SafeZoneDisplayMode;
  playArea?: PlayAreaBounds;
  onPlayAreaChange?: (playArea: PlayAreaBounds) => void;
  boundaryEditMode?: boolean;
  groundZones?: GroundZone[];
  /** HP-bearing targetable entities (e.g. 逐云寒蕊) */
  entities?: TargetEntity[];
  selectedEntityId?: string | null;
  onSelectEntity?: (entityId: string) => void;
  myUserId?: string;
  groundCastPreview?: { x: number; y: number; z?: number; radius: number; label?: string; isValid?: boolean; showPath?: boolean } | null;
  onGroundPointerMove?: (x: number, y: number, worldZ?: number, isHorizontal?: boolean) => void;
  onGroundPointerDown?: (x: number, y: number, worldZ?: number) => void;
  showCollisionShells?: boolean;
  collisionReady?: boolean;
  collisionSystemRef?: MutableRefObject<MapCollisionSystem | null>;
  collisionDebugRef?: MutableRefObject<{
    enabled: boolean;
    center: { x: number; y: number; z: number };
    supportY: number | null;
  }>;
  onCollisionSystemReady?: (sys: MapCollisionSystem) => void;
  /** Hides all visual mesh/terrain; shows only the collision shell wireframe on a black canvas. */
  blueprintMode?: boolean;
  /** Whether LOS to the selected target is currently blocked (for blueprint mode LOS line). */
  losIsBlocked?: boolean;
  /** Proof callback — called once on mount with actual Three.js runtime values */
  onEnvDebug?: (info: EnvDebugInfo) => void;
  onSceneMetrics?: (metrics: SceneRuntimeMetrics) => void;
  onSceneLoadTiming?: (event: SceneLoadTimingEvent) => void;
  envToggles?: EnvToggles;
  dirLightConfig?: DirLightConfig;
  /** Hides terrain / houses / world meshes while preserving self and HUD-facing overlays. */
  blindWorldMode?: boolean;
  /** Renders only the local player with camera/light setup, no world or other actors. */
  selfOnlyMode?: boolean;
  opponentInstantSnapAtRef?: MutableRefObject<number>;
}

export interface EnvDebugInfo {
  exposure: number;
  toneMapping: string;
  dirIntensity: number;
  dirColor: string;
  ambIntensity: number;
  hemiIntensity: number;
  fog: string | null;
  hasSkyDome: boolean;
  shadowNormalBias: number;
}

export interface SceneRuntimeMetrics {
  ts: number;
  rootChildren: number;
  objects: number;
  meshes: number;
  lights: number;
  cameras: number;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

export interface EnvToggles {
  toneMapping: boolean;
  exposure: boolean;
  shadows: boolean;
  dirLight: boolean;
  ambLight: boolean;
  hemiLight: boolean;
  fog: boolean;
  skyDome: boolean;
  cameraFar: boolean;
}

export interface DirLightConfig {
  intensity: number;
  colorMode: 'export' | 'custom';
  customColor: string;
}

const DEFAULT_ENV_TOGGLES: EnvToggles = {
  toneMapping: false, exposure: false, shadows: false,
  dirLight: false, ambLight: false, hemiLight: false,
  fog: false, skyDome: false, cameraFar: false,
};

const DEFAULT_DIR_LIGHT_CONFIG: DirLightConfig = {
  intensity: 0.25,
  colorMode: 'export',
  customColor: '#fdf2ed',
};

/**
 * Sets renderer properties for exported-map modes.
 * Must render first in the exported-map block so its useEffect fires before EnvProbe.
 */
function CollisionTestSetup({ blueprintMode, t }: { blueprintMode: boolean; t: EnvToggles }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = (!blueprintMode && t.toneMapping) ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = (!blueprintMode && t.exposure) ? 1.25 : 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = !blueprintMode && t.shadows;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
  }, [gl, blueprintMode, t.toneMapping, t.exposure, t.shadows]);
  return null;
}

function CameraFarSetup({ far }: { far: number }) {
  const { camera } = useThree();
  useEffect(() => {
    (camera as THREE.PerspectiveCamera).far = far;
    camera.updateProjectionMatrix();
  }, [camera, far]);
  return null;
}

const SUN_DIR = new THREE.Vector3(0.709406, 0.573576, -0.409576).normalize();
const SUN_COLOR = new THREE.Color(0.984313, 0.890196, 0.847058);
const AMBIENT_COLOR = new THREE.Color(0.498039, 0.498039, 0.498039);
const HEMI_SKY_COLOR = new THREE.Color(0.3984312, 0.4482351, 0.5976468);
const HEMI_GROUND_COLOR = new THREE.Color('#8b7355');

function ExportReaderSunLight({ config = DEFAULT_DIR_LIGHT_CONFIG }: { config?: DirLightConfig }) {
  const { camera, scene } = useThree();
  const lightRef = useRef<THREE.DirectionalLight | null>(null);

  useEffect(() => {
    const sun = new THREE.DirectionalLight(SUN_COLOR, 3.0);
    sun.position.copy(SUN_DIR).multiplyScalar(100000);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 200000;
    sun.shadow.camera.left = -50000;
    sun.shadow.camera.right = 50000;
    sun.shadow.camera.top = 50000;
    sun.shadow.camera.bottom = -50000;
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 200;
    scene.add(sun);
    scene.add(sun.target);
    lightRef.current = sun;
    return () => {
      if (sun.target.parent) sun.target.parent.remove(sun.target);
      scene.remove(sun);
      if (sun.parent) sun.parent.remove(sun);
      lightRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.intensity = config.intensity;
    light.color.copy(config.colorMode === 'export' ? SUN_COLOR : new THREE.Color(config.customColor));
  }, [config]);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const dir = light.position.clone().normalize();
    light.position.copy(camera.position).addScaledVector(dir, 100000);
    light.target.position.copy(camera.position);
    light.target.updateMatrixWorld();
  });

  return null;
}

/** Sky dome that follows the camera so it stays within camera.far. */
const SKY_UNIFORMS = {
  topColor:    { value: new THREE.Color('#4488cc') },
  bottomColor: { value: new THREE.Color('#d4c5a0') },
  horizonColor:{ value: new THREE.Color('#c8b888') },
  exponent:    { value: 0.5 },
};
const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = `
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
`;
function SkyDome() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(() => { if (meshRef.current) meshRef.current.position.copy(camera.position); });
  return (
    <mesh ref={meshRef} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1800, 32, 16]} />
      <shaderMaterial side={THREE.BackSide} depthWrite={false} uniforms={SKY_UNIFORMS}
        vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} />
    </mesh>
  );
}

/** Reads actual Three.js scene/renderer state and fires onEnvDebug.
 *  Reads after next animation frame so CollisionTestSetup's useEffect has already run. */
function EnvProbe({ onEnvDebug }: { onEnvDebug: (info: EnvDebugInfo) => void }) {
  const { scene, gl } = useThree();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const toneMappingName = ({
        [THREE.NoToneMapping]: 'None',
        [THREE.LinearToneMapping]: 'Linear',
        [THREE.ReinhardToneMapping]: 'Reinhard',
        [THREE.CineonToneMapping]: 'Cineon',
        [THREE.ACESFilmicToneMapping]: 'ACESFilmic',
      } as Record<number, string>)[gl.toneMapping] ?? `#${gl.toneMapping}`;
      const dir = scene.children.find((c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight);
      const amb = scene.children.find((c): c is THREE.AmbientLight => c instanceof THREE.AmbientLight);
      const hemi = scene.children.find((c): c is THREE.HemisphereLight => c instanceof THREE.HemisphereLight);
      const dirColor = dir ? '#' + dir.color.getHexString() : 'n/a';
      const fogInfo = scene.fog
        ? `${scene.fog.constructor.name} color=#${(scene.fog as any).color?.getHexString() ?? '?'} density=${(scene.fog as any).density ?? 'n/a'}`
        : null;
      const hasSkyDome = scene.children.some(
        (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry && (c.material as any).isShaderMaterial
      );
      onEnvDebug({
        exposure: +gl.toneMappingExposure.toFixed(3),
        toneMapping: toneMappingName,
        dirIntensity: +(dir?.intensity ?? 0).toFixed(2),
        dirColor,
        ambIntensity: +(amb?.intensity ?? 0).toFixed(2),
        hemiIntensity: +(hemi?.intensity ?? 0).toFixed(2),
        fog: fogInfo,
        hasSkyDome,
        shadowNormalBias: +(dir?.shadow?.normalBias ?? 0),
      });
    });
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function SceneMetricsProbe({ onSceneMetrics }: { onSceneMetrics: (metrics: SceneRuntimeMetrics) => void }) {
  const { scene, gl } = useThree();
  useEffect(() => {
    const collect = () => {
      let objects = 0;
      let meshes = 0;
      let lights = 0;
      let cameras = 0;
      scene.traverse((object) => {
        objects += 1;
        const probe = object as any;
        if (probe.isMesh) meshes += 1;
        if (probe.isLight) lights += 1;
        if (probe.isCamera) cameras += 1;
      });
      onSceneMetrics({
        ts: Date.now(),
        rootChildren: scene.children.length,
        objects,
        meshes,
        lights,
        cameras,
        geometries: gl.info.memory.geometries ?? 0,
        textures: gl.info.memory.textures ?? 0,
        programs: gl.info.programs?.length ?? 0,
        calls: gl.info.render.calls ?? 0,
        triangles: gl.info.render.triangles ?? 0,
        lines: gl.info.render.lines ?? 0,
        points: gl.info.render.points ?? 0,
      });
    };
    collect();
    const id = window.setInterval(collect, 1000);
    return () => window.clearInterval(id);
  }, [gl, scene, onSceneMetrics]);
  return null;
}

type BoundaryHandle = 'nw' | 'ne' | 'sw' | 'se';

function normalizePlayAreaBounds(playArea: PlayAreaBounds | undefined, mapWidth: number, mapHeight: number): PlayAreaBounds {
  const rawMinX = Math.max(0, Math.min(mapWidth, Number(playArea?.minX ?? 0)));
  const rawMaxX = Math.max(0, Math.min(mapWidth, Number(playArea?.maxX ?? mapWidth)));
  const rawMinY = Math.max(0, Math.min(mapHeight, Number(playArea?.minY ?? 0)));
  const rawMaxY = Math.max(0, Math.min(mapHeight, Number(playArea?.maxY ?? mapHeight)));
  return {
    minX: Math.min(rawMinX, rawMaxX),
    minY: Math.min(rawMinY, rawMaxY),
    maxX: Math.max(rawMinX, rawMaxX),
    maxY: Math.max(rawMinY, rawMaxY),
  };
}

function updateBoundaryHandle(bounds: PlayAreaBounds, handle: BoundaryHandle, worldX: number, worldY: number, mapWidth: number, mapHeight: number): PlayAreaBounds {
  const minSize = 12;
  const next = { ...bounds };
  const clampedX = Math.max(0, Math.min(mapWidth, worldX));
  const clampedY = Math.max(0, Math.min(mapHeight, worldY));
  if (handle === 'nw' || handle === 'sw') next.minX = Math.min(clampedX, next.maxX - minSize);
  if (handle === 'ne' || handle === 'se') next.maxX = Math.max(clampedX, next.minX + minSize);
  if (handle === 'nw' || handle === 'ne') next.minY = Math.min(clampedY, next.maxY - minSize);
  if (handle === 'sw' || handle === 'se') next.maxY = Math.max(clampedY, next.minY + minSize);
  return normalizePlayAreaBounds(next, mapWidth, mapHeight);
}

function YumenBoundaryOverlay({
  playArea,
  mapWidth,
  mapHeight,
  worldHalfX,
  worldHalfY,
  localRenderPosRef,
  onPlayAreaChange,
  boundaryEditMode = false,
  getZoneTerrainZ,
}: {
  playArea?: PlayAreaBounds;
  mapWidth: number;
  mapHeight: number;
  worldHalfX: number;
  worldHalfY: number;
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z?: number }>;
  onPlayAreaChange?: (playArea: PlayAreaBounds) => void;
  boundaryEditMode?: boolean;
  getZoneTerrainZ: (worldX: number, worldY: number, worldZ?: number) => number;
}) {
  const [draftBounds, setDraftBounds] = useState(() => normalizePlayAreaBounds(playArea, mapWidth, mapHeight));
  const [visibleBoundarySegments, setVisibleBoundarySegments] = useState<NearbyLineSegment[]>([]);
  const draftBoundsRef = useRef(draftBounds);
  const visibleBoundarySignatureRef = useRef('');
  const dragHandleRef = useRef<BoundaryHandle | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragPointRef = useRef(new THREE.Vector3());

  useEffect(() => {
    draftBoundsRef.current = draftBounds;
  }, [draftBounds]);

  useEffect(() => {
    if (!dragHandleRef.current) {
      setDraftBounds(normalizePlayAreaBounds(playArea, mapWidth, mapHeight));
    }
  }, [playArea, mapWidth, mapHeight]);

  const bounds = draftBounds;
  const minX = bounds.minX - worldHalfX;
  const maxX = bounds.maxX - worldHalfX;
  const minZ = worldHalfY - bounds.minY;
  const maxZ = worldHalfY - bounds.maxY;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const width = Math.max(0.1, maxX - minX);
  const depth = Math.max(0.1, minZ - maxZ);
  const wallHeight = 10;
  const wallY = wallHeight / 2;
  const handlePositions: Record<BoundaryHandle, [number, number, number]> = {
    nw: [minX, wallY, minZ],
    ne: [maxX, wallY, minZ],
    sw: [minX, wallY, maxZ],
    se: [maxX, wallY, maxZ],
  };
  const boundaryGroundLine: [number, number, number][] = [];
  const boundaryLineClearance = 0.6;
  const xLineSamples = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / 10) + 1);
  const yLineSamples = Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / 10) + 1);
  const addBoundaryPoint = (worldX: number, worldY: number) => {
    boundaryGroundLine.push([
      worldX - worldHalfX,
      getZoneTerrainZ(worldX, worldY, 0) + boundaryLineClearance,
      worldHalfY - worldY,
    ]);
  };
  for (let i = 0; i < xLineSamples; i += 1) {
    const t = xLineSamples === 1 ? 0 : i / (xLineSamples - 1);
    addBoundaryPoint(bounds.minX + (bounds.maxX - bounds.minX) * t, bounds.minY);
  }
  for (let i = 1; i < yLineSamples; i += 1) {
    const t = yLineSamples === 1 ? 0 : i / (yLineSamples - 1);
    addBoundaryPoint(bounds.maxX, bounds.minY + (bounds.maxY - bounds.minY) * t);
  }
  for (let i = 1; i < xLineSamples; i += 1) {
    const t = xLineSamples === 1 ? 0 : i / (xLineSamples - 1);
    addBoundaryPoint(bounds.maxX - (bounds.maxX - bounds.minX) * t, bounds.maxY);
  }
  for (let i = 1; i < yLineSamples; i += 1) {
    const t = yLineSamples === 1 ? 0 : i / (yLineSamples - 1);
    addBoundaryPoint(bounds.minX, bounds.maxY - (bounds.maxY - bounds.minY) * t);
  }

  useFrame(() => {
    const player = localRenderPosRef.current;
    const playerSceneX = player.x - worldHalfX;
    const playerSceneZ = worldHalfY - player.y;
    const nextSegments = buildNearbyLineSegments(boundaryGroundLine, playerSceneX, playerSceneZ, YUMEN_BOUNDARY_LINE_VISIBLE_DISTANCE, 'boundary');
    const signature = nearbySegmentSignature(nextSegments);
    if (signature !== visibleBoundarySignatureRef.current) {
      visibleBoundarySignatureRef.current = signature;
      setVisibleBoundarySegments(nextSegments);
    }
  });

  const applyDragPoint = (event: any) => {
    const handle = dragHandleRef.current;
    if (!handle) return;
    event.stopPropagation();
    const dragPoint = event.ray?.intersectPlane?.(dragPlaneRef.current, dragPointRef.current);
    if (!dragPoint) return;
    const next = updateBoundaryHandle(
      draftBoundsRef.current,
      handle,
      dragPoint.x + worldHalfX,
      worldHalfY - dragPoint.z,
      mapWidth,
      mapHeight,
    );
    draftBoundsRef.current = next;
    setDraftBounds(next);
  };

  const finishDrag = (event: any) => {
    if (!dragHandleRef.current) return;
    event.stopPropagation();
    try {
      if (activePointerIdRef.current !== null && event.target?.releasePointerCapture) {
        event.target.releasePointerCapture(activePointerIdRef.current);
      }
    } catch {
      // Pointer capture can already be released by the browser.
    }
    dragHandleRef.current = null;
    activePointerIdRef.current = null;
    onPlayAreaChange?.(draftBoundsRef.current);
  };

  return (
    <group renderOrder={20}>
      {visibleBoundarySegments.map((segment) => (
        <Line
          key={`${segment.key}-glow`}
          points={segment.points}
          color="#ff1f1f"
          lineWidth={5}
          transparent
          opacity={0.22}
          renderOrder={33}
          depthTest={false}
          depthWrite={false}
        />
      ))}
      {visibleBoundarySegments.map((segment) => (
        <Line
          key={segment.key}
          points={segment.points}
          color="#ff2f2f"
          lineWidth={2}
          transparent
          opacity={0.94}
          renderOrder={34}
          depthTest={false}
          depthWrite={false}
        />
      ))}
      {boundaryEditMode && (Object.keys(handlePositions) as BoundaryHandle[]).map((handle) => (
        <mesh
          key={handle}
          position={handlePositions[handle]}
          renderOrder={42}
          onPointerDown={(event) => {
            event.stopPropagation();
            dragHandleRef.current = handle;
            activePointerIdRef.current = event.pointerId;
            event.target?.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={applyDragPoint}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <cylinderGeometry args={[1.4, 1.4, wallHeight + 2, 18]} />
          <meshBasicMaterial color="#fde047" transparent opacity={0.94} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

function YumenSafeZoneOverlay({
  safeZone,
  worldHalfX,
  worldHalfY,
  localRenderPosRef,
  getZoneTerrainZ,
  getZoneVisualZ,
  showFutureSafeZone = true,
  displayMode = 'terrain',
  structureXrayActive,
  onStructureXrayActiveChange,
}: {
  safeZone?: SafeZone;
  worldHalfX: number;
  worldHalfY: number;
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z?: number }>;
  getZoneTerrainZ: (worldX: number, worldY: number, worldZ?: number) => number;
  getZoneVisualZ: (worldX: number, worldY: number, worldZ?: number) => number;
  showFutureSafeZone?: boolean;
  displayMode?: SafeZoneDisplayMode;
  structureXrayActive: boolean;
  onStructureXrayActiveChange: (active: boolean) => void;
}) {
  const [xraySegments, setXraySegments] = useState<{ current: NearbyLineSegment[]; target: NearbyLineSegment[] }>({ current: [], target: [] });
  const xraySignatureRef = useRef({ current: '', target: '' });
  const showCurrentLine = true;
  const visual = useMemo(() => {
    if (!safeZone) return null;
    const radius = Math.max(0, Number(safeZone.currentHalf ?? 0));
    if (radius <= 0) return null;
    const segments = displayMode === 'topDown' ? 360 : 180;
    const sampleZ = displayMode === 'topDown' ? getZoneVisualZ : getZoneTerrainZ;
    const buildRingPoints = (centerX: number, centerY: number, ringRadius: number) => {
      const points: LinePoint[] = [];
      for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
        const angle = (segmentIndex / segments) * Math.PI * 2;
        const worldX = centerX + Math.cos(angle) * ringRadius;
        const worldY = centerY + Math.sin(angle) * ringRadius;
        points.push([
          worldX - worldHalfX,
          sampleZ(worldX, worldY, 0) + YUMEN_SAFE_ZONE_RING_CLEARANCE,
          worldHalfY - worldY,
        ]);
      }
      return points;
    };

    const bottomPoints = buildRingPoints(safeZone.centerX, safeZone.centerY, radius);
    const targetRadius = Math.max(0, Number(safeZone.targetHalf ?? (typeof safeZone.targetDiameter === 'number' ? safeZone.targetDiameter / 2 : 0)));
    const targetBottomPoints = showFutureSafeZone && safeZone.targetVisible && targetRadius > 0 && typeof safeZone.targetCenterX === 'number' && typeof safeZone.targetCenterY === 'number'
      ? buildRingPoints(safeZone.targetCenterX, safeZone.targetCenterY, targetRadius)
      : null;

    return { bottomPoints, targetBottomPoints, radius };
  }, [safeZone, worldHalfX, worldHalfY, getZoneTerrainZ, getZoneVisualZ, showFutureSafeZone, displayMode]);

  useFrame(() => {
    if (!visual || !safeZone) {
      setXraySegments((previous) => (previous.current.length || previous.target.length ? { current: [], target: [] } : previous));
      xraySignatureRef.current = { current: '', target: '' };
      if (structureXrayActive) onStructureXrayActiveChange(false);
      return;
    }
    const player = localRenderPosRef.current;
    const playerSceneX = player.x - worldHalfX;
    const playerSceneZ = worldHalfY - player.y;
    const current = showCurrentLine ? buildNearbyLineSegments(visual.bottomPoints, playerSceneX, playerSceneZ, YUMEN_SAFE_ZONE_LINE_XRAY_DISTANCE, 'safe-current') : [];
    const target = buildNearbyLineSegments(visual.targetBottomPoints, playerSceneX, playerSceneZ, YUMEN_SAFE_ZONE_LINE_XRAY_DISTANCE, 'safe-target');
    const currentSignature = nearbySegmentSignature(current);
    const targetSignature = nearbySegmentSignature(target);
    if (currentSignature !== xraySignatureRef.current.current || targetSignature !== xraySignatureRef.current.target) {
      xraySignatureRef.current = { current: currentSignature, target: targetSignature };
      setXraySegments({ current, target });
    }
    const nearLine = current.length > 0 || target.length > 0;
    if (structureXrayActive !== nearLine) onStructureXrayActiveChange(nearLine);
  });

  useEffect(() => {
    return () => onStructureXrayActiveChange(false);
  }, [onStructureXrayActiveChange]);

  if (!visual) return null;
  return (
    <group renderOrder={18}>
      {showCurrentLine && (
        <Line
          points={visual.bottomPoints}
          color="#ffffff"
          lineWidth={5}
          renderOrder={20}
          depthTest={true}
          depthWrite={false}
        />
      )}
      {visual.targetBottomPoints && (
        <Line
          points={visual.targetBottomPoints}
          color="#22b8ff"
          lineWidth={3}
          transparent
          opacity={1}
          renderOrder={21}
          depthTest={true}
          depthWrite={false}
        />
      )}
      {xraySegments.current.map((segment) => (
        <Line
          key={segment.key}
          points={segment.points}
          color="#ffffff"
          lineWidth={5}
          transparent
          opacity={0.96}
          renderOrder={41}
          depthTest={false}
          depthWrite={false}
        />
      ))}
      {xraySegments.target.map((segment) => (
        <Line
          key={segment.key}
          points={segment.points}
          color="#22b8ff"
          lineWidth={3}
          transparent
          opacity={1}
          renderOrder={42}
          depthTest={false}
          depthWrite={false}
        />
      ))}
    </group>
  );
}

export default function ArenaScene({
  me,
  allOpponents,
  opponents,
  yumenSpectatorUserIds = [],
  selectedTargetId,
  onSelectTarget,
  pickups,
  meChanneling,
  meChannelRadius = 10,
  channelingOpponentId,
  channelingOpponentRadius = 10,
  selectedSelf = false,
  localRenderPosRef,
  camYawRef,
  camPitchRef,
  camZoomRef,
  cameraMoveCommandActiveRef,
  cameraLookInputVersionRef,
  manualCameraLookActiveRef,
  onCameraDebugEvent,
  meFacingRef,
  maxHp,
  meScreenBoundsRef,
  oppScreenBoundsRef,
  opponentScreenBoundsRef,
  entityScreenBoundsRef,
  mode,
  safeZone,
  showFutureSafeZone = true,
  safeZoneDisplayMode = 'terrain',
  playArea,
  onPlayAreaChange,
  boundaryEditMode,
  groundZones,
  entities,
  selectedEntityId,
  onSelectEntity,
  myUserId,
  groundCastPreview,
  onGroundPointerMove,
  onGroundPointerDown,
  showCollisionShells,
  collisionReady = true,
  collisionSystemRef,
  collisionDebugRef,
  onCollisionSystemReady,
  blueprintMode = false,
  losIsBlocked = false,
  onEnvDebug,
  onSceneMetrics,
  onSceneLoadTiming,
  envToggles,
  dirLightConfig,
  blindWorldMode = false,
  selfOnlyMode = false,
  opponentInstantSnapAtRef,
}: ArenaSceneProps) {
  const storedUnitScale = getStoredUnitScale(mode);
  const { objects: mapObjects, width: mapWidth, height: mapHeight } = getMapForMode(mode);
  const worldHalfX = mapWidth / 2;
  const worldHalfY = mapHeight / 2;
  const isArena = mode === 'arena';
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [safeZoneStructureXrayActive, setSafeZoneStructureXrayActive] = useState(false);
  const zoneProbeRef = useRef(new THREE.Vector3());
  const hasGroundZoneTimers = (groundZones?.length ?? 0) > 0;
  const yumenSpectatorUserIdSet = useMemo(() => new Set(yumenSpectatorUserIds), [yumenSpectatorUserIds]);

  useEffect(() => {
    if (!hasGroundZoneTimers) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [hasGroundZoneTimers]);

  const selectedTarget = selectedTargetId
    ? opponents.find((o) => {
        const targetYumenSpectator = hasYumenSpectatorBuff(o.buffs) || o.yumenDefeated === true || yumenSpectatorUserIdSet.has(o.userId);
        const selfYumenSpectator = hasYumenSpectatorBuff(me?.buffs) || me.yumenDefeated === true || yumenSpectatorUserIdSet.has(me.userId);
        return o.userId === selectedTargetId && !hasDisguiseBuff(o.buffs) && (!shouldHideByStealthFromEnemyView(o.buffs) || (selfYumenSpectator && targetYumenSpectator));
      })
    : null;
  const selectedEntity = selectedEntityId
    ? (entities ?? []).find((entity) => entity.id === selectedEntityId) ?? null
    : null;
  const meDisguised = hasDisguiseBuff(me?.buffs);
  const meYumenSpectator = hasYumenSpectatorBuff(me?.buffs) || me.yumenDefeated === true || yumenSpectatorUserIdSet.has(me.userId);
  const meSemiTransparent = !meDisguised && (hasStealthBuff(me?.buffs) || hasSanliuXiaBuff(me?.buffs) || meYumenSpectator);

  const targetAnchor = selectedTarget
    ? selectedTarget.position
    : selectedEntity
    ? selectedEntity.position
    : null;

  const targetLinePoints = targetAnchor
    ? [
        [
          localRenderPosRef.current.x - worldHalfX,
          (localRenderPosRef.current.z ?? 0) + 1,
          worldHalfY - localRenderPosRef.current.y,
        ],
        [
          targetAnchor.x - worldHalfX,
          (targetAnchor.z ?? 0) + 1,
          worldHalfY - targetAnchor.y,
        ],
      ] as [number, number, number][]
    : null;

  const handleGroundPointerMove = (e: any) => {
    if (!onGroundPointerMove) return;
    onGroundPointerMove(e.point.x + worldHalfX, worldHalfY - e.point.z, e.point.y, e.isHorizontal !== false);
  };

  const handleGroundPointerDown = (e: any) => {
    if (!onGroundPointerDown) return;
    onGroundPointerDown(e.point.x + worldHalfX, worldHalfY - e.point.z, e.point.y);
  };

  const isExportedMap = isExportedMapMode(mode);
  const isYumenMode = isYumen1v1BasicMode(mode);
  const showCircularSafeZoneOverlay = isYumenMode;

  const getZoneVisualZ = useCallback((worldX: number, worldY: number, worldZ = 0) => {
    let groundZ = 0;

    if (isExportedMap && collisionSystemRef?.current) {
      const probe = zoneProbeRef.current;
      probe.set(
        (worldX - worldHalfX - GROUP_POS_X) / RENDER_SF_XZ,
        5000,
        (worldHalfY - worldY - GROUP_POS_Z) / RENDER_SF_XZ,
      );
      const supportY = collisionSystemRef.current.getSupportGroundY(probe);
      if (supportY !== null) {
        groundZ = supportY * RENDER_SF_Y + GROUP_POS_Y;
      }
    } else {
      for (const obj of mapObjects) {
        if (
          worldX >= obj.x && worldX <= obj.x + obj.w &&
          worldY >= obj.y && worldY <= obj.y + obj.d &&
          obj.h > groundZ
        ) {
          groundZ = obj.h;
        }
      }
    }

    return Math.max(worldZ, groundZ) + 0.16;
  }, [collisionSystemRef, isExportedMap, mapObjects, worldHalfX, worldHalfY]);

  const getZoneTerrainZ = useCallback((worldX: number, worldY: number, worldZ = 0) => {
    let groundZ = 0;

    if (isExportedMap && collisionSystemRef?.current) {
      const probe = zoneProbeRef.current;
      probe.set(
        (worldX - worldHalfX - GROUP_POS_X) / RENDER_SF_XZ,
        5000,
        (worldHalfY - worldY - GROUP_POS_Z) / RENDER_SF_XZ,
      );
      const terrainY = collisionSystemRef.current.getTerrainGroundY(probe);
      if (terrainY !== null) {
        groundZ = terrainY * RENDER_SF_Y + GROUP_POS_Y;
      }
    }

    return Math.max(worldZ, groundZ) + 0.16;
  }, [collisionSystemRef, isExportedMap, worldHalfX, worldHalfY]);

  return (
    <>
      {/* Camera */}
      {onSceneMetrics && <SceneMetricsProbe onSceneMetrics={onSceneMetrics} />}
      <CameraRig
        localRenderPosRef={localRenderPosRef}
        camYawRef={camYawRef}
        camPitchRef={camPitchRef}
        camZoomRef={camZoomRef}
        moveCommandActiveRef={cameraMoveCommandActiveRef}
        cameraLookInputVersionRef={cameraLookInputVersionRef}
        manualCameraLookActiveRef={manualCameraLookActiveRef}
        onCameraDebugEvent={onCameraDebugEvent}
        worldHalfX={worldHalfX}
        worldHalfY={worldHalfY}
        collisionSystemRef={isExportedMap ? collisionSystemRef : undefined}
      />

      {/* Lighting — mode-specific */}
      {selfOnlyMode ? (
        <>
          <ambientLight intensity={1.1} color="#f4f6ff" />
          <directionalLight position={[300, 500, 100]} intensity={2.6} color="#eef4ff" />
        </>
      ) : isExportedMap ? (
        <>
          <CollisionTestSetup blueprintMode={blueprintMode} t={envToggles ?? DEFAULT_ENV_TOGGLES} />
          <CameraFarSetup far={envToggles?.cameraFar ? 500000 : 2000} />
          {envToggles?.dirLight && <ExportReaderSunLight config={dirLightConfig} />}
          {envToggles?.ambLight && <ambientLight intensity={0.8} color={AMBIENT_COLOR} />}
          {envToggles?.hemiLight && <hemisphereLight args={[HEMI_SKY_COLOR, HEMI_GROUND_COLOR, 1.0]} />}
          {envToggles?.fog && <fogExp2 attach="fog" args={['#c8b888', 0.0000035]} />}
          {envToggles?.skyDome && <SkyDome />}
          {onEnvDebug && <EnvProbe onEnvDebug={onEnvDebug} />}
        </>
      ) : (
        <>
          <ambientLight intensity={1.0} color="#c0ddb8" />
          <directionalLight position={[300, 500, 100]} intensity={2.8} color="#e8eedc" />
          <directionalLight position={[-100, 50, -200]} intensity={0.4} color="#3d7045" />
          {!isArena && <fog attach="fog" args={['#7ab86a', 300, 1000]} />}
        </>
      )}

      {!blueprintMode && (
        <Character
          worldX={me.position.x}
          worldY={me.position.y}
          worldZ={me.position.z ?? 0}
          color="#1a66cc"
          emissive="#0a2255"
          hp={me.hp}
          shield={me.shield ?? 0}
          maxHp={me.maxHp ?? maxHp}
          isMe={true}
          isSelected={selectedSelf}
          facingRef={meFacingRef}
          posRef={localRenderPosRef}
          onScreenBounds={meScreenBoundsRef ? (b) => { meScreenBoundsRef.current = b; } : undefined}
          worldHalfX={worldHalfX}
          worldHalfY={worldHalfY}
          isStealthed={meSemiTransparent}
          isDisguised={meDisguised}
          hideHpBar={meDisguised || meYumenSpectator}
          cameraFadeEnabled={isExportedMap && !selfOnlyMode}
          hpColorOverride={hasShiFangXuanJiBuff(me.buffs) ? '#2acb6b' : undefined}
        />
      )}

      {!selfOnlyMode && (
        <>
          {/* World */}
          {isExportedMap ? (
            <ExportedMapScene
              worldWidth={mapWidth}
              worldHeight={mapHeight}
              showCollisionShells={showCollisionShells}
              blueprintMode={blueprintMode}
              hideVisuals={blindWorldMode}
              terrainDepthPrepass={isYumenMode && safeZoneStructureXrayActive}
              onCollisionSystemReady={onCollisionSystemReady}
              onLoadTiming={onSceneLoadTiming}
              onPointerMove={onGroundPointerMove ? handleGroundPointerMove : undefined}
              onPointerDown={onGroundPointerDown ? handleGroundPointerDown : undefined}
            />
          ) : (
            <>
              <Ground
                arenaSize={mapWidth}
                isArena={isArena}
                mode={mode}
                safeZone={safeZone}
                hideVisuals={blindWorldMode}
                onPointerMove={onGroundPointerMove ? handleGroundPointerMove : undefined}
                onPointerDown={onGroundPointerDown ? handleGroundPointerDown : undefined}
              />
              {!blindWorldMode && <MapObjects localRenderPosRef={localRenderPosRef} mapObjects={mapObjects} worldHalfX={worldHalfX} worldHalfY={worldHalfY} />}
            </>
          )}
          {isYumenMode && (
            <YumenBoundaryOverlay
              playArea={playArea}
              mapWidth={mapWidth}
              mapHeight={mapHeight}
              worldHalfX={worldHalfX}
              worldHalfY={worldHalfY}
              localRenderPosRef={localRenderPosRef}
              onPlayAreaChange={onPlayAreaChange}
              boundaryEditMode={boundaryEditMode}
              getZoneTerrainZ={getZoneTerrainZ}
            />
          )}
          {showCircularSafeZoneOverlay && (
            <YumenSafeZoneOverlay
              safeZone={safeZone}
              worldHalfX={worldHalfX}
              worldHalfY={worldHalfY}
              localRenderPosRef={localRenderPosRef}
              getZoneTerrainZ={getZoneTerrainZ}
              getZoneVisualZ={getZoneVisualZ}
              showFutureSafeZone={showFutureSafeZone}
              displayMode={safeZoneDisplayMode}
              structureXrayActive={isYumenMode ? safeZoneStructureXrayActive : false}
              onStructureXrayActiveChange={isYumenMode ? setSafeZoneStructureXrayActive : () => undefined}
            />
          )}
          {!blueprintMode && <PickupBooks pickups={pickups} localRenderPosRef={localRenderPosRef} worldHalfX={worldHalfX} worldHalfY={worldHalfY} />}

          {/* Always-visible target connection line (not blocked by structures). */}
          {targetLinePoints && (
            <Line
              points={targetLinePoints}
              color={blueprintMode ? (losIsBlocked ? '#ff2222' : '#00ff88') : '#ffd24a'}
              lineWidth={blueprintMode ? 3 : 2}
              transparent
              opacity={0.9}
              depthTest={false}
            />
          )}
        </>
      )}

      {/* All game-play visuals hidden in blueprint mode */}
      {!blueprintMode && !selfOnlyMode && <>
      {/* Ground damage zones (e.g. 狂龙乱舞 雷云) */}
      {(groundZones ?? []).map(zone => {
        const isBaizuMarker = zone.abilityId === 'baizu_marker';
        const isShengTaiji = zone.abilityId === 'qionglong_huasheng_zone' || zone.abilityId === 'sheng_tai_ji';
        const isKuanglong = zone.abilityId === 'kuang_long_luan_wu';
        const isZhenShanHe = zone.abilityId === 'zhen_shan_he';
        const isChongYinYang = zone.abilityId === 'chong_yin_yang';
        const isLingTaiXu = zone.abilityId === 'ling_tai_xu';
        const isTunRiYue = zone.abilityId === 'tun_ri_yue';
        const isSuiXingChen = zone.abilityId === 'sui_xing_chen';
        const isPoCangQiong = zone.abilityId === 'po_cang_qiong';
        const isXiBingYu = zone.abilityId === 'xi_bing_yu';
        const isOwn = zone.ownerUserId === me.userId;
        const isXiBingYuTarget = zone.pickupTargetUserId === me.userId;
        const color = isXiBingYu
          ? (isXiBingYuTarget ? '#4488ff' : '#ff3333')
          : isBaizuMarker
          ? (isOwn ? '#b06cff' : '#ff3333')
          : (isOwn ? '#4488ff' : '#ff3333');
        const baseLabel = isBaizuMarker
          ? '百足'
          : isZhenShanHe
          ? '镇山河'
          : isChongYinYang
          ? '冲阴阳'
          : isLingTaiXu
          ? '凌太虚'
          : isTunRiYue
          ? '吞日月'
          : isSuiXingChen
          ? '碎星辰'
          : isPoCangQiong
          ? '破苍穹'
          : (zone.abilityName ?? '雷云');
        const showOwnTimer = isOwn && (isShengTaiji || isKuanglong || isZhenShanHe || isChongYinYang || isLingTaiXu || isTunRiYue || isSuiXingChen || isPoCangQiong);
        const secondsLeft = Math.max(1, Math.ceil((zone.expiresAt - nowMs) / 1000));
        const label = showOwnTimer ? `${baseLabel} · ${secondsLeft}` : baseLabel;
        return (
          <AoeZone
            key={zone.id}
            worldX={zone.x}
            worldY={zone.y}
            worldZ={getZoneVisualZ(zone.x, zone.y, zone.z ?? 0)}
            radius={zone.radius}
            color={color}
            ringThickness={isXiBingYu ? 0.1 : undefined}
            labelSize={isXiBingYu ? 0.34 : undefined}
            labelColor={color}
            label={label}
            worldHalfX={worldHalfX}
            worldHalfY={worldHalfY}
          />
        );
      })}

      {/* HP-bearing targetable entities (e.g. 逐云寒蕊) */}
      {(entities ?? []).map((entity) => {
        const isOwn = entity.ownerUserId === myUserId;
        const isSelected = selectedEntityId === entity.id;
        const z = getZoneVisualZ(entity.position.x, entity.position.y, entity.position.z ?? 0);
        const owner = isOwn
          ? me
          : (allOpponents ?? opponents).find((opp) => opp.userId === entity.ownerUserId);
        const ownerName = owner?.username ?? owner?.userId ?? '玩家';
        const dx = entity.position.x - me.position.x;
        const dy = entity.position.y - me.position.y;
        const dz = (entity.position.z ?? 0) - (me.position.z ?? 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / storedUnitScale;
        const isDummy = entity.kind === 'test_dummy_ally' || entity.kind === 'test_dummy_enemy';
        const isWall = entity.kind === 'chu_he_han_jie_wall';
        const label = isDummy
          ? (isOwn ? '友方木桩' : '敌方木桩')
          : isWall
          ? `${ownerName}的楚河汉界`
          : `${ownerName}的逐云寒蕊`;
        return (
          <TargetEntityVisual
            key={entity.id}
            kind={entity.kind}
            worldX={entity.position.x}
            worldY={entity.position.y}
            worldZ={z}
            radius={entity.radius}
            hp={entity.hp}
            maxHp={entity.maxHp}
            isOwn={isOwn}
            isSelected={isSelected}
            username={label}
            distance={dist}
            color={isWall ? (isOwn ? '#1a66cc' : '#cc3333') : (isOwn ? '#33aa55' : '#ff3333')}
            worldHalfX={worldHalfX}
            worldHalfY={worldHalfY}
            wallHalfLength={entity.wallHalfLength}
            wallHalfThickness={entity.wallHalfThickness}
            wallHeight={entity.wallHeight}
            wallTangent={entity.wallTangent}
            spawnedAt={entity.spawnedAt}
            onClick={() => onSelectEntity?.(entity.id)}
            onScreenBounds={(bounds) => {
              if (!entityScreenBoundsRef) return;
              entityScreenBoundsRef.current[entity.id] = bounds;
            }}
          />
        );
      })}

      {groundCastPreview && (
        <>
          {groundCastPreview.showPath && (
            <Line
              points={[
                [
                  localRenderPosRef.current.x - worldHalfX,
                  (localRenderPosRef.current.z ?? 0) + 0.35,
                  worldHalfY - localRenderPosRef.current.y,
                ],
                [
                  groundCastPreview.x - worldHalfX,
                  (groundCastPreview.isValid === false
                    ? (groundCastPreview.z ?? 0)
                    : getZoneVisualZ(groundCastPreview.x, groundCastPreview.y, groundCastPreview.z ?? 0)) + 0.35,
                  worldHalfY - groundCastPreview.y,
                ],
              ]}
              color={groundCastPreview.isValid === false ? '#ff3333' : '#ffd24a'}
              lineWidth={3}
              transparent
              opacity={0.95}
              depthTest={false}
            />
          )}
          <AoeZone
            worldX={groundCastPreview.x}
            worldY={groundCastPreview.y}
            worldZ={
              groundCastPreview.isValid === false
                ? (groundCastPreview.z ?? 0)  // On a wall: use raw hit Z, no snap
                : getZoneVisualZ(groundCastPreview.x, groundCastPreview.y, groundCastPreview.z ?? 0)
            }
            radius={groundCastPreview.radius}
            color={
              groundCastPreview.isValid === false ? '#ff3333'
              : groundCastPreview.label === '百足' ? '#b06cff'
              : '#ffd24a'
            }
            labelColor={
              groundCastPreview.isValid === false ? '#ff8888'
              : groundCastPreview.label === '百足' ? '#d8b6ff'
              : '#ffe98a'
            }
            label={groundCastPreview.label ?? "预览"}
            worldHalfX={worldHalfX}
            worldHalfY={worldHalfY}
          />
        </>
      )}

      {/* Local player AOE zone */}
      {meChanneling && (
        <AoeZone
          worldX={me.position.x}
          worldY={me.position.y}
          worldZ={(me.position.z ?? 0) + CHANNEL_RING_WAIST_Z}
          radius={meChannelRadius * storedUnitScale}
          color="#ffd700"
          worldHalfX={worldHalfX}
          worldHalfY={worldHalfY}
          followPositionRef={localRenderPosRef}
          followZOffset={CHANNEL_RING_WAIST_Z}
        />
      )}

      {/* Opponents — render all of them */}
      {opponents.map((opp, i) => {
        const disguised = hasDisguiseBuff(opp.buffs);
        const oppYumenSpectator = hasYumenSpectatorBuff(opp.buffs) || opp.yumenDefeated === true || yumenSpectatorUserIdSet.has(opp.userId);
        const hiddenByStealth = shouldHideByStealthFromEnemyView(opp.buffs) && !(meYumenSpectator && oppYumenSpectator);
        if (hiddenByStealth) return null;

        const dx = opp.position.x - me.position.x;
        const dy = opp.position.y - me.position.y;
        const dz = (opp.position.z ?? 0) - (me.position.z ?? 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / storedUnitScale;
        return (
          <group key={opp.userId}>
            {/* Opponent AOE zone */}
            {channelingOpponentId === opp.userId && (
              <AoeZone
                worldX={opp.position.x}
                worldY={opp.position.y}
                worldZ={(opp.position.z ?? 0) + CHANNEL_RING_WAIST_Z}
                radius={channelingOpponentRadius * storedUnitScale}
                color="#ff5500"
                worldHalfX={worldHalfX}
                worldHalfY={worldHalfY}
                smoothPosition
                instantSnapAtRef={opponentInstantSnapAtRef}
                instantSnapWindowMs={600}
              />
            )}
            <Character
              worldX={opp.position.x}
              worldY={opp.position.y}
              worldZ={opp.position.z ?? 0}
              color={oppYumenSpectator ? '#8c8c8c' : OPP_COLORS[i % OPP_COLORS.length]}
              emissive={oppYumenSpectator ? '#1d1d1d' : OPP_EMISSIVES[i % OPP_EMISSIVES.length]}
              hp={opp.hp}
              shield={opp.shield ?? 0}
              maxHp={opp.maxHp ?? maxHp}
              isMe={false}
              isSelected={selectedTargetId === opp.userId && !disguised}
              facing={opp.facing}
              username={opp.username ?? opp.userId}
              distance={dist}
              onSelect={disguised ? undefined : () => onSelectTarget?.(opp.userId)}
              onScreenBounds={
                i === 0 || opponentScreenBoundsRef
                  ? (bounds) => {
                      if (i === 0 && oppScreenBoundsRef) {
                        oppScreenBoundsRef.current = bounds;
                      }
                      if (opponentScreenBoundsRef) {
                        opponentScreenBoundsRef.current[opp.userId] = bounds;
                      }
                    }
                  : undefined
              }
              worldHalfX={worldHalfX}
              worldHalfY={worldHalfY}
              isStealthed={!disguised && (hasSanliuXiaBuff(opp.buffs) || oppYumenSpectator)}
              isDisguised={disguised}
              hideHpBar={disguised || hasZhuYunHideBuff(opp.buffs)}
              hideHealthMeter={oppYumenSpectator}
              nameColorOverride={oppYumenSpectator ? '#b7b7b7' : undefined}
              hpColorOverride={hasShiFangXuanJiBuff(opp.buffs) ? '#2acb6b' : undefined}
              instantSnapAtRef={opponentInstantSnapAtRef}
              instantSnapWindowMs={600}
            />
          </group>
        );
      })}

      </>}  {/* end !blueprintMode */}
      {!selfOnlyMode && isExportedMap && collisionDebugRef && showCollisionShells && (
        <CollisionProbeOverlay debugRef={collisionDebugRef} />
      )}

      {/* Player's own collision sphere (visible when Shell/Blueprint is on) */}
      {!selfOnlyMode && isExportedMap && collisionReady && (showCollisionShells || blueprintMode) && (
        <PlayerCollisionSphere posRef={localRenderPosRef} worldHalfX={worldHalfX} worldHalfY={worldHalfY} playerRadius={COLLISION_TEST_VIS_RADIUS} />
      )}
    </>
  );
}

function CollisionProbeOverlay({
  debugRef,
}: {
  debugRef: MutableRefObject<{
    enabled: boolean;
    center: { x: number; y: number; z: number };
    supportY: number | null;
  }>;
}) {
  const probeRef = useRef<THREE.Mesh>(null);
  const groundRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const debug = debugRef.current;
    if (probeRef.current) {
      probeRef.current.visible = debug.enabled;
      if (debug.enabled) {
        probeRef.current.position.set(
          debug.center.x * RENDER_SF_XZ + GROUP_POS_X,
          debug.center.y * RENDER_SF_Y + GROUP_POS_Y,
          debug.center.z * RENDER_SF_XZ + GROUP_POS_Z,
        );
      }
    }
    if (groundRef.current) {
      const visible = debug.enabled && debug.supportY !== null;
      groundRef.current.visible = visible;
      if (visible) {
        groundRef.current.position.set(
          debug.center.x * RENDER_SF_XZ + GROUP_POS_X,
          debug.supportY! * RENDER_SF_Y + GROUP_POS_Y,
          debug.center.z * RENDER_SF_XZ + GROUP_POS_Z,
        );
      }
    }
  });

  return (
    <>
      <mesh ref={probeRef} renderOrder={11} visible={false}>
        <sphereGeometry args={[COLLISION_TEST_VIS_RADIUS, 18, 14]} />
        <meshBasicMaterial color="#ff3344" wireframe transparent opacity={0.95} depthTest={false} />
      </mesh>
      <mesh ref={groundRef} renderOrder={12} visible={false}>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshBasicMaterial color="#ffd24a" transparent opacity={0.95} depthTest={false} />
      </mesh>
    </>
  );
}

/* ─── Player collision sphere wireframe ─── */
function PlayerCollisionSphere({
  posRef,
  worldHalfX,
  worldHalfY,
  playerRadius,
}: {
  posRef: MutableRefObject<{ x: number; y: number; z: number }>;
  worldHalfX: number;
  worldHalfY: number;
  playerRadius: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const p = posRef.current;
    meshRef.current.position.set(
      p.x - worldHalfX,
      (p.z ?? 0) + playerRadius,
      worldHalfY - p.y,
    );
  });

  return (
    <mesh ref={meshRef} renderOrder={10}>
      <sphereGeometry args={[playerRadius, 16, 12]} />
      <meshBasicMaterial color="#00ffff" wireframe transparent opacity={0.7} depthTest={false} />
    </mesh>
  );
}
