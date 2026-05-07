'use client';

import { useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';

interface AoeZoneProps {
  worldX: number;
  worldY: number;
  worldZ?: number;
  radius: number;
  color: string;
  ringThickness?: number;
  labelSize?: number;
  worldHalfX: number;
  worldHalfY: number;
  /** Optional text label displayed in the centre of the zone, always facing the camera */
  label?: string;
  /** Colour override for the label — defaults to `color` */
  labelColor?: string;
  followPositionRef?: MutableRefObject<{ x: number; y: number; z: number }>;
  followZOffset?: number;
  smoothPosition?: boolean;
  instantSnapAtRef?: MutableRefObject<number>;
  instantSnapWindowMs?: number;
}

export default function AoeZone({
  worldX, worldY, worldZ = 0, radius, color, ringThickness, labelSize, worldHalfX, worldHalfY,
  label, labelColor, followPositionRef, followZOffset = 0, smoothPosition = false, instantSnapAtRef, instantSnapWindowMs = 0,
}: AoeZoneProps) {
  const groupRef  = useRef<THREE.Group>(null);
  const ringRef   = useRef<THREE.Mesh>(null);
  const fillRef   = useRef<THREE.Mesh>(null);
  const currentPos = useRef(new THREE.Vector3(worldX - worldHalfX, worldZ + 0.04, worldHalfY - worldY));

  useFrame(({ clock }) => {
    const target = followPositionRef?.current;
    const targetX = target ? target.x - worldHalfX : worldX - worldHalfX;
    const targetY = target ? (target.z ?? 0) + followZOffset + 0.04 : worldZ + 0.04;
    const targetZ = target ? worldHalfY - target.y : worldHalfY - worldY;
    if (groupRef.current) {
      if (followPositionRef) {
        groupRef.current.position.set(targetX, targetY, targetZ);
      } else if (smoothPosition) {
        const shouldSnap = !!instantSnapAtRef && instantSnapWindowMs > 0 && performance.now() - instantSnapAtRef.current < instantSnapWindowMs;
        if (shouldSnap) {
          currentPos.current.set(targetX, targetY, targetZ);
        } else {
          currentPos.current.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.18);
        }
        groupRef.current.position.copy(currentPos.current);
      }
    }

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
  const resolvedRingThickness = Math.max(0.02, Math.min(ringThickness ?? 0.3, Math.max(0.02, radius - 0.02)));
  const resolvedLabelSize = Math.max(0.2, labelSize ?? 0.72);

  return (
    <group ref={groupRef} position={[x, worldZ + 0.04, z]}>
      {/* Ground fill disc */}
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Ground ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(0, radius - resolvedRingThickness), radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Label — always faces camera via Billboard, centred just above the ground */}
      {label && (
        <Billboard position={[0, 0.8, 0]}>
          <Text
            fontSize={resolvedLabelSize}
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
