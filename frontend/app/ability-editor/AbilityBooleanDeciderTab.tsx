"use client";

import { type CSSProperties, type ReactNode, useMemo, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  AbilityBooleanDeciderEntry,
  AbilityBooleanDeciderMode,
  AbilityBooleanDeciderSnapshot,
  abilityTypeLabel,
  getAbilityIconByName,
  getSimpleDescription,
  targetTypeLabel,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

interface AbilityBooleanDeciderTabProps {
  searchStorageKey: string;
  loadingText: string;
  snapshot: AbilityBooleanDeciderSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onToggle: (abilityId: string, mode: AbilityBooleanDeciderMode) => Promise<void>;
  enabledColumnTitle: string;
  enabledEmptyText: string;
  excludedColumnTitle: string;
  undecidedColumnTitle: string;
  decideYesLabel: string;
  decideNoLabel: string;
  enabledActionLabel: string;
  excludedActionLabel: string;
  footerText: string;
  showQinggongBadge?: boolean;
  showImmuneBadge?: boolean;
  showMetadataRow?: boolean;
  limitUndecidedToQinggong?: boolean;
  limitUndecidedToChannel?: boolean;
}

export default function AbilityBooleanDeciderTab({
  searchStorageKey,
  loadingText,
  snapshot,
  loading,
  errorMessage,
  onRetry,
  onToggle,
  enabledColumnTitle,
  enabledEmptyText,
  excludedColumnTitle,
  undecidedColumnTitle,
  decideYesLabel,
  decideNoLabel,
  enabledActionLabel,
  excludedActionLabel,
  footerText,
  showQinggongBadge,
  showImmuneBadge,
  showMetadataRow = true,
  limitUndecidedToQinggong = false,
  limitUndecidedToChannel = false,
}: AbilityBooleanDeciderTabProps) {
  const [search, setSearch] = usePersistentState(searchStorageKey, "");
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
  const undecidedAbilities = filteredAbilities.filter(
    (entry) =>
      !entry.enabled &&
      !entry.manuallyExcluded &&
      (!limitUndecidedToQinggong || entry.qinggong) &&
      (!limitUndecidedToChannel || entry.type === "CHANNEL")
  );
  const enabledAbilities = filteredAbilities.filter((entry) => entry.enabled && !entry.manuallyExcluded);

  async function handleToggle(abilityId: string, mode: AbilityBooleanDeciderMode) {
    setTogglingAbilityId(abilityId);
    try {
      await onToggle(abilityId, mode);
    } finally {
      setTogglingAbilityId(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>{loadingText}</div>;
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
            onChange={(event) => setSearch(event.target.value)}
            className={styles.searchInput}
            placeholder="搜索技能名、类型或描述"
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
            title={`${excludedColumnTitle} (${excludedAbilities.length})`}
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
                  actionLabel={excludedActionLabel}
                  actionTint="#8a4040"
                  showQinggongBadge={showQinggongBadge}
                  showImmuneBadge={showImmuneBadge}
                  showMetadataRow={showMetadataRow}
                  onAction={() => handleToggle(entry.id, "clear")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader
            title={`${undecidedColumnTitle} (${undecidedAbilities.length})`}
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
                  decideYesLabel={decideYesLabel}
                  decideNoLabel={decideNoLabel}
                  showQinggongBadge={showQinggongBadge}
                  showImmuneBadge={showImmuneBadge}
                  showMetadataRow={showMetadataRow}
                  onDecideCan={() => handleToggle(entry.id, "manual-include")}
                  onDecideNo={() => handleToggle(entry.id, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader
            title={`${enabledColumnTitle} (${enabledAbilities.length})`}
            background="#eef5ff"
            color="#264a7a"
            border="#9ec1f0"
          />
          <ListShell border="#9ec1f0" background="#f8fbff">
            {enabledAbilities.length === 0 ? (
              <EmptyState text={enabledEmptyText} />
            ) : (
              enabledAbilities.map((entry) => (
                <AbilityRow
                  key={entry.id}
                  entry={entry}
                  disabled={togglingAbilityId === entry.id}
                  actionLabel={enabledActionLabel}
                  actionTint="#264a7a"
                  showQinggongBadge={showQinggongBadge}
                  showImmuneBadge={showImmuneBadge}
                  showMetadataRow={showMetadataRow}
                  onAction={() => handleToggle(entry.id, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "#8a7f6f" }}>{footerText}</p>
    </div>
  );
}

function DecisionAbilityRow({
  entry,
  disabled,
  decideYesLabel,
  decideNoLabel,
  showQinggongBadge,
  showImmuneBadge,
  showMetadataRow,
  onDecideCan,
  onDecideNo,
}: {
  entry: AbilityBooleanDeciderEntry;
  disabled: boolean;
  decideYesLabel: string;
  decideNoLabel: string;
  showQinggongBadge?: boolean;
  showImmuneBadge?: boolean;
  showMetadataRow?: boolean;
  onDecideCan: () => void;
  onDecideNo: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0ece6" }}>
      <img
        src={getAbilityIconByName(entry.name)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <AbilityHeading
          entry={entry}
          showQinggongBadge={showQinggongBadge}
          showImmuneBadge={showImmuneBadge}
          showMetadataRow={showMetadataRow}
        />
        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {getSimpleDescription(entry.description)}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button type="button" disabled={disabled} onClick={onDecideNo} title={decideNoLabel} style={decisionButtonStyle(disabled, "#9a4a2a")}>
          X
        </button>
        <button type="button" disabled={disabled} onClick={onDecideCan} title={decideYesLabel} style={decisionButtonStyle(disabled, "#305f3d")}>
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
  showQinggongBadge,
  showImmuneBadge,
  showMetadataRow,
  onAction,
}: {
  entry: AbilityBooleanDeciderEntry;
  disabled: boolean;
  actionLabel: string;
  actionTint: string;
  showQinggongBadge?: boolean;
  showImmuneBadge?: boolean;
  showMetadataRow?: boolean;
  onAction: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0ece6" }}>
      <img
        src={getAbilityIconByName(entry.name)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <AbilityHeading
          entry={entry}
          showQinggongBadge={showQinggongBadge}
          showImmuneBadge={showImmuneBadge}
          showMetadataRow={showMetadataRow}
        />
        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {getSimpleDescription(entry.description)}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onAction}
        style={{
          flexShrink: 0,
          minHeight: 28,
          borderRadius: 6,
          border: `1px solid ${actionTint}`,
          background: disabled ? "#ddd" : "transparent",
          color: disabled ? "#777" : actionTint,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          padding: "0 10px",
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function AbilityHeading({
  entry,
  showQinggongBadge,
  showImmuneBadge,
  showMetadataRow,
}: {
  entry: AbilityBooleanDeciderEntry;
  showQinggongBadge?: boolean;
  showImmuneBadge?: boolean;
  showMetadataRow?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#2e2a25", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.name}
        </span>
        <CopyNameButton value={entry.name} label="复制技能名" />
      </div>
      {showMetadataRow && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, color: "#8a7f72" }}>
          <span>{abilityTypeLabel[entry.type]}</span>
          <span>{targetTypeLabel[entry.target]}</span>
          {entry.manualEnabled ? <Badge text="手动加入" tint="#2f6f44" /> : null}
          {entry.manuallyExcluded ? <Badge text="手动排除" tint="#8a4040" /> : null}
          {!entry.manualEnabled && !entry.manuallyExcluded && entry.baseEnabled ? <Badge text="代码默认" tint="#4f6f9a" /> : null}
          {showQinggongBadge && entry.qinggong ? <Badge text="轻功" tint="#8b6a21" /> : null}
          {showImmuneBadge && entry.qinggongGcdImmune ? <Badge text="不受轻功GCD" tint="#264a7a" /> : null}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, background, color, border }: { title: string; background: string; color: string; border: string }) {
  return (
    <div style={{ background, color, border: `1px solid ${border}`, borderRadius: "6px 6px 0 0", padding: "10px 12px", fontWeight: 800 }}>
      {title}
    </div>
  );
}

function ListShell({ children, border, background }: { children: ReactNode; border: string; background: string }) {
  return (
    <div style={{ border: `1px solid ${border}`, borderTop: 0, background, minHeight: 420, maxHeight: 640, overflowY: "auto" }}>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 16, fontSize: 12, color: "#8a7f72" }}>{text}</div>;
}

function Badge({ text, tint }: { text: string; tint: string }) {
  return <span style={{ color: tint, fontWeight: 700 }}>{text}</span>;
}

function decisionButtonStyle(disabled: boolean, tint: string): CSSProperties {
  return {
    width: 34,
    minHeight: 28,
    borderRadius: 6,
    border: `1px solid ${tint}`,
    background: disabled ? "#ddd" : "transparent",
    color: disabled ? "#777" : tint,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
