// backend/game/engine/effects/definitions/Dash.ts

import { GameState, Card, CardEffect, ActiveBuff } from "../../state/types";
import { Position } from "../../state/types/position";
import { pushEvent } from "../events";

/**
 * Handle DASH effects.
 * Moves the source player toward the target's position.
 * Dash distance is controlled by effect.value (typically 8-10 units).
 */
export function handleDash(
  state: GameState,
  source: { userId: string; position: Position; buffs: ActiveBuff[] },
  target: { userId: string; position: Position; buffs: ActiveBuff[] },
  isEnemyEffect: boolean,
  card: Card,
  effect: CardEffect
) {
  const dashDistance = effect.value ?? 8; // Default 8 units if not specified

  // Calculate vector from source to target
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // If distance is 0, don't dash
  if (distance === 0) {
    pushEvent(state, {
      turn: state.turn,
      type: "DASH",
      actorUserId: source.userId,
      targetUserId: target.userId,
      cardId: card.id,
      cardName: card.name,
      effectType: "DASH",
      value: 0,
    });
    return;
  }

  // Normalize direction and calculate new position
  const dirX = dx / distance;
  const dirY = dy / distance;

  const newX = source.position.x + dirX * dashDistance;
  const newY = source.position.y + dirY * dashDistance;

  // Clamp to arena boundaries (0-100 in both axes)
  source.position.x = Math.max(0, Math.min(100, newX));
  source.position.y = Math.max(0, Math.min(100, newY));

  pushEvent(state, {
    turn: state.turn,
    type: "DASH",
    actorUserId: source.userId,
    targetUserId: target.userId,
    cardId: card.id,
    cardName: card.name,
    effectType: "DASH",
    value: dashDistance,
  });
}
