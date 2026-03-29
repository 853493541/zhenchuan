// backend/game/engine/effects/definitions/DirectionalDash.ts
/**
 * DIRECTIONAL_DASH effect — animated dash with 惯性 (Momentum Inheritance)
 *
 * Sets up an activeDash on the player. The actual vz capture is DEFERRED to
 * the first game-loop tick (in movement.ts) so that any pending jump input
 * is processed first. This prevents the race condition where pressing
 * double-jump + nieyun simultaneously would lose the jump because the HTTP
 * handler for cast runs before the tick that processes the jump.
 *
 * dirMode values:
 *   TOWARD     — dash in caster's facing direction
 *   AWAY       — dash away from opponent
 *   PERP_LEFT  — dash left (perpendicular to facing, rotate +90°)
 *   PERP_RIGHT — dash right (perpendicular to facing, rotate -90°)
 */

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { PlayerState } from "../../state/types";
import { Position } from "../../state/types/position";
import { pushEvent } from "../events";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { blocksEnemyTargeting } from "../../rules/guards";

/** Stable buffId for the CC-immunity granted while dashing */
export const DASH_CC_IMMUNE_BUFF_ID = 999900;

// Default dash speed at 30Hz: 20 units / 30 ticks = 2/3 unit per tick.
const DASH_UNITS_PER_TICK = 20 / 30;

// Maximum angle caps (degrees from horizontal)
const MAX_DOWN_ANGLE_DEG = 35;
const MAX_UP_ANGLE_DEG   = 45;

function pointToSegmentDistance2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 1e-8) {
    const dx = px - ax;
    const dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function handleDirectionalDash(
  state: GameState,
  source: PlayerState,
  opponentPos: Position,
  ability: Ability,
  effect: AbilityEffect
) {
  const dx = opponentPos.x - source.position.x;
  const dy = opponentPos.y - source.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const distance = effect.value ?? 10;

  let dirX: number;
  let dirY: number;

  if (dist < 0.01) {
    dirX = 0;
    dirY = 1;
  } else {
    const fx = dx / dist;
    const fy = dy / dist;

    switch (effect.dirMode) {
      case "TOWARD":
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
        dirX = -fy; dirY = fx;  break;
      case "PERP_RIGHT":
        dirX = fy;  dirY = -fx; break;
      default:
        dirX = fx;  dirY = fy;  break;
    }
  }

  const durationTicks = effect.durationTicks ?? Math.round(distance / DASH_UNITS_PER_TICK);

  // Pre-compute per-tick vz caps from the angle limits.
  // Actual vz capture happens on the first game-loop tick in movement.ts.
  const maxUpVz   =  (distance * Math.tan(MAX_UP_ANGLE_DEG   * Math.PI / 180)) / durationTicks;
  const maxDownVz = -(distance * Math.tan(MAX_DOWN_ANGLE_DEG * Math.PI / 180)) / durationTicks;

  // Optional arc mode: enforce a jump-like parabola with the configured peak height.
  let forceVzPerTick: number | undefined;
  let useArcGravity = false;
  let arcGravityUpPerTick: number | undefined;
  let arcGravityDownPerTick: number | undefined;
  const arcPeakHeight = effect.arcPeakHeight ?? 0;
  if (arcPeakHeight > 0) {
    const halfTicks = Math.max(1, durationTicks / 2);
    const g = (2 * arcPeakHeight) / (halfTicks * halfTicks);
    forceVzPerTick = g * halfTicks;
    useArcGravity = true;
    arcGravityUpPerTick = g;
    arcGravityDownPerTick = g;
  }

  source.activeDash = {
    abilityId: ability.id,
    vxPerTick: dirX * distance / durationTicks,
    vyPerTick: dirY * distance / durationTicks,
    speedPerTick: effect.speedPerTick,
    steerByFacing: effect.steerByFacing,
    wallDiveOnBlock: effect.wallDiveOnBlock,
    snapUpUnits: effect.snapUpUnits,
    diveVzPerTick: effect.diveVzPerTick,
    // vzPerTick: undefined — captured on first tick in movement.ts
    forceVzPerTick,
    useArcGravity,
    arcGravityUpPerTick,
    arcGravityDownPerTick,
    maxUpVz,
    maxDownVz,
    ticksRemaining: durationTicks,
  };

  // 疾: apply route damage immediately on cast to all enemies intersecting dash path.
  if ((effect.routeDamage ?? 0) > 0) {
    const startX = source.position.x;
    const startY = source.position.y;
    const endX = startX + dirX * distance;
    const endY = startY + dirY * distance;
    const routeRadius = effect.routeRadius ?? 2;

    for (const targetPlayer of state.players as any[]) {
      if (targetPlayer.userId === source.userId) continue;
      if ((targetPlayer.hp ?? 0) <= 0) continue;
      if (blocksEnemyTargeting(targetPlayer)) continue;

      const distToPath = pointToSegmentDistance2D(
        targetPlayer.position.x,
        targetPlayer.position.y,
        startX,
        startY,
        endX,
        endY,
      );
      if (distToPath > routeRadius) continue;

      const dmg = resolveScheduledDamage({
        source: source as any,
        target: targetPlayer,
        base: effect.routeDamage ?? 0,
      });
      targetPlayer.hp = Math.max(0, targetPlayer.hp - dmg);

      pushEvent(state, {
        turn: state.turn,
        type: "DAMAGE",
        actorUserId: source.userId,
        targetUserId: targetPlayer.userId,
        abilityId: ability.id,
        abilityName: ability.name,
        effectType: "DAMAGE",
        value: dmg,
      });
    }
  }

  // Freeze XY velocity — activeDash owns horizontal movement now.
  // Do NOT clear vz here — movement.ts needs the live vz (after processing
  // any pending jump) for the first-tick capture.
  source.velocity.vx = 0;
  source.velocity.vy = 0;

  // Grant CC immunity for the duration of the dash
  source.buffs = source.buffs.filter(b => b.buffId !== DASH_CC_IMMUNE_BUFF_ID);
  source.buffs.push({
    buffId: DASH_CC_IMMUNE_BUFF_ID,
    name: "Dash CC Immunity",
    category: "BUFF",
    effects: [{ type: "CONTROL_IMMUNE" }],
    expiresAt: Date.now() + Math.ceil(durationTicks * (1000 / 30)) + 500,
    appliedAtTurn: state.turn,
    appliedAt: Date.now(),
  } as ActiveBuff);

  pushEvent(state, {
    turn: state.turn,
    type: "DASH",
    actorUserId: source.userId,
    targetUserId: source.userId,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType: "DIRECTIONAL_DASH",
    value: Math.round(distance),
  });

  console.log(`[DASH-CAST] player=${source.userId} ability=${ability.id} distance=${distance} durationTicks=${durationTicks} vxPerTick=${source.activeDash!.vxPerTick.toFixed(6)} vyPerTick=${source.activeDash!.vyPerTick.toFixed(6)} pos=(${source.position.x.toFixed(1)},${source.position.y.toFixed(1)},${(source.position.z ?? 0).toFixed(3)}) vz=${(source.velocity.vz ?? 0).toFixed(6)} dirMode=${effect.dirMode}`);
}
