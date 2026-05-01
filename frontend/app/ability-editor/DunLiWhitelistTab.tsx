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
  onToggle: (abilityId: string, dunLiWhitelisted: boolean) => Promise<void>;
}

export default function DunLiWhitelistTab({ snapshot, loading, onToggle }: Props) {
  const [rarityFilter, setRarityFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [toggling, setToggling] = useState<string | null>(null);

  const all = snapshot?.abilities ?? [];

  const filteredUndecided = useMemo(() => {
    let list = all.filter((a) => !a.dunLiWhitelisted);
    if (rarityFilter === "unset") list = list.filter((a) => !a.tags?.rarity);
    else if (rarityFilter) list = list.filter((a) => a.tags?.rarity === rarityFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        [a.id, a.name, a.description].join(" ").toLowerCase().includes(q),
      );
    }
    return list;
  }, [all, rarityFilter, search]);

  const decided = all.filter((a) => a.dunLiWhitelisted);

  async function handleToggle(ability: AbilityEditorAbility, value: boolean) {
    setToggling(ability.id);
    try {
      await onToggle(ability.id, value);
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
        <div className={styles.tagFilterRow}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
            placeholder="搜索技能名或 ID"
            style={{ maxWidth: 320 }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
          alignItems: "start",
        }}
      >
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
            未加入白名单 ({filteredUndecided.length})
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
            {filteredUndecided.length === 0 ? (
              <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>
                没有匹配的技能
              </div>
            ) : (
              filteredUndecided.map((ability) => (
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

        <div>
          <div
            style={{
              padding: "8px 14px",
              background: "#eef5ff",
              borderRadius: "10px 10px 0 0",
              fontWeight: 700,
              fontSize: 13,
              color: "#264a7a",
              borderBottom: "2px solid #9ec1f0",
            }}
          >
            盾立白名单 ({decided.length})
          </div>
          <div
            style={{
              border: "1px solid #9ec1f0",
              borderTop: "none",
              borderRadius: "0 0 10px 10px",
              background: "#f8fbff",
              maxHeight: 640,
              overflowY: "auto",
            }}
          >
            {decided.length === 0 ? (
              <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>
                白名单为空
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
        加入白名单的技能：依然会被「盾立」的免疫伤害效果阻挡，但<strong>不会被反弹</strong>给施放者；技能携带的 buff/debuff 会正常落在「盾立」持有者身上。
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
      <img
        src={getAbilityIconByName(ability.name)}
        alt={ability.name}
        style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
        loading="lazy"
      />

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
          background: action === "add" ? "#264a7a" : "#e4ddd4",
          color: action === "add" ? "#ffffff" : "#5a4e3e",
          transition: "opacity 0.1s",
        }}
      >
        {action === "add" ? "→ 加入白名单" : "← 移除"}
      </button>
    </div>
  );
}
