'use client';

import { useEffect, useRef, useState, MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXPORTED_MAP_DATA_PATH, RENDER_SF } from './ExportedMapScene';

const CHAR_RADIUS = 0.42;
const CHAR_HEIGHT = 1.5;
const FACING_ARC_RADIUS = 7;
const FACING_ARC_CENTER_OFFSET = CHAR_RADIUS + 0.06;
const FACING_ARC_BORDER_INNER_RADIUS = FACING_ARC_RADIUS - 0.16;
const FACING_ARC_BORDER_OUTER_RADIUS = FACING_ARC_RADIUS + 0.02;
const FACING_ARC_GLOW_INNER_RADIUS = FACING_ARC_RADIUS - 0.28;
const FACING_ARC_GLOW_OUTER_RADIUS = FACING_ARC_RADIUS + 0.16;
/** Camera distance at which the HP bar has scale=1 (matches default camera offset) */
const HP_REF_DIST = 20;
const _hpWorldPos = new THREE.Vector3();
const _bodyWorldPos = new THREE.Vector3();
const SELF_HIDE_DISTANCE = CHAR_HEIGHT;
const SELF_FADE_DISTANCE = CHAR_HEIGHT * 1.8;
const OPPONENT_VERTICAL_BLINK_THRESHOLD = 4;
const DISGUISE_CART_GLB_NAME = 'wj_木车002_hd.glb';
const DISGUISE_CART_GLB_URL = `${EXPORTED_MAP_DATA_PATH}/meshes/${encodeURIComponent(DISGUISE_CART_GLB_NAME)}`;
const DISGUISE_TEXTURE_MAP_URL = `${EXPORTED_MAP_DATA_PATH}/texture-map.json`;
let disguiseCartPrototypePromise: Promise<THREE.Group> | null = null;
const disguiseTextureLoader = new THREE.TextureLoader();
const disguiseTextureCache = new Map<string, THREE.Texture>();

function loadDisguiseTextureCached(pngName: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  const key = `${pngName}:${colorSpace}`;
  if (!disguiseTextureCache.has(key)) {
    const tex = disguiseTextureLoader.load(`${EXPORTED_MAP_DATA_PATH}/textures/${encodeURIComponent(pngName)}`);
    tex.colorSpace = colorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    disguiseTextureCache.set(key, tex);
  }
  return disguiseTextureCache.get(key)!;
}

function loadDisguiseMRECached(pngName: string): THREE.Texture {
  const key = `${pngName}:mre`;
  if (!disguiseTextureCache.has(key)) {
    const tex = disguiseTextureLoader.load(
      `${EXPORTED_MAP_DATA_PATH}/textures/${encodeURIComponent(pngName)}`,
      (loaded) => {
        const img = loaded.image as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < data.data.length; index += 4) {
          const red = data.data[index];
          data.data[index] = data.data[index + 2];
          data.data[index + 2] = red;
        }
        ctx.putImageData(data, 0, 0);
        loaded.image = canvas;
        loaded.needsUpdate = true;
      },
    );
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    disguiseTextureCache.set(key, tex);
  }
  return disguiseTextureCache.get(key)!;
}

function loadDisguiseCartGltf(loader: GLTFLoader): Promise<any> {
  return new Promise((resolve, reject) => {
    loader.load(DISGUISE_CART_GLB_URL, resolve, undefined, reject);
  });
}

async function loadDisguiseCartTextureInfo(): Promise<any | null> {
  try {
    const response = await fetch(DISGUISE_TEXTURE_MAP_URL);
    if (!response.ok) return null;
    const textureMap = await response.json();
    return textureMap?.[DISGUISE_CART_GLB_NAME] ?? null;
  } catch {
    return null;
  }
}

function applyDisguiseCartTextureMaterials(scene: THREE.Group, textureInfo: any | null) {
  const subsetTextures = Array.isArray(textureInfo?.subsets) ? textureInfo.subsets : null;
  let meshIndex = 0;
  scene.traverse((child: any) => {
    if (!child?.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    const geometry = child.geometry as THREE.BufferGeometry | undefined;
    const subTex = subsetTextures && meshIndex < subsetTextures.length
      ? subsetTextures[meshIndex]
      : textureInfo;
    const hasColors = !!geometry?.hasAttribute?.('color');
    const materialOptions: any = {
      color: hasColors ? 0xffffff : 0xccbbaa,
      vertexColors: hasColors,
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.DoubleSide,
    };

    if (subTex) {
      if (subTex.albedo) {
        materialOptions.map = loadDisguiseTextureCached(subTex.albedo, THREE.SRGBColorSpace);
        materialOptions.color = 0xffffff;
        materialOptions.vertexColors = false;
      }
      if (subTex.mre) {
        const mreTex = loadDisguiseMRECached(subTex.mre);
        materialOptions.roughnessMap = mreTex;
        materialOptions.metalnessMap = mreTex;
        materialOptions.roughness = 1.0;
        materialOptions.metalness = 1.0;
      }
      if (subTex.normal) {
        materialOptions.normalMap = loadDisguiseTextureCached(subTex.normal, THREE.LinearSRGBColorSpace);
        materialOptions.normalScale = new THREE.Vector2(1, -1);
      }
      const blendMode = subTex.blendMode || textureInfo?.blendMode || 0;
      if (blendMode === 1 && materialOptions.map) {
        const alphaRef = subTex.alphaRef != null ? subTex.alphaRef : 128;
        materialOptions.alphaTest = alphaRef / 255;
        materialOptions.transparent = false;
      } else if (blendMode === 2 && materialOptions.map) {
        materialOptions.transparent = true;
        materialOptions.blending = THREE.AdditiveBlending;
        materialOptions.depthWrite = false;
      }
    }

    child.material = new THREE.MeshStandardMaterial(materialOptions);
    meshIndex += 1;
  });
}

function computeHpShieldSegments(hp: number, shield: number, maxHp: number): { hpPct: number; shieldPct: number } {
  const safeMaxHp = Math.max(1, Number(maxHp || 100));
  const safeHp = Math.max(0, Number(hp || 0));
  const safeShield = Math.max(0, Number(shield || 0));
  const total = safeHp + safeShield;

  if (total <= 0) return { hpPct: 0, shieldPct: 0 };

  if (total <= safeMaxHp) {
    return {
      hpPct: Math.max(0, Math.min(1, safeHp / safeMaxHp)),
      shieldPct: Math.max(0, Math.min(1, safeShield / safeMaxHp)),
    };
  }

  return {
    hpPct: Math.max(0, Math.min(1, safeHp / total)),
    shieldPct: Math.max(0, Math.min(1, safeShield / total)),
  };
}

function loadDisguiseCartPrototype(): Promise<THREE.Group> {
  if (!disguiseCartPrototypePromise) {
    const loader = new GLTFLoader();
    disguiseCartPrototypePromise = Promise.all([
      loadDisguiseCartGltf(loader),
      loadDisguiseCartTextureInfo(),
    ]).then(([gltf, textureInfo]) => {
      const scene = gltf.scene as THREE.Group;
      applyDisguiseCartTextureMaterials(scene, textureInfo);
      return scene;
    });
  }
  return disguiseCartPrototypePromise;
}

function cloneDisguiseCartModel(prototype: THREE.Group): THREE.Group {
  const model = prototype.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.scale.setScalar(RENDER_SF);
  model.position.set(-center.x * RENDER_SF, -box.min.y * RENDER_SF, -center.z * RENDER_SF);
  model.traverse((child: any) => {
    if (!child?.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return model;
}

function DisguiseCartModel({ facingYaw }: { facingYaw: number }) {
  const [model, setModel] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDisguiseCartPrototype()
      .then((prototype) => {
        if (!cancelled) setModel(cloneDisguiseCartModel(prototype));
      })
      .catch(() => {
        if (!cancelled) setModel(null);
      });
    return () => { cancelled = true; };
  }, []);

  if (!model) {
    return (
      <mesh position={[0, 0.35, 0]} rotation={[0, facingYaw, 0]} castShadow>
        <boxGeometry args={[1.25, 0.7, 0.85]} />
        <meshStandardMaterial color="#7a6042" roughness={0.8} metalness={0.05} />
      </mesh>
    );
  }

  return <primitive object={model} rotation={[0, facingYaw, 0]} />;
}

interface CharacterProps {
  worldX: number;
  worldY: number;
  worldZ: number;
  color: string;
  emissive: string;
  hp: number;
  shield?: number;
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
  worldHalfX: number;
  worldHalfY: number;
  /** Visual-only stealth state: model becomes semi-transparent (HP UI unchanged). */
  isStealthed?: boolean;
  /** Hide the HP/name billboard for enemy-view special cases. */
  hideHpBar?: boolean;
  /** Replace the character with the exported-map cart mesh for 砂石伪装. */
  isDisguised?: boolean;
  cameraFadeEnabled?: boolean;
  hpColorOverride?: string;
  instantSnapAtRef?: MutableRefObject<number>;
  instantSnapWindowMs?: number;
}

export default function Character({
  worldX,
  worldY,
  worldZ,
  color,
  emissive,
  hp,
  shield = 0,
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
  worldHalfX,
  worldHalfY,
  isStealthed = false,
  hideHpBar = false,
  isDisguised = false,
  cameraFadeEnabled = false,
  hpColorOverride,
  instantSnapAtRef,
  instantSnapWindowMs = 0,
}: CharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const capRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const arcRef = useRef<THREE.Mesh>(null);
  const arcBorderRef = useRef<THREE.Mesh>(null);
  const arcGlowRef = useRef<THREE.Mesh>(null);
  const hpGroupRef = useRef<THREE.Group>(null);
  /** Smoothed display yaw for the arc — lags behind actual facing for visual animation */
  const arcDisplayYawRef = useRef(0);
  const { camera, size } = useThree();

  // Show HP bar: always for self, within 60 units for others, unless hidden by a special state.
  const showHpBar = !hideHpBar && (isMe || (distance !== undefined && distance <= 60));

  const handleSelect = (e: any) => {
    if (!onSelect) return;
    e.stopPropagation();
    onSelect();
  };

  const healthPct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
  const hpShieldSegments = computeHpShieldSegments(hp, shield, maxHp);
  const hpPct = hpShieldSegments.hpPct;
  const shieldPct = hpShieldSegments.shieldPct;
  const hpColor = hpColorOverride ?? (
    isMe
      ? '#3399ff'
      : isSelected
      ? '#ff8888'
      : (healthPct > 0.5 ? '#dd2222' : healthPct > 0.25 ? '#cc1111' : '#991111')
  );

  const threeX = worldX - worldHalfX;
  const threeY = worldZ;
  const threeZ = worldHalfY - worldY;

  // For opponent (no posRef): smooth lerp toward prop position
  const currentPos = useRef(new THREE.Vector3(threeX, threeY, threeZ));

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // --- Position ---
    if (posRef) {
      // Local player: posRef is already smoothed by the rAF loop in BattleArena.
      // Copy directly — NO additional lerp (avoids sluggish double-smoothing).
      const p = posRef.current;
      groupRef.current.position.set(p.x - worldHalfX, p.z, worldHalfY - p.y);
    } else {
      // Opponent: smooth lerp toward prop-driven position
      const tx = worldX - worldHalfX;
      const ty = worldZ;
      const tz = worldHalfY - worldY;
      const shouldInstantSnap =
        !!instantSnapAtRef &&
        instantSnapWindowMs > 0 &&
        performance.now() - instantSnapAtRef.current < instantSnapWindowMs;
      const shouldVerticalBlink = Math.abs(ty - currentPos.current.y) >= OPPONENT_VERTICAL_BLINK_THRESHOLD;
      if (shouldInstantSnap || shouldVerticalBlink) {
        currentPos.current.set(tx, ty, tz);
      } else {
        currentPos.current.lerp(new THREE.Vector3(tx, ty, tz), 0.18);
      }
      groupRef.current.position.copy(currentPos.current);
    }

    // --- Facing rotation (updated every frame) ---
    const f = facingRef ? facingRef.current : facing;
    if (f && bodyRef.current) {
      const yaw = Math.atan2(f.x, -f.y); // z-flip: negate game-y for correct Three.js facing
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
        arcRef.current.position.set(
          Math.sin(arcYaw) * FACING_ARC_CENTER_OFFSET,
          0.04,
          Math.cos(arcYaw) * FACING_ARC_CENTER_OFFSET,
        );
        arcRef.current.rotation.order = 'YXZ';
        arcRef.current.rotation.set(-Math.PI / 2, arcYaw, 0);
      }
      if (arcBorderRef.current) {
        arcBorderRef.current.position.set(
          Math.sin(arcYaw) * FACING_ARC_CENTER_OFFSET,
          0.04,
          Math.cos(arcYaw) * FACING_ARC_CENTER_OFFSET,
        );
        arcBorderRef.current.rotation.order = 'YXZ';
        arcBorderRef.current.rotation.set(-Math.PI / 2, arcYaw, 0);
      }
      if (arcGlowRef.current) {
        arcGlowRef.current.position.set(
          Math.sin(arcYaw) * FACING_ARC_CENTER_OFFSET,
          0.035,
          Math.cos(arcYaw) * FACING_ARC_CENTER_OFFSET,
        );
        arcGlowRef.current.rotation.order = 'YXZ';
        arcGlowRef.current.rotation.set(-Math.PI / 2, arcYaw, 0);
      }
    }

    const visualAlpha = cameraFadeEnabled && isMe
      ? THREE.MathUtils.clamp(
          (camera.position.distanceTo(
            _bodyWorldPos.set(
              groupRef.current.position.x,
              groupRef.current.position.y + CHAR_HEIGHT * 0.55,
              groupRef.current.position.z,
            ),
          ) - SELF_HIDE_DISTANCE) / (SELF_FADE_DISTANCE - SELF_HIDE_DISTANCE),
          0,
          1,
        )
      : 1;

    if (bodyRef.current) {
      bodyRef.current.visible = visualAlpha > 0.01;
      const bodyMaterial = bodyRef.current.material as THREE.MeshStandardMaterial;
      bodyMaterial.opacity = (isStealthed && !isDisguised ? 0.45 : 1) * visualAlpha;
      bodyMaterial.depthWrite = !(isStealthed && !isDisguised) && visualAlpha > 0.05;
    }

    if (capRef.current) {
      capRef.current.visible = visualAlpha > 0.01;
      const capMaterial = capRef.current.material as THREE.MeshStandardMaterial;
      capMaterial.opacity = (isStealthed && !isDisguised ? 0.45 : 1) * visualAlpha;
      capMaterial.depthWrite = !(isStealthed && !isDisguised) && visualAlpha > 0.05;
    }

    if (shadowRef.current) {
      shadowRef.current.visible = visualAlpha > 0.01;
      const shadowMaterial = shadowRef.current.material as THREE.MeshBasicMaterial;
      shadowMaterial.opacity = 0.3 * visualAlpha;
    }

    // --- Billboard HP bar: always face camera, fixed screen size ---
    if (hpGroupRef.current) {
      hpGroupRef.current.visible = showHpBar && visualAlpha > 0.02;
      hpGroupRef.current.quaternion.copy(camera.quaternion);
      if (hpGroupRef.current.visible) {
        // Scale inversely with distance so on-screen size stays constant
        hpGroupRef.current.getWorldPosition(_hpWorldPos);
        const camDist = camera.position.distanceTo(_hpWorldPos);
        const s = camDist / HP_REF_DIST;
        hpGroupRef.current.scale.setScalar(s);
      }
    }

    if (arcRef.current) {
      arcRef.current.visible = visualAlpha > 0.02;
    }
    if (arcBorderRef.current) {
      arcBorderRef.current.visible = visualAlpha > 0.02;
    }
    if (arcGlowRef.current) {
      arcGlowRef.current.visible = visualAlpha > 0.02;
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
  const facingYaw = initFacing ? Math.atan2(initFacing.x, -initFacing.y) : 0;

  return (
    <group ref={groupRef} position={[threeX, threeY, threeZ]}>
      {isDisguised ? (
        <>
          <DisguiseCartModel facingYaw={facingYaw} />
          <mesh ref={shadowRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.95, 20]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.24} depthWrite={false} />
          </mesh>
        </>
      ) : (
        <>
          {/* Body cylinder — rotation driven by useFrame */}
          <mesh ref={bodyRef} position={[0, CHAR_HEIGHT / 2, 0]} castShadow rotation={[0, facingYaw, 0]} onPointerDown={handleSelect}>
            <cylinderGeometry args={[CHAR_RADIUS, CHAR_RADIUS * 0.9, CHAR_HEIGHT, 16]} />
            <meshStandardMaterial
              color={color}
              emissive={emissive}
              emissiveIntensity={isMe ? 0.4 : 0.15}
              roughness={0.6}
              metalness={0.1}
              transparent
              opacity={isStealthed ? 0.45 : 1}
              depthWrite={!isStealthed}
            />
          </mesh>

          {/* Top cap highlight */}
          <mesh ref={capRef} position={[0, CHAR_HEIGHT + 0.02, 0]} onPointerDown={handleSelect}>
            <cylinderGeometry args={[CHAR_RADIUS * 0.95, CHAR_RADIUS * 0.95, 0.06, 16]} />
            <meshStandardMaterial
              color={isMe ? '#aaccff' : '#ff9999'}
              emissive={isMe ? '#6699ff' : '#ff5555'}
              emissiveIntensity={0.7}
              roughness={0.3}
              transparent
              opacity={isStealthed ? 0.45 : 1}
              depthWrite={!isStealthed}
            />
          </mesh>

          {/* Shadow blob on ground */}
          <mesh ref={shadowRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[CHAR_RADIUS * 1.4, 16]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </>
      )}



      {/* Selected enemy glow */}
      {isSelected && !isMe && !isDisguised && (
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
              color={hpColorOverride ?? (isSelected ? '#ff99bb' : '#ff3333')}
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
          )}
          {/* Thin black border */}
          <sprite scale={[2.86, 0.274, 1]} renderOrder={0}>
            <spriteMaterial color="#000000" depthTest={true} depthWrite={false} toneMapped={false} />
          </sprite>
          {/* Background */}
          <sprite scale={[2.8, 0.224, 1]} renderOrder={1}>
            <spriteMaterial color="#222222" transparent opacity={0.9} depthTest={true} depthWrite={false} toneMapped={false} />
          </sprite>
          {/* Colored fill */}
          <sprite position={[(hpPct - 1) * 1.4, 0, 0]} scale={[2.8 * hpPct, 0.182, 1]} renderOrder={2}>
            <spriteMaterial color={hpColor} depthTest={true} depthWrite={false} toneMapped={false} />
          </sprite>
          {/* Shield fill segment */}
          {shieldPct > 0 && (
            <sprite position={[-1.4 + (2.8 * hpPct) + (2.8 * shieldPct * 0.5), 0, 0]} scale={[2.8 * shieldPct, 0.182, 1]} renderOrder={3}>
              <spriteMaterial color="#f0f6ff" depthTest={true} depthWrite={false} toneMapped={false} />
            </sprite>
          )}
        </group>
      )}

      {/* Facing arc — only shown when selected, updated by useFrame */}
      {(facing || facingRef) && isSelected && !isDisguised && (
        <>
          {/* Fill */}
          <mesh
            ref={arcRef}
            position={[
              Math.sin(facingYaw) * FACING_ARC_CENTER_OFFSET,
              0.04,
              Math.cos(facingYaw) * FACING_ARC_CENTER_OFFSET,
            ]}
            rotation={new THREE.Euler(-Math.PI / 2, facingYaw, 0, 'YXZ')}
          >
            <circleGeometry args={[FACING_ARC_RADIUS, 64, -Math.PI, Math.PI]} />
            <meshBasicMaterial color="#ff6600" transparent opacity={0.38} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
          </mesh>
          {/* Lighter border ring with glow */}
          <mesh
            ref={arcBorderRef}
            position={[
              Math.sin(facingYaw) * FACING_ARC_CENTER_OFFSET,
              0.04,
              Math.cos(facingYaw) * FACING_ARC_CENTER_OFFSET,
            ]}
            rotation={new THREE.Euler(-Math.PI / 2, facingYaw, 0, 'YXZ')}
          >
            <ringGeometry args={[FACING_ARC_BORDER_INNER_RADIUS, FACING_ARC_BORDER_OUTER_RADIUS, 64, 1, -Math.PI, Math.PI]} />
            <meshBasicMaterial color="#ffee00" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
          </mesh>
          {/* Outer glow ring */}
          <mesh
            ref={arcGlowRef}
            position={[
              Math.sin(facingYaw) * FACING_ARC_CENTER_OFFSET,
              0.035,
              Math.cos(facingYaw) * FACING_ARC_CENTER_OFFSET,
            ]}
            rotation={new THREE.Euler(-Math.PI / 2, facingYaw, 0, 'YXZ')}
          >
            <ringGeometry args={[FACING_ARC_GLOW_INNER_RADIUS, FACING_ARC_GLOW_OUTER_RADIUS, 64, 1, -Math.PI, Math.PI]} />
            <meshBasicMaterial color="#ffdd44" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
