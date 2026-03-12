"use client";

import React from "react";
import Link from "next/link";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.container}>
      {/* ================= Header ================= */}
      <div className={styles.header}>
        <h1 className={styles.title}>真传</h1>
        <p className={styles.subtitle}>Card Game Platform</p>
      </div>

      {/* ================= Quick Access ================= */}
      <div className={styles.quickAccess}>
        <Link href="/game" className={styles.card}>
          🎮 Play Game
        </Link>
      </div>

      {/* ================= Footer ================= */}
      <div className={styles.footer}>
        <p>版本 v2.50</p>
        <p>作者: 轻语@乾坤一掷</p>
        <p>最后更新日期: 1/21/2026</p>
      </div>
    </div>
  );
}
