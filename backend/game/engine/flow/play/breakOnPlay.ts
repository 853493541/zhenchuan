// engine/flow/breakOnPlay.ts
import { ActiveBuff, Ability } from "../../state/types";

function isForwardChannel(ability: Ability): boolean {
  if (ability.type !== "CHANNEL") return false;
  return (ability as any).channelForward === true;
}

function isChannel(ability: Ability): boolean {
  return ability.type === "CHANNEL";
}

function stealthAgeMs(buff: ActiveBuff, now: number): number {
  if (buff.appliedAt === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - buff.appliedAt);
}

function isDunyingCompanion(buff: ActiveBuff): boolean {
  return buff.buffId === 1021 && (buff.name === "遁影" || buff.sourceAbilityId === "fuguang_lueying");
}

const TRIGGERED_STEALTH_BREAK_ABILITIES = new Set(["wu_jianyu"]);

/**
 * Stealth buffs have per-skill break exceptions.
 * Keep this logic centralized so future tuning only needs one edit point.
 */
function shouldKeepStealthOnPlay(buff: ActiveBuff, ability: Ability, now: number): boolean {
  const buffId = buff.buffId;
  const isCommon = ability.isCommon === true;
  const channelCast = isChannel(ability);
  const isForward = isForwardChannel(ability);

  switch (buffId) {
    // 暗尘弥散:
    // - common abilities do not break
    // - channel start does not break (forward/reverse)
    // - normal casts break immediately
    case 1011:
      return isCommon || channelCast;

    // 浮光掠影:
    // - forward channel start does not break (breaks on completion)
    // - reverse channel breaks immediately
    // - common breaks only after the first 5s grace window
    case 1012:
      if (channelCast) return isForward;
      if (isCommon) return stealthAgeMs(buff, now) < 5_000;
      return false;

    // 天地无极:
    // - common abilities do not break
    // - channel start does not break (breaks on completion)
    // - normal casts break immediately
    case 1013:
      return isCommon || channelCast;

    default:
      return false;
  }
}

export function breakOnPlay(source: { buffs?: ActiveBuff[] }, playedAbility: Ability) {
  if (!Array.isArray(source.buffs)) return;
  const now = Date.now();
  const hadFuguangBefore = source.buffs.some((b) => b.buffId === 1012);
  source.buffs = source.buffs.filter((b) => {
    if (!b.breakOnPlay) return true;
    if (shouldKeepStealthOnPlay(b, playedAbility, now)) return true;
    return false;
  });

  const hasFuguangAfter = source.buffs.some((b) => b.buffId === 1012);
  if (hadFuguangBefore && !hasFuguangAfter) {
    source.buffs = source.buffs.filter((b) => !isDunyingCompanion(b));
  }
}

/**
 * Certain delayed follow-up strikes are special-cased to break stealth only.
 * They do not count as a normal "play" for channel breaking.
 */
export function applyTriggeredFollowUpPlayRules(
  source: { buffs?: ActiveBuff[] },
  playedAbility: Ability
) {
  if (!TRIGGERED_STEALTH_BREAK_ABILITIES.has(playedAbility.id)) {
    return false;
  }

  const beforeBuffCount = Array.isArray(source.buffs) ? source.buffs.length : 0;
  breakOnPlay(source, playedAbility);
  const afterBuffCount = Array.isArray(source.buffs) ? source.buffs.length : 0;
  return beforeBuffCount !== afterBuffCount;
}
