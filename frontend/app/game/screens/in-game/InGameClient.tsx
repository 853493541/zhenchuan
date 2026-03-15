"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

import BattleArena from "./components/BattleArena";
import GameOverModal from "./components/GameBoard/components/GameOverModal";
import DraftScreen from "./components/DraftScreen";
import { toastError } from "@/app/components/toast/toast";
import { useGameState } from "./hooks/useGameState";
import {
  GamePreloadProvider,
} from "./preload/GamePreloadContext";

/* ================= ERROR CODE → TOAST TEXT ================= */
function showGameError(rawCode: string) {
  const code = rawCode?.trim();

  switch (code) {
    case "ERR_NOT_YOUR_TURN":
      toastError("还没轮到你");
      break;
    case "ERR_SILENCED":
      toastError("你被沉默，无法释放技能");
      break;
    case "ERR_CONTROLLED":
      toastError("你被控制，无法行动");
      break;
    case "ERR_TARGET_UNTARGETABLE":
      toastError("目标无法选中");
      break;
    case "ERR_CARD_NOT_IN_HAND":
      toastError("技能不可用");
      break;
    case "ERR_ON_COOLDOWN":
      toastError("这个能力正在冷却");
      break;
    case "ERR_NO_GCD":
      toastError("行动值不足");
      break;
    case "ERR_GAME_OVER":
      toastError("对局已经结束");
      break;
    case "ERR_NOT_AUTHENTICATED":
      toastError("登录状态失效，请重新进入");
      break;
    case "ERR_OUT_OF_RANGE":
      toastError("距离太远，无法释放该能力");
      break;
    case "ERR_TOO_CLOSE":
      toastError("距离太近，无法释放该能力");
      break;
    case "ERR_TARGET_UNAVAILABLE":
      toastError("目标不可选中");
      break;
    default:
      toastError("操作无法执行");
  }
}

/* ================= TYPES ================= */

type GamePreload = {
  cards: any[];
  cardMap: Record<string, any>;
  buffs: any[];
  buffMap: Record<number, any>;
};

type Props = {
  gameId: string;
  selfUserId: string;
  selfUsername: string;
  authToken?: string;
};

/* ================= COMPONENT ================= */

export default function InGameClient({
  gameId,
  selfUserId,
  authToken,
}: Props) {
  const router = useRouter();

  const {
    loading,
    state,
    tournament,
    me,
    opponent,
    isMyTurn,
    isWinner,
    playCard,
    endTurn,
    rtt,
    refetch,
    opponentPositionBufferRef,
  } = useGameState(gameId, selfUserId, authToken);

  // Track if we've already initiated battle to prevent duplicate calls
  const battleInitiatedRef = useRef(false);

  // Reset battleInitiatedRef when phase leaves BATTLE (so next battle can start)
  useEffect(() => {
    if (tournament?.phase !== "BATTLE") {
      battleInitiatedRef.current = false;
    }
  }, [tournament?.phase]);

  // Auto-call /battle/start when phase transitions to BATTLE (only once)
  useEffect(() => {
    if (tournament?.phase === "BATTLE" && state && !loading && !battleInitiatedRef.current) {
      battleInitiatedRef.current = true; // Mark as initiated immediately
      
      const initiateBattle = async () => {
        try {
          console.log("[InGameClient] Initiating battle via /battle/start");
          const res = await fetch("/api/game/battle/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ gameId }),
          });
          
          if (!res.ok) {
            const errText = await res.text();
            console.error("[InGameClient] /battle/start failed:", res.status, errText);
          } else {
            console.log("[InGameClient] ✅ /battle/start succeeded, GameLoop should now be running");
          }
        } catch (err) {
          console.error("[InGameClient] Error calling /battle/start:", err);
        }
      };
      
      initiateBattle();
    }
  }, [tournament?.phase, gameId]); // Only depend on phase and gameId, not state

  // ✉ Poll for phase changes while in DRAFT phase — catches missed WS updates
  // (Robust fallback: even if WS misses the transition broadcast, polling will detect it)
  useEffect(() => {
    if (tournament?.phase !== "DRAFT") return;
    const id = setInterval(() => { refetch(); }, 2000);
    return () => clearInterval(id);
  }, [tournament?.phase, refetch]);

  // ✉ Poll during BATTLE phase to detect when battle ends and phase transitions to DRAFT/GAME_OVER
  useEffect(() => {
    if (tournament?.phase !== "BATTLE") return;
    const id = setInterval(() => { refetch(); }, 3000);
    return () => clearInterval(id);
  }, [tournament?.phase, refetch]);

  /* ================= PRELOAD ================= */

  const [preload, setPreload] = useState<GamePreload | null>(null);
  const [preloadError, setPreloadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPreload() {
      try {
        const res = await fetch("/api/game/preload", {
          credentials: "include",
        });

        if (!res.ok) {
          throw new Error("preload fetch failed");
        }

        const data = await res.json();
        if (!cancelled) {
          setPreload(data);
        }
      } catch (err) {
        console.error("[Preload] failed:", err);
        if (!cancelled) {
          setPreloadError(true);
        }
      }
    }

    loadPreload();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ================= BATTLE INITIALIZATION ================= */

  useEffect(() => {
    if (
      tournament &&
      tournament.phase === "BATTLE" &&
      state &&
      !battleInitiatedRef.current &&
      state.players.some((p: any) => p.hand.length === 0)
    ) {
      battleInitiatedRef.current = true; // guard before async so it never fires twice
      (async () => {
        try {
          console.log("[InGameClient] Initializing battle state...");
          const res = await fetch("/api/game/battle/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ gameId }),
          });

          if (res.ok) {
            console.log("[InGameClient] Battle initialized, refetching state...");
            await new Promise((r) => setTimeout(r, 300));
            refetch();
          } else {
            console.error("[InGameClient] Battle start failed:", res.status);
            battleInitiatedRef.current = false; // allow retry on genuine failure
          }
        } catch (err) {
          console.error("[InGameClient] Battle initialization error:", err);
          battleInitiatedRef.current = false; // allow retry after network error
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.phase, gameId]); // intentionally excludes `state` and `refetch` —
  // state changes 30x/sec from position broadcasts and would re-trigger this every tick

  /* ================= BATTLE COMPLETION ================= */

  useEffect(() => {
    if (
      tournament &&
      tournament.phase === "BATTLE" &&
      state &&
      state.gameOver &&
      state.winnerUserId
    ) {
      // Battle is over, call battle/complete to advance tournament
      (async () => {
        try {
          console.log("[InGameClient] Battle ended, completing tournament battle...");
          const res = await fetch("/api/game/battle/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ gameId }),
          });

          if (res.ok) {
            const result = await res.json();
            console.log("[InGameClient] Battle completed:", result);
            await new Promise((r) => setTimeout(r, 300));
            refetch();
          } else if (res.status === 400) {
            // Already completed by the other player — refetch to get the new DRAFT state
            console.log("[InGameClient] Battle already completed by other player, refetching...");
            await new Promise((r) => setTimeout(r, 500));
            refetch();
          } else {
            console.error("[InGameClient] Battle complete failed:", res.status);
          }
        } catch (err) {
          console.error("[InGameClient] Battle completion error:", err);
        }
      })();
    }
  }, [tournament?.phase, state?.gameOver, state?.winnerUserId, gameId, refetch]);

  /* ================= LOADING ================= */

  if (
    loading ||
    !state ||
    !me ||
    !opponent ||
    !preload ||
    preloadError
  ) {
    return <div>Loading game…</div>;
  }

  /* ================= DRAFT PHASE ================= */

  if (tournament && tournament.phase === "DRAFT") {
    return (
      <DraftScreen
        gameId={gameId}
        selfUserId={selfUserId}
        tournament={tournament}
        cardMap={preload.cardMap}
        onFinalizeDraft={async () => {
          // Finalization API call is handled within DraftScreen
          // Just need to wait for state update via WebSocket
        }}
        onStateChange={refetch}
      />
    );
  }
  
  /* ================= RENDER BATTLE ================= */

  // Only render if we have valid player data
  if (!me || !opponent) {
    return <div>Loading battle state...</div>;
  }

  // Calculate 3D distance between players (includes Z so jumping increases effective range)
  const distance = me?.position && opponent?.position
    ? Math.sqrt(
        Math.pow(opponent.position.x - me.position.x, 2) +
        Math.pow(opponent.position.y - me.position.y, 2) +
        Math.pow((opponent.position.z ?? 0) - (me.position.z ?? 0), 2)
      )
    : 0;

  return (
    <GamePreloadProvider value={preload}>
      <BattleArena
        me={me}
        opponent={opponent}
        gameId={gameId}
        distance={distance}
        maxHp={me.hp + (state.players[1]?.hp || 0) === me.hp ? me.hp : 30} // Fallback to 30
        cards={preload.cardMap}
        opponentPositionBufferRef={opponentPositionBufferRef}
        onCastAbility={async (cardInstanceId) => {
          // Find by instanceId (normal drafted cards) or by cardId (common abilities)
          const cardInstance =
            me.hand.find((c) => c.instanceId === cardInstanceId) ??
            me.hand.find((c) => ((c as any).cardId ?? (c as any).id) === cardInstanceId) ??
            ({ instanceId: cardInstanceId } as any); // synthetic stub — backend validates
          const res = await playCard(cardInstance);
          if (!res.ok && res.error) {
            console.error("[CastAbility] Error response:", res.error);
            showGameError(res.error);
          }
        }}
      />

      {tournament?.phase === "GAME_OVER" && (
        <GameOverModal
          isWinner={isWinner}
          onExit={() => router.push("/game")}
        />
      )}
    </GamePreloadProvider>
  );
}
