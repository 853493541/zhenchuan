/**
 * DraftScreen - Main screen during draft phase
 * Shows shop, selection, gold/level, and bench area (备战区)
 */

"use client";

import { useState, useEffect } from "react";
import type { TournamentState, AbilityInstance } from "../types";
import DraftShop from "./DraftShop";
import SelectedAbilities from "./SelectedAbilities";
import DraftEconomy from "./DraftEconomy";
import BenchArea from "./BenchArea";
import styles from "./DraftScreen.module.css";

type Props = {
  gameId: string;
  selfUserId: string;
  tournament: TournamentState;
  abilityMap: Record<string, any>;
  onFinalizeDraft: () => Promise<void>;
  onStateChange?: () => Promise<void>; // Callback to refetch parent state
};

export default function DraftScreen({
  gameId,
  selfUserId,
  tournament,
  abilityMap,
  onFinalizeDraft,
  onStateChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eco = tournament.economy[selfUserId];
  const shop = tournament.shop[selfUserId];
  const selected = tournament.selectedAbilities[selfUserId];
  const bench = tournament.bench?.[selfUserId] || [];

  if (!eco || !shop || !selected) {
    return <div className={styles.error}>草稿状态缺失</div>;
  }

  const handleSelectCard = async (cardInstance: AbilityInstance, destination: "selected" | "bench" = "selected") => {
    if (destination === "selected" && selected.length >= 6) {
      setError("选择栏已满 (最多6个)");
      return;
    }
    if (destination === "bench" && bench.length >= 12) {
      setError("备战区已满 (最多8个)");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/select", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          abilityInstanceId: cardInstance.instanceId,
          destination,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "购买失败");
        return;
      }

      // Selection successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMoveCard = async (abilityInstanceId: string, from: "selected" | "bench", to: "selected" | "bench") => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/move", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          abilityInstanceId,
          from,
          to,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "移动失败");
        return;
      }

      // Move successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSellCard = async (abilityInstanceId: string) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/sell", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          abilityInstanceId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "出售失败");
        return;
      }

      // Sell successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshShop = async () => {
    if (eco.gold < 1) {
      setError("金币不足以刷新");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "刷新失败");
        return;
      }

      // Refresh successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLockCard = async (abilityIndex: number) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/lock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          abilityIndex,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "锁定失败");
        return;
      }

      // Lock successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    try {
      console.log(`[DraftScreen] 🔘 Player ${selfUserId} clicked READY button!`);
      setLoading(true);
      setError(null);

      console.log(`[DraftScreen] 📤 ${selfUserId}: Sending /draft/finalize request...`);
      const res = await fetch("/api/game/draft/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });

      console.log(`[DraftScreen] 📥 ${selfUserId}: Response status: ${res.status}`);
      
      if (!res.ok) {
        const data = await res.json();
        console.error(`[DraftScreen] ❌ ${selfUserId}: Error: ${data.error}`);
        setError(data.error || "确认失败");
        return;
      }

      const result = await res.json();
      console.log(`[DraftScreen] ✅ ${selfUserId}: Finalize result:`, result);

      // Finalization successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }

      // If both players are ready and battle is starting, do an additional refetch
      if (result.battleStarting) {
        console.log(`[DraftScreen] ${selfUserId}: Both players ready! Refetching for battle...`);
        // Wait a moment for backend to fully process
        await new Promise((r) => setTimeout(r, 500));
        if (onStateChange) {
          await onStateChange();
        }
      }

      // Then call parent handler
      await onFinalizeDraft();
    } catch (err: any) {
      console.error("[DraftScreen] ❌ Exception:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.mainArea}>
        {/* Left Sidebar - Class/Unit Icons */}
        <div className={styles.leftSidebar}>
          <div className={styles.sidebarTitle}>势力</div>
          {/* Placeholder for class icons */}
        </div>

        {/* Center Content Area */}
        <div className={styles.centerArea}>
          {/* Header with Refresh and Confirm */}
          <div className={styles.header}>
            <h1>第 {tournament.battleNumber} 场</h1>
            <button
              className={styles.confirmBtn}
              onClick={handleFinalize}
              disabled={loading}
              title="确认选择"
            >
              ✓ 确认
            </button>
            <button
              className={styles.refreshBtn}
              onClick={handleRefreshShop}
              disabled={loading || eco.gold < 1}
            >
              🔄 刷新
            </button>
            <div className={styles.gameHp}>🏥 {tournament.gameHp[selfUserId]}</div>
          </div>

          {/* Shop - Horizontal Row */}
          <DraftShop
            shop={shop}
            abilityMap={abilityMap}
            onSelectCard={handleSelectCard}
            onLockCard={handleLockCard}
            loading={loading}
          />

          {/* Selected Abilities - Large Row */}
          <SelectedAbilities 
            selected={selected} 
            abilityMap={abilityMap}
            onMoveToBench={(abilityInstanceId) => handleMoveCard(abilityInstanceId, "selected", "bench")}
            loading={loading}
          />

          {/* Bench Area - Grid */}
          <BenchArea
            bench={bench}
            abilityMap={abilityMap}
            onMoveToSelected={(abilityInstanceId) => handleMoveCard(abilityInstanceId, "bench", "selected")}
            onSell={handleSellCard}
            loading={loading}
            fullSlots={bench.length}
          />
        </div>

        {/* Right Panel - Fixed Controls (Desktop) / Economy Info (Mobile) */}
        <div className={styles.rightPanel}>
          <DraftEconomy eco={eco} battleNumber={tournament.battleNumber} />

          {error && <div className={styles.error}>{error}</div>}
          
          {selected.length > 0 && (
            <div className={styles.progress}>
              已选 {selected.length} / 6
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
