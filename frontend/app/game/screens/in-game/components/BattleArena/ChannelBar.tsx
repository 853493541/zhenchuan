'use client';

import React, { useEffect, useRef, useState } from 'react';
import styles from './ChannelBar.module.css';

/* ============================================================
   Forward channel (正读条): bar fills 0→100%
   ============================================================ */
export interface ForwardChannelData {
  kind: 'forward';
  name: string;
  startedAt: number;
  durationMs: number;
  cancelOnMove: boolean;
  cancelOnJump: boolean;
}

/* ============================================================
   Reverse channel (倒读条): bar drains 100→0%
   ============================================================ */
export interface ReverseChannelData {
  kind: 'reverse';
  name: string;
  appliedAt: number;
  durationMs: number;
  /** Tick interval for drawing 段落 (next-effect markers). */
  tickIntervalMs?: number;
}

export type ChannelBarData = ForwardChannelData | ReverseChannelData;

export type ChannelBarVariant = 'hud' | 'enemy';
export type ChannelBarPhase = 'active' | 'success' | 'interrupted';

/* Phase-driven color overrides. Active fill comes from the CSS class
   (yellow/gold gradient). */
const SUCCESS_COLOR_ENEMY = '#43d977';     // green flash on enemy boss bar success
const INTERRUPTED_COLOR = '#f08a2a';        // orange — cancelled mid-channel
const INTERRUPTED_TRAILING_COLOR = '#a85a18';

interface ChannelBarProps {
  data: ChannelBarData;
  variant?: ChannelBarVariant;
  phase?: ChannelBarPhase;
  /** Override active fill with a flat color. When unset, CSS gradient default is used. */
  fillColorOverride?: string;
  /** Force the filled percentage (0..100). When unset, percent comes from clock. */
  progressOverride?: number;
  /** Color for the unfilled trailing portion (used during interrupt). */
  trailingColor?: string;
  /** Append "(elapsed/total)" to the label (HUD self bar). */
  showTimer?: boolean;
  /** 0..1 wrapper opacity for fade-out. */
  opacity?: number;
}

function getVariantClassNames(variant: ChannelBarVariant) {
  return {
    wrap: variant === 'enemy'
      ? `${styles.channelBarWrap} ${styles.enemyChannelBarWrap}`
      : styles.channelBarWrap,
    label: variant === 'enemy'
      ? `${styles.channelBarLabel} ${styles.enemyChannelBarLabel}`
      : styles.channelBarLabel,
    track: variant === 'enemy'
      ? `${styles.channelBarTrack} ${styles.enemyChannelBarTrack}`
      : styles.channelBarTrack,
    tick: variant === 'enemy'
      ? `${styles.channelBarTick} ${styles.enemyChannelBarTick}`
      : styles.channelBarTick,
  };
}

function useNowMs(active: boolean) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let rafId = 0;
    const tick = () => {
      setNowMs(Date.now());
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [active]);
  return nowMs;
}

function formatSeconds(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  return sec.toFixed(2);
}

export function ChannelBar({
  data,
  variant = 'hud',
  phase = 'active',
  fillColorOverride,
  progressOverride,
  trailingColor,
  showTimer = false,
  opacity = 1,
}: ChannelBarProps) {
  const nowMs = useNowMs(phase === 'active' && progressOverride === undefined);
  const safeDurationMs = Math.max(1, data.durationMs);

  let filledPct: number;
  let elapsedMs: number;
  if (data.kind === 'forward') {
    elapsedMs = Math.max(0, Math.min(safeDurationMs, nowMs - data.startedAt));
    filledPct = (elapsedMs / safeDurationMs) * 100;
  } else {
    elapsedMs = Math.max(0, Math.min(safeDurationMs, nowMs - data.appliedAt));
    filledPct = 100 - (elapsedMs / safeDurationMs) * 100;
  }

  const displayPct = typeof progressOverride === 'number' ? progressOverride : filledPct;

  // Tick marks only for active reverse channels in HUD variant.
  const showTicks = data.kind === 'reverse'
    && variant !== 'enemy'
    && phase === 'active'
    && !!data.tickIntervalMs
    && data.tickIntervalMs > 0;
  const tickCount = showTicks
    ? Math.floor(safeDurationMs / (data.tickIntervalMs as number))
    : 0;

  const classNames = getVariantClassNames(variant);

  let labelText = data.name;
  if (showTimer) {
    labelText = `${data.name} (${formatSeconds(elapsedMs)}/${formatSeconds(safeDurationMs)})`;
  }

  const fillStyle: React.CSSProperties = {
    width: `${Math.max(0, Math.min(100, displayPct)).toFixed(2)}%`,
    ...(fillColorOverride ? { background: fillColorOverride } : {}),
  };

  const trailingStyle: React.CSSProperties | null = trailingColor
    ? {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${Math.max(0, Math.min(100, displayPct)).toFixed(2)}%`,
        right: 0,
        background: trailingColor,
        opacity: 0.55,
        zIndex: 1,
      }
    : null;

  return (
    <div
      className={classNames.wrap}
      style={{ opacity, transition: 'opacity 0.5s ease-out' }}
    >
      <span className={classNames.label}>{labelText}</span>
      <div className={classNames.track}>
        {trailingStyle && <div style={trailingStyle} />}
        <div className={styles.channelBarFill} style={fillStyle} />
        {showTicks && tickCount > 1 && Array.from({ length: tickCount - 1 }, (_, i) => (
          <div
            key={i}
            className={classNames.tick}
            style={{ left: `${((i + 1) / tickCount) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   ChannelBarHost — manages success / interrupt / fade lifecycle.

   Per-variant completion behaviour:

   ── enemy (boss bar) ──
   - success    : snap to 100%, fill flips green, immediately
                  starts fading; fully gone after 0.5s.
   - interrupted: freeze at progress, fill flips orange (with
                  darker orange behind), immediately starts
                  fading; fully gone after 0.5s.

   ── hud (self) ──
   - success / interrupted : NO color change, NO snap. Just a
     plain 0.5s opacity fade from the bar's current visual state.
   ============================================================ */
interface DisplayState {
  data: ChannelBarData;
  phase: ChannelBarPhase;
  frozenProgressPct?: number;
  fading: boolean;
}

interface ChannelBarHostProps {
  data: ChannelBarData | null;
  variant?: ChannelBarVariant;
  showTimer?: boolean;
  /** Fade-out duration (ms). Default 500ms. */
  fadeOutMs?: number;
}

export function ChannelBarHost({
  data,
  variant = 'hud',
  showTimer = false,
  fadeOutMs = 500,
}: ChannelBarHostProps) {
  const [state, setState] = useState<DisplayState | null>(null);
  const lastActiveDataRef = useRef<ChannelBarData | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearFadeTimer() {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }

  const dataKey = data
    ? data.kind === 'forward'
      ? `f:${data.name}:${data.startedAt}`
      : `r:${data.name}:${data.appliedAt}`
    : null;

  useEffect(() => {
    if (data) {
      clearFadeTimer();
      lastActiveDataRef.current = data;
      setState({ data, phase: 'active', fading: false });
      return;
    }

    const prev = lastActiveDataRef.current;
    if (!prev) {
      setState(null);
      return;
    }
    lastActiveDataRef.current = null;

    if (variant === 'hud') {
      // Self bar: freeze the bar at its current progress and fade.
      // No phase visuals (no green, no orange, no snap).
      const elapsedHud = prev.kind === 'forward'
        ? Date.now() - prev.startedAt
        : Date.now() - prev.appliedAt;
      const safeDurHud = Math.max(1, prev.durationMs);
      const eHud = Math.max(0, Math.min(safeDurHud, elapsedHud));
      const frozenPctHud = prev.kind === 'forward'
        ? (eHud / safeDurHud) * 100
        : 100 - (eHud / safeDurHud) * 100;
      setState({
        data: prev,
        phase: 'active',
        frozenProgressPct: frozenPctHud,
        fading: true,
      });
      clearFadeTimer();
      fadeTimerRef.current = setTimeout(() => setState(null), fadeOutMs);
      return;
    }

    // Enemy bar — distinguish success vs interrupt.
    const elapsed = prev.kind === 'forward'
      ? Date.now() - prev.startedAt
      : Date.now() - prev.appliedAt;
    // Generous threshold to absorb client/server clock skew on completion.
    const success = elapsed >= prev.durationMs - 300;

    if (success) {
      setState({ data: prev, phase: 'success', fading: true });
    } else {
      const safeDur = Math.max(1, prev.durationMs);
      const e = Math.max(0, Math.min(safeDur, elapsed));
      const frozenPct = prev.kind === 'forward'
        ? (e / safeDur) * 100
        : 100 - (e / safeDur) * 100;
      setState({
        data: prev,
        phase: 'interrupted',
        frozenProgressPct: frozenPct,
        fading: true,
      });
    }

    clearFadeTimer();
    fadeTimerRef.current = setTimeout(() => setState(null), fadeOutMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  useEffect(() => () => clearFadeTimer(), []);

  if (!state) return null;

  // Per-variant + per-phase color & progress overrides.
  let fillColorOverride: string | undefined;
  let progressOverride: number | undefined;
  let trailingColor: string | undefined;

  if (state.phase === 'success') {
    progressOverride = 100;
    fillColorOverride = SUCCESS_COLOR_ENEMY;
  } else if (state.phase === 'interrupted') {
    progressOverride = state.frozenProgressPct;
    fillColorOverride = INTERRUPTED_COLOR;
    trailingColor = INTERRUPTED_TRAILING_COLOR;
  } else if (state.fading && typeof state.frozenProgressPct === 'number') {
    // hud fade: freeze progress, no color change.
    progressOverride = state.frozenProgressPct;
  }

  return (
    <ChannelBar
      data={state.data}
      variant={variant}
      phase={state.phase}
      fillColorOverride={fillColorOverride}
      progressOverride={progressOverride}
      trailingColor={trailingColor}
      showTimer={showTimer && state.phase === 'active' && !state.fading}
      opacity={state.fading ? 0 : 1}
    />
  );
}
