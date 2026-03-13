"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import TopBar from "../TopBar";
import styles from "./styles.module.css";

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  // ✅ username comes from AuthGate via window (set once)
  const [username] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return (window as any).__AUTH_USERNAME__ ?? null;
  });

  /* =====================================================
     🚫 LOGIN PAGE — NO LAYOUT
     ===================================================== */
  if (isLoginPage) {
    return <>{children}</>;
  }

  /* =====================================================
     ✅ NORMAL APP LAYOUT
     ===================================================== */
  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <div className={styles.topbarGlobal}>
        <TopBar username={username} />
      </div>

      {/* Main content */}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
