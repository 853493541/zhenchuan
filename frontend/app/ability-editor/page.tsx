"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import AdControlTab from "./AdControlTab";
import BuffEditorTab from "./BuffEditorTab";
import AbilityBooleanDeciderTab from "./AbilityBooleanDeciderTab";
import CanCastWhileMountedTab from "./CanCastWhileMountedTab";
import DamageReductionOverrideTab from "./DamageReductionOverrideTab";
import DescriptionReviewTab, { abilityToReviewEntry, buffToReviewEntry } from "./DescriptionReviewTab";
import HiddenBuffTab from "./HiddenBuffTab";
import ManualCancelableBuffTab from "./ManualCancelableBuffTab";
import BuffTimerVisibilityTab from "./BuffTimerVisibilityTab";
import ProjectileEditorTab from "./ProjectileEditorTab";
import DunLiWhitelistTab from "./DunLiWhitelistTab";
import NoWeaponRequiredTab from "./NoWeaponRequiredTab";
import QinYinGongMingTab from "./QinYinGongMingTab";
import SoundReviewTab from "./SoundReviewTab";
import { usePersistentState } from "./usePersistentState";
import {
  ABILITY_RARITIES,
  AbilityBooleanDeciderMode,
  AbilityBooleanDeciderSnapshot,
  AbilityEditorAbility,
  AbilityEditorSnapshot,
  AbilityRarity,
  AbilitySchool,
  AbilityDescriptionReviewEntry,
  AbilityDescriptionReviewSnapshot,
  BuffEditorSnapshot,
  BuffTimerVisibilityMode,
  BuffTimerVisibilitySnapshot,
  BuffDescriptionReviewEntry,
  BuffDescriptionReviewSnapshot,
  CanCastWhileMountedSnapshot,
  DamageReductionOverrideMode,
  DamageReductionOverrideSnapshot,
  HiddenBuffMode,
  HiddenBuffSnapshot,
  ManualCancelableBuffMode,
  ManualCancelableBuffSnapshot,
  NoWeaponRequiredSnapshot,
  QinYinGongMingSnapshot,
  DAMAGE_TYPE_COLOR,
  DAMAGE_TYPES,
  DamageType,
  DescriptionReviewStatus,
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

type MainTab = "abilities" | "buffs" | "adControl" | "projectiles" | "dunLiWhitelist" | "noWeaponRequired" | "canCastWhileMounted" | "abilityDescriptionReview" | "qinggong" | "qinggongGcdImmune" | "hasteUnaffected" | "soundReview" | "qinYinGongMing" | "damageReductionOverride" | "manualCancelableBuffs" | "buffTimerVisibility" | "hiddenBuffs" | "buffDescriptionReview";
type EditorTabGroup = "skill" | "buff";

const SKILL_EDITOR_TABS: Array<{ id: MainTab; label: string }> = [
  { id: "adControl", label: "加成修正" },
  { id: "projectiles", label: "远程弹道" },
  { id: "dunLiWhitelist", label: "盾立白名单" },
  { id: "noWeaponRequired", label: "无需武器" },
  { id: "canCastWhileMounted", label: "可以马上施展" },
  { id: "abilityDescriptionReview", label: "描述修正" },
  { id: "qinggong", label: "轻功" },
  { id: "qinggongGcdImmune", label: "不受轻功GCD 影响" },
  { id: "hasteUnaffected", label: "读条不受加速影响" },
];

const BUFF_EDITOR_TABS: Array<{ id: MainTab; label: string }> = [
  { id: "qinYinGongMing", label: "琴音共鸣" },
  { id: "damageReductionOverride", label: "减伤被顶" },
  { id: "manualCancelableBuffs", label: "主动取消" },
  { id: "buffTimerVisibility", label: "时间显示" },
  { id: "hiddenBuffs", label: "隐藏" },
  { id: "buffDescriptionReview", label: "描述修正" },
];

function getEditorTabGroup(tab: MainTab): EditorTabGroup | null {
  if (SKILL_EDITOR_TABS.some((item) => item.id === tab)) {
    return "skill";
  }

  if (BUFF_EDITOR_TABS.some((item) => item.id === tab)) {
    return "buff";
  }

  return null;
}

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
  const [mainTab, setMainTab] = usePersistentState<MainTab>("abilityEditor.mainTab", "abilities");

  // Read ?tab= from URL on first mount to support deep-linking to the buff tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "buffs") {
      setMainTab("buffs");
    } else if (params.get("tab") === "adControl") {
      setMainTab("adControl");
    } else if (params.get("tab") === "projectiles") {
      setMainTab("projectiles");
    } else if (params.get("tab") === "dunLiWhitelist") {
      setMainTab("dunLiWhitelist");
    } else if (params.get("tab") === "noWeaponRequired") {
      setMainTab("noWeaponRequired");
    } else if (params.get("tab") === "canCastWhileMounted") {
      setMainTab("canCastWhileMounted");
    } else if (params.get("tab") === "abilityDescriptionReview") {
      setMainTab("abilityDescriptionReview");
    } else if (params.get("tab") === "qinggong") {
      setMainTab("qinggong");
    } else if (params.get("tab") === "qinggongGcdImmune") {
      setMainTab("qinggongGcdImmune");
    } else if (params.get("tab") === "hasteUnaffected") {
      setMainTab("hasteUnaffected");
    } else if (params.get("tab") === "soundReview") {
      setMainTab("soundReview");
    } else if (params.get("tab") === "qinYinGongMing") {
      setMainTab("qinYinGongMing");
    } else if (params.get("tab") === "damageReductionOverride") {
      setMainTab("damageReductionOverride");
    } else if (params.get("tab") === "manualCancelableBuffs") {
      setMainTab("manualCancelableBuffs");
    } else if (params.get("tab") === "buffTimerVisibility") {
      setMainTab("buffTimerVisibility");
    } else if (params.get("tab") === "hiddenBuffs") {
      setMainTab("hiddenBuffs");
    } else if (params.get("tab") === "buffDescriptionReview") {
      setMainTab("buffDescriptionReview");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (mainTab === "abilities") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", mainTab);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [mainTab]);

  useEffect(() => {
    if (mainTab !== "soundReview") return;

    window.requestAnimationFrame(() => {
      document.getElementById("sound-review-board")?.scrollIntoView({ block: "start" });
    });
  }, [mainTab]);

  // ── Ability snapshot ──────────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<AbilityEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Filter state lives for the current page session ─────────────────────
  const [search, setSearch] = usePersistentState<string>("abilityEditor.abilities.search", "");
  // tagFilters: groupId → "" (all) | "unset" | actual value
  const [tagFilters, setTagFilters] = usePersistentState<Record<TagGroupId, string>>(
    "abilityEditor.abilities.tagFilters",
    { rarity: "", school: "", damageType: "" }
  );
  // channelFilter: "" (all) | "none" (no channel) | "FORWARD" (正读条) | "REVERSE" (逆读条) | "any" (any channel)
  const [channelFilter, setChannelFilter] = usePersistentState<string>("abilityEditor.abilities.channelFilter", "");

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
  const [noWeaponRequiredSnapshot, setNoWeaponRequiredSnapshot] = useState<NoWeaponRequiredSnapshot | null>(null);
  const [noWeaponRequiredLoading, setNoWeaponRequiredLoading] = useState(false);
  const [noWeaponRequiredError, setNoWeaponRequiredError] = useState("");
  const [canCastWhileMountedSnapshot, setCanCastWhileMountedSnapshot] = useState<CanCastWhileMountedSnapshot | null>(null);
  const [canCastWhileMountedLoading, setCanCastWhileMountedLoading] = useState(false);
  const [canCastWhileMountedError, setCanCastWhileMountedError] = useState("");
  const [abilityDescriptionReviewSnapshot, setAbilityDescriptionReviewSnapshot] = useState<AbilityDescriptionReviewSnapshot | null>(null);
  const [abilityDescriptionReviewLoading, setAbilityDescriptionReviewLoading] = useState(false);
  const [abilityDescriptionReviewError, setAbilityDescriptionReviewError] = useState("");
  const [qinggongSnapshot, setQinggongSnapshot] = useState<AbilityBooleanDeciderSnapshot | null>(null);
  const [qinggongLoading, setQinggongLoading] = useState(false);
  const [qinggongError, setQinggongError] = useState("");
  const [qinggongGcdImmuneSnapshot, setQinggongGcdImmuneSnapshot] = useState<AbilityBooleanDeciderSnapshot | null>(null);
  const [qinggongGcdImmuneLoading, setQinggongGcdImmuneLoading] = useState(false);
  const [qinggongGcdImmuneError, setQinggongGcdImmuneError] = useState("");
  const [hasteUnaffectedSnapshot, setHasteUnaffectedSnapshot] = useState<AbilityBooleanDeciderSnapshot | null>(null);
  const [hasteUnaffectedLoading, setHasteUnaffectedLoading] = useState(false);
  const [hasteUnaffectedError, setHasteUnaffectedError] = useState("");
  const [qinYinGongMingSnapshot, setQinYinGongMingSnapshot] = useState<QinYinGongMingSnapshot | null>(null);
  const [qinYinGongMingLoading, setQinYinGongMingLoading] = useState(false);
  const [qinYinGongMingError, setQinYinGongMingError] = useState("");
  const [damageReductionOverrideSnapshot, setDamageReductionOverrideSnapshot] = useState<DamageReductionOverrideSnapshot | null>(null);
  const [damageReductionOverrideLoading, setDamageReductionOverrideLoading] = useState(false);
  const [damageReductionOverrideError, setDamageReductionOverrideError] = useState("");
  const [manualCancelableBuffSnapshot, setManualCancelableBuffSnapshot] = useState<ManualCancelableBuffSnapshot | null>(null);
  const [manualCancelableBuffLoading, setManualCancelableBuffLoading] = useState(false);
  const [manualCancelableBuffError, setManualCancelableBuffError] = useState("");
  const [buffTimerVisibilitySnapshot, setBuffTimerVisibilitySnapshot] = useState<BuffTimerVisibilitySnapshot | null>(null);
  const [buffTimerVisibilityLoading, setBuffTimerVisibilityLoading] = useState(false);
  const [buffTimerVisibilityError, setBuffTimerVisibilityError] = useState("");
  const [hiddenBuffSnapshot, setHiddenBuffSnapshot] = useState<HiddenBuffSnapshot | null>(null);
  const [hiddenBuffLoading, setHiddenBuffLoading] = useState(false);
  const [hiddenBuffError, setHiddenBuffError] = useState("");
  const [buffDescriptionReviewSnapshot, setBuffDescriptionReviewSnapshot] = useState<BuffDescriptionReviewSnapshot | null>(null);
  const [buffDescriptionReviewLoading, setBuffDescriptionReviewLoading] = useState(false);
  const [buffDescriptionReviewError, setBuffDescriptionReviewError] = useState("");

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

  const loadQinYinGongMingSnapshot = async () => {
    setQinYinGongMingLoading(true);
    setQinYinGongMingError("");

    try {
      const response = await fetch("/api/game/ability-editor/qin-yin-gong-ming", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setQinYinGongMingSnapshot((await response.json()) as QinYinGongMingSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setQinYinGongMingError(message);
    } finally {
      setQinYinGongMingLoading(false);
    }
  };

  const loadDamageReductionOverrideSnapshot = async () => {
    setDamageReductionOverrideLoading(true);
    setDamageReductionOverrideError("");

    try {
      const response = await fetch("/api/game/ability-editor/damage-reduction-override", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setDamageReductionOverrideSnapshot((await response.json()) as DamageReductionOverrideSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setDamageReductionOverrideError(message);
    } finally {
      setDamageReductionOverrideLoading(false);
    }
  };

  const loadManualCancelableBuffSnapshot = async () => {
    setManualCancelableBuffLoading(true);
    setManualCancelableBuffError("");

    try {
      const response = await fetch("/api/game/ability-editor/manual-cancelable-buffs", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setManualCancelableBuffSnapshot((await response.json()) as ManualCancelableBuffSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setManualCancelableBuffError(message);
    } finally {
      setManualCancelableBuffLoading(false);
    }
  };

  const loadBuffTimerVisibilitySnapshot = async () => {
    setBuffTimerVisibilityLoading(true);
    setBuffTimerVisibilityError("");

    try {
      const response = await fetch("/api/game/ability-editor/buff-timer-visibility", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setBuffTimerVisibilitySnapshot((await response.json()) as BuffTimerVisibilitySnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setBuffTimerVisibilityError(message);
    } finally {
      setBuffTimerVisibilityLoading(false);
    }
  };

  const loadHiddenBuffSnapshot = async () => {
    setHiddenBuffLoading(true);
    setHiddenBuffError("");

    try {
      const response = await fetch("/api/game/ability-editor/hidden-buffs", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setHiddenBuffSnapshot((await response.json()) as HiddenBuffSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setHiddenBuffError(message);
    } finally {
      setHiddenBuffLoading(false);
    }
  };

  const loadAbilityDescriptionReviewSnapshot = async () => {
    setAbilityDescriptionReviewLoading(true);
    setAbilityDescriptionReviewError("");

    try {
      const response = await fetch("/api/game/ability-editor/description-review", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setAbilityDescriptionReviewSnapshot((await response.json()) as AbilityDescriptionReviewSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setAbilityDescriptionReviewError(message);
    } finally {
      setAbilityDescriptionReviewLoading(false);
    }
  };

  const loadBuffDescriptionReviewSnapshot = async () => {
    setBuffDescriptionReviewLoading(true);
    setBuffDescriptionReviewError("");

    try {
      const response = await fetch("/api/game/ability-editor/buff-description-review", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setBuffDescriptionReviewSnapshot((await response.json()) as BuffDescriptionReviewSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setBuffDescriptionReviewError(message);
    } finally {
      setBuffDescriptionReviewLoading(false);
    }
  };

  const loadNoWeaponRequiredSnapshot = async () => {
    setNoWeaponRequiredLoading(true);
    setNoWeaponRequiredError("");

    try {
      const response = await fetch("/api/game/ability-editor/no-weapon-required", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setNoWeaponRequiredSnapshot((await response.json()) as NoWeaponRequiredSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setNoWeaponRequiredError(message);
    } finally {
      setNoWeaponRequiredLoading(false);
    }
  };

  const loadCanCastWhileMountedSnapshot = async () => {
    setCanCastWhileMountedLoading(true);
    setCanCastWhileMountedError("");

    try {
      const response = await fetch("/api/game/ability-editor/can-cast-while-mounted", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setCanCastWhileMountedSnapshot((await response.json()) as CanCastWhileMountedSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setCanCastWhileMountedError(message);
    } finally {
      setCanCastWhileMountedLoading(false);
    }
  };

  const loadQinggongSnapshot = async () => {
    setQinggongLoading(true);
    setQinggongError("");

    try {
      const response = await fetch("/api/game/ability-editor/qinggong", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setQinggongSnapshot((await response.json()) as AbilityBooleanDeciderSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setQinggongError(message);
    } finally {
      setQinggongLoading(false);
    }
  };

  const loadQinggongGcdImmuneSnapshot = async () => {
    setQinggongGcdImmuneLoading(true);
    setQinggongGcdImmuneError("");

    try {
      const response = await fetch("/api/game/ability-editor/qinggong-gcd-immune", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setQinggongGcdImmuneSnapshot((await response.json()) as AbilityBooleanDeciderSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setQinggongGcdImmuneError(message);
    } finally {
      setQinggongGcdImmuneLoading(false);
    }
  };

  const loadHasteUnaffectedSnapshot = async () => {
    setHasteUnaffectedLoading(true);
    setHasteUnaffectedError("");

    try {
      const response = await fetch("/api/game/ability-editor/haste-unaffected", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setHasteUnaffectedSnapshot((await response.json()) as AbilityBooleanDeciderSnapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setHasteUnaffectedError(message);
    } finally {
      setHasteUnaffectedLoading(false);
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

  useEffect(() => {
    if (mainTab === "qinYinGongMing") {
      loadQinYinGongMingSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "damageReductionOverride") {
      loadDamageReductionOverrideSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "manualCancelableBuffs") {
      loadManualCancelableBuffSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "buffTimerVisibility") {
      loadBuffTimerVisibilitySnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "hiddenBuffs") {
      loadHiddenBuffSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "buffDescriptionReview" && !buffDescriptionReviewSnapshot && !buffDescriptionReviewLoading) {
      loadBuffDescriptionReviewSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "noWeaponRequired" && !noWeaponRequiredSnapshot && !noWeaponRequiredLoading) {
      loadNoWeaponRequiredSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "canCastWhileMounted" && !canCastWhileMountedSnapshot && !canCastWhileMountedLoading) {
      loadCanCastWhileMountedSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "abilityDescriptionReview" && !abilityDescriptionReviewSnapshot && !abilityDescriptionReviewLoading) {
      loadAbilityDescriptionReviewSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "qinggong" && !qinggongSnapshot && !qinggongLoading) {
      loadQinggongSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "qinggongGcdImmune" && !qinggongGcdImmuneSnapshot && !qinggongGcdImmuneLoading) {
      loadQinggongGcdImmuneSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  useEffect(() => {
    if (mainTab === "hasteUnaffected" && !hasteUnaffectedSnapshot && !hasteUnaffectedLoading) {
      loadHasteUnaffectedSnapshot();
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

  const handleProjectileToggle = async (
    abilityId: string,
    mode: "manual-include" | "manual-exclude" | "clear"
  ) => {
    try {
      const res = await fetch(`/api/game/ability-editor/${abilityId}/is-projectile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
    } catch { /* silent */ }
  };

  const handleDunLiWhitelistToggle = async (
    abilityId: string,
    mode: "manual-include" | "manual-exclude" | "clear"
  ) => {
    try {
      const res = await fetch(`/api/game/ability-editor/${abilityId}/dun-li-whitelist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      setSnapshot((await res.json()) as AbilityEditorSnapshot);
    } catch { /* silent */ }
  };

  const handleNoWeaponRequiredToggle = async (
    abilityId: string,
    mode: "manual-include" | "manual-exclude" | "clear"
  ) => {
    try {
      const res = await fetch(`/api/game/ability-editor/no-weapon-required/${abilityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as NoWeaponRequiredSnapshot;
      setNoWeaponRequiredSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleCanCastWhileMountedToggle = async (
    abilityId: string,
    mode: "manual-include" | "manual-exclude" | "clear"
  ) => {
    try {
      const res = await fetch(`/api/game/ability-editor/can-cast-while-mounted/${abilityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as CanCastWhileMountedSnapshot;
      setCanCastWhileMountedSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleAbilityDescriptionStatus = async (entry: AbilityDescriptionReviewEntry, status: DescriptionReviewStatus) => {
    try {
      const res = await fetch(`/api/game/ability-editor/description-review/${entry.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as AbilityDescriptionReviewSnapshot;
      setAbilityDescriptionReviewSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleAbilityDescriptionSave = async (entry: AbilityDescriptionReviewEntry, description: string) => {
    try {
      const res = await fetch(`/api/game/ability-editor/description-review/${entry.id}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as AbilityDescriptionReviewSnapshot;
      setAbilityDescriptionReviewSnapshot(nextSnapshot);
      setSnapshot((prev) => prev ? {
        ...prev,
        updatedAt: nextSnapshot.updatedAt,
        abilities: prev.abilities.map((ability) => ability.id === entry.id ? { ...ability, description } : ability),
      } : prev);
    } catch { /* silent */ }
  };

  const handleBuffDescriptionStatus = async (entry: BuffDescriptionReviewEntry, status: DescriptionReviewStatus) => {
    try {
      const res = await fetch(`/api/game/ability-editor/buff-description-review/${entry.buffId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      setBuffDescriptionReviewSnapshot((await res.json()) as BuffDescriptionReviewSnapshot);
    } catch { /* silent */ }
  };

  const handleBuffDescriptionSave = async (entry: BuffDescriptionReviewEntry, description: string) => {
    try {
      const res = await fetch(`/api/game/ability-editor/buff-description-review/${entry.buffId}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as BuffDescriptionReviewSnapshot;
      setBuffDescriptionReviewSnapshot(nextSnapshot);
      setBuffSnapshot((prev) => prev ? {
        ...prev,
        updatedAt: nextSnapshot.updatedAt,
        buffs: prev.buffs.map((buff) => buff.buffId === entry.buffId ? { ...buff, description } : buff),
      } : prev);
    } catch { /* silent */ }
  };

  const handleQinggongToggle = async (abilityId: string, mode: AbilityBooleanDeciderMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/qinggong/${abilityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as AbilityBooleanDeciderSnapshot;
      setQinggongSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
      setQinggongGcdImmuneSnapshot(null);
    } catch { /* silent */ }
  };

  const handleQinggongGcdImmuneToggle = async (abilityId: string, mode: AbilityBooleanDeciderMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/qinggong-gcd-immune/${abilityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as AbilityBooleanDeciderSnapshot;
      setQinggongGcdImmuneSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
      setQinggongSnapshot(null);
    } catch { /* silent */ }
  };

  const handleHasteUnaffectedToggle = async (abilityId: string, mode: AbilityBooleanDeciderMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/haste-unaffected/${abilityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as AbilityBooleanDeciderSnapshot;
      setHasteUnaffectedSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleQinYinGongMingToggle = async (buffId: number, mode: "manual-include" | "manual-exclude" | "clear") => {
    try {
      const res = await fetch(`/api/game/ability-editor/qin-yin-gong-ming/${buffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      setQinYinGongMingSnapshot((await res.json()) as QinYinGongMingSnapshot);
    } catch { /* silent */ }
  };

  const handleDamageReductionOverrideToggle = async (buffId: number, mode: DamageReductionOverrideMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/damage-reduction-override/${buffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as DamageReductionOverrideSnapshot;
      setDamageReductionOverrideSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleManualCancelableBuffToggle = async (buffId: number, mode: ManualCancelableBuffMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/manual-cancelable-buffs/${buffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as ManualCancelableBuffSnapshot;
      setManualCancelableBuffSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleBuffTimerVisibilityToggle = async (buffId: number, mode: BuffTimerVisibilityMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/buff-timer-visibility/${buffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as BuffTimerVisibilitySnapshot;
      setBuffTimerVisibilitySnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
    } catch { /* silent */ }
  };

  const handleHiddenBuffToggle = async (buffId: number, mode: HiddenBuffMode) => {
    try {
      const res = await fetch(`/api/game/ability-editor/hidden-buffs/${buffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return;
      const nextSnapshot = (await res.json()) as HiddenBuffSnapshot;
      setHiddenBuffSnapshot(nextSnapshot);
      setSnapshot((prev) => (prev ? { ...prev, updatedAt: nextSnapshot.updatedAt } : prev));
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

    if (channelFilter) {
      const chMode = ability.channelInfo?.mode;
      if (channelFilter === "none" && chMode) return false;
      if (channelFilter === "any" && !chMode) return false;
      if (channelFilter === "FORWARD" && chMode !== "FORWARD") return false;
      if (channelFilter === "REVERSE" && chMode !== "REVERSE") return false;
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

  const activeEditorGroup = getEditorTabGroup(mainTab);
  const activeEditorTabs = activeEditorGroup === "skill"
    ? SKILL_EDITOR_TABS
    : activeEditorGroup === "buff"
      ? BUFF_EDITOR_TABS
      : [];

  return (
    <div className={styles.page}>
      <section className={`${styles.shell} ${mainTab === "soundReview" ? styles.soundReviewShell : ""}`}>
        <div className={styles.topRow}>
          <Link href="/" className={styles.backLink}>
            返回大厅
          </Link>
          <div className={styles.updatedAt}>最后保存：{formatUpdatedAt(snapshot?.updatedAt ?? null)}</div>
        </div>

        {mainTab !== "soundReview" && (
          <div className={styles.headerBlock}>
            <p className={styles.eyebrow}>Ability Editor</p>
            <h1 className={styles.title}>能力属性与AD倍率编辑</h1>
            <p className={styles.subtitle}>
              总览层只负责浏览。点击技能卡片进入详情页后，再编辑属性、读条、冷却、范围和AD倍率。
            </p>
            <div className={styles.summaryRow}>
              <span className={styles.summaryPill}>技能 {snapshot?.abilities.length ?? 0}</span>
            </div>
          </div>
        )}

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
            className={`${styles.mainTab} ${activeEditorGroup === "skill" ? styles.mainTabActive : ""}`}
            onClick={() => setMainTab(activeEditorGroup === "skill" ? mainTab : "projectiles")}
          >
            技能
          </button>
          <button
            type="button"
            className={`${styles.mainTab} ${mainTab === "soundReview" ? styles.mainTabActive : ""}`}
            onClick={() => setMainTab("soundReview")}
          >
            音效审核
          </button>
          <button
            type="button"
            className={`${styles.mainTab} ${activeEditorGroup === "buff" ? styles.mainTabActive : ""}`}
            onClick={() => setMainTab(activeEditorGroup === "buff" ? mainTab : "qinYinGongMing")}
          >
            气劲
          </button>
        </div>

        {activeEditorGroup && (
          <div className={styles.editorSubTabBar}>
            {activeEditorTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.editorSubTab} ${mainTab === tab.id ? styles.editorSubTabActive : ""}`}
                onClick={() => setMainTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
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
            {/* 读条 row */}
            <div className={styles.tagFilterRow}>
              <span className={styles.rarityFilterLabel}>读条</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {([
                  { value: "", label: "全部" },
                  { value: "none", label: "无读条" },
                  { value: "any", label: "任意读条" },
                  { value: "FORWARD", label: "正读条" },
                  { value: "REVERSE", label: "逆读条" },
                ] as const).map((opt) => {
                  const isActive = channelFilter === opt.value;
                  const isDefault = opt.value === "";
                  return (
                    <button key={opt.value || "all"} type="button" className={styles.rarityFilterBtn}
                      style={{
                        borderRadius: 3,
                        borderColor: "#6aaee6",
                        color: isActive ? "#fff" : (isDefault ? "#888" : "#6aaee6"),
                        background: isActive ? "#6aaee6" : (isDefault && !channelFilter ? "#544c40" : "transparent"),
                        padding: "2px 6px",
                        fontSize: 12,
                      }}
                      onClick={() => setChannelFilter(opt.value)}
                    >{opt.label}</button>
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
      {mainTab === "adControl" && (
        <section className={styles.adControlSection}>
          <AdControlTab
            snapshot={snapshot}
            loading={loading}
            onSnapshotUpdate={setSnapshot}
          />
        </section>
      )}

      {mainTab === "projectiles" && (
        <section className={styles.buffEditorSection}>
          <ProjectileEditorTab
            snapshot={snapshot}
            loading={loading}
            onProjectileToggle={handleProjectileToggle}
          />
        </section>
      )}
      {/* ── 盾立白名单 tab ──────────────────────────── */}
      {mainTab === "dunLiWhitelist" && (
        <section className={styles.buffEditorSection}>
          <DunLiWhitelistTab
            snapshot={snapshot}
            loading={loading}
            onToggle={handleDunLiWhitelistToggle}
          />
        </section>
      )}

      {mainTab === "noWeaponRequired" && (
        <section className={styles.buffEditorSection}>
          <NoWeaponRequiredTab
            snapshot={noWeaponRequiredSnapshot}
            loading={noWeaponRequiredLoading}
            errorMessage={noWeaponRequiredError}
            onRetry={loadNoWeaponRequiredSnapshot}
            onToggle={handleNoWeaponRequiredToggle}
          />
        </section>
      )}

      {mainTab === "canCastWhileMounted" && (
        <section className={styles.buffEditorSection}>
          <CanCastWhileMountedTab
            snapshot={canCastWhileMountedSnapshot}
            loading={canCastWhileMountedLoading}
            errorMessage={canCastWhileMountedError}
            onRetry={loadCanCastWhileMountedSnapshot}
            onToggle={handleCanCastWhileMountedToggle}
          />
        </section>
      )}

      {mainTab === "abilityDescriptionReview" && (
        <section className={styles.buffEditorSection}>
          <DescriptionReviewTab
            kind="ability"
            entries={abilityDescriptionReviewSnapshot?.abilities ?? []}
            loading={abilityDescriptionReviewLoading}
            errorMessage={abilityDescriptionReviewError}
            onRetry={loadAbilityDescriptionReviewSnapshot}
            onStatusChange={handleAbilityDescriptionStatus}
            onDescriptionChange={handleAbilityDescriptionSave}
            toReviewEntry={abilityToReviewEntry}
            searchStorageKey="abilityEditor.descriptionReview.search"
            loadingText="正在加载技能描述修正列表…"
          />
        </section>
      )}

      {mainTab === "qinggong" && (
        <section className={styles.buffEditorSection}>
          <AbilityBooleanDeciderTab
            searchStorageKey="abilityEditor.qinggong.search"
            loadingText="正在加载轻功列表…"
            snapshot={qinggongSnapshot}
            loading={qinggongLoading}
            errorMessage={qinggongError}
            onRetry={loadQinggongSnapshot}
            onToggle={handleQinggongToggle}
            enabledColumnTitle="轻功"
            enabledEmptyText="当前没有轻功技能"
            excludedColumnTitle="非轻功"
            undecidedColumnTitle="未决定"
            decideYesLabel="标记为轻功"
            decideNoLabel="标记为非轻功"
            enabledActionLabel="改为非轻功"
            excludedActionLabel="恢复"
            footerText="这里决定哪些技能视为轻功。轻功技能会被封轻功限制，并且在带有 GCD 时可触发轻功公共调息。"
            showImmuneBadge
            showMetadataRow={false}
          />
        </section>
      )}

      {mainTab === "qinggongGcdImmune" && (
        <section className={styles.buffEditorSection}>
          <AbilityBooleanDeciderTab
            searchStorageKey="abilityEditor.qinggongGcdImmune.search"
            loadingText="正在加载不受轻功GCD影响列表…"
            snapshot={qinggongGcdImmuneSnapshot}
            loading={qinggongGcdImmuneLoading}
            errorMessage={qinggongGcdImmuneError}
            onRetry={loadQinggongGcdImmuneSnapshot}
            onToggle={handleQinggongGcdImmuneToggle}
            enabledColumnTitle="不受轻功GCD 影响"
            enabledEmptyText="当前没有不受轻功GCD影响的技能"
            excludedColumnTitle="受到轻功GCD 影响"
            undecidedColumnTitle="未决定"
            decideYesLabel="设为不受轻功GCD影响"
            decideNoLabel="设为受到轻功GCD影响"
            enabledActionLabel="改为受到轻功GCD影响"
            excludedActionLabel="恢复"
            footerText="这里决定哪些技能仍视为轻功，但不会触发或受到 3 秒轻功公共调息。扶摇直上默认属于这一类。"
            showQinggongBadge
            limitUndecidedToQinggong
          />
        </section>
      )}

      {mainTab === "hasteUnaffected" && (
        <section className={styles.buffEditorSection}>
          <AbilityBooleanDeciderTab
            searchStorageKey="abilityEditor.hasteUnaffected.search"
            loadingText="正在加载读条不受加速影响列表…"
            snapshot={hasteUnaffectedSnapshot}
            loading={hasteUnaffectedLoading}
            errorMessage={hasteUnaffectedError}
            onRetry={loadHasteUnaffectedSnapshot}
            onToggle={handleHasteUnaffectedToggle}
            enabledColumnTitle="读条不受加速影响"
            enabledEmptyText="当前没有读条不受加速影响的技能"
            excludedColumnTitle="读条受到加速影响"
            undecidedColumnTitle="未决定"
            decideYesLabel="设为读条不受加速影响"
            decideNoLabel="设为读条受到加速影响"
            enabledActionLabel="改为读条受到加速影响"
            excludedActionLabel="恢复"
            footerText="这里决定哪些读条技能不吃加速率。未排除的技能会按当前规则缩短正读条、逆读条以及持续伤害的总时间和跳间隔；未决定列表只显示带读条的技能。"
            showMetadataRow={false}
            limitUndecidedToChannel
          />
        </section>
      )}

      {mainTab === "soundReview" && (
        <section id="sound-review-board" className={styles.buffEditorSection}>
          <SoundReviewTab
            snapshot={snapshot}
            loading={loading}
            errorMessage={errorMessage}
            onRetry={loadSnapshot}
          />
        </section>
      )}

      {mainTab === "qinYinGongMing" && (
        <section className={styles.buffEditorSection}>
          <QinYinGongMingTab
            snapshot={qinYinGongMingSnapshot}
            loading={qinYinGongMingLoading}
            errorMessage={qinYinGongMingError}
            onRetry={loadQinYinGongMingSnapshot}
            onToggle={handleQinYinGongMingToggle}
          />
        </section>
      )}

      {mainTab === "damageReductionOverride" && (
        <section className={styles.buffEditorSection}>
          <DamageReductionOverrideTab
            snapshot={damageReductionOverrideSnapshot}
            loading={damageReductionOverrideLoading}
            errorMessage={damageReductionOverrideError}
            onRetry={loadDamageReductionOverrideSnapshot}
            onToggle={handleDamageReductionOverrideToggle}
          />
        </section>
      )}

      {mainTab === "manualCancelableBuffs" && (
        <section className={styles.buffEditorSection}>
          <ManualCancelableBuffTab
            snapshot={manualCancelableBuffSnapshot}
            loading={manualCancelableBuffLoading}
            errorMessage={manualCancelableBuffError}
            onRetry={loadManualCancelableBuffSnapshot}
            onToggle={handleManualCancelableBuffToggle}
          />
        </section>
      )}

      {mainTab === "buffTimerVisibility" && (
        <section className={styles.buffEditorSection}>
          <BuffTimerVisibilityTab
            snapshot={buffTimerVisibilitySnapshot}
            loading={buffTimerVisibilityLoading}
            errorMessage={buffTimerVisibilityError}
            onRetry={loadBuffTimerVisibilitySnapshot}
            onToggle={handleBuffTimerVisibilityToggle}
          />
        </section>
      )}

      {mainTab === "hiddenBuffs" && (
        <section className={styles.buffEditorSection}>
          <HiddenBuffTab
            snapshot={hiddenBuffSnapshot}
            loading={hiddenBuffLoading}
            errorMessage={hiddenBuffError}
            onRetry={loadHiddenBuffSnapshot}
            onToggle={handleHiddenBuffToggle}
          />
        </section>
      )}

      {mainTab === "buffDescriptionReview" && (
        <section className={styles.buffEditorSection}>
          <DescriptionReviewTab
            kind="buff"
            entries={buffDescriptionReviewSnapshot?.buffs ?? []}
            loading={buffDescriptionReviewLoading}
            errorMessage={buffDescriptionReviewError}
            onRetry={loadBuffDescriptionReviewSnapshot}
            onStatusChange={handleBuffDescriptionStatus}
            onDescriptionChange={handleBuffDescriptionSave}
            toReviewEntry={buffToReviewEntry}
            searchStorageKey="abilityEditor.buffDescriptionReview.search"
            loadingText="正在加载气劲描述修正列表…"
          />
        </section>
      )}
    </div>
  );
}
