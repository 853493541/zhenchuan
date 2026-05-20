"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, RotateCcw, Search, Volume2, X } from "lucide-react";

import {
  AbilityEditorAbility,
  AbilityEditorSnapshot,
  getAbilityIconByName,
} from "./editorShared";
import { usePersistentState } from "./usePersistentState";
import {
  listAbilitySoundFiles,
  type AbilitySoundFile,
} from "../game/screens/in-game/components/BattleArena/abilitySoundRegistry";
import styles from "./page.module.css";

type DurationState = Record<string, { seconds?: number; failed?: boolean }>;
type ReviewStatus = "good" | "needsWork";
type ReviewState = Record<string, ReviewStatus>;
type ReviewColumn = "needsWork" | "undecided" | "good";
type SoundCountFilter = "all" | "0" | "1" | "many";
type AbilityNoteState = Record<string, string>;

type SoundGroup = {
  key: string;
  abilityName: string;
  ability: AbilityEditorAbility | null;
  sounds: AbilitySoundFile[];
  allSounds: AbilitySoundFile[];
};

interface SoundReviewTabProps {
  snapshot: AbilityEditorSnapshot | null;
  loading: boolean;
  errorMessage: string;
  onRetry: () => void;
}

const REVIEW_STORAGE_KEY = "soundBrowser.soundAbilityReviews.v2";
const LEGACY_REVIEW_STORAGE_KEY = "soundBrowser.soundReviews.v1";
const LEGACY_ABILITY_CHECK_STORAGE_KEY = "soundBrowser.soundAbilityChecks.v1";
const NOTE_STORAGE_KEY = "soundBrowser.soundReviewNotes.v1";

const SOUND_COUNT_FILTERS: Array<{ value: SoundCountFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "many", label: ">1" },
];

function normalizeAbilityName(name: string | undefined) {
  return String(name ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

function isFenglaiWushanName(name: string | undefined) {
  const normalized = normalizeAbilityName(name);
  return normalized === "风来吴山" || normalized === "风来无山";
}

function isAbilityName(name: string | undefined, values: string[]) {
  return values.includes(normalizeAbilityName(name));
}

function readStoredReviewMap(storageKey: string): ReviewState {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, value === "bad" ? "needsWork" : value])
        .filter((entry): entry is [string, ReviewStatus] => entry[1] === "good" || entry[1] === "needsWork")
    );
  } catch {
    return {};
  }
}

function readStoredLegacyAbilityChecks(): Record<string, true> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(LEGACY_ABILITY_CHECK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, true] => entry[1] === true)
    );
  } catch {
    return {};
  }
}

function readStoredReviews(): ReviewState {
  const stored = readStoredReviewMap(REVIEW_STORAGE_KEY);
  if (Object.keys(stored).length > 0) return stored;

  return Object.fromEntries(
    Object.keys(readStoredLegacyAbilityChecks()).map((key) => [key, "good" as ReviewStatus])
  );
}

function readStoredLegacySoundReviews(): ReviewState {
  return readStoredReviewMap(LEGACY_REVIEW_STORAGE_KEY);
}

