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
  CardEffect,
  BuffEffect,
} from "./types/effects";

/* ================= Buffs ================= */
export type {
  BuffCategory,
  BuffApplyTo,
  BuffTickOn,
  BuffDefinition,
  ActiveBuff,
} from "./types/buffs";

/* ================= Cards ================= */
export type {
  CardType,
  TargetType,
  Card,
  CardInstance,
} from "./types/cards";

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

export {
  calculateDistance,
  calculateAngle,
} from "./types/position";
