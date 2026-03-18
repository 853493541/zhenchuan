// engine/flow/breakOnPlay.ts
import { ActiveBuff } from "../../state/types";

export function breakOnPlay(source: { buffs?: ActiveBuff[] }) {
  if (!Array.isArray(source.buffs)) return;
  source.buffs = source.buffs.filter((b) => !b.breakOnPlay);
}
