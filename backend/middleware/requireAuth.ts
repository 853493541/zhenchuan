import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET");
}

declare global {
  namespace Express {
    interface Request {
      auth?: {
        uid: string;
        username: string;
        tokenVersion: number;
      };
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.cookies?.auth_token;
    console.log(`[requireAuth] ${req.method} ${req.path} - token present: ${!!token}`);
    
    if (!token) {
      console.log(`[requireAuth] ❌ No token in cookies`);
      return res.status(401).json({ error: "Not authenticated" });
    }

    // 1️⃣ Verify JWT signature
    const payload = jwt.verify(token, JWT_SECRET) as {
      uid: string;
      username: string;
      tokenVersion: number;
    };
    console.log(`[requireAuth] ✅ JWT verified for userId: ${payload.uid}`);

    // 2️⃣ Load user from DB
    const user = await User.findById(payload.uid).select("tokenVersion username");
    console.log(`[requireAuth] 🔍 User lookup for ${payload.uid}: ${user ? "found" : "NOT FOUND"}`);
    
    if (!user) {
      console.log(`[requireAuth] ❌ User not found in DB`);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // 3️⃣ Compare token versions (GLOBAL LOGOUT CHECK)
    if (user.tokenVersion !== payload.tokenVersion) {
      console.log(`[requireAuth] ❌ Token version mismatch. User version: ${user.tokenVersion}, Token version: ${payload.tokenVersion}`);
      return res.status(401).json({ error: "Session revoked" });
    }

    console.log(`[requireAuth] ✅ Auth passed for ${payload.username} (${payload.uid})`);
    
    // 4️⃣ Attach auth info
    req.auth = {
      uid: payload.uid,
      username: payload.username,
      tokenVersion: payload.tokenVersion,
    };

    next();
  } catch (err) {
    console.log(`[requireAuth] ❌ Auth error:`, err instanceof Error ? err.message : String(err));
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
