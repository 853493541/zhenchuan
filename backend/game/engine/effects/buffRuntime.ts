// backend/game/engine/effects/system.ts

import { randomUUID } from "crypto";
import {
  GameState,
  Ability,
  GameEvent,
  ActiveBuff,
  BuffDefinition,
} from "../state/types";

/* ================= Utilities ================= */

function pushEvent(
  state: GameState,
  e: Omit<GameEvent, "id" | "timestamp">
) {
  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    ...e,
  });
}

/* ================= Buff System ================= */

/**
 * Apply a buff to a target player.
 *
 * Buff lifetime is wall-clock based:
 *   expiresAt = Date.now() + buff.durationMs
 *
 * For periodic effects (DoT / HoT):
 *   lastTickAt = Date.now()  — first tick fires periodicMs after application
 */
export function addBuff(params: {
  state: GameState;
  sourceUserId: string;
  targetUserId: string;
  ability: Ability;
  buffTarget: { userId: string; buffs: ActiveBuff[] };
  buff: BuffDefinition;
}) {
  const {
    state,
    sourceUserId,
    targetUserId,
    ability,
    buffTarget,
    buff,
  } = params;

  // Stacking: if buff defines maxStacks > 1, increment stacks on the existing buff
  // instead of replacing it. The lastTickAt is intentionally NOT reset — this prevents
  // stack-refresh abuse (re-casting resets the tick timer allowing faster ticks).
  if (buff.maxStacks !== undefined && buff.maxStacks > 1) {
    const existing = buffTarget.buffs.find((b) => b.buffId === buff.buffId);
    if (existing) {
      const now = Date.now();
      existing.stacks = Math.min((existing.stacks ?? 1) + 1, buff.maxStacks);
      existing.expiresAt = now + buff.durationMs;
      pushEvent(state, {
        turn: state.turn,
        type: "BUFF_APPLIED",
        actorUserId: sourceUserId,
        targetUserId,
        abilityId: ability.id,
        abilityName: ability.name,
        buffId: existing.buffId,
        buffName: existing.name,
        buffCategory: existing.category,
        appliedAtTurn: existing.appliedAtTurn,
      });
      return;
    }
  }

  // Refresh same buffId (stable replacement — resets the timer)
  buffTarget.buffs = buffTarget.buffs.filter(
    (b) => b.buffId !== buff.buffId
  );

  const now = Date.now();

  const active: ActiveBuff = {
    buffId: buff.buffId,
    name: buff.name,
    category: buff.category,

    effects: buff.effects.map((e) => ({ ...e })), // clone for runtime mutation

    expiresAt: now + buff.durationMs,

    // Periodic effects (DoT / HoT)
    ...(buff.periodicMs !== undefined && {
      periodicMs: buff.periodicMs,
      lastTickAt: now,
    }),

    appliedAtTurn: state.turn, // informational only
    appliedAt: now,             // wall-clock ms — used by TIMED_AOE_DAMAGE
    breakOnPlay: buff.breakOnPlay,
    cancelOnMove: buff.cancelOnMove,
    cancelOnJump: buff.cancelOnJump,
    cancelOnOutOfRange: buff.cancelOnOutOfRange,
    forwardChannel: buff.forwardChannel,
    sourceUserId: sourceUserId,
    stacks: buff.initialStacks,
    maxStacks: buff.maxStacks,
    procCooldownMs: buff.procCooldownMs,

    sourceAbilityId: ability.id,
    sourceAbilityName: ability.name,
  };

  buffTarget.buffs.push(active);

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_APPLIED",
    actorUserId: sourceUserId,
    targetUserId,
    abilityId: ability.id,
    abilityName: ability.name,

    buffId: active.buffId,
    buffName: active.name,
    buffCategory: active.category,
    appliedAtTurn: active.appliedAtTurn,
  });
}

/**
 * Emit a buff-expired event.
 */
export function pushBuffExpired(
  state: GameState,
  params: {
    targetUserId: string;
    buffId: number;
    buffName: string;
    buffCategory: "BUFF" | "DEBUFF";
    sourceAbilityId?: string;
    sourceAbilityName?: string;
  }
) {
  const {
    targetUserId,
    buffId,
    buffName,
    buffCategory,
    sourceAbilityId,
    sourceAbilityName,
  } = params;

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_EXPIRED",
    actorUserId: targetUserId,
    targetUserId,
    abilityId: sourceAbilityId,
    abilityName: sourceAbilityName,
    buffId,
    buffName,
    buffCategory,
  });
}
