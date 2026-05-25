"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ChangePasswordModal.module.css";
import { updateStoredAuthSessionUser } from "./authSessionStore";
import { toastError } from "@/app/components/toast/toast";

type AuthUser = {
  username: string;
  displayName?: string;
  isAdmin?: boolean;
};

const CHINESE_NAME_RE = /^[\u4e00-\u9fff]+$/u;

export default function ChangeDisplayNameModal({
  currentDisplayName,
  onClose,
  onSaved,
}: {
  currentDisplayName: string;
  onClose: () => void;
  onSaved: (user: AuthUser) => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function submit() {
    const nextName = displayName.trim();
    if (!nextName) {
      setError("名称不能为空");
      return;
    }

    if (!CHINESE_NAME_RE.test(nextName)) {
      toastError("只能起中文名称");
      return;
    }

    if (nextName.length > 6) {
      setError("名称不能超过 6 个字");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/display-name", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: nextName }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "保存失败");
        return;
      }

      if (typeof window !== "undefined") {
        (window as any).__AUTH_USER__ = data.user;
      }
      updateStoredAuthSessionUser(data.user);
      onSaved(data.user);
      onClose();
    } catch {
      setError("网络错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} ref={modalRef}>
        <h2 className={styles.title}>修改名称</h2>

        <div className={styles.field}>
          <label className={styles.label}>名称</label>
          <input
            className={styles.input}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError(null);
            }}
            autoFocus
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            onClick={submit}
            disabled={loading}
          >
            {loading ? "保存中…" : "确定"}
          </button>

          <button className={styles.secondaryBtn} onClick={onClose} disabled={loading}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}