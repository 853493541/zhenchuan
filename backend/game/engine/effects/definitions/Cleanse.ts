// backend/game/engine/effects/handlers/handleCleanse.ts

import { ActiveBuff } from "../../state/types";

export type CapturedControlKind = "root" | "freeze" | "stun" | "knockdown";

export interface CapturedControlSnapshot {
  kind: CapturedControlKind;
  remainingMs: number;
  fullDurationMs: number;
  sourceBuffId: number;
  sourceBuffName: string;
}

function isMoheKnockdown(buff: ActiveBuff) {
  return buff.buffId === 1002 && buff.sourceAbilityId === "mohe_wuliang";
}

function isKnockdown(buff: ActiveBuff) {
  return isMoheKnockdown(buff) || buff.name.includes("倒地");
}

function classifyCapturedControl(buff: ActiveBuff): CapturedControlKind | null {
  if (isKnockdown(buff)) return "knockdown";

  const hasControl = buff.effects.some((e) => e.type === "CONTROL");
  const hasRoot = buff.effects.some((e) => e.type === "ROOT");

  if (hasControl && hasRoot) return "freeze";
  if (hasRoot) return "root";
  if (hasControl) return "stun";
  return null;
}

export function captureAndCleanseControls(
  source: { buffs: ActiveBuff[] },
  now: number = Date.now()
): CapturedControlSnapshot[] {
  const capturedByKind = new Map<CapturedControlKind, CapturedControlSnapshot>();

  source.buffs = source.buffs.filter((buff) => {
    const hasRoot = buff.effects.some((e) => e.type === "ROOT");
    const hasControl = buff.effects.some((e) => e.type === "CONTROL");
    const hasAttackLock = buff.effects.some((e) => e.type === "ATTACK_LOCK");
    const shouldRemove = hasRoot || hasControl || hasAttackLock || isKnockdown(buff);
    if (!shouldRemove) return true;

    const capturedKind = classifyCapturedControl(buff);
    if (capturedKind) {
      const remainingMs = Math.max(1, buff.expiresAt - now);
      const fullDurationMs = Math.max(
        remainingMs,
        typeof buff.appliedAt === "number" ? buff.expiresAt - buff.appliedAt : remainingMs,
      );
      const existing = capturedByKind.get(capturedKind);
      if (!existing) {
        capturedByKind.set(capturedKind, {
          kind: capturedKind,
          remainingMs,
          fullDurationMs,
          sourceBuffId: buff.buffId,
          sourceBuffName: buff.name,
        });
      } else {
        existing.remainingMs = Math.max(existing.remainingMs, remainingMs);
        existing.fullDurationMs = Math.max(existing.fullDurationMs, fullDurationMs);
      }
    }

    return false;
  });

  return Array.from(capturedByKind.values());
}

/**
 * Control level cleansability:
 *   Level 0 – ROOT, SLOW           → REMOVABLE only when effect.cleanseRootSlow=true
 *   Level 1 – CONTROL, ATTACK_LOCK → REMOVABLE by cleanse
 *   Level 2 – KNOCKED_BACK         → NOT removable (physics effect, must expire)
 *   Level 3 – SILENCE              → NOT removable (hard silence, must expire)
 */
export function handleCleanse(
  source: { buffs: ActiveBuff[] },
  effect?: { cleanseRootSlow?: boolean }
) {
  const cleanseRootSlow = effect?.cleanseRootSlow === true;

  source.buffs = source.buffs.filter(
    (b) =>
      isMoheKnockdown(b) ||
      !b.effects.some(
        (e) =>
          ((e.type === "ROOT" || e.type === "SLOW") && cleanseRootSlow) ||
          e.type === "CONTROL" ||
          e.type === "ATTACK_LOCK"
      )
  );
}
