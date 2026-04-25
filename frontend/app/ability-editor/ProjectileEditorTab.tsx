"use client";

import { useMemo, useState } from "react";

import {
  AbilityEditorAbility,
  AbilityEditorSnapshot,
  ABILITY_RARITIES,
  AbilityRarity,
  RARITY_COLOR,
  getAbilityIconByName,
} from "./editorShared";
import styles from "./page.module.css";

interface Props {
  snapshot: AbilityEditorSnapshot | null;
  loading: boolean;
  onProjectileToggle: (abilityId: string, isProjectile: boolean) => Promise<void>;
}

export default function ProjectileEditorTab({ snapshot, loading, onProjectileToggle }: Props) {
  const [rarityFilter, setRarityFilter] = useState<string>("");
  const [toggling, setToggling] = useState<string | null>(null);

  const all = snapshot?.abilities ?? [];

  const filtered = useMemo(() => {
    if (!rarityFilter) return all;
    if (rarityFilter === "unset") return all.filter((a) => !a.tags?.rarity);
    return all.filter((a) => a.tags?.rarity === rarityFilter);
  }, [all, rarityFilter]);

  const undecided = filtered.filter((a) => !a.isProjectile);
  const decided = all.filter((a) => a.isProjectile); // right box always shows all decided, regardless of filter

  async function handleToggle(ability: AbilityEditorAbility, value: boolean) {
    setToggling(ability.id);
    try {
      await onProjectileToggle(ability.id, value);
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return <div className={styles.statePanel}>正在加载技能属性…</div>;
  }

  return (
    <div style={{ maxWidth: 1260, margin: "0 auto", paddingTop: 16 }}>
      {/* Rarity filter bar */}
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
              onClick={() => setRarityFilter((f) => (f === "unset" ? "" : "unset"))}
            >
              未设置
            </button>
            {ABILITY_RARITIES.map((r) => {
              const color = RARITY_COLOR[r as AbilityRarity];
              const isActive = rarityFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  className={styles.rarityFilterBtn}
                  style={{
                    borderColor: color,
                    color: isActive ? "#fff" : color,
                    background: isActive ? color : "transparent",
                  }}
                  onClick={() => setRarityFilter((f) => (f === r ? "" : r))}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
          alignItems: "start",
        }}
      >
        {/* Left: undecided */}
        <div>
          <div
            style={{
              padding: "8px 14px",
              background: "#f4f1eb",
              borderRadius: "10px 10px 0 0",
              fontWeight: 700,
              fontSize: 13,
              color: "#7a6e62",
              borderBottom: "2px solid #e4ddd4",
            }}
          >
            未标记 ({undecided.length})
          </div>
          <div
            style={{
              border: "1px solid #e4ddd4",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              background: "#ffffff",
              maxHeight: 640,
              overflowY: "auto",
            }}
          >
            {undecided.length === 0 ? (
              <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>
                {rarityFilter ? "该稀有度下无未标记技能" : "所有技能均已标记"}
              </div>
            ) : (
              undecided.map((ability) => (
                <AbilityRow
                  key={ability.id}
                  ability={ability}
                  action="add"
                  disabled={toggling === ability.id}
                  onAction={() => handleToggle(ability, true)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: decided */}
        <div>
          <div
            style={{
              padding: "8px 14px",
              background: "#fff5eb",
              borderRadius: "10px 10px 0 0",
              fontWeight: 700,
              fontSize: 13,
              color: "#6f3f16",
              borderBottom: "2px solid #f4c89a",
            }}
          >
            远程弹道技能 ({decided.length})
          </div>
          <div
            style={{
              border: "1px solid #f4c89a",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              background: "#fffcf8",
              maxHeight: 640,
              overflowY: "auto",
            }}
          >
            {decided.length === 0 ? (
              <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>
                尚未添加任何远程弹道技能
              </div>
            ) : (
              decided.map((ability) => (
                <AbilityRow
                  key={ability.id}
                  ability={ability}
                  action="remove"
                  disabled={toggling === ability.id}
                  onAction={() => handleToggle(ability, false)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "#8a7f6f" }}>
        被标记为远程弹道技能的技能在对手拥有「斩无常」护盾时，其伤害将被完全阻挡。
      </p>
    </div>
  );
}

function AbilityRow({
  ability,
  action,
  disabled,
  onAction,
}: {
  ability: AbilityEditorAbility;
  action: "add" | "remove";
  disabled: boolean;
  onAction: () => void;
}) {
  const rarity = ability.tags?.rarity as AbilityRarity | undefined;
  const rarityColor = rarity ? RARITY_COLOR[rarity] : undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid #f0ece6",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "#faf8f5")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "")}
    >
      {/* Icon */}
      <img
        src={getAbilityIconByName(ability.name)}
        alt={ability.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

      {/* Name + rarity */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#211d18", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ability.name}
        </div>
        {rarity && (
          <span
            style={{
              display: "inline-block",
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 999,
              background: `${rarityColor}22`,
              color: rarityColor,
              border: `1px solid ${rarityColor}88`,
              marginTop: 2,
            }}
          >
            {rarity}
          </span>
        )}
      </div>

      {/* Action button */}
      <button
        type="button"
        disabled={disabled}
        onClick={onAction}
        style={{
          flexShrink: 0,
          padding: "4px 10px",
          borderRadius: 6,
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          fontWeight: 700,
          fontSize: 12,
          opacity: disabled ? 0.5 : 1,
          background: action === "add" ? "#6f3f16" : "#e4ddd4",
          color: action === "add" ? "#ffffff" : "#5a4e3e",
          transition: "opacity 0.1s",
        }}
      >
        {action === "add" ? "→ 标记" : "← 移除"}
      </button>
    </div>
  );
}
