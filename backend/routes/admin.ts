import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { User } from "../models/User";

const router = Router();

async function requireAdminUser(req: Request, res: Response) {
  const user = await User.findById(req.auth!.uid).select("username displayName isAdmin").lean();
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
  if (user.isAdmin !== true) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

router.get("/users/activity", requireAuth, async (req, res) => {
  try {
    const admin = await requireAdminUser(req, res);
    if (!admin) return;

    const users = await User.find(
      {},
      {
        username: 1,
        displayName: 1,
        isAdmin: 1,
        lastSeenAt: 1,
        lastSeenIp: 1,
      }
    )
      .sort({ username: 1 })
      .lean();

    return res.json({
      users: users.map((user) => ({
        username: user.username,
        displayName: user.displayName || user.username,
        isAdmin: user.isAdmin === true,
        lastSeenAt: user.lastSeenAt ?? null,
        lastSeenIp: user.lastSeenIp ?? null,
      })),
    });
  } catch (err) {
    console.error("[admin/users/activity] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;