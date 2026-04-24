"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { toastError, toastSuccess } from "../../components/toast/toast";
import {
  AbilityEditorAbility,
  AbilityEditorChannelInfo,
  AbilityEditorNumericSetting,
  AbilityEditorPropertyState,
  AbilityEditorSnapshot,
  AbilitySchool,
  ABILITY_RARITIES,
  AbilityRarity,
  TAG_GROUP_DEFINITIONS,
  TagGroupId,
  RARITY_COLOR,
  SCHOOL_COLOR,
  SCHOOL_TAGS,
  abilityTypeLabel,
  formatUpdatedAt,
  getAbilityIconByName,
  getSimpleDescription,
  parseNumericDraft,
  targetTypeLabel,
} from "../editorShared";
import styles from "./page.module.css";

const FALLBACK_ICON = "/icons/default.png";

function findAbility(snapshot: AbilityEditorSnapshot | null, abilityId: string) {
  return snapshot?.abilities.find((ability) => ability.id === abilityId) ?? null;
}

function isNonChannelProperty(property: AbilityEditorPropertyState) {
  return property.group !== "读条";
}

export default function AbilityDetailPage() {
  const params = useParams<{ abilityId: string }>();
  const abilityId = Array.isArray(params.abilityId) ? params.abilityId[0] : params.abilityId;

  const [snapshot, setSnapshot] = useState<AbilityEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});

  const loadSnapshot = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/game/ability-editor", { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      setSnapshot((await response.json()) as AbilityEditorSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSnapshot(); }, []);

  const ability = useMemo(() => findAbility(snapshot, abilityId), [snapshot, abilityId]);

  const skillProperties = useMemo(
    () => ability?.properties.filter(isNonChannelProperty) ?? [],
    [ability]
  );
  const activeSkillProperties = skillProperties.filter((p) => p.enabled);
  const availableSkillProperties = skillProperties.filter((p) => !p.enabled);

  const channelInfo: AbilityEditorChannelInfo | null = ability?.channelInfo ?? null;
  const activeChannelProperties = channelInfo?.properties.filter((p) => p.enabled) ?? [];
  const availableChannelProperties = channelInfo?.properties.filter((p) => !p.enabled) ?? [];

  const getDraftKey = (fieldId: string) => `${abilityId}::${fieldId}`;

  const updateProperty = async (
    targetAbility: AbilityEditorAbility,
    property: AbilityEditorPropertyState,
    enabled: boolean
  ) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/${targetAbility.id}/property`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyId: property.id, enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
      toastSuccess(`${enabled ? "已添加" : "已移除"} ${property.label} · ${targetAbility.name}`);
    } catch (error) {
      toastError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const updateNumeric = async (
    targetAbility: AbilityEditorAbility,
    setting: AbilityEditorNumericSetting
  ) => {
    const draftKey = getDraftKey(setting.id);
    const rawValue = numericDrafts[draftKey] ?? String(setting.value);
    const parsedValue = parseNumericDraft(rawValue);
    if (parsedValue === null) { toastError("请输入有效数字"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/${targetAbility.id}/numeric`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fieldId: setting.id, value: parsedValue }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
      setNumericDrafts((d) => { const n = { ...d }; delete n[draftKey]; return n; });
      toastSuccess(`已更新 ${setting.label} · ${targetAbility.name}`);
    } catch (error) {
      toastError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const updateTag = async (targetAbility: AbilityEditorAbility, tagGroup: TagGroupId, value: string | null) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/game/ability-editor/${targetAbility.id}/tag`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tagGroup, value }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
      toastSuccess(value ? `标签已设为 ${value}` : `已清除标签`);
    } catch (error) {
      toastError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // Numeric input row — no arrow spinners, text-only
  const renderNumericRow = (
    targetAbility: AbilityEditorAbility,
    setting: AbilityEditorNumericSetting
  ) => {
    const draftKey = getDraftKey(setting.id);
    const draftValue = numericDrafts[draftKey] ?? String(setting.value);
    const parsedDraftValue = parseNumericDraft(draftValue);
    const canSave = parsedDraftValue !== null && parsedDraftValue !== setting.value && !saving;

    return (
      <div key={setting.id} className={styles.fieldRow}>
        <div className={styles.fieldLabel}>
          <span className={styles.fieldLabelText}>{setting.label}</span>
        </div>
        <div className={styles.fieldControl}>
          <input
            type="text"
            inputMode="decimal"
            className={styles.numericInput}
            value={draftValue}
            disabled={saving}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.\-]/g, "");
              setNumericDrafts((d) => ({ ...d, [draftKey]: raw }));
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) updateNumeric(targetAbility, setting); }}
          />
          <button
            type="button"
            className={styles.saveBtn}
            disabled={!canSave}
            onClick={() => updateNumeric(targetAbility, setting)}
          >
            保存
          </button>
        </div>
        <div className={styles.fieldMeta}>
          <span className={styles.fieldDesc}>{setting.description}</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className={styles.page}><div className={styles.statePanel}>正在加载技能详情…</div></div>;
  }

  if (errorMessage) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <p className={styles.stateTitle}>加载失败</p>
          <p className={styles.stateCopy}>{errorMessage}</p>
          <button className={styles.retryButton} onClick={loadSnapshot}>重新加载</button>
        </div>
      </div>
    );
  }

  if (!ability) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel}>
          <p className={styles.stateTitle}>没有找到这个技能</p>
          <p className={styles.stateCopy}>可能是技能 ID 不存在，或者数据还没有加载成功。</p>
          <Link href="/ability-editor" className={styles.backLink}>← 返回技能总览</Link>
        </div>
      </div>
    );
  }

  const iconSrc = getAbilityIconByName(ability.name);
  const isChannelAbility = !!ability.channelInfo;

  return (
    <div className={styles.page}>
      {/* Top nav */}
      <div className={styles.topNav}>
        <Link href="/ability-editor" className={styles.backLink}>← 技能列表</Link>
        <span className={styles.updatedAt}>最后保存：{formatUpdatedAt(snapshot?.updatedAt ?? null)}</span>
      </div>

      {/* ── 基本信息 ──────────────────────────────────── */}
      <section className={styles.detailCard}>
        <h2 className={styles.detailCardTitle}>基本信息</h2>
        <div className={styles.basicLayout}>
          {/* Icon column */}
          <div className={styles.iconCol}>
            <div className={styles.iconFrame}>
              <img
                src={iconSrc}
                alt={ability.name}
                draggable={false}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.src.endsWith(FALLBACK_ICON)) img.src = FALLBACK_ICON;
                  else img.style.opacity = "0.25";
                }}
              />
            </div>
            <div className={styles.idBadge}>{ability.id}</div>
          </div>

          {/* Fields column */}
          <div className={styles.fields}>
            {/* Name */}
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>名称</span>
              <span className={styles.infoValue}>{ability.name}</span>
            </div>

            {/* Type + Target */}
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>类型</span>
              <div className={styles.infoValue}>
                <span className={styles.typeBadge}>{abilityTypeLabel[ability.type]}</span>
                <span className={styles.targetBadge}>{targetTypeLabel[ability.target]}</span>
                {isChannelAbility && <span className={styles.channelBadge}>{channelInfo!.label}</span>}
              </div>
            </div>

            {/* Stats */}
            {ability.stats.length > 0 && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>数值</span>
                <div className={styles.statsRow}>
                  {ability.stats.map((stat) => (
                    <div key={stat.id} className={styles.statPill}>
                      <span className={styles.statLabel}>{stat.label}</span>
                      <strong className={styles.statValue}>{stat.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>描述</span>
              <p className={styles.descText}>{getSimpleDescription(ability.description)}</p>
            </div>

            {/* Tags (rarity + school) */}
            {/* Rarity */}
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{TAG_GROUP_DEFINITIONS.rarity.label}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {ABILITY_RARITIES.map((v) => {
                  const color = RARITY_COLOR[v as AbilityRarity] ?? "#aaa";
                  const isActive = ability.tags?.rarity === v;
                  return (
                    <button key={v} type="button" disabled={saving}
                      onClick={() => updateTag(ability, "rarity", isActive ? null : v)}
                      style={{ padding: "3px 10px", borderRadius: 4, border: `1px solid ${color}`, background: isActive ? color : "transparent", color: isActive ? "#1a1a2e" : color, fontWeight: isActive ? 700 : 400, fontSize: 12, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.55 : 1 }}
                    >{v}</button>
                  );
                })}
                {ability.tags?.rarity && (
                  <span style={{ fontSize: 11, color: "#888" }}>（点击已选中项可清除）</span>
                )}
              </div>
            </div>
            {/* School — 5 per row grid */}
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{TAG_GROUP_DEFINITIONS.school.label}</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, auto)", gap: 4 }}>
                {SCHOOL_TAGS.map((v) => {
                  const color = SCHOOL_COLOR[v as AbilitySchool] ?? "#aaa";
                  const isActive = ability.tags?.school === v;
                  return (
                    <button key={v} type="button" disabled={saving}
                      onClick={() => updateTag(ability, "school", isActive ? null : v)}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${color}`, background: isActive ? color : "transparent", color: isActive ? "#1a1a2e" : color, fontWeight: isActive ? 700 : 400, fontSize: 12, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.55 : 1, textAlign: "center" }}
                    >{v}</button>
                  );
                })}
              </div>
              {ability.tags?.school && (
                <span style={{ fontSize: 11, color: "#888", marginTop: 4, display: "block" }}>（点击已选中项可清除）</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 技能属性 ──────────────────────────────────── */}
      <section className={styles.detailCard}>
        <h2 className={styles.detailCardTitle}>技能属性</h2>

        {activeSkillProperties.length > 0 && (
          <div className={styles.chipRow}>
            {activeSkillProperties.map((property) => (
              <button
                key={property.id}
                type="button"
                className={styles.activeChip}
                disabled={saving}
                onClick={() => updateProperty(ability, property, false)}
                title={property.description}
              >
                {property.label}
                <span className={styles.chipRemove}>移除</span>
              </button>
            ))}
          </div>
        )}

        {availableSkillProperties.length > 0 && (
          <div className={styles.addRow}>
            <span className={styles.addLabel}>添加属性</span>
            <select
              className={styles.addSelect}
              defaultValue=""
              disabled={saving}
              onChange={(e) => {
                const property = availableSkillProperties.find((p) => p.id === e.target.value);
                e.target.value = "";
                if (property) updateProperty(ability, property, true);
              }}
            >
              <option value="">选择一个属性…</option>
              {availableSkillProperties.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        )}

        {activeSkillProperties.length === 0 && availableSkillProperties.length === 0 && (
          <p className={styles.emptyCopy}>没有可编辑的属性。</p>
        )}
      </section>

      {/* ── 读条设置 ─────────────────────────────────── */}
      {channelInfo && (
        <section className={styles.detailCard}>
          <h2 className={styles.detailCardTitle}>读条设置</h2>

          {/* Channel derived stats */}
          {channelInfo.derivedStats.length > 0 && (
            <div className={styles.statsRow} style={{ marginBottom: 16 }}>
              {channelInfo.derivedStats.map((stat) => (
                <div key={stat.id} className={styles.statPill}>
                  <span className={styles.statLabel}>{stat.label}</span>
                  <strong className={styles.statValue}>{stat.value}</strong>
                </div>
              ))}
            </div>
          )}

          {/* Channel properties */}
          {activeChannelProperties.length > 0 && (
            <div className={styles.chipRow}>
              {activeChannelProperties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  className={styles.activeChip}
                  disabled={saving}
                  onClick={() => updateProperty(ability, property, false)}
                  title={property.description}
                >
                  {property.label}
                  <span className={styles.chipRemove}>移除</span>
                </button>
              ))}
            </div>
          )}

          {availableChannelProperties.length > 0 && (
            <div className={styles.addRow}>
              <span className={styles.addLabel}>添加读条属性</span>
              <select
                className={styles.addSelect}
                defaultValue=""
                disabled={saving}
                onChange={(e) => {
                  const property = availableChannelProperties.find((p) => p.id === e.target.value);
                  e.target.value = "";
                  if (property) updateProperty(ability, property, true);
                }}
              >
                <option value="">选择一个属性…</option>
                {availableChannelProperties.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Channel timing numeric settings */}
          {channelInfo.timingSettings.length > 0 && (
            <div className={styles.numericList}>
              {channelInfo.timingSettings.map((setting) => renderNumericRow(ability, setting))}
            </div>
          )}
        </section>
      )}

      {/* ── 技能数值 ──────────────────────────────────── */}
      {ability.coreSettings.length > 0 && (
        <section className={styles.detailCard}>
          <h2 className={styles.detailCardTitle}>技能数值</h2>
          <div className={styles.numericList}>
            {ability.coreSettings.map((setting) => renderNumericRow(ability, setting))}
          </div>
        </section>
      )}

      {/* ── 伤害数值 ──────────────────────────────────── */}
      <section className={styles.detailCard}>
        <h2 className={styles.detailCardTitle}>伤害数值</h2>
        {ability.damageSettings.length > 0 ? (
          <div className={styles.numericList}>
            {ability.damageSettings.map((setting) => renderNumericRow(ability, setting))}
          </div>
        ) : (
          <p className={styles.emptyCopy}>这个技能当前没有可直接编辑的伤害项。</p>
        )}
      </section>
    </div>
  );
}
