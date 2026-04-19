'use client';

import React from 'react';
import styles from './ChannelBar.module.css';

/* ============================================================
   Forward channel (正读条): bar fills 0→100%
   Used for cast-and-hold abilities (e.g. 云飞玉皇).
   Driven by player.activeChannel from the server.
   ============================================================ */
export interface ForwardChannelData {
  kind: 'forward';
  /** Ability name shown above the bar */
  name: string;
  /** Date.now() ms when the channel started */
  startedAt: number;
  /** Total channel duration in ms */
  durationMs: number;
  /** true = movement input will cancel the channel */
  cancelOnMove: boolean;
  /** true = jumping will cancel the channel */
  cancelOnJump: boolean;
}

/* ============================================================
   Reverse channel (倒读条): bar drains 100→0%
   Used for timed buff channels (e.g. 笑醉狂, 风来吴山).
   Driven by a matching buff in player.buffs.
   ============================================================ */
export interface ReverseChannelData {
  kind: 'reverse';
  /** Buff name shown above the bar */
  name: string;
  /** Date.now() ms when the buff was applied — used as stable animation key */
  appliedAt: number;
  /** Total buff duration in ms */
  durationMs: number;
  /**
   * If set, draw tick marks at each tick interval.
   * e.g. 风来吴山 passes periodicMs=625 → 8 ticks visible as dividers.
   */
  tickIntervalMs?: number;
}

export type ChannelBarData = ForwardChannelData | ReverseChannelData;

interface ChannelBarProps {
  data: ChannelBarData;
}

export function ChannelBar({ data }: ChannelBarProps) {
  if (data.kind === 'forward') {
    return <ForwardBar data={data} />;
  }
  return <ReverseBar data={data} />;
}

/* ---- 正读条: fills 0→100% ---- */
function ForwardBar({ data }: { data: ForwardChannelData }) {
  const { name, startedAt, durationMs } = data;
  const elapsedMs = Math.max(0, Math.min(durationMs, Date.now() - startedAt));
  // Tick marks at 1-second intervals
  const tickCount = Math.max(2, Math.round(durationMs / 1000));

  return (
    <div className={styles.channelBarWrap}>
      <span className={styles.channelBarLabel}>{name}</span>
      <div className={styles.channelBarTrack}>
        {/* key=startedAt: CSS animation restarts when a new channel begins */}
        <div
          key={startedAt}
          className={styles.channelBarFillForward}
          style={{
            animationDuration: `${durationMs}ms`,
            animationDelay: `-${elapsedMs}ms`,
          }}
        />
        {Array.from({ length: tickCount - 1 }, (_, i) => (
          <div
            key={i}
            className={styles.channelBarTick}
            style={{ left: `${((i + 1) / tickCount) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---- 倒读条: drains 100→0% ---- */
function ReverseBar({ data }: { data: ReverseChannelData }) {
  const { name, appliedAt, durationMs, tickIntervalMs } = data;
  const expiresAt = appliedAt + durationMs;
  const elapsedMs = Math.max(0, Math.min(durationMs, Date.now() - appliedAt));

  // Tick marks at tickIntervalMs positions (e.g. 625ms for 风来吴山, 1s for 笑醉狂)
  const tickCount = tickIntervalMs && durationMs > 0
    ? Math.floor(durationMs / tickIntervalMs)
    : 0;

  return (
    <div className={styles.channelBarWrap}>
      <span className={styles.channelBarLabel}>{name}</span>
      <div className={styles.channelBarTrack}>
        {/* key=expiresAt: CSS animation restarts when a new buff instance is applied */}
        <div
          key={expiresAt}
          className={styles.channelBarFill}
          style={{
            animationDuration: `${durationMs}ms`,
            animationDelay: `-${elapsedMs}ms`,
          }}
        />
        {tickIntervalMs && tickCount > 1 && Array.from({ length: tickCount - 1 }, (_, i) => (
          <div
            key={i}
            className={styles.channelBarTick}
            style={{ left: `${((i + 1) / tickCount) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
