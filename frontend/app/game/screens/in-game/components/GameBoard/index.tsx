"use client";

import styles from "./styles.module.css";

import OpponentArea from "./components/OpponentArea";
import PlayerArea from "./components/PlayerArea";
import CurrentAction from "./components/CurrentAction";
import ActionHistory from "./components/ActionHistory";
import EndTurn from "./components/EndTurn";
import NetworkIndicator from "../NetworkIndicator";

import type {
  PlayerState,
  GameEvent,
} from "@/app/game/screens/in-game/types";

type Props = {
  me: PlayerState;
  opponent: PlayerState;
  events: GameEvent[];
  isMyTurn: boolean;
  onEndTurn: () => void;
  currentTurn: number;
  rtt?: number | null;
};

export default function GameBoard({
  me,
  opponent,
  events,
  isMyTurn,
  onEndTurn,
  currentTurn: _currentTurn,
  rtt,
}: Props) {
  return (
    <div className={styles.boardRoot}>
      <NetworkIndicator rtt={rtt} />
      <div className={styles.board}>
        {/* 🟥 OPPONENT AREA */}
        <div className={styles.region}>
          <OpponentArea opponent={opponent} currentTurn={0} />
        </div>

        {/* 🟨 ARENA */}
        <div className={styles.region}>
          <CurrentAction events={events} myUserId={me.userId} />
        </div>

        {/* 🟩 PLAYER AREA */}
        <div className={styles.region}>
          <PlayerArea
            me={me}
            isMyTurn={isMyTurn}
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
