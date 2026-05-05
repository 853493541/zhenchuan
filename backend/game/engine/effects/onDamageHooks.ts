// backend/game/engine/effects/onDamageHooks.ts
//
// Shared on-damage effect hooks.
//
// PRE-DAMAGE  — call preCheckRedirect() BEFORE applyDamageToTarget().
//   Returns the adjusted (reduced) damage for the primary target (A) plus the
//   redirect player (B) and amount.  Apply the reduced value to A; then call
//   applyRedirectToOpponent() to apply the 55% portion to B.
//   This ensures the DAMAGE event value matches what A actually takes.
//
// POST-DAMAGE — call processOnDamageTaken() AFTER applyDamageToTarget().
//   Handles 七星拱瑞 freeze-break only (redirect is now pre-damage).

import { GameState, Ability } from "../state/types";
import { addBuff, pushBuffExpired } from "./buffRuntime";
import { pushEvent } from "./events";
import { hasDamageImmune } from "../rules/guards";
import { applyDamageToTarget } from "../utils/health";
import { resolveRedirectedDamageToTarget } from "../utils/combatMath";

// ── 七星拱瑞 ──────────────────────────────────────────────────────────────────
const QIXING_FREEZE_BUFF_ID = 2600;
const QIXING_STUN_BUFF_ID   = 2601;
const QIXING_STUN_ABILITY   = { id: "qixing_gongrui", name: "七星拱瑞" } as Ability;

// ── 玄水蛊 ───────────────────────────────────────────────────────────────────
const XUANSHUI_SELF_BUFF_ID   = 2607; // carried by the ability caster (A)
const XUANSHUI_POISON_BUFF_ID = 2606; // carried by the opponent (B) — 毒手
const XUANSHUI_REDIRECT_PCT   = 0.55;

// ── 疾电叱羽 ──────────────────────────────────────────────────────────────────
// Redirect ALL incoming damage from any ally with the JI_DIAN_REDIRECT buff to the
// linked HP-bearing zone. The zone consumes up to its remaining HP; excess damage
// is discarded (does not fall back to the player). When the zone HP hits 0 the
// zone expires, and the buff is naturally cleared next tick by GameLoop's zone
// presence check.
const JI_DIAN_BUFF_ID = 2620;
const SHESHEN_REDIRECT_BUFF_ID = 2737;
const SHESHEN_BEAR_BUFF_ID = 2738;
const YUAN_GUARD_BUFF_ID = 2739;
const YUAN_BEAR_BUFF_ID = 2740;

type RedirectProtectedTarget =
  | { kind: "player"; userId: string }
  | { kind: "entity"; entityId: string };

type RedirectResolution = {
  player: any;
  mode: "direct-hp" | "shielded";
  abilityId: string;
  abilityName: string;
  effectType: string;
  hideAbilityName?: boolean;
  suppressCritLabel?: boolean;
  protectedTarget?: RedirectProtectedTarget;
  consumeBuffId?: number;
  consumeRedirectPlayerBuffId?: number;
};

function getRedirectProtectedTarget(target: { userId: string; id?: string }): RedirectProtectedTarget {
  if (typeof (target as any).id === "string") {
    return { kind: "entity", entityId: (target as any).id };
  }
  return { kind: "player", userId: target.userId };
}

function expireRedirectProtectedBuff(
  state: GameState,
  protectedTarget: RedirectProtectedTarget | undefined,
  buffId: number | undefined,
) {
  if (!protectedTarget || typeof buffId !== "number") return;

  const liveTarget = protectedTarget.kind === "player"
    ? (state.players as any[]).find((candidate: any) => candidate.userId === protectedTarget.userId)
    : ((state as any).entities ?? []).find((candidate: any) => candidate.id === protectedTarget.entityId);
  if (!liveTarget) return;

  const buffIndex = (liveTarget.buffs as any[])?.findIndex((buff: any) => buff?.buffId === buffId) ?? -1;
  if (buffIndex < 0) return;

  const [removedBuff] = (liveTarget.buffs as any[]).splice(buffIndex, 1);
  pushBuffExpired(state, {
    targetUserId: liveTarget.userId,
    buffId: removedBuff.buffId,
    buffName: removedBuff.name,
    buffCategory: removedBuff.category,
    sourceAbilityId: removedBuff.sourceAbilityId,
    sourceAbilityName: removedBuff.sourceAbilityName,
    sourceUserId: removedBuff.sourceUserId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-DAMAGE: 玄水蛊 redirect split
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call BEFORE applyDamageToTarget().
 *
 * Checks whether `target` (A) carries 玄水蛊 (buff 2607) and the opponent (B)
 * carries 毒手 (buff 2606).  If yes, returns:
 *   - adjustedDamage: the reduced amount A should actually receive (≈45%)
 *   - redirectPlayer: B (the player who will take the redirect hit)
 *   - redirectAmt:    the portion dealt to B (≈55%)
 *
 * If redirect does not apply, returns rawDamage unchanged and null redirectPlayer.
 */
export function preCheckRedirect(
  state: GameState,
  target: { userId: string; buffs: any[]; id?: string },
  rawDamage: number
): { adjustedDamage: number; redirectPlayer: RedirectResolution | null; redirectAmt: number } {
  const noRedirect = { adjustedDamage: rawDamage, redirectPlayer: null, redirectAmt: 0 };
  if (rawDamage <= 0) return noRedirect;

  const now = Date.now();

  // ── 疾电叱羽 zone redirect (runs first, fully absorbs up to zone HP) ──
  const jiDianBuff = (target.buffs as any[]).find(
    (b: any) => b.buffId === JI_DIAN_BUFF_ID && b.expiresAt > now
  );
  if (jiDianBuff) {
    const zoneId: string | undefined = (jiDianBuff as any).linkedZoneId;
    const zone = (state as any).groundZones?.find((z: any) => z.id === zoneId);
    if (zone && (zone.hp ?? 0) > 0) {
      const consume = Math.min(rawDamage, zone.hp);
      zone.hp = Math.max(0, zone.hp - consume);
      pushEvent(state, {
        turn: state.turn,
        type: "DAMAGE",
        actorUserId: target.userId,
        targetUserId: target.userId,
        abilityId: zone.abilityId ?? "ji_dian_chi_yu",
        abilityName: zone.abilityName ?? "疾电叱羽",
        effectType: "JI_DIAN_REDIRECT",
        value: consume,
      } as any);
      // Excess damage is discarded — player takes 0 regardless.
      return { adjustedDamage: 0, redirectPlayer: null, redirectAmt: 0 };
    }
  }

  const yuanGuardBuff = (target.buffs as any[]).find(
    (b: any) => b.buffId === YUAN_GUARD_BUFF_ID && b.expiresAt > now
  );
  if (yuanGuardBuff) {
    const redirectPlayer = (state.players as any[]).find(
      (player: any) =>
        player.userId === (yuanGuardBuff as any).redirectUserId &&
        (player.buffs as any[])?.some(
          (buff: any) => buff.buffId === YUAN_BEAR_BUFF_ID && buff.expiresAt > now
        )
    );
    if (redirectPlayer && redirectPlayer.hp > 0) {
      return {
        adjustedDamage: 0,
        redirectPlayer: {
          player: redirectPlayer,
          mode: "shielded",
          abilityId: "yuan",
          abilityName: "渊",
          effectType: "DAMAGE",
          hideAbilityName: true,
          protectedTarget: getRedirectProtectedTarget(target),
          consumeBuffId: YUAN_GUARD_BUFF_ID,
          consumeRedirectPlayerBuffId: YUAN_BEAR_BUFF_ID,
        },
        redirectAmt: rawDamage,
      };
    }
  }

  const sheshenRedirectBuff = (target.buffs as any[]).find(
    (b: any) => b.buffId === SHESHEN_REDIRECT_BUFF_ID && b.expiresAt > now
  );
  if (sheshenRedirectBuff) {
    const redirectPlayer = (state.players as any[]).find(
      (player: any) =>
        player.userId === (sheshenRedirectBuff as any).redirectUserId &&
        (player.buffs as any[])?.some(
          (buff: any) => buff.buffId === SHESHEN_BEAR_BUFF_ID && buff.expiresAt > now
        )
    );
    if (redirectPlayer && redirectPlayer.hp > 0) {
      return {
        adjustedDamage: 0,
        redirectPlayer: {
          player: redirectPlayer,
          mode: "shielded",
          abilityId: "she_shen_jue",
          abilityName: "舍身诀",
          effectType: "DAMAGE",
          hideAbilityName: true,
          suppressCritLabel: true,
        },
        redirectAmt: rawDamage,
      };
    }
  }

  const hasSelfBuff = target.buffs.some(
    (b: any) => b.buffId === XUANSHUI_SELF_BUFF_ID && b.expiresAt > now
  );
  if (!hasSelfBuff) return noRedirect;

  const redirectPlayer = (state.players as any[]).find(
    (p: any) =>
      p.userId !== target.userId &&
      p.buffs?.some(
        (b: any) => b.buffId === XUANSHUI_POISON_BUFF_ID && b.expiresAt > now
      )
  );
  if (!redirectPlayer || redirectPlayer.hp <= 0 || hasDamageImmune(redirectPlayer as any)) {
    return noRedirect;
  }

  const redirectAmt  = Math.max(1, Math.round(rawDamage * XUANSHUI_REDIRECT_PCT));
  const adjustedDamage = Math.max(0, rawDamage - redirectAmt);
  return {
    adjustedDamage,
    redirectPlayer: {
      player: redirectPlayer,
      mode: "direct-hp",
      abilityId: "xuanshui_gu",
      abilityName: "",
      effectType: "DAMAGE_REDIRECT_55",
    },
    redirectAmt,
  };
}

/**
 * Call AFTER preCheckRedirect() returned a non-null redirectPlayer.
 * Applies the redirect damage directly to B (bypasses shields) and emits a
 * silent DAMAGE event so B sees a floating number with no ability text.
 */
export function applyRedirectToOpponent(
  state: GameState,
  redirectPlayer: RedirectResolution | any,
  redirectAmt: number
): void {
  const redirect = redirectPlayer && redirectPlayer.player
    ? (redirectPlayer as RedirectResolution)
    : {
        player: redirectPlayer,
        mode: "direct-hp",
        abilityId: "xuanshui_gu",
        abilityName: "",
        effectType: "DAMAGE_REDIRECT_55",
      } satisfies RedirectResolution;

  const target = redirect.player;
  if (!target || redirectAmt <= 0) return;

  let actualDamage = 0;
  let shieldAbsorbed = 0;

  if (!hasDamageImmune(target as any)) {
    if (redirect.mode === "shielded") {
      const mitigatedRedirectAmt = resolveRedirectedDamageToTarget({
        target: target as any,
        base: redirectAmt,
      });
      const result = applyDamageToTarget(target as any, mitigatedRedirectAmt);
      actualDamage = result.totalDamage;
      shieldAbsorbed = result.shieldAbsorbed;
      if (result.hpDamage > 0) {
        processOnDamageTaken(state, target as any, result.hpDamage);
      }
    } else {
      const before: number = target.hp;
      target.hp = Math.max(0, target.hp - redirectAmt);
      if (
        target.hp <= 0 &&
        (target.buffs as any[])?.some((b: any) =>
          b.effects?.some((e: any) => e.type === "MIN_HP_1")
        )
      ) {
        target.hp = 1;
      }
      actualDamage = before - target.hp;
      if (actualDamage > 0) {
        processOnDamageTaken(state, target as any, actualDamage);
      }
    }
  }

  if (redirect.consumeBuffId) {
    expireRedirectProtectedBuff(state, redirect.protectedTarget, redirect.consumeBuffId);
  }
  if (redirect.consumeRedirectPlayerBuffId) {
    expireRedirectProtectedBuff(
      state,
      { kind: "player", userId: target.userId },
      redirect.consumeRedirectPlayerBuffId,
    );
  }

  if (actualDamage > 0 || shieldAbsorbed > 0) {
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: target.userId,
      targetUserId: target.userId,
      abilityId: redirect.abilityId,
      abilityName: redirect.abilityName,
      hideAbilityName: redirect.hideAbilityName === true,
      suppressCritLabel: redirect.suppressCritLabel === true,
      effectType: redirect.effectType,
      value: actualDamage,
      shieldAbsorbed: shieldAbsorbed > 0 ? shieldAbsorbed : undefined,
    } as any);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-DAMAGE: 七星拱瑞 freeze-break (and future post-damage hooks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call this AFTER applyDamageToTarget() reports hpDamage > 0.
 * (Redirect is handled pre-damage via preCheckRedirect; this only handles
 *  七星拱瑞 freeze-break and any future post-damage triggers.)
 *
 * @param state           – current game state
 * @param damagedPlayer   – player who just lost HP
 * @param hpDamage        – actual HP lost
 * @param attackerUserId  – userId of whoever dealt the damage
 */
export function processOnDamageTaken(
  state: GameState,
  damagedPlayer: { userId: string; hp: number; buffs: any[] },
  hpDamage: number,
  attackerUserId?: string
): void {
  if (hpDamage <= 0) return;

  const now = Date.now();

  // ── 七星拱瑞 freeze-break ─────────────────────────────────────────────────
  const freezeIdx = damagedPlayer.buffs.findIndex(
    (b) => b.buffId === QIXING_FREEZE_BUFF_ID && b.expiresAt > now
  );
  if (freezeIdx >= 0) {
    const fb = damagedPlayer.buffs[freezeIdx];
    damagedPlayer.buffs.splice(freezeIdx, 1);

    pushBuffExpired(state, {
      targetUserId: damagedPlayer.userId,
      buffId: QIXING_FREEZE_BUFF_ID,
      buffName: fb.name ?? "七星拱瑞",
      buffCategory: "DEBUFF",
      sourceAbilityId: fb.sourceAbilityId ?? "qixing_gongrui",
      sourceAbilityName: fb.sourceAbilityName ?? "七星拱瑞",
      sourceUserId: fb.sourceUserId,
    });

    const casterUserId =
      attackerUserId && attackerUserId !== damagedPlayer.userId
        ? attackerUserId
        : ((state.players as any[]).find(
            (p: any) => p.userId !== damagedPlayer.userId
          )?.userId ?? damagedPlayer.userId);

    addBuff({
      state,
      sourceUserId: casterUserId,
      targetUserId: damagedPlayer.userId,
      ability: QIXING_STUN_ABILITY,
      buffTarget: damagedPlayer as any,
      buff: {
        buffId: QIXING_STUN_BUFF_ID,
        name: "北斗",
        category: "DEBUFF",
        durationMs: 4_000,
        description: "眩晕4秒",
        effects: [{ type: "CONTROL" }],
      },
    });
  }
}
