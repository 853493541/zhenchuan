export type DashRenderPosition = {
  x: number;
  y: number;
  z: number;
};

export type DashRenderSample = {
  position: DashRenderPosition;
  sampledAtMs: number;
  ticksRemaining: number;
  vxPerTick: number;
  vyPerTick: number;
  vzPerTick: number;
};

export type DashRenderPredictionOptions = {
  nowMs: number;
  tickMs?: number;
  maxLeadTicks?: number;
};

const DEFAULT_TICK_MS = 1000 / 30;
export const DASH_RENDER_MAX_LEAD_TICKS = 20;
export const DASH_SERVER_GAP_WARNING_MS = 650;

export function predictDashRenderPosition(
  sample: DashRenderSample | null,
  options: DashRenderPredictionOptions
): DashRenderPosition | null {
  if (!sample) return null;

  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const maxLeadTicks = options.maxLeadTicks ?? DASH_RENDER_MAX_LEAD_TICKS;
  const elapsedMs = Math.max(0, options.nowMs - sample.sampledAtMs);
  const elapsedTicks = tickMs > 0 ? elapsedMs / tickMs : 0;
  const leadTicks = Math.max(0, Math.min(elapsedTicks, maxLeadTicks, sample.ticksRemaining));

  return {
    x: sample.position.x + sample.vxPerTick * leadTicks,
    y: sample.position.y + sample.vyPerTick * leadTicks,
    z: sample.position.z + sample.vzPerTick * leadTicks,
  };
}

export function shouldLogDashServerGap(gapMs: number, thresholdMs = DASH_SERVER_GAP_WARNING_MS): boolean {
  return Number.isFinite(gapMs) && gapMs >= thresholdMs;
}