import { gameplayUnitsToWorldUnits, type GameState, type PlayerState, type Position } from "../state/types";
import type { MapObject } from "../state/types/map";
import { getGroundHeightForMap, resolveMapCollisions, type MapContext } from "../loop/movement";
import { pushBuffExpired } from "../effects/buffRuntime";
import {
  isLineBlockedByEnemyChuHeHanJieWall,
  resolveEnemyChuHeHanJieWallCollision,
} from "./chuHeHanJieWall";

export const YUN_SAN_BUFF_ID = 2650;

const YUN_SAN_MIN_TARGET_DISTANCE_UNITS = 17;
const YUN_SAN_MAX_TARGET_DISTANCE_UNITS = 18;
const YUN_SAN_DASH_SPEED_DISTANCE_UNITS = 20;
const YUN_SAN_DASH_SPEED_WINDOW_TICKS = 6;
const YUN_SAN_MIN_RING_SHIFT_UNITS = 10;
const YUN_SAN_MAX_RING_SHIFT_UNITS = 12;
const YUN_SAN_ACTOR_HEIGHT_UNITS = 1.5;
const YUN_SAN_LOS_EYE_HEIGHT = 1.5;
const YUN_SAN_RESOLVE_TOLERANCE_UNITS = 0.35;
const DEFAULT_ARENA_WIDTH = 2000;
const DEFAULT_ARENA_HEIGHT = 2000;
const YUN_SAN_DESTINATION_BAND_UNITS = [18, 17.75, 17.5, 17.25, 17] as const;
const YUN_SAN_RING_SHIFT_CANDIDATES = [12, 11.5, 11, 10.5, 10] as const;
const YUN_SAN_DIRECTION_EPSILON = 1e-4;

function segmentIntersectsAABB(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  let tmin = 0;
  let tmax = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < minY || y1 > maxY) return false;
  } else {
    let t1 = (minY - y1) / dy;
    let t2 = (maxY - y1) / dy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  return true;
}

function isLineBlockedByMapObjects(params: {
  from: Pick<Position, "x" | "y">;
  to: Pick<Position, "x" | "y">;
  fromZ: number;
  toZ: number;
  objects: MapObject[];
  minBlockH?: number;
}): boolean {
  const {
    from,
    to,
    fromZ,
    toZ,
    objects,
    minBlockH = 0,
  } = params;
  const fromEye = fromZ + YUN_SAN_LOS_EYE_HEIGHT;
  const toEye = toZ + YUN_SAN_LOS_EYE_HEIGHT;

  for (const obj of objects) {
    if (obj.h < minBlockH) continue;
    if (obj.h <= Math.min(fromEye, toEye)) continue;
    if (
      segmentIntersectsAABB(
        from.x,
        from.y,
        to.x,
        to.y,
        obj.x - 0.5,
        obj.y - 0.5,
        obj.x + obj.w + 0.5,
        obj.y + obj.d + 0.5,
      )
    ) {
      return true;
    }
  }

  return false;
}

function isLineBlocked(params: {
  state: GameState;
  actorUserId: string;
  from: Pick<Position, "x" | "y">;
  to: Pick<Position, "x" | "y">;
  fromZ: number;
  toZ: number;
  mapCtx?: MapContext;
}): boolean {
  const { state, actorUserId, from, to, fromZ, toZ, mapCtx } = params;
  const arenaW = mapCtx?.width ?? DEFAULT_ARENA_WIDTH;
  const arenaH = mapCtx?.height ?? DEFAULT_ARENA_HEIGHT;

  const blockedByMap = mapCtx?.collisionSystem
    ? mapCtx.collisionSystem.checkLOS(
        from.x,
        from.y,
        fromZ,
        to.x,
        to.y,
        toZ,
        arenaW,
        arenaH,
        YUN_SAN_LOS_EYE_HEIGHT,
      )
    : isLineBlockedByMapObjects({
        from,
        to,
        fromZ,
        toZ,
        objects: mapCtx?.objects ?? [],
      });

  if (blockedByMap) return true;

  return isLineBlockedByEnemyChuHeHanJieWall({
    state,
    actorUserId,
    from,
    to,
    casterZ: fromZ,
    targetZ: toZ,
    eyeHeight: YUN_SAN_LOS_EYE_HEIGHT,
  });
}

