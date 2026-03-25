'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

const ARENA_SIZE = 2000;
const GRID_STEP = 100;
const GRID_HALF = 600;

export default function Ground() {
  // Ground plane
  // Grid lines via LineSegments
  const { gridPositions } = useMemo(() => {
    const positions: number[] = [];
    const half = GRID_HALF;
    // X lines
    for (let x = -half; x <= half; x += GRID_STEP) {
      positions.push(x, 0.01, -half, x, 0.01, half);
    }
    // Z lines
    for (let z = -half; z <= half; z += GRID_STEP) {
      positions.push(-half, 0.01, z, half, 0.01, z);
    }
    return { gridPositions: new Float32Array(positions) };
  }, []);

  // Arena boundary lines (full perimeter)
  const boundaryPositions = useMemo(() => {
    const h = ARENA_SIZE / 2;
    return new Float32Array([
      -h, 0.05, -h,  h, 0.05, -h,
       h, 0.05, -h,  h, 0.05,  h,
       h, 0.05,  h, -h, 0.05,  h,
      -h, 0.05,  h, -h, 0.05, -h,
    ]);
  }, []);

  return (
    <group>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[ARENA_SIZE, ARENA_SIZE]} />
        <meshLambertMaterial color="#d4b070" />
      </mesh>

      {/* Grid lines */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[gridPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#a07840" transparent opacity={0.4} />
      </lineSegments>

      {/* Arena boundary */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[boundaryPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#c08030" />
      </lineSegments>
    </group>
  );
}
