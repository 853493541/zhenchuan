"use client";

import React, { useMemo, useState } from "react";

import {
  AbilityEditorAbility,
  AbilityEditorNumericSetting,
  AbilityEditorSnapshot,
  abilityTypeLabel,
  getAbilityIconByName,
  parseNumericDraft,
  targetTypeLabel,
} from "./editorShared";
import styles from "./page.module.css";

type Props = {
  snapshot: AbilityEditorSnapshot | null;
  loading: boolean;
  onSnapshotUpdate: (snapshot: AbilityEditorSnapshot) => void;
};

type DamageAbility = AbilityEditorAbility & { damageSettings: AbilityEditorNumericSetting[] };

function cleanDecimalInput(value: string) {
  return value.replace(/[^0-9.\-]/g, "");
}

function formatMultiplier(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

export default function AdControlTab({ snapshot, loading, onSnapshotUpdate }: Props) {
  const [search, setSearch] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const allDamageAbilities = useMemo<DamageAbility[]>(() => {
    return (snapshot?.abilities ?? [])
      .filter((ability): ability is DamageAbility => ability.damageSettings.length > 0)
      .map((ability) => ({ ...ability, damageSettings: ability.damageSettings }));
  }, [snapshot]);

  const filteredAbilities = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return allDamageAbilities
      .map((ability) => {
        const settings = onlyEdited
          ? ability.damageSettings.filter((setting) => setting.overridden)
          : ability.damageSettings;
        return { ability, settings };
      })
      .filter(({ ability, settings }) => {
        if (settings.length === 0) return false;
        if (!normalizedSearch) return true;
        const searchable = [
          ability.name,
          ability.description,
          abilityTypeLabel[ability.type],
          targetTypeLabel[ability.target],
          ...settings.map((setting) => setting.label),
        ].join(" ").toLowerCase();
        return searchable.includes(normalizedSearch);
      });
  }, [allDamageAbilities, onlyEdited, search]);

  const totalSettings = allDamageAbilities.reduce((sum, ability) => sum + ability.damageSettings.length, 0);
  const editedSettings = allDamageAbilities.reduce(
    (sum, ability) => sum + ability.damageSettings.filter((setting) => setting.overridden).length,
    0,
  );

  const updateDamageSetting = async (ability: AbilityEditorAbility, setting: AbilityEditorNumericSetting) => {
    const key = `${ability.id}:${setting.id}`;
    const parsed = parseNumericDraft(drafts[key] ?? String(setting.value));
    if (parsed === null || parsed === setting.value || savingKey) return;

    setSavingKey(key);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/game/ability-editor/${ability.id}/numeric`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fieldId: setting.id, value: parsed }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const nextSnapshot = (await response.json()) as AbilityEditorSnapshot;
      onSnapshotUpdate(nextSnapshot);
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return <div className={styles.statePanel}>正在加载AD倍率…</div>;
  }

  if (!snapshot) {
    return <div className={styles.statePanel}>暂无技能数据</div>;
  }

  return (
    <div className={styles.adControlShell}>
      <div className={styles.adControlHeader}>
        <div>
          <h2 className={styles.adControlTitle}>AD伤害倍率</h2>
          <div className={styles.adControlMeta}>技能 {allDamageAbilities.length} · 倍率 {totalSettings} · 已覆盖 {editedSettings}</div>
        </div>
        <div className={styles.adControlTools}>
          <input
            type="text"
            value={search}
            className={styles.adControlSearch}
            placeholder="搜索技能或倍率"
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className={styles.adControlToggle}>
            <input
              type="checkbox"
              checked={onlyEdited}
              onChange={(event) => setOnlyEdited(event.target.checked)}
            />
            <span>只看已覆盖</span>
          </label>
        </div>
      </div>

      {errorMessage && <div className={styles.adControlError}>{errorMessage}</div>}

      <div className={styles.adControlList}>
        {filteredAbilities.map(({ ability, settings }) => (
          <article key={ability.id} className={styles.adControlCard}>
            <div className={styles.adAbilityHead}>
              <div className={styles.iconFrame}>
                <img
                  src={getAbilityIconByName(ability.name)}
                  alt={ability.name}
                  className={styles.abilityIcon}
                  draggable={false}
                  loading="lazy"
                />
              </div>
              <div className={styles.adAbilityTitleBlock}>
                <div className={styles.adAbilityName}>{ability.name}</div>
                <div className={styles.adAbilityMeta}>{abilityTypeLabel[ability.type]} · {targetTypeLabel[ability.target]}</div>
              </div>
            </div>

            <div className={styles.adSettingList}>
              {settings.map((setting) => {
                const key = `${ability.id}:${setting.id}`;
                const draftValue = drafts[key] ?? formatMultiplier(setting.value);
                const parsed = parseNumericDraft(draftValue);
                const canSave = parsed !== null && parsed !== setting.value && !savingKey;
                return (
                  <div key={setting.id} className={styles.adSettingRow}>
                    <div className={styles.adSettingLabelBlock}>
                      <span className={styles.adSettingLabel}>{setting.label}</span>
                      <span className={setting.overridden ? styles.adOverrideBadge : styles.adDefaultBadge}>
                        {setting.overridden ? "已覆盖" : "默认"}
                      </span>
                    </div>
                    <div className={styles.adSettingControl}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={styles.adNumericInput}
                        value={draftValue}
                        disabled={savingKey === key}
                        onChange={(event) => setDrafts((current) => ({ ...current, [key]: cleanDecimalInput(event.target.value) }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && canSave) void updateDamageSetting(ability, setting);
                        }}
                      />
                      <button
                        type="button"
                        className={styles.adSaveButton}
                        disabled={!canSave}
                        onClick={() => void updateDamageSetting(ability, setting)}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}