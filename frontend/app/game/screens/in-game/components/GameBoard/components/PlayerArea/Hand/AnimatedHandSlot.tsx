"use client";

import styles from "./styles.module.css";

type Props = {
  children: React.ReactNode;
};

export default function AnimatedHandSlot({ children }: Props) {
  return (
    <div
      className={`${styles.slot} ${styles.drawIn}`}
      style={{
        // Always enter from the far right of the viewport
        // feels consistent regardless of hand size
        ["--enter-x" as any]: "100vw",
      }}
    >
      {children}
    </div>
  );
}
