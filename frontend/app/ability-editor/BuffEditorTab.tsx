"use client";

import { useState } from "react";

import { toastError, toastSuccess } from "../components/toast/toast";
import { FALLBACK_BUFF_ICON_PATH } from "../lib/buffIcons";
import {
  BUFF_ATTRIBUTES,
  BuffAttribute,
  BuffEditorEntry,
  BuffEditorSnapshot,
  formatUpdatedAt,
  getAbilityIconByName,
  getBuffIconPath,
  getBuffSubtitle,
} from "./editorShared";
import styles from "./page.module.css";

type SubTab = "有利" | "不利";
type AttributeFilter = BuffAttribute | "全部";
type HiddenFilter = "全部状态" | "隐藏" | "显示";

const SUB_TABS: SubTab[] = ["有利", "不利"];
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
  onSnapshotUpdate,
  onRetry,
}: BuffEditorTabProps) {
  const [subTab, setSubTab] = useState<SubTab>("有利");
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>("全部");
  const [hiddenFilter, setHiddenFilter] = useState<HiddenFilter>("显示");
  const [editingNameBuffId, setEditingNameBuffId] = useState<number | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const allBuffs = snapshot?.buffs ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const categoryFiltered = allBuffs.filter((buff) =>
    subTab === "有利" ? buff.category === "BUFF" : buff.category === "DEBUFF"
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

  const handleAttributeChange = async (entry: BuffEditorEntry, attribute: BuffAttribute) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/attribute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attribute }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const next = (await response.json()) as BuffEditorSnapshot;
      onSnapshotUpdate(next);
      toastSuccess(`已更新 ${entry.name} · 属性为 ${attribute}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDescriptionChange = (buffId: number, description: string) => {
    setDescriptionDrafts((current) => ({
      ...current,
      [buffId]: description,
    }));
  };

  const handleStartNameEdit = (entry: BuffEditorEntry) => {
    setEditingNameBuffId(entry.buffId);
    setNameDrafts((current) => ({
      ...current,
      [entry.buffId]: current[entry.buffId] ?? entry.name,
    }));
  };

  const handleCancelNameEdit = (buffId: number) => {
    setEditingNameBuffId((current) => (current === buffId ? null : current));
    setNameDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[buffId];
      return nextDrafts;
    });
  };

  const handleNameChange = (buffId: number, name: string) => {
    setNameDrafts((current) => ({
      ...current,
      [buffId]: name,
    }));
  };

  const handleNameSave = async (entry: BuffEditorEntry, name: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const next = (await response.json()) as BuffEditorSnapshot;
      onSnapshotUpdate(next);
      setEditingNameBuffId((current) => (current === entry.buffId ? null : current));
      setNameDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[entry.buffId];
        return nextDrafts;
      });
      toastSuccess(`已更新 Buff 名称 · ${entry.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDescriptionSave = async (entry: BuffEditorEntry, description: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const next = (await response.json()) as BuffEditorSnapshot;
      onSnapshotUpdate(next);
      setDescriptionDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[entry.buffId];
        return nextDrafts;
      });
      toastSuccess(`已更新 ${entry.name} · 描述`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleHiddenChange = async (entry: BuffEditorEntry, hidden: boolean) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/hidden`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hidden }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const next = (await response.json()) as BuffEditorSnapshot;
      onSnapshotUpdate(next);
      toastSuccess(`已更新 ${entry.name} · ${hidden ? "隐藏" : "显示"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

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
              {allBuffs.filter((b) => (tab === "有利" ? b.category === "BUFF" : b.category === "DEBUFF")).length}
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
            <BuffCard
              key={entry.buffId}
              entry={entry}
              isEditingName={editingNameBuffId === entry.buffId}
              nameDraft={nameDrafts[entry.buffId] ?? entry.name}
              descriptionDraft={descriptionDrafts[entry.buffId] ?? entry.description}
              saving={saving}
              onAttributeChange={handleAttributeChange}
              onHiddenChange={handleHiddenChange}
              onStartNameEdit={handleStartNameEdit}
              onCancelNameEdit={handleCancelNameEdit}
              onNameChange={handleNameChange}
              onNameSave={handleNameSave}
              onDescriptionChange={handleDescriptionChange}
              onDescriptionSave={handleDescriptionSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BuffCard({
  entry,
  isEditingName,
  nameDraft,
  descriptionDraft,
  saving,
  onAttributeChange,
  onHiddenChange,
  onStartNameEdit,
  onCancelNameEdit,
  onNameChange,
  onNameSave,
  onDescriptionChange,
  onDescriptionSave,
}: {
  entry: BuffEditorEntry;
  isEditingName: boolean;
  nameDraft: string;
  descriptionDraft: string;
  saving: boolean;
  onAttributeChange: (entry: BuffEditorEntry, attribute: BuffAttribute) => void;
  onHiddenChange: (entry: BuffEditorEntry, hidden: boolean) => void;
  onStartNameEdit: (entry: BuffEditorEntry) => void;
  onCancelNameEdit: (buffId: number) => void;
  onNameChange: (buffId: number, name: string) => void;
  onNameSave: (entry: BuffEditorEntry, name: string) => void;
  onDescriptionChange: (buffId: number, description: string) => void;
  onDescriptionSave: (entry: BuffEditorEntry, description: string) => void;
}) {
  const subtitle = getBuffSubtitle(entry);
  const iconSrc = getBuffIconPath(entry);
  const sourceAbilityIcon = entry.sourceAbilityName ? getAbilityIconByName(entry.sourceAbilityName) : null;
  const isDebuff = entry.category === "DEBUFF";
  const trimmedNameDraft = nameDraft.trim();
  const canSaveName = trimmedNameDraft.length > 0 && trimmedNameDraft !== entry.name.trim();
  const trimmedDraft = descriptionDraft.trim();
  const canSaveDescription = trimmedDraft.length > 0 && trimmedDraft !== entry.description.trim();

  return (
    <article className={`${styles.buffCard} ${isDebuff ? styles.buffCardDebuff : styles.buffCardBuff}`}>
      {/* Icon + identity */}
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
          <div className={styles.buffNameRow}>
            {isEditingName ? (
              <input
                value={nameDraft}
                autoFocus
                disabled={saving}
                className={styles.buffNameInput}
                onChange={(event) => onNameChange(entry.buffId, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canSaveName && !saving) {
                    event.preventDefault();
                    onNameSave(entry, nameDraft);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelNameEdit(entry.buffId);
                  }
                }}
              />
            ) : (
              <div className={styles.buffCardName}>{entry.name}</div>
            )}

            <div className={styles.buffNameActions}>
              <button
                type="button"
                disabled={saving || (isEditingName && trimmedNameDraft.length === 0)}
                className={styles.buffNameIconButton}
                onClick={() => {
                  if (isEditingName) {
                    if (canSaveName) {
                      onNameSave(entry, nameDraft);
                      return;
                    }

                    onCancelNameEdit(entry.buffId);
                  } else {
                    onStartNameEdit(entry);
                  }
                }}
                title={isEditingName ? "提交名称" : "编辑名称"}
                aria-label={isEditingName ? "提交名称" : "编辑名称"}
              >
                {isEditingName ? <CheckIcon /> : <PenIcon />}
              </button>
            </div>
          </div>
        </div>

        <span className={`${styles.buffTopTag} ${isDebuff ? styles.buffTopTagDebuff : styles.buffTopTagBuff}`}>
          {subtitle}
        </span>
      </div>

      <div className={styles.buffDescEditor}>
        <div className={styles.buffSectionLabel}>描述</div>
        <textarea
          value={descriptionDraft}
          rows={4}
          disabled={saving}
          className={styles.buffDescTextarea}
          onChange={(event) => onDescriptionChange(entry.buffId, event.target.value)}
        />
        <div className={styles.buffDescActions}>
          <button
            type="button"
            disabled={saving || !canSaveDescription}
            className={styles.buffDescSave}
            onClick={() => onDescriptionSave(entry, descriptionDraft)}
          >
            保存描述
          </button>
        </div>
      </div>

      {/* Attribute selector */}
      <div className={styles.buffAttrRow}>
        <span className={styles.buffAttrLabel}>属性</span>
        <select
          className={styles.buffAttrSelect}
          disabled={saving}
          value={entry.attribute}
          onChange={(event) => {
            const nextAttribute = event.target.value as BuffAttribute;
            if (nextAttribute !== entry.attribute) {
              onAttributeChange(entry, nextAttribute);
            }
          }}
        >
          {BUFF_ATTRIBUTES.map((attr) => (
            <option key={attr} value={attr}>
              {attr}
            </option>
          ))}
        </select>
        <label className={styles.buffHiddenToggle}>
          <input
            type="checkbox"
            checked={entry.hidden}
            disabled={saving}
            onChange={(event) => onHiddenChange(entry, event.target.checked)}
          />
          隐藏
        </label>
      </div>

      {sourceAbilityIcon && (
        <div className={styles.buffCardFooter}>
          <img
            src={sourceAbilityIcon}
            alt={entry.sourceAbilityName ?? entry.name}
            title={entry.sourceAbilityName ?? undefined}
            className={styles.buffSourceAbilityIcon}
            draggable={false}
            loading="lazy"
          />
        </div>
      )}
    </article>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.penIcon}>
      <path
        d="M14.85 2.65a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L8.1 14.4l-3.22.72.72-3.22 9.25-9.25Z"
        fill="currentColor"
      />
      <path d="M11.2 4.2l4.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.penIcon}>
      <path
        d="M4.5 10.5 8 14l7.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
