/**
 * DraftScreen - Main screen during draft phase
 * Shows shop, selection, gold/level
 */

"use client";

import { useState, useEffect } from "react";
import type { TournamentState, CardInstance } from "../types";
import DraftShop from "./DraftShop";
import SelectedAbilities from "./SelectedAbilities";
import DraftEconomy from "./DraftEconomy";
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

  if (!eco || !shop || !selected) {
    return <div className={styles.error}>Draft state missing</div>;
  }

  const handleSelectCard = async (cardInstance: CardInstance) => {
    if (selected.length >= 6) {
      setError("Already selected 6 abilities");
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to select");
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

  const handleRefreshShop = async () => {
    if (eco.gold < 1) {
      setError("Not enough gold to refresh");
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
        setError(data.error || "Failed to refresh");
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
        setError(data.error || "Failed to lock card");
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
      setError(`Must select exactly 6 abilities (currently ${selected.length})`);
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
        setError(data.error || "Failed to finalize");
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
        <h1>Battle {tournament.battleNumber}</h1>
        <div className={styles.gameHp}>
          <span>Tournament HP: {tournament.gameHp[selfUserId]}</span>
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
        <SelectedAbilities selected={selected} cardMap={cardMap} />

        {/* Right: Economy */}
        <div className={styles.rightPanel}>
          <DraftEconomy eco={eco} battleNumber={tournament.battleNumber} />

          <button
            className={styles.refreshBtn}
            onClick={handleRefreshShop}
            disabled={loading || eco.gold < 1}
          >
            Refresh (1 gold)
          </button>

          {selected.length === 6 && (
            <button
              className={styles.finalizeBtn}
              onClick={handleFinalize}
              disabled={loading}
            >
              Finalize Draft {loading ? "..." : ""}
            </button>
          )}

          {error && <div className={styles.error}>{error}</div>}
          {selected.length > 0 && (
            <div className={styles.progress}>
              {selected.length} / 6 selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
