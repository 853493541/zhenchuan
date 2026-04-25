"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import BuffEditorTab from "./BuffEditorTab";
import ProjectileEditorTab from "./ProjectileEditorTab";
import {
  ABILITY_RARITIES,
  AbilityEditorAbility,
  AbilityEditorSnapshot,
  AbilityRarity,
  AbilitySchool,
  BuffEditorSnapshot,
  DAMAGE_TYPE_COLOR,
  DAMAGE_TYPES,
  DamageType,
  RARITY_COLOR,
  SCHOOL_COLOR,
  SCHOOL_TAGS,
  TAG_GROUP_DEFINITIONS,
  TagGroupId,
  abilityTypeLabel,
  formatUpdatedAt,
  getAbilityIconByName,
  getSimpleDescription,
  getStatValue,
  targetTypeLabel,
} from "./editorShared";

const RARITY_CARD_BG: Record<string, string> = {
  "精巧": "rgba(105, 219, 124, 0.09)",
  "卓越": "rgba(116, 192, 252, 0.09)",
  "珍奇": "rgba(204, 93, 232, 0.09)",
  "稀世": "rgba(255, 146, 43, 0.09)",
};
import styles from "./page.module.css";

type MainTab = "abilities" | "buffs" | "projectiles";

function buildOverviewTags(ability: AbilityEditorAbility) {
  const tags: string[] = [];

  const cooldown = getStatValue(ability.stats, "cooldownTicks");
  if (cooldown) tags.push(cooldown);

  const range = getStatValue(ability.stats, "range");
  if (range) tags.push(range);

  if (ability.channelInfo) {
    tags.push(ability.channelInfo.label);
  }

  const activeSkillProperties = ability.properties
    .filter((property) => property.enabled && property.group !== "读条")
    .slice(0, 2)
    .map((property) => property.label);

  return [...tags, ...activeSkillProperties];
}

