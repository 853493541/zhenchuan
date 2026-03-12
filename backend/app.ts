import express from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { connectDB } from "./db";

// 🔐 AUTH
import authRoutes from "./routes/authRoutes";
import { requireAuth } from "./middleware/requireAuth";

// GAME
import gameRoutes from "./game/routes/game.routes";



const app = express();

console.log("📦 Creating Express app...");

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
// Auth routes
console.log("🔓 Registering auth routes...");
app.use("/api/auth", authRoutes);

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