function readStoredNotes(): AbilityNoteState {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(NOTE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function formatDuration(seconds: number | undefined, failed?: boolean) {
  if (failed) return "无法读取";
  if (seconds === undefined) return "读取中";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  if (minutes > 0) return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
  return `${rest.toFixed(2)} 秒`;
}

function getPhaseLabel(file: AbilitySoundFile) {
  if (isAbilityName(file.abilityName, ["七星拱瑞", "引窍"])) return "完成";
  if (isAbilityName(file.abilityName, ["雾暗迷云", "暗雾迷云", "鸿蒙天禁", "跃潮斩波"])) return "命中";
  if (isAbilityName(file.abilityName, ["笑醉狂"])) return "读条";
  if (file.totalInAbility <= 1) return isFenglaiWushanName(file.abilityName) ? "读条" : "释放";
  if (isAbilityName(file.abilityName, ["盾立"]) && file.ordinal === 2) return "反击";
  if (isAbilityName(file.abilityName, ["御骑", "千蝶吐瑞", "无间狱"]) && file.ordinal === 2) return "读条";
  if (isAbilityName(file.abilityName, ["真·下车"])) return "释放";
  if (file.ordinal === 1) return "释放";
  if (file.ordinal === file.totalInAbility) return "完成";
  return "读条";
}

function countSounds(groups: SoundGroup[]) {
  return groups.reduce((total, group) => total + group.sounds.length, 0);
}

function formatColumnTitle(label: string, groups: SoundGroup[]) {
  const abilityCount = groups.length;
  const soundCount = countSounds(groups);
  const emptyAbilityCount = groups.filter((group) => group.allSounds.length === 0).length;
  if (emptyAbilityCount > 0) return `${label} (${abilityCount} 技能 · ${soundCount} 音效 · ${emptyAbilityCount} 无音效)`;
  return `${label} (${abilityCount} 技能 · ${soundCount} 音效)`;
}

export default function SoundReviewTab({ snapshot, loading, errorMessage, onRetry }: SoundReviewTabProps) {
  const files = useMemo(() => listAbilitySoundFiles(), []);
  const [query, setQuery] = usePersistentState("abilityEditor.soundReview.query", "");
  const [soundCountFilter, setSoundCountFilter] = usePersistentState<SoundCountFilter>("abilityEditor.soundReview.soundCountFilter", "all");
  const [durations, setDurations] = useState<DurationState>({});
  const [reviews, setReviews] = useState<ReviewState>(() => readStoredReviews());
  const [notes, setNotes] = useState<AbilityNoteState>(() => readStoredNotes());
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const migratedLegacyReviewsRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews));
    } catch { /* ignore storage failures */ }
  }, [reviews]);

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(notes));
    } catch { /* ignore storage failures */ }
  }, [notes]);

  const abilitiesByName = useMemo(() => {
    const map = new Map<string, AbilityEditorAbility>();
    for (const ability of snapshot?.abilities ?? []) {
      map.set(normalizeAbilityName(ability.name), ability);
    }
    return map;
  }, [snapshot]);

  const soundGroups = useMemo<SoundGroup[]>(() => {
    const groups = new Map<string, SoundGroup>();

    for (const ability of snapshot?.abilities ?? []) {
      const abilityName = normalizeAbilityName(ability.name);
      if (abilityName) {
        groups.set(ability.id, { key: ability.id, abilityName, ability, sounds: [], allSounds: [] });
      }
    }

    for (const file of files) {
      const abilityName = normalizeAbilityName(file.abilityName);
      const ability = abilitiesByName.get(abilityName) ?? null;
      const key = ability?.id ?? abilityName;
      const existing = groups.get(key);

      if (existing) {
        existing.sounds.push(file);
        existing.allSounds.push(file);
      } else {
        groups.set(key, { key, abilityName, ability, sounds: [file], allSounds: [file] });
      }
    }

    return Array.from(groups.values());
  }, [abilitiesByName, files, snapshot]);

  useEffect(() => {
    if (migratedLegacyReviewsRef.current || soundGroups.length === 0) return;
    migratedLegacyReviewsRef.current = true;

    const legacyReviews = readStoredLegacySoundReviews();
    if (Object.keys(legacyReviews).length === 0) return;

    setReviews((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const group of soundGroups) {
        if (next[group.key]) continue;

        if (group.allSounds.some((file) => legacyReviews[file.key] === "needsWork")) {
          next[group.key] = "needsWork";
          changed = true;
        } else if (group.allSounds.length > 0 && group.allSounds.every((file) => legacyReviews[file.key] === "good")) {
          next[group.key] = "good";
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [soundGroups]);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return soundGroups.filter((group) => {
      const soundCount = group.sounds.length;

      if (soundCountFilter === "0" && soundCount !== 0) return false;
      if (soundCountFilter === "1" && soundCount !== 1) return false;
      if (soundCountFilter === "many" && soundCount <= 1) return false;

      if (!normalizedQuery) return true;

      return group.abilityName.toLowerCase().includes(normalizedQuery);
    });
  }, [query, soundCountFilter, soundGroups]);

  const columnGroups = useMemo(() => {
    const next: Record<ReviewColumn, SoundGroup[]> = {
      needsWork: [],
      undecided: [],
      good: [],
    };

    for (const group of filteredGroups) {
      const status = reviews[group.key];
      if (status === "needsWork") next.needsWork.push(group);
      else if (status === "good") next.good.push(group);
      else next.undecided.push(group);
    }

    return next;
  }, [filteredGroups, reviews]);

  const reviewCounts = useMemo(() => {
    let good = 0;
    let needsWork = 0;
    for (const group of soundGroups) {
      if (reviews[group.key] === "good") good += 1;
      if (reviews[group.key] === "needsWork") needsWork += 1;
    }
    return { good, needsWork, undecided: soundGroups.length - good - needsWork };
  }, [reviews, soundGroups]);

  const filteredSoundCount = countSounds(filteredGroups);

  useEffect(() => {
    let cancelled = false;
    const activeAudios: HTMLAudioElement[] = [];
    let cursor = 0;

    const loadNext = () => {
      if (cancelled) return;
      const file = files[cursor];
      cursor += 1;
      if (!file) return;

      const audio = new Audio();
      activeAudios.push(audio);
      audio.preload = "metadata";
      audio.src = file.url;
      audio.onloadedmetadata = () => {
        if (!cancelled) {
          setDurations((prev) => ({ ...prev, [file.key]: { seconds: audio.duration } }));
        }
        loadNext();
      };
      audio.onerror = () => {
        if (!cancelled) {
          setDurations((prev) => ({ ...prev, [file.key]: { failed: true } }));
        }
        loadNext();
      };
      audio.load();
    };

    for (let index = 0; index < 6; index += 1) {
      loadNext();
    }

    return () => {
      cancelled = true;
      for (const audio of activeAudios) {
        audio.src = "";
      }
    };
  }, [files]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const playFile = (file: AbilitySoundFile) => {
    if (playingKey === file.key) {
      audioRef.current?.pause();
      setPlayingKey(null);
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(file.url);
    audio.volume = 0.8;
    audio.onended = () => setPlayingKey(null);
    audio.onerror = () => setPlayingKey(null);
    audioRef.current = audio;
    setPlayingKey(file.key);
    void audio.play().catch(() => setPlayingKey(null));
  };

  const updateAbilityReview = (abilityKey: string, status: ReviewStatus | null) => {
    setReviews((prev) => {
      const next = { ...prev };
      if (status) next[abilityKey] = status;
      else delete next[abilityKey];
      return next;
    });
  };

  const updateNote = (abilityKey: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (note) next[abilityKey] = note;
      else delete next[abilityKey];
      return next;
    });
  };

  if (loading) {
    return <div className={styles.statePanel}>正在加载音效审核数据…</div>;
  }

  if (errorMessage) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.stateTitle}>加载失败</p>
        <p className={styles.stateCopy}>{errorMessage}</p>
        <button className={styles.retryButton} onClick={onRetry}>重新加载</button>
      </div>
    );
  }

  const filters = (
    <div className={styles.rarityFilterBar} style={{ marginBottom: 14, gap: 10 }}>
        <div className={styles.tagFilterRow} style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Search size={18} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={styles.searchInput}
            placeholder="搜索技能名"
            style={{ maxWidth: 420 }}
          />
          <span style={{ alignSelf: "center", color: "#7a7368", fontSize: 12, fontWeight: 800 }}>
            {filteredGroups.length} 个技能 · <Volume2 size={13} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {filteredSoundCount} 个匹配音效 · {reviewCounts.good} 个技能可用 · {reviewCounts.needsWork} 个技能需处理 · {reviewCounts.undecided} 个技能未决定
          </span>
        </div>

        <div className={styles.tagFilterRow} style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span className={styles.rarityFilterLabel}>音效数量</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {SOUND_COUNT_FILTERS.map((option) => {
              const isActive = soundCountFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isActive}
                  className={styles.rarityFilterBtn}
                  style={isActive ? { background: "#544c40", color: "#fff", borderColor: "#544c40" } : {}}
                  onClick={() => setSoundCountFilter(option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
  );

  const board = filteredGroups.length === 0 ? (
    <div className={styles.statePanel}>
      <p className={styles.stateTitle}>没有匹配结果</p>
      <p className={styles.stateCopy}>换一个关键词或筛选条件试试。</p>
    </div>
  ) : (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
        gap: 16,
        alignItems: "start",
      }}
    >
      <SoundColumn
        title={formatColumnTitle("需要继续处理", columnGroups.needsWork)}
        emptyText="当前没有需要继续处理的音效"
        background="#fdf1f1"
        color="#8a4040"
        border="#e5b1b1"
        listBackground="#fff8f8"
        groups={columnGroups.needsWork}
        column="needsWork"
        durations={durations}
        reviews={reviews}
        notes={notes}
        playingKey={playingKey}
        onPlay={playFile}
        onAbilityReview={updateAbilityReview}
        onNoteChange={updateNote}
      />

      <SoundColumn
        title={formatColumnTitle("未决定", columnGroups.undecided)}
        emptyText="当前没有未决定的音效"
        background="#f4f1eb"
        color="#7a6e62"
        border="#e4ddd4"
        listBackground="#ffffff"
        groups={columnGroups.undecided}
        column="undecided"
        durations={durations}
        reviews={reviews}
        notes={notes}
        playingKey={playingKey}
        onPlay={playFile}
        onAbilityReview={updateAbilityReview}
        onNoteChange={updateNote}
      />

      <SoundColumn
        title={formatColumnTitle("音效可用", columnGroups.good)}
        emptyText="当前没有已通过的音效"
        background="#eef8f1"
        color="#236f31"
        border="#a8d6b3"
        listBackground="#f8fff9"
        groups={columnGroups.good}
        column="good"
        durations={durations}
        reviews={reviews}
        notes={notes}
        playingKey={playingKey}
        onPlay={playFile}
        onAbilityReview={updateAbilityReview}
        onNoteChange={updateNote}
      />
    </div>
  );

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", paddingTop: 4 }}>
      {filters}
      {board}
    </div>
  );
}

