// backend/game/engine/loop/movement.ts
/**
 * Movement logic for real-time 2D arena battles
 * Handles applying player input to position/velocity
 */

import { PlayerState, MovementInput } from "../state/types";

/**
 * Arena boundaries (in units)
 */
const ARENA_WIDTH = 100;
const ARENA_HEIGHT = 100;
const PLAYER_RADIUS = 2; // Collision size of player

/** Vertical physics constants (at ~30 Hz tick rate) */
const GRAVITY       = 0.04;  // units/tick² downward acceleration
const JUMP_VZ       = 0.346; // initial upward velocity on jump (peak ≈ 1.5 units per jump)
const POWER_JUMP_VZ = 0.98;  // boosted jump velocity for 弹跳 buff (~12 unit peak height)
const MAX_JUMPS = 2;     // allow double-jump

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

  if (!input) {
    // No input - decelerate (stop sliding)
    player.velocity.vx *= 0.9;
    player.velocity.vy *= 0.9;
  } else {
    // Calculate target velocity based on input
    let targetVx = 0;
    let targetVy = 0;

    // Note: Y is inverted in typical canvas coordinates (up is -y)
    if (input.up) targetVy -= player.moveSpeed;
    if (input.down) targetVy += player.moveSpeed;
    if (input.left) targetVx -= player.moveSpeed;
    if (input.right) targetVx += player.moveSpeed;

    // Smooth acceleration to target velocity
    const acceleration = 0.3;
    player.velocity.vx += (targetVx - player.velocity.vx) * acceleration;
    player.velocity.vy += (targetVy - player.velocity.vy) * acceleration;

    // Update facing direction from input (immediate, not velocity-lagged)
    if (targetVx !== 0 || targetVy !== 0) {
      const flen = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
      player.facing = { x: targetVx / flen, y: targetVy / flen };
    }

    // ── Jump (one-shot: GameLoop clears input.jump after each tick) ──
    if (input.jump && player.jumpCount < MAX_JUMPS) {
      // Check for 弹跳 buff (JUMP_BOOST) — consume it for a power jump
      const boostIdx = player.buffs.findIndex(
        (b) => b.effects.some((e) => e.type === "JUMP_BOOST")
      );
      player.velocity.vz = boostIdx >= 0 ? POWER_JUMP_VZ : JUMP_VZ;
      player.jumpCount += 1;
      if (boostIdx >= 0) {
        player.buffs.splice(boostIdx, 1); // consume the boost
      }
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

  // ── Z axis: gravity + landing ──
  player.velocity.vz! -= GRAVITY;
  player.position.z! += player.velocity.vz!;
  if (player.position.z! <= 0) {
    player.position.z  = 0;
    player.velocity.vz = 0;
    player.jumpCount   = 0; // restore jumps on landing
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
  const PLAYER_RADIUS = 2;
  player.position.x = Math.max(
    PLAYER_RADIUS,
    Math.min(ARENA_WIDTH - PLAYER_RADIUS, player.position.x)
  );
  player.position.y = Math.max(
    PLAYER_RADIUS,
    Math.min(ARENA_HEIGHT - PLAYER_RADIUS, player.position.y)
  );

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
