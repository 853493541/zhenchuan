"use client";

import React, { useMemo, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  AbilityEditorAbility,
  AbilityEditorNumericSetting,
  AbilityEditorSnapshot,
  DescriptionReviewStatus,
  getAbilityIconByName,
  parseNumericDraft,
} from "./editorShared";
import styles from "./page.module.css";

type Props = {
  snapshot: AbilityEditorSnapshot | null;
  loading: boolean;
  onSnapshotUpdate: (snapshot: AbilityEditorSnapshot) => void;
};

type DamageAbility = AbilityEditorAbility & { adControlStatus: DescriptionReviewStatus };
type RowAction = { label: string; status: DescriptionReviewStatus; tint: string };

const STATUS_CONFIG: Record<DescriptionReviewStatus, { title: string; background: string; color: string; border: string; empty: string; actions: RowAction[] }> = {
  "needs-more": {
    title: "需要补充",
    background: "#fff7e8",
    color: "#9a5b16",
    border: "#e7bc75",
    empty: "当前没有需要补充的条目",
    actions: [
      { label: "未修正", status: "unfixed", tint: "#7a6e62" },
      { label: "已修正", status: "fixed", tint: "#236f31" },
    ],
  },
  unfixed: {
    title: "未修正",
    background: "#f4f1eb",
    color: "#7a6e62",
    border: "#e4ddd4",
    empty: "当前没有未修正的条目",
    actions: [
      { label: "需要补充", status: "needs-more", tint: "#c8302d" },
      { label: "已修正", status: "fixed", tint: "#236f31" },
    ],
  },
  fixed: {
    title: "已修正",
    background: "#eef8f0",
    color: "#236f31",
    border: "#9ed5a8",
    empty: "当前没有已修正的条目",
    actions: [
      { label: "需要补充", status: "needs-more", tint: "#c8302d" },
      { label: "未修正", status: "unfixed", tint: "#7a6e62" },
    ],
  },
};

function cleanDecimalInput(value: string) {
  return value.replace(/[^0-9.\-]/g, "");
}

function formatMultiplier(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function isDamageAbility(ability: AbilityEditorAbility) {
  return ability.type === "ATTACK" || ability.damageSettings.length > 0;
}

export default function AdControlTab({ snapshot, loading, onSnapshotUpdate }: Props) {
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const allDamageAbilities = useMemo<DamageAbility[]>(() => {
    return (snapshot?.abilities ?? [])
      .filter((ability): ability is DamageAbility => isDamageAbility(ability))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  }, [snapshot]);

  const filteredAbilities = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return allDamageAbilities;
    return allDamageAbilities.filter((ability) => {
      const searchable = [
        ability.name,
        ability.description,
        ...ability.damageSettings.map((setting) => setting.label),
      ].join(" ").toLowerCase();
      return searchable.includes(normalizedSearch);
    });
  }, [allDamageAbilities, search]);

  const grouped = useMemo(() => ({
    "needs-more": filteredAbilities.filter((ability) => ability.adControlStatus === "needs-more"),
    unfixed: filteredAbilities.filter((ability) => ability.adControlStatus === "unfixed"),
    fixed: filteredAbilities.filter((ability) => ability.adControlStatus === "fixed"),
  }), [filteredAbilities]);

  const totalSettings = allDamageAbilities.reduce((sum, ability) => sum + ability.damageSettings.length, 0);

  const saveDamageSetting = async (ability: DamageAbility, setting: AbilityEditorNumericSetting, rawValue?: string) => {
    const key = `${ability.id}:${setting.id}`;
    const nextRawValue = rawValue ?? drafts[key] ?? String(setting.value);
    const parsed = parseNumericDraft(nextRawValue);
    if (parsed === null || savingKey) return false;

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
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  const saveAbilityDrafts = async (ability: DamageAbility) => {
    for (const setting of ability.damageSettings) {
      const key = `${ability.id}:${setting.id}`;
      if (!Object.prototype.hasOwnProperty.call(drafts, key)) continue;
      const ok = await saveDamageSetting(ability, setting, drafts[key]);
      if (!ok) return false;
    }
    return true;
  };

  const updateStatus = async (ability: DamageAbility, status: DescriptionReviewStatus) => {
    if (savingKey) return;
    const draftsSaved = await saveAbilityDrafts(ability);
    if (!draftsSaved) return;

    const key = `${ability.id}:status`;
    setSavingKey(key);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/game/ability-editor/ad-control/${ability.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      onSnapshotUpdate((await response.json()) as AbilityEditorSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "状态保存失败");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return <div className={styles.statePanel}>正在加载加成修正...</div>;
  }

  if (!snapshot) {
    return <div className={styles.statePanel}>暂无技能数据</div>;
  }

  return (
    <div className={styles.adControlShell}>
      <div className={styles.adControlHeader}>
        <div>
          <h2 className={styles.adControlTitle}>加成修正</h2>
          <div className={styles.adControlMeta}>技能 {allDamageAbilities.length} · 加成 {totalSettings}</div>
        </div>
        <div className={styles.adControlTools}>
          <input
            type="text"
            value={search}
            className={styles.adControlSearch}
            placeholder="搜索技能或描述"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {errorMessage && <div className={styles.adControlError}>{errorMessage}</div>}

      <div className={styles.adControlBoard}>
        {(["needs-more", "unfixed", "fixed"] as DescriptionReviewStatus[]).map((status) => {
          const config = STATUS_CONFIG[status];
          const abilities = grouped[status];
          return (
            <section key={status} className={styles.adControlColumn} style={{ "--ad-column-border": config.border } as React.CSSProperties}>
              <div className={styles.adControlColumnTitle} style={{ background: config.background, color: config.color, borderBottomColor: config.border }}>
                {config.title} ({abilities.length})
              </div>
              <div className={styles.adControlColumnBody}>
                {abilities.length === 0 ? (
                  <div className={styles.adControlEmpty}>{config.empty}</div>
                ) : abilities.map((ability) => (
                  <article key={ability.id} className={styles.adControlReviewRow}>
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
                        <div className={styles.adAbilityNameLine}>
                          <div className={styles.adAbilityName}>{ability.name}</div>
                          <CopyNameButton value={ability.name} />
                        </div>
                      </div>
                    </div>

                    <div className={styles.adAbilityDescription}>{ability.description}</div>

                    <div className={styles.adSettingList}>
                      {ability.damageSettings.length === 0 ? (
                        <div className={styles.adNoSettingRow}>暂无可编辑加成</div>
                      ) : ability.damageSettings.map((setting) => {
                        const key = `${ability.id}:${setting.id}`;
                        const draftValue = drafts[key] ?? formatMultiplier(setting.value);
                        const disabled = savingKey === key || savingKey === `${ability.id}:status`;
                        return (
                          <label key={setting.id} className={styles.adSettingRow}>
                            <span className={styles.adSettingLabel}>{setting.label}</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className={styles.adNumericInput}
                              value={draftValue}
                              disabled={disabled}
                              onChange={(event) => setDrafts((current) => ({ ...current, [key]: cleanDecimalInput(event.target.value) }))}
                              onBlur={() => {
                                if (Object.prototype.hasOwnProperty.call(drafts, key)) {
                                  void saveDamageSetting(ability, setting, drafts[key]);
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>

                    <div className={styles.adReviewActions}>
                      {config.actions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          disabled={savingKey === `${ability.id}:status`}
                          className={styles.adReviewButton}
                          style={{ "--ad-action-color": action.tint } as React.CSSProperties}
                          onClick={() => void updateStatus(ability, action.status)}
                        >
                          <span className={styles.adReviewButtonIcon}>{action.status === "fixed" ? "✓" : action.status === "needs-more" ? "X" : ""}</span>
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
