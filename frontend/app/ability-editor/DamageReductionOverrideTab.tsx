"use client";

import { useMemo, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  DamageReductionOverrideEntry,
  DamageReductionOverrideMode,
  DamageReductionOverrideSnapshot,
  getBuffIconPath,
  getBuffSubtitle,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

interface Props {
  snapshot: DamageReductionOverrideSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onToggle: (buffId: number, mode: DamageReductionOverrideMode) => Promise<void>;
}

export default function DamageReductionOverrideTab({ snapshot, loading, errorMessage, onRetry, onToggle }: Props) {
  const [search, setSearch] = usePersistentState("abilityEditor.damageReductionOverride.search", "");
  const [togglingBuffId, setTogglingBuffId] = useState<number | null>(null);

  const buffs = snapshot?.buffs ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredBuffs = useMemo(() => {
    if (!normalizedSearch) return buffs;
    return buffs.filter((entry) =>
      [entry.buffId, entry.name, entry.description, entry.sourceAbilityName, getBuffSubtitle(entry)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [buffs, normalizedSearch]);

  const noOverrideBuffs = filteredBuffs.filter((entry) => entry.manualNoOverride);
  const undecidedBuffs = filteredBuffs.filter((entry) => !entry.manualNoOverride && !entry.manualCanOverride);
  const canOverrideBuffs = filteredBuffs.filter((entry) => entry.manualCanOverride);

  async function handleToggle(buffId: number, mode: DamageReductionOverrideMode) {
    setTogglingBuffId(buffId);
    try {
      await onToggle(buffId, mode);
    } finally {
      setTogglingBuffId(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>正在加载减伤被顶配置…</div>;
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
            placeholder="搜索 Buff 名称、ID 或描述"
            style={{ maxWidth: 340 }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
          marginTop: 16,
          alignItems: "start",
        }}
      >
        <div>
          <SectionHeader title={`不可被顶 (${noOverrideBuffs.length})`} background="#eef7f1" color="#285a36" border="#a7d8b5" />
          <ListShell border="#a7d8b5" background="#f8fcf9">
            {noOverrideBuffs.length === 0 ? (
              <EmptyState text="当前没有不可被顶减伤" />
            ) : (
              noOverrideBuffs.map((entry) => (
                <DamageReductionRow
                  key={entry.buffId}
                  entry={entry}
                  disabled={togglingBuffId === entry.buffId}
                  primaryLabel="可"
                  primaryTint="#6c5f3f"
                  onPrimary={() => handleToggle(entry.buffId, "can-override")}
                  secondaryLabel="清"
                  onSecondary={() => handleToggle(entry.buffId, "clear")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader title={`未决定 (${undecidedBuffs.length})`} background="#f4f1eb" color="#7a6e62" border="#e4ddd4" />
          <ListShell border="#e4ddd4" background="#ffffff">
            {undecidedBuffs.length === 0 ? (
              <EmptyState text="当前没有未决定减伤" />
            ) : (
              undecidedBuffs.map((entry) => (
                <DecisionDamageReductionRow
                  key={entry.buffId}
                  entry={entry}
                  disabled={togglingBuffId === entry.buffId}
                  onNoOverride={() => handleToggle(entry.buffId, "no-override")}
                  onCanOverride={() => handleToggle(entry.buffId, "can-override")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader title={`可以被顶 (${canOverrideBuffs.length})`} background="#fff7e8" color="#805a21" border="#e8ca8a" />
          <ListShell border="#e8ca8a" background="#fffdf8">
            {canOverrideBuffs.length === 0 ? (
              <EmptyState text="当前没有手动标记可以被顶" />
            ) : (
              canOverrideBuffs.map((entry) => (
                <DamageReductionRow
                  key={entry.buffId}
                  entry={entry}
                  disabled={togglingBuffId === entry.buffId}
                  primaryLabel="不可"
                  primaryTint="#285a36"
                  onPrimary={() => handleToggle(entry.buffId, "no-override")}
                  secondaryLabel="清"
                  onSecondary={() => handleToggle(entry.buffId, "clear")}
                />
              ))
            )}
          </ListShell>
        </div>
      </div>
    </div>
  );
}

function DecisionDamageReductionRow({
  entry,
  disabled,
  onNoOverride,
  onCanOverride,
}: {
  entry: DamageReductionOverrideEntry;
  disabled: boolean;
  onNoOverride: () => void;
  onCanOverride: () => void;
}) {
  return (
    <DamageReductionBaseRow entry={entry}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <SmallActionButton disabled={disabled} tint="#9a4a2a" onClick={onNoOverride}>X</SmallActionButton>
        <SmallActionButton disabled={disabled} tint="#305f3d" onClick={onCanOverride}>✓</SmallActionButton>
      </div>
    </DamageReductionBaseRow>
  );
}

function DamageReductionRow({
  entry,
  disabled,
  primaryLabel,
  primaryTint,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  entry: DamageReductionOverrideEntry;
  disabled: boolean;
  primaryLabel: string;
  primaryTint: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
}) {
  return (
    <DamageReductionBaseRow entry={entry}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <SmallActionButton disabled={disabled} tint={primaryTint} onClick={onPrimary}>{primaryLabel}</SmallActionButton>
        <SmallActionButton disabled={disabled} tint="#776e62" onClick={onSecondary}>{secondaryLabel}</SmallActionButton>
      </div>
    </DamageReductionBaseRow>
  );
}

function DamageReductionBaseRow({ entry, children }: { entry: DamageReductionOverrideEntry; children: React.ReactNode }) {
  const subtitle = getBuffSubtitle(entry);
  const valueLabel = `${Number(entry.damageReductionValue.toFixed(2)).toString()}%`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0ece6" }}>
      <img
        src={getBuffIconPath(entry)}
        alt={entry.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2 }}>{entry.name}</div>
          <CopyNameButton value={entry.name} />
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#315c9f16", color: "#315c9f", border: "1px solid #315c9f44" }}>
            减伤 {valueLabel}
          </span>
          {entry.manualNoOverride && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#2f9e4422", color: "#236f31", border: "1px solid #2f9e4466" }}>
              不可被顶
            </span>
          )}
          {entry.manualCanOverride && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#f59f0022", color: "#946200", border: "1px solid #f59f0066" }}>
              可以被顶
            </span>
          )}
        </div>

        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {[subtitle, entry.sourceAbilityName, entry.description].filter(Boolean).join(" · ")}
        </div>
      </div>

      {children}
    </div>
  );
}

function SmallActionButton({ disabled, tint, onClick, children }: { disabled: boolean; tint: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: String(children).length > 1 ? 72 : 34,
        minHeight: 28,
        borderRadius: 6,
        border: `1px solid ${tint}`,
        background: disabled ? "#ddd" : "transparent",
        color: disabled ? "#777" : tint,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, background, color, border }: { title: string; background: string; color: string; border: string }) {
  return (
    <div style={{ padding: "8px 14px", background, borderRadius: "8px 8px 0 0", fontWeight: 700, fontSize: 13, color, borderBottom: `2px solid ${border}` }}>
      {title}
    </div>
  );
}

function ListShell({ children, border, background }: { children: React.ReactNode; border: string; background: string }) {
  return (
    <div style={{ border: `1px solid ${border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background, maxHeight: 640, overflowY: "auto" }}>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>{text}</div>;
}
