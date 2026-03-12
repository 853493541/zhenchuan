"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import GameBoard from "./components/GameBoard";
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
      toastError("你被沉默，无法出牌");
      break;
    case "ERR_CONTROLLED":
      toastError("你被控制，无法出牌");
      break;
    case "ERR_TARGET_UNTARGETABLE":
      toastError("目标无法选中");
      break;
    case "ERR_CARD_NOT_IN_HAND":
      toastError("这张牌不在你的手牌中");
      break;
    case "ERR_GAME_OVER":
      toastError("对局已经结束");
      break;
    case "ERR_NOT_AUTHENTICATED":
      toastError("登录状态失效，请重新进入");
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
  } = useGameState(gameId, selfUserId, authToken);

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

  console.log("[InGameClient] Tournament state:", {
    tournament: tournament ? { phase: tournament.phase, battleNumber: tournament.battleNumber } : null,
    loading,
    hasState: !!state,
    hasMe: !!me,
    hasOpponent: !!opponent,
    hasPreload: !!preload,
  });

  if (tournament && tournament.phase === "DRAFT") {
    console.log("[InGameClient] Showing DRAFT screen");
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

  console.log("[InGameClient] Rendering BATTLE, player hand cards:", {
    myHandSize: me?.hand?.length || 0,
    opponentHandSize: opponent?.hand?.length || 0,
    myCards: me?.hand?.map((c) => ({ cardId: c.cardId, cooldown: c.cooldown })),
  });

  return (
    <GamePreloadProvider value={preload}>
      <GameBoard
        me={me}
        opponent={opponent}
        events={state.events}
        isMyTurn={isMyTurn}
        currentTurn={state.turn}
        rtt={rtt}
        onPlayCard={async (card) => {
          const res = await playCard(card);
          if (!res.ok && res.error) {
            showGameError(res.error);
          }
        }}
        onEndTurn={async () => {
          const res = await endTurn();
          if (!res.ok && res.error) {
            showGameError(res.error);
          }
        }}
      />

      {state.gameOver && (
        <GameOverModal
          isWinner={isWinner}
          onExit={() => router.push("/game")}
        />
      )}
    </GamePreloadProvider>
  );
}