function SoundColumn({
  title,
  emptyText,
  background,
  color,
  border,
  listBackground,
  groups,
  column,
  durations,
  reviews,
  notes,
  playingKey,
  onPlay,
  onAbilityReview,
  onNoteChange,
}: {
  title: string;
  emptyText: string;
  background: string;
  color: string;
  border: string;
  listBackground: string;
  groups: SoundGroup[];
  column: ReviewColumn;
  durations: DurationState;
  reviews: ReviewState;
  notes: AbilityNoteState;
  playingKey: string | null;
  onPlay: (file: AbilitySoundFile) => void;
  onAbilityReview: (abilityKey: string, status: ReviewStatus | null) => void;
  onNoteChange: (abilityKey: string, note: string) => void;
}) {
  return (
    <div>
      <SectionHeader title={title} background={background} color={color} border={border} />
      <ListShell border={border} background={listBackground}>
        {groups.length === 0 ? (
          <EmptyState text={emptyText} />
        ) : (
          groups.map((group) => (
            <SoundGroupBlock
              key={group.key}
              group={group}
              column={column}
              durations={durations}
              reviews={reviews}
              notes={notes}
              playingKey={playingKey}
              onPlay={onPlay}
              onAbilityReview={onAbilityReview}
              onNoteChange={onNoteChange}
            />
          ))
        )}
      </ListShell>
    </div>
  );
}

