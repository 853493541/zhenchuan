"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./styles.module.css";
import UserMenu from "@/app/components/auth/UserMenu";

interface TopBarProps {
  user?: {
    username: string;
    displayName?: string;
    isAdmin?: boolean;
    school?: string | null;
  } | null;
}

export default function TopBar({ user }: TopBarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isInGame = pathname?.startsWith('/game/in-game') || pathname?.startsWith('/game/screens/in-game');

  const leaveGameAndReturnHome = async () => {
    const gameId = searchParams.get('gameId');
    if (gameId) {
      try {
        const res = await fetch('/api/game/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ gameId }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error('[TopBar] /game/end failed:', res.status, text);
        }
      } catch (err) {
        console.error('[TopBar] /game/end error:', err);
      }
    }
    router.replace('/');
  };

  return (
    <div className={styles.wrap}>
      {/* Logo + Title */}
      {isInGame ? (
        <button type="button" className={styles.titleWrapButton} onClick={() => void leaveGameAndReturnHome()}>
          <Image
            src="/icons/app_icon_no_background.webp?v=4"
            alt="logo"
            width={32}
            height={32}
            priority
          />
          <span className={styles.title}>真传</span>
        </button>
      ) : (
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
      )}

      {/* Right side user menu */}
      <div className={styles.rightArea}>
        {user ? <UserMenu user={user} /> : null}
      </div>
    </div>
  );
}
