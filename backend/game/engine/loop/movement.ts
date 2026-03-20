// backend/game/engine/loop/movement.ts
/**
 * Movement logic for real-time 2D arena battles
 * Handles applying player input to position/velocity
 */

import { PlayerState, MovementInput } from "../state/types";
import type { MapObject } from "../state/types/map";
import { worldMap } from "../../map/worldMap";

/**
 * Arena boundaries (in units)
 */
const ARENA_WIDTH = 2000;
const ARENA_HEIGHT = 2000;
const PLAYER_RADIUS = 2; // Collision size of player

/**
 * Resolve a circle-vs-AABB collision between a player and a map object.
 * Pushes the player out of the obstacle and cancels velocity into it.
 */
function resolveObjectCollision(player: PlayerState, obj: MapObject): void {
  const pr = PLAYER_RADIUS;
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
 * Vertical physics (60 Hz tick rate) — symmetric gravity
 *
 * A single GRAVITY constant is used for both ascent and descent so that
 * rise time = fall time for every jump (natural parabolic arc).
 *
 * Tuned to the following targets:
 *   Single jump : rises to 1.7 units in exactly 1 second (60 ticks)
 *                 falls back to ground in exactly 1 second  → 2 s total
 *   Double jump : from wherever it fires, adds 1.3 units of height
 *                 (max peak = 3.0 if pressed at single-jump apex)
 *                 rise / fall ≈ 0.875 s each                → ~1.75 s extra
 *   Power jump  : 扶摇直上 – peaks at 12.8 units
 *                 rise / fall ≈ 2.74 s each                 → ~5.5 s total
 *
 * Asymmetric gravity, 60 Hz:
 *   Single jump : 1.7 u peak, 1.0 s rise (60 ticks), 0.7 s fall (42 ticks) → 1.7 s total
 *   Double jump : +0.67 u extra (peak 2.37 u), 1.45 s from 2nd press   → 2.45 s total from takeoff
 *   Power jump  : 12.8 u peak, 1.77 s rise (106.2 ticks), 1.93 s fall   → 3.7 s total
 *
 * Power jump uses separate gravity constants so its arc is steeper/faster.
 */
// ── Regular jump gravity (60 Hz) ──
const GRAVITY_UP     = 2 * 1.7 / (60 * 60);       // ≈ 0.000944  (60 ticks = 1.0 s rise)
const GRAVITY_DOWN   = 2 * 1.7 / (42 * 42);       // ≈ 0.001927  (42 ticks = 0.7 s fall)
const JUMP_VZ        = GRAVITY_UP * 60;            // ≈ 0.05667   – single jump (1.0 s → 1.7 u)
const DOUBLE_JUMP_VZ = GRAVITY_UP * 40;            // ≈ 0.03778   – double jump (+0.755 u → ~2.51 s total)
// ── Power jump gravity (扶摇直上, 60 Hz) ──
const POWER_GRAVITY_UP   = 2 * 12.8 / (106.2 * 106.2); // ≈ 0.002270  (106.2 ticks = 1.77 s rise)
const POWER_GRAVITY_DOWN = 2 * 12.8 / (115.8 * 115.8); // ≈ 0.001909  (115.8 ticks = 1.93 s fall)
const POWER_JUMP_VZ      = POWER_GRAVITY_UP * 106.2;    // ≈ 0.2411    – 12.8 u peak
const MAX_JUMPS = 2;           // default double-jump cap

/**
 * Apply movement input to player state
 *
 * Input is processed into velocity, applied to position each tick.
 * Movement is clamped to arena boundaries.
 *
 * @param player Player to move
 * @param input Current WASD input state
 * @param tickRate Game loop tick rate (Hz) for frame-independent movement
 */
export function applyMovement(
  player: PlayerState,
  input: MovementInput | null,
  tickRate: number
) {
  // ── initialise Z fields on older state objects that predate jumping ──
  if (player.position.z   === undefined) player.position.z   = 0;
  if (player.velocity.vz  === undefined) player.velocity.vz  = 0;
  if (player.jumpCount    === undefined) player.jumpCount     = 0;

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

  if (!input) {
    // No input - decelerate (stop sliding)
    player.velocity.vx *= 0.9;
    player.velocity.vy *= 0.9;
  } else {
    // Calculate target velocity based on input
    let targetVx = 0;
    let targetVy = 0;

    if (input.dx !== undefined || input.dy !== undefined) {
      // 传统模式: precise direction vector from client
      targetVx = (input.dx ?? 0) * effectiveMoveSpeed;
      targetVy = (input.dy ?? 0) * effectiveMoveSpeed;
    } else {
      // 摇杆模式: WASD boolean flags
      if (input.up)    targetVy -= effectiveMoveSpeed;
      if (input.down)  targetVy += effectiveMoveSpeed;
      if (input.left)  targetVx -= effectiveMoveSpeed;
      if (input.right) targetVx += effectiveMoveSpeed;
    }

    // Smooth acceleration to target velocity
    const acceleration = 0.3;
    player.velocity.vx += (targetVx - player.velocity.vx) * acceleration;
    player.velocity.vy += (targetVy - player.velocity.vy) * acceleration;

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

    // ── Jump (one-shot: GameLoop clears input.jump after each tick) ──
    // MULTI_JUMP buff overrides the default 2-jump cap.
    const multiJumpEffect = allEffects.find((e) => e.type === "MULTI_JUMP");
    const maxJumps = multiJumpEffect ? (multiJumpEffect.value ?? MAX_JUMPS) : MAX_JUMPS;
    if (input.jump && player.jumpCount < maxJumps) {
      // 弹跳 JUMP_BOOST: consumed immediately for a power jump, any jump number.
      const boostIdx = player.buffs.findIndex(
        (b) => b.effects.some((e) => e.type === "JUMP_BOOST")
      );
      if (boostIdx >= 0) {
        player.velocity.vz = POWER_JUMP_VZ;
        player.isPowerJump = true;
        player.buffs.splice(boostIdx, 1); // consume the buff instantly
      } else if (player.jumpCount === 0) {
        // First jump
        player.velocity.vz = JUMP_VZ;
        player.isPowerJump = false;
      } else {
        // Double / multi-jump: always 1.5× the first-jump height
        player.velocity.vz = DOUBLE_JUMP_VZ;
      }
      player.jumpCount += 1;
    }
  }

  // Apply XY velocity to position
  player.position.x += player.velocity.vx;
  player.position.y += player.velocity.vy;

  // Clamp position to arena boundaries
  const minX = PLAYER_RADIUS;
  const maxX = ARENA_WIDTH - PLAYER_RADIUS;
  const minY = PLAYER_RADIUS;
  const maxY = ARENA_HEIGHT - PLAYER_RADIUS;

  if (player.position.x < minX) {
    player.position.x = minX;
    player.velocity.vx = 0;
  }
  if (player.position.x > maxX) {
    player.position.x = maxX;
    player.velocity.vx = 0;
  }
  if (player.position.y < minY) {
    player.position.y = minY;
    player.velocity.vy = 0;
  }
  if (player.position.y > maxY) {
    player.position.y = maxY;
    player.velocity.vy = 0;
  }

  // ── Map object collision (AABB vs circle) ──
  for (const obj of worldMap.objects) {
    resolveObjectCollision(player, obj);
  }

  // ── Z axis: asymmetric gravity (power jump uses steeper separate constants) ──
  const gravUp   = player.isPowerJump ? POWER_GRAVITY_UP   : GRAVITY_UP;
  const gravDown = player.isPowerJump ? POWER_GRAVITY_DOWN  : GRAVITY_DOWN;
  player.velocity.vz! -= (player.velocity.vz! >= 0 ? gravUp : gravDown);
  player.position.z! += player.velocity.vz!;
  if (player.position.z! <= 0) {
    player.position.z  = 0;
    player.velocity.vz = 0;
    player.jumpCount   = 0; // restore jumps on landing
    player.isPowerJump = false;
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
  distance: number
) {
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
  player.position.x = Math.max(
    PLAYER_RADIUS,
    Math.min(ARENA_WIDTH - PLAYER_RADIUS, player.position.x)
  );
  player.position.y = Math.max(
    PLAYER_RADIUS,
    Math.min(ARENA_HEIGHT - PLAYER_RADIUS, player.position.y)
  );

  // Map object collision after forced move
  for (const obj of worldMap.objects) {
    resolveObjectCollision(player, obj);
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
  distance: number
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
      distance
    );
  } else {
    // Push away from source
    const pushX = sourceX + (dx / currentDist) * distance * 2;
    const pushY = sourceY + (dy / currentDist) * distance * 2;
    movePlayerTowards(player, pushX, pushY, distance);
  }
}

/**
 * Stun/root effect - stop player movement
 */
export function stopPlayerMovement(player: PlayerState) {
  player.velocity.vx = 0;
  player.velocity.vy = 0;
}
