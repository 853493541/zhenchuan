"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRightLeft,
  KeyRound,
  LogOut,
  Music,
  Pencil,
  Sparkles,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import ChangePasswordModal from "./ChangePasswordModal";
import ChangeDisplayNameModal from "./ChangeDisplayNameModal";
import ChangeSchoolModal from "./ChangeSchoolModal";
import SwitchAccountModal from "./SwitchAccountModal";
import { removeStoredAuthSession, updateStoredAuthSessionUser } from "./authSessionStore";
import { getSchoolColor } from "@/app/lib/schoolMeta";
import styles from "./UserMenu.module.css";

interface Props {
  user: {
    username: string;
    displayName?: string;
    isAdmin?: boolean;
    school?: string | null;
  };
}

function getAvatarLetter(name: string) {
  return name.charAt(0).toUpperCase();
}

export default function UserMenu({ user }: Props) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [showDisplayName, setShowDisplayName] = useState(false);
  const [showSchool, setShowSchool] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName || user.username);
  const [school, setSchool] = useState<string | null>(user.school ?? null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const avatarLetter = getAvatarLetter(displayName);
  const canViewAdminTools = user.isAdmin === true;

  useEffect(() => {
    setDisplayName(user.displayName || user.username);
    setSchool(user.school ?? null);
  }, [user.displayName, user.school, user.username]);

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {}

    removeStoredAuthSession(user.username);
    setOpen(false);
    setShowChange(false);
    setShowDisplayName(false);
    setShowSchool(false);
    setShowSwitch(false);
    router.replace("/login");
  }

  function openRoute(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <div className={styles.wrap} ref={wrapperRef}>
      <button
        className={styles.avatarBtn}
        onClick={() => setOpen((value) => !value)}
        aria-label="账户菜单"
      >
        <div className={styles.avatarCircle}>{avatarLetter}</div>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.profile}>
            <div className={styles.profileAvatar}>{avatarLetter}</div>
            <div className={styles.profileInfo}>
              <div className={styles.profileNameRow}>
                <div className={styles.profileName}>{displayName}</div>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => {
                    setOpen(false);
                    setShowSwitch(true);
                  }}
                  aria-label="切换账号"
                  title="切换账号"
                >
                  <ArrowRightLeft size={15} />
                </button>
              </div>
              {school && (
                <div className={styles.profileSchool} style={{ color: getSchoolColor(school), borderColor: getSchoolColor(school) }}>
                  {school}
                </div>
              )}
            </div>
          </div>

          <div className={styles.divider} />

          {canViewAdminTools && (
            <>
              <button
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  router.push("/admin/activity");
                }}
              >
                <ShieldCheck size={18} />
                查看记录
              </button>

              <button className={styles.menuItem} onClick={() => openRoute("/ability-editor")}>
                <Wrench size={18} />
                技能编辑
              </button>

              <button className={styles.menuItem} onClick={() => openRoute("/ability-editor?tab=soundReview")}>
                <Music size={18} />
                音效
              </button>

              <button className={styles.menuItem} onClick={() => openRoute("/network-diagnostics")}>
                <Activity size={18} />
                网络诊断
              </button>

              <div className={styles.divider} />
            </>
          )}

          <button
            className={styles.menuItem}
            onClick={() => {
              setShowDisplayName(true);
              setOpen(false);
            }}
          >
            <Pencil size={18} />
            修改名称
          </button>

          <button
            className={styles.menuItem}
            onClick={() => {
              setShowSchool(true);
              setOpen(false);
            }}
          >
            <Sparkles size={18} />
            修改门派
          </button>

          <button
            className={styles.menuItem}
            onClick={() => {
              setShowChange(true);
              setOpen(false);
            }}
          >
            <KeyRound size={18} />
            修改密码
          </button>

          <button className={`${styles.menuItem} ${styles.logout}`} onClick={logout}>
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      )}

      {showDisplayName && (
        <ChangeDisplayNameModal
          currentDisplayName={displayName}
          onClose={() => setShowDisplayName(false)}
          onSaved={(nextUser) => {
            updateStoredAuthSessionUser(nextUser);
            setDisplayName(nextUser.displayName || nextUser.username);
            setSchool(nextUser.school ?? null);
          }}
        />
      )}

      {showSchool && (
        <ChangeSchoolModal
          currentSchool={school}
          onClose={() => setShowSchool(false)}
          onSaved={(nextUser) => {
            updateStoredAuthSessionUser(nextUser);
            setSchool(nextUser.school ?? null);
            setDisplayName(nextUser.displayName || nextUser.username);
          }}
        />
      )}

      {showSwitch && (
        <SwitchAccountModal
          currentUser={{ username: user.username, displayName: displayName, isAdmin: user.isAdmin, school }}
          onClose={() => setShowSwitch(false)}
        />
      )}

      {showChange && (
        <ChangePasswordModal
          currentUsername={user.username}
          onClose={() => {
            setShowChange(false);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}