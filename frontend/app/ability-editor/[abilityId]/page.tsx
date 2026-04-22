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
  abilityTypeLabel,
  formatUpdatedAt,
  getAbilityIconByName,
  getSimpleDescription,
  parseNumericDraft,
  targetTypeLabel,
} from "../editorShared";
import styles from "./page.module.css";

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
      const response = await fetch("/api/game/ability-editor", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setSnapshot((await response.json()) as AbilityEditorSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, []);

  const ability = useMemo(() => findAbility(snapshot, abilityId), [snapshot, abilityId]);

  const skillProperties = useMemo(
    () => ability?.properties.filter(isNonChannelProperty) ?? [],
    [ability]
  );
  const activeSkillProperties = skillProperties.filter((property) => property.enabled);
  const availableSkillProperties = skillProperties.filter((property) => !property.enabled);

  const channelInfo: AbilityEditorChannelInfo | null = ability?.channelInfo ?? null;
  const activeChannelProperties = channelInfo?.properties.filter((property) => property.enabled) ?? [];
  const availableChannelProperties = channelInfo?.properties.filter((property) => !property.enabled) ?? [];

  const getDraftKey = (fieldId: string) => `${abilityId}::${fieldId}`;

  const updateProperty = async (
    targetAbility: AbilityEditorAbility,
    property: AbilityEditorPropertyState,
    enabled: boolean
  ) => {
    setSaving(true);

    try {
      const response = await fetch(`/api/game/ability-editor/${targetAbility.id}/property`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          propertyId: property.id,
          enabled,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setSnapshot((await response.json()) as AbilityEditorSnapshot);
      toastSuccess(`${enabled ? "已添加" : "已移除"} ${property.label} · ${targetAbility.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      toastError(message);
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

    if (parsedValue === null) {
      toastError("请输入有效数字");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/game/ability-editor/${targetAbility.id}/numeric`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          fieldId: setting.id,
          value: parsedValue,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setSnapshot((await response.json()) as AbilityEditorSnapshot);
      setNumericDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[draftKey];
        return nextDrafts;
      });
      toastSuccess(`已更新 ${setting.label} · ${targetAbility.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      toastError(message);
    } finally {
      setSaving(false);
    }
  };

  const renderNumericEditor = (
    targetAbility: AbilityEditorAbility,
    setting: AbilityEditorNumericSetting
  ) => {
    const draftKey = getDraftKey(setting.id);
    const draftValue = numericDrafts[draftKey] ?? String(setting.value);
    const parsedDraftValue = parseNumericDraft(draftValue);
    const canSave = parsedDraftValue !== null && parsedDraftValue !== setting.value && !saving;

    return (
      <div key={setting.id} className={styles.numericRow}>
        <div className={styles.numericCopy}>
          <div className={styles.numericTitleRow}>
            <span className={styles.numericLabel}>{setting.label}</span>
            {setting.overridden && <span className={styles.overrideBadge}>覆盖</span>}
          </div>
          <div className={styles.numericDescription}>{setting.description}</div>
          <div className={styles.numericBase}>默认值 {setting.baseValue}</div>
        </div>

        <div className={styles.numericInputGroup}>
          <input
            type="number"
            step={setting.step ?? 1}
            className={styles.numericInput}
            value={draftValue}
            disabled={saving}
            onChange={(event) => {
              const nextValue = event.target.value;
              setNumericDrafts((currentDrafts) => ({
                ...currentDrafts,
                [draftKey]: nextValue,
              }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSave) {
                updateNumeric(targetAbility, setting);
              }
            }}
          />
          <button
            type="button"
            className={styles.saveButton}
            disabled={!canSave}
            onClick={() => updateNumeric(targetAbility, setting)}
          >
            保存
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className={styles.statePanel}>正在加载技能详情…</div>;
  }

  if (errorMessage) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.stateTitle}>加载失败</p>
        <p className={styles.stateCopy}>{errorMessage}</p>
        <button className={styles.retryButton} onClick={loadSnapshot}>
          重新加载
        </button>
      </div>
    );
  }

  if (!ability) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.stateTitle}>没有找到这个技能</p>
        <p className={styles.stateCopy}>可能是技能 ID 不存在，或者数据还没有加载成功。</p>
        <Link href="/ability-editor" className={styles.backLinkInline}>
          返回技能总览
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.topRow}>
          <Link href="/ability-editor" className={styles.backLink}>
            返回技能总览
          </Link>
          <div className={styles.updatedAt}>最后保存：{formatUpdatedAt(snapshot?.updatedAt ?? null)}</div>
        </div>

        <div className={styles.hero}>
          <div className={styles.heroIdentity}>
            <div className={styles.iconFrame}>
              <img
                src={getAbilityIconByName(ability.name)}
                alt={ability.name}
                className={styles.abilityIcon}
                draggable={false}
              />
            </div>

            <div className={styles.heroCopy}>
              <div className={styles.heroMetaRow}>
                <span className={styles.typeBadge}>{abilityTypeLabel[ability.type]}</span>
                <span className={styles.targetBadge}>{targetTypeLabel[ability.target]}</span>
                {ability.channelInfo && <span className={styles.channelBadge}>{ability.channelInfo.label}</span>}
                {ability.hasOverrides && <span className={styles.overrideBadge}>已覆盖默认值</span>}
              </div>
              <h1 className={styles.title}>{ability.name}</h1>
              <p className={styles.subtitle}>{getSimpleDescription(ability.description)}</p>
            </div>
          </div>

          <div className={styles.statGrid}>
            {ability.stats.map((stat) => (
              <div key={stat.id} className={styles.statCard}>
                <span className={styles.statLabel}>{stat.label}</span>
                <strong className={styles.statValue}>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.contentGrid}>
          <section className={styles.sectionCard}>
            <div className={styles.sectionTitle}>技能属性</div>

            {activeSkillProperties.length > 0 && (
              <div className={styles.activeChipRow}>
                {activeSkillProperties.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    className={styles.activeChip}
                    disabled={saving}
                    onClick={() => updateProperty(ability, property, false)}
                    title={property.description}
                  >
                    <span>{property.label}</span>
                    <span className={styles.chipAction}>移除</span>
                  </button>
                ))}
              </div>
            )}

            <div className={styles.addRow}>
              <label className={styles.addLabel} htmlFor="skill-property-select">
                添加技能属性
              </label>
              <select
                id="skill-property-select"
                className={styles.select}
                defaultValue=""
                disabled={saving || availableSkillProperties.length === 0}
                onChange={(event) => {
                  const nextPropertyId = event.target.value;
                  const property = availableSkillProperties.find((item) => item.id === nextPropertyId);
                  event.target.value = "";
                  if (!property) return;
                  updateProperty(ability, property, true);
                }}
              >
                <option value="">
                  {availableSkillProperties.length === 0 ? "没有可添加属性" : "选择一个属性"}
                </option>
                {availableSkillProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className={styles.sectionCard}>
            <div className={styles.sectionTitle}>技能数值</div>
            <div className={styles.numericList}>
              {ability.coreSettings.map((setting) => renderNumericEditor(ability, setting))}
            </div>
          </section>

          {channelInfo && (
            <section className={styles.sectionCard}>
              <div className={styles.sectionTitle}>读条设置</div>
              <div className={styles.channelSummaryRow}>
                {channelInfo.derivedStats.map((stat) => (
                  <div key={stat.id} className={styles.channelStatCard}>
                    <span className={styles.channelStatLabel}>{stat.label}</span>
                    <strong className={styles.channelStatValue}>{stat.value}</strong>
                  </div>
                ))}
              </div>

              {activeChannelProperties.length > 0 && (
                <div className={styles.activeChipRow}>
                  {activeChannelProperties.map((property) => (
                    <button
                      key={property.id}
                      type="button"
                      className={styles.activeChip}
                      disabled={saving}
                      onClick={() => updateProperty(ability, property, false)}
                      title={property.description}
                    >
                      <span>{property.label}</span>
                      <span className={styles.chipAction}>移除</span>
                    </button>
                  ))}
                </div>
              )}

              <div className={styles.addRow}>
                <label className={styles.addLabel} htmlFor="channel-property-select">
                  添加读条属性
                </label>
                <select
                  id="channel-property-select"
                  className={styles.select}
                  defaultValue=""
                  disabled={saving || availableChannelProperties.length === 0}
                  onChange={(event) => {
                    const nextPropertyId = event.target.value;
                    const property = availableChannelProperties.find((item) => item.id === nextPropertyId);
                    event.target.value = "";
                    if (!property) return;
                    updateProperty(ability, property, true);
                  }}
                >
                  <option value="">
                    {availableChannelProperties.length === 0 ? "没有可添加属性" : "选择一个属性"}
                  </option>
                  {availableChannelProperties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.numericList}>
                {channelInfo.timingSettings.map((setting) => renderNumericEditor(ability, setting))}
              </div>
            </section>
          )}

          <section className={`${styles.sectionCard} ${styles.damageSection}`}>
            <div className={styles.sectionTitle}>伤害数值</div>
            <div className={styles.numericList}>
              {ability.damageSettings.length > 0 ? (
                ability.damageSettings.map((setting) => renderNumericEditor(ability, setting))
              ) : (
                <div className={styles.emptyCopy}>这个技能当前没有可直接编辑的伤害项。</div>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}