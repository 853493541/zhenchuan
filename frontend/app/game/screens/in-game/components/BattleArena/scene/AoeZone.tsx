'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';

interface AoeZoneProps {
  worldX: number;
  worldY: number;
  worldZ?: number;
  radius: number;
  color: string;
  worldHalfX: number;
  worldHalfY: number;
  /** Optional text label displayed in the centre of the zone, always facing the camera */
  label?: string;
  /** Colour override for the label — defaults to `color` */
  labelColor?: string;
}

export default function AoeZone({
  worldX, worldY, worldZ = 0, radius, color, worldHalfX, worldHalfY,
  label, labelColor,
}: AoeZoneProps) {
  const ringRef   = useRef<THREE.Mesh>(null);
  const fillRef   = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 3.3);
    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 + 0.35 * pulse;
    }
    if (fillRef.current) {
      const mat = fillRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.10 + 0.06 * pulse;
    }
  });

  const x = worldX - worldHalfX;
  const z = worldHalfY - worldY;
  const textColor = labelColor ?? color;

  return (
    <group position={[x, worldZ + 0.04, z]}>
      {/* Ground fill disc */}
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Ground ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.3, radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Label — always faces camera via Billboard, centred just above the ground */}
      {label && (
        <Billboard position={[0, 0.8, 0]}>
          <Text
            fontSize={0.72}
            color={textColor}
            anchorX="center"
            anchorY="middle"
            outlineColor="#000000"
            outlineWidth={0.08}
          >
            {label}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
