// backend/game/services/flow/stateDiff.ts

/**
 * State diff utility (game-safe)
 *
 * Rules:
 * - NEVER replace root
 * - events: append-only
 * - hand arrays: replace (abilities are permanent, cooldown tracked)
 * - small arrays: replace
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
    const key = basePath.split("/").pop();

    /* ---------- append-only arrays (events) ---------- */
    if (key && APPEND_ONLY_KEYS.has(key)) {
      if (next.length > prev.length) {
        for (let i = prev.length; i < next.length; i++) {
          patches.push({
            path: `${basePath}/${i}`,
            value: next[i],
          });
        }
      }
      return patches;
    }

    /* ---------- small arrays (hand, buffs, etc) ---------- */
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
    const path = `${basePath}/${key}`;

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
