'use client';

import { useRef, MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

const CHAR_RADIUS = 0.7;
const CHAR_HEIGHT = 2.0;
/** Camera distance at which the HP bar has scale=1 (matches default camera offset) */
const HP_REF_DIST = 20;
const _hpWorldPos = new THREE.Vector3();

interface CharacterProps {
  worldX: number;
  worldY: number;
  worldZ: number;
  color: string;
  emissive: string;
  hp: number;
  maxHp: number;
  isMe: boolean;
  isSelected?: boolean;
  facing?: { x: number; y: number };
  /** Live facing ref — read every frame for the local player */
  facingRef?: MutableRefObject<{ x: number; y: number }>;
  username?: string;
  /** Distance to this character in game units (displayed in the name label) */
  distance?: number;
  onSelect?: () => void;
  /** Live position ref — read every frame for the local player */
  posRef?: MutableRefObject<{ x: number; y: number; z: number }>;
  /** Per-frame projected screen anchor for HUD overlays */
  onScreenBounds?: (bounds: { cx: number; topY: number; baseY: number; rs: number }) => void;
  worldHalf: number;
}

export default function Character({
  worldX,
  worldY,
  worldZ,
  color,
  emissive,
  hp,
  maxHp,
  isMe,
  isSelected = false,
  facing,
  facingRef,
  username,
  distance,
  onSelect,
  posRef,
  onScreenBounds,
  worldHalf,
}: CharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const arcRef = useRef<THREE.Mesh>(null);
  const arcBorderRef = useRef<THREE.Mesh>(null);
  const arcGlowRef = useRef<THREE.Mesh>(null);
  const hpGroupRef = useRef<THREE.Group>(null);
  /** Smoothed display yaw for the arc — lags behind actual facing for visual animation */
  const arcDisplayYawRef = useRef(0);
  const { camera, size } = useThree();

  // Show HP bar: always for self, within 60 units for others
  const showHpBar = isMe || (distance !== undefined && distance <= 60);

  const handleSelect = (e: any) => {
    if (!onSelect) return;
    e.stopPropagation();
    onSelect();
  };

  const hpPct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
  const hpColor = isMe
    ? '#3399ff'
    : isSelected
    ? '#ff8888'
    : (hpPct > 0.5 ? '#dd2222' : hpPct > 0.25 ? '#cc1111' : '#991111');

  const threeX = worldX - worldHalf;
  const threeY = worldZ;
  const threeZ = worldY - worldHalf;

  // For opponent (no posRef): smooth lerp toward prop position
  const currentPos = useRef(new THREE.Vector3(threeX, threeY, threeZ));

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // --- Position ---
    if (posRef) {
      // Local player: posRef is already smoothed by the rAF loop in BattleArena.
      // Copy directly — NO additional lerp (avoids sluggish double-smoothing).
      const p = posRef.current;
      groupRef.current.position.set(p.x - worldHalf, p.z, p.y - worldHalf);
    } else {
      // Opponent: smooth lerp toward prop-driven position
      const tx = worldX - worldHalf;
      const ty = worldZ;
      const tz = worldY - worldHalf;
      currentPos.current.lerp(new THREE.Vector3(tx, ty, tz), 0.18);
      groupRef.current.position.copy(currentPos.current);
    }

    // --- Facing rotation (updated every frame) ---
    const f = facingRef ? facingRef.current : facing;
    if (f && bodyRef.current) {
      const yaw = Math.atan2(f.x, f.y);
      bodyRef.current.rotation.set(0, yaw, 0);

      // Smooth arc display yaw — rotates at max 720°/s so a full 180° takes ~0.25s
      const MAX_ARC_SPEED = Math.PI * 4; // rad/s
      let arcDiff = yaw - arcDisplayYawRef.current;
      // Shortest-path wrap to [-π, π]
      arcDiff = ((arcDiff + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxStep = MAX_ARC_SPEED * Math.min(delta, 0.1);
      arcDisplayYawRef.current += Math.abs(arcDiff) < maxStep ? arcDiff : maxStep * Math.sign(arcDiff);
      const arcYaw = arcDisplayYawRef.current;

      // Update facing arc: YXZ Euler order so Ry(yaw) spins in world XZ first,
      // then Rx(-π/2) lays the circle flat on the ground.
      if (arcRef.current) {
        arcRef.current.position.set(Math.sin(arcYaw) * 0.8, 0.04, Math.cos(arcYaw) * 0.8);
        arcRef.current.rotation.order = 'YXZ';
        arcRef.current.rotation.set(-Math.PI / 2, arcYaw, 0);
      }
      if (arcBorderRef.current) {
        arcBorderRef.current.position.set(Math.sin(arcYaw) * 0.8, 0.04, Math.cos(arcYaw) * 0.8);
        arcBorderRef.current.rotation.order = 'YXZ';
        arcBorderRef.current.rotation.set(-Math.PI / 2, arcYaw, 0);
      }
      if (arcGlowRef.current) {
        arcGlowRef.current.position.set(Math.sin(arcYaw) * 0.8, 0.035, Math.cos(arcYaw) * 0.8);
        arcGlowRef.current.rotation.order = 'YXZ';
        arcGlowRef.current.rotation.set(-Math.PI / 2, arcYaw, 0);
      }
    }

    // --- Billboard HP bar: always face camera, fixed screen size ---
    if (hpGroupRef.current) {
      hpGroupRef.current.quaternion.copy(camera.quaternion);
      // Scale inversely with distance so on-screen size stays constant
      hpGroupRef.current.getWorldPosition(_hpWorldPos);
      const camDist = camera.position.distanceTo(_hpWorldPos);
      const s = camDist / HP_REF_DIST;
      hpGroupRef.current.scale.setScalar(s);
    }

    // --- World->screen anchor for floating numbers / HUD overlays ---
    if (onScreenBounds) {
      const headWorld = new THREE.Vector3(
        groupRef.current.position.x,
        groupRef.current.position.y + CHAR_HEIGHT + 1.05,
        groupRef.current.position.z,
      );
      const hpWorld = new THREE.Vector3(
        groupRef.current.position.x,
        groupRef.current.position.y + CHAR_HEIGHT + 0.7,
        groupRef.current.position.z,
      );

      headWorld.project(camera);
      hpWorld.project(camera);

      const rawCx = (headWorld.x * 0.5 + 0.5) * size.width;
      const rawTopY = (-headWorld.y * 0.5 + 0.5) * size.height;
      const rawBaseY = (-hpWorld.y * 0.5 + 0.5) * size.height;

      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const cx = Number.isFinite(rawCx) ? clamp(rawCx, 0, size.width) : size.width * 0.5;
      const topY = Number.isFinite(rawTopY) ? clamp(rawTopY, 0, size.height) : size.height * 0.15;
      const baseY = Number.isFinite(rawBaseY) ? clamp(rawBaseY, 0, size.height) : size.height * 0.2;

      onScreenBounds({ cx, topY, baseY, rs: 1 });
    }
  });

  // Initial facing yaw (for static JSX initial values)
  const initFacing = facingRef ? facingRef.current : facing;
  const facingYaw = initFacing ? Math.atan2(initFacing.x, initFacing.y) : 0;

  return (
    <group ref={groupRef} position={[threeX, threeY, threeZ]}>
      {/* Body cylinder — rotation driven by useFrame */}
      <mesh ref={bodyRef} position={[0, CHAR_HEIGHT / 2, 0]} castShadow rotation={[0, facingYaw, 0]} onPointerDown={handleSelect}>
        <cylinderGeometry args={[CHAR_RADIUS, CHAR_RADIUS * 0.9, CHAR_HEIGHT, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={isMe ? 0.4 : 0.15}
          roughness={0.6}
          metalness={0.1}
        />
      </mesh>

      {/* Top cap highlight */}
      <mesh position={[0, CHAR_HEIGHT + 0.02, 0]} onPointerDown={handleSelect}>
        <cylinderGeometry args={[CHAR_RADIUS * 0.95, CHAR_RADIUS * 0.95, 0.06, 16]} />
        <meshStandardMaterial
          color={isMe ? '#aaccff' : '#ff9999'}
          emissive={isMe ? '#6699ff' : '#ff5555'}
          emissiveIntensity={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* Shadow blob on ground */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[CHAR_RADIUS * 1.4, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
      </mesh>



      {/* Selected enemy glow */}
      {isSelected && !isMe && (
        <mesh position={[0, CHAR_HEIGHT / 2, 0]} onPointerDown={handleSelect}>
          <cylinderGeometry args={[CHAR_RADIUS + 0.12, CHAR_RADIUS * 0.9 + 0.12, CHAR_HEIGHT + 0.15, 16]} />
          <meshBasicMaterial color="#ff4444" transparent opacity={0.25} side={THREE.BackSide} />
        </mesh>
      )}

      {/* HP bar + name — all in one billboard group (same 3D system = same scale rules) */}
      {showHpBar && (
        <group ref={hpGroupRef} position={[0, CHAR_HEIGHT + 0.7, 0]}>
          {/* Enemy name — Text from drei, above bar */}
          {username && !isMe && (
            <Text
              position={[0, 0.32, 0]}
              fontSize={0.28}
              color={isSelected ? '#ff99bb' : '#ff3333'}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.025}
              outlineColor="#000000"
              material-toneMapped={false}
            >
              {isSelected && distance !== undefined ? `${username} · ${distance.toFixed(1)}尺` : username}
            </Text>
          )}
          {/* Thin black border */}
          <sprite scale={[2.86, 0.274, 1]} renderOrder={0}>
            <spriteMaterial color="#000000" depthTest={false} depthWrite={false} toneMapped={false} />
          </sprite>
          {/* Background */}
          <sprite scale={[2.8, 0.224, 1]} renderOrder={1}>
            <spriteMaterial color="#222222" transparent opacity={0.9} depthTest={false} depthWrite={false} toneMapped={false} />
          </sprite>
          {/* Colored fill */}
          <sprite position={[(hpPct - 1) * 1.4, 0, 0]} scale={[2.8 * hpPct, 0.182, 1]} renderOrder={2}>
            <spriteMaterial color={hpColor} depthTest={false} depthWrite={false} toneMapped={false} />
          </sprite>
        </group>
      )}

      {/* Facing arc — only shown when selected, updated by useFrame */}
      {(facing || facingRef) && isSelected && (
        <>
          {/* Fill */}
          <mesh
            ref={arcRef}
            position={[Math.sin(facingYaw) * 0.8, 0.04, Math.cos(facingYaw) * 0.8]}
            rotation={new THREE.Euler(-Math.PI / 2, facingYaw, 0, 'YXZ')}
          >
            <circleGeometry args={[2.4, 32, -Math.PI, Math.PI]} />
            <meshBasicMaterial color="#ff6600" transparent opacity={0.38} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* Lighter border ring with glow */}
          <mesh
            ref={arcBorderRef}
            position={[Math.sin(facingYaw) * 0.8, 0.04, Math.cos(facingYaw) * 0.8]}
            rotation={new THREE.Euler(-Math.PI / 2, facingYaw, 0, 'YXZ')}
          >
            <ringGeometry args={[2.28, 2.42, 48, 1, -Math.PI, Math.PI]} />
            <meshBasicMaterial color="#ffee00" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
          {/* Outer glow ring */}
          <mesh
            ref={arcGlowRef}
            position={[Math.sin(facingYaw) * 0.8, 0.035, Math.cos(facingYaw) * 0.8]}
            rotation={new THREE.Euler(-Math.PI / 2, facingYaw, 0, 'YXZ')}
          >
            <ringGeometry args={[2.18, 2.52, 48, 1, -Math.PI, Math.PI]} />
            <meshBasicMaterial color="#ffdd44" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
