import express from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDB } from "./db";

// 🔐 AUTH
import authRoutes from "./routes/authRoutes";
import { requireAuth } from "./middleware/requireAuth";

// GAME
import gameRoutes from "./game/routes/game.routes";
import diagnosticsRoutes from "./game/routes/diagnostics.routes";

const EXPORT_SCAN_DEPTH = 7;
const FULL_EXPORT_SCAN_CACHE_TTL_MS = 30_000;
const FULL_EXPORT_FILE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const FULL_EXPORT_LIST_CACHE_CONTROL = "no-cache";

type FullExportPackage = {
   packageName: string;
   name: string;
   createdAt: number;
   stats: Record<string, unknown>;
   packageRoot: string;
};

type FullExportListItem = {
   packageName: string;
   name: string;
   createdAt: number;
   stats: Record<string, unknown>;
};

type FullExportIndexCache = {
   expiresAt: number;
   roots: string[];
   exportsList: FullExportListItem[];
   packageByName: Map<string, FullExportPackage>;
};

let fullExportIndexCache: FullExportIndexCache | null = null;

function isDirectory(absPath: string): boolean {
   try {
      return fs.statSync(absPath).isDirectory();
   } catch {
      return false;
   }
}

function resolveExportRoots(): string[] {
   const raw =
      process.env.EXPORT_VIEWER_ROOTS ||
      process.env.FULL_EXPORTS_ROOTS ||
      process.env.FULL_EXPORT_ROOTS ||
      "";

   const envRoots = raw
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => path.resolve(s));

   const cwd = process.cwd();
   const defaults = [
      path.resolve(cwd, "public/game/exported-maps"),
      path.resolve(cwd, "frontend/public/game/exported-maps"),
      path.resolve(cwd, "frontend/public/game"),
      path.resolve(cwd, "frontend/public"),
      path.resolve(cwd, "../frontend/public/game/exported-maps"),
      path.resolve(cwd, "../frontend/public/game"),
      path.resolve(cwd, "../frontend/public"),
      path.resolve(cwd, ".."),
      path.resolve(cwd, "../../frontend/public/game/exported-maps"),
      path.resolve(path.join(os.homedir(), "Desktop", "JX3FullExports")),
   ];

   const out: string[] = [];
   const seen = new Set<string>();

   for (const candidate of [...envRoots, ...defaults]) {
      const abs = path.resolve(candidate);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (isDirectory(abs)) out.push(abs);
   }

   return out;
}

function readManifestPackage(packageRoot: string): FullExportPackage | null {
   const manifestPath = path.join(packageRoot, "manifest.json");
   const mapDataPath = path.join(packageRoot, "map-data");

   if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) return null;
   if (!isDirectory(mapDataPath)) return null;

   try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(raw);

      const packageName = String(manifest?.packageName || path.basename(packageRoot)).trim();
      if (!packageName) return null;

      const createdAtRaw = Number(manifest?.createdAt);
      const createdAt = Number.isFinite(createdAtRaw)
         ? createdAtRaw
         : fs.statSync(manifestPath).mtimeMs;

      const stats =
         manifest?.stats && typeof manifest.stats === "object" && !Array.isArray(manifest.stats)
            ? (manifest.stats as Record<string, unknown>)
            : {};

      return {
         packageName,
         name: String(manifest?.name || packageName),
         createdAt,
         stats,
         packageRoot,
      };
   } catch {
      return null;
   }
}

function scanRootPackages(root: string): FullExportPackage[] {
   const out: FullExportPackage[] = [];
   if (!isDirectory(root)) return out;

   const skipDirs = new Set([
      ".git",
      "node_modules",
      ".next",
      "dist",
      "build",
      "coverage",
      ".vscode",
      "test-results",
   ]);

   const stack: Array<{ dir: string; depth: number }> = [{
      dir: path.resolve(root),
      depth: 0,
   }];

   while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;

      const pkg = readManifestPackage(current.dir);
      if (pkg) {
         out.push(pkg);
         continue;
      }

      if (current.depth >= EXPORT_SCAN_DEPTH) continue;

      let entries: fs.Dirent[] = [];
      try {
         entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
         continue;
      }

      for (const entry of entries) {
         if (!entry.isDirectory()) continue;
         if (skipDirs.has(entry.name)) continue;
         stack.push({
            dir: path.join(current.dir, entry.name),
            depth: current.depth + 1,
         });
      }
   }

   return out;
}

function buildFullExportIndexCache(): FullExportIndexCache {
   const roots = resolveExportRoots();
   const found = roots.flatMap((root) => scanRootPackages(root));

   const byName = new Map<string, FullExportPackage>();
   for (const pkg of found) {
      const prev = byName.get(pkg.packageName);
      if (!prev || pkg.createdAt > prev.createdAt) {
         byName.set(pkg.packageName, pkg);
      }
   }

   const exportsList = [...byName.values()]
      .sort((a, b) => {
         if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
         return a.packageName.localeCompare(b.packageName, undefined, { sensitivity: "base" });
      })
      .map((pkg) => ({
         packageName: pkg.packageName,
         name: pkg.name,
         createdAt: pkg.createdAt,
         stats: pkg.stats,
      }));

   return {
      expiresAt: Date.now() + FULL_EXPORT_SCAN_CACHE_TTL_MS,
      roots,
      exportsList,
      packageByName: byName,
   };
}

function getFullExportIndexCache(forceRefresh = false): FullExportIndexCache {
   if (!forceRefresh && fullExportIndexCache && fullExportIndexCache.expiresAt > Date.now()) {
      return fullExportIndexCache;
   }

   fullExportIndexCache = buildFullExportIndexCache();
   return fullExportIndexCache;
}

function listFullExports() {
   const cache = getFullExportIndexCache();

   return {
      exports: cache.exportsList,
      roots: cache.roots,
   };
}

function decodePathPart(value: string): string | null {
   try {
      return decodeURIComponent(value);
   } catch {
      return null;
   }
}

function safePathUnder(root: string, relPath: string): string | null {
   const abs = path.resolve(path.join(root, relPath));
   if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
   return abs;
}

function resolvePackageByName(packageName: string): FullExportPackage | null {
   return getFullExportIndexCache().packageByName.get(packageName) ?? null;
}

function setFullExportListHeaders(res: express.Response) {
   res.setHeader("Cache-Control", FULL_EXPORT_LIST_CACHE_CONTROL);
   res.setHeader("Timing-Allow-Origin", "*");
}

function setFullExportFileHeaders(res: express.Response) {
   res.setHeader("Cache-Control", FULL_EXPORT_FILE_CACHE_CONTROL);
   res.setHeader("Timing-Allow-Origin", "*");
   res.setHeader("Vary", "Accept-Encoding");
}


const app = express();

console.log("📦 Creating Express app...");

/* =====================================================
   VERY EARLY REQUEST LOGGER (DISABLED - causes CPU load)
===================================================== */
// Disabled to reduce CPU/IO load during gameplay
// app.use((req, res, next) => {
//   if (req.path !== '/' && !req.path.includes('movement')) {
//     console.log(`[HTTP-In] ${req.method} ${req.path} from ${req.ip}`);
//   }
//   const originalSend = res.send;
//   res.send = function(data) {
//     const status = res.statusCode;
//     if (req.path !== '/' && !req.path.includes('movement')) {
//       const indicator = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '✅';
//       console.log(`[HTTP-Out] ${indicator} ${status} ${req.method} ${req.path}`);
//     }
//     return originalSend.call(this, data);
//   };
//   next();
// });

console.log("✅ Early request logger disabled (CPU optimization)");

/* =====================================================
   �📊 REQUEST LOGGER (disabled during movement spam)
===================================================== */
// Disabled to reduce log spam during movement commands
// app.use((req, res, next) => {
//   const start = Date.now();
//   const originalSend = res.send;
//   res.send = function(data) {
//     const duration = Date.now() - start;
//     const status = res.statusCode;
//     const indicator = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '✅';
//     console.log(`${indicator} [${status}] ${req.method} ${req.path} (${duration}ms)`);
//     return originalSend.call(this, data);
//   };
//   next();
// });

console.log("✅ Request logger disabled (movement spam)");

/* =====================================================
   🌐 CORS (for development)
===================================================== */

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

console.log("✅ Middleware loaded: json, cookieParser");

// CORS MUST come after body parsing but before routes
app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins in dev mode
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));

app.use(compression());

console.log("✅ CORS and compression configured");

function defaultErrorCodeForStatus(status: number): string {
   if (status === 401) return "ERR_NOT_AUTHENTICATED";
   if (status === 403) return "ERR_FORBIDDEN";
   if (status === 404) return "ERR_NOT_FOUND";
   if (status >= 500) return "ERR_INTERNAL";
   return "ERR_BAD_REQUEST";
}

function normalizeErrorCode(raw: unknown, status: number): string {
   const text = String(raw ?? "").trim();
   if (/^ERR_[A-Z0-9_]+$/.test(text)) return text;
   return defaultErrorCodeForStatus(status);
}

app.use((_req, res, next) => {
   const originalJson = res.json.bind(res);
   res.json = ((body?: any) => {
      if (
         res.statusCode >= 400 &&
         body &&
         typeof body === "object" &&
         !Array.isArray(body) &&
         "error" in body &&
         !("code" in body)
      ) {
         const message = typeof body.message === "string" ? body.message : String(body.error ?? "Request failed");
         return originalJson({
            ...body,
            code: normalizeErrorCode(body.error, res.statusCode),
            message,
         });
      }
      return originalJson(body);
   }) as typeof res.json;

   const originalSend = res.send.bind(res);
   res.send = ((body?: any) => {
      const contentType = String(res.getHeader("content-type") ?? "");
      if (res.statusCode >= 400 && typeof body === "string" && !contentType.includes("application/json")) {
         const code = normalizeErrorCode(body, res.statusCode);
         res.type("application/json");
         return originalSend(JSON.stringify({
            error: body,
            code,
            message: body,
         }));
      }
      return originalSend(body);
   }) as typeof res.send;

   next();
});

/* =====================================================
   🗄️ Database
===================================================== */

connectDB();

/* =====================================================
   🔓 PUBLIC ROUTES (NO LOGIN REQUIRED)
===================================================== */

console.log("🔓 Registering public routes...");

// Health check (keep public)
app.get("/", (_, res) => {
  res.send("✅ API is running (auth enabled)");
});

console.log("  ✓ GET /");

// Test CORS endpoint
app.get("/api/test-cors", (req, res) => {
  res.json({ message: "CORS works!", timestamp: new Date().toISOString() });
});

console.log("  ✓ GET /api/test-cors");

app.get("/api/full-exports", (_req, res) => {
   try {
      setFullExportListHeaders(res);
      res.json(listFullExports());
   } catch (err) {
      res.status(500).json({
         error: err instanceof Error ? err.message : String(err),
      });
   }
});

console.log("  ✓ GET /api/full-exports");

const serveFullExports: express.RequestHandler = (req, res, next) => {
   if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
   }

   // req.path here is relative to the mounted /full-exports prefix.
   const relPath = String(req.path || "/");
   if (relPath === "/list" || relPath === "/list/") {
      try {
         setFullExportListHeaders(res);
         res.json(listFullExports());
      } catch (err) {
         res.status(500).json({
            error: err instanceof Error ? err.message : String(err),
         });
      }
      return;
   }

   const trimmed = relPath.replace(/^\/+/, "");
   if (!trimmed) {
      res.status(404).json({ error: "Not found." });
      return;
   }

   const slash = trimmed.indexOf("/");
   if (slash < 0) {
      res.status(404).json({ error: "Not found." });
      return;
   }

   const packagePart = decodePathPart(trimmed.slice(0, slash));
   const relFilePart = decodePathPart(trimmed.slice(slash + 1));

   if (!packagePart || !relFilePart) {
      res.status(400).json({ error: "Invalid export path." });
      return;
   }

   const pkg = resolvePackageByName(packagePart);
   if (!pkg) {
      res.status(404).json({ error: `Package not found: ${packagePart}` });
      return;
   }

   const abs = safePathUnder(pkg.packageRoot, relFilePart);
   if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.status(404).json({ error: "File not found." });
      return;
   }

   setFullExportFileHeaders(res);
   res.sendFile(abs, (err) => {
      if (err) next(err);
   });
};

app.use("/full-exports", serveFullExports);

setTimeout(() => {
   try {
      const warmed = getFullExportIndexCache(true);
      console.log(`✅ Full export index warmed: ${warmed.exportsList.length} packages, ${warmed.roots.length} roots`);
   } catch (err) {
      console.warn("⚠️ Full export index warmup failed:", err instanceof Error ? err.message : String(err));
   }
}, 0);

console.log("  ✓ GET|HEAD /full-exports/list");
console.log("  ✓ GET|HEAD /full-exports/<package>/<file>");

// Auth routes
console.log("🔓 Registering auth routes...");
app.use("/api/auth", authRoutes);

console.log("🧾 Registering diagnostics routes...");
app.use("/api/diagnostics", requireAuth, diagnosticsRoutes);

/* =====================================================
   🎮 GAME API ROUTES
===================================================== */

console.log("🎮 Registering game routes...");
app.use("/api/game", gameRoutes);

/* =====================================================
   🔒 HARD GATE — EVERYTHING BELOW REQUIRES LOGIN
===================================================== */

console.log("🔒 Registering auth gate middleware...");
app.use("/api", requireAuth);

console.log("✅ All routes registered successfully!");

export default app;
