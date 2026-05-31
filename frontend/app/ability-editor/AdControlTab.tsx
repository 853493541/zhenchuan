"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import { AD_CONTROL_COEFF_ROWS } from "./adControlCoeffRows";
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

type AbilityWithAdStatus = AbilityEditorAbility & { adControlStatus: DescriptionReviewStatus };
type RowAction = { label: string; status: DescriptionReviewStatus; tint: string };
type AdControlColumnKey = "no-bonus" | DescriptionReviewStatus;
type AdControlRowEntry = {
  rowId: string;
  sourceIndex: number;
  ability: AbilityWithAdStatus;
  outputType: string;
  textCoeff: string;
  setting: AbilityEditorNumericSetting | null;
};
type AdControlAbilityEntry = {
  rowId: string;
  ability: AbilityWithAdStatus;
  rows: AdControlRowEntry[];
};

const STATUS_CONFIG: Record<AdControlColumnKey, { title: string; background: string; color: string; border: string; empty: string; actions: RowAction[] }> = {
  "no-bonus": {
    title: "无加成",
    background: "#edf3ff",
    color: "#2a4b8d",
    border: "#b7c8ea",
    empty: "当前没有无加成条目",
    actions: [],
  },
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

function formatTextCoeffQuickValue(raw: string): string | null {
  const first = extractNumericCandidates(raw)[0];
  if (!Number.isFinite(first)) return null;
  return formatMultiplier(first);
}

function extractNumericCandidates(raw: string): number[] {
  const matches = raw.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const nums = matches
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value));
  return Array.from(new Set(nums));
}

function nearestDiff(value: number, candidates: number[]): number {
  if (candidates.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const diff = Math.abs(value - candidate);
    if (diff < best) best = diff;
  }
  return best;
}

function scoreRowSetting(
  row: { outputType: string; textCoeff: string; currentCoeff: string },
  setting: AbilityEditorNumericSetting
) {
  const output = row.outputType;
  const label = setting.label;
  let score = 0;

  const isDot = output.includes("持续");
  const isExtra = output.includes("额外");
  const isExplode = output.includes("引爆");

  if (isDot && label.includes("持续")) score += 8;
  if (isExtra && /额外|附加|读条完成/.test(label)) score += 6;
  if (isExplode && /引爆|延时|读条完成|范围/.test(label)) score += 7;
  if (output === "造成伤害" && label.includes("伤害") && !label.includes("持续")) score += 3;

  const coeffCandidates = [
    ...extractNumericCandidates(row.currentCoeff),
    ...extractNumericCandidates(row.textCoeff),
  ];
  const diff = nearestDiff(setting.value, coeffCandidates);

  if (Number.isFinite(diff)) {
    if (diff <= 1e-6) score += 14;
    else if (diff <= 1e-3) score += 10;
    else if (diff <= 5e-2) score += 6;
    else if (diff <= 2e-1) score += 3;
  }

  if (score === 0 && label.includes("伤害")) score = 1;
  return { score, diff };
}

function assignSettingsForRows(
  rows: Array<{ outputType: string; textCoeff: string; currentCoeff: string }>,
  settings: AbilityEditorNumericSetting[]
) {
  const assignments: Array<number | null> = new Array(rows.length).fill(null);
  if (rows.length === 0 || settings.length === 0) return assignments;

  const isNoBonusRow = (row: { outputType: string }) => row.outputType === "无加成";

  const pairs: Array<{ rowIndex: number; settingIndex: number; score: number; diff: number }> = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (isNoBonusRow(rows[rowIndex])) continue;
    for (let settingIndex = 0; settingIndex < settings.length; settingIndex += 1) {
      const { score, diff } = scoreRowSetting(rows[rowIndex], settings[settingIndex]);
      pairs.push({ rowIndex, settingIndex, score, diff });
    }
  }

  pairs.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.diff - right.diff;
  });

  const usedRows = new Set<number>();
  const usedSettings = new Set<number>();

  for (const pair of pairs) {
    if (usedRows.has(pair.rowIndex) || usedSettings.has(pair.settingIndex)) continue;
    if (pair.score <= 0) continue;
    assignments[pair.rowIndex] = pair.settingIndex;
    usedRows.add(pair.rowIndex);
    usedSettings.add(pair.settingIndex);
  }

  // Fallback: assign remaining rows by first free setting to minimize null rows.
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (isNoBonusRow(rows[rowIndex])) continue;
    if (assignments[rowIndex] !== null) continue;
    const fallbackSetting = settings.findIndex((_, idx) => !usedSettings.has(idx));
    if (fallbackSetting === -1) continue;
    assignments[rowIndex] = fallbackSetting;
    usedSettings.add(fallbackSetting);
  }

  return assignments;
}

