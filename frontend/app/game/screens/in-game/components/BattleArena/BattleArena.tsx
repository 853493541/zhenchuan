'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';

/* ============================================================
   ARENA SETTINGS  (must match backend)
   ============================================================ */
const ARENA_WIDTH  = 100;
const ARENA_HEIGHT = 100;

/* Character visual */
const CHAR_HEIGHT = 5.0;   // world units tall
const CHAR_RADIUS = 1.7;   // world units wide (radius)

/* 3rd-person camera — high & pulled back, ~26° below horizontal
   atan((20-1.5)/(38)) ≈ 26°  →  lots of ground visible, char at lower-center.

   Camera direction is FIXED at (0,1) — always faces +Y.
   This guarantees A = screen-left and D = screen-right regardless of where
   the opponent is, eliminating the A/D flip when the camera rotates. */
const CAM_DIST_BACK   = 30;  // units behind player
const CAM_HEIGHT      = 20;  // units above ground
const CAM_LOOK_AHEAD  = 8;   // look-ahead toward opponent side
const NEAR_CLIP       = 0.8;

// Vertical FOV — used with H-based focal length so scale is consistent
// across all screen widths (phone / tablet / wide monitor all look the same depth)
const VFOV_RAD = (60 * Math.PI) / 180;

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
  _dir: { x: number; y: number }, // kept for API compat but ignored
  W: number,
  H: number,
): Cam {
  const camPos = v3(
    playerPos.x - CAM_DIR.x * CAM_DIST_BACK,
    playerPos.y - CAM_DIR.y * CAM_DIST_BACK,
    CAM_HEIGHT,
  );
  const lookAt = v3(
    playerPos.x + CAM_DIR.x * CAM_LOOK_AHEAD,
    playerPos.y + CAM_DIR.y * CAM_LOOK_AHEAD,
    1.5,
  );
  const worldUp = v3(0, 0, 1);
  const fwd   = norm3(sub3(lookAt, camPos));
  const right = norm3(cross3(fwd, worldUp));
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

function renderFloor(ctx: CanvasRenderingContext2D, cam: Cam, W: number, H: number) {
  const corners = [
    v3(0, 0, 0), v3(ARENA_WIDTH, 0, 0),
    v3(ARENA_WIDTH, ARENA_HEIGHT, 0), v3(0, ARENA_HEIGHT, 0),
  ];
  const sc = corners
    .map(c => projPt(c, cam, W, H))
    .filter((p): p is ScreenPt => p !== null);

  if (sc.length >= 3) {
    ctx.fillStyle = '#0a1620';
    ctx.beginPath();
    ctx.moveTo(sc[0].x, sc[0].y);
    for (let i = 1; i < sc.length; i++) ctx.lineTo(sc[i].x, sc[i].y);
    ctx.lineTo(W + 20, H + 20);
    ctx.lineTo(-20, H + 20);
    ctx.closePath();
    ctx.fill();
  }

  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(18, 55, 100, 0.65)';
  for (let x = 0; x <= ARENA_WIDTH; x += 10) {
    const a = projPt(v3(x, 0, 0), cam, W, H);
    const b = projPt(v3(x, ARENA_HEIGHT, 0), cam, W, H);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  for (let y = 0; y <= ARENA_HEIGHT; y += 10) {
    const a = projPt(v3(0, y, 0), cam, W, H);
    const b = projPt(v3(ARENA_WIDTH, y, 0), cam, W, H);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }

  const edges: [V3, V3][] = [
    [v3(0, 0, 0),                      v3(ARENA_WIDTH, 0, 0)],
    [v3(ARENA_WIDTH, 0, 0),            v3(ARENA_WIDTH, ARENA_HEIGHT, 0)],
    [v3(ARENA_WIDTH, ARENA_HEIGHT, 0), v3(0, ARENA_HEIGHT, 0)],
    [v3(0, ARENA_HEIGHT, 0),           v3(0, 0, 0)],
  ];
  ctx.strokeStyle = 'rgba(40, 140, 255, 0.9)';
  ctx.lineWidth   = 1.8;
  ctx.shadowColor = '#1a6fff';
  ctx.shadowBlur  = 9;
  for (const [a, b] of edges) {
    const pa = projPt(a, cam, W, H);
    const pb = projPt(b, cam, W, H);
    if (pa && pb) { ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); }
  }
  ctx.shadowBlur = 0;
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
  hpCurrent: number,
  isMe: boolean,
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
  const barW = Math.max(rs * 2.6, 38);
  const barH = 5;
  const barX = cx - barW / 2;
  const barY = topP.y - 18;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  pRoundRect(ctx, barX - 1, barY - 1, barW + 2, barH + 2, 3);
  ctx.fill();

  const hpColor = hpFrac > 0.5 ? '#44dd55' : hpFrac > 0.25 ? '#ffcc22' : '#ee3333';
  ctx.fillStyle = hpColor;
  const fillW = Math.max(0, barW * hpFrac);
  if (fillW > 0) {
    ctx.beginPath();
    pRoundRect(ctx, barX, barY, fillW, barH, 2);
    ctx.fill();
  }

  const fontSize = Math.max(9, Math.min(12, rs * 1.3));
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font      = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(`${hpCurrent}`, cx, barY - 3);
}

/* ============================================================
   TYPES
   ============================================================ */
interface Position { x: number; y: number; z?: number; }

interface AbilityInfo {
  id: string;
  name: string;
  range?: number;
  minRange?: number;
  cooldown: number;
  isReady: boolean;
}

interface BattleArenaProps {
  me: { userId: string; position: Position; hp: number; hand: any[] };
  opponent: { userId: string; position: Position; hp: number };
  gameId: string;
  onCastAbility: (cardInstanceId: string) => Promise<void>;
  distance: number;
  maxHp: number;
  cards: Record<string, any>;
  opponentPositionBufferRef?: React.MutableRefObject<Array<{ t: number; pos: Position }>>;
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
  cards,
  opponentPositionBufferRef,
}: BattleArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);

  /* --- React state (UI only) --- */
  const [abilities, setAbilities] = useState<AbilityInfo[]>([]);
  const [rtt,       setRtt]       = useState<number | null>(null);
  const [wasdKeys,  setWasdKeys]  = useState({ w: false, a: false, s: false, d: false });

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

  /* --- Opponent interpolation --- */
  const internalOpponentBufferRef = useRef<Array<{ t: number; pos: Position }>>([]);
  const opponentRawRef            = useRef<Position | null>(null);
  const RENDER_DELAY_MS           = 100;
  const activeOpponentBuffer      = opponentPositionBufferRef ?? internalOpponentBufferRef;

  // Camera direction is now pinned to CAM_DIR constant — no ref needed.
  // Keep a dummy ref so nothing else needs changing.
  const camDirRef = useRef(CAM_DIR);

  /* --- Render-loop refs (avoid stale closures) --- */
  const abilitiesRef  = useRef<AbilityInfo[]>([]);
  const meHpRef       = useRef(me?.hp ?? 0);
  const oppHpRef      = useRef(opponent?.hp ?? 0);
  const maxHpRef      = useRef(maxHp);
  const canvasSizeRef = useRef({ w: 800, h: 500 });

  useEffect(() => { meHpRef.current  = me?.hp ?? 0;      }, [me?.hp]);
  useEffect(() => { oppHpRef.current = opponent?.hp ?? 0; }, [opponent?.hp]);
  useEffect(() => { maxHpRef.current = maxHp;             }, [maxHp]);

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
          // W = forward on screen = camera+Y = server "down" (+vy)
          // S = backward on screen = camera-Y = server "up"  (-vy)
          direction: (k.w || k.a || k.s || k.d || shouldJump)
            ? { up: k.s, down: k.w, left: k.a, right: k.d, jump: shouldJump }
            : null,
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
    const moving = keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d;
    const blend  = moving ? 0.03 : 0.25;
    localPositionRef.current = {
      x: local.x + (me.position.x - local.x) * blend,
      y: local.y + (me.position.y - local.y) * blend,
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
    const updated = me.hand
      .map((instance: any) => {
        // Try every possible card lookup strategy:
        // 1. CardInstance format from GameLoop: instance.cardId -> cardMap key
        // 2. Merged draft format: instance.id -> cardMap key
        // 3. Merged draft format: instance itself is the card (has .name)
        const card =
          (instance.cardId && cards[instance.cardId]) ||
          (instance.id    && cards[instance.id])     ||
          (instance.name  ? instance : null);

        const instanceId = instance.instanceId || instance.id || String(Math.random());
        if (!card) {
          console.warn('[BattleArena] card lookup failed for hand item:', instance);
          // Still show a placeholder so the slot is visible
          return {
            id:       instanceId,
            name:     instance.name || instance.cardId || instance.id || '?',
            range:    undefined as number | undefined,
            minRange: undefined as number | undefined,
            cooldown: instance.cooldown || 0,
            isReady:  (instance.cooldown ?? 0) === 0,
          };
        }
        return {
          id:       instanceId,
          name:     card.name,
          range:    card.range,
          minRange: card.minRange,
          cooldown: instance.cooldown || 0,
          isReady:  (instance.cooldown ?? 0) === 0 && (!card.range || distance <= card.range),
        };
      }) as AbilityInfo[];
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[BattleArena] hand: ${me.hand.length} items → ${updated.length} abilities`);
    }
    setAbilities(updated);
    abilitiesRef.current = updated;
  }, [me.hand, distance, cards]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = true;
        setWasdKeys(prev => ({ ...prev, [k]: true }));
      }
      // Space = jump (both local prediction and server)
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        jumpLocalRef.current = true;
        jumpSendRef.current  = true;
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

  const handleJoystickDirection = useCallback(
    (keys: { w: boolean; a: boolean; s: boolean; d: boolean }) => {
      keysRef.current = keys;
      setWasdKeys(keys);
    },
    [],
  );

  /* Physics — mirrors server exactly */
  useEffect(() => {
    const MAX_SPEED = 1.0, ACCEL = 0.3, DECEL = 0.9;
    const JUMP_VZ_CLIENT = 0.6, GRAVITY_CLIENT = 0.04;
    const tick = () => {
      const pos = localPositionRef.current;
      if (!pos) return;
      const vel = localVelocityRef.current;
      const k   = keysRef.current;
      let ix = 0, iy = 0;
      if (k.w) iy += 1;  // W = +Y = forward into scene (matches server "down" = +vy)
      if (k.s) iy -= 1;  // S = -Y = backward toward camera
      if (k.a) ix -= 1;
      if (k.d) ix += 1;
      if (ix !== 0 || iy !== 0) {
        const len = Math.sqrt(ix * ix + iy * iy);
        vel.x += ((ix / len) * MAX_SPEED - vel.x) * ACCEL;
        vel.y += ((iy / len) * MAX_SPEED - vel.y) * ACCEL;
      } else { vel.x *= DECEL; vel.y *= DECEL; }
      localPositionRef.current = {
        x: Math.max(2, Math.min(98, pos.x + vel.x)),
        y: Math.max(2, Math.min(98, pos.y + vel.y)),
      };

      // ── Z axis: jump + gravity ──
      if (jumpLocalRef.current && localJumpCountRef.current < 2) {
        localVzRef.current        = JUMP_VZ_CLIENT;
        localJumpCountRef.current += 1;
        jumpLocalRef.current       = false; // consume local jump
      }
      localVzRef.current -= GRAVITY_CLIENT;
      localZRef.current   = Math.max(0, localZRef.current + localVzRef.current);
      if (localZRef.current <= 0 && localVzRef.current < 0) {
        localZRef.current         = 0;
        localVzRef.current        = 0;
        localJumpCountRef.current = 0; // restore jumps on landing
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

      // Camera direction is fixed — no dynamic tracking, no flip

      const cam = buildCam(v3(myPos.x, myPos.y, 0), camDirRef.current, w, h);

      /* Draw scene */
      renderBg(ctx, cam, w, h);
      renderFloor(ctx, cam, w, h);

      /* Range indicator circle */
      const abilityList    = abilitiesRef.current;
      const readyAbility   = abilityList.find(a => a.isReady && a.range);
      const minRangeAbil   = abilityList.find(a => a.minRange);
      if (readyAbility?.range)
        renderRangeCircle(ctx, v3(myPos.x, myPos.y, 0), readyAbility.range, cam, w, h, 'rgba(80, 210, 100, 0.55)');
      if (minRangeAbil?.minRange)
        renderRangeCircle(ctx, v3(myPos.x, myPos.y, 0), minRangeAbil.minRange, cam, w, h, 'rgba(255, 80, 80, 0.45)');

      /* Sort back-to-front */
      const mxHp = maxHpRef.current;
      const entities = [
        { pos: v3(opPos.x, opPos.y, opPos.z ?? 0), color: '#cc3333', glow: '#ff5555', hp: oppHpRef.current, isMe: false },
        { pos: v3(myPos.x, myPos.y, localZRef.current),  color: '#1a66cc', glow: '#44aaff', hp: meHpRef.current,  isMe: true  },
      ];
      entities.sort((a, b) => {
        const dA = dot3(sub3(a.pos, cam.pos), cam.fwd);
        const dB = dot3(sub3(b.pos, cam.pos), cam.fwd);
        return dB - dA;
      });
      for (const e of entities) {
        renderCharacter(ctx, e.pos, cam, w, h, e.color, e.glow, Math.max(0, e.hp / mxHp), e.hp, e.isMe);
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

  // Facing direction arrow derived from current movement keys
  const facingArrow = (() => {
    const { w, a, s, d } = wasdKeys;
    if (w && d) return '↗'; if (w && a) return '↖';
    if (s && d) return '↘'; if (s && a) return '↙';
    if (w) return '↑'; if (s) return '↓';
    if (a) return '←'; if (d) return '→';
    return '·';
  })();

  return (
    <div className={styles.container}>

      {/* ===== FULL-SCREEN 3D CANVAS ===== */}
      <div ref={wrapRef} className={styles.canvasWrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      {/* ===== TOP-LEFT: My HP panel ===== */}
      <div className={styles.playerPanel}>
        <div className={styles.playerLabelRow}>
          <span className={styles.playerLabel}>YOU</span>
          <span className={styles.facingDir}>{facingArrow}</span>
        </div>
        <div className={styles.myHpRow}>
          <div className={styles.myHpTrack}>
            <div
              className={styles.myHpFill}
              style={{
                width:      `${myHpPct}%`,
                background: myHpPct > 50 ? '#44cc55' : myHpPct > 25 ? '#ffcc22' : '#ee3333',
              }}
            />
          </div>
          <span className={styles.myHpNum}>{me?.hp ?? 0}</span>
        </div>
      </div>

      {/* ===== TOP-CENTER: Enemy boss bar ===== */}
      <div className={styles.enemyBossBar}>
        <div className={styles.enemyName}>ENEMY</div>
        <div className={styles.enemyHpRow}>
          <div className={styles.enemyHpTrack}>
            <div
              className={styles.enemyHpFill}
              style={{
                width:      `${oppHpPct}%`,
                background: oppHpPct > 50
                  ? 'linear-gradient(90deg, #991111, #cc2222)'
                  : oppHpPct > 25
                  ? 'linear-gradient(90deg, #aa7700, #ddaa00)'
                  : 'linear-gradient(90deg, #771111, #aa1111)',
              }}
            />
            {[25, 50, 75].map(t => (
              <div key={t} className={styles.enemyHpTick} style={{ left: `${t}%` }} />
            ))}
          </div>
          <span className={styles.enemyHpNum}>{opponent?.hp ?? 0}</span>
        </div>
      </div>

      {/* ===== TOP-RIGHT: RTT badge ===== */}
      <div className={styles.rttBadge}>{rtt !== null ? `${rtt}ms` : '—'}</div>

      {/* ===== CENTER: Distance floating label ===== */}
      <div className={styles.distIndicator}>
        <span className={styles.distVal}>{distance.toFixed(1)}</span>
        <span className={styles.distUnit}>units</span>
      </div>

      {/* ===== BOTTOM: WASD (mobile left) + centered hotbar ===== */}
      <div className={styles.bottomHud}>

        <div className={styles.wasdWrap}>
          <WASDButtons onDirectionChange={handleJoystickDirection} />
          <div className={`${styles.movingDot} ${isMoving ? styles.moving : ''}`} />
        </div>

        <div className={styles.hotbar}>
          {abilities.length === 0 && (
            <span className={styles.noAbilities}>loading abilities…</span>
          )}
          {abilities.map((ability, idx) => (
            <button
              key={ability.id}
              className={`${styles.abilityBtn} ${ability.isReady ? styles.ready : styles.notReady}`}
              disabled={!ability.isReady}
              onClick={() => onCastAbility(ability.id)}
              title={`${ability.name}${ability.range ? ` | 范围: ${ability.range}` : ''}${ability.cooldown > 0 ? ` | CD: ${ability.cooldown}` : ''}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/game/icons/Skills/${ability.name}.png`}
                alt={ability.name}
                className={styles.abilityIcon}
                draggable={false}
              />
              {ability.cooldown > 0 && (
                <span className={styles.cdOverlay}>{ability.cooldown}</span>
              )}
              <span className={styles.abilityKey}>{idx + 1}</span>
            </button>
          ))}
        </div>

        <div className={styles.wasdSpacer} />

      </div>
    </div>
  );
}
