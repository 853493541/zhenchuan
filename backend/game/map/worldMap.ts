// backend/game/map/worldMap.ts
// Static 2000×2000 world map — loaded once, used for collision and sent to clients.
//
// Object coordinate system:
//   x, y  = min corner (bottom-left of object on the ground plane)
//   w, d  = full width (X extent) and depth (Y extent)
//   h     = full visual + collision height (Z extent from ground)
//
// Players spawn near (985, 1000) and (1015, 1000).
// No objects are placed within ~100 units of the spawn center.

import type { WorldMap, MapObject } from "../engine/state/types/map";

const objects: MapObject[] = [
  // ══════════════════════════════════════════════════════
  // CENTER BLOCK — 10×10×10 building for testing structures
  // ══════════════════════════════════════════════════════
  { id: 'center_wall1', type: 'building', x: 995, y: 995, w: 10, d: 10, h: 10 },

  // ══════════════════════════════════════════════════════
  // MOUNTAINS — large, tall, dark earth tones
  // ══════════════════════════════════════════════════════
  { id: 'm1', type: 'mountain', x:   20, y:   30, w: 140, d: 120, h: 45 }, // NW corner
  { id: 'm2', type: 'mountain', x:  320, y:  200, w: 110, d:  90, h: 30 }, // NW inner
  { id: 'm3', type: 'mountain', x: 1760, y:   40, w: 180, d: 150, h: 50 }, // NE corner
  { id: 'm4', type: 'mountain', x:   60, y: 1760, w: 150, d: 140, h: 42 }, // SW corner
  { id: 'm5', type: 'mountain', x: 1750, y: 1800, w: 180, d: 160, h: 55 }, // SE corner

  // ══════════════════════════════════════════════════════
  // HIGH HILLS — medium sized, moderate height, green-brown
  // ══════════════════════════════════════════════════════
  { id: 'hh1', type: 'hill_high', x:  160, y:  610, w:  90, d:  75, h: 15 }, // W mid
  { id: 'hh2', type: 'hill_high', x: 1250, y:  320, w:  85, d:  70, h: 16 }, // NE area
  { id: 'hh3', type: 'hill_high', x:  280, y: 1300, w:  80, d:  70, h: 14 }, // W south
  { id: 'hh4', type: 'hill_high', x: 1420, y: 1260, w:  88, d:  72, h: 16 }, // SE area
  { id: 'hh5', type: 'hill_high', x:  600, y:  220, w:  75, d:  65, h: 13 }, // NW mid
  { id: 'hh6', type: 'hill_high', x: 1580, y: 1480, w:  82, d:  70, h: 15 }, // SE
  { id: 'hh7', type: 'hill_high', x:  580, y: 1680, w:  75, d:  65, h: 13 }, // SW
  { id: 'hh8', type: 'hill_high', x: 1680, y:  730, w:  82, d:  72, h: 15 }, // E mid

  // ══════════════════════════════════════════════════════
  // LOW HILLS — wide footprint, gentle slope feel, green
  // ══════════════════════════════════════════════════════
  { id: 'lh1',  type: 'hill_low', x:  430, y:  480, w:  70, d:  55, h:  5 },
  { id: 'lh2',  type: 'hill_low', x: 1820, y:  600, w:  62, d:  52, h:  4 },
  { id: 'lh3',  type: 'hill_low', x:  360, y: 1640, w:  65, d:  52, h:  5 },
  { id: 'lh4',  type: 'hill_low', x: 1270, y: 1730, w:  60, d:  50, h:  4 },
  { id: 'lh5',  type: 'hill_low', x:  780, y:  360, w:  55, d:  45, h:  4 }, // N of spawn
  { id: 'lh6',  type: 'hill_low', x: 1360, y:  530, w:  58, d:  48, h:  4 }, // NE of center
  { id: 'lh7',  type: 'hill_low', x:  720, y: 1640, w:  58, d:  48, h:  4 },
  { id: 'lh8',  type: 'hill_low', x: 1100, y: 1780, w:  55, d:  45, h:  3 }, // S
  { id: 'lh9',  type: 'hill_low', x:  200, y:  920, w:  48, d:  40, h:  3 }, // W of spawn
  { id: 'lh10', type: 'hill_low', x: 1700, y: 1100, w:  55, d:  45, h:  4 }, // E of spawn

  // ══════════════════════════════════════════════════════
  // BUILDINGS — stone blocks, mid-height, clustered
  // ══════════════════════════════════════════════════════
  { id: 'b1',  type: 'building', x:  560, y:  200, w:  30, d:  24, h: 14 }, // NW village
  { id: 'b2',  type: 'building', x:  680, y:  260, w:  35, d:  28, h: 16 }, // NW village
  { id: 'b3',  type: 'building', x:  130, y:  800, w:  24, d:  20, h: 12 }, // W outpost
  { id: 'b4',  type: 'building', x: 1420, y:  200, w:  32, d:  26, h: 13 }, // NE town
  { id: 'b5',  type: 'building', x: 1640, y:  400, w:  28, d:  22, h: 11 }, // NE town
  { id: 'b6',  type: 'building', x: 1130, y:  740, w:  38, d:  30, h: 15 }, // E approach
  { id: 'b7',  type: 'building', x:  660, y: 1060, w:  24, d:  20, h: 10 }, // W approach
  { id: 'b8',  type: 'building', x: 1310, y:  970, w:  26, d:  22, h: 12 }, // E approach
  { id: 'b9',  type: 'building', x:  680, y: 1820, w:  30, d:  24, h: 13 }, // SW town
  { id: 'b10', type: 'building', x: 1700, y: 1340, w:  28, d:  24, h: 12 }, // SE outpost
  { id: 'b11', type: 'building', x:  340, y: 1370, w:  32, d:  26, h: 13 }, // SW
  { id: 'b12', type: 'building', x: 1670, y:  720, w:  26, d:  22, h: 11 }, // E corridor
  { id: 'b13', type: 'building', x:  880, y: 1640, w:  30, d:  25, h: 12 }, // S of spawn

  // ══════════════════════════════════════════════════════
  // ROCKS — small dark stone clusters
  // ══════════════════════════════════════════════════════
  { id: 'r1',  type: 'rock', x:  155, y:  290, w: 18, d: 14, h: 10 },
  { id: 'r2',  type: 'rock', x:  182, y:  310, w: 10, d: 10, h:  7 }, // cluster with r1
  { id: 'r3',  type: 'rock', x:  280, y:  720, w: 16, d: 13, h:  9 },
  { id: 'r4',  type: 'rock', x: 1340, y:  490, w: 14, d: 12, h:  8 },
  { id: 'r5',  type: 'rock', x: 1382, y:  512, w:  8, d:  8, h:  5 }, // cluster with r4
  { id: 'r6',  type: 'rock', x:  500, y: 1220, w: 15, d: 12, h:  8 },
  { id: 'r7',  type: 'rock', x: 1180, y: 1420, w: 13, d: 11, h:  7 },
  { id: 'r8',  type: 'rock', x:  740, y:  930, w: 12, d: 10, h:  6 }, // W of spawn
  { id: 'r9',  type: 'rock', x: 1260, y: 1060, w: 14, d: 12, h:  7 }, // E of spawn
  { id: 'r10', type: 'rock', x:  510, y:  650, w: 10, d:  9, h:  6 },
  { id: 'r11', type: 'rock', x: 1520, y: 1210, w: 12, d: 11, h:  7 },
  { id: 'r12', type: 'rock', x:  790, y: 1520, w: 13, d: 11, h:  6 }, // S of spawn
  { id: 'r13', type: 'rock', x: 1420, y: 1630, w: 12, d: 10, h:  7 },
  { id: 'r14', type: 'rock', x:  230, y: 1220, w: 10, d:  9, h:  6 },
  { id: 'r15', type: 'rock', x: 1770, y:  420, w: 10, d:  9, h:  6 },

  // ══════════════════════════════════════════════════════
  // SPAWN-AREA LANDMARKS — within 80-180 units of center (985,1000)
  // ══════════════════════════════════════════════════════
  { id: 'rn1', type: 'rock',     x:  865, y:  920, w: 14, d: 12, h:  8 }, // NW of spawn
  { id: 'rn2', type: 'rock',     x: 1100, y: 1060, w: 12, d: 10, h:  7 }, // NE of spawn
  { id: 'rn3', type: 'rock',     x:  930, y: 1110, w: 14, d: 12, h:  8 }, // S of spawn
  { id: 'rn4', type: 'rock',     x: 1050, y:  870, w: 13, d: 11, h:  7 }, // N of spawn
  { id: 'lhn1', type: 'hill_low', x:  810, y:  950, w: 55, d: 45, h:  4 }, // W of spawn
  { id: 'lhn2', type: 'hill_low', x: 1120, y: 1040, w: 50, d: 42, h:  4 }, // E of spawn
];

export const worldMap: WorldMap = {
  width:  2000,
  height: 2000,
  objects,
};
