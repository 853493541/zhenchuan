"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Home } from "lucide-react";
import styles from "./styles.module.css";

import BattleArena from "./components/BattleArena";
import GameOverModal from "./components/GameBoard/components/GameOverModal";
import DraftScreen from "./components/DraftScreen";
import { toastError, toastSuccess } from "@/app/components/toast/toast";
import { useGameState } from "./hooks/useGameState";
import {
  GamePreloadProvider,
} from "./preload/GamePreloadContext";

const LEGACY_STORED_UNIT_SCALE = 2.2;

function getStoredUnitScale(mode?: string): number {
  return mode === 'collision-test' ? 1 : LEGACY_STORED_UNIT_SCALE;
}

/* ================= ERROR CODE → TOAST TEXT ================= */
function showGameError(rawCode: string) {
  const code = rawCode?.trim();

  switch (code) {
    case "ERR_CHANNELING":
      toastError("正在进行其他动作");
      break;
    case "ERR_NOT_YOUR_TURN":
      toastError("还没轮到你");
      break;
    case "ERR_SILENCED":
      toastError("经脉受损，无法运功");
      break;
    case "ERR_DISARMED":
      toastError("你被缴械，无法施展需要武器的招式");
      break;
    case "ERR_NON_QINGGONG_LOCKED":
      toastError("你当前只能施展轻功招式");
      break;
    case "ERR_DISPLACEMENT":
      toastError("该招式无法在位移时施展");
      break;
    case "ERR_KNOCKED_BACK":
      toastError("你被击退，无法行动");
      break;
    case "ERR_PULLED":
      toastError("你被拉拽，无法行动");
      break;
    case "ERR_CONTROLLED":
      toastError("你被控制，无法行动");
      break;
    case "ERR_ROOTED":
      toastError("你被锁足，无法施展该招式");
      break;
    case "ERR_TARGET_UNTARGETABLE":
      toastError("目标无法选中");
      break;
    case "ERR_ABILITY_NOT_IN_HAND":
      toastError("技能不可用");
      break;
    case "ERR_ABILITY_NOT_FOUND":
      toastError("技能配置不存在");
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
      toastError("当前气血不足，无法施放");
      break;
    case "ERR_TARGET_HP_TOO_HIGH":
      toastError("目标气血过高，无法施放");
      break;
    case "ERR_BLOCKED_BY_BUFF":
      toastError("该招式被当前气劲阻止");
      break;
    case "ERR_INVALID_PAYLOAD":
      toastError("请求参数无效");
      break;
    case "ERR_BATTLE_NOT_IN_PROGRESS":
      toastError("战斗尚未开始");
      break;
    case "ERR_GAME_LOOP":
      toastError("战斗同步异常，请稍后重试");
      break;
    case "ERR_NOT_IN_GAME":
      toastError("你不在这个对局中");
      break;
    case "ERR_PICKUP_TOO_FAR":
    case "ERR_PICKUP_CLAIM_TOO_FAR":
      toastError("距离太远，无法拾取");
      break;
    case "ERR_PICKUP_NOT_FOUND":
      toastError("可拾取物不存在或已被拾取");
      break;
    case "ERR_PICKUP_HAND_FULL":
      toastError("只能拾取6个技能");
      break;
    case "ERR_CONSUMABLE_COOLDOWN":
      toastError("物品尚未冷却");
      break;
    case "ERR_CONSUMABLE_IN_COMBAT":
      toastError("战斗中无法使用该物品");
      break;
    case "ERR_CONSUMABLE_CONTROLLED":
      toastError("受控状态无法使用");
      break;
    case "ERR_CONSUMABLE_DASHING":
      toastError("位移中无法使用");
      break;
    case "ERR_CONSUMABLE_NOT_FOUND":
      toastError("物品配置不存在");
      break;
    case "ERR_CONSUMABLE_NOT_IMPLEMENTED":
      toastError("该物品暂未开放");
      break;
    case "ERR_NO_LINE_OF_SIGHT":
      toastError("目标不在视线范围内");
      break;
    case "ERR_INTERNAL":
      toastError("服务器处理失败");
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
    loadError,
    disconnectPrompt,
    state,
    tournament,
    gameMode,
    me,
    opponent,
    opponents,
    isMyTurn,
    isWinner,
    playAbility,
    cancelBuff,
    cancelChannel,
    useConsumable,
    updateTargetSelection,
    endTurn,
    rtt,
    refetch,
    clearDisconnectPrompt,
    opponentPositionBufferRef,
  } = useGameState(gameId, selfUserId, authToken);

  const hasState = !!state;

  // Track if we've already initiated battle to prevent duplicate calls
  const battleInitiatedRef = useRef(false);
  const battleCompletionHandledRef = useRef<string | null>(null);
  const leaveNoticeHandledRef = useRef<string | null>(null);
  const disconnectAutoLeaveKeyRef = useRef<string | null>(null);
  const [disconnectCountdown, setDisconnectCountdown] = useState(5);
  const [dismissedLeaveNoticeKey, setDismissedLeaveNoticeKey] = useState<string | null>(null);

  const leaveNotice = state?.leaveNotice;
  const leaveNoticeKey = leaveNotice ? `${leaveNotice.userId}:${leaveNotice.endsAt}` : null;
  const exitPrompt = useMemo(() => {
    if (disconnectPrompt) {
      return { ...disconnectPrompt, reason: "disconnected" as const };
    }
    if (!leaveNotice || leaveNotice.userId === selfUserId || dismissedLeaveNoticeKey === leaveNoticeKey) {
      return null;
    }
    return {
      userId: leaveNotice.userId,
      username: leaveNotice.username || "Opponent",
      endsAt: leaveNotice.endsAt,
      reason: "left" as const,
    };
  }, [disconnectPrompt, dismissedLeaveNoticeKey, leaveNotice, leaveNoticeKey, selfUserId]);

  const leaveGameAndReturnHome = async (source: string) => {
    clearDisconnectPrompt();
    try {
      const res = await fetch('/api/game/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[${source}] /game/end failed:`, res.status, text);
      }
    } catch (err) {
      console.error(`[${source}] /game/end failed:`, err);
    }
    router.replace('/');
  };

  const leaveAfterDisconnectPrompt = async () => {
    if (!exitPrompt) return;
    const promptKey = `${exitPrompt.reason}:${exitPrompt.userId}:${exitPrompt.endsAt}`;
    if (disconnectAutoLeaveKeyRef.current === promptKey) return;
    disconnectAutoLeaveKeyRef.current = promptKey;
    await leaveGameAndReturnHome(exitPrompt.reason === "left" ? 'LeaveNoticePrompt' : 'DisconnectPrompt');
  };

  const dismissExitPrompt = () => {
    if (disconnectPrompt) clearDisconnectPrompt();
    if (leaveNoticeKey) setDismissedLeaveNoticeKey(leaveNoticeKey);
  };

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

  useEffect(() => {
    if (tournament?.phase !== "BATTLE" || !state?.gameOver || !state?.winnerUserId) {
      battleCompletionHandledRef.current = null;
    }
  }, [tournament?.phase, tournament?.battleNumber, state?.gameOver, state?.winnerUserId]);

  useEffect(() => {
    if (!loadError) return;
    if (["ERR_NOT_FOUND", "ERR_NOT_IN_GAME", "ERR_BATTLE_NOT_IN_PROGRESS", "Game not found"].includes(loadError)) {
      router.replace("/game");
    }
  }, [loadError, router]);

  useEffect(() => {
    if (state?.gameOver && !state?.winnerUserId) {
      router.replace("/game");
    }
  }, [router, state?.gameOver, state?.winnerUserId]);

  useEffect(() => {
    const notice = state?.leaveNotice;
    if (!notice) {
      leaveNoticeHandledRef.current = null;
      setDismissedLeaveNoticeKey(null);
      return;
    }
    if (notice.userId === selfUserId) return;

    const noticeKey = `${notice.userId}:${notice.endsAt}`;
    if (leaveNoticeHandledRef.current === noticeKey) return;
    leaveNoticeHandledRef.current = noticeKey;
  }, [selfUserId, state?.leaveNotice]);

  useEffect(() => {
    if (!exitPrompt) {
      setDisconnectCountdown(5);
      disconnectAutoLeaveKeyRef.current = null;
      return;
    }

    const updateCountdown = () => {
      setDisconnectCountdown(Math.max(0, Math.ceil((exitPrompt.endsAt - Date.now()) / 1000)));
    };
    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(intervalId);
  }, [exitPrompt]);

  useEffect(() => {
    if (!exitPrompt || disconnectCountdown > 0) return;
    void leaveAfterDisconnectPrompt();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitPrompt, disconnectCountdown]);

  // Auto-call /battle/start when phase transitions to BATTLE (only once)
  useEffect(() => {
    if (tournament?.phase === "BATTLE" && hasState && !loading && !battleInitiatedRef.current) {
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
  }, [tournament?.phase, tournament?.battleNumber, gameId, hasState, loading, refetch]);

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
      const battleCompletionKey = `${tournament.battleNumber ?? "battle"}:${state.winnerUserId}`;
      if (battleCompletionHandledRef.current === battleCompletionKey) {
        return;
      }
      battleCompletionHandledRef.current = battleCompletionKey;

      let cancelled = false;

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
          if (cancelled) return;
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
            if (!cancelled) {
              refetch();
            }
          } else if (res.status === 400) {
            // Already completed by the other player — refetch to get the new DRAFT state
            console.log("[InGameClient] Battle already completed by other player, refetching...");
            await new Promise((r) => setTimeout(r, 500));
            if (!cancelled) {
              refetch();
            }
          } else {
            console.error("[InGameClient] Battle complete failed:", res.status);
            battleCompletionHandledRef.current = null;
          }
        } catch (err) {
          console.error("[InGameClient] Battle completion error:", err);
          battleCompletionHandledRef.current = null;
        }
      })();

      return () => {
        cancelled = true;
      };
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

  // Calculate 3D distance to nearest opponent in new world units.
  const distance = (() => {
    const storedUnitScale = getStoredUnitScale(gameMode);
    let minDist = 0;
    for (const opp of opponents) {
      if (!me?.position || !opp?.position) continue;
      const d = Math.sqrt(
        Math.pow(opp.position.x - me.position.x, 2) +
        Math.pow(opp.position.y - me.position.y, 2) +
        Math.pow((opp.position.z ?? 0) - (me.position.z ?? 0), 2)
      ) / storedUnitScale;
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
      <>
        <button
          type="button"
          className={styles.homeButton}
          aria-label="首页"
          title="首页"
          onClick={() => void leaveGameAndReturnHome('InGameHomeButton')}
        >
          <Home size={27} strokeWidth={2.4} aria-hidden="true" />
        </button>

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
          entities={state?.entities}
          opponentPositionBufferRef={opponentPositionBufferRef}
          mode={gameMode ?? 'arena'}
          onLeaveGame={() => leaveGameAndReturnHome('EscExitButton')}
          onMovementRecover={refetch}
          onCastAbility={async (abilityInstanceId, targetUserId, groundTarget, entityTargetId, movementIntent) => {
            // Find by instanceId (normal drafted abilities) or by abilityId (common abilities)
            const cardInstance =
              me.hand.find((c) => c.instanceId === abilityInstanceId) ??
              me.hand.find((c) => ((c as any).abilityId ?? (c as any).id) === abilityInstanceId) ??
              ({ instanceId: abilityInstanceId } as any); // synthetic stub — backend validates
            const res = await playAbility(cardInstance, targetUserId, groundTarget, entityTargetId, movementIntent);
            if (!res.ok && res.error) {
              console.error("[CastAbility] Error response:", res.error);
              if (res.error === "ERR_BATTLE_NOT_IN_PROGRESS" || res.error === "ERR_NOT_IN_GAME") {
                router.replace("/game");
                return;
              }
              showGameError(res.error);
            }
          }}
          onCancelChannel={async () => {
            const res = await cancelChannel();
            if (!res.ok && res.error) {
              if (res.error === "ERR_BATTLE_NOT_IN_PROGRESS" || res.error === "ERR_NOT_IN_GAME") {
                router.replace("/game");
                return;
              }
              showGameError(res.error);
            }
          }}
          onUseConsumable={async (consumableId) => {
            const res = await useConsumable(consumableId);
            if (!res.ok && res.error) {
              if (res.error === "ERR_BATTLE_NOT_IN_PROGRESS" || res.error === "ERR_NOT_IN_GAME") {
                router.replace("/game");
                return;
              }
              showGameError(res.error);
            }
          }}
          onTargetSelection={async (selection) => {
            const res = await updateTargetSelection(selection);
            if (!res.ok && res.error) {
              console.error("[TargetSelection] Error response:", res.error);
            }
          }}
          onCancelBuff={async (buffId, options) => {
            const res = await cancelBuff(buffId, options);
            if (!res.ok && res.error) {
              if (res.error === "ERR_BATTLE_NOT_IN_PROGRESS" || res.error === "ERR_NOT_IN_GAME") {
                router.replace("/game");
                return;
              }
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

        {exitPrompt && (
          <div className={styles.disconnectPromptOverlay} role="dialog" aria-modal="true">
            <div className={styles.disconnectPromptWindow}>
              <div className={styles.disconnectPromptTitle}>{exitPrompt.reason === "left" ? "Player left" : "Player disconnected"}</div>
              <div className={styles.disconnectPromptMessage}>
                {exitPrompt.username || "Opponent"} {exitPrompt.reason === "left" ? "left" : "disconnected"}. Leave and return to home page?
              </div>
              <div className={styles.disconnectPromptCountdown}>
                Auto return in {disconnectCountdown}s
              </div>
              <div className={styles.disconnectPromptActions}>
                <button
                  type="button"
                  className={styles.disconnectPromptButtonSecondary}
                  onClick={dismissExitPrompt}
                >
                  No
                </button>
                <button
                  type="button"
                  className={styles.disconnectPromptButtonPrimary}
                  onClick={() => void leaveAfterDisconnectPrompt()}
                >
                  Yes ({disconnectCountdown}s)
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    </GamePreloadProvider>
  );
}
