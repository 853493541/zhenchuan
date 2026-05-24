"use client";

type LatencySampleKind = "lifecycle" | "ping" | "state-diff" | "http" | "movement";
type UploadState = "idle" | "pending" | "ok" | "failed";

export type LatencyRecorderContext = {
  gameId?: string;
  userId?: string;
  username?: string;
  route?: string;
  gameMode?: string;
  tournamentPhase?: string;
  battleNumber?: number;
  stateVersion?: number;
  playerCount?: number;
};

export type LatencyRecorderSummary = {
  sessionId: string | null;
  startedAt: number | null;
  sampleCount: number;
  pendingSamples: number;
  droppedSamples: number;
  lastRttMs: number | null;
  averageRttMs: number | null;
  maxRttMs: number | null;
  p95RttMs: number | null;
  stateDiffCount: number;
  maxStateDiffGapMs: number | null;
  movementRequestCount: number;
  averageMovementMs: number | null;
  lastUploadStatus: UploadState;
  lastUploadAt: number | null;
  lastBatchId: string | null;
  lastReportId: string | null;
  lastUploadError: string | null;
};

type ActiveLatencySession = {
  schemaVersion: 1;
  sessionId: string;
  startedAt: number;
  startedAtIso: string;
  context: LatencyRecorderContext;
  sampleCount: number;
  droppedSamples: number;
  lastSampleAt?: number;
  lastSampleAtIso?: string;
};

type LatencySample = {
  schemaVersion: 1;
  sampleId: string;
  sessionId: string;
  ts: number;
  iso: string;
  relMs: number;
  kind: LatencySampleKind;
  context: LatencyRecorderContext;
  data?: unknown;
};

type LatencyBatch = {
  schemaVersion: 1;
  kind: "latency-sample-batch";
  batchId: string;
  reason: string;
  generatedAt: number;
  generatedAtIso: string;
  session: ActiveLatencySession | null;
  context: LatencyRecorderContext;
  browser: Record<string, unknown>;
  pendingBeforeBatch: number;
  droppedBeforeBatch: number;
  samples: LatencySample[];
};

export type LatencyReport = {
  schemaVersion: 1;
  kind: "latency-report";
  generatedAt: number;
  generatedAtIso: string;
  session: ActiveLatencySession | null;
  context: LatencyRecorderContext;
  browser: Record<string, unknown>;
  summary: LatencyRecorderSummary;
  samples: LatencySample[];
};

type UploadStatus = {
  status: UploadState;
  at?: number;
  batchId?: string;
  reportId?: string;
  error?: string;
};

const LATENCY_BATCH_ENDPOINT = "/api/diagnostics/client-latency-batch";
const LATENCY_REPORT_ENDPOINT = "/api/diagnostics/client-latency-report";
const MAX_PENDING_SAMPLES = 1_200;
const MAX_BATCH_SAMPLES = 500;
const MAX_ROLLING_SAMPLES = 1_800;
const MAX_RTT_VALUES = 600;
const MAX_MOVEMENT_VALUES = 300;
const FLUSH_MS = 10_000;
const KEEPALIVE_MAX_BYTES = 60_000;
const SENSITIVE_KEY_RE = /(token|password|cookie|authorization|jwt|secret|auth|credential)/i;

const nowIso = (ts = Date.now()) => new Date(ts).toISOString();

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncateText(value: string, max = 900) {
  const redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [redacted]")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .replace(/auth_token=([^;&\s]+)/gi, "auth_token=[redacted]");
  return redacted.length > max ? `${redacted.slice(0, max)}...` : redacted;
}

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[function ${(value as Function).name || "anonymous"}]`;
  if (typeof value !== "object") return String(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(value.message),
      stack: truncateText(value.stack ?? "", 2_000),
    };
  }

  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (depth >= 5) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, 80).map((entry) => sanitizeValue(entry, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 120)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : sanitizeValue(entry, depth + 1, seen);
  }
  return out;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

function browserSummary() {
  const connection = typeof navigator !== "undefined" ? (navigator as any).connection : null;
  return sanitizeValue({
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    language: typeof navigator !== "undefined" ? navigator.language : null,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    connection: connection ? {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData,
    } : null,
    visibilityState: typeof document !== "undefined" ? document.visibilityState : undefined,
    url: typeof window !== "undefined" ? window.location.href : null,
    viewport: typeof window !== "undefined" ? {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    } : null,
  }) as Record<string, unknown>;
}

function formatMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${roundMs(value)}ms`;
}

function formatTime(ts: number | null | undefined) {
  if (!ts) return "-";
  const date = new Date(ts);
  const time = date.toLocaleTimeString("en-GB", { hour12: false });
  return `${time}.${String(ts % 1000).padStart(3, "0")}`;
}

export function formatLatencyDiagnosticsReport(report: LatencyReport) {
  const lines: string[] = [];
  const summary = report.summary;
  lines.push("延迟诊断报告");
  lines.push(`生成时间: ${report.generatedAtIso}`);
  lines.push(`Session: ${report.session?.sessionId ?? "-"}`);
  lines.push(`Game: ${report.context.gameId ?? "-"} / ${report.context.gameMode ?? "-"}`);
  lines.push(`User: ${report.context.userId ?? "-"}`);
  lines.push("");
  lines.push("总览:");
  lines.push(`- 样本: ${summary.sampleCount}, 待上传: ${summary.pendingSamples}, 丢弃: ${summary.droppedSamples}`);
  lines.push(`- RTT: 最新 ${formatMs(summary.lastRttMs)}, 平均 ${formatMs(summary.averageRttMs)}, P95 ${formatMs(summary.p95RttMs)}, 最大 ${formatMs(summary.maxRttMs)}`);
  lines.push(`- 状态包: ${summary.stateDiffCount}, 最大间隔 ${formatMs(summary.maxStateDiffGapMs)}`);
  lines.push(`- 移动请求: ${summary.movementRequestCount}, 平均 ${formatMs(summary.averageMovementMs)}`);
  lines.push(`- 上传: ${summary.lastUploadStatus}, batch=${summary.lastBatchId ?? "-"}, report=${summary.lastReportId ?? "-"}, error=${summary.lastUploadError ?? "-"}`);
  lines.push("");
  lines.push("最近传输:");
  for (const sample of report.samples.slice(-120)) {
    const data = (sample.data ?? {}) as any;
    if (sample.kind === "ping") {
      lines.push(`[${formatTime(sample.ts)}] ping seq=${data.sequence ?? "-"} rtt=${formatMs(data.rttMs)} c2s=${formatMs(data.estimatedClientToServerMs)} s2c=${formatMs(data.estimatedServerToClientMs)} server=${formatMs(data.serverProcessingMs)}`);
    } else if (sample.kind === "state-diff") {
      lines.push(`[${formatTime(sample.ts)}] diff v${data.version ?? "-"} count=${data.diffCount ?? "-"} bytes=${data.payloadBytes ?? "-"} gap=${formatMs(data.intervalMs)} lag=${formatMs(data.receiveLagMs)}`);
    } else if (sample.kind === "movement") {
      lines.push(`[${formatTime(sample.ts)}] move seq=${data.seq ?? "-"} status=${data.status ?? "-"} dur=${formatMs(data.durationMs)} server=${formatMs(data.serverProcessingMs)} jump=${data.shouldJump === true ? "yes" : "no"}`);
    } else if (sample.kind === "http") {
      lines.push(`[${formatTime(sample.ts)}] http ${data.operation ?? "-"} status=${data.status ?? "-"} dur=${formatMs(data.durationMs)} server=${formatMs(data.serverProcessingMs)}`);
    } else {
      lines.push(`[${formatTime(sample.ts)}] ${sample.kind} ${JSON.stringify(data)}`);
    }
  }
  return lines.join("\n");
}

class ClientLatencyRecorder {
  private activeSession: ActiveLatencySession | null = null;
  private context: LatencyRecorderContext = {};
  private pendingSamples: LatencySample[] = [];
  private rollingSamples: LatencySample[] = [];
  private flushTimer: number | null = null;
  private uploadInFlight = false;
  private installed = false;
  private uploadStatus: UploadStatus = { status: "idle" };
  private rttValues: number[] = [];
  private lastRttMs: number | null = null;
  private maxRttMs: number | null = null;
  private stateDiffCount = 0;
  private maxStateDiffGapMs: number | null = null;
  private movementDurations: number[] = [];
  private movementRequestCount = 0;
  private stoppingSession = false;

  startSession(context: LatencyRecorderContext) {
    if (typeof window === "undefined") return;
    this.installHandlers();
    this.context = { ...this.context, ...context, route: context.route ?? window.location.pathname };

    if (this.activeSession?.context.gameId === context.gameId && this.activeSession.context.userId === context.userId) {
      this.updateContext(context);
      this.startFlushTimer();
      return;
    }

    const now = Date.now();
    this.pendingSamples = [];
    this.rollingSamples = [];
    this.rttValues = [];
    this.lastRttMs = null;
    this.maxRttMs = null;
    this.stateDiffCount = 0;
    this.maxStateDiffGapMs = null;
    this.movementDurations = [];
    this.movementRequestCount = 0;
    this.stoppingSession = false;
    this.uploadStatus = { status: "idle" };
    this.activeSession = {
      schemaVersion: 1,
      sessionId: makeId(),
      startedAt: now,
      startedAtIso: nowIso(now),
      context: this.context,
      sampleCount: 0,
      droppedSamples: 0,
    };
    this.startFlushTimer();
    this.recordWebSocketLifecycle("session-start", { context: this.context });
  }

  updateContext(context: LatencyRecorderContext) {
    this.context = { ...this.context, ...context };
    if (this.activeSession) {
      this.activeSession.context = { ...this.activeSession.context, ...this.context };
    }
  }

  stopSession(reason: string, data?: unknown) {
    if (!this.activeSession || this.stoppingSession || typeof window === "undefined") return;
    const sessionId = this.activeSession.sessionId;
    this.recordWebSocketLifecycle("session-stop", { reason, ...this.toObject(data) });
    this.stoppingSession = true;

    if (this.flushTimer !== null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    void this.flushSamples(`session-stop:${reason}`).catch(() => undefined).finally(() => {
      if (this.activeSession?.sessionId === sessionId) {
        this.activeSession = null;
        this.pendingSamples = [];
      }
      this.stoppingSession = false;
    });
  }

  recordWebSocketLifecycle(type: string, data?: unknown) {
    this.recordSample("lifecycle", { type, ...this.toObject(data) });
  }

  recordPingSample(data: unknown) {
    this.recordSample("ping", data);
  }

  recordStateDiffSample(data: unknown) {
    this.recordSample("state-diff", data);
  }

  recordHttpSample(operation: string, data: unknown) {
    this.recordSample("http", { operation, ...this.toObject(data) });
  }

  recordMovementRequest(data: unknown) {
    this.recordSample("movement", data);
  }

  getSummary(): LatencyRecorderSummary {
    return {
      sessionId: this.activeSession?.sessionId ?? null,
      startedAt: this.activeSession?.startedAt ?? null,
      sampleCount: this.activeSession?.sampleCount ?? 0,
      pendingSamples: this.pendingSamples.length,
      droppedSamples: this.activeSession?.droppedSamples ?? 0,
      lastRttMs: roundMs(this.lastRttMs),
      averageRttMs: roundMs(average(this.rttValues)),
      maxRttMs: roundMs(this.maxRttMs),
      p95RttMs: roundMs(percentile(this.rttValues, 0.95)),
      stateDiffCount: this.stateDiffCount,
      maxStateDiffGapMs: roundMs(this.maxStateDiffGapMs),
      movementRequestCount: this.movementRequestCount,
      averageMovementMs: roundMs(average(this.movementDurations)),
      lastUploadStatus: this.uploadStatus.status,
      lastUploadAt: this.uploadStatus.at ?? null,
      lastBatchId: this.uploadStatus.batchId ?? null,
      lastReportId: this.uploadStatus.reportId ?? null,
      lastUploadError: this.uploadStatus.error ?? null,
    };
  }

  buildReport(): LatencyReport {
    const generatedAt = Date.now();
    return {
      schemaVersion: 1,
      kind: "latency-report",
      generatedAt,
      generatedAtIso: nowIso(generatedAt),
      session: this.activeSession,
      context: sanitizeValue(this.activeSession?.context ?? this.context) as LatencyRecorderContext,
      browser: browserSummary(),
      summary: this.getSummary(),
      samples: this.rollingSamples.slice(-MAX_ROLLING_SAMPLES),
    };
  }

  getReportText() {
    return formatLatencyDiagnosticsReport(this.buildReport());
  }

  async uploadReport() {
    await this.flushSamples("before-report").catch(() => undefined);
    const report = this.buildReport();
    const body = JSON.stringify(report);
    this.uploadStatus = { ...this.uploadStatus, status: "pending", at: Date.now(), error: undefined };
    try {
      const res = await fetch(LATENCY_REPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      this.uploadStatus = {
        ...this.uploadStatus,
        status: "ok",
        at: Date.now(),
        reportId: typeof data.latencyReportId === "string" ? data.latencyReportId : null,
        error: undefined,
      };
      return data;
    } catch (err) {
      this.uploadStatus = {
        ...this.uploadStatus,
        status: "failed",
        at: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  }

  async flushSamples(reason = "manual", keepalive = false) {
    if (this.uploadInFlight || this.pendingSamples.length === 0 || typeof window === "undefined") return;
    const samples = this.pendingSamples.slice(0, MAX_BATCH_SAMPLES);
    const batch = this.buildBatch(reason, samples);
    const body = JSON.stringify(batch);
    if (keepalive && body.length >= KEEPALIVE_MAX_BYTES) return;

    this.uploadInFlight = true;
  this.uploadStatus = { ...this.uploadStatus, status: "pending", at: Date.now(), error: undefined };
    try {
      const res = await fetch(LATENCY_BATCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const uploadedIds = new Set(samples.map((sample) => sample.sampleId));
      this.pendingSamples = this.pendingSamples.filter((sample) => !uploadedIds.has(sample.sampleId));
      this.uploadStatus = {
        ...this.uploadStatus,
        status: "ok",
        at: Date.now(),
        batchId: typeof data.latencyBatchId === "string" ? data.latencyBatchId : batch.batchId,
        error: undefined,
      };
    } catch (err) {
      this.uploadStatus = {
        ...this.uploadStatus,
        status: "failed",
        at: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
      throw err;
    } finally {
      this.uploadInFlight = false;
    }
  }

  private installHandlers() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;

    document.addEventListener("visibilitychange", () => {
      this.recordWebSocketLifecycle(document.hidden ? "page-hidden" : "page-visible", {
        visibilityState: document.visibilityState,
      });
      if (document.hidden) void this.flushSamples("visibility-hidden", true).catch(() => undefined);
    });

    window.addEventListener("pagehide", () => {
      this.recordWebSocketLifecycle("pagehide");
      this.tryBeaconBatch("pagehide");
    });

    (window as any).__zhenchuanLatencyRecorder = this;
    (window as any).__zhenchuanLatencyReport = () => this.buildReport();
  }

  private startFlushTimer() {
    if (this.flushTimer !== null || typeof window === "undefined") return;
    this.flushTimer = window.setInterval(() => {
      void this.flushSamples("timer").catch(() => undefined);
    }, FLUSH_MS);
  }

  private recordSample(kind: LatencySampleKind, data?: unknown) {
    if (!this.activeSession || this.stoppingSession) return;
    const now = Date.now();

    this.updateStats(kind, data);
    this.activeSession.sampleCount += 1;
    this.activeSession.lastSampleAt = now;
    this.activeSession.lastSampleAtIso = nowIso(now);

    const sample: LatencySample = {
      schemaVersion: 1,
      sampleId: makeId(),
      sessionId: this.activeSession.sessionId,
      ts: now,
      iso: nowIso(now),
      relMs: now - this.activeSession.startedAt,
      kind,
      context: sanitizeValue(this.activeSession.context) as LatencyRecorderContext,
      data: sanitizeValue(data),
    };

    this.pendingSamples.push(sample);
    this.rollingSamples.push(sample);

    if (this.rollingSamples.length > MAX_ROLLING_SAMPLES) {
      this.rollingSamples = this.rollingSamples.slice(-MAX_ROLLING_SAMPLES);
    }
    if (this.pendingSamples.length > MAX_PENDING_SAMPLES) {
      const dropped = this.pendingSamples.length - MAX_PENDING_SAMPLES;
      this.pendingSamples = this.pendingSamples.slice(-MAX_PENDING_SAMPLES);
      this.activeSession.droppedSamples += dropped;
    }
    if (this.pendingSamples.length >= MAX_BATCH_SAMPLES) {
      void this.flushSamples("max-batch").catch(() => undefined);
    }
  }

  private updateStats(kind: LatencySampleKind, data: unknown) {
    const dataObject = this.toObject(data);
    if (kind === "ping") {
      const rttMs = finiteNumber(dataObject.rttMs);
      if (rttMs !== null) {
        this.lastRttMs = rttMs;
        this.maxRttMs = this.maxRttMs === null ? rttMs : Math.max(this.maxRttMs, rttMs);
        this.rttValues.push(rttMs);
        if (this.rttValues.length > MAX_RTT_VALUES) this.rttValues = this.rttValues.slice(-MAX_RTT_VALUES);
      }
      return;
    }

    if (kind === "state-diff") {
      this.stateDiffCount += 1;
      const intervalMs = finiteNumber(dataObject.intervalMs);
      if (intervalMs !== null) {
        this.maxStateDiffGapMs = this.maxStateDiffGapMs === null ? intervalMs : Math.max(this.maxStateDiffGapMs, intervalMs);
      }
      return;
    }

    if (kind === "movement") {
      this.movementRequestCount += 1;
      const durationMs = finiteNumber(dataObject.durationMs);
      if (durationMs !== null) {
        this.movementDurations.push(durationMs);
        if (this.movementDurations.length > MAX_MOVEMENT_VALUES) this.movementDurations = this.movementDurations.slice(-MAX_MOVEMENT_VALUES);
      }
    }
  }

  private buildBatch(reason: string, samples: LatencySample[]): LatencyBatch {
    const generatedAt = Date.now();
    return {
      schemaVersion: 1,
      kind: "latency-sample-batch",
      batchId: makeId(),
      reason,
      generatedAt,
      generatedAtIso: nowIso(generatedAt),
      session: this.activeSession,
      context: sanitizeValue(this.activeSession?.context ?? this.context) as LatencyRecorderContext,
      browser: browserSummary(),
      pendingBeforeBatch: this.pendingSamples.length,
      droppedBeforeBatch: this.activeSession?.droppedSamples ?? 0,
      samples,
    };
  }

  private tryBeaconBatch(reason: string) {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    if (this.pendingSamples.length === 0) return;
    const samples = this.pendingSamples.slice(-120);
    const batch = this.buildBatch(reason, samples);
    const body = JSON.stringify(batch);
    if (body.length >= KEEPALIVE_MAX_BYTES) return;
    try {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(LATENCY_BATCH_ENDPOINT, blob);
    } catch {
      // ignore unload failures
    }
  }

  private toObject(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  }
}

let singleton: ClientLatencyRecorder | null = null;

export function getClientLatencyRecorder() {
  if (!singleton) singleton = new ClientLatencyRecorder();
  return singleton;
}

declare global {
  interface Window {
    __zhenchuanLatencyRecorder?: ClientLatencyRecorder;
    __zhenchuanLatencyReport?: () => LatencyReport;
  }
}