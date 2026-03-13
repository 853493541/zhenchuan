'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import styles from './BattleArena.module.css';

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
}: BattleArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wasdKeys, setWasdKeys] = useState({
    w: false,
    a: false,
    s: false,
    d: false,
  });
  const [abilities, setAbilities] = useState<AbilityInfo[]>([]);
  const localPositionRef = useRef<Position | null>(null); // client-predicted position
  const localVelocityRef = useRef({ x: 0, y: 0 });       // client-predicted velocity
  const keysRef = useRef({ w: false, a: false, s: false, d: false });
  const opponentPrevRef = useRef<Position | null>(null);  // for opponent interpolation
  const opponentNextRef = useRef<Position | null>(null);
  const opponentLerpRef = useRef(0);
  const abilitiesRef = useRef<AbilityInfo[]>([]);         // synced for stable render loop
  const distanceRef = useRef(0);
  const initializedRef = useRef(false);
  // Send movement input to server — reads keysRef directly (no stale state closure)
  const sendMovement = useCallback(async () => {
    const keys = keysRef.current;
    const hasInput = keys.w || keys.a || keys.s || keys.d;

    try {
      await fetch('/api/game/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gameId,
          direction: hasInput
            ? { up: keys.w, down: keys.s, left: keys.a, right: keys.d }
            : null,
        }),
      });
    } catch (err) {
      // Fire-and-forget: prediction handles display, drops are recoverable
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

  // Record new opponent target on each broadcast for interpolation
  useEffect(() => {
    if (!opponent?.position) return;
    opponentPrevRef.current = opponentNextRef.current ?? { ...opponent.position };
    opponentNextRef.current = { ...opponent.position };
    opponentLerpRef.current = performance.now();
  }, [opponent?.position?.x, opponent?.position?.y]);

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
    return () => clearInterval(interval);
  }, [sendMovement]);

  // Keep distanceRef in sync for the stable render loop
  useEffect(() => {
    distanceRef.current = distance;
  }, [distance]);

  // Render-only rAF loop — reads refs, no physics.
  // Physics is done in the 33ms interval above.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const loop = () => {
      // --- Opponent interpolation ---
      const opElapsed = performance.now() - opponentLerpRef.current;
      const opT = Math.min(opElapsed / 50, 1);
      const opPrev = opponentPrevRef.current;
      const opNext = opponentNextRef.current;
      let opPos: Position | null = opNext;
      if (opPrev && opNext) {
        opPos = {
          x: opPrev.x + (opNext.x - opPrev.x) * opT,
          y: opPrev.y + (opNext.y - opPrev.y) * opT,
        };
      }

      // --- Canvas render ---
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, ARENA_WIDTH * CANVAS_SCALE, ARENA_HEIGHT * CANVAS_SCALE);

      const p1Pos = localPositionRef.current;
      if (!p1Pos || !opPos) {
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
        <p>Use WASD to move</p>
        <p>Click abilities to cast</p>
        <p>
          {Object.values(wasdKeys).some((v) => v) ? '🟢 Moving...' : '⚪ Standby'}
        </p>
      </div>
    </div>
  );
}
