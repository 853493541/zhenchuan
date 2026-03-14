// backend/game/engine/effects/handlers.ts

import { GameState, Card } from "../state/types";
import { handleDamage } from "./definitions/Damage";
import { handleBonusDamageIfHpGt } from "./definitions/BonusDamageIfHpGt";
import { handleHeal } from "./definitions/Heal";
import { handleDraw } from "./definitions/Draw";
import { handleCleanse } from "./definitions/Cleanse";
import { handleChannelEffect } from "./definitions/Channel";
import { handleDash } from "./definitions/Dash";
import { handleDirectionalDash } from "./definitions/DirectionalDash";
import { handleApplyBuffs } from "./applyBuffs";

/**
 * PUBLIC EFFECT HANDLERS FACADE
 *
 * This file is the stable import boundary.
 * Do NOT put logic here.
 */

export {
  handleDamage,
  handleBonusDamageIfHpGt,
  handleHeal,
  handleDraw,
  handleCleanse,
  handleChannelEffect,
  handleDash,
  handleDirectionalDash,
  handleApplyBuffs,
};
