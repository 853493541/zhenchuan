'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';

// Arena constants (must match backend)
const ARENA_WIDTH = 100;
const ARENA_HEIGHT = 100;
const CANVAS_SCALE = 4; // 1 unit = 4 pixels for display

interface Position {
  x: number;
  y: number;
}

interface PlayerDisplay {
  userId: string;
  position: Position;
  hp: number;
  maxHp: number;
  color: string;
}

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
  /** Raw WS-timestamped opponent position buffer from useGameState.
   *  Updated directly in the WS handler — no React render delay. */
  opponentPositionBufferRef?: React.MutableRefObject<Array<{ t: number; pos: Position }>>;
}

/**
 * 2D real-time battle arena with WASD movement
 */
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
  const [wasdKeys, setWasdKeys] = useState({
    w: false,
    a: false,
    s: false,
    d: false,
  });
  const [abilities, setAbilities] = useState<AbilityInfo[]>([]);
  const [rtt, setRtt] = useState<number | null>(null);
  const localPositionRef = useRef<Position | null>(null); // client-predicted position
  const localVelocityRef = useRef({ x: 0, y: 0 });       // client-predicted velocity
  const keysRef = useRef({ w: false, a: false, s: false, d: false });
  // Opponent interpolation: timestamped position buffer
  // Prefer the external buffer (direct from WS handler, no React delay).
  // Fall back to internal buffer if parent doesn't provide one.
  const internalOpponentBufferRef = useRef<Array<{ t: number; pos: Position }>>([]);
  const opponentRawRef = useRef<Position | null>(null); // latest raw position (startup fallback)
  const RENDER_DELAY_MS = 100; // render opponent 100ms behind real-time
  // Resolve which buffer to use
  const activeOpponentBuffer = opponentPositionBufferRef ?? internalOpponentBufferRef;
  const abilitiesRef = useRef<AbilityInfo[]>([]);         // synced for stable render loop
  const distanceRef = useRef(0);
  const initializedRef = useRef(false);
  const movementAbortRef = useRef<AbortController | null>(null);

  // Send movement input — cancels any in-flight request first so the browser
  // never queues more than 1 concurrent movement fetch (prevents ERR_INSUFFICIENT_RESOURCES).
  const sendMovement = useCallback(async () => {
    const keys = keysRef.current;
    const hasInput = keys.w || keys.a || keys.s || keys.d;

    movementAbortRef.current?.abort();
    movementAbortRef.current = new AbortController();

    try {
      await fetch('/api/game/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: movementAbortRef.current.signal,
        body: JSON.stringify({
          gameId,
          direction: hasInput
            ? { up: keys.w, down: keys.s, left: keys.a, right: keys.d }
            : null,
        }),
      });
    } catch (err: any) {
      // AbortError = cancelled by next tick, expected and harmless
    }
  }, [gameId]);

  // Seed local prediction from first server position
  useEffect(() => {
    if (me?.position && !initializedRef.current) {
      localPositionRef.current = { ...me.position };
      initializedRef.current = true;
    }
  }, [me?.position?.x, me?.position?.y]);

  // Server correction — applied on each broadcast.
  // While moving: tiny 3% nudge (mostly invisible, handles timer jitter).
  // While stopped: 25% pull to anchor final resting position.
  useEffect(() => {
    if (!me?.position || !initializedRef.current) return;
    const local = localPositionRef.current;
    if (!local) return;
    const isMoving = keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d;
    const blend = isMoving ? 0.03 : 0.25;
    localPositionRef.current = {
      x: local.x + (me.position.x - local.x) * blend,
      y: local.y + (me.position.y - local.y) * blend,
    };
  }, [me?.position?.x, me?.position?.y]);

  // Keep opponentRawRef updated for startup fallback (and feed internal buffer if no external one).
  useEffect(() => {
    if (!opponent?.position) return;
    opponentRawRef.current = opponent.position;
    // Only push to internal buffer when no external buffer is provided
    if (!opponentPositionBufferRef) {
      const now = performance.now();
      internalOpponentBufferRef.current.push({ t: now, pos: { ...opponent.position } });
      const cutoff = now - 1000;
      internalOpponentBufferRef.current = internalOpponentBufferRef.current.filter(e => e.t >= cutoff);
    }
  }, [opponent?.position?.x, opponent?.position?.y, opponentPositionBufferRef]);

  // Update abilities list based on hand
  useEffect(() => {
    const updatedAbilities = me.hand
      .map((instance: any) => {
        // Handle both old format (cardId reference) and new format (full card object)
        const card = instance.cardId ? cards[instance.cardId] : instance;
        
        // Skip if card definition not found
        if (!card || !card.name) {
          console.warn('[BattleArena] Card not found:', instance);
          return null;
        }

        const canCast = instance.cooldown === 0;
        const inRange = !card.range || distance <= card.range;

        return {
          id: instance.instanceId || instance.id,
          name: card.name,
          range: card.range,
          minRange: card.minRange,
          cooldown: instance.cooldown || 0,
          isReady: canCast && inRange,
        };
      })
      .filter((ability) => ability !== null) as AbilityInfo[];

    setAbilities(updatedAbilities);
    abilitiesRef.current = updatedAbilities;
  }, [me.hand, distance, cards]);

  // WASD key listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') {
        e.preventDefault();
        keysRef.current.w = true;
        setWasdKeys((prev) => ({ ...prev, w: true }));
      } else if (key === 'a') {
        e.preventDefault();
        keysRef.current.a = true;
        setWasdKeys((prev) => ({ ...prev, a: true }));
      } else if (key === 's') {
        e.preventDefault();
        keysRef.current.s = true;
        setWasdKeys((prev) => ({ ...prev, s: true }));
      } else if (key === 'd') {
        e.preventDefault();
        keysRef.current.d = true;
        setWasdKeys((prev) => ({ ...prev, d: true }));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') {
        keysRef.current.w = false;
        setWasdKeys((prev) => ({ ...prev, w: false }));
      } else if (key === 'a') {
        keysRef.current.a = false;
        setWasdKeys((prev) => ({ ...prev, a: false }));
      } else if (key === 's') {
        keysRef.current.s = false;
        setWasdKeys((prev) => ({ ...prev, s: false }));
      } else if (key === 'd') {
        keysRef.current.d = false;
        setWasdKeys((prev) => ({ ...prev, d: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Joystick direction handler
  const handleJoystickDirection = useCallback(
    (keys: { w: boolean; a: boolean; s: boolean; d: boolean }) => {
      keysRef.current = keys;
      setWasdKeys(keys);
    },
    []
  );

  // Physics at fixed 33ms — EXACTLY mirrors server applyMovement() with no dt scaling.
  // Decoupled from rAF so frame rate doesn't affect integration.
  useEffect(() => {
    // Physics constants — must match backend/game/engine/loop/movement.ts
    const MAX_SPEED = 0.5; // player.moveSpeed on server
    const ACCEL = 0.3;
    const DECEL = 0.9;

    const tick = () => {
      const pos = localPositionRef.current;
      if (!pos) return;
      const vel = localVelocityRef.current;
      const keys = keysRef.current;

      let ix = 0, iy = 0;
      if (keys.w) iy -= 1;
      if (keys.s) iy += 1;
      if (keys.a) ix -= 1;
      if (keys.d) ix += 1;

      if (ix !== 0 || iy !== 0) {
        const len = Math.sqrt(ix * ix + iy * iy);
        const targetVx = (ix / len) * MAX_SPEED;
        const targetVy = (iy / len) * MAX_SPEED;
        // Matches server: vel += (target - vel) * ACCEL
        vel.x += (targetVx - vel.x) * ACCEL;
        vel.y += (targetVy - vel.y) * ACCEL;
      } else {
        // Matches server: vel *= DECEL
        vel.x *= DECEL;
        vel.y *= DECEL;
      }

      // Matches server: position += velocity (no dt)
      localPositionRef.current = {
        x: Math.max(2, Math.min(98, pos.x + vel.x)),
        y: Math.max(2, Math.min(98, pos.y + vel.y)),
      };
    };

    const physicsId = setInterval(tick, 33);
    return () => clearInterval(physicsId);
  }, []);

  // Send movement at 33ms — synced with physics so server gets fresh input every tick
  useEffect(() => {
    const interval = setInterval(sendMovement, 33);
    return () => {
      clearInterval(interval);
      movementAbortRef.current?.abort(); // cancel any in-flight request on unmount
    };
  }, [sendMovement]);

  // Keep distanceRef in sync for the stable render loop
  useEffect(() => {
    distanceRef.current = distance;
  }, [distance]);

  // Measure RTT via ping every 2 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const startTime = performance.now();
      try {
        await fetch('/api/game/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ gameId }),
        });
        const rttMs = Math.round(performance.now() - startTime);
        setRtt(rttMs);
      } catch (err) {
        // Silently ignore ping failures
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [gameId]);

  // Render-only rAF loop — reads refs, no physics.
  // Physics is done in the 33ms interval above.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const loop = () => {
      // --- Opponent position: entity interpolation with dead reckoning ---
      //
      // Three cases handled without snapping:
      //   1. renderTime between two buffer entries  → interpolate (normal case)
      //   2. renderTime before first entry (buffer cold) → show first entry
      //   3. renderTime past last entry (delayed packet) → dead-reckon forward
      //      using velocity from last two entries (max 1 extra tick to prevent runaway)
      const renderTime = performance.now() - RENDER_DELAY_MS;
      const buf = activeOpponentBuffer.current;
      let opPos: Position | null = opponentRawRef.current; // startup fallback

      if (buf.length >= 2) {
        const last = buf[buf.length - 1];
        const prev = buf[buf.length - 2];

        if (renderTime <= buf[0].t) {
          // Too early — clamp to oldest entry
          opPos = buf[0].pos;
        } else if (renderTime >= last.t) {
          // Past the buffer — dead-reckon forward using last velocity
          const span = last.t - prev.t;
          if (span > 0) {
            const overshoot = Math.min((renderTime - last.t) / span, 1); // cap at 1 tick ahead
            opPos = {
              x: Math.max(2, Math.min(98, last.pos.x + (last.pos.x - prev.pos.x) * overshoot)),
              y: Math.max(2, Math.min(98, last.pos.y + (last.pos.y - prev.pos.y) * overshoot)),
            };
          } else {
            opPos = last.pos;
          }
        } else {
          // Normal case: find bracketing pair and interpolate
          for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) {
              const lo = buf[i], hi = buf[i + 1];
              const span = hi.t - lo.t;
              const t = span > 0 ? (renderTime - lo.t) / span : 1;
              opPos = {
                x: lo.pos.x + (hi.pos.x - lo.pos.x) * t,
                y: lo.pos.y + (hi.pos.y - lo.pos.y) * t,
              };
              break;
            }
          }
        }
      } else if (buf.length === 1) {
        opPos = buf[0].pos;
      }

      // --- Canvas render ---
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, ARENA_WIDTH * CANVAS_SCALE, ARENA_HEIGHT * CANVAS_SCALE);

      const p1Pos = localPositionRef.current;
      if (!p1Pos || !opPos) {
        // Still waiting for initial data
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for arena data...', canvas.width / 2, canvas.height / 2);
        animId = requestAnimationFrame(loop);
        return;
      }

      const p1X = p1Pos.x * CANVAS_SCALE;
      const p1Y = p1Pos.y * CANVAS_SCALE;
      const p2X = opPos.x * CANVAS_SCALE;
      const p2Y = opPos.y * CANVAS_SCALE;

      // Range circle
      const firstAbilityWithRange = abilitiesRef.current.find((a) => a.range);
      if (firstAbilityWithRange) {
        ctx.strokeStyle = 'rgba(100, 200, 100, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p1X, p1Y, (firstAbilityWithRange.range || 0) * CANVAS_SCALE, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Distance line
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1X, p1Y);
      ctx.lineTo(p2X, p2Y);
      ctx.stroke();

      // Distance label
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(distanceRef.current.toFixed(1), (p1X + p2X) / 2, (p1Y + p2Y) / 2 - 10);

      // Player 1 (me) — blue
      ctx.fillStyle = '#3899ec';
      ctx.beginPath();
      ctx.arc(p1X, p1Y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Player 2 (opponent) — red
      ctx.fillStyle = '#ec3838';
      ctx.beginPath();
      ctx.arc(p2X, p2Y, 8, 0, Math.PI * 2);
      ctx.fill();

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []); // stable — all data via refs

  return (
    <div className={styles.container}>
      {/* RTT Display */}
      <div className={styles.rttDisplay}>
        RTT: {rtt !== null ? `${rtt}ms` : '—'}
      </div>

      <WASDButtons onDirectionChange={handleJoystickDirection} />

      <div className={styles.arenaSection}>
        <canvas
          ref={canvasRef}
          width={ARENA_WIDTH * CANVAS_SCALE}
          height={ARENA_HEIGHT * CANVAS_SCALE}
          className={styles.canvas}
        />
        <div className={styles.info}>
          <div>Distance: {distance.toFixed(1)}</div>
          <div>HP: {me.hp} / {maxHp}</div>
          <div className={styles.hpBar}>
            <div
              className={styles.hpFill}
              style={{ width: `${(me.hp / maxHp) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className={styles.abilityPanel}>
        <h3>Abilities</h3>
        <div className={styles.abilityGrid}>
          {abilities.map((ability) => (
            <button
              key={ability.id}
              className={`${styles.abilityButton} ${
                ability.isReady ? styles.ready : styles.notReady
              }`}
              disabled={!ability.isReady}
              onClick={() => onCastAbility(ability.id)}
              title={`${ability.name} | Range: ${ability.range || '∞'} | CD: ${ability.cooldown}`}
            >
              <div className={styles.abilityName}>{ability.name}</div>
              <div className={styles.abilityRange}>
                {ability.range ? `${ability.range.toFixed(0)}` : '∞'}
              </div>
              {ability.cooldown > 0 && (
                <div className={styles.abilityCooldown}>{ability.cooldown}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.controls}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div>
            <p>Use WASD to move</p>
            <p>Click abilities to cast</p>
            <p>
              {Object.values(wasdKeys).some((v) => v) ? '🟢 Moving...' : '⚪ Standby'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
