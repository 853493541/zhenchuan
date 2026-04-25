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
import { addShieldToTarget, applyDamageToTarget, removeLinkedShield } from "../utils/health";
import { applyPropertyOverridesToEffects, loadBuffEditorOverrides } from "../../abilities/buffEditorOverrides";

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

const ROOT_DR_BUFF_ID = 990100;
const STUN_DR_BUFF_ID = 990101;
const LOCKOUT_DR_BUFF_ID = 990102;
const FREEZE_DR_BUFF_ID = 990103;
const CONTROL_DR_DURATION_MS = 10_000;
// 雷霆震怒: stun + damage immunity package
const LEI_TING_ZHEN_NU_BUFF_ID = 2506;

type ResistanceConfig = {
  buffId: number;
  name: string;
};

const ROOT_DR_CONFIG: ResistanceConfig = {
  buffId: ROOT_DR_BUFF_ID,
  name: "锁足抗性",
};

const STUN_DR_CONFIG: ResistanceConfig = {
  buffId: STUN_DR_BUFF_ID,
  name: "眩晕抗性",
};

const FREEZE_DR_CONFIG: ResistanceConfig = {
  buffId: FREEZE_DR_BUFF_ID,
  name: "定身抗性",
};

const LOCKOUT_DR_CONFIG: ResistanceConfig = {
  buffId: LOCKOUT_DR_BUFF_ID,
  name: "锁招抗性",
};

const SHARED_LOCKOUT_EFFECT_TYPES = new Set(["SILENCE", "ATTACK_LOCK"]);

function getActiveResistanceBuff(
  target: { buffs: ActiveBuff[] },
  buffId: number,
  now: number
): ActiveBuff | undefined {
  return target.buffs.find(
    (b) => b.buffId === buffId && b.expiresAt > now
  );
}

function getResistanceConfig(runtimeBuff: BuffDefinition): ResistanceConfig | null {
  if (runtimeBuff.category !== "DEBUFF") return null;
  if (runtimeBuff.buffId === 1002) return null;

  if (runtimeBuff.effects.some((e) => SHARED_LOCKOUT_EFFECT_TYPES.has(e.type))) {
    return LOCKOUT_DR_CONFIG;
  }

  const hasControl = runtimeBuff.effects.some((e) => e.type === "CONTROL");
  const hasRoot    = runtimeBuff.effects.some((e) => e.type === "ROOT");

  // Freeze (定身) = CONTROL + ROOT on the same buff → separate DR from pure stun
  if (hasControl && hasRoot) {
    return FREEZE_DR_CONFIG;
  }

  if (hasControl) {
    return STUN_DR_CONFIG;
  }

  if (hasRoot) {
    return ROOT_DR_CONFIG;
  }

  return null;
}

function refreshResistanceBuff(params: {
  state: GameState;
  target: { userId: string; buffs: ActiveBuff[] };
  ability: Ability;
  now: number;
  config: ResistanceConfig;
}) {
  const { state, target, ability, now, config } = params;
  const activeResistance = getActiveResistanceBuff(target, config.buffId, now);
  const nextStacks = (activeResistance?.stacks ?? 0) + 1;

  if (activeResistance) {
    activeResistance.name = config.name;
    activeResistance.category = "BUFF";
    activeResistance.effects = [];
    activeResistance.expiresAt = now + CONTROL_DR_DURATION_MS;
    activeResistance.appliedAt = now;
    activeResistance.appliedAtTurn = state.turn;
    activeResistance.breakOnPlay = false;
    activeResistance.sourceAbilityId = ability.id;
    activeResistance.sourceAbilityName = ability.name;
    activeResistance.stacks = nextStacks;
    activeResistance.maxStacks = 99;
  } else {
    target.buffs = target.buffs.filter((b) => b.buffId !== config.buffId);
    target.buffs.push({
      buffId: config.buffId,
      name: config.name,
      category: "BUFF",
      effects: [],
      expiresAt: now + CONTROL_DR_DURATION_MS,
      appliedAt: now,
      appliedAtTurn: state.turn,
      breakOnPlay: false,
      stacks: nextStacks,
      maxStacks: 99,
      sourceAbilityId: ability.id,
      sourceAbilityName: ability.name,
    });
  }

  pushEvent(state, {
    turn: state.turn,
    type: "BUFF_APPLIED",
    actorUserId: target.userId,
    targetUserId: target.userId,
    abilityId: ability.id,
    abilityName: ability.name,
    buffId: config.buffId,
    buffName: config.name,
    buffCategory: "BUFF",
    appliedAtTurn: state.turn,
  });
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
  "PULLED",
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

function hasInvulnerable(target: { buffs: ActiveBuff[] }): boolean {
  return target.buffs.some((b) => b.effects.some((e) => e.type === "INVULNERABLE"));
}

function isSharedLockoutDebuff(buff: ActiveBuff): boolean {
  if (buff.category !== "DEBUFF") return false;
  return buff.effects.some((e) => SHARED_LOCKOUT_EFFECT_TYPES.has(e.type));
}

function removeSharedLockoutDebuffs(params: {
  state: GameState;
  targetUserId: string;
  target: { buffs: ActiveBuff[] };
}) {
  const { state, targetUserId, target } = params;
  const removed = target.buffs.filter((b) => isSharedLockoutDebuff(b));
  if (removed.length === 0) return;

  target.buffs = target.buffs.filter((b) => !isSharedLockoutDebuff(b));
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

function removeStealthOnIncomingControl(params: {
  state: GameState;
  targetUserId: string;
  target: { buffs: ActiveBuff[] };
  controlTypes: string[];
}) {
  const { state, targetUserId, target, controlTypes } = params;
  if (controlTypes.length === 0) return;

  const tiandiBreakTypes = ["CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "PULLED", "SILENCE"];
  const fuguangBreakTypes = ["ROOT", "CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "PULLED", "SILENCE"];

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
  // Apply property overrides from the editor (so game engine uses edited values)
  const { overrides: editorOverrides } = loadBuffEditorOverrides();
  const propEntry = editorOverrides[String(buff.buffId)];
  if (propEntry?.properties !== undefined) {
    runtimeBuff = { ...runtimeBuff, effects: applyPropertyOverridesToEffects(runtimeBuff, propEntry.properties) as typeof runtimeBuff.effects };
  }
  // Apply duration override live so changes take effect without a server restart
  if (typeof propEntry?.durationMs === "number") {
    runtimeBuff = { ...runtimeBuff, durationMs: propEntry.durationMs };
  }
  const now = Date.now();
  const incomingMoheKnockdown =
    sourceUserId !== targetUserId &&
    runtimeBuff.buffId === 1002 &&
    runtimeBuff.effects.some((e) => e.type === "CONTROL");

  if (sourceUserId !== targetUserId && hasInvulnerable(buffTarget)) {
    return;
  }

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
    runtimeBuff.effects.some((e) => e.type === "KNOCKED_BACK" || e.type === "PULLED") &&
    hasKnockbackImmune(buffTarget)
  ) {
    return;
  }

  if (sourceUserId !== targetUserId && hasControlImmune(buffTarget)) {
    const hadCC = runtimeBuff.effects.some(
      (e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK" || e.type === "ROOT"
    );
    const filteredEffects = runtimeBuff.effects.filter(
      (e) => e.type !== "CONTROL" && e.type !== "ATTACK_LOCK" && e.type !== "ROOT" && e.type !== "DAMAGE_IMMUNE"
    );
    if (filteredEffects.length === 0) {
      return;
    }
    // If the buff was a CC buff and all CC effects were stripped, block it entirely.
    // This prevents partial application (e.g. 七星拱瑞 applying only its HoT without the freeze).
    if (hadCC) {
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

  if (
    sourceUserId !== targetUserId &&
    runtimeBuff.effects.some((e) => SHARED_LOCKOUT_EFFECT_TYPES.has(e.type))
  ) {
    removeSharedLockoutDebuffs({
      state,
      targetUserId,
      target: buffTarget,
    });
  }

  // 摩诃无量交互：倒地期间免疫其他控制层级（可被沉默），并且新硬控会替换摩诃无量·眩晕。
  if (sourceUserId !== targetUserId) {
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

      // 雷霆震怒 interaction: knockdown also removes 雷霆震怒 (bypasses stun immunity)
      const leiTingBuff = buffTarget.buffs.find((b) => b.buffId === LEI_TING_ZHEN_NU_BUFF_ID);
      if (leiTingBuff) {
        buffTarget.buffs = buffTarget.buffs.filter((b) => b.buffId !== LEI_TING_ZHEN_NU_BUFF_ID);
        pushEvent(state, {
          turn: state.turn,
          type: "BUFF_EXPIRED",
          actorUserId: targetUserId,
          targetUserId,
          abilityId: leiTingBuff.sourceAbilityId,
          abilityName: leiTingBuff.sourceAbilityName,
          buffId: leiTingBuff.buffId,
          buffName: leiTingBuff.name,
          buffCategory: leiTingBuff.category,
        });
      }
    }

    // 雷霆震怒: while target has this buff, immune to other CONTROL effects (knockdown bypasses)
    if (!incomingMoheKnockdown) {
      const targetHasLeiTing = buffTarget.buffs.some(
        (b) => b.buffId === LEI_TING_ZHEN_NU_BUFF_ID && b.expiresAt > now
      );
      if (targetHasLeiTing) {
        const filteredEffects = runtimeBuff.effects.filter(
          (e) => e.type !== "CONTROL" && e.type !== "ATTACK_LOCK" && e.type !== "ROOT"
        );
        if (filteredEffects.length === 0) {
          return;
        }
        if (filteredEffects.length !== runtimeBuff.effects.length) {
          runtimeBuff = { ...runtimeBuff, effects: filteredEffects };
        }
      }
    }

    if (buffTarget.buffs.some((b) => isMoheKnockdown(b) && b.expiresAt > now)) {
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
      (e) => e.type === "CONTROL" || e.type === "ATTACK_LOCK" || e.type === "KNOCKED_BACK" || e.type === "PULLED"
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

  const resistanceConfig =
    sourceUserId !== targetUserId ? getResistanceConfig(runtimeBuff) : null;
  if (resistanceConfig && runtimeBuff.durationMs > 0) {
    const resistanceStacks =
      getActiveResistanceBuff(buffTarget, resistanceConfig.buffId, now)?.stacks ?? 0;
    if (resistanceStacks > 0) {
      runtimeBuff = {
        ...runtimeBuff,
        durationMs: Math.max(
          1,
          Math.round(runtimeBuff.durationMs * Math.pow(0.5, resistanceStacks))
        ),
      };
    }
  }

  // Stacking: if buff defines maxStacks > 1, increment stacks on the existing buff
  // instead of replacing it. The lastTickAt is intentionally NOT reset — this prevents
  // stack-refresh abuse (re-casting resets the tick timer allowing faster ticks).
  if (runtimeBuff.maxStacks !== undefined && runtimeBuff.maxStacks > 1) {
    const existing = buffTarget.buffs.find((b) => b.buffId === runtimeBuff.buffId);
    if (existing) {
      existing.stacks = Math.min((existing.stacks ?? 1) + (runtimeBuff.initialStacks ?? 1), runtimeBuff.maxStacks);
      existing.expiresAt = now + runtimeBuff.durationMs;

      // 三环套月: consume at 3 stacks and deal immediate bonus damage.
      if (runtimeBuff.buffId === 3001 && (existing.stacks ?? 0) >= (runtimeBuff.maxStacks ?? 3)) {
        const source = state.players.find((p: any) => p.userId === sourceUserId);
        const target = state.players.find((p: any) => p.userId === targetUserId);
        if (target && target.hp > 0) {
          const bonus = source
            ? resolveScheduledDamage({ source, target, base: 3 })
            : 3;
          applyDamageToTarget(target as any, bonus);
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
  const replaced = buffTarget.buffs.filter((b) => b.buffId === runtimeBuff.buffId);
  for (const oldBuff of replaced) {
    removeLinkedShield(buffTarget as any, oldBuff);
  }
  buffTarget.buffs = buffTarget.buffs.filter((b) => b.buffId !== runtimeBuff.buffId);

  const linkedShield = runtimeBuff.effects
    .filter((e) => e.type === "SHIELD")
    .reduce((sum, e) => sum + (e.value ?? 0), 0);

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
    shieldAmount: linkedShield > 0 ? linkedShield : undefined,

    sourceAbilityId: ability.id,
    sourceAbilityName: ability.name,
  };

  buffTarget.buffs.push(active);

  if (linkedShield > 0) {
    addShieldToTarget(buffTarget as any, linkedShield);
  }

  // CC that hits a channeling player (with no INTERRUPT_IMMUNE) cancels their channel.
  if ((buffTarget as any).activeChannel) {
    const isCC = runtimeBuff.effects.some((e) =>
      e.type === "CONTROL" || e.type === "KNOCKED_BACK" || e.type === "PULLED" || e.type === "ATTACK_LOCK"
    );
    const isImmune = buffTarget.buffs.some((b) =>
      b.effects.some((e) => e.type === "INTERRUPT_IMMUNE" || e.type === "CONTROL_IMMUNE")
    );
    if (isCC && !isImmune) {
      (buffTarget as any).activeChannel = undefined;
    }
  }

  // Incoming control can forcibly break specific stealth buffs.
  if (sourceUserId !== targetUserId) {
    const controlTypes = runtimeBuff.effects
      .map((e) => e.type)
      .filter((t) => ["ROOT", "CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "PULLED", "SILENCE"].includes(t));
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

  if (resistanceConfig) {
    refreshResistanceBuff({
      state,
      target: buffTarget,
      ability,
      now,
      config: resistanceConfig,
    });
  }
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
