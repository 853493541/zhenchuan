import { PerformanceObserver, monitorEventLoopDelay, performance } from "node:perf_hooks";

const PREFIX = "[LAG-PROBE]";
const CHECK_INTERVAL_MS = 5_000;
const EVENT_LOOP_MAX_THRESHOLD_MS = 120;
const EVENT_LOOP_P99_THRESHOLD_MS = 80;
const TIMER_DRIFT_THRESHOLD_MS = 120;
const GC_THRESHOLD_MS = 50;

let backendProbeStarted = false;

export function roundLagMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rssMb: roundLagMs(memory.rss / 1024 / 1024),
    heapUsedMb: roundLagMs(memory.heapUsed / 1024 / 1024),
    heapTotalMb: roundLagMs(memory.heapTotal / 1024 / 1024),
    externalMb: roundLagMs(memory.external / 1024 / 1024),
  };
}

export function recordLagProbe(kind: string, data: Record<string, unknown> = {}) {
  const now = Date.now();
  try {
    console.warn(`${PREFIX} ${JSON.stringify({
      schemaVersion: 1,
      kind,
      ts: now,
      iso: new Date(now).toISOString(),
      pid: process.pid,
      uptimeMs: roundLagMs(process.uptime() * 1000),
      ...data,
    })}`);
  } catch (err) {
    console.warn(`${PREFIX} ${kind} log-failed`, err instanceof Error ? err.message : String(err));
  }
}

export function startBackendLagProbe() {
  if (backendProbeStarted || process.env.ZHENCHUAN_LAG_PROBE === "0") return;
  backendProbeStarted = true;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  try {
    const gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < GC_THRESHOLD_MS) continue;
        recordLagProbe("backend-gc-pause", {
          durationMs: roundLagMs(entry.duration),
          gcKind: (entry as any).kind ?? null,
          gcFlags: (entry as any).flags ?? null,
          memory: memorySnapshot(),
        });
      }
    });
    gcObserver.observe({ entryTypes: ["gc"] });
  } catch (err) {
    console.warn(`${PREFIX} gc observer unavailable`, err instanceof Error ? err.message : String(err));
  }

  let lastCheckAt = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const timerDriftMs = now - lastCheckAt - CHECK_INTERVAL_MS;
    lastCheckAt = now;

    const maxMs = Number(histogram.max) / 1_000_000;
    const meanMs = Number(histogram.mean) / 1_000_000;
    const p99Ms = histogram.percentile(99) / 1_000_000;

    if (
      maxMs >= EVENT_LOOP_MAX_THRESHOLD_MS ||
      p99Ms >= EVENT_LOOP_P99_THRESHOLD_MS ||
      timerDriftMs >= TIMER_DRIFT_THRESHOLD_MS
    ) {
      recordLagProbe("backend-event-loop-delay", {
        intervalMs: CHECK_INTERVAL_MS,
        timerDriftMs: roundLagMs(timerDriftMs),
        eventLoopMaxMs: roundLagMs(maxMs),
        eventLoopP99Ms: roundLagMs(p99Ms),
        eventLoopMeanMs: roundLagMs(meanMs),
        memory: memorySnapshot(),
      });
    }

    histogram.reset();
  }, CHECK_INTERVAL_MS);

  timer.unref?.();
  console.log(`${PREFIX} backend monitor active interval=${CHECK_INTERVAL_MS}ms max>=${EVENT_LOOP_MAX_THRESHOLD_MS}ms p99>=${EVENT_LOOP_P99_THRESHOLD_MS}ms`);
}