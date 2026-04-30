'use client';

import { useRef } from 'react';
import { Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const HP_REF_DIST = 20;
const NAMEPLATE_Y = 2.2;
const _hpWorldPos = new THREE.Vector3();
const _screenWorldPos = new THREE.Vector3();

interface TargetEntityVisualProps {
  worldX: number;
  worldY: number;
  worldZ: number;
  radius: number;
  hp: number;
  maxHp: number;
  isOwn: boolean;
  isSelected?: boolean;
  username: string;
  distance?: number;
  color: string;
  worldHalfX: number;
  worldHalfY: number;
  onClick?: () => void;
  onScreenBounds?: (bounds: { cx: number; topY: number; baseY: number; rs: number }) => void;
}

export default function TargetEntityVisual({
  worldX,
  worldY,
  worldZ,
  radius,
  hp,
  maxHp,
  isOwn,
  isSelected = false,
  username,
  distance,
  color,
  worldHalfX,
  worldHalfY,
  onClick,
  onScreenBounds,
}: TargetEntityVisualProps) {
  const hpGroupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const { camera, size } = useThree();

  const showHpBar = isOwn || (distance !== undefined && distance <= 60);
  const healthPct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
  const hpColor = isOwn
    ? '#44cc55'
    : isSelected
    ? '#ff8888'
    : (healthPct > 0.5 ? '#dd2222' : healthPct > 0.25 ? '#cc1111' : '#991111');

  useFrame(({ clock }) => {
    const ringMat = ringRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (ringMat) {
      const pulse = 0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 3.3);
      ringMat.opacity = 0.55 + 0.25 * pulse;
    }
    const fillMat = fillRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (fillMat) {
      const pulse = 0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 2.7);
      fillMat.opacity = 0.12 + 0.05 * pulse;
    }
    if (hpGroupRef.current) {
      hpGroupRef.current.visible = showHpBar;
      hpGroupRef.current.quaternion.copy(camera.quaternion);
      if (showHpBar) {
        hpGroupRef.current.getWorldPosition(_hpWorldPos);
        const camDist = camera.position.distanceTo(_hpWorldPos);
        hpGroupRef.current.scale.setScalar(camDist / HP_REF_DIST);
      }
    }
    if (onScreenBounds) {
      const screenWorld = _screenWorldPos.set(
        worldX - worldHalfX,
        worldZ + NAMEPLATE_Y + 0.35,
        worldHalfY - worldY,
      ).project(camera);
      const rawCx = (screenWorld.x * 0.5 + 0.5) * size.width;
      const rawTopY = (-screenWorld.y * 0.5 + 0.5) * size.height;
      const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
      onScreenBounds({
        cx: Number.isFinite(rawCx) ? clamp(rawCx, 0, size.width) : size.width * 0.5,
        topY: Number.isFinite(rawTopY) ? clamp(rawTopY, 0, size.height) : size.height * 0.15,
        baseY: Number.isFinite(rawTopY) ? clamp(rawTopY, 0, size.height) : size.height * 0.15,
        rs: 1,
      });
    }
  });

  const handleSelect = (event: any) => {
    if (!onClick) return;
    event.stopPropagation();
    onClick();
  };

  return (
    <group position={[worldX - worldHalfX, worldZ, worldHalfY - worldY]}>
      {/* Cylinder body — same shape as player avatar */}
      <mesh position={[0, 0.75, 0]} onPointerDown={handleSelect} castShadow>
        <cylinderGeometry args={[0.42, 0.42 * 0.9, 1.5, 16]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={handleSelect}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={handleSelect}>
        <ringGeometry args={[Math.max(0, radius - 0.3), radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.72} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} onPointerDown={handleSelect}>
          <ringGeometry args={[radius + 0.08, radius + 0.24, 48]} />
          <meshBasicMaterial color="#ffd24a" transparent opacity={0.78} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {showHpBar && (
        <group ref={hpGroupRef} position={[0, NAMEPLATE_Y, 0]}>
          <Text
            position={[0, 0.32, 0]}
            fontSize={0.28}
            color={isSelected ? '#ff99bb' : (isOwn ? '#66dd77' : '#ff3333')}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.025}
            outlineColor="#000000"
            material-toneMapped={false}
            material-depthTest={true}
            material-depthWrite={false}
          >
            {isSelected && distance !== undefined ? `${username} · ${distance.toFixed(1)}尺` : username}
          </Text>
          <sprite scale={[2.86, 0.274, 1]} renderOrder={0}>
            <spriteMaterial color="#000000" depthTest={true} depthWrite={false} toneMapped={false} />
          </sprite>
          <sprite scale={[2.8, 0.224, 1]} renderOrder={1}>
            <spriteMaterial color="#222222" transparent opacity={0.9} depthTest={true} depthWrite={false} toneMapped={false} />
          </sprite>
          <sprite position={[(healthPct - 1) * 1.4, 0, 0]} scale={[2.8 * healthPct, 0.182, 1]} renderOrder={2}>
            <spriteMaterial color={hpColor} depthTest={true} depthWrite={false} toneMapped={false} />
          </sprite>
        </group>
      )}
    </group>
  );
}