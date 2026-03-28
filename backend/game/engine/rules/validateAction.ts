// backend/game/engine/rules/validateAction.ts

import { GameState } from "../state/types";
import { ABILITIES } from "../../abilities/abilities";
import { blocksCardTargeting } from "./guards";
import { calculateDistance } from "../state/types";

/* =========================================================
   INTERNAL HELPERS
========================================================= */

function hasEffect(player: { buffs: any[] }, type: string) {
  return player.buffs.some((b: any) =>
    b.effects.some((e: any) => e.type === type)
  );
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
