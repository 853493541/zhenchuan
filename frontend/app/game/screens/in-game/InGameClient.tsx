"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

import BattleArena from "./components/BattleArena";
import GameOverModal from "./components/GameBoard/components/GameOverModal";
import DraftScreen from "./components/DraftScreen";
import { toastError, toastSuccess } from "@/app/components/toast/toast";
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
    case "ERR_KNOCKED_BACK":
      toastError("你被击退，无法行动");
      break;
    case "ERR_CONTROLLED":
      toastError("你被控制，无法行动");
      break;
    case "ERR_TARGET_UNTARGETABLE":
      toastError("目标无法选中");
      break;
    case "ERR_ABILITY_NOT_IN_HAND":
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
      toastError("警告：目标丢失或不可选中");
      break;
    case "ERR_REQUIRES_GROUNDED":
      toastError("该技能需要落地后施放");
      break;
    case "ERR_REQUIRES_STANDING":
      toastError("该技能需要站立后施放");
      break;
    case "ERR_QINGGONG_SEALED":
      toastError("你被封轻功，无法施放轻功技能");
      break;
    case "ERR_HP_TOO_LOW":
      toastError("当前气血必须大于35才能施放");
      break;
    case "ERR_NO_LINE_OF_SIGHT":
      toastError("目标不在视线范围内");
      break;
    default:
      toastError("操作无法执行");
  }
}

/* ================= TYPES ================= */

type GamePreload = {
  abilities: any[];
  abilityMap: Record<string, any>;
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
    gameMode,
    me,
    opponent,
    opponents,
    isMyTurn,
    isWinner,
    playAbility,
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

  // DRAFT is disabled, so phase can remain BATTLE across rounds.
  // Reset the guard on battle number changes so /battle/start runs for each new round.
  useEffect(() => {
    battleInitiatedRef.current = false;
  }, [tournament?.battleNumber]);

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
            // Refetch state from DB so the frontend gets the freshly-generated pickups
            // (the regular 30Hz loop broadcasts do NOT include /pickups)
            await new Promise((r) => setTimeout(r, 350));
            refetch();
          }
        } catch (err) {
          console.error("[InGameClient] Error calling /battle/start:", err);
        }
      };
      
      initiateBattle();
    }
  }, [tournament?.phase, tournament?.battleNumber, gameId, loading, state, refetch]);

  // No polling — all phase transitions (DRAFT↔BATTLE↔GAME_OVER) are broadcast
  // over WebSocket by the backend (draft/finalize and battle/complete routes).
  // Continuous REST polling was the root cause of stale snapshots corrupting
  // live buff/cooldown state during battle.

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

  /* ================= BATTLE COMPLETION ================= */

  useEffect(() => {
    if (
      tournament &&
      tournament.phase === "BATTLE" &&
      state &&
      state.gameOver &&
      state.winnerUserId
    ) {
      // Show win/lose toast immediately
      if (state.winnerUserId === selfUserId) {
        toastSuccess("🏆 你赢了！");
      } else {
        toastError("💀 你输了，将重新开始…");
      }
      // Battle is over, call battle/complete to advance tournament after delay
      (async () => {
        try {
          // Give player 2.5 s to read the result
          await new Promise((r) => setTimeout(r, 2500));
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
  }, [tournament?.phase, state?.gameOver, state?.winnerUserId, gameId, refetch, selfUserId]);

  /* ================= LOADING ================= */

  if (
    loading ||
    !state ||
    !me ||
    opponents.length === 0 ||
    !preload ||
    preloadError
  ) {
    return <div>Loading game…</div>;
  }

  /* ================= DRAFT PHASE (DISABLED) ================= */
  // Draft phase is currently disabled — game starts directly in BATTLE.
  // Uncomment to re-enable the draft flow.
  /*
  if (tournament && tournament.phase === "DRAFT") {
    return (
      <DraftScreen
        gameId={gameId}
        selfUserId={selfUserId}
        tournament={tournament}
        abilityMap={preload.abilityMap}
        onFinalizeDraft={async () => {
          // Finalization API call is handled within DraftScreen
          // Just need to wait for state update via WebSocket
        }}
        onStateChange={refetch}
      />
    );
  }
  */
  
  /* ================= RENDER BATTLE ================= */

  // Calculate 3D distance to nearest opponent
  const distance = (() => {
    let minDist = 0;
    for (const opp of opponents) {
      if (!me?.position || !opp?.position) continue;
      const d = Math.sqrt(
        Math.pow(opp.position.x - me.position.x, 2) +
        Math.pow(opp.position.y - me.position.y, 2) +
        Math.pow((opp.position.z ?? 0) - (me.position.z ?? 0), 2)
      );
      if (minDist === 0 || d < minDist) minDist = d;
    }
    return minDist;
  })();

  const mePlayer = {
    ...me,
    position: me.position ?? { x: 1000, y: 1000, z: 0 },
  };
  const normalizedOpponents = opponents.map((opp) => ({
    ...opp,
    position: opp.position ?? { x: 1000, y: 1000, z: 0 },
  }));
  const primaryOpponent = (opponent ?? normalizedOpponents[0])
    ? {
        ...(opponent ?? normalizedOpponents[0]),
        position: (opponent ?? normalizedOpponents[0]).position ?? { x: 1000, y: 1000, z: 0 },
      }
    : normalizedOpponents[0];

  return (
    <GamePreloadProvider value={preload}>
      <BattleArena
        me={mePlayer}
        opponent={primaryOpponent}
        opponents={normalizedOpponents}
        gameId={gameId}
        distance={distance}
        maxHp={me.maxHp ?? 100}
        abilities={preload.abilityMap}
        events={state?.events ?? []}
        pickups={state?.pickups ?? []}
        safeZone={state?.safeZone}
        groundZones={state?.groundZones}
        opponentPositionBufferRef={opponentPositionBufferRef}
        mode={gameMode ?? 'arena'}
        onCastAbility={async (abilityInstanceId, targetUserId, groundTarget) => {
          // Find by instanceId (normal drafted abilities) or by abilityId (common abilities)
          const cardInstance =
            me.hand.find((c) => c.instanceId === abilityInstanceId) ??
            me.hand.find((c) => ((c as any).abilityId ?? (c as any).id) === abilityInstanceId) ??
            ({ instanceId: abilityInstanceId } as any); // synthetic stub — backend validates
          const res = await playAbility(cardInstance, targetUserId, groundTarget);
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
