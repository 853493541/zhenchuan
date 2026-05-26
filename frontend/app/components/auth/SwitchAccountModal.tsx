"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./ChangePasswordModal.module.css";
import {
  findAdminSession,
  readStoredAuthSessions,
  rememberCurrentAuthSession,
  type StoredAuthSession,
  type StoredAuthUser,
} from "./authSessionStore";

export default function SwitchAccountModal({
  currentUser,
  onClose,
}: {
  currentUser: StoredAuthUser;
  onClose: () => void;
}) {
  const router = useRouter();
  const modalRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<StoredAuthSession[]>([]);
  const [selectedUsername, setSelectedUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  const availableSessions = useMemo(
    () => sessions.filter((session) => session.username !== currentUser.username),
    [currentUser.username, sessions]
  );
  const adminSession = useMemo(() => findAdminSession(sessions), [sessions]);
  const canSwitch = currentUser.isAdmin === true || adminSession !== null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    function onClick(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      setLoading(true);
      setError(null);
      try {
        const nextSessions = await rememberCurrentAuthSession(currentUser).catch(() => readStoredAuthSessions());
        if (cancelled) return;
        setSessions(nextSessions);
        const firstOther = nextSessions.find((session) => session.username !== currentUser.username);
        setSelectedUsername(firstOther?.username ?? "");
      } catch {
        if (!cancelled) setError("网络错误，请稍后再试");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSessions();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  async function submit() {
    if (!selectedUsername || !canSwitch) return;
    const selectedSession = sessions.find((session) => session.username === selectedUsername);
    if (!selectedSession) return;

    setSwitching(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/switch-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: selectedSession.token,
          authorizingToken: currentUser.isAdmin === true ? undefined : adminSession?.token,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "切换失败");
        return;
      }

      await rememberCurrentAuthSession(data.user).catch(() => undefined);
      window.location.href = "/";
    } catch {
      setError("网络错误，请稍后再试");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} ref={modalRef}>
        <h2 className={styles.title}>切换账号</h2>

        <div className={styles.accountList}>
          {loading && <div className={styles.accountEmpty}>加载中…</div>}
          {!loading && availableSessions.length === 0 && <div className={styles.accountEmpty}>暂无其他已登录账号</div>}
          {availableSessions.map((session) => (
            <button
              key={session.username}
              type="button"
              className={`${styles.accountChoice} ${selectedUsername === session.username ? styles.accountChoiceActive : ""}`}
              disabled={!canSwitch}
              onClick={() => {
                setSelectedUsername(session.username);
                setError(null);
              }}
            >
              <span className={styles.accountName}>{session.displayName || session.username}</span>
              {session.isAdmin && <span className={styles.accountBadge}>管理员</span>}
            </button>
          ))}
        </div>

        {!canSwitch && <div className={styles.error}>需要已登录的管理员账号</div>}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            onClick={submit}
            disabled={!selectedUsername || !canSwitch || switching}
          >
            {switching ? "切换中…" : "切换"}
          </button>

          <button
            className={styles.secondaryBtn}
            onClick={() => {
              onClose();
              router.push("/login");
            }}
            disabled={switching}
          >
            添加账号
          </button>

          <button className={styles.secondaryBtn} onClick={onClose} disabled={switching}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}