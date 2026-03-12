/**
 * DraftScreen - Main screen during draft phase
 * Shows shop, selection, gold/level, and bench area (备战区)
 */

"use client";

import { useState, useEffect } from "react";
import type { TournamentState, CardInstance } from "../types";
import DraftShop from "./DraftShop";
import SelectedAbilities from "./SelectedAbilities";
import DraftEconomy from "./DraftEconomy";
import BenchArea from "./BenchArea";
import styles from "./DraftScreen.module.css";

type Props = {
  gameId: string;
  selfUserId: string;
  tournament: TournamentState;
  cardMap: Record<string, any>;
  onFinalizeDraft: () => Promise<void>;
  onStateChange?: () => Promise<void>; // Callback to refetch parent state
};

export default function DraftScreen({
  gameId,
  selfUserId,
  tournament,
  cardMap,
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

  const handleSelectCard = async (cardInstance: CardInstance, destination: "selected" | "bench" = "selected") => {
    if (destination === "selected" && selected.length >= 6) {
      setError("选择栏已满 (最多6个)");
      return;
    }
    if (destination === "bench" && bench.length >= 12) {
      setError("备战区已满 (最多12个)");
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
          cardInstanceId: cardInstance.instanceId,
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

  const handleMoveCard = async (cardInstanceId: string, from: "selected" | "bench", to: "selected" | "bench") => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/move", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          cardInstanceId,
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

  const handleSellCard = async (cardInstanceId: string) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/sell", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          cardInstanceId,
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

  const handleLockCard = async (cardIndex: number) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/lock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          cardIndex,
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
    if (selected.length !== 6) {
      setError(`必须选择6个能力 (当前${selected.length}个)`);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/game/draft/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "确认失败");
        return;
      }

      // Finalization successful - refetch parent state
      if (onStateChange) {
        await onStateChange();
      }
      // Then call parent handler
      await onFinalizeDraft();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>第 {tournament.battleNumber} 场战斗</h1>
        <div className={styles.gameHp}>
          <span>🏥 竞技场血量: {tournament.gameHp[selfUserId]}</span>
        </div>
      </div>

      <div className={styles.mainLayout}>
        {/* Left: Shop */}
        <DraftShop
          shop={shop}
          cardMap={cardMap}
          onSelectCard={handleSelectCard}
          onLockCard={handleLockCard}
          loading={loading}
        />

        {/* Center: Selected Abilities */}
        <div className={styles.centerPanel}>
          <SelectedAbilities selected={selected} cardMap={cardMap} />
          
          {selected.length > 0 && (
            <div className={styles.moveToSelectText}>
              ← 从备战区移过来
            </div>
          )}
        </div>

        {/* Right: Economy & Controls */}
        <div className={styles.rightPanel}>
          <DraftEconomy eco={eco} battleNumber={tournament.battleNumber} />

          <div className={styles.buttonGroup}>
            <button
              className={styles.refreshBtn}
              onClick={handleRefreshShop}
              disabled={loading || eco.gold < 1}
            >
              🔄 刷新 (1金币)
            </button>

            <button
              className={`${styles.benchBtn}`}
              disabled={true}
              title="备战区最多12个能力"
            >
              📦 备战区 {bench.length}/12
            </button>
          </div>

          {selected.length === 6 && (
            <button
              className={styles.finalizeBtn}
              onClick={handleFinalize}
              disabled={loading}
            >
              ✓ 确认出战 {loading ? "..." : ""}
            </button>
          )}

          {error && <div className={styles.error}>{error}</div>}
          {selected.length > 0 && (
            <div className={styles.progress}>
              已选 {selected.length} / 6
            </div>
          )}
        </div>
      </div>

      {/* Bench Area */}
      <BenchArea
        bench={bench}
        cardMap={cardMap}
        onMoveToSelected={(cardInstanceId) => handleMoveCard(cardInstanceId, "bench", "selected")}
        onSell={handleSellCard}
        loading={loading}
        fullSlots={bench.length}
      />
    </div>
  );
}