function createProbePlayer(userId: string, position: Position) {
  return {
    userId,
    hp: 1,
    shield: 0,
    hand: [],
    buffs: [],
    position: { ...position },
    velocity: { vx: 0, vy: 0, vz: 0 },
    moveSpeed: 0,
    jumpCount: 0,
    isPowerJump: false,
    isPowerJumpCombined: false,
  } as Pick<PlayerState, "userId" | "hp" | "shield" | "hand" | "buffs" | "position" | "velocity" | "moveSpeed" | "jumpCount"> & {
    isPowerJump?: boolean;
    isPowerJumpCombined?: boolean;
  };
}

function normalizePlanar(x: number, y: number) {
  const length = Math.hypot(x, y);
  if (length <= YUN_SAN_DIRECTION_EPSILON) return null;
  return {
    x: x / length,
    y: y / length,
  };
}

function getRetreatDirection(source: PlayerState, targetPosition: Position) {
  return normalizePlanar(
    source.position.x - targetPosition.x,
    source.position.y - targetPosition.y,
  ) ?? normalizePlanar(
    -(source.facing?.x ?? 0),
    -(source.facing?.y ?? 1),
  ) ?? { x: 0, y: -1 };
}

function isCandidateInsideArena(params: {
  candidateX: number;
  candidateY: number;
  playerRadius: number;
  arenaW: number;
  arenaH: number;
}) {
  const { candidateX, candidateY, playerRadius, arenaW, arenaH } = params;
  return !(
    candidateX < playerRadius ||
    candidateX > arenaW - playerRadius ||
    candidateY < playerRadius ||
    candidateY > arenaH - playerRadius
  );
}

function buildCandidatePosition(params: {
  state: GameState;
  actorUserId: string;
  candidateX: number;
  candidateY: number;
  sourceZ: number;
  targetPosition: Position;
  targetZ: number;
  mapCtx?: MapContext;
  toleranceWorld: number;
  playerRadius: number;
  arenaW: number;
  arenaH: number;
}) {
  const {
    state,
    actorUserId,
    candidateX,
    candidateY,
    sourceZ,
    targetPosition,
    targetZ,
    mapCtx,
    toleranceWorld,
    playerRadius,
    arenaW,
    arenaH,
  } = params;

  if (!isCandidateInsideArena({ candidateX, candidateY, playerRadius, arenaW, arenaH })) {
    return null;
  }

  const candidateZ = getGroundHeightForMap(candidateX, candidateY, sourceZ, mapCtx);
  const candidatePosition: Position = {
    x: candidateX,
    y: candidateY,
    z: candidateZ,
  };

  if (
    !isStableCandidatePosition({
      state,
      actorUserId,
      position: candidatePosition,
      mapCtx,
      toleranceWorld,
    })
  ) {
    return null;
  }

  if (
    isLineBlocked({
      state,
      actorUserId,
      from: candidatePosition,
      to: targetPosition,
      fromZ: candidateZ,
      toZ: targetZ,
      mapCtx,
    })
  ) {
    return null;
  }

  return candidatePosition;
}

