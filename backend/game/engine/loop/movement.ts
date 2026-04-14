// backend/game/engine/loop/movement.ts
/**
 * Movement logic for real-time 2D arena battles
 * Handles applying player input to position/velocity
 */

import { PlayerState, MovementInput } from "../state/types";
import type { MapObject } from "../state/types/map";
import * as THREE from "three";
import { worldMap } from "../../map/worldMap";
import {
  EXPORTED_COLLISION_GROUP_POS_X,
  EXPORTED_COLLISION_GROUP_POS_Y,
  EXPORTED_COLLISION_GROUP_POS_Z,
  EXPORTED_COLLISION_RADIUS,
  EXPORTED_COLLISION_RENDER_SF,
  type ExportedMapCollisionSystem,
} from "../../map/exportedMapCollision";
import { DASH_CC_IMMUNE_BUFF_ID } from "../effects/definitions/DirectionalDash";

/**
 * Arena boundaries (in units)
 */
const ARENA_WIDTH = 2000;
const ARENA_HEIGHT = 2000;
const DEFAULT_PLAYER_RADIUS = 2; // Collision size of player

/** Passed by GameLoop to use the correct map for the current game mode. */
export interface MapContext {
  objects: import("../state/types/map").MapObject[];
  width: number;
  height: number;
  /** If true, enforce a circular boundary (center = width/2, height/2; radius = width/2). */
  circular?: boolean;
  /** Override player collision radius (default 2). Export-reader avatar uses ~0.32. */
  playerRadius?: number;
  /** Server-authoritative exported collision shell for collision-test mode. */
  collisionSystem?: ExportedMapCollisionSystem | null;
}

const BVH_STEP_UP_LIMIT = 56;
const BVH_RECOVERY_DROP = 3500;
const BVH_RECOVERY_LIFT = 120;
// Cylinder collision: half-height in game units (character 2.0 m tall)
const CYL_HALF_HEIGHT_GAME = 1.0;
const EXPORTED_CYLINDER_HALF_HEIGHT = CYL_HALF_HEIGHT_GAME / EXPORTED_COLLISION_RENDER_SF; // ~90 export units
const _bvhCenter = new THREE.Vector3();
const _bvhVelocity = new THREE.Vector3();

/** Clamp player position to a circular boundary without bounce. */
function clampToCircle(player: PlayerState, cx: number, cy: number, maxR: number): void {
  const dx = player.position.x - cx;
  const dy = player.position.y - cy;
  const distSq = dx * dx + dy * dy;
  if (distSq <= maxR * maxR) return;
  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  player.position.x = cx + nx * maxR;
  player.position.y = cy + ny * maxR;
}

/**
 * Check if player center is within the XY footprint of an AABB (with player radius).
 */
function isInsideXY(px: number, py: number, obj: MapObject, pr: number): boolean {
  const cx = Math.max(obj.x, Math.min(px, obj.x + obj.w));
  const cy = Math.max(obj.y, Math.min(py, obj.y + obj.d));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy < pr * pr;
}

/**
 * Resolve a circle-vs-AABB collision between a player and a map object.
 * Pushes the player out of the obstacle and cancels velocity into it.
 *
 * Z-aware: if the player's feet are at or above the object's top (obj.h),
 * no XY collision occurs — the player can walk on the roof.
 */
function resolveObjectCollision(player: PlayerState, obj: MapObject, playerRadius = DEFAULT_PLAYER_RADIUS): void {
  const pz = player.position.z ?? 0;

  // Player is above this object — no XY collision (can walk on roof)
  if (pz >= obj.h) return;
  const pr = playerRadius;
  const px = player.position.x;
  const py = player.position.y;

  // Closest point on the AABB to the player center
  const cx = Math.max(obj.x, Math.min(px, obj.x + obj.w));
  const cy = Math.max(obj.y, Math.min(py, obj.y + obj.d));
  const dx = px - cx;
  const dy = py - cy;
  const distSq = dx * dx + dy * dy;

  if (distSq >= pr * pr) return; // no overlap

  if (distSq < 1e-6) {
    // Player center is fully inside AABB — push out through nearest edge
    const dL = px - obj.x;
    const dR = obj.x + obj.w - px;
    const dT = py - obj.y;
    const dB = obj.y + obj.d - py;
    const min = Math.min(dL, dR, dT, dB);
    if (min === dL) { player.position.x = obj.x - pr;           player.velocity.vx = Math.min(0, player.velocity.vx); }
    else if (min === dR) { player.position.x = obj.x + obj.w + pr; player.velocity.vx = Math.max(0, player.velocity.vx); }
    else if (min === dT) { player.position.y = obj.y - pr;           player.velocity.vy = Math.min(0, player.velocity.vy); }
    else                 { player.position.y = obj.y + obj.d + pr; player.velocity.vy = Math.max(0, player.velocity.vy); }
    return;
  }

  const dist = Math.sqrt(distSq);
  const nx = dx / dist; // outward normal from obstacle surface toward player
  const ny = dy / dist;
  const penetration = pr - dist;

  // Push player out of obstacle
  player.position.x += nx * penetration;
  player.position.y += ny * penetration;

  // Cancel velocity component going into the obstacle (preserve sliding)
  const velDot = player.velocity.vx * nx + player.velocity.vy * ny;
  if (velDot < 0) {
    player.velocity.vx -= velDot * nx;
    player.velocity.vy -= velDot * ny;
  }
}

/**
 * Get the ground height at a player's XY position.
 * Returns the height of the tallest object whose footprint the player overlaps
 * AND whose top is at or below the player's current Z (i.e. the player is above it).
 * Returns 0 if no such object exists (player is on the open arena floor).
 *
 * The pz check prevents a ground-level player from being "teleported" to a
 * rooftop just because their XY footprint overlaps during a sideways collision.
 */
function getGroundHeight(px: number, py: number, pz: number, objects: MapObject[], pr = DEFAULT_PLAYER_RADIUS): number {
  let ground = 0;
  for (const obj of objects) {
    // Only count objects the player is above (or at the surface of)
    if (pz >= obj.h - 0.1 && isInsideXY(px, py, obj, pr) && obj.h > ground) {
      ground = obj.h;
    }
  }
  return ground;
}

function hasExportedCollision(mapCtx?: MapContext): mapCtx is MapContext & { collisionSystem: ExportedMapCollisionSystem } {
  return !!mapCtx?.collisionSystem;
}

function syncExportCenter(px: number, py: number, pz: number, arenaW: number, arenaH: number, _playerRadius: number): THREE.Vector3 {
  const halfW = arenaW / 2;
  const halfH = arenaH / 2;
  _bvhCenter.set(
    (px - halfW - EXPORTED_COLLISION_GROUP_POS_X) / EXPORTED_COLLISION_RENDER_SF,
    // Cylinder centre = feetY + half-height (not feetY + sphere radius)
    (pz - EXPORTED_COLLISION_GROUP_POS_Y) / EXPORTED_COLLISION_RENDER_SF + EXPORTED_CYLINDER_HALF_HEIGHT,
    (halfH - py - EXPORTED_COLLISION_GROUP_POS_Z) / EXPORTED_COLLISION_RENDER_SF,
  );
  return _bvhCenter;
}

function applyHorizontalFromExportCenter(
  player: PlayerState,
  center: THREE.Vector3,
  arenaW: number,
  arenaH: number,
  playerRadius: number,
): void {
  const halfW = arenaW / 2;
  const halfH = arenaH / 2;
  player.position.x = Math.max(
    playerRadius,
    Math.min(arenaW - playerRadius, center.x * EXPORTED_COLLISION_RENDER_SF + EXPORTED_COLLISION_GROUP_POS_X + halfW),
  );
  player.position.y = Math.max(
    playerRadius,
    Math.min(arenaH - playerRadius, halfH - (center.z * EXPORTED_COLLISION_RENDER_SF + EXPORTED_COLLISION_GROUP_POS_Z)),
  );
}

function getExportedGroundHeight(
  px: number,
  py: number,
  pz: number,
  arenaW: number,
  arenaH: number,
  playerRadius: number,
  collisionSystem: ExportedMapCollisionSystem,
): number {
  const center = syncExportCenter(px, py, pz, arenaW, arenaH, playerRadius);
  const groundExportY = collisionSystem.getSupportGroundY(center);
  return groundExportY === null
    ? 0
    : groundExportY * EXPORTED_COLLISION_RENDER_SF + EXPORTED_COLLISION_GROUP_POS_Y;
}

function resolveExportedHorizontalCollision(
  player: PlayerState,
  arenaW: number,
  arenaH: number,
  playerRadius: number,
  collisionSystem: ExportedMapCollisionSystem,
): void {
  const center = syncExportCenter(player.position.x, player.position.y, player.position.z ?? 0, arenaW, arenaH, playerRadius);
  // Horizontal-only velocity (vertical handled in separate pass)
  _bvhVelocity.set(0, 0, 0);
  collisionSystem.resolveSphereCollision(center, EXPORTED_COLLISION_RADIUS, _bvhVelocity);
  applyHorizontalFromExportCenter(player, center, arenaW, arenaH, playerRadius);
  // Do NOT read _bvhVelocity.y — wall contacts must not corrupt vertical velocity
}

function resolveExportedVerticalCollision(
  player: PlayerState,
  arenaW: number,
  arenaH: number,
  playerRadius: number,
  collisionSystem: ExportedMapCollisionSystem,
): number {
  // center.y = cylinder centre = feetY (player.position.z) + half-height
  // player.position.z already has gravity applied by the caller.
  const center = syncExportCenter(player.position.x, player.position.y, player.position.z ?? 0, arenaW, arenaH, playerRadius);

  const groundExportY = collisionSystem.getSupportGroundY(center);
  const feetExportY   = center.y - EXPORTED_CYLINDER_HALF_HEIGHT;
  let bvhOnGround = false;

  if (groundExportY !== null) {
    const gap = feetExportY - groundExportY; // negative → below surface
    if (gap <= 0) {
      // Feet at or below terrain surface → snap up and land
      center.y = groundExportY + EXPORTED_CYLINDER_HALF_HEIGHT;
      player.velocity.vz = 0;
      bvhOnGround = true;
    } else if (
      gap <= BVH_STEP_UP_LIMIT &&
      (player.velocity.vz ?? 0) <= 0 &&
      (player.jumpCount ?? 0) === 0
    ) {
      // Step-up: small gap while falling/standing (e.g. stair lip)
      center.y = groundExportY + EXPORTED_CYLINDER_HALF_HEIGHT;
      player.velocity.vz = 0;
      bvhOnGround = true;
    }
  }

  // Fall recovery
  const floorExportY = groundExportY ?? feetExportY;
  if (feetExportY < floorExportY - BVH_RECOVERY_DROP) {
    center.y = floorExportY + EXPORTED_CYLINDER_HALF_HEIGHT + BVH_RECOVERY_LIFT;
    player.velocity.vz = 0;
  }

  // Feet = cylinder bottom → exact terrain surface, no slope offset
  player.position.z = (center.y - EXPORTED_CYLINDER_HALF_HEIGHT) * EXPORTED_COLLISION_RENDER_SF + EXPORTED_COLLISION_GROUP_POS_Y;

  // Return postMoveGroundH for caller's landing check: player.position.z <= postMoveGroundH
  return bvhOnGround
    ? player.position.z
    : groundExportY !== null
      ? groundExportY * EXPORTED_COLLISION_RENDER_SF + EXPORTED_COLLISION_GROUP_POS_Y
      : player.position.z;
}

function resolveExportedRecovery(
  player: PlayerState,
  arenaW: number,
  arenaH: number,
  playerRadius: number,
  collisionSystem: ExportedMapCollisionSystem,
): void {
  const center = syncExportCenter(player.position.x, player.position.y, player.position.z ?? 0, arenaW, arenaH, playerRadius);
  // Horizontal wall push only (no vertical velocity input)
  _bvhVelocity.set(0, 0, 0);
  collisionSystem.resolveSphereCollision(center, EXPORTED_COLLISION_RADIUS, _bvhVelocity);
  applyHorizontalFromExportCenter(player, center, arenaW, arenaH, playerRadius);

  const groundExportY = collisionSystem.getSupportGroundY(center);
  if (groundExportY === null) return;

  const groundH = groundExportY * EXPORTED_COLLISION_RENDER_SF + EXPORTED_COLLISION_GROUP_POS_Y;
  if ((player.position.z ?? 0) <= groundH + 0.25 && (player.velocity.vz ?? 0) <= 0) {
    player.position.z = groundH;
    player.velocity.vz = 0;
  }
}

/**
 * Unit scale: movement/jump physics in this file are expressed in "new units".
 * 1 new unit = 2.2 old world units (derived from map measurement: same house
 * is 22 new units tall in our world and 10 units in the reference game → ×2.2).
 * Map coordinates and collision never change — only locomotion/jump physics are scaled here.
 */
const UNIT_SCALE = 2.2;

/**
 * Vertical physics (30 Hz tick rate)
 *
 * Asymmetric gravity, 30 Hz.  Heights below are in NEW units; actual world
 * displacement = height × UNIT_SCALE.
 *   Single jump : 1.7 u peak, 1.0 s rise (30 ticks), 0.7 s fall (21 ticks) → 1.7 s total
 *   Double jump : +0.755 u extra (peak 2.455 u) → ~2.51 s total from takeoff
 *   Power jump  : 12.8 u peak, 1.77 s rise (53.1 ticks), 1.93 s fall (57.9 ticks) → 3.7 s total
 */
const GRAVITY_UP     = 2 * 1.7  * UNIT_SCALE / (30 * 30);        // ≈ 0.008311
const GRAVITY_DOWN   = 2 * 1.7  * UNIT_SCALE / (21 * 21);        // ≈ 0.016962
const JUMP_VZ        = GRAVITY_UP * 30;                           // ≈ 0.24933
const DOUBLE_JUMP_VZ = GRAVITY_UP * 20;                           // ≈ 0.16622
const POWER_GRAVITY_UP   = 2 * 12.8 * UNIT_SCALE / (53.1 * 53.1); // ≈ 0.019974
const POWER_GRAVITY_DOWN = 2 * 12.8 * UNIT_SCALE / (57.9 * 57.9); // ≈ 0.016799
const POWER_JUMP_VZ      = POWER_GRAVITY_UP * 53.1;                // ≈ 1.0606 (12.8 u peak)
// 扶摇直上 + 鸟翔碧空 combined: 24u peak, same 53.1-tick rise / 57.9-tick fall as power jump
const COMBINED_GRAVITY_UP   = 2 * 24 * UNIT_SCALE / (53.1 * 53.1); // = POWER_GRAVITY_UP × (24/12.8)
const COMBINED_GRAVITY_DOWN = 2 * 24 * UNIT_SCALE / (57.9 * 57.9);
const COMBINED_JUMP_VZ      = COMBINED_GRAVITY_UP * 53.1;            // ≈ 1.9886 (24 u peak)
const MAX_JUMPS = 2;           // default double-jump cap
const BASE_MOVE_SPEED_NEW_PER_SECOND = 5;
const UPWARD_JUMP_AIR_SHIFT_DISTANCE = 2 * UNIT_SCALE;
const DIRECTIONAL_JUMP_DISTANCE = 6 * UNIT_SCALE;
const AIR_SHIFT_DURATION_SECONDS = 1;
const MULTI_JUMP_HEIGHT_MULT = Math.sqrt(3); // 鸟翔碧空: 3× height → √3× velocity

function normalizePlanar(x: number, y: number): { x: number; y: number } | null {
  const len = Math.sqrt(x * x + y * y);
  if (len <= 0.01) return null;
  return { x: x / len, y: y / len };
}

function clearAirShift(player: PlayerState): void {
  player.airNudgeRemaining = 0;
  player.airNudgeTicksRemaining = 0;
  delete player.airNudgeDir;
  player.airDirectionLocked = false;
}

function clearAirborneSpeedCarry(player: PlayerState): void {
  player.airborneSpeedCarry = 0;
}

function getAirShiftSpeedPerTick(player: PlayerState): number {
  if ((player.airNudgeRemaining ?? 0) <= 0 || (player.airNudgeTicksRemaining ?? 0) <= 0) {
    return 0;
  }
  return (player.airNudgeRemaining ?? 0) / Math.max(1, player.airNudgeTicksRemaining ?? 0);
}

function rememberAirborneSpeedCarry(player: PlayerState, speedPerTick: number): void {
  if (!Number.isFinite(speedPerTick) || speedPerTick <= 0.0001) return;
  player.airborneSpeedCarry = speedPerTick;
}

function getJumpStartPlanarSpeed(player: PlayerState, effectiveMoveSpeed: number): number {
  return Math.max(
    effectiveMoveSpeed,
    player.airborneSpeedCarry ?? 0,
    Math.hypot(player.velocity.vx ?? 0, player.velocity.vy ?? 0),
    getAirShiftSpeedPerTick(player),
  );
}

function startAirShift(
  player: PlayerState,
  dir: { x: number; y: number },
  distance: number,
  ticks: number,
): void {
  player.airNudgeRemaining = Math.max(0, distance);
  player.airNudgeTicksRemaining = Math.max(0, ticks);
  player.airNudgeDir = { x: dir.x, y: dir.y };
  player.airDirectionLocked = true;
}

function estimateAirborneTicks(
  heightAboveGround: number,
  initialVz: number,
  gravityUp: number,
  gravityDown: number,
): number {
  let height = Math.max(0, heightAboveGround);
  let vz = initialVz;
  let ticks = 0;

  while (ticks < 360) {
    vz -= vz >= 0 ? gravityUp : gravityDown;
    height += vz;
    ticks += 1;
    if (height <= 0) return Math.max(1, ticks);
  }

  return 360;
}

/**
 * Apply movement input to player state
 *
 * Input is processed into velocity, applied to position each tick.
 * Movement is clamped to arena boundaries.
 *
 * @param player Player to move
 * @param input Current WASD input state
 * @param tickRate Game loop tick rate (Hz) for frame-independent movement
 * @param mapCtx   Optional map context (objects, width, height). Defaults to 2000×2000 worldMap.
 */
export function applyMovement(
  player: PlayerState,
  input: MovementInput | null,
  tickRate: number,
  mapCtx?: MapContext
) {
  const mapObjects = mapCtx?.objects ?? worldMap.objects;
  const arenaW     = mapCtx?.width  ?? ARENA_WIDTH;
  const arenaH     = mapCtx?.height ?? ARENA_HEIGHT;
  const pr         = mapCtx?.playerRadius ?? DEFAULT_PLAYER_RADIUS;
  const airShiftDurationTicks = Math.max(1, Math.round(tickRate * AIR_SHIFT_DURATION_SECONDS));
  const baseMoveSpeedPerTick = (BASE_MOVE_SPEED_NEW_PER_SECOND * UNIT_SCALE) / tickRate;
  // ── initialise Z fields on older state objects that predate jumping ──
  if (player.position.z   === undefined) player.position.z   = 0;
  if (player.velocity.vz  === undefined) player.velocity.vz  = 0;
  if (player.jumpCount    === undefined) player.jumpCount     = 0;
  if (player.airNudgeRemaining === undefined) player.airNudgeRemaining = 0;
  if (player.airNudgeTicksRemaining === undefined) player.airNudgeTicksRemaining = 0;
  if (player.airDirectionLocked === undefined) player.airDirectionLocked = false;
  if (player.airborneSpeedCarry === undefined) player.airborneSpeedCarry = 0;

  const currentGroundH = hasExportedCollision(mapCtx)
    ? getExportedGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, arenaW, arenaH, pr, mapCtx.collisionSystem)
    : getGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, mapObjects, pr);
  const wasAirborne = (player.position.z ?? 0) > currentGroundH + 0.01;

  const allEffects = player.buffs.flatMap((b) => b.effects);

  // ── Level 2 (KNOCKED_BACK) and Level 1 (CONTROL/stun/knockdown): ──
  // Both fully lock the player — no movement, no facing, no jump.
  const isFullyLocked =
    allEffects.some((e) => e.type === "KNOCKED_BACK") ||
    allEffects.some((e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK");
  if (isFullyLocked) {
    input = null;
  }

  // ── Level 0 ROOT: blocks WASD + facing direction + jump. ──
  // Camera movement is purely client-side and is unaffected.
  const isRooted = !isFullyLocked && allEffects.some((e) => e.type === "ROOT");
  if (isRooted && input) {
    input = {
      ...input,
      dx: 0,
      dy: 0,
      up: false,
      down: false,
      left: false,
      right: false,
      facing: undefined,
      jump: false,
    };
  }

  // 风来吴山 (buffId=1014): lock jump input while channeling.
  // This is a hard jump-disable, not a jump-cancel mechanic.
  const jumpLockedByFenglai = player.buffs.some((b: any) => b.buffId === 1014);
  if (jumpLockedByFenglai && input?.jump) {
    input = {
      ...input,
      jump: false,
    };
  }

  // ── 惯性 animated dash (蹑云逐月 / DIRECTIONAL_DASH momentum system) ────────
  // While activeDash is in progress the dash owns all movement. Normal input,
  // gravity, and XY velocity are suspended. Vertical velocity is captured on
  // the FIRST tick (not at HTTP-cast time) so any pending jump is processed
  // first — this eliminates the race where jump + dash are pressed together
  // and the jump gets swallowed.
  if (player.activeDash) {
    const dash = player.activeDash;

    // ── First tick: process pending jump, then capture vz ──────────────────
    if (dash.vzPerTick === undefined) {
      // Process a pending jump so "double-jump then instantly nieyun" works.
      const multiJumpEffect = allEffects.find((e) => e.type === "MULTI_JUMP");
      const maxJumps = multiJumpEffect ? (multiJumpEffect.value ?? MAX_JUMPS) : MAX_JUMPS;
      if (input?.jump && (player.jumpCount ?? 0) < maxJumps) {
        const isMultiJumpDashPending = !!multiJumpEffect;
        const boostIdx = player.buffs.findIndex(
          (b) => b.effects.some((e) => e.type === "JUMP_BOOST")
        );
        if (boostIdx >= 0) {
          if (isMultiJumpDashPending) {
            // Combined 扶摇 + 鸟翔碧空 pending dash-jump
            player.velocity.vz = COMBINED_JUMP_VZ;
            player.isPowerJumpCombined = true;
            player.isPowerJump = false;
          } else {
            player.velocity.vz = POWER_JUMP_VZ;
            player.isPowerJump = true;
            player.isPowerJumpCombined = false;
          }
          player.buffs.splice(boostIdx, 1);
        } else {
          // 鸟翔碧空: all jumps are full 3× strength
          player.velocity.vz = isMultiJumpDashPending
            ? JUMP_VZ * MULTI_JUMP_HEIGHT_MULT
            : (player.jumpCount ?? 0) === 0 ? JUMP_VZ : DOUBLE_JUMP_VZ;
        }
      }
      if (dash.forceVzPerTick !== undefined) {
        dash.vzPerTick = dash.forceVzPerTick;
      } else {
        const rawVz = player.velocity.vz ?? 0;

        // Dead zone: near the apex of a jump (|vz| very small) → horizontal dash.
        // Asymmetric: tiny upward vz (> 0.003) still counts as "rising" to preserve
        // the upward-dash feel. But negative vz must exceed -0.02 (~10 ticks of
        // falling) before the dash tilts downward — this gives a generous 0.17 s
        // window after the apex where the dash stays horizontal.
        // Scaled by UNIT_SCALE because vz values are now ×2.2 larger.
        const DEAD_ZONE_UP   = 0.006 * UNIT_SCALE;  // almost any upward motion → upward dash
        const DEAD_ZONE_DOWN = 0.04  * UNIT_SCALE;   // must fall for ~0.17s before dash tilts down

        if (rawVz > DEAD_ZONE_UP) {
          // Rising: dash upward, capped at max angle
          dash.vzPerTick = Math.min(rawVz, dash.maxUpVz);
        } else if (rawVz < -DEAD_ZONE_DOWN) {
          // Falling significantly: dash downward, capped at max angle
          dash.vzPerTick = Math.max(rawVz, dash.maxDownVz);
        } else {
          // Near apex / slight fall: horizontal dash
          dash.vzPerTick = 0;
        }
      }

      // Clear vz — the dash now owns vertical movement
      player.velocity.vz = 0;
      // Post-dash jump allowance: MULTI_JUMP → full reset (5 jumps), normal → 1 jump only
      const hasMultiJumpDash = allEffects.some((e) => e.type === "MULTI_JUMP");
      player.jumpCount = hasMultiJumpDash ? 0 : 1;
      clearAirShift(player);

      (dash as any)._startMs = Date.now();
      console.log(`[DASH] >>> START  time=${new Date().toISOString()}  ticks=${dash.ticksRemaining}`);
    }

    if (dash.snapUpUnits && !(dash as any)._snapApplied) {
      player.position.z = (player.position.z ?? 0) + dash.snapUpUnits * UNIT_SCALE;
      (dash as any)._snapApplied = true;
    }

    // Steering mode: keep moving forward, but heading follows live facing.
    if (dash.steerByFacing) {
      if (input?.facing) {
        const flen = Math.sqrt(input.facing.x * input.facing.x + input.facing.y * input.facing.y);
        if (flen > 0.01) {
          player.facing = { x: input.facing.x / flen, y: input.facing.y / flen };
        }
      }

      const facingNow = player.facing;
      if (facingNow) {
        const flen = Math.sqrt(facingNow.x * facingNow.x + facingNow.y * facingNow.y);
        if (flen > 0.01) {
          const nx = facingNow.x / flen;
          const ny = facingNow.y / flen;
          const speed = dash.speedPerTick ?? Math.sqrt(dash.vxPerTick * dash.vxPerTick + dash.vyPerTick * dash.vyPerTick);
          dash.vxPerTick = nx * speed;
          dash.vyPerTick = ny * speed;
        }
      }
    }

    rememberAirborneSpeedCarry(
      player,
      dash.speedPerTick ?? Math.sqrt(dash.vxPerTick * dash.vxPerTick + dash.vyPerTick * dash.vyPerTick),
    );

    // ── Apply dash movement ────────────────────────────────────────────────
    const prevX = player.position.x;
    const prevY = player.position.y;
    const intendedStepX = dash.vxPerTick;
    const intendedStepY = dash.vyPerTick;
    const intendedStep = Math.sqrt(intendedStepX * intendedStepX + intendedStepY * intendedStepY);

    // Sub-step XY to prevent wall tunneling. Fast dashes (疾 = 1.23 u/tick) can
    // teleport through thin walls in one step; dividing into smaller steps ensures
    // each collision pass can catch the penetration.
    const MAX_XY_SUBSTEP = pr * 0.85; // ~0.54 game units — well under any wall thickness
    const numSubSteps = Math.max(1, Math.ceil(intendedStep / MAX_XY_SUBSTEP));
    const subStepX = intendedStepX / numSubSteps;
    const subStepY = intendedStepY / numSubSteps;

    for (let _ss = 0; _ss < numSubSteps; _ss++) {
      player.position.x += subStepX;
      player.position.y += subStepY;

      // Arena bounds clamp per sub-step
      if (mapCtx?.circular) {
        const cx = arenaW / 2;
        const cy = arenaH / 2;
        clampToCircle(player, cx, cy, arenaW / 2 - pr);
      } else {
        const minX = pr; const maxX = arenaW - pr;
        const minY = pr; const maxY = arenaH - pr;
        if (player.position.x < minX) { player.position.x = minX; }
        if (player.position.x > maxX) { player.position.x = maxX; }
        if (player.position.y < minY) { player.position.y = minY; }
        if (player.position.y > maxY) { player.position.y = maxY; }
      }
      // Collision resolution per sub-step
      if (hasExportedCollision(mapCtx)) {
        resolveExportedHorizontalCollision(player, arenaW, arenaH, pr, mapCtx.collisionSystem);
      } else {
        for (const obj of mapObjects) {
          resolveObjectCollision(player, obj, pr);
        }
      }
    }

    // Apply frozen vertical velocity (gravity suspended)
    // In collision-test mode use BVH ground height; otherwise fall back to AABB.
    const dashGroundH = hasExportedCollision(mapCtx)
      ? getExportedGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, arenaW, arenaH, pr, mapCtx.collisionSystem)
      : getGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, mapObjects);
    player.position.z = Math.max(dashGroundH, player.position.z! + dash.vzPerTick);
    if (dash.useArcGravity) {
      const gUp = dash.arcGravityUpPerTick ?? 0;
      const gDown = dash.arcGravityDownPerTick ?? gUp;
      dash.vzPerTick -= (dash.vzPerTick >= 0 ? gUp : gDown);
    }
    if (player.position.z === dashGroundH && dash.vzPerTick < 0) {
      // Hit the ground (or rooftop) mid-dash — stop downward drift, keep going horizontally
      dash.vzPerTick = 0;
    }

    dash.ticksRemaining--;
    if (dash.ticksRemaining <= 0) {
      const elapsed = Date.now() - ((dash as any)._startMs ?? 0);
      console.log(`[DASH] <<< END    time=${new Date().toISOString()}  elapsed=${elapsed}ms  (expected ~1000ms for 30 ticks @ 30Hz)`);
      // Dash complete — gravity resets
      const dashEndGroundH = hasExportedCollision(mapCtx)
        ? getExportedGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, arenaW, arenaH, pr, mapCtx.collisionSystem)
        : getGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, mapObjects);
      if (player.position.z! <= dashEndGroundH + 0.01) {
        // On the ground (or rooftop): fully land
        player.position.z  = dashEndGroundH;
        player.velocity.vz = 0;
        player.jumpCount   = 0;
        clearAirShift(player);
        clearAirborneSpeedCarry(player);
      } else {
        // Airborne: start falling from rest (gravity reset)
        player.velocity.vz = 0;
        // Post-dash jump allowance: MULTI_JUMP → full reset, normal → 1 jump only
        const hasMultiJumpEnd = allEffects.some((e) => e.type === "MULTI_JUMP");
        player.jumpCount = hasMultiJumpEnd ? 0 : 1;
        clearAirShift(player);
      }
      player.isPowerJump = false;
      delete player.activeDash;
      // Remove dash CC immunity buff
      player.buffs = player.buffs.filter(b => b.buffId !== DASH_CC_IMMUNE_BUFF_ID);
    }

    if (dash.wallDiveOnBlock && intendedStep > 0.001) {
      const actualStepX = player.position.x - prevX;
      const actualStepY = player.position.y - prevY;
      const actualStep = Math.sqrt(actualStepX * actualStepX + actualStepY * actualStepY);
      if (actualStep < intendedStep * 0.35) {
        dash.vxPerTick = 0;
        dash.vyPerTick = 0;
        dash.steerByFacing = false;
        const diveVz = (dash.diveVzPerTick ?? -0.45) * UNIT_SCALE;
        dash.vzPerTick = Math.min(dash.vzPerTick ?? 0, diveVz);
      }
    }

    return; // Skip normal movement + normal gravity entirely
  }

  // ── Speed modifiers ──
  // SPEED_BOOST value = additive bonus fraction (e.g. 1.0 = +100% speed)
  // SLOW value        = additive reduction fraction (e.g. 0.5 = −50% speed)
  // Clamped to 0 so negative speed is impossible.
  const speedBoostSum = allEffects
    .filter((e) => e.type === "SPEED_BOOST")
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
  const slowSum = allEffects
    .filter((e) => e.type === "SLOW")
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
  const effectiveMoveSpeed =
    player.moveSpeed * Math.max(0, 1 + speedBoostSum - slowSum);

  if (!wasAirborne && (player.jumpCount ?? 0) === 0) {
    clearAirborneSpeedCarry(player);
  }

  let airInputDx = 0;
  let airInputDy = 0;
  let targetVx = 0;
  let targetVy = 0;

  if (!input) {
    // On ground: decelerate. In air: preserve existing horizontal momentum.
    if (!wasAirborne) {
      player.velocity.vx *= 0.9;
      player.velocity.vy *= 0.9;
    }
  } else {
    // Calculate target velocity based on input

    if (input.dx !== undefined || input.dy !== undefined) {
      // 传统模式: precise direction vector from client
      targetVx = (input.dx ?? 0) * effectiveMoveSpeed;
      targetVy = (input.dy ?? 0) * effectiveMoveSpeed;
    } else {
      // 摇杆模式: WASD boolean flags
      let inputX = 0;
      let inputY = 0;
      if (input.up)    inputY -= 1;
      if (input.down)  inputY += 1;
      if (input.left)  inputX -= 1;
      if (input.right) inputX += 1;

      const inputLen = Math.sqrt(inputX * inputX + inputY * inputY);
      if (inputLen > 0.01) {
        targetVx = (inputX / inputLen) * effectiveMoveSpeed;
        targetVy = (inputY / inputLen) * effectiveMoveSpeed;
      }
    }

    const hasDirectionalIntent =
      Math.abs(targetVx) > 0.01 || Math.abs(targetVy) > 0.01;
    const jumpAirborne = wasAirborne && (player.jumpCount ?? 0) > 0;
    if (wasAirborne || jumpAirborne) {
      const planarAirborneSpeed = Math.max(
        Math.hypot(player.velocity.vx ?? 0, player.velocity.vy ?? 0),
        getAirShiftSpeedPerTick(player),
      );
      rememberAirborneSpeedCarry(player, planarAirborneSpeed);
    }

    if (jumpAirborne) {
      airInputDx = targetVx;
      airInputDy = targetVy;
    } else {
      // Ground: normal accel/decel behavior.
      // Airborne: preserve momentum unless there is active directional intent.
      const acceleration = 0.3;
      if (!wasAirborne || hasDirectionalIntent) {
        player.velocity.vx += (targetVx - player.velocity.vx) * acceleration;
        player.velocity.vy += (targetVy - player.velocity.vy) * acceleration;
      }

      // Update facing direction from input (immediate, not velocity-lagged).
      // In traditional/MMO control, facing can intentionally differ from movement
      // (backpedal or strafe), so explicit input.facing takes precedence.
      if (input.facing) {
        const flen = Math.sqrt(input.facing.x * input.facing.x + input.facing.y * input.facing.y);
        if (flen > 0.01) {
          player.facing = { x: input.facing.x / flen, y: input.facing.y / flen };
        }
      } else if (targetVx !== 0 || targetVy !== 0) {
        const flen = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
        player.facing = { x: targetVx / flen, y: targetVy / flen };
      }
    }

    // ── Jump (one-shot: GameLoop clears input.jump after each tick) ──
    // MULTI_JUMP buff overrides the default 2-jump cap.
    const multiJumpEffect = allEffects.find((e) => e.type === "MULTI_JUMP");
    const maxJumps = multiJumpEffect ? (multiJumpEffect.value ?? MAX_JUMPS) : MAX_JUMPS;
    if (input.jump && player.jumpCount < maxJumps) {
      const isMultiJump = !!multiJumpEffect;
      const jumpDir = normalizePlanar(targetVx, targetVy);
      const isDirectionalJump = jumpDir !== null;
      const heightAboveGround = Math.max(0, (player.position.z ?? 0) - currentGroundH);
      let jumpGravityUp = GRAVITY_UP;
      let jumpGravityDown = GRAVITY_DOWN;
      let jumpVz = JUMP_VZ;
      // 弹跳 JUMP_BOOST: consumed immediately for a power jump, any jump number.
      const boostIdx = player.buffs.findIndex(
        (b) => b.effects.some((e) => e.type === "JUMP_BOOST")
      );
      if (boostIdx >= 0) {
        if (isMultiJump) {
          // Combined 扶摇直上 + 鸟翔碧空: 24u peak, same timing as power jump
          jumpVz = COMBINED_JUMP_VZ;
          jumpGravityUp = COMBINED_GRAVITY_UP;
          jumpGravityDown = COMBINED_GRAVITY_DOWN;
          player.velocity.vz = jumpVz;
          player.isPowerJumpCombined = true;
          player.isPowerJump = false;
        } else {
          jumpVz = POWER_JUMP_VZ;
          jumpGravityUp = POWER_GRAVITY_UP;
          jumpGravityDown = POWER_GRAVITY_DOWN;
          player.velocity.vz = jumpVz;
          player.isPowerJump = true;
          player.isPowerJumpCombined = false;
        }
        player.buffs.splice(boostIdx, 1); // consume the buff instantly
      } else if (player.jumpCount === 0) {
        // First jump (鸟翔碧空: 3× height)
        jumpVz = isMultiJump ? JUMP_VZ * MULTI_JUMP_HEIGHT_MULT : JUMP_VZ;
        player.velocity.vz = jumpVz;
        player.isPowerJump = false;
        player.isPowerJumpCombined = false;
      } else {
        // Double / multi-jump (鸟翔碧空: every jump is full 3× strength)
        jumpVz = isMultiJump ? JUMP_VZ * MULTI_JUMP_HEIGHT_MULT : DOUBLE_JUMP_VZ;
        player.velocity.vz = jumpVz;
        player.isPowerJump = false;
        player.isPowerJumpCombined = false;
      }
      const jumpStartPlanarSpeed = getJumpStartPlanarSpeed(player, effectiveMoveSpeed);
      player.velocity.vx = 0;
      player.velocity.vy = 0;
      player.jumpCount += 1;

      clearAirShift(player);
      rememberAirborneSpeedCarry(player, jumpStartPlanarSpeed);
      if (isDirectionalJump) {
        const speedScale = baseMoveSpeedPerTick > 0.0001
          ? jumpStartPlanarSpeed / baseMoveSpeedPerTick
          : 0;
        const jumpTravelTicks = estimateAirborneTicks(
          heightAboveGround,
          jumpVz,
          jumpGravityUp,
          jumpGravityDown,
        );
        startAirShift(
          player,
          jumpDir,
          DIRECTIONAL_JUMP_DISTANCE * Math.max(0, speedScale),
          jumpTravelTicks,
        );
        player.facing = { x: jumpDir.x, y: jumpDir.y };
      } else {
        // Upward jump: wait for the first mid-air direction input, then lock it for this jump phase.
        player.airNudgeRemaining = UPWARD_JUMP_AIR_SHIFT_DISTANCE;
      }
    }
  }

  // Upward jump: first mid-air direction input locks the drift direction for this jump phase.
  if (
    wasAirborne &&
    (player.airNudgeRemaining ?? 0) > 0 &&
    (player.airNudgeTicksRemaining ?? 0) <= 0 &&
    !input?.jump &&
    !player.airDirectionLocked
  ) {
    const dir = normalizePlanar(airInputDx, airInputDy);
    if (dir) {
      startAirShift(player, dir, player.airNudgeRemaining ?? 0, airShiftDurationTicks);
    }
  }

  // Animate correction over 1.0s instead of applying instantly.
  if (
    wasAirborne &&
    !input?.jump &&
    (player.airNudgeTicksRemaining ?? 0) > 0 &&
    (player.airNudgeRemaining ?? 0) > 0 &&
    player.airNudgeDir
  ) {
    const ticksLeft = Math.max(1, player.airNudgeTicksRemaining!);
    const step = Math.min(player.airNudgeRemaining!, player.airNudgeRemaining! / ticksLeft);
    player.position.x += player.airNudgeDir.x * step;
    player.position.y += player.airNudgeDir.y * step;
    player.airNudgeRemaining = Math.max(0, player.airNudgeRemaining! - step);
    player.airNudgeTicksRemaining = Math.max(0, player.airNudgeTicksRemaining! - 1);
    if (player.airNudgeRemaining <= 0 || player.airNudgeTicksRemaining <= 0) {
      player.airNudgeRemaining = 0;
      player.airNudgeTicksRemaining = 0;
      delete player.airNudgeDir;
    }
  }

  // Apply XY velocity to position
  player.position.x += player.velocity.vx;
  player.position.y += player.velocity.vy;

  // Clamp position to arena boundaries
  if (mapCtx?.circular) {
    const cx = arenaW / 2;
    const cy = arenaH / 2;
    clampToCircle(player, cx, cy, arenaW / 2 - pr);
  } else {
    const minX = pr;
    const maxX = arenaW - pr;
    const minY = pr;
    const maxY = arenaH - pr;
    if (player.position.x < minX) { player.position.x = minX; player.velocity.vx = 0; }
    if (player.position.x > maxX) { player.position.x = maxX; player.velocity.vx = 0; }
    if (player.position.y < minY) { player.position.y = minY; player.velocity.vy = 0; }
    if (player.position.y > maxY) { player.position.y = maxY; player.velocity.vy = 0; }
  }

  // ── Collision resolution ──
  if (hasExportedCollision(mapCtx)) {
    resolveExportedHorizontalCollision(player, arenaW, arenaH, pr, mapCtx.collisionSystem);
  } else {
    for (const obj of mapObjects) {
      resolveObjectCollision(player, obj, pr);
    }
  }

  // ── Z axis: asymmetric gravity (combined buff > power jump > regular) ──
  const gravUp   = player.isPowerJumpCombined ? COMBINED_GRAVITY_UP
                 : player.isPowerJump         ? POWER_GRAVITY_UP
                 : GRAVITY_UP;
  const gravDown = player.isPowerJumpCombined ? COMBINED_GRAVITY_DOWN
                 : player.isPowerJump         ? POWER_GRAVITY_DOWN
                 : GRAVITY_DOWN;
  player.velocity.vz! -= (player.velocity.vz! >= 0 ? gravUp : gravDown);
  player.position.z! += player.velocity.vz!;

  const postMoveGroundH = hasExportedCollision(mapCtx)
    ? resolveExportedVerticalCollision(player, arenaW, arenaH, pr, mapCtx.collisionSystem)
    : getGroundHeight(player.position.x, player.position.y, player.position.z ?? 0, mapObjects, pr);
  const isAirborneNow = player.position.z! > postMoveGroundH + 0.01;
  if (!wasAirborne && isAirborneNow && player.jumpCount === 0) {
    // Preserve limiter state for jump takeoff; only clear for non-jump airborne transitions.
    clearAirShift(player);
  }

  if (player.position.z! <= postMoveGroundH) {
    player.position.z  = postMoveGroundH;
    player.velocity.vz = 0;
    player.jumpCount   = 0; // restore jumps on landing
    player.isPowerJump = false;
    player.isPowerJumpCombined = false;
    clearAirShift(player);
    clearAirborneSpeedCarry(player);
  }
}

/**
 * Move a player towards a target position at given speed
 * Used by abilities (dash, charge, knockback, etc.)
 *
 * @param player Player to move
 * @param targetX Target X coordinate
 * @param targetY Target Y coordinate
 * @param distance How far to move towards target
 */
export function movePlayerTowards(
  player: PlayerState,
  targetX: number,
  targetY: number,
  distance: number,
  mapCtx?: MapContext
) {
  const mapObjects = mapCtx?.objects ?? worldMap.objects;
  const arenaW     = mapCtx?.width  ?? ARENA_WIDTH;
  const arenaH     = mapCtx?.height ?? ARENA_HEIGHT;
  const pr         = mapCtx?.playerRadius ?? DEFAULT_PLAYER_RADIUS;

  const dx = targetX - player.position.x;
  const dy = targetY - player.position.y;
  const currentDist = Math.sqrt(dx * dx + dy * dy);

  if (currentDist === 0) return; // Already at target

  const moveLength = Math.min(distance, currentDist);
  const moveX = (dx / currentDist) * moveLength;
  const moveY = (dy / currentDist) * moveLength;

  player.position.x += moveX;
  player.position.y += moveY;

  // Clamp to arena boundaries
  if (mapCtx?.circular) {
    const cx = arenaW / 2;
    const cy = arenaH / 2;
    const dx2 = player.position.x - cx;
    const dy2 = player.position.y - cy;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const maxR = arenaW / 2 - pr;
    if (d2 > maxR) {
      player.position.x = cx + (dx2 / d2) * maxR;
      player.position.y = cy + (dy2 / d2) * maxR;
    }
  } else {
    player.position.x = Math.max(
      pr,
      Math.min(arenaW - pr, player.position.x)
    );
    player.position.y = Math.max(
      pr,
      Math.min(arenaH - pr, player.position.y)
    );
  }

  // Collision after forced move
  if (hasExportedCollision(mapCtx)) {
    resolveExportedRecovery(player, arenaW, arenaH, pr, mapCtx.collisionSystem);
  } else {
    for (const obj of mapObjects) {
      resolveObjectCollision(player, obj, pr);
    }
  }

  // Stop velocity when forced to move
  player.velocity.vx = 0;
  player.velocity.vy = 0;
}

/**
 * Knockback effect - push player away from target
 *
 * @param player Player to knockback
 * @param sourceX Source of knockback (X coordinate)
 * @param sourceY Source of knockback (Y coordinate)
 * @param distance How far to push
 */
export function knockbackPlayer(
  player: PlayerState,
  sourceX: number,
  sourceY: number,
  distance: number,
  mapCtx?: MapContext
) {
  const dx = player.position.x - sourceX;
  const dy = player.position.y - sourceY;
  const currentDist = Math.sqrt(dx * dx + dy * dy);

  if (currentDist === 0) {
    // Player is at source, push in random direction
    const angle = Math.random() * Math.PI * 2;
    movePlayerTowards(
      player,
      sourceX + Math.cos(angle) * distance * 2,
      sourceY + Math.sin(angle) * distance * 2,
      distance,
      mapCtx
    );
  } else {
    // Push away from source
    const pushX = sourceX + (dx / currentDist) * distance * 2;
    const pushY = sourceY + (dy / currentDist) * distance * 2;
    movePlayerTowards(player, pushX, pushY, distance, mapCtx);
  }
}

/**
 * Stun/root effect - stop player movement
 */
export function stopPlayerMovement(player: PlayerState) {
  player.velocity.vx = 0;
  player.velocity.vy = 0;
}

/**
 * Resolve map object collisions for a player (push out of obstacles).
 * Call this after any forced position update (knockback, teleport, etc.)
 * to prevent the player from ending up inside a wall.
 */
export function resolveMapCollisions(player: PlayerState, mapCtx?: MapContext): void {
  const mapObjects = mapCtx?.objects ?? worldMap.objects;
  const arenaW = mapCtx?.width ?? ARENA_WIDTH;
  const arenaH = mapCtx?.height ?? ARENA_HEIGHT;
  const pr = mapCtx?.playerRadius ?? DEFAULT_PLAYER_RADIUS;
  if (hasExportedCollision(mapCtx)) {
    resolveExportedRecovery(player, arenaW, arenaH, pr, mapCtx.collisionSystem);
    return;
  }
  for (const obj of mapObjects) {
    resolveObjectCollision(player, obj, pr);
  }
}
