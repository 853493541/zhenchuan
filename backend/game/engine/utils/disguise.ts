import { randomUUID } from "crypto";
import type { BuffDefinition, GameState, PlayerState } from "../state/types";
import { isRuntimeBuffActive } from "../rules/guards";

export const SAND_DISGUISE_CONSUMABLE_ID = "sha_shi_wei_zhuang";
export const SAND_DISGUISE_CONSUMABLE_NAME = "砂石伪装";
export const SAND_DISGUISE_BUFF_ID = 980001;
export const SAND_DISGUISE_MESH_NAME = "wj_木车002_hd.glb";
export const GUAN_MU_DISGUISE_CONSUMABLE_ID = "guan_mu_wei_zhuang";
export const GUAN_MU_DISGUISE_CONSUMABLE_NAME = "灌木伪装";
export const GUAN_MU_DISGUISE_BUFF_ID = 980004;
export const GUAN_MU_DISGUISE_MESH_NAME = "pj_玉门草棚001_hd.glb";
export const WA_GUAN_DISGUISE_CONSUMABLE_ID = "wa_guan_wei_zhuang";
export const WA_GUAN_DISGUISE_CONSUMABLE_NAME = "瓦罐伪装";
export const WA_GUAN_DISGUISE_BUFF_ID = 980003;
export const WA_GUAN_DISGUISE_MESH_NAME = "wj_坛子001_001_hd.glb";
export const SAND_DISGUISE_BUFF_NAME = "伪装";
export const SAND_DISGUISE_DURATION_MS = 4 * 60_000;
export const SAND_DISGUISE_LEASH_RADIUS_UNITS = 2;

export const SAND_DISGUISE_BUFF: BuffDefinition = {
  buffId: SAND_DISGUISE_BUFF_ID,
  name: SAND_DISGUISE_BUFF_NAME,
  category: "BUFF",
  durationMs: SAND_DISGUISE_DURATION_MS,
  breakOnPlay: false,
  description: "伪装成地图物件，无法移动、无法被目标选择；受到攻击进入战斗后立即解除。",
  effects: [
    { type: "STEALTH" },
    { type: "ROOT" },
    { type: "SPECIAL_ABILITY_BAR", abilityIds: ["jie_chu_wei_zhuang"] } as any,
    { type: "DISGUISE", meshName: SAND_DISGUISE_MESH_NAME } as any,
  ],
  disguiseMeshName: SAND_DISGUISE_MESH_NAME,
} as any;

export const WA_GUAN_DISGUISE_BUFF: BuffDefinition = {
  buffId: WA_GUAN_DISGUISE_BUFF_ID,
  name: SAND_DISGUISE_BUFF_NAME,
  category: "BUFF",
  durationMs: SAND_DISGUISE_DURATION_MS,
  breakOnPlay: false,
  description: "伪装成地图物件，无法移动、无法被目标选择；受到攻击进入战斗后立即解除。",
  effects: [
    { type: "STEALTH" },
    { type: "ROOT" },
    { type: "SPECIAL_ABILITY_BAR", abilityIds: ["jie_chu_wei_zhuang"] } as any,
    { type: "DISGUISE", meshName: WA_GUAN_DISGUISE_MESH_NAME } as any,
  ],
  disguiseMeshName: WA_GUAN_DISGUISE_MESH_NAME,
} as any;

export const GUAN_MU_DISGUISE_BUFF: BuffDefinition = {
  buffId: GUAN_MU_DISGUISE_BUFF_ID,
  name: SAND_DISGUISE_BUFF_NAME,
  category: "BUFF",
  durationMs: SAND_DISGUISE_DURATION_MS,
  breakOnPlay: false,
  description: "伪装成地图物件，无法移动、无法被目标选择；受到攻击进入战斗后立即解除。",
  effects: [
    { type: "STEALTH" },
    { type: "ROOT" },
    { type: "SPECIAL_ABILITY_BAR", abilityIds: ["jie_chu_wei_zhuang"] } as any,
    { type: "DISGUISE", meshName: GUAN_MU_DISGUISE_MESH_NAME } as any,
  ],
  disguiseMeshName: GUAN_MU_DISGUISE_MESH_NAME,
} as any;

