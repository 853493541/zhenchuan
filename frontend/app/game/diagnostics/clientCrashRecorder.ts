"use client";

type BreadcrumbSeverity = "info" | "warn" | "error" | "fatal";

export type CrashReportReason =
  | "heartbeat"
  | "manual"
  | "pagehide"
  | "fatal-error"
  | "react-error-boundary"
  | "webgl-context-lost"
  | "suspected-previous-crash"
  | "unclean-previous-session";

export type CrashRecorderContext = {
  gameId?: string;
  userId?: string;
  username?: string;
  route?: string;
  gameMode?: string;
  tournamentPhase?: string;
  battleNumber?: number;
  stateVersion?: number;
  playerCount?: number;
  selfHp?: number;
  selfMaxHp?: number;
  selfPosition?: { x?: number; y?: number; z?: number };
};

export type CrashRecorderSummary = {
  sessionId: string | null;
  startedAt: number | null;
  lastAliveAt: number | null;
  lastHeartbeatAt: number | null;
  lastDisconnectAt: number | null;
  lastReconnectAt: number | null;
  disconnectCount: number;
  reconnectCount: number;
  breadcrumbCount: number;
  lastFatalAt: number | null;
  lastUploadAt: number | null;
  lastUploadStatus: "idle" | "pending" | "ok" | "failed";
  lastReportId: string | null;
  lastUploadError: string | null;
  relationSummary: string;
};

type CrashBreadcrumb = {
  ts: number;
  iso: string;
  relMs: number;
  type: string;
  severity: BreadcrumbSeverity;
  data?: unknown;
};

type ActiveCrashSession = {
  schemaVersion: 1;
  sessionId: string;
  startedAt: number;
  startedAtIso: string;
  lastAliveAt: number;
  lastHeartbeatAt: number;
  cleanExitAt?: number;
  cleanExitReason?: string;
  lastDisconnectAt?: number;
  lastDisconnectReason?: string;
  lastReconnectAt?: number;
  disconnectCount: number;
  reconnectCount: number;
  lastPagehideAt?: number;
  lastBeforeUnloadAt?: number;
  lastFatalAt?: number;
  lastFatalSummary?: string;
  context: CrashRecorderContext;
};

type StoredBuffer = {
  sessionId: string;
  breadcrumbs: CrashBreadcrumb[];
};

type StoredQueue = {
  reports: unknown[];
};

type FrontendLogEntry = {
  schemaVersion: 1;
  logId: string;
  sessionId: string | null;
  ts: number;
  iso: string;
  relMs: number;
  type: string;
  severity: BreadcrumbSeverity;
  context: CrashRecorderContext;
  data?: unknown;
};

type StoredFrontendLogQueue = {
  entries: FrontendLogEntry[];
  dropped: number;
};

type ConnectionChecklist = {
  updatedAt: number | null;
  updatedAtIso: string | null;
  lastStage: string | null;
  stages: Record<string, unknown>;
};

type FrontendLogBatch = {
  schemaVersion: 1;
  kind: "frontend-log-batch";
  batchId: string;
  reason: string;
  generatedAt: number;
  generatedAtIso: string;
  sessionId: string | null;
  context: CrashRecorderContext;
  browser: Record<string, unknown>;
  droppedBeforeBatch: number;
  entries: FrontendLogEntry[];
};

type UploadStatus = {
  status: "idle" | "pending" | "ok" | "failed";
  at?: number;
  reportId?: string;
  error?: string;
};

type EndSessionOptions = {
  clearUploadedLogs?: boolean;
};

type CrashReport = {
  schemaVersion: 1;
  reason: CrashReportReason;
  generatedAt: number;
  generatedAtIso: string;
  compact: boolean;
  session: ActiveCrashSession | null;
  context: CrashRecorderContext;
  timeline: Record<string, unknown>;
  browser: Record<string, unknown>;
  metrics: Record<string, unknown>;
  latestGameSnapshot: Record<string, unknown> | null;
  breadcrumbs: CrashBreadcrumb[];
};

