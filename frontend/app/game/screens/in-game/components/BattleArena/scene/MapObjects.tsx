'use client';

import { MutableRefObject, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { worldMapObjects } from '../worldMap';

// Color palette per object type
const OBJ_COLORS: Record<string, string> = {
  building:  '#4a5465',
  rock:      '#363640',
  mountain:  '#3a2e22',
  hill_high: '#253a1e',
  hill_low:  '#2a4228',
};

// Offset from center: worldMap uses (0,0) as top-left corner of the arena,
// but Three.js scene is centered at (0,0,0) with arena spanning ±1000 on X and Z.
const HALF = 1000;
const RENDER_RANGE = 200;

interface MapObjectsProps {
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z: number }>;
}

export default function MapObjects({ localRenderPosRef }: MapObjectsProps) {
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

  const objects = useMemo(() => {
    return worldMapObjects
      .filter(obj => {
        const cx = obj.x + obj.w * 0.5;
        const cy = obj.y + obj.d * 0.5;
        const radius = Math.hypot(obj.w, obj.d) * 0.5;
        const dx = cx - center.x;
        const dy = cy - center.y;
        return dx * dx + dy * dy <= (RENDER_RANGE + radius) * (RENDER_RANGE + radius);
      })
      .map(obj => ({
      id: obj.id,
      // Center the box: obj.x/y are min corners, convert to center
      px: obj.x + obj.w * 0.5 - HALF,
      py: obj.h * 0.5,            // Three.js y = height, box sits on floor
      pz: obj.y + obj.d * 0.5 - HALF,
      sx: obj.w,
      sy: obj.h,
      sz: obj.d,
      color: OBJ_COLORS[obj.type] ?? '#4a5465',
    }));
  }, [center.x, center.y]);

  return (
    <group>
      {objects.map(o => (
        <mesh
          key={o.id}
          position={[o.px, o.py, o.pz]}
        >
          <boxGeometry args={[o.sx, o.sy, o.sz]} />
          <meshLambertMaterial color={o.color} />
        </mesh>
      ))}
    </group>
  );
}
