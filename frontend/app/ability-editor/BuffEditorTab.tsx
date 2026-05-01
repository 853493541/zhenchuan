"use client";

import Link from "next/link";
import { useState } from "react";

import { FALLBACK_BUFF_ICON_PATH } from "../lib/buffIcons";
import {
  BUFF_ATTRIBUTES,
  BuffAttribute,
  BuffEditorEntry,
  BuffEditorSnapshot,
  formatUpdatedAt,
  getBuffIconPath,
  getBuffSubtitle,
} from "./editorShared";
import styles from "./page.module.css";

type SubTab = "有利气劲" | "不利气劲";
type AttributeFilter = BuffAttribute | "全部";
type HiddenFilter = "全部状态" | "隐藏" | "显示";

const SUB_TABS: SubTab[] = ["有利气劲", "不利气劲"];
const ATTRIBUTE_FILTERS: AttributeFilter[] = ["全部", ...BUFF_ATTRIBUTES];
const HIDDEN_FILTERS: HiddenFilter[] = ["全部状态", "隐藏", "显示"];

interface BuffEditorTabProps {
  snapshot: BuffEditorSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onSnapshotUpdate: (next: BuffEditorSnapshot) => void;
  onRetry: () => void;
}

export default function BuffEditorTab({
  snapshot,
  loading,
  errorMessage,
  onRetry,
}: BuffEditorTabProps) {
  const [subTab, setSubTab] = useState<SubTab>("有利气劲");
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>("全部");
  const [hiddenFilter, setHiddenFilter] = useState<HiddenFilter>("显示");
  const [search, setSearch] = useState("");

  const allBuffs = snapshot?.buffs ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const categoryFiltered = allBuffs.filter((buff) =>
    subTab === "有利气劲" ? buff.category === "BUFF" : buff.category === "DEBUFF"
  );
  const visibilityFiltered = categoryFiltered.filter((buff) => {
    if (hiddenFilter === "全部状态") return true;
    return hiddenFilter === "隐藏" ? buff.hidden : !buff.hidden;
  });

  const filtered = visibilityFiltered
    .filter((buff) => attributeFilter === "全部" || buff.attribute === attributeFilter)
    .filter((buff) => {
      if (!normalizedSearch) return true;
      return (
        buff.name.toLowerCase().includes(normalizedSearch) ||
        String(buff.buffId).includes(normalizedSearch) ||
        (buff.sourceAbilityName ?? "").toLowerCase().includes(normalizedSearch)
      );
    });

  if (loading) {
    return <div className={styles.statePanel}>正在加载 Buff 列表…</div>;
  }

  if (errorMessage) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.stateTitle}>加载失败</p>
        <p className={styles.stateCopy}>{errorMessage}</p>
        <button className={styles.retryButton} onClick={onRetry}>
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Sub-tab bar */}
      <div className={styles.buffSubTabBar}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`${styles.buffSubTab} ${subTab === tab ? styles.buffSubTabActive : ""}`}
            onClick={() => setSubTab(tab)}
          >
            {tab}
            <span className={styles.buffSubTabCount}>
              {allBuffs.filter((b) => (tab === "有利气劲" ? b.category === "BUFF" : b.category === "DEBUFF")).length}
            </span>
          </button>
        ))}

        <div className={styles.buffSubTabSpacer} />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.buffSubTabSearch}
          placeholder="搜索 Buff 名或 ID"
        />

        <select
          value={hiddenFilter}
          onChange={(event) => setHiddenFilter(event.target.value as HiddenFilter)}
          className={styles.buffSubTabSelect}
        >
          {HIDDEN_FILTERS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <div className={styles.buffUpdatedAt}>
          最后保存：{formatUpdatedAt(snapshot?.updatedAt ?? null)}
        </div>
      </div>

      {/* Attribute filter */}
      <div className={styles.buffAttrFilterBar}>
        {ATTRIBUTE_FILTERS.map((filterValue) => {
          const count =
            filterValue === "全部"
              ? visibilityFiltered.length
              : visibilityFiltered.filter((buff) => buff.attribute === filterValue).length;
          return (
            <button
              key={filterValue}
              type="button"
              className={`${styles.buffAttrFilterChip} ${attributeFilter === filterValue ? styles.buffAttrFilterChipActive : ""}`}
              onClick={() => setAttributeFilter(filterValue)}
            >
              {filterValue}
              <span className={styles.buffAttrFilterCount}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Buff grid */}
      {filtered.length === 0 ? (
        <div className={styles.statePanel}>
          <p className={styles.stateTitle}>没有匹配结果</p>
          <p className={styles.stateCopy}>换一个关键词试试。</p>
        </div>
      ) : (
        <div className={styles.buffGrid}>
          {filtered.map((entry) => (
            <BuffReadOnlyCard key={entry.buffId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function BuffReadOnlyCard({ entry }: { entry: BuffEditorEntry }) {
  const subtitle = getBuffSubtitle(entry);
  const iconSrc = getBuffIconPath(entry);
  const isDebuff = entry.category === "DEBUFF";
  const effectiveProps = entry.properties.length > 0 ? entry.properties : entry.baseProperties;

  return (
    <Link
      href={`/ability-editor/buff/${entry.buffId}`}
      className={[
        styles.buffCard,
        isDebuff ? styles.buffCardDebuff : styles.buffCardBuff,
        entry.hidden ? styles.buffCardHidden : "",
        styles.buffCardLink,
      ].join(" ")}
    >
      <div className={styles.buffCardTop}>
        <div className={styles.buffIconFrame}>
          <img
            src={iconSrc}
            alt={entry.name}
            className={styles.buffIcon}
            draggable={false}
            loading="lazy"
            onError={(event) => {
              const image = event.currentTarget;
              if (image.src.endsWith(FALLBACK_BUFF_ICON_PATH)) {
                image.style.opacity = "0.25";
                return;
              }
              image.src = FALLBACK_BUFF_ICON_PATH;
            }}
          />
        </div>
        <div className={styles.buffCardMeta}>
          <div className={styles.buffCardName}>{entry.name}</div>
        </div>
        {subtitle && (
          <span className={`${styles.buffTopTag} ${isDebuff ? styles.buffTopTagDebuff : styles.buffTopTagBuff}`}>
            {subtitle}
          </span>
        )}
      </div>

      <p className={styles.buffCardDesc}>{entry.description}</p>

      {effectiveProps.length > 0 && (
        <div className={styles.buffPropTagRow}>
          {effectiveProps.map((p) => (
            <span key={p.type} className={styles.buffPropTag}>
              {p.type}
            </span>
          ))}
        </div>
      )}

      <div className={styles.buffCardHint}>点击编辑详细属性</div>
    </Link>
  );
}
