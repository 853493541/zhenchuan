// backend/game/engine/state/types/map.ts

export type MapObjectType = 'building' | 'rock' | 'mountain' | 'hill_high' | 'hill_low';

export interface MapObject {
  id: string;
  type: MapObjectType;
  /** Min X corner (world units) */
  x: number;
  /** Min Y corner (world units) */
  y: number;
  /** Width (X extent, world units) */
  w: number;
  /** Depth (Y extent, world units) */
  d: number;
  /** Visual + collision height (Z extent, world units) */
  h: number;
}

export interface WorldMap {
  width: number;
  height: number;
  objects: MapObject[];
}
