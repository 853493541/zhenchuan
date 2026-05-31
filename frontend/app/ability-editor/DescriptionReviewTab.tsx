"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  DescriptionReviewStatus,
  getAbilityIconByName,
  getBuffIconPath,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

type ReviewEntry = {
  key: string;
  name: string;
  description: string;
  status: DescriptionReviewStatus;
  iconPath: string;
  subtitle?: string;
};

interface Props<TEntry> {
  kind: "ability" | "buff";
  entries: TEntry[];
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onStatusChange: (entry: TEntry, status: DescriptionReviewStatus) => Promise<void>;
  onDescriptionChange: (entry: TEntry, description: string) => Promise<void>;
  toReviewEntry: (entry: TEntry) => ReviewEntry;
  searchStorageKey: string;
  loadingText: string;
}

export default function DescriptionReviewTab<TEntry>({
  kind,
  entries,
  loading,
  errorMessage,
  onRetry,
  onStatusChange,
  onDescriptionChange,
  toReviewEntry,
  searchStorageKey,
  loadingText,
}: Props<TEntry>) {
  const [search, setSearch] = usePersistentState(searchStorageKey, "");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const reviewEntries = useMemo(() => entries.map((entry) => ({ raw: entry, review: toReviewEntry(entry) })), [entries, toReviewEntry]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) return reviewEntries;
    return reviewEntries.filter(({ review }) => [review.name, review.description, review.subtitle ?? ""].join(" ").toLowerCase().includes(normalizedSearch));
  }, [normalizedSearch, reviewEntries]);

  const needsMore = filteredEntries.filter(({ review }) => review.status === "needs-more");
  const unfixed = filteredEntries.filter(({ review }) => review.status === "unfixed");
  const fixed = filteredEntries.filter(({ review }) => review.status === "fixed");

  async function handleStatus(entry: TEntry, review: ReviewEntry, status: DescriptionReviewStatus, description: string) {
    setBusyKey(review.key);
    try {
      if (description !== review.description) {
        await onDescriptionChange(entry, description);
      }
      await onStatusChange(entry, status);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <div className={styles.statePanel}>{loadingText}</div>;
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
            placeholder={kind === "ability" ? "搜索技能名称或描述" : "搜索气劲名称、来源或描述"}
            style={{ maxWidth: 340 }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <Column title={`需要补充 (${needsMore.length})`} background="#fff7e8" color="#9a5b16" border="#e7bc75">
          {needsMore.length === 0 ? <EmptyState text="当前没有需要补充的条目" /> : needsMore.map(({ raw, review }) => (
            <ReviewRow key={review.key} entry={review} disabled={busyKey === review.key} onStatus={(status, description) => handleStatus(raw, review, status, description)} actions={[
              { label: "未修正", status: "unfixed", tint: "#7a6e62" },
              { label: "已修正", status: "fixed", tint: "#236f31" },
            ]} />
          ))}
        </Column>

        <Column title={`未修正 (${unfixed.length})`} background="#f4f1eb" color="#7a6e62" border="#e4ddd4">
          {unfixed.length === 0 ? <EmptyState text="当前没有未修正的条目" /> : unfixed.map(({ raw, review }) => (
            <ReviewRow key={review.key} entry={review} disabled={busyKey === review.key} onStatus={(status, description) => handleStatus(raw, review, status, description)} actions={[
              { label: "需要补充", status: "needs-more", tint: "#c8302d" },
              { label: "已修正", status: "fixed", tint: "#236f31" },
            ]} />
          ))}
        </Column>

        <Column title={`已修正 (${fixed.length})`} background="#eef8f0" color="#236f31" border="#9ed5a8">
          {fixed.length === 0 ? <EmptyState text="当前没有已修正的条目" /> : fixed.map(({ raw, review }) => (
            <ReviewRow key={review.key} entry={review} disabled={busyKey === review.key} onStatus={(status, description) => handleStatus(raw, review, status, description)} actions={[
              { label: "需要补充", status: "needs-more", tint: "#c8302d" },
              { label: "未修正", status: "unfixed", tint: "#7a6e62" },
            ]} />
          ))}
        </Column>
      </div>
    </div>
  );
}

type RowAction = { label: string; status: DescriptionReviewStatus; tint: string };

function ReviewRow({ entry, disabled, onStatus, actions }: { entry: ReviewEntry; disabled: boolean; onStatus: (status: DescriptionReviewStatus, description: string) => Promise<void>; actions: RowAction[] }) {
  const [draft, setDraft] = useState(entry.description);
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid #f0ece6" }}>
      <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
        <img src={entry.iconPath} alt={entry.name} style={{ width: 30, height: 30, borderRadius: 6, objectFit: "contain", flexShrink: 0 }} draggable={false} loading="lazy" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#211d18", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</div>
            <CopyNameButton value={entry.name} />
          </div>
          {entry.subtitle && <div style={{ marginTop: 2, fontSize: 11, color: "#8a7f73", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.subtitle}</div>}
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={4}
        style={{
          width: "100%",
          marginTop: 8,
          resize: "vertical",
          borderRadius: 6,
          border: "1px solid #ded6ca",
          background: "#fffdf9",
          color: "#211d18",
          fontSize: 12,
          lineHeight: 1.45,
          padding: "7px 8px",
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {actions.map((action) => (
          <button key={action.status} type="button" disabled={disabled} onClick={() => void onStatus(action.status, draft)} style={buttonStyle(action.tint, disabled, action.status)}>
            <span aria-hidden="true" style={statusIconStyle(action.status, action.tint, disabled)}>
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

export function abilityToReviewEntry(entry: { id: string; name: string; description: string; status: DescriptionReviewStatus }): ReviewEntry {
  return {
    key: entry.id,
    name: entry.name,
    description: entry.description,
    status: entry.status,
    iconPath: getAbilityIconByName(entry.name),
  };
}

export function buffToReviewEntry(entry: { buffId: number; name: string; description: string; status: DescriptionReviewStatus; category: "BUFF" | "DEBUFF"; iconPath?: string; iconMissing?: boolean; sourceAbilityName?: string }): ReviewEntry {
  return {
    key: String(entry.buffId),
    name: entry.name,
    description: entry.description,
    status: entry.status,
    iconPath: getBuffIconPath(entry),
    subtitle: entry.sourceAbilityName ? `来源: ${entry.sourceAbilityName}` : entry.category,
  };
}