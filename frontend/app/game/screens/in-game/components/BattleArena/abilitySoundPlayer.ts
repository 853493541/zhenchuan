import type { AbilitySoundExtraCue, AbilitySoundPhase } from './abilitySoundRegistry';

type PlayAbilitySoundParams = {
  url: string;
  volume: number;
  pan: number;
  abilityId?: string;
  abilityName?: string;
  actorUserId?: string;
  phase: AbilitySoundPhase;
  playbackRate?: number;
  fitToDurationMs?: number;
  loopDurationMs?: number;
  extraSounds?: AbilitySoundExtraCue[];
};

type AbilitySoundDebugEntry = {
  at: number;
  url: string;
  volume: number;
  effectiveVolume?: number;
  pan: number;
  abilityId?: string;
  abilityName?: string;
  actorUserId?: string;
  phase: AbilitySoundPhase;
  playbackRate?: number;
  fitToDurationMs?: number;
  loopDurationMs?: number;
  normalizationGain?: number;
  rms?: number;
  skipped?: string;
  error?: string;
};

type LoadedAbilitySound = {
  buffer: AudioBuffer;
  normalizationGain: number;
  rms: number;
};

type ActiveAbilitySoundSource = {
  source: AudioBufferSourceNode;
  startedAt: number;
  stopTimer?: ReturnType<typeof setTimeout>;
};

declare global {
  interface Window {
    __zcAbilitySoundDebug?: {
      plays: AbilitySoundDebugEntry[];
      unlocked: boolean;
      contextState?: AudioContextState;
    };
  }
}

const MAX_ACTIVE_SOURCES = 16;
const MIN_REPEAT_GAP_MS = 80;
const TARGET_RMS = 0.12;
const MIN_NORMALIZATION_GAIN = 0.25;
const MAX_NORMALIZATION_GAIN = 2.5;
const MAX_ANALYSIS_SAMPLES_PER_CHANNEL = 60_000;

let audioContext: AudioContext | null = null;
const bufferCache = new Map<string, Promise<LoadedAbilitySound>>();
const activeSources: ActiveAbilitySoundSource[] = [];
const lastPlayAtByKey = new Map<string, number>();

function normalizePlaybackRate(value: unknown, min = 0.5, max = 3) {
  return Math.max(min, Math.min(max, Number(value ?? 1) || 1));
}

function getPlaybackRate(params: { playbackRate?: number; fitToDurationMs?: number }, buffer: AudioBuffer) {
  const fitToDurationMs = Number(params.fitToDurationMs ?? 0);
  if (Number.isFinite(fitToDurationMs) && fitToDurationMs > 0) {
    return normalizePlaybackRate((buffer.duration * 1000) / fitToDurationMs, 0.1, 8);
  }
  return normalizePlaybackRate(params.playbackRate);
}

function getDebugState() {
  window.__zcAbilitySoundDebug ??= {
    plays: [],
    unlocked: false,
  };
  return window.__zcAbilitySoundDebug;
}

function recordDebug(entry: AbilitySoundDebugEntry) {
  if (typeof window === 'undefined') return;
  const debug = getDebugState();
  debug.plays.push(entry);
  while (debug.plays.length > 200) {
    debug.plays.shift();
  }
  debug.contextState = audioContext?.state;
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
  audioContext = new AudioContextCtor();
  return audioContext;
}

async function loadAudioBuffer(context: AudioContext, url: string) {
  const existing = bufferCache.get(url);
  if (existing) return existing;

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((buffer) => ({ buffer, ...analyzeAudioBuffer(buffer) }));

  bufferCache.set(url, promise);
  return promise;
}

function analyzeAudioBuffer(buffer: AudioBuffer): Pick<LoadedAbilitySound, 'normalizationGain' | 'rms'> {
  let sumSquares = 0;
  let sampleCount = 0;
  let peak = 0;

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const samples = buffer.getChannelData(channelIndex);
    const stride = Math.max(1, Math.ceil(samples.length / MAX_ANALYSIS_SAMPLES_PER_CHANNEL));
    for (let index = 0; index < samples.length; index += stride) {
      const sample = samples[index];
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }

  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  if (!Number.isFinite(rms) || rms <= 0.00001) {
    return { normalizationGain: 1, rms: 0 };
  }

  let normalizationGain = TARGET_RMS / rms;
  normalizationGain = Math.max(MIN_NORMALIZATION_GAIN, Math.min(MAX_NORMALIZATION_GAIN, normalizationGain));
  if (peak > 0 && peak * normalizationGain > 0.98) {
    normalizationGain = Math.min(normalizationGain, 0.98 / peak);
  }

  return {
    normalizationGain: Math.max(MIN_NORMALIZATION_GAIN, Math.min(MAX_NORMALIZATION_GAIN, normalizationGain)),
    rms,
  };
}

export async function unlockAbilityAudio() {
  if (typeof window === 'undefined') return false;
  const context = getAudioContext();
  if (context.state === 'suspended') {
    await context.resume();
  }
  const debug = getDebugState();
  debug.unlocked = context.state === 'running';
  debug.contextState = context.state;
  return debug.unlocked;
}

export function installAbilityAudioUnlock() {
  if (typeof window === 'undefined') return () => {};

  const unlock = () => {
    void unlockAbilityAudio().catch(() => {});
  };

  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });

  return () => {
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
    window.removeEventListener('touchstart', unlock, { capture: true });
  };
}

export async function playAbilitySound(params: PlayAbilitySoundParams) {
  if (typeof window === 'undefined') return false;

  const volume = Math.max(0, Math.min(1, params.volume));
  const requestedPlaybackRate = normalizePlaybackRate(params.playbackRate);
  const loopDurationMs = Number(params.loopDurationMs ?? 0);
  const shouldLoop = Number.isFinite(loopDurationMs) && loopDurationMs > 0;
  if (volume <= 0.01) {
    recordDebug({ ...params, at: Date.now(), volume, playbackRate: requestedPlaybackRate, skipped: 'volume' });
    return false;
  }

  const repeatKey = `${params.actorUserId ?? 'unknown'}:${params.abilityId ?? params.abilityName ?? 'unknown'}:${params.phase}:${params.url}`;
  const now = performance.now();
  const lastPlayAt = lastPlayAtByKey.get(repeatKey) ?? -Infinity;
  if (now - lastPlayAt < MIN_REPEAT_GAP_MS) {
    recordDebug({ ...params, at: Date.now(), volume, playbackRate: requestedPlaybackRate, skipped: 'repeat' });
    return false;
  }
  lastPlayAtByKey.set(repeatKey, now);

  try {
    const context = getAudioContext();
    if (context.state === 'suspended') {
      await context.resume().catch(() => {});
    }

    const loadedSound = await loadAudioBuffer(context, params.url);
  const playbackRate = getPlaybackRate(params, loadedSound.buffer);
    const source = context.createBufferSource();
    source.buffer = loadedSound.buffer;
    source.loop = shouldLoop;
    source.playbackRate.setValueAtTime(playbackRate, context.currentTime);

    const effectiveVolume = Math.max(0, Math.min(2, volume * loadedSound.normalizationGain));
    const gain = context.createGain();
    gain.gain.setValueAtTime(effectiveVolume, context.currentTime);

    if ('StereoPannerNode' in window) {
      const panner = new StereoPannerNode(context, {
        pan: Math.max(-1, Math.min(1, params.pan)),
      });
      source.connect(panner);
      panner.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(context.destination);

    while (activeSources.length >= MAX_ACTIVE_SOURCES) {
      const oldest = activeSources.shift();
      if (oldest?.stopTimer) clearTimeout(oldest.stopTimer);
      try {
        oldest?.source.stop();
      } catch {
        // Source may already have ended.
      }
    }

    const activeEntry: ActiveAbilitySoundSource = { source, startedAt: now };
    activeSources.push(activeEntry);
    source.onended = () => {
      if (activeEntry.stopTimer) {
        clearTimeout(activeEntry.stopTimer);
        activeEntry.stopTimer = undefined;
      }
      const idx = activeSources.indexOf(activeEntry);
      if (idx >= 0) activeSources.splice(idx, 1);
    };

    source.start();
    if (shouldLoop) {
      activeEntry.stopTimer = setTimeout(() => {
        activeEntry.stopTimer = undefined;
        try {
          source.stop();
        } catch {
          // Source may already have ended.
        }
      }, Math.max(80, loopDurationMs));
    }
    for (const extraSound of params.extraSounds ?? []) {
      const delayMs = extraSound.playAfterCurrentEnds
        ? (loadedSound.buffer.duration * 1000) / playbackRate
        : Math.max(0, Number(extraSound.delayMs ?? 0) || 0);
      setTimeout(() => {
        void playAbilitySound({
          url: extraSound.url,
          volume,
          pan: params.pan,
          abilityId: params.abilityId,
          abilityName: params.abilityName,
          actorUserId: params.actorUserId,
          phase: extraSound.phase,
          playbackRate: extraSound.playbackRate ?? params.playbackRate,
          fitToDurationMs: extraSound.fitToDurationMs,
          loopDurationMs: extraSound.loopDurationMs,
        });
      }, delayMs);
    }
    recordDebug({
      ...params,
      at: Date.now(),
      volume,
      effectiveVolume,
      playbackRate,
      normalizationGain: loadedSound.normalizationGain,
      rms: loadedSound.rms,
      pan: Math.max(-1, Math.min(1, params.pan)),
    });
    return true;
  } catch (error) {
    recordDebug({
      ...params,
      at: Date.now(),
      volume,
      playbackRate: requestedPlaybackRate,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}