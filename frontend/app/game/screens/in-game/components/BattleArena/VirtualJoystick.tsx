'use client';

/**
 * VirtualJoystick — Analog circular joystick for touch devices.
 *
 * - Fires onDirectionChange with WASD booleans (for keysRef / local prediction).
 * - Fires onAnalogMove with normalised (dx, dy) for smooth server-side movement.
 * - The outer ring is fixed; the knob follows the first touch inside the ring.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';

interface VirtualJoystickProps {
  onDirectionChange: (keys: { w: boolean; a: boolean; s: boolean; d: boolean }) => void;
  /** Called with normalised dx/dy (magnitude ≤ 1) for analog movement. */
  onAnalogMove?: (dx: number, dy: number) => void;
  /** Show a dedicated jump button next to the joystick. */
  onJump?: () => void;
  size?: number; // diameter of the outer ring in px (default 120)
}

const DEAD_ZONE_RATIO = 0.22; // fraction of radius below which all keys are false

export default function VirtualJoystick({
  onDirectionChange,
  onAnalogMove,
  onJump,
  size = 120,
}: VirtualJoystickProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  const radius = size / 2;
  const deadZone = radius * DEAD_ZONE_RATIO;

  const computeDirection = useCallback((relX: number, relY: number) => {
    const dist = Math.sqrt(relX * relX + relY * relY);
    if (dist < deadZone) {
      onDirectionChange({ w: false, a: false, s: false, d: false });
      onAnalogMove?.(0, 0);
      return;
    }
    const ndx = relX / Math.max(dist, radius);
    const ndy = relY / Math.max(dist, radius);

    const w = ndy < -DEAD_ZONE_RATIO;
    const s = ndy >  DEAD_ZONE_RATIO;
    const a = ndx < -DEAD_ZONE_RATIO;
    const d = ndx >  DEAD_ZONE_RATIO;

    onDirectionChange({ w, a, s, d });
    onAnalogMove?.(ndx, -ndy);
  }, [radius, deadZone, onDirectionChange, onAnalogMove]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (touchIdRef.current !== null) return;
    const touch = e.changedTouches[0];
    touchIdRef.current = touch.identifier;
    const rect = outerRef.current!.getBoundingClientRect();
    const relX = touch.clientX - rect.left - radius;
    const relY = touch.clientY - rect.top  - radius;
    const cx = Math.max(-radius, Math.min(radius, relX));
    const cy = Math.max(-radius, Math.min(radius, relY));
    setKnob({ x: cx, y: cy });
    computeDirection(relX, relY);
  }, [radius, computeDirection]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return;
    const rect = outerRef.current!.getBoundingClientRect();
    const relX = touch.clientX - rect.left - radius;
    const relY = touch.clientY - rect.top  - radius;
    const cx = Math.max(-radius, Math.min(radius, relX));
    const cy = Math.max(-radius, Math.min(radius, relY));
    setKnob({ x: cx, y: cy });
    computeDirection(relX, relY);
  }, [radius, computeDirection]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return;
    touchIdRef.current = null;
    setKnob(null);
    onDirectionChange({ w: false, a: false, s: false, d: false });
    onAnalogMove?.(0, 0);
  }, [onDirectionChange, onAnalogMove]);

  useEffect(() => {
    const release = () => {
      if (touchIdRef.current !== null) {
        touchIdRef.current = null;
        setKnob(null);
        onDirectionChange({ w: false, a: false, s: false, d: false });
        onAnalogMove?.(0, 0);
      }
    };
    window.addEventListener('touchcancel', release);
    return () => window.removeEventListener('touchcancel', release);
  }, [onDirectionChange, onAnalogMove]);

  const knobSize = size * 0.42;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div
        ref={outerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.35)',
          border: '2px solid rgba(255,255,255,0.28)',
          position: 'relative',
          flexShrink: 0,
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {(['↑','↓','←','→'] as const).map((arrow, i) => {
          const positions: React.CSSProperties[] = [
            { top: 4,    left: '50%',  transform: 'translateX(-50%)' },
            { bottom: 4, left: '50%',  transform: 'translateX(-50%)' },
            { left: 4,   top: '50%',   transform: 'translateY(-50%)' },
            { right: 4,  top: '50%',   transform: 'translateY(-50%)' },
          ];
          return (
            <span key={arrow} style={{
              position: 'absolute',
              ...positions[i],
              color: 'rgba(255,255,255,0.35)',
              fontSize: 12,
              pointerEvents: 'none',
            }}>{arrow}</span>
          );
        })}
        <div style={{
          position: 'absolute',
          width: knobSize,
          height: knobSize,
          borderRadius: '50%',
          background: knob ? 'rgba(100,180,255,0.88)' : 'rgba(210,210,210,0.50)',
          border: '2px solid rgba(255,255,255,0.65)',
          left: radius + (knob?.x ?? 0) - knobSize / 2,
          top:  radius + (knob?.y ?? 0) - knobSize / 2,
          pointerEvents: 'none',
          transition: knob ? 'none' : 'all 0.12s ease',
          boxShadow: knob ? '0 0 14px rgba(80,160,255,0.7)' : 'none',
        }} />
      </div>

      {onJump && (
        <div
          onTouchStart={(e) => { e.preventDefault(); onJump(); }}
          style={{
            width: 58,
            height: 58,
            borderRadius: '50%',
            background: 'rgba(60,160,60,0.75)',
            border: '2px solid rgba(140,255,140,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 24,
            fontWeight: 700,
            touchAction: 'none',
            userSelect: 'none',
            flexShrink: 0,
            boxShadow: '0 0 10px rgba(60,200,60,0.4)',
          }}
        >
          ↑
        </div>
      )}
    </div>
  );
}
