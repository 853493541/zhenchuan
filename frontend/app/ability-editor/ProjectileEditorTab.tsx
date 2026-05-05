"use client";

import { CSSProperties, ReactNode, useMemo, useState } from "react";

import CopyNameButton from "./CopyNameButton";
import {
  AbilityEditorAbility,
  AbilityEditorSnapshot,
  ABILITY_RARITIES,
  AbilityRarity,
  RARITY_COLOR,
  abilityTypeLabel,
  getAbilityIconByName,
  getSimpleDescription,
  targetTypeLabel,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import styles from "./page.module.css";

type DecisionMode = "manual-include" | "manual-exclude" | "clear";

interface Props {
  snapshot: AbilityEditorSnapshot | null;
  loading: boolean;
  onProjectileToggle: (abilityId: string, mode: DecisionMode) => Promise<void>;
}

export default function ProjectileEditorTab({ snapshot, loading, onProjectileToggle }: Props) {
  const [rarityFilter, setRarityFilter] = usePersistentState<string>("abilityEditor.projectiles.rarityFilter", "");
  const [search, setSearch] = usePersistentState<string>("abilityEditor.projectiles.search", "");
  const [toggling, setToggling] = useState<string | null>(null);

  const all = snapshot?.abilities ?? [];

  const filtered = useMemo(() => {
    let list = all;
    if (rarityFilter === "unset") list = list.filter((ability) => !ability.tags?.rarity);
    else if (rarityFilter) list = list.filter((ability) => ability.tags?.rarity === rarityFilter);

    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((ability) =>
        [ability.id, ability.name, ability.description, abilityTypeLabel[ability.type], targetTypeLabel[ability.target]]
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    }
    return list;
  }, [all, rarityFilter, search]);

  const excluded = filtered.filter((ability) => ability.manuallyProjectileExcluded);
  const undecided = filtered.filter((ability) => !ability.isProjectile && !ability.manuallyProjectileExcluded);
  const included = filtered.filter((ability) => ability.isProjectile);

  async function handleToggle(abilityId: string, mode: DecisionMode) {
    setToggling(abilityId);
    try {
      await onProjectileToggle(abilityId, mode);
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>正在加载技能属性…</div>;
  }

  return (
    <div style={{ maxWidth: 1260, margin: "0 auto", paddingTop: 16 }}>
      <div className={styles.rarityFilterBar}>
        <div className={styles.tagFilterRow}>
          <span className={styles.rarityFilterLabel}>稀有度</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className={styles.rarityFilterBtn}
              style={!rarityFilter ? { background: "#544c40", color: "#fff", borderColor: "#544c40" } : {}}
              onClick={() => setRarityFilter("")}
            >
              全部
            </button>
            <button
              type="button"
              className={styles.rarityFilterBtn}
              style={{
                borderColor: "#999",
                color: rarityFilter === "unset" ? "#fff" : "#888",
                background: rarityFilter === "unset" ? "#888" : "transparent",
              }}
              onClick={() => setRarityFilter((value) => (value === "unset" ? "" : "unset"))}
            >
              未设置
            </button>
            {ABILITY_RARITIES.map((rarity) => {
              const color = RARITY_COLOR[rarity as AbilityRarity];
              const isActive = rarityFilter === rarity;
              return (
                <button
                  key={rarity}
                  type="button"
                  className={styles.rarityFilterBtn}
                  style={{
                    borderColor: color,
                    color: isActive ? "#fff" : color,
                    background: isActive ? color : "transparent",
                  }}
                  onClick={() => setRarityFilter((value) => (value === rarity ? "" : rarity))}
                >
                  {rarity}
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.tagFilterRow}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.searchInput}
            placeholder="搜索技能名、ID、类型或描述"
            style={{ maxWidth: 340 }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          marginTop: 16,
          alignItems: "start",
        }}
      >
        <div>
          <SectionHeader title={`已声明非远程弹道 (${excluded.length})`} background="#fdf1f1" color="#8a4040" border="#e5b1b1" />
          <ListShell border="#e5b1b1" background="#fff8f8">
            {excluded.length === 0 ? (
              <EmptyState text="当前没有被排除的技能" />
            ) : (
              excluded.map((ability) => (
                <AbilityRow
                  key={ability.id}
                  ability={ability}
                  disabled={toggling === ability.id}
                  actionLabel="恢复"
                  actionTint="#8a4040"
                  onAction={() => handleToggle(ability.id, "clear")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader title={`未决定 (${undecided.length})`} background="#f4f1eb" color="#7a6e62" border="#e4ddd4" />
          <ListShell border="#e4ddd4" background="#ffffff">
            {undecided.length === 0 ? (
              <EmptyState text="当前没有未决定的技能" />
            ) : (
              undecided.map((ability) => (
                <DecisionAbilityRow
                  key={ability.id}
                  ability={ability}
                  disabled={toggling === ability.id}
                  onDecideCan={() => handleToggle(ability.id, "manual-include")}
                  onDecideNo={() => handleToggle(ability.id, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>

        <div>
          <SectionHeader title={`远程弹道技能 (${included.length})`} background="#eef5ff" color="#264a7a" border="#9ec1f0" />
          <ListShell border="#9ec1f0" background="#f8fbff">
            {included.length === 0 ? (
              <EmptyState text="当前没有远程弹道技能" />
            ) : (
              included.map((ability) => (
                <AbilityRow
                  key={ability.id}
                  ability={ability}
                  disabled={toggling === ability.id}
                  actionLabel="改为非弹道"
                  actionTint="#264a7a"
                  onAction={() => handleToggle(ability.id, "manual-exclude")}
                />
              ))
            )}
          </ListShell>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "#8a7f6f" }}>
        被标记为远程弹道技能的技能在对手拥有「斩无常」护盾时，其伤害将被完全阻挡。
      </p>
    </div>
  );
}

function DecisionAbilityRow({
  ability,
  disabled,
  onDecideCan,
  onDecideNo,
}: {
  ability: AbilityEditorAbility;
  disabled: boolean;
  onDecideCan: () => void;
  onDecideNo: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0ece6" }}>
      <AbilityIcon ability={ability} />
      <AbilitySummary ability={ability} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button type="button" disabled={disabled} onClick={onDecideNo} style={decisionButtonStyle(disabled, "#9a4a2a")}>
          X
        </button>
        <button type="button" disabled={disabled} onClick={onDecideCan} style={decisionButtonStyle(disabled, "#305f3d")}>
          ✓
        </button>
      </div>
    </div>
  );
}

function AbilityRow({
  ability,
  disabled,
  actionLabel,
  actionTint,
  onAction,
}: {
  ability: AbilityEditorAbility;
  disabled: boolean;
  actionLabel?: string;
  actionTint: string;
  onAction?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0ece6" }}>
      <AbilityIcon ability={ability} />
      <AbilitySummary ability={ability} />
      {actionLabel && onAction ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onAction}
          style={{
            flexShrink: 0,
            width: 116,
            minHeight: 28,
            borderRadius: 6,
            border: `1px solid ${actionTint}`,
            background: disabled ? "#ddd" : "transparent",
            color: disabled ? "#777" : actionTint,
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function AbilityIcon({ ability }: { ability: AbilityEditorAbility }) {
  return (
    <img
      src={getAbilityIconByName(ability.name)}
      alt={ability.name}
      style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
      draggable={false}
      loading="lazy"
    />
  );
}

function AbilitySummary({ ability }: { ability: AbilityEditorAbility }) {
  const rarity = ability.tags?.rarity as AbilityRarity | undefined;
  const rarityColor = rarity ? RARITY_COLOR[rarity] : undefined;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2 }}>{ability.name}</div>
        <CopyNameButton value={ability.name} />
        <span style={badgeStyle("#666", "#9992", "#9996")}>{abilityTypeLabel[ability.type]}</span>
        <span style={badgeStyle("#2a6170", "#8ecae622", "#8ecae666")}>{targetTypeLabel[ability.target]}</span>
        {rarity && rarityColor && <span style={badgeStyle(rarityColor, `${rarityColor}22`, `${rarityColor}88`)}>{rarity}</span>}
        {ability.manualIsProjectile && <span style={badgeStyle("#236f31", "#2f9e4422", "#2f9e4466")}>手动加入</span>}
        {ability.manuallyProjectileExcluded && <span style={badgeStyle("#b04444", "#ffd8d822", "#ffb0b066")}>手动排除</span>}
      </div>
      <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>ID: {ability.id}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: "#72675b" }}>{getSimpleDescription(ability.description)}</div>
    </div>
  );
}

function SectionHeader({ title, background, color, border }: { title: string; background: string; color: string; border: string }) {
  return (
    <div style={{ padding: "8px 14px", background, borderRadius: "8px 8px 0 0", fontWeight: 700, fontSize: 13, color, borderBottom: `2px solid ${border}` }}>
      {title}
    </div>
  );
}

function ListShell({ children, border, background }: { children: ReactNode; border: string; background: string }) {
  return (
    <div style={{ border: `1px solid ${border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background, maxHeight: 640, overflowY: "auto" }}>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>{text}</div>;
}

function decisionButtonStyle(disabled: boolean, color: string): CSSProperties {
  return {
    width: 34,
    minHeight: 28,
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: disabled ? "#ddd" : "transparent",
    color: disabled ? "#777" : color,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function badgeStyle(color: string, background: string, border: string): CSSProperties {
  return {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 999,
    background,
    color,
    border: `1px solid ${border}`,
  };
}