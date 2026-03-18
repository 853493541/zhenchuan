// backend/game/engine/state/types/position.ts
// Position and movement types for real-time 2D battles

export interface Position {
  x: number;
  y: number;
  /** Vertical height above the arena floor (0 = ground). Added for jump support. */
  z?: number;
}

export interface Velocity {
  vx: number;
  vy: number;
  /** Vertical velocity — positive = rising, negative = falling. */
  vz?: number;
}

/**
 * Movement direction input from client
 * Can be combination of multiple directions (W+D = up+right)
 */
export interface MovementInput {
  up: boolean;    // W key
  down: boolean;  // S key
  left: boolean;  // A key
  right: boolean; // D key
  /** One-shot jump request — processed once per press, then cleared by GameLoop. */
  jump?: boolean;
  /** Precise normalized direction vector (传统模式). Overrides up/down/left/right when present. */
  dx?: number;
  dy?: number;
  /** Client-reported character facing direction (for server-side ability targeting). */
  facing?: { x: number; y: number };
}

/**
 * Calculate Euclidean distance between two positions
 */
export function calculateDistance(p1: Position, p2: Position): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = (p2.z ?? 0) - (p1.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate direction angle (in radians) from p1 to p2
 * Used for directional ability targeting
 */
export function calculateAngle(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}
