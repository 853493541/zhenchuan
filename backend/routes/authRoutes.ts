import { Router } from "express";
import { getSeededTestDisplayName, normalizeStoredUserDisplayName, USER_SCHOOLS, User } from "../models/User";
import GameSession from "../game/models/GameSession";
import {
  getCookieOptions,
  hashPassword,
  signToken,
  verifyToken,
  verifyPassword,
  getClientIp, // ✅ centralized IP helper
} from "../utils/auth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes
const DISPLAY_NAME_RE = /^[\u4e00-\u9fff]{1,6}$/u;
const CHINESE_NAME_RE = /^[\u4e00-\u9fff]+$/u;
const USER_SCHOOL_SET = new Set<string>(USER_SCHOOLS);

function publicUserPayload(user: any) {
  return {
    id: user._id,
    uid: user._id,
    username: user.username,
    displayName: normalizeStoredUserDisplayName(user.username, user.displayName),
    school: USER_SCHOOL_SET.has(user.school) ? user.school : null,
    isAdmin: user.isAdmin === true,
  };
}

async function repairSeededTestDisplayName(user: any) {
  const seededDisplayName = getSeededTestDisplayName(user?.username);
  if (!seededDisplayName) return;
  const normalizedDisplayName = normalizeStoredUserDisplayName(user.username, user.displayName);
  if (normalizedDisplayName !== seededDisplayName || user.displayName === seededDisplayName) return;

  user.displayName = seededDisplayName;
  await user.save();
  await GameSession.updateMany(
    { players: String(user._id) },
    { $set: { [`playerNames.${String(user._id)}`]: seededDisplayName } }
  );
}

function normalizeDisplayName(raw: unknown) {
  return String(raw ?? "").trim();
}

function isValidDisplayName(displayName: string) {
  return DISPLAY_NAME_RE.test(displayName);
}

function normalizeSchool(raw: unknown) {
  const school = String(raw ?? "").trim();
  return USER_SCHOOL_SET.has(school) ? school : null;
}

async function findValidUserForToken(rawToken: unknown) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) return null;

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.uid);
    if (!user) return null;
    if (user.username !== payload.username) return null;
    if (user.tokenVersion !== payload.tokenVersion) return null;
    return user;
  } catch {
    return null;
  }
}

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

    await repairSeededTestDisplayName(user);

    const token = signToken({
      uid: String(user._id),
      username: user.username,
      tokenVersion: user.tokenVersion,
    });

    res.cookie("auth_token", token, getCookieOptions(req));
    return res.json({
      ok: true,
      user: publicUserPayload(user),
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

    await repairSeededTestDisplayName(user);

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
      user: publicUserPayload(user),
    });
  } catch (err) {
    console.error("[auth/me] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/switch-session
 * Switches to a previously authenticated browser session token.
 */
router.post("/switch-session", async (req, res) => {
  try {
    const targetToken = String(req.body?.token || "");
    const authorizingToken = String(req.body?.authorizingToken || "");

    const targetUser = await findValidUserForToken(targetToken);
    if (!targetUser) {
      return res.status(401).json({ error: "账号登录已失效" });
    }

    const currentUser = await findValidUserForToken(req.cookies?.auth_token);
    const authorizingUser = authorizingToken ? await findValidUserForToken(authorizingToken) : null;
    const hasAdminSession = [targetUser, currentUser, authorizingUser].some((user) => user?.isAdmin === true);

    if (!hasAdminSession) {
      return res.status(403).json({ error: "需要已登录的管理员账号" });
    }

    await repairSeededTestDisplayName(targetUser);

    res.cookie("auth_token", targetToken, getCookieOptions(req));
    return res.json({
      ok: true,
      user: publicUserPayload(targetUser),
    });
  } catch (err) {
    console.error("[auth/switch-session] error:", err);
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
      user: publicUserPayload(user),
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
 * PATCH /api/auth/display-name
 * Updates the player-facing 角色名称 for the current account.
 */
router.patch("/display-name", requireAuth, async (req, res) => {
  try {
    const displayName = normalizeDisplayName(req.body?.displayName);

    if (!displayName) {
      return res.status(400).json({ error: "名称不能为空" });
    }

    if (!CHINESE_NAME_RE.test(displayName)) {
      return res.status(400).json({ error: "只能起中文名称" });
    }

    if (!isValidDisplayName(displayName)) {
      return res.status(400).json({ error: "名称不能超过 6 个字" });
    }

    const user = await User.findById(req.auth!.uid);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const duplicate = await User.findOne({ displayName, _id: { $ne: user._id } });
    if (duplicate) {
      return res.status(409).json({ error: "名称已被使用" });
    }

    user.displayName = displayName;
    await user.save();

    await GameSession.updateMany(
      { players: String(user._id) },
      { $set: { [`playerNames.${String(user._id)}`]: displayName } }
    );

    return res.json({ ok: true, user: publicUserPayload(user) });
  } catch (err) {
    console.error("[auth/display-name] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/auth/school
 * Updates the account's selected 门派.
 */
router.patch("/school", requireAuth, async (req, res) => {
  try {
    const school = normalizeSchool(req.body?.school);

    if (!school) {
      return res.status(400).json({ error: "门派无效" });
    }

    const user = await User.findById(req.auth!.uid);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.school = school as any;
    await user.save();

    await GameSession.updateMany(
      { players: String(user._id) },
      { $set: { [`playerSchools.${String(user._id)}`]: school } }
    );

    return res.json({ ok: true, user: publicUserPayload(user) });
  } catch (err) {
    console.error("[auth/school] error:", err);
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
