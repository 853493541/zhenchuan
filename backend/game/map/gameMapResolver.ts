import type { MapObject } from "../engine/state/types/map";
import { arenaMap } from "./arenaMap";
import { worldMap } from "./worldMap";
import { loadExportCollisionMap } from "./exportedMapResolver";

export interface BattleMapConfig {
  width: number;
  height: number;
  spawnCenterX: number;
  spawnCenterY: number;
}

export interface ResolvedGameMap extends BattleMapConfig {
  objects: MapObject[];
  source: "arena" | "pubg-default" | "pubg-export";
  exportPackageName: string | null;
}

export function resolveGameMap(
  mode: "arena" | "pubg",
  exportPackageName?: string | null,
): ResolvedGameMap {
  if (mode === "arena") {
    return {
      width: arenaMap.width,
      height: arenaMap.height,
      spawnCenterX: arenaMap.width / 2,
      spawnCenterY: arenaMap.height / 2,
      objects: arenaMap.objects,
      source: "arena",
      exportPackageName: null,
    };
  }

  if (exportPackageName && exportPackageName.trim().length > 0) {
    const imported = loadExportCollisionMap(exportPackageName);
    if (imported) {
      return {
        width: imported.width,
        height: imported.height,
        spawnCenterX: imported.spawnCenterX,
        spawnCenterY: imported.spawnCenterY,
        objects: imported.objects,
        source: "pubg-export",
        exportPackageName: imported.packageName,
      };
    }
  }

  return {
    width: worldMap.width,
    height: worldMap.height,
    spawnCenterX: worldMap.width / 2,
    spawnCenterY: worldMap.height / 2,
    objects: worldMap.objects,
    source: "pubg-default",
    exportPackageName: null,
  };
}

export function toBattleMapConfig(map: Pick<ResolvedGameMap, "width" | "height" | "spawnCenterX" | "spawnCenterY">): BattleMapConfig {
  return {
    width: map.width,
    height: map.height,
    spawnCenterX: map.spawnCenterX,
    spawnCenterY: map.spawnCenterY,
  };
}
