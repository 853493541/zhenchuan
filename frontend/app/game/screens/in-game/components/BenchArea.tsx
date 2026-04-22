/**
 * BenchArea - Shows 8 benched abilities that persist across battles
 * Can move to selected, sell for gold, or hover to see stats
 */

"use client";

import type { AbilityInstance } from "../types";
import { useState } from "react";
import styles from "./BenchArea.module.css";

type Props = {
  bench: AbilityInstance[];
  abilityMap: Record<string, any>;
  onMoveToSelected: (abilityInstanceId: string) => Promise<void>;
  onSell: (abilityInstanceId: string) => Promise<void>;
  loading: boolean;
  fullSlots?: number; // How many slots currently used (for UI feedback)
};

export default function BenchArea({
  bench,
  abilityMap,
  onMoveToSelected,
  onSell,
  loading,
  fullSlots = 0,
}: Props) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (abilityId: string) => {
    setFailedImages(prev => new Set([...prev, abilityId]));
  };
  const benchSlots = Array.from({ length: 8 }, (_, i) => {
    const ability = bench[i];
    return { index: i, ability };
  });

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>备战区 {fullSlots}/8</h3>
      <div className={styles.grid}>
        {benchSlots.map(({ index, ability }) => {
          if (!ability) {
            return (
              <div key={index} className={`${styles.ability} ${styles.empty}`}>
                <div className={styles.emptySlot}>{index + 1}</div>
              </div>
            );
          }

          const abilityDef = abilityMap[ability.abilityId];

          return (
            <div
              key={ability.instanceId}
              className={styles.ability}
              onClick={() => onMoveToSelected(ability.instanceId)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSell(ability.instanceId);
              }}
              style={{ cursor: "pointer" }}
              title="左键移到选择栏 或右键出售"
            >
              {!failedImages.has(ability.abilityId) ? (
                <img 
                  src={`/icons/${abilityDef?.name}.png`} 
                  alt={abilityDef?.name} 
                  className={styles.portrait}
                  onError={() => handleImageError(ability.abilityId)}
                />
              ) : (
                <div className={styles.portrait}>
                  <div className={styles.portraitInner}>{abilityDef?.name?.charAt(0) || "?"}</div>
                </div>
              )}
              <div className={styles.cardInfo}>
                <h3 className={styles.abilityName}>{abilityDef?.name || "Unknown"}</h3>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
