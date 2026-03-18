// backend/game/engine/effects/system.ts

import { randomUUID } from "crypto";
import {
  GameState,
  Card,
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
 * Buff lifetime is now driven by:
 *   - remaining (number of ticks)
 *   - tickOn ("TURN_START" | "TURN_END")
 *
 * ❌ NO expiresAtTurn
 * ❌ NO durationTurns math
 */
export function addBuff(params: {
  state: GameState;
  sourceUserId: string;
  targetUserId: string;
  card: Card;
  buffTarget: { userId: string; buffs: ActiveBuff[] };
  buff: BuffDefinition;
}) {
  const {
    state,
    sourceUserId,
    targetUserId,
    card,
    buffTarget,
    buff,
  } = params;

  // 🔁 Refresh same buffId (stable replacement)
  buffTarget.buffs = buffTarget.buffs.filter(
    (b) => b.buffId !== buff.buffId
  );

  const active: ActiveBuff = {
    buffId: buff.buffId,
    name: buff.name,
    category: buff.category,

    effects: buff.effects.map((e) => ({ ...e })), // clone for runtime mutation

    remaining: buff.duration,
    tickOn: buff.tickOn,

    appliedAtTurn: state.turn, // informational only
    breakOnPlay: buff.breakOnPlay,

    sourceCardId: card.id,
    sourceCardName: card.name,
  };

  buffTarget.buffs.push(active);

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_APPLIED",
    actorUserId: sourceUserId,
    targetUserId,
    cardId: card.id,
    cardName: card.name,

    buffId: active.buffId,
    buffName: active.name,
    buffCategory: active.category,
    appliedAtTurn: active.appliedAtTurn,
  });
}

/**
 * Emit a buff-expired event.
 * Actual removal from player.buffs is handled
 * by the turn flow (after ticking).
 */
export function pushBuffExpired(
  state: GameState,
  params: {
    targetUserId: string;
    buffId: number;
    buffName: string;
    buffCategory: "BUFF" | "DEBUFF";
    sourceCardId?: string;
    sourceCardName?: string;
  }
) {
  const {
    targetUserId,
    buffId,
    buffName,
    buffCategory,
    sourceCardId,
    sourceCardName,
  } = params;

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_EXPIRED",
    actorUserId: targetUserId,
    targetUserId,
    cardId: sourceCardId,
    cardName: sourceCardName,
    buffId,
    buffName,
    buffCategory,
  });
}
