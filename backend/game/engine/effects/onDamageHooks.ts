// backend/game/engine/effects/onDamageHooks.ts
//
// Shared on-damage effect hooks. Call processOnDamageTaken() after any call
// to applyDamageToTarget() that deals HP damage to a player.
//
// Handles:
//   • 七星拱瑞 (buff 2600): when the frozen player takes HP damage, instantly
//     remove the freeze and apply 北斗 (buff 2601, CONTROL 4 s).
//   • 玄水蛊  (buff 2607): when the buff-holder takes HP damage, restore 55%
//     of it to them and deal that 55% to the opponent carrying 毒手 (buff 2606).

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

/**
 * Call this after applyDamageToTarget() reports hpDamage > 0.
 *
 * @param state           – current game state
 * @param damagedPlayer   – player who just lost HP (must expose .userId, .hp, .buffs)
 * @param hpDamage        – actual HP lost (the hpDamage returned by applyDamageToTarget)
 * @param attackerUserId  – userId of whoever dealt the damage (optional but recommended)
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

    // The caster who froze this player is the attacker; fall back to the
    // other player when attackerUserId is absent or points to self.
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

  // ── 玄水蛊 damage redirect ─────────────────────────────────────────────────
  // No isEnemyEffect restriction — redirect fires regardless of damage source.
  const hasXuanshui = damagedPlayer.buffs.some(
    (b) => b.buffId === XUANSHUI_SELF_BUFF_ID && b.expiresAt > now
  );
  if (hasXuanshui) {
    const redirectTarget = (state.players as any[]).find(
      (p: any) =>
        p.userId !== damagedPlayer.userId &&
        p.buffs?.some(
          (b: any) => b.buffId === XUANSHUI_POISON_BUFF_ID && b.expiresAt > now
        )
    );
    if (redirectTarget && redirectTarget.hp > 0) {
      // Respect DAMAGE_IMMUNE / 无敌 — cannot force damage through invulnerability
      if (hasDamageImmune(redirectTarget as any)) return;

      const redirectAmt = Math.max(1, Math.round(hpDamage * XUANSHUI_REDIRECT_PCT));
      // Restore the redirected portion to the original damaged player.
      // Look up via state.players to ensure we always mutate the authoritative ref.
      const damagedInState =
        (state.players as any[]).find((p: any) => p.userId === damagedPlayer.userId) ??
        (damagedPlayer as any);
      damagedInState.hp = Math.min(
        damagedInState.maxHp ?? 100,
        damagedInState.hp + redirectAmt
      );
      // Keep passed reference in sync in case it differed
      (damagedPlayer as any).hp = damagedInState.hp;

      // Redirected damage bypasses shields and damage reduction — apply directly to HP.
      // Still respects MIN_HP_1 (啸如虎 unkillable).
      const rtHpBefore: number = redirectTarget.hp;
      redirectTarget.hp = Math.max(0, redirectTarget.hp - redirectAmt);
      // MIN_HP_1 clamp
      if (
        redirectTarget.hp <= 0 &&
        (redirectTarget.buffs as any[])?.some((b: any) =>
          b.effects?.some((e: any) => e.type === "MIN_HP_1")
        )
      ) {
        redirectTarget.hp = 1;
      }
      // No floating number for A (actorUserId = B = redirectTarget.userId so A
      // never hits the "I dealt damage" branch).
      // B sees a dmg_taken float with no ability text (abilityName = "").
      pushEvent(state, {
        turn: state.turn,
        type: "DAMAGE",
        actorUserId: redirectTarget.userId,
        targetUserId: redirectTarget.userId,
        abilityId: "xuanshui_gu",
        abilityName: "",
        effectType: "DAMAGE_REDIRECT_55",
        value: redirectAmt,
      } as any);
      void rtHpBefore; // suppress unused warning
    }
  }
}
