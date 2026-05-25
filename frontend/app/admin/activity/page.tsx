"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./styles.module.css";

interface UserActivity {
  username: string;
  displayName: string;
  isAdmin: boolean;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
}

const SPECIAL_USERS = new Set(["catcake", "guest", "testuser1", "testuser2"]);

function timeAgo(ts: string | null) {
  if (!ts) return "从未";

  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  if (hour < 24) return `${hour} 小时前`;
  return `${day} 天前`;
}

function sortByLastSeen(list: UserActivity[]) {
  return [...list].sort((a, b) => {
    if (!a.lastSeenAt && !b.lastSeenAt) return a.displayName.localeCompare(b.displayName, "zh-Hans-CN");
    if (!a.lastSeenAt) return 1;
    if (!b.lastSeenAt) return -1;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });
}

export default function AdminActivityPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meRes = await fetch("/api/auth/me", { credentials: "include" });
        if (meRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (!meRes.ok) throw new Error("auth failed");

        const meData = await meRes.json();
        if (meData?.user?.isAdmin !== true) {
          router.replace("/");
          return;
        }

        const res = await fetch("/api/admin/users/activity", { credentials: "include" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.status === 403) {
          router.replace("/");
          return;
        }
        if (!res.ok) throw new Error("load failed");

        const data = await res.json();
        if (!cancelled) setUsers(data.users || []);
      } catch {
        if (!cancelled) setError("无法加载访问记录");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const specialUsers = useMemo(
    () => sortByLastSeen(users.filter((user) => SPECIAL_USERS.has(user.username) || user.isAdmin)),
    [users]
  );
  const normalUsers = useMemo(
    () => sortByLastSeen(users.filter((user) => !SPECIAL_USERS.has(user.username) && !user.isAdmin)),
    [users]
  );

  const renderRows = (rows: UserActivity[]) => rows.map((user) => (
    <tr key={user.username}>
      <td className={styles.username}>{user.displayName || user.username}</td>
      <td>{timeAgo(user.lastSeenAt)}</td>
      <td className={styles.ip}>{user.lastSeenIp ?? "—"}</td>
    </tr>
  ));

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>访问记录</h1>
      </header>

      {loading && <div className={styles.loading}>加载中…</div>}
      {error && <div className={styles.error}>{error}</div>}

      {!loading && !error && (
        <>
          <section className={styles.card}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>最近登录</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>{renderRows(specialUsers)}</tbody>
            </table>
          </section>

          <section className={styles.card}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>最近登录</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>{renderRows(normalUsers)}</tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}