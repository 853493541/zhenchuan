import type { GameState, Position, TargetEntity } from "../state/types";

export const CHU_HE_HAN_JIE_WALL_KIND = "chu_he_han_jie_wall";
export const CHU_HE_HAN_JIE_WALL_LENGTH_UNITS = 20;
export const CHU_HE_HAN_JIE_WALL_THICKNESS_UNITS = 0.18;
export const CHU_HE_HAN_JIE_WALL_HEIGHT_UNITS = 3.5;
export const CHU_HE_HAN_JIE_WALL_HP = 100;
export const CHU_HE_HAN_JIE_WALL_DURATION_MS = 4_000;
const DEFAULT_ACTOR_HEIGHT_UNITS = 1.5;

type WallGeometry = {
  centerX: number;
  centerY: number;
  halfLength: number;
  halfThickness: number;
  baseZ: number;
  height: number;
  tangentX: number;
  tangentY: number;
  normalX: number;
  normalY: number;
};

type LocalPoint = {
  u: number;
  v: number;
};

type SweepHit = {
  entryTime: number;
  position: Pick<Position, "x" | "y">;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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
      const temp = t1;
      t1 = t2;
      t2 = temp;
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
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  return true;
}

function getSegmentEntryTimeAABB(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number | null {
  let tEnter = 0;
  let tExit = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-8) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tExit) return false;
      if (r > tEnter) tEnter = r;
    } else {
      if (r < tEnter) return false;
      if (r < tExit) tExit = r;
    }
    return true;
  };

  if (!clip(-dx, x1 - minX)) return null;
  if (!clip(dx, maxX - x1)) return null;
  if (!clip(-dy, y1 - minY)) return null;
  if (!clip(dy, maxY - y1)) return null;

  if (tEnter < 0 || tEnter > 1) return null;
  return tEnter;
}

export function isChuHeHanJieWallEntity(entity: TargetEntity | null | undefined): boolean {
  return !!entity && entity.kind === CHU_HE_HAN_JIE_WALL_KIND;
}

function getWallGeometry(entity: TargetEntity): WallGeometry | null {
  if (!isChuHeHanJieWallEntity(entity)) return null;
  const halfLength = Number(entity.wallHalfLength ?? 0);
  const halfThickness = Number(entity.wallHalfThickness ?? 0);
  const height = Number(entity.wallHeight ?? 0);
  const tangentX = Number(entity.wallTangent?.x ?? 0);
  const tangentY = Number(entity.wallTangent?.y ?? 0);
  const normalX = Number(entity.wallNormal?.x ?? 0);
  const normalY = Number(entity.wallNormal?.y ?? 0);
  if (halfLength <= 0 || halfThickness <= 0 || height <= 0) return null;

  const tangentLen = Math.hypot(tangentX, tangentY);
  const normalLen = Math.hypot(normalX, normalY);
  if (tangentLen < 1e-6 || normalLen < 1e-6) return null;

  return {
    centerX: entity.position.x,
    centerY: entity.position.y,
    halfLength,
    halfThickness,
    baseZ: entity.position.z ?? 0,
    height,
    tangentX: tangentX / tangentLen,
    tangentY: tangentY / tangentLen,
    normalX: normalX / normalLen,
    normalY: normalY / normalLen,
  };
}

function toLocalPoint(geometry: WallGeometry, point: Pick<Position, "x" | "y">): LocalPoint {
  const dx = point.x - geometry.centerX;
  const dy = point.y - geometry.centerY;
  return {
    u: dx * geometry.tangentX + dy * geometry.tangentY,
    v: dx * geometry.normalX + dy * geometry.normalY,
  };
}

function fromLocalPoint(geometry: WallGeometry, point: LocalPoint): Pick<Position, "x" | "y"> {
  return {
    x: geometry.centerX + point.u * geometry.tangentX + point.v * geometry.normalX,
    y: geometry.centerY + point.u * geometry.tangentY + point.v * geometry.normalY,
  };
}

function doesActorOverlapWallHeight(
  geometry: WallGeometry,
  actorBaseZ: number,
  actorHeight: number,
): boolean {
  const actorTopZ = actorBaseZ + actorHeight;
  const wallTopZ = geometry.baseZ + geometry.height;
  return actorTopZ > geometry.baseZ + 1e-4 && actorBaseZ < wallTopZ - 1e-4;
}

function getEnemyWalls(state: GameState, actorUserId: string, ignoreEntityId?: string): TargetEntity[] {
  const now = Date.now();
  return (state.entities ?? []).filter((entity) => {
    if (!isChuHeHanJieWallEntity(entity)) return false;
    if (entity.ownerUserId === actorUserId) return false;
    if (entity.id === ignoreEntityId) return false;
    if ((entity.hp ?? 0) <= 0) return false;
    if ((entity.expiresAt ?? 0) <= now) return false;
    return true;
  });
}

