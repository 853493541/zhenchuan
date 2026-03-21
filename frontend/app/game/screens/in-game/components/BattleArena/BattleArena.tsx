'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';
import StatusBar from '../GameBoard/components/StatusBar';
import { toastError, toastSuccess } from '@/app/components/toast/toast';
import type { ActiveBuff } from '../../types';
import type { PickupItem } from '../../types';
import { worldMapObjects, type MapObject } from './worldMap';

/* ============================================================
   ARENA SETTINGS  (must match backend)
   ============================================================ */
const ARENA_WIDTH  = 2000;
const ARENA_HEIGHT = 2000;

/* Character visual */
const CHAR_HEIGHT = 2.0;   // world units tall  (player capsule)
const CHAR_RADIUS = 0.7;   // world units radius (−30%)

/* 3rd-person camera — high & pulled back, ~26° below horizontal
   atan((20-1.5)/(38)) ≈ 26°  →  lots of ground visible, char at lower-center.

   Camera direction is FIXED at (0,1) — always faces +Y.
   This guarantees A = screen-left and D = screen-right regardless of where
   the opponent is, eliminating the A/D flip when the camera rotates. */
const CAM_DIST_BACK   = 20;  // units behind player
const CAM_HEIGHT      = 10;  // units above player (follows player Z)
const CAM_ARM         = Math.sqrt(CAM_DIST_BACK * CAM_DIST_BACK + CAM_HEIGHT * CAM_HEIGHT); // orbit arm length
const DEFAULT_PITCH   = Math.atan2(CAM_HEIGHT, CAM_DIST_BACK); // ≈ 0.464 rad (~26.6°)
const CAM_LOOK_AHEAD  = 6;   // look-ahead toward opponent side
const NEAR_CLIP       = 0.8;
const DASH_ANIM_MS    = 1500; // ms — cosmetic dash travel animation

// Vertical FOV — used with H-based focal length so scale is consistent
// across all screen widths (phone / tablet / wide monitor all look the same depth)
const VFOV_RAD = (72 * Math.PI) / 180;

/* ============================================================
   VEC3 MATH
   ============================================================ */
type V3 = { x: number; y: number; z: number };
const v3       = (x: number, y: number, z: number): V3 => ({ x, y, z });
const sub3     = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale3   = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot3     = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3   = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (a: V3): V3 => {
  const l = Math.sqrt(dot3(a, a));
  return l < 1e-6 ? v3(0, 1, 0) : scale3(a, 1 / l);
};

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* ============================================================
   CAMERA
   ============================================================ */
interface Cam {
  pos: V3;
  fwd: V3;
  right: V3;
  up: V3;
  fl: number; // focal length (px)
}

// Fixed camera direction — always facing +Y in world space.
// This keeps A = screen-left and D = screen-right at all times.
const CAM_DIR = { x: 0, y: 1 };

function buildCam(
  playerPos: V3,
  dir: { x: number; y: number },
  W: number,
  H: number,
  zoom = 1.0,
  pitch = DEFAULT_PITCH,
): Cam {
  const distBack = CAM_ARM * Math.cos(pitch) * zoom;
  const height   = CAM_ARM * Math.sin(pitch);
  const camPos = v3(
    playerPos.x - dir.x * distBack,
    playerPos.y - dir.y * distBack,
    playerPos.z + height,
  );
  // Scale look-ahead by cos(pitch): at overhead view (pitch→π/2) look directly at player, not ahead
  const lookAheadScale = Math.cos(pitch);
  const lookAt = v3(
    playerPos.x + dir.x * CAM_LOOK_AHEAD * lookAheadScale,
    playerPos.y + dir.y * CAM_LOOK_AHEAD * lookAheadScale,
    playerPos.z + 1.0,
  );
  const worldUp = v3(0, 0, 1);
  const fwd   = norm3(sub3(lookAt, camPos));
  // Use yaw-derived right vector — always well-defined even when looking straight down.
  // This avoids the degenerate cross(fwd, worldUp)=0 case at high pitch angles.
  const right = v3(dir.y, -dir.x, 0); // perpendicular to facing in horizontal plane
  const up    = norm3(cross3(right, fwd));
  // Height-based focal length: scale is tied to viewport HEIGHT so
  // phone / tablet / wide-monitor all see the same perceived distance.
  const fl = (H / 2) / Math.tan(VFOV_RAD / 2);
  return { pos: camPos, fwd, right, up, fl };
}

interface ScreenPt { x: number; y: number; depth: number; }

function projPt(world: V3, cam: Cam, W: number, H: number): ScreenPt | null {
  const t = sub3(world, cam.pos);
  const depth = dot3(t, cam.fwd);
  if (depth < NEAR_CLIP) return null;
  const cx = dot3(t, cam.right);
  const cy = dot3(t, cam.up);
  return {
    x: (cx / depth) * cam.fl + W / 2,
    y: -(cy / depth) * cam.fl + H / 2,
    depth,
  };
}

/* ============================================================
   SCENE RENDERING HELPERS
   ============================================================ */

function renderBg(ctx: CanvasRenderingContext2D, cam: Cam, W: number, H: number) {
  const far = projPt(
    v3(cam.pos.x + cam.fwd.x * 5000, cam.pos.y + cam.fwd.y * 5000, 0),
    cam, W, H,
  );
  const hY = far ? Math.max(0, Math.min(H * 0.7, far.y)) : H * 0.45;

  const sky = ctx.createLinearGradient(0, 0, 0, hY + 30);
  sky.addColorStop(0,   '#010409');
  sky.addColorStop(0.6, '#03091a');
  sky.addColorStop(1,   '#071628');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hY + 30);

  const gnd = ctx.createLinearGradient(0, hY, 0, H);
  gnd.addColorStop(0, '#071628');
  gnd.addColorStop(1, '#020810');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, hY, W, H - hY);
}

// Ground patch half-size — draw a 1200×1200 patch of ground around the camera.
const FLOOR_HALF = 600;
// Grid step within the local floor patch
const FLOOR_GRID  = 100;

function renderFloor(ctx: CanvasRenderingContext2D, cam: Cam, W: number, H: number) {
  // ── Ground fill: project a large quad centred on the camera footprint ──
  // We snap the patch centre to the grid so the lines don't swim as you move.
  const cx = Math.round(cam.pos.x / FLOOR_GRID) * FLOOR_GRID;
  const cy = Math.round(cam.pos.y / FLOOR_GRID) * FLOOR_GRID;
  const x0 = Math.max(0, cx - FLOOR_HALF);
  const x1 = Math.min(ARENA_WIDTH,  cx + FLOOR_HALF);
  const y0 = Math.max(0, cy - FLOOR_HALF);
  const y1 = Math.min(ARENA_HEIGHT, cy + FLOOR_HALF);

  const gndCorners = [
    v3(x0, y0, 0), v3(x1, y0, 0),
    v3(x1, y1, 0), v3(x0, y1, 0),
  ];
  const sc = gndCorners
    .map(c => projPt(c, cam, W, H))
    .filter((p): p is ScreenPt => p !== null);

  if (sc.length >= 3) {
    ctx.fillStyle = '#0a1620';
    ctx.beginPath();
    ctx.moveTo(sc[0].x, sc[0].y);
    for (let i = 1; i < sc.length; i++) ctx.lineTo(sc[i].x, sc[i].y);
    // Extend the fill down off-screen to cover the bottom gap
    ctx.lineTo(W + 20, H + 20);
    ctx.lineTo(-20, H + 20);
    ctx.closePath();
    ctx.fill();
  }

  // ── Grid lines: only within the visible patch ──
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(18, 55, 100, 0.65)';
  const gx0 = Math.floor(x0 / FLOOR_GRID) * FLOOR_GRID;
  const gx1 = Math.ceil(x1  / FLOOR_GRID) * FLOOR_GRID;
  const gy0 = Math.floor(y0 / FLOOR_GRID) * FLOOR_GRID;
  const gy1 = Math.ceil(y1  / FLOOR_GRID) * FLOOR_GRID;

  for (let gx = gx0; gx <= gx1; gx += FLOOR_GRID) {
    const a = projPt(v3(gx, y0, 0), cam, W, H);
    const b = projPt(v3(gx, y1, 0), cam, W, H);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  for (let gy = gy0; gy <= gy1; gy += FLOOR_GRID) {
    const a = projPt(v3(x0, gy, 0), cam, W, H);
    const b = projPt(v3(x1, gy, 0), cam, W, H);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }

  // ── Arena boundary edges (only near edges, skip edges > 800 units away) ──
  const allEdges: [V3, V3][] = [
    [v3(0, 0, 0),                      v3(ARENA_WIDTH, 0, 0)],
    [v3(ARENA_WIDTH, 0, 0),            v3(ARENA_WIDTH, ARENA_HEIGHT, 0)],
    [v3(ARENA_WIDTH, ARENA_HEIGHT, 0), v3(0, ARENA_HEIGHT, 0)],
    [v3(0, ARENA_HEIGHT, 0),           v3(0, 0, 0)],
  ];
  // Edge midpoints for distance test
  const edgeMids = [
    v3(ARENA_WIDTH / 2, 0, 0),
    v3(ARENA_WIDTH, ARENA_HEIGHT / 2, 0),
    v3(ARENA_WIDTH / 2, ARENA_HEIGHT, 0),
    v3(0, ARENA_HEIGHT / 2, 0),
  ];
  ctx.strokeStyle = 'rgba(40, 140, 255, 0.9)';
  ctx.lineWidth   = 1.8;
  ctx.shadowColor = '#1a6fff';
  ctx.shadowBlur  = 9;
  for (let i = 0; i < allEdges.length; i++) {
    const mid = edgeMids[i];
    const ex = mid.x - cam.pos.x, ey = mid.y - cam.pos.y;
    if (ex * ex + ey * ey > 800 * 800) continue; // skip far edges
    const [a, b] = allEdges[i];
    const pa = projPt(a, cam, W, H);
    const pb = projPt(b, cam, W, H);
    if (pa && pb) { ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); }
  }
  ctx.shadowBlur = 0;
}

/* Filled + outlined AOE zone with animated pulse — for channel abilities */
function renderAoeZone(
  ctx: CanvasRenderingContext2D,
  pos: V3,
  radius: number,
  cam: Cam,
  W: number, H: number,
  fillColor: string,
  borderColor: string,
) {
  const segments = 64;
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
  ctx.save();
  ctx.beginPath();
  let first = true;
  for (let i = 0; i <= segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const p = projPt(
      v3(pos.x + Math.cos(ang) * radius, pos.y + Math.sin(ang) * radius, 0.03),
      cam, W, H,
    );
    if (!p) { first = true; continue; }
    if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.10 + 0.06 * pulse;
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.globalAlpha = 0.55 + 0.35 * pulse;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function renderRangeCircle(
  ctx: CanvasRenderingContext2D,
  pos: V3,
  radius: number,
  cam: Cam,
  W: number, H: number,
  color: string,
) {
  const segments = 48;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  let first = true;
  for (let i = 0; i <= segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const p = projPt(
      v3(pos.x + Math.cos(ang) * radius, pos.y + Math.sin(ang) * radius, 0.05),
      cam, W, H,
    );
    if (!p) { first = true; continue; }
    if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/* Ghost outline drawn behind dashing characters */
function renderDashGhost(
  ctx: CanvasRenderingContext2D,
  pos: V3,
  cam: Cam,
  W: number, H: number,
  color: string,
  alpha: number,
) {
  const baseP = projPt(v3(pos.x, pos.y, pos.z),              cam, W, H);
  const topP  = projPt(v3(pos.x, pos.y, pos.z + CHAR_HEIGHT), cam, W, H);
  if (!baseP || !topP) return;
  const rs = (CHAR_RADIUS / baseP.depth) * cam.fl;
  if (rs < 1) return;
  const ellipseRy = rs * 0.32;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 10;
  ctx.beginPath();
  ctx.moveTo(topP.x - rs, topP.y);
  ctx.lineTo(baseP.x - rs, baseP.y);
  ctx.ellipse(baseP.x, baseP.y, rs, ellipseRy, 0, Math.PI, 0, true);
  ctx.lineTo(topP.x + rs, topP.y);
  ctx.ellipse(topP.x, topP.y, rs, ellipseRy, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/* ============================================================
   MAP OBJECT RENDERING
   Draw axis-aligned boxes for all world geometry.
   Culled at 200 world-unit camera distance (handled in render loop).
   ============================================================ */

function tintColor(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8)  & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `rgb(${r},${g},${b})`;
}

const OBJ_BASE: Record<string, { base: string; outline: string }> = {
  building:  { base: '#4a5465', outline: '#607088' },
  rock:      { base: '#363640', outline: '#484858' },
  mountain:  { base: '#3a2e22', outline: '#5a4a38' },
  hill_high: { base: '#253a1e', outline: '#3a5a2e' },
  hill_low:  { base: '#2a4228', outline: '#406040' },
};

// Face brightness factors for simple top-down directional lighting
// top=1.0, south face (-Y, faces camera default)=0.85, north=0.65, east=0.78, west=0.72
const FACES: Array<{ vi: [number,number,number,number]; nx: number; ny: number; nz: number; bright: number }> = [
  { vi: [4,5,6,7], nx: 0,  ny: 0,  nz: 1,  bright: 1.00 }, // top
  { vi: [0,1,5,4], nx: 0,  ny: -1, nz: 0,  bright: 0.85 }, // south (−Y, faces toward default cam)
  { vi: [3,2,6,7], nx: 0,  ny: 1,  nz: 0,  bright: 0.65 }, // north (+Y, away from cam)
  { vi: [0,3,7,4], nx: -1, ny: 0,  nz: 0,  bright: 0.72 }, // west
  { vi: [1,2,6,5], nx: 1,  ny: 0,  nz: 0,  bright: 0.78 }, // east
];

function renderMapObject(
  ctx: CanvasRenderingContext2D,
  obj: MapObject,
  cam: Cam,
  W: number, H: number,
): void {
  const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.w, y1 = obj.y + obj.d, h = obj.h;

  // 8 box corners: [0-3] bottom ring, [4-7] top ring
  const cs: V3[] = [
    v3(x0, y0, 0), v3(x1, y0, 0), v3(x1, y1, 0), v3(x0, y1, 0),
    v3(x0, y0, h), v3(x1, y0, h), v3(x1, y1, h), v3(x0, y1, h),
  ];
  const ps = cs.map(c => projPt(c, cam, W, H));

  const col = OBJ_BASE[obj.type] ?? OBJ_BASE.building;

  for (const face of FACES) {
    // Back-face culling: face is visible when camera is on the outward side
    const fi = face.vi;
    const fx = (cs[fi[0]].x + cs[fi[1]].x + cs[fi[2]].x + cs[fi[3]].x) * 0.25;
    const fy = (cs[fi[0]].y + cs[fi[1]].y + cs[fi[2]].y + cs[fi[3]].y) * 0.25;
    const fz = (cs[fi[0]].z + cs[fi[1]].z + cs[fi[2]].z + cs[fi[3]].z) * 0.25;
    const vis = face.nx * (cam.pos.x - fx) + face.ny * (cam.pos.y - fy) + face.nz * (cam.pos.z - fz);
    if (vis <= 0) continue;

    const pts = fi.map(i => ps[i]).filter((p): p is ScreenPt => p !== null);
    if (pts.length < 3) continue;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle   = tintColor(col.base, face.bright);
    ctx.fill();
    ctx.strokeStyle = col.outline;
    ctx.lineWidth   = 0.5;
    ctx.stroke();
  }
}

/* Filled half-disc showing facing direction at character feet */
function renderFacingArc(
  ctx: CanvasRenderingContext2D,
  charPos: V3,
  facing: { x: number; y: number },
  cam: Cam,
  W: number, H: number,
) {
  const f = Math.sqrt(facing.x * facing.x + facing.y * facing.y);
  if (f < 0.1) return;
  const nx = facing.x / f, ny = facing.y / f;
  const arcZ = Math.max(0.02, charPos.z + 0.08);
  const R = 2.1;
  const STEPS = 20;
  const fAngle = Math.atan2(ny, nx);
  // Offset arc center to character's front (身前)
  const offsetDist = 0.8;
  const arcCenterX = charPos.x + nx * offsetDist;
  const arcCenterY = charPos.y + ny * offsetDist;
  const center = projPt(v3(arcCenterX, arcCenterY, arcZ), cam, W, H);
  if (!center) return;

  const pts: Array<{ x: number; y: number } | null> = [];
  for (let i = 0; i <= STEPS; i++) {
    const a = fAngle - Math.PI / 2 + (Math.PI * i / STEPS);
    pts.push(projPt(v3(arcCenterX + R * Math.cos(a), arcCenterY + R * Math.sin(a), arcZ), cam, W, H));
  }

  ctx.save();
  ctx.fillStyle   = 'rgba(232, 180, 46, 0.3)';
  ctx.strokeStyle = 'rgba(255, 210, 90, 0.95)';
  ctx.lineWidth   = 2.2;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowColor = 'rgba(255, 210, 100, 0.9)';
  ctx.shadowBlur  = 12;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  let started = false;
  for (const p of pts) {
    if (!p) { started = false; continue; }
    if (!started) { ctx.moveTo(p.x, p.y); started = true; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Render a glowing green ability book at a world position. */
function renderPickupBook(
  ctx: CanvasRenderingContext2D,
  pos: V3,
  cam: Cam,
  W: number, H: number,
  angleDeg: number = 0,
) {
  // Book world dimensions — lying FLAT on the ground (z = constant, x/y span the floor)
  const hw = 0.42; // half-width  (like holding a book open)
  const hd = 0.26; // half-depth  (thin paperback)

  const rad  = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  // Rotate offsets around world Z then translate to book center
  const wc = (dx: number, dy: number): V3 => v3(
    pos.x + dx * cosA - dy * sinA,
    pos.y + dx * sinA + dy * cosA,
    pos.z, // z stays 0 — flat on ground
  );

  // 4 book corners (world space, all at z=0)
  const corners = [
    wc(-hw, -hd),
    wc( hw, -hd),
    wc( hw,  hd),
    wc(-hw,  hd),
  ];
  // Spine 18% from left edge, full depth
  const spTop = wc(-hw + hw * 2 * 0.18, -hd);
  const spBot = wc(-hw + hw * 2 * 0.18,  hd);

  // Project all world corners to screen
  const sc = corners.map(c => projPt(c, cam, W, H));
  if (sc.some(p => !p || p.depth < NEAR_CLIP)) return;
  const sps = projPt(spTop, cam, W, H);
  const spb = projPt(spBot, cam, W, H);

  // Book center screen pos (for beam origin)
  const base = projPt(pos, cam, W, H);
  if (!base) return;

  // === BEAM: rises 0.5 × CHAR_HEIGHT = 1.0 world unit above book ===
  const beamTip = projPt(v3(pos.x, pos.y, pos.z + CHAR_HEIGHT * 0.5), cam, W, H);
  if (beamTip) {
    const bx = base.x, by = base.y;
    const tx = beamTip.x, ty = beamTip.y;
    // Beam base half-width ≈ screen-space hw of book
    const bHW = Math.max(2, (hw / base.depth) * cam.fl * 0.55);
    const grad = ctx.createLinearGradient(bx, by, tx, ty);
    grad.addColorStop(0,   'rgba(80,255,160,0.90)');
    grad.addColorStop(0.4, 'rgba(0,230,110,0.45)');
    grad.addColorStop(1,   'rgba(0,255,120,0.00)');
    ctx.save();
    ctx.shadowColor = 'rgba(0,255,120,0.90)';
    ctx.shadowBlur  = 20;
    ctx.beginPath();
    ctx.moveTo(bx - bHW, by);
    ctx.lineTo(bx + bHW, by);
    ctx.lineTo(tx + 0.4,  ty);
    ctx.lineTo(tx - 0.4,  ty);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // === BOOK BODY (flat quadrilateral projected from world space) ===
  ctx.save();
  ctx.fillStyle   = '#12090d';
  ctx.strokeStyle = '#3a2010';
  ctx.lineWidth   = 0.85;
  ctx.shadowBlur  = 0;
  ctx.beginPath();
  ctx.moveTo(sc[0]!.x, sc[0]!.y);
  ctx.lineTo(sc[1]!.x, sc[1]!.y);
  ctx.lineTo(sc[2]!.x, sc[2]!.y);
  ctx.lineTo(sc[3]!.x, sc[3]!.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Spine
  if (sps && spb) {
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = '#604020';
    ctx.lineWidth   = 0.45;
    ctx.beginPath();
    ctx.moveTo(sps.x, sps.y);
    ctx.lineTo(spb.x, spb.y);
    ctx.stroke();
  }
  ctx.restore();
}

function facingArrow(facing: { x: number; y: number } | undefined): string {
  if (!facing) return '·';
  const len = Math.sqrt(facing.x * facing.x + facing.y * facing.y);
  if (len < 0.05) return '·';
  const nx = facing.x / len;
  const ny = facing.y / len;
  const angle = Math.atan2(ny, nx);
  const idx = Math.round(angle / (Math.PI / 4));
  const dirs = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  return dirs[((idx % 8) + 8) % 8];
}

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

function pRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const cr = Math.min(r, w / 2, Math.max(0, h / 2));
  ctx.moveTo(x + cr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, cr);
  ctx.arcTo(x + w, y + h, x,     y + h, cr);
  ctx.arcTo(x,     y + h, x,     y,     cr);
  ctx.arcTo(x,     y,     x + w, y,     cr);
  ctx.closePath();
}

function renderCharacter(
  ctx: CanvasRenderingContext2D,
  pos: V3,
  cam: Cam,
  W: number, H: number,
  color: string,
  glowColor: string,
  hpFrac: number,
  isMe: boolean,
  isSelected: boolean = false,
) {
  const baseP = projPt(v3(pos.x, pos.y, pos.z),             cam, W, H);
  const topP  = projPt(v3(pos.x, pos.y, pos.z + CHAR_HEIGHT), cam, W, H);
  if (!baseP || !topP) return;

  const depth  = baseP.depth;
  const rs     = (CHAR_RADIUS / depth) * cam.fl;
  if (rs < 1.5) return;

  const bodyH     = baseP.y - topP.y;
  if (bodyH < 1) return;

  const cx        = topP.x;
  const ellipseRy = rs * 0.32;

  // Ground shadow — always projected at floor level (fades as player goes higher)
  const shadowP = projPt(v3(pos.x, pos.y, 0), cam, W, H);
  if (shadowP) {
    const sRs = (CHAR_RADIUS / shadowP.depth) * cam.fl;
    ctx.save();
    ctx.globalAlpha = Math.max(0.08, 0.35 - pos.z * 0.05);
    ctx.fillStyle   = '#000';
    ctx.beginPath();
    ctx.ellipse(shadowP.x, shadowP.y, sRs * 1.5, sRs * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Cylinder body
  const bodyGrad = ctx.createLinearGradient(cx - rs, 0, cx + rs, 0);
  bodyGrad.addColorStop(0,    shadeHex(color, -45));
  bodyGrad.addColorStop(0.28, color);
  bodyGrad.addColorStop(0.55, color);
  bodyGrad.addColorStop(1,    shadeHex(color, -40));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(cx - rs, topP.y);
  ctx.lineTo(cx - rs, baseP.y);
  ctx.ellipse(baseP.x, baseP.y, rs, ellipseRy, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rs, topP.y);
  ctx.ellipse(topP.x,  topP.y,  rs, ellipseRy, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();

  // Top face
  ctx.fillStyle  = color;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.ellipse(cx, topP.y, rs, ellipseRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Top highlight
  const topHL = ctx.createRadialGradient(cx - rs * 0.28, topP.y - ellipseRy * 0.35, 0, cx, topP.y, rs);
  topHL.addColorStop(0,   'rgba(255,255,255,0.5)');
  topHL.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  topHL.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = topHL;
  ctx.beginPath();
  ctx.ellipse(cx, topP.y, rs, ellipseRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glow outline for the local player
  if (isMe) {
    ctx.save();
    ctx.strokeStyle = glowColor;
    ctx.lineWidth   = 1.8;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(cx - rs, topP.y);
    ctx.lineTo(cx - rs, baseP.y);
    ctx.ellipse(baseP.x, baseP.y, rs, ellipseRy, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rs, topP.y);
    ctx.ellipse(topP.x, topP.y, rs, ellipseRy, 0, 0, Math.PI, true);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Floating HP bar
  const barW = Math.max(rs * 3.9, 57);
  const barH = 6;
  const barX = cx - barW / 2;
  const barY = topP.y - 22;

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  pRoundRect(ctx, barX - 1, barY - 1, barW + 2, barH + 2, 3);
  ctx.fill();

  const hpColor = isMe
    ? (hpFrac > 0.5 ? '#44dd55' : hpFrac > 0.25 ? '#ffcc22' : '#ee3333')
    : isSelected
    ? '#ff8888'
    : (hpFrac > 0.5 ? '#dd2222' : hpFrac > 0.25 ? '#cc1111' : '#991111');
  ctx.fillStyle = hpColor;
  const fillW = Math.max(0, barW * hpFrac);
  if (fillW > 0) {
    ctx.beginPath();
    pRoundRect(ctx, barX, barY, fillW, barH, 2);
    ctx.fill();
  }

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
  isReady: boolean;
  isCommon: boolean;
  target: 'SELF' | 'OPPONENT';
}

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
  me: { userId: string; position: Position; hp: number; hand: any[]; buffs?: ActiveBuff[]; facing?: Facing };
  opponent: { userId: string; position: Position; hp: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing };
  gameId: string;
  onCastAbility: (abilityInstanceId: string, targetUserId?: string) => Promise<void>;
  distance: number;
  maxHp: number;
  abilities: Record<string, any>;
  opponentPositionBufferRef?: React.MutableRefObject<Array<{ t: number; pos: Position }>>;
  /** Full game events array from state — used to spawn per-event floating numbers */
  events?: any[];
  /** Pickup items (ability books) currently on the ground */
  pickups?: PickupItem[];
}

/* ============================================================
   COMPONENT
   ============================================================ */
export default function BattleArena({
  me,
  opponent,
  gameId,
  onCastAbility,
  distance,
  maxHp,
  abilities,
  opponentPositionBufferRef,
  events = [],
  pickups = [],
}: BattleArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);

  /* --- React state (UI only) --- */
  const [handAbilities,    setHandAbilities]    = useState<AbilityInfo[]>([]);
  const [rtt,              setRtt]              = useState<number | null>(null);
  const [wasdKeys,         setWasdKeys]         = useState({ w: false, a: false, s: false, d: false });
  const [controlMode,      setControlMode]      = useState<'joystick' | 'traditional'>('traditional');
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [showCheatWindow,  setShowCheatWindow]  = useState(false);
  const [addingAbility,    setAddingAbility]    = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedSelf,     setSelectedSelf]     = useState(false);
  const [, setChannelTick] = useState(0); // forces re-renders for channel bar countdown

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
  const [minimizedModals,   setMinimizedModals]   = useState<Set<string>>(new Set());

  /* --- Draggable UI positions (persisted to localStorage) --- */
  const [uiPositions, setUiPositions] = useState<Record<string, { left: number; top: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('zhenchuan-ui-positions') ?? '{}'); } catch { return {}; }
  });
  const uiPositionsRef = useRef<Record<string, { left: number; top: number }>>({});

  /* --- Debug position overlay --- */
  const [showDebugGrid, setShowDebugGrid] = useState(false);
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
  type JumpRecord = { riseMs: number | null; fallMs: number | null; totalMs: number | null; peakZ: number | null };
  const [jumpRecord, setJumpRecord] = useState<JumpRecord>({ riseMs: null, fallMs: null, totalMs: null, peakZ: null });
  // Internal tracking refs (updated every rAF frame)
  const jumpPhaseRef  = useRef<'ground' | 'rising' | 'falling'>('ground');
  const takeoffTimeRef = useRef<number>(0);   // when feet left the ground
  const peakTimeRef    = useRef<number>(0);   // when apex was detected
  const prevZRef       = useRef<number>(0);   // previous frame Z for transition detection
  const peakZRef       = useRef<number>(0);   // max Z reached during current jump

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
    // Stagger: count how many same-type floats are currently alive to offset them
    const stagger = floatTypeCountRef.current[type] ?? 0;
    floatTypeCountRef.current[type] = stagger + 1;
    const yOffset = stagger * 28; // 28px per simultaneous float of the same type
    setFloats(f => [...f, { id, value, type, startTime: Date.now(), label: opts?.label, screenPct: opts?.screenPct, yOffset }]);
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
  const localPositionRef = useRef<Position | null>(null);
  const localVelocityRef = useRef({ x: 0, y: 0 });
  const initializedRef   = useRef(false);
  const movementAbortRef = useRef<AbortController | null>(null);

  /* --- Jump / Z refs --- */
  const jumpLocalRef      = useRef(false); // drives local Z prediction
  const jumpSendRef       = useRef(false); // queued for next movement POST
  const localZRef         = useRef(0);     // current Z height (world units)
  const localVzRef        = useRef(0);     // current Z velocity
  const localJumpCountRef = useRef(0);     // jumps used in current airtime (max 2)
  const localFacingRef    = useRef({ x: 0, y: 1 }); // current facing direction (default +Y)
  const meFacingRef       = useRef<Facing>({ x: 0, y: 1 });
  const oppFacingRef      = useRef<Facing>({ x: 0, y: 1 });

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
  const camZoomRef     = useRef(1.0);           // zoom multiplier (scroll wheel)
  const mouseStateRef  = useRef({ isLeft: false, isRight: false, lastX: 0, lastY: 0, downX: NaN, downY: NaN });

  /* --- Target selection refs --- */
  const selectedTargetRef   = useRef<string | null>(null);
  const selectedSelfRef     = useRef(false);
  const oppScreenBoundsRef  = useRef<{ cx: number; topY: number; baseY: number; rs: number } | null>(null);
  const meScreenBoundsRef   = useRef<{ cx: number; topY: number; baseY: number; rs: number } | null>(null);
  // Always reflects current opponent userId (stable in 1v1 but kept as ref for closure safety)
  const opponentUserIdRef   = useRef<string>(opponent.userId);
  opponentUserIdRef.current = opponent.userId;

  /* --- Dash animation refs --- */
  const localDashAnimRef = useRef<{ start: V3; startTime: number } | null>(null);
  const oppDashAnimRef   = useRef<{ start: V3; startTime: number } | null>(null);

  /* --- Render-loop refs (avoid stale closures) --- */
  const abilitiesRef  = useRef<AbilityInfo[]>([]);
  const meHpRef       = useRef(me?.hp ?? 0);
  const oppHpRef      = useRef(opponent?.hp ?? 0);
  const maxHpRef      = useRef(maxHp);
  const distanceRef   = useRef(distance);
  distanceRef.current = distance;
  const canvasSizeRef = useRef({ w: 800, h: 500 });

  /* --- Fuyao (扶摇直上) local buff prediction --- */
  const hasFuyaoBuffRef  = useRef(false);
  const isPowerJumpRef   = useRef(false); // true while airborne from a power jump (different gravity)
  const maxJumpsRef      = useRef(2);     // updated from me.buffs MULTI_JUMP effect

  /* --- Channel AOE refs (used in render loop, updated via useEffect) --- */
  const meChannelingRef  = useRef(false);
  const oppChannelingRef = useRef(false);

  // Ref-based cast wrapper — updated every render, so it always captures the
  // latest onCastAbility without causing keyboard/mouse useEffect re-runs.
  const castAbilityRef = useRef<(id: string) => void>(() => {});
  castAbilityRef.current = (id: string) => {
    const ability = abilitiesRef.current.find(a => a.id === id);
    if (ability?.abilityId === 'fuyao_zhishang') hasFuyaoBuffRef.current = true;
    // Abilities targeting the opponent require a target to be selected first
    if (ability?.target === 'OPPONENT' && !selectedTargetRef.current) {
      toastError('请先选择目标');
      return;
    }
    // Stamp the ability name so the damage / heal float can label itself
    lastCastNameRef.current = ability?.name ?? null;
    onCastAbility(id, selectedTargetRef.current ?? undefined);
  };

  /* --- Render position + dash-trail refs --- */
  const localRenderPosRef = useRef<V3>({ x: me?.position?.x ?? 50, y: me?.position?.y ?? 50, z: 0 });
  const oppRenderPosRef   = useRef<V3>({ x: opponent?.position?.x ?? 50, y: opponent?.position?.y ?? 50, z: 0 });
  const localTrailRef     = useRef<Array<{ pos: V3; alpha: number }>>([]);
  const oppTrailRef       = useRef<Array<{ pos: V3; alpha: number }>>([]);
  const lastFrameTimeRef  = useRef<number>(0);

  useEffect(() => { meHpRef.current  = me?.hp ?? 0;      }, [me?.hp]);
  // Keep max-jumps ref in sync with MULTI_JUMP buff from server state
  useEffect(() => {
    const multiJump = me?.buffs?.flatMap((b: any) => b.effects ?? []).find((e: any) => e.type === 'MULTI_JUMP');
    maxJumpsRef.current = multiJump ? (multiJump.value ?? 2) : 2;
  }, [me?.buffs]);
  useEffect(() => { oppHpRef.current = opponent?.hp ?? 0; }, [opponent?.hp]);
  useEffect(() => { maxHpRef.current = maxHp;             }, [maxHp]);
  useEffect(() => {
    const f = me?.facing;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      meFacingRef.current = { x: f.x, y: f.y };
    }
  }, [me?.facing?.x, me?.facing?.y]);
  useEffect(() => {
    const f = opponent?.facing;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      oppFacingRef.current = { x: f.x, y: f.y };
    }
  }, [opponent?.facing?.x, opponent?.facing?.y]);

  // Restore control mode from localStorage on mount
  useEffect(() => {
    const saved = (localStorage.getItem('controlMode')) as 'joystick' | 'traditional' | null;
    const mode  = (saved === 'joystick' || saved === 'traditional') ? saved : 'traditional';
    setControlMode(mode);
    controlModeRef.current = mode;
  }, []);

  // Channel bar countdown: tick every 50ms while 不工 buff (buffId 1014) is active
  const channelBuff = me?.buffs?.find((b: any) => b.buffId === 1014);
  useEffect(() => {
    if (!channelBuff) return;
    const id = setInterval(() => setChannelTick(t => t + 1), 50);
    return () => clearInterval(id);
  }, [(channelBuff as any)?.expiresAt]);

  // Ref that the rAF writes a new jump record into (avoids stale closure in rAF)
  const jumpRecordNextRef = useRef<{ riseMs: number; fallMs: number; totalMs: number; peakZ: number } | null>(null);

  // Poll height + consume any finished jump record every 50 ms
  useEffect(() => {
    const id = setInterval(() => {
      setMyZ(Math.round(myZRef.current * 10) / 10);
      const rec = jumpRecordNextRef.current;
      if (rec) {
        jumpRecordNextRef.current = null;
        setJumpRecord({ riseMs: rec.riseMs, fallMs: rec.fallMs, totalMs: rec.totalMs, peakZ: rec.peakZ });
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

  // Keep pickups ref up-to-date for render loop
  useEffect(() => {
    pickupsRef.current = pickups;
  }, [pickups]);

  // Keep nearbyPickupIdsRef + pickupModalsRef + uiPositionsRef in sync
  useEffect(() => { nearbyPickupIdsRef.current = nearbyPickupIds; }, [nearbyPickupIds]);
  useEffect(() => { pickupModalsRef.current    = pickupModals;    }, [pickupModals]);
  useEffect(() => { uiPositionsRef.current     = uiPositions;     }, [uiPositions]);

  // Proximity check: collect ALL books within range, sorted closest-first (runs every 100ms)
  // Also auto-close pickup panels whose book is now beyond claim range (20 units)
  useEffect(() => {
    const PICKUP_RANGE = 8;
    const CLAIM_RANGE  = 20;
    const id = setInterval(() => {
      const pos = localPositionRef.current;
      if (!pos) return;
      const items = pickupsRef.current;
      const nearby: Array<{ id: string; dist: number }> = [];
      for (const p of items) {
        const dx = pos.x - p.position.x;
        const dy = pos.y - p.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
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
          return Math.sqrt(dx * dx + dy * dy) > CLAIM_RANGE;
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
      if (evt.type === 'DAMAGE' && (evt.value ?? 0) > 0) {
        if (evt.targetUserId === myId) {
          // I took damage
          const bounds = meScreenBoundsRef.current;
          const { w, h } = canvasSizeRef.current;
          const screenPct = bounds
            ? { x: bounds.cx / w, y: Math.max(0, (bounds.topY - 22) / h) }
            : undefined;
          addFloat(evt.value, 'dmg_taken', { label: evt.abilityName, screenPct });
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
        const bounds = meScreenBoundsRef.current;
        const { w, h } = canvasSizeRef.current;
        const screenPct = bounds
          ? { x: bounds.cx / w, y: Math.max(0, (bounds.topY - 22) / h) }
          : undefined;
        addFloat(evt.value, 'heal', { label: evt.abilityName, screenPct });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  /* --- Track opponent hand cooldown resets (kept for other UI purposes) --- */
  const prevOppHandRef      = useRef<any[]>([]);

  /* ========================= MOVEMENT ========================= */

  const sendMovement = useCallback(async () => {
    const k = keysRef.current;
    // Capture & clear jump flag atomically before the async POST
    const shouldJump = jumpSendRef.current;
    if (shouldJump) jumpSendRef.current = false;
    movementAbortRef.current?.abort();
    movementAbortRef.current = new AbortController();
    try {
      await fetch('/api/game/movement', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal:      movementAbortRef.current.signal,
        body: JSON.stringify({
          gameId,
          // Always send the character's current facing direction so server-side
          // abilities (dashes, etc.) use the correct orientation
          facing: {
            x: Math.sin(charYawRef.current),
            y: Math.cos(charYawRef.current),
          },
          direction: (() => {
            if (controlModeRef.current === 'traditional') {
              const mouseLook = mouseStateRef.current.isRight;
              const bothMouse = mouseStateRef.current.isRight && mouseStateRef.current.isLeft;

              if (mouseLook) {
                // MMO mouselook: move relative to camera, camera yaw unchanged unless mouse moves.
                const yaw = camYawRef.current;
                const fwd = { x: Math.sin(yaw), y: Math.cos(yaw) };
                const right = { x: Math.cos(yaw), y: -Math.sin(yaw) };

                let forwardInput = (k.w ? 1 : 0) + (k.s ? -1 : 0) + (bothMouse ? 1 : 0);
                let strafeInput = (k.d ? 1 : 0) + (k.a ? -1 : 0);

                // Requested behavior: RMB + A + D => forward-right diagonal.
                if (k.a && k.d) {
                  strafeInput = 1;
                  forwardInput += 1;
                }

                let dx = fwd.x * forwardInput + right.x * strafeInput;
                let dy = fwd.y * forwardInput + right.y * strafeInput;
                if (dx === 0 && dy === 0 && !shouldJump) return null;

                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const backpedalOnly = k.s && !k.w && !k.a && !k.d && !bothMouse;
                const speedMult = backpedalOnly ? 0.5 : 1.0;
                dx = (dx / len) * speedMult;
                dy = (dy / len) * speedMult;
                return { dx, dy, jump: shouldJump };
              }

              // Keyboard-only traditional mode: movement follows facing.
              const moveFwd = { x: Math.sin(charYawRef.current), y: Math.cos(charYawRef.current) };
              let dx = 0, dy = 0;
              if (k.w) { dx += moveFwd.x; dy += moveFwd.y; }
              if (k.s) { dx -= moveFwd.x; dy -= moveFwd.y; }
              if (dx === 0 && dy === 0 && !shouldJump) return null;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const backpedalOnly = k.s && !k.w && !k.a && !k.d;
              const speedMult = backpedalOnly ? 0.5 : 1.0;
              return { dx: (dx / len) * speedMult, dy: (dy / len) * speedMult, jump: shouldJump };
            }
            // 摇杆模式: absolute WASD
            return (k.w || k.a || k.s || k.d || shouldJump)
              ? { up: k.s, down: k.w, left: k.a, right: k.d, jump: shouldJump }
              : null;
          })(),
        }),
      });
    } catch { /* AbortError expected */ }
  }, [gameId]);

  useEffect(() => {
    if (me?.position && !initializedRef.current) {
      localPositionRef.current = { ...me.position };
      initializedRef.current   = true;
    }
  }, [me?.position?.x, me?.position?.y]);

  useEffect(() => {
    if (!me?.position || !initializedRef.current) return;
    const local  = localPositionRef.current;
    if (!local) return;
    const dx = me.position.x - local.x;
    const dy = me.position.y - local.y;
    // Hard-snap if server position is far away (e.g. new battle start)
    if (dx * dx + dy * dy > 25) {
      localPositionRef.current = { ...me.position };
      return;
    }
    const moving = keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d;
    const blend  = moving ? 0.03 : 0.25;
    localPositionRef.current = {
      x: local.x + dx * blend,
      y: local.y + dy * blend,
    };
  }, [me?.position?.x, me?.position?.y]);

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
            isReady:     (instance.cooldown ?? 0) === 0,
            isCommon:    false,
            target:      'OPPONENT' as 'SELF' | 'OPPONENT',
          };
        }
        return {
          id:          instanceId,
          abilityId:      ability.id,
          name:        ability.name,
          range:       ability.range,
          minRange:    ability.minRange,
          cooldown:    instance.cooldown || 0,
          maxCooldown: ability.cooldownTicks ?? 0,
          isReady:     (instance.cooldown ?? 0) === 0 && (!ability.range || distance <= ability.range),
          isCommon:    false,
          target:      (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
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
        const instanceId = instance?.instanceId ?? ability.id;
        const cooldown   = instance?.cooldown ?? 0;
        return {
          id:          instanceId,
          abilityId:      ability.id,
          name:        ability.name,
          range:       ability.range,
          minRange:    ability.minRange,
          cooldown,
          maxCooldown: ability.cooldownTicks ?? 0,
          isReady:     cooldown === 0 && (!ability.range || distance <= ability.range),
          isCommon:    true,
          target:      (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
        } as AbilityInfo;
      })
      .filter(Boolean) as AbilityInfo[];

    const updated = [...commonUpdated, ...draftUpdated];
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BattleArena] hand: ${me.hand.length} items → ${draftUpdated.length} draft + ${commonUpdated.length} common`);
    }
    setHandAbilities(updated);
    abilitiesRef.current = updated;
  }, [me.hand, me.buffs, opponent?.buffs, distance, abilities]);

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
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = true;
        setWasdKeys(prev => ({ ...prev, [k]: true }));
      }
      // Space = jump
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        jumpLocalRef.current = true;
        jumpSendRef.current  = true;
      }
      // Escape = close any open overlay (pickup panel; extend here for future modals)
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickupModals([]);
        return;
      }
      // F = interact with nearby pickup (channel to open panel; claim if panel already open)
      if (k === 'f') {
        e.preventDefault();
        handlePickupInteractRef.current();
        return;
      }
      // Tab / F1 — select opponent as target
      if (e.key === 'Tab' || e.key === 'F1') {
        e.preventDefault();
        setSelectedTargetId(opponentUserIdRef.current);
        selectedTargetRef.current = opponentUserIdRef.current;
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
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = false;
        setWasdKeys(prev => ({ ...prev, [k]: false }));
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
    };
  }, []);

  // Mouse hotkeys + camera drag + zoom:
  //   Left-drag              → rotate camera (traditional mode)
  //   Right-drag             → rotate camera + snap character facing (traditional mode)
  //   Middle-down (MD)       → common[1] 扶摇直上
  //   Alt+W                  → common[2] 蹑云逐月
  //   Button-3 / XB1 (down)  → draft[4]
  //   Button-4 / XB2 (down)  → draft[5]
  //   Wheel up/down          → zoom in/out
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      // Left button — start camera drag
      if (e.button === 0) {
        // Only start drag if not clicking a UI button or a draggable panel
        if ((e.target as HTMLElement).closest('button, [data-ui-drag]')) return;
        mouseStateRef.current.isLeft = true;
        mouseStateRef.current.lastX  = e.clientX;
        mouseStateRef.current.lastY  = e.clientY;
        mouseStateRef.current.downX  = e.clientX;
        mouseStateRef.current.downY  = e.clientY;
        return;
      }
      // Right button — start character rotate drag (context menu already suppressed by onContextMenu)
      if (e.button === 2) {
        mouseStateRef.current.isRight = true;
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
        const ab = abilitiesRef.current.filter(a => !a.isCommon)[4]; // draft slot 5 (XB1)
        if (ab?.isReady) castAbilityRef.current(ab.id);
        return;
      }
      if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        const ab = abilitiesRef.current.filter(a => !a.isCommon)[5]; // draft slot 6 (XB2)
        if (ab?.isReady) castAbilityRef.current(ab.id);
        return;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        mouseStateRef.current.isLeft = false;
        // Detect click (no significant drag) for target selection
        const dx = Math.abs(e.clientX - mouseStateRef.current.downX);
        const dy = Math.abs(e.clientY - mouseStateRef.current.downY);
        mouseStateRef.current.downX = NaN;
        mouseStateRef.current.downY = NaN;
        if (!isNaN(dx) && dx < 5 && dy < 5 && !(e.target as HTMLElement).closest('button')) {
          const canvas = canvasRef.current;
          const bounds = oppScreenBoundsRef.current;
          if (canvas && bounds) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvasSizeRef.current.w / (rect.width  || 1);
            const scaleY = canvasSizeRef.current.h / (rect.height || 1);
            const canvasX = (e.clientX - rect.left) * scaleX;
            const canvasY = (e.clientY - rect.top)  * scaleY;
            const hitX = Math.abs(canvasX - bounds.cx) <= bounds.rs + 8;
            const hitY = canvasY >= bounds.topY - 10 && canvasY <= bounds.baseY + 10;
            if (hitX && hitY) {
              setSelectedTargetId(opponentUserIdRef.current);
              selectedTargetRef.current = opponentUserIdRef.current;
            } else {
              setSelectedTargetId(null);
              selectedTargetRef.current = null;
            }
          }
        }
        return;
      }
      if (e.button === 2) {
        mouseStateRef.current.isRight = false;
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
      if (controlModeRef.current !== 'traditional') return;
      const ms = mouseStateRef.current;
      if (!ms.isLeft && !ms.isRight) return;
      const dx = e.clientX - ms.lastX;
      const dy = e.clientY - ms.lastY;
      ms.lastX = e.clientX;
      ms.lastY = e.clientY;

      if (ms.isRight && !ms.isLeft) {
        // RMB only: rotate camera; character snaps to camera direction
        camYawRef.current  += dx * 0.005;
        charYawRef.current  = camYawRef.current;
        // Update pitch too (drag up/down tilts view)
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = Math.max(0.08, Math.min(Math.PI * 0.47, newPitch));
        // Immediately sync facing arrow so it updates without requiring movement
        localFacingRef.current = {
          x: Math.sin(charYawRef.current),
          y: Math.cos(charYawRef.current),
        };
      } else if (ms.isLeft && !ms.isRight) {
        // LMB only: rotate camera yaw + pitch
        camYawRef.current  += dx * 0.005;
        // dy > 0 = drag down = look more from above (increase pitch)
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = Math.max(0.08, Math.min(Math.PI * 0.47, newPitch));
      } else {
        // LMB + RMB together: rotate camera + character facing; physics tick moves forward
        camYawRef.current  += dx * 0.005;
        charYawRef.current  = camYawRef.current;
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = Math.max(0.08, Math.min(Math.PI * 0.47, newPitch));
        localFacingRef.current = {
          x: Math.sin(charYawRef.current),
          y: Math.cos(charYawRef.current),
        };
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
      e.preventDefault();
      // deltaY > 0 = scroll down = zoom out; < 0 = scroll up = zoom in
      const delta = e.deltaY > 0 ? 0.12 : -0.12;
      camZoomRef.current = Math.max(0.4, Math.min(2.5, camZoomRef.current + delta));
    };
    // Use capture phase so we intercept BEFORE the browser's own navigation handlers
    window.addEventListener('mousedown',   onMouseDown,   { capture: true });
    window.addEventListener('mouseup',     onMouseUp,     { capture: true });
    window.addEventListener('mousemove',   onMouseMove,   { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('auxclick',    onAuxClick,    { capture: true });
    window.addEventListener('wheel',       onWheel,       { passive: false, capture: true });
    return () => {
      window.removeEventListener('mousedown',   onMouseDown,   { capture: true });
      window.removeEventListener('mouseup',     onMouseUp,     { capture: true });
      window.removeEventListener('mousemove',   onMouseMove,   { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('auxclick',    onAuxClick,    { capture: true });
      window.removeEventListener('wheel',       onWheel,       { capture: true } as EventListenerOptions);
    };
  }, []);

  const handleJoystickDirection = useCallback(
    (keys: { w: boolean; a: boolean; s: boolean; d: boolean }) => {
      keysRef.current = keys;
      setWasdKeys(keys);
    },
    [],
  );

  /* Physics — mirrors server exactly */
  useEffect(() => {
    // 7.5 u/s at 30 Hz = 0.25 u/tick
    const MAX_SPEED = 0.25, ACCEL = 0.3, DECEL = 0.9;
    // 30 Hz client physics — asymmetric gravity, tuned per jump type:
    //   Single jump : 1.7 u peak, 1.0 s rise, 0.7 s fall  → 1.7 s total
    //   Double jump : +0.755 u extra (peak 2.455 u)         → ~2.51 s total from takeoff
    //   Power jump  : 12.8 u peak, 1.77 s rise, 1.93 s fall → 3.7 s total
    const GRAVITY_UP_CLIENT         = 2 * 1.7  / (30 * 30);            // ≈ 0.003778 (regular rise)
    const GRAVITY_DOWN_CLIENT       = 2 * 1.7  / (21 * 21);            // ≈ 0.007710 (regular fall, 0.7 s)
    const JUMP_VZ_CLIENT            = GRAVITY_UP_CLIENT * 30;           // ≈ 0.11333 (1.0 s → 1.7 u)
    const DOUBLE_JUMP_VZ_CLIENT     = GRAVITY_UP_CLIENT * 20;           // ≈ 0.07556 (+0.755 u → 2.51 s total)
    const POWER_GRAVITY_UP_CLIENT   = 2 * 12.8 / (53.1 * 53.1);        // ≈ 0.009079 (1.77 s rise)
    const POWER_GRAVITY_DOWN_CLIENT = 2 * 12.8 / (57.9 * 57.9);        // ≈ 0.007636 (1.93 s fall)
    const POWER_JUMP_VZ_CLIENT      = POWER_GRAVITY_UP_CLIENT * 53.1;   // ≈ 0.4823  (12.8 u peak)
    const TURN_RATE = 0.055; // radians / tick at 30 Hz ≈ 95°/sec
    const tick = () => {
      const pos = localPositionRef.current;
      if (!pos) return;
      const vel = localVelocityRef.current;
      const k   = keysRef.current;
      const ms  = mouseStateRef.current;

      if (controlModeRef.current === 'traditional') {
        const mouseLook = ms.isRight;
        const bothMouse = ms.isRight && ms.isLeft;

        if (mouseLook) {
          // MMO mouselook: camera turns from mouse; movement is camera-relative.
          // Facing follows movement intent except pure backpedal.
        } else {
          // JX3-like keyboard turning: A/D turn camera first; character follows
          // only when camera drifts far from current facing.
          const turning = (k.a ? -1 : 0) + (k.d ? 1 : 0);
          if (turning !== 0) {
            camYawRef.current += turning * TURN_RATE;
          }

          const rawDelta = camYawRef.current - charYawRef.current;
          const FOLLOW_THRESHOLD = Math.PI; // 180 degrees
          if (Math.abs(rawDelta) >= FOLLOW_THRESHOLD) {
            const delta = normalizeAngle(rawDelta);
            const step = Math.max(-TURN_RATE, Math.min(TURN_RATE, delta));
            charYawRef.current += step;
            localFacingRef.current = {
              x: Math.sin(charYawRef.current),
              y: Math.cos(charYawRef.current),
            };
          }
        }

        let fx = 0, fy = 0;

        if (mouseLook) {
          const yaw = camYawRef.current;
          const moveFwd = { x: Math.sin(yaw), y: Math.cos(yaw) };
          const moveRight = { x: Math.cos(yaw), y: -Math.sin(yaw) };

          let forwardInput = (k.w ? 1 : 0) + (k.s ? -1 : 0) + (bothMouse ? 1 : 0);
          let strafeInput = (k.d ? 1 : 0) + (k.a ? -1 : 0);

          // Requested behavior: RMB + A + D => forward-right diagonal.
          if (k.a && k.d) {
            strafeInput = 1;
            forwardInput += 1;
          }

          fx = moveFwd.x * forwardInput + moveRight.x * strafeInput;
          fy = moveFwd.y * forwardInput + moveRight.y * strafeInput;
        } else {
          const moveFwd = { x: Math.sin(charYawRef.current), y: Math.cos(charYawRef.current) };
          if (k.w) { fx += moveFwd.x; fy += moveFwd.y; }
          if (k.s) { fx -= moveFwd.x; fy -= moveFwd.y; }
        }

        if (fx !== 0 || fy !== 0) {
          const len = Math.sqrt(fx * fx + fy * fy);
          // Backpedal is slower while keeping facing unchanged.
          const backpedalOnly = k.s && !k.w && !k.a && !k.d && !bothMouse;
          const speedMult = backpedalOnly ? 0.5 : 1.0;
          vel.x += ((fx / len) * MAX_SPEED * speedMult - vel.x) * ACCEL;
          vel.y += ((fy / len) * MAX_SPEED * speedMult - vel.y) * ACCEL;
          if (mouseLook && !backpedalOnly) {
            charYawRef.current = Math.atan2(fx / len, fy / len);
            localFacingRef.current = {
              x: Math.sin(charYawRef.current),
              y: Math.cos(charYawRef.current),
            };
          }
        } else {
          vel.x *= DECEL;
          vel.y *= DECEL;
        }
      } else {
        // 摇杆模式: WASD = absolute world directions
        let ix = 0, iy = 0;
        if (k.w) iy += 1;
        if (k.s) iy -= 1;
        if (k.a) ix -= 1;
        if (k.d) ix += 1;
        if (ix !== 0 || iy !== 0) {
          const len = Math.sqrt(ix * ix + iy * iy);
          vel.x += ((ix / len) * MAX_SPEED - vel.x) * ACCEL;
          vel.y += ((iy / len) * MAX_SPEED - vel.y) * ACCEL;
          localFacingRef.current = { x: ix / len, y: iy / len };
        } else {
          vel.x *= DECEL;
          vel.y *= DECEL;
        }
      }

      localPositionRef.current = {
        x: Math.max(2, Math.min(ARENA_WIDTH - 2, pos.x + vel.x)),
        y: Math.max(2, Math.min(ARENA_HEIGHT - 2, pos.y + vel.y)),
      };

      // ── Z axis: jump + gravity ──
      if (jumpLocalRef.current && localJumpCountRef.current < maxJumpsRef.current) {
        const jumpVz = hasFuyaoBuffRef.current ? POWER_JUMP_VZ_CLIENT
          : localJumpCountRef.current === 0 ? JUMP_VZ_CLIENT
          : DOUBLE_JUMP_VZ_CLIENT;
        if (hasFuyaoBuffRef.current) isPowerJumpRef.current = true;
        else if (localJumpCountRef.current === 0) isPowerJumpRef.current = false;
        hasFuyaoBuffRef.current   = false;
        localVzRef.current        = jumpVz;
        localJumpCountRef.current += 1;
        jumpLocalRef.current       = false;
      }
      const gravUp   = isPowerJumpRef.current ? POWER_GRAVITY_UP_CLIENT   : GRAVITY_UP_CLIENT;
      const gravDown = isPowerJumpRef.current ? POWER_GRAVITY_DOWN_CLIENT  : GRAVITY_DOWN_CLIENT;
      localVzRef.current -= (localVzRef.current >= 0 ? gravUp : gravDown);
      localZRef.current   = Math.max(0, localZRef.current + localVzRef.current);
      if (localZRef.current <= 0 && localVzRef.current < 0) {
        localZRef.current         = 0;
        localVzRef.current        = 0;
        localJumpCountRef.current = 0;
        isPowerJumpRef.current    = false;
      }
    };
    const id = setInterval(tick, 33);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(sendMovement, 33);
    return () => { clearInterval(id); movementAbortRef.current?.abort(); };
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

  /* ResizeObserver: keep canvas pixel size in sync */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const w = Math.round(width), h = Math.round(height);
      canvasSizeRef.current = { w, h };
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = w; canvas.height = h; }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ========================= RENDER LOOP ========================= */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const loop = () => {
      /* Resolove opponent position with interpolation */
      const renderTime = performance.now() - RENDER_DELAY_MS;
      const buf  = activeOpponentBuffer.current;
      let opPos: Position | null = opponentRawRef.current;

      if (buf.length >= 2) {
        const last = buf[buf.length - 1];
        const prev = buf[buf.length - 2];
        if (renderTime <= buf[0].t) {
          opPos = buf[0].pos;
        } else if (renderTime >= last.t) {
          const span = last.t - prev.t;
          if (span > 0) {
            const over = Math.min((renderTime - last.t) / span, 1);
            opPos = {
              x: Math.max(2, Math.min(98, last.pos.x + (last.pos.x - prev.pos.x) * over)),
              y: Math.max(2, Math.min(98, last.pos.y + (last.pos.y - prev.pos.y) * over)),
              z: Math.max(0, (last.pos.z ?? 0) + ((last.pos.z ?? 0) - (prev.pos.z ?? 0)) * over),
            };
          } else opPos = last.pos;
        } else {
          for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) {
              const lo = buf[i], hi = buf[i + 1];
              const span = hi.t - lo.t;
              const t = span > 0 ? (renderTime - lo.t) / span : 1;
              opPos = {
                x: lo.pos.x + (hi.pos.x - lo.pos.x) * t,
                y: lo.pos.y + (hi.pos.y - lo.pos.y) * t,
                z: (lo.pos.z ?? 0) + ((hi.pos.z ?? 0) - (lo.pos.z ?? 0)) * t,
              };
              break;
            }
          }
        }
      } else if (buf.length === 1) {
        opPos = buf[0].pos;
      }

      const myPos = localPositionRef.current;
      const { w, h } = canvasSizeRef.current;

      if (!myPos || !opPos || w < 10 || h < 10) {
        if (w >= 10 && h >= 10) {
          ctx.fillStyle = '#020509';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#444';
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Connecting…', w / 2, h / 2);
        }
        animId = requestAnimationFrame(loop);
        return;
      }

      // ── Smooth render positions; large jumps trigger 1.5 s cosmetic dash animation ──
      const frameNow = performance.now();
      const frameDt  = lastFrameTimeRef.current === 0 ? 16 : Math.min(frameNow - lastFrameTimeRef.current, 50);
      lastFrameTimeRef.current = frameNow;
      const dtF = frameDt / 16.67; // normalised to 60 fps
      const DASH_THRESH = 3.5;     // world units — smaller = walk blend, larger = dash anim
      const SNAP_THRESH = 20;       // world units — instant-snap for initial position or server teleport

      // --- local player render pos ---
      {
        const tx = myPos.x, ty = myPos.y, tz = localZRef.current;
        const r  = localRenderPosRef.current;
        const ddx = tx - r.x, ddy = ty - r.y, ddz = tz - r.z;
        const dist2d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist2d > SNAP_THRESH) {
          // Very large jump — snap instantly (initial position, server correction)
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
          localDashAnimRef.current  = null;
        } else if (!localDashAnimRef.current && dist2d > DASH_THRESH) {
          // Moderate jump — start travel animation (no visible trail)
          localDashAnimRef.current = { start: { ...r }, startTime: frameNow };
        }
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
          const k = Math.min(1, 0.3 * dtF);
          localRenderPosRef.current = { x: r.x + ddx * k, y: r.y + ddy * k, z: r.z + ddz * k };
        }
        // Trails removed
      }

      // --- opponent render pos ---
      {
        const tx = opPos.x, ty = opPos.y, tz = opPos.z ?? 0;
        const r  = oppRenderPosRef.current;
        const ddx = tx - r.x, ddy = ty - r.y, ddz = tz - r.z;
        const oppDist2d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (oppDist2d > SNAP_THRESH) {
          oppRenderPosRef.current = { x: tx, y: ty, z: tz };
          oppDashAnimRef.current  = null;
        } else if (!oppDashAnimRef.current && oppDist2d > DASH_THRESH) {
          oppDashAnimRef.current = { start: { ...r }, startTime: frameNow };
        }
        if (oppDashAnimRef.current) {
          const elapsed = frameNow - oppDashAnimRef.current.startTime;
          const t = Math.min(1, elapsed / DASH_ANIM_MS);
          const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          oppRenderPosRef.current = {
            x: oppDashAnimRef.current.start.x + (tx - oppDashAnimRef.current.start.x) * eased,
            y: oppDashAnimRef.current.start.y + (ty - oppDashAnimRef.current.start.y) * eased,
            z: oppDashAnimRef.current.start.z + (tz - oppDashAnimRef.current.start.z) * eased,
          };
          if (t >= 1) oppDashAnimRef.current = null;
        } else {
          const k = Math.min(1, 0.3 * dtF);
          oppRenderPosRef.current = { x: r.x + ddx * k, y: r.y + ddy * k, z: r.z + ddz * k };
        }
        // Trails removed
      }

      const myRP = localRenderPosRef.current;
      const opRP = oppRenderPosRef.current;

      // Keep the height display ref up to date (read by the 50ms polling interval)
      const curZ   = myRP.z ?? 0;
      const prevZ  = prevZRef.current;
      const nowMs  = performance.now();
      const phase  = jumpPhaseRef.current;

      if (phase === 'ground') {
        if (curZ > 0.01) {
          // Lifted off
          jumpPhaseRef.current   = 'rising';
          takeoffTimeRef.current  = nowMs;
          peakTimeRef.current     = nowMs;
          peakZRef.current        = curZ;
        }
      } else if (phase === 'rising') {
        if (curZ > prevZ) {
          peakTimeRef.current = nowMs;                              // keep pushing apex time while still rising
          peakZRef.current  = Math.max(peakZRef.current, curZ);     // track highest point
        } else {
          // Transitioned from rising → falling
          jumpPhaseRef.current = 'falling';
        }
      } else /* falling */ {
        if (curZ <= 0.01 && prevZ > 0.01) {
          // Landed
          const total  = nowMs - takeoffTimeRef.current;
          const rise   = peakTimeRef.current - takeoffTimeRef.current;
          const fall   = nowMs - peakTimeRef.current;
          jumpRecordNextRef.current = { riseMs: rise, fallMs: fall, totalMs: total, peakZ: peakZRef.current };
          jumpPhaseRef.current = 'ground';
        }
      }

      prevZRef.current = curZ;
      myZRef.current   = curZ;

      // Camera follows smooth render pos (including jump Z)
      const camDir = controlModeRef.current === 'traditional'
        ? { x: Math.sin(camYawRef.current), y: Math.cos(camYawRef.current) }
        : CAM_DIR;
      const cam = buildCam(v3(myRP.x, myRP.y, myRP.z), camDir, w, h, camZoomRef.current, camPitchRef.current);

      /* Draw scene */
      renderBg(ctx, cam, w, h);
      renderFloor(ctx, cam, w, h);

      /* Range indicator circle */
      const abilityList    = abilitiesRef.current;
      const readyAbility   = abilityList.find(a => a.isReady && a.range);
      const minRangeAbil   = abilityList.find(a => a.minRange);
      if (readyAbility?.range)
        renderRangeCircle(ctx, v3(myRP.x, myRP.y, 0), readyAbility.range, cam, w, h, 'rgba(80, 210, 100, 0.55)');
      if (minRangeAbil?.minRange)
        renderRangeCircle(ctx, v3(myRP.x, myRP.y, 0), minRangeAbil.minRange, cam, w, h, 'rgba(255, 80, 80, 0.45)');

      /* Channel AOE zone (风来吴山 不工 buff — range 10) */
      if (meChannelingRef.current)
        renderAoeZone(ctx, v3(myRP.x, myRP.y, 0), 10, cam, w, h, '#ffdd00', '#ffd700');
      if (oppChannelingRef.current)
        renderAoeZone(ctx, v3(opRP.x, opRP.y, 0), 10, cam, w, h, '#ff3300', '#ff5500');

      /* ── Depth-sorted render: map objects + characters ── */
      const mxHp = maxHpRef.current;

      type RenderItem =
        | { kind: 'obj';  obj: MapObject; depth: number }
        | { kind: 'char'; pos: V3; color: string; glow: string; hp: number; isMe: boolean; depth: number };

      const renderItems: RenderItem[] = [];

      // Collect visible map objects (within 200 world units of camera position)
      for (const obj of worldMapObjects) {
        const cx = obj.x + obj.w * 0.5;
        const cy = obj.y + obj.d * 0.5;
        const cz = obj.h * 0.5;
        const ddx = cx - cam.pos.x, ddy = cy - cam.pos.y, ddz = cz - cam.pos.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz > 600 * 600) continue;
        const depth = ddx * cam.fwd.x + ddy * cam.fwd.y + ddz * cam.fwd.z;
        renderItems.push({ kind: 'obj', obj, depth });
      }

      // Collect characters
      const charEntries = [
        { pos: v3(opRP.x, opRP.y, opRP.z), color: '#cc3333', glow: '#ff5555', hp: oppHpRef.current, isMe: false },
        { pos: v3(myRP.x, myRP.y, myRP.z), color: '#1a66cc', glow: '#44aaff', hp: meHpRef.current,  isMe: true  },
      ];      for (const c of charEntries) {
        const ddx = c.pos.x - cam.pos.x, ddy = c.pos.y - cam.pos.y, ddz = c.pos.z - cam.pos.z;
        const depth = ddx * cam.fwd.x + ddy * cam.fwd.y + ddz * cam.fwd.z;
        renderItems.push({ kind: 'char', ...c, depth });
      }

      // Painter's algorithm: farthest first
      renderItems.sort((a, b) => b.depth - a.depth);

      for (const item of renderItems) {
        if (item.kind === 'obj') {
          renderMapObject(ctx, item.obj, cam, w, h);
        } else {
          const e = item;
          renderCharacter(ctx, e.pos, cam, w, h, e.color, e.glow, Math.max(0, e.hp / mxHp), e.isMe, !e.isMe && selectedTargetRef.current !== null);
          if (e.isMe) {
            if (selectedSelfRef.current) renderFacingArc(ctx, e.pos, meFacingRef.current, cam, w, h);
            // Save local player screen bounds for float positioning
            const meBaseP = projPt(e.pos, cam, w, h);
            const meTopP  = projPt(v3(e.pos.x, e.pos.y, e.pos.z + CHAR_HEIGHT), cam, w, h);
            if (meBaseP && meTopP) {
              const mrs = (CHAR_RADIUS / meBaseP.depth) * cam.fl;
              meScreenBoundsRef.current = { cx: meBaseP.x, topY: meTopP.y, baseY: meBaseP.y, rs: mrs };
            }
          } else {
            // Show opponent facing arc only when selected
            if (selectedTargetRef.current) {
              renderFacingArc(ctx, e.pos, oppFacingRef.current, cam, w, h);
            }
            // Save opponent screen bounds for click hit-testing
            const baseP = projPt(e.pos, cam, w, h);
            const topP  = projPt(v3(e.pos.x, e.pos.y, e.pos.z + CHAR_HEIGHT), cam, w, h);
            if (baseP && topP) {
              const rs = (CHAR_RADIUS / baseP.depth) * cam.fl;
              oppScreenBoundsRef.current = { cx: baseP.x, topY: topP.y, baseY: baseP.y, rs };
              // Draw enemy nameplate (name · distance) above HP bar
              if (rs >= 1.5) {
                const barY   = topP.y - 22;
                const dist   = distanceRef.current;
                const label  = `陌路侠士 · ${dist.toFixed(1)}尺`;
                const nSize  = Math.max(9, Math.min(13, rs * 1.15));
                ctx.save();
                ctx.font         = `${nSize}px "Microsoft YaHei", sans-serif`;
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle    = 'rgba(0,0,0,0.7)';
                ctx.fillText(label, baseP.x + 0.5, barY - 2.5);
                ctx.fillStyle = selectedTargetRef.current
                  ? 'rgba(255, 208, 213, 0.95)'
                  : 'rgba(200, 40, 40, 0.9)';
                ctx.fillText(label, baseP.x, barY - 3);
                ctx.restore();
              }
            }
          }
        }
      }

      // Draw targeting line when opponent is selected
      if (selectedTargetRef.current) {
        const myScreenPos = projPt(v3(myRP.x, myRP.y, localZRef.current + CHAR_HEIGHT / 2), cam, w, h);
        const oppScreenPos = projPt(v3(opRP.x, opRP.y, (opRP.z ?? 0) + CHAR_HEIGHT / 2), cam, w, h);
        if (myScreenPos && oppScreenPos) {
          ctx.save();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(myScreenPos.x, myScreenPos.y);
          ctx.lineTo(oppScreenPos.x, oppScreenPos.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── Pickup books ──
      const currentPickups = pickupsRef.current;
      for (const pickup of currentPickups) {
        // Derive a stable pseudo-random angle from the pickup's UUID
        const pickupAngle = parseInt(pickup.id.replace(/-/g, '').slice(0, 6), 16) % 360;
        renderPickupBook(
          ctx,
          v3(pickup.position.x, pickup.position.y, 0),
          cam, w, h,
          pickupAngle,
        );
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []); // stable — all live data accessed via refs

  /* ========================= HUD DATA ========================= */
  const myHpPct  = Math.max(0, Math.min(100, ((me?.hp  ?? 0) / maxHp) * 100));
  const oppHpPct = Math.max(0, Math.min(100, ((opponent?.hp ?? 0) / maxHp) * 100));
  const isMoving = Object.values(wasdKeys).some(v => v);
  const myFacingArrow = facingArrow(me.facing ?? meFacingRef.current);

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

      {/* ===== FULL-SCREEN 3D CANVAS ===== */}
      <div ref={wrapRef} className={styles.canvasWrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      {/* ===== JUMP STATS + HEIGHT DISPLAY ===== */}
      <div style={{
        position: 'absolute',
        left: '30%',
        top: '67%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        pointerEvents: 'none',
        zIndex: 490,
      }}>
        {/* Jump timing record */}
        <div style={{
          background: 'rgba(0,0,0,0.65)',
          color: 'rgba(255,220,100,0.85)',
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '3px 10px',
          borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.12)',
          whiteSpace: 'nowrap',
        }}>
          {jumpRecord.riseMs !== null
            ? `↑ ${(jumpRecord.riseMs / 1000).toFixed(2)}s  ↓ ${(jumpRecord.fallMs! / 1000).toFixed(2)}s  ⟳ ${(jumpRecord.totalMs! / 1000).toFixed(2)}s  ⬆ ${jumpRecord.peakZ!.toFixed(1)}u`
            : '— — —'}
        </div>
        {/* Current height */}
        <div style={{
          background: 'rgba(0,0,0,0.65)',
          color: myZ > 0.01 ? '#44ffaa' : 'rgba(255,255,255,0.5)',
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: 700,
          padding: '3px 10px',
          borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.15)',
          letterSpacing: '0.05em',
        }}>
          {myZ.toFixed(1)}
        </div>
      </div>

      {/* ===== TOP-LEFT: My HP panel ===== */}
      <div
        className={styles.playerPanel}
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onClick={() => { const next = !selectedSelfRef.current; selectedSelfRef.current = next; setSelectedSelf(next); }}
      >
        <div className={styles.playerLabelRow}>
          <span className={styles.playerLabel}>玩家</span>
        </div>
        <div className={styles.myHpTrack}>
          <div
            className={styles.myHpFill}
            style={{
              width:      `${myHpPct}%`,
              background: myHpPct > 50 ? '#44cc55' : myHpPct > 25 ? '#ffcc22' : '#ee3333',
            }}
          />
          <span className={styles.hpNumInside}>{me?.hp ?? 0}</span>
        </div>
        <div className={styles.myManaTrack}>
          <div className={styles.myManaFill} />
        </div>
      </div>

      {/* ===== TOP-RIGHT: Control mode settings ===== */}
      <button
        className={styles.controlBtn}
        onClick={() => setShowControlPanel(v => !v)}
        title="控制设置"
      >&#9881;</button>
      {showControlPanel && (
        <div className={styles.controlPanel}>
          <div className={styles.controlPanelTitle}>控制模式</div>
          <div className={styles.controlModeRow}>
            <button
              className={`${styles.controlModeBtn} ${controlMode === 'traditional' ? styles.controlModeActive : ''}`}
              onClick={() => {
                setControlMode('traditional');
                controlModeRef.current = 'traditional';
                localStorage.setItem('controlMode', 'traditional');
                // Sync yaw to current facing so camera doesn’t jump
                const f = localFacingRef.current;
                const yaw = Math.atan2(f.x, f.y);
                charYawRef.current = yaw;
                camYawRef.current  = yaw;
              }}
            >传统模式</button>
            <button
              className={`${styles.controlModeBtn} ${controlMode === 'joystick' ? styles.controlModeActive : ''}`}
              onClick={() => {
                setControlMode('joystick');
                controlModeRef.current = 'joystick';
                localStorage.setItem('controlMode', 'joystick');
              }}
            >摇杆模式</button>
          </div>
          <div className={styles.controlHints}>
            {controlMode === 'traditional' ? (
              <><span>W/S</span> 前进/后退 <span>A/D</span> 转向<br/><span>右键拖拽</span> 转向+转镜头 <span>左键拖拽</span> 转镜头<br/><span>滚轮</span> 镜头缩放</>
            ) : (
              <><span>WASD</span> 绝对方向移动<br/><span>镜头固定</span> 不随角色旋转</>
            )}
          </div>
        </div>
      )}

      {/* ===== TOP-CENTER: Enemy info panel — health → buffs → debuffs → abilities (only when selected) ===== */}
      <div className={styles.enemyBossGroup}>
        {selectedTargetId && (
          <>
            <div className={styles.enemyBossBar}>
              <div className={styles.enemyName}>陌路侠士</div>
              <div className={styles.enemyHpTrack}>
                <div
                  className={styles.enemyHpFill}
                  style={{
                    width:      `${oppHpPct}%`,
                    background: 'linear-gradient(90deg, #991111, #cc2222)',
                  }}
                />
                <span className={styles.hpNumInside}>{opponent?.hp ?? 0}</span>
              </div>
              <div className={styles.enemyManaTrack}>
                <div className={styles.enemyManaFill} />
              </div>
            </div>
            {/* Buffs row then debuffs row — fixed-height wrapper so ability row never shifts up */}
            <div style={{ minHeight: 72, width: '100%' }}>
              <StatusBar buffs={opponent?.buffs ?? []} debugLabel="opp" />
            </div>
            {/* Enemy drafted abilities */}
            {(() => {
              const draftedAbilities = (opponent?.hand ?? []).filter((ability: any) => {
                const abilityId = ability.abilityId || ability.id;
                return abilityId && !COMMON_ABILITY_ORDER.includes(abilityId as any);
              });
              return (
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
                            src={`/game/icons/Skills/${name}.png`}
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
              );
            })()}
          </>
        )}
      </div>

      {/* ===== TOP-RIGHT: RTT badge + debug grid toggle ===== */}
      <div className={styles.rttBadge}>{rtt !== null ? `${rtt}ms` : '—'}</div>
      <button
        onClick={() => setShowDebugGrid(v => !v)}
        title="Toggle XY% grid"
        style={{
          position: 'absolute', top: 14, right: 60, zIndex: 500,
          background: showDebugGrid ? 'rgba(255,220,0,0.18)' : 'rgba(0,0,0,0.55)',
          border: `1px solid ${showDebugGrid ? '#ffdd00' : 'rgba(255,255,255,0.2)'}`,
          color: showDebugGrid ? '#ffdd00' : 'rgba(255,255,255,0.55)',
          borderRadius: 4, padding: '3px 8px', fontSize: 11,
          cursor: 'pointer', fontFamily: 'monospace', letterSpacing: 1,
        }}
      >
        XY%
      </button>

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
        <span className={styles.distVal}>{distance.toFixed(1)}尺</span>
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

        return pickupModals.map((modal, idx) => {
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
                      const d   = Math.sqrt(ddx * ddx + ddy * ddy);
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
                    src={`/game/icons/Skills/${modal.name}.png`}
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
          borderRadius: 6, padding: 8, maxHeight: '70vh',
          overflowY: 'auto',
          display: 'grid', gridTemplateColumns: 'repeat(4, 32px)', gap: 4,
        }}>
          {Object.values(abilities)
            .filter((c: any) => c && !c.isCommon && c.id && c.name)
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
            .map((ability: any) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={ability.id}
                src={`/game/icons/Skills/${ability.name}.png`}
                alt={ability.name}
                title={`${ability.name}${ability.description ? '\n' + ability.description : ''}`}
                style={{
                  width: 32, height: 32, objectFit: 'contain',
                  borderRadius: 4, border: '1px solid #ff6b00',
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
            ))
          }
        </div>
      )}

      {/* ===== BOTTOM: WASD (mobile left) + centered hotbar ===== */}
      <div className={styles.bottomHud}>

        <div className={styles.wasdWrap}>
          <WASDButtons onDirectionChange={handleJoystickDirection} />
        </div>

        <div className={styles.hotbarStack}>
          {/* ── Player buffs above drafted slots ── */}
          {me?.buffs && me.buffs.length > 0 && (
            <div className={styles.playerBuffRow}>
              <StatusBar buffs={me.buffs} showDebug debugLabel="me" />
            </div>
          )}

          {/* ── 倒读条: countdown bar for 风来吴山 (不工 buff buffId 1014) ── */}
          {(() => {
            if (!channelBuff) return null;
            const CHANNEL_MS = 5000;
            const TICKS = 8;
            const remaining = Math.max(0, (channelBuff as any).expiresAt - Date.now());
            if (remaining <= 0) return null;
            const elapsed = CHANNEL_MS - remaining;
            // 倒读条: fill shrinks from 100% → 0% as time elapses
            const progress = Math.max(0, remaining / CHANNEL_MS);
            const elapsedSec = (elapsed / 1000).toFixed(2);
            const totalSec   = (CHANNEL_MS / 1000).toFixed(1);
            return (
              <div className={styles.channelBarWrap}>
                <span className={styles.channelBarLabel}>
                  风来吴山 ({elapsedSec}/{totalSec})
                </span>
                <div className={styles.channelBarTrack}>
                  <div className={styles.channelBarFill} style={{ width: `${progress * 100}%` }} />
                  {Array.from({ length: TICKS - 1 }, (_, i) => (
                    <div
                      key={i}
                      className={styles.channelBarTick}
                      style={{ left: `${((i + 1) / TICKS) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Top row: draft abilities (6 fixed slots) ── */}
          <div className={styles.hotbar}>
            {Array.from({ length: 6 }, (_, idx) => {
              const ability = draftAbilities[idx];
              const keyHint = ['1','2','3','Q','XB1','XB2'][idx];
              if (!ability) {
                return (
                  <div key={`empty-${idx}`} className={`${styles.abilityBtn} ${styles.emptySlot}`}>
                    <span className={styles.abilityKey}>{keyHint}</span>
                  </div>
                );
              }
              const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
              return (
                <button
                  key={ability.id}
                  className={`${styles.abilityBtn} ${ability.isReady ? styles.ready : styles.notReady}`}
                  disabled={!ability.isReady}
                  onClick={() => castAbilityRef.current(ability.id)}
                  title={`${ability.name}${ability.range ? ` | 范围: ${ability.range}` : ''}${ability.cooldown > 0 ? ` | CD: ${Math.ceil(ability.cooldown / 60)}` : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/game/icons/Skills/${ability.name}.png`} alt={ability.name} className={styles.abilityIcon} draggable={false} />
                  {ability.cooldown > 0 && ability.maxCooldown > 0 && (
                    <div className={styles.cdArc} style={{ background: `conic-gradient(from 0deg, transparent ${(100-cdPct).toFixed(1)}%, rgba(0,0,0,0.72) ${(100-cdPct).toFixed(1)}%)` }}>
                      <span className={styles.cdNum}>{Math.ceil(ability.cooldown / 60)}</span>
                    </div>
                  )}
                  <span className={styles.abilityKey}>{keyHint}</span>
                </button>
              );
            })}
          </div>

          {/* ── Bottom row: 8 common abilities (with visual gaps) ── */}
          <div className={styles.commonBar}>
            {commonAbilities.map((ability, idx) => {
              const COMMON_KEY_HINTS = ['X','MD','MU','A+A','A+D','A+S','`','T'] as const;
              const keyHint = COMMON_KEY_HINTS[idx] ?? '';
              const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
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
                    title={`${ability.name}${ability.cooldown > 0 ? ` | CD: ${Math.ceil(ability.cooldown / 60)}` : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/game/icons/Skills/${ability.name}.png`} alt={ability.name} className={styles.abilityIcon} draggable={false} />
                    {ability.cooldown > 0 && ability.maxCooldown > 0 && (
                      <div className={styles.cdArc} style={{ background: `conic-gradient(from 0deg, transparent ${(100-cdPct).toFixed(1)}%, rgba(0,0,0,0.72) ${(100-cdPct).toFixed(1)}%)` }}>
                        <span className={styles.cdNum}>{Math.ceil(ability.cooldown / 60)}</span>
                      </div>
                    )}
                    <span className={styles.abilityKey}>{keyHint}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className={styles.wasdSpacer} />

      </div>

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
        let posStyle: React.CSSProperties;
        if (entry.type === 'dmg_dealt') {
          // Float above enemy — uses projected canvas position captured at cast time
          const pctX = entry.screenPct ? entry.screenPct.x * 100 : 50;
          const pctY = entry.screenPct ? entry.screenPct.y * 100 : 12;
          posStyle = { top: `calc(${pctY}% + ${travelUp - entry.yOffset}px)`, left: `${pctX}%`, transform: 'translateX(-50%)' };
        } else if (entry.type === 'dmg_taken') {
          posStyle = { top: `calc(60% + ${travelUp - entry.yOffset}px)`, left: '40%', transform: 'translateX(-50%)' };
        } else {
          posStyle = { top: `calc(60% + ${travelUp - entry.yOffset}px)`, left: '60%', transform: 'translateX(-50%)' };
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
