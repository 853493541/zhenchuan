// backend/game/engine/flow/turn/buffSource.ts

import { ActiveBuff } from "../../../state/types";

export function getBuffSourceAbilityId(buff: ActiveBuff) {
  return buff.sourceAbilityId;
}

export function getBuffSourceAbilityName(buff: ActiveBuff) {
  // fallback guarantees frontend can always render text
  return buff.sourceAbilityName ?? buff.name;
}

export function getBuffSourceAbilityNameWithDebug(buff: ActiveBuff, debug?: string) {
  const base = getBuffSourceAbilityName(buff);
  return debug ? `${base} · ${debug}` : base;
}