export default function AbilityEditorPage() {
  const [mainTab, setMainTab] = useState<MainTab>("abilities");

  // Read ?tab= from URL on first mount to support deep-linking to the buff tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "buffs") {
      setMainTab("buffs");
    } else if (params.get("tab") === "projectiles") {
      setMainTab("projectiles");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ability snapshot ──────────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<AbilityEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Filter persistence via sessionStorage ────────────────────────────────
  const FILTER_KEY = "abilityEditorFilters_v2";
  const savedFilters = typeof window !== "undefined"
    ? (() => { try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? "null"); } catch { return null; } })()
    : null;
  const [search, setSearch] = useState<string>(savedFilters?.search ?? "");
  // tagFilters: groupId → "" (all) | "unset" | actual value
  const [tagFilters, setTagFilters] = useState<Record<TagGroupId, string>>(
    savedFilters?.tagFilters ?? { rarity: "", school: "", damageType: "" }
  );
  // Persist to sessionStorage whenever filters change
  useEffect(() => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ search, tagFilters })); } catch { /* ignore */ }
  }, [search, tagFilters]);

  const [errorMessage, setErrorMessage] = useState("");

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

      const nextSnapshot = (await response.json()) as AbilityEditorSnapshot;
      setSnapshot(nextSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  // ── Buff snapshot ─────────────────────────────────────────────────────────
  const [buffSnapshot, setBuffSnapshot] = useState<BuffEditorSnapshot | null>(null);
  const [buffLoading, setBuffLoading] = useState(false);
  const [buffError, setBuffError] = useState("");

  const loadBuffSnapshot = async () => {
    setBuffLoading(true);
    setBuffError("");

    try {
      const response = await fetch("/api/game/ability-editor/buffs", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setBuffSnapshot((await response.json()) as BuffEditorSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setBuffError(message);
    } finally {
      setBuffLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, []);

  // Load buff snapshot when the buff tab is first opened
  useEffect(() => {
    if (mainTab === "buffs" && !buffSnapshot && !buffLoading) {
      loadBuffSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  const updateTag = async (abilityId: string, tagGroup: TagGroupId, value: string | null) => {
    try {
      const res = await fetch(`/api/game/ability-editor/${abilityId}/tag`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tagGroup, value }),
      });
      if (!res.ok) return;
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
    } catch { /* silent */ }
  };

  const handleProjectileToggle = async (abilityId: string, isProjectile: boolean) => {
    try {
      const res = await fetch(`/api/game/ability-editor/${abilityId}/is-projectile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isProjectile }),
      });
      if (!res.ok) return;
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
    } catch { /* silent */ }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const abilities = (snapshot?.abilities ?? []).filter((ability) => {
    for (const [groupId, filterVal] of Object.entries(tagFilters)) {
      if (!filterVal) continue;
      if (filterVal === "unset") {
        if (ability.tags?.[groupId]) return false;
      } else {
        if (ability.tags?.[groupId] !== filterVal) return false;
      }
    }

    if (!normalizedSearch) {
      return true;
    }

    const searchableText = [
      ability.id,
      ability.name,
      ability.description,
      ...ability.properties.map((property) => property.label),
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedSearch);
  });

  // Count of abilities per school (from full snapshot, ignoring current filters)
  const schoolCounts = useMemo(() => {
    const all = snapshot?.abilities ?? [];
    const counts: Record<string, number> = { unset: 0 };
    for (const s of SCHOOL_TAGS) counts[s] = 0;
    for (const a of all) {
      const sc = (a.tags as any)?.school;
      if (sc && sc in counts) counts[sc]++;
      else counts.unset++;
    }
    return counts;
  }, [snapshot]);

  // Count of abilities per damageType
  const damageTypeCounts = useMemo(() => {
    const all = snapshot?.abilities ?? [];
    const counts: Record<string, number> = { unset: 0 };
    for (const dt of DAMAGE_TYPES) counts[dt] = 0;
    for (const a of all) {
      const dt = (a.tags as any)?.damageType;
      if (dt && dt in counts) counts[dt]++;
      else counts.unset++;
    }
    return counts;
  }, [snapshot]);

  return (
    <div className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.topRow}>
          <Link href="/" className={styles.backLink}>
            返回大厅
          </Link>
          <div className={styles.updatedAt}>最后保存：{formatUpdatedAt(snapshot?.updatedAt ?? null)}</div>
        </div>

        <div className={styles.headerBlock}>
          <p className={styles.eyebrow}>Ability Editor</p>
          <h1 className={styles.title}>能力属性与伤害编辑</h1>
          <p className={styles.subtitle}>
            总览层只负责浏览。点击技能卡片进入详情页后，再编辑属性、读条、冷却、范围和伤害。
          </p>
          <div className={styles.summaryRow}>
            <span className={styles.summaryPill}>技能 {snapshot?.abilities.length ?? 0}</span>
          </div>
        </div>

        {/* Main tab bar */}
        <div className={styles.mainTabBar}>
          <button
            type="button"
            className={`${styles.mainTab} ${mainTab === "abilities" ? styles.mainTabActive : ""}`}
            onClick={() => setMainTab("abilities")}
          >
            技能列表
          </button>
          <button
            type="button"
            className={`${styles.mainTab} ${mainTab === "buffs" ? styles.mainTabActive : ""}`}
            onClick={() => setMainTab("buffs")}
          >
            BUFF 编辑
          </button>
          <button
            type="button"
            className={`${styles.mainTab} ${mainTab === "projectiles" ? styles.mainTabActive : ""}`}
            onClick={() => setMainTab("projectiles")}
          >
            远程弹道技能
          </button>
        </div>
      </section>

      {/* ── Abilities tab ───────────────────────────────────────────────────── */}
      {mainTab === "abilities" && (
        <>
          <section className={styles.toolbar}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={styles.searchInput}
              placeholder="搜索技能名、ID 或属性名"
            />
          </section>

          <div className={styles.rarityFilterBar}>
            {/* Rarity row */}
            <div className={styles.tagFilterRow}>
              <span className={styles.rarityFilterLabel}>稀有度</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className={styles.rarityFilterBtn}
                  style={!tagFilters.rarity ? { background: "#544c40", color: "#fff", borderColor: "#544c40" } : {}}
                  onClick={() => setTagFilters((f) => ({ ...f, rarity: "" }))}
                >全部</button>
                <button type="button" className={styles.rarityFilterBtn}
                  style={{ borderColor: "#999", color: tagFilters.rarity === "unset" ? "#fff" : "#888", background: tagFilters.rarity === "unset" ? "#888" : "transparent" }}
                  onClick={() => setTagFilters((f) => ({ ...f, rarity: f.rarity === "unset" ? "" : "unset" }))}
                >未设置</button>
                {ABILITY_RARITIES.map((r) => {
                  const color = RARITY_COLOR[r as AbilityRarity];
                  const isActive = tagFilters.rarity === r;
                  return (
                    <button key={r} type="button" className={styles.rarityFilterBtn}
                      style={{ borderColor: color, color: isActive ? "#fff" : color, background: isActive ? color : "transparent" }}
                      onClick={() => setTagFilters((f) => ({ ...f, rarity: isActive ? "" : r }))}
                    >{r}</button>
                  );
                })}
              </div>
            </div>
            {/* 门派 row — rectangular buttons */}
            <div className={styles.tagFilterRow}>
              <span className={styles.rarityFilterLabel}>门派</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button type="button" className={styles.rarityFilterBtn}
                  style={!tagFilters.school ? { background: "#544c40", color: "#fff", borderColor: "#544c40", borderRadius: 3 } : { borderRadius: 3 }}
                  onClick={() => setTagFilters((f) => ({ ...f, school: "" }))}
                >全部</button>
                <button type="button" className={styles.rarityFilterBtn}
                  style={{ borderRadius: 3, borderColor: "#999", color: tagFilters.school === "unset" ? "#fff" : "#888", background: tagFilters.school === "unset" ? "#888" : "transparent" }}
                  onClick={() => setTagFilters((f) => ({ ...f, school: f.school === "unset" ? "" : "unset" }))}
                >未设置 {schoolCounts.unset > 0 ? schoolCounts.unset : ""}</button>
                {SCHOOL_TAGS.map((s) => {
                  const c = SCHOOL_COLOR[s as AbilitySchool];
                  const isActive = tagFilters.school === s;
                  const cnt = schoolCounts[s] ?? 0;
                  return (
                    <button key={s} type="button" className={styles.rarityFilterBtn}
                      style={{ borderRadius: 3, borderColor: c, color: isActive ? "#111" : c, background: isActive ? c : "transparent", padding: "2px 6px", fontSize: 12 }}
                      onClick={() => setTagFilters((f) => ({ ...f, school: isActive ? "" : s }))}
                    >{s}{cnt > 0 ? <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.75 }}>{cnt}</span> : null}</button>
                  );
                })}
              </div>
            </div>
            {/* 伤害类型 row */}
            <div className={styles.tagFilterRow}>
              <span className={styles.rarityFilterLabel}>伤害类型</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button type="button" className={styles.rarityFilterBtn}
                  style={!tagFilters.damageType ? { background: "#544c40", color: "#fff", borderColor: "#544c40", borderRadius: 3 } : { borderRadius: 3 }}
                  onClick={() => setTagFilters((f) => ({ ...f, damageType: "" }))}
                >全部</button>
                <button type="button" className={styles.rarityFilterBtn}
                  style={{ borderRadius: 3, borderColor: "#999", color: tagFilters.damageType === "unset" ? "#fff" : "#888", background: tagFilters.damageType === "unset" ? "#888" : "transparent" }}
                  onClick={() => setTagFilters((f) => ({ ...f, damageType: f.damageType === "unset" ? "" : "unset" }))}
                >未设置 {damageTypeCounts.unset > 0 ? damageTypeCounts.unset : ""}</button>
                {DAMAGE_TYPES.map((dt) => {
                  const c = DAMAGE_TYPE_COLOR[dt as DamageType];
                  const isActive = tagFilters.damageType === dt;
                  const cnt = damageTypeCounts[dt] ?? 0;
                  return (
                    <button key={dt} type="button" className={styles.rarityFilterBtn}
                      style={{ borderRadius: 3, borderColor: c, color: isActive ? "#111" : c, background: isActive ? c : "transparent", padding: "2px 6px", fontSize: 12 }}
                      onClick={() => setTagFilters((f) => ({ ...f, damageType: isActive ? "" : dt }))}
                    >{dt}{cnt > 0 ? <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.75 }}>{cnt}</span> : null}</button>
                  );
                })}
              </div>
            </div>
          </div>

          {loading && <div className={styles.statePanel}>正在加载技能属性…</div>}

          {!loading && errorMessage && (
            <div className={styles.statePanel}>
              <p className={styles.stateTitle}>加载失败</p>
              <p className={styles.stateCopy}>{errorMessage}</p>
              <button className={styles.retryButton} onClick={loadSnapshot}>
                重新加载
              </button>
            </div>
          )}

          {!loading && !errorMessage && abilities.length === 0 && (
            <div className={styles.statePanel}>
              <p className={styles.stateTitle}>没有匹配结果</p>
              <p className={styles.stateCopy}>换一个关键词，或者清除筛选条件。</p>
            </div>
          )}

          {!loading && !errorMessage && abilities.length > 0 && (
            <section className={styles.cardList}>
              {abilities.map((ability) => {
                const tags = buildOverviewTags(ability);

                return (
                  <Link key={ability.id} href={`/ability-editor/${ability.id}`} className={styles.cardLink}>
                    <article
                      className={styles.card}
                      style={{
                        background: ability.tags?.rarity ? RARITY_CARD_BG[ability.tags.rarity] : "#ffffff",
                        ...(ability.tags?.rarity ? { borderLeft: `3px solid ${RARITY_COLOR[ability.tags.rarity as AbilityRarity]}` } : {}),
                      }}
                    >
                      <div className={styles.cardTopRow}>
                        <div className={styles.cardIdentity}>
                          <div className={styles.iconFrame}>
                            <img
                              src={getAbilityIconByName(ability.name)}
                              alt={ability.name}
                              className={styles.abilityIcon}
                              draggable={false}
                              loading="lazy"
                            />
                          </div>

                          <div className={styles.cardHeadingBlock}>
                        <div className={styles.cardMetaRow}>
                          <span className={styles.typeBadge}>{abilityTypeLabel[ability.type]}</span>
                          <span className={styles.targetBadge}>{targetTypeLabel[ability.target]}</span>
                          {ability.tags?.rarity && (
                            <span style={{ display: "inline-flex", alignItems: "center", minHeight: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${RARITY_COLOR[ability.tags.rarity as AbilityRarity]}22`, color: RARITY_COLOR[ability.tags.rarity as AbilityRarity], border: `1px solid ${RARITY_COLOR[ability.tags.rarity as AbilityRarity]}88` }}>
                              {ability.tags.rarity}
                            </span>
                          )}
                          {ability.tags?.school && (() => {
                            const sc = SCHOOL_COLOR[ability.tags.school as AbilitySchool];
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", minHeight: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${sc}22`, color: sc, border: `1px solid ${sc}88` }}>
                                {ability.tags.school}
                              </span>
                            );
                          })()}
                          {ability.isProjectile && (
                            <span style={{ display: "inline-flex", alignItems: "center", minHeight: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#ffd24a22", color: "#c8930a", border: "1px solid #ffd24a88" }}>
                              弹道
                            </span>
                          )}
                        </div>
                        <h2 className={styles.cardTitle}>{ability.name}</h2>
                          </div>
                        </div>
                      </div>

                      <p className={styles.cardDescription}>{getSimpleDescription(ability.description)}</p>

                      {tags.length > 0 && (
                        <div className={styles.tagRow}>
                          {tags.map((tag) => (
                            <span key={tag} className={styles.infoTag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className={styles.cardFooter}>
                        <div className={styles.enterHint}>点击进入编辑</div>
                        <div
                          className={styles.tagBtnsArea}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        >
                          {/* Damage type buttons (single row) */}
                          <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                            {DAMAGE_TYPES.map((dt) => {
                              const color = DAMAGE_TYPE_COLOR[dt as DamageType];
                              const isActive = ability.tags?.damageType === dt;
                              return (
                                <button key={dt} type="button" className={styles.rarityBtn}
                                  style={{ borderColor: color, color: isActive ? "#111" : color, background: isActive ? color : "transparent", borderRadius: 3, padding: "1px 5px", fontSize: 11 }}
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void updateTag(ability.id, "damageType", isActive ? null : dt); }}
                                >{dt}</button>
                              );
                            })}
                          </div>
                          {/* Rarity buttons (single row) */}
                          <div className={styles.rarityBtnsRow}>
                            {ABILITY_RARITIES.map((r) => {
                              const color = RARITY_COLOR[r as AbilityRarity];
                              const isActive = ability.tags?.rarity === r;
                              return (
                                <button key={r} type="button" className={styles.rarityBtn}
                                  style={{ borderColor: color, color: isActive ? "#fff" : color, background: isActive ? color : "transparent" }}
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void updateTag(ability.id, "rarity", isActive ? null : r); }}
                                >{r}</button>
                              );
                            })}
                          </div>
                          {/* School buttons (flexible wrap, rectangular) */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                            {SCHOOL_TAGS.map((s) => {
                              const color = SCHOOL_COLOR[s as AbilitySchool];
                              const isActive = ability.tags?.school === s;
                              return (
                                <button key={s} type="button" className={styles.classBtn}
                                  style={{ borderColor: color, color: isActive ? "#111" : color, background: isActive ? color : "transparent" }}
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void updateTag(ability.id, "school", isActive ? null : s); }}
                                >{s}</button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </article>
                  </Link>
                );
              })}
            </section>
          )}
        </>
      )}

      {/* ── Buff editor tab ─────────────────────────────────────────────────── */}
      {mainTab === "buffs" && (
        <section className={styles.buffEditorSection}>
          <BuffEditorTab
            snapshot={buffSnapshot}
            loading={buffLoading}
            errorMessage={buffError}
            onSnapshotUpdate={setBuffSnapshot}
            onRetry={loadBuffSnapshot}
          />
        </section>
      )}

      {/* ── Projectile abilities tab ─────────────────────────────────────────── */}
      {mainTab === "projectiles" && (
        <section className={styles.buffEditorSection}>
          <ProjectileEditorTab
            snapshot={snapshot}
            loading={loading}
            onProjectileToggle={handleProjectileToggle}
          />
        </section>
      )}
    </div>
  );
}
