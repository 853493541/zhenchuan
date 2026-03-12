"use client";

import styles from "./styles.module.css";

import OpponentArea from "./components/OpponentArea";
import PlayerArea from "./components/PlayerArea";
import CurrentAction from "./components/CurrentAction";
import ActionHistory from "./components/ActionHistory";
import EndTurn from "./components/EndTurn";
import NetworkIndicator from "../NetworkIndicator";

import type {
  CardInstance,
  PlayerState,
  GameEvent,
} from "@/app/game/screens/in-game/types";

type Props = {
  me: PlayerState;
  opponent: PlayerState;
  events: GameEvent[];
  isMyTurn: boolean;
  onPlayCard: (card: CardInstance) => void;
  onEndTurn: () => void;
  currentTurn: number;
  rtt?: number | null;
};

export default function GameBoard({
  me,
  opponent,
  events,
  isMyTurn,
  onPlayCard,
  onEndTurn,
  currentTurn,
  rtt,
}: Props) {
  return (
    <div className={styles.boardRoot}>
      <NetworkIndicator rtt={rtt} />
      <div className={styles.board}>
        {/* 🟥 OPPONENT AREA */}
        <div className={styles.region}>
          <OpponentArea opponent={opponent} currentTurn={currentTurn} />
        </div>

        {/* 🟨 ARENA */}
        <div className={styles.region}>
          <CurrentAction events={events} myUserId={me.userId} />
        </div>

        {/* 🟩 PLAYER AREA */}
        <div className={styles.region}>
          <PlayerArea
            me={me}
            currentTurn={currentTurn}
            isMyTurn={isMyTurn}
            onPlayCard={onPlayCard}
          />
        </div>

        {/* 🟦 HISTORY */}
        <div className={styles.historyOverlay}>
          <ActionHistory events={events} myUserId={me.userId} />
        </div>

        {/* 🔘 END TURN */}
        <div className={styles.endturnOverlay}>
          <EndTurn isMyTurn={isMyTurn} onEndTurn={onEndTurn} />
        </div>
      </div>
    </div>
  );
}
