"use client";

import { useMemo, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  HiddenBuffEntry,
  HiddenBuffMode,
  HiddenBuffSnapshot,
  getBuffIconPath,
  getBuffSubtitle,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

interface Props {
  snapshot: HiddenBuffSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
  onToggle: (buffId: number, mode: HiddenBuffMode) => Promise<void>;
}

export default function HiddenBuffTab({ snapshot, loading, errorMessage, onRetry, onToggle }: Props) {
  const [search, setSearch] = usePersistentState("abilityEditor.hiddenBuffs.search", "");
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

  const visibleBuffs = filteredBuffs.filter((entry) => entry.manuallyVisible);
  const undecidedBuffs = filteredBuffs.filter((entry) => !entry.hidden && !entry.manuallyVisible);
  const hiddenBuffs = filteredBuffs.filter((entry) => entry.hidden);

  async function handleToggle(buffId: number, mode: HiddenBuffMode) {
    setTogglingBuffId(buffId);
    try {
      await onToggle(buffId, mode);
    } finally {
      setTogglingBuffId(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>正在加载隐藏 Buff 配置…</div>;
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
          <input value={search} onChange={(event) => setSearch(event.target.value)} className={styles.searchInput} placeholder="搜索 Buff 名称、ID、来源或描述" style={{ maxWidth: 340 }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <div>
          <SectionHeader title={`强制显示 (${visibleBuffs.length})`} background="#fdf1f1" color="#8a4040" border="#e5b1b1" />
          <ListShell border="#e5b1b1" background="#fff8f8">
            {visibleBuffs.length === 0 ? <EmptyState text="当前没有强制显示的 Buff" /> : visibleBuffs.map((entry) => (
              <BuffRow key={entry.buffId} entry={entry} disabled={togglingBuffId === entry.buffId} actionLabel="恢复" actionTint="#8a4040" onAction={() => handleToggle(entry.buffId, "clear")} />
            ))}
          </ListShell>
        </div>

        <div>
          <SectionHeader title={`未决定 (${undecidedBuffs.length})`} background="#f4f1eb" color="#7a6e62" border="#e4ddd4" />
          <ListShell border="#e4ddd4" background="#ffffff">
            {undecidedBuffs.length === 0 ? <EmptyState text="当前没有未决定 Buff" /> : undecidedBuffs.map((entry) => (
              <DecisionBuffRow key={entry.buffId} entry={entry} disabled={togglingBuffId === entry.buffId} onDecideShow={() => handleToggle(entry.buffId, "manual-exclude")} onDecideHide={() => handleToggle(entry.buffId, "manual-include")} />
            ))}
          </ListShell>
        </div>

        <div>
          <SectionHeader title={`隐藏 Buff (${hiddenBuffs.length})`} background="#eef5ff" color="#264a7a" border="#9ec1f0" />
          <ListShell border="#9ec1f0" background="#f8fbff">
            {hiddenBuffs.length === 0 ? <EmptyState text="当前没有隐藏 Buff" /> : hiddenBuffs.map((entry) => (
              <BuffRow key={entry.buffId} entry={entry} disabled={togglingBuffId === entry.buffId} actionLabel="显示" actionTint="#264a7a" onAction={() => handleToggle(entry.buffId, "manual-exclude")} />
            ))}
          </ListShell>
        </div>
      </div>
    </div>
  );
}

function DecisionBuffRow({ entry, disabled, onDecideShow, onDecideHide }: { entry: HiddenBuffEntry; disabled: boolean; onDecideShow: () => void; onDecideHide: () => void }) {
  return (
    <BuffBaseRow entry={entry}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <SmallActionButton disabled={disabled} tint="#9a4a2a" onClick={onDecideShow}>X</SmallActionButton>
        <SmallActionButton disabled={disabled} tint="#305f3d" onClick={onDecideHide}>✓</SmallActionButton>
      </div>
    </BuffBaseRow>
  );
}

function BuffRow({ entry, disabled, actionLabel, actionTint, onAction }: { entry: HiddenBuffEntry; disabled: boolean; actionLabel: string; actionTint: string; onAction: () => void }) {
  return (
    <BuffBaseRow entry={entry}>
      <SmallActionButton disabled={disabled} tint={actionTint} onClick={onAction} wide>{actionLabel}</SmallActionButton>
    </BuffBaseRow>
  );
}

function BuffBaseRow({ entry, children }: { entry: HiddenBuffEntry; children: React.ReactNode }) {
  const subtitle = getBuffSubtitle(entry);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0ece6" }}>
      <img src={getBuffIconPath(entry)} alt={entry.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }} draggable={false} loading="lazy" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2 }}>{entry.name}</div>
          <CopyNameButton value={entry.name} />
          {entry.defaultHidden && <Badge tint="#315c9f" text="默认隐藏" />}
          {entry.manualHidden && <Badge tint="#236f31" text="手动隐藏" />}
          {entry.manuallyVisible && <Badge tint="#b04444" text="强制显示" />}
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>
          {[subtitle, entry.sourceAbilityName, entry.description].filter(Boolean).join(" · ")}
        </div>
      </div>
      {children}
    </div>
  );
}

function Badge({ tint, text }: { tint: string; text: string }) {
  return <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: `${tint}22`, color: tint, border: `1px solid ${tint}66` }}>{text}</span>;
}

function SmallActionButton({ disabled, tint, onClick, children, wide = false }: { disabled: boolean; tint: string; onClick: () => void; children: React.ReactNode; wide?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} style={{ width: wide ? 72 : 34, minHeight: 28, borderRadius: 6, border: `1px solid ${tint}`, background: disabled ? "#ddd" : "transparent", color: disabled ? "#777" : tint, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer" }}>{children}</button>;
}

function SectionHeader({ title, background, color, border }: { title: string; background: string; color: string; border: string }) {
  return <div style={{ padding: "8px 14px", background, borderRadius: "8px 8px 0 0", fontWeight: 700, fontSize: 13, color, borderBottom: `2px solid ${border}` }}>{title}</div>;
}

function ListShell({ children, border, background }: { children: React.ReactNode; border: string; background: string }) {
  return <div style={{ border: `1px solid ${border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background, maxHeight: 640, overflowY: "auto" }}>{children}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>{text}</div>;
}