/**
 * DraftShop - Displays 5 available ability abilities in shop
 * Click ability directly to buy and add to bench
 */

"use client";

import type { Shop, AbilityInstance } from "../types";
import { useState } from "react";
import styles from "./DraftShop.module.css";

type Props = {
  shop: Shop;
  abilityMap: Record<string, any>;
  onSelectCard: (ability: AbilityInstance, destination: "selected" | "bench") => Promise<void>;
  onLockCard: (index: number) => Promise<void>;
  loading: boolean;
};

export default function DraftShop({
  shop,
  abilityMap,
  onSelectCard,
  onLockCard,
  loading,
}: Props) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (abilityId: string) => {
    setFailedImages(prev => new Set([...prev, abilityId]));
  };

  return (
    <div className={styles.shop}>
      <h2 className={styles.title}>🛒 商店</h2>
      <div className={styles.grid}>
        {shop.abilities.map((ability, idx) => {
          const abilityDef = abilityMap[ability.abilityId];
          if (!abilityDef) return null;

          return (
            <div
              key={ability.instanceId}
              className={styles.ability}
              onClick={() => !loading && onSelectCard(ability, "bench")}
            >
              {!failedImages.has(ability.abilityId) ? (
                <img 
                  src={`/icons/${abilityDef.name}.png`} 
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
                <p className={styles.description}>
                  {abilityDef.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
