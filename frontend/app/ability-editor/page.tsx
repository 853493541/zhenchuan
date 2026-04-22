"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  AbilityEditorAbility,
  AbilityEditorSnapshot,
  abilityTypeLabel,
  formatUpdatedAt,
  getAbilityIconByName,
  getSimpleDescription,
  getStatValue,
  targetTypeLabel,
} from "./editorShared";
import styles from "./page.module.css";

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
  const [snapshot, setSnapshot] = useState<AbilityEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showOnlyOverrides, setShowOnlyOverrides] = useState(false);
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

  useEffect(() => {
    loadSnapshot();
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const abilities = (snapshot?.abilities ?? []).filter((ability) => {
    if (showOnlyOverrides && !ability.hasOverrides) {
      return false;
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

  const overriddenCount = snapshot?.abilities.filter((ability) => ability.hasOverrides).length ?? 0;

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
            <span className={styles.summaryPill}>已覆盖 {overriddenCount}</span>
          </div>
        </div>
      </section>

      <section className={styles.toolbar}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={styles.searchInput}
          placeholder="搜索技能名、ID 或属性名"
        />

        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={showOnlyOverrides}
            onChange={(event) => setShowOnlyOverrides(event.target.checked)}
          />
          只看已覆盖技能
        </label>
      </section>

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
          <p className={styles.stateCopy}>换一个关键词，或者取消“只看已覆盖技能”。</p>
        </div>
      )}

      {!loading && !errorMessage && abilities.length > 0 && (
        <section className={styles.cardList}>
          {abilities.map((ability) => {
            const tags = buildOverviewTags(ability);

            return (
              <Link key={ability.id} href={`/ability-editor/${ability.id}`} className={styles.cardLink}>
                <article className={styles.card}>
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
                      {ability.hasOverrides && (
                        <span className={styles.overrideBadge}>已覆盖默认值</span>
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

                  <div className={styles.enterHint}>点击进入编辑</div>
                </article>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}