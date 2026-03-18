'use client';

import React, { useRef, useEffect } from 'react';
import styles from './VirtualJoystick.module.css';

interface VirtualJoystickProps {
  onDirectionChange: (keys: {
    w: boolean;
    a: boolean;
    s: boolean;
    d: boolean;
  }) => void;
}

/**
 * Virtual joystick for mobile/touch screens
 * Converts touch drag to WASD-like directional input
 */
export default function VirtualJoystick({ onDirectionChange }: VirtualJoystickProps) {
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const containerCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const JOYSTICK_RADIUS = 50; // Outer radius in px
  const KNOB_RADIUS = 20; // Inner knob radius in px
  const DEAD_ZONE = 10; // Dead zone radius in px

  // Update the direction state based on knob position
  const updateDirection = (knobX: number, knobY: number) => {
    const distance = Math.sqrt(knobX * knobX + knobY * knobY);

    // Normalize direction
    let dirX = 0,
      dirY = 0;
    if (distance > DEAD_ZONE) {
      const angle = Math.atan2(knobY, knobX);
      dirX = Math.cos(angle);
      dirY = Math.sin(angle);
    }

    // Convert Cartesian direction to WASD keys
    // 45-degree octants to determine which keys are pressed
    const threshold = Math.cos(Math.PI / 8); // cos(22.5°) ≈ 0.92

    const w = dirY < -threshold;
    const s = dirY > threshold;
    const a = dirX < -threshold;
    const d = dirX > threshold;

    onDirectionChange({ w, a, s, d });
  };

  // Reset joystick to center
  const resetJoystick = () => {
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(0, 0)';
    }
    updateDirection(0, 0);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (touchIdRef.current !== null) return; // Already tracking a touch

    const touch = e.touches[0];
    touchIdRef.current = touch.identifier;

    // Get joystick container center
    if (joystickRef.current) {
      const rect = joystickRef.current.getBoundingClientRect();
      containerCenterRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    // Calculate initial position
    const dx = touch.clientX - containerCenterRef.current.x;
    const dy = touch.clientY - containerCenterRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= JOYSTICK_RADIUS) {
      handleTouchMove(e);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = Array.from(e.touches).find((t) => t.identifier === touchIdRef.current);
    if (!touch) return;

    const dx = touch.clientX - containerCenterRef.current.x;
    const dy = touch.clientY - containerCenterRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Clamp to joystick radius
    let clampedX = dx;
    let clampedY = dy;
    if (distance > JOYSTICK_RADIUS) {
      const scale = JOYSTICK_RADIUS / distance;
      clampedX = dx * scale;
      clampedY = dy * scale;
    }

    // Update knob visual position
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    }

    // Update direction state
    updateDirection(clampedX, clampedY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchExists = Array.from(e.touches).find((t) => t.identifier === touchIdRef.current);
    if (!touchExists) {
      touchIdRef.current = null;
      resetJoystick();
    }
  };

  useEffect(() => {
    // Ensure proper cleanup
    return () => {
      resetJoystick();
    };
  }, []);

  return (
    <div className={styles.joystickContainer}>
      <div
        ref={joystickRef}
        className={styles.joystick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Outer circle (visual feedback) */}
        <div className={styles.outerCircle} />

        {/* Direction indicators */}
        <div className={styles.directions}>
          <div className={styles.directionLabel + ' ' + styles.up}>↑</div>
          <div className={styles.directionLabel + ' ' + styles.left}>←</div>
          <div className={styles.directionLabel + ' ' + styles.right}>→</div>
          <div className={styles.directionLabel + ' ' + styles.down}>↓</div>
        </div>

        {/* Inner knob (draggable) */}
        <div ref={knobRef} className={styles.knob} />
      </div>
      <p className={styles.label}>摇杆</p>
    </div>
  );
}
