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
  const [localPosition, setLocalPosition] = useState<Position | null>(null); // Client-side prediction
  const lastMovementSendTime = useRef(0);
  const movementSendInterval = 50; // Send movement updates every 50ms

  // Send movement input to server
  const sendMovement = useCallback(async () => {
    const now = Date.now();
    if (now - lastMovementSendTime.current < movementSendInterval) return;

    const hasInput = Object.values(wasdKeys).some((v) => v);

    try {
      const res = await fetch('/api/game/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gameId,
          direction: hasInput
            ? {
                up: wasdKeys.w,
                down: wasdKeys.s,
                left: wasdKeys.a,
                right: wasdKeys.d,
              }
            : null,
        }),
      });

      // Apply server response position immediately (client-side prediction)
      if (res.ok) {
        const data = await res.json();
        if (data.position) {
          // Predict next position based on input
          // This approximates what the server will calculate in the next tick
          let predictedX = data.position.x;
          let predictedY = data.position.y;
          
          // Apply movement based on input (moveSpeed = 3, acceleration = 0.3 per tick)
          const MOVE_SPEED = 3;
          const ACCELERATION = 0.3;
          
          if (hasInput) {
            let targetVx = 0, targetVy = 0;
            if (wasdKeys.w) targetVy -= MOVE_SPEED;
            if (wasdKeys.s) targetVy += MOVE_SPEED;
            if (wasdKeys.a) targetVx -= MOVE_SPEED;
            if (wasdKeys.d) targetVx += MOVE_SPEED;
            
            // Accelerate velocity
            const vel = data.velocity || { vx: 0, vy: 0 };
            const newVx = vel.vx + (targetVx - vel.vx) * ACCELERATION;
            const newVy = vel.vy + (targetVy - vel.vy) * ACCELERATION;
            
            // Apply velocity to position
            predictedX += newVx;
            predictedY += newVy;
          }
          
          setLocalPosition({ x: predictedX, y: predictedY });
        }
      }
    } catch (err) {
      console.error('[Movement] Failed to send:', err);
    }

    lastMovementSendTime.current = now;
  }, [wasdKeys, gameId]);

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
      .filter((ability): ability is AbilityInfo => ability !== null);

    setAbilities(updatedAbilities);
  }, [me.hand, distance, cards]);

  // WASD key listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') {
        e.preventDefault();
        setWasdKeys((prev) => ({ ...prev, w: true }));
      } else if (key === 'a') {
        e.preventDefault();
        setWasdKeys((prev) => ({ ...prev, a: true }));
      } else if (key === 's') {
        e.preventDefault();
        setWasdKeys((prev) => ({ ...prev, s: true }));
      } else if (key === 'd') {
        e.preventDefault();
        setWasdKeys((prev) => ({ ...prev, d: true }));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') {
        setWasdKeys((prev) => ({ ...prev, w: false }));
      } else if (key === 'a') {
        setWasdKeys((prev) => ({ ...prev, a: false }));
      } else if (key === 's') {
        setWasdKeys((prev) => ({ ...prev, s: false }));
      } else if (key === 'd') {
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

  // Send movement updates
  useEffect(() => {
    const interval = setInterval(() => {
      sendMovement();
    }, movementSendInterval);

    return () => clearInterval(interval);
  }, [sendMovement]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Debug: log player positions
    if (!me?.position) {
      console.warn('[BattleArena] Me position is missing:', { me });
    }
    if (!opponent?.position) {
      console.warn('[BattleArena] Opponent position is missing:', { opponent });
    }

    if (!me?.position || !opponent?.position) {
      // Show loading state
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for arena data...', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw arena border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, ARENA_WIDTH * CANVAS_SCALE, ARENA_HEIGHT * CANVAS_SCALE);

    // Draw player 1 (me) - use local position if available (client-side prediction)
    const displayPosition = localPosition || me.position;
    const p1X = displayPosition.x * CANVAS_SCALE;
    const p1Y = displayPosition.y * CANVAS_SCALE;
    ctx.fillStyle = '#3899ec';
    ctx.beginPath();
    ctx.arc(p1X, p1Y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw player 2 (opponent)
    const p2X = opponent.position.x * CANVAS_SCALE;
    const p2Y = opponent.position.y * CANVAS_SCALE;
    ctx.fillStyle = '#ec3838';
    ctx.beginPath();
    ctx.arc(p2X, p2Y, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw range circles for abilities (if any has range)
    const firstAbilityWithRange = abilities.find((a) => a.range);
    if (firstAbilityWithRange) {
      ctx.strokeStyle = 'rgba(100, 200, 100, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        p1X,
        p1Y,
        (firstAbilityWithRange.range || 0) * CANVAS_SCALE,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    // Draw distance line
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p1X, p1Y);
    ctx.lineTo(p2X, p2Y);
    ctx.stroke();

    // Draw distance text
    const midX = (p1X + p2X) / 2;
    const midY = (p1Y + p2Y) / 2;
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(distance.toFixed(1), midX, midY - 10);
  }, [me, opponent, abilities, distance]);

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
