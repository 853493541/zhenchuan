// backend/game/engine/state/types/position.ts
// Position and movement types for real-time 2D battles

export interface Position {
  x: number;
  y: number;
}

export interface Velocity {
  vx: number;
  vy: number;
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
}

/**
 * Calculate Euclidean distance between two positions
 */
export function calculateDistance(p1: Position, p2: Position): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate direction angle (in radians) from p1 to p2
 * Used for directional ability targeting
 */
export function calculateAngle(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}
