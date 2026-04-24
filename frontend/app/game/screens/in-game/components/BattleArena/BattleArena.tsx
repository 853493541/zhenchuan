'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';
import VirtualJoystick from './VirtualJoystick';
import StatusBar from '../GameBoard/components/StatusBar';
import { ChannelBar, type ChannelBarData } from './ChannelBar';
import { toastError, toastSuccess } from '@/app/components/toast/toast';
import type { ActiveBuff, ActiveChannel, PickupItem, GroundZone } from '../../types';
import ArenaScene, { type DirLightConfig, type EnvDebugInfo, type EnvToggles } from './scene/ArenaScene';
import { getMapForMode, type MapObject } from './worldMap';
import type { MapCollisionSystem } from './scene/MapCollisionSystem';
import { RENDER_SF, GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z } from './scene/ExportedMapScene';
import * as THREE from 'three';

type V3 = { x: number; y: number; z: number };
type CollisionDebugState = {
  enabled: boolean;
  center: V3;
  supportY: number | null;
};

/* ============================================================
   ARENA SETTINGS  (must match backend)
   ============================================================ */
const PUBG_WIDTH  = 2000;
const PUBG_HEIGHT = 2000;
const ARENA_WIDTH_SMALL  = 200;
const ARENA_HEIGHT_SMALL = 200;
const DASH_ANIM_MS = 1500; // ms — cosmetic dash travel animation
const CAMERA_FOV = 72;
const DEFAULT_CAMERA_ZOOM = 0.7;
const CAMERA_ZOOM_MAX = 0.7;
const CAMERA_ZOOM_OVER_MAX = 2.5;
const DEFAULT_PLAYER_RADIUS = 2; // must match backend
const COLLISION_TEST_PLAYER_RADIUS = 0.384;
const LEGACY_STORED_UNIT_SCALE = 2.2;
const SERVER_TICK_RATE = 30;
const BASE_MOVE_SPEED_PER_TICK = 0.1666667;
const AIR_SHIFT_DURATION_TICKS = SERVER_TICK_RATE;

function getStoredUnitScale(mode?: string): number {
  return mode === 'collision-test' ? 1 : LEGACY_STORED_UNIT_SCALE;
}

function getDefaultMoveSpeedPerTick(mode?: string): number {
  return BASE_MOVE_SPEED_PER_TICK * getStoredUnitScale(mode);
}

function getUpwardJumpAirShiftDistance(mode?: string): number {
  return 2 * getStoredUnitScale(mode);
}

function getDirectionalJumpDistance(mode?: string): number {
  return 6 * getStoredUnitScale(mode);
}

function normalizePlanar(x: number, y: number): { x: number; y: number } | null {
  const len = Math.sqrt(x * x + y * y);
  if (len <= 0.01) return null;
  return { x: x / len, y: y / len };
}

function worldUnitsToNewUnits(value: number, mode?: string): number {
  return value / getStoredUnitScale(mode);
}

function facingToYaw(facing: { x: number; y: number }): number {
  return Math.atan2(facing.x, -facing.y);
}

function buildTraditionalMoveIntent(
  keys: { w: boolean; a: boolean; s: boolean; d: boolean },
  mouseLook: boolean,
  bothMouse: boolean,
  camYaw: number,
  charYaw: number,
): { direction: { dx: number; dy: number } | null; backpedalOnly: boolean } {
  let dx = 0;
  let dy = 0;
  let backpedalOnly = false;

  if (mouseLook) {
    const moveFwd = { x: Math.sin(camYaw), y: -Math.cos(camYaw) };
    const moveRight = { x: Math.cos(camYaw), y: Math.sin(camYaw) };

    let forwardInput = (keys.w ? 1 : 0) + (keys.s ? -1 : 0) + (bothMouse ? 1 : 0);
    let strafeInput = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
    if (keys.a && keys.d) {
      strafeInput = -1;
      forwardInput += 1;
    }

    dx = moveFwd.x * forwardInput + moveRight.x * strafeInput;
    dy = moveFwd.y * forwardInput + moveRight.y * strafeInput;
    backpedalOnly = keys.s && !keys.w && !keys.a && !keys.d && !bothMouse;
  } else {
    const moveFwd = { x: Math.sin(charYaw), y: -Math.cos(charYaw) };
    if (keys.w) {
      dx += moveFwd.x;
      dy += moveFwd.y;
    }
    if (keys.s) {
      dx -= moveFwd.x;
      dy -= moveFwd.y;
    }
    backpedalOnly = keys.s && !keys.w && !keys.a && !keys.d;
  }

  const dir = normalizePlanar(dx, dy);
  if (!dir) return { direction: null, backpedalOnly };
  const speedMult = backpedalOnly ? 0.5 : 1.0;
  return {
    direction: { dx: dir.x * speedMult, dy: dir.y * speedMult },
    backpedalOnly,
  };
}

function estimateAirborneTicks(
  heightAboveGround: number,
  initialVz: number,
  gravityUp: number,
  gravityDown: number,
): number {
  let height = Math.max(0, heightAboveGround);
  let vz = initialVz;
  let ticks = 0;

  while (ticks < 360) {
    vz -= vz >= 0 ? gravityUp : gravityDown;
    height += vz;
    ticks += 1;
    if (height <= 0) return Math.max(1, ticks);
  }

  return 360;
}

function getTravelSpeedPerTick(distance: number, ticks: number): number {
  if (distance <= 0 || ticks <= 0) return 0;
  return distance / Math.max(1, ticks);
}

/** Resolve circle-vs-AABB collision (client-side prediction). Z-aware: skip if player is above obj. */
function resolveObjCollisionClient(
  px: number, py: number, pz: number,
  vel: { x: number; y: number },
  obj: MapObject,
  playerRadius = DEFAULT_PLAYER_RADIUS,
): { x: number; y: number } {
  if (pz >= obj.h) return { x: px, y: py }; // above rooftop
  const pr = playerRadius;
  const cx = Math.max(obj.x, Math.min(px, obj.x + obj.w));
  const cy = Math.max(obj.y, Math.min(py, obj.y + obj.d));
  const dx = px - cx;
  const dy = py - cy;
  const distSq = dx * dx + dy * dy;
  if (distSq >= pr * pr) return { x: px, y: py };
  let outX = px, outY = py;
  if (distSq < 1e-6) {
    const dL = px - obj.x;
    const dR = obj.x + obj.w - px;
    const dT = py - obj.y;
    const dB = obj.y + obj.d - py;
    const min = Math.min(dL, dR, dT, dB);
    if (min === dL)      { outX = obj.x - pr;           vel.x = Math.min(0, vel.x); }
    else if (min === dR) { outX = obj.x + obj.w + pr;   vel.x = Math.max(0, vel.x); }
    else if (min === dT) { outY = obj.y - pr;           vel.y = Math.min(0, vel.y); }
    else                 { outY = obj.y + obj.d + pr;   vel.y = Math.max(0, vel.y); }
  } else {
    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    const pen = pr - dist;
    outX += nx * pen;
    outY += ny * pen;
    const dot = vel.x * nx + vel.y * ny;
    if (dot < 0) { vel.x -= dot * nx; vel.y -= dot * ny; }
  }
  return { x: outX, y: outY };
}

/** Get ground height at XY (tallest object the player overlaps and is above). */
function getGroundHeightClient(px: number, py: number, pz: number, objects: MapObject[], playerRadius = DEFAULT_PLAYER_RADIUS): number {
  let ground = 0;
  for (const obj of objects) {
    if (pz < obj.h - 0.1) continue; // player is below this object's top
    const cx = Math.max(obj.x, Math.min(px, obj.x + obj.w));
    const cy = Math.max(obj.y, Math.min(py, obj.y + obj.d));
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy < playerRadius * playerRadius && obj.h > ground) {
      ground = obj.h;
    }
  }
  return ground;
}

/* ─── BVH collision scratch objects (reused to avoid GC pressure) ─── */
const _bvhCenter   = new THREE.Vector3();
const _bvhVelocity = new THREE.Vector3();
// Cylinder collision shape: horizontal radius + half-height tracked separately.
// _bvhCenter.y is always the CYLINDER CENTRE (feet + half-height), never sphere-bottom.
const EXPORT_CYL_RADIUS      = COLLISION_TEST_PLAYER_RADIUS / RENDER_SF;
const CYL_HALF_HEIGHT_GAME   = 0.75;                                      // game units (total height = 1.5)
const EXPORT_CYL_HALF_HEIGHT = CYL_HALF_HEIGHT_GAME / RENDER_SF;
const BVH_STEP_UP_EXPORT     = 56;                                         // max step-up in export units

function getBvhGroundProbeOriginY(centerY: number): number {
  return centerY - EXPORT_CYL_HALF_HEIGHT + BVH_STEP_UP_EXPORT;
}

function getBvhGroundSupportY(sys: MapCollisionSystem, center: THREE.Vector3): number | null {
  return sys.getSupportGroundY(center, getBvhGroundProbeOriginY(center.y));
}

function getBvhCeilingY(sys: MapCollisionSystem, center: THREE.Vector3): number | null {
  return sys.getCeilingY(center, center.y);
}

/* --- LOS BVH scratch (avoid GC in render loop) --- */
const _losFrom = new THREE.Vector3();
const _losTo   = new THREE.Vector3();
const LOS_EYE_HEIGHT_GAME = 1.5; // eye height above feet in game units

/**
 * Convert a game-space position to BVH export-unit space at eye height,
 * then check BVH LOS between caster and target.
 * Returns true = LOS is blocked.
 */
function clientCheckLOS(
  sys: import('./scene/MapCollisionSystem').MapCollisionSystem,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  halfW: number, halfH: number,
): boolean {
  if (!sys.shellBVH) return false;
  const sf = RENDER_SF;
  const gx = GROUP_POS_X, gy = GROUP_POS_Y, gz = GROUP_POS_Z;
  _losFrom.set(
    (ax - halfW - gx) / sf,
    (az + LOS_EYE_HEIGHT_GAME - gy) / sf,
    (halfH - ay - gz) / sf,
  );
  _losTo.set(
    (bx - halfW - gx) / sf,
    (bz + LOS_EYE_HEIGHT_GAME - gy) / sf,
    (halfH - by - gz) / sf,
  );
  return sys.checkLOS(_losFrom, _losTo, EXPORT_CYL_RADIUS);
}

/** Live position + height display — reads refs every 200ms.
 *  Shows:  X / Y world coords,  "↑ Xm" above-ground (new units),  "floor Xm" floor elevation (new units).
 */
function PositionDisplay({
  posRef,
  groundHRef,
  unitScale = LEGACY_STORED_UNIT_SCALE,
  inline = false,
}: {
  posRef: React.MutableRefObject<{ x: number; y: number; z: number }>;
  groundHRef?: React.MutableRefObject<number>;
  unitScale?: number;
  inline?: boolean;
}) {
  const [pos, setPos] = React.useState({ x: 0, y: 0, z: 0, groundH: 0 });
  React.useEffect(() => {
    const id = setInterval(() => {
      const p = posRef.current;
      const g = groundHRef?.current ?? 0;
      setPos({ x: p.x, y: p.y, z: p.z, groundH: g });
    }, 200);
    return () => clearInterval(id);
  }, [posRef, groundHRef]);
  const aboveGround = (pos.z - pos.groundH) / unitScale;
  const floorElev   = pos.groundH / unitScale;
  return (
    <div style={{
      ...(inline
        ? {
            background: 'rgba(255,255,255,0.04)',
            color: '#86efac',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            lineHeight: 1.6,
          }
        : {
            position: 'absolute', top: 14, left: 14, zIndex: 500,
            background: 'rgba(0,0,0,0.7)', color: '#0f0', fontFamily: 'monospace',
            fontSize: 12, padding: '4px 8px', borderRadius: 4, pointerEvents: 'none',
            lineHeight: 1.5,
          }),
    }}>
      <div>X:{pos.x.toFixed(1)} Y:{pos.y.toFixed(1)}</div>
      <div>↑ {aboveGround.toFixed(2)} u  (above ground)</div>
      <div>floor {floorElev.toFixed(2)} u  (elevation)</div>
    </div>
  );
}

/** Golden 3D line between two world-coord pins — rendered inside the R3F Canvas. */
function MeasureLine3D({
  pinA,
  pinB,
  halfX,
  halfY,
}: {
  pinA: { x: number; y: number; z: number } | null;
  pinB: { x: number; y: number; z: number } | null;
  halfX: number;
  halfY: number;
}) {
  const geoRef  = React.useRef(new THREE.BufferGeometry());
  const matRef  = React.useRef(new THREE.LineBasicMaterial({ color: '#FFD700' }));
  const lineObj = React.useRef(new THREE.Line(geoRef.current, matRef.current));
  React.useEffect(() => {
    return () => { geoRef.current.dispose(); matRef.current.dispose(); };
  }, []);
  React.useEffect(() => {
    if (!pinA || !pinB) return;
    const ax = pinA.x - halfX, ay = (pinA.z ?? 0) + 0.3, az = halfY - pinA.y;
    const bx = pinB.x - halfX, by = (pinB.z ?? 0) + 0.3, bz = halfY - pinB.y;
    geoRef.current.setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
    geoRef.current.computeBoundingSphere();
  }, [pinA, pinB, halfX, halfY]);
  return <primitive object={lineObj.current} visible={!!(pinA && pinB)} />;
}

/** 2D segment vs AABB intersection (for line-of-sight checks). */
function segmentIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) < 1e-8) { if (x1 < minX || x1 > maxX) return false; }
  else {
    let t1 = (minX - x1) / dx, t2 = (maxX - x1) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dy) < 1e-8) { if (y1 < minY || y1 > maxY) return false; }
  else {
    let t1 = (minY - y1) / dy, t2 = (maxY - y1) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Check if LOS between two positions is blocked by any map object.
 *  Returns the first blocking MapObject, or null if clear.
 *  minBlockH: objects shorter than this are ignored.
 *  casterZ / targetZ: feet heights; EYE_HEIGHT is added for eye-level check.
 */
const LOS_EYE_HEIGHT = 1.5; // game units above player feet
function isLOSBlockedClient(
  ax: number, ay: number, bx: number, by: number, objects: MapObject[],
  minBlockH: number = 0,
  casterZ: number = 0,
  targetZ: number = 0,
): MapObject | null {
  const casterEye = casterZ + LOS_EYE_HEIGHT;
  const targetEye = targetZ + LOS_EYE_HEIGHT;
  for (const obj of objects) {
    if (obj.h < minBlockH) continue;
    if (obj.h <= Math.min(casterEye, targetEye)) continue;
    if (segmentIntersectsAABB(ax, ay, bx, by, obj.x - 0.5, obj.y - 0.5, obj.x + obj.w + 0.5, obj.y + obj.d + 0.5)) return obj;
  }
  return null;
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function facingArrow(facing: { x: number; y: number } | undefined): string {
  if (!facing) return '·';
  const len = Math.sqrt(facing.x * facing.x + facing.y * facing.y);
  if (len < 0.05) return '·';
  const angle = Math.atan2(facing.y / len, facing.x / len);
  const idx = Math.round(angle / (Math.PI / 4));
  const dirs = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  return dirs[((idx % 8) + 8) % 8];
}

const STEALTH_BUFF_IDS = new Set([1011, 1012, 1013, 1021]);
const UNTARGETABLE_BUFF_IDS = new Set([1008]);
const SANLIU_XIA_BUFF_IDS = new Set([1007, 1008]);

function buffHasEffect(buff: ActiveBuff | any, type: string): boolean {
  return Array.isArray(buff?.effects) && buff.effects.some((e: any) => e?.type === type);
}

function buffNameIncludes(buff: ActiveBuff | any, token: string): boolean {
  return typeof buff?.name === 'string' && buff.name.includes(token);
}

function hasStealthClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'STEALTH') ||
    STEALTH_BUFF_IDS.has(b.buffId) ||
    buffNameIncludes(b, '隐身') ||
    buffNameIncludes(b, '遁影')
  );
}

function hasSanliuXiaClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => SANLIU_XIA_BUFF_IDS.has(b.buffId) || buffNameIncludes(b, '散流霞'));
}

function shouldHideOpponentByStealth(buffs?: ActiveBuff[]): boolean {
  return hasStealthClient(buffs) && !hasSanliuXiaClient(buffs);
}

function blocksTargetingClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'STEALTH') ||
    buffHasEffect(b, 'UNTARGETABLE') ||
    STEALTH_BUFF_IDS.has(b.buffId) ||
    UNTARGETABLE_BUFF_IDS.has(b.buffId) ||
    buffNameIncludes(b, '隐身') ||
    buffNameIncludes(b, '遁影') ||
    buffNameIncludes(b, '不可选中')
  );
}

function hasQinggongSealClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'DISPLACEMENT') ||
    buffHasEffect(b, 'QINGGONG_SEAL') ||
    buffNameIncludes(b, '封轻功')
  );
}

function hasSilenceClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'SILENCE') || buffNameIncludes(b, '沉默'));
}

function hasDisplacementClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'DISPLACEMENT'));
}

function hasDashTurnOverrideClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'DASH_TURN_OVERRIDE'));
}

function buffsHaveAnyEffect(buffs: ActiveBuff[] | undefined, effectTypes: string[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => effectTypes.some((effectType) => buffHasEffect(b, effectType)));
}

function requiresFacingByDefault(ability?: { target?: 'SELF' | 'OPPONENT'; faceDirection?: boolean } | null): boolean {
  if (!ability) return false;
  if (ability.target === 'OPPONENT') return ability.faceDirection !== false;
  return ability.faceDirection === true;
}

function computeHpShieldSegments(
  hp: number | undefined,
  shield: number | undefined,
  maxHp: number | undefined,
): { hpPct: number; shieldPct: number } {
  const safeMaxHp = Math.max(1, Number(maxHp ?? 100));
  const safeHp = Math.max(0, Number(hp ?? 0));
  const safeShield = Math.max(0, Number(shield ?? 0));
  const total = safeHp + safeShield;

  if (total <= 0) {
    return { hpPct: 0, shieldPct: 0 };
  }

  if (total <= safeMaxHp) {
    return {
      hpPct: Math.max(0, Math.min(100, (safeHp / safeMaxHp) * 100)),
      shieldPct: Math.max(0, Math.min(100, (safeShield / safeMaxHp) * 100)),
    };
  }

  return {
    hpPct: Math.max(0, Math.min(100, (safeHp / total) * 100)),
    shieldPct: Math.max(0, Math.min(100, (safeShield / total) * 100)),
  };
}

// Fixed camera direction constant — referenced in physics tick
const CAM_DIR = { x: 0, y: 1 };
const DEFAULT_PITCH = Math.atan2(10, 20);
const DEFAULT_MIN_CAMERA_PITCH = 0.08;
const COLLISION_TEST_MIN_CAMERA_PITCH = -1.05;
const MAX_CAMERA_PITCH = Math.PI * 0.47;

function clampCameraPitch(pitch: number, mode?: string): number {
  const minPitch = mode === 'collision-test' ? COLLISION_TEST_MIN_CAMERA_PITCH : DEFAULT_MIN_CAMERA_PITCH;
  return Math.max(minPitch, Math.min(MAX_CAMERA_PITCH, pitch));
}

/* ============================================================
   TYPES
   ============================================================ */
interface Position { x: number; y: number; z?: number; }
interface Facing { x: number; y: number; }

interface AbilityInfo {
  id: string;        // instanceId (or abilityId fallback for common)
  abilityId: string;    // always the plain ability id (e.g. 'fuyao_zhishang')
  name: string;
  range?: number;
  minRange?: number;
  cooldown: number;
  maxCooldown: number;
  chargeCount?: number;
  maxCharges?: number;
  chargeRegenTicksRemaining?: number;
  chargeRegenProgress?: number;
  chargeRecoveryTicks?: number;
  chargeLockTicks?: number;
  chargeCastLockTicks?: number;
  isReady: boolean;
  isCommon: boolean;
  target: 'SELF' | 'OPPONENT';
  faceDirection?: boolean;
  requiresGrounded?: boolean;
  requiresStanding?: boolean;
  minSelfHpExclusive?: number;
  qinggong?: boolean;
  cannotCastWhileRooted?: boolean;
  allowGroundCastWithoutTarget?: boolean;
  losBlocked?: boolean;
}

type CameraDebugEntry = {
  id: number;
  ts: number;
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
};

/** Fixed display order for the common-ability bar. */
const COMMON_ABILITY_ORDER = [
  'menghu_xiasha',
  'fuyao_zhishang',
  'nieyun_zhuyue',
  'lingxiao_lansheng',
  'yaotai_zhenhe',
  'yingfeng_huilang',
  'houyao',
  'yuqi',
] as const;

interface BattleArenaProps {
  me: { userId: string; position: Position; hp: number; maxHp?: number; shield?: number; hand: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel };
  opponent: { userId: string; position: Position; hp: number; maxHp?: number; shield?: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing };
  /** All other players (opponents) — supports 1v1 and N-player modes */
  opponents?: { userId: string; position: Position; hp: number; maxHp?: number; shield?: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing }[];
  gameId: string;
  onCastAbility: (
    abilityInstanceId: string,
    targetUserId?: string,
    groundTarget?: { x: number; y: number; z?: number },
  ) => Promise<void>;
  distance: number;
  maxHp: number;
  abilities: Record<string, any>;
  opponentPositionBufferRef?: React.MutableRefObject<Map<string, Array<{ t: number; pos: Position }>>>;
  /** Full game events array from state — used to spawn per-event floating numbers */
  events?: any[];
  /** Pickup items (ability books) currently on the ground */
  pickups?: PickupItem[];
  /** Safe zone state for poison zone rendering */
  safeZone?: { centerX: number; centerY: number; currentHalf: number; dps: number; shrinking: boolean; shrinkProgress: number; nextChangeIn: number };
  /** Persistent ground damage zones */
  groundZones?: GroundZone[];
  /** Game mode: 'arena' (100×100) or 'pubg' (2000×2000) */
  mode?: string;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export default function BattleArena({
  me,
  opponent,
  opponents,
  gameId,
  onCastAbility,
  distance,
  maxHp,
  abilities,
  opponentPositionBufferRef,
  events = [],
  pickups = [],
  safeZone,
  groundZones,
  mode,
}: BattleArenaProps) {
  const mapData = useMemo(() => getMapForMode(mode), [mode]);
  const ARENA_WIDTH  = mode === 'arena' ? ARENA_WIDTH_SMALL  : mode === 'collision-test' ? mapData.width : PUBG_WIDTH;
  const ARENA_HEIGHT = mode === 'arena' ? ARENA_HEIGHT_SMALL : mode === 'collision-test' ? mapData.height : PUBG_HEIGHT;
  const playerRadius = mode === 'collision-test' ? COLLISION_TEST_PLAYER_RADIUS : DEFAULT_PLAYER_RADIUS;
  const storedUnitScale = getStoredUnitScale(mode);
  const modePickups = useMemo(() => (mode === 'collision-test' ? [] : pickups), [mode, pickups]);
  const mapObjectsRef = useRef(mapData.objects);
  useEffect(() => {
    mapObjectsRef.current = mapData.objects;
  }, [mapData]);
  // CODE FRESHNESS MARKER — if you see this in console, the new code IS running
  useEffect(() => { console.log('[BA-FRESH] BattleArena v2 loaded — activeDash support active'); }, []);
  // Prevent page scroll while the game is mounted (critical for touch devices)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const wrapRef        = useRef<HTMLDivElement>(null);
  const canvasSizeRef  = useRef({ w: 800, h: 500 });

  useEffect(() => {
    const updateCanvasSize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvasSizeRef.current = { w: rect.width, h: rect.height };
      }
    };

    updateCanvasSize();
    const ro = new ResizeObserver(updateCanvasSize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', updateCanvasSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  const opponentsList = useMemo(
    () => ((opponents && opponents.length > 0 ? opponents : [opponent]).filter(Boolean)),
    [opponents, opponent],
  );
  const visibleOpponentsList = useMemo(
    () => opponentsList.filter((o) => !shouldHideOpponentByStealth(o?.buffs)),
    [opponentsList],
  );
  const targetableOpponentsList = useMemo(
    () => opponentsList.filter((o) => !blocksTargetingClient(o?.buffs)),
    [opponentsList],
  );

  /* --- React state (UI only) --- */
  const [handAbilities,    setHandAbilities]    = useState<AbilityInfo[]>([]);
  const [rtt,              setRtt]              = useState<number | null>(null);
  const [wasdKeys,         setWasdKeys]         = useState({ w: false, a: false, s: false, d: false });
  const [controlMode,      setControlMode]      = useState<'joystick' | 'traditional'>('traditional');
  // Mobile detection: touch device without fine pointer (mouse) = phone/tablet
  const [isMobileDevice, setIsMobileDevice]    = useState(false);
  const [showCollisionControlPanel, setShowCollisionControlPanel] = useState(false);
  const [showScreenCoordPanel, setShowScreenCoordPanel] = useState(false);
  const [showCheatWindow,  setShowCheatWindow]  = useState(false);
  const [cheatRarityFilter, setCheatRarityFilter] = useState<string>('all');
  const [cheatSchoolFilter, setCheatSchoolFilter] = useState<string>('all');
  const [cheatSchoolOpen,   setCheatSchoolOpen]   = useState(false);
  const cheatSchoolRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cheatSchoolOpen) return;
    const h = (e: MouseEvent) => {
      if (cheatSchoolRef.current && !cheatSchoolRef.current.contains(e.target as Node)) setCheatSchoolOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [cheatSchoolOpen]);
  const [addingAbility,    setAddingAbility]    = useState<string | null>(null);
  const [runningCheatAction, setRunningCheatAction] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedSelf,     setSelectedSelf]     = useState(false);
  const [pendingGroundCastAbilityId, setPendingGroundCastAbilityId] = useState<string | null>(null);
  const [groundCastPreview, setGroundCastPreview] = useState<{ x: number; y: number; z?: number; isValid?: boolean } | null>(null);
  const [autoForward, setAutoForward] = useState(false);
  const [draggingDraftInstanceId, setDraggingDraftInstanceId] = useState<string | null>(null);
  const [dragHoverIndex, setDragHoverIndex] = useState<number | null>(null);
  const [discardZoneHover, setDiscardZoneHover] = useState(false);
  const [, ] = useState(0); // placeholder (was setChannelTick)

  /* --- Pickup interaction state --- */
  const [nearbyPickupIds,   setNearbyPickupIds]   = useState<string[]>([]);         // sorted closest-first
  const [channelPickupId,   setChannelPickupId]   = useState<string | null>(null); // book being channeled
  const [channelProgress,   setChannelProgress]   = useState(0);                  // 0-1
  const [pickupModals,      setPickupModals]      = useState<Array<{ pickupId: string; abilityId: string; name: string; description: string }>>([]);
  const channelTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelStartRef     = useRef<number>(0);
  const channelAnimRef      = useRef<number>(0);
  const pickupsRef          = useRef<PickupItem[]>([]);
  const nearbyPickupIdsRef  = useRef<string[]>([]);  // synced from state; used in callbacks
  const pickupModalsRef     = useRef<Array<{ pickupId: string; abilityId: string; name: string; description: string }>>([]);
  const channelPickupIdRef  = useRef<string | null>(null);
  const [minimizedModals,   setMinimizedModals]   = useState<Set<string>>(new Set());

  /* --- Draggable UI positions (persisted to localStorage) --- */
  const [uiPositions, setUiPositions] = useState<Record<string, { left: number; top: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('zhenchuan-ui-positions') ?? '{}'); } catch { return {}; }
  });
  const uiPositionsRef = useRef<Record<string, { left: number; top: number }>>({});

  /* --- Debug position overlay --- */
  const [showDebugGrid, setShowDebugGrid] = useState(false);
  const [showCollisionShells, setShowCollisionShells] = useState(false);
  const [showCollisionBoxes, setShowCollisionBoxes] = useState(false);
  const [blueprintMode, setBlueprintMode] = useState(false);
  const [showTestingPanel, setShowTestingPanel] = useState(false);
  const [showEnvTestingPanel, setShowEnvTestingPanel] = useState(false);
  const [showSceneTestingPanel, setShowSceneTestingPanel] = useState(false);
  const [showCameraEventTestingPanel, setShowCameraEventTestingPanel] = useState(false);
  const [showMeasurePanel, setShowMeasurePanel] = useState(false);
  const [showJumpDetailsPanel, setShowJumpDetailsPanel] = useState(false);
  const [showGroundDistanceDetail, setShowGroundDistanceDetail] = useState(false);
  const [losBlocker, setLosBlocker] = useState<string | null>(null);
  const [envDebugInfo, setEnvDebugInfo] = useState<EnvDebugInfo | null>(null);
  const [envToggles, setEnvToggles] = useState<EnvToggles>({
    toneMapping: true, exposure: true, shadows: true,
    dirLight: true, ambLight: true, hemiLight: true,
    fog: true, skyDome: true, cameraFar: true,
  });
  const [dirLightConfig, setDirLightConfig] = useState<DirLightConfig>({
    intensity: 0.25,
    colorMode: 'export',
    customColor: '#fdf2ed',
  });
  const [cameraZoomLevel, setCameraZoomLevel] = useState(DEFAULT_CAMERA_ZOOM);
  const [allowOverrangeCameraZoom, setAllowOverrangeCameraZoom] = useState(false);
  const [cameraDebugEntries, setCameraDebugEntries] = useState<CameraDebugEntry[]>([]);
  const cameraDebugIdRef = useRef(0);
  const cameraEventTestingEnabledRef = useRef(false);
  const losBlockerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLOSBlocker = useCallback((msg: string) => {
    setLosBlocker(msg);
    if (losBlockerTimerRef.current) clearTimeout(losBlockerTimerRef.current);
    losBlockerTimerRef.current = setTimeout(() => setLosBlocker(null), 3000);
  }, []);
  const clearCameraDebugEntries = useCallback(() => {
    cameraDebugIdRef.current = 0;
    setCameraDebugEntries(prev => (prev.length === 0 ? prev : []));
  }, []);
  const appendCameraDebugEntry = useCallback((entry: Omit<CameraDebugEntry, 'id' | 'ts'>) => {
    if (!cameraEventTestingEnabledRef.current) return;
    setCameraDebugEntries(prev => {
      const nextId = cameraDebugIdRef.current + 1;
      cameraDebugIdRef.current = nextId;
      const next = [...prev, { ...entry, id: nextId, ts: Date.now() }];
      return next.slice(-180);
    });
  }, []);
  useEffect(() => {
    cameraEventTestingEnabledRef.current = showCameraEventTestingPanel;
    if (!showCameraEventTestingPanel) {
      clearCameraDebugEntries();
    }
  }, [clearCameraDebugEntries, showCameraEventTestingPanel]);
  const formatCameraDebugEntry = useCallback((entry: CameraDebugEntry) => {
    const time = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
    const millis = String(entry.ts % 1000).padStart(3, '0');
    const flags = [
      entry.wallClamp ? 'wall' : null,
      entry.probeClamp ? 'probe' : null,
      entry.groundClamp ? 'ground' : null,
      entry.recenter ? 'recenter' : null,
    ].filter(Boolean).join('/');
    const wallLine = entry.wallDebug
      ? `wall hits=${entry.wallDebug.hitCount}/${entry.wallDebug.sampleCount} mask=${entry.wallDebug.hitMask || '-'} ` +
        `span=${entry.wallDebug.spanX.toFixed(2)}x${entry.wallDebug.spanY.toFixed(2)} ` +
        `range=${entry.wallDebug.minDistance === null ? '-' : `${entry.wallDebug.minDistance.toFixed(2)}..${entry.wallDebug.maxDistance?.toFixed(2) ?? entry.wallDebug.minDistance.toFixed(2)}`} ` +
        `raw=${entry.wallDebug.rawDistance === null ? '-' : entry.wallDebug.rawDistance.toFixed(2)} ` +
        `keep=${entry.wallDebug.retainedDistance === null ? '-' : entry.wallDebug.retainedDistance.toFixed(2)} ` +
        `clear=${entry.wallDebug.clearMs}ms ` +
        `pending=${entry.wallDebug.pendingExpandDistance === null ? '-' : `${entry.wallDebug.pendingExpandDistance.toFixed(2)}@${entry.wallDebug.pendingExpandMs}ms`}`
      : null;
    const probeLine = entry.probeDebug
      ? `probe hits=${entry.probeDebug.hitCount}/${entry.probeDebug.sampleCount} mask=${entry.probeDebug.hitMask || '-'} ` +
        `range=${entry.probeDebug.minDistance === null ? '-' : `${entry.probeDebug.minDistance.toFixed(2)}..${entry.probeDebug.maxDistance?.toFixed(2) ?? entry.probeDebug.minDistance.toFixed(2)}`} ` +
        `raw=${entry.probeDebug.rawDistance === null ? '-' : entry.probeDebug.rawDistance.toFixed(2)} ` +
        `keep=${entry.probeDebug.retainedDistance === null ? '-' : entry.probeDebug.retainedDistance.toFixed(2)}`
      : null;

    return [
      `[${time}.${millis}] ${entry.type} ${entry.message}`,
      `cam(${entry.camera.x.toFixed(2)}, ${entry.camera.y.toFixed(2)}, ${entry.camera.z.toFixed(2)}) ` +
        `look(${entry.lookTarget.x.toFixed(2)}, ${entry.lookTarget.y.toFixed(2)}, ${entry.lookTarget.z.toFixed(2)}) ` +
        `pivot(${entry.pivot.x.toFixed(2)}, ${entry.pivot.y.toFixed(2)}, ${entry.pivot.z.toFixed(2)})`,
      `yaw=${entry.yaw.toFixed(2)} pitch=${entry.pitch.toFixed(2)} zoom=${entry.zoom.toFixed(2)} ` +
        `dist=${entry.actualDistance.toFixed(2)}/${entry.desiredDistance.toFixed(2)}${flags ? ` flags=${flags}` : ''}`,
      wallLine,
      probeLine,
    ].filter(Boolean).join('\n');
  }, []);
  const copyCameraDebugEntries = useCallback(async () => {
    if (cameraDebugEntries.length === 0) {
      toastError('没有可复制的镜头日志');
      return;
    }

    try {
      await navigator.clipboard.writeText(cameraDebugEntries.map(formatCameraDebugEntry).join('\n\n'));
      toastSuccess(`已复制 ${cameraDebugEntries.length} 条镜头日志`);
    } catch {
      toastError('复制镜头日志失败');
    }
  }, [cameraDebugEntries, formatCameraDebugEntry]);
  const collisionSysRef = useRef<MapCollisionSystem | null>(null);
  const collisionReadyRef = useRef(mode !== 'collision-test');
  const [collisionReady, setCollisionReady] = useState(mode !== 'collision-test');
  const collisionDebugRef = useRef<CollisionDebugState>({
    enabled: false,
    center: { x: 0, y: 0, z: 0 },
    supportY: null,
  });
  useEffect(() => {
    collisionSysRef.current = null;
    collisionReadyRef.current = mode !== 'collision-test';
    setCollisionReady(mode !== 'collision-test');
    collisionDebugRef.current = {
      enabled: false,
      center: { x: 0, y: 0, z: 0 },
      supportY: null,
    };
  }, [mode]);
  const onCollisionSystemReady = useCallback((sys: MapCollisionSystem) => {
    collisionSysRef.current = sys;
    const pos = localPositionRef.current ?? { x: mapData.width / 2, y: mapData.height / 2 };
    const halfW = mapData.width / 2;
    const halfH = mapData.height / 2;
    const tmpCenter = new THREE.Vector3(
      (pos.x - halfW - GROUP_POS_X) / RENDER_SF,
      5000,
      (halfH - pos.y - GROUP_POS_Z) / RENDER_SF,
    );
    const groundY = getBvhGroundSupportY(sys, tmpCenter);
    collisionDebugRef.current = {
      enabled: true,
      center: { x: tmpCenter.x, y: tmpCenter.y, z: tmpCenter.z },
      supportY: groundY,
    };
    if (groundY !== null) {
      const feetGameZ = groundY * RENDER_SF + GROUP_POS_Y;
      localZRef.current = feetGameZ;
      localVzRef.current = 0;
      groundBaseRef.current = feetGameZ;
      localRenderPosRef.current = { x: pos.x, y: pos.y, z: feetGameZ };
      console.log('[BVH] Initial ground at export Y', groundY.toFixed(1), '→ game Z', feetGameZ.toFixed(3));
    } else {
      console.warn('[BVH] No ground found at spawn, using Z=0');
    }
    bvhCenterYInitRef.current = false; // force sphere center resync on first tick
    collisionReadyRef.current = true;
    setCollisionReady(true);
    console.log('[BVH] Collision system ready');
  }, [mapData.height, mapData.width]);
  const [debugCursor,   setDebugCursor]   = useState<{ x: number; y: number } | null>(null);
  const [debugBounds,   setDebugBounds]   = useState<{
    me:  { cx: number; topY: number; hpBarY: number } | null;
    opp: { cx: number; topY: number } | null;
    cw: number; ch: number;
  }>({ me: null, opp: null, cw: 800, ch: 500 });

  /* --- Height-above-ground display + jump timing --- */
  const [myZ, setMyZ] = useState(0);
  const myZRef = useRef(0);
  // Jump timing records (seconds, null = not yet measured)
  type JumpRecord = {
    riseMs: number | null;
    fallMs: number | null;
    totalMs: number | null;
    peakUnits: number | null;
    startSpeedUnitsPerSec: number | null;
    expectedLandUnits: number | null;
    actualLandUnits: number | null;
    jumpPhase: number | null;
    mode: 'directional' | 'upward' | null;
  };
  type JumpTelemetry = {
    startMs: number;
    peakMs: number;
    takeoffGround: number;
    peakHeightWorld: number;
    takeoffPos: { x: number; y: number };
    expectedLandWorld: number;
    startSpeedUnitsPerSec: number;
    jumpPhase: number;
    mode: 'directional' | 'upward';
  };
  const [jumpRecord, setJumpRecord] = useState<JumpRecord>({
    riseMs: null,
    fallMs: null,
    totalMs: null,
    peakUnits: null,
    startSpeedUnitsPerSec: null,
    expectedLandUnits: null,
    actualLandUnits: null,
    jumpPhase: null,
    mode: null,
  });
  // Internal tracking refs (updated every rAF frame)
  const jumpPhaseRef  = useRef<'ground' | 'rising' | 'falling'>('ground');
  const takeoffTimeRef = useRef<number>(0);   // when feet left the ground
  const takeoffGroundRef = useRef<number>(0); // floor height under feet at takeoff
  const peakTimeRef    = useRef<number>(0);   // when apex was detected
  const prevAboveGroundRef = useRef<number>(0); // previous frame height above current floor
  const peakHeightRef  = useRef<number>(0);   // max jump height above takeoff floor (world units)

  /* --- Floating damage/heal numbers --- */
  type FloatType = 'dmg_dealt' | 'dmg_taken' | 'heal';
  type FloatEntry = { id: number; value: number; type: FloatType; startTime: number; label?: string; screenPct?: { x: number; y: number }; yOffset: number };
  const [floats, setFloats] = useState<FloatEntry[]>([]);
  const floatIdRef = useRef(0);
  const lastCastNameRef = useRef<string | null>(null);
  // Per-type stagger counter — increments each time a float of a given type
  // is spawned, so simultaneous hits don’t visually overlap.
  const floatTypeCountRef = useRef<Record<string, number>>({});
  // Track how many events we've already processed to avoid re-processing on re-render
  const prevEventsLenRef = useRef<number>(-1);
  const addFloat = (value: number, type: FloatType, opts?: { label?: string; screenPct?: { x: number; y: number } }) => {
    if (value <= 0) return;
    const id = ++floatIdRef.current;
    const safeScreenPct =
      opts?.screenPct && Number.isFinite(opts.screenPct.x) && Number.isFinite(opts.screenPct.y)
        ? {
            x: Math.max(0, Math.min(1, opts.screenPct.x)),
            y: Math.max(0, Math.min(1, opts.screenPct.y)),
          }
        : undefined;
    // Stagger: count how many same-type floats are currently alive to offset them
    const stagger = floatTypeCountRef.current[type] ?? 0;
    floatTypeCountRef.current[type] = stagger + 1;
    const yOffset = stagger * 28; // 28px per simultaneous float of the same type
    setFloats(f => [...f, { id, value, type, startTime: Date.now(), label: opts?.label, screenPct: safeScreenPct, yOffset }]);
    setTimeout(() => {
      setFloats(f => f.filter(e => e.id !== id));
      floatTypeCountRef.current[type] = Math.max(0, (floatTypeCountRef.current[type] ?? 1) - 1);
    }, 1400);
  };

  // Split abilities into two rows for rendering
  const commonAbilities = handAbilities.filter(a => a.isCommon);
  const draftAbilities  = handAbilities.filter(a => !a.isCommon);

  /* --- Game logic refs --- */
  const keysRef          = useRef({ w: false, a: false, s: false, d: false });
  const joystickDirRef   = useRef<{ dx: number; dy: number } | null>(null); // analog joystick
  const autoForwardRef   = useRef(false);

  // Ground height under player — updated every physics tick for height display.
  const groundHRef = useRef(0);
  // First stable ground height — relative-elevation baseline (0 = flat starting ground)
  const groundBaseRef = useRef<number | null>(null);
  // Height display state: updated every 50ms
  const [heightDisplay, setHeightDisplay] = React.useState({ aboveGround: 0, floorElev: 0 });
  const [speedTestState, setSpeedTestState] = React.useState({
    active: false,
    currentUnitsPerSec: 0,
    measuredDistanceUnits: 0,
    measuredElapsedMs: 0,
    averageUnitsPerSec: 0,
    maxUnitsPerSec: 0,
    baseEligible: true,
    lockReason: null as string | null,
  });
  // Measurement pins — up to 2 world-coord positions {x, y, z}
  const [measurePins, setMeasurePins] = React.useState<Array<{ x: number; y: number; z: number }>>([]);
  const dragJustEndedRef = useRef(false);
  const localPositionRef = useRef<Position | null>(null);
  const localVelocityRef = useRef({ x: 0, y: 0 });
  const initializedRef   = useRef(false);
  const movementSeqRef   = useRef(0);

  /* --- Jump / Z refs --- */
  const jumpLocalRef      = useRef(false); // drives local Z prediction
  const jumpSendRef       = useRef(false); // queued for next movement POST
  const localZRef         = useRef(0);     // current Z height (world units)
  const localVzRef        = useRef(0);     // current Z velocity
  const localJumpCountRef = useRef(0);     // jumps used in current airtime (max 2)
  const lastDashAbilityIdRef = useRef<string | null>(null); // track last active dash for jump-restore logic
  const airborneSpeedCarryRef = useRef(0); // latest special airborne planar speed snapshot (world units/tick)
  const jumpTelemetryRef  = useRef<JumpTelemetry | null>(null);
  const lastJumpInputAtRef = useRef(0);    // last local jump press time for air reconciliation
  const bvhCenterYInitRef = useRef(false); // true after _bvhCenter.y first initialised
  const airNudgeRemainingRef = useRef(0);  // current jump phase travel budget (world units)
  const airNudgeTicksRemainingRef = useRef(0); // current jump phase travel ticks remaining
  const airNudgeDirRef = useRef<{ x: number; y: number } | null>(null);
  const airDirectionLockedRef = useRef(false); // once this jump phase picks a direction, ignore other movement inputs
  const localFacingRef    = useRef({ x: 0, y: 1 }); // current facing direction (default +Y)
  const facingInitRef     = useRef(false);
  const meFacingRef       = useRef<Facing>({ x: 0, y: 1 });
  const oppFacingRef      = useRef<Facing>({ x: 0, y: 1 });
  const prevActiveChannelRef = useRef<ActiveChannel | null>(null);
  const speedSamplePrevRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const speedTestRunRef = useRef({
    active: false,
    distanceWorld: 0,
    validElapsedMs: 0,
    maxUnitsPerSec: 0,
  });

  /* --- Opponent interpolation --- */
  const internalOpponentBufferRef = useRef<Array<{ t: number; pos: Position }>>([]);
  const opponentRawRef            = useRef<Position | null>(null);
  const RENDER_DELAY_MS           = 100;
  const activeOpponentBuffer      = opponentPositionBufferRef ?? internalOpponentBufferRef;

  // Camera direction is now pinned to CAM_DIR constant — no ref needed.
  // Keep a dummy ref so nothing else needs changing.
  const camDirRef = useRef(CAM_DIR);

  // 传统模式 camera/character state
  const controlModeRef = useRef<'joystick' | 'traditional'>('traditional');
  const charYawRef     = useRef(0);             // character facing yaw (radians, 0 = facing +Y)
  const camYawRef      = useRef(0);             // camera yaw
  const camPitchRef    = useRef(DEFAULT_PITCH); // camera pitch angle (radians)
  const camZoomRef     = useRef(DEFAULT_CAMERA_ZOOM);           // zoom multiplier (scroll wheel)
  const cameraMoveCommandActiveRef = useRef(false);
  const cameraLookInputVersionRef = useRef(0);
  const manualCameraLookActiveRef = useRef(false);
  const mouseStateRef  = useRef({ isLeft: false, isRight: false, lastX: 0, lastY: 0, downX: NaN, downY: NaN });

  /* --- Target selection refs --- */
  const selectedTargetRef   = useRef<string | null>(null);
  const selectedSelfRef     = useRef(false);
  const pendingGroundCastAbilityRef = useRef<string | null>(null);
  const mouseWorldPosRef = useRef<{ x: number; y: number; z?: number } | null>(null);
  const oppScreenBoundsRef  = useRef<{ cx: number; topY: number; baseY: number; rs: number } | null>(null);
  const meScreenBoundsRef   = useRef<{ cx: number; topY: number; baseY: number; rs: number } | null>(null);
  const opponentIdsRef      = useRef<string[]>([]);
  // Always reflects current primary opponent userId
  const opponentUserIdRef   = useRef<string>(targetableOpponentsList[0]?.userId ?? '');
  opponentUserIdRef.current = targetableOpponentsList[0]?.userId ?? '';

  /* --- Dash animation refs --- */
  const localDashAnimRef = useRef<{ start: V3; startTime: number } | null>(null);
  const oppDashAnimRef   = useRef<{ start: V3; startTime: number } | null>(null);

  /* --- Server-authoritative dash tracking --- */
  const meActiveDashRef  = useRef<any>(null);  // mirrors me.activeDash from server
  const dashTurnOverrideRef = useRef(false);
  // *** SYNCHRONOUS ref update during render — NOT in useEffect ***
  // useEffect fires AFTER requestAnimationFrame, so if we set the ref there,
  // the render loop reads the STALE value and falls back to cosmetic easing.
  // Setting it here ensures RAF always sees the latest activeDash.
  const _prevDashRef = useRef<boolean>(false);
  {
    const ad = (me as any)?.activeDash;
    const isDashing = !!ad && ad.ticksRemaining > 0;
    meActiveDashRef.current = isDashing ? ad : null;
    dashTurnOverrideRef.current = hasDashTurnOverrideClient(me?.buffs);
    // Transition logging (synchronous, fine for refs)
    if (isDashing && !_prevDashRef.current) {
      (window as any).__dashStartMs = performance.now();
      console.log(`[DASH] >>> FRONTEND START  time=${new Date().toISOString()}`);
    }
    if (!isDashing && _prevDashRef.current) {
      const elapsed = performance.now() - ((window as any).__dashStartMs ?? 0);
      console.log(`[DASH] <<< FRONTEND END    elapsed=${elapsed.toFixed(0)}ms  (expected ~1000ms)`);
    }
    _prevDashRef.current = isDashing;
  }

  /* --- Render-loop refs (avoid stale closures) --- */
  const abilitiesRef  = useRef<AbilityInfo[]>([]);
  const meHpRef       = useRef(me?.hp ?? 0);
  const oppHpRef      = useRef(opponent?.hp ?? 0);
  const maxHpRef      = useRef(maxHp);
  const distanceRef   = useRef(distance);
  distanceRef.current = distance;

  /* --- Fuyao (扶摇直上) local buff prediction --- */
  const hasFuyaoBuffRef          = useRef(false);
  const isPowerJumpRef           = useRef(false); // true while airborne from a power jump (different gravity)
  const isPowerJumpCombinedRef   = useRef(false); // true for 扶摇+鸟翔 combined 24u jump
  const maxJumpsRef              = useRef(2);     // updated from me.buffs MULTI_JUMP effect
  const predictedMultiJumpExpiresAtRef = useRef(0);
  const moveSpeedScaleRef        = useRef(1);     // SPEED_BOOST/SLOW local prediction multiplier
  const movementControlStateRef  = useRef({ fullyLocked: false, rooted: false });

  /* --- Channel AOE refs (used in render loop, updated via useEffect) --- */
  const meChannelingRef  = useRef(false);
  const oppChannelingRef = useRef(false);

  // Ref-based cast wrapper — updated every render, so it always captures the
  // latest onCastAbility without causing keyboard/mouse useEffect re-runs.
  const castAbilityRef = useRef<(id: string) => void>(() => {});
  castAbilityRef.current = (id: string) => {
    const ability = abilitiesRef.current.find(a => a.id === id);
    // 孤风飒踏 and 撼地: enter pending ground-cast mode (shows hover circle, click to confirm)
    if (ability?.abilityId === 'gu_feng_sa_ta' || ability?.abilityId === 'han_di') {
      setPendingGroundCastAbilityId(id);
      return;
    }
    if (ability?.abilityId === 'fuyao_zhishang') hasFuyaoBuffRef.current = true;
    if (ability?.abilityId === 'niao_xiang_bi_kong') {
      predictedMultiJumpExpiresAtRef.current = performance.now() + 15_000;
    }
    if (ability?.abilityId === 'yan_yu_xing') {
      // 烟雨行 consumes ALL remaining air jumps (interaction with 鸟翔碧空's 6 jumps)
      localJumpCountRef.current = getEffectiveMaxJumps();
    }
    const selectedTargetIdNow = selectedTargetRef.current;
    const selectedTarget = selectedTargetIdNow
      ? opponentsList.find((o) => o.userId === selectedTargetIdNow)
      : null;
    const targetPos = selectedTarget?.position;

    // Abilities targeting the opponent require a target to be selected first
    if (ability?.target === 'OPPONENT' && !selectedTargetIdNow) {
      if (ability?.allowGroundCastWithoutTarget) {
        setPendingGroundCastAbilityId(id);
        setGroundCastPreview(null);
        return;
      }
      toastError('请先选择目标');
      return;
    }
    if (ability?.target === 'OPPONENT' && selectedTarget && blocksTargetingClient(selectedTarget.buffs)) {
      toastError('目标不可选中');
      return;
    }
    if (ability?.target === 'OPPONENT' && !targetPos) {
      if (ability?.allowGroundCastWithoutTarget) {
        setPendingGroundCastAbilityId(id);
        setGroundCastPreview(null);
        return;
      }
      toastError('目标不可见或已失去目标');
      return;
    }

    const airborneLockedLocal =
      jumpLocalRef.current ||
      jumpSendRef.current ||
      localJumpCountRef.current > 0 ||
      Math.abs(localVzRef.current) > 0.01;
    if (ability?.requiresGrounded && airborneLockedLocal) {
      toastError('该技能需要落地后施放');
      return;
    }
    if (ability?.requiresStanding) {
      const movingByInput =
        keysRef.current.w ||
        keysRef.current.a ||
        keysRef.current.s ||
        keysRef.current.d;
      const movingLocal =
        movingByInput ||
        Math.abs(localVelocityRef.current.x) > 0.01 ||
        Math.abs(localVelocityRef.current.y) > 0.01;
      if (airborneLockedLocal || movingLocal) {
        toastError('该技能需要站立后施放');
        return;
      }
    }
    if (ability?.cannotCastWhileRooted && buffsHaveAnyEffect(me?.buffs, ['ROOT'])) {
      toastError('你被锁足，无法施展该招式');
      return;
    }
    if (typeof ability?.minSelfHpExclusive === 'number' && (me?.hp ?? 0) <= ability.minSelfHpExclusive) {
      toastError(`当前气血必须大于${ability.minSelfHpExclusive}才能施放`);
      return;
    }

    // Face direction check (180° hemisphere)
    if (ability?.target === 'OPPONENT' && requiresFacingByDefault(ability)) {
      const myPos = localPositionRef.current ?? me.position;
      const myFacing = me.facing ?? meFacingRef.current;
      if (myPos && myFacing && targetPos) {
        const dx = targetPos.x - myPos.x;
        const dy = targetPos.y - myPos.y;
        const dot = myFacing.x * dx + myFacing.y * dy;
        if (dot < 0) {
          toastError('目标不在面朝方向内');
          return;
        }
      }
    }
    // Line-of-sight check (structure blocking)
    if (ability?.target === 'OPPONENT') {
      const myPos = localPositionRef.current ?? me.position;
      const myZ = (myPos as any)?.z ?? localZRef.current ?? 0;
      const tgtZ = (targetPos as any)?.z ?? 0;
      if (myPos && targetPos) {
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        let losBlocked = false;
        if (mode === 'collision-test' && collisionSysRef.current) {
          losBlocked = clientCheckLOS(collisionSysRef.current, myPos.x, myPos.y, myZ, targetPos.x, targetPos.y, tgtZ, halfW, halfH);
        } else if (mode !== 'collision-test') {
          const aabbBlocker = isLOSBlockedClient(myPos.x, myPos.y, targetPos.x, targetPos.y, mapObjectsRef.current, 0, myZ, tgtZ);
          if (aabbBlocker) {
            losBlocked = true;
            showLOSBlocker(`视线被 ${aabbBlocker.id} 遮挡`);
          }
        }
        if (losBlocked) {
          if (mode === 'collision-test') showLOSBlocker('视线被遮挡');
          toastError('视线被遮挡');
          return;
        }
      }
    }
    // Stamp the ability name so the damage / heal float can label itself
    lastCastNameRef.current = ability?.name ?? null;
    setPendingGroundCastAbilityId(null);
    setGroundCastPreview(null);
    onCastAbility(id, selectedTargetIdNow ?? undefined);
  };

  const castGroundAbilityRef = useRef<(x: number, y: number, worldZ?: number) => void>(() => {});
  castGroundAbilityRef.current = (x: number, y: number, worldZ?: number) => {
    const abilityId = pendingGroundCastAbilityRef.current;
    if (!abilityId) return;
    const ability = abilitiesRef.current.find((a) => a.id === abilityId);
    if (!ability) return;

    lastCastNameRef.current = ability.name ?? null;
    setPendingGroundCastAbilityId(null);
    setGroundCastPreview(null);
    onCastAbility(abilityId, undefined, { x, y, z: worldZ });
  };

  /* --- Render position + dash-trail refs --- */
  const localRenderPosRef = useRef<V3>({ x: me?.position?.x ?? 50, y: me?.position?.y ?? 50, z: 0 });
  const oppRenderPosRef   = useRef<V3>({ x: opponent?.position?.x ?? 50, y: opponent?.position?.y ?? 50, z: 0 });
  const localTrailRef     = useRef<Array<{ pos: V3; alpha: number }>>([]);
  const oppTrailRef       = useRef<Array<{ pos: V3; alpha: number }>>([]);
  const lastFrameTimeRef  = useRef<number>(0);

  // Restore the old rAF render-position loop exactly.
  // Handles: smooth position lerp, dash snap animation, jump phase tracking, Z display.
  useEffect(() => {
    let rafId = 0;
    const DASH_THRESH = 3.5;
    const SNAP_THRESH = 20;

    const tick = () => {
      const frameNow = performance.now();
      const frameDt = lastFrameTimeRef.current === 0 ? 16 : Math.min(frameNow - lastFrameTimeRef.current, 50);
      lastFrameTimeRef.current = frameNow;
      const dtF = frameDt / 16.67;

      // --- local player render pos ---
      const myPos = localPositionRef.current ?? me?.position;
      if (myPos) {
        const tx = myPos.x, ty = myPos.y, tz = localZRef.current;
        const r  = localRenderPosRef.current;
        const ddx = tx - r.x, ddy = ty - r.y, ddz = tz - r.z;
        const dist2d = Math.sqrt(ddx * ddx + ddy * ddy);
        const airborneRender =
          localJumpCountRef.current > 0 ||
          Math.abs(localVzRef.current) > 0.01 ||
          tz > groundHRef.current + 0.05;
        const justJumpedRender = frameNow - lastJumpInputAtRef.current < 320;

        // During server-authoritative dash: HARD SNAP to server position.
        // Do NOT lerp — any lerp causes the visual to lag behind the server,
        // extending the perceived dash duration beyond the actual 1-second window.
        if (meActiveDashRef.current) {
          localDashAnimRef.current = null;
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
        } else if (dist2d > SNAP_THRESH) {
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
          localDashAnimRef.current  = null;
        } else if (!localDashAnimRef.current && dist2d > DASH_THRESH) {
          localDashAnimRef.current = { start: { ...r }, startTime: frameNow };
        }
        if (!meActiveDashRef.current) {
          if (localDashAnimRef.current) {
            const elapsed = frameNow - localDashAnimRef.current.startTime;
            const t = Math.min(1, elapsed / DASH_ANIM_MS);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            localRenderPosRef.current = {
              x: localDashAnimRef.current.start.x + (tx - localDashAnimRef.current.start.x) * eased,
              y: localDashAnimRef.current.start.y + (ty - localDashAnimRef.current.start.y) * eased,
              z: localDashAnimRef.current.start.z + (tz - localDashAnimRef.current.start.z) * eased,
            };
            if (t >= 1) localDashAnimRef.current = null;
          } else {
            const horizontalK = Math.min(1, (airborneRender ? (justJumpedRender ? 0.52 : 0.4) : 0.3) * dtF);
            const verticalK = Math.min(1, (airborneRender ? (justJumpedRender ? 0.62 : 0.46) : 0.3) * dtF);
            localRenderPosRef.current = {
              x: r.x + ddx * horizontalK,
              y: r.y + ddy * horizontalK,
              z: r.z + ddz * verticalK,
            };
          }
        }
      }

      myZRef.current = localRenderPosRef.current.z ?? 0;

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [me?.position?.x, me?.position?.y]);

  useEffect(() => { meHpRef.current  = me?.hp ?? 0;      }, [me?.hp]);
  // Keep max-jumps ref in sync with MULTI_JUMP buff from server state
  useEffect(() => {
    const multiJump = me?.buffs?.flatMap((b: any) => (b.effects ?? []).filter(Boolean)).find((e: any) => e.type === 'MULTI_JUMP');
    maxJumpsRef.current = multiJump ? (multiJump.value ?? 2) : 2;
  }, [me?.buffs]);

  const getEffectiveMaxJumps = useCallback(() => {
    const predictedMultiJumpActive = predictedMultiJumpExpiresAtRef.current > performance.now();
    return predictedMultiJumpActive ? Math.max(maxJumpsRef.current, 5) : maxJumpsRef.current;
  }, []);

  const tryQueueLocalJump = useCallback(() => {
    if (jumpLockedRef.current) return;
    const maxJumps = getEffectiveMaxJumps();
    if (localJumpCountRef.current >= maxJumps) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
      return;
    }
    lastJumpInputAtRef.current = performance.now();
    jumpLocalRef.current = true;
    jumpSendRef.current = true;
  }, [getEffectiveMaxJumps]);

  // Keep local movement-speed prediction aligned with backend movement.ts
  useEffect(() => {
    const effects = (me?.buffs ?? []).flatMap((b: any) => (b.effects ?? []).filter(Boolean));
    const speedBoost = effects
      .filter((e: any) => e.type === 'SPEED_BOOST')
      .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
    const slow = effects
      .filter((e: any) => e.type === 'SLOW')
      .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
    moveSpeedScaleRef.current = Math.max(0, 1 + speedBoost - slow);
  }, [me?.buffs]);

  useEffect(() => {
    const getBaseSpeedLockReason = () => {
      if (meActiveDashRef.current) return '冲刺中';
      if (localJumpCountRef.current > 0 || Math.abs(localVzRef.current) > 0.01) return '空中';
      if (Math.abs(moveSpeedScaleRef.current - 1) > 0.001) return '有移速修正';
      return null;
    };

    const id = window.setInterval(() => {
      const pos = localPositionRef.current;
      const now = performance.now();
      const prev = speedSamplePrevRef.current;
      const lockReason = getBaseSpeedLockReason();
      let currentUnitsPerSec = 0;

      if (pos && prev) {
        const dtMs = now - prev.t;
        if (dtMs > 1) {
          const distanceWorld = Math.hypot(pos.x - prev.x, pos.y - prev.y);
          currentUnitsPerSec = (distanceWorld / storedUnitScale) / (dtMs / 1000);

          if (speedTestRunRef.current.active && !lockReason) {
            speedTestRunRef.current.distanceWorld += distanceWorld;
            speedTestRunRef.current.validElapsedMs += dtMs;
            speedTestRunRef.current.maxUnitsPerSec = Math.max(
              speedTestRunRef.current.maxUnitsPerSec,
              currentUnitsPerSec,
            );
          }
        }
      }

      if (pos) {
        speedSamplePrevRef.current = { x: pos.x, y: pos.y, t: now };
      }

      const measuredDistanceUnits = speedTestRunRef.current.distanceWorld / storedUnitScale;
      const measuredElapsedMs = speedTestRunRef.current.validElapsedMs;
      setSpeedTestState({
        active: speedTestRunRef.current.active,
        currentUnitsPerSec,
        measuredDistanceUnits,
        measuredElapsedMs,
        averageUnitsPerSec: measuredElapsedMs > 0 ? measuredDistanceUnits / (measuredElapsedMs / 1000) : 0,
        maxUnitsPerSec: speedTestRunRef.current.maxUnitsPerSec,
        baseEligible: !lockReason,
        lockReason,
      });
    }, 100);

    return () => window.clearInterval(id);
  }, []);

  // activeDash side-effects: reset local prediction state when dash ends
  const activeDashJson = JSON.stringify((me as any)?.activeDash ?? null);
  useEffect(() => {
    const ad = (me as any)?.activeDash;
    const isDashing = !!ad && ad.ticksRemaining > 0;
    if (isDashing) {
      // Track which ability is currently dashing so we can restore jumps correctly on end
      lastDashAbilityIdRef.current = ad.abilityId ?? null;
    }
    if (!isDashing) {
      const wasYanYuXing = lastDashAbilityIdRef.current === 'yan_yu_xing';
      const airborneAfterDash = localZRef.current > groundHRef.current + 0.01;
      // 烟雨行: consumes ALL remaining jumps (backend sets jumpCount = MAX_JUMPS)
      localJumpCountRef.current = airborneAfterDash
        ? (wasYanYuXing ? getEffectiveMaxJumps() : (getEffectiveMaxJumps() > 2 ? 0 : 1))
        : 0;
      localVzRef.current = 0;
      isPowerJumpRef.current = false;
      isPowerJumpCombinedRef.current = false;
      airborneSpeedCarryRef.current = 0;
    }
  }, [activeDashJson, getEffectiveMaxJumps]);
  useEffect(() => { oppHpRef.current = opponent?.hp ?? 0; }, [opponent?.hp]);
  useEffect(() => { maxHpRef.current = maxHp;             }, [maxHp]);
  useEffect(() => {
    const f = me?.facing;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      meFacingRef.current = { x: f.x, y: f.y };
      if (!facingInitRef.current) {
        localFacingRef.current = { x: f.x, y: f.y };
        const yaw = Math.atan2(f.x, f.y);
        charYawRef.current = yaw;
        camYawRef.current = yaw;
        facingInitRef.current = true;
      }
    }
  }, [me?.facing?.x, me?.facing?.y]);
  useEffect(() => {
    const f = opponent?.facing;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      oppFacingRef.current = { x: f.x, y: f.y };
    }
  }, [opponent?.facing?.x, opponent?.facing?.y]);

  // Auto-detect mobile, but keep gameplay on the traditional movement path.
  useEffect(() => {
    // Mobile = touch device without a fine pointer (mouse), e.g. phones/iPads
    const isMobile = typeof window !== 'undefined' &&
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia('(pointer: fine)').matches;
    setIsMobileDevice(isMobile);
    const mode: 'traditional' | 'joystick' = 'traditional';
    setControlMode(mode);
    controlModeRef.current = mode;
  }, []);

  // Channel bar: now uses CSS animation — no JS polling needed.
  // Keep channelBuff computed so the bar mounts/unmounts correctly.
  // Prefer activeChannel (pure channel system) over legacy buff-based channels.
  // -- Forward channel (正读条): from player.activeChannel (e.g. 云飞玉皇)
  // -- Reverse channel (倒读条): from buff buffId 1014/1017/2001/2003
  //    (e.g. 风来吴山, 心诤, 笑醉狂, 千蝶吐瑞)
  const channelBarData: ChannelBarData | null = (() => {
    const locallyAirborne = localJumpCountRef.current > 0 || Math.abs(localVzRef.current) > 0.01;
    // CC (stun/freeze/knockdown) cancels channels that have no INTERRUPT_IMMUNE protection
    const hasBlockingCC = buffsHaveAnyEffect(me?.buffs, ['CONTROL', 'KNOCKED_BACK', 'ATTACK_LOCK']);
    const hasInterruptImmune = buffsHaveAnyEffect(me?.buffs, ['INTERRUPT_IMMUNE', 'CONTROL_IMMUNE']);
    if (hasBlockingCC && !hasInterruptImmune) return null;
    if (me?.activeChannel) {
      const ch = me.activeChannel;
      // Hide immediately on local jump if this channel cancels on jump
      if (locallyAirborne && ch.cancelOnJump) return null;
      return {
        kind: 'forward' as const,
        name: ch.abilityName,
        startedAt: ch.startedAt,
        durationMs: ch.durationMs,
        cancelOnMove: !!ch.cancelOnMove,
        cancelOnJump: !!ch.cancelOnJump,
      };
    }
    const buff = me?.buffs?.find((b: any) =>
      b.buffId === 1014 || b.buffId === 1017 || b.buffId === 2001 || b.buffId === 2003
    );
    if (buff) {
      // Buffs 2001 (笑醉狂) and 2003 (千蝶吐瑞) cancel on jump — hide bar immediately
      const cancelOnJump = (buff as any).buffId === 2001 || (buff as any).buffId === 2003;
      if (locallyAirborne && cancelOnJump) return null;
      const appliedAt: number = (buff as any).appliedAt ?? 0;
      const expiresAt: number = (buff as any).expiresAt ?? 0;
      const durationMs = expiresAt - appliedAt > 0 ? expiresAt - appliedAt : 5_000;
      return {
        kind: 'reverse' as const,
        name: (buff as any).name ?? '运功',
        appliedAt: appliedAt > 0 ? appliedAt : expiresAt - durationMs,
        durationMs,
        tickIntervalMs: (buff as any).periodicMs,
      };
    }
    return null;
  })();

  const jumpRecordNextRef = useRef<JumpRecord | null>(null);
  const jumpLockedRef = useRef(false);

  useEffect(() => {
    const buffs = me?.buffs ?? [];
    const fullyLocked = buffsHaveAnyEffect(buffs, ['KNOCKED_BACK', 'CONTROL', 'ATTACK_LOCK']);
    const rooted = !fullyLocked && buffsHaveAnyEffect(buffs, ['ROOT']);
    const locked = buffs.some((b: any) => b.buffId === 1014) || fullyLocked || rooted;
    movementControlStateRef.current = { fullyLocked, rooted };
    jumpLockedRef.current = locked;
    if (locked) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
    }
  }, [me?.buffs]);

  // Poll height + consume any finished jump record every 50 ms
  useEffect(() => {
    const id = setInterval(() => {
      const curZ  = myZRef.current;
      const gH    = groundHRef.current;
      const gBase = groundBaseRef.current ?? gH;
      setMyZ(Math.round(curZ * 10) / 10);
      setHeightDisplay({
        aboveGround: Math.max(0, (curZ - gH)) / storedUnitScale,
        floorElev:   Math.max(0, (gH - gBase)) / storedUnitScale,
      });
      const rec = jumpRecordNextRef.current;
      if (rec) {
        jumpRecordNextRef.current = null;
        setJumpRecord(rec);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Keep render-loop refs up to date for channel AOE circles
  useEffect(() => {
    meChannelingRef.current = !!(me?.buffs?.some((b: any) => b.buffId === 1014));
  }, [me?.buffs]);
  useEffect(() => {
    oppChannelingRef.current = !!(opponent?.buffs?.some((b: any) => b.buffId === 1014));
  }, [opponent?.buffs]);

  // Keep selected target valid as opponent list changes (N-player support)
  useEffect(() => {
    const ids = targetableOpponentsList.map((o) => o.userId);
    opponentIdsRef.current = ids;
    const current = selectedTargetRef.current;
    if (ids.length === 0) {
      setSelectedTargetId(null);
      selectedTargetRef.current = null;
      return;
    }
    if (current && !ids.includes(current)) {
      setSelectedTargetId(null);
      selectedTargetRef.current = null;
    }
  }, [targetableOpponentsList]);

  useEffect(() => {
    selectedTargetRef.current = selectedTargetId;
  }, [selectedTargetId]);

  useEffect(() => {
    pendingGroundCastAbilityRef.current = pendingGroundCastAbilityId;
  }, [pendingGroundCastAbilityId]);

  // Keep pickups ref up-to-date for render loop
  useEffect(() => {
    pickupsRef.current = modePickups;
  }, [modePickups]);

  // Keep nearbyPickupIdsRef + pickupModalsRef + uiPositionsRef in sync
  useEffect(() => { nearbyPickupIdsRef.current = nearbyPickupIds; }, [nearbyPickupIds]);
  useEffect(() => { pickupModalsRef.current    = pickupModals;    }, [pickupModals]);
  useEffect(() => { uiPositionsRef.current     = uiPositions;     }, [uiPositions]);
  useEffect(() => { channelPickupIdRef.current = channelPickupId; }, [channelPickupId]);

  // Proximity check: collect ALL books within range, sorted closest-first (runs every 100ms)
  // Also auto-close pickup panels whose book is now beyond claim range (20 units)
  useEffect(() => {
    const PICKUP_RANGE = 5;
    const CLAIM_RANGE  = 20;
    const id = setInterval(() => {
      const pos = localPositionRef.current;
      if (!pos) return;
      const pz = localZRef.current;
      const items = pickupsRef.current;
      const nearby: Array<{ id: string; dist: number }> = [];
      for (const p of items) {
        const dx = pos.x - p.position.x;
        const dy = pos.y - p.position.y;
        const dz = 0;
        const dist = worldUnitsToNewUnits(Math.sqrt(dx * dx + dy * dy + dz * dz), mode);
        if (dist < PICKUP_RANGE) nearby.push({ id: p.id, dist });
      }
      nearby.sort((a, b) => a.dist - b.dist);
      const ids = nearby.map(n => n.id);
      nearbyPickupIdsRef.current = ids;
      setNearbyPickupIds(prev =>
        prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids
      );
      // Close any open panels whose book drifted beyond claim range
      const modals = pickupModalsRef.current;
      if (modals.length > 0) {
        const toClose = modals.filter(m => {
          const pu = items.find(p => p.id === m.pickupId);
          if (!pu) return true;
          const dx = pos.x - pu.position.x;
          const dy = pos.y - pu.position.y;
          return worldUnitsToNewUnits(Math.sqrt(dx * dx + dy * dy), mode) > CLAIM_RANGE;
        }).map(m => m.pickupId);
        if (toClose.length > 0) {
          setPickupModals(prev => prev.filter(m => !toClose.includes(m.pickupId)));
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Poll canvas bounds for debug overlay
  useEffect(() => {
    if (!showDebugGrid) return;
    const id = setInterval(() => {
      const me  = meScreenBoundsRef.current;
      const opp = oppScreenBoundsRef.current;
      const { w: cw, h: ch } = canvasSizeRef.current;
      setDebugBounds({
        me:  me  ? { cx: me.cx,  topY: me.topY,  hpBarY: me.topY  - 20 } : null,
        opp: opp ? { cx: opp.cx, topY: opp.topY } : null,
        cw, ch,
      });
    }, 100);
    return () => clearInterval(id);
  }, [showDebugGrid]);

  /* --- Event-based floating numbers (replaces HP-delta system) --- */
  // Initialize on first render so we don't replay old events from before mount
  useEffect(() => {
    if (prevEventsLenRef.current === -1) {
      prevEventsLenRef.current = events.length;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip on very first render before initialization
    if (prevEventsLenRef.current === -1) return;
    const lastSeen = prevEventsLenRef.current;
    if (events.length <= lastSeen) return;
    const newEvents = events.slice(lastSeen);
    prevEventsLenRef.current = events.length;

    const myId = me?.userId;
    for (const evt of newEvents) {
      // WS array patches can momentarily produce sparse event slices.
      // Ignore empty/malformed entries instead of crashing the whole arena.
      if (!evt || typeof evt !== 'object' || !('type' in evt)) continue;
      if (evt.type === 'DAMAGE' && (evt.value ?? 0) > 0) {
        if (evt.targetUserId === myId) {
          if (!selectedTargetRef.current && !selectedSelfRef.current && evt.actorUserId && evt.actorUserId !== myId) {
            const attackerStillPresent = visibleOpponentsList.some((o) => o.userId === evt.actorUserId);
            if (attackerStillPresent) {
              setSelectedTargetId(evt.actorUserId);
              selectedTargetRef.current = evt.actorUserId;
              setSelectedSelf(false);
              selectedSelfRef.current = false;
            }
          }
          // I took damage — fixed position (x=40%, y=60%)
          addFloat(evt.value, 'dmg_taken', { label: evt.abilityName });
        } else if (evt.actorUserId === myId) {
          // I dealt damage to opponent
          const bounds = oppScreenBoundsRef.current;
          const { w, h } = canvasSizeRef.current;
          const screenPct = bounds
            ? { x: bounds.cx / w, y: Math.max(0, (bounds.topY - 55) / h) }
            : undefined;
          addFloat(evt.value, 'dmg_dealt', { label: evt.abilityName, screenPct });
        }
      } else if (evt.type === 'HEAL' && (evt.value ?? 0) > 0 && evt.targetUserId === myId) {
        // Heal — fixed position (x=60%, y=60%)
        addFloat(evt.value, 'heal', { label: evt.abilityName });
      } else if (evt.type === 'DODGE' && evt.targetUserId === myId) {
        toastError(`警告：${evt.abilityName ?? '技能'}被闪避`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // Warn when a targeted channel is interrupted because target became untargetable (e.g. entered stealth).
  useEffect(() => {
    const prev = prevActiveChannelRef.current;
    const curr = me?.activeChannel ?? null;

    if (prev && !curr) {
      const targetIsOpponent = !!prev.targetUserId && prev.targetUserId !== me.userId;
      const elapsedMs = Math.max(0, Date.now() - (prev.startedAt ?? 0));
      const interruptedEarly = elapsedMs + 120 < (prev.durationMs ?? 0);
      if (targetIsOpponent && interruptedEarly) {
        const target = opponentsList.find((o) => o.userId === prev.targetUserId);
        const targetLost = !target || blocksTargetingClient(target.buffs);
        if (targetLost) {
          toastError('警告：目标丢失，运功中断');
        }
      }
    }

    prevActiveChannelRef.current = curr ? { ...curr } : null;
  }, [me?.activeChannel, me?.userId, opponentsList]);

  /* --- Track opponent hand cooldown resets (kept for other UI purposes) --- */
  const prevOppHandRef      = useRef<any[]>([]);

  /* ========================= MOVEMENT ========================= */

  const sendMovement = useCallback(async () => {
    const k = keysRef.current;
    const mouseLook = controlModeRef.current === 'traditional' && mouseStateRef.current.isRight;
    const bothMouse = mouseStateRef.current.isRight && mouseStateRef.current.isLeft;
    // Capture & clear jump flag atomically before the async POST
    const shouldJump = jumpSendRef.current;
    if (shouldJump) jumpSendRef.current = false;
    const dashFacingLocked = !!meActiveDashRef.current && !dashTurnOverrideRef.current;
    let facingPayload = { ...meFacingRef.current };
    let directionPayload:
      | { dx: number; dy: number; jump: boolean }
      | { up: boolean; down: boolean; left: boolean; right: boolean; jump: boolean }
      | null = null;

    if (controlModeRef.current === 'traditional') {
      const moveIntent = buildTraditionalMoveIntent(
        k,
        mouseLook,
        bothMouse,
        camYawRef.current,
        charYawRef.current,
      );
      if (moveIntent.direction) {
        directionPayload = {
          dx: moveIntent.direction.dx,
          dy: moveIntent.direction.dy,
          jump: shouldJump,
        };
      } else if (shouldJump) {
        directionPayload = { dx: 0, dy: 0, jump: true };
      }

      if (!dashFacingLocked && mouseLook) {
        facingPayload = {
          x: Math.sin(camYawRef.current),
          y: -Math.cos(camYawRef.current),
        };
      } else if (!dashFacingLocked && moveIntent.direction && !moveIntent.backpedalOnly) {
        const facingDir = normalizePlanar(moveIntent.direction.dx, moveIntent.direction.dy);
        if (facingDir) facingPayload = facingDir;
      }
    } else if (joystickDirRef.current) {
      const jd = joystickDirRef.current;
      const mag = Math.sqrt(jd.dx * jd.dx + jd.dy * jd.dy);
      if (mag >= 0.01 || shouldJump) {
        directionPayload = { dx: jd.dx, dy: jd.dy, jump: shouldJump };
      }
      if (!dashFacingLocked) {
        const facingDir = normalizePlanar(jd.dx, jd.dy);
        if (facingDir) facingPayload = facingDir;
      }
    } else {
      if (k.w || k.a || k.s || k.d || shouldJump) {
        directionPayload = { up: k.s, down: k.w, left: k.a, right: k.d, jump: shouldJump };
      }
      if (!dashFacingLocked) {
        const facingDir = normalizePlanar(
          (k.a ? -1 : 0) + (k.d ? 1 : 0),
          (k.w ? 1 : 0) + (k.s ? -1 : 0),
        );
        if (facingDir) facingPayload = facingDir;
      }
    }

    meFacingRef.current = facingPayload;
    const seq = ++movementSeqRef.current;
    try {
      await fetch('/api/game/movement', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gameId,
          seq,
          // Server-facing is authoritative for ability logic and stays camera-forward
          // during RMB strafing / RMB diagonals even if the local avatar is rendered sideways.
          facing: {
            x: facingPayload.x,
            y: facingPayload.y,
          },
          direction: directionPayload,
        }),
      });
    } catch { /* AbortError expected */ }
  }, [gameId]);

  useEffect(() => {
    if (me?.position && !initializedRef.current) {
      localPositionRef.current = { ...me.position };
      localZRef.current = (me.position as any).z ?? 0;
      groundBaseRef.current = localZRef.current;
      localRenderPosRef.current = { x: me.position.x, y: me.position.y, z: localZRef.current };
      initializedRef.current   = true;
    }
  }, [me?.position?.x, me?.position?.y, (me?.position as any)?.z]);

  useEffect(() => {
    if (!me?.position || !initializedRef.current) return;
    const local  = localPositionRef.current;
    if (!local) return;
    const dx = me.position.x - local.x;
    const dy = me.position.y - local.y;
    const activeDash = (me as any)?.activeDash;

    // Collision-test mode: both client and backend now use BVH collision, so we can
    // reconcile position normally. Only skip reconciliation on dash (server owns dash).
    if (mode === 'collision-test') {
      if (activeDash && activeDash.ticksRemaining > 0) {
        meActiveDashRef.current = activeDash;
        localPositionRef.current = { ...me.position };
        localZRef.current  = (me.position as any).z ?? 0;
        localVzRef.current = 0;
        bvhCenterYInitRef.current = false; // resync cylinder center after dash
        return;
      }

      if (!collisionReadyRef.current) {
        const serverZ = (me.position as any).z ?? 0;
        localPositionRef.current = { ...me.position };
        localZRef.current = serverZ;
        localRenderPosRef.current = {
          x: me.position.x,
          y: me.position.y,
          z: serverZ,
        };
        return;
      }
      // Fall through to standard smooth reconciliation (fixes jump-range mismatch between
      // client prediction and server-authoritative BVH result).
    }

    // Hard-snap if server position is far away (e.g. new battle start)
    if (dx * dx + dy * dy > 25) {
      localPositionRef.current = { ...me.position };
      return;
    }

    // During active dash: server owns position — hard-snap XY + Z
    // Check me.activeDash directly (not ref) so this works even before React
    // fires the activeDash tracking useEffect on this render cycle.
    if (activeDash && activeDash.ticksRemaining > 0) {
      meActiveDashRef.current = activeDash;
      localPositionRef.current = { ...me.position };
      localZRef.current  = (me.position as any).z ?? 0;
      localVzRef.current = 0;
      return;
    }

    // Reconcile Z with softer airborne correction to avoid double-jump snap.
    // When the client just jumped locally, trust prediction more briefly.
    const serverZ = (me.position as any).z ?? 0;
    const localZ  = localZRef.current;
    const zError = serverZ - localZ;
    const airborneLocal =
      localJumpCountRef.current > 0 ||
      Math.abs(localVzRef.current) > 0.01 ||
      localZ > groundHRef.current + 0.05;
    const justJumpedLocally = performance.now() - lastJumpInputAtRef.current < 260;
    const hardSnapThreshold = airborneLocal ? (justJumpedLocally ? 6.6 : 4.4) : 2.64;
    const settleThreshold = airborneLocal ? 0.132 : 0.044;
    const zBlend = airborneLocal ? (justJumpedLocally ? 0.08 : 0.16) : 0.35;
    const shouldSoftReconcile = !airborneLocal || !justJumpedLocally || Math.abs(zError) > 0.66;
    if (Math.abs(zError) > hardSnapThreshold) {
      localZRef.current = serverZ;
      if (!airborneLocal || serverZ <= groundHRef.current + 0.05) {
        localVzRef.current = 0;
      }
      bvhCenterYInitRef.current = false; // large Z snap — resync sphere center next tick
    } else if (shouldSoftReconcile) {
      localZRef.current = localZ + zError * zBlend;
      if (Math.abs(serverZ - localZRef.current) < settleThreshold) {
        localZRef.current = serverZ;
      }
    }
    const moving = keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d;
    const blend  = airborneLocal && justJumpedLocally ? 0 : moving ? 0.03 : 0.25;
    localPositionRef.current = {
      x: local.x + dx * blend,
      y: local.y + dy * blend,
    };
  }, [me?.position?.x, me?.position?.y, (me?.position as any)?.z]);

  useEffect(() => {
    if (!opponent?.position) return;
    opponentRawRef.current = opponent.position;
    if (!opponentPositionBufferRef) {
      const now    = performance.now();
      internalOpponentBufferRef.current.push({ t: now, pos: { ...opponent.position } });
      const cutoff = now - 1000;
      internalOpponentBufferRef.current = internalOpponentBufferRef.current.filter(e => e.t >= cutoff);
    }
  }, [opponent?.position?.x, opponent?.position?.y, opponentPositionBufferRef]);

  useEffect(() => {
    // ── Draft abilities: sourced from me.hand (only non-common abilities) ──
    const GCD_WINDOW_TICKS = 45;
    const getDisplayMaxCooldown = (ab: any): number => {
      const base = ab?.cooldownTicks ?? 0;
      const gcdWindow = ab?.gcd === true ? GCD_WINDOW_TICKS : 0;
      return Math.max(base, gcdWindow);
    };
    const getChargeDisplay = (ab: any, instance: any) => {
      const maxCharges = Math.max(0, Number(ab?.maxCharges ?? 0));
      if (maxCharges <= 1) {
        const currentCooldown = Math.max(0, Number(instance?.cooldown ?? 0));
        return {
          maxCharges: undefined,
          chargeCount: undefined,
          chargeRecoveryTicks: undefined,
          chargeRegenTicksRemaining: undefined,
          chargeRegenProgress: undefined,
          chargeCastLockTicks: undefined,
          chargeLockTicks: undefined,
          cooldown: currentCooldown,
          maxCooldown: Math.max(getDisplayMaxCooldown(ab), currentCooldown),
        };
      }

      const chargeCount = typeof instance?.chargeCount === 'number' ? instance.chargeCount : maxCharges;
      const chargeRecoveryTicks = Math.max(1, Number(ab?.chargeRecoveryTicks ?? ab?.cooldownTicks ?? 1));
      const chargeRegenTicksRemaining = Math.max(0, Number(instance?.chargeRegenTicksRemaining ?? 0));
      const chargeRegenProgress = chargeCount < maxCharges
        ? Math.max(0, Math.min(1, 1 - (chargeRegenTicksRemaining / chargeRecoveryTicks)))
        : undefined;
      const chargeCastLockTicks = Math.max(0, Number(ab?.chargeCastLockTicks ?? 0));
      const chargeLockTicks = Math.max(0, Number(instance?.chargeLockTicks ?? 0));

      if (chargeCount <= 0) {
        return {
          maxCharges,
          chargeCount,
          chargeRecoveryTicks,
          chargeRegenTicksRemaining,
          chargeRegenProgress,
          chargeCastLockTicks,
          chargeLockTicks,
          cooldown: chargeRegenTicksRemaining,
          maxCooldown: chargeRecoveryTicks,
        };
      }

      if (chargeLockTicks > 0) {
        return {
          maxCharges,
          chargeCount,
          chargeRecoveryTicks,
          chargeRegenTicksRemaining,
          chargeRegenProgress,
          chargeCastLockTicks,
          chargeLockTicks,
          cooldown: chargeLockTicks,
          maxCooldown: Math.max(1, chargeCastLockTicks),
        };
      }

      return {
        maxCharges,
        chargeCount,
        chargeRecoveryTicks,
        chargeRegenTicksRemaining,
        chargeRegenProgress,
        chargeCastLockTicks,
        chargeLockTicks,
        cooldown: 0,
        maxCooldown: chargeRecoveryTicks,
      };
    };
    const selectedTarget = selectedTargetId
      ? targetableOpponentsList.find((o) => o.userId === selectedTargetId) ?? null
      : null;
    const hasSelectedTarget = !!selectedTarget;
    const targetForChecks = selectedTarget ?? targetableOpponentsList[0] ?? null;
    const myPos = me.position ?? localPositionRef.current;
    const myFacing = me.facing ?? meFacingRef.current;
    const targetPos = targetForChecks?.position;
    const qinggongSealed = hasQinggongSealClient(me.buffs);
    const rootedByDebuff = buffsHaveAnyEffect(me.buffs, ['ROOT']);

    const isAbilityReady = (ab: any, instance: any): boolean => {
      const maxCharges = Math.max(0, Number(ab?.maxCharges ?? 0));
      if (maxCharges > 1) {
        const chargeCount = typeof instance?.chargeCount === 'number' ? instance.chargeCount : maxCharges;
        const chargeLockTicks = Number(instance?.chargeLockTicks ?? 0);
        if (chargeLockTicks > 0) return false;
        if (chargeCount <= 0) return false;
      } else if ((instance?.cooldown ?? 0) > 0) {
        return false;
      }
      const airborneLockedLocal =
        jumpLocalRef.current ||
        jumpSendRef.current ||
        localJumpCountRef.current > 0 ||
        Math.abs(localVzRef.current) > 0.01;
      if (ab?.requiresGrounded && airborneLockedLocal) return false;
      if (ab?.requiresStanding) {
        const movingByInput =
          wasdKeys.w ||
          wasdKeys.a ||
          wasdKeys.s ||
          wasdKeys.d;
        const movingLocal =
          movingByInput ||
          Math.abs(localVelocityRef.current.x) > 0.01 ||
          Math.abs(localVelocityRef.current.y) > 0.01;
        if (airborneLockedLocal || movingLocal) return false;
      }
      if (typeof ab?.minSelfHpExclusive === 'number' && (me?.hp ?? 0) <= ab.minSelfHpExclusive) {
        return false;
      }
      if (ab?.qinggong && qinggongSealed) return false;
      if (ab?.cannotCastWhileRooted && rootedByDebuff) return false;

      // Ground-target abilities always ready regardless of target selection or range
      if (ab?.target === 'OPPONENT' && !!ab?.allowGroundCastWithoutTarget) return true;

      const needsSelectedTarget = ab?.target === 'OPPONENT' && !ab?.allowGroundCastWithoutTarget;
      if (needsSelectedTarget && !targetPos) return false;

      const distanceToTarget = (myPos && targetPos)
        ? worldUnitsToNewUnits(Math.sqrt(
            Math.pow(targetPos.x - myPos.x, 2) +
            Math.pow(targetPos.y - myPos.y, 2) +
            Math.pow(((targetPos as any)?.z ?? 0) - ((myPos as any)?.z ?? 0), 2)
          ), mode)
        : distance;
      const inMaxRange = !ab?.range || distanceToTarget <= ab.range;
      const inMinRange = !ab?.minRange || distanceToTarget >= ab.minRange;
      if (!inMaxRange || !inMinRange) return false;

      if (ab?.target === 'OPPONENT' && myPos && targetPos) {
        if (requiresFacingByDefault(ab) && myFacing) {
          const dx = targetPos.x - myPos.x;
          const dy = targetPos.y - myPos.y;
          if (myFacing.x * dx + myFacing.y * dy < 0) return false;
        }
          const myZ2 = (myPos as any)?.z ?? localZRef.current ?? 0;
          const tgtZ2 = (targetPos as any)?.z ?? 0;
          if (mode === 'collision-test' && collisionSysRef.current) {
            // BVH-based LOS: same accurate geometry as backend + blueprint wireframe
            if (clientCheckLOS(collisionSysRef.current, myPos.x, myPos.y, myZ2, targetPos.x, targetPos.y, tgtZ2, ARENA_WIDTH / 2, ARENA_HEIGHT / 2)) {
              return false;
            }
          } else if (mode !== 'collision-test') {
            if (isLOSBlockedClient(myPos.x, myPos.y, targetPos.x, targetPos.y, mapObjectsRef.current, 0, myZ2, tgtZ2)) {
              return false;
            }
          }
      }
      return true;
    };

    const draftUpdated: AbilityInfo[] = me.hand
      .map((instance: any) => {
        const ability =
          (instance.abilityId && abilities[instance.abilityId]) ||
          (instance.id    && abilities[instance.id])     ||
          (instance.name  ? instance : null);

        // Skip common abilities — they are shown in the top row independently
        if (ability?.isCommon) return null;

        const instanceId = instance.instanceId || instance.id || String(Math.random());
        if (!ability) {
          console.warn('[BattleArena] ability lookup failed for hand item:', instance);
          return {
            id:          instanceId,
            abilityId:      instance.abilityId || instance.id || instanceId,
            name:        instance.name || instance.abilityId || instance.id || '?',
            range:       undefined as number | undefined,
            minRange:    undefined as number | undefined,
            cooldown:    instance.cooldown || 0,
            maxCooldown: 0,
            isReady:     isAbilityReady(ability, instance),
            isCommon:    false,
            target:      'OPPONENT' as 'SELF' | 'OPPONENT',
            minSelfHpExclusive: undefined,
            requiresGrounded: false,
            requiresStanding: false,
            qinggong: false,
            cannotCastWhileRooted: false,
            allowGroundCastWithoutTarget: false,
          };
        }
        const chargeDisplay = getChargeDisplay(ability, instance);
        const isReadyVal = isAbilityReady(ability, instance);
        const losBlockedVal = !isReadyVal && (ability as any)?.target === 'OPPONENT' && myPos && targetPos
          ? (mode === 'collision-test' && collisionSysRef.current
              ? clientCheckLOS(collisionSysRef.current, myPos.x, myPos.y, (myPos as any)?.z ?? localZRef.current ?? 0, targetPos.x, targetPos.y, (targetPos as any)?.z ?? 0, ARENA_WIDTH / 2, ARENA_HEIGHT / 2)
              : mode !== 'collision-test'
                ? !!isLOSBlockedClient(myPos.x, myPos.y, targetPos.x, targetPos.y, mapObjectsRef.current, 0, (myPos as any)?.z ?? localZRef.current ?? 0, (targetPos as any)?.z ?? 0)
                : false)
          : false;
        return {
          id:          instanceId,
          abilityId:      ability.id,
          name:        ability.name,
          range:       ability.range,
          minRange:    ability.minRange,
          cooldown:    chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          chargeRegenTicksRemaining: chargeDisplay.chargeRegenTicksRemaining,
          chargeRegenProgress: chargeDisplay.chargeRegenProgress,
          chargeCastLockTicks: chargeDisplay.chargeCastLockTicks,
          chargeLockTicks: chargeDisplay.chargeLockTicks,
          isReady:     isReadyVal,
          losBlocked:  losBlockedVal,
          isCommon:    false,
          target:      (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
          faceDirection: requiresFacingByDefault(ability as any),
          minSelfHpExclusive: typeof (ability as any).minSelfHpExclusive === 'number' ? (ability as any).minSelfHpExclusive : undefined,
          requiresGrounded: !!(ability as any).requiresGrounded,
          requiresStanding: !!(ability as any).requiresStanding,
          qinggong: !!(ability as any).qinggong,
          cannotCastWhileRooted: !!(ability as any).cannotCastWhileRooted,
          allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,
        };
      })
      .filter(Boolean) as AbilityInfo[];

    // ── Common abilities: always built from preload abilities in fixed display order ──
    const cardValues: any[] = Object.values(abilities);
    const commonUpdated: AbilityInfo[] = COMMON_ABILITY_ORDER
      .map((orderedCardId) => {
        const ability = cardValues.find((c: any) => c.id === orderedCardId);
        if (!ability) return null;
        const instance = me.hand.find(
          (h: any) => (h.abilityId ?? h.id) === ability.id
        );
        const chargeDisplay = getChargeDisplay(ability, instance ?? {});
        const isReadyCom = isAbilityReady(ability, instance);
        const losBlockedCom = !isReadyCom && (ability as any)?.target === 'OPPONENT' && myPos && targetPos
          ? (mode === 'collision-test' && collisionSysRef.current
              ? clientCheckLOS(collisionSysRef.current, myPos.x, myPos.y, (myPos as any)?.z ?? localZRef.current ?? 0, targetPos.x, targetPos.y, (targetPos as any)?.z ?? 0, ARENA_WIDTH / 2, ARENA_HEIGHT / 2)
              : mode !== 'collision-test'
                ? !!isLOSBlockedClient(myPos.x, myPos.y, targetPos.x, targetPos.y, mapObjectsRef.current, 0, (myPos as any)?.z ?? localZRef.current ?? 0, (targetPos as any)?.z ?? 0)
                : false)
          : false;
        return {
          id:          ability.id,
          abilityId:      ability.id,
          name:        ability.name,
          range:       ability.range,
          minRange:    ability.minRange,
          cooldown:    chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          chargeRegenTicksRemaining: chargeDisplay.chargeRegenTicksRemaining,
          chargeRegenProgress: chargeDisplay.chargeRegenProgress,
          chargeCastLockTicks: chargeDisplay.chargeCastLockTicks,
          chargeLockTicks: chargeDisplay.chargeLockTicks,
          isReady:     isReadyCom,
          losBlocked:  losBlockedCom,
          isCommon:    true,
          target:      (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
          faceDirection: requiresFacingByDefault(ability as any),
          minSelfHpExclusive: typeof (ability as any).minSelfHpExclusive === 'number' ? (ability as any).minSelfHpExclusive : undefined,
          requiresGrounded: !!(ability as any).requiresGrounded,
          requiresStanding: !!(ability as any).requiresStanding,
          qinggong: !!(ability as any).qinggong,
          cannotCastWhileRooted: !!(ability as any).cannotCastWhileRooted,
          allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,
        } as AbilityInfo;
      })
      .filter(Boolean) as AbilityInfo[];

    const updated = [...commonUpdated, ...draftUpdated];
    setHandAbilities(updated);
    abilitiesRef.current = updated;
  }, [
    me.hand,
    me.buffs,
    me.hp,
    me.position,
    me.facing,
    selectedTargetId,
    targetableOpponentsList,
    distance,
    abilities,
    wasdKeys,
  ]);

  /* ========================= PICKUP INTERACTION ========================= */

  /** Start a drag session for any draggable UI panel. Key is stored in localStorage. */
  const startUIDrag = useCallback((key: string, defaultPos: { left: number; top: number }, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const base = uiPositionsRef.current[key] ?? defaultPos;
    const onMove = (me: MouseEvent) => {
      setUiPositions(prev => ({
        ...prev,
        [key]: { left: base.left + me.clientX - startX, top: base.top + me.clientY - startY },
      }));
    };
    const onUp = (me: MouseEvent) => {
      const next = { left: base.left + me.clientX - startX, top: base.top + me.clientY - startY };
      setUiPositions(prev => {
        const updated = { ...prev, [key]: next };
        try { localStorage.setItem('zhenchuan-ui-positions', JSON.stringify(updated)); } catch {}
        return updated;
      });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickupInteract = useCallback(() => {
    const target = nearbyPickupIdsRef.current[0] ?? null;
    if (!target) return;

    // Block channeling if moving or airborne
    const keys = keysRef.current;
    if (keys.w || keys.a || keys.s || keys.d) return;
    if (localJumpCountRef.current > 0 || Math.abs(localVzRef.current) > 0.01) return;

    // If the closest book's panel is already open → claim it (F toggles open→claim)
    if (pickupModalsRef.current.some(m => m.pickupId === target)) {
      claimPickup(target);
      return;
    }

    // If already channeling this same book, ignore (debounce)
    if (channelPickupId === target) return;

    // Start 0.5s channel
    setChannelPickupId(target);
    setChannelProgress(0);
    channelStartRef.current = performance.now();

    // Animate progress bar
    const animate = () => {
      const elapsed  = performance.now() - channelStartRef.current;
      const progress = Math.min(1, elapsed / 500);
      setChannelProgress(progress);
      if (progress < 1) {
        channelAnimRef.current = requestAnimationFrame(animate);
      } else {
        // Channel complete — inspect pickup
        inspectPickup(target);
      }
    };
    channelAnimRef.current = requestAnimationFrame(animate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelPickupId]);

  const handlePickupInteractRef = useRef(handlePickupInteract);
  handlePickupInteractRef.current = handlePickupInteract;

  const inspectPickup = useCallback(async (pickupId: string) => {
    setChannelPickupId(null);
    setChannelProgress(0);
    try {
      const res = await fetch('/api/game/pickup/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, pickupId }),
      });
      if (!res.ok) {
        const err = await res.json();
        toastError(err.error ?? '无法读取');
        return;
      }
      const data = await res.json();
      // Add panel if not already open for this pickup
      setPickupModals(prev =>
        prev.some(m => m.pickupId === data.pickupId)
          ? prev
          : [...prev, { pickupId: data.pickupId, abilityId: data.abilityId, name: data.name, description: data.description }]
      );
    } catch {
      toastError('网络错误');
    }
  }, [gameId]);

  const claimPickup = useCallback(async (pickupId: string) => {
    try {
      const res = await fetch('/api/game/pickup/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, pickupId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error ?? '无法拾取');
        return; // keep panel open on failure
      }
      setPickupModals(prev => prev.filter(m => m.pickupId !== pickupId));
      toastSuccess(`拾取了 ${data.name}`);
    } catch {
      toastError('网络错误');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Clean up channel animation on unmount or when nearby pickup changes
  useEffect(() => {
    return () => {
      cancelAnimationFrame(channelAnimRef.current);
      if (channelTimerRef.current) clearTimeout(channelTimerRef.current);
    };
  }, []);

  // Cancel channel if the book being channeled leaves the nearby range
  useEffect(() => {
    if (channelPickupId && !nearbyPickupIds.includes(channelPickupId)) {
      cancelAnimationFrame(channelAnimRef.current);
      setChannelPickupId(null);
      setChannelProgress(0);
    }
  }, [nearbyPickupIds, channelPickupId]);

  // ── Keyboard input ──
  useEffect(() => {
    const resetMovementKeys = () => {
      autoForwardRef.current = false;
      setAutoForward(false);
      keysRef.current = { w: false, a: false, s: false, d: false };
      setWasdKeys({ w: false, a: false, s: false, d: false });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (selectedTargetRef.current || selectedSelfRef.current) {
          selectedTargetRef.current = null;
          selectedSelfRef.current = false;
          setSelectedTargetId(null);
          setSelectedSelf(false);
          return;
        }
        setShowTestingPanel(v => !v);
        return;
      }
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();

        if (k === 's' && autoForwardRef.current) {
          autoForwardRef.current = false;
          setAutoForward(false);
          keysRef.current.w = false;
          setWasdKeys(prev => ({ ...prev, w: false }));
        }
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = true;
        setWasdKeys(prev => ({ ...prev, [k]: true }));

        // Movement breaks channeling
        if (channelPickupIdRef.current) {
          cancelAnimationFrame(channelAnimRef.current);
          setChannelPickupId(null);
          setChannelProgress(0);
        }
        // Movement closes all pickup modals
        if (pickupModalsRef.current.length > 0) {
          setPickupModals([]);
        }
      }
      // Space = jump
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        if (keysRef.current.s) {
          const commons = abilitiesRef.current.filter(a => a.isCommon);
          const backstep = commons.find(a => a.abilityId === 'houyao');
          if (backstep?.isReady) {
            castAbilityRef.current(backstep.id);
            return;
          }
        }
        tryQueueLocalJump();
      }
      // F = interact with nearby pickup (channel to open panel; claim if panel already open)
      if (k === 'f') {
        e.preventDefault();
        handlePickupInteractRef.current();
        return;
      }
      // G = auto-forward (persists until S is pressed)
      if (k === 'g') {
        e.preventDefault();
        if (!e.repeat && !autoForwardRef.current) {
          autoForwardRef.current = true;
          setAutoForward(true);
          keysRef.current.w = true;
          setWasdKeys(prev => ({ ...prev, w: true }));
          toastSuccess('自动前行已开启（按 S 停止）');
        }
        return;
      }
      // Tab / F1 — select primary opponent target (old 1v1 behavior)
      if (e.key === 'Tab' || e.key === 'F1') {
        e.preventDefault();
        const primary = opponentIdsRef.current[0] ?? opponentUserIdRef.current;
        if (!primary) {
          toastError('当前没有可选目标');
          return;
        }
        setSelectedTargetId(primary);
        selectedTargetRef.current = primary;
        setSelectedSelf(false);
        selectedSelfRef.current = false;
        return;
      }
      // ── Draft slots: 1  2  3  Q ──
      const drafts = abilitiesRef.current.filter(a => !a.isCommon);
      if (e.key === '1' && drafts[0]?.isReady) { castAbilityRef.current(drafts[0].id); return; }
      if (e.key === '2' && drafts[1]?.isReady) { castAbilityRef.current(drafts[1].id); return; }
      if (e.key === '3' && drafts[2]?.isReady) { castAbilityRef.current(drafts[2].id); return; }
      if (k === 'q' && !e.altKey && drafts[3]?.isReady) { castAbilityRef.current(drafts[3].id); return; }
      // ── Common abilities: X  Alt+A  Alt+D  Alt+S  `  T ──
      const commons = abilitiesRef.current.filter(a => a.isCommon);
      if (k === 'x' && !e.altKey) {
        // index 0 = 猛虎下山
        if (commons[0]?.isReady) castAbilityRef.current(commons[0].id);
        return;
      }
      if (k === 't' && !e.altKey) {
        // index 7 = 御骑
        if (commons[7]?.isReady) castAbilityRef.current(commons[7].id);
        return;
      }
      if (e.key === '`') {
        // index 6 = 后撤
        if (commons[6]?.isReady) castAbilityRef.current(commons[6].id);
        return;
      }
      if (e.altKey) {
        e.preventDefault(); // suppress browser Alt shortcuts
        if (k === 'w' && commons[2]?.isReady) castAbilityRef.current(commons[2].id); // 蹑云逐月
        if (k === 'a' && commons[3]?.isReady) castAbilityRef.current(commons[3].id); // 凌霄揽胜
        if (k === 'd' && commons[4]?.isReady) castAbilityRef.current(commons[4].id); // 瑶台枕鹤
        if (k === 's' && commons[5]?.isReady) castAbilityRef.current(commons[5].id); // 迎风回浪
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k)) {
        if (k === 'w' && autoForwardRef.current) {
          return;
        }
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = false;
        setWasdKeys(prev => ({ ...prev, [k]: false }));
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) resetMovementKeys();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    window.addEventListener('blur',    resetMovementKeys);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
      window.removeEventListener('blur',    resetMovementKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tryQueueLocalJump]);

  // Mouse hotkeys + camera drag + zoom:
  //   Left-drag              → rotate camera (traditional mode)
  //   Right-drag             → rotate camera + snap character facing (traditional mode)
  //   Middle-down (MD)       → common[1] 扶摇直上
  //   Alt+W                  → common[2] 蹑云逐月
  //   Button-3 / XB1 (down)  → draft[5]
  //   Button-4 / XB2 (down)  → draft[4]
  //   Wheel up/down          → zoom in/out
  useEffect(() => {
    const resetMouseButtons = () => {
      mouseStateRef.current.isLeft = false;
      mouseStateRef.current.isRight = false;
      manualCameraLookActiveRef.current = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      // Left button — start camera drag
      if (e.button === 0) {
        // Only start drag if not clicking a UI button or a draggable panel
        if ((e.target as HTMLElement).closest('button, [data-ui-drag]')) return;
        mouseStateRef.current.isLeft = true;
        manualCameraLookActiveRef.current = true;
        mouseStateRef.current.lastX  = e.clientX;
        mouseStateRef.current.lastY  = e.clientY;
        mouseStateRef.current.downX  = e.clientX;
        mouseStateRef.current.downY  = e.clientY;
        return;
      }
      // Right button — start character rotate drag (context menu already suppressed by onContextMenu)
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        mouseStateRef.current.isRight = true;
        manualCameraLookActiveRef.current = mouseStateRef.current.isLeft;
        mouseStateRef.current.lastX   = e.clientX;
        mouseStateRef.current.lastY   = e.clientY;
        return;
      }
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        const ab = abilitiesRef.current.filter(a => a.isCommon)[1]; // 扶摇直上
        if (ab?.isReady) castAbilityRef.current(ab.id);
        return;
      }
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        const ab = abilitiesRef.current.filter(a => !a.isCommon)[5]; // draft slot 6 (XB1)
        if (ab?.isReady) castAbilityRef.current(ab.id);
        return;
      }
      if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        const ab = abilitiesRef.current.filter(a => !a.isCommon)[4]; // draft slot 5 (XB2)
        if (ab?.isReady) castAbilityRef.current(ab.id);
        return;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        mouseStateRef.current.isLeft = false;
        manualCameraLookActiveRef.current = false;
        // Keep old behavior compatibility: do not force clear or cycle targets on plain mouse up.
        mouseStateRef.current.downX = NaN;
        mouseStateRef.current.downY = NaN;
        return;
      }
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        mouseStateRef.current.isRight = false;
        manualCameraLookActiveRef.current = mouseStateRef.current.isLeft;
        return;
      }
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      const ms = mouseStateRef.current;
      if (!ms.isLeft && !ms.isRight) return;
      e.preventDefault();
      const dx = e.clientX - ms.lastX;
      const dy = e.clientY - ms.lastY;
      ms.lastX = e.clientX;
      ms.lastY = e.clientY;

      if (ms.isRight && !ms.isLeft) {
        // RMB only: rotate camera; character snaps to camera direction
        camYawRef.current  -= dx * 0.005;
        // Update pitch too (drag up/down tilts view)
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = clampCameraPitch(newPitch, mode);
        cameraLookInputVersionRef.current += 1;
        const moveIntent = buildTraditionalMoveIntent(
          keysRef.current,
          true,
          false,
          camYawRef.current,
          charYawRef.current,
        );
        const facingDir = moveIntent.direction && !moveIntent.backpedalOnly
          ? normalizePlanar(moveIntent.direction.dx, moveIntent.direction.dy)
          : {
              x: Math.sin(camYawRef.current),
              y: -Math.cos(camYawRef.current),
            };
        if (facingDir && (!meActiveDashRef.current || dashTurnOverrideRef.current)) {
          localFacingRef.current = facingDir;
          charYawRef.current = facingToYaw(facingDir);
        }
      } else if (ms.isLeft && !ms.isRight) {
        // LMB only: rotate camera yaw + pitch
        camYawRef.current  -= dx * 0.005;
        // dy > 0 = drag down = look more from above (increase pitch)
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = clampCameraPitch(newPitch, mode);
        cameraLookInputVersionRef.current += 1;
      } else {
        // LMB + RMB together: rotate camera + character facing; physics tick moves forward
        camYawRef.current  -= dx * 0.005;
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = clampCameraPitch(newPitch, mode);
        cameraLookInputVersionRef.current += 1;
        const moveIntent = buildTraditionalMoveIntent(
          keysRef.current,
          true,
          true,
          camYawRef.current,
          charYawRef.current,
        );
        const facingDir = moveIntent.direction && !moveIntent.backpedalOnly
          ? normalizePlanar(moveIntent.direction.dx, moveIntent.direction.dy)
          : {
              x: Math.sin(camYawRef.current),
              y: -Math.cos(camYawRef.current),
            };
        if (facingDir && (!meActiveDashRef.current || dashTurnOverrideRef.current)) {
          localFacingRef.current = facingDir;
          charYawRef.current = facingToYaw(facingDir);
        }
      }
    };
    // Prevent native right-click context menu
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    // auxclick fires for middle-click and side-buttons — prevent browser tab-open / navigation
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1 || e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[data-testing-panel]')) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.12 : -0.12;
      const zoomMax = allowOverrangeCameraZoom ? CAMERA_ZOOM_OVER_MAX : CAMERA_ZOOM_MAX;
      camZoomRef.current = Math.max(0.4, Math.min(zoomMax, camZoomRef.current + delta));
      setCameraZoomLevel(camZoomRef.current);
    };
    // Use capture phase so we intercept BEFORE the browser's own navigation handlers
    window.addEventListener('mousedown',   onMouseDown,   { capture: true });
    window.addEventListener('mouseup',     onMouseUp,     { capture: true });
    window.addEventListener('mousemove',   onMouseMove,   { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('auxclick',    onAuxClick,    { capture: true });
    window.addEventListener('wheel',       onWheel,       { passive: false, capture: true });
    window.addEventListener('blur',        resetMouseButtons);
    return () => {
      window.removeEventListener('mousedown',   onMouseDown,   { capture: true });
      window.removeEventListener('mouseup',     onMouseUp,     { capture: true });
      window.removeEventListener('mousemove',   onMouseMove,   { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('auxclick',    onAuxClick,    { capture: true });
      window.removeEventListener('wheel',       onWheel,       { capture: true } as EventListenerOptions);
      window.removeEventListener('blur',        resetMouseButtons);
    };
  }, [allowOverrangeCameraZoom]);

  // ── Touch camera rotation (mobile/iPad) ──────────────────────────────────
  // A single touch that starts on the 3D canvas (wrapRef) rotates camera + player
  // the same way as PC right-click drag (charYawRef also updated → facing changes).
  // UI elements (joystick, buttons) have higher z-index and consume their own
  // touches, so they never reach wrapRef.
  useEffect(() => {
    const camTouchRef = { id: null as number | null, lastX: 0, lastY: 0 };

    const onTouchStart = (e: TouchEvent) => {
      if (camTouchRef.id !== null) return; // already tracking one finger
      const touch = e.changedTouches[0];
      const target = touch.target as HTMLElement;
      // Only start camera rotation if the touch landed on the canvas wrapper
      if (!wrapRef.current?.contains(target)) return;
      camTouchRef.id    = touch.identifier;
      camTouchRef.lastX = touch.clientX;
      camTouchRef.lastY = touch.clientY;
      manualCameraLookActiveRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (camTouchRef.id === null) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === camTouchRef.id);
      if (!touch) return;
      const dx = touch.clientX - camTouchRef.lastX;
      const dy = touch.clientY - camTouchRef.lastY;
      camTouchRef.lastX = touch.clientX;
      camTouchRef.lastY = touch.clientY;
      // Right-click behaviour: camera + character facing both rotate
      camYawRef.current  -= dx * 0.005;
      if (!meActiveDashRef.current || dashTurnOverrideRef.current) {
        charYawRef.current  = camYawRef.current;
        localFacingRef.current = {
          x: Math.sin(charYawRef.current),
          y: -Math.cos(charYawRef.current),
        };
      }
      const newPitch = camPitchRef.current + dy * 0.003;
      camPitchRef.current = clampCameraPitch(newPitch, mode);
      cameraLookInputVersionRef.current += 1;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === camTouchRef.id);
      if (touch) {
        camTouchRef.id = null;
        manualCameraLookActiveRef.current = false;
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove',  onTouchMove,  { passive: true });
    window.addEventListener('touchend',   onTouchEnd,   { passive: true });
    window.addEventListener('touchcancel',onTouchEnd,   { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove',  onTouchMove);
      window.removeEventListener('touchend',   onTouchEnd);
      window.removeEventListener('touchcancel',onTouchEnd);
    };
  }, []);

  const handleJoystickDirection = useCallback(
    (keys: { w: boolean; a: boolean; s: boolean; d: boolean }) => {
      const nextKeys = { ...keys };
      if (nextKeys.s && autoForwardRef.current) {
        autoForwardRef.current = false;
        setAutoForward(false);
      }
      if (autoForwardRef.current && !nextKeys.s) {
        nextKeys.w = true;
      }
      keysRef.current = nextKeys;
      setWasdKeys(nextKeys);
    },
    [],
  );

  // Analog joystick direction — stored separately and used in sendMovement
  const handleJoystickAnalog = useCallback((dx: number, dy: number) => {
    joystickDirRef.current = (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) ? { dx, dy } : null;
  }, []);

  // Jump triggered from the virtual joystick's jump button  
  const handleJoystickJump = useCallback(() => {
    tryQueueLocalJump();
  }, [tryQueueLocalJump]);

  /* Physics — mirrors server exactly */
  useEffect(() => {
    const CLIENT_TICK_HZ = 30;
    const CLIENT_TICK_MS = 1000 / CLIENT_TICK_HZ;
    // Match backend movement constants at 30Hz.
    const UNIT_SCALE = getStoredUnitScale(mode);
    const DEFAULT_MOVE_SPEED_WORLD_PER_TICK = getDefaultMoveSpeedPerTick(mode);
    const UPWARD_JUMP_AIR_SHIFT_DISTANCE = getUpwardJumpAirShiftDistance(mode);
    const DIRECTIONAL_JUMP_DISTANCE = getDirectionalJumpDistance(mode);
    const MAX_SPEED = 0.1666667 * UNIT_SCALE, ACCEL = 0.3, DECEL = 0.9;
    // 30 Hz client physics — asymmetric gravity, tuned per jump type:
    //   Single jump : 1.7 u peak, 1.0 s rise, 0.7 s fall  → 1.7 s total
    //   Double jump : +0.755 u extra (peak 2.455 u)         → ~2.51 s total from takeoff
    //   Power jump  : 12.8 u peak, 1.77 s rise, 1.93 s fall → 3.7 s total
    const GRAVITY_UP_CLIENT         = 2 * 1.7  * UNIT_SCALE / (30 * 30);   // ≈ 0.008311 (regular rise)
    const GRAVITY_DOWN_CLIENT       = 2 * 1.7  * UNIT_SCALE / (21 * 21);   // ≈ 0.016962 (regular fall, 0.7 s)
    const JUMP_VZ_CLIENT            = GRAVITY_UP_CLIENT * 30;               // ≈ 0.24933 (1.0 s → 1.7 u)
    const DOUBLE_JUMP_VZ_CLIENT     = GRAVITY_UP_CLIENT * 20;               // ≈ 0.16622 (+0.755 u → 2.51 s total)
    const POWER_GRAVITY_UP_CLIENT   = 2 * 12.8 * UNIT_SCALE / (53.1 * 53.1); // ≈ 0.019974 (1.77 s rise)
    const POWER_GRAVITY_DOWN_CLIENT = 2 * 12.8 * UNIT_SCALE / (57.9 * 57.9); // ≈ 0.016799 (1.93 s fall)
    const POWER_JUMP_VZ_CLIENT      = POWER_GRAVITY_UP_CLIENT * 53.1;        // ≈ 1.0606  (12.8 u peak)
    // 扶摇直上 + 鸟翔碧空 combined: 24u peak, same 53.1-tick rise / 57.9-tick fall
    const COMBINED_GRAVITY_UP_CLIENT   = 2 * 24 * UNIT_SCALE / (53.1 * 53.1);
    const COMBINED_GRAVITY_DOWN_CLIENT = 2 * 24 * UNIT_SCALE / (57.9 * 57.9);
    const COMBINED_JUMP_VZ_CLIENT      = COMBINED_GRAVITY_UP_CLIENT * 53.1;
    const POWER_DIRECTIONAL_JUMP_DISTANCE = 18 * UNIT_SCALE;
    const POWER_DOUBLE_DIRECTIONAL_JUMP_DISTANCE = 12 * UNIT_SCALE;
    const MULTI_JUMP_DIRECTIONAL_JUMP_DISTANCE = 12 * UNIT_SCALE;
    const MULTI_JUMP_HEIGHT_MULT = Math.sqrt(3); // 鸟翔碧空: 3× height → √3× velocity
    const TURN_RATE = 0.055; // radians / tick at 30 Hz ≈ 95°/sec
    const tick = () => {
      const tickNowMs = performance.now();
      const pos = localPositionRef.current;
      if (!pos) {
        cameraMoveCommandActiveRef.current = false;
        return;
      }
      if (mode === 'collision-test' && !collisionReadyRef.current) {
        cameraMoveCommandActiveRef.current = false;
        localVelocityRef.current = { x: 0, y: 0 };
        localVzRef.current = 0;
        return;
      }
      const effectiveMaxSpeed = MAX_SPEED * moveSpeedScaleRef.current;
      const effectiveMaxJumps = getEffectiveMaxJumps();

      // During server-authoritative dash: skip movement + gravity, but KEEP camera/turning
      if (meActiveDashRef.current) {
        cameraMoveCommandActiveRef.current = false;
        localVelocityRef.current.x = 0;
        localVelocityRef.current.y = 0;
        jumpLocalRef.current = false;
        // Post-dash jump allowance: MULTI_JUMP → full reset, normal → 1 jump only
        localJumpCountRef.current = effectiveMaxJumps > 2 ? 0 : 1;
        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;
        // Still allow A/D camera turning while dashing
        const k = keysRef.current;
        const ms = mouseStateRef.current;
        if (controlModeRef.current === 'traditional' && !ms.isRight) {
          const turning = (k.a ? 1 : 0) + (k.d ? -1 : 0);
          if (turning !== 0) {
            camYawRef.current  += turning * TURN_RATE;
          }
        }
        return;
      }

      const vel = localVelocityRef.current;
      const k   = keysRef.current;
      const ms  = mouseStateRef.current;
      const objs = mapObjectsRef.current;
      const useBVH = mode === 'collision-test' && !!collisionSysRef.current;
      const tickGroundH = (() => {
        if (!useBVH) {
          return getGroundHeightClient(pos.x, pos.y, localZRef.current, objs, playerRadius);
        }

        const sys = collisionSysRef.current!;
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        _bvhCenter.set(
          (pos.x - halfW - GROUP_POS_X) / RENDER_SF,
          (localZRef.current - GROUP_POS_Y) / RENDER_SF + EXPORT_CYL_HALF_HEIGHT,
          (halfH - pos.y - GROUP_POS_Z) / RENDER_SF,
        );
        const supportY = getBvhGroundSupportY(sys, _bvhCenter);
        if (supportY === null) {
          return getGroundHeightClient(pos.x, pos.y, localZRef.current, objs, playerRadius);
        }
        return supportY * RENDER_SF + GROUP_POS_Y;
      })();
      const airborne = localZRef.current > tickGroundH + 0.01;
      groundHRef.current = tickGroundH; // keep height display in sync
      if (groundBaseRef.current === null) groundBaseRef.current = tickGroundH; // init baseline once
      if (!airborne && localJumpCountRef.current === 0) {
        airborneSpeedCarryRef.current = 0;
      }
      const { fullyLocked, rooted } = movementControlStateRef.current;
      const movementLocked = fullyLocked || rooted;
      const preserveUpwardJumpRise =
        airborne &&
        localJumpCountRef.current > 0 &&
        localVzRef.current > 0.01 &&
        !airDirectionLockedRef.current &&
        !airNudgeDirRef.current;

      if (movementLocked && !preserveUpwardJumpRise) {
        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;
        airborneSpeedCarryRef.current = 0;
        vel.x = 0;
        vel.y = 0;
        if (airborne) {
          localVzRef.current = Math.min(localVzRef.current, -0.0001);
        }
      }

      let airNudgeDx = 0;
      let airNudgeDy = 0;
      let moveIntentDx = 0;
      let moveIntentDy = 0;
      const jumpAirborne = airborne && localJumpCountRef.current > 0;

      if (jumpLocalRef.current && localJumpCountRef.current >= effectiveMaxJumps) {
        jumpLocalRef.current = false;
      }

      if (controlModeRef.current === 'traditional') {
        const mouseLook = ms.isRight;
        const bothMouse = ms.isRight && ms.isLeft;

        if (movementLocked) {
          cameraMoveCommandActiveRef.current = false;
        } else if (mouseLook) {
          // MMO mouselook: camera turns from mouse; movement is camera-relative.
          // Facing follows movement intent except pure backpedal.
        } else {
          // WoW-style keyboard turning: A/D turn camera AND character together immediately.
          const turning = (k.a ? 1 : 0) + (k.d ? -1 : 0);
          if (turning !== 0) {
            camYawRef.current  += turning * TURN_RATE;
            charYawRef.current  = camYawRef.current;
            localFacingRef.current = {
              x: Math.sin(charYawRef.current),
              y: -Math.cos(charYawRef.current),
            };
          }
        }

        const moveIntent = buildTraditionalMoveIntent(
          k,
          mouseLook,
          bothMouse,
          camYawRef.current,
          charYawRef.current,
        );
        const moveDirection = movementLocked ? null : moveIntent.direction;
        cameraMoveCommandActiveRef.current = !!moveDirection;
        moveIntentDx = moveDirection?.dx ?? 0;
        moveIntentDy = moveDirection?.dy ?? 0;

        if (jumpAirborne) {
          airNudgeDx = moveIntentDx;
          airNudgeDy = moveIntentDy;
        } else if (moveDirection) {
          vel.x += (moveDirection.dx * effectiveMaxSpeed - vel.x) * ACCEL;
          vel.y += (moveDirection.dy * effectiveMaxSpeed - vel.y) * ACCEL;

          if (!moveIntent.backpedalOnly) {
            const facingDir = normalizePlanar(moveDirection.dx, moveDirection.dy);
            if (facingDir) {
              localFacingRef.current = facingDir;
              charYawRef.current = facingToYaw(facingDir);
            }
          } else if (mouseLook) {
            const facingDir = {
              x: Math.sin(camYawRef.current),
              y: -Math.cos(camYawRef.current),
            };
            localFacingRef.current = facingDir;
            charYawRef.current = facingToYaw(facingDir);
          }
        } else {
          if (!airborne) {
            vel.x *= DECEL;
            vel.y *= DECEL;
          }
          if (mouseLook && !movementLocked) {
            const facingDir = {
              x: Math.sin(camYawRef.current),
              y: -Math.cos(camYawRef.current),
            };
            localFacingRef.current = facingDir;
            charYawRef.current = facingToYaw(facingDir);
          }
        }
      } else {
        // 摇杆模式: WASD = absolute world directions
        let ix = 0, iy = 0;
        if (k.w) iy += 1;
        if (k.s) iy -= 1;
        if (k.a) ix -= 1;
        if (k.d) ix += 1;
        const moveDir = movementLocked ? null : normalizePlanar(ix, iy);
        cameraMoveCommandActiveRef.current = !!moveDir || (!movementLocked && !!joystickDirRef.current);
        moveIntentDx = moveDir?.x ?? 0;
        moveIntentDy = moveDir?.y ?? 0;
        if (jumpAirborne) {
          airNudgeDx = moveIntentDx;
          airNudgeDy = moveIntentDy;
        } else if (moveDir) {
          vel.x += (moveDir.x * effectiveMaxSpeed - vel.x) * ACCEL;
          vel.y += (moveDir.y * effectiveMaxSpeed - vel.y) * ACCEL;
          localFacingRef.current = moveDir;
          charYawRef.current = facingToYaw(moveDir);
        } else if (!airborne) {
          vel.x *= DECEL;
          vel.y *= DECEL;
        }
      }

      // Upward jump: first mid-air direction input locks the drift direction for this jump phase.
      if (
        jumpAirborne &&
        !jumpLocalRef.current &&
        airNudgeRemainingRef.current > 0 &&
        airNudgeTicksRemainingRef.current <= 0 &&
        !airDirectionLockedRef.current
      ) {
        const airDir = normalizePlanar(airNudgeDx, airNudgeDy);
        if (airDir) {
          airNudgeDirRef.current = airDir;
          airNudgeTicksRemainingRef.current = AIR_SHIFT_DURATION_TICKS;
          airDirectionLockedRef.current = true;
          if (jumpTelemetryRef.current?.mode === 'upward') {
            jumpTelemetryRef.current.expectedLandWorld = UPWARD_JUMP_AIR_SHIFT_DISTANCE;
          }
        }
      }

      if (airborne) {
        const planarAirborneSpeed = Math.max(
          Math.hypot(vel.x, vel.y),
          getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current),
        );
        if (planarAirborneSpeed > 0.0001) {
          airborneSpeedCarryRef.current = planarAirborneSpeed;
        }
      }

      let nudgeX = 0;
      let nudgeY = 0;
      if (
        airborne &&
        !jumpLocalRef.current &&
        airNudgeTicksRemainingRef.current > 0 &&
        airNudgeRemainingRef.current > 0 &&
        airNudgeDirRef.current
      ) {
        const ticksLeft = Math.max(1, airNudgeTicksRemainingRef.current);
        const step = Math.min(airNudgeRemainingRef.current, airNudgeRemainingRef.current / ticksLeft);
        nudgeX = airNudgeDirRef.current.x * step;
        nudgeY = airNudgeDirRef.current.y * step;
        airNudgeRemainingRef.current = Math.max(0, airNudgeRemainingRef.current - step);
        airNudgeTicksRemainingRef.current = Math.max(0, airNudgeTicksRemainingRef.current - 1);
        if (airNudgeRemainingRef.current <= 0 || airNudgeTicksRemainingRef.current <= 0) {
          airNudgeRemainingRef.current = 0;
          airNudgeTicksRemainingRef.current = 0;
          airNudgeDirRef.current = null;
        }
      }

      let newPx = Math.max(playerRadius, Math.min(ARENA_WIDTH - playerRadius, pos.x + vel.x + nudgeX));
      let newPy = Math.max(playerRadius, Math.min(ARENA_HEIGHT - playerRadius, pos.y + vel.y + nudgeY));

      // Map object collision

      if (useBVH) {
        // ── BVH sphere collision (matches export-reader exactly) ──
        const sys = collisionSysRef.current!;
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        // ── Cylinder horizontal pass ──
        // _bvhCenter.y = cylinder centre (feet + half-height); preserved between ticks.
        // Only update X/Z for horizontal movement; Y is owned by the vertical pass.
        _bvhCenter.x = (newPx - halfW - GROUP_POS_X) / RENDER_SF;
        _bvhCenter.z = (halfH - newPy - GROUP_POS_Z) / RENDER_SF;
        if (!bvhCenterYInitRef.current) {
          // First tick after spawn/teleport: set centre from current feet position.
          _bvhCenter.y = (localZRef.current - GROUP_POS_Y) / RENDER_SF + EXPORT_CYL_HALF_HEIGHT;
          bvhCenterYInitRef.current = true;
        }
        // Sphere at cylinder centre provides correct horizontal wall push (push.y=0 for walls)
        _bvhVelocity.set(
          (vel.x + nudgeX) / RENDER_SF,
          0, // vertical handled separately; don't let wall contacts corrupt Vz
          -(vel.y + nudgeY) / RENDER_SF,
        );
        sys.resolveSphereCollision(_bvhCenter, EXPORT_CYL_RADIUS, _bvhVelocity);

        // Convert back → game horizontal (clamp to arena bounds)
        newPx = Math.max(playerRadius, Math.min(ARENA_WIDTH - playerRadius,
          _bvhCenter.x * RENDER_SF + GROUP_POS_X + halfW));
        newPy = Math.max(playerRadius, Math.min(ARENA_HEIGHT - playerRadius,
          halfH - (_bvhCenter.z * RENDER_SF + GROUP_POS_Z)));
        // Do NOT read _bvhVelocity.y here — vertical velocity is managed by the vertical pass.
      } else {
        for (const obj of objs) {
          const resolved = resolveObjCollisionClient(newPx, newPy, localZRef.current, vel, obj, playerRadius);
          newPx = resolved.x;
          newPy = resolved.y;
        }
      }

      localPositionRef.current = { x: newPx, y: newPy };

      // ── Z axis: jump + gravity ──
      if (!movementLocked && jumpLocalRef.current && localJumpCountRef.current < effectiveMaxJumps) {
        const jumpDir = normalizePlanar(moveIntentDx, moveIntentDy);
        const isMultiJump = effectiveMaxJumps > 2;
        const hadPowerJumpAirtime = isPowerJumpRef.current && !isPowerJumpCombinedRef.current && localJumpCountRef.current > 0;
        const usePowerDirectionalBudget = hasFuyaoBuffRef.current;
        const heightAboveGround = Math.max(0, localZRef.current - tickGroundH);
        const jumpSpeedSource = Math.max(
          effectiveMaxSpeed,
          airborneSpeedCarryRef.current,
          Math.hypot(vel.x, vel.y),
          getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current),
        );
        const jumpSpeedScale = DEFAULT_MOVE_SPEED_WORLD_PER_TICK > 0.0001
          ? jumpSpeedSource / DEFAULT_MOVE_SPEED_WORLD_PER_TICK
          : 0;
        let jumpVz: number;
        let jumpGravityUp = GRAVITY_UP_CLIENT;
        let jumpGravityDown = GRAVITY_DOWN_CLIENT;
        if (hasFuyaoBuffRef.current && isMultiJump) {
          // Combined 扶摇直上 + 鸟翔碧空: 24u peak, same timing as power jump
          jumpVz = COMBINED_JUMP_VZ_CLIENT;
          jumpGravityUp = COMBINED_GRAVITY_UP_CLIENT;
          jumpGravityDown = COMBINED_GRAVITY_DOWN_CLIENT;
          isPowerJumpCombinedRef.current = true;
          isPowerJumpRef.current = false;
        } else if (hasFuyaoBuffRef.current) {
          jumpVz = POWER_JUMP_VZ_CLIENT;
          jumpGravityUp = POWER_GRAVITY_UP_CLIENT;
          jumpGravityDown = POWER_GRAVITY_DOWN_CLIENT;
          isPowerJumpRef.current = true;
          isPowerJumpCombinedRef.current = false;
        } else if (localJumpCountRef.current === 0) {
          jumpVz = isMultiJump ? JUMP_VZ_CLIENT * MULTI_JUMP_HEIGHT_MULT : JUMP_VZ_CLIENT;
          isPowerJumpRef.current = false;
          isPowerJumpCombinedRef.current = false;
        } else {
          // 鸟翔碧空: every jump is full 3× strength
          jumpVz = isMultiJump ? JUMP_VZ_CLIENT * MULTI_JUMP_HEIGHT_MULT : DOUBLE_JUMP_VZ_CLIENT;
          isPowerJumpRef.current = false;
          isPowerJumpCombinedRef.current = false;
        }
        const directionalJumpDistance = usePowerDirectionalBudget
          ? POWER_DIRECTIONAL_JUMP_DISTANCE
          : hadPowerJumpAirtime
            ? POWER_DOUBLE_DIRECTIONAL_JUMP_DISTANCE
            : isMultiJump && !hasFuyaoBuffRef.current
              ? MULTI_JUMP_DIRECTIONAL_JUMP_DISTANCE
            : DIRECTIONAL_JUMP_DISTANCE;
        hasFuyaoBuffRef.current   = false;
        localVzRef.current        = jumpVz;
        vel.x = 0;
        vel.y = 0;
        const nextJumpPhase = localJumpCountRef.current + 1;
        localJumpCountRef.current = nextJumpPhase;
        jumpLocalRef.current       = false;
        airborneSpeedCarryRef.current = jumpSpeedSource;
        jumpTelemetryRef.current = {
          startMs: tickNowMs,
          peakMs: tickNowMs,
          takeoffGround: tickGroundH,
          peakHeightWorld: 0,
          takeoffPos: {
            x: localPositionRef.current?.x ?? pos.x,
            y: localPositionRef.current?.y ?? pos.y,
          },
          expectedLandWorld: jumpDir ? directionalJumpDistance * Math.max(0, jumpSpeedScale) : 0,
          startSpeedUnitsPerSec: (jumpSpeedSource * CLIENT_TICK_HZ) / UNIT_SCALE,
          jumpPhase: nextJumpPhase,
          mode: jumpDir ? 'directional' : 'upward',
        };

        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;

        if (jumpDir) {
          airNudgeRemainingRef.current = directionalJumpDistance * Math.max(0, jumpSpeedScale);
          airNudgeTicksRemainingRef.current = estimateAirborneTicks(
            heightAboveGround,
            jumpVz,
            jumpGravityUp,
            jumpGravityDown,
          );
          airNudgeDirRef.current = jumpDir;
          airDirectionLockedRef.current = true;
          localFacingRef.current = jumpDir;
          charYawRef.current = facingToYaw(jumpDir);
        } else {
          airNudgeRemainingRef.current = UPWARD_JUMP_AIR_SHIFT_DISTANCE;
        }
      }
      const gravUp   = isPowerJumpCombinedRef.current ? COMBINED_GRAVITY_UP_CLIENT
                     : isPowerJumpRef.current         ? POWER_GRAVITY_UP_CLIENT
                     : GRAVITY_UP_CLIENT;
      const gravDown = isPowerJumpCombinedRef.current ? COMBINED_GRAVITY_DOWN_CLIENT
                     : isPowerJumpRef.current         ? POWER_GRAVITY_DOWN_CLIENT
                     : GRAVITY_DOWN_CLIENT;
      localVzRef.current -= (localVzRef.current >= 0 ? gravUp : gravDown);

      // Ground height: BVH cylinder (collision-test) or AABB (other modes)
      let clientGroundH: number;
      if (useBVH) {
        const sys = collisionSysRef.current!;
        // ── Cylinder vertical pass ──
        // Apply gravity to cylinder centre (feet + halfHeight).
        _bvhCenter.y += localVzRef.current / RENDER_SF;

        const ceilingExportY = getBvhCeilingY(sys, _bvhCenter);
        const headExportY = _bvhCenter.y + EXPORT_CYL_HALF_HEIGHT;
        if (localVzRef.current > 0 && ceilingExportY !== null && headExportY >= ceilingExportY) {
          _bvhCenter.y = ceilingExportY - EXPORT_CYL_HALF_HEIGHT;
          localVzRef.current = -0.0001;
        }

        const groundExportY = getBvhGroundSupportY(sys, _bvhCenter);
        const feetExportY   = _bvhCenter.y - EXPORT_CYL_HALF_HEIGHT;
        let bvhOnGround = false;

        if (groundExportY !== null) {
          const gap = feetExportY - groundExportY; // negative → below surface, positive → above
          if (gap <= 0) {
            // Feet at or below terrain surface → snap up, land
            _bvhCenter.y    = groundExportY + EXPORT_CYL_HALF_HEIGHT;
            localVzRef.current = 0;
            bvhOnGround     = true;
          } else if (
            gap <= BVH_STEP_UP_EXPORT &&
            localVzRef.current <= 0 &&
            localJumpCountRef.current === 0
          ) {
            // Small gap while falling/standing → step-up snap (stairs / lips)
            _bvhCenter.y    = groundExportY + EXPORT_CYL_HALF_HEIGHT;
            localVzRef.current = 0;
            bvhOnGround     = true;
          }
        }

        // Fall recovery: if somehow far below terrain, teleport up
        const floorY = groundExportY ?? feetExportY;
        if (_bvhCenter.y - EXPORT_CYL_HALF_HEIGHT < floorY - 3500) {
          _bvhCenter.y    = floorY + EXPORT_CYL_HALF_HEIGHT + 120;
          localVzRef.current = 0;
        }

        collisionDebugRef.current = {
          enabled: true,
          center: { x: _bvhCenter.x, y: _bvhCenter.y, z: _bvhCenter.z },
          supportY: groundExportY,
        };

        // Feet = cylinder bottom = exact terrain surface when grounded (no slope float)
        const feetGameZ = (_bvhCenter.y - EXPORT_CYL_HALF_HEIGHT) * RENDER_SF + GROUP_POS_Y;
        localZRef.current = feetGameZ;
        clientGroundH = bvhOnGround
          ? feetGameZ
          : (groundExportY !== null ? groundExportY * RENDER_SF + GROUP_POS_Y : feetGameZ);
      } else {
        clientGroundH = getGroundHeightClient(localPositionRef.current.x, localPositionRef.current.y, localZRef.current, objs, playerRadius);
        localZRef.current = Math.max(clientGroundH, localZRef.current + localVzRef.current);
      }
      if (jumpTelemetryRef.current) {
        const currentHeightWorld = Math.max(0, localZRef.current - jumpTelemetryRef.current.takeoffGround);
        if (currentHeightWorld >= jumpTelemetryRef.current.peakHeightWorld - 0.001) {
          jumpTelemetryRef.current.peakHeightWorld = Math.max(jumpTelemetryRef.current.peakHeightWorld, currentHeightWorld);
          jumpTelemetryRef.current.peakMs = tickNowMs;
        }
      }
      if (localZRef.current <= clientGroundH) {
        const telemetry = jumpTelemetryRef.current;
        if (telemetry) {
          const landPos = localPositionRef.current ?? pos;
          const actualLandWorld = Math.hypot(
            landPos.x - telemetry.takeoffPos.x,
            landPos.y - telemetry.takeoffPos.y,
          );
          jumpRecordNextRef.current = {
            riseMs: Math.max(0, telemetry.peakMs - telemetry.startMs),
            fallMs: Math.max(0, tickNowMs - telemetry.peakMs),
            totalMs: Math.max(0, tickNowMs - telemetry.startMs),
            peakUnits: telemetry.peakHeightWorld / UNIT_SCALE,
            startSpeedUnitsPerSec: telemetry.startSpeedUnitsPerSec,
            expectedLandUnits: telemetry.expectedLandWorld / UNIT_SCALE,
            actualLandUnits: actualLandWorld / UNIT_SCALE,
            jumpPhase: telemetry.jumpPhase,
            mode: telemetry.mode,
          };
          jumpTelemetryRef.current = null;
        }
        localZRef.current              = clientGroundH;
        localVzRef.current             = 0;
        localJumpCountRef.current      = 0;
        isPowerJumpRef.current         = false;
        isPowerJumpCombinedRef.current = false;
        airDirectionLockedRef.current  = false;
        airborneSpeedCarryRef.current  = 0;
        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
      }
    };
    const id = setInterval(tick, CLIENT_TICK_MS);
    return () => clearInterval(id);
  }, [ARENA_HEIGHT, ARENA_WIDTH, getEffectiveMaxJumps, mode, playerRadius]);

  useEffect(() => {
    const id = setInterval(sendMovement, 1000 / 30);
    return () => { clearInterval(id); };
  }, [sendMovement]);

  useEffect(() => {
    const id = setInterval(async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/game/ping', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify({ gameId }),
        });
        setRtt(Math.round(performance.now() - t0));
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(id);
  }, [gameId]);

  /* ========================= HUD DATA ========================= */
  const myMaxHp = me?.maxHp ?? maxHp;
  const myShield = Math.max(0, me?.shield ?? 0);
  const myBarSegments = computeHpShieldSegments(me?.hp ?? 0, myShield, myMaxHp);
  const myHpPct = myBarSegments.hpPct;
  const myShieldPct = myBarSegments.shieldPct;
  const myFacingArrow = facingArrow(localFacingRef.current);
  const meEffects = (me?.buffs ?? []).flatMap((b: any) => Array.isArray(b?.effects) ? b.effects : []);
  const moveSpeedBoostSum = meEffects
    .filter((e: any) => e?.type === 'SPEED_BOOST')
    .reduce((sum: number, e: any) => sum + Number(e?.value ?? 0), 0);
  const moveSpeedSlowSum = meEffects
    .filter((e: any) => e?.type === 'SLOW')
    .reduce((sum: number, e: any) => sum + Number(e?.value ?? 0), 0);
  const baseMoveSpeed = Number(me?.moveSpeed ?? getDefaultMoveSpeedPerTick(mode));
  const finalMoveSpeed = Math.max(0, baseMoveSpeed * Math.max(0, 1 + moveSpeedBoostSum - moveSpeedSlowSum));
  const baseMoveSpeedUnitsPerSec = baseMoveSpeed * SERVER_TICK_RATE / storedUnitScale;
  const effectiveMoveSpeedUnitsPerSec = finalMoveSpeed * SERVER_TICK_RATE / storedUnitScale;
  const damageReductionEffect = meEffects.find((e: any) => e?.type === 'DAMAGE_REDUCTION');
  const damageReductionPct = Math.max(0, Number(damageReductionEffect?.value ?? 0) * 100);
  const dodgeChancePct = Math.max(
    0,
    Math.min(
      100,
      meEffects
        .filter((e: any) => e?.type === 'DODGE_NEXT')
        .reduce((sum: number, e: any) => sum + Number(e?.chance ?? 0), 0) * 100,
    ),
  );

    const startSpeedTest = useCallback(() => {
      const pos = localPositionRef.current;
      const now = performance.now();
      speedTestRunRef.current = {
        active: true,
        distanceWorld: 0,
        validElapsedMs: 0,
        maxUnitsPerSec: 0,
      };
      speedSamplePrevRef.current = pos ? { x: pos.x, y: pos.y, t: now } : null;
      setSpeedTestState((prev) => ({
        ...prev,
        active: true,
        measuredDistanceUnits: 0,
        measuredElapsedMs: 0,
        averageUnitsPerSec: 0,
        maxUnitsPerSec: 0,
      }));
    }, []);

    const stopSpeedTest = useCallback(() => {
      speedTestRunRef.current = {
        ...speedTestRunRef.current,
        active: false,
      };
      setSpeedTestState((prev) => ({ ...prev, active: false }));
    }, []);

    const resetSpeedTest = useCallback(() => {
      const pos = localPositionRef.current;
      const now = performance.now();
      speedTestRunRef.current = {
        active: false,
        distanceWorld: 0,
        validElapsedMs: 0,
        maxUnitsPerSec: 0,
      };
      speedSamplePrevRef.current = pos ? { x: pos.x, y: pos.y, t: now } : null;
      setSpeedTestState((prev) => ({
        ...prev,
        active: false,
        measuredDistanceUnits: 0,
        measuredElapsedMs: 0,
        averageUnitsPerSec: 0,
        maxUnitsPerSec: 0,
      }));
    }, []);

  const RARITY_ORDER: Record<string, number> = { '稀世': 0, '珍奇': 1, '卓越': 2, '精巧': 3 };
  const RARITY_COLOR: Record<string, string> = {
    '稀世': '#ff922b', '珍奇': '#cc5de8', '卓越': '#74c0fc', '精巧': '#69db7c',
  };
  const SCHOOL_COLOR: Record<string, string> = {
    '七秀': '#f9a8d4', '万花': '#b197fc', '五毒': '#60a5fa', '长歌': '#63e6be',
    '药宗': '#20c997', '天策': '#ff922b', '少林': '#fbbf24', '明教': '#f87171',
    '苍云': '#b08060', '纯阳': '#a5d8ff', '唐门': '#339af0', '藏剑': '#ffe066',
    '丐帮': '#ffa94d', '霸刀': '#4dabf7', '蓬莱': '#ced4da', '凌雪': '#e03131',
    '衍天': '#d0bfff', '刀宗': '#adb5bd', '万灵': '#fab005', '段氏': '#868e96', '通用': '#94a3b8',
  };
  const SCHOOL_TAGS_BA = ['少林','万花','天策','纯阳','七秀','藏剑','五毒','唐门','丐帮','明教','苍云','长歌','霸刀','蓬莱','凌雪','衍天','药宗','刀宗','万灵','段氏','通用'];

  const cheatAbilities = useMemo(
    () =>
      Object.values(abilities)
        .filter((c: any) => c && !c.isCommon && c.id && c.name)
        .sort((a: any, b: any) => {
          const ra = RARITY_ORDER[a.rarity] ?? 99;
          const rb = RARITY_ORDER[b.rarity] ?? 99;
          if (ra !== rb) return ra - rb;
          return a.name.localeCompare(b.name);
        }),
    [abilities],
  );

  const filteredCheatAbilities = useMemo(() => {
    let list = cheatAbilities;
    if (cheatRarityFilter === 'unset') list = list.filter((a: any) => !a.rarity);
    else if (cheatRarityFilter !== 'all') list = list.filter((a: any) => a.rarity === cheatRarityFilter);
    if (cheatSchoolFilter === 'unset') list = list.filter((a: any) => !a.tags?.school);
    else if (cheatSchoolFilter !== 'all') list = list.filter((a: any) => a.tags?.school === cheatSchoolFilter);
    return list;
  }, [cheatAbilities, cheatRarityFilter, cheatSchoolFilter]);

  const renderCheatIcon = (ability: any) => {
    const rarityBorderColor = ability.rarity ? RARITY_COLOR[ability.rarity] : '#555';
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={ability.id}
        src={`/icons/${ability.name}.png`}
        alt={ability.name}
        title={`${ability.name}${ability.rarity ? ` [${ability.rarity}]` : ''}${ability.description ? '\n' + ability.description : ''}`}
        style={{
          width: 32,
          height: 32,
          objectFit: 'contain',
          borderRadius: 4,
          border: `1.5px solid ${rarityBorderColor}`,
          cursor: addingAbility === ability.id ? 'wait' : 'pointer',
          opacity: addingAbility === ability.id ? 0.4 : 1,
          background: 'rgba(20,5,5,0.8)',
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
        onClick={async () => {
          if (addingAbility) return;
          setAddingAbility(ability.id);
          try {
            const res = await fetch('/api/game/cheat/add-ability', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ gameId, abilityId: ability.id }),
            });
            if (!res.ok) {
              const err = await res.json();
              console.error('[CheatWindow] add-ability failed:', err);
            }
          } catch (e) {
            console.error('[CheatWindow] error:', e);
          } finally {
            setAddingAbility(null);
          }
        }}
      />
    );
  };

  const runCheatAction = useCallback(
    async (actionId: string, url: string, successText: string, body?: Record<string, any>) => {
      if (runningCheatAction) return false;
      setRunningCheatAction(actionId);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ gameId, ...(body ?? {}) }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toastError(err.error ?? '操作失败');
          return false;
        }
        toastSuccess(successText);
        return true;
      } catch {
        toastError('网络错误');
        return false;
      } finally {
        setRunningCheatAction(null);
      }
    },
    [gameId, runningCheatAction],
  );

  const reorderDraftAbility = useCallback(
    async (instanceId: string, toIndex: number) => {
      const res = await fetch('/api/game/cheat/reorder-ability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, instanceId, toIndex }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toastError(err.error ?? '拖拽换位失败');
        return false;
      }
      return true;
    },
    [gameId],
  );

  const discardDraftAbility = useCallback(
    async (instanceId: string) => {
      const res = await fetch('/api/game/cheat/discard-ability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, instanceId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toastError(err.error ?? '弃置失败');
        return false;
      }
      toastSuccess('技能已弃置');
      return true;
    },
    [gameId],
  );

  const handleDraftDragStart = (e: React.DragEvent, instanceId: string, slotIndex: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', instanceId);
    dragJustEndedRef.current = false;
    setDraggingDraftInstanceId(instanceId);
    setDragHoverIndex(slotIndex);
    setDiscardZoneHover(false);
  };

  const handleDraftDragEnd = () => {
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setDiscardZoneHover(false);
    dragJustEndedRef.current = true;
    window.setTimeout(() => {
      dragJustEndedRef.current = false;
    }, 120);
  };

  const handleDraftSlotDrop = async (e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    const instanceId = e.dataTransfer.getData('text/plain') || draggingDraftInstanceId;
    if (!instanceId) return;
    await reorderDraftAbility(instanceId, slotIndex);
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setDiscardZoneHover(false);
  };

  const handleDiscardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const instanceId = e.dataTransfer.getData('text/plain') || draggingDraftInstanceId;
    if (!instanceId) return;
    await discardDraftAbility(instanceId);
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setDiscardZoneHover(false);
  };

  // Mouse move handler for debug cursor tracking
  const handleDebugMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!showDebugGrid) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDebugCursor({
      x: ((e.clientX - rect.left) / rect.width)  * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    });
  };

  return (
    <div
      className={styles.container}
      onMouseMove={handleDebugMouseMove}
      onMouseLeave={() => showDebugGrid && setDebugCursor(null)}
    >

      {/* ===== MODE INDICATOR ===== */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 500,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(12,18,16,0.78)',
        border: mode === 'arena' ? '1px solid rgba(255,60,60,0.70)' : '1px solid rgba(80,180,120,0.55)',
        borderRadius: 6,
        padding: '4px 10px',
        pointerEvents: 'none',
        backdropFilter: 'blur(2px)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: mode === 'arena' ? '#ff4444' : '#44cc88',
          boxShadow: mode === 'arena' ? '0 0 6px #ff2222' : '0 0 6px #22aa66',
          display: 'inline-block', flexShrink: 0,
        }} />
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '0.5px',
          color: mode === 'arena' ? '#ffaaaa' : '#aaeec8',
          fontFamily: '"Microsoft YaHei", sans-serif',
        }}>
          {mode === 'arena' ? '竞技场' : mode === 'collision-test' ? '玉门关' : '吃鸡'}
        </span>
      </div>
      {/* ===== FULL-SCREEN 3D CANVAS ===== */}
      {/* ===== R3F 3D CANVAS ===== */}
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <Canvas
          camera={{ fov: 72, near: 0.5, far: 2000 }}
          style={{ background: blueprintMode ? '#000010' : '#888888' }}
          gl={{ antialias: true }}
          shadows={mode === 'collision-test' && envToggles.shadows && !blueprintMode ? 'percentage' : false}
        >
          <ArenaScene
            me={me}
            opponents={visibleOpponentsList}
            selectedTargetId={selectedTargetId}
            onSelectTarget={(userId) => {
              const clicked = opponentsList.find((o) => o.userId === userId);
              if (clicked && blocksTargetingClient(clicked.buffs)) {
                toastError('目标不可选中');
                return;
              }
              setPendingGroundCastAbilityId(null);
              setGroundCastPreview(null);
              setSelectedTargetId(userId);
              selectedTargetRef.current = userId;
              setSelectedSelf(false);
              selectedSelfRef.current = false;
            }}
            pickups={modePickups}
            meChanneling={meChannelingRef.current}
            channelingOpponentId={visibleOpponentsList.find((o) => !!o?.buffs?.some((b: any) => b.buffId === 1014))?.userId ?? null}
            selectedSelf={selectedSelf}
            localRenderPosRef={localRenderPosRef}
            camYawRef={camYawRef}
            camPitchRef={camPitchRef}
            camZoomRef={camZoomRef}
            cameraMoveCommandActiveRef={cameraMoveCommandActiveRef}
            cameraLookInputVersionRef={cameraLookInputVersionRef}
            manualCameraLookActiveRef={manualCameraLookActiveRef}
            meFacingRef={localFacingRef as React.MutableRefObject<{ x: number; y: number }>}
            maxHp={maxHp}
            meScreenBoundsRef={meScreenBoundsRef}
            oppScreenBoundsRef={oppScreenBoundsRef}
            mode={mode}
            safeZone={safeZone}
            groundZones={groundZones}
            groundCastPreview={
              (() => {
                if (!groundCastPreview) return null;

                // Pending ground cast (e.g. 百足, 五方行尽)
                if (pendingGroundCastAbilityId) {
                  const previewAbilityInfo = abilitiesRef.current.find(
                    (a: any) => a.id === pendingGroundCastAbilityId
                  );
                  const previewAbilityId = previewAbilityInfo?.abilityId ?? pendingGroundCastAbilityId;
                  const previewAbility =
                    abilities[previewAbilityId] ??
                    Object.values(abilities).find((c: any) => c.id === previewAbilityId);
                  const previewRadiusUnits = Array.isArray((previewAbility as any)?.effects)
                    ? ((previewAbility as any).effects.find((e: any) =>
                        e.type === 'BAIZU_AOE' || e.type === 'WUFANG_XINGJIN_AOE'
                      )?.range ?? 6)
                    : 6;
                  return {
                    x: groundCastPreview.x,
                    y: groundCastPreview.y,
                    z: groundCastPreview.z,
                    radius: previewRadiusUnits * storedUnitScale,
                    label: previewAbilityInfo?.name ?? previewAbility?.name ?? '范围预览',
                    isValid: groundCastPreview.isValid !== false,
                  };
                }

                // No hover unless a pending ground cast is active
                return null;
              })()
            }
            onGroundPointerMove={(x, y, worldZ, isHorizontal) => {
              mouseWorldPosRef.current = { x, y, z: worldZ };
              // Only update preview state when there is an active pending ground cast
              if (pendingGroundCastAbilityRef.current) {
                setGroundCastPreview({ x, y, z: worldZ, isValid: isHorizontal !== false });
              }
            }}
            onGroundPointerDown={(x, y, worldZ) => {
              if (!pendingGroundCastAbilityRef.current) return;
              castGroundAbilityRef.current(x, y, worldZ);
            }}
            showCollisionShells={showCollisionShells}
            collisionReady={collisionReady}
            collisionSystemRef={collisionSysRef}
            collisionDebugRef={collisionDebugRef}
            onCollisionSystemReady={onCollisionSystemReady}
            onCameraDebugEvent={mode === 'collision-test' && showCameraEventTestingPanel ? appendCameraDebugEntry : undefined}
            losBlocker={losBlocker}
            blueprintMode={blueprintMode}
            losIsBlocked={draftAbilities.some(a => a.losBlocked) || commonAbilities.some(a => a.losBlocked)}
            onEnvDebug={mode === 'collision-test' && showEnvTestingPanel ? setEnvDebugInfo : undefined}
            envToggles={mode === 'collision-test' ? envToggles : undefined}
            dirLightConfig={mode === 'collision-test' ? dirLightConfig : undefined}
          />
          {/* Golden measurement line */}
          <MeasureLine3D
            pinA={measurePins[0] ?? null}
            pinB={measurePins[1] ?? null}
            halfX={ARENA_WIDTH / 2}
            halfY={ARENA_HEIGHT / 2}
          />
        </Canvas>
      </div>
      {mode === 'collision-test' && showEnvTestingPanel && (
        <div className={styles.uiFloatingPanel} style={{ top: 14, left: 14, width: 'min(360px, calc(100vw - 28px))' }}>
          <div className={styles.uiFloatingTitle}>灯光控制</div>
          <div className={styles.uiFloatingSection}>
            {([
              ['toneMapping', 'toneMapping'],
              ['exposure', '曝光'],
              ['shadows', '阴影'],
              ['dirLight', '方向光'],
              ['ambLight', '环境光'],
              ['hemiLight', '半球光'],
              ['fog', '雾效'],
              ['skyDome', '天空球'],
              ['cameraFar', '远裁剪'],
            ] as [keyof EnvToggles, string][]).map(([key, label]) => (
              <label key={key} className={styles.uiCheckboxRow}>
                <input
                  type="checkbox"
                  checked={envToggles[key]}
                  className={styles.uiCheckboxInput}
                  onChange={() => setEnvToggles(prev => {
                    const next = { ...prev, [key]: !prev[key] };
                    if (key === 'dirLight' && next.dirLight) {
                      next.toneMapping = true;
                      next.exposure = true;
                      next.ambLight = true;
                      next.hemiLight = true;
                      next.shadows = true;
                      next.cameraFar = true;
                    }
                    return next;
                  })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className={styles.uiFloatingSubsection}>
            <div className={styles.uiFloatingLabel}>太阳亮度 {dirLightConfig.intensity.toFixed(2)}</div>
            <input
              type="range"
              min="0"
              max="6"
              step="0.05"
              value={dirLightConfig.intensity}
              onChange={(e) => setDirLightConfig((prev) => ({ ...prev, intensity: Number(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <div className={styles.uiFloatingLabel} style={{ marginTop: 10 }}>太阳颜色</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="color"
                value={dirLightConfig.customColor}
                onChange={(e) => setDirLightConfig((prev) => ({
                  ...prev,
                  colorMode: 'custom',
                  customColor: e.target.value,
                }))}
              />
              <button type="button" onClick={() => setDirLightConfig({ intensity: 3.0, colorMode: 'export', customColor: '#fdf2ed' })} className={styles.uiInlineButton}>导出默认</button>
              <button type="button" onClick={() => setDirLightConfig({ intensity: 0.25, colorMode: 'export', customColor: '#fdf2ed' })} className={styles.uiInlineButton}>低亮默认</button>
            </div>
          </div>
        </div>
      )}

      {mode === 'collision-test' && showSceneTestingPanel && (
        <div className={styles.uiInfoPanel} style={{ left: '5%', top: '50%', transform: 'translateY(-50%)' }}>
          <div className={styles.uiFloatingTitle}>角色状态</div>
          <div className={styles.uiInfoValue}>位置 {localRenderPosRef.current.x.toFixed(1)}, {localRenderPosRef.current.y.toFixed(1)}</div>
          <div className={styles.uiInfoValue}>移速 {effectiveMoveSpeedUnitsPerSec.toFixed(2)}</div>
          <div className={styles.uiInfoValue}>镜头距离 {cameraZoomLevel.toFixed(2)}</div>
          <div className={styles.uiInfoValue}>广角 {CAMERA_FOV}</div>
        </div>
      )}

      {mode === 'collision-test' && showCameraEventTestingPanel && (
        <div
          className={styles.uiFloatingPanel}
          style={{
            left: '5%',
            top: '60%',
            width: 'min(420px, calc(100vw - 28px))',
            maxHeight: '34vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            paddingBottom: 10,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div className={styles.uiFloatingTitle}>镜头事件</div>
              <div className={styles.uiInlineHint}>记录镜头卡墙、贴墙、回正和跳变事件</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className={styles.uiInlineButton} onClick={clearCameraDebugEntries}>清空</button>
              <button type="button" className={styles.uiInlineButton} onClick={() => void copyCameraDebugEntries()}>复制</button>
            </div>
          </div>

          <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.86)' }}>
            已记录 {cameraDebugEntries.length} 条
          </div>

          <div
            style={{
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: '24vh',
              paddingRight: 4,
            }}
          >
            {cameraDebugEntries.length === 0 ? (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.58)', lineHeight: 1.5 }}>
                暂无镜头事件。发生卡墙、贴身、回正或明显跳变时会自动写入这里。
              </div>
            ) : cameraDebugEntries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.28)',
                  padding: '7px 8px',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.9)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.45,
                }}
              >
                {formatCameraDebugEntry(entry)}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'collision-test' && (showCollisionControlPanel || showScreenCoordPanel) && (
        <div className={styles.uiTopRightStack}>
          {showCollisionControlPanel && (
            <>
              <label className={`${styles.uiCheckboxRow} ${styles.uiCheckboxBox}`}>
                <input type="checkbox" checked={showCollisionShells} className={styles.uiCheckboxInput} onChange={(e) => setShowCollisionShells(e.target.checked)} />
                <span>显示碰撞体</span>
              </label>
              <label className={`${styles.uiCheckboxRow} ${styles.uiCheckboxBox}`}>
                <input type="checkbox" checked={blueprintMode} className={styles.uiCheckboxInput} onChange={(e) => setBlueprintMode(e.target.checked)} />
                <span>显示蓝本</span>
              </label>
            </>
          )}
          {showScreenCoordPanel && (
            <label className={`${styles.uiCheckboxRow} ${styles.uiCheckboxBox}`}>
              <input type="checkbox" checked={showDebugGrid} className={styles.uiCheckboxInput} onChange={(e) => setShowDebugGrid(e.target.checked)} />
              <span>显示屏幕坐标</span>
            </label>
          )}
        </div>
      )}

      {mode === 'collision-test' && showMeasurePanel && (
        <div className={styles.uiFloatingPanel} style={{ left: '70%', top: '60%', width: 220, transform: 'translate(-50%, -50%)' }}>
          <div className={styles.uiFloatingTitle}>距离测试</div>
          <div className={styles.escMeasureGrid}>
            <button
              type="button"
              onClick={() => {
                const pos = localPositionRef.current ?? localRenderPosRef.current;
                const nextPin = { x: pos.x, y: pos.y, z: localZRef.current };
                setMeasurePins(prev => prev.length >= 2 ? [nextPin, prev[1]] : [nextPin]);
              }}
              className={`${styles.escMeasureButton} ${measurePins.length >= 1 ? styles.escMeasureButtonActive : ''}`}
            >
              Pin A
            </button>
            <button
              type="button"
              onClick={() => {
                const pos = localPositionRef.current ?? localRenderPosRef.current;
                const nextPin = { x: pos.x, y: pos.y, z: localZRef.current };
                setMeasurePins(prev => {
                  if (prev.length === 0) return prev;
                  return [prev[0], nextPin];
                });
              }}
              className={`${styles.escMeasureButton} ${measurePins.length >= 2 ? styles.escMeasureButtonActive : ''}`}
            >
              Pin B
            </button>
          </div>
          {measurePins.length === 0 && <div className={styles.uiInlineHint}>先点 Pin A 记录起点。</div>}
          {measurePins.length === 1 && <div className={styles.uiInlineHint}>A 已记录，再点 Pin B 记录终点。</div>}
          {measurePins.length >= 2 && (() => {
            const dx = measurePins[1].x - measurePins[0].x;
            const dy = measurePins[1].y - measurePins[0].y;
            const dz = measurePins[1].z - measurePins[0].z;
            const flatDist = Math.sqrt(dx * dx + dy * dy) / storedUnitScale;
            const heightDelta = Math.abs(dz) / storedUnitScale;
            const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz) / storedUnitScale;
            return (
              <div className={styles.escMeasureReadout}>
                <div>A 已记录</div>
                <div>B 已记录</div>
                <div>平面 {flatDist.toFixed(1)}</div>
                <div>高差 {heightDelta.toFixed(1)}</div>
                <div className={styles.escMeasureTotal}>总长 {totalDist.toFixed(1)}</div>
              </div>
            );
          })()}
          {measurePins.length > 0 && (
            <button type="button" onClick={() => setMeasurePins([])} className={styles.escMeasureClear}>清除</button>
          )}
        </div>
      )}

      {mode === 'collision-test' && showTestingPanel && (
        <div className={styles.escOverlay}>
          <div className={styles.escPanelShell} data-testing-panel>
            <div className={styles.escPanelHeader}>
              <div className={styles.escTitle}>控制面板</div>
              <button
                type="button"
                onClick={() => setShowTestingPanel(false)}
                className={styles.escCloseIcon}
                aria-label="关闭控制面板"
              >
                ×
              </button>
            </div>

            <div className={styles.escToggleList}>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showEnvTestingPanel} onChange={(e) => setShowEnvTestingPanel(e.target.checked)} className={styles.escToggleInput} />
                <span>灯光控制</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showSceneTestingPanel} onChange={(e) => setShowSceneTestingPanel(e.target.checked)} className={styles.escToggleInput} />
                <span>角色状态</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showCameraEventTestingPanel} onChange={(e) => setShowCameraEventTestingPanel(e.target.checked)} className={styles.escToggleInput} />
                <span>镜头事件测试</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showCollisionControlPanel} onChange={(e) => setShowCollisionControlPanel(e.target.checked)} className={styles.escToggleInput} />
                <span>体积碰撞开关</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showScreenCoordPanel} onChange={(e) => setShowScreenCoordPanel(e.target.checked)} className={styles.escToggleInput} />
                <span>显示屏幕坐标</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showMeasurePanel} onChange={(e) => setShowMeasurePanel(e.target.checked)} className={styles.escToggleInput} />
                <span>距离测试</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showJumpDetailsPanel} onChange={(e) => setShowJumpDetailsPanel(e.target.checked)} className={styles.escToggleInput} />
                <span>跳跃细节</span>
              </label>
              <label className={styles.escToggleRow}>
                <input type="checkbox" checked={showGroundDistanceDetail} onChange={(e) => setShowGroundDistanceDetail(e.target.checked)} className={styles.escToggleInput} />
                <span>显示距离地面的距离</span>
              </label>
              <label className={styles.escToggleRow}>
                <input
                  type="checkbox"
                  checked={allowOverrangeCameraZoom}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setAllowOverrangeCameraZoom(next);
                    if (!next) {
                      camZoomRef.current = Math.min(camZoomRef.current, CAMERA_ZOOM_MAX);
                      setCameraZoomLevel(camZoomRef.current);
                    }
                  }}
                  className={styles.escToggleInput}
                />
                <span>允许超距镜头</span>
              </label>
            </div>
          </div>
        </div>
      )}
      {mode === 'collision-test' && !collisionReady && (
        <div style={{
          position: 'absolute',
          top: 14,
          right: 14,
          zIndex: 520,
          background: 'rgba(18, 18, 18, 0.82)',
          border: '1px solid rgba(255, 210, 74, 0.42)',
          color: '#ffd24a',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 6,
          pointerEvents: 'none',
          fontFamily: 'monospace',
        }}>
          loading real collision...
        </div>
      )}

      {/* ===== LOS BLOCKER DEBUG OVERLAY ===== */}
      {losBlocker && (
        <div style={{
          position: 'absolute',
          top: 60,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 530,
          background: 'rgba(180, 0, 0, 0.85)',
          border: '1px solid #ff4444',
          color: '#fff',
          fontSize: 13,
          padding: '7px 16px',
          borderRadius: 6,
          fontFamily: 'monospace',
          pointerEvents: 'none',
          textAlign: 'center',
        }}>
          {losBlocker}
        </div>
      )}

      {/* ===== JUMP STATS + HEIGHT DISPLAY ===== */}
      <div style={{
        position: 'absolute',
        left: '30%',
        top: '67%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: showJumpDetailsPanel ? 3 : 0,
        pointerEvents: 'none',
        zIndex: 490,
      }}>
        {showJumpDetailsPanel && (
          <div style={{
            background: 'rgba(0,0,0,0.65)',
            color: 'rgba(255,220,100,0.85)',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 5,
            border: '1px solid rgba(255,255,255,0.12)',
            whiteSpace: 'normal',
            lineHeight: 1.4,
          }}>
            {jumpRecord.riseMs !== null
              ? (
                <>
                  <div>
                    {`J${jumpRecord.jumpPhase ?? '?'} ${jumpRecord.mode === 'directional' ? 'dir' : 'up'}  ↑ ${(jumpRecord.riseMs / 1000).toFixed(2)}s  ↓ ${(jumpRecord.fallMs! / 1000).toFixed(2)}s  ⟳ ${(jumpRecord.totalMs! / 1000).toFixed(2)}s  ⬆ ${jumpRecord.peakUnits!.toFixed(1)}u`}
                  </div>
                  <div>
                    {`v0 ${(jumpRecord.startSpeedUnitsPerSec ?? 0).toFixed(2)} u/s  exp ${(jumpRecord.expectedLandUnits ?? 0).toFixed(2)}u  land ${(jumpRecord.actualLandUnits ?? 0).toFixed(2)}u`}
                  </div>
                </>
              )
              : '— — —'}
          </div>
        )}
        {/* Current height: A = above current floor, B = relative floor elevation */}
        <div style={{
          background: 'rgba(0,0,0,0.65)',
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: 700,
          padding: '3px 10px',
          borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.15)',
          letterSpacing: '0.05em',
        }}>
          <span style={{ color: '#44ffaa' }}>{heightDisplay.aboveGround.toFixed(1)}</span>
          {showGroundDistanceDetail && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}> | </span>
              <span style={{ color: '#ffd700' }}>{heightDisplay.floorElev.toFixed(1)}</span>
            </>
          )}
        </div>
      </div>

      {/* ===== TOP-LEFT: My HP panel ===== */}
      <div
        className={styles.playerPanel}
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onClick={() => {
          const next = !selectedSelfRef.current;
          selectedSelfRef.current = next;
          setSelectedSelf(next);
          if (next) {
            setSelectedTargetId(null);
            selectedTargetRef.current = null;
          }
        }}
      >
        <div className={styles.playerLabelRow}>
          <span className={styles.playerLabel}>玩家</span>
        </div>
        <div className={styles.myHpTrack}>
          {myShieldPct > 0 && (
            <div
              className={styles.myShieldFill}
              style={{
                left: `${myHpPct}%`,
                width: `${myShieldPct}%`,
              }}
            />
          )}
          <div
            className={styles.myHpFill}
            style={{
              width:      `${myHpPct}%`,
              background: myHpPct > 50 ? '#44cc55' : myHpPct > 25 ? '#ffcc22' : '#ee3333',
            }}
          />
          {(me?.hp ?? 0) > 0 && (
            <span
              className={styles.hpSegmentNum}
              style={{ left: `${Math.max(6, Math.min(94, myHpPct / 2))}%` }}
            >
              {Math.round(me?.hp ?? 0)}
            </span>
          )}
          {myShield > 0 && (
            <span
              className={styles.shieldSegmentNum}
              style={{ left: `${Math.max(6, Math.min(94, myHpPct + myShieldPct / 2))}%` }}
            >
              {Math.round(myShield)}
            </span>
          )}
        </div>
      </div>

      {/* ===== TOP-CENTER: Target info panel — health → buffs → abilities (self or enemy) ===== */}
      <div className={styles.enemyBossGroup}>
        {(selectedTargetId || selectedSelf) && (() => {
          const selectedTarget = selectedTargetId
            ? opponentsList.find((o) => o.userId === selectedTargetId) ?? null
            : null;
          const isSelf       = selectedSelf && !selectedTargetId;
          const targetHp     = isSelf ? (me?.hp ?? 0) : (selectedTarget?.hp ?? 0);
          const targetShield = Math.max(0, isSelf ? (me?.shield ?? 0) : (selectedTarget?.shield ?? 0));
          const targetMaxHp  = isSelf
            ? (me?.maxHp ?? maxHp)
            : (selectedTarget?.maxHp ?? maxHp);
          const targetBarSegments = computeHpShieldSegments(targetHp, targetShield, targetMaxHp);
          const targetHpPct = targetBarSegments.hpPct;
          const targetShieldPct = targetBarSegments.shieldPct;
          const targetName   = isSelf ? '玩家' : '恐怖花萝';
          const targetBuffs  = isSelf ? (me?.buffs ?? []) : (selectedTarget?.buffs ?? []);
          const targetHand   = isSelf ? me.hand : (selectedTarget?.hand ?? []);
          const hpGradient   = 'linear-gradient(90deg, #991111, #cc2222)';
          const barBg        = isSelf
            ? { background: 'rgba(210, 215, 220, 0.18)', border: '1px solid rgba(200, 210, 220, 0.35)' }
            : {};
          const draftedAbilities = targetHand.filter((ability: any) => {
            const abilityId = ability.abilityId || ability.id;
            return abilityId && !COMMON_ABILITY_ORDER.includes(abilityId as any);
          });
          return (
            <>
              <div className={styles.enemyBossBar} style={barBg}>
                <div className={styles.enemyName}>{targetName}</div>
                <div className={styles.enemyHpTrack}>
                  {targetShieldPct > 0 && (
                    <div
                      className={styles.enemyShieldFill}
                      style={{
                        left: `${targetHpPct}%`,
                        width: `${targetShieldPct}%`,
                      }}
                    />
                  )}
                  <div
                    className={styles.enemyHpFill}
                    style={{ width: `${targetHpPct}%`, background: hpGradient }}
                  />
                  {targetHp > 0 && (
                    <span
                      className={styles.hpSegmentNum}
                      style={{ left: `${Math.max(6, Math.min(94, targetHpPct / 2))}%` }}
                    >
                      {Math.round(targetHp)}
                    </span>
                  )}
                  {targetShield > 0 && (
                    <span
                      className={styles.shieldSegmentNum}
                      style={{ left: `${Math.max(6, Math.min(94, targetHpPct + targetShieldPct / 2))}%` }}
                    >
                      {Math.round(targetShield)}
                    </span>
                  )}
                </div>
              </div>
              {/* Buffs row — fixed-height wrapper so ability row never shifts up */}
              <div style={{ minHeight: 72, width: '100%' }}>
                <StatusBar buffs={targetBuffs} debugLabel={isSelf ? 'me-target' : 'opp'} />
              </div>
              {/* Drafted abilities */}
              <div className={styles.enemyAbilityRow}>
                {draftedAbilities.map((ability: any) => {
                  const abilityId = ability.abilityId || ability.id;
                  const cardData = abilities[abilityId];
                  const name = cardData?.name || abilityId || '?';
                  return (
                    <div key={ability.instanceId || abilityId} className={styles.enemyAbilityItem}>
                      <div className={styles.enemyAbilitySlot} title={name}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/icons/${name}.png`}
                          alt={name}
                          className={styles.enemyAbilityIcon}
                          draggable={false}
                        />
                      </div>
                      <span className={styles.enemyAbilityName}>{name.slice(0, 2)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>

      {/* ===== TOP-RIGHT: RTT badge + debug grid toggle ===== */}
      <div
        className={styles.rttBadge}
        style={{
          color: rtt === null ? '#e8eef5' : rtt < 100 ? '#59d36a' : rtt < 200 ? '#ffb547' : '#ff5b5b',
        }}
      >
        <span className={styles.rttBadgeValue}>{rtt !== null ? `${rtt}ms` : '—'}</span>
      </div>

      {/* ===== DEBUG POSITION GRID ===== */}
      {showDebugGrid && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 490 }}>
          {/* Grid lines every 10% */}
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(p => (
            <React.Fragment key={p}>
              {/* horizontal */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: `${p}%`, height: 1,
                background: p === 50 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)' }} />
              {/* vertical */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${p}%`, width: 1,
                background: p === 50 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)' }} />
              {/* Y label on left edge */}
              <div style={{
                position: 'absolute', left: 3, top: `${p}%`,
                transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.75)', color: '#ffdd00',
                fontSize: 10, fontFamily: 'monospace', padding: '1px 4px', borderRadius: 2,
              }}>Y{p}</div>
              {/* X label on top edge */}
              <div style={{
                position: 'absolute', top: 3, left: `${p}%`,
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.75)', color: '#ffdd00',
                fontSize: 10, fontFamily: 'monospace', padding: '1px 4px', borderRadius: 2,
              }}>X{p}</div>
            </React.Fragment>
          ))}

          {/* Cursor coordinates readout */}
          {debugCursor && (
            <div style={{
              position: 'absolute',
              left: `${Math.min(debugCursor.x, 80)}%`,
              top:  `${Math.min(debugCursor.y, 90)}%`,
              transform: 'translate(8px, -50%)',
              background: 'rgba(0,0,0,0.88)', color: '#ffdd00',
              fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
              padding: '3px 8px', borderRadius: 4,
              border: '1px solid rgba(255,221,0,0.6)',
              pointerEvents: 'none',
              zIndex: 495,
            }}>
              X:{debugCursor.x.toFixed(1)}% Y:{debugCursor.y.toFixed(1)}%
            </div>
          )}

          {/* Live canvas bounds markers */}
          {(() => {
            const { me, opp, cw, ch } = debugBounds;
            if (!cw || !ch) return null;
            const markers: Array<{ x: number; y: number; color: string; label: string }> = [];
            if (me) {
              const x = (me.cx / cw) * 100;
              const y = (me.hpBarY / ch) * 100;
              markers.push({ x, y, color: '#44aaff', label: `ME hp-bar\nX:${x.toFixed(1)}% Y:${y.toFixed(1)}%` });
            }
            if (opp) {
              const x = (opp.cx / cw) * 100;
              const y = (opp.topY / ch) * 100;
              markers.push({ x, y, color: '#ff5555', label: `OPP head\nX:${x.toFixed(1)}% Y:${y.toFixed(1)}%` });
            }
            return markers.map((m, i) => (
              <div key={i} style={{ position: 'absolute', left: `${m.x}%`, top: `${m.y}%`,
                transform: 'translate(-50%,-50%)', zIndex: 496 }}>
                {/* crosshair dot */}
                <div style={{ width: 10, height: 10, borderRadius: '50%',
                  background: m.color, border: '2px solid #fff',
                  boxShadow: '0 0 8px rgba(0,0,0,0.9)' }} />
                {/* horizontal tick */}
                <div style={{ position: 'absolute', top: 4, left: -18, width: 14, height: 2, background: m.color }} />
                <div style={{ position: 'absolute', top: 4, left: 12, width: 14, height: 2, background: m.color }} />
                {/* label */}
                <div style={{
                  position: 'absolute', top: 14, left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.88)', color: m.color,
                  fontSize: 10, fontFamily: 'monospace', padding: '2px 6px',
                  borderRadius: 3, border: `1px solid ${m.color}`,
                  whiteSpace: 'pre', textAlign: 'center',
                }}>
                  {m.label}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ===== CENTER: Distance floating label ===== */}
      <div className={styles.distIndicator}>
        <span className={styles.distVal}>
          {selectedSelf ? '0.0尺' : selectedTargetId ? `${distance.toFixed(1)}尺` : '没有目标'}
        </span>
      </div>

      {/* ===== PICKUP: "拾取 [F]" prompts — draggable, always visible when near books ===== */}
      {nearbyPickupIds.length > 0 && (() => {
        const promptPos = uiPositions['pickup-prompt'] ?? { left: 64, top: 60 };
        return (
          <div
            style={{
              position: 'absolute',
              left: promptPos.left,
              top: promptPos.top,
              display: 'flex', flexDirection: 'column', gap: 4,
              pointerEvents: 'auto',
              zIndex: 650,
              cursor: 'move',
            }}
            data-ui-drag="true"
            onMouseDown={(e) => startUIDrag('pickup-prompt', { left: 64, top: 60 }, e)}
          >
            {nearbyPickupIds.map((id) => (
              <div key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(26,24,20,0.84)',
                border: '1px solid rgba(190,170,110,0.50)',
                borderRadius: 22,
                padding: '5px 16px 5px 12px',
                color: '#e5d9af',
                fontSize: 13,
                fontFamily: '"Microsoft YaHei", sans-serif',
                letterSpacing: '0.05em',
                boxShadow: '0 2px 10px rgba(0,0,0,0.60)',
                userSelect: 'none',
              }}>
                拾取【<span style={{ color: '#ffe060', fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>F</span>】
              </div>
            ))}
          </div>
        );
      })()}

      {/* ===== PICKUP: Channel progress bar ===== */}
      {channelPickupId && (
        <div style={{
          position: 'absolute', bottom: '38%', left: '50%',
          transform: 'translateX(-50%)',
          width: 220,
          background: 'rgba(0,20,10,0.9)',
          border: '1px solid #00ff80',
          borderRadius: 8,
          padding: '10px 16px',
          zIndex: 600,
          textAlign: 'center',
        }}>
          <div style={{ color: '#aaffcc', fontSize: 13, marginBottom: 6, fontFamily: '"Microsoft YaHei", sans-serif' }}>正在研读秘籍…</div>
          <div style={{ background: 'rgba(0,80,40,0.5)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, #00cc55, #00ff88)',
              width: `${channelProgress * 100}%`,
              transition: 'width 0.05s linear',
              boxShadow: '0 0 8px rgba(0,255,100,0.7)',
            }} />
          </div>
        </div>
      )}

      {/* ===== PICKUP: Ability panels — draggable, stacked with no gap ===== */}
      {pickupModals.length > 0 && (() => {
        // Layout constants
        const SLOT = 40, ITEM_GAP = 3, COLS = 6;
        const BODY_PAD = 8; // px padding each side of item area
        const bodyW   = COLS * SLOT + (COLS - 1) * ITEM_GAP + BODY_PAD * 2;
        const TITLE_H = 28;
        const BODY_H  = BODY_PAD * 2 + SLOT; // 8+40+8 = 56
        const PANEL_H = TITLE_H + BODY_H + 2; // +2 borders
        const panelBase = uiPositions['pickup-panel'] ?? { left: 200, top: 150 };

        return pickupModals.slice(0, 5).map((modal, idx) => {
          return (
            <div key={modal.pickupId} style={{
              position: 'absolute',
              left: panelBase.left,
              top: panelBase.top + idx * PANEL_H,
              background: 'rgba(34,44,42,0.97)',
              border: '1px solid rgba(90,130,110,0.60)',
              borderRadius: idx === 0 ? 4 : 0,
              borderTop: idx === 0 ? undefined : 'none',
              zIndex: 700 + idx,
              width: bodyW,
              boxShadow: idx === pickupModals.length - 1 ? '0 4px 20px rgba(0,0,0,0.80)' : 'none',
              fontFamily: '"Microsoft YaHei", sans-serif',
              userSelect: 'none',
            }}>
              {/* ── Title bar — drag handle ── */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0 8px',
                  background: 'rgba(55,75,68,0.90)',
                  borderBottom: '1px solid rgba(90,130,110,0.40)',
                  borderRadius: idx === 0 ? '3px 3px 0 0' : 0,
                  height: TITLE_H,
                  cursor: 'move',
                }}
                data-ui-drag="true"
                onMouseDown={(e) => startUIDrag('pickup-panel', { left: 200, top: 150 }, e)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cde5d8', fontSize: 13, fontWeight: 600 }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>目</span>
                  技能 (1)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* Navigator: fat cursor arrow in circle, rotated to point at book */}
                  {(() => {
                    const pu2 = pickupsRef.current.find(p => p.id === modal.pickupId);
                    const pp  = localPositionRef.current;
                    let deg2  = 0;
                    let dist2 = '';
                    if (pu2 && pp) {
                      const ddx = pu2.position.x - pp.x;
                      const ddy = pu2.position.y - pp.y;
                      const d   = worldUnitsToNewUnits(Math.sqrt(ddx * ddx + ddy * ddy), mode);
                      dist2 = d < 1 ? '<1' : `${Math.round(d)}`;
                      // 0° = right (+X). SVG arrow default points up (−90°), so subtract 90
                      deg2 = ((Math.atan2(ddy, ddx) * 180 / Math.PI) - 90 + 360) % 360;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
                          {/* Circle */}
                          <circle cx="10" cy="10" r="9" fill="none" stroke="#7ab898" strokeWidth="1.5" />
                          {/* Fat cursor arrow, rotated */}
                          <g transform={`rotate(${deg2}, 10, 10)`}>
                            <polygon
                              points="10,3 13.5,12 10,10.5 6.5,12"
                              fill="#a8dfbf"
                              stroke="rgba(0,0,0,0.5)"
                              strokeWidth="0.6"
                              strokeLinejoin="round"
                            />
                          </g>
                        </svg>
                        {dist2 && <span style={{ fontSize: 10, color: '#7ab898', minWidth: 14 }}>{dist2}</span>}
                      </div>
                    );
                  })()}
                  {/* Minimize button */}
                  <button
                    onClick={() => setMinimizedModals(prev => {
                      const next = new Set(prev);
                      if (next.has(modal.pickupId)) next.delete(modal.pickupId); else next.add(modal.pickupId);
                      return next;
                    })}
                    style={{ background: 'none', border: 'none', color: '#aaccbb', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  >{minimizedModals.has(modal.pickupId) ? '+' : '−'}</button>
                  {/* Close button */}
                  <button
                    onClick={() => setPickupModals(prev => prev.filter(m => m.pickupId !== modal.pickupId))}
                    style={{ background: 'none', border: 'none', color: '#aaccbb', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  >×</button>
                </div>
              </div>

              {/* ── Items: hidden when minimized ── */}
              {!minimizedModals.has(modal.pickupId) && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: ITEM_GAP,
                  padding: BODY_PAD,
                  background: 'rgba(26,36,34,0.95)',
                  borderRadius: '0 0 3px 3px',
                }}>
                <div
                  style={{
                    position: 'relative', width: SLOT, height: SLOT,
                    borderRadius: 4, overflow: 'hidden', cursor: 'pointer',
                    border: '1px solid rgba(80,200,120,0.55)',
                    boxShadow: '0 0 6px rgba(0,200,80,0.25)',
                    flexShrink: 0,
                  }}
                  onClick={() => claimPickup(modal.pickupId)}
                  title={modal.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/icons/${modal.name}.png`}
                    alt={modal.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.20'; }}
                  />
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'rgba(0,0,0,0.68)',
                    color: '#dff5e8',
                    fontSize: 9,
                    textAlign: 'center',
                    lineHeight: '14px',
                    padding: '0 1px',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}>{modal.name.slice(0, 4)}</div>
                </div>
                </div>
              )}
            </div>
          );
        });
      })()}

      {/* ===== CHEAT: Ability picker (bottom-right, toggleable) ===== */}
      <button
        style={{
          position: 'absolute', bottom: 170, right: 8, zIndex: 200,
          background: showCheatWindow ? '#ff6b00' : 'rgba(20,20,30,0.92)',
          color: showCheatWindow ? '#fff' : '#ff6b00',
          border: '1px solid #ff6b00', borderRadius: 4,
          padding: '5px 12px', fontSize: 12, cursor: 'pointer',
          fontWeight: 600, letterSpacing: '0.5px',
          boxShadow: showCheatWindow ? '0 0 10px rgba(255,107,0,0.5)' : 'none',
        }}
        onClick={() => setShowCheatWindow(v => !v)}
        title="测试用：直接添加技能"
      >
        {showCheatWindow ? '✕ 关闭技能面板' : '⚡ 添加技能'}
      </button>
      {showCheatWindow && (
        <div style={{
          position: 'absolute', bottom: 200, right: 8, zIndex: 200,
          background: 'rgba(10,18,28,0.97)', border: '1px solid #ff6b00',
          borderRadius: 6, padding: 8,
          height: 'calc(100vh - 230px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 220,
        }}>
          <div style={{
            fontSize: 10,
            lineHeight: 1.35,
            color: '#e9edf5',
            padding: '4px 6px',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.04)',
          }}>
            图标已按目录分区，便于快速定位技能。
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 6,
          }}>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('full-heal', '/api/game/cheat/full-heal', '双方已恢复满血')}
              style={{
                background: 'rgba(40, 160, 80, 0.20)',
                color: '#b6ffcd',
                border: '1px solid rgba(80, 210, 120, 0.55)',
                borderRadius: 4,
                fontSize: 11,
                padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >双方满血</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('reset-cd', '/api/game/cheat/reset-cooldowns', '双方技能已重置冷却')}
              style={{
                background: 'rgba(40, 100, 190, 0.20)',
                color: '#bcd9ff',
                border: '1px solid rgba(90, 150, 255, 0.55)',
                borderRadius: 4,
                fontSize: 11,
                padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >重置CD</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('clear-buffs', '/api/game/cheat/clear-buffs', '双方增益减益已清空')}
              style={{
                background: 'rgba(170, 120, 30, 0.20)',
                color: '#ffe0a8',
                border: '1px solid rgba(255, 180, 80, 0.55)',
                borderRadius: 4,
                fontSize: 11,
                padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >清空Buff</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('discard-all', '/api/game/cheat/discard-all', '已清空当前技能栏')}
              style={{
                background: 'rgba(40, 110, 210, 0.24)',
                color: '#c6e8ff',
                border: '1px solid rgba(120, 190, 255, 0.70)',
                borderRadius: 4,
                fontSize: 11,
                padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >清空技能</button>
          </div>

          <div style={{ fontSize: 11, color: '#69f0ae', fontWeight: 700 }}>全部技能（按稀有度）</div>
          {/* Rarity filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {['all', '稀世', '珍奇', '卓越', '精巧', 'unset'].map((f) => {
              const label = f === 'all' ? '全部' : f === 'unset' ? '未设' : f;
              const color = RARITY_COLOR[f as keyof typeof RARITY_COLOR];
              const isActive = cheatRarityFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setCheatRarityFilter(isActive && f !== 'all' ? 'all' : f)}
                  style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${color ?? '#888'}`,
                    color: isActive ? '#fff' : (color ?? '#888'),
                    background: isActive ? (color ?? '#888') : 'transparent',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >{label}</button>
              );
            })}
            <span style={{ fontSize: 10, color: '#888' }}>({filteredCheatAbilities.length})</span>
          </div>
          {/* School filter dropdown */}
          <div ref={cheatSchoolRef} style={{ position: 'relative', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#aaa' }}>Class：</span>
              <button
                type="button"
                onClick={() => setCheatSchoolOpen((o) => !o)}
                style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${cheatSchoolFilter === 'all' ? '#555' : cheatSchoolFilter === 'unset' ? '#888' : (SCHOOL_COLOR[cheatSchoolFilter] ?? '#888')}`,
                  color: cheatSchoolFilter === 'all' ? '#aaa' : '#111',
                  background: cheatSchoolFilter === 'all' ? 'transparent' : cheatSchoolFilter === 'unset' ? '#888' : (SCHOOL_COLOR[cheatSchoolFilter] ?? '#888'),
                  fontWeight: cheatSchoolFilter !== 'all' ? 700 : 400,
                  minWidth: 52,
                }}
              >
                {cheatSchoolFilter === 'all' ? '全部 ▼' : cheatSchoolFilter === 'unset' ? '未设 ▼' : `${cheatSchoolFilter} ▼`}
              </button>
            </div>
            {cheatSchoolOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 300,
                background: 'rgba(10,10,20,0.97)', border: '1px solid #555',
                borderRadius: 6, padding: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                width: 200,
              }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {['all','unset'].map((f) => (
                    <button key={f} type="button"
                      onClick={() => { setCheatSchoolFilter(f); setCheatSchoolOpen(false); }}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                        border: '1px solid #666', color: cheatSchoolFilter === f ? '#fff' : '#aaa',
                        background: cheatSchoolFilter === f ? '#666' : 'transparent', fontWeight: cheatSchoolFilter === f ? 700 : 400 }}
                    >{f === 'all' ? '全部' : '未设置'}</button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
                  {SCHOOL_TAGS_BA.map((s) => {
                    const c = SCHOOL_COLOR[s] ?? '#888';
                    const isActive = cheatSchoolFilter === s;
                    return (
                      <button key={s} type="button"
                        onClick={() => { setCheatSchoolFilter(isActive ? 'all' : s); setCheatSchoolOpen(false); }}
                        style={{ fontSize: 10, padding: '2px 2px', borderRadius: 3, cursor: 'pointer',
                          border: `1px solid ${c}`, color: isActive ? '#111' : c,
                          background: isActive ? c : 'transparent', fontWeight: isActive ? 700 : 400,
                          textAlign: 'center' }}
                      >{s}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 32px)', gap: 4, alignContent: 'start' }}>
            {filteredCheatAbilities.map((ability: any) => renderCheatIcon(ability))}
          </div>

        </div>
      )}

      {/* ===== BOTTOM: WASD / Joystick (mobile left) + centered hotbar ===== */}
      <div className={styles.bottomHud} style={isMobileDevice ? { justifyContent: 'center' } : undefined}>

        {/* Desktop WASD buttons */}
        {!isMobileDevice && (
          <div className={styles.wasdWrap}>
            <WASDButtons onDirectionChange={handleJoystickDirection} />
          </div>
        )}

        <div className={styles.hotbarStack}>
          {/* ── Player buffs above drafted slots ── */}
          {me?.buffs && me.buffs.length > 0 && (
            <div className={styles.playerBuffRow}>
              <StatusBar buffs={me.buffs} showDebug debugLabel="me" />
            </div>
          )}

          {/* ── Channel bar (正读条 / 倒读条) ── */}
          {channelBarData && <ChannelBar data={channelBarData} />}

          {/* ── Top row: draft abilities (6 fixed slots) ── */}
          <div className={styles.hotbar}>
            {Array.from({ length: 6 }, (_, idx) => {
              const ability = draftAbilities[idx];
              const keyHint = ['1','2','3','Q','XB2','XB1'][idx];
              return (
                <div
                  key={ability ? `slot-${ability.id}` : `empty-${idx}`}
                  className={`${styles.draftSlot} ${dragHoverIndex === idx ? styles.draftSlotHover : ''}`}
                  onDragOver={(e) => {
                    if (!draggingDraftInstanceId) return;
                    e.preventDefault();
                    setDragHoverIndex(idx);
                  }}
                  onDragLeave={() => {
                    if (dragHoverIndex === idx) setDragHoverIndex(null);
                  }}
                  onDrop={(e) => void handleDraftSlotDrop(e, idx)}
                >
                  {!ability ? (
                    <div className={`${styles.abilityBtn} ${styles.emptySlot}`}>
                      <span className={styles.abilityKey}>{keyHint}</span>
                    </div>
                  ) : (() => {
                    const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
                    const cdSeconds = Math.floor(ability.cooldown / 30);
                    const hasCharges = (ability.maxCharges ?? 0) > 1;
                    const chargeCount = hasCharges ? (ability.chargeCount ?? ability.maxCharges ?? 0) : 0;
                    const maxCharges = hasCharges ? Math.max(0, ability.maxCharges ?? 0) : 0;
                    const chargeRegenProgress = hasCharges
                      ? Math.max(0, Math.min(1, Number(ability.chargeRegenProgress ?? 0)))
                      : 0;
                    const recoveringCharge = hasCharges && chargeCount < maxCharges;
                    const chargePathProgress = hasCharges ? (recoveringCharge ? chargeRegenProgress : 1) : 0;
                    const chargePathLength = (Math.max(0, Math.min(1, chargePathProgress)) * 100).toFixed(2);
                    const isQueTaZhi = ability.abilityId === 'que_ta_zhi';
                    return (
                      <button
                        className={`${styles.abilityBtn} ${ability.isReady ? styles.ready : styles.notReady}`}
                        style={ability.losBlocked ? { boxShadow: '0 0 0 2px #ff3333, 0 0 10px 3px rgba(255,50,50,0.45)', outline: 'none' } : undefined}
                        draggable
                        onDragStart={(e) => handleDraftDragStart(e, ability.id, idx)}
                        onDragEnd={handleDraftDragEnd}
                        onClick={() => {
                          if (dragJustEndedRef.current) return;
                          if (!ability.isReady) {
                            if (ability.losBlocked) {
                              showLOSBlocker('视线被遮挡');
                            }
                            return;
                          }
                          castAbilityRef.current(ability.id);
                        }}
                        title={`${ability.name}${ability.range ? ` | 范围: ${ability.range}` : ''}${hasCharges ? ` | 充能: ${chargeCount}/${ability.maxCharges}` : ''}${ability.cooldown > 0 ? ` | CD: ${cdSeconds}` : ''}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/icons/${ability.name}.png`} alt={ability.name} className={styles.abilityIcon} draggable={false} />
                        {ability.cooldown > 0 && ability.maxCooldown > 0 && (
                          <div className={styles.cdArc} style={{ background: `conic-gradient(from 0deg, transparent ${(100-cdPct).toFixed(1)}%, rgba(0,0,0,0.72) ${(100-cdPct).toFixed(1)}%)` }}>
                            <span className={styles.cdNum}>{cdSeconds}</span>
                          </div>
                        )}
                        {hasCharges && (
                          <div className={`${styles.chargeFrame} ${isQueTaZhi ? styles.chargeFrameQueTaZhi : ''}`}>
                            <svg className={styles.chargeFrameSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                              <rect
                                className={styles.chargeFrameTrack}
                                x="5"
                                y="5"
                                width="90"
                                height="90"
                                rx="8"
                                ry="8"
                                pathLength={100}
                              />
                              <rect
                                className={styles.chargeFrameProgress}
                                x="5"
                                y="5"
                                width="90"
                                height="90"
                                rx="8"
                                ry="8"
                                pathLength={100}
                                strokeDasharray={`${chargePathLength} 100`}
                              />
                            </svg>
                            <span className={`${styles.chargeStackBox} ${isQueTaZhi ? styles.chargeStackBoxQueTaZhi : ''}`}>
                              {Math.max(0, chargeCount)}
                            </span>
                          </div>
                        )}
                        <span className={styles.abilityKey}>{keyHint}</span>
                      </button>
                    );
                  })()}
                </div>
              );
            })}
          </div>
          {draggingDraftInstanceId && (
            <div
              className={`${styles.discardDropZone} ${discardZoneHover ? styles.discardDropZoneActive : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDiscardZoneHover(true);
              }}
              onDragLeave={() => setDiscardZoneHover(false)}
              onDrop={(e) => void handleDiscardDrop(e)}
            >
              拖到蓝色区域删除技能
            </div>
          )}

          {/* ── Bottom row: 8 common abilities (with visual gaps) ── */}
          <div className={styles.commonBar}>
            {commonAbilities.map((ability, idx) => {
              const COMMON_KEY_HINTS = ['X','MD','MU','A+A','A+D','A+S','`','T'] as const;
              const keyHint = COMMON_KEY_HINTS[idx] ?? '';
              const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
              const cdSeconds = Math.floor(ability.cooldown / 30);
              const hasCharges = (ability.maxCharges ?? 0) > 1;
              const chargeCount = hasCharges ? (ability.chargeCount ?? ability.maxCharges ?? 0) : 0;
              const maxCharges = hasCharges ? Math.max(0, ability.maxCharges ?? 0) : 0;
              const chargeRegenProgress = hasCharges
                ? Math.max(0, Math.min(1, Number(ability.chargeRegenProgress ?? 0)))
                : 0;
              const recoveringCharge = hasCharges && chargeCount < maxCharges;
              const chargePathProgress = hasCharges ? (recoveringCharge ? chargeRegenProgress : 1) : 0;
              const chargePathLength = (Math.max(0, Math.min(1, chargePathProgress)) * 100).toFixed(2);
              const isQueTaZhi = ability.abilityId === 'que_ta_zhi';
              return (
                <React.Fragment key={ability.id}>
                  {/* gap between 猛虎下山 and 扶摇 */}
                  {idx === 1 && <div className={styles.commonGap} />}
                  {/* gap between 后撤 and 御骑 */}
                  {idx === 7 && <div className={styles.commonGap} />}
                  <button
                    className={`${styles.abilityBtn} ${styles.commonBtn} ${ability.isReady ? styles.ready : styles.notReady}`}
                    disabled={!ability.isReady}
                    onClick={() => castAbilityRef.current(ability.id)}
                    title={`${ability.name}${hasCharges ? ` | 充能: ${chargeCount}/${ability.maxCharges}` : ''}${ability.cooldown > 0 ? ` | CD: ${cdSeconds}` : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/icons/${ability.name}.png`} alt={ability.name} className={styles.abilityIcon} draggable={false} />
                    {ability.cooldown > 0 && ability.maxCooldown > 0 && (
                      <div className={styles.cdArc} style={{ background: `conic-gradient(from 0deg, transparent ${(100-cdPct).toFixed(1)}%, rgba(0,0,0,0.72) ${(100-cdPct).toFixed(1)}%)` }}>
                        <span className={styles.cdNum}>{cdSeconds}</span>
                      </div>
                    )}
                    {hasCharges && (
                      <div className={`${styles.chargeFrame} ${isQueTaZhi ? styles.chargeFrameQueTaZhi : ''}`}>
                        <svg className={styles.chargeFrameSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                          <rect
                            className={styles.chargeFrameTrack}
                            x="5"
                            y="5"
                            width="90"
                            height="90"
                            rx="8"
                            ry="8"
                            pathLength={100}
                          />
                          <rect
                            className={styles.chargeFrameProgress}
                            x="5"
                            y="5"
                            width="90"
                            height="90"
                            rx="8"
                            ry="8"
                            pathLength={100}
                            strokeDasharray={`${chargePathLength} 100`}
                          />
                        </svg>
                        <span className={`${styles.chargeStackBox} ${isQueTaZhi ? styles.chargeStackBoxQueTaZhi : ''}`}>
                          {Math.max(0, chargeCount)}
                        </span>
                      </div>
                    )}
                    <span className={styles.abilityKey}>{keyHint}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {!isMobileDevice && <div className={styles.wasdSpacer} />}

      </div>{/* end bottomHud */}

      {/* ===== MOBILE FORWARD/BACK + JUMP BUTTONS — anchored to root container ===== */}
      {isMobileDevice && (
        <div style={{
          position: 'absolute',
          left: '67%',
          bottom: '45%',
          transform: 'translate(-50%, 50%)',
          zIndex: 500,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'auto',
        }}>
          {/* Forward button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); handleJoystickDirection({ w: true, a: false, s: false, d: false }); }}
            onTouchEnd={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            onTouchCancel={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'rgba(0,0,0,0.45)',
              border: '2px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, color: 'rgba(255,255,255,0.85)',
              touchAction: 'none', userSelect: 'none', flexShrink: 0,
            }}
          >↑</div>
          {/* Jump button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); handleJoystickJump(); }}
            style={{
              width: 60, height: 60, borderRadius: '50%',
              background: 'rgba(80,180,255,0.25)',
              border: '2px solid rgba(100,200,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: 'rgba(160,230,255,0.9)',
              touchAction: 'none', userSelect: 'none', flexShrink: 0,
            }}
          >跳</div>
          {/* Backward button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: true, d: false }); }}
            onTouchEnd={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            onTouchCancel={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'rgba(0,0,0,0.45)',
              border: '2px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, color: 'rgba(255,255,255,0.85)',
              touchAction: 'none', userSelect: 'none', flexShrink: 0,
            }}
          >↓</div>
        </div>
      )}

      {/* ===== SAFE ZONE TIMER / PROGRESS BAR ===== */}
      {safeZone && safeZone.nextChangeIn > 0 && (
        <div style={{
          position: 'absolute',
          left: '95%',
          top: '30%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'none',
          zIndex: 500,
        }}>
          {/* Progress bar container */}
          <div style={{
            width: 120,
            height: 12,
            background: 'rgba(0,0,0,0.5)',
            borderRadius: 3,
            border: '1px solid rgba(255,255,255,0.2)',
            overflow: 'hidden',
          }}>
            {safeZone.shrinking && (
              <div style={{
                width: `${Math.min(100, safeZone.shrinkProgress * 100)}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #ff4444, #ff8800)',
                borderRadius: 3,
                transition: 'width 0.3s linear',
              }} />
            )}
          </div>
          {/* Timer text */}
          <div style={{
            color: safeZone.shrinking ? '#ff8800' : '#ffffff',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap',
          }}>
            {safeZone.shrinking
              ? `缩圈中 ${Math.ceil(safeZone.nextChangeIn)}s`
              : `风暴倒计时: ${Math.ceil(safeZone.nextChangeIn)}`}
          </div>
        </div>
      )}

      {/* ===== FLOATING DAMAGE / HEAL NUMBERS ===== */}
      {floats.map(entry => {
        const age      = (Date.now() - entry.startTime) / 1300; // 0→1 over 1.3s
        // quick fade-in (0→8%), hold (8→75%), fade-out (75→100%)
        const opacity  = age < 0.08 ? age / 0.08 : Math.max(0, 1 - Math.max(0, age - 0.75) / 0.25);
        const travelUp = -80 * age; // floats upward
        const color = entry.type === 'dmg_dealt'
          ? '#ffffff'
          : entry.type === 'heal'
          ? '#44ff66'
          : '#ff2222';
        const pctX = entry.screenPct && Number.isFinite(entry.screenPct.x) ? entry.screenPct.x * 100 : undefined;
        const pctY = entry.screenPct && Number.isFinite(entry.screenPct.y) ? entry.screenPct.y * 100 : undefined;
        let posStyle: React.CSSProperties;
        if (entry.type === 'dmg_dealt') {
          // Float above enemy — fixed-size text in screen space (not distance-scaled)
          posStyle = {
            top: `calc(${pctY ?? 12}% + ${travelUp - entry.yOffset}px)`,
            left: `${pctX ?? 50}%`,
            transform: 'translateX(-50%)',
          };
        } else if (entry.type === 'dmg_taken') {
            posStyle = {
              top: `calc(${pctY ?? 65}% + ${travelUp - entry.yOffset}px)`,
              left: `${pctX ?? 40}%`,
              transform: 'translateX(-50%)',
            };
        } else {
            posStyle = {
              top: `calc(${pctY ?? 65}% + ${travelUp - entry.yOffset}px)`,
              left: `${pctX ?? 60}%`,
              transform: 'translateX(-50%)',
            };
        }
        const sign = entry.type === 'heal' ? '+' : '-';
        const displayText = entry.label
          ? `${entry.label}: ${sign}${entry.value}`
          : `${sign}${entry.value}`;
        return (
          <div
            key={entry.id}
            className={`${styles.floatNumber} ${entry.type === 'dmg_dealt' ? styles.floatDealt : entry.type === 'heal' ? styles.floatHeal : styles.floatTaken}`}
            style={{ ...posStyle, opacity, color }}
          >
            {displayText}
          </div>
        );
      })}
    </div>
  );
}
