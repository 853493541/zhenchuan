// backend/game/engine/effects/definitions/DirectionalDash.ts
/**
 * DIRECTIONAL_DASH effect
 * Moves the caster a fixed distance in a direction relative to their
 * current orientation toward the opponent.
 *
 * dirMode values:
 *   TOWARD     — dash toward the opponent
 *   AWAY       — dash away from the opponent
 *   PERP_LEFT  — dash left (perpendicular to facing, rotate +90°)
 *   PERP_RIGHT — dash right (perpendicular to facing, rotate -90°)
 */

import { GameState, Card, CardEffect } from "../../state/types";
import { PlayerState } from "../../state/types";
import { Position } from "../../state/types/position";
import { pushEvent } from "../events";

const ARENA_WIDTH  = 100;
const ARENA_HEIGHT = 100;
const PLAYER_RADIUS = 2;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function handleDirectionalDash(
  state: GameState,
  source: PlayerState,
  opponentPos: Position,
  card: Card,
  effect: CardEffect
) {
  const dx = opponentPos.x - source.position.x;
  const dy = opponentPos.y - source.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const distance = effect.value ?? 10;

  let dirX: number;
  let dirY: number;

  if (dist < 0.01) {
    // Degenerate: same spot — default to facing +Y (camera forward)
    dirX = 0;
    dirY = 1;
  } else {
    const fx = dx / dist; // unit vector toward opponent
    const fy = dy / dist;

    switch (effect.dirMode) {
      case "TOWARD":
        // Use the caster's stored facing direction (set by movement input).
        // Fall back to toward-opponent if facing is unknown (first tick, idle).
        if (source.facing && (Math.abs(source.facing.x) + Math.abs(source.facing.y)) > 0.01) {
          dirX = source.facing.x;
          dirY = source.facing.y;
        } else {
          dirX = fx; dirY = fy;
        }
        break;
      case "AWAY":
        dirX = -fx; dirY = -fy; break;
      case "PERP_LEFT":
        // rotate 90° counter-clockwise: (x,y) → (-y, x)
        dirX = -fy; dirY = fx;  break;
      case "PERP_RIGHT":
        // rotate 90° clockwise: (x,y) → (y, -x)
        dirX = fy;  dirY = -fx; break;
      default:
        dirX = fx;  dirY = fy;  break;
    }
  }

  source.position.x = clamp(
    source.position.x + dirX * distance,
    PLAYER_RADIUS,
    ARENA_WIDTH - PLAYER_RADIUS,
  );
  source.position.y = clamp(
    source.position.y + dirY * distance,
    PLAYER_RADIUS,
    ARENA_HEIGHT - PLAYER_RADIUS,
  );

  // Reset XY velocity so the dash doesn't carry over into the movement loop
  source.velocity.vx = 0;
  source.velocity.vy = 0;

  pushEvent(state, {
    turn: state.turn,
    type: "DASH",
    actorUserId: source.userId,
    targetUserId: source.userId,
    cardId: card.id,
    cardName: card.name,
    effectType: "DIRECTIONAL_DASH",
    value: Math.round(distance),
  });
}