const ACTIVE_SESSION_KEY = "zhenchuan.crashRecorder.activeSession.v1";
const BUFFER_KEY = "zhenchuan.crashRecorder.buffer.v1";
const QUEUE_KEY = "zhenchuan.crashRecorder.uploadQueue.v1";
const FRONTEND_LOG_QUEUE_KEY = "zhenchuan.crashRecorder.frontendLogQueue.v1";
const MAX_BREADCRUMBS = 320;
const MAX_QUEUED_REPORTS = 6;
const MAX_FRONTEND_LOG_QUEUE = 600;
const MAX_FRONTEND_LOG_BATCH = 120;
const HEARTBEAT_MS = 5_000;
const HEARTBEAT_UPLOAD_MS = 30_000;
const FRONTEND_LOG_FLUSH_MS = 8_000;
const STATE_DIFF_LOG_SAMPLE_MS = 2_000;
const FULL_REPORT_BREADCRUMBS = 260;
const COMPACT_REPORT_BREADCRUMBS = 70;
const KEEPALIVE_MAX_BYTES = 60_000;
const CRASH_REPORT_ENDPOINT = "/api/diagnostics/client-crash-report";
const FRONTEND_LOG_ENDPOINT = "/api/diagnostics/client-frontend-log";
const SESSION_CLEAN_EXIT_ENDPOINT = "/api/diagnostics/client-session-clean-exit";
const SENSITIVE_KEY_RE = /(token|password|cookie|authorization|jwt|secret|auth|credential)/i;

const nowIso = (ts = Date.now()) => new Date(ts).toISOString();

function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return safeJsonParse(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable or full. Backend heartbeat still gives us a trail.
  }
}

function removeStorage(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function truncateText(value: string, max = 700) {
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
      stack: truncateText(value.stack ?? "", 2_500),
    };
  }

  if (typeof Event !== "undefined" && value instanceof Event) {
    return {
      type: value.type,
      target: value.target instanceof Element ? value.target.tagName : undefined,
    };
  }

  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (depth >= 5) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, 40).map((entry) => sanitizeValue(entry, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
  for (const [key, entry] of entries) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : sanitizeValue(entry, depth + 1, seen);
  }
  return out;
}

function getBrowserMetrics() {
  const memory = (typeof performance !== "undefined" ? (performance as any).memory : null) ?? null;
  const resources = typeof performance !== "undefined"
    ? performance.getEntriesByType("resource").slice(-30).map((entry) => ({
        name: truncateText((entry as PerformanceResourceTiming).name ?? String(entry.name), 260),
        initiatorType: (entry as PerformanceResourceTiming).initiatorType,
        duration: Math.round(entry.duration),
        transferSize: Number((entry as PerformanceResourceTiming).transferSize ?? 0) || 0,
      }))
    : [];

  return sanitizeValue({
    visibilityState: typeof document !== "undefined" ? document.visibilityState : undefined,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
    deviceMemory: typeof navigator !== "undefined" ? (navigator as any).deviceMemory : undefined,
    memory: memory ? {
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      totalJSHeapSize: memory.totalJSHeapSize,
      usedJSHeapSize: memory.usedJSHeapSize,
    } : null,
    dom: typeof document !== "undefined" ? {
      nodes: document.getElementsByTagName("*").length,
      canvases: document.getElementsByTagName("canvas").length,
      images: document.getElementsByTagName("img").length,
      scripts: document.getElementsByTagName("script").length,
    } : null,
    resources,
  }) as Record<string, unknown>;
}

function getBrowserLogSummary() {
  return sanitizeValue({
    visibilityState: typeof document !== "undefined" ? document.visibilityState : undefined,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    url: typeof window !== "undefined" ? truncateText(window.location.href, 500) : null,
    viewport: typeof window !== "undefined" ? {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    } : null,
  }) as Record<string, unknown>;
}

function describeDisconnectRelation(session: ActiveCrashSession | null, eventAt: number) {
  if (!session?.lastDisconnectAt) {
    return {
      relation: "no-disconnect-recorded",
      summary: "no disconnect recorded before event",
    };
  }

  const deltaMs = eventAt - session.lastDisconnectAt;
  const reconnectedAfterDisconnect = typeof session.lastReconnectAt === "number" && session.lastReconnectAt >= session.lastDisconnectAt;
  const connectedAtEvent = reconnectedAfterDisconnect && session.lastReconnectAt! <= eventAt;
  const closeWindow = Math.abs(deltaMs) <= 10_000;
  const relation = closeWindow
    ? "same-10s-window"
    : deltaMs >= 0
      ? "event-after-disconnect"
      : "event-before-disconnect";

  return {
    relation,
    eventAt,
    eventAtIso: nowIso(eventAt),
    lastDisconnectAt: session.lastDisconnectAt,
    lastDisconnectAtIso: nowIso(session.lastDisconnectAt),
    lastReconnectAt: session.lastReconnectAt,
    lastReconnectAtIso: session.lastReconnectAt ? nowIso(session.lastReconnectAt) : null,
    eventMsFromLastDisconnect: deltaMs,
    connectedAtEvent,
    lastDisconnectReason: session.lastDisconnectReason ?? null,
    summary: `${relation}, ${deltaMs}ms from last disconnect`,
  };
}

function formatTime(ts?: number | null) {
  return ts ? nowIso(ts) : "-";
}

export function formatCrashDiagnosticsReport(report: CrashReport) {
  const relation = report.timeline.disconnectRelation as any;
  const lines: string[] = [];
  lines.push("崩溃诊断报告");
  lines.push(`原因: ${report.reason}`);
  lines.push(`生成时间: ${report.generatedAtIso}`);
  lines.push(`Session: ${report.session?.sessionId ?? "-"}`);
  lines.push(`Game: ${report.context.gameId ?? "-"} / ${report.context.gameMode ?? "-"}`);
  lines.push(`User: ${report.context.userId ?? "-"}`);
  lines.push("");
  lines.push("时间关系:");
  lines.push(`- 启动: ${formatTime(report.session?.startedAt)}`);
  lines.push(`- 最后心跳: ${formatTime(report.session?.lastAliveAt)}`);
  lines.push(`- 最后断线: ${formatTime(report.session?.lastDisconnectAt)}`);
  lines.push(`- 最后重连: ${formatTime(report.session?.lastReconnectAt)}`);
  lines.push(`- 崩溃/事件与断线: ${relation?.summary ?? "-"}`);
  lines.push("");
  lines.push("状态:");
  lines.push(`- phase=${report.context.tournamentPhase ?? "-"}, battle=${report.context.battleNumber ?? "-"}, version=${report.context.stateVersion ?? "-"}`);
  lines.push(`- hp=${report.context.selfHp ?? "-"}/${report.context.selfMaxHp ?? "-"}, pos=${JSON.stringify(report.context.selfPosition ?? {})}`);
  const snapshot = report.latestGameSnapshot as any;
  if (snapshot?.gameCounts) {
    lines.push(`- counts=${JSON.stringify(snapshot.gameCounts)}`);
  }
  if (snapshot?.sceneMetrics) {
    lines.push(`- three=${JSON.stringify(snapshot.sceneMetrics)}`);
  }
  lines.push("");
  lines.push("最近行为:");
  for (const breadcrumb of report.breadcrumbs.slice(-80)) {
    lines.push(`[${new Date(breadcrumb.ts).toLocaleTimeString("en-GB", { hour12: false })}] ${breadcrumb.severity} ${breadcrumb.type} ${JSON.stringify(breadcrumb.data ?? {})}`);
  }
  return lines.join("\n");
}

class ClientCrashRecorder {
  private installed = false;
  private activeSession: ActiveCrashSession | null = null;
  private breadcrumbs: CrashBreadcrumb[] = [];
  private heartbeatTimer: number | null = null;
  private frontendLogTimer: number | null = null;
  private lastPersistAt = 0;
  private lastHeartbeatUploadAt = 0;
  private lastMovementSampleAt = 0;
  private lastStateDiffLogAt = 0;
  private skippedStateDiffMessages = 0;
  private latestGameSnapshot: Record<string, unknown> | null = null;
  private latestSceneMetrics: Record<string, unknown> | null = null;
  private context: CrashRecorderContext = {};
  private uploadStatus: UploadStatus = { status: "idle" };
  private connectionChecklist: ConnectionChecklist = {
    updatedAt: null,
    updatedAtIso: null,
    lastStage: null,
    stages: {},
  };
  private originalConsoleError: typeof console.error | null = null;
  private originalConsoleWarn: typeof console.warn | null = null;
  private consoleWrapping = false;
  private frontendLogUploadInFlight = false;

  startSession(context: CrashRecorderContext) {
    if (typeof window === "undefined") return;
    this.installGlobalHandlers();
    this.context = { ...this.context, ...context, route: context.route ?? window.location.pathname };

    if (this.activeSession?.context.gameId === context.gameId && this.activeSession.context.userId === context.userId) {
      this.updateContext(context);
      return;
    }

    const previousSession = readStorage<ActiveCrashSession | null>(ACTIVE_SESSION_KEY, null);
    const previousBuffer = readStorage<StoredBuffer | null>(BUFFER_KEY, null);

    if (previousSession && !previousSession.cleanExitAt) {
      const eventAt = previousSession.lastAliveAt || Date.now();
      const reason: CrashReportReason = previousSession.lastPagehideAt || previousSession.lastBeforeUnloadAt
        ? "unclean-previous-session"
        : "suspected-previous-crash";
      const previousReport = this.buildReportFor(reason, previousSession, previousBuffer?.breadcrumbs ?? [], {
        detectedAt: Date.now(),
        suspectedCrashAt: eventAt,
      }, false, eventAt);
      this.enqueueReport(previousReport);
    }

    const now = Date.now();
    this.activeSession = {
      schemaVersion: 1,
      sessionId: makeSessionId(),
      startedAt: now,
      startedAtIso: nowIso(now),
      lastAliveAt: now,
      lastHeartbeatAt: now,
      disconnectCount: 0,
      reconnectCount: 0,
      context: this.context,
    };
    this.breadcrumbs = [];
    this.connectionChecklist = {
      updatedAt: now,
      updatedAtIso: nowIso(now),
      lastStage: "session-start",
      stages: {},
    };
    this.lastStateDiffLogAt = 0;
    this.skippedStateDiffMessages = 0;
    this.recordBreadcrumb("session-start", { context: this.context });
    this.persist(true);
    this.startHeartbeat();
    this.startFrontendLogFlush();
    void this.flushQueuedReports().catch(() => undefined);
    void this.flushFrontendLogs("session-start").catch(() => undefined);
  }

  endSession(reason: string, options?: EndSessionOptions) {
    if (!this.activeSession) return;
    const session = this.activeSession;
    const now = Date.now();
    this.recordBreadcrumb("session-clean-exit", { reason });
    session.cleanExitAt = now;
    session.cleanExitReason = reason;
    session.lastAliveAt = now;
    this.persist(true);
    if (options?.clearUploadedLogs) {
      this.clearLocalSessionLogs(session.sessionId);
      void this.clearUploadedSessionLogs(session, reason).catch(() => undefined);
      this.activeSession = null;
      this.breadcrumbs = [];
      return;
    }
    void this.flushFrontendLogs("session-clean-exit", true).catch(() => undefined);
  }

  markSessionUnmount(reason: string) {
    if (!this.activeSession) return;
    this.recordBreadcrumb("session-unmount", { reason }, "warn", true);
  }

  updateContext(context: CrashRecorderContext) {
    this.context = { ...this.context, ...context };
    if (this.activeSession) {
      this.activeSession.context = { ...this.activeSession.context, ...this.context };
      this.activeSession.lastAliveAt = Date.now();
      this.persist(false);
    }
  }

  updateGameSnapshot(snapshot: Record<string, unknown>) {
    this.latestGameSnapshot = sanitizeValue(snapshot) as Record<string, unknown>;
    this.updateContext({
      gameId: typeof snapshot.gameId === "string" ? snapshot.gameId : this.context.gameId,
      gameMode: typeof snapshot.gameMode === "string" ? snapshot.gameMode : this.context.gameMode,
      stateVersion: typeof snapshot.stateVersion === "number" ? snapshot.stateVersion : this.context.stateVersion,
      selfHp: typeof snapshot.selfHp === "number" ? snapshot.selfHp : this.context.selfHp,
      selfMaxHp: typeof snapshot.selfMaxHp === "number" ? snapshot.selfMaxHp : this.context.selfMaxHp,
      selfPosition: typeof snapshot.selfPosition === "object" ? snapshot.selfPosition as CrashRecorderContext["selfPosition"] : this.context.selfPosition,
    });
  }

  updateSceneMetrics(metrics: Record<string, unknown>) {
    this.latestSceneMetrics = sanitizeValue(metrics) as Record<string, unknown>;
  }

  recordBehavior(type: string, data?: unknown) {
    this.recordBreadcrumb(`behavior:${type}`, data);
  }

  recordConnectionChecklist(stage: string, data?: unknown, force = false) {
    const now = Date.now();
    const stageData = typeof data === "object" && data !== null ? data as Record<string, unknown> : { value: data };
    this.connectionChecklist = {
      updatedAt: now,
      updatedAtIso: nowIso(now),
      lastStage: stage,
      stages: {
        ...this.connectionChecklist.stages,
        [stage]: sanitizeValue({ ts: now, iso: nowIso(now), ...stageData }),
      },
    };
    if (typeof window !== "undefined") {
      (window as any).__zhenchuanConnectionChecklist = this.getConnectionChecklist();
    }
    this.recordBreadcrumb("connection:checklist", { stage, ...stageData }, "info", force);
  }

  getConnectionChecklist() {
    return sanitizeValue(this.connectionChecklist) as ConnectionChecklist;
  }

  recordMovementSample(data: unknown, force = false) {
    const now = Date.now();
    if (!force && now - this.lastMovementSampleAt < 1_200) return;
    this.lastMovementSampleAt = now;
    this.recordBehavior("movement", data);
  }

  recordWebSocketEvent(type: string, data?: unknown) {
    if (type === "close" || type === "disconnect") {
      this.recordDisconnect(data);
      return;
    }
    if (type === "open" || type === "reconnect") {
      this.recordReconnect(data);
      return;
    }
    this.recordBreadcrumb(`ws:${type}`, data);
  }

  recordWebSocketMessage(data: { type?: string; version?: number; diffCount?: number; eventCount?: number; samplePaths?: string[] }) {
    if (data.type === "PONG") {
      this.updateContext({ stateVersion: data.version ?? this.context.stateVersion });
      return;
    }
    if (data.type === "STATE_DIFF") {
      const now = Date.now();
      if (typeof data.version === "number") {
        this.context = { ...this.context, stateVersion: data.version };
        if (this.activeSession) {
          this.activeSession.context = { ...this.activeSession.context, stateVersion: data.version };
          this.activeSession.lastAliveAt = now;
        }
      }

      const hasEvents = (data.eventCount ?? 0) > 0;
      if (!hasEvents && now - this.lastStateDiffLogAt < STATE_DIFF_LOG_SAMPLE_MS) {
        this.skippedStateDiffMessages += 1;
        return;
      }

      const skippedSinceLastLog = this.skippedStateDiffMessages;
      this.skippedStateDiffMessages = 0;
      this.lastStateDiffLogAt = now;
      this.recordBreadcrumb("ws:message", skippedSinceLastLog > 0 ? { ...data, skippedSinceLastLog } : data);
      return;
    }
    this.recordBreadcrumb("ws:message", data);
  }

  recordDisconnect(data?: unknown) {
    const now = Date.now();
    if (this.activeSession) {
      this.activeSession.lastDisconnectAt = now;
      this.activeSession.disconnectCount += 1;
      this.activeSession.lastDisconnectReason = typeof data === "object" && data && "reason" in data
        ? String((data as any).reason ?? "")
        : undefined;
      this.activeSession.lastAliveAt = now;
    }
    this.recordBreadcrumb("network:disconnect", data, "warn", true);
  }

  recordReconnect(data?: unknown) {
    const now = Date.now();
    if (this.activeSession) {
      this.activeSession.lastReconnectAt = now;
      this.activeSession.reconnectCount += 1;
      this.activeSession.lastAliveAt = now;
    }
    this.recordBreadcrumb("network:reconnect", data, "info", true);
  }

  recordWebGLContextLost(data?: unknown) {
    this.recordBreadcrumb("webgl:context-lost", data, "fatal", true);
    void this.uploadReport("webgl-context-lost", { compact: false }).catch(() => undefined);
  }

  recordWebGLContextRestored(data?: unknown) {
    this.recordBreadcrumb("webgl:context-restored", data, "warn", true);
  }

  recordFatalError(error: unknown, data?: unknown, reason: CrashReportReason = "fatal-error") {
    const now = Date.now();
    const summary = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (this.activeSession) {
      this.activeSession.lastFatalAt = now;
      this.activeSession.lastFatalSummary = truncateText(summary, 500);
      this.activeSession.lastAliveAt = now;
    }
    this.recordBreadcrumb("fatal:error", { error: sanitizeValue(error), data }, "fatal", true);
    const report = this.buildReport(reason, { compact: false, eventAt: now });
    const consoleError = this.originalConsoleError ?? (typeof console !== "undefined" ? console.error.bind(console) : null);
    consoleError?.("[Zhenchuan][crash-diagnostics]", summary, report);
    void this.uploadReportObject(report, false).catch(() => undefined);
  }

  buildReport(reason: CrashReportReason, options?: { compact?: boolean; eventAt?: number; extra?: Record<string, unknown> }) {
    return this.buildReportFor(reason, this.activeSession, this.breadcrumbs, options?.extra, options?.compact ?? false, options?.eventAt);
  }

  getReportText(reason: CrashReportReason = "manual") {
    return formatCrashDiagnosticsReport(this.buildReport(reason, { compact: false }));
  }

  async uploadReport(reason: CrashReportReason = "manual", options?: { compact?: boolean; eventAt?: number }) {
    const report = this.buildReport(reason, options);
    return this.uploadReportObject(report, options?.compact ?? false);
  }

  getSummary(): CrashRecorderSummary {
    const session = this.activeSession;
    const relation = describeDisconnectRelation(session, Date.now());
    return {
      sessionId: session?.sessionId ?? null,
      startedAt: session?.startedAt ?? null,
      lastAliveAt: session?.lastAliveAt ?? null,
      lastHeartbeatAt: session?.lastHeartbeatAt ?? null,
      lastDisconnectAt: session?.lastDisconnectAt ?? null,
      lastReconnectAt: session?.lastReconnectAt ?? null,
      disconnectCount: session?.disconnectCount ?? 0,
      reconnectCount: session?.reconnectCount ?? 0,
      breadcrumbCount: this.breadcrumbs.length,
      lastFatalAt: session?.lastFatalAt ?? null,
      lastUploadAt: this.uploadStatus.at ?? null,
      lastUploadStatus: this.uploadStatus.status,
      lastReportId: this.uploadStatus.reportId ?? null,
      lastUploadError: this.uploadStatus.error ?? null,
      relationSummary: String(relation.summary ?? "-"),
    };
  }

  private installGlobalHandlers() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;

    window.addEventListener("error", (event) => {
      this.recordFatalError(event.error ?? event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        message: event.message,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.recordFatalError(event.reason ?? "unhandledrejection", { type: "unhandledrejection" });
    });

    document.addEventListener("visibilitychange", () => {
      this.recordBreadcrumb(document.hidden ? "page:hidden" : "page:visible", { visibilityState: document.visibilityState });
      if (document.hidden) void this.flushFrontendLogs("visibility-hidden", true).catch(() => undefined);
    });

    window.addEventListener("pagehide", () => {
      const now = Date.now();
      if (this.activeSession) {
        this.activeSession.lastPagehideAt = now;
        this.activeSession.lastAliveAt = now;
      }
      this.recordBreadcrumb("page:pagehide", undefined, "warn", true);
      this.tryBeaconReport("pagehide");
      this.tryBeaconFrontendLogs("pagehide");
    });

    window.addEventListener("beforeunload", () => {
      const now = Date.now();
      if (this.activeSession) {
        this.activeSession.lastBeforeUnloadAt = now;
        this.activeSession.lastAliveAt = now;
      }
      this.recordBreadcrumb("page:beforeunload", undefined, "warn", true);
      this.persist(true);
      this.tryBeaconFrontendLogs("beforeunload");
    });

    this.wrapConsole();
    (window as any).__zhenchuanCrashRecorder = this;
    (window as any).__zhenchuanCrashReport = () => this.buildReport("manual", { compact: false });
    (window as any).__zhenchuanConnectionChecklist = this.getConnectionChecklist();
  }

  private wrapConsole() {
    if (this.consoleWrapping || typeof console === "undefined") return;
    this.consoleWrapping = true;
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);

    console.error = (...args: unknown[]) => {
      this.originalConsoleError?.(...args);
      this.recordBreadcrumb("console:error", { args: args.map((arg) => sanitizeValue(arg)) }, "error");
    };
    console.warn = (...args: unknown[]) => {
      this.originalConsoleWarn?.(...args);
      this.recordBreadcrumb("console:warn", { args: args.map((arg) => sanitizeValue(arg)) }, "warn");
    };
  }

  private recordBreadcrumb(type: string, data?: unknown, severity: BreadcrumbSeverity = "info", forcePersist = false) {
    const now = Date.now();
    const startedAt = this.activeSession?.startedAt ?? now;
    const breadcrumb: CrashBreadcrumb = {
      ts: now,
      iso: nowIso(now),
      relMs: now - startedAt,
      type,
      severity,
      data: sanitizeValue(data),
    };
    this.breadcrumbs.push(breadcrumb);
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.breadcrumbs = this.breadcrumbs.slice(-MAX_BREADCRUMBS);
    }
    if (this.activeSession) {
      this.activeSession.lastAliveAt = now;
    }
    this.persist(forcePersist);
    this.appendFrontendLog(breadcrumb);
    if (severity === "fatal") {
      this.tryBeaconFrontendLogs(`fatal:${type}`);
      void this.flushFrontendLogs(`fatal:${type}`, true).catch(() => undefined);
    } else if (forcePersist) {
      void this.flushFrontendLogs(`event:${type}`, true).catch(() => undefined);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer !== null || typeof window === "undefined") return;
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.activeSession) return;
      const now = Date.now();
      this.activeSession.lastAliveAt = now;
      this.activeSession.lastHeartbeatAt = now;
      this.recordBreadcrumb("heartbeat", {
        metrics: getBrowserMetrics(),
        sceneMetrics: this.latestSceneMetrics,
      });
      this.persist(true);
      if (now - this.lastHeartbeatUploadAt >= HEARTBEAT_UPLOAD_MS) {
        this.lastHeartbeatUploadAt = now;
        void this.uploadReport("heartbeat", { compact: true, eventAt: now }).catch(() => undefined);
      }
    }, HEARTBEAT_MS);
  }

  private startFrontendLogFlush() {
    if (this.frontendLogTimer !== null || typeof window === "undefined") return;
    this.frontendLogTimer = window.setInterval(() => {
      void this.flushFrontendLogs("timer").catch(() => undefined);
    }, FRONTEND_LOG_FLUSH_MS);
  }

  private persist(force = false) {
    if (!this.activeSession) return;
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 2_000) return;
    this.lastPersistAt = now;
    writeStorage(ACTIVE_SESSION_KEY, this.activeSession);
    writeStorage(BUFFER_KEY, {
      sessionId: this.activeSession.sessionId,
      breadcrumbs: this.breadcrumbs,
    } satisfies StoredBuffer);
  }

  private appendFrontendLog(breadcrumb: CrashBreadcrumb) {
    const queue = readStorage<StoredFrontendLogQueue>(FRONTEND_LOG_QUEUE_KEY, { entries: [], dropped: 0 });
    const context = sanitizeValue(this.activeSession?.context ?? this.context) as CrashRecorderContext;
    queue.entries.push({
      schemaVersion: 1,
      logId: makeSessionId(),
      sessionId: this.activeSession?.sessionId ?? null,
      ts: breadcrumb.ts,
      iso: breadcrumb.iso,
      relMs: breadcrumb.relMs,
      type: breadcrumb.type,
      severity: breadcrumb.severity,
      context,
      data: breadcrumb.data,
    });
    if (queue.entries.length > MAX_FRONTEND_LOG_QUEUE) {
      const dropped = queue.entries.length - MAX_FRONTEND_LOG_QUEUE;
      queue.entries = queue.entries.slice(-MAX_FRONTEND_LOG_QUEUE);
      queue.dropped += dropped;
    }
    writeStorage(FRONTEND_LOG_QUEUE_KEY, queue);
  }

  private buildFrontendLogBatch(reason: string, entries: FrontendLogEntry[], droppedBeforeBatch: number): FrontendLogBatch {
    const generatedAt = Date.now();
    return {
      schemaVersion: 1,
      kind: "frontend-log-batch",
      batchId: makeSessionId(),
      reason,
      generatedAt,
      generatedAtIso: nowIso(generatedAt),
      sessionId: this.activeSession?.sessionId ?? entries[entries.length - 1]?.sessionId ?? null,
      context: sanitizeValue(this.activeSession?.context ?? this.context) as CrashRecorderContext,
      browser: getBrowserLogSummary(),
      droppedBeforeBatch,
      entries,
    };
  }

  private removeUploadedFrontendLogs(uploadedLogIds: string[]) {
    const uploaded = new Set(uploadedLogIds);
    const queue = readStorage<StoredFrontendLogQueue>(FRONTEND_LOG_QUEUE_KEY, { entries: [], dropped: 0 });
    const remaining = queue.entries.filter((entry) => !uploaded.has(entry.logId));
    const nextQueue: StoredFrontendLogQueue = {
      entries: remaining,
      dropped: 0,
    };
    if (nextQueue.entries.length > 0) writeStorage(FRONTEND_LOG_QUEUE_KEY, nextQueue);
    else removeStorage(FRONTEND_LOG_QUEUE_KEY);
  }

  private clearLocalSessionLogs(sessionId: string) {
    removeStorage(ACTIVE_SESSION_KEY);
    removeStorage(BUFFER_KEY);

    const frontendQueue = readStorage<StoredFrontendLogQueue>(FRONTEND_LOG_QUEUE_KEY, { entries: [], dropped: 0 });
    const frontendEntries = frontendQueue.entries.filter((entry) => entry.sessionId !== sessionId);
    if (frontendEntries.length > 0) writeStorage(FRONTEND_LOG_QUEUE_KEY, { entries: frontendEntries, dropped: 0 });
    else removeStorage(FRONTEND_LOG_QUEUE_KEY);

    const reportQueue = readStorage<StoredQueue>(QUEUE_KEY, { reports: [] });
    const reports = reportQueue.reports.filter((report: any) => report?.session?.sessionId !== sessionId);
    if (reports.length > 0) writeStorage(QUEUE_KEY, { reports });
    else removeStorage(QUEUE_KEY);
  }

  private async clearUploadedSessionLogs(session: ActiveCrashSession, reason: string) {
    if (typeof window === "undefined") return;
    const gameId = session.context.gameId;
    if (!gameId) return;
    const body = JSON.stringify({
      sessionId: session.sessionId,
      gameId,
      reason,
      cleanExitAt: session.cleanExitAt,
    });
    await fetch(SESSION_CLEAN_EXIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: body.length < KEEPALIVE_MAX_BYTES,
      body,
    });
  }

  private async flushFrontendLogs(reason = "timer", keepalive = false) {
    if (this.frontendLogUploadInFlight || typeof window === "undefined") return;
    const queue = readStorage<StoredFrontendLogQueue>(FRONTEND_LOG_QUEUE_KEY, { entries: [], dropped: 0 });
    if (queue.entries.length === 0) return;

    const entries = queue.entries.slice(0, MAX_FRONTEND_LOG_BATCH);
    const batch = this.buildFrontendLogBatch(reason, entries, queue.dropped);
    const body = JSON.stringify(batch);
    this.frontendLogUploadInFlight = true;
    try {
      const res = await fetch(FRONTEND_LOG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: keepalive && body.length < KEEPALIVE_MAX_BYTES,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json().catch(() => ({}));
      this.removeUploadedFrontendLogs(entries.map((entry) => entry.logId));
    } finally {
      this.frontendLogUploadInFlight = false;
    }
  }

  private buildReportFor(
    reason: CrashReportReason,
    session: ActiveCrashSession | null,
    sourceBreadcrumbs: CrashBreadcrumb[],
    extra?: Record<string, unknown>,
    compact = false,
    eventAt = Date.now(),
  ): CrashReport {
    const generatedAt = Date.now();
    const breadcrumbLimit = compact ? COMPACT_REPORT_BREADCRUMBS : FULL_REPORT_BREADCRUMBS;
    const relation = describeDisconnectRelation(session, eventAt);
    return {
      schemaVersion: 1,
      reason,
      generatedAt,
      generatedAtIso: nowIso(generatedAt),
      compact,
      session,
      context: session?.context ?? this.context,
      timeline: {
        eventAt,
        eventAtIso: nowIso(eventAt),
        detectedAt: extra?.detectedAt ?? generatedAt,
        suspectedCrashAt: extra?.suspectedCrashAt ?? null,
        disconnectRelation: relation,
        lastFatalAt: session?.lastFatalAt ?? null,
        lastFatalAtIso: session?.lastFatalAt ? nowIso(session.lastFatalAt) : null,
        lastFatalSummary: session?.lastFatalSummary ?? null,
        connectionChecklist: this.getConnectionChecklist(),
      },
      browser: {
        userAgent: typeof navigator !== "undefined" ? truncateText(navigator.userAgent, 500) : null,
        url: typeof window !== "undefined" ? truncateText(window.location.href, 500) : null,
        viewport: typeof window !== "undefined" ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio } : null,
      },
      metrics: getBrowserMetrics(),
      latestGameSnapshot: this.latestGameSnapshot,
      breadcrumbs: sourceBreadcrumbs.slice(-breadcrumbLimit),
    };
  }

  private enqueueReport(report: unknown) {
    const queue = readStorage<StoredQueue>(QUEUE_KEY, { reports: [] });
    queue.reports.push(report);
    queue.reports = queue.reports.slice(-MAX_QUEUED_REPORTS);
    writeStorage(QUEUE_KEY, queue);
  }

  private async flushQueuedReports() {
    const queue = readStorage<StoredQueue>(QUEUE_KEY, { reports: [] });
    if (queue.reports.length === 0) return;
    const remaining: unknown[] = [];
    for (const report of queue.reports) {
      try {
        await this.uploadReportObject(report, false);
      } catch {
        remaining.push(report);
      }
    }
    if (remaining.length > 0) writeStorage(QUEUE_KEY, { reports: remaining.slice(-MAX_QUEUED_REPORTS) });
    else removeStorage(QUEUE_KEY);
  }

  private async uploadReportObject(report: unknown, compact: boolean) {
    const body = JSON.stringify(report);
    this.uploadStatus = { status: "pending", at: Date.now() };
    try {
      const res = await fetch(CRASH_REPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: compact && body.length < KEEPALIVE_MAX_BYTES,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      this.uploadStatus = {
        status: "ok",
        at: Date.now(),
        reportId: typeof data.reportId === "string" ? data.reportId : null,
      };
      this.recordBreadcrumb("diagnostics:upload-ok", { reportId: this.uploadStatus.reportId, compact });
      return data;
    } catch (err) {
      this.uploadStatus = {
        status: "failed",
        at: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
      this.enqueueReport(report);
      throw err;
    }
  }

  private tryBeaconReport(reason: CrashReportReason) {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    const report = this.buildReport(reason, { compact: true });
    const body = JSON.stringify(report);
    if (body.length > KEEPALIVE_MAX_BYTES) return;
    try {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(CRASH_REPORT_ENDPOINT, blob);
    } catch {
      // ignore
    }
  }

  private tryBeaconFrontendLogs(reason: string) {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    const queue = readStorage<StoredFrontendLogQueue>(FRONTEND_LOG_QUEUE_KEY, { entries: [], dropped: 0 });
    if (queue.entries.length === 0) return;
    const entries = queue.entries.slice(-MAX_FRONTEND_LOG_BATCH);
    const batch = this.buildFrontendLogBatch(reason, entries, queue.dropped);
    const body = JSON.stringify(batch);
    if (body.length > KEEPALIVE_MAX_BYTES) return;
    try {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(FRONTEND_LOG_ENDPOINT, blob);
    } catch {
      // ignore
    }
  }
}

let singleton: ClientCrashRecorder | null = null;

export function getClientCrashRecorder() {
  if (!singleton) singleton = new ClientCrashRecorder();
  return singleton;
}

declare global {
  interface Window {
    __zhenchuanCrashRecorder?: ClientCrashRecorder;
    __zhenchuanCrashReport?: () => CrashReport;
  }
}
