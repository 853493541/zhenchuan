'use client';

import { useRef, MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface CameraRigProps {
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z: number }>;
  camYawRef: MutableRefObject<number>;
  camPitchRef: MutableRefObject<number>;
  camZoomRef: MutableRefObject<number>;
  worldHalf: number;
}

const CAM_DIST_BACK = 20;
const CAM_HEIGHT = 10;

export default function CameraRig({
  localRenderPosRef,
  camYawRef,
  camPitchRef,
  camZoomRef,
  worldHalf,
}: CameraRigProps) {
  const { camera } = useThree();

  useFrame(() => {
    const p = localRenderPosRef.current;
    // world: x=right, y=forward, z=up → three: x=right, y=up, z=back
    const px = p.x - worldHalf;
    const py = p.z; // player height in Three.js y
    const pz = p.y - worldHalf; // player forward in Three.js z

    const pitch = camPitchRef.current;
    const yaw = camYawRef.current;
    const zoom = camZoomRef.current;

    const distBack = CAM_DIST_BACK * zoom * Math.cos(pitch);
    const camH = (CAM_DIST_BACK * zoom * Math.sin(pitch)) + CAM_HEIGHT * 0.3;

    // Camera sits directly behind player — no extra lerp (localRenderPosRef is already smooth)
    const camX = px - Math.sin(yaw) * distBack;
    const camZ = pz - Math.cos(yaw) * distBack;
    camera.position.set(camX, py + camH, camZ);

    // Look slightly ahead of player
    const lookX = px + Math.sin(yaw) * 4;
    const lookZ = pz + Math.cos(yaw) * 4;
    camera.lookAt(lookX, py + 1.0, lookZ);
  });

  return null;
}
