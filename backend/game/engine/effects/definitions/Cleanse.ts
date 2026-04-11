// backend/game/engine/effects/handlers/handleCleanse.ts

import { ActiveBuff } from "../../state/types";

/**
 * Control level cleansability:
 *   Level 0 – ROOT, SLOW           → REMOVABLE only when effect.cleanseRootSlow=true
 *   Level 1 – CONTROL, ATTACK_LOCK → REMOVABLE by cleanse
 *   Level 2 – KNOCKED_BACK         → NOT removable (physics effect, must expire)
 *   Level 3 – SILENCE              → NOT removable (hard silence, must expire)
 */
export function handleCleanse(
  source: { buffs: ActiveBuff[] },
  effect?: { cleanseRootSlow?: boolean }
) {
  const cleanseRootSlow = effect?.cleanseRootSlow === true;

  source.buffs = source.buffs.filter(
    (b) =>
      !b.effects.some(
        (e) =>
          ((e.type === "ROOT" || e.type === "SLOW") && cleanseRootSlow) ||
          e.type === "CONTROL" ||
          e.type === "ATTACK_LOCK"
      )
  );
}
