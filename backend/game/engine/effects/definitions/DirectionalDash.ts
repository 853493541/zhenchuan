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
 *   AWAY       — dash backward from caster's facing direction
 *   PERP_LEFT  — dash left (perpendicular to facing, rotate +90°)
 *   PERP_RIGHT — dash right (perpendicular to facing, rotate -90°)
 */

import { GameState, Ability, AbilityEffect, ActiveBuff } from "../../state/types";
import { PlayerState } from "../../state/types";
import { Position, gameplayUnitsToWorldUnits } from "../../state/types/position";
import { pushEvent } from "../events";
import { resolveScheduledDamage } from "../../utils/combatMath";
import { applyDamageToTarget } from "../../utils/health";
import { blocksEnemyTargeting } from "../../rules/guards";

/** Stable buffId for the CC-immunity granted while dashing */
export const DASH_CC_IMMUNE_BUFF_ID = 999900;

// Maximum angle caps (degrees from horizontal)
const MAX_DOWN_ANGLE_DEG = 35;
const MAX_UP_ANGLE_DEG   = 45;

export function applyDashRuntimeBuff(params: {
  state: GameState;
  target: PlayerState;
  durationMs: number;
  effects: ActiveBuff["effects"];
  sourceAbilityId?: string;
  sourceAbilityName?: string;
  appliedAt?: number;
}) {
  const {
    state,
    target,
    durationMs,
    effects,
    sourceAbilityId,
    sourceAbilityName,
    appliedAt = Date.now(),
  } = params;

  const dedupedEffects = Array.from(
    new Map(effects.map((effect) => [effect.type, effect])).values()
  ) as ActiveBuff["effects"];

  target.buffs = target.buffs.filter((b) => b.buffId !== DASH_CC_IMMUNE_BUFF_ID);
  target.buffs.push({
    buffId: DASH_CC_IMMUNE_BUFF_ID,
    name: "Dash Runtime",
    category: "BUFF",
    effects: dedupedEffects,
    expiresAt: appliedAt + Math.max(0, durationMs),
    breakOnPlay: false,
    sourceAbilityId,
    sourceAbilityName,
    appliedAtTurn: state.turn,
    appliedAt,
  } as ActiveBuff);
}

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
  _opponentPos: Position,
  ability: Ability,
  effect: AbilityEffect
) {
  const distance = effect.value ?? 10;
  const storedUnitScale = state.unitScale;

  // 五蕴皆空·聂云缩减: reduce 蹑云逐月 distance and duration by 70%
  const rawDistance = (() => {
    if (ability.id === "nieyun_zhuyue") {
      const hasReduction = (source.buffs as any[]).some((b: any) =>
        b.effects?.some((e: any) => e.type === "NIEYUN_DASH_REDUCTION")
      );
      if (hasReduction) return distance * 0.30;
    }
    return distance;
  })();

  const worldDistance = gameplayUnitsToWorldUnits(rawDistance, storedUnitScale);
  const dashUnitsPerTick = gameplayUnitsToWorldUnits(20, storedUnitScale) / 30;

  const rawFacing = source.facing;
  const facingLen = rawFacing
    ? Math.sqrt(rawFacing.x * rawFacing.x + rawFacing.y * rawFacing.y)
    : 0;
  const facingX = facingLen > 0.01 ? rawFacing!.x / facingLen : 0;
  const facingY = facingLen > 0.01 ? rawFacing!.y / facingLen : 1;

  let dirX: number;
  let dirY: number;

  switch (effect.dirMode) {
    case "TOWARD":
      dirX = facingX;
      dirY = facingY;
      break;
    case "AWAY":
      dirX = -facingX;
      dirY = -facingY;
      break;
    case "PERP_LEFT":
      dirX = -facingY;
      dirY = facingX;
      break;
    case "PERP_RIGHT":
      dirX = facingY;
      dirY = -facingX;
      break;
    default:
      dirX = facingX;
      dirY = facingY;
      break;
  }

  const baseDurationTicks = effect.durationTicks ?? Math.round(worldDistance / dashUnitsPerTick);
  const durationTicks = (() => {
    if (ability.id === "nieyun_zhuyue") {
      const hasReduction = (source.buffs as any[]).some((b: any) =>
        b.effects?.some((e: any) => e.type === "NIEYUN_DASH_REDUCTION")
      );
      if (hasReduction) return Math.max(1, Math.round(baseDurationTicks * 0.30));
    }
    return baseDurationTicks;
  })();

  // Pre-compute per-tick vz caps from the angle limits.
  // Actual vz capture happens on the first game-loop tick in movement.ts.
  const maxUpVz   =  (worldDistance * Math.tan(MAX_UP_ANGLE_DEG   * Math.PI / 180)) / durationTicks;
  const maxDownVz = -(worldDistance * Math.tan(MAX_DOWN_ANGLE_DEG * Math.PI / 180)) / durationTicks;

  // Optional arc mode: enforce a jump-like parabola with the configured peak height.
  let forceVzPerTick: number | undefined;
  let useArcGravity = false;
  let arcGravityUpPerTick: number | undefined;
  let arcGravityDownPerTick: number | undefined;
  const arcPeakHeight = gameplayUnitsToWorldUnits(effect.arcPeakHeight ?? 0, storedUnitScale);
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
    vxPerTick: dirX * worldDistance / durationTicks,
    vyPerTick: dirY * worldDistance / durationTicks,
    speedPerTick: effect.speedPerTick !== undefined
      ? gameplayUnitsToWorldUnits(effect.speedPerTick, storedUnitScale)
      : undefined,
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
    const endX = startX + dirX * worldDistance;
    const endY = startY + dirY * worldDistance;
    const routeRadius = gameplayUnitsToWorldUnits(effect.routeRadius ?? 2, storedUnitScale);

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
      applyDamageToTarget(targetPlayer as any, dmg);

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
  const dashRuntimeEffects: ActiveBuff["effects"] = [
    { type: "CONTROL_IMMUNE" },
    { type: "KNOCKBACK_IMMUNE" },
    { type: "DISPLACEMENT" },
    { type: "DASH_TURN_LOCK" },
  ];
  if (ability.id === "taxingxing") {
    dashRuntimeEffects.push({ type: "DODGE_NEXT", chance: 0.65 } as any);
  }
  const dashRuntimeAppliedAt = Date.now();
  applyDashRuntimeBuff({
    state,
    target: source,
    durationMs: Math.ceil(durationTicks * (1000 / 30)) + 500,
    effects: dashRuntimeEffects,
    sourceAbilityId: ability.id,
    sourceAbilityName: ability.name,
    appliedAt: dashRuntimeAppliedAt,
  });

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
