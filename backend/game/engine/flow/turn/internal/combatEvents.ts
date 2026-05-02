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
  isCrit?: boolean;
  effectType?: "DAMAGE" | "SCHEDULED_DAMAGE";
}) {
  const {
    state,
    actorUserId,
    targetUserId,
    abilityId,
    abilityName,
    value,
    isCrit,
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
    isCrit,
  });
}

export function pushHealEvent(params: {
  state: GameState;
  actorUserId: string;
  targetUserId: string;
  abilityId: string | undefined;
  abilityName: string | undefined;
  value: number;
  isCrit?: boolean;
}) {
  const { state, actorUserId, targetUserId, abilityId, abilityName, value, isCrit } = params;

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
    isCrit,
  });
}