function SoundGroupBlock({
  group,
  column,
  durations,
  reviews,
  notes,
  playingKey,
  onPlay,
  onAbilityReview,
  onNoteChange,
}: {
  group: SoundGroup;
  column: ReviewColumn;
  durations: DurationState;
  reviews: ReviewState;
  notes: AbilityNoteState;
  playingKey: string | null;
  onPlay: (file: AbilitySoundFile) => void;
  onAbilityReview: (abilityKey: string, status: ReviewStatus | null) => void;
  onNoteChange: (abilityKey: string, note: string) => void;
}) {
  const ability = group.ability;
  const title = `${group.abilityName}（${group.allSounds.length}）`;
  const status = reviews[group.key];
  const checked = status === "good";
  const indeterminate = status === "needsWork";

  return (
    <div style={{ borderBottom: "1px solid #f0ece6" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 6px" }}>
        <AbilityCheckbox
          checked={checked}
          indeterminate={indeterminate}
          title="技能音效可用"
          onChange={(nextChecked) => onAbilityReview(group.key, nextChecked ? "good" : null)}
        />
        <img
          src={getAbilityIconByName(ability?.name ?? group.abilityName) ?? undefined}
          alt={group.abilityName}
          style={{ width: 34, height: 34, borderRadius: 6, objectFit: "contain", flexShrink: 0, background: "#f5efe5" }}
          draggable={false}
          loading="lazy"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", minHeight: 34 }}>
            <div title={title} style={{ fontWeight: 800, fontSize: 13, color: "#211d18", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </div>
          </div>
        </div>
        <AbilityDecisionButtons
          column={column}
          onReview={(nextStatus) => onAbilityReview(group.key, nextStatus)}
        />
      </div>

      {group.sounds.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 12px 10px" }}>
          {group.sounds.map((file) => (
            <SoundDecisionRow
              key={file.key}
              file={file}
              duration={durations[file.key]}
              isPlaying={playingKey === file.key}
              onPlay={() => onPlay(file)}
            />
          ))}
        </div>
      ) : null}

      {column === "needsWork" ? (
        <div style={{ padding: group.sounds.length > 0 ? "0 12px 10px" : "0 12px 10px 12px" }}>
          <textarea
            value={notes[group.key] ?? ""}
            onChange={(event) => onNoteChange(group.key, event.target.value)}
            aria-label={`${group.abilityName} 备注`}
            placeholder="备注"
            rows={2}
            style={{
              width: "100%",
              resize: "vertical",
              minHeight: 54,
              padding: "8px 9px",
              borderRadius: 7,
              border: "1px solid #e5b1b1",
              background: "#fffdf9",
              color: "#3d3226",
              fontSize: 12,
              lineHeight: 1.4,
              outline: "none",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function AbilityCheckbox({ checked, indeterminate, title, onChange }: { checked: boolean; indeterminate: boolean; title: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked ? "true" : indeterminate ? "mixed" : "false"}
      title={title}
      aria-label={title}
      onClick={() => onChange(!checked)}
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        border: `2px solid ${checked ? "#236f31" : indeterminate ? "#9a7a2a" : "#b8afa3"}`,
        background: checked ? "#236f31" : "#ffffff",
        color: "#ffffff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        margin: 0,
        padding: 0,
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      {checked ? <Check size={14} aria-hidden="true" /> : indeterminate ? <span style={{ width: 10, height: 2, background: "#9a7a2a", borderRadius: 2 }} /> : null}
    </button>
  );
}

function AbilityDecisionButtons({ column, onReview }: { column: ReviewColumn; onReview: (status: ReviewStatus | null) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, flexShrink: 0 }}>
      {column === "undecided" ? (
        <>
          <IconButton color="#9a4a2a" active={false} onClick={() => onReview("needsWork")} title="需要继续处理">
            <X size={16} aria-hidden="true" />
          </IconButton>
          <IconButton color="#236f31" active={false} onClick={() => onReview("good")} title="音效可用">
            <Check size={16} aria-hidden="true" />
          </IconButton>
        </>
      ) : (
        <>
          {column === "needsWork" ? (
            <IconButton color="#236f31" active={false} onClick={() => onReview("good")} title="改为可用">
              <Check size={16} aria-hidden="true" />
            </IconButton>
          ) : (
            <IconButton color="#9a4a2a" active={false} onClick={() => onReview("needsWork")} title="改为需要处理">
              <X size={16} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton color="#5d5145" active={false} onClick={() => onReview(null)} title="恢复未决定">
            <RotateCcw size={15} aria-hidden="true" />
          </IconButton>
        </>
      )}
    </div>
  );
}

function SoundDecisionRow({
  file,
  duration,
  isPlaying,
  onPlay,
}: {
  file: AbilitySoundFile;
  duration: { seconds?: number; failed?: boolean } | undefined;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        minHeight: 42,
        padding: "6px 7px",
        border: "1px solid #eee7dc",
        borderRadius: 7,
        background: "#fffdf9",
      }}
    >
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", minHeight: 22, padding: "0 8px", borderRadius: 999, background: "#eef5ff", color: "#264a7a", fontSize: 12, fontWeight: 900 }}>
          {getPhaseLabel(file)}
        </span>
        <span style={{ color: "#6f665a", fontSize: 12, fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
          {formatDuration(duration?.seconds, duration?.failed)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
        <IconButton color="#1f5d4b" active={isPlaying} onClick={onPlay} title={isPlaying ? "暂停" : "播放"}>
          {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </IconButton>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  background,
  color,
  border,
}: {
  title: string;
  background: string;
  color: string;
  border: string;
}) {
  return (
    <div
      style={{
        padding: "8px 14px",
        background,
        borderRadius: "8px 8px 0 0",
        fontWeight: 700,
        fontSize: 13,
        color,
        borderBottom: `2px solid ${border}`,
      }}
    >
      {title}
    </div>
  );
}

function ListShell({ children, border, background }: { children: React.ReactNode; border: string; background: string }) {
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderTop: "none",
        borderRadius: "0 0 8px 8px",
        background,
        maxHeight: 680,
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: "24px 16px", color: "#aaa", fontSize: 13, textAlign: "center" }}>
      {text}
    </div>
  );
}

function IconButton({ color, active, title, children, onClick }: { color: string; active: boolean; title: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${active ? color : "#ddd7cb"}`,
        background: active ? color : "#ffffff",
        color: active ? "#ffffff" : color,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
