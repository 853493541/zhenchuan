"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { toastError, toastSuccess } from "../../../components/toast/toast";
import { FALLBACK_BUFF_ICON_PATH } from "../../../lib/buffIcons";
import {
  BUFF_ATTRIBUTES,
  BUFF_PROPERTY_TYPES,
  BuffAttribute,
  BuffEditorSnapshot,
  BuffProperty,
  BuffPropertyType,
  formatUpdatedAt,
  getAbilityIconByName,
  getBuffIconPath,
  getBuffSubtitle,
} from "../../editorShared";
import styles from "../../page.module.css";

const PROPERTY_VALUE_CONFIG: Partial<
  Record<BuffPropertyType, { label: string; unit: string; min: number; max: number }>
> = {
  减伤: { label: "减伤值", unit: "%", min: 0, max: 100 },
  闪避: { label: "闪避率", unit: "%", min: 0, max: 100 },
};

export default function BuffDetailPage() {
  const params = useParams<{ buffId: string }>();
  const rawBuffId = Array.isArray(params.buffId) ? params.buffId[0] : params.buffId;
  const buffId = parseInt(rawBuffId ?? "", 10);

  const [snapshot, setSnapshot] = useState<BuffEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [durationSecDraft, setDurationSecDraft] = useState("");
  const [localProperties, setLocalProperties] = useState<BuffProperty[]>([]);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [prevEntryBuffId, setPrevEntryBuffId] = useState<number | null>(null);

  const loadSnapshot = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/game/ability-editor/buffs", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSnapshot(); }, []);

  const entry = useMemo(
    () => snapshot?.buffs.find((b) => b.buffId === buffId) ?? null,
    [snapshot, buffId]
  );

  useEffect(() => {
    if (!entry || entry.buffId === prevEntryBuffId) return;
    setNameDraft(entry.name);
    setDescriptionDraft(entry.description);
    setDurationSecDraft(entry.durationMs !== null ? String(entry.durationMs / 1000) : "");
    setLocalProperties(
      entry.properties.length > 0 ? [...entry.properties] : [...entry.baseProperties]
    );
    setPrevEntryBuffId(entry.buffId);
  }, [entry, prevEntryBuffId]);

  const trimmedName = nameDraft.trim();
  const canSaveName = trimmedName.length > 0 && trimmedName !== entry?.name.trim();
  const trimmedDesc = descriptionDraft.trim();
  const canSaveDesc = trimmedDesc.length > 0 && trimmedDesc !== entry?.description.trim();

  const parsedDurSec = parseFloat(durationSecDraft);
  const durationMsDraft = Number.isFinite(parsedDurSec) ? Math.round(parsedDurSec * 1000) : null;
  const canSaveDuration =
    durationMsDraft !== null &&
    durationMsDraft >= 100 &&
    durationMsDraft <= 300_000 &&
    durationMsDraft !== entry?.durationMs;

  const activeTypes = new Set(localProperties.map((p) => p.type));
  const availableTypes = BUFF_PROPERTY_TYPES.filter((t) => !activeTypes.has(t));

  const handleSaveName = async () => {
    if (!entry || !canSaveName) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmedName }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
      setIsEditingName(false);
      toastSuccess("已更新 Buff 名称");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDescription = async () => {
    if (!entry || !canSaveDesc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description: trimmedDesc }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
      toastSuccess("已更新描述");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDuration = async () => {
    if (!entry || !canSaveDuration || durationMsDraft === null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/duration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ durationMs: durationMsDraft }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
      toastSuccess(`已更新持续时间：${parsedDurSec}s`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAttributeChange = async (attribute: BuffAttribute) => {
    if (!entry) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/attribute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ attribute }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
      toastSuccess(`属性已设为 ${attribute}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleHiddenChange = async (hidden: boolean) => {
    if (!entry) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/hidden`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveProperties = async (props: BuffProperty[]) => {
    if (!entry) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/buffs/${entry.buffId}/properties`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ properties: props }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as BuffEditorSnapshot);
      toastSuccess("已更新功能");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAddProperty = (type: BuffPropertyType) => {
    const config = PROPERTY_VALUE_CONFIG[type];
    const defaultValue = config ? config.min : undefined;
    const newProp: BuffProperty = {
      type,
      ...(defaultValue !== undefined ? { value: defaultValue } : {}),
    };
    const next = [...localProperties, newProp];
    setLocalProperties(next);
    setShowAddPicker(false);
    saveProperties(next);
  };

  const handleRemoveProperty = (type: BuffPropertyType) => {
    const next = localProperties.filter((p) => p.type !== type);
    setLocalProperties(next);
    saveProperties(next);
  };

  const handlePropertyValueChange = (type: BuffPropertyType, value: number) => {
    setLocalProperties((prev) => prev.map((p) => (p.type === type ? { ...p, value } : p)));
  };

  const handlePropertyValueBlur = () => { saveProperties(localProperties); };

  const handleNoOverrideChange = (type: BuffPropertyType, noOverride: boolean) => {
    const next = localProperties.map((p) => (p.type === type ? { ...p, noOverride } : p));
    setLocalProperties(next);
    saveProperties(next);
  };

  if (loading) {
    return <div className={styles.page}><div className={styles.statePanel}>正在加载…</div></div>;
  }

  if (errorMessage) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <p className={styles.stateTitle}>加载失败</p>
          <p className={styles.stateCopy}>{errorMessage}</p>
          <Link href="/ability-editor?tab=buffs" className={styles.backLink}>← 返回</Link>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <p className={styles.stateTitle}>Buff 不存在</p>
          <p className={styles.stateCopy}>buffId: {buffId}</p>
          <Link href="/ability-editor?tab=buffs" className={styles.backLink}>← 返回</Link>
        </div>
      </div>
    );
  }

  const subtitle = getBuffSubtitle(entry);
  const iconSrc = getBuffIconPath(entry);
  const isDebuff = entry.category === "DEBUFF";
  const sourceAbilityIcon = entry.sourceAbilityName ? getAbilityIconByName(entry.sourceAbilityName) : null;

  return (
    <div className={styles.page}>
      {/* Top nav */}
      <div className={styles.buffDetailNav}>
        <Link href="/ability-editor?tab=buffs" className={styles.backLink}>
          ← 气劲列表
        </Link>
        <span className={styles.updatedAt}>
          最后保存：{formatUpdatedAt(snapshot?.updatedAt ?? null)}
        </span>
      </div>

      {/* ── 基本信息 ─────────────────────────────────── */}
      <section className={styles.buffDetailCard}>
        <h2 className={styles.buffDetailCardTitle}>基本信息</h2>

        <div className={styles.buffDetailBasicLayout}>
          {/* Icon */}
          <div className={styles.buffDetailIconCol}>
            <div className={styles.buffIconFrameLg}>
              <img
                src={iconSrc}
                alt={entry.name}
                draggable={false}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.src.endsWith(FALLBACK_BUFF_ICON_PATH)) img.src = FALLBACK_BUFF_ICON_PATH;
                  else img.style.opacity = "0.25";
                }}
              />
            </div>
            <div className={styles.buffDetailIdBadge}>ID {entry.buffId}</div>
          </div>

          {/* Fields */}
          <div className={styles.buffDetailFields}>
            {/* Name */}
            <div className={styles.buffDetailRow}>
              <span className={styles.buffDetailRowLabel}>名称</span>
              <div className={styles.buffDetailRowValue}>
                {isEditingName ? (
                  <input
                    value={nameDraft}
                    autoFocus
                    disabled={saving}
                    className={styles.buffNameInput}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSaveName) handleSaveName();
                      if (e.key === "Escape") setIsEditingName(false);
                    }}
                  />
                ) : (
                  <span className={styles.buffDetailRowText}>{entry.name}</span>
                )}
                <button
                  type="button"
                  disabled={saving || (isEditingName && trimmedName.length === 0)}
                  className={styles.buffNameIconButton}
                  onClick={() => {
                    if (isEditingName) { if (canSaveName) handleSaveName(); else setIsEditingName(false); }
                    else setIsEditingName(true);
                  }}
                  title={isEditingName ? "提交名称" : "编辑名称"}
                >
                  {isEditingName ? <CheckIcon /> : <PenIcon />}
                </button>
              </div>
            </div>

            {/* Duration */}
            <div className={styles.buffDetailRow}>
              <span className={styles.buffDetailRowLabel}>持续时间</span>
              <div className={styles.buffDetailRowValue}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={durationSecDraft}
                  disabled={saving}
                  className={styles.buffDetailDurInput}
                  onChange={(e) => {
                    // only allow digits and one decimal point
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    const clean = raw.replace(/^(\d*\.?\d*).*/, "$1");
                    setDurationSecDraft(clean);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSaveDuration) handleSaveDuration(); }}
                />
                <span className={styles.buffDetailRowUnit}>秒</span>
                {entry.baseDurationMs !== null && durationMsDraft !== null && durationMsDraft !== entry.baseDurationMs && (
                  <span className={styles.buffDetailRowHint}>原始: {entry.baseDurationMs / 1000}s</span>
                )}
                <button
                  type="button"
                  disabled={saving || !canSaveDuration}
                  className={styles.buffDetailSaveBtn}
                  onClick={handleSaveDuration}
                >
                  保存
                </button>
              </div>
            </div>

            {/* Source ability */}
            {entry.sourceAbilityName && (
              <div className={styles.buffDetailRow}>
                <span className={styles.buffDetailRowLabel}>来源招式</span>
                <div className={styles.buffDetailRowValue}>
                  {sourceAbilityIcon && (
                    <img
                      src={sourceAbilityIcon}
                      alt={entry.sourceAbilityName}
                      className={styles.buffDetailSourceIcon}
                      draggable={false}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <span className={styles.buffDetailRowText}>{entry.sourceAbilityName}</span>
                </div>
              </div>
            )}

            {/* Type + hidden */}
            <div className={styles.buffDetailRow}>
              <span className={styles.buffDetailRowLabel}>类型</span>
              <div className={styles.buffDetailRowValue}>
                <select
                  className={styles.buffAttrSelect}
                  disabled={saving || entry.hidden}
                  value={entry.attribute}
                  onChange={(e) => handleAttributeChange(e.target.value as BuffAttribute)}
                  title={entry.hidden ? "隐藏 Buff 不可设置属性" : undefined}
                >
                  {BUFF_ATTRIBUTES.map((attr) => (
                    <option key={attr} value={attr}>{attr}</option>
                  ))}
                </select>
                {subtitle && (
                  <span className={`${styles.buffTopTag} ${isDebuff ? styles.buffTopTagDebuff : styles.buffTopTagBuff}`}>
                    {subtitle}
                  </span>
                )}
                <label className={styles.buffHiddenToggle}>
                  <input
                    type="checkbox"
                    checked={entry.hidden}
                    disabled={saving}
                    onChange={(e) => handleHiddenChange(e.target.checked)}
                  />
                  隐藏
                </label>
              </div>
            </div>

            {/* Description */}
            <div className={styles.buffDetailRow}>
              <span className={styles.buffDetailRowLabel}>描述</span>
              <div className={styles.buffDetailRowValueCol}>
                <textarea
                  value={descriptionDraft}
                  rows={3}
                  disabled={saving}
                  className={styles.buffDescTextarea}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                />
                <div className={styles.buffDescActions}>
                  <button
                    type="button"
                    disabled={saving || !canSaveDesc}
                    className={styles.buffDescSave}
                    onClick={handleSaveDescription}
                  >
                    保存描述
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 功能 ──────────────────────────────────────── */}
      <section className={styles.buffDetailCard}>
        <h2 className={styles.buffDetailCardTitle}>功能</h2>


        <div className={styles.buffPropertyList}>
          {localProperties.map((prop) => {
            const config = PROPERTY_VALUE_CONFIG[prop.type];
            return (
              <div key={prop.type} className={styles.buffPropertyItem}>
                <span className={styles.buffPropertyItemName}>{prop.type}</span>
                {config && (
                  <>
                    <span className={styles.buffPropValueLabel}>{config.label}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={saving}
                      className={styles.buffPropValueInput}
                      value={prop.value ?? config.min}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        const n = parseInt(raw, 10);
                        handlePropertyValueChange(
                          prop.type,
                          raw === "" ? config.min : Number.isFinite(n)
                            ? Math.max(config.min, Math.min(config.max, n))
                            : config.min
                        );
                      }}
                      onBlur={(e) => {
                        // re-derive from DOM value to avoid stale closure
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        const n = parseInt(raw, 10);
                        const clamped = Number.isFinite(n)
                          ? Math.max(config.min, Math.min(config.max, n))
                          : config.min;
                        const updated = localProperties.map((p2) =>
                          p2.type === prop.type ? { ...p2, value: clamped } : p2
                        );
                        setLocalProperties(updated);
                        saveProperties(updated);
                      }}
                    />
                    <span className={styles.buffPropValueUnit}>{config.unit}</span>
                  </>
                )}
                {prop.type === "减伤" && (
                  <label className={styles.buffPropNoOverride}>
                    <input
                      type="checkbox"
                      checked={prop.noOverride ?? false}
                      disabled={saving}
                      onChange={(e) => handleNoOverrideChange(prop.type, e.target.checked)}
                    />
                    不可被顶
                  </label>
                )}
                <button
                  type="button"
                  disabled={saving}
                  className={styles.buffPropertyRemoveBtn}
                  onClick={() => handleRemoveProperty(prop.type)}
                  title={`移除 ${prop.type}`}
                  aria-label={`移除 ${prop.type}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {availableTypes.length > 0 && (
          <div className={styles.buffAddPropertyRow}>
            {showAddPicker ? (
              <>
                <select
                  className={styles.buffAddPropertySelect}
                  defaultValue=""
                  autoFocus
                  onChange={(e) => { if (e.target.value) handleAddProperty(e.target.value as BuffPropertyType); }}
                >
                  <option value="" disabled>选择功能…</option>
                  {availableTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button type="button" className={styles.buffAddPropertyCancel} onClick={() => setShowAddPicker(false)}>
                  取消
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={saving}
                className={styles.buffAddPropertyBtn}
                onClick={() => setShowAddPicker(true)}
              >
                + 添加功能
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.penIcon}>
      <path d="M14.85 2.65a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L8.1 14.4l-3.22.72.72-3.22 9.25-9.25Z" fill="currentColor" />
      <path d="M11.2 4.2l4.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.penIcon}>
      <path d="M4.5 10.5 8 14l7.5-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
