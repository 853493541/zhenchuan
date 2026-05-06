// backend/game/engine/utils/health.ts

import { ActiveBuff } from "../state/types";

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

type ShieldedTarget = {
  hp: number;
  maxHp?: number;
  shield?: number;
  buffs?: ActiveBuff[];
};

function normalizeShield(target: ShieldedTarget) {
  if (!Number.isFinite(target.shield)) {
    target.shield = 0;
    return;
  }
  if ((target.shield ?? 0) < 0) target.shield = 0;
}

export function getMaxHp(target: { maxHp?: number }): number {
  return target.maxHp ?? 100;
}

export function resolveMaxHpPercentHealAmount(target: { maxHp?: number }, percent: number): number {
  const rawPercent = Number(percent ?? 0);
  if (!Number.isFinite(rawPercent) || rawPercent <= 0) return 0;
  return Math.max(0, Math.floor(getMaxHp(target) * (rawPercent / 100)));
}

export function applyHealToTarget(target: ShieldedTarget, rawHeal: number): number {
  const heal = Math.max(0, Math.floor(rawHeal));
  if (heal <= 0) return 0;

  const before = target.hp;
  target.hp = Math.min(getMaxHp(target), target.hp + heal);
  return Math.max(0, target.hp - before);
}

export function applyDamageToTarget(target: ShieldedTarget, rawDamage: number): {
  totalDamage: number;
  shieldAbsorbed: number;
  hpDamage: number;
} {
  const damage = roundNumber(Math.max(0, Number(rawDamage ?? 0)));
  if (damage <= 0) {
    return { totalDamage: 0, shieldAbsorbed: 0, hpDamage: 0 };
  }

  normalizeShield(target);

  let shieldAbsorbed = 0;
  if ((target.shield ?? 0) > 0) {
    shieldAbsorbed = Math.min(target.shield ?? 0, damage);
    target.shield = Math.max(0, (target.shield ?? 0) - shieldAbsorbed);

    // Consume linked shield pools first to keep shield-bearing buffs in sync.
    if (shieldAbsorbed > 0 && Array.isArray(target.buffs)) {
      let remainingAbsorb = shieldAbsorbed;
      for (const buff of target.buffs) {
        if (remainingAbsorb <= 0) break;
        const linked = Math.max(0, Math.floor(buff.shieldAmount ?? 0));
        if (linked <= 0) continue;

        const consumed = Math.min(linked, remainingAbsorb);
        const left = linked - consumed;
        buff.shieldAmount = left;
        remainingAbsorb -= consumed;

        // Shield-linked buffs expire once their linked pool is depleted.
        if (left <= 0) {
          buff.shieldAmount = 0;
          buff.expiresAt = Math.min(buff.expiresAt, Date.now());
        }
      }
    }
  }

  const hpDamage = roundNumber(Math.max(0, damage - shieldAbsorbed));
  if (hpDamage > 0) {
    target.hp = roundNumber(Math.max(0, target.hp - hpDamage));
    // 啸如虎 MIN_HP_1: if any buff prevents death, clamp hp to at least 1
    if (
      target.hp <= 0 &&
      Array.isArray(target.buffs) &&
      target.buffs.some((b) => b.effects.some((e) => (e as any).type === "MIN_HP_1"))
    ) {
      target.hp = 1;
    }
  }

  return {
    totalDamage: damage,
    shieldAbsorbed,
    hpDamage,
  };
}

export function addShieldToTarget(target: ShieldedTarget, amount: number): number {
  const shieldGain = Math.max(0, Math.floor(amount));
  if (shieldGain <= 0) return 0;

  normalizeShield(target);
  target.shield = (target.shield ?? 0) + shieldGain;
  return shieldGain;
}

export function removeLinkedShield(target: ShieldedTarget, buff: { shieldAmount?: number }) {
  const linked = Math.max(0, Math.floor(buff.shieldAmount ?? 0));
  if (linked <= 0) return;

  normalizeShield(target);
  target.shield = Math.max(0, (target.shield ?? 0) - linked);
  buff.shieldAmount = 0;
}
