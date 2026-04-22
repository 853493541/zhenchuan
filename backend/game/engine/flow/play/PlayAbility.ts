// engine/flow/applyAbility.ts

import { GameState, Ability } from "../../state/types";
import { getEnemy } from "../../utils/targeting";
import { pushEvent } from "../../../services/flow/events";
import { addBuff } from "../../effects/buffRuntime";

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
  }
) {
  if (state.gameOver) return;

  const source = state.players[playerIndex];
  const target = state.players[targetIndex];
  const enemy = getEnemy(state, playerIndex);

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
  const abilityDodged = computeAbilityDodge(ability, target);

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
}
