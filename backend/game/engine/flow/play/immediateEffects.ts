// engine/flow/applyImmediateEffects.ts
import { resolveEffectTargetIndex } from "../../utils/targeting";
import { isEnemyEffect, shouldSkipDueToDodge } from "../../rules/guards";
import {
  handleDamage,
  handleBonusDamageIfHpGt,
  handleHeal,
  handleDraw,
  handleCleanse,
  handleChannelEffect,
  handleDash,
  handleDirectionalDash,
} from "../../effects/handlers";

export function applyImmediateEffects(params: {
  state: any;
  card: any;
  source: any;
  target: any;
  enemy: any;
  playerIndex: number;
  targetIndex: number;
  opponentHpAtStart: number;
  cardDodged: boolean;
}) {
  const {
    state,
    card,
    source,
    target,
    enemy,
    playerIndex,
    targetIndex,
    opponentHpAtStart,
    cardDodged,
  } = params;

  for (const effect of card.effects) {
    const effTargetIndex = resolveEffectTargetIndex(
      targetIndex,
      playerIndex,
      effect.applyTo
    );
    const effTarget = state.players[effTargetIndex];
    const enemyApplied = isEnemyEffect(source, effTarget, effect);

    if (shouldSkipDueToDodge(cardDodged, enemyApplied)) continue;

    switch (effect.type) {
      case "DAMAGE":
        handleDamage(state, source, effTarget, enemyApplied, card, effect);
        break;

      case "BONUS_DAMAGE_IF_TARGET_HP_GT":
        handleBonusDamageIfHpGt(
          state,
          source,
          target,
          opponentHpAtStart,
          card,
          effect
        );
        break;

      case "HEAL":
        handleHeal(state, source, effTarget, card, effect);
        break;

      case "DRAW":
        handleDraw(state, source, effect);
        break;

      case "CLEANSE":
        handleCleanse(source);
        break;

      case "DASH":
        handleDash(state, source, effTarget, enemyApplied, card, effect);
        break;

      case "DIRECTIONAL_DASH": {
        // Always targets self — the opponent position is used only for orientation
        const oppIdx = playerIndex === 0 ? 1 : 0;
        const oppPos = state.players[oppIdx].position;
        handleDirectionalDash(state, source, oppPos, card, effect);
        break;
      }

      case "WUJIAN_CHANNEL":
      case "XINZHENG_CHANNEL":
        handleChannelEffect(state, source, enemy, card, effect);
        break;

      default:
        break;
    }
  }
}
