// backend/game/engine/rules/validateAction.ts

import { GameState } from "../state/types";
import { ABILITIES } from "../../abilities/abilities";
import { blocksCardTargeting } from "./guards";
import { calculateDistance } from "../state/types";
import { worldMap } from "../../map/worldMap";
import type { MapObject } from "../state/types/map";

/* =========================================================
   INTERNAL HELPERS
========================================================= */

function hasEffect(player: { buffs: any[] }, type: string) {
  return player.buffs.some((b: any) =>
    b.effects.some((e: any) => e.type === type)
  );
}

/**
 * Facing rule:
 * - Opponent-targeted abilities require 180° facing by default.
 * - Set faceDirection:false to explicitly opt out.
 */
function requiresFacing(ability: { target?: string; faceDirection?: boolean }): boolean {
  if (ability.target === "OPPONENT") return ability.faceDirection !== false;
  return ability.faceDirection === true;
}

/**
 * Check if a target is within 180° of the player's facing direction.
 */
function isInFacingHemisphere(
  player: { position: { x: number; y: number }; facing?: { x: number; y: number } },
  target: { position: { x: number; y: number } }
): boolean {
  const f = player.facing;
  if (!f) return true; // no facing data → allow
  const dx = target.position.x - player.position.x;
  const dy = target.position.y - player.position.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return true; // on top of each other → allow
  // dot product ≥ 0 means within 180°
  return (f.x * dx + f.y * dy) >= 0;
}

/**
 * Check if line-of-sight between two positions is blocked by any map object.
 * Uses 2D segment-vs-AABB test (ignores Z for now — structures are full-height blockers).
 */
function isLOSBlocked(
  ax: number, ay: number,
  bx: number, by: number,
  objects: MapObject[]
): boolean {
  for (const obj of objects) {
    if (segmentIntersectsAABB(ax, ay, bx, by, obj.x, obj.y, obj.x + obj.w, obj.y + obj.d)) {
      return true;
    }
  }
  return false;
}

/** 2D segment vs AABB intersection test. */
function segmentIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // X slab
  if (Math.abs(dx) < 1e-8) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Y slab
  if (Math.abs(dy) < 1e-8) {
    if (y1 < minY || y1 > maxY) return false;
  } else {
    let t1 = (minY - y1) / dy;
    let t2 = (maxY - y1) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/* =========================================================
   VALIDATE PLAY ABILITY (REAL-TIME BATTLE)
========================================================= */

/**
 * Validate ability cast in real-time battle
 * Checks: cooldown, range, silence
 */
export function validateCastAbility(
  state: GameState,
  playerIndex: number,
  abilityInstanceId: string
) {
  if (state.gameOver) {
    throw new Error("ERR_GAME_OVER");
  }

  const player = state.players[playerIndex];

  // Accept lookup by instanceId OR by abilityId (common abilities may be cast by abilityId)
  let instance = player.hand.find(
    (c) => c.instanceId === abilityInstanceId || (c.abilityId ?? (c as any).id) === abilityInstanceId
  );

  // Auto-inject common abilities missing from hand (legacy/in-progress games)
  if (!instance) {
    const maybeCommon = ABILITIES[abilityInstanceId];
    if (maybeCommon && (maybeCommon as any).isCommon) {
      const newInst = { instanceId: abilityInstanceId, abilityId: abilityInstanceId, cooldown: 0 };
      player.hand.push(newInst as any);
      instance = newInst as any;
    }
  }

  if (!instance) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }

  console.log("[validateCastAbility] DEBUG - ability instance:", {
    instanceId: instance.instanceId,
    abilityId: instance.abilityId,
    id: (instance as any).id,
    keys: Object.keys(instance).slice(0, 10),
  });

  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = instance.abilityId || (instance as any).id;
  const ability = ABILITIES[abilityId];
  if (!ability) {
    throw new Error("ERR_ABILITY_NOT_FOUND");
  }

  /* ================= COOLDOWN ================= */
  if (instance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= CHANNELING ================= */
  if ((player as any).activeChannel) {
    throw new Error("ERR_CHANNELING");
  }

  /* ================= SILENCE (Level 3 — not removable) ================= */
  if (hasEffect(player, "SILENCE")) {
    throw new Error("ERR_SILENCED");
  }

  /* ================= KNOCKED_BACK (Level 2 — not removable) ================= */
  if (hasEffect(player, "KNOCKED_BACK")) {
    const allowsKnockback =
      Array.isArray(ability.effects) &&
      ability.effects.some((e: any) => e.allowWhileKnockedBack === true);
    if (!allowsKnockback) {
      throw new Error("ERR_KNOCKED_BACK");
    }
  }

  /* ================= CONTROL / ATTACK_LOCK (Level 1 — removable) ================= */
  const isControlled =
    hasEffect(player, "CONTROL") || hasEffect(player, "ATTACK_LOCK");
  const allowsOverride =
    Array.isArray(ability.effects) &&
    ability.effects.some((e: any) => e.allowWhileControlled === true);
  if (isControlled && !allowsOverride) {
    throw new Error("ERR_CONTROLLED");
  }

  /* (Level 0 — ROOT / SLOW only restrict movement, spells are not blocked) */

  /* ================= REQUIRES GROUNDED ================= */
  if ((ability as any).requiresGrounded) {
    const playerZ = (player.position as any).z ?? 0;
    if (playerZ > 0.5) {
      throw new Error("ERR_REQUIRES_GROUNDED");
    }
  }

  /* ================= RANGE CHECK ================= */
  if (ability.range !== undefined) {
    const distance = calculateDistance(
      state.players[playerIndex].position,
      state.players[playerIndex === 0 ? 1 : 0].position
    );

    if (distance > ability.range) {
      throw new Error("ERR_OUT_OF_RANGE");
    }

    if (ability.minRange !== undefined && distance < ability.minRange) {
      throw new Error("ERR_TOO_CLOSE");
    }
  }

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */
  if (ability.target === "OPPONENT") {
    const enemyIndex = playerIndex === 0 ? 1 : 0;
    const enemy = state.players[enemyIndex];

    if (blocksCardTargeting(enemy)) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }

    /* ================= FACE DIRECTION (180°) ================= */
    if (requiresFacing(ability as any)) {
      if (!isInFacingHemisphere(player, enemy)) {
        throw new Error("ERR_NOT_FACING_TARGET");
      }
    }

    /* ================= LINE OF SIGHT (structure blocking) ================= */
    const mapObjects = worldMap.objects; // TODO: pass map context for arena mode
    if (isLOSBlocked(
      player.position.x, player.position.y,
      enemy.position.x, enemy.position.y,
      mapObjects
    )) {
      throw new Error("ERR_NO_LINE_OF_SIGHT");
    }
  }

  // ✅ All validations passed
}

/* =========================================================
   VALIDATE PLAY ABILITY (TURN-BASED - Legacy)
========================================================= */

export function validatePlayAbility(
  state: GameState,
  playerIndex: number,
  abilityInstanceId: string
) {
  if (state.gameOver) {
    throw new Error("ERR_GAME_OVER");
  }

  if (state.activePlayerIndex !== playerIndex) {
    throw new Error("ERR_NOT_YOUR_TURN");
  }

  const player = state.players[playerIndex];

  const instance = player.hand.find((c) => c.instanceId === abilityInstanceId);
  if (!instance) {
    throw new Error("ERR_ABILITY_NOT_IN_HAND");
  }

  // Ability can be referenced by either .abilityId or .id (depending on how it was populated)
  const abilityId = instance.abilityId || (instance as any).id;
  const ability = ABILITIES[abilityId];
  if (!ability) {
    throw new Error("ERR_ABILITY_NOT_FOUND");
  }

  /* ================= COOLDOWN ================= */

  if (instance.cooldown > 0) {
    throw new Error("ERR_ON_COOLDOWN");
  }

  /* ================= SILENCE (Level 3 — not removable) ================= */

  if (hasEffect(player, "SILENCE")) {
    throw new Error("ERR_SILENCED");
  }

  /* ================= KNOCKED_BACK (Level 2 — not removable) ================= */

  if (hasEffect(player, "KNOCKED_BACK")) {
    const allowsKnockback =
      Array.isArray(ability.effects) &&
      ability.effects.some((e) => (e as any).allowWhileKnockedBack === true);
    if (!allowsKnockback) {
      throw new Error("ERR_KNOCKED_BACK");
    }
  }

  /* ================= CONTROL / ATTACK_LOCK (Level 1 — removable) ================= */

  const isControlled =
    hasEffect(player, "CONTROL") || hasEffect(player, "ATTACK_LOCK");

  const allowsOverride =
    Array.isArray(ability.effects) &&
    ability.effects.some((e) => e.allowWhileControlled === true);

  if (isControlled && !allowsOverride) {
    throw new Error("ERR_CONTROLLED");
  }

  /* (Level 0 — ROOT / SLOW only restrict movement, spells are not blocked) */

  /* ================= TARGETING (STEALTH / UNTARGETABLE) ================= */

  // Only applies to opponent-targeted abilities
  if (ability.target === "OPPONENT") {
    const enemyIndex = playerIndex === 0 ? 1 : 0;
    const enemy = state.players[enemyIndex];

    if (blocksCardTargeting(enemy)) {
      throw new Error("ERR_TARGET_UNAVAILABLE");
    }
  }

  // ✅ All validations passed
}
