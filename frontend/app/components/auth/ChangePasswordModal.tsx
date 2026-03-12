"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./ChangePasswordModal.module.css";
import { toastError } from "@/app/components/toast/toast";

export default function ChangePasswordModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const router = useRouter();
  const modalRef = useRef<HTMLDivElement>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /* ===============================
     ESC + Click-away close
  =============================== */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    function onClick(e: MouseEvent) {
      if (
        modalRef.current &&
        !modalRef.current.contains(e.target as Node)
      ) {
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
    if (!current || !next) return;

    setError(null);
    setLoading(true);

    const res = await fetch(`/api/auth/change-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: current,
        newPassword: next,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data?.error || "修改密码失败");
      setLoading(false);
      return;
    }

    // ✅ clean exit sequence
    onClose();
    router.replace("/login");
  }

  function onForgotPassword() {
    toastError("请联系管理员");
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} ref={modalRef}>
        <h2 className={styles.title}>修改密码</h2>

        <div className={styles.field}>
          <label className={styles.label}>当前密码</label>
          <input
            className={styles.input}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>新密码</label>
          <input
            className={styles.input}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>

        <div className={styles.forgotRow}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={onForgotPassword}
          >
            忘记密码？
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            onClick={submit}
            disabled={loading || !current || !next}
          >
            {loading ? "提交中…" : "确认修改"}
          </button>

          <button
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={loading}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
