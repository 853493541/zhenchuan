'use client';

import { useMemo } from 'react';

interface GroundProps {
  arenaSize?: number;
  isArena?: boolean;
}

export default function Ground({ arenaSize = 2000, isArena = false }: GroundProps) {
  const half = arenaSize / 2;

  /* ── Arena grid lines ── */
  const arenaGridPositions = useMemo(() => {
    if (!isArena) return new Float32Array(0);
    const positions: number[] = [];
    const step = 20;
    for (let x = -half; x <= half; x += step) {
      positions.push(x, 0.02, -half, x, 0.02, half);
    }
    for (let z = -half; z <= half; z += step) {
      positions.push(-half, 0.02, z, half, 0.02, z);
    }
    return new Float32Array(positions);
  }, [isArena, half]);

  /* ── Arena white glowing border (double line for glow effect) ── */
  const arenaBorderPositions = useMemo(() => {
    if (!isArena) return new Float32Array(0);
    return new Float32Array([
      -half, 0.06, -half,   half, 0.06, -half,
       half, 0.06, -half,   half, 0.06,  half,
       half, 0.06,  half,  -half, 0.06,  half,
      -half, 0.06,  half,  -half, 0.06, -half,
    ]);
  }, [isArena, half]);

  // Slightly wider outer border for glow halo
  const arenaBorderOuterPositions = useMemo(() => {
    if (!isArena) return new Float32Array(0);
    const o = 0.3; // offset outward
    return new Float32Array([
      -half - o, 0.05, -half - o,   half + o, 0.05, -half - o,
       half + o, 0.05, -half - o,   half + o, 0.05,  half + o,
       half + o, 0.05,  half + o,  -half - o, 0.05,  half + o,
      -half - o, 0.05,  half + o,  -half - o, 0.05, -half - o,
    ]);
  }, [isArena, half]);

  /* ── PUBG rectangular grid ── */
  const GRID_STEP = 100;
  const GRID_HALF = 600;

  const { gridPositions } = useMemo(() => {
    if (isArena) return { gridPositions: new Float32Array(0) };
    const positions: number[] = [];
    const gh = GRID_HALF;
    for (let x = -gh; x <= gh; x += GRID_STEP) {
      positions.push(x, 0.01, -gh, x, 0.01, gh);
    }
    for (let z = -gh; z <= gh; z += GRID_STEP) {
      positions.push(-gh, 0.01, z, gh, 0.01, z);
    }
    return { gridPositions: new Float32Array(positions) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArena]);

  const boundaryPositions = useMemo(() => {
    if (isArena) return new Float32Array(0);
    const h = arenaSize / 2;
    return new Float32Array([
      -h, 0.05, -h,  h, 0.05, -h,
       h, 0.05, -h,  h, 0.05,  h,
       h, 0.05,  h, -h, 0.05,  h,
      -h, 0.05,  h, -h, 0.05, -h,
    ]);
  }, [isArena, arenaSize]);

  // ═══════════════════════════════════════════════════
  //  ARENA MODE — Green grass + white glowing border
  // ═══════════════════════════════════════════════════
  if (isArena) {
    return (
      <group>
        {/* Green grass ground */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[arenaSize, arenaSize]} />
          <meshLambertMaterial color="#4e8c5a" />
        </mesh>

        {/* Subtle grid lines */}
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[arenaGridPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#2a5e35" transparent opacity={0.25} />
        </lineSegments>

        {/* White glowing border — outer halo */}
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[arenaBorderOuterPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.3} />
        </lineSegments>

        {/* White glowing border — bright core */}
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[arenaBorderPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.9} />
        </lineSegments>
      </group>
    );
  }

  // ═══════════════════════════════════════════════
  //  PUBG MODE — Forest green ground
  // ═══════════════════════════════════════════════
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[arenaSize, arenaSize]} />
        <meshLambertMaterial color="#4e8c5a" />
      </mesh>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#2a5e35" transparent opacity={0.4} />
      </lineSegments>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[boundaryPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#1a3e22" />
      </lineSegments>
    </group>
  );
}
