/**
 * SelectedAbilities - Shows the 6 selected abilities
 */

"use client";

import type { AbilityInstance } from "../types";
import { useState } from "react";
import styles from "./SelectedAbilities.module.css";

type Props = {
  selected: AbilityInstance[];
  abilityMap: Record<string, any>;
  onMoveToBench?: (abilityInstanceId: string) => Promise<void>;
  loading?: boolean;
};

export default function SelectedAbilities({ 
  selected, 
  abilityMap,
  onMoveToBench,
  loading = false,
}: Props) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (abilityId: string) => {
    setFailedImages(prev => new Set([...prev, abilityId]));
  };
  return (
    <div className={styles.container}>
      <h2 className={styles.title}>⚔️ 出战阵容</h2>
      <div className={styles.slotGrid}>
        {Array.from({ length: 6 }).map((_, idx) => {
          const ability = selected[idx];
          const abilityDef = ability ? abilityMap[ability.abilityId] : null;

          return (
            <div 
              key={idx} 
              className={`${styles.slot} ${ability ? styles.selected : styles.empty}`}
              onClick={() => ability && onMoveToBench && onMoveToBench(ability.instanceId)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (ability && onMoveToBench) {
                  onMoveToBench(ability.instanceId);
                }
              }}
              style={ability && onMoveToBench ? { cursor: "pointer" } : {}}
              title={ability ? "左键点击或右键移到备战区" : ""}
            >
              {abilityDef ? (
                <>
                  {!failedImages.has(ability.abilityId) ? (
                    <img 
                      src={`/game/icons/Skills/${abilityDef.name}.png`} 
                      alt={abilityDef.name} 
                      className={styles.portrait}
                      onError={() => handleImageError(ability.abilityId)}
                    />
                  ) : (
                    <div className={styles.portrait}>
                      <div className={styles.portraitInner}>{abilityDef.name.charAt(0)}</div>
                    </div>
                  )}
                  <div className={styles.cardInfo}>
                    <h3 className={styles.abilityName}>{abilityDef.name}</h3>
                  </div>
                </>
              ) : (
                <div className={styles.emptySlot}>
                  <span>位置 {idx + 1}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