export const SAND_DISGUISE_ABILITY = {
  id: SAND_DISGUISE_CONSUMABLE_ID,
  name: SAND_DISGUISE_CONSUMABLE_NAME,
  type: "CONSUMABLE",
  target: "SELF",
  buffs: [SAND_DISGUISE_BUFF],
} as any;

export const WA_GUAN_DISGUISE_ABILITY = {
  id: WA_GUAN_DISGUISE_CONSUMABLE_ID,
  name: WA_GUAN_DISGUISE_CONSUMABLE_NAME,
  type: "CONSUMABLE",
  target: "SELF",
  buffs: [WA_GUAN_DISGUISE_BUFF],
} as any;

export const GUAN_MU_DISGUISE_ABILITY = {
  id: GUAN_MU_DISGUISE_CONSUMABLE_ID,
  name: GUAN_MU_DISGUISE_CONSUMABLE_NAME,
  type: "CONSUMABLE",
  target: "SELF",
  buffs: [GUAN_MU_DISGUISE_BUFF],
} as any;

export function createSandDisguiseRuntimeBuff(anchor: { x: number; y: number }): BuffDefinition {
  return {
    ...SAND_DISGUISE_BUFF,
    leashOriginX: anchor.x,
    leashOriginY: anchor.y,
    leashRadiusUnits: SAND_DISGUISE_LEASH_RADIUS_UNITS,
  } as BuffDefinition;
}

export function createWaGuanDisguiseRuntimeBuff(anchor: { x: number; y: number }): BuffDefinition {
  return {
    ...WA_GUAN_DISGUISE_BUFF,
    leashOriginX: anchor.x,
    leashOriginY: anchor.y,
    leashRadiusUnits: SAND_DISGUISE_LEASH_RADIUS_UNITS,
  } as BuffDefinition;
}

export function createGuanMuDisguiseRuntimeBuff(anchor: { x: number; y: number }): BuffDefinition {
  return {
    ...GUAN_MU_DISGUISE_BUFF,
    leashOriginX: anchor.x,
    leashOriginY: anchor.y,
    leashRadiusUnits: SAND_DISGUISE_LEASH_RADIUS_UNITS,
  } as BuffDefinition;
}

export function isDisguiseBuff(buff: any): boolean {
  return buff?.buffId === SAND_DISGUISE_BUFF_ID ||
    buff?.buffId === GUAN_MU_DISGUISE_BUFF_ID ||
    buff?.buffId === WA_GUAN_DISGUISE_BUFF_ID ||
    (Array.isArray(buff?.effects) && buff.effects.some((effect: any) => effect?.type === "DISGUISE"));
}

export function hasDisguiseBuff(player: Pick<PlayerState, "buffs"> | null | undefined): boolean {
  return Array.isArray(player?.buffs) && player.buffs.some((buff) => isRuntimeBuffActive(buff) && isDisguiseBuff(buff));
}

export function clearTargetSelectionsTargetingPlayer(state: GameState, targetUserId: string): boolean {
  let changed = false;
  for (const player of state.players ?? []) {
    if (player.userId === targetUserId) continue;
    const selection = (player as any).targetSelection;
    if (selection?.kind === "player" && selection.userId === targetUserId) {
      delete (player as any).targetSelection;
      changed = true;
    }
  }
  return changed;
}

export function removeDisguiseBuffs(state: GameState, player: PlayerState, timestamp = Date.now()): boolean {
  if (!Array.isArray(player.buffs) || player.buffs.length === 0) return false;

  const removed = player.buffs.filter(isDisguiseBuff);
  if (removed.length === 0) return false;

  player.buffs = player.buffs.filter((buff) => !isDisguiseBuff(buff));
  clearTargetSelectionsTargetingPlayer(state, player.userId);

  for (const buff of removed) {
    state.events.push({
      id: randomUUID(),
      timestamp,
      turn: state.turn,
      type: "BUFF_EXPIRED",
      actorUserId: player.userId,
      targetUserId: player.userId,
      abilityId: buff.sourceAbilityId ?? SAND_DISGUISE_CONSUMABLE_ID,
      abilityName: buff.sourceAbilityName ?? SAND_DISGUISE_CONSUMABLE_NAME,
      buffId: buff.buffId,
      buffName: buff.name,
      buffCategory: buff.category,
    } as any);
  }

  return true;
}