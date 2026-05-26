"use client";

import { useEffect, useRef, useState } from "react";
import { toastError } from "@/app/components/toast/toast";
import { getSchoolColor, isSchoolTag, SCHOOL_TAGS, type SchoolTag } from "@/app/lib/schoolMeta";
import { updateStoredAuthSessionUser } from "./authSessionStore";
import styles from "./ChangePasswordModal.module.css";

type AuthUser = {
  username: string;
  displayName?: string;
  isAdmin?: boolean;
  school?: string | null;
};

export default function ChangeSchoolModal({
  currentSchool,
  onClose,
  onSaved,
}: {
  currentSchool?: string | null;
  onClose: () => void;
  onSaved: (user: AuthUser) => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [selectedSchool, setSelectedSchool] = useState<SchoolTag>(() => isSchoolTag(currentSchool) ? currentSchool : "少林");
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
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/school", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ school: selectedSchool }),
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
      toastError("网络错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.modal} ${styles.schoolModal}`} ref={modalRef}>
        <h2 className={styles.title}>修改门派</h2>

        <div className={styles.schoolGrid}>
          {SCHOOL_TAGS.map((school) => {
            const color = getSchoolColor(school);
            const active = selectedSchool === school;
            return (
              <button
                key={school}
                type="button"
                className={`${styles.schoolChoice} ${active ? styles.schoolChoiceActive : ""}`}
                style={{ borderColor: color, color }}
                onClick={() => {
                  setSelectedSchool(school);
                  setError(null);
                }}
              >
                {school}
              </button>
            );
          })}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.primaryBtn} onClick={submit} disabled={loading}>
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