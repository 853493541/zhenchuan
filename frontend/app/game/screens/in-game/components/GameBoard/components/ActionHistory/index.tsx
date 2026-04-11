"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./styles.module.css";
import type { GameEvent } from "@/app/game/screens/in-game/types";
import Ability from "../../../Ability";

/* ================= PROPS ================= */

type Props = {
  events: GameEvent[] | undefined | null;
  myUserId: string;
};

/* ================= TOKEN COMPONENTS ================= */

const Skill = ({
  name,
  onHover,
  onLeave,
}: {
  name: string;
  onHover?: () => void;
  onLeave?: () => void;
}) => (
  <span
    className={styles.skill}
    onMouseEnter={onHover}
    onMouseLeave={onLeave}
  >
    [{name}]
  </span>
);

const Buff = ({ name }: { name: string }) => (
  <span className={styles.buff}>[{name}]</span>
);

const Target = ({ name }: { name: string }) => (
  <span className={styles.target}>[{name}]</span>
);

const DamageNum = ({ value }: { value: number }) => (
  <span className={styles.number}>{value}</span>
);

/* ================= RENDERERS ================= */

function renderDamageLine(e: GameEvent, myUserId: string) {
  const isMe = e.actorUserId === myUserId;
  const dmg = e.value ?? 0;

  if (isMe) {
    return (
      <>
        你的<Skill name={e.abilityName!} />对
        <Target name={e.targetName ?? "对手"} />
        造成了<DamageNum value={dmg} />点伤害。
      </>
    );
  }

  return (
    <>
      <Target name={e.actorName ?? "对手"} />的
      <Skill name={e.abilityName!} />
      对你造成了<DamageNum value={dmg} />点伤害。
    </>
  );
}

function renderBuffLine(e: GameEvent, myUserId: string) {
  const isMe = e.targetUserId === myUserId;

  if (e.type === "BUFF_APPLIED") {
    return (
      <>
        {isMe ? "你" : "对手"}获得了效果
        <Buff name={e.buffName!} />。
      </>
    );
  }

  if (e.type === "BUFF_EXPIRED") {
    return (
      <>
        <Buff name={e.buffName!} />
        效果从{isMe ? "你" : "对手"}身上消失了。
      </>
    );
  }

  return null;
}

function renderPlayLine(
  e: GameEvent,
  myUserId: string,
  setHovered: (e: GameEvent | null) => void
) {
  const isMe = e.actorUserId === myUserId;

  return (
    <>
      {isMe ? "你" : <Target name={e.actorName ?? "对手"} />}施放了
      <Skill
        name={e.abilityName ?? "未知技能"}
        onHover={() => setHovered(e)}
        onLeave={() => setHovered(null)}
      />
      。
    </>
  );
}

/* ================= COMPONENT ================= */

export default function ActionHistory({ events, myUserId }: Props) {
  const [tab, setTab] = useState<"damage" | "buff" | "play">("damage");
  const [hovered, setHovered] = useState<GameEvent | null>(null);

  const logBodyRef = useRef<HTMLDivElement | null>(null);

  /* ================= EVENTS ================= */

  const damageEvents = useMemo(() => {
    if (!Array.isArray(events)) return [];
    return events.filter((e) => e.type === "DAMAGE" && e.abilityName).slice(-40);
  }, [events]);

  const buffEvents = useMemo(() => {
    if (!Array.isArray(events)) return [];
    return events
      .filter(
        (e) =>
          (e.type === "BUFF_APPLIED" || e.type === "BUFF_EXPIRED") &&
          e.buffName
      )
      .slice(-40);
  }, [events]);

  const playEvents = useMemo(() => {
    if (!Array.isArray(events)) return [];
    return events.filter((e) => e.type === "PLAY_ABILITY").slice(-40);
  }, [events]);

  /* ================= AUTO SCROLL ================= */

  useEffect(() => {
    const el = logBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [damageEvents, buffEvents, playEvents, tab]);

  /* ================= RENDER ================= */

  return (
    <div className={styles.wrapper}>
      <div className={styles.chatlog}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${
              tab === "damage" ? styles.activeTab : ""
            }`}
            onClick={() => setTab("damage")}
          >
            伤害
          </button>
          <button
            className={`${styles.tab} ${
              tab === "buff" ? styles.activeTab : ""
            }`}
            onClick={() => setTab("buff")}
          >
            状态
          </button>
          <button
            className={`${styles.tab} ${
              tab === "play" ? styles.activeTab : ""
            }`}
            onClick={() => setTab("play")}
          >
            技能
          </button>
        </div>

        <div className={styles.logBody} ref={logBodyRef}>
          {tab === "damage" &&
            (damageEvents.length === 0 ? (
              <div className={styles.emptyText}>暂无伤害记录</div>
            ) : (
              damageEvents.map((e) => (
                <div key={e.id} className={styles.logLine}>
                  {renderDamageLine(e, myUserId)}
                </div>
              ))
            ))}

          {tab === "buff" &&
            (buffEvents.length === 0 ? (
              <div className={styles.emptyText}>暂无状态变化</div>
            ) : (
              buffEvents.map((e) => (
                <div key={e.id} className={styles.logLine}>
                  {renderBuffLine(e, myUserId)}
                </div>
              ))
            ))}

          {tab === "play" &&
            (playEvents.length === 0 ? (
              <div className={styles.emptyText}>暂无技能记录</div>
            ) : (
              playEvents.map((e) => (
                <div key={e.id} className={styles.logLine}>
                  {renderPlayLine(e, myUserId, setHovered)}
                </div>
              ))
            ))}
        </div>
      </div>

      {hovered?.abilityId && (
        <div className={styles.preview}>
          <Ability abilityId={hovered.abilityId} variant="preview" />
        </div>
      )}
    </div>
  );
}
