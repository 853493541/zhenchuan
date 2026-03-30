// backend/game/engine/effects/system.ts

import { randomUUID } from "crypto";
import {
  GameState,
  Ability,
  GameEvent,
  ActiveBuff,
  BuffDefinition,
} from "../state/types";
import { resolveScheduledDamage } from "../utils/combatMath";

/* ================= Utilities ================= */

function pushEvent(
  state: GameState,
  e: Omit<GameEvent, "id" | "timestamp">
) {
  state.events.push({
    id: randomUUID(),
    timestamp: Date.now(),
    ...e,
  });
}

function isDunyingCompanion(buff: ActiveBuff): boolean {
  return buff.buffId === 1021 && (buff.name === "遁影" || buff.sourceAbilityId === "fuguang_lueying");
}

function isMoheKnockdown(buff: ActiveBuff): boolean {
  return buff.buffId === 1002 && buff.sourceAbilityId === "mohe_wuliang";
}

function isMoheStun(buff: ActiveBuff): boolean {
  return buff.buffId === 1202 && buff.sourceAbilityId === "mohe_wuliang";
}

function isStunDebuff(buff: ActiveBuff): boolean {
  if (isMoheKnockdown(buff)) return false;
  if (buff.category !== "DEBUFF") return false;
  return buff.effects.some((e) => e.type === "CONTROL");
}

const CONTROL_TYPES_BLOCKED_WHILE_KNOCKED_DOWN = new Set([
  "ROOT",
  "CONTROL",
  "ATTACK_LOCK",
  "KNOCKED_BACK",
]);

function hasRootSlowImmune(target: { buffs: ActiveBuff[] }): boolean {
  return target.buffs.some((b) => b.effects.some((e) => e.type === "ROOT_SLOW_IMMUNE"));
}

function hasKnockbackImmune(target: { buffs: ActiveBuff[] }): boolean {
  return target.buffs.some((b) => b.effects.some((e) => e.type === "KNOCKBACK_IMMUNE"));
}

function hasControlImmune(target: { buffs: ActiveBuff[] }): boolean {
  return target.buffs.some((b) => b.effects.some((e) => e.type === "CONTROL_IMMUNE"));
}

function hasSilenceImmune(target: { buffs: ActiveBuff[] }): boolean {
  return target.buffs.some((b) => b.effects.some((e) => e.type === "SILENCE_IMMUNE"));
}

