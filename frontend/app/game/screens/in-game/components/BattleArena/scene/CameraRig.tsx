'use client';

import { useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MapCollisionSystem } from './MapCollisionSystem';
import { GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z, RENDER_SF } from './ExportedMapScene';

interface CameraRigProps {
  localRenderPosRef: MutableRefObject<{ x: number; y: number; z: number }>;
  camYawRef: MutableRefObject<number>;
  camPitchRef: MutableRefObject<number>;
  camZoomRef: MutableRefObject<number>;
  moveCommandActiveRef?: MutableRefObject<boolean>;
  cameraLookInputVersionRef?: MutableRefObject<number>;
  manualCameraLookActiveRef?: MutableRefObject<boolean>;
  onCameraDebugEvent?: (entry: {
    type: string;
    message: string;
    camera: { x: number; y: number; z: number };
    lookTarget: { x: number; y: number; z: number };
    pivot: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    zoom: number;
    desiredDistance: number;
    actualDistance: number;
    wallClamp: boolean;
    probeClamp: boolean;
    groundClamp: boolean;
    recenter: boolean;
    wallDebug?: {
      hitCount: number;
      sampleCount: number;
      hitMask: string;
      spanX: number;
      spanY: number;
      minDistance: number | null;
      maxDistance: number | null;
      rawDistance: number | null;
      retainedDistance: number | null;
      clearMs: number;
      pendingExpandDistance: number | null;
      pendingExpandMs: number;
    };
    probeDebug?: {
      hitCount: number;
      sampleCount: number;
      hitMask: string;
      minDistance: number | null;
      maxDistance: number | null;
      rawDistance: number | null;
      retainedDistance: number | null;
    };
  }) => void;
  worldHalfX: number;
  worldHalfY: number;
  collisionSystemRef?: MutableRefObject<MapCollisionSystem | null>;
}

type CollisionZoomDirection = -1 | 0 | 1;

const CAM_DIST_BACK = 20;
const CAMERA_PIVOT_HEIGHT = 1.25;
const LOOK_FORWARD_DIST = 4.5;
const LOOK_FORWARD_WHEN_UP = 0.9;
const LOOK_UP_HEIGHT = 18;
const LOOK_UP_OVERFLOW_RANGE = 4;
const CAMERA_WALL_PADDING = 0.45;
const CAMERA_MIN_DISTANCE = 0.08;
const CAMERA_GROUND_CLEARANCE = 0.12;
const CAMERA_GROUND_PROBE_RISE = 0.8;
const AVATAR_HIDDEN_NEAR_DISTANCE = 1.5;
const LOOK_UP_LOWERING_SCALE = 0.35;
const CAMERA_PROBE_SIDE = 0.55;
const CAMERA_PROBE_UP = 0.36;
const CAMERA_PROBE_DOWN = 0.24;
const CAMERA_CLOSE_FOCUS_RANGE = 3.5;
const CAMERA_STATE_EPSILON = 0.05;
const CAMERA_DISTANCE_SETTLE_EPSILON = 0.035;
const CAMERA_COLLISION_DIRECTION_EPSILON = 0.04;
const CAMERA_COLLISION_ZOOM_IN_SPEED = 8;
const CAMERA_COLLISION_BLOCKED_ZOOM_OUT_SPEED = 0.8;
const CAMERA_COLLISION_RELEASE_ZOOM_OUT_SPEED = 2.1;
const CAMERA_COLLISION_REVERSE_ZOOM_IN_SPEED = 3.2;
const CAMERA_COLLISION_DIRECTION_CHANGE_COOLDOWN_MS = 260;
const CAMERA_WALL_CLAMP_RELEASE_HOLD_MS = 220;
const CAMERA_WALL_DISTANCE_SHRINK_SPEED = 8;
const CAMERA_WALL_DISTANCE_GROW_SPEED = 0.6;
const CAMERA_WALL_DISTANCE_EXPAND_HOLD_MS = 520;
const CAMERA_WALL_DISTANCE_EXPAND_MIN_DELTA = 0.55;
const CAMERA_WALL_DISTANCE_EXPAND_TARGET_EPSILON = 0.3;
const CAMERA_WALL_SUPPORT_SIDE = 0.78;
const CAMERA_WALL_SUPPORT_UP = 0.56;
const CAMERA_WALL_SUPPORT_DOWN = 0.42;
const CAMERA_WALL_MIN_RELIABLE_HITS = 5;
const CAMERA_WALL_RELIABLE_HIT_INDEX = 4;
const CAMERA_WALL_MIN_REDUCTION = 0.6;
const CAMERA_WALL_MIN_HORIZONTAL_SPAN = 1.0;
const CAMERA_PROBE_CLAMP_ENTER_DELTA = 0.16;
const CAMERA_PROBE_CLAMP_EXIT_DELTA = 0.07;
const CAMERA_PROBE_CLAMP_ENTER_HOLD_MS = 90;
const CAMERA_PROBE_CLAMP_EXIT_HOLD_MS = 160;
const CAMERA_GROUND_CLAMP_ENTER_RATIO = 0.08;
const CAMERA_GROUND_CLAMP_EXIT_RATIO = 0.035;
const CAMERA_GROUND_CLAMP_MAX_ABOVE_PLAYER = 1.2;
const CAMERA_PROBE_MIN_RELIABLE_HITS = 2;
const CAMERA_PROBE_RELIABLE_HIT_INDEX = 1;
const CAMERA_PROBE_MIN_REDUCTION = 0.28;
const CAMERA_PROBE_DISTANCE_SHRINK_SPEED = 6;
const CAMERA_PROBE_DISTANCE_GROW_SPEED = 2.5;
const CAMERA_CLOSE_CAMERA_ENTER_DISTANCE = 1.44;
const CAMERA_CLOSE_CAMERA_EXIT_DISTANCE = 1.62;
const CAMERA_SNAP_LOG_DISTANCE = 0.9;
const CAMERA_SNAP_LOG_INTERVAL_MS = 120;

const CAMERA_WALL_SUPPORT_SAMPLES = [
  { label: 'C', x: 0, y: 0 },
  { label: 'R', x: 1, y: 0 },
  { label: 'L', x: -1, y: 0 },
  { label: 'U', x: 0, y: 1 },
  { label: 'D', x: 0, y: -1 },
  { label: 'UR', x: 0.82, y: 0.76 },
  { label: 'UL', x: -0.82, y: 0.76 },
  { label: 'DR', x: 0.82, y: -0.64 },
  { label: 'DL', x: -0.82, y: -0.64 },
] as const;

const CAMERA_PROBE_SAMPLES = [
  { label: 'R', x: 1, y: 0 },
  { label: 'L', x: -1, y: 0 },
  { label: 'U', x: 0, y: 1 },
  { label: 'D', x: 0, y: -1 },
  { label: 'UR', x: 0.82, y: 0.72 },
  { label: 'UL', x: -0.82, y: 0.72 },
  { label: 'DR', x: 0.82, y: -0.58 },
  { label: 'DL', x: -0.82, y: -0.58 },
] as const;

const _pivot = new THREE.Vector3();
const _desiredCamera = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _avatarNdc = new THREE.Vector3();
const _pivotExport = new THREE.Vector3();
const _desiredCameraExport = new THREE.Vector3();
const _cameraDirExport = new THREE.Vector3();
const _centerDirExport = new THREE.Vector3();
const _cameraForwardExport = new THREE.Vector3();
const _cameraRightExport = new THREE.Vector3();
const _cameraUpExport = new THREE.Vector3();
const _probeTargetExport = new THREE.Vector3();
const _probeDirExport = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _targetCamera = new THREE.Vector3();
const _targetCameraDir = new THREE.Vector3();
const _wallAllowedDistances: number[] = [];
const _probeAllowedDistances: number[] = [];

function sceneToExport(scenePos: THREE.Vector3, out: THREE.Vector3) {
  out.set(
    (scenePos.x - GROUP_POS_X) / RENDER_SF,
    (scenePos.y - GROUP_POS_Y) / RENDER_SF,
    (scenePos.z - GROUP_POS_Z) / RENDER_SF,
  );
}

function exportToScene(exportPos: THREE.Vector3, out: THREE.Vector3) {
  out.set(
    exportPos.x * RENDER_SF + GROUP_POS_X,
    exportPos.y * RENDER_SF + GROUP_POS_Y,
    exportPos.z * RENDER_SF + GROUP_POS_Z,
  );
}

export default function CameraRig({
  localRenderPosRef,
  camYawRef,
  camPitchRef,
  camZoomRef,
  moveCommandActiveRef,
  cameraLookInputVersionRef,
  manualCameraLookActiveRef,
  onCameraDebugEvent,
  worldHalfX,
  worldHalfY,
  collisionSystemRef,
}: CameraRigProps) {
  const { camera } = useThree();
  const lastLookInputVersionRef = useRef(-1);
  const recenterLookRef = useRef(false);
  const lastCameraPosRef = useRef(new THREE.Vector3());
  const hasLastCameraPosRef = useRef(false);
  const wallClampActiveRef = useRef(false);
  const probeClampActiveRef = useRef(false);
  const groundClampActiveRef = useRef(false);
  const closeCameraActiveRef = useRef(false);
  const recenterStateRef = useRef(false);
  const lastSnapLogAtRef = useRef(0);
  const lastWallClampHitAtRef = useRef(0);
  const retainedWallClampDistanceSceneRef = useRef<number | null>(null);
  const pendingWallExpandTargetSceneRef = useRef<number | null>(null);
  const pendingWallExpandSinceRef = useRef(0);
  const probeClampPendingStateRef = useRef<boolean | null>(null);
  const probeClampPendingSinceRef = useRef(0);
  const retainedProbeDistanceSceneRef = useRef<number | null>(null);
  const smoothedCameraDistanceRef = useRef(CAM_DIST_BACK);
  const collisionBlendActiveRef = useRef(false);
  const smoothedLookUpRatioRef = useRef(0);
  const lastCollisionZoomDirectionRef = useRef<CollisionZoomDirection>(0);
  const lastCollisionZoomDirectionChangeAtRef = useRef(0);

  useFrame((_, delta) => {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (cameraLookInputVersionRef && cameraLookInputVersionRef.current !== lastLookInputVersionRef.current) {
      lastLookInputVersionRef.current = cameraLookInputVersionRef.current;
      recenterLookRef.current = false;
    }

    const p = localRenderPosRef.current;
    // world: x=right, y=forward, z=up → three: x=right, y=up, z=back
    const px = p.x - worldHalfX;
    const py = p.z; // player height in Three.js y
    const pz = worldHalfY - p.y; // z-flip: game y→Three.js z inverted

    const pitch = camPitchRef.current;
    const yaw = camYawRef.current;
    const zoom = camZoomRef.current;

    const distBack = CAM_DIST_BACK * zoom * Math.cos(pitch);
    const camH = CAM_DIST_BACK * zoom * Math.sin(pitch) * (pitch < 0 ? LOOK_UP_LOWERING_SCALE : 1);
    const desiredDistanceScene = Math.sqrt(distBack * distBack + camH * camH);
    let lookUpRatio = 0;
    let actualClampDistanceScene = desiredDistanceScene;
    let centerClampDistanceScene = desiredDistanceScene;
    let probeClampActive = false;
    let targetWallClampActive = false;
    let rawReliableProbeDistanceScene: number | null = null;
    let rawWallClampDistanceScene: number | null = null;
    let wallHitCount = 0;
    let wallHitMask = '';
    let wallMinDistanceScene: number | null = null;
    let wallMaxDistanceScene: number | null = null;
    let wallMinOffsetX = 0;
    let wallMaxOffsetX = 0;
    let wallMinOffsetY = 0;
    let wallMaxOffsetY = 0;
    let wallLeftHitCount = 0;
    let wallRightHitCount = 0;
    let wallCenterHitCount = 0;
    let probeHitCount = 0;
    let probeHitMask = '';
    let probeMinDistanceScene: number | null = null;
    let probeMaxDistanceScene: number | null = null;

    _pivot.set(px, py + CAMERA_PIVOT_HEIGHT, pz);
    _desiredCamera.set(
      _pivot.x - Math.sin(yaw) * distBack,
      _pivot.y + camH,
      _pivot.z - Math.cos(yaw) * distBack,
    );

    if (collisionSystemRef?.current) {
      sceneToExport(_pivot, _pivotExport);
      sceneToExport(_desiredCamera, _desiredCameraExport);
      _cameraDirExport.subVectors(_desiredCameraExport, _pivotExport);

      const desiredDistance = _cameraDirExport.length();
      if (desiredDistance > 1e-4) {
        const minDistance = CAMERA_MIN_DISTANCE / RENDER_SF;
        _centerDirExport.copy(_cameraDirExport).multiplyScalar(1 / desiredDistance);
        let wallClampedDistance = desiredDistance;

        _wallAllowedDistances.length = 0;

        _cameraForwardExport.subVectors(_pivotExport, _desiredCameraExport);
        if (_cameraForwardExport.lengthSq() > 1e-8) {
          _cameraForwardExport.normalize();
          _cameraRightExport.crossVectors(_worldUp, _cameraForwardExport);
          if (_cameraRightExport.lengthSq() < 1e-8) {
            _cameraRightExport.set(Math.cos(yaw), 0, -Math.sin(yaw));
          }
          _cameraRightExport.normalize();
          _cameraUpExport.crossVectors(_cameraForwardExport, _cameraRightExport);
          if (_cameraUpExport.lengthSq() < 1e-8) {
            _cameraUpExport.copy(_worldUp);
          } else {
            _cameraUpExport.normalize();
          }

          for (const sample of CAMERA_WALL_SUPPORT_SAMPLES) {
            const offsetX = sample.x * CAMERA_WALL_SUPPORT_SIDE;
            const offsetY = sample.y > 0
              ? sample.y * CAMERA_WALL_SUPPORT_UP
              : sample.y * CAMERA_WALL_SUPPORT_DOWN;
            _probeTargetExport.copy(_desiredCameraExport)
              .addScaledVector(_cameraRightExport, offsetX / RENDER_SF)
              .addScaledVector(_cameraUpExport, offsetY / RENDER_SF);

            _probeDirExport.subVectors(_probeTargetExport, _pivotExport);
            const supportDistance = _probeDirExport.length();
            if (supportDistance <= 1e-4) continue;

            _probeDirExport.multiplyScalar(1 / supportDistance);
            const supportHitDistance = collisionSystemRef.current.raycastDistanceIgnoringFloorHits(
              _pivotExport,
              _probeDirExport,
              0.01,
              supportDistance,
            );

            if (supportHitDistance === null) continue;

            const allowedDistance = Math.max(
              minDistance,
              (supportHitDistance - CAMERA_WALL_PADDING / RENDER_SF) * (desiredDistance / supportDistance),
            );
            _wallAllowedDistances.push(allowedDistance);

            const allowedDistanceScene = allowedDistance * RENDER_SF;
            wallHitCount += 1;
            wallHitMask = wallHitMask ? `${wallHitMask},${sample.label}` : sample.label;
            wallMinDistanceScene = wallMinDistanceScene === null ? allowedDistanceScene : Math.min(wallMinDistanceScene, allowedDistanceScene);
            wallMaxDistanceScene = wallMaxDistanceScene === null ? allowedDistanceScene : Math.max(wallMaxDistanceScene, allowedDistanceScene);
            if (sample.x < 0) {
              wallLeftHitCount += 1;
            } else if (sample.x > 0) {
              wallRightHitCount += 1;
            } else {
              wallCenterHitCount += 1;
            }
            if (wallHitCount === 1) {
              wallMinOffsetX = offsetX;
              wallMaxOffsetX = offsetX;
              wallMinOffsetY = offsetY;
              wallMaxOffsetY = offsetY;
            } else {
              wallMinOffsetX = Math.min(wallMinOffsetX, offsetX);
              wallMaxOffsetX = Math.max(wallMaxOffsetX, offsetX);
              wallMinOffsetY = Math.min(wallMinOffsetY, offsetY);
              wallMaxOffsetY = Math.max(wallMaxOffsetY, offsetY);
            }
          }

          const wallHorizontalSpan = wallHitCount > 0 ? wallMaxOffsetX - wallMinOffsetX : 0;
          const wallHasBroadHorizontalCoverage =
            wallCenterHitCount > 0 &&
            wallLeftHitCount > 0 &&
            wallRightHitCount > 0 &&
            wallHorizontalSpan >= CAMERA_WALL_MIN_HORIZONTAL_SPAN;

          // One-sided blocker clusters are usually posts, bridge sticks, or trim. Let the probe clamp
          // handle those edge occluders instead of collapsing the full boom like a real wall.
          if (wallHasBroadHorizontalCoverage && _wallAllowedDistances.length >= CAMERA_WALL_MIN_RELIABLE_HITS) {
            _wallAllowedDistances.sort((a, b) => a - b);
            const reliableWallDistance = _wallAllowedDistances[Math.min(
              CAMERA_WALL_RELIABLE_HIT_INDEX,
              _wallAllowedDistances.length - 1,
            )];
            if (desiredDistance - reliableWallDistance > CAMERA_WALL_MIN_REDUCTION / RENDER_SF) {
              wallClampedDistance = reliableWallDistance;
            }
          }

          _probeAllowedDistances.length = 0;

          for (const sample of CAMERA_PROBE_SAMPLES) {
            _probeTargetExport.copy(_desiredCameraExport)
              .addScaledVector(_cameraRightExport, (sample.x * CAMERA_PROBE_SIDE) / RENDER_SF)
              .addScaledVector(_cameraUpExport, ((sample.y > 0 ? CAMERA_PROBE_UP : CAMERA_PROBE_DOWN) * sample.y) / RENDER_SF);

            _probeDirExport.subVectors(_probeTargetExport, _pivotExport);
            const probeDistance = _probeDirExport.length();
            if (probeDistance <= 1e-4) continue;

            _probeDirExport.multiplyScalar(1 / probeDistance);
            const probeHitDistance = collisionSystemRef.current.raycastDistanceIgnoringFloorHits(
              _pivotExport,
              _probeDirExport,
              0.01,
              probeDistance,
            );

            if (probeHitDistance === null) continue;

            const allowedDistance = Math.max(
              minDistance,
              (probeHitDistance - CAMERA_WALL_PADDING / RENDER_SF) * (desiredDistance / probeDistance),
            );
            _probeAllowedDistances.push(allowedDistance);

            const allowedDistanceScene = allowedDistance * RENDER_SF;
            probeHitCount += 1;
            probeHitMask = probeHitMask ? `${probeHitMask},${sample.label}` : sample.label;
            probeMinDistanceScene = probeMinDistanceScene === null ? allowedDistanceScene : Math.min(probeMinDistanceScene, allowedDistanceScene);
            probeMaxDistanceScene = probeMaxDistanceScene === null ? allowedDistanceScene : Math.max(probeMaxDistanceScene, allowedDistanceScene);
          }

          if (_probeAllowedDistances.length >= CAMERA_PROBE_MIN_RELIABLE_HITS) {
            _probeAllowedDistances.sort((a, b) => a - b);
            const reliableProbeDistance = _probeAllowedDistances[Math.min(
              CAMERA_PROBE_RELIABLE_HIT_INDEX,
              _probeAllowedDistances.length - 1,
            )];
            if (wallClampedDistance - reliableProbeDistance > CAMERA_PROBE_MIN_REDUCTION / RENDER_SF) {
              rawReliableProbeDistanceScene = reliableProbeDistance * RENDER_SF;
            }
          }
        }

        rawWallClampDistanceScene = wallClampedDistance * RENDER_SF;
        const rawWallClampActive = rawWallClampDistanceScene + CAMERA_STATE_EPSILON < desiredDistanceScene;
        if (rawWallClampActive) {
          lastWallClampHitAtRef.current = nowMs;
          const currentRetainedWallDistance = retainedWallClampDistanceSceneRef.current ?? rawWallClampDistanceScene;
          if (rawWallClampDistanceScene <= currentRetainedWallDistance) {
            retainedWallClampDistanceSceneRef.current = THREE.MathUtils.damp(
              currentRetainedWallDistance,
              rawWallClampDistanceScene,
              CAMERA_WALL_DISTANCE_SHRINK_SPEED,
              delta,
            );
            pendingWallExpandTargetSceneRef.current = null;
          } else if (rawWallClampDistanceScene - currentRetainedWallDistance >= CAMERA_WALL_DISTANCE_EXPAND_MIN_DELTA) {
            if (
              pendingWallExpandTargetSceneRef.current === null ||
              Math.abs(pendingWallExpandTargetSceneRef.current - rawWallClampDistanceScene) > CAMERA_WALL_DISTANCE_EXPAND_TARGET_EPSILON
            ) {
              pendingWallExpandTargetSceneRef.current = rawWallClampDistanceScene;
              pendingWallExpandSinceRef.current = nowMs;
            } else if (nowMs - pendingWallExpandSinceRef.current >= CAMERA_WALL_DISTANCE_EXPAND_HOLD_MS) {
              retainedWallClampDistanceSceneRef.current = THREE.MathUtils.damp(
                currentRetainedWallDistance,
                rawWallClampDistanceScene,
                CAMERA_WALL_DISTANCE_GROW_SPEED,
                delta,
              );
            }
          } else {
            pendingWallExpandTargetSceneRef.current = null;
          }
        } else if (
          retainedWallClampDistanceSceneRef.current !== null &&
          nowMs - lastWallClampHitAtRef.current >= CAMERA_WALL_CLAMP_RELEASE_HOLD_MS
        ) {
          retainedWallClampDistanceSceneRef.current = null;
          pendingWallExpandTargetSceneRef.current = null;
        }

        centerClampDistanceScene = retainedWallClampDistanceSceneRef.current ?? rawWallClampDistanceScene;
        let clampedDistance = centerClampDistanceScene / RENDER_SF;

        actualClampDistanceScene = centerClampDistanceScene;
        targetWallClampActive = centerClampDistanceScene + CAMERA_STATE_EPSILON < desiredDistanceScene;
        const rawProbeClampDelta = rawReliableProbeDistanceScene === null
          ? 0
          : centerClampDistanceScene - rawReliableProbeDistanceScene;
        const rawProbeClampWanted = probeClampActiveRef.current
          ? rawProbeClampDelta > CAMERA_PROBE_CLAMP_EXIT_DELTA
          : rawProbeClampDelta > CAMERA_PROBE_CLAMP_ENTER_DELTA;

        probeClampActive = probeClampActiveRef.current;
        if (rawProbeClampWanted !== probeClampActiveRef.current) {
          if (probeClampPendingStateRef.current !== rawProbeClampWanted) {
            probeClampPendingStateRef.current = rawProbeClampWanted;
            probeClampPendingSinceRef.current = nowMs;
          } else {
            const holdMs = rawProbeClampWanted
              ? CAMERA_PROBE_CLAMP_ENTER_HOLD_MS
              : CAMERA_PROBE_CLAMP_EXIT_HOLD_MS;
            if (nowMs - probeClampPendingSinceRef.current >= holdMs) {
              probeClampActive = rawProbeClampWanted;
            }
          }
        } else {
          probeClampPendingStateRef.current = null;
        }

        if (probeClampActive) {
          if (rawReliableProbeDistanceScene !== null) {
            const currentRetainedProbeDistance = retainedProbeDistanceSceneRef.current ?? rawReliableProbeDistanceScene;
            const probeDistanceSpeed = rawReliableProbeDistanceScene < currentRetainedProbeDistance
              ? CAMERA_PROBE_DISTANCE_SHRINK_SPEED
              : CAMERA_PROBE_DISTANCE_GROW_SPEED;
            retainedProbeDistanceSceneRef.current = THREE.MathUtils.damp(
              currentRetainedProbeDistance,
              rawReliableProbeDistanceScene,
              probeDistanceSpeed,
              delta,
            );
          }

          if (retainedProbeDistanceSceneRef.current !== null) {
            actualClampDistanceScene = Math.min(centerClampDistanceScene, retainedProbeDistanceSceneRef.current);
            clampedDistance = actualClampDistanceScene / RENDER_SF;
          }
        } else {
          retainedProbeDistanceSceneRef.current = null;
        }

        actualClampDistanceScene = clampedDistance * RENDER_SF;

        if (clampedDistance + CAMERA_STATE_EPSILON / RENDER_SF < desiredDistance) {
          _desiredCameraExport.copy(_pivotExport).addScaledVector(_centerDirExport, clampedDistance);
          exportToScene(_desiredCameraExport, _desiredCamera);
        }
      }

      sceneToExport(_desiredCamera, _desiredCameraExport);
      const groundY = collisionSystemRef.current.getSupportGroundY(
        _desiredCameraExport,
        _desiredCameraExport.y + CAMERA_GROUND_PROBE_RISE / RENDER_SF,
      );
      if (groundY !== null) {
        const minCameraY = groundY * RENDER_SF + GROUP_POS_Y + CAMERA_GROUND_CLEARANCE;
        const roofLikeGroundWhileBlocked =
          (targetWallClampActive || probeClampActive) &&
          minCameraY > py + CAMERA_GROUND_CLAMP_MAX_ABOVE_PLAYER;

        if (!roofLikeGroundWhileBlocked && _desiredCamera.y < minCameraY) {
          lookUpRatio = THREE.MathUtils.clamp((minCameraY - _desiredCamera.y) / LOOK_UP_OVERFLOW_RANGE, 0, 1);
          _desiredCamera.y = minCameraY;
        }
      }
    } else {
      _desiredCamera.y = Math.max(py + 0.15, _desiredCamera.y);
    }

    _targetCamera.copy(_desiredCamera);

    const targetCollisionActive =
      targetWallClampActive ||
      probeClampActive ||
      lookUpRatio > CAMERA_GROUND_CLAMP_EXIT_RATIO;

    _targetCameraDir.subVectors(_targetCamera, _pivot);
    const targetCameraDistance = Math.max(CAMERA_MIN_DISTANCE, _targetCameraDir.length());
    if (targetCameraDistance > 1e-4) {
      _targetCameraDir.multiplyScalar(1 / targetCameraDistance);
    } else {
      _targetCameraDir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    }

    if (!hasLastCameraPosRef.current) {
      smoothedCameraDistanceRef.current = targetCameraDistance;
      smoothedLookUpRatioRef.current = lookUpRatio;
      lastCameraPosRef.current.copy(_targetCamera);
      hasLastCameraPosRef.current = true;
    }

    if (targetCollisionActive) {
      collisionBlendActiveRef.current = true;
    }

    if (collisionBlendActiveRef.current) {
      const currentBlendDistance = smoothedCameraDistanceRef.current;
      const targetBlendDistance = targetCameraDistance;
      let effectiveTargetBlendDistance = targetBlendDistance;
      let blendDirection: CollisionZoomDirection = 0;
      if (targetBlendDistance < currentBlendDistance - CAMERA_COLLISION_DIRECTION_EPSILON) {
        blendDirection = -1;
      } else if (targetBlendDistance > currentBlendDistance + CAMERA_COLLISION_DIRECTION_EPSILON) {
        blendDirection = 1;
      }

      const previousBlendDirection = lastCollisionZoomDirectionRef.current;
      const reversingBlendDirection =
        blendDirection !== 0 &&
        previousBlendDirection !== 0 &&
        blendDirection !== previousBlendDirection;

      let blendSpeed: number;

      // Prevent collision zoom from immediately reversing direction when clamp state flickers.
      if (reversingBlendDirection) {
        const reversalAgeMs = nowMs - lastCollisionZoomDirectionChangeAtRef.current;
        if (reversalAgeMs < CAMERA_COLLISION_DIRECTION_CHANGE_COOLDOWN_MS) {
          if (blendDirection > 0) {
            effectiveTargetBlendDistance = currentBlendDistance;
            blendDirection = 0;
          } else {
            blendSpeed = CAMERA_COLLISION_REVERSE_ZOOM_IN_SPEED;
          }
        }
      }

      if (blendDirection !== 0 && blendDirection !== previousBlendDirection) {
        lastCollisionZoomDirectionRef.current = blendDirection;
        lastCollisionZoomDirectionChangeAtRef.current = nowMs;
      } else if (blendDirection === 0 && !targetCollisionActive) {
        lastCollisionZoomDirectionRef.current = 0;
      }

      if (blendSpeed === undefined) {
        blendSpeed = effectiveTargetBlendDistance < currentBlendDistance - CAMERA_COLLISION_DIRECTION_EPSILON
          ? CAMERA_COLLISION_ZOOM_IN_SPEED
          : targetWallClampActive || probeClampActive
            ? CAMERA_COLLISION_BLOCKED_ZOOM_OUT_SPEED
            : CAMERA_COLLISION_RELEASE_ZOOM_OUT_SPEED;
      }

      smoothedCameraDistanceRef.current = THREE.MathUtils.damp(
        currentBlendDistance,
        effectiveTargetBlendDistance,
        blendSpeed,
        delta,
      );
      smoothedLookUpRatioRef.current = THREE.MathUtils.damp(
        smoothedLookUpRatioRef.current,
        lookUpRatio,
        blendSpeed,
        delta,
      );

      if (
        !targetCollisionActive &&
        Math.abs(smoothedCameraDistanceRef.current - targetBlendDistance) <= CAMERA_DISTANCE_SETTLE_EPSILON &&
        Math.abs(smoothedLookUpRatioRef.current - lookUpRatio) <= 0.01
      ) {
        collisionBlendActiveRef.current = false;
        smoothedCameraDistanceRef.current = targetBlendDistance;
        smoothedLookUpRatioRef.current = lookUpRatio;
      }
    } else {
      smoothedCameraDistanceRef.current = targetCameraDistance;
      smoothedLookUpRatioRef.current = lookUpRatio;
    }

    camera.position.copy(_pivot).addScaledVector(_targetCameraDir, smoothedCameraDistanceRef.current);

    const visibleLookUpRatio = collisionBlendActiveRef.current ? smoothedLookUpRatioRef.current : lookUpRatio;
    const effectiveLookUpRatio = recenterLookRef.current ? 0 : visibleLookUpRatio;
    const actualDistanceScene = camera.position.distanceTo(_pivot);
    const wallFocusRatio = recenterLookRef.current
      ? 1
      : THREE.MathUtils.clamp((desiredDistanceScene - actualDistanceScene) / CAMERA_CLOSE_FOCUS_RANGE, 0, 1);
    const lookForwardDist = recenterLookRef.current
      ? 0
      : THREE.MathUtils.lerp(LOOK_FORWARD_DIST, LOOK_FORWARD_WHEN_UP, effectiveLookUpRatio);
    _lookTarget.set(
      px + Math.sin(yaw) * lookForwardDist,
      _pivot.y + THREE.MathUtils.lerp(0, LOOK_UP_HEIGHT, effectiveLookUpRatio),
      pz + Math.cos(yaw) * lookForwardDist,
    );
    if (!recenterLookRef.current && wallFocusRatio > 0) {
      _lookTarget.lerp(_pivot, wallFocusRatio);
    }
    camera.lookAt(_lookTarget);
    camera.updateMatrixWorld();

    if (
      !recenterLookRef.current &&
      moveCommandActiveRef?.current &&
      !manualCameraLookActiveRef?.current &&
      actualDistanceScene > AVATAR_HIDDEN_NEAR_DISTANCE
    ) {
      _avatarNdc.copy(_pivot).project(camera);
      const avatarVisible =
        _avatarNdc.z >= -1 &&
        _avatarNdc.z <= 1 &&
        Math.abs(_avatarNdc.x) <= 1 &&
        Math.abs(_avatarNdc.y) <= 1;

      if (!avatarVisible) {
        recenterLookRef.current = true;
        _lookTarget.copy(_pivot);
        camera.lookAt(_lookTarget);
        camera.updateMatrixWorld();
      }
    }

    const wallClampActive = actualDistanceScene + CAMERA_STATE_EPSILON < desiredDistanceScene;
    const groundClampActive = groundClampActiveRef.current
      ? visibleLookUpRatio > CAMERA_GROUND_CLAMP_EXIT_RATIO
      : visibleLookUpRatio > CAMERA_GROUND_CLAMP_ENTER_RATIO;
    const closeCameraActive = closeCameraActiveRef.current
      ? actualDistanceScene <= CAMERA_CLOSE_CAMERA_EXIT_DISTANCE
      : actualDistanceScene <= CAMERA_CLOSE_CAMERA_ENTER_DISTANCE;
    const recenterActive = recenterLookRef.current;
    const wallSpanX = wallHitCount > 0 ? wallMaxOffsetX - wallMinOffsetX : 0;
    const wallSpanY = wallHitCount > 0 ? wallMaxOffsetY - wallMinOffsetY : 0;
    const wallClearMs = targetWallClampActive ? 0 : Math.max(0, Math.round(nowMs - lastWallClampHitAtRef.current));
    const wallPendingExpandMs = pendingWallExpandTargetSceneRef.current === null
      ? 0
      : Math.max(0, Math.round(nowMs - pendingWallExpandSinceRef.current));
    const emitDebug = (type: string, message: string) => {
      onCameraDebugEvent?.({
        type,
        message,
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        lookTarget: { x: _lookTarget.x, y: _lookTarget.y, z: _lookTarget.z },
        pivot: { x: _pivot.x, y: _pivot.y, z: _pivot.z },
        yaw,
        pitch,
        zoom,
        desiredDistance: desiredDistanceScene,
        actualDistance: actualDistanceScene,
        wallClamp: wallClampActive,
        probeClamp: probeClampActive,
        groundClamp: groundClampActive,
        recenter: recenterActive,
        wallDebug: {
          hitCount: wallHitCount,
          sampleCount: CAMERA_WALL_SUPPORT_SAMPLES.length,
          hitMask: wallHitMask,
          spanX: wallSpanX,
          spanY: wallSpanY,
          minDistance: wallMinDistanceScene,
          maxDistance: wallMaxDistanceScene,
          rawDistance: rawWallClampDistanceScene,
          retainedDistance: centerClampDistanceScene < desiredDistanceScene - CAMERA_STATE_EPSILON ? centerClampDistanceScene : null,
          clearMs: wallClearMs,
          pendingExpandDistance: pendingWallExpandTargetSceneRef.current,
          pendingExpandMs: wallPendingExpandMs,
        },
        probeDebug: {
          hitCount: probeHitCount,
          sampleCount: CAMERA_PROBE_SAMPLES.length,
          hitMask: probeHitMask,
          minDistance: probeMinDistanceScene,
          maxDistance: probeMaxDistanceScene,
          rawDistance: rawReliableProbeDistanceScene,
          retainedDistance: retainedProbeDistanceSceneRef.current,
        },
      });
    };

    if (wallClampActive !== wallClampActiveRef.current) {
      emitDebug(
        wallClampActive ? 'wall-clamp-start' : 'wall-clamp-end',
        wallClampActive
          ? `wall clamp shortened distance to ${actualDistanceScene.toFixed(2)}`
          : 'wall clamp released',
      );
      wallClampActiveRef.current = wallClampActive;
    }

    if (probeClampActive !== probeClampActiveRef.current) {
      emitDebug(
        probeClampActive ? 'probe-clamp-start' : 'probe-clamp-end',
        probeClampActive
          ? 'side probes pulled the camera inward to keep wall edges out of frame'
          : 'side probe clamp released',
      );
      probeClampActiveRef.current = probeClampActive;
    }

    if (groundClampActive !== groundClampActiveRef.current) {
      emitDebug(
        groundClampActive ? 'ground-clamp-start' : 'ground-clamp-end',
        groundClampActive
          ? `camera reached local ground and overflow became sky-look (${lookUpRatio.toFixed(2)})`
          : 'camera lifted clear of local ground clamp',
      );
      groundClampActiveRef.current = groundClampActive;
    }

    if (closeCameraActive !== closeCameraActiveRef.current) {
      emitDebug(
        closeCameraActive ? 'close-camera-start' : 'close-camera-end',
        closeCameraActive ? 'camera entered close-body wall view' : 'camera left close-body wall view',
      );
      closeCameraActiveRef.current = closeCameraActive;
    }

    if (recenterActive !== recenterStateRef.current) {
      emitDebug(
        recenterActive ? 'recenter-start' : 'recenter-end',
        recenterActive ? 'move command recentered the aim onto the avatar' : 'recenter released',
      );
      recenterStateRef.current = recenterActive;
    }

    if (hasLastCameraPosRef.current) {
      const snapDistance = lastCameraPosRef.current.distanceTo(camera.position);
      if (snapDistance >= CAMERA_SNAP_LOG_DISTANCE && nowMs - lastSnapLogAtRef.current >= CAMERA_SNAP_LOG_INTERVAL_MS) {
        const snapReasons = [
          wallClampActive ? (probeClampActive ? 'wall+probe' : 'wall') : null,
          groundClampActive ? 'ground' : null,
          recenterActive ? 'recenter' : null,
        ].filter(Boolean);
        emitDebug(
          'snap',
          `camera jumped ${snapDistance.toFixed(2)}${snapReasons.length > 0 ? ` because ${snapReasons.join('+')}` : ''}`,
        );
        lastSnapLogAtRef.current = nowMs;
      }
    }

    lastCameraPosRef.current.copy(camera.position);
    hasLastCameraPosRef.current = true;
  });

  return null;
}
