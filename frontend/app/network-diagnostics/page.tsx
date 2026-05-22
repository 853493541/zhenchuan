"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, RefreshCw, Search, Star, Wifi } from "lucide-react";
import styles from "./page.module.css";

type MetricSummary = {
  count: number;
  latest: number | null;
  avg: number | null;
  p95: number | null;
  max: number | null;
};

type NetworkSessionSummary = {
  gameId: string;
  mode: string | null;
  started: boolean | null;
  gameOver: boolean | null;
  createdAt: number | null;
  updatedAt: number | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
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

type PlayerReport = {
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
};

type SessionsResponse = {
  recentLimit: number;
  totalRecordedGames: number;
  starredGameIds: string[];
  sessions: NetworkSessionSummary[];
};

type DetailResponse = {
  game: NetworkSessionSummary;
  players: PlayerReport[];
};

type DiagnosisSeverity = "good" | "warn" | "bad" | "neutral";

type QuickDiagnosisItem = {
  id: string;
  severity: DiagnosisSeverity;
  confidence?: "高" | "中" | "低";
  area: string;
  target: string;
  evidence: string;
  suggestion: string;
};

type QuickDiagnosis = {
  baseline: PlayerReport | null;
  baselineName: string;
  headline: string;
  severity: DiagnosisSeverity;
  items: QuickDiagnosisItem[];
};

const MODE_LABELS: Record<string, string> = {
  "collision-test": "玉门关",
  pubg: "吃鸡",
  arena: "竞技场",
};

const DETAIL_LABELS: Record<string, string> = {
  seq: "序号",
  rttMs: "RTT",
  c2sMs: "上行估计",
  s2cMs: "下行估计",
  serverMs: "服务器",
  version: "版本",
  diffCount: "变更",
  payloadBytes: "大小",
  intervalMs: "间隔",
  receiveLagMs: "到达估计",
  status: "状态",
  accepted: "接受",
  durationMs: "耗时",
  jump: "跳跃",
  operation: "操作",
  type: "类型",
};

function shortId(gameId: string) {
  return gameId.slice(-6);
}

function formatMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function formatCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return value.toLocaleString("zh-CN");
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 0.001 && value > 0) return "<0.1%";
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatTime(value: number | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return `${date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
}

function formatDetailValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") {
    if (key.endsWith("Ms") || key === "serverMs") return formatMs(value);
    if (key === "payloadBytes") return formatBytes(value);
    return formatCount(value);
  }
  return String(value);
}

function playerName(summary: NetworkSessionSummary | null | undefined, userId: string, fallback?: string | null) {
  return fallback || summary?.playerNames?.[userId] || `玩家 ${userId.slice(-4)}`;
}

function toneForMs(value: number | null | undefined, warn: number, bad: number) {
  if (typeof value !== "number") return "neutral";
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "good";
}

function toneForRate(value: number | null | undefined, warn: number, bad: number) {
  if (typeof value !== "number") return "neutral";
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "good";
}

function metricPoint(metric: MetricSummary) {
  return metric.p95 ?? metric.avg ?? metric.latest ?? null;
}

function metricTypicalPoint(metric: MetricSummary) {
  return metric.avg ?? metric.p95 ?? metric.latest ?? null;
}

function playerDisplayName(summary: NetworkSessionSummary, player: PlayerReport) {
  return playerName(summary, player.userId, player.username);
}

function compareMs(value: number | null, baseline: number | null, baselineName: string) {
  if (value === null) return "无样本";
  if (baseline === null) return formatMs(value);
  const delta = value - baseline;
  if (delta > 0) return `${formatMs(value)}，比 ${baselineName} 高 ${formatMs(delta)}`;
  return `${formatMs(value)}，不高于 ${baselineName}`;
}

function severityRank(severity: DiagnosisSeverity) {
  if (severity === "bad") return 3;
  if (severity === "warn") return 2;
  if (severity === "good") return 1;
  return 0;
}

function metricIssueSeverity(value: number | null, baseline: number | null, warnAbs: number, badAbs: number, warnDelta: number, badDelta: number): DiagnosisSeverity | null {
  if (value === null) return null;
  const delta = baseline === null ? null : value - baseline;
  if (value >= badAbs || (delta !== null && delta >= badDelta)) return "bad";
  if (value >= warnAbs || (delta !== null && delta >= warnDelta)) return "warn";
  return null;
}

function relativeIssueSeverity(value: number | null, baseline: number | null, warnAbs: number, badAbs: number, warnDelta: number, badDelta: number): DiagnosisSeverity | null {
  if (value === null) return null;
  if (baseline === null) return metricIssueSeverity(value, null, warnAbs, badAbs, warnDelta, badDelta);
  const delta = value - baseline;
  if (value < warnAbs) return null;
  if (delta >= badDelta) return "bad";
  if (delta >= warnDelta) return "warn";
  return null;
}

function sustainedRttSeverity(player: PlayerReport, baseline: PlayerReport | null): DiagnosisSeverity | null {
  const avg = player.rtt.avg;
  const p95 = player.rtt.p95;
  const latest = player.rtt.latest;
  const baselineAvg = baseline?.rtt.avg ?? null;
  const avgDelta = avg !== null && baselineAvg !== null ? avg - baselineAvg : null;

  if ((avg !== null && avg >= 260) || (avg !== null && p95 !== null && avg >= 180 && p95 >= 420) || (avgDelta !== null && avgDelta >= 180 && avg >= 220)) return "bad";
  if ((avg !== null && avg >= 180) || (avg !== null && p95 !== null && avg >= 140 && p95 >= 300) || (avgDelta !== null && avgDelta >= 110 && avg >= 160) || (latest !== null && latest >= 260 && avg !== null && avg >= 150)) return "warn";
  return null;
}

function jitterObservation(player: PlayerReport, baseline: PlayerReport | null): QuickDiagnosisItem | null {
  const p95 = player.rtt.p95;
  const avg = player.rtt.avg;
  const latest = player.rtt.latest;
  const baselineP95 = baseline?.rtt.p95 ?? null;
  const p95Delta = p95 !== null && baselineP95 !== null ? p95 - baselineP95 : null;
  if (p95 === null) return null;
  const hasTailSpike = (p95Delta !== null && p95Delta >= 90) || p95 >= 220;
  const looksStable = (avg === null || avg < 160) && (latest === null || latest < 220);
  if (!hasTailSpike || !looksStable) return null;
  return {
    id: `${player.userId}-rtt-observation`,
    severity: "neutral",
    confidence: "低",
    area: "偶发波动",
    target: player.username ?? player.userId.slice(-4),
    evidence: `RTT P95 ${formatMs(p95)}，平均 ${formatMs(avg)}，最新 ${formatMs(latest)}`,
    suggestion: "这类尾部采样不直接判定为网络差；只有平均延迟、状态间隔或移动确认也一起变差时，才优先查玩家线路。",
  };
}

function playerHealthScore(player: PlayerReport) {
  const rtt = metricPoint(player.rtt) ?? 800;
  const stateLag = metricPoint(player.stateDiffInterval) ?? 500;
  const movement = metricTypicalPoint(player.movement) ?? 600;
  const http = metricTypicalPoint(player.http) ?? 500;
  const slowRate = player.sampleCount > 0 ? (player.slowEvents.length / player.sampleCount) * 1000 : 80;
  return rtt * 1.2 + stateLag * 0.9 + movement * 0.45 + http * 0.25 + slowRate * 2;
}

function chooseBaselinePlayer(players: PlayerReport[], summary: NetworkSessionSummary) {
  const catcake = players.find((player) => playerDisplayName(summary, player).toLowerCase().includes("catcake") && player.sampleCount > 0);
  if (catcake) return catcake;
  return [...players].filter((player) => player.sampleCount > 0).sort((a, b) => playerHealthScore(a) - playerHealthScore(b))[0] ?? players[0] ?? null;
}

function summarizeSlowEvents(events: SlowEvent[], matcher: (event: SlowEvent) => boolean) {
  const matched = events.filter(matcher);
  if (matched.length === 0) return null;
  return {
    count: matched.length,
    max: Math.max(...matched.map((event) => event.metricMs)),
    severity: matched.some((event) => event.severity === "bad") ? "bad" as DiagnosisSeverity : "warn" as DiagnosisSeverity,
  };
}

function pushIssue(items: QuickDiagnosisItem[], item: QuickDiagnosisItem | null) {
  if (item) items.push(item);
}

function buildQuickDiagnosis(detail: DetailResponse, summary: NetworkSessionSummary): QuickDiagnosis {
  const baseline = chooseBaselinePlayer(detail.players, summary);
  const baselineName = baseline ? playerDisplayName(summary, baseline) : "无基准";
  const items: QuickDiagnosisItem[] = [];

  if (!baseline) {
    return { baseline: null, baselineName, headline: "暂无可诊断样本", severity: "neutral", items: [] };
  }

  const baselineRtt = metricPoint(baseline.rtt);
  const baselineStateLag = metricPoint(baseline.stateDiffInterval);
  const baselineStateInterval = metricPoint(baseline.stateDiffInterval);
  const baselineMovement = metricTypicalPoint(baseline.movement);
  const baselineHttp = metricTypicalPoint(baseline.http);

  const baselineRttSeverity = sustainedRttSeverity(baseline, null);
  pushIssue(items, baselineRttSeverity ? {
    id: "baseline-rtt",
    severity: baselineRttSeverity,
    confidence: "中",
    area: "基准延迟",
    target: baselineName,
    evidence: `基准 RTT 平均 ${formatMs(baseline.rtt.avg)}，P95 ${formatMs(baselineRtt)}`,
    suggestion: "连基准玩家 RTT 都高时，先查服务器区域、跨境线路、DNS/代理和机房出口，不要先改战斗代码。",
  } : null);

  pushIssue(items, metricIssueSeverity(baselineMovement, null, 350, 700, 0, 0) ? {
    id: "baseline-movement",
    severity: metricIssueSeverity(baselineMovement, null, 350, 700, 0, 0)!,
    confidence: "高",
    area: "移动确认",
    target: "全局",
    evidence: `${baselineName} 移动确认平均 ${formatMs(baselineMovement)}`,
    suggestion: "基准也慢时，优先查 /movement HTTP 链路、nginx 到 backend、GameLoop 移动/碰撞处理和服务器 CPU。",
  } : null);

  pushIssue(items, metricIssueSeverity(baselineStateInterval, null, 180, 350, 0, 0) ? {
    id: "baseline-state-interval",
    severity: metricIssueSeverity(baselineStateInterval, null, 180, 350, 0, 0)!,
    confidence: "高",
    area: "状态广播",
    target: "全局",
    evidence: `${baselineName} 状态包间隔 P95 ${formatMs(baselineStateInterval)}`,
    suggestion: "基准玩家状态包间隔也高时，优先查后端广播频率、tick 负载、diff 生成和 WebSocket 发送队列。",
  } : null);

  for (const player of detail.players) {
    if (player.userId === baseline.userId || player.sampleCount === 0) continue;
    const name = playerDisplayName(summary, player);
    const rtt = metricPoint(player.rtt);
    const stateLag = metricPoint(player.stateDiffInterval);
    const movement = metricTypicalPoint(player.movement);
    const http = metricTypicalPoint(player.http);
    const rttSeverity = sustainedRttSeverity(player, baseline);
    const stateSeverity = relativeIssueSeverity(stateLag, baselineStateLag, 130, 280, 80, 180);
    const movementSeverity = relativeIssueSeverity(movement, baselineMovement, 350, 700, 120, 260);
    const httpSeverity = relativeIssueSeverity(http, baselineHttp, 350, 700, 160, 350);
    const server = summarizeSlowEvents(player.slowEvents, (event) => event.label.includes("服务器处理"));

    pushIssue(items, rttSeverity ? {
      id: `${player.userId}-rtt`,
      severity: rttSeverity,
      confidence: stateSeverity || movementSeverity ? "高" : "中",
      area: "延迟过高",
      target: name,
      evidence: `RTT 平均 ${formatMs(player.rtt.avg)}，P95 ${compareMs(rtt, baselineRtt, baselineName)}`,
      suggestion: stateSeverity || movementSeverity ? "延迟和实际同步/输入指标一起变差，才优先查玩家本地网络、Wi-Fi、运营商线路或加速器路径。" : "只有 RTT 变高时先当作中等可信信号，继续看实感和状态/移动指标，不要单靠 P95 定责。",
    } : null);

    if (!rttSeverity) pushIssue(items, jitterObservation({ ...player, username: name }, baseline));

    pushIssue(items, stateSeverity ? {
      id: `${player.userId}-state`,
      severity: stateSeverity,
      confidence: "高",
      area: "状态同步",
      target: name,
      evidence: `状态包间隔 P95 ${compareMs(stateLag, baselineStateLag, baselineName)}`,
      suggestion: rttSeverity ? "状态同步慢并且 RTT 也高，先按网络路径问题处理。" : "RTT 不明显高但状态同步慢时，查 WebSocket 接收、客户端主线程解析、diff 大小和浏览器卡顿。",
    } : null);

    pushIssue(items, movementSeverity ? {
      id: `${player.userId}-movement`,
      severity: movementSeverity,
      confidence: "高",
      area: "移动确认",
      target: name,
      evidence: `移动平均 ${compareMs(movement, baselineMovement, baselineName)}`,
      suggestion: rttSeverity ? "移动确认跟 RTT 一起慢，优先修网络路径。" : "RTT 正常但移动确认慢，查 /movement 请求、nginx 代理、backend movement route 和碰撞计算。",
    } : null);

    pushIssue(items, httpSeverity && (stateSeverity || movementSeverity) ? {
      id: `${player.userId}-http`,
      severity: httpSeverity,
      confidence: "高",
      area: "操作请求",
      target: name,
      evidence: `HTTP 平均 ${compareMs(http, baselineHttp, baselineName)}`,
      suggestion: "HTTP 和实际同步/输入一起慢时，查该操作接口、nginx upstream、backend route、数据库/缓存访问和客户端请求排队。",
    } : httpSeverity ? {
      id: `${player.userId}-http-observation`,
      severity: "neutral",
      confidence: "低",
      area: "接口观察",
      target: name,
      evidence: `HTTP 平均 ${compareMs(http, baselineHttp, baselineName)}`,
      suggestion: "这可能来自加载、snapshot、auth 或冷启动请求；状态同步和移动确认正常时，不把它当作实时战斗卡顿。",
    } : null);

    pushIssue(items, server && server.count >= 2 ? {
      id: `${player.userId}-server`,
      severity: server.severity,
      confidence: "高",
      area: "服务器处理",
      target: "backend",
      evidence: `${name} 触发 ${server.count} 次服务器处理慢，最高 ${formatMs(server.max)}`,
      suggestion: "这是服务端方向的信号，优先查对应 route、GameLoop、碰撞/技能逻辑和进程 CPU，而不是玩家网络。",
    } : null);
  }

  const compactItems = items
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 6);
  const severity = compactItems[0]?.severity ?? "good";
  const headline = severity === "bad"
    ? "有明确瓶颈，先处理红色项"
    : severity === "warn"
      ? "有波动，先看黄色项"
      : "未发现明显瓶颈";

  return { baseline, baselineName, headline, severity, items: compactItems };
}

export default function NetworkDiagnosticsPage() {
  const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [gameIdInput, setGameIdInput] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSummary = useMemo(() => {
    if (!selectedGameId) return null;
    return detail?.game ?? sessionsData?.sessions.find((session) => session.gameId === selectedGameId) ?? null;
  }, [detail?.game, selectedGameId, sessionsData?.sessions]);

  const selectedPlayer = useMemo(() => {
    if (!detail) return null;
    return detail.players.find((player) => player.userId === selectedPlayerId) ?? detail.players[0] ?? null;
  }, [detail, selectedPlayerId]);

  const fetchSessions = useCallback(async (keepSelection = true) => {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/diagnostics/network-sessions", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as SessionsResponse;
      setSessionsData(data);
      setError(null);
      if (!keepSelection || !selectedGameId || !data.sessions.some((session) => session.gameId === selectedGameId)) {
        setSelectedGameId(data.sessions[0]?.gameId ?? selectedGameId ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSessions(false);
    }
  }, [selectedGameId]);

  const fetchDetail = useCallback(async (gameId: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/diagnostics/network-sessions/${encodeURIComponent(gameId)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as DetailResponse;
      setDetail(data);
      setSelectedPlayerId((prev) => data.players.some((player) => player.userId === prev) ? prev : data.players[0]?.userId ?? null);
      setError(null);
    } catch (err) {
      setDetail(null);
      setSelectedPlayerId(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions(false);
    const timer = window.setInterval(() => void fetchSessions(true), 30_000);
    return () => window.clearInterval(timer);
  }, [fetchSessions]);

  useEffect(() => {
    if (!selectedGameId) return;
    void fetchDetail(selectedGameId);
  }, [fetchDetail, selectedGameId]);

  const toggleStar = useCallback(async (session: NetworkSessionSummary) => {
    const nextStarred = !session.starred;
    const res = await fetch(`/api/diagnostics/network-sessions/${encodeURIComponent(session.gameId)}/star`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ starred: nextStarred }),
    });
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    setDetail((prev) => prev && prev.game.gameId === session.gameId ? { ...prev, game: { ...prev.game, starred: nextStarred } } : prev);
    await fetchSessions(true);
  }, [fetchSessions]);

  const loadTypedGame = useCallback(() => {
    const gameId = gameIdInput.trim();
    if (!gameId) return;
    setSelectedGameId(gameId);
  }, [gameIdInput]);

  return (
    <main className={styles.page}>
      <section className={styles.topBar}>
        <Link className={styles.backLink} href="/">返回大厅</Link>
        <div className={styles.actions}>
          <div className={styles.searchBox}>
            <Search size={16} aria-hidden="true" />
            <input
              value={gameIdInput}
              onChange={(event) => setGameIdInput(event.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadTypedGame();
              }}
              placeholder="Game ID"
              inputMode="text"
            />
            <button type="button" onClick={loadTypedGame}>打开</button>
          </div>
          <button type="button" className={styles.iconButton} onClick={() => void fetchSessions(true)} disabled={loadingSessions} aria-label="刷新">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className={styles.header}>
        <div>
          <h1>网络诊断</h1>
          <div className={styles.headerStats}>
            <span>保留 {sessionsData?.recentLimit ?? 5} 场最近记录</span>
            <span>{sessionsData?.starredGameIds.length ?? 0} 场已标星</span>
            <span>{sessionsData?.totalRecordedGames ?? 0} 场可读记录</span>
          </div>
        </div>
      </section>

      {error && <div className={styles.errorLine}>{error}</div>}

      <section className={styles.layout}>
        <aside className={styles.sessionRail}>
          <div className={styles.railTitle}>游戏</div>
          {sessionsData?.sessions.length === 0 && <div className={styles.emptyState}>暂无网络记录</div>}
          {sessionsData?.sessions.map((session) => {
            const active = session.gameId === selectedGameId;
            const rttTone = toneForMs(session.rtt.p95 ?? session.rtt.avg, 220, 400);
            const issueRate = session.sampleCount > 0 ? session.issueCount / session.sampleCount : 0;
            return (
              <button
                key={session.gameId}
                type="button"
                className={`${styles.sessionCard} ${active ? styles.sessionCardActive : ""}`}
                onClick={() => setSelectedGameId(session.gameId)}
              >
                <span className={styles.sessionTopLine}>
                  <strong>#{shortId(session.gameId)}</strong>
                  <span className={styles.modeBadge}>{MODE_LABELS[session.mode ?? ""] ?? session.mode ?? "未知"}</span>
                  {session.starred && <Star size={13} fill="currentColor" aria-hidden="true" />}
                </span>
                <span className={styles.sessionPlayers}>{session.playerIds.map((id) => playerName(session, id)).join(" / ") || "无玩家记录"}</span>
                <span className={styles.sessionMetrics}>
                  <span data-tone={rttTone}>P95 {formatMs(session.rtt.p95)}</span>
                  <span>{formatCount(session.sampleCount)} 样本</span>
                  <span data-tone={toneForRate(issueRate, 0.05, 0.12)}>{formatPercent(issueRate)} 异常</span>
                </span>
                <span className={styles.sessionTime}>{formatTime(session.lastSeenAt ?? session.updatedAt)}</span>
              </button>
            );
          })}
        </aside>

        <section className={styles.reportPane}>
          {!selectedSummary && !loadingDetail && <div className={styles.emptyState}>选择一场游戏查看连接记录</div>}
          {selectedSummary && (
            <>
              <div className={styles.reportHeader}>
                <div>
                  <div className={styles.reportKicker}>#{selectedSummary.gameId}</div>
                  <h2>{MODE_LABELS[selectedSummary.mode ?? ""] ?? selectedSummary.mode ?? "网络记录"}</h2>
                  <div className={styles.reportSubline}>
                    <span>{formatTime(selectedSummary.firstSeenAt ?? selectedSummary.createdAt)}</span>
                    <span>{selectedSummary.gameOver ? "已结束" : selectedSummary.started ? "战斗中" : "未开始"}</span>
                    <span>{formatBytes(selectedSummary.payloadBytes)}</span>
                  </div>
                </div>
                <button type="button" className={`${styles.starButton} ${selectedSummary.starred ? styles.starButtonActive : ""}`} onClick={() => void toggleStar(selectedSummary)}>
                  <Star size={16} fill={selectedSummary.starred ? "currentColor" : "none"} aria-hidden="true" />
                  <span>{selectedSummary.starred ? "已标星" : "标星"}</span>
                </button>
              </div>

              {loadingDetail && <div className={styles.emptyState}>读取中</div>}

              {detail && (
                <>
                  <QuickDiagnosisPanel detail={detail} summary={selectedSummary} />

                  <div className={styles.playerTabs} role="tablist" aria-label="玩家连接记录">
                    {detail.players.map((player) => {
                      const active = player.userId === selectedPlayer?.userId;
                      return (
                        <button
                          key={player.userId}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`${styles.playerTab} ${active ? styles.playerTabActive : ""}`}
                          onClick={() => setSelectedPlayerId(player.userId)}
                        >
                          <span>{playerName(selectedSummary, player.userId, player.username)}</span>
                          <strong>{formatMs(player.rtt.latest)}</strong>
                        </button>
                      );
                    })}
                  </div>

                  {selectedPlayer ? (
                    <PlayerReportView player={selectedPlayer} summary={selectedSummary} />
                  ) : (
                    <div className={styles.emptyState}>这场游戏还没有玩家网络样本</div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function QuickDiagnosisPanel({ detail, summary }: { detail: DetailResponse; summary: NetworkSessionSummary }) {
  const diagnosis = useMemo(() => buildQuickDiagnosis(detail, summary), [detail, summary]);
  const baseline = diagnosis.baseline;
  const baselineLine = baseline
    ? `基准 ${diagnosis.baselineName} · RTT 平均 ${formatMs(baseline.rtt.avg)} · 状态间隔 P95 ${formatMs(metricPoint(baseline.stateDiffInterval))} · 移动均值 ${formatMs(metricTypicalPoint(baseline.movement))}`
    : "暂无基准样本";

  return (
    <section className={styles.quickPanel}>
      <div className={styles.quickHeader}>
        <div>
          <h3>快速诊断</h3>
          <p>{baselineLine}</p>
        </div>
        <span className={styles.quickBadge} data-severity={diagnosis.severity}>{diagnosis.headline}</span>
      </div>

      {diagnosis.items.length === 0 ? (
        <div className={styles.quickClear}>本场主要指标接近基准，暂时没有需要优先处理的网络或服务端瓶颈。</div>
      ) : (
        <div className={styles.quickItems}>
          {diagnosis.items.map((item) => (
            <div key={item.id} className={styles.quickItem} data-severity={item.severity}>
              <div className={styles.quickItemTop}>
                <strong>{item.area}</strong>
                <span>{item.target}{item.confidence ? ` · 可信度${item.confidence}` : ""}</span>
              </div>
              <p>{item.evidence}</p>
              <em>{item.suggestion}</em>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerReportView({ player, summary }: { player: PlayerReport; summary: NetworkSessionSummary }) {
  const visibleSlowEvents = player.slowEvents.slice(0, 12);
  const visibleTimeline = player.timeline.slice(Math.max(0, player.timeline.length - 80));
  const anomalyRate = player.sampleCount > 0 ? player.slowEvents.length / player.sampleCount : 0;
  const cards = [
    { icon: Wifi, label: "RTT", value: formatMs(player.rtt.latest), meta: `平均 ${formatMs(player.rtt.avg)} · P95 ${formatMs(player.rtt.p95)}`, tone: toneForMs(player.rtt.p95 ?? player.rtt.avg, 220, 400) },
    { icon: Activity, label: "状态包", value: formatMs(player.stateDiffInterval.p95), meta: `平均间隔 ${formatMs(player.stateDiffInterval.avg)} · ${formatCount(player.stateDiffInterval.count)} 次`, tone: toneForMs(player.stateDiffInterval.p95 ?? player.stateDiffInterval.avg, 180, 350) },
    { icon: Clock3, label: "移动确认", value: formatMs(player.movement.avg), meta: `P95 ${formatMs(player.movement.p95)} · ${formatCount(player.movement.count)} 次`, tone: toneForMs(player.movement.p95 ?? player.movement.avg, 180, 350) },
    { icon: AlertTriangle, label: "异常样本", value: formatPercent(anomalyRate), meta: `${formatCount(player.slowEvents.length)} / ${formatCount(player.sampleCount)} 样本`, tone: toneForRate(anomalyRate, 0.05, 0.12) },
  ];

  return (
    <div className={styles.playerReport}>
      <div className={styles.metricGrid}>
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={styles.metricBox} data-tone={card.tone}>
              <Icon size={17} aria-hidden="true" />
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.meta}</small>
            </div>
          );
        })}
      </div>

      <section className={styles.sectionBlock}>
        <div className={styles.sectionHeader}>
          <h3>异常样本</h3>
          <span>{formatPercent(anomalyRate)} · {player.slowEvents.length} 条</span>
        </div>
        {player.slowEvents.length === 0 ? (
          <div className={styles.emptyState}>没有超过阈值的异常样本</div>
        ) : (
          <div className={styles.slowList}>
            {visibleSlowEvents.map((event) => (
              <div key={event.id} className={styles.slowRow} data-severity={event.severity}>
                <span>{formatTime(event.at)}</span>
                <strong>{event.label}</strong>
                <em>{event.metricLabel} {formatMs(event.metricMs)}</em>
                <DetailPills detail={event.detail} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <div className={styles.sectionHeader}>
          <h3>过程时间线</h3>
          <span>{formatCount(visibleTimeline.length)} / {formatCount(player.timelineTotal)}</span>
        </div>
        {player.timeline.length === 0 ? (
          <div className={styles.emptyState}>{summary.playerIds.includes(player.userId) ? "这名玩家还没有上传网络样本" : "无时间线"}</div>
        ) : (
          <div className={styles.timelineTable}>
            {visibleTimeline.map((entry) => (
              <div key={entry.id} className={styles.timelineRow} data-severity={entry.severity}>
                <span>{formatTime(entry.at)}</span>
                <strong>{entry.label}</strong>
                <em>{formatMs(entry.valueMs)}</em>
                <DetailPills detail={entry.detail} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DetailPills({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (entries.length === 0) return null;
  return (
    <span className={styles.detailPills}>
      {entries.map(([key, value]) => (
        <span key={key}>{DETAIL_LABELS[key] ?? key}: {formatDetailValue(key, value)}</span>
      ))}
    </span>
  );
}