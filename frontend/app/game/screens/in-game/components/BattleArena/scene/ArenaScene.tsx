'use client';

import { MutableRefObject } from 'react';
import Ground from './Ground';
import MapObjects from './MapObjects';
import Character from './Character';
import PickupBooks from './PickupBooks';
import AoeZone from './AoeZone';
import CameraRig from './CameraRig';
import type { PickupItem, GroundZone } from '../../../types';
import { getMapForMode } from '../worldMap';

// Colors for up to 5 opponents (index 0 = primary, etc.)
const OPP_COLORS = ['#cc3333', '#cc8800', '#9933cc', '#cc3388'];
const OPP_EMISSIVES = ['#440000', '#332200', '#220044', '#330022'];

interface PlayerInfo {
  userId: string;
  position: { x: number; y: number; z?: number };
  hp: number;
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
}: ArenaSceneProps) {
  const { objects: mapObjects, width: mapWidth } = getMapForMode(mode);
  const worldHalf = mapWidth / 2;
  const isArena = mode === 'arena';
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

      {/* Lighting — daylight for all modes */}
      <ambientLight intensity={1.0} color="#c0ddb8" />
      <directionalLight position={[300, 500, 100]} intensity={2.8} color="#e8eedc" />
      <directionalLight position={[-100, 50, -200]} intensity={0.4} color="#3d7045" />
      {!isArena && <fog attach="fog" args={['#7ab86a', 300, 1000]} />}

      {/* World */}
      <Ground arenaSize={mapWidth} isArena={isArena} safeZone={safeZone} />
      <MapObjects localRenderPosRef={localRenderPosRef} mapObjects={mapObjects} worldHalf={worldHalf} />
      <PickupBooks pickups={pickups} localRenderPosRef={localRenderPosRef} worldHalf={worldHalf} />

      {/* Ground damage zones (e.g. 狂龙乱舞 雷云) */}
      {(groundZones ?? []).map(zone => {
        const isOwn = zone.ownerUserId === me.userId;
        return (
          <AoeZone
            key={zone.id}
            worldX={zone.x}
            worldY={zone.y}
            worldZ={0}
            radius={zone.radius}
            color={isOwn ? "#4488ff" : "#ff3333"}
            labelColor={isOwn ? "#4488ff" : "#ff3333"}
            label="雷云"
            worldHalf={worldHalf}
          />
        );
      })}

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
              maxHp={maxHp}
              isMe={false}
              isSelected={selectedTargetId === opp.userId}
              facing={opp.facing}
              username="陌路侠士"
              distance={dist}
              onSelect={() => onSelectTarget?.(opp.userId)}
              onScreenBounds={i === 0 && oppScreenBoundsRef ? (b) => { oppScreenBoundsRef.current = b; } : undefined}
              worldHalf={worldHalf}
            />
          </group>
        );
      })}

      {/* Local player — rendered last (on top) */}
      <Character
        worldX={me.position.x}
        worldY={me.position.y}
        worldZ={me.position.z ?? 0}
        color="#1a66cc"
        emissive="#0a2255"
        hp={me.hp}
        maxHp={maxHp}
        isMe={true}
        isSelected={selectedSelf}
        facingRef={meFacingRef}
        posRef={localRenderPosRef}
        onScreenBounds={meScreenBoundsRef ? (b) => { meScreenBoundsRef.current = b; } : undefined}
        worldHalf={worldHalf}
      />
    </>
  );
}
