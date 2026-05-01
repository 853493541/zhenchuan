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
  target: { userId: string; buffs: any[] },
  rawDamage: number
): { adjustedDamage: number; redirectPlayer: any | null; redirectAmt: number } {
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
  return { adjustedDamage, redirectPlayer, redirectAmt };
}

/**
 * Call AFTER preCheckRedirect() returned a non-null redirectPlayer.
 * Applies the redirect damage directly to B (bypasses shields) and emits a
 * silent DAMAGE event so B sees a floating number with no ability text.
 */
export function applyRedirectToOpponent(
  state: GameState,
  redirectPlayer: any,
  redirectAmt: number
): void {
  const before: number = redirectPlayer.hp;
  redirectPlayer.hp = Math.max(0, redirectPlayer.hp - redirectAmt);
  // MIN_HP_1 (啸如虎 unkillable)
  if (
    redirectPlayer.hp <= 0 &&
    (redirectPlayer.buffs as any[])?.some((b: any) =>
      b.effects?.some((e: any) => e.type === "MIN_HP_1")
    )
  ) {
    redirectPlayer.hp = 1;
  }
  const actual = before - redirectPlayer.hp;
  if (actual > 0) {
    // B sees a damage float with no ability text.
    // actorUserId = B (redirectPlayer) → A's client never matches as attacker.
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: redirectPlayer.userId,
      targetUserId: redirectPlayer.userId,
      abilityId:    "xuanshui_gu",
      abilityName:  "",
      effectType:   "DAMAGE_REDIRECT_55",
      value:        actual,
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
