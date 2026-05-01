"use client";

import { useMemo, useState } from "react";

import {
  QinYinGongMingEntry,
  QinYinGongMingSnapshot,
  getBuffIconPath,
  getBuffSubtitle,
} from "./editorShared";
import styles from "./page.module.css";

interface Props {
  snapshot: QinYinGongMingSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onToggle: (buffId: number, mode: "manual-include" | "manual-exclude" | "clear") => Promise<void>;
}

export default function QinYinGongMingTab({ snapshot, loading, errorMessage, onRetry, onToggle }: Props) {
  const [search, setSearch] = useState("");
  const [togglingBuffId, setTogglingBuffId] = useState<number | null>(null);
  const [stealableTab, setStealableTab] = useState<"default" | "special">("default");

  const buffs = snapshot?.buffs ?? [];
  const normalizedSearch = search.trim().toLowerCase();

  const filteredBuffs = useMemo(() => {
    if (!normalizedSearch) return buffs;
    return buffs.filter((entry) =>
      [entry.buffId, entry.name, entry.description, getBuffSubtitle(entry)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [buffs, normalizedSearch]);

  const excludedBuffs = filteredBuffs.filter((entry) => entry.manuallyExcluded && !entry.stealable);
  const undecidedBuffs = filteredBuffs.filter((entry) => !entry.stealable && !entry.manuallyExcluded);
  const stealableBuffs = filteredBuffs.filter((entry) => entry.stealable);
  const defaultStealableBuffs = stealableBuffs.filter((entry) => entry.defaultStealable);
  const specialStealableBuffs = stealableBuffs.filter((entry) => !entry.defaultStealable && entry.manualStealable);
  const visibleStealableBuffs = stealableTab === "default" ? defaultStealableBuffs : specialStealableBuffs;

  async function handleToggle(buffId: number, mode: "manual-include" | "manual-exclude" | "clear") {
    setTogglingBuffId(buffId);
    try {
      await onToggle(buffId, mode);
    } finally {
      setTogglingBuffId(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>正在加载琴音共鸣可偷取气劲…</div>;
  }

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
    <div style={{ maxWidth: 1260, margin: "0 auto", paddingTop: 16 }}>
      <div className={styles.rarityFilterBar}>
        <div className={styles.tagFilterRow}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
            placeholder="搜索 Buff 名称、ID 或描述"
            style={{ maxWidth: 340 }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          marginTop: 16,
          alignItems: "start",
        }}
      >
        <div>
          <SectionHeader
            title={`已声明不可偷取 (${excludedBuffs.length})`}
            background="#fdf1f1"
            color="#8a4040"
            border="#e5b1b1"
          />
          <ListShell border="#e5b1b1" background="#fff8f8">
            {excludedBuffs.length === 0 ? (
              <EmptyState text="当前没有被排除的 Buff" />
            ) : (
              excludedBuffs.map((entry) => (
                <BuffRow
                  key={entry.buffId}
                  entry={entry}
                  disabled={togglingBuffId === entry.buffId}
                  actionLabel="恢复"
                  actionTint="#8a4040"
                  onAction={() => handleToggle(entry.buffId, "clear")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader
            title={`未决定 (${undecidedBuffs.length})`}
            background="#f4f1eb"
            color="#7a6e62"
            border="#e4ddd4"
          />
          <ListShell border="#e4ddd4" background="#ffffff">
            {undecidedBuffs.length === 0 ? (
              <EmptyState text="当前没有未决定的 Buff" />
            ) : (
              undecidedBuffs.map((entry) => (
                <DecisionBuffRow
                  key={entry.buffId}
                  entry={entry}
                  disabled={togglingBuffId === entry.buffId}
                  onDecideCan={() => handleToggle(entry.buffId, "manual-include")}
                  onDecideNo={() => handleToggle(entry.buffId, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader
            title={`琴音共鸣可偷取 (${stealableBuffs.length})`}
            background="#eef5ff"
            color="#264a7a"
            border="#9ec1f0"
          />
          <ListShell border="#9ec1f0" background="#f8fbff">
            <div
              style={{
                display: "flex",
                gap: 8,
                padding: "10px 12px",
                borderBottom: "1px solid #dbe7fa",
                background: "#f4f8ff",
              }}
            >
              <button
                type="button"
                onClick={() => setStealableTab("default")}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${stealableTab === "default" ? "#315c9f" : "#b8cdea"}`,
                  background: stealableTab === "default" ? "#315c9f" : "transparent",
                  color: stealableTab === "default" ? "#fff" : "#315c9f",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                默认列表 ({defaultStealableBuffs.length})
              </button>
              <button
                type="button"
                onClick={() => setStealableTab("special")}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${stealableTab === "special" ? "#236f31" : "#bddcc5"}`,
                  background: stealableTab === "special" ? "#236f31" : "transparent",
                  color: stealableTab === "special" ? "#fff" : "#236f31",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                特殊列表 ({specialStealableBuffs.length})
              </button>
            </div>
            {visibleStealableBuffs.length === 0 ? (
              <EmptyState text={stealableTab === "default" ? "当前没有默认可偷取 Buff" : "当前没有特殊可偷取 Buff"} />
            ) : (
              visibleStealableBuffs.map((entry) => (
                <BuffRow
                  key={entry.buffId}
                  entry={entry}
                  disabled={togglingBuffId === entry.buffId}
                  actionLabel={undefined}
                  actionTint="#305f3d"
                  onAction={undefined}
                />
              ))
            )}
          </ListShell>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "#8a7f6f" }}>
        任何有属性的有利气劲都会自动出现在可偷取列表里。每次进入此页都会从服务器重新读取一次列表，所以后面新增的属性气劲也会自动回来。隐藏 Buff 不会出现在这里；只有未决定列表里的 Buff 需要你手动判定为 NO 或 ✓。
      </p>
    </div>
  );
}

function DecisionBuffRow({
  entry,
  disabled,
  onDecideCan,
  onDecideNo,
}: {
  entry: QinYinGongMingEntry;
  disabled: boolean;
  onDecideCan: () => void;
  onDecideNo: () => void;
}) {
  const subtitle = getBuffSubtitle(entry);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid #f0ece6",
      }}
    >
      <img
        src={getBuffIconPath(entry)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2 }}>
            {entry.name}
          </div>
        </div>

        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {[subtitle, entry.description].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={onDecideCan}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #305f3d",
            background: disabled ? "#ddd" : "transparent",
            color: disabled ? "#777" : "#305f3d",
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          ✓
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onDecideNo}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #9a4a2a",
            background: disabled ? "#ddd" : "transparent",
            color: disabled ? "#777" : "#9a4a2a",
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          X
        </button>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  background,
  color,
  border,
}: {
  title: string;
  background: string;
  color: string;
  border: string;
}) {
  return (
    <div
      style={{
        padding: "8px 14px",
        background,
        borderRadius: "10px 10px 0 0",
        fontWeight: 700,
        fontSize: 13,
        color,
        borderBottom: `2px solid ${border}`,
      }}
    >
      {title}
    </div>
  );
}

function ListShell({ children, border, background }: { children: React.ReactNode; border: string; background: string }) {
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderTop: "none",
        borderRadius: "0 0 10px 10px",
        background,
        maxHeight: 640,
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>
      {text}
    </div>
  );
}

function BuffRow({
  entry,
  disabled,
  actionLabel,
  actionTint,
  onAction,
}: {
  entry: QinYinGongMingEntry;
  disabled: boolean;
  actionLabel?: string;
  actionTint: string;
  onAction?: () => void;
}) {
  const subtitle = getBuffSubtitle(entry);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid #f0ece6",
      }}
    >
      <img
        src={getBuffIconPath(entry)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2 }}>
            {entry.name}
          </div>
          {entry.hidden && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#9992", color: "#666", border: "1px solid #9996" }}>
              隐藏
            </span>
          )}
          {entry.defaultStealable && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#3f7bd822", color: "#315c9f", border: "1px solid #3f7bd866" }}>
              默认: 属性气劲
            </span>
          )}
          {entry.manuallyExcluded && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#ffd8d822", color: "#b04444", border: "1px solid #ffb0b066" }}>
              已排除
            </span>
          )}
          {entry.manualStealable && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#2f9e4422", color: "#236f31", border: "1px solid #2f9e4466" }}>
              手动加入
            </span>
          )}
        </div>

        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {[subtitle, entry.description].filter(Boolean).join(" · ")}
        </div>
      </div>

      {actionLabel && onAction ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onAction}
          style={{
            flexShrink: 0,
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${actionTint}`,
            background: disabled ? "#ddd" : "transparent",
            color: disabled ? "#777" : actionTint,
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {actionLabel}
        </button>
      ) : (
        <span style={{ flexShrink: 0, fontSize: 11, color: "#8c7f72" }}>
          {entry.defaultStealable ? "默认包含" : entry.manualStealable ? "手动加入" : ""}
        </span>
      )}
    </div>
  );
}