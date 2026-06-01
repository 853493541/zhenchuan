'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXPORTED_MAP_DATA_PATH, RENDER_SF_XZ, RENDER_SF_Y } from './ExportedMapScene';

type FakeDisguisePoint = {
  x: number;
  y: number;
  z: number;
};

type FakeDisguisePlacement = FakeDisguisePoint & {
  glbName: string;
  yaw: number;
};

const MIN_FAKE_DISGUISE_COUNT = 5;
const FAKE_DISGUISE_APPEAR_DELAY_MS = 20_000;
const DISGUISE_GLB_NAMES = [
  'wj_木车002_hd.glb',
  'pj_玉门草棚001_hd.glb',
  'wj_坛子001_001_hd.glb',
] as const;
const FAKE_DISGUISE_POINTS: FakeDisguisePoint[] = [
  { x: 213.77, y: 229.32, z: 0.38 },
  { x: 224.04, y: 197.71, z: 0.27 },
  { x: 232.47, y: 165.22, z: 0.16 },
  { x: 184.84, y: 119.17, z: 20.15 },
  { x: 187.4, y: 126.91, z: 1.05 },
  { x: 93.37, y: 121.35, z: 4.74 },
  { x: 23.23, y: 210.16, z: 21.36 },
  { x: 55.64, y: 271.76, z: 23.4 },
  { x: 146.67, y: 239.0, z: 15.98 },
  { x: 345.98, y: 255.35, z: 97.63 },
  { x: 314.76, y: 139.25, z: 62.87 },
  { x: 243.49, y: 142.56, z: 16.0 },
  { x: 138.94, y: 168.15, z: 10.47 },
  { x: 117.24, y: 227.23, z: 0.29 },
  { x: 117.53, y: 223.6, z: 0.27 },
  { x: 105.68, y: 209.65, z: -0.18 },
];

const DISGUISE_TEXTURE_MAP_URL = `${EXPORTED_MAP_DATA_PATH}/texture-map.json`;
const disguisePrototypePromises = new Map<string, Promise<THREE.Group>>();
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

function loadDisguiseGltf(loader: GLTFLoader, glbName: string): Promise<any> {
  return new Promise((resolve, reject) => {
    loader.load(`${EXPORTED_MAP_DATA_PATH}/meshes/${encodeURIComponent(glbName)}`, resolve, undefined, reject);
  });
}

async function loadDisguiseTextureInfo(glbName: string): Promise<any | null> {
  try {
    const response = await fetch(DISGUISE_TEXTURE_MAP_URL);
    if (!response.ok) return null;
    const textureMap = await response.json();
    return textureMap?.[glbName] ?? null;
  } catch {
    return null;
  }
}

function applyDisguiseModelTextureMaterials(scene: THREE.Group, textureInfo: any | null) {
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

function loadDisguisePrototype(glbName: string): Promise<THREE.Group> {
  const existing = disguisePrototypePromises.get(glbName);
  if (existing) return existing;

  const loader = new GLTFLoader();
  const promise = Promise.all([
    loadDisguiseGltf(loader, glbName),
    loadDisguiseTextureInfo(glbName),
  ]).then(([gltf, textureInfo]) => {
    const scene = gltf.scene as THREE.Group;
    applyDisguiseModelTextureMaterials(scene, textureInfo);
    return scene;
  });
  disguisePrototypePromises.set(glbName, promise);
  return promise;
}

function cloneDisguiseModel(prototype: THREE.Group): THREE.Group {
  const model = prototype.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.scale.set(RENDER_SF_XZ, RENDER_SF_Y, RENDER_SF_XZ);
  model.position.set(-center.x * RENDER_SF_XZ, -box.min.y * RENDER_SF_Y, -center.z * RENDER_SF_XZ);
  model.traverse((child: any) => {
    if (!child?.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;
    child.raycast = () => null;
  });
  return model;
}

function pickFakeDisguisePlacements(): FakeDisguisePlacement[] {
  const shuffled = [...FAKE_DISGUISE_POINTS];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  const maxCount = shuffled.length;
  const count = Math.floor(Math.random() * (maxCount - MIN_FAKE_DISGUISE_COUNT + 1)) + MIN_FAKE_DISGUISE_COUNT;
  return shuffled.slice(0, count).map((point) => ({
    ...point,
    glbName: DISGUISE_GLB_NAMES[Math.floor(Math.random() * DISGUISE_GLB_NAMES.length)],
    yaw: Math.random() * Math.PI * 2,
  }));
}

function FakeDisguiseProp({
  worldHalfX,
  worldHalfY,
  placement,
}: {
  worldHalfX: number;
  worldHalfY: number;
  placement: FakeDisguisePlacement;
}) {
  const [model, setModel] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDisguisePrototype(placement.glbName)
      .then((prototype) => {
        if (!cancelled) setModel(cloneDisguiseModel(prototype));
      })
      .catch(() => {
        if (!cancelled) setModel(null);
      });
    return () => { cancelled = true; };
  }, [placement.glbName]);

  if (!model) return null;

  return (
    <primitive
      object={model}
      position={[placement.x - worldHalfX, placement.z, worldHalfY - placement.y]}
      rotation={[0, placement.yaw, 0]}
    />
  );
}

export default function FakeDisguiseProps({
  worldHalfX,
  worldHalfY,
  modeKey,
}: {
  worldHalfX: number;
  worldHalfY: number;
  modeKey: string;
}) {
  const placements = useMemo(() => pickFakeDisguisePlacements(), [modeKey]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    const timeoutId = window.setTimeout(() => setVisible(true), FAKE_DISGUISE_APPEAR_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [modeKey]);

  if (!visible) return null;

  return (
    <group>
      {placements.map((placement, index) => (
        <FakeDisguiseProp
          key={`${placement.x}:${placement.y}:${placement.z}:${placement.glbName}:${index}`}
          worldHalfX={worldHalfX}
          worldHalfY={worldHalfY}
          placement={placement}
        />
      ))}
    </group>
  );
}