// backend/game/engine/flow/turn/buffSource.ts

import { ActiveBuff } from "../../../state/types";

export function getBuffSourceCardId(buff: ActiveBuff) {
  return buff.sourceCardId;
}

export function getBuffSourceCardName(buff: ActiveBuff) {
  // fallback guarantees frontend can always render text
  return buff.sourceCardName ?? buff.name;
}

export function getBuffSourceCardNameWithDebug(buff: ActiveBuff, debug?: string) {
  const base = getBuffSourceCardName(buff);
  return debug ? `${base} · ${debug}` : base;
}
