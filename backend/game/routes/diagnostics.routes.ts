import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  LATENCY_LOG_DIR,
  getNetworkSessionDetail,
  getNetworkSessionSummaries,
  pruneLatencyLogs,
  setNetworkSessionStar,
} from "../services/networkDiagnostics";
import { recordLagProbe, roundLagMs } from "../../utils/lagProbe";

const router = express.Router();

const MAX_REPORT_BYTES = 1_500_000;
const MAX_FRONTEND_LOG_BYTES = 1_000_000;
const MAX_LATENCY_BATCH_BYTES = 1_000_000;
const MAX_LATENCY_REPORT_BYTES = 1_800_000;
const MAX_STRING_LENGTH = 4_000;
const MAX_ARRAY_LENGTH = 120;
const MAX_OBJECT_KEYS = 160;
const CRASH_LOG_DIR = process.env.CLIENT_CRASH_LOG_DIR || path.resolve(process.cwd(), "../logs/client-crashes");
const FRONTEND_LOG_DIR = process.env.CLIENT_FRONTEND_LOG_DIR || path.resolve(process.cwd(), "../logs/frontend");
const SENSITIVE_KEY_RE = /(token|password|cookie|authorization|jwt|secret|auth|credential)/i;

function dayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function sanitizeString(value: string) {
  const redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer [redacted]")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .replace(/auth_token=([^;&\s]+)/gi, "auth_token=[redacted]");
  return redacted.length > MAX_STRING_LENGTH ? `${redacted.slice(0, MAX_STRING_LENGTH)}...` : redacted;
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (depth >= 7) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitize(entry, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : sanitize(entry, depth + 1, seen);
  }
  return out;
}

function getPayloadBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
}

async function appendJsonl(logDir: string, ts: number, entry: unknown) {
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${dayKey(ts)}.jsonl`);
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function matchesSessionEntry(entry: any, sessionId: string, gameId: string, userId: string) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.user?.uid && entry.user.uid !== userId) return false;

  const frontendLog = entry.frontendLog;
  if (frontendLog && typeof frontendLog === "object") {
    return frontendLog.sessionId === sessionId && frontendLog.context?.gameId === gameId;
  }

  const report = entry.report;
  if (report && typeof report === "object") {
    return report.session?.sessionId === sessionId && report.context?.gameId === gameId;
  }

  return false;
}

async function removeSessionEntriesFromDir(logDir: string, sessionId: string, gameId: string, userId: string) {
  await fs.mkdir(logDir, { recursive: true });
  const files = await fs.readdir(logDir).catch(() => [] as string[]);
  let filesTouched = 0;
  let entriesRemoved = 0;

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const logPath = path.join(logDir, file);
    const raw = await fs.readFile(logPath, "utf8").catch(() => "");
    if (!raw) continue;

    const kept: string[] = [];
    let removedInFile = 0;
    for (const line of raw.split(/\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        kept.push(line);
        continue;
      }

      if (matchesSessionEntry(parsed, sessionId, gameId, userId)) {
        removedInFile += 1;
      } else {
        kept.push(line);
      }
    }

    if (removedInFile > 0) {
      filesTouched += 1;
      entriesRemoved += removedInFile;
      await fs.writeFile(logPath, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
    }
  }

  return { filesTouched, entriesRemoved };
}

router.post("/client-crash-report", async (req, res) => {
  try {
    const payloadBytes = getPayloadBytes(req.body);
    if (payloadBytes > MAX_REPORT_BYTES) {
      return res.status(413).json({ error: "ERR_REPORT_TOO_LARGE", maxBytes: MAX_REPORT_BYTES });
    }

    const receivedAt = Date.now();
    const reportId = crypto.randomUUID();
    const entry = {
      reportId,
      receivedAt,
      receivedAtIso: new Date(receivedAt).toISOString(),
      payloadBytes,
      user: req.auth ? {
        uid: req.auth.uid,
        username: req.auth.username,
      } : null,
      request: {
        userAgent: sanitizeString(req.get("user-agent") ?? ""),
        origin: sanitizeString(req.get("origin") ?? ""),
        referer: sanitizeString(req.get("referer") ?? ""),
      },
      report: sanitize(req.body),
    };

    await appendJsonl(CRASH_LOG_DIR, receivedAt, entry);

    res.json({ ok: true, reportId, receivedAt });
  } catch (err) {
    console.error("[Diagnostics] Failed to write client crash report:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_CLIENT_CRASH_REPORT_WRITE_FAILED" });
  }
});

router.post("/client-frontend-log", async (req, res) => {
  try {
    const payloadBytes = getPayloadBytes(req.body);
    if (payloadBytes > MAX_FRONTEND_LOG_BYTES) {
      return res.status(413).json({ error: "ERR_FRONTEND_LOG_TOO_LARGE", maxBytes: MAX_FRONTEND_LOG_BYTES });
    }

    const receivedAt = Date.now();
    const logBatchId = crypto.randomUUID();
    const entry = {
      logBatchId,
      receivedAt,
      receivedAtIso: new Date(receivedAt).toISOString(),
      payloadBytes,
      user: req.auth ? {
        uid: req.auth.uid,
        username: req.auth.username,
      } : null,
      request: {
        userAgent: sanitizeString(req.get("user-agent") ?? ""),
        origin: sanitizeString(req.get("origin") ?? ""),
        referer: sanitizeString(req.get("referer") ?? ""),
      },
      frontendLog: sanitize(req.body),
    };

    await appendJsonl(FRONTEND_LOG_DIR, receivedAt, entry);

    res.json({ ok: true, logBatchId, receivedAt });
  } catch (err) {
    console.error("[Diagnostics] Failed to write frontend log batch:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_FRONTEND_LOG_WRITE_FAILED" });
  }
});

router.post("/client-latency-batch", async (req, res) => {
  const handlerStartedAt = performance.now();
  try {
    const payloadBytes = getPayloadBytes(req.body);
    if (payloadBytes > MAX_LATENCY_BATCH_BYTES) {
      return res.status(413).json({ error: "ERR_LATENCY_BATCH_TOO_LARGE", maxBytes: MAX_LATENCY_BATCH_BYTES });
    }

    const receivedAt = Date.now();
    const latencyBatchId = crypto.randomUUID();
    const entry = {
      latencyBatchId,
      receivedAt,
      receivedAtIso: new Date(receivedAt).toISOString(),
      payloadBytes,
      user: req.auth ? {
        uid: req.auth.uid,
        username: req.auth.username,
      } : null,
      request: {
        userAgent: sanitizeString(req.get("user-agent") ?? ""),
        origin: sanitizeString(req.get("origin") ?? ""),
        referer: sanitizeString(req.get("referer") ?? ""),
      },
      latencyBatch: sanitize(req.body),
    };

    const writeStartedAt = performance.now();
    await appendJsonl(LATENCY_LOG_DIR, receivedAt, entry);
    const writeMs = performance.now() - writeStartedAt;
    void pruneLatencyLogs().catch((err) => {
      console.error("[Diagnostics] Failed to prune latency logs:", err instanceof Error ? err.message : String(err));
    });

    const totalMs = performance.now() - handlerStartedAt;
    const sampleCount = Array.isArray((req.body as any)?.samples) ? (req.body as any).samples.length : null;
    if (totalMs >= 100 || writeMs >= 60 || payloadBytes >= 250_000) {
      recordLagProbe("diagnostics-latency-batch", {
        latencyBatchId,
        payloadBytes,
        sampleCount,
        writeMs: roundLagMs(writeMs),
        totalMs: roundLagMs(totalMs),
        userId: req.auth?.uid ?? null,
      });
    }

    res.json({ ok: true, latencyBatchId, receivedAt });
  } catch (err) {
    console.error("[Diagnostics] Failed to write latency batch:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_CLIENT_LATENCY_BATCH_WRITE_FAILED" });
  }
});

router.post("/client-latency-report", async (req, res) => {
  try {
    const payloadBytes = getPayloadBytes(req.body);
    if (payloadBytes > MAX_LATENCY_REPORT_BYTES) {
      return res.status(413).json({ error: "ERR_LATENCY_REPORT_TOO_LARGE", maxBytes: MAX_LATENCY_REPORT_BYTES });
    }

    const receivedAt = Date.now();
    const latencyReportId = crypto.randomUUID();
    const entry = {
      latencyReportId,
      receivedAt,
      receivedAtIso: new Date(receivedAt).toISOString(),
      payloadBytes,
      user: req.auth ? {
        uid: req.auth.uid,
        username: req.auth.username,
      } : null,
      request: {
        userAgent: sanitizeString(req.get("user-agent") ?? ""),
        origin: sanitizeString(req.get("origin") ?? ""),
        referer: sanitizeString(req.get("referer") ?? ""),
      },
      latencyReport: sanitize(req.body),
    };

    await appendJsonl(LATENCY_LOG_DIR, receivedAt, entry);
    void pruneLatencyLogs().catch((err) => {
      console.error("[Diagnostics] Failed to prune latency logs:", err instanceof Error ? err.message : String(err));
    });

    res.json({ ok: true, latencyReportId, receivedAt });
  } catch (err) {
    console.error("[Diagnostics] Failed to write latency report:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_CLIENT_LATENCY_REPORT_WRITE_FAILED" });
  }
});

router.get("/network-sessions", async (_req, res) => {
  try {
    res.json(await getNetworkSessionSummaries());
  } catch (err) {
    console.error("[Diagnostics] Failed to read network sessions:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_NETWORK_DIAGNOSTICS_READ_FAILED" });
  }
});

router.get("/network-sessions/:gameId", async (req, res) => {
  try {
    const gameId = String(req.params.gameId ?? "").trim();
    if (!gameId) return res.status(400).json({ error: "ERR_INVALID_GAME_ID" });

    const detail = await getNetworkSessionDetail(gameId);
    if (!detail) return res.status(404).json({ error: "ERR_NETWORK_SESSION_NOT_FOUND" });
    res.json(detail);
  } catch (err) {
    console.error("[Diagnostics] Failed to read network session detail:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_NETWORK_DIAGNOSTICS_DETAIL_FAILED" });
  }
});

router.post("/network-sessions/:gameId/star", async (req, res) => {
  try {
    const gameId = String(req.params.gameId ?? "").trim();
    if (!gameId) return res.status(400).json({ error: "ERR_INVALID_GAME_ID" });
    const starred = req.body?.starred !== false;
    res.json({ ok: true, ...(await setNetworkSessionStar(gameId, starred)) });
  } catch (err) {
    console.error("[Diagnostics] Failed to update network session star:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_NETWORK_DIAGNOSTICS_STAR_FAILED" });
  }
});

router.post("/client-session-clean-exit", async (req, res) => {
  try {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
    const gameId = typeof req.body?.gameId === "string" ? req.body.gameId.trim() : "";
    const reason = typeof req.body?.reason === "string" ? sanitizeString(req.body.reason.trim()) : "";
    const userId = req.auth?.uid;

    if (!sessionId || !gameId || !userId) {
      return res.status(400).json({ error: "ERR_INVALID_SESSION_CLEAN_EXIT" });
    }

    const [crashResult, frontendResult] = await Promise.all([
      removeSessionEntriesFromDir(CRASH_LOG_DIR, sessionId, gameId, userId),
      removeSessionEntriesFromDir(FRONTEND_LOG_DIR, sessionId, gameId, userId),
    ]);

    console.log("[Diagnostics] Cleared normal client session logs", {
      userId,
      gameId,
      sessionId,
      reason,
      crashEntriesRemoved: crashResult.entriesRemoved,
      frontendEntriesRemoved: frontendResult.entriesRemoved,
    });

    res.json({ ok: true, crash: crashResult, frontend: frontendResult });
  } catch (err) {
    console.error("[Diagnostics] Failed to clear normal client session logs:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "ERR_CLIENT_SESSION_CLEAN_EXIT_FAILED" });
  }
});

export default router;
