// engine/flow/applyAbility.ts

import { GameState, Ability } from "../../state/types";
import { getEnemy } from "../../utils/targeting";
import { pushEvent } from "../../../services/flow/events";
import { addBuff } from "../../effects/buffRuntime";
import { applyDamageToTarget } from "../../utils/health";

import { breakOnPlay } from "./breakOnPlay";
import { computeAbilityDodge } from "../../rules/dodge";
import { applyImmediateEffects } from "./immediateEffects";
import { applyAbilityBuffs } from "./buffs";
import { checkGameOver } from "../turn/checkGameOver";
import type { MapContext } from "../../loop/movement";

export function applyAbility(
  state: GameState,
  ability: Ability,
  playerIndex: number,
  targetIndex: number,
  mapCtx?: MapContext,
  castContext?: {
    targetUserId?: string;
    groundTarget?: { x: number; y: number; z?: number };
    entityTargetId?: string;
  }
) {
  if (state.gameOver) return;

  const source = state.players[playerIndex];
  const target = state.players[targetIndex];
  const enemy = getEnemy(state, playerIndex);
  const entityTarget = castContext?.entityTargetId
    ? (state.entities ?? []).find((entity) => entity.id === castContext.entityTargetId) ?? null
    : null;

  /**
   * ================= GCD SPEND =================
   * Validation already happened in validatePlayAbility
   * This is the single authoritative place where GCD is consumed
   */
  pushEvent(state, {
    turn: state.turn,
    type: "PLAY_ABILITY",
    actorUserId: source.userId,
    targetUserId: target.userId,
    abilityId: ability.id,
    abilityName: ability.name,
  });

  breakOnPlay(source, ability);

  const opponentHpAtStart = target.hp;
  const abilityDodged = entityTarget ? false : computeAbilityDodge(ability, target);

  if (abilityDodged) {
    pushEvent(state, {
      turn: state.turn,
      type: "DODGE",
      actorUserId: target.userId,
      targetUserId: source.userId,
      abilityId: ability.id,
      abilityName: ability.name,
    } as any);
  }

  applyImmediateEffects({
    state,
    ability,
    source,
    target,
    enemy,
    playerIndex,
    targetIndex,
    opponentHpAtStart,
    abilityDodged,
    mapCtx,
    castContext,
  });

  applyAbilityBuffs({
    state,
    ability,
    source,
    target,
    entityTarget,
    abilityDodged,
  });

  // 绛唇珠袖: manually apply only the cast-time debuff (2323) to the opponent.
  // Buff 2324 (沉默) is trigger-only; applied in playService when opponent uses 轻功.
  if (ability.id === "jiang_chun_zhu_xiu" && !abilityDodged) {
    const debuffDef = (ability as any).buffs?.find((b: any) => b.buffId === 2323);
    if (debuffDef) {
      addBuff({
        state,
        sourceUserId: source.userId,
        targetUserId: target.userId,
        ability: ability as any,
        buffTarget: target as any,
        buff: debuffDef,
      });
    }
  }

  checkGameOver(state);

  // ── 傍花随柳 on-play trigger ──────────────────────────────────────────────
  // Each stack consumed deals 2 damage; consuming the last (3rd) stack also silences 4s.
  const BANG_HUA_BUFF_ID    = 2611;
  const BANG_HUA_SILENCE_ID = 2612;
  const triggerNow = Date.now();
  const bangHuaIdx = (source.buffs as any[]).findIndex(
    (b: any) => b.buffId === BANG_HUA_BUFF_ID && b.expiresAt > triggerNow
  );
  if (bangHuaIdx >= 0) {
    const bangHuaBuff = (source.buffs as any[])[bangHuaIdx];
    const currentStacks = bangHuaBuff.stacks ?? 1;
    const casterUserId = enemy?.userId ?? target.userId;
    const isLastStack = currentStacks <= 1;

    // Always: consume 1 stack and deal 2 damage
    if (isLastStack) {
      (source.buffs as any[]).splice(bangHuaIdx, 1);
    } else {
      bangHuaBuff.stacks = currentStacks - 1;
    }
    applyDamageToTarget(source as any, 2);
    pushEvent(state, {
      turn: state.turn,
      type: "DAMAGE",
      actorUserId: casterUserId,
      targetUserId: source.userId,
      abilityId: "bang_hua_sui_liu",
      abilityName: "傍花随柳",
      effectType: "BANG_HUA_TRIGGER",
      value: 2,
    } as any);

    // Last stack: also apply 束发 silence 4s
    if (isLastStack) {
      addBuff({
        state,
        sourceUserId: casterUserId,
        targetUserId: source.userId,
        ability: { id: "bang_hua_sui_liu", name: "傍花随柳" } as Ability,
        buffTarget: source as any,
        buff: {
          buffId: BANG_HUA_SILENCE_ID,
          name: "束发",
          category: "DEBUFF",
          durationMs: 4_000,
          description: "沉默4秒",
          effects: [{ type: "SILENCE" }],
        } as any,
      });
    }
  }
}