export default function AdControlTab({ snapshot, loading, onSnapshotUpdate }: Props) {
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [priorityAbilityIds, setPriorityAbilityIds] = useState<Record<DescriptionReviewStatus, string[]>>({
    "needs-more": [],
    unfixed: [],
    fixed: [],
  });
  const autosaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return () => {
      for (const timer of Object.values(autosaveTimersRef.current)) {
        clearTimeout(timer);
      }
      autosaveTimersRef.current = {};
    };
  }, []);

  const allAbilities = useMemo<AbilityWithAdStatus[]>(() => {
    return (snapshot?.abilities ?? [])
      .filter((ability): ability is AbilityWithAdStatus => Boolean(ability?.id))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  }, [snapshot]);

  const coeffRowEntries = useMemo<AdControlRowEntry[]>(() => {
    const abilityByName = new Map<string, AbilityWithAdStatus>();
    for (const ability of allAbilities) {
      if (!abilityByName.has(ability.name)) {
        abilityByName.set(ability.name, ability);
      }
    }

    const rowBuckets = new Map<string, Array<{ row: (typeof AD_CONTROL_COEFF_ROWS)[number]; sourceIndex: number }>>();
    for (let index = 0; index < AD_CONTROL_COEFF_ROWS.length; index += 1) {
      const row = AD_CONTROL_COEFF_ROWS[index];
      const bucket = rowBuckets.get(row.abilityName) ?? [];
      bucket.push({ row, sourceIndex: index });
      rowBuckets.set(row.abilityName, bucket);
    }

    const rowToSettingIndex = new Map<number, number | null>();
    for (const [abilityName, bucket] of rowBuckets.entries()) {
      const ability = abilityByName.get(abilityName);
      if (!ability) continue;

      const assignments = assignSettingsForRows(
        bucket.map((entry) => ({
          outputType: entry.row.outputType,
          textCoeff: entry.row.textCoeff,
          currentCoeff: entry.row.currentCoeff,
        })),
        ability.damageSettings
      );

      for (let i = 0; i < bucket.length; i += 1) {
        rowToSettingIndex.set(bucket[i].sourceIndex, assignments[i]);
      }
    }

    const rows: AdControlRowEntry[] = [];

    for (let index = 0; index < AD_CONTROL_COEFF_ROWS.length; index += 1) {
      const row = AD_CONTROL_COEFF_ROWS[index];
      const ability = abilityByName.get(row.abilityName);
      if (!ability) continue;

      const settingIndex = rowToSettingIndex.get(index) ?? null;

      rows.push({
        rowId: `${ability.id}:${index}:${row.outputType}`,
        sourceIndex: index,
        ability,
        outputType: row.outputType,
        textCoeff: row.textCoeff,
        setting: settingIndex === null ? null : ability.damageSettings[settingIndex] ?? null,
      });
    }

    return rows;
  }, [allAbilities]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return coeffRowEntries;
    return coeffRowEntries.filter(({ ability, outputType, textCoeff, setting }) => {
      const searchable = [
        ability.name,
        ability.description,
        outputType,
        textCoeff,
        setting?.label ?? "",
      ].join(" ").toLowerCase();
      return searchable.includes(normalizedSearch);
    });
  }, [coeffRowEntries, search]);

  const filteredAbilities = useMemo<AdControlAbilityEntry[]>(() => {
    const byAbility = new Map<string, AdControlAbilityEntry>();
    for (const row of filteredRows) {
      const existing = byAbility.get(row.ability.id);
      if (existing) {
        existing.rows.push(row);
      } else {
        byAbility.set(row.ability.id, {
          rowId: row.ability.id,
          ability: row.ability,
          rows: [row],
        });
      }
    }

    const entries = Array.from(byAbility.values());
    entries.forEach((entry) => {
      entry.rows.sort((left, right) => left.sourceIndex - right.sourceIndex);
    });
    return entries;
  }, [filteredRows]);

  const grouped = useMemo(() => {
    const isNoBonusAbility = (entry: AdControlAbilityEntry) =>
      entry.rows.length > 0 && entry.rows.every((row) => row.outputType === "无加成");

    const byColumn: Record<AdControlColumnKey, AdControlAbilityEntry[]> = {
      "no-bonus": filteredAbilities.filter(isNoBonusAbility),
      "needs-more": filteredAbilities.filter((entry) => !isNoBonusAbility(entry) && entry.ability.adControlStatus === "needs-more"),
      unfixed: filteredAbilities.filter((entry) => !isNoBonusAbility(entry) && entry.ability.adControlStatus === "unfixed"),
      fixed: filteredAbilities.filter((entry) => !isNoBonusAbility(entry) && entry.ability.adControlStatus === "fixed"),
    };

    const sortByPriority = (entries: AdControlAbilityEntry[], status: DescriptionReviewStatus) => {
      const ranked = new Map(priorityAbilityIds[status].map((abilityId, index) => [abilityId, index]));
      return [...entries].sort((left, right) => {
        const leftRank = ranked.get(left.ability.id);
        const rightRank = ranked.get(right.ability.id);
        if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
        if (leftRank !== undefined) return -1;
        if (rightRank !== undefined) return 1;
        return left.ability.name.localeCompare(right.ability.name, "zh-Hans-CN");
      });
    };

    byColumn["needs-more"] = sortByPriority(byColumn["needs-more"], "needs-more");
    byColumn.fixed = sortByPriority(byColumn.fixed, "fixed");

    return byColumn;
  }, [filteredAbilities, priorityAbilityIds]);

  const uniqueAbilityCount = useMemo(() => new Set(coeffRowEntries.map((entry) => entry.ability.id)).size, [coeffRowEntries]);

  const saveDamageSetting = async (ability: AbilityWithAdStatus, setting: AbilityEditorNumericSetting, rawValue?: string) => {
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

  const saveAbilityDrafts = async (ability: AbilityWithAdStatus) => {
    for (const setting of ability.damageSettings) {
      const key = `${ability.id}:${setting.id}`;
      if (!Object.prototype.hasOwnProperty.call(drafts, key)) continue;
      const ok = await saveDamageSetting(ability, setting, drafts[key]);
      if (!ok) return false;
    }
    return true;
  };

  const updateStatus = async (ability: AbilityWithAdStatus, status: DescriptionReviewStatus) => {
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
      if (status === "needs-more" || status === "fixed") {
        setPriorityAbilityIds((current) => ({
          ...current,
          [status]: [ability.id, ...current[status].filter((id) => id !== ability.id)],
        }));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "状态保存失败");
    } finally {
      setSavingKey(null);
    }
  };

  const scheduleAutosave = (ability: AbilityWithAdStatus, setting: AbilityEditorNumericSetting, key: string, value: string) => {
    const existing = autosaveTimersRef.current[key];
    if (existing) {
      clearTimeout(existing);
    }
    autosaveTimersRef.current[key] = setTimeout(() => {
      void saveDamageSetting(ability, setting, value);
      delete autosaveTimersRef.current[key];
    }, 450);
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
          <div className={styles.adControlMeta}>条目 {coeffRowEntries.length} · 技能 {uniqueAbilityCount}</div>
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
        {(["no-bonus", "needs-more", "unfixed", "fixed"] as AdControlColumnKey[]).map((status) => {
          const config = STATUS_CONFIG[status];
          const entries = grouped[status];
          return (
            <section key={status} className={styles.adControlColumn} style={{ "--ad-column-border": config.border } as React.CSSProperties}>
              <div className={styles.adControlColumnTitle} style={{ background: config.background, color: config.color, borderBottomColor: config.border }}>
                {config.title} ({entries.length})
              </div>
              <div className={styles.adControlColumnBody}>
                {entries.length === 0 ? (
                  <div className={styles.adControlEmpty}>{config.empty}</div>
                ) : entries.map((entry) => {
                  const { ability, rows } = entry;
                  return (
                  <article key={entry.rowId} className={styles.adControlReviewRow}>
                    <div className={styles.adAbilityHead}>
                      <div className={styles.adAbilityIconFrame}>
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
                      {rows.map((row) => {
                        if (!row.setting) {
                          return (
                            <label key={`${row.rowId}:unmatched`} className={styles.adSettingRow}>
                              <span className={styles.adSettingLabel}>{row.outputType}</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={`${styles.adNumericInput} ${styles.adNumericInputDisabled}`}
                                value=""
                                placeholder="未匹配"
                                disabled
                                readOnly
                              />
                            </label>
                          );
                        }

                        const key = `${ability.id}:${row.setting.id}`;
                        const draftValue = drafts[key] ?? formatMultiplier(row.setting.value);
                        const quickTextCoeff = formatTextCoeffQuickValue(row.textCoeff);
                        const disabled = savingKey === key || savingKey === `${ability.id}:status`;

                        return (
                          <label key={`${row.rowId}:${row.setting.id}`} className={styles.adSettingRow}>
                            <span className={styles.adSettingLabel}>{row.outputType}</span>
                            <span className={styles.adSettingControl}>
                              <span className={styles.adCoeffQuick}>
                                <span className={styles.adCoeffValue}>{quickTextCoeff ?? "-"}</span>
                                <button
                                  type="button"
                                  className={styles.adCoeffApplyButton}
                                  disabled={disabled || quickTextCoeff === null}
                                  onClick={() => {
                                    if (!quickTextCoeff) return;
                                    setDrafts((current) => ({ ...current, [key]: quickTextCoeff }));
                                    void saveDamageSetting(ability, row.setting, quickTextCoeff);
                                  }}
                                >
                                  {">"}
                                </button>
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={styles.adNumericInput}
                                value={draftValue}
                                disabled={disabled}
                                onChange={(event) => {
                                  const cleaned = cleanDecimalInput(event.target.value);
                                  setDrafts((current) => ({ ...current, [key]: cleaned }));
                                  scheduleAutosave(ability, row.setting, key, cleaned);
                                }}
                                onBlur={(event) => {
                                  const timer = autosaveTimersRef.current[key];
                                  if (timer) {
                                    clearTimeout(timer);
                                    delete autosaveTimersRef.current[key];
                                  }
                                  const immediateValue = cleanDecimalInput(event.currentTarget.value);
                                  if (immediateValue.length > 0) {
                                    setDrafts((current) => ({ ...current, [key]: immediateValue }));
                                    void saveDamageSetting(ability, row.setting, immediateValue);
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                            </span>
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
                )})}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
