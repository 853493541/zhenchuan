/**
 * API route to get auth token for WebSocket
 * Extracts JWT token from cookies
 */

import { cookies } from "next/headers";

export async function GET(req: Request) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return Response.json(
        { error: "No auth token in cookies" },
        { status: 401 }
      );
    }

    console.log("[API] /auth/token: Returning token from cookies");
    return Response.json({ ok: true, token });
  } catch (err) {
    console.error("[API] /auth/token error:", err);
    return Response.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
