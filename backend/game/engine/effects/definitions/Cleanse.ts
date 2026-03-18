// backend/game/engine/effects/handlers/handleCleanse.ts

import { ActiveBuff } from "../../state/types";

export function handleCleanse(source: { buffs: ActiveBuff[] }) {
  source.buffs = source.buffs.filter(
    (b) =>
      !b.effects.some(
        (e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK"
      )
  );
}
