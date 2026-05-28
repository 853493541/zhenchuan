"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  AbilityCooldownReviewEntry,
  DescriptionReviewStatus,
  getAbilityIconByName,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

interface Props {
  entries: AbilityCooldownReviewEntry[];
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onStatusChange: (entry: AbilityCooldownReviewEntry, status: DescriptionReviewStatus) => Promise<void>;
  onCooldownChange: (entry: AbilityCooldownReviewEntry, cooldownTicks: number) => Promise<void>;
}

type RowAction = { label: string; status: DescriptionReviewStatus; tint: string };

function ticksToSecondsText(ticks: number) {
  const seconds = Math.max(0, Number(ticks ?? 0)) / 30;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function secondsTextToTicks(value: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.max(0, Math.round(seconds * 30));
}

function filterDecimalInput(value: string) {
  const stripped = value.replace(/[^0-9.]/g, "");
  const firstDot = stripped.indexOf(".");
  if (firstDot === -1) return stripped;
  return `${stripped.slice(0, firstDot + 1)}${stripped.slice(firstDot + 1).replace(/\./g, "")}`;
}

export default function CooldownReviewTab({ entries, loading, errorMessage, onRetry, onStatusChange, onCooldownChange }: Props) {
  const [search, setSearch] = usePersistentState("abilityEditor.cooldownReview.search", "");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) return entries;
    return entries.filter((entry) => [entry.name, entry.description].join(" ").toLowerCase().includes(normalizedSearch));
  }, [entries, normalizedSearch]);

  const needsMore = filteredEntries.filter((entry) => entry.status === "needs-more");
  const unfixed = filteredEntries.filter((entry) => entry.status === "unfixed");
  const fixed = filteredEntries.filter((entry) => entry.status === "fixed");

  async function handleStatus(entry: AbilityCooldownReviewEntry, status: DescriptionReviewStatus, cooldownSecondsText: string) {
    const cooldownTicks = secondsTextToTicks(cooldownSecondsText);
    if (cooldownTicks === null) return;
    setBusyKey(entry.id);
    try {
      if (cooldownTicks !== entry.cooldownTicks) {
        await onCooldownChange(entry, cooldownTicks);
      }
      await onStatusChange(entry, status);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <div className={styles.statePanel}>正在加载 CD纠正列表…</div>;
  if (errorMessage) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.stateTitle}>加载失败</p>
        <p className={styles.stateCopy}>{errorMessage}</p>
        <button className={styles.retryButton} onClick={onRetry}>重新加载</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1420, margin: "0 auto", paddingTop: 16 }}>
      <div className={styles.rarityFilterBar}>
        <div className={styles.tagFilterRow}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.searchInput}
            placeholder="搜索技能名称或描述"
            style={{ maxWidth: 340 }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <Column title={`需要补充 (${needsMore.length})`} background="#fff7e8" color="#9a5b16" border="#e7bc75">
          {needsMore.length === 0 ? <EmptyState text="当前没有需要补充的条目" /> : needsMore.map((entry) => (
            <ReviewRow key={entry.id} entry={entry} disabled={busyKey === entry.id} onStatus={(status, value) => handleStatus(entry, status, value)} actions={[
              { label: "未修正", status: "unfixed", tint: "#7a6e62" },
              { label: "已修正", status: "fixed", tint: "#236f31" },
            ]} />
          ))}
        </Column>

        <Column title={`未修正 (${unfixed.length})`} background="#f4f1eb" color="#7a6e62" border="#e4ddd4">
          {unfixed.length === 0 ? <EmptyState text="当前没有未修正的条目" /> : unfixed.map((entry) => (
            <ReviewRow key={entry.id} entry={entry} disabled={busyKey === entry.id} onStatus={(status, value) => handleStatus(entry, status, value)} actions={[
              { label: "需要补充", status: "needs-more", tint: "#c8302d" },
              { label: "已修正", status: "fixed", tint: "#236f31" },
            ]} />
          ))}
        </Column>

        <Column title={`已修正 (${fixed.length})`} background="#eef8f0" color="#236f31" border="#9ed5a8">
          {fixed.length === 0 ? <EmptyState text="当前没有已修正的条目" /> : fixed.map((entry) => (
            <ReviewRow key={entry.id} entry={entry} disabled={busyKey === entry.id} onStatus={(status, value) => handleStatus(entry, status, value)} actions={[
              { label: "需要补充", status: "needs-more", tint: "#c8302d" },
              { label: "未修正", status: "unfixed", tint: "#7a6e62" },
            ]} />
          ))}
        </Column>
      </div>
    </div>
  );
}

function ReviewRow({ entry, disabled, onStatus, actions }: { entry: AbilityCooldownReviewEntry; disabled: boolean; onStatus: (status: DescriptionReviewStatus, cooldownSecondsText: string) => Promise<void>; actions: RowAction[] }) {
  const [draftSeconds, setDraftSeconds] = useState(ticksToSecondsText(entry.cooldownTicks));
  const invalid = secondsTextToTicks(draftSeconds) === null;

  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid #f0ece6" }}>
      <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
        <img src={getAbilityIconByName(entry.name)} alt={entry.name} style={{ width: 30, height: 30, borderRadius: 6, objectFit: "contain", flexShrink: 0 }} draggable={false} loading="lazy" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#211d18", lineHeight: 1.2, overflow: "hidden", whiteSpace: "nowrap" }}>{entry.name}</div>
            <CopyNameButton value={entry.name} />
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: "#8a7f73", overflow: "hidden", whiteSpace: "nowrap" }}>原始 {ticksToSecondsText(entry.baseCooldownTicks)} 秒</div>
        </div>
      </div>
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#6f6255", fontSize: 12, fontWeight: 800 }}>冷却秒</span>
        <input
          type="text"
          inputMode="decimal"
          value={draftSeconds}
          onChange={(event) => setDraftSeconds(filterDecimalInput(event.target.value))}
          style={{
            minWidth: 0,
            height: 30,
            borderRadius: 6,
            border: invalid ? "1px solid #c8302d" : "1px solid #ded6ca",
            background: "#fffdf9",
            color: "#211d18",
            fontSize: 13,
            fontWeight: 800,
            padding: "0 8px",
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            MozAppearance: "textfield",
          } as CSSProperties}
        />
      </div>
      <div style={{ marginTop: 7, color: "#7e7469", fontSize: 12, lineHeight: 1.45, maxHeight: 52, overflow: "hidden" }}>{entry.description}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {actions.map((action) => (
          <button key={action.status} type="button" disabled={disabled || invalid} onClick={() => void onStatus(action.status, draftSeconds)} style={buttonStyle(action.tint, disabled || invalid, action.status)}>
            <span aria-hidden="true" style={statusIconStyle(action.status, action.tint, disabled || invalid)}>
              {action.status === "fixed" ? "✓" : action.status === "needs-more" ? "X" : ""}
            </span>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function buttonStyle(tint: string, disabled: boolean, status: DescriptionReviewStatus): CSSProperties {
  return {
    minHeight: 28,
    borderRadius: 6,
    border: `1px solid ${tint}`,
    background: disabled ? "#ddd" : status === "fixed" ? "rgba(35, 111, 49, 0.08)" : status === "needs-more" ? "rgba(200, 48, 45, 0.08)" : "transparent",
    color: disabled ? "#777" : tint,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 800,
    padding: "4px 9px",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function statusIconStyle(status: DescriptionReviewStatus, tint: string, disabled: boolean): CSSProperties {
  return {
    width: 14,
    height: 14,
    borderRadius: 3,
    border: `1.5px solid ${disabled ? "#888" : tint}`,
    background: status === "fixed"
      ? (disabled ? "#cfcfcf" : "rgba(35, 111, 49, 0.16)")
      : status === "needs-more"
        ? (disabled ? "#cfcfcf" : "rgba(200, 48, 45, 0.16)")
        : "transparent",
    color: disabled ? "#777" : tint,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: status === "needs-more" ? 10 : 11,
    fontWeight: 900,
    lineHeight: 1,
    flexShrink: 0,
  };
}

function Column({ title, background, color, border, children }: { title: string; background: string; color: string; border: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ padding: "8px 14px", background, borderRadius: "8px 8px 0 0", fontWeight: 800, fontSize: 13, color, borderBottom: `2px solid ${border}` }}>{title}</div>
      <div style={{ border: `1px solid ${border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background: "#fff", maxHeight: 720, overflowY: "auto" }}>{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>{text}</div>;
}