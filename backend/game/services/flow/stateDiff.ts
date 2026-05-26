// backend/game/services/flow/stateDiff.ts

/**
 * State diff utility (game-safe)
 *
 * Rules:
 * - NEVER replace root
 * - events: append-only
 * - fixed runtime arrays: patch by index so players/hand cooldowns do not fan
 *   out into whole-array replacements
 * - variable arrays: replace when length/order changes
 *
 * IMPORTANT:
 * - Designed for POLLING + EVENT HISTORY
 * - Events are persistent in DB and pruned separately
 * - Diff must be monotonic and idempotent
 */

export type DiffPatch = {
  path: string;
  value: any;
};

const APPEND_ONLY_KEYS = new Set(["events"]);
const INDEX_PATCH_KEYS = new Set(["players", "hand", "entities", "groundZones"]);

function pathKey(basePath: string): string | undefined {
  return basePath.split("/").filter(Boolean).pop();
}

function joinPath(basePath: string, key: string | number): string {
  const cleanBase = basePath === "/" ? "" : basePath;
  return `${cleanBase}/${key}`;
}

function identityForArrayItem(key: string, value: any): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (key === "players") return value.userId;
  if (key === "hand") return value.instanceId ?? value.abilityId ?? value.id;
  if (key === "entities" || key === "groundZones") return value.id;
  return undefined;
}

function canPatchArrayByIndex(key: string, prev: any[], next: any[]): boolean {
  if (!INDEX_PATCH_KEYS.has(key) || prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    const prevId = identityForArrayItem(key, prev[i]);
    const nextId = identityForArrayItem(key, next[i]);
    if ((prevId || nextId) && prevId !== nextId) return false;
  }
  return true;
}

export function diffState(
  prev: any,
  next: any,
  basePath = ""
): DiffPatch[] {
  const patches: DiffPatch[] = [];

  /* ================= ROOT SAFETY ================= */

  if (basePath === "") {
    return diffState(prev, next, "/");
  }

  /* ================= PRIMITIVES ================= */

  if (
    prev === null ||
    next === null ||
    typeof prev !== "object" ||
    typeof next !== "object"
  ) {
    if (prev !== next) {
      patches.push({ path: basePath, value: next });
    }
    return patches;
  }

  /* ================= ARRAYS ================= */

  if (Array.isArray(prev) && Array.isArray(next)) {
    const key = pathKey(basePath);

    /* ---------- append-only arrays (events) ---------- */
    if (key && APPEND_ONLY_KEYS.has(key)) {
      if (next.length > prev.length) {
        for (let i = prev.length; i < next.length; i++) {
          patches.push({ path: joinPath(basePath, i), value: next[i] });
        }
      }
      return patches;
    }

    if (key && canPatchArrayByIndex(key, prev, next)) {
      for (let i = 0; i < next.length; i++) {
        patches.push(...diffState(prev[i], next[i], joinPath(basePath, i)));
      }
      return patches;
    }

    /* ---------- variable arrays (buffs, pickups, etc) ---------- */
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      patches.push({ path: basePath, value: next });
    }
    return patches;
  }

  /* ================= OBJECTS ================= */

  const keys = new Set([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]);

  for (const key of keys) {
    const pVal = prev[key];
    const nVal = next[key];
    const path = joinPath(basePath, key);

    // removed
    if (!(key in next)) {
      patches.push({ path, value: undefined });
      continue;
    }

    // added
    if (!(key in prev)) {
      patches.push({ path, value: nVal });
      continue;
    }

    patches.push(...diffState(pVal, nVal, path));
  }

  return patches;
}
