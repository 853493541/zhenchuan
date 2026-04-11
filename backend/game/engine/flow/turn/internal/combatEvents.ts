// backend/game/engine/flow/turn/eventHelpers.ts

import { GameState } from "../../../state/types";
import { randomUUID } from "crypto";

export function pushDamageEvent(params: {
  state: GameState;
  actorUserId: string;
  targetUserId: string;
  abilityId: string | undefined;
  abilityName: string | undefined;
  value: number;
  effectType?: "DAMAGE" | "SCHEDULED_DAMAGE";
}) {
  const {
    state,
    actorUserId,
    targetUserId,
    abilityId,
    abilityName,
    value,
    effectType = "DAMAGE",
  } = params;

  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    turn: state.turn,
    type: "DAMAGE",
    actorUserId,
    targetUserId,
    abilityId,
    abilityName,
    effectType,
    value,
  });
}

export function pushHealEvent(params: {
  state: GameState;
  actorUserId: string;
  targetUserId: string;
  abilityId: string | undefined;
  abilityName: string | undefined;
  value: number;
}) {
  const { state, actorUserId, targetUserId, abilityId, abilityName, value } = params;

  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    turn: state.turn,
    type: "HEAL",
    actorUserId,
    targetUserId,
    abilityId,
    abilityName,
    effectType: "HEAL",
    value,
  });
}