function removeStealthOnIncomingControl(params: {
  state: GameState;
  targetUserId: string;
  target: { buffs: ActiveBuff[] };
  controlTypes: string[];
}) {
  const { state, targetUserId, target, controlTypes } = params;
  if (controlTypes.length === 0) return;

  const tiandiBreakTypes = ["CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "SILENCE"];
  const fuguangBreakTypes = ["ROOT", "CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "SILENCE"];

  const removed: ActiveBuff[] = [];
  target.buffs = target.buffs.filter((b) => {
    if (b.buffId === 1011) return true; // 暗尘: incoming control never breaks stealth
    if (b.buffId === 1012) {
      const shouldBreak = controlTypes.some((t) => fuguangBreakTypes.includes(t));
      if (shouldBreak) removed.push(b);
      return !shouldBreak;
    }
    if (b.buffId === 1013) {
      const shouldBreak = controlTypes.some((t) => tiandiBreakTypes.includes(t));
      if (shouldBreak) removed.push(b);
      return !shouldBreak;
    }
    return true;
  });

  // 浮光掠影(1012) breaks early -> remove its companion 遁影(1021) immediately.
  if (removed.some((b) => b.buffId === 1012)) {
    const companionRemoved = target.buffs.filter((b) => isDunyingCompanion(b));
    if (companionRemoved.length > 0) {
      target.buffs = target.buffs.filter((b) => !isDunyingCompanion(b));
      removed.push(...companionRemoved);
    }
  }

  for (const b of removed) {
    pushEvent(state, {
      turn: state.turn,
      type: "BUFF_EXPIRED",
      actorUserId: targetUserId,
      targetUserId,
      abilityId: b.sourceAbilityId,
      abilityName: b.sourceAbilityName,
      buffId: b.buffId,
      buffName: b.name,
      buffCategory: b.category,
    });
  }
}

/* ================= Buff System ================= */

/**
 * Apply a buff to a target player.
 *
 * Buff lifetime is wall-clock based:
 *   expiresAt = Date.now() + buff.durationMs
 *
 * For periodic effects (DoT / HoT):
 *   lastTickAt = Date.now()  — first tick fires periodicMs after application
 */
export function addBuff(params: {
  state: GameState;
  sourceUserId: string;
  targetUserId: string;
  ability: Ability;
  buffTarget: { userId: string; buffs: ActiveBuff[] };
  buff: BuffDefinition;
}) {
  const {
    state,
    sourceUserId,
    targetUserId,
    ability,
    buffTarget,
    buff,
  } = params;

  let runtimeBuff: BuffDefinition = buff;

  if (sourceUserId !== targetUserId && hasRootSlowImmune(buffTarget)) {
    const filteredEffects = runtimeBuff.effects.filter(
      (e) => e.type !== "ROOT" && e.type !== "SLOW"
    );
    if (filteredEffects.length === 0) {
      return;
    }
    if (filteredEffects.length !== runtimeBuff.effects.length) {
      runtimeBuff = {
        ...runtimeBuff,
        effects: filteredEffects,
      };
    }
  }

  if (
    sourceUserId !== targetUserId &&
    runtimeBuff.effects.some((e) => e.type === "KNOCKED_BACK") &&
    hasKnockbackImmune(buffTarget)
  ) {
    return;
  }

  if (sourceUserId !== targetUserId && hasControlImmune(buffTarget)) {
    const filteredEffects = runtimeBuff.effects.filter(
      (e) => e.type !== "CONTROL" && e.type !== "ATTACK_LOCK"
    );
    if (filteredEffects.length === 0) {
      return;
    }
    if (filteredEffects.length !== runtimeBuff.effects.length) {
      runtimeBuff = {
        ...runtimeBuff,
        effects: filteredEffects,
      };
    }
  }

  if (sourceUserId !== targetUserId && hasSilenceImmune(buffTarget)) {
    const filteredEffects = runtimeBuff.effects.filter((e) => e.type !== "SILENCE");
    if (filteredEffects.length === 0) {
      return;
    }
    if (filteredEffects.length !== runtimeBuff.effects.length) {
      runtimeBuff = {
        ...runtimeBuff,
        effects: filteredEffects,
      };
    }
  }

  // 摩诃无量交互：倒地期间免疫其他控制层级（可被沉默），并且新硬控会替换摩诃无量·眩晕。
  if (sourceUserId !== targetUserId) {
    const incomingMoheKnockdown =
      (ability.id === "mohe_wuliang" || runtimeBuff.buffId === 1002) &&
      runtimeBuff.effects.some((e) => e.type === "CONTROL");
    if (incomingMoheKnockdown) {
      const removedStuns = buffTarget.buffs.filter(isStunDebuff);
      if (removedStuns.length > 0) {
        buffTarget.buffs = buffTarget.buffs.filter((b) => !isStunDebuff(b));
        for (const b of removedStuns) {
          pushEvent(state, {
            turn: state.turn,
            type: "BUFF_EXPIRED",
            actorUserId: targetUserId,
            targetUserId,
            abilityId: b.sourceAbilityId,
            abilityName: b.sourceAbilityName,
            buffId: b.buffId,
            buffName: b.name,
            buffCategory: b.category,
          });
        }
      }
    }

    if (buffTarget.buffs.some(isMoheKnockdown)) {
      const filteredEffects = runtimeBuff.effects.filter(
        (e) => !CONTROL_TYPES_BLOCKED_WHILE_KNOCKED_DOWN.has(e.type)
      );
      if (filteredEffects.length === 0) {
        return;
      }
      if (filteredEffects.length !== runtimeBuff.effects.length) {
        runtimeBuff = {
          ...runtimeBuff,
          effects: filteredEffects,
        };
      }
    }

    const incomingHardControl = runtimeBuff.effects.some(
      (e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK" || e.type === "KNOCKED_BACK"
    );
    if (incomingHardControl) {
      const removedMoheStuns = buffTarget.buffs.filter(isMoheStun);
      if (removedMoheStuns.length > 0) {
        buffTarget.buffs = buffTarget.buffs.filter((b) => !isMoheStun(b));
        for (const b of removedMoheStuns) {
          pushEvent(state, {
            turn: state.turn,
            type: "BUFF_EXPIRED",
            actorUserId: targetUserId,
            targetUserId,
            abilityId: b.sourceAbilityId,
            abilityName: b.sourceAbilityName,
            buffId: b.buffId,
            buffName: b.name,
            buffCategory: b.category,
          });
        }
      }
    }
  }

  // Stacking: if buff defines maxStacks > 1, increment stacks on the existing buff
  // instead of replacing it. The lastTickAt is intentionally NOT reset — this prevents
  // stack-refresh abuse (re-casting resets the tick timer allowing faster ticks).
  if (runtimeBuff.maxStacks !== undefined && runtimeBuff.maxStacks > 1) {
    const existing = buffTarget.buffs.find((b) => b.buffId === runtimeBuff.buffId);
    if (existing) {
      const now = Date.now();
      existing.stacks = Math.min((existing.stacks ?? 1) + 1, runtimeBuff.maxStacks);
      existing.expiresAt = now + runtimeBuff.durationMs;

      // 三环套月: consume at 3 stacks and deal immediate bonus damage.
      if (runtimeBuff.buffId === 3001 && (existing.stacks ?? 0) >= (runtimeBuff.maxStacks ?? 3)) {
        const source = state.players.find((p: any) => p.userId === sourceUserId);
        const target = state.players.find((p: any) => p.userId === targetUserId);
        if (target && target.hp > 0) {
          const bonus = source
            ? resolveScheduledDamage({ source, target, base: 3 })
            : 3;
          target.hp = Math.max(0, target.hp - bonus);
          if (bonus > 0) {
            pushEvent(state, {
              turn: state.turn,
              type: "DAMAGE",
              actorUserId: sourceUserId,
              targetUserId,
              abilityId: ability.id,
              abilityName: ability.name,
              value: bonus,
              effectType: "DAMAGE",
            });
          }
        }
        buffTarget.buffs = buffTarget.buffs.filter((b) => b.buffId !== runtimeBuff.buffId);
        pushEvent(state, {
          turn: state.turn,
          type: "BUFF_EXPIRED",
          actorUserId: targetUserId,
          targetUserId,
          abilityId: ability.id,
          abilityName: ability.name,
          buffId: existing.buffId,
          buffName: existing.name,
          buffCategory: existing.category,
        });
        return;
      }

      pushEvent(state, {
        turn: state.turn,
        type: "BUFF_APPLIED",
        actorUserId: sourceUserId,
        targetUserId,
        abilityId: ability.id,
        abilityName: ability.name,
        buffId: existing.buffId,
        buffName: existing.name,
        buffCategory: existing.category,
        appliedAtTurn: existing.appliedAtTurn,
      });
      return;
    }
  }

  // Refresh same buffId (stable replacement — resets the timer)
  buffTarget.buffs = buffTarget.buffs.filter(
    (b) => b.buffId !== runtimeBuff.buffId
  );

  const now = Date.now();

  const active: ActiveBuff = {
    buffId: runtimeBuff.buffId,
    name: runtimeBuff.name,
    category: runtimeBuff.category,

    effects: runtimeBuff.effects.map((e) => ({ ...e })), // clone for runtime mutation

    expiresAt: now + runtimeBuff.durationMs,

    // Periodic effects (DoT / HoT)
    ...(runtimeBuff.periodicMs !== undefined && {
      periodicMs: runtimeBuff.periodicMs,
      periodicStartImmediate: runtimeBuff.periodicStartImmediate === true,
      lastTickAt:
        runtimeBuff.periodicStartImmediate === true
          ? now - runtimeBuff.periodicMs
          : now,
    }),

    appliedAtTurn: state.turn, // informational only
    appliedAt: now,             // wall-clock ms — used by TIMED_AOE_DAMAGE
    breakOnPlay: runtimeBuff.breakOnPlay,
    cancelOnMove: runtimeBuff.cancelOnMove,
    cancelOnJump: runtimeBuff.cancelOnJump,
    cancelOnOutOfRange: runtimeBuff.cancelOnOutOfRange,
    forwardChannel: runtimeBuff.forwardChannel,
    sourceUserId: sourceUserId,
    stacks: runtimeBuff.initialStacks,
    maxStacks: runtimeBuff.maxStacks,
    procCooldownMs: runtimeBuff.procCooldownMs,

    sourceAbilityId: ability.id,
    sourceAbilityName: ability.name,
  };

  buffTarget.buffs.push(active);

  // Incoming control can forcibly break specific stealth buffs.
  if (sourceUserId !== targetUserId) {
    const controlTypes = runtimeBuff.effects
      .map((e) => e.type)
      .filter((t) => ["ROOT", "CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "SILENCE"].includes(t));
    removeStealthOnIncomingControl({
      state,
      targetUserId,
      target: buffTarget,
      controlTypes,
    });
  }

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_APPLIED",
    actorUserId: sourceUserId,
    targetUserId,
    abilityId: ability.id,
    abilityName: ability.name,

    buffId: active.buffId,
    buffName: active.name,
    buffCategory: active.category,
    appliedAtTurn: active.appliedAtTurn,
  });
}

/**
 * Emit a buff-expired event.
 */
export function pushBuffExpired(
  state: GameState,
  params: {
    targetUserId: string;
    buffId: number;
    buffName: string;
    buffCategory: "BUFF" | "DEBUFF";
    sourceAbilityId?: string;
    sourceAbilityName?: string;
  }
) {
  const {
    targetUserId,
    buffId,
    buffName,
    buffCategory,
    sourceAbilityId,
    sourceAbilityName,
  } = params;

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_EXPIRED",
    actorUserId: targetUserId,
    targetUserId,
    abilityId: sourceAbilityId,
    abilityName: sourceAbilityName,
    buffId,
    buffName,
    buffCategory,
  });
}
