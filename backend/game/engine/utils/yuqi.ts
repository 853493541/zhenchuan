export const YUQI_BUFF_ID = 2741;
export const REN_CHI_CHENG_BUFF_ID = 2742;
export const ZONG_QING_QI_BUFF_ID = 2743;
export const NUWA_BUTIAN_BUFF_ID = 1019;
export const YUQI_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

type BuffLike = {
  buffId?: number;
  expiresAt?: number;
  effects?: Array<{ type?: string } | null> | null;
};

const YUQI_BREAKING_CONTROL_EFFECT_TYPES = new Set([
  "CONTROL",
  "ATTACK_LOCK",
  "KNOCKED_BACK",
  "PULLED",
  "SILENCE",
  "DISARM",
  "NON_QINGGONG_LOCK",
  "FEARED",
]);

export function hasYuqiState(target: { buffs?: BuffLike[] } | undefined, now = Date.now()) {
  return Array.isArray(target?.buffs) && target.buffs.some((buff) =>
    buff.buffId === YUQI_BUFF_ID && (buff.expiresAt ?? 0) > now
  );
}

export function isJumpBoostBuff(buff: BuffLike | undefined) {
  return Array.isArray(buff?.effects) && buff.effects.some((effect) => effect?.type === "JUMP_BOOST");
}

export function shouldBreakYuqiOnIncomingControl(buff: { effects?: Array<{ type?: string } | null> } | undefined) {
  return Array.isArray(buff?.effects) && buff.effects.some((effect) =>
    !!effect?.type && YUQI_BREAKING_CONTROL_EFFECT_TYPES.has(effect.type)
  );
}