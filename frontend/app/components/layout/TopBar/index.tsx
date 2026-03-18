"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./styles.module.css";
import UserMenu from "@/app/components/auth/UserMenu";

interface TopBarProps {
  username?: string | null; // ✅ injected from parent (AuthGate / LayoutShell)
}

export default function TopBar({ username }: TopBarProps) {

  return (
    <div className={styles.wrap}>
      {/* Logo + Title */}
      <Link href="/" className={styles.titleWrap}>
        <Image
          src="/icons/app_icon_no_background.webp?v=4"
          alt="logo"
          width={32}
          height={32}
          priority
        />
        <span className={styles.title}>真传</span>
      </Link>

      {/* Right side user menu */}
      <div className={styles.rightArea}>
        {username ? <UserMenu username={username} /> : null}
      </div>
    </div>
  );
}
