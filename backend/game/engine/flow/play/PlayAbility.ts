// engine/flow/applyAbility.ts

import { GameState, Ability } from "../../state/types";
import { getEnemy } from "../../utils/targeting";
import { pushEvent } from "../../../services/flow/events";

import { breakOnPlay } from "./breakOnPlay";
import { computeAbilityDodge } from "../../rules/dodge";
import { applyImmediateEffects } from "./immediateEffects";
import { applyAbilityBuffs } from "./buffs";
import { checkGameOver } from "../turn/checkGameOver";

export function applyAbility(
  state: GameState,
  ability: Ability,
  playerIndex: number,
  targetIndex: number
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
  });

  applyAbilityBuffs({
    state,
    ability,
    source,
    target,
    abilityDodged,
  });

  checkGameOver(state);
}
