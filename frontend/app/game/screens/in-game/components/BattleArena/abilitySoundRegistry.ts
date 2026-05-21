import soundManifest from '../../../../../../public/game/sounds/tani-sound-zc-2026-05-15T11-26-31-705Z/manifest.json';

export type AbilitySoundPhase =
  | 'cast'
  | 'channelStart'
  | 'channelComplete'
  | 'counter'
  | 'followUp'
  | 'impact'
  | 'buffApplied';

export type AbilitySoundExtraCue = {
  url: string;
  phase: AbilitySoundPhase;
  delayMs?: number;
  playAfterCurrentEnds?: boolean;
  playbackRate?: number;
  fitToDurationMs?: number;
  preservePitch?: boolean;
  loopDurationMs?: number;
};

type AbilitySoundEvent = {
  type?: string;
  abilityId?: string;
  abilityName?: string;
  targetUserId?: string;
  channelPhase?: 'start' | 'complete';
  effectType?: string;
  soundPhase?: 'counter' | 'dashComplete' | 'followUp';
  buffId?: number;
};

type AbilitySoundManifestEntry = {
  name: string;
  folder: string;
  wems?: Array<{
    id: string;
    files?: {
      ogg?: string;
    };
  }>;
};

type AbilityLike = {
  id?: string;
  name?: string;
  type?: string;
  target?: string;
  range?: number;
  channel?: {
    source?: string;
    durationMs?: number;
  };
};

type AbilitySoundCue = {
  url: string;
  phase: AbilitySoundPhase;
  playbackRate?: number;
  fitToDurationMs?: number;
  preservePitch?: boolean;
  finishAfterChannelComplete?: boolean;
  normalizeVolume?: boolean;
  loopDuringChannel?: boolean;
  extraSounds?: AbilitySoundExtraCue[];
  targetOnly?: boolean;
};

const SOUND_PACK_BASE = '/game/sounds/tani-sound-zc-2026-05-15T11-26-31-705Z/';
const SOUND_PACK_NAME = 'tani-sound-zc-2026-05-15T11-26-31-705Z';
const QIANDIE_SHORT_OVERLAP_DELAY_MS = 4620;
const XIAO_ZUI_KUANG_CHANNEL_SOUND_MS = 9000;
const MIYUN_CONFUSION_BUFF_ID = 2744;
const HONG_MENG_TIAN_JIN_BUFF_ID = 2645;

const cleanAbilityName = (name: string | undefined) =>
  String(name ?? '').replace(/^\s*\d+\.\s*/, '').trim();

function isFenglaiWushan(ability: AbilityLike | undefined, event: AbilitySoundEvent) {
  const abilityId = String(ability?.id ?? event.abilityId ?? '');
  const abilityName = cleanAbilityName(ability?.name ?? event.abilityName);
  return abilityId === 'fenglai_wushan' || abilityName === '风来吴山' || abilityName === '风来无山';
}

function getAbilityIdentity(ability: AbilityLike | undefined, event: AbilitySoundEvent) {
  return {
    id: String(ability?.id ?? event.abilityId ?? ''),
    name: cleanAbilityName(ability?.name ?? event.abilityName),
  };
}

function matchesAbility(ability: AbilityLike | undefined, event: AbilitySoundEvent, ids: string[], names: string[]) {
  const identity = getAbilityIdentity(ability, event);
  return ids.includes(identity.id) || names.includes(identity.name);
}

const manifestEntriesByName = new Map<string, AbilitySoundManifestEntry>();

for (const entry of (soundManifest as { abilities?: AbilitySoundManifestEntry[] }).abilities ?? []) {
  const cleanName = cleanAbilityName(entry.name);
  if (cleanName) {
    manifestEntriesByName.set(cleanName, entry);
  }
}

function isChannelAbility(ability: AbilityLike | undefined) {
  return ability?.type === 'CHANNEL' || !!ability?.channel;
}

function getOggUrls(entry: AbilitySoundManifestEntry) {
  return (entry.wems ?? [])
    .map((wem) => wem.files?.ogg)
    .filter((ogg): ogg is string => typeof ogg === 'string' && ogg.length > 0)
    .map((ogg) => encodeURI(`${SOUND_PACK_BASE}${ogg}`));
}

export type AbilitySoundFile = {
  key: string;
  abilityName: string;
  manifestName: string;
  folder: string;
  wemId: string;
  fileName: string;
  relativePath: string;
  url: string;
  ordinal: number;
  totalInAbility: number;
};

export function listAbilitySoundFiles(): AbilitySoundFile[] {
  return ((soundManifest as { abilities?: AbilitySoundManifestEntry[] }).abilities ?? []).flatMap((entry) => {
    const abilityName = cleanAbilityName(entry.name);
    const wems = entry.wems ?? [];
    return wems
      .map((wem, index) => {
        const relativePath = wem.files?.ogg;
        if (!relativePath) return null;
        const fileName = relativePath.split('/').pop() ?? `${wem.id}.ogg`;
        const url = encodeURI(`${SOUND_PACK_BASE}${relativePath}`);
        return {
          key: `${entry.folder}:${wem.id}:${index}`,
          abilityName,
          manifestName: entry.name,
          folder: entry.folder,
          wemId: wem.id,
          fileName,
          relativePath,
          url,
          ordinal: index + 1,
          totalInAbility: wems.length,
        } satisfies AbilitySoundFile;
      })
      .filter((file): file is AbilitySoundFile => file !== null);
  });
}

export function getAbilitySoundPackName() {
  return SOUND_PACK_NAME;
}

function getSoundPhase(event: AbilitySoundEvent, ability: AbilityLike | undefined): AbilitySoundPhase | null {
  if (event.type === 'ABILITY_SOUND') {
    if (event.soundPhase === 'counter') return 'counter';
    if (event.soundPhase === 'dashComplete') return 'impact';
    if (event.soundPhase === 'followUp') return 'followUp';
    return event.channelPhase === 'complete' ? 'channelComplete' : null;
  }

  if (event.type !== 'PLAY_ABILITY') {
    return null;
  }

  if (event.channelPhase === 'complete') {
    return null;
  }

  if (event.channelPhase === 'start' || isChannelAbility(ability)) {
    return 'channelStart';
  }

  return 'cast';
}

export function getAbilitySoundCue(
  ability: AbilityLike | undefined,
  event: AbilitySoundEvent,
): AbilitySoundCue | null {
  const abilityName = cleanAbilityName(ability?.name ?? event.abilityName);
  if (!abilityName) return null;

  const entry = manifestEntriesByName.get(abilityName);
  if (!entry) return null;

  const urls = getOggUrls(entry);
  if (urls.length === 0) return null;

  if (matchesAbility(ability, event, ['wu_an_mi_yun'], ['雾暗迷云', '暗雾迷云'])) {
    if (event.type === 'BUFF_APPLIED' && Number(event.buffId) === MIYUN_CONFUSION_BUFF_ID) {
      return { url: urls[0], phase: 'buffApplied', targetOnly: true };
    }
    return null;
  }

  if (matchesAbility(ability, event, ['hong_meng_tian_jin'], ['鸿蒙天禁'])) {
    if (event.type === 'BUFF_APPLIED' && Number(event.buffId) === HONG_MENG_TIAN_JIN_BUFF_ID) {
      return { url: urls[0], phase: 'buffApplied', targetOnly: true };
    }
    return null;
  }

  if (matchesAbility(ability, event, ['yue_chao_zhan_bo'], ['跃潮斩波'])) {
    if (event.type === 'ABILITY_SOUND' && event.soundPhase === 'dashComplete') {
      return { url: urls[0], phase: 'impact' };
    }
    return null;
  }

  if (
    event.type === 'DAMAGE' &&
    event.effectType === 'TIMED_AOE_DAMAGE' &&
    matchesAbility(ability, event, ['wu_jianyu'], ['无间狱'])
  ) {
    return urls[1] ? { url: urls[1], phase: 'followUp' } : null;
  }

  if (matchesAbility(ability, event, ['baizu'], ['百足']) && event.type === 'ABILITY_SOUND' && event.soundPhase === 'followUp') {
    return { url: urls[0], phase: 'followUp' };
  }

  const phase = getSoundPhase(event, ability);
  if (!phase) return null;

  if (matchesAbility(ability, event, ['dun_li'], ['盾立']) && phase === 'counter') {
    return urls[1] ? { url: urls[1], phase: 'counter' } : null;
  }

  if (matchesAbility(ability, event, ['qixing_gongrui'], ['七星拱瑞'])) {
    if (phase === 'channelStart') return null;
    if (phase === 'channelComplete') return { url: urls[0], phase };
  }

  if (matchesAbility(ability, event, ['qiandie_turui'], ['千蝶吐瑞'])) {
    if (phase === 'channelComplete') return null;
    if (phase === 'channelStart' && urls[1]) {
      return {
        url: urls[0],
        phase,
        extraSounds: [{ url: urls[1], phase: 'channelStart', delayMs: QIANDIE_SHORT_OVERLAP_DELAY_MS }],
      };
    }
  }

  if (matchesAbility(ability, event, ['yuqi'], ['御骑'])) {
    if (phase === 'channelComplete') return null;
    if (event.channelPhase !== 'start') return null;
    if (phase === 'channelStart' && urls[1]) {
      return {
        url: urls[0],
        phase,
        extraSounds: [{ url: urls[1], phase: 'channelStart', delayMs: 0 }],
      };
    }
  }

  if (matchesAbility(ability, event, ['zhen_xia_che'], ['真·下车']) && phase === 'cast' && urls[1]) {
    return {
      url: urls[0],
      phase,
      extraSounds: [{ url: urls[1], phase: 'cast', delayMs: 0 }],
    };
  }

  if (matchesAbility(ability, event, ['cheng_huang_zhi_wei'], ['乘黄之威']) && phase === 'cast' && urls[1]) {
    return {
      url: urls[0],
      phase,
    };
  }

  if (matchesAbility(ability, event, ['cheng_huang_zhi_wei'], ['乘黄之威']) && phase === 'impact' && urls[1]) {
    return { url: urls[1], phase };
  }

  if (matchesAbility(ability, event, ['ren_chi_cheng'], ['任驰骋']) && phase === 'channelStart') {
    return { url: urls[0], phase, fitToDurationMs: 750, preservePitch: true, finishAfterChannelComplete: true, normalizeVolume: false };
  }

  if (matchesAbility(ability, event, ['xiao_zui_kuang'], ['笑醉狂'])) {
    if (phase === 'channelComplete') return null;
    if (phase === 'channelStart') {
      return { url: urls[0], phase, fitToDurationMs: XIAO_ZUI_KUANG_CHANNEL_SOUND_MS };
    }
  }

  if (matchesAbility(ability, event, ['yin_qiao'], ['引窍'])) {
    if (phase === 'channelStart') return null;
    if (phase === 'channelComplete') return { url: urls[0], phase };
    return null;
  }

  if (matchesAbility(ability, event, ['qionglong_huasheng'], ['穹隆化生']) && phase === 'cast' && urls[1]) {
    return {
      url: urls[0],
      phase,
      fitToDurationMs: 2000,
      extraSounds: [{ url: urls[1], phase: 'channelComplete', playAfterCurrentEnds: true }],
    };
  }

  if (phase === 'channelComplete') {
    if (urls.length < 2) return null;
    return { url: urls[urls.length - 1], phase };
  }

  return {
    url: urls[0],
    phase,
    ...(phase === 'channelStart' && isFenglaiWushan(ability, event) ? { loopDuringChannel: true } : {}),
  };
}

export function getAbilitySoundAudibleRange(ability: AbilityLike | undefined, phase: AbilitySoundPhase) {
  const range = typeof ability?.range === 'number' && Number.isFinite(ability.range) ? ability.range : 0;
  if (ability?.target === 'SELF') {
    return phase === 'channelComplete' ? 70 : 60;
  }
  if (range > 0) {
    return Math.max(40, Math.min(90, range * 2.5));
  }
  return 60;
}