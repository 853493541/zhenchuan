'use client';

import { useMemo } from 'react';

interface GroundProps {
  arenaSize?: number;
  isArena?: boolean;
  safeZone?: { centerX: number; centerY: number; currentHalf: number; dps: number };
  onPointerMove?: (e: any) => void;
  onPointerDown?: (e: any) => void;
}

export default function Ground({
  arenaSize = 2000,
  isArena = false,
  safeZone,
  onPointerMove,
  onPointerDown,
}: GroundProps) {
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

  /* ── Safe zone (毒圈) white glowing boundary ── */
  const safeZoneBorderPositions = useMemo(() => {
    if (!safeZone || safeZone.currentHalf >= half) return new Float32Array(0);
    const cx = safeZone.centerX - half;
    const cz = safeZone.centerY - half;
    const h = safeZone.currentHalf;
    const y = 0.10;
    return new Float32Array([
      cx - h, y, cz - h,   cx + h, y, cz - h,
      cx + h, y, cz - h,   cx + h, y, cz + h,
      cx + h, y, cz + h,   cx - h, y, cz + h,
      cx - h, y, cz + h,   cx - h, y, cz - h,
    ]);
  }, [safeZone, half]);

  // ═══════════════════════════════════════════════════
  //  ARENA MODE — Green grass + white glowing border
  // ═══════════════════════════════════════════════════
  if (isArena) {
    return (
      <group>
        {/* Green grass ground */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.01, 0]}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
        >
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

        {/* Safe zone (毒圈) border — bright white core (extra shiny) */}
        {safeZoneBorderPositions.length > 0 && (
          <lineSegments>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[safeZoneBorderPositions, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#ffffff" transparent opacity={1} />
          </lineSegments>
        )}

        {/* Safe zone gradient barrier wall — fades from strong at bottom to invisible at 15 units */}
        {safeZone && safeZone.currentHalf < half && safeZone.currentHalf > 0 && (() => {
          const cx = safeZone.centerX - half;
          const cz = safeZone.centerY - half;
          const h = safeZone.currentHalf;
          const wallHeight = 15;
          const layers = 6;
          const walls: JSX.Element[] = [];
          for (let i = 0; i < layers; i++) {
            const t = i / layers; // 0 = bottom, 1 = top
            const layerH = wallHeight / layers;
            const yCenter = t * wallHeight + layerH / 2;
            const opacity = 0.12 * (1 - t); // strong at bottom, fading to 0 at top
            if (opacity < 0.005) continue;
            walls.push(
              <group key={i}>
                <mesh position={[cx, yCenter, cz - h]}>
                  <planeGeometry args={[h * 2, layerH]} />
                  <meshBasicMaterial color="#66ffcc" transparent opacity={opacity} side={2} depthWrite={false} />
                </mesh>
                <mesh position={[cx, yCenter, cz + h]}>
                  <planeGeometry args={[h * 2, layerH]} />
                  <meshBasicMaterial color="#66ffcc" transparent opacity={opacity} side={2} depthWrite={false} />
                </mesh>
                <mesh position={[cx + h, yCenter, cz]} rotation={[0, Math.PI / 2, 0]}>
                  <planeGeometry args={[h * 2, layerH]} />
                  <meshBasicMaterial color="#66ffcc" transparent opacity={opacity} side={2} depthWrite={false} />
                </mesh>
                <mesh position={[cx - h, yCenter, cz]} rotation={[0, Math.PI / 2, 0]}>
                  <planeGeometry args={[h * 2, layerH]} />
                  <meshBasicMaterial color="#66ffcc" transparent opacity={opacity} side={2} depthWrite={false} />
                </mesh>
              </group>
            );
          }
          return <group>{walls}</group>;
        })()}
      </group>
    );
  }

  // ═══════════════════════════════════════════════
  //  PUBG MODE — Forest green ground
  // ═══════════════════════════════════════════════
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
      >
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
