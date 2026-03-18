"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import ChangePasswordModal from "./ChangePasswordModal";
import styles from "./UserMenu.module.css";



interface Props {
  username: string;
}

/* ===============================
   Display name mapping
=============================== */
const DISPLAY_NAME_MAP: Record<string, string> = {
  admin: "管理员",
  wuxi: "五溪",
  douzhi: "豆子",
  juzi: "桔子",
  tianmei: "甜妹",
  guest: "游客账号",
  catcake: "猫猫糕",
};

function getDisplayName(username: string) {
  return DISPLAY_NAME_MAP[username] ?? username;
}

function getAvatarLetter(name: string) {
  return name.charAt(0).toUpperCase();
}

/* ===============================
   Permissions
=============================== */
const ACTIVITY_PAGE_ALLOWED_USERS = new Set(["admin", "catcake"]);

export default function UserMenu({ username }: Props) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [showChange, setShowChange] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const displayName = getDisplayName(username);
  const avatarLetter = getAvatarLetter(displayName);
  const canViewActivityPage = ACTIVITY_PAGE_ALLOWED_USERS.has(username);

  /* =====================================================
     🔥 GLYPH WARM-UP (CRITICAL FIX)
     ===================================================== */
  useEffect(() => {
    const span = document.createElement("span");
    span.className = "material-symbols-outlined";
    span.textContent = "admin_panel_settings key logout";
    span.style.position = "absolute";
    span.style.visibility = "hidden";
    span.style.pointerEvents = "none";
    document.body.appendChild(span);

    return () => {
      document.body.removeChild(span);
    };
  }, []);

  /* =====================================================
     Click-away + ESC
     ===================================================== */
  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  /* =====================================================
     Logout
     ===================================================== */
  async function logout() {
    try {
      await fetch(`/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}

    setOpen(false);
    setShowChange(false);
    router.replace("/login");
  }

  /* =====================================================
     Render
     ===================================================== */
  return (
    <div className={styles.wrap} ref={wrapperRef}>
      {/* Avatar */}
      <button
        className={styles.avatarBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label="账户菜单"
      >
        <div className={styles.avatarCircle}>{avatarLetter}</div>
      </button>

      {/* Menu */}
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.profile}>
            <div className={styles.profileAvatar}>{avatarLetter}</div>
            <div className={styles.profileInfo}>
              <div className={styles.profileName}>{displayName}</div>
              <div className={styles.profileHint}>已登录</div>
            </div>
          </div>

          <div className={styles.divider} />

          {canViewActivityPage && (
            <button
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                router.push("/admin/activity");
              }}
            >
              <span className="material-symbols-outlined">
                admin_panel_settings
              </span>
              查看记录
            </button>
          )}

          <button
            className={styles.menuItem}
            onClick={() => {
              setShowChange(true);
              setOpen(false);
            }}
          >
            <span className="material-symbols-outlined">key</span>
            修改密码
          </button>

          <button
            className={`${styles.menuItem} ${styles.logout}`}
            onClick={logout}
          >
            <span className="material-symbols-outlined">logout</span>
            退出登录
          </button>
        </div>
      )}

      {showChange && (
        <ChangePasswordModal
          onClose={() => {
            setShowChange(false);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
