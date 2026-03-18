import { Router } from "express";
import { User } from "../models/User";
import {
  getCookieOptions,
  hashPassword,
  signToken,
  verifyPassword,
  getClientIp, // ✅ centralized IP helper
} from "../utils/auth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const usernameRaw = String(req.body?.username || "");
    const passwordRaw = String(req.body?.password || "");

    const username = usernameRaw.trim().toLowerCase();
    const password = passwordRaw;

    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "账号密码错误！" });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "账号密码错误！" });
    }

    const token = signToken({
      uid: String(user._id),
      username: user.username,
      tokenVersion: user.tokenVersion,
    });

    res.cookie("auth_token", token, getCookieOptions(req));
    return res.json({
      ok: true,
      user: { id: user._id, username: user.username },
    });
  } catch (err) {
    console.error("[auth/login] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", async (_req, res) => {
  try {
    res.clearCookie("auth_token", { path: "/" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[auth/logout] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/auth/me
 * 👀 Updates lastSeenAt + lastSeenIp (throttled)
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.auth!.uid);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = Date.now();
    const lastSeen = user.lastSeenAt?.getTime() ?? 0;

    // ⏱️ Throttle presence updates
    if (!user.lastSeenAt || now - lastSeen > LAST_SEEN_THROTTLE_MS) {
      user.lastSeenAt = new Date();

      // 🌐 Record last-seen IP (overwritten, not audit)
      const ip = getClientIp(req);
      user.lastSeenIp = ip ?? undefined;


      await user.save();
    }

    return res.json({
      ok: true,
      user: {
        uid: user._id,
        username: user.username,
      },
    });
  } catch (err) {
    console.error("[auth/me] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/bootstrap
 * Allows creating the FIRST user only
 */
router.post("/bootstrap", async (req, res) => {
  try {
    const count = await User.countDocuments();
    // if (count > 0) {
    //   return res
    //     .status(403)
    //     .json({ error: "Bootstrap disabled (users already exist)" });
    // }

    const usernameRaw = String(req.body?.username || "");
    const passwordRaw = String(req.body?.password || "");

    const username = usernameRaw.trim().toLowerCase();
    const password = passwordRaw;

    if (!username || !password) {
      return res.status(400).json({ error: "Need username + password" });
    }

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      username,
      passwordHash,
      tokenVersion: 0,
    });

    return res.json({
      ok: true,
      user: { id: user._id, username: user.username },
    });
  } catch (err) {
    console.error("[auth/bootstrap] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/change-password
 * - Verifies current password
 * - Updates password
 * - Increments tokenVersion (global logout)
 */
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Missing passwords" });
    }

    const user = await User.findById(req.auth!.uid);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    user.passwordHash = await hashPassword(newPassword);
    user.tokenVersion += 1;

    await user.save();

    // Invalidate current browser session
    res.clearCookie("auth_token", { path: "/" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[auth/change-password] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/auth/token
 * Returns JWT token for WebSocket connection
 * NO AUTH REQUIRED - just echoes the cookie back if it exists
 * (User is already authenticated to be on the game page)
 */
router.get("/token", async (req, res) => {
  try {
    console.log("[auth/token] Request received. Cookies:", Object.keys(req.cookies || {}));
    
    const token = req.cookies?.auth_token;
    
    if (!token) {
      console.log("[auth/token] ❌ No auth_token cookie found");
      console.log("[auth/token] All cookies:", req.cookies);
      return res.status(401).json({ error: "No auth token in cookies" });
    }

    console.log("[auth/token] ✅ Returning token from cookies");
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("[auth/token] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
