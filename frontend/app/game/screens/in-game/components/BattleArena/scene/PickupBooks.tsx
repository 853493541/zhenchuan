'use client';

import { MutableRefObject, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PickupItem } from '../../../types';

const HALF = 1000;
const RENDER_RANGE = 200;

interface PickupBooksProps {
  pickups: PickupItem[];
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z: number }>;
}

function PickupBook({ pickup }: { pickup: PickupItem }) {
  const x = pickup.position.x - HALF;
  const z = pickup.position.y - HALF;

  // Stable angle from id hash
  const angle = (parseInt(pickup.id.replace(/-/g, '').slice(0, 6), 16) % 360) * (Math.PI / 180);

  return (
    <group position={[x, 0, z]}>
      {/* Book body — dark blue */}
      <mesh rotation={[0, angle, 0]} position={[0, 0.05, 0]}>
        <boxGeometry args={[0.84, 0.1, 0.52]} />
        <meshLambertMaterial color="#1a2a6e" />
      </mesh>

      {/* Spine */}
      <mesh rotation={[0, angle, 0]} position={[-0.3, 0.05, 0]}>
        <boxGeometry args={[0.06, 0.12, 0.52]} />
        <meshLambertMaterial color="#1a2a6e" />
      </mesh>

      {/* Green point light — real glow on surrounding surfaces */}
      <pointLight position={[0, 0.5, 0]} color="#00ff44" intensity={4} distance={6} decay={2} />
      {/* Solid bright green rod */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 1.0, 8]} />
        <meshBasicMaterial color="#00ff44" />
      </mesh>
    </group>
  );
}

export default function PickupBooks({ pickups, localRenderPosRef }: PickupBooksProps) {
  const [center, setCenter] = useState<{ x: number; y: number }>({
    x: localRenderPosRef.current.x,
    y: localRenderPosRef.current.y,
  });
  const lastUpdateMsRef = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - lastUpdateMsRef.current < 120) return;
    lastUpdateMsRef.current = now;
    const p = localRenderPosRef.current;
    setCenter(prev => {
      if (Math.abs(prev.x - p.x) < 1 && Math.abs(prev.y - p.y) < 1) return prev;
      return { x: p.x, y: p.y };
    });
  });

  const visiblePickups = useMemo(
    () => pickups.filter((p) => {
      const dx = p.position.x - center.x;
      const dy = p.position.y - center.y;
      return dx * dx + dy * dy <= RENDER_RANGE * RENDER_RANGE;
    }),
    [pickups, center.x, center.y],
  );

  return (
    <group>
      {visiblePickups.map(p => (
        <PickupBook key={p.id} pickup={p} />
      ))}
    </group>
  );
}
