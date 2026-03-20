// backend/game/engine/state/types.ts
// SINGLE ENTRY — explicit, boring, correct

/* ================= Common ================= */
export type { PlayerID } from "./types/common";

/* ================= Scheduling ================= */
export type {
  TurnPhase,
  ScheduledTarget,
  ScheduledTurnOf,
} from "./types/scheduling";

/* ================= Effects ================= */
export type {
  EffectType,
  AbilityEffect,
  BuffEffect,
} from "./types/effects";

/* ================= Buffs ================= */
export type {
  BuffCategory,
  BuffApplyTo,
  BuffDefinition,
  ActiveBuff,
} from "./types/buffs";

/* ================= Cards ================= */
export type {
  AbilityType,
  TargetType,
  Ability,
  AbilityInstance,
} from "./types/abilities";

/* ================= Events ================= */
export type {
  GameEventType,
  GameEvent,
} from "./types/events";

/* ================= Runtime / State ================= */
export type {
  PlayerState,
  GameState,
} from "./types/state";

/* ================= Tournament / Draft / Economy ================= */
export type {
  PlayerEconomy,
  Shop,
  BattleInstance,
  TournamentState,
} from "./types/tournament";

export {
  LOSER_DAMAGE_BY_BATTLE,
  STARTING_GAME_HP,
  STARTING_BATTLE_HP,
  STARTING_GOLD,
  GOLD_PER_ROUND,
  LEVEL_UP_COSTS,
  RARITY_POOLS,
} from "./types/tournament";

/* ================= Position & Movement ================= */
export type {
  Position,
  Velocity,
  MovementInput,
} from "./types/position";

/* ================= World Map ================= */
export type {
  MapObjectType,
  MapObject,
  WorldMap,
} from "./types/map";

export {
  calculateDistance,
  calculateAngle,
} from "./types/position";
