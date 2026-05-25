export type StoredAuthUser = {
  id?: string;
  uid?: string;
  username: string;
  displayName: string;
  isAdmin?: boolean;
};

export type StoredAuthSession = StoredAuthUser & {
  token: string;
  updatedAt: number;
};

const STORAGE_KEY = "zhenchuan.auth.sessions.v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeUser(user: StoredAuthUser): StoredAuthUser {
  return {
    id: user.id,
    uid: user.uid,
    username: user.username,
    displayName: user.displayName || user.username,
    isAdmin: user.isAdmin === true,
  };
}

export function readStoredAuthSessions(): StoredAuthSession[] {
  if (!canUseStorage()) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((session): session is StoredAuthSession => (
      session &&
      typeof session.username === "string" &&
      typeof session.displayName === "string" &&
      typeof session.token === "string" &&
      session.token.length > 0
    ));
  } catch {
    return [];
  }
}

function writeStoredAuthSessions(sessions: StoredAuthSession[]) {
  if (!canUseStorage()) return;

  const deduped = new Map<string, StoredAuthSession>();
  for (const session of sessions) {
    deduped.set(session.username, session);
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([...deduped.values()].sort((a, b) => b.updatedAt - a.updatedAt))
  );
}

export async function rememberCurrentAuthSession(user: StoredAuthUser): Promise<StoredAuthSession[]> {
  if (!canUseStorage() || !user?.username) return readStoredAuthSessions();

  const res = await fetch("/api/auth/token", { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  const token = typeof data?.token === "string" ? data.token : "";
  if (!res.ok || !token) return readStoredAuthSessions();

  const normalized = normalizeUser(user);
  const sessions = readStoredAuthSessions().filter((session) => session.username !== normalized.username);
  const nextSession: StoredAuthSession = {
    ...normalized,
    token,
    updatedAt: Date.now(),
  };

  writeStoredAuthSessions([nextSession, ...sessions]);
  return readStoredAuthSessions();
}

export function updateStoredAuthSessionUser(user: StoredAuthUser) {
  if (!canUseStorage() || !user?.username) return;

  const normalized = normalizeUser(user);
  const sessions = readStoredAuthSessions().map((session) => (
    session.username === normalized.username
      ? { ...session, ...normalized, updatedAt: Date.now() }
      : session
  ));
  writeStoredAuthSessions(sessions);
}

export function removeStoredAuthSession(username: string) {
  if (!canUseStorage() || !username) return;
  writeStoredAuthSessions(readStoredAuthSessions().filter((session) => session.username !== username));
}

export function findAdminSession(sessions: StoredAuthSession[]): StoredAuthSession | null {
  return sessions.find((session) => session.isAdmin === true) ?? null;
}