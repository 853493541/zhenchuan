// backend/game/engine/effects/definitions/Dash.ts

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { Position } from "../../state/types/position";
import { pushEvent } from "../events";

/**
 * Handle DASH effects.
 * Moves the source player to be 1 unit away from target position.
 */
export function handleDash(
  state: GameState,
  source: { userId: string; position: Position; buffs: ActiveBuff[] },
  target: { userId: string; position: Position; buffs: ActiveBuff[] },
  isEnemyEffect: boolean,
  ability: Ability,
  effect: AbilityEffect
) {
  // Calculate vector from source to target
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // If already close, don't move
  if (distance <= 1) {
    pushEvent(state, {
      turn: state.turn,
      type: "DASH",
      actorUserId: source.userId,
      targetUserId: target.userId,
      abilityId: ability.id,
      abilityName: ability.name,
      effectType: "DASH",
      value: 0,
    });
    return;
  }

  // Position player 1 unit away from target
  const desiredDistance = 1;
  const dirX = dx / distance;
  const dirY = dy / distance;

  const newX = target.position.x - dirX * desiredDistance;
  const newY = target.position.y - dirY * desiredDistance;

  // Clamp to arena boundaries (0-100 in both axes)
  source.position.x = Math.max(0, Math.min(100, newX));
  source.position.y = Math.max(0, Math.min(100, newY));

  pushEvent(state, {
    turn: state.turn,
    type: "DASH",
    actorUserId: source.userId,
    targetUserId: target.userId,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType: "DASH",
    value: Math.round(distance - desiredDistance),
  });
}