export function isLineBlockedByEnemyChuHeHanJieWall(params: {
  state: GameState;
  actorUserId: string;
  from: Pick<Position, "x" | "y">;
  to: Pick<Position, "x" | "y">;
  casterZ?: number;
  targetZ?: number;
  eyeHeight?: number;
  ignoreEntityId?: string;
}): boolean {
  const {
    state,
    actorUserId,
    from,
    to,
    casterZ = 0,
    targetZ = 0,
    eyeHeight = 1.5,
    ignoreEntityId,
  } = params;

  const casterEye = casterZ + eyeHeight;
  const targetEye = targetZ + eyeHeight;

  for (const wall of getEnemyWalls(state, actorUserId, ignoreEntityId)) {
    const geometry = getWallGeometry(wall);
    if (!geometry) continue;
    const wallTop = geometry.baseZ + geometry.height;
    if (wallTop <= Math.min(casterEye, targetEye)) continue;

    const start = toLocalPoint(geometry, from);
    const end = toLocalPoint(geometry, to);
    if (
      segmentIntersectsAABB(
        start.u,
        start.v,
        end.u,
        end.v,
        -geometry.halfLength,
        -geometry.halfThickness,
        geometry.halfLength,
        geometry.halfThickness,
      )
    ) {
      return true;
    }
  }

  return false;
}

function resolveCircleAgainstWall(
  geometry: WallGeometry,
  position: Pick<Position, "x" | "y">,
  radius: number,
): Pick<Position, "x" | "y"> | null {
  const local = toLocalPoint(geometry, position);
  const closestU = clamp(local.u, -geometry.halfLength, geometry.halfLength);
  const closestV = clamp(local.v, -geometry.halfThickness, geometry.halfThickness);
  const deltaU = local.u - closestU;
  const deltaV = local.v - closestV;
  const distanceSq = deltaU * deltaU + deltaV * deltaV;
  const targetRadius = radius + 1e-4;

  if (distanceSq >= targetRadius * targetRadius) {
    return null;
  }

  const resolved = { ...local };
  if (distanceSq > 1e-8) {
    const distance = Math.sqrt(distanceSq);
    const push = targetRadius - distance;
    resolved.u += (deltaU / distance) * push;
    resolved.v += (deltaV / distance) * push;
  } else {
    const overlapU = geometry.halfLength + targetRadius - Math.abs(local.u);
    const overlapV = geometry.halfThickness + targetRadius - Math.abs(local.v);
    if (overlapV <= overlapU) {
      resolved.v = (local.v >= 0 ? 1 : -1) * (geometry.halfThickness + targetRadius);
    } else {
      resolved.u = (local.u >= 0 ? 1 : -1) * (geometry.halfLength + targetRadius);
    }
  }

  return fromLocalPoint(geometry, resolved);
}

function sweepCircleAgainstWall(
  geometry: WallGeometry,
  previousPosition: Pick<Position, "x" | "y">,
  currentPosition: Pick<Position, "x" | "y">,
  radius: number,
): SweepHit | null {
  const start = toLocalPoint(geometry, previousPosition);
  const end = toLocalPoint(geometry, currentPosition);
  const expandedHalfLength = geometry.halfLength + radius + 1e-4;
  const expandedHalfThickness = geometry.halfThickness + radius + 1e-4;

  if (
    Math.abs(start.u) <= expandedHalfLength &&
    Math.abs(start.v) <= expandedHalfThickness
  ) {
    return null;
  }

  const entryTime = getSegmentEntryTimeAABB(
    start.u,
    start.v,
    end.u,
    end.v,
    -expandedHalfLength,
    -expandedHalfThickness,
    expandedHalfLength,
    expandedHalfThickness,
  );
  if (entryTime === null) return null;

  const dirU = end.u - start.u;
  const dirV = end.v - start.v;
  const dirLen = Math.hypot(dirU, dirV);
  const backoff = dirLen > 1e-6 ? Math.min(1e-3, dirLen * 0.05) : 0;
  const stopDistance = Math.max(0, entryTime * dirLen - backoff);
  const stopT = dirLen > 1e-6 ? stopDistance / dirLen : entryTime;

  return {
    entryTime,
    position: fromLocalPoint(geometry, {
      u: start.u + dirU * stopT,
      v: start.v + dirV * stopT,
    }),
  };
}

export function resolveEnemyChuHeHanJieWallCollision(params: {
  state: GameState;
  actorUserId: string;
  position: Position;
  radius: number;
  previousPosition?: Pick<Position, "x" | "y">;
  actorBaseZ?: number;
  actorHeight?: number;
}): boolean {
  const {
    state,
    actorUserId,
    position,
    radius,
    previousPosition,
    actorBaseZ = Number(position.z ?? 0),
    actorHeight = DEFAULT_ACTOR_HEIGHT_UNITS,
  } = params;
  let collided = false;

  if (previousPosition) {
    let bestSweepHit: SweepHit | null = null;
    for (const wall of getEnemyWalls(state, actorUserId)) {
      const geometry = getWallGeometry(wall);
      if (!geometry) continue;
      if (!doesActorOverlapWallHeight(geometry, actorBaseZ, actorHeight)) continue;
      const sweepHit = sweepCircleAgainstWall(geometry, previousPosition, position, radius);
      if (!sweepHit) continue;
      if (!bestSweepHit || sweepHit.entryTime < bestSweepHit.entryTime) {
        bestSweepHit = sweepHit;
      }
    }
    if (bestSweepHit) {
      position.x = bestSweepHit.position.x;
      position.y = bestSweepHit.position.y;
      collided = true;
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    let passCollided = false;
    for (const wall of getEnemyWalls(state, actorUserId)) {
      const geometry = getWallGeometry(wall);
      if (!geometry) continue;
      if (!doesActorOverlapWallHeight(geometry, actorBaseZ, actorHeight)) continue;
      const resolved = resolveCircleAgainstWall(geometry, position, radius);
      if (!resolved) continue;
      position.x = resolved.x;
      position.y = resolved.y;
      passCollided = true;
      collided = true;
    }
    if (!passCollided) break;
  }

  return collided;
}