function buildRingShiftCandidate(params: {
  state: GameState;
  source: PlayerState;
  targetPosition: Position;
  targetRadius: number;
  dashDistance: number;
  sideSign: number;
  sourceZ: number;
  targetZ: number;
  mapCtx?: MapContext;
  toleranceWorld: number;
  playerRadius: number;
  arenaW: number;
  arenaH: number;
}) {
  const {
    state,
    source,
    targetPosition,
    targetRadius,
    dashDistance,
    sideSign,
    sourceZ,
    targetZ,
    mapCtx,
    toleranceWorld,
    playerRadius,
    arenaW,
    arenaH,
  } = params;

  const centerDx = source.position.x - targetPosition.x;
  const centerDy = source.position.y - targetPosition.y;
  const centerDistance = Math.hypot(centerDx, centerDy);
  if (centerDistance <= YUN_SAN_DIRECTION_EPSILON) return null;
  if (centerDistance > targetRadius + dashDistance + YUN_SAN_DIRECTION_EPSILON) return null;
  if (centerDistance < Math.abs(targetRadius - dashDistance) - YUN_SAN_DIRECTION_EPSILON) return null;

  const unitX = centerDx / centerDistance;
  const unitY = centerDy / centerDistance;
  const baseOffset = (
    targetRadius * targetRadius - dashDistance * dashDistance + centerDistance * centerDistance
  ) / (2 * centerDistance);
  const perpendicularSq = targetRadius * targetRadius - baseOffset * baseOffset;
  if (perpendicularSq <= YUN_SAN_DIRECTION_EPSILON) return null;

  const perpendicularOffset = Math.sqrt(perpendicularSq);
  const perpX = -unitY;
  const perpY = unitX;
  const candidateX = targetPosition.x + unitX * baseOffset + perpX * perpendicularOffset * sideSign;
  const candidateY = targetPosition.y + unitY * baseOffset + perpY * perpendicularOffset * sideSign;

  return buildCandidatePosition({
    state,
    actorUserId: source.userId,
    candidateX,
    candidateY,
    sourceZ,
    targetPosition,
    targetZ,
    mapCtx,
    toleranceWorld,
    playerRadius,
    arenaW,
    arenaH,
  });
}

function isStableCandidatePosition(params: {
  state: GameState;
  actorUserId: string;
  position: Position;
  mapCtx?: MapContext;
  toleranceWorld: number;
}): boolean {
  const { state, actorUserId, position, mapCtx, toleranceWorld } = params;
  const playerRadius = mapCtx?.playerRadius ?? 2;
  const probe = createProbePlayer(actorUserId, position);

  resolveMapCollisions(probe as any, mapCtx);
  resolveEnemyChuHeHanJieWallCollision({
    state,
    actorUserId,
    position: probe.position,
    radius: playerRadius,
    actorBaseZ: probe.position.z ?? 0,
    actorHeight: YUN_SAN_ACTOR_HEIGHT_UNITS,
  });

  const movedDistance = Math.hypot(
    probe.position.x - position.x,
    probe.position.y - position.y,
  );
  const movedZ = Math.abs((probe.position.z ?? 0) - (position.z ?? 0));
  return movedDistance <= toleranceWorld && movedZ <= toleranceWorld;
}

function findYunSanDestination(params: {
  state: GameState;
  source: PlayerState;
  targetPosition: Position;
  mapCtx?: MapContext;
}): Position | null {
  const { state, source, targetPosition, mapCtx } = params;
  const storedUnitScale = state.unitScale;
  const minTargetDistance = gameplayUnitsToWorldUnits(YUN_SAN_MIN_TARGET_DISTANCE_UNITS, storedUnitScale);
  const maxTargetDistance = gameplayUnitsToWorldUnits(YUN_SAN_MAX_TARGET_DISTANCE_UNITS, storedUnitScale);
  const minRingShiftDistance = gameplayUnitsToWorldUnits(YUN_SAN_MIN_RING_SHIFT_UNITS, storedUnitScale);
  const maxRingShiftDistance = gameplayUnitsToWorldUnits(YUN_SAN_MAX_RING_SHIFT_UNITS, storedUnitScale);
  const targetRadiusCandidates = YUN_SAN_DESTINATION_BAND_UNITS
    .map((distanceUnits) => gameplayUnitsToWorldUnits(distanceUnits, storedUnitScale))
    .filter((radius) => radius >= minTargetDistance - YUN_SAN_DIRECTION_EPSILON && radius <= maxTargetDistance + YUN_SAN_DIRECTION_EPSILON);
  const ringShiftDistanceCandidates = YUN_SAN_RING_SHIFT_CANDIDATES
    .map((distanceUnits) => gameplayUnitsToWorldUnits(distanceUnits, storedUnitScale))
    .filter((distance) => distance >= minRingShiftDistance - YUN_SAN_DIRECTION_EPSILON && distance <= maxRingShiftDistance + YUN_SAN_DIRECTION_EPSILON);
  const toleranceWorld = gameplayUnitsToWorldUnits(YUN_SAN_RESOLVE_TOLERANCE_UNITS, storedUnitScale);
  const playerRadius = mapCtx?.playerRadius ?? 2;
  const arenaW = mapCtx?.width ?? DEFAULT_ARENA_WIDTH;
  const arenaH = mapCtx?.height ?? DEFAULT_ARENA_HEIGHT;
  const sourceZ = Number(source.position.z ?? 0);
  const targetZ = Number(targetPosition.z ?? 0);
  const retreatDirection = getRetreatDirection(source, targetPosition);
  const currentDistance = Math.hypot(
    source.position.x - targetPosition.x,
    source.position.y - targetPosition.y,
  );

  if (currentDistance < minTargetDistance) {
    for (const radius of targetRadiusCandidates) {
      const candidatePosition = buildCandidatePosition({
        state,
        actorUserId: source.userId,
        candidateX: targetPosition.x + retreatDirection.x * radius,
        candidateY: targetPosition.y + retreatDirection.y * radius,
        sourceZ,
        targetPosition,
        targetZ,
        mapCtx,
        toleranceWorld,
        playerRadius,
        arenaW,
        arenaH,
      });
      if (candidatePosition) return candidatePosition;
    }

    return null;
  }

  const sideSigns = Math.random() < 0.5 ? [1, -1] : [-1, 1];

  for (const sideSign of sideSigns) {
    for (const dashDistance of ringShiftDistanceCandidates) {
      for (const radius of targetRadiusCandidates) {
        const candidatePosition = buildRingShiftCandidate({
          state,
          source,
          targetPosition,
          targetRadius: radius,
          dashDistance,
          sideSign,
          sourceZ,
          targetZ,
          mapCtx,
          toleranceWorld,
          playerRadius,
          arenaW,
          arenaH,
        });
        if (candidatePosition) return candidatePosition;
      }
    }
  }

  return null;
}

export function triggerYunSanBlink(params: {
  state: GameState;
  source: PlayerState;
  targetPosition: Position;
  triggerAbilityId: string;
  mapCtx?: MapContext;
  now?: number;
}): boolean {
  const { state, source, targetPosition, triggerAbilityId, mapCtx, now = Date.now() } = params;
  const activeBuffs = source.buffs ?? [];
  const buffIndex = activeBuffs.findIndex(
    (buff: any) =>
      buff.buffId === YUN_SAN_BUFF_ID &&
      (buff.expiresAt ?? 0) > now &&
      (buff.stacks ?? 1) > 0,
  );
  if (buffIndex === -1) return false;

  const destination = findYunSanDestination({
    state,
    source,
    targetPosition,
    mapCtx,
  });
  if (!destination) return false;

  const dx = destination.x - source.position.x;
  const dy = destination.y - source.position.y;
  const dz = (destination.z ?? 0) - Number(source.position.z ?? 0);
  if (Math.hypot(dx, dy) < 1e-4 && Math.abs(dz) < 1e-4) return false;

  const dashSpeedPerTick = gameplayUnitsToWorldUnits(YUN_SAN_DASH_SPEED_DISTANCE_UNITS, state.unitScale) / YUN_SAN_DASH_SPEED_WINDOW_TICKS;
  const dashTicks = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(dashSpeedPerTick, YUN_SAN_DIRECTION_EPSILON)));

  source.activeDash = {
    abilityId: triggerAbilityId,
    vxPerTick: dx / dashTicks,
    vyPerTick: dy / dashTicks,
    forceVzPerTick: dz / dashTicks,
    maxUpVz: 999,
    maxDownVz: -999,
    ticksRemaining: dashTicks,
  } as any;
  source.velocity = {
    ...source.velocity,
    vx: 0,
    vy: 0,
    vz: 0,
  };

  const liveBuff = activeBuffs[buffIndex] as any;
  const remainingStacks = Math.max(0, Number(liveBuff.stacks ?? 1) - 1);
  if (remainingStacks > 0) {
    liveBuff.stacks = remainingStacks;
  } else {
    activeBuffs.splice(buffIndex, 1);
    pushBuffExpired(state, {
      targetUserId: source.userId,
      buffId: liveBuff.buffId,
      buffName: liveBuff.name,
      buffCategory: liveBuff.category,
      sourceAbilityId: liveBuff.sourceAbilityId,
      sourceAbilityName: liveBuff.sourceAbilityName,
    });
  }

  return true;
}