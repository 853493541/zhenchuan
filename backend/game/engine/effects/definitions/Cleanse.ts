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

const HARDCODED_CLEANSEABLE_SLOW_BUFF_IDS = new Set([
  2005, // 孔雀翎
  1342, // 捕风式
  2403, // 滞影（捉影式）
  2720, // 惊惧（剑飞惊天减速）
]);

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
 * Control type cleansability:
 *   Type 0 – ROOT                 → REMOVABLE by cleanse (default)
 *   Selected SLOW/QINGGONG_SEAL    → REMOVABLE by any cleanse (hardcoded list above)
 *   Type 1 – CONTROL, ATTACK_LOCK → REMOVABLE by cleanse
 *   Type 3 – KNOCKED_BACK         → NOT removable (forced dash-state, must expire)
 *   Lockout – SILENCE              → NOT removable (hard silence, must expire)
 */
export function handleCleanse(
  source: { buffs: ActiveBuff[] },
  effect?: { cleanseRootSlow?: boolean }
) {
  // Keep backward compatibility with old metadata, but default to true:
  // cleanse should remove ROOT unless explicitly disabled.
  const cleanseRootSlow = effect?.cleanseRootSlow !== false;

  source.buffs = source.buffs.filter((b) => {
    if (HARDCODED_CLEANSEABLE_SLOW_BUFF_IDS.has(b.buffId)) return false;

    return !b.effects.some(
      (e) =>
        (e.type === "ROOT" && cleanseRootSlow) ||
        e.type === "CONTROL" ||
        e.type === "ATTACK_LOCK"
    );
  });
}
