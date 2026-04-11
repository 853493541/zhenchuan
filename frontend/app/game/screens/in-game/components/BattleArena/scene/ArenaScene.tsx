'use client';

import { MutableRefObject, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
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

const COLLISION_TEST_VIS_RADIUS = 0.64; // game units — matches export-reader avatar

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
  showCollisionBoxes?: boolean;
  collisionReady?: boolean;
  collisionDebugRef?: MutableRefObject<{
    enabled: boolean;
    center: { x: number; y: number; z: number };
    supportY: number | null;
  }>;
  onCollisionSystemReady?: (sys: MapCollisionSystem) => void;
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
  showCollisionBoxes,
  collisionReady = true,
  collisionDebugRef,
  onCollisionSystemReady,
}: ArenaSceneProps) {
  const { objects: mapObjects, width: mapWidth } = getMapForMode(mode);
  const worldHalf = mapWidth / 2;
  const isArena = mode === 'arena';
  const [nowMs, setNowMs] = useState(() => Date.now());

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
          localRenderPosRef.current.x - worldHalf,
          (localRenderPosRef.current.z ?? 0) + 1,
          worldHalf - localRenderPosRef.current.y,
        ],
        [
          selectedTarget.position.x - worldHalf,
          (selectedTarget.position.z ?? 0) + 1,
          worldHalf - selectedTarget.position.y,
        ],
      ] as [number, number, number][]
    : null;

  const handleGroundPointerMove = (e: any) => {
    if (!onGroundPointerMove) return;
    onGroundPointerMove(e.point.x + worldHalf, worldHalf - e.point.z);
  };

  const handleGroundPointerDown = (e: any) => {
    if (!onGroundPointerDown) return;
    onGroundPointerDown(e.point.x + worldHalf, worldHalf - e.point.z);
  };

  const isCollisionTest = mode === 'collision-test';

  return (
    <>
      {/* Camera */}
      <CameraRig
        localRenderPosRef={localRenderPosRef}
        camYawRef={camYawRef}
        camPitchRef={camPitchRef}
        camZoomRef={camZoomRef}
        worldHalf={worldHalf}
      />

      {/* Lighting — mode-specific */}
      {isCollisionTest ? (
        <>
          {/* Lighting from environment.json + visual-settings.json (matches export-reader exactly) */}
          {/* Sun: diffuse=[0.984,0.890,0.847], dir=[0.709,0.574,-0.410], intensity=3 */}
          <directionalLight
            position={[709, 574, -410]}
            intensity={3.0}
            color="#fbe3d8"
            castShadow
          />
          {/* Ambient: ambientColor=[0.498,0.498,0.498], intensity=0.8 */}
          <ambientLight intensity={0.8} color="#7f7f7f" />
          {/* Hemisphere: skyLightColor*[0.8,0.9,1.2]=[0.398,0.448,0.598], ground=#8b7355, intensity=1 */}
          <hemisphereLight args={['#667299', '#8b7355', 1.0]} />
          {/* Fog: FogExp2 from visual-settings, density scaled for our scene (original 0.0000035 / SF) */}
          <fogExp2 attach="fog" args={['#c8b888', 0.00063]} />
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
        <ExportedMapScene worldHalf={worldHalf} showCollisionShells={showCollisionShells} showCollisionBoxes={showCollisionBoxes} onCollisionSystemReady={onCollisionSystemReady} />
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
          <MapObjects localRenderPosRef={localRenderPosRef} mapObjects={mapObjects} worldHalf={worldHalf} />
        </>
      )}
      <PickupBooks pickups={pickups} localRenderPosRef={localRenderPosRef} worldHalf={worldHalf} />

      {/* Always-visible target connection line (not blocked by structures). */}
      {targetLinePoints && (
        <Line
          points={targetLinePoints}
          color="#ffd24a"
          lineWidth={2}
          transparent
          opacity={0.9}
          depthTest={false}
        />
      )}

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
            worldZ={zone.z ?? 0}
            radius={zone.radius}
            color={color}
            labelColor={color}
            label={label}
            worldHalf={worldHalf}
          />
        );
      })}

      {groundCastPreview && (
        <AoeZone
          worldX={groundCastPreview.x}
          worldY={groundCastPreview.y}
          worldZ={0}
          radius={groundCastPreview.radius}
          color={groundCastPreview.label === '百足' ? '#b06cff' : '#ffd24a'}
          labelColor={groundCastPreview.label === '百足' ? '#d8b6ff' : '#ffe98a'}
          label={groundCastPreview.label ?? "预览"}
          worldHalf={worldHalf}
        />
      )}

      {/* Local player AOE zone */}
      {meChanneling && (
        <AoeZone
          worldX={me.position.x}
          worldY={me.position.y}
          worldZ={me.position.z ?? 0}
          radius={10}
          color="#ffd700"
          worldHalf={worldHalf}
        />
      )}

      {/* Opponents — render all of them */}
      {opponents.map((opp, i) => {
        const hiddenByStealth = shouldHideByStealthFromEnemyView(opp.buffs);
        if (hiddenByStealth) return null;

        const dx = opp.position.x - me.position.x;
        const dy = opp.position.y - me.position.y;
        const dz = (opp.position.z ?? 0) - (me.position.z ?? 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return (
          <group key={opp.userId}>
            {/* Opponent AOE zone */}
            {channelingOpponentId === opp.userId && (
              <AoeZone
                worldX={opp.position.x}
                worldY={opp.position.y}
                worldZ={opp.position.z ?? 0}
                radius={10}
                color="#ff5500"
                worldHalf={worldHalf}
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
              worldHalf={worldHalf}
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
          worldHalf={worldHalf}
          isStealthed={meSemiTransparent}
        />
      )}

      {isCollisionTest && collisionDebugRef && (showCollisionShells || showCollisionBoxes) && (
        <CollisionProbeOverlay debugRef={collisionDebugRef} />
      )}

      {/* Player's own collision sphere (visible when Shell or Box toggles are on) */}
      {isCollisionTest && collisionReady && (showCollisionShells || showCollisionBoxes) && (
        <PlayerCollisionSphere posRef={localRenderPosRef} worldHalf={worldHalf} playerRadius={COLLISION_TEST_VIS_RADIUS} />
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
  worldHalf,
  playerRadius,
}: {
  posRef: MutableRefObject<{ x: number; y: number; z: number }>;
  worldHalf: number;
  playerRadius: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const p = posRef.current;
    meshRef.current.position.set(
      p.x - worldHalf,
      (p.z ?? 0) + playerRadius,
      worldHalf - p.y,
    );
  });

  return (
    <mesh ref={meshRef} renderOrder={10}>
      <sphereGeometry args={[playerRadius, 16, 12]} />
      <meshBasicMaterial color="#00ffff" wireframe transparent opacity={0.7} depthTest={false} />
    </mesh>
  );
}
