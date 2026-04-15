// backend/game/engine/effects/definitions/Dash.ts

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { PlayerState } from "../../state/types";
import { Position, gameplayUnitsToWorldUnits, worldUnitsToGameplayUnits } from "../../state/types/position";
import { pushEvent } from "../events";

/** Stable buffId for the CC-immunity granted while dashing */
const DASH_CC_IMMUNE_BUFF_ID = 999901;

const TICK_RATE = 30;

/**
 * Handle DASH effects.
 * Sets up an activeDash that moves the source player to 1 unit away from target.
 * Speed is constant (20u in 0.5s). Shorter distances complete faster.
 */
export function handleDash(
  state: GameState,
  source: { userId: string; position: Position; buffs: ActiveBuff[] },
  target: { userId: string; position: Position; buffs: ActiveBuff[] },
  isEnemyEffect: boolean,
  ability: Ability,
  effect: AbilityEffect
) {
  const storedUnitScale = state.unitScale;
  const dashSpeedUnitsPerSec = gameplayUnitsToWorldUnits(40, storedUnitScale);
  const stopDistance = gameplayUnitsToWorldUnits(1, storedUnitScale);

  // Calculate vector from source to target
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const sourceZ = source.position.z ?? 0;
  const targetZ = target.position.z ?? 0;
  const dz = targetZ - sourceZ;

  // If already close in XYZ, don't move
  if (distance <= stopDistance && Math.abs(dz) <= 0.1) {
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

  // We want to end up STOP_DISTANCE_NEW_UNITS away from target on XY, but snap vertical travel to target Z.
  const desiredDistance = distance > stopDistance ? stopDistance : 0;
  const travelDistance = Math.max(0, distance - desiredDistance);
  const dirX = distance > 0.001 ? dx / distance : 0;
  const dirY = distance > 0.001 ? dy / distance : 0;

  const speedPerTick = dashSpeedUnitsPerSec / TICK_RATE;
  const horizontalTicks = Math.round(travelDistance / speedPerTick);
  const verticalTicks = Math.round(Math.abs(dz) / speedPerTick);
  const durationTicks = Math.max(1, horizontalTicks, verticalTicks);
  const durationSec = durationTicks / TICK_RATE;
  const sourcePlayer = source as PlayerState;

  // Maximum vertical angle caps
  const MAX_UP_ANGLE_DEG = 45;
  const MAX_DOWN_ANGLE_DEG = 35;
  const maxUpVz = (travelDistance * Math.tan(MAX_UP_ANGLE_DEG * Math.PI / 180)) / durationTicks;
  const maxDownVz = -(travelDistance * Math.tan(MAX_DOWN_ANGLE_DEG * Math.PI / 180)) / durationTicks;

  sourcePlayer.activeDash = {
    abilityId: ability.id,
    vxPerTick: dirX * travelDistance / durationTicks,
    vyPerTick: dirY * travelDistance / durationTicks,
    forceVzPerTick: dz / durationTicks,
    // vzPerTick: undefined — captured on first tick in movement.ts
    maxUpVz,
    maxDownVz,
    ticksRemaining: durationTicks,
  };

  // Freeze movement momentum — dash owns trajectory completely.
  if (sourcePlayer.velocity) {
    sourcePlayer.velocity.vx = 0;
    sourcePlayer.velocity.vy = 0;
    sourcePlayer.velocity.vz = 0;
  }
  sourcePlayer.isPowerJump = false;
  sourcePlayer.isPowerJumpCombined = false;

  // Grant CC immunity for the duration of the dash
  sourcePlayer.buffs = sourcePlayer.buffs.filter(b => b.buffId !== DASH_CC_IMMUNE_BUFF_ID);
  sourcePlayer.buffs.push({
    buffId: DASH_CC_IMMUNE_BUFF_ID,
    name: "龙牙冲刺",
    category: "BUFF",
    effects: [{ type: "CONTROL_IMMUNE" }],
    expiresAt: Date.now() + durationSec * 1000 + 100,
  });

  pushEvent(state, {
    turn: state.turn,
    type: "DASH",
    actorUserId: source.userId,
    targetUserId: target.userId,
    abilityId: ability.id,
    abilityName: ability.name,
    effectType: "DASH",
    value: Math.round(worldUnitsToGameplayUnits(travelDistance, storedUnitScale)),
  });
}
