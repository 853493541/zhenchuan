'use client';

import { MutableRefObject, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Ground from './Ground';
import MapObjects from './MapObjects';
import Character from './Character';
import PickupBooks from './PickupBooks';
import AoeZone from './AoeZone';
import CameraRig from './CameraRig';
import type { PickupItem, GroundZone } from '../../../types';
import { getMapForMode } from '../worldMap';
import ExportedMapScene, { GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z, RENDER_SF } from './ExportedMapScene';
import type { MapCollisionSystem } from './MapCollisionSystem';

// Colors for up to 5 opponents (index 0 = primary, etc.)
const OPP_COLORS = ['#cc3333', '#cc8800', '#9933cc', '#cc3388'];
const OPP_EMISSIVES = ['#440000', '#332200', '#220044', '#330022'];

const LEGACY_STORED_UNIT_SCALE = 2.2;
const COLLISION_TEST_VIS_RADIUS = 0.384;
const CHANNEL_RING_WAIST_Z = 1.0;

function getStoredUnitScale(mode?: string): number {
  return mode === 'collision-test' ? 1 : LEGACY_STORED_UNIT_SCALE;
}

const STEALTH_BUFF_IDS = new Set([1011, 1012, 1013, 1021]);
const SANLIU_XIA_BUFF_IDS = new Set([1007, 1008]);

function hasStealthBuff(buffs?: any[]): boolean {
  if (!Array.isArray(buffs)) return false;
  return buffs.some((b: any) =>
    (b.effects ?? []).some((e: any) => e.type === 'STEALTH') ||
    STEALTH_BUFF_IDS.has(b?.buffId) ||
    (typeof b?.name === 'string' && (b.name.includes('隐身') || b.name.includes('遁影')))
  );
}

function hasSanliuXiaBuff(buffs?: any[]): boolean {
  if (!Array.isArray(buffs)) return false;
  return buffs.some((b: any) =>
    SANLIU_XIA_BUFF_IDS.has(b?.buffId) ||
    (typeof b?.name === 'string' && b.name.includes('散流霞'))
  );
}

function shouldHideByStealthFromEnemyView(buffs?: any[]): boolean {
  return hasStealthBuff(buffs) && !hasSanliuXiaBuff(buffs);
}

interface PlayerInfo {
  userId: string;
  position: { x: number; y: number; z?: number };
  hp: number;
  shield?: number;
  maxHp?: number;
  facing?: { x: number; y: number };
  buffs?: any[];
  hand?: any[];
}

interface ArenaSceneProps {
  me: PlayerInfo;
  /** All non-me players */
  opponents: PlayerInfo[];
  selectedTargetId: string | null;
  onSelectTarget?: (userId: string) => void;
  pickups: PickupItem[];
  meChanneling: boolean;
  /** Which opponent userId is channeling (if any) */
  channelingOpponentId?: string | null;
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
  }) => void;
  meFacingRef: MutableRefObject<{ x: number; y: number }>;
  maxHp: number;
  meScreenBoundsRef?: MutableRefObject<{ cx: number; topY: number; baseY: number; rs: number } | null>;
  oppScreenBoundsRef?: MutableRefObject<{ cx: number; topY: number; baseY: number; rs: number } | null>;
  mode?: string;
  safeZone?: { centerX: number; centerY: number; currentHalf: number; dps: number; shrinking: boolean; shrinkProgress: number; nextChangeIn: number };
  groundZones?: GroundZone[];
  groundCastPreview?: { x: number; y: number; radius: number; label?: string } | null;
  onGroundPointerMove?: (x: number, y: number) => void;
  onGroundPointerDown?: (x: number, y: number) => void;
  showCollisionShells?: boolean;
  collisionReady?: boolean;
  collisionSystemRef?: MutableRefObject<MapCollisionSystem | null>;
  collisionDebugRef?: MutableRefObject<{
    enabled: boolean;
    center: { x: number; y: number; z: number };
    supportY: number | null;
  }>;
  onCollisionSystemReady?: (sys: MapCollisionSystem) => void;
  /** When set, renders a red wireframe box at this AABB's world position for LOS debug. */
  losBlocker?: string | null;
  /** Hides all visual mesh/terrain; shows only the collision shell wireframe on a black canvas. */
  blueprintMode?: boolean;
  /** Whether LOS to the selected target is currently blocked (for blueprint mode LOS line). */
  losIsBlocked?: boolean;
  /** Proof callback — called once on mount with actual Three.js runtime values */
  onEnvDebug?: (info: EnvDebugInfo) => void;
  envToggles?: EnvToggles;
  dirLightConfig?: DirLightConfig;
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
 * Sets renderer properties for collision-test mode.
 * Must render FIRST in the isCollisionTest block so its useEffect fires before EnvProbe.
 */
function CollisionTestSetup({ blueprintMode, t }: { blueprintMode: boolean; t: EnvToggles }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = (!blueprintMode && t.toneMapping) ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = (!blueprintMode && t.exposure) ? 1.25 : 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = !blueprintMode && t.shadows;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
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
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
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

export default function ArenaScene({
  me,
  opponents,
  selectedTargetId,
  onSelectTarget,
  pickups,
  meChanneling,
  channelingOpponentId,
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
  mode,
  safeZone,
  groundZones,
  groundCastPreview,
  onGroundPointerMove,
  onGroundPointerDown,
  showCollisionShells,
  collisionReady = true,
  collisionSystemRef,
  collisionDebugRef,
  onCollisionSystemReady,
  losBlocker,
  blueprintMode = false,
  losIsBlocked = false,
  onEnvDebug,
  envToggles,
  dirLightConfig,
}: ArenaSceneProps) {
  const storedUnitScale = getStoredUnitScale(mode);
  const { objects: mapObjects, width: mapWidth, height: mapHeight } = getMapForMode(mode);
  const worldHalfX = mapWidth / 2;
  const worldHalfY = mapHeight / 2;
  const isArena = mode === 'arena';
  const [nowMs, setNowMs] = useState(() => Date.now());
  const zoneProbeRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const selectedTarget = selectedTargetId
    ? opponents.find((o) => o.userId === selectedTargetId && !shouldHideByStealthFromEnemyView(o.buffs))
    : null;
  const meSemiTransparent = hasStealthBuff(me?.buffs) || hasSanliuXiaBuff(me?.buffs);

  const targetLinePoints = selectedTarget
    ? [
        [
          localRenderPosRef.current.x - worldHalfX,
          (localRenderPosRef.current.z ?? 0) + 1,
          worldHalfY - localRenderPosRef.current.y,
        ],
        [
          selectedTarget.position.x - worldHalfX,
          (selectedTarget.position.z ?? 0) + 1,
          worldHalfY - selectedTarget.position.y,
        ],
      ] as [number, number, number][]
    : null;

  const handleGroundPointerMove = (e: any) => {
    if (!onGroundPointerMove) return;
    onGroundPointerMove(e.point.x + worldHalfX, worldHalfY - e.point.z);
  };

  const handleGroundPointerDown = (e: any) => {
    if (!onGroundPointerDown) return;
    onGroundPointerDown(e.point.x + worldHalfX, worldHalfY - e.point.z);
  };

  const isCollisionTest = mode === 'collision-test';

  const getZoneVisualZ = (worldX: number, worldY: number, worldZ = 0) => {
    let groundZ = 0;

    if (isCollisionTest && collisionSystemRef?.current) {
      const probe = zoneProbeRef.current;
      probe.set(
        (worldX - worldHalfX - GROUP_POS_X) / RENDER_SF,
        5000,
        (worldHalfY - worldY - GROUP_POS_Z) / RENDER_SF,
      );
      const supportY = collisionSystemRef.current.getSupportGroundY(probe);
      if (supportY !== null) {
        groundZ = supportY * RENDER_SF + GROUP_POS_Y;
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
  };

  return (
    <>
      {/* Camera */}
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
        collisionSystemRef={isCollisionTest ? collisionSystemRef : undefined}
      />

      {/* Lighting — mode-specific */}
      {isCollisionTest ? (
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

      {/* World */}
      {isCollisionTest ? (
        <ExportedMapScene
          worldWidth={mapWidth}
          worldHeight={mapHeight}
          showCollisionShells={showCollisionShells}
          blueprintMode={blueprintMode}
          onCollisionSystemReady={onCollisionSystemReady}
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
            onPointerMove={onGroundPointerMove ? handleGroundPointerMove : undefined}
            onPointerDown={onGroundPointerDown ? handleGroundPointerDown : undefined}
          />
          <MapObjects localRenderPosRef={localRenderPosRef} mapObjects={mapObjects} worldHalfX={worldHalfX} worldHalfY={worldHalfY} />
        </>
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

      {/* All game-play visuals hidden in blueprint mode */}
      {!blueprintMode && <>
      {/* Ground damage zones (e.g. 狂龙乱舞 雷云) */}
      {(groundZones ?? []).map(zone => {
        const isBaizuMarker = zone.abilityId === 'baizu_marker';
        const isShengTaiji = zone.abilityId === 'qionglong_huasheng_zone';
        const isKuanglong = zone.abilityId === 'kuang_long_luan_wu';
        const isOwn = zone.ownerUserId === me.userId;
        const color = isBaizuMarker
          ? (isOwn ? '#b06cff' : '#ff3333')
          : isShengTaiji
          ? (isOwn ? '#4488ff' : '#ff3333')
          : (isOwn ? '#4488ff' : '#ff3333');
        const baseLabel = isBaizuMarker
          ? '百足'
          : (zone.abilityName ?? '雷云');
        const showOwnTimer = isOwn && (isShengTaiji || isKuanglong);
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
            labelColor={color}
            label={label}
            worldHalfX={worldHalfX}
            worldHalfY={worldHalfY}
          />
        );
      })}

      {groundCastPreview && (
        <AoeZone
          worldX={groundCastPreview.x}
          worldY={groundCastPreview.y}
          worldZ={getZoneVisualZ(groundCastPreview.x, groundCastPreview.y, 0)}
          radius={groundCastPreview.radius}
          color={groundCastPreview.label === '百足' ? '#b06cff' : '#ffd24a'}
          labelColor={groundCastPreview.label === '百足' ? '#d8b6ff' : '#ffe98a'}
          label={groundCastPreview.label ?? "预览"}
          worldHalfX={worldHalfX}
          worldHalfY={worldHalfY}
        />
      )}

      {/* Local player AOE zone */}
      {meChanneling && (
        <AoeZone
          worldX={me.position.x}
          worldY={me.position.y}
          worldZ={(me.position.z ?? 0) + CHANNEL_RING_WAIST_Z}
          radius={10 * storedUnitScale}
          color="#ffd700"
          worldHalfX={worldHalfX}
          worldHalfY={worldHalfY}
        />
      )}

      {/* Opponents — render all of them */}
      {opponents.map((opp, i) => {
        const hiddenByStealth = shouldHideByStealthFromEnemyView(opp.buffs);
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
                radius={10 * storedUnitScale}
                color="#ff5500"
                worldHalfX={worldHalfX}
                worldHalfY={worldHalfY}
              />
            )}
            <Character
              worldX={opp.position.x}
              worldY={opp.position.y}
              worldZ={opp.position.z ?? 0}
              color={OPP_COLORS[i % OPP_COLORS.length]}
              emissive={OPP_EMISSIVES[i % OPP_EMISSIVES.length]}
              hp={opp.hp}
              shield={opp.shield ?? 0}
              maxHp={opp.maxHp ?? maxHp}
              isMe={false}
              isSelected={selectedTargetId === opp.userId}
              facing={opp.facing}
              username="恐怖花萝"
              distance={dist}
              onSelect={() => onSelectTarget?.(opp.userId)}
              onScreenBounds={i === 0 && oppScreenBoundsRef ? (b) => { oppScreenBoundsRef.current = b; } : undefined}
              worldHalfX={worldHalfX}
              worldHalfY={worldHalfY}
              isStealthed={hasSanliuXiaBuff(opp.buffs)}
            />
          </group>
        );
      })}

      {/* Local player — rendered last (on top) */}
      {(!isCollisionTest || collisionReady) && (
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
          cameraFadeEnabled={isCollisionTest}
        />
      )}
      </>}  {/* end !blueprintMode */}

      {isCollisionTest && collisionDebugRef && showCollisionShells && (
        <CollisionProbeOverlay debugRef={collisionDebugRef} />
      )}

      {/* Player's own collision sphere (visible when Shell/Blueprint is on) */}
      {isCollisionTest && collisionReady && (showCollisionShells || blueprintMode) && (
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
          debug.center.x * RENDER_SF + GROUP_POS_X,
          debug.center.y * RENDER_SF + GROUP_POS_Y,
          debug.center.z * RENDER_SF + GROUP_POS_Z,
        );
      }
    }
    if (groundRef.current) {
      const visible = debug.enabled && debug.supportY !== null;
      groundRef.current.visible = visible;
      if (visible) {
        groundRef.current.position.set(
          debug.center.x * RENDER_SF + GROUP_POS_X,
          debug.supportY! * RENDER_SF + GROUP_POS_Y,
          debug.center.z * RENDER_SF + GROUP_POS_Z,
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
