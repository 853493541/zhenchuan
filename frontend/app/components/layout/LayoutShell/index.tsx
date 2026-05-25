"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import TopBar from "../TopBar";
import styles from "./styles.module.css";

type LayoutAuthUser = {
  username: string;
  displayName?: string;
  isAdmin?: boolean;
};

export default function LayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const isInGame = pathname?.startsWith('/game/in-game') || pathname?.startsWith('/game/screens/in-game');
  const isResourcePack = pathname === '/resource-pack';

  const [authUser] = useState<LayoutAuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    const user = (window as any).__AUTH_USER__;
    if (user?.username) return user;
    const username = (window as any).__AUTH_USERNAME__;
    return username ? { username } : null;
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
      {!isInGame && !isResourcePack && (
        <div className={styles.topbarGlobal}>
          <TopBar user={authUser} />
        </div>
      )}

      {/* Main content */}
      <main className={isInGame ? styles.mainFullscreenNoTopbar : isResourcePack ? styles.mainEmbeddedNoTopbar : styles.main}>{children}</main>
    </div>
  );
}
