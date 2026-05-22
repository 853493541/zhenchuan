import fs from "node:fs/promises";
import path from "node:path";
import GameSession from "../models/GameSession";
import { subscriptionManager } from "../../websocket/GameSubscriptionManager";

type JsonObject = Record<string, any>;

type LatencyLogEntry = {
  latencyBatchId?: string;
  latencyReportId?: string;
  receivedAt?: number;
  receivedAtIso?: string;
  payloadBytes?: number;
  user?: { uid?: string; username?: string } | null;
  latencyBatch?: JsonObject;
  latencyReport?: JsonObject;
};

type ParsedLatencyLine = {
  fileName: string;
  lineIndex: number;
  rawLine: string;
  entry: LatencyLogEntry | null;
  gameId: string | null;
  receivedAt: number | null;
};

type MetricSummary = {
  count: number;
  latest: number | null;
  avg: number | null;
  p95: number | null;
  max: number | null;
};

type SlowEvent = {
  id: string;
  at: number;
  iso: string;
  playerId: string;
  kind: string;
  label: string;
  metricLabel: string;
  metricMs: number;
  thresholdMs: number;
  severity: "warn" | "bad";
  detail: Record<string, unknown>;
};

type TimelineEntry = {
  id: string;
  at: number;
  iso: string;
  kind: string;
  label: string;
  valueMs: number | null;
  severity: "ok" | "warn" | "bad";
  detail: Record<string, unknown>;
};

type GameAccumulator = {
  gameId: string;
  mode: string | null;
  tournamentPhase: string | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  sampleCount: number;
  payloadBytes: number;
  playerIds: Set<string>;
  playerNames: Map<string, string>;
  sampleIds: Set<string>;
  rttValues: number[];
  latestRttMs: number | null;
  stateDiffCount: number;
  movementCount: number;
  httpCount: number;
  lifecycleCount: number;
  slowEvents: SlowEvent[];
};

type PlayerAccumulator = {
  userId: string;
  username: string | null;
  sessionIds: Set<string>;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  sampleCount: number;
  rttValues: number[];
  latestRttMs: number | null;
  movementDurations: number[];
  httpDurations: number[];
  stateDiffIntervals: number[];
  stateDiffLags: number[];
  lifecycleEvents: TimelineEntry[];
  timeline: TimelineEntry[];
  slowEvents: SlowEvent[];
  lastStateTimelineAt: number | null;
};

export type NetworkSessionSummary = {
  gameId: string;
  mode: string | null;
  started: boolean | null;
  gameOver: boolean | null;
  createdAt: number | null;
  updatedAt: number | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  connectedClientCount: number;
  connectedPlayerIds: string[];
  recordingActive: boolean;
  recordingStoppedReason: string | null;
  starred: boolean;
  sampleCount: number;
  payloadBytes: number;
  playerIds: string[];
  playerNames: Record<string, string>;
  rtt: MetricSummary;
  stateDiffCount: number;
  movementCount: number;
  httpCount: number;
  lifecycleCount: number;
  issueCount: number;
};

export type NetworkSessionDetail = {
  game: NetworkSessionSummary;
  players: Array<{
    userId: string;
    username: string | null;
    sessionIds: string[];
    firstSeenAt: number | null;
    lastSeenAt: number | null;
    sampleCount: number;
    rtt: MetricSummary;
    movement: MetricSummary;
    http: MetricSummary;
    stateDiffInterval: MetricSummary;
    stateDiffLag: MetricSummary;
    lifecycleEvents: TimelineEntry[];
    slowEvents: SlowEvent[];
    timeline: TimelineEntry[];
    timelineTotal: number;
  }>;
};

const RECENT_UNSTARRED_LIMIT = 5;
const MAX_PLAYER_TIMELINE = 900;
const MAX_PLAYER_SLOW_EVENTS = 120;
const MAX_GAME_SLOW_EVENTS = 60;
const STATE_DIFF_TIMELINE_SAMPLE_MS = 1_000;

export const LATENCY_LOG_DIR = process.env.CLIENT_LATENCY_LOG_DIR || path.resolve(process.cwd(), "../logs/latency");
const LATENCY_STARRED_FILE = process.env.CLIENT_LATENCY_STARRED_FILE || path.join(LATENCY_LOG_DIR, "starred-games.json");

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const numeric = asNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function roundMs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function roundNonNegativeMs(value: unknown): number | null {
  return roundMs(nonNegativeNumber(value));
}

function roundDerivedLatencyMs(value: unknown): number | "时钟偏差" | null {
  const numeric = asNumber(value);
  if (numeric === null) return null;
  return numeric < 0 ? "时钟偏差" : roundMs(numeric);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function metricSummary(values: number[], latest: number | null = null): MetricSummary {
  if (values.length === 0) {
    return { count: 0, latest: roundMs(latest), avg: null, p95: null, max: null };
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    latest: roundMs(latest ?? values[values.length - 1] ?? null),
    avg: roundMs(sum / values.length),
    p95: roundMs(percentile(values, 0.95)),
    max: roundMs(Math.max(...values)),
  };
}

function nowIso(ts: number) {
  return new Date(ts).toISOString();
}

function isMongoId(value: string) {
  return /^[a-f0-9]{24}$/i.test(value);
}

function getPayload(entry: LatencyLogEntry): JsonObject | null {
  return asRecord(entry.latencyBatch) ?? asRecord(entry.latencyReport);
}

function getPayloadContext(payload: JsonObject | null): JsonObject {
  if (!payload) return {};
  return asRecord(payload.context) ?? asRecord(asRecord(payload.session)?.context) ?? {};
}

function getSamples(payload: JsonObject | null): JsonObject[] {
  const samples = payload?.samples;
  return Array.isArray(samples) ? samples.map(asRecord).filter(Boolean) as JsonObject[] : [];
}

function getSampleContext(sample: JsonObject | null, payload: JsonObject | null): JsonObject {
  return asRecord(sample?.context) ?? getPayloadContext(payload);
}

function getGameIdFromEntry(entry: LatencyLogEntry): string | null {
  const payload = getPayload(entry);
  const context = getPayloadContext(payload);
  const fromContext = asString(context.gameId);
  if (fromContext) return fromContext;

  for (const sample of getSamples(payload)) {
    const sampleGameId = asString(getSampleContext(sample, payload).gameId);
    if (sampleGameId) return sampleGameId;
  }

  return null;
}

function getEntryTime(entry: LatencyLogEntry, payload: JsonObject | null): number | null {
  return asNumber(entry.receivedAt)
    ?? asNumber(payload?.generatedAt)
    ?? asNumber(asRecord(payload?.session)?.startedAt)
    ?? null;
}

function getSampleTime(sample: JsonObject, entry: LatencyLogEntry, payload: JsonObject | null): number {
  return asNumber(sample.ts) ?? getEntryTime(entry, payload) ?? Date.now();
}

function createGameAccumulator(gameId: string): GameAccumulator {
  return {
    gameId,
    mode: null,
    tournamentPhase: null,
    firstSeenAt: null,
    lastSeenAt: null,
    sampleCount: 0,
    payloadBytes: 0,
    playerIds: new Set(),
    playerNames: new Map(),
    sampleIds: new Set(),
    rttValues: [],
    latestRttMs: null,
    stateDiffCount: 0,
    movementCount: 0,
    httpCount: 0,
    lifecycleCount: 0,
    slowEvents: [],
  };
}

function createPlayerAccumulator(userId: string, username: string | null): PlayerAccumulator {
  return {
    userId,
    username,
    sessionIds: new Set(),
    firstSeenAt: null,
    lastSeenAt: null,
    sampleCount: 0,
    rttValues: [],
    latestRttMs: null,
    movementDurations: [],
    httpDurations: [],
    stateDiffIntervals: [],
    stateDiffLags: [],
    lifecycleEvents: [],
    timeline: [],
    slowEvents: [],
    lastStateTimelineAt: null,
  };
}

function observeTime(target: { firstSeenAt: number | null; lastSeenAt: number | null }, ts: number) {
  target.firstSeenAt = target.firstSeenAt === null ? ts : Math.min(target.firstSeenAt, ts);
  target.lastSeenAt = target.lastSeenAt === null ? ts : Math.max(target.lastSeenAt, ts);
}

function buildSlowEvent(sample: JsonObject, sampleKey: string, playerId: string, ts: number): SlowEvent | null {
  const data = asRecord(sample.data) ?? {};
  const kind = asString(sample.kind) ?? "unknown";
  const candidates: Array<{ metricLabel: string; metricMs: number | null; thresholdMs: number; badMs: number; label: string }> = [];

  if (kind === "ping") {
    candidates.push({ metricLabel: "RTT", metricMs: nonNegativeNumber(data.rttMs), thresholdMs: 220, badMs: 400, label: "PING/PONG 往返过慢" });
  } else if (kind === "state-diff") {
    candidates.push({ metricLabel: "状态包间隔", metricMs: nonNegativeNumber(data.intervalMs), thresholdMs: 180, badMs: 350, label: "状态同步间隔过长" });
    candidates.push({ metricLabel: "解析耗时", metricMs: nonNegativeNumber(data.parseMs), thresholdMs: 14, badMs: 30, label: "客户端解析过慢" });
  } else if (kind === "movement") {
    candidates.push({ metricLabel: "移动请求耗时", metricMs: nonNegativeNumber(data.durationMs), thresholdMs: 180, badMs: 350, label: "移动输入确认过慢" });
    candidates.push({ metricLabel: "服务器处理", metricMs: nonNegativeNumber(data.serverProcessingMs), thresholdMs: 60, badMs: 120, label: "移动服务器处理过慢" });
  } else if (kind === "http") {
    candidates.push({ metricLabel: "请求耗时", metricMs: nonNegativeNumber(data.durationMs), thresholdMs: 350, badMs: 700, label: "操作请求过慢" });
    candidates.push({ metricLabel: "服务器处理", metricMs: nonNegativeNumber(data.serverProcessingMs), thresholdMs: 80, badMs: 160, label: "操作服务器处理过慢" });
  }

  const slowest = candidates
    .filter((candidate): candidate is { metricLabel: string; metricMs: number; thresholdMs: number; badMs: number; label: string } => candidate.metricMs !== null && candidate.metricMs >= candidate.thresholdMs)
    .sort((a, b) => (b.metricMs / b.thresholdMs) - (a.metricMs / a.thresholdMs))[0];

  if (!slowest) return null;

  return {
    id: `${sampleKey}:${slowest.metricLabel}`,
    at: ts,
    iso: nowIso(ts),
    playerId,
    kind,
    label: slowest.label,
    metricLabel: slowest.metricLabel,
    metricMs: roundMs(slowest.metricMs) ?? slowest.metricMs,
    thresholdMs: slowest.thresholdMs,
    severity: slowest.metricMs >= slowest.badMs ? "bad" : "warn",
    detail: compactSampleDetail(kind, data),
  };
}

function compactSampleDetail(kind: string, data: JsonObject): Record<string, unknown> {
  if (kind === "ping") {
    return {
      seq: data.sequence,
      rttMs: roundNonNegativeMs(data.rttMs),
      c2sMs: roundDerivedLatencyMs(data.estimatedClientToServerMs),
      s2cMs: roundDerivedLatencyMs(data.estimatedServerToClientMs),
      serverMs: roundNonNegativeMs(data.serverProcessingMs),
    };
  }
  if (kind === "state-diff") {
    return {
      version: data.version,
      diffCount: data.diffCount,
      payloadBytes: data.payloadBytes,
      intervalMs: roundNonNegativeMs(data.intervalMs),
      receiveLagMs: roundDerivedLatencyMs(data.receiveLagMs),
    };
  }
  if (kind === "movement") {
    return {
      seq: data.seq,
      status: data.status,
      accepted: data.accepted,
      durationMs: roundNonNegativeMs(data.durationMs),
      serverMs: roundNonNegativeMs(data.serverProcessingMs),
      jump: data.shouldJump === true,
    };
  }
  if (kind === "http") {
    return {
      operation: data.operation,
      status: data.status,
      durationMs: roundNonNegativeMs(data.durationMs),
      serverMs: roundNonNegativeMs(data.serverProcessingMs),
    };
  }
  if (kind === "lifecycle") {
    return {
      type: data.type,
      reason: data.reason,
      stateVersion: data.stateVersion,
      disconnectedPlayers: Array.isArray(data.disconnectedPlayerIds) ? data.disconnectedPlayerIds.length : undefined,
    };
  }
  return { type: data.type };
}

function buildTimelineEntry(sample: JsonObject, sampleKey: string, ts: number, slowEvent: SlowEvent | null): TimelineEntry | null {
  const kind = asString(sample.kind) ?? "unknown";
  const data = asRecord(sample.data) ?? {};
  const detail = compactSampleDetail(kind, data);
  const severity = slowEvent?.severity ?? "ok";

  if (kind === "ping") {
    return { id: sampleKey, at: ts, iso: nowIso(ts), kind, label: "PING/PONG", valueMs: roundNonNegativeMs(data.rttMs), severity, detail };
  }
  if (kind === "state-diff") {
    return { id: sampleKey, at: ts, iso: nowIso(ts), kind, label: "状态同步", valueMs: roundNonNegativeMs(data.intervalMs), severity, detail };
  }
  if (kind === "movement") {
    return { id: sampleKey, at: ts, iso: nowIso(ts), kind, label: "移动输入", valueMs: roundNonNegativeMs(data.durationMs), severity, detail };
  }
  if (kind === "http") {
    return { id: sampleKey, at: ts, iso: nowIso(ts), kind, label: String(data.operation ?? "HTTP"), valueMs: roundNonNegativeMs(data.durationMs), severity, detail };
  }
  if (kind === "lifecycle") {
    return { id: sampleKey, at: ts, iso: nowIso(ts), kind, label: String(data.type ?? "连接事件"), valueMs: null, severity, detail };
  }
  return null;
}

async function readLatencyLines(): Promise<ParsedLatencyLine[]> {
  await fs.mkdir(LATENCY_LOG_DIR, { recursive: true });
  const files = (await fs.readdir(LATENCY_LOG_DIR).catch(() => [] as string[]))
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  const lines: ParsedLatencyLine[] = [];

  for (const fileName of files) {
    const logPath = path.join(LATENCY_LOG_DIR, fileName);
    const raw = await fs.readFile(logPath, "utf8").catch(() => "");
    if (!raw) continue;
    raw.split(/\n/).forEach((line, lineIndex) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line) as LatencyLogEntry;
        const payload = getPayload(entry);
        lines.push({
          fileName,
          lineIndex,
          rawLine: line,
          entry,
          gameId: getGameIdFromEntry(entry),
          receivedAt: getEntryTime(entry, payload),
        });
      } catch {
        lines.push({ fileName, lineIndex, rawLine: line, entry: null, gameId: null, receivedAt: null });
      }
    });
  }

  return lines;
}

export async function readStarredGameIds(): Promise<Set<string>> {
  await fs.mkdir(LATENCY_LOG_DIR, { recursive: true });
  const raw = await fs.readFile(LATENCY_STARRED_FILE, "utf8").catch(() => "");
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as { gameIds?: unknown };
    return new Set(Array.isArray(parsed.gameIds) ? parsed.gameIds.map(asString).filter(Boolean) as string[] : []);
  } catch {
    return new Set();
  }
}

async function writeStarredGameIds(starred: Set<string>) {
  await fs.mkdir(LATENCY_LOG_DIR, { recursive: true });
  await fs.writeFile(LATENCY_STARRED_FILE, `${JSON.stringify({ gameIds: [...starred].sort() }, null, 2)}\n`, "utf8");
}

function observeGameSample(game: GameAccumulator, sample: JsonObject, sampleKey: string, entry: LatencyLogEntry, payload: JsonObject | null) {
  const ts = getSampleTime(sample, entry, payload);
  const context = getSampleContext(sample, payload);
  const data = asRecord(sample.data) ?? {};
  const kind = asString(sample.kind) ?? "unknown";
  const userId = asString(context.userId) ?? asString(entry.user?.uid) ?? "unknown";
  const username = asString(context.username) ?? asString(entry.user?.username);

  observeTime(game, ts);
  game.sampleCount += 1;
  game.playerIds.add(userId);
  if (username) game.playerNames.set(userId, username);
  game.mode = game.mode ?? asString(context.gameMode);
  game.tournamentPhase = game.tournamentPhase ?? asString(context.tournamentPhase);

  if (kind === "ping") {
    const rttMs = nonNegativeNumber(data.rttMs);
    if (rttMs !== null) {
      game.rttValues.push(rttMs);
      game.latestRttMs = rttMs;
    }
  } else if (kind === "state-diff") {
    game.stateDiffCount += 1;
  } else if (kind === "movement") {
    game.movementCount += 1;
  } else if (kind === "http") {
    game.httpCount += 1;
  } else if (kind === "lifecycle") {
    game.lifecycleCount += 1;
  }

  const slowEvent = buildSlowEvent(sample, sampleKey, userId, ts);
  if (slowEvent) {
    game.slowEvents.push(slowEvent);
    game.slowEvents.sort((a, b) => b.at - a.at);
    game.slowEvents = game.slowEvents.slice(0, MAX_GAME_SLOW_EVENTS);
  }
}

function buildGameAccumulators(lines: ParsedLatencyLine[]): Map<string, GameAccumulator> {
  const games = new Map<string, GameAccumulator>();

  for (const line of lines) {
    if (!line.entry || !line.gameId) continue;
    const payload = getPayload(line.entry);
    const game = games.get(line.gameId) ?? createGameAccumulator(line.gameId);
    games.set(line.gameId, game);
    game.payloadBytes += asNumber(line.entry.payloadBytes) ?? 0;
    if (line.receivedAt !== null) observeTime(game, line.receivedAt);

    const payloadContext = getPayloadContext(payload);
    game.mode = game.mode ?? asString(payloadContext.gameMode);
    game.tournamentPhase = game.tournamentPhase ?? asString(payloadContext.tournamentPhase);
    const payloadUserId = asString(payloadContext.userId) ?? asString(line.entry.user?.uid);
    const payloadUsername = asString(payloadContext.username) ?? asString(line.entry.user?.username);
    if (payloadUserId) {
      game.playerIds.add(payloadUserId);
      if (payloadUsername) game.playerNames.set(payloadUserId, payloadUsername);
    }

    getSamples(payload).forEach((sample, sampleIndex) => {
      const sampleKey = asString(sample.sampleId) ?? `${line.fileName}:${line.lineIndex}:${sampleIndex}`;
      if (game.sampleIds.has(sampleKey)) return;
      game.sampleIds.add(sampleKey);
      observeGameSample(game, sample, sampleKey, line.entry!, payload);
    });
  }

  return games;
}

async function loadGameDocs(gameIds: string[]) {
  const validIds = [...new Set(gameIds.filter(isMongoId))];
  if (validIds.length === 0) return new Map<string, any>();
  const docs = await GameSession.find({ _id: { $in: validIds } }).lean().catch(() => [] as any[]);
  return new Map(docs.map((doc: any) => [String(doc._id), doc]));
}

function toEpoch(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return asNumber(value);
}

function summaryFromAccumulator(game: GameAccumulator, starred: Set<string>, doc?: any): NetworkSessionSummary {
  const playerNames: Record<string, string> = Object.fromEntries(game.playerNames.entries());
  if (doc?.playerNames && typeof doc.playerNames === "object") {
    for (const [userId, username] of Object.entries(doc.playerNames as Record<string, unknown>)) {
      if (typeof username === "string") playerNames[userId] = username;
    }
  }
  const docPlayers = Array.isArray(doc?.players) ? doc.players.map(String) : [];
  const playerIds = [...new Set([...docPlayers, ...game.playerIds])];
  const connectedClientCount = subscriptionManager.getGameClientCount(game.gameId);
  const connectedPlayerIds = playerIds.filter((userId) => subscriptionManager.isConnected(game.gameId, userId));
  const gameOver = typeof doc?.state?.gameOver === "boolean" ? doc.state.gameOver : null;
  const started = typeof doc?.started === "boolean" ? doc.started : null;
  const recordingActive = connectedPlayerIds.length > 0 && gameOver !== true;
  const recordingStoppedReason = started === true && gameOver !== true && playerIds.length >= 2 && connectedPlayerIds.length === 0
    ? "all-players-disconnected"
    : null;

  return {
    gameId: game.gameId,
    mode: asString(doc?.mode) ?? game.mode,
    started,
    gameOver,
    createdAt: toEpoch(doc?.createdAt),
    updatedAt: toEpoch(doc?.updatedAt),
    firstSeenAt: game.firstSeenAt,
    lastSeenAt: game.lastSeenAt ?? toEpoch(doc?.updatedAt),
    connectedClientCount,
    connectedPlayerIds,
    recordingActive,
    recordingStoppedReason,
    starred: starred.has(game.gameId),
    sampleCount: game.sampleCount,
    payloadBytes: game.payloadBytes,
    playerIds,
    playerNames,
    rtt: metricSummary(game.rttValues, game.latestRttMs),
    stateDiffCount: game.stateDiffCount,
    movementCount: game.movementCount,
    httpCount: game.httpCount,
    lifecycleCount: game.lifecycleCount,
    issueCount: game.slowEvents.length,
  };
}

function emptyAccumulatorForGame(gameId: string): GameAccumulator {
  return createGameAccumulator(gameId);
}

export async function getNetworkSessionSummaries() {
  const [lines, starred] = await Promise.all([readLatencyLines(), readStarredGameIds()]);
  const accumulators = buildGameAccumulators(lines);
  for (const gameId of starred) {
    if (!accumulators.has(gameId)) accumulators.set(gameId, emptyAccumulatorForGame(gameId));
  }

  const docs = await loadGameDocs([...accumulators.keys()]);
  const all = [...accumulators.values()]
    .map((game) => summaryFromAccumulator(game, starred, docs.get(game.gameId)))
    .sort((a, b) => (b.lastSeenAt ?? b.updatedAt ?? 0) - (a.lastSeenAt ?? a.updatedAt ?? 0));

  const starredSessions = all.filter((session) => session.starred);
  const recentSessions = all.filter((session) => !session.starred).slice(0, RECENT_UNSTARRED_LIMIT);

  return {
    recentLimit: RECENT_UNSTARRED_LIMIT,
    totalRecordedGames: all.length,
    starredGameIds: [...starred].sort(),
    sessions: [...starredSessions, ...recentSessions]
      .sort((a, b) => {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return (b.lastSeenAt ?? b.updatedAt ?? 0) - (a.lastSeenAt ?? a.updatedAt ?? 0);
      }),
  };
}

function observePlayerSample(player: PlayerAccumulator, sample: JsonObject, sampleKey: string, entry: LatencyLogEntry, payload: JsonObject | null) {
  const ts = getSampleTime(sample, entry, payload);
  const context = getSampleContext(sample, payload);
  const data = asRecord(sample.data) ?? {};
  const kind = asString(sample.kind) ?? "unknown";
  const sessionId = asString(sample.sessionId) ?? asString(asRecord(payload?.session)?.sessionId);
  const slowEvent = buildSlowEvent(sample, sampleKey, player.userId, ts);
  const timelineEntry = buildTimelineEntry(sample, sampleKey, ts, slowEvent);

  observeTime(player, ts);
  player.sampleCount += 1;
  if (sessionId) player.sessionIds.add(sessionId);
  player.username = player.username ?? asString(context.username) ?? asString(entry.user?.username);

  if (kind === "ping") {
    const rttMs = nonNegativeNumber(data.rttMs);
    if (rttMs !== null) {
      player.rttValues.push(rttMs);
      player.latestRttMs = rttMs;
    }
  } else if (kind === "state-diff") {
    const intervalMs = nonNegativeNumber(data.intervalMs);
    const receiveLagMs = nonNegativeNumber(data.receiveLagMs);
    if (intervalMs !== null) player.stateDiffIntervals.push(intervalMs);
    if (receiveLagMs !== null) player.stateDiffLags.push(receiveLagMs);
  } else if (kind === "movement") {
    const durationMs = nonNegativeNumber(data.durationMs);
    if (durationMs !== null) player.movementDurations.push(durationMs);
  } else if (kind === "http") {
    const durationMs = nonNegativeNumber(data.durationMs);
    if (durationMs !== null) player.httpDurations.push(durationMs);
  }

  if (slowEvent) {
    player.slowEvents.push(slowEvent);
  }

  if (timelineEntry) {
    if (kind === "lifecycle") player.lifecycleEvents.push(timelineEntry);
    const shouldKeepStateDiff = kind !== "state-diff"
      || slowEvent !== null
      || player.lastStateTimelineAt === null
      || ts - player.lastStateTimelineAt >= STATE_DIFF_TIMELINE_SAMPLE_MS;
    if (shouldKeepStateDiff) {
      player.timeline.push(timelineEntry);
      if (kind === "state-diff") player.lastStateTimelineAt = ts;
    }
  }
}

export async function getNetworkSessionDetail(gameId: string): Promise<NetworkSessionDetail | null> {
  const [lines, starred] = await Promise.all([readLatencyLines(), readStarredGameIds()]);
  const matchingLines = lines.filter((line) => line.gameId === gameId);
  const docs = await loadGameDocs([gameId]);
  const doc = docs.get(gameId);

  if (!doc && matchingLines.length === 0 && !starred.has(gameId)) return null;

  const gameAccumulator = buildGameAccumulators(matchingLines).get(gameId) ?? emptyAccumulatorForGame(gameId);
  const players = new Map<string, PlayerAccumulator>();
  const seenPlayerSamples = new Set<string>();

  for (const line of matchingLines) {
    if (!line.entry) continue;
    const payload = getPayload(line.entry);
    getSamples(payload).forEach((sample, sampleIndex) => {
      const sampleContext = getSampleContext(sample, payload);
      const userId = asString(sampleContext.userId) ?? asString(getPayloadContext(payload).userId) ?? asString(line.entry?.user?.uid) ?? "unknown";
      const username = asString(sampleContext.username) ?? asString(line.entry?.user?.username);
      const player = players.get(userId) ?? createPlayerAccumulator(userId, username);
      players.set(userId, player);
      const sampleKey = asString(sample.sampleId) ?? `${line.fileName}:${line.lineIndex}:${sampleIndex}`;
      const playerSampleKey = `${userId}:${sampleKey}`;
      if (seenPlayerSamples.has(playerSampleKey)) return;
      seenPlayerSamples.add(playerSampleKey);
      observePlayerSample(player, sample, sampleKey, line.entry!, payload);
    });
  }

  if (Array.isArray(doc?.players)) {
    for (const userId of doc.players.map(String)) {
      if (!players.has(userId)) {
        const username = typeof doc.playerNames?.[userId] === "string" ? doc.playerNames[userId] : null;
        players.set(userId, createPlayerAccumulator(userId, username));
      }
    }
  }

  const game = summaryFromAccumulator(gameAccumulator, starred, doc);
  const playerOrder = new Map(game.playerIds.map((userId, index) => [userId, index]));
  const playerReports = [...players.values()]
    .sort((a, b) => (playerOrder.get(a.userId) ?? 999) - (playerOrder.get(b.userId) ?? 999))
    .map((player) => {
      player.slowEvents.sort((a, b) => b.at - a.at);
      player.lifecycleEvents.sort((a, b) => b.at - a.at);
      player.timeline.sort((a, b) => a.at - b.at);
      const timelineTotal = player.timeline.length;
      return {
        userId: player.userId,
        username: player.username ?? game.playerNames[player.userId] ?? null,
        sessionIds: [...player.sessionIds],
        firstSeenAt: player.firstSeenAt,
        lastSeenAt: player.lastSeenAt,
        sampleCount: player.sampleCount,
        rtt: metricSummary(player.rttValues, player.latestRttMs),
        movement: metricSummary(player.movementDurations),
        http: metricSummary(player.httpDurations),
        stateDiffInterval: metricSummary(player.stateDiffIntervals),
        stateDiffLag: metricSummary(player.stateDiffLags),
        lifecycleEvents: player.lifecycleEvents.slice(0, 40),
        slowEvents: player.slowEvents.slice(0, MAX_PLAYER_SLOW_EVENTS),
        timeline: player.timeline.slice(Math.max(0, player.timeline.length - MAX_PLAYER_TIMELINE)),
        timelineTotal,
      };
    });

  return { game, players: playerReports };
}

export async function setNetworkSessionStar(gameId: string, starred: boolean) {
  const starredIds = await readStarredGameIds();
  if (starred) starredIds.add(gameId);
  else starredIds.delete(gameId);
  await writeStarredGameIds(starredIds);
  void pruneLatencyLogs().catch((err) => {
    console.error("[Diagnostics] Failed to prune latency logs after star change:", err instanceof Error ? err.message : String(err));
  });
  return { gameId, starred, starredGameIds: [...starredIds].sort() };
}

export async function pruneLatencyLogs() {
  const [lines, starred] = await Promise.all([readLatencyLines(), readStarredGameIds()]);
  const accumulators = buildGameAccumulators(lines);
  const recentUnstarred = [...accumulators.values()]
    .filter((game) => !starred.has(game.gameId))
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
    .slice(0, RECENT_UNSTARRED_LIMIT)
    .map((game) => game.gameId);
  const keepGameIds = new Set([...starred, ...recentUnstarred]);
  const byFile = new Map<string, ParsedLatencyLine[]>();
  let removedEntries = 0;

  for (const line of lines) {
    const bucket = byFile.get(line.fileName) ?? [];
    bucket.push(line);
    byFile.set(line.fileName, bucket);
  }

  for (const [fileName, fileLines] of byFile.entries()) {
    const kept: string[] = [];
    let changed = false;
    for (const line of fileLines) {
      if (!line.entry || !line.gameId || keepGameIds.has(line.gameId)) {
        kept.push(line.rawLine);
      } else {
        changed = true;
        removedEntries += 1;
      }
    }
    if (changed) {
      await fs.writeFile(path.join(LATENCY_LOG_DIR, fileName), kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
    }
  }

  return { keepGameIds: [...keepGameIds].sort(), removedEntries };
}