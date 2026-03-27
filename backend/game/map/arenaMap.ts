// backend/game/map/arenaMap.ts
// 200×200 square arena map — used for "Arena" mode (2-player focused combat).
//
// Players spawn at (90, 100) and (110, 100), 20 units apart, facing each other.
// Map boundary is enforced as a rectangle: (0,0) to (200,200).

import type { WorldMap, MapObject } from "../engine/state/types/map";

const objects: MapObject[] = [];

export const arenaMap: WorldMap = {
  width:  200,
  height: 200,
  objects,
};
