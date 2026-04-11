// Shared types for R3F scene components

export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

/** Convert world coords (x=right, y=forward, z=up) → Three.js coords (x=right, z=back, y=up) */
export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}
