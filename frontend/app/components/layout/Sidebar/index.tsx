"use client";

import React from "react";
import NavLink from "../NavLink";
import styles from "./styles.module.css";

export default function Sidebar() {
  return (
    <div className={styles.wrap}>
      <nav className={styles.nav}>
        <NavLink href="/">🏠 主页</NavLink>
        <NavLink href="/game">🎮 真传卡牌</NavLink>
      </nav>
    </div>
  );
}
