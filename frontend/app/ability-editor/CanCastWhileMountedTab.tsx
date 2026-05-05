"use client";

import { ReactNode, useMemo, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  CanCastWhileMountedEntry,
  CanCastWhileMountedSnapshot,
  abilityTypeLabel,
  getAbilityIconByName,
  getSimpleDescription,
  targetTypeLabel,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

interface Props {
  snapshot: CanCastWhileMountedSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onToggle: (abilityId: string, mode: "manual-include" | "manual-exclude" | "clear") => Promise<void>;
}

export default function CanCastWhileMountedTab({ snapshot, loading, errorMessage, onRetry, onToggle }: Props) {
  const [search, setSearch] = usePersistentState("abilityEditor.canCastWhileMounted.search", "");
  const [togglingAbilityId, setTogglingAbilityId] = useState<string | null>(null);

  const abilities = snapshot?.abilities ?? [];
  const normalizedSearch = search.trim().toLowerCase();

  const filteredAbilities = useMemo(() => {
    if (!normalizedSearch) return abilities;
    return abilities.filter((entry) =>
      [entry.id, entry.name, entry.description, abilityTypeLabel[entry.type], targetTypeLabel[entry.target]]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [abilities, normalizedSearch]);

  const excludedAbilities = filteredAbilities.filter((entry) => entry.manuallyExcluded);
  const undecidedAbilities = filteredAbilities.filter((entry) => !entry.canCastWhileMounted && !entry.manuallyExcluded);
  const enabledAbilities = filteredAbilities.filter((entry) => entry.canCastWhileMounted);

  async function handleToggle(abilityId: string, mode: "manual-include" | "manual-exclude" | "clear") {
    setTogglingAbilityId(abilityId);
    try {
      await onToggle(abilityId, mode);
    } finally {
      setTogglingAbilityId(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>正在加载“可以马上施展”技能列表…</div>;
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
            placeholder="搜索技能名、ID、类型或描述"
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
            title={`已声明不能马上施展 (${excludedAbilities.length})`}
            background="#fdf1f1"
            color="#8a4040"
            border="#e5b1b1"
          />
          <ListShell border="#e5b1b1" background="#fff8f8">
            {excludedAbilities.length === 0 ? (
              <EmptyState text="当前没有被排除的技能" />
            ) : (
              excludedAbilities.map((entry) => (
                <AbilityRow
                  key={entry.id}
                  entry={entry}
                  disabled={togglingAbilityId === entry.id}
                  actionLabel="恢复"
                  actionTint="#8a4040"
                  onAction={() => handleToggle(entry.id, "clear")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader
            title={`未决定 (${undecidedAbilities.length})`}
            background="#f4f1eb"
            color="#7a6e62"
            border="#e4ddd4"
          />
          <ListShell border="#e4ddd4" background="#ffffff">
            {undecidedAbilities.length === 0 ? (
              <EmptyState text="当前没有未决定的技能" />
            ) : (
              undecidedAbilities.map((entry) => (
                <DecisionAbilityRow
                  key={entry.id}
                  entry={entry}
                  disabled={togglingAbilityId === entry.id}
                  onDecideCan={() => handleToggle(entry.id, "manual-include")}
                  onDecideNo={() => handleToggle(entry.id, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader
            title={`可以马上施展 (${enabledAbilities.length})`}
            background="#eef5ff"
            color="#264a7a"
            border="#9ec1f0"
          />
          <ListShell border="#9ec1f0" background="#f8fbff">
            {enabledAbilities.length === 0 ? (
              <EmptyState text="当前没有可马上施展技能" />
            ) : (
              enabledAbilities.map((entry) => (
                <AbilityRow
                  key={entry.id}
                  entry={entry}
                  disabled={togglingAbilityId === entry.id}
                  actionLabel="改为不可马上施展"
                  actionTint="#264a7a"
                  onAction={() => handleToggle(entry.id, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "#8a7f6f" }}>
        这里决定哪些技能拥有“可以马上施展”属性。右侧技能在御骑期间仍可施放，中间列表可以直接判定，左侧“恢复”会清除手动覆盖并回到代码默认值。
      </p>
    </div>
  );
}

function DecisionAbilityRow({
  entry,
  disabled,
  onDecideCan,
  onDecideNo,
}: {
  entry: CanCastWhileMountedEntry;
  disabled: boolean;
  onDecideCan: () => void;
  onDecideNo: () => void;
}) {
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
        src={getAbilityIconByName(entry.name)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <AbilityHeading entry={entry} />
        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {getSimpleDescription(entry.description)}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={onDecideNo}
          style={{
            width: 34,
            minHeight: 28,
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
        <button
          type="button"
          disabled={disabled}
          onClick={onDecideCan}
          style={{
            width: 34,
            minHeight: 28,
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
      </div>
    </div>
  );
}

function AbilityRow({
  entry,
  disabled,
  actionLabel,
  actionTint,
  onAction,
}: {
  entry: CanCastWhileMountedEntry;
  disabled: boolean;
  actionLabel?: string;
  actionTint: string;
  onAction?: () => void;
}) {
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
        src={getAbilityIconByName(entry.name)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <AbilityHeading entry={entry} />
        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {getSimpleDescription(entry.description)}
        </div>
      </div>

      {actionLabel && onAction ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onAction}
          style={{
            flexShrink: 0,
            width: 132,
            minHeight: 28,
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
      ) : null}
    </div>
  );
}

function AbilityHeading({ entry }: { entry: CanCastWhileMountedEntry }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2 }}>
          {entry.name}
        </div>
        <CopyNameButton value={entry.name} />
        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#9992", color: "#666", border: "1px solid #9996" }}>
          {abilityTypeLabel[entry.type]}
        </span>
        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#8ecae622", color: "#2a6170", border: "1px solid #8ecae666" }}>
          {targetTypeLabel[entry.target]}
        </span>
        {entry.baseCanCastWhileMounted && (
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#3f7bd822", color: "#315c9f", border: "1px solid #3f7bd866" }}>
            代码默认
          </span>
        )}
        {entry.manualCanCastWhileMounted && (
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#2f9e4422", color: "#236f31", border: "1px solid #2f9e4466" }}>
            手动加入
          </span>
        )}
        {entry.manuallyExcluded && (
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#ffd8d822", color: "#b04444", border: "1px solid #ffb0b066" }}>
            手动排除
          </span>
        )}
      </div>
      <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
        ID: {entry.id}
      </div>
    </>
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
        borderRadius: "8px 8px 0 0",
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

function ListShell({ children, border, background }: { children: ReactNode; border: string; background: string }) {
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderTop: "none",
        borderRadius: "0 0 8px 8px",
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