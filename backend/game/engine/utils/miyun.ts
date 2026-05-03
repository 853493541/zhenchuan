import { blocksCardTargeting, blocksEnemyTargeting } from "../rules/guards";
import type { GameState, TargetEntity } from "../state/types";

export const MIYUN_CONFUSION_BUFF_ID = 2744;
export const WUSHI_IMMUNE_BUFF_ID = 2745;
export const WU_AN_MI_YUN_ABILITY_ID = "wu_an_mi_yun";

type BuffCarrier = {
  buffs?: Array<{
    expiresAt?: number;
    effects?: Array<{ type?: string }>;
  }>;
};

export type MiYunSelectableTarget =
  | { kind: "player"; target: any }
  | { kind: "entity"; target: TargetEntity };

export function hasWuShiImmunity(target: BuffCarrier | null | undefined, now: number = Date.now()) {
  return (target?.buffs ?? []).some(
    (buff: any) =>
      (buff.expiresAt ?? 0) > now &&
      Array.isArray(buff.effects) &&
      buff.effects.some((effect: any) => effect?.type === "MIYUN_IMMUNE"),
  );
}

export function hasMiYunConfusion(target: BuffCarrier | null | undefined, now: number = Date.now()) {
  if (hasWuShiImmunity(target, now)) return false;
  return (target?.buffs ?? []).some(
    (buff: any) =>
      (buff.expiresAt ?? 0) > now &&
      Array.isArray(buff.effects) &&
      buff.effects.some((effect: any) => effect?.type === "MIYUN_CONFUSION"),
  );
}

export function getMiYunTargetPosition(target: MiYunSelectableTarget) {
  return target.target.position;
}

export function getMiYunTargetDistance(
  center: { x: number; y: number },
  target: MiYunSelectableTarget,
) {
  const dx = (target.target.position?.x ?? 0) - center.x;
  const dy = (target.target.position?.y ?? 0) - center.y;
  const rawDistance = Math.hypot(dx, dy);
  if (target.kind !== "entity") return rawDistance;
  return Math.max(0, rawDistance - Math.max(0, Number(target.target.radius ?? 0)));
}

function isWithinCone(params: {
  center: { x: number; y: number };
  targetPosition: { x: number; y: number };
  facing?: { x: number; y: number } | null;
  coneAngleDeg?: number;
}) {
  const { center, targetPosition, facing, coneAngleDeg } = params;
  if (!coneAngleDeg || coneAngleDeg >= 360) return true;
  const dx = targetPosition.x - center.x;
  const dy = targetPosition.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.0001) return true;

  const rawFacingX = Number(facing?.x ?? 0);
  const rawFacingY = Number(facing?.y ?? 1);
  const facingLength = Math.hypot(rawFacingX, rawFacingY) || 1;
  const facingX = rawFacingX / facingLength;
  const facingY = rawFacingY / facingLength;
  const dot = (facingX * dx + facingY * dy) / distance;
  return dot >= Math.cos((coneAngleDeg / 2) * Math.PI / 180);
}

export function getMiYunAreaCandidates(params: {
  state: GameState;
  sourceUserId: string;
  center: { x: number; y: number };
  radiusWorld: number;
  coneAngleDeg?: number;
  facing?: { x: number; y: number } | null;
}) {
  const { state, sourceUserId, center, radiusWorld, coneAngleDeg, facing } = params;
  const candidates: MiYunSelectableTarget[] = [];

  for (const victim of state.players ?? []) {
    if (victim.userId === sourceUserId) continue;
    if ((victim.hp ?? 0) <= 0) continue;
    if (blocksCardTargeting(victim as any)) continue;
    const candidate = { kind: "player", target: victim } satisfies MiYunSelectableTarget;
    if (getMiYunTargetDistance(center, candidate) > radiusWorld) continue;
    if (!isWithinCone({ center, targetPosition: getMiYunTargetPosition(candidate), facing, coneAngleDeg })) continue;
    candidates.push(candidate);
  }

  for (const entity of state.entities ?? []) {
    if ((entity.hp ?? 0) <= 0) continue;
    if (blocksEnemyTargeting(entity as any)) continue;
    const candidate = { kind: "entity", target: entity } satisfies MiYunSelectableTarget;
    if (getMiYunTargetDistance(center, candidate) > radiusWorld) continue;
    if (!isWithinCone({ center, targetPosition: getMiYunTargetPosition(candidate), facing, coneAngleDeg })) continue;
    candidates.push(candidate);
  }

  return candidates;
}

export function rerollMiYunAreaTargets(params: {
  state: GameState;
  source: BuffCarrier | null | undefined;
  sourceUserId: string;
  originalSlotCount: number;
  center: { x: number; y: number };
  radiusWorld: number;
  coneAngleDeg?: number;
  facing?: { x: number; y: number } | null;
}) {
  const { state, source, sourceUserId, originalSlotCount, center, radiusWorld, coneAngleDeg, facing } = params;
  if (originalSlotCount <= 0 || !hasMiYunConfusion(source)) return null;

  const candidates = getMiYunAreaCandidates({
    state,
    sourceUserId,
    center,
    radiusWorld,
    coneAngleDeg,
    facing,
  });
  if (candidates.length === 0) return null;

  return Array.from({ length: originalSlotCount }, () => candidates[Math.floor(Math.random() * candidates.length)]);
}