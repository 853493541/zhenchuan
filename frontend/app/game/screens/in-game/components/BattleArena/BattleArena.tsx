'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';
import VirtualJoystick from './VirtualJoystick';
import StatusBar from '../GameBoard/components/StatusBar';
import { ChannelBar, ChannelBarHost, type ChannelBarData } from './ChannelBar';
import { ArrowLeft, Clipboard, Gamepad2, Gauge, Keyboard, LayoutGrid, MessageCircle, Puzzle, RotateCcw, Swords, Trash2, Volume2, Wind, X } from 'lucide-react';
import { toastError, toastSuccess } from '@/app/components/toast/toast';
import type { ActiveBuff, ActiveChannel, PickupItem, GroundZone, TargetEntity, TargetSelection } from '../../types';
import ArenaScene, { type DirLightConfig, type EnvDebugInfo, type EnvToggles, type SceneRuntimeMetrics } from './scene/ArenaScene';
import { getMapForMode, type MapObject } from './worldMap';
import type { MapCollisionSystem } from './scene/MapCollisionSystem';
import { RENDER_SF, GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z, type SceneLoadTimingEvent } from './scene/ExportedMapScene';
import { encodeIconPublicPath, getAbilityIconPath } from '@/app/lib/iconPaths';
import * as THREE from 'three';
import { ensureResizeObserverSupport } from '../../ensureResizeObserverSupport';
import { getAbilitySoundAudibleRange, getAbilitySoundCue, type AbilitySoundPhase } from './abilitySoundRegistry';
import { installAbilityAudioUnlock, playAbilitySound, stopAbilityChannelSound } from './abilitySoundPlayer';

type V3 = { x: number; y: number; z: number };
type LoadStageStatus = '完成' | '进行中' | '失败';

type LoadPerformanceStage = {
  id: string;
  name: string;
  status: LoadStageStatus;
  startedAtMs: number;
  completedAtMs: number | null;
  durationMs: number;
  detail: string;
  meta?: Record<string, number | string>;
};

type LoadPerformanceStageState = {
  id: string;
  name: string;
  status: LoadStageStatus;
  startedAtMs: number;
  completedAtMs: number | null;
  detail: string;
  meta?: Record<string, number | string>;
  order: number;
};

type LoadResourceGroup = {
  label: string;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  transferSizeBytes: number;
  encodedBodySizeBytes: number;
  slowestName: string;
};

type LoadResourceEntrySummary = {
  name: string;
  label: string;
  durationMs: number;
  transferSizeBytes: number;
  encodedBodySizeBytes: number;
};

type LoadPerformanceSnapshot = {
  ts: number;
  startedAtIso: string;
  totalMs: number;
  completed: boolean;
  stages: LoadPerformanceStage[];
  inProgressStages: LoadPerformanceStage[];
  resourceGroups: LoadResourceGroup[];
  slowestResources: LoadResourceEntrySummary[];
  sceneMetrics: SceneRuntimeMetrics | null;
  reportText: string;
  gameCounts: {
    opponents: number;
    visibleOpponents: number;
    entities: number;
    visibleEntities: number;
    groundZones: number;
    pickups: number;
    events: number;
    selfBuffs: number;
    abilities: number;
  };
};

const formatLoadPerfNumber = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString('zh-CN');
};

const formatLoadPerfMs = (ms: number | null | undefined) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.max(0, Math.round(ms))}ms`;
};

const formatLoadPerfBytes = (bytes: number | null | undefined) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
};

const getSceneResourceLabel = (url: string) => {
  const path = (() => {
    try { return new URL(url).pathname; } catch { return url; }
  })();
  if (!path.includes('/full-exports/')) return null;
  if (path.endsWith('.glb')) return 'GLB模型';
  if (path.includes('/textures/')) return '模型贴图';
  if (path.includes('/terrain-textures/') && !path.endsWith('/index.json')) return '地形贴图';
  if (path.includes('/heightmap/')) return '地形高度';
  if (path.endsWith('.collision.json') || path.endsWith('/mesh-collision-index.json')) return '碰撞数据';
  if (path.endsWith('.json')) return '地图清单';
  return '其他地图资源';
};

const getSceneResourceName = (url: string) => {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const parts = path.split('/').filter(Boolean);
    return parts.slice(-2).join('/');
  } catch {
    return url;
  }
};

function collectSceneResourceTimings(startedAtMs: number) {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const groups = new Map<string, LoadResourceGroup>();
  const resources: LoadResourceEntrySummary[] = [];

  for (const entry of entries) {
    if (entry.startTime + 5 < startedAtMs) continue;
    const label = getSceneResourceLabel(entry.name);
    if (!label) continue;
    const durationMs = Math.max(0, entry.duration || 0);
    const transferSizeBytes = Number(entry.transferSize ?? 0) || 0;
    const encodedBodySizeBytes = Number(entry.encodedBodySize ?? 0) || 0;
    const name = getSceneResourceName(entry.name);
    resources.push({ name, label, durationMs, transferSizeBytes, encodedBodySizeBytes });

    const group = groups.get(label) ?? {
      label,
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      transferSizeBytes: 0,
      encodedBodySizeBytes: 0,
      slowestName: '',
    };
    group.count += 1;
    group.totalDurationMs += durationMs;
    group.transferSizeBytes += transferSizeBytes;
    group.encodedBodySizeBytes += encodedBodySizeBytes;
    if (durationMs >= group.maxDurationMs) {
      group.maxDurationMs = durationMs;
      group.slowestName = name;
    }
    groups.set(label, group);
  }

  return {
    resourceGroups: Array.from(groups.values()).sort((a, b) => b.maxDurationMs - a.maxDurationMs),
    slowestResources: resources.sort((a, b) => b.durationMs - a.durationMs).slice(0, 8),
  };
}

function buildSceneLoadReport(snapshot: Omit<LoadPerformanceSnapshot, 'reportText'>) {
  const lines: string[] = [];
  lines.push('加载性能报告');
  lines.push(`生成时间: ${new Date(snapshot.ts).toISOString()}`);
  lines.push(`开始时间: ${snapshot.startedAtIso}`);
  lines.push(`总场景加载: ${formatLoadPerfMs(snapshot.totalMs)} (${snapshot.completed ? '完成' : '进行中'})`);
  lines.push('');
  lines.push('阶段耗时:');
  for (const stage of snapshot.stages) {
    const start = formatLoadPerfMs(stage.startedAtMs);
    const end = stage.completedAtMs === null ? '-' : formatLoadPerfMs(stage.completedAtMs);
    const meta = stage.meta
      ? Object.entries(stage.meta).map(([key, value]) => `${key}=${value}`).join(', ')
      : '';
    lines.push(`- ${stage.name}: ${stage.status}, ${formatLoadPerfMs(stage.durationMs)} (${start} -> ${end})${stage.detail ? `, ${stage.detail}` : ''}${meta ? `, ${meta}` : ''}`);
  }
  lines.push('');
  lines.push('资源分组:');
  if (snapshot.resourceGroups.length === 0) {
    lines.push('- 无 full-exports 资源计时');
  } else {
    for (const group of snapshot.resourceGroups) {
      lines.push(`- ${group.label}: ${group.count} 个, 合计 ${formatLoadPerfMs(group.totalDurationMs)}, 最慢 ${formatLoadPerfMs(group.maxDurationMs)} ${group.slowestName || '-'}, 传输 ${formatLoadPerfBytes(group.transferSizeBytes)}, 编码大小 ${formatLoadPerfBytes(group.encodedBodySizeBytes)}`);
    }
  }
  lines.push('');
  lines.push('最慢资源:');
  if (snapshot.slowestResources.length === 0) {
    lines.push('- 无');
  } else {
    for (const resource of snapshot.slowestResources) {
      lines.push(`- ${resource.label} ${resource.name}: ${formatLoadPerfMs(resource.durationMs)}, 传输 ${formatLoadPerfBytes(resource.transferSizeBytes)}, 编码大小 ${formatLoadPerfBytes(resource.encodedBodySizeBytes)}`);
    }
  }
  lines.push('');
  lines.push('Three.js:');
  if (snapshot.sceneMetrics) {
    lines.push(`- objects=${snapshot.sceneMetrics.objects}, meshes=${snapshot.sceneMetrics.meshes}, lights=${snapshot.sceneMetrics.lights}, geometries=${snapshot.sceneMetrics.geometries}, textures=${snapshot.sceneMetrics.textures}, drawCalls=${snapshot.sceneMetrics.calls}, triangles=${snapshot.sceneMetrics.triangles}`);
  } else {
    lines.push('- 未采集到 Three.js 指标');
  }
  lines.push('');
  lines.push(`游戏对象: 敌人 ${snapshot.gameCounts.visibleOpponents}/${snapshot.gameCounts.opponents}, 实体 ${snapshot.gameCounts.visibleEntities}/${snapshot.gameCounts.entities}, 地面区 ${snapshot.gameCounts.groundZones}, 拾取 ${snapshot.gameCounts.pickups}, 事件 ${snapshot.gameCounts.events}, Buff ${snapshot.gameCounts.selfBuffs}, 招式 ${snapshot.gameCounts.abilities}`);
  return lines.join('\n');
}
type HeartStatKey =
  | 'attack'
  | 'maxHp'
  | 'crit'
  | 'critEffect'
  | 'haste'
  | 'dodge'
  | 'runSpeed'
  | 'defense'
  | 'huajin'
  | 'damageReduction';

type HeartStatRow = {
  key: HeartStatKey;
  label: string;
  value: string;
  tooltipTitle?: string;
  tooltipLines?: string[];
};

type HeartStatHintState = {
  title: string;
  lines: string[];
  anchorRect: DOMRect;
};

type GcdVisibilitySettings = {
  enabled: boolean;
  base: boolean;
  qinggong: boolean;
  houyao: boolean;
};

type AbilitySoundSettings = {
  volumePercent: number;
  disabled: boolean;
  version: number;
};

type InGameWarningEvent = {
  id: number;
  text: string;
};

type UiPosition = { left: number; top: number };
type UiViewportSize = { w: number; h: number };
type UiPositionStoragePayload = {
  positions: Record<string, UiPosition>;
  viewport: UiViewportSize | null;
};

const EMPTY_UI_POSITION_STORAGE_PAYLOAD: UiPositionStoragePayload = {
  positions: {},
  viewport: null,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidUiViewportSize(value: unknown): value is UiViewportSize {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<UiViewportSize>;
  return isFiniteNumber(candidate.w) && candidate.w > 0 && isFiniteNumber(candidate.h) && candidate.h > 0;
}

function sanitizeUiPositions(raw: unknown): Record<string, UiPosition> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const next: Record<string, UiPosition> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const candidate = value as Partial<UiPosition>;
    if (!isFiniteNumber(candidate.left) || !isFiniteNumber(candidate.top)) {
      continue;
    }
    next[key] = {
      left: Math.round(candidate.left),
      top: Math.round(candidate.top),
    };
  }
  return next;
}

function normalizeUiPositionStoragePayload(raw: unknown): UiPositionStoragePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return EMPTY_UI_POSITION_STORAGE_PAYLOAD;
  }

  const payload = raw as { positions?: unknown; viewport?: unknown };
  return {
    positions: sanitizeUiPositions(payload.positions ?? raw),
    viewport: isValidUiViewportSize(payload.viewport)
      ? { w: Math.round(payload.viewport.w), h: Math.round(payload.viewport.h) }
      : null,
  };
}

function areUiViewportSizesEqual(a: UiViewportSize, b: UiViewportSize): boolean {
  return Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
}

function clampUiPosition(position: UiPosition, viewport: UiViewportSize): UiPosition {
  const maxLeft = Math.max(12, Math.round(viewport.w - 12));
  const maxTop = Math.max(12, Math.round(viewport.h - 12));
  return {
    left: Math.max(12, Math.min(maxLeft, Math.round(position.left))),
    top: Math.max(12, Math.min(maxTop, Math.round(position.top))),
  };
}

function scaleUiPositions(
  positions: Record<string, UiPosition>,
  fromViewport: UiViewportSize,
  toViewport: UiViewportSize,
): Record<string, UiPosition> {
  if (fromViewport.w <= 0 || fromViewport.h <= 0 || toViewport.w <= 0 || toViewport.h <= 0) {
    return positions;
  }

  const scaleX = toViewport.w / fromViewport.w;
  const scaleY = toViewport.h / fromViewport.h;
  const next: Record<string, UiPosition> = {};
  for (const [key, position] of Object.entries(positions)) {
    next[key] = clampUiPosition({
      left: position.left * scaleX,
      top: position.top * scaleY,
    }, toViewport);
  }
  return next;
}

const HEART_STAT_STORAGE_KEY = 'zhenchuan-heart-stat-visibility';
const GCD_VISIBILITY_STORAGE_KEY = 'zhenchuan-gcd-visibility';
const ABILITY_SOUND_SETTINGS_STORAGE_KEY = 'zhenchuan-ability-sound-settings-v1';
const ABILITY_PANEL_SCALE_STORAGE_KEY = 'zhenchuan-ability-panel-scale-v2';
const ABILITY_PANEL_BASE_VISUAL_SCALE = 1.175;
const ABILITY_PANEL_MAX_VISUAL_SCALE = 2;
const IN_GAME_WARNING_SCALE_STORAGE_KEY = 'zhenchuan-ingame-warning-scale-v1';
const IN_GAME_WARNING_UI_KEY = 'in-game-warning';
const IN_GAME_WARNING_DURATION_MS = 1500;
const IN_GAME_WARNING_PREVIEW_TEXT = '无法施展该招式';
const REQUIRED_POWER_MISSING_WARNING = '经脉受损 无法运功';
const DASH_GROUND_TARGET_ABILITY_IDS = new Set(['lin_shi_fei_zhua', 'han_di', 'gu_feng_sa_ta']);
const LEGACY_PLAYER_STATUS_UI_KEY = 'player-status-bar';
const PLAYER_BUFF_STATUS_UI_KEY = 'player-buff-status-bar';
const PLAYER_DEBUFF_STATUS_UI_KEY = 'player-debuff-status-bar';
const TARGET_BUFF_STATUS_UI_KEY = 'target-buff-status-bar';
const TARGET_DEBUFF_STATUS_UI_KEY = 'target-debuff-status-bar';
const PLAYER_ICON_BAR_UI_KEY = 'player-icon-bar';
const PLAYER_CHANNEL_BAR_UI_KEY = 'player-channel-bar';
const PLAYER_GCD_BAR_UI_KEY = 'player-gcd-bar';
const TARGET_ICON_BAR_UI_KEY = 'target-icon-bar';
const TARGET_TARGET_ICON_BAR_UI_KEY = 'target-target-icon-bar';
const TARGET_OWNED_ABILITY_BAR_UI_KEY = 'target-owned-ability-bar';
const OWNED_ABILITY_BAR_UI_KEY = 'owned-ability-bar';
const HEIGHT_COUNTER_UI_KEY = 'height-counter';
const DISTANCE_INDICATOR_UI_KEY = 'distance-indicator';
const HEART_STATS_UI_KEY = 'heart-stats-bar';
const ITEM_BAR_UI_KEY = 'item-bar';
const CATCAKE_DEFAULT_UI_VIEWPORT: UiViewportSize = { w: 1920, h: 945 };
const CATCAKE_DEFAULT_UI_POSITIONS: Record<string, UiPosition> = {
  [PLAYER_ICON_BAR_UI_KEY]: { left: 457, top: 463 },
  [PLAYER_CHANNEL_BAR_UI_KEY]: { left: 815, top: 689 },
  [PLAYER_GCD_BAR_UI_KEY]: { left: 841, top: 722 },
  [PLAYER_BUFF_STATUS_UI_KEY]: { left: 643, top: 571 },
  [PLAYER_DEBUFF_STATUS_UI_KEY]: { left: 642, top: 628 },
  [TARGET_ICON_BAR_UI_KEY]: { left: 488, top: 22 },
  [TARGET_OWNED_ABILITY_BAR_UI_KEY]: { left: 448, top: 235 },
  [TARGET_BUFF_STATUS_UI_KEY]: { left: 440, top: 115 },
  [TARGET_DEBUFF_STATUS_UI_KEY]: { left: 440, top: 168 },
  [TARGET_TARGET_ICON_BAR_UI_KEY]: { left: 832, top: 42 },
  [HEIGHT_COUNTER_UI_KEY]: { left: 540, top: 816 },
  [DISTANCE_INDICATOR_UI_KEY]: { left: 1147, top: 383 },
  [IN_GAME_WARNING_UI_KEY]: { left: 960, top: 151 },
  [ITEM_BAR_UI_KEY]: { left: 647, top: 751 },
  [HEART_STATS_UI_KEY]: { left: 194, top: 466 },
};
const DRAFT_ABILITY_SLOT_COUNT = 6;
const ITEM_BAR_SLOT_COUNT = 14;
const CONSUMABLE_BAR_STORAGE_KEY = 'zhenchuan-consumable-bar-settings-v1';
const CONSUMABLE_BAR_MIN_SLOTS = 12;
const CONSUMABLE_BAR_MAX_SLOTS = 16;
const CONSUMABLE_BAR_DEFAULT_SLOTS = 12;
const CONSUMABLE_ITEMS = [
  { id: 'beng_dai', name: '绷带', implemented: true, startingCount: 12 },
  { id: 'jin_chuang_yao', name: '金疮药', implemented: true, startingCount: 8 },
  { id: 'yue_ying_sha', name: '月影沙', implemented: true, startingCount: 4 },
  { id: 'sha_shi_wei_zhuang', name: '砂石伪装', implemented: true, startingCount: 4 },
  { id: 'guan_mu_wei_zhuang', name: '灌木伪装', implemented: false, startingCount: 0 },
  { id: 'wa_guan_wei_zhuang', name: '瓦罐伪装', implemented: false, startingCount: 0 },
  { id: 'sha_xing_xie', name: '沙行蝎', implemented: false, startingCount: 0 },
  { id: 'ma_cao', name: '马草', implemented: false, startingCount: 0 },
  { id: 'yi_jie_wu_qi_he', name: '一阶武器盒', implemented: false, startingCount: 0 },
  { id: 'er_jie_wu_qi_he', name: '二阶武器盒', implemented: false, startingCount: 0 },
  { id: 'san_jie_wu_qi_he', name: '三阶武器盒', implemented: false, startingCount: 0 },
  { id: 'tian_jie_wu_qi_he', name: '天阶武器盒', implemented: false, startingCount: 0 },
] as const;
const STATUS_BAR_VERTICAL_OFFSET = 58;
const PLAYER_CHANNEL_BAR_FLOAT_WIDTH = 290;
const PLAYER_GCD_BAR_FLOAT_WIDTH = 224;
const PLAYER_GCD_BAR_DEFAULT_TOP_OFFSET = 26;
const PLAYER_CHANNEL_BAR_DEFAULT_TOP_OFFSET = 54;
const HEART_STAT_ORDER: HeartStatKey[] = [
  'attack',
  'maxHp',
  'crit',
  'critEffect',
  'haste',
  'dodge',
  'runSpeed',
  'defense',
  'huajin',
  'damageReduction',
];
const DEFAULT_HEART_STAT_VISIBILITY: Record<HeartStatKey, boolean> = {
  attack: true,
  maxHp: true,
  crit: true,
  critEffect: true,
  haste: true,
  dodge: true,
  runSpeed: true,
  defense: true,
  huajin: true,
  damageReduction: true,
};
const DEFAULT_GCD_VISIBILITY_SETTINGS: GcdVisibilitySettings = {
  enabled: true,
  base: true,
  qinggong: false,
  houyao: false,
};

function isDashGroundTargetAbilityId(abilityId: string | null | undefined): boolean {
  return !!abilityId && DASH_GROUND_TARGET_ABILITY_IDS.has(abilityId);
}
const DEFAULT_ABILITY_SOUND_SETTINGS: AbilitySoundSettings = {
  volumePercent: 80,
  disabled: false,
  version: 4,
};
const ABILITY_SOUND_VOLUME_OUTPUT_SCALE = 0.625;
const PLAYER_CHANNEL_BAR_PREVIEW_DATA: ChannelBarData = {
  kind: 'forward',
  name: '引导读条',
  startedAt: 0,
  durationMs: 1200,
  cancelOnMove: true,
  cancelOnJump: true,
};
type CombatPresetStatKey = 'attackDamage' | 'maxHp' | 'critChancePct' | 'defensePct' | 'huajinPct';

const COMBAT_PRESET_RARITIES = [
  { id: 'white', label: '白装', color: '#f3f4f6', stats: { critChancePct: 0, defensePct: 0, huajinPct: 40, maxHp: 300000, attackDamage: 10000 } },
  { id: 'green', label: '绿装', color: '#42b663', stats: { critChancePct: 30, defensePct: 12, huajinPct: 55, maxHp: 900000, attackDamage: 30000 } },
  { id: 'blue', label: '蓝装', color: '#3a8dff', stats: { critChancePct: 36, defensePct: 16, huajinPct: 60, maxHp: 1050000, attackDamage: 40000 } },
  { id: 'purple', label: '紫装', color: '#9f5fd9', stats: { critChancePct: 46, defensePct: 23, huajinPct: 73, maxHp: 1200000, attackDamage: 50000 } },
] as const;

const COMBAT_PRESET_STAT_ROWS: Array<{ key: CombatPresetStatKey; label: string }> = [
  { key: 'attackDamage', label: '攻击' },
  { key: 'maxHp', label: '气血' },
  { key: 'critChancePct', label: '会心' },
  { key: 'defensePct', label: '防御' },
  { key: 'huajinPct', label: '化劲' },
];

type CollisionDebugState = {
  enabled: boolean;
  center: V3;
  supportY: number | null;
};

/* ============================================================
   ARENA SETTINGS  (must match backend)
   ============================================================ */
const PUBG_WIDTH  = 2000;
const PUBG_HEIGHT = 2000;
const ARENA_WIDTH_SMALL  = 200;
const ARENA_HEIGHT_SMALL = 200;
const DASH_ANIM_MS = 1500; // ms — cosmetic dash travel animation
const CAMERA_FOV = 72;
const DEFAULT_CAMERA_ZOOM = 0.7;
const CAMERA_ZOOM_MAX = 0.7;
const CAMERA_ZOOM_OVER_MAX = 2.5;
const DEFAULT_PLAYER_RADIUS = 2; // must match backend
const COLLISION_TEST_PLAYER_RADIUS = 0.384;
const LEGACY_STORED_UNIT_SCALE = 2.2;
const SERVER_TICK_RATE = 30;
const BASE_HASTE_RATE_PCT = 23.54;
const BASE_GCD_SECONDS = 1.19;
const BASE_GCD_MS = BASE_GCD_SECONDS * 1000;
const BASE_GCD_WINDOW_TICKS = Math.round(BASE_GCD_SECONDS * SERVER_TICK_RATE);
const BASE_MOVE_SPEED_PER_TICK = 0.1666667;
const AIR_SHIFT_DURATION_TICKS = SERVER_TICK_RATE;
const LEGACY_CHANNEL_JUMP_LOCK_BUFF_IDS = new Set([1014, 1017, 2001, 2003, 2712]);

type ScreenBounds = { cx: number; topY: number; baseY: number; rs: number };

type RuntimeAbilityChannel = {
  source: 'ACTIVE' | 'BUFF';
  mode: 'FORWARD' | 'REVERSE';
  durationMs: number;
  cancelOnMove: boolean;
  cancelOnJump: boolean;
  interruptible?: boolean;
  tickIntervalMs?: number;
  buffId?: number;
};

type VisualGcdState = {
  id: string;
  name: string;
  kind: 'base' | 'qinggong' | 'houyao';
  startedAt: number;
  durationMs: number;
};

type ChannelingPlayer = {
  activeChannel?: ActiveChannel;
  buffs?: ActiveBuff[];
};

function getStoredUnitScale(mode?: string): number {
  return mode === 'collision-test' ? 1 : LEGACY_STORED_UNIT_SCALE;
}

function getDefaultMoveSpeedPerTick(mode?: string): number {
  return BASE_MOVE_SPEED_PER_TICK * getStoredUnitScale(mode);
}

function getUpwardJumpAirShiftDistance(mode?: string): number {
  return 2 * getStoredUnitScale(mode);
}

function getDirectionalJumpDistance(mode?: string): number {
  return 6 * getStoredUnitScale(mode);
}

function getBackpedalDoubleJumpDistance(mode?: string): number {
  return 3.7 * getStoredUnitScale(mode);
}

function normalizeAbilityPanelScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(0.5, Math.min(2, numeric)) * 100) / 100;
}

function normalizeInGameWarningScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(0.1, Math.min(2, numeric)) * 100) / 100;
}

function normalizeAbilitySoundVolumePercent(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ABILITY_SOUND_SETTINGS.volumePercent;
  return Math.round(Math.max(0, Math.min(100, numeric)));
}

function getAbilityPanelCssScale(value: number): number {
  const normalized = normalizeAbilityPanelScale(value);
  const visualScale = normalized <= 1
    ? ABILITY_PANEL_BASE_VISUAL_SCALE * normalized
    : ABILITY_PANEL_BASE_VISUAL_SCALE + (normalized - 1) * (ABILITY_PANEL_MAX_VISUAL_SCALE - ABILITY_PANEL_BASE_VISUAL_SCALE);
  return Math.round(visualScale * 1000) / 1000;
}

function hasLegacyChannelJumpLock(buffs?: ActiveBuff[]): boolean {
  return Array.isArray(buffs) && buffs.some((buff) => LEGACY_CHANNEL_JUMP_LOCK_BUFF_IDS.has(buff.buffId));
}

function hasLingRanTianFengStateClient(buffs?: ActiveBuff[]): boolean {
  return Array.isArray(buffs) && buffs.some((buff: any) =>
    (buff.effects ?? []).some((effect: any) => effect?.type === 'LING_RAN_TIAN_FENG_STATE')
  );
}

function isLingRanSpecialJumpActiveClient(player?: any): boolean {
  const dash = player?.activeDash;
  return dash?.abilityId === 'ling_ran_tian_feng' && dash.ticksRemaining > 0 && dash.lingRanCastLift !== true;
}

function hasLingRanSpecialJumpRefillBuffClient(buffs?: ActiveBuff[]): boolean {
  return Array.isArray(buffs) && buffs.some((buff) => buff.buffId === 1014 || buff.buffId === 2712);
}

function getRuntimeAbilityChannel(ability: any): RuntimeAbilityChannel | null {
  const channel = ability?.channel;
  if (!channel || typeof channel !== 'object') {
    return null;
  }

  const source = channel.source === 'BUFF' ? 'BUFF' : channel.source === 'ACTIVE' ? 'ACTIVE' : null;
  const mode = channel.mode === 'REVERSE' ? 'REVERSE' : channel.mode === 'FORWARD' ? 'FORWARD' : null;
  if (!source || !mode) {
    return null;
  }

  const durationMs = Number(channel.durationMs ?? 0);
  const tickIntervalMs = Number(channel.tickIntervalMs ?? 0);

  return {
    source,
    mode,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    cancelOnMove: channel.cancelOnMove === true,
    cancelOnJump: channel.cancelOnJump === true,
    interruptible: channel.interruptible !== false,
    ...(Number.isFinite(tickIntervalMs) && tickIntervalMs > 0 ? { tickIntervalMs } : {}),
    ...(typeof channel.buffId === 'number' ? { buffId: channel.buffId } : {}),
  };
}

function requiresStandingAtCastClient(ability: any): boolean {
  if (ability?.requiresStanding === true) return true;
  const channel = getRuntimeAbilityChannel(ability);
  return channel?.source === 'ACTIVE' && channel.cancelOnMove === true;
}

function buildChannelBarDataForPlayer(
  player: ChannelingPlayer | null | undefined,
  channelAbilityByBuffId: Map<number, any>,
  options?: { suppressJumpBar?: boolean },
): ChannelBarData | null {
  const result = buildChannelBarResultForPlayer(player, channelAbilityByBuffId, options);
  return result ? result.data : null;
}

function buildChannelBarResultForPlayer(
  player: ChannelingPlayer | null | undefined,
  channelAbilityByBuffId: Map<number, any>,
  options?: { suppressJumpBar?: boolean },
  abilitiesById?: Record<string, any>,
): { data: ChannelBarData; abilityId?: string; ability?: any } | null {
  const buffs = player?.buffs ?? [];
  const suppressJumpBar = options?.suppressJumpBar === true;

  const hasBlockingCC = buffsHaveAnyEffect(buffs, ['CONTROL', 'KNOCKED_BACK', 'ATTACK_LOCK']);
  const hasInterruptImmune = buffsHaveAnyEffect(buffs, ['CONTROL_IMMUNE', 'SILENCE_IMMUNE']);
  if (hasBlockingCC && !hasInterruptImmune) {
    return null;
  }

  if (player?.activeChannel) {
    const channel = player.activeChannel;
    if (suppressJumpBar && channel.cancelOnJump) {
      return null;
    }

    const ability = abilitiesById?.[channel.abilityId];
    const interruptible = (channel as any).interruptible !== undefined
      ? (channel as any).interruptible
      : (ability?.channel?.interruptible !== false);
    const activeTickIntervalMs = Number((channel as any).tickIntervalMs ?? ability?.channel?.tickIntervalMs ?? 0);
    const data: ChannelBarData = channel.forwardChannel === false
      ? {
          kind: 'reverse',
          name: channel.abilityName,
          appliedAt: channel.startedAt,
          durationMs: Math.max(1, channel.durationMs),
          ...(Number.isFinite(activeTickIntervalMs) && activeTickIntervalMs > 0 ? { tickIntervalMs: activeTickIntervalMs } : {}),
          interruptible,
        }
      : {
          kind: 'forward',
          name: channel.abilityName,
          startedAt: channel.startedAt,
          durationMs: Math.max(1, channel.durationMs),
          cancelOnMove: !!channel.cancelOnMove,
          cancelOnJump: !!channel.cancelOnJump,
          interruptible,
        };
    return { data, abilityId: channel.abilityId, ability };
  }

  for (const buff of buffs) {
    const ability = channelAbilityByBuffId.get(buff.buffId);
    const channel = getRuntimeAbilityChannel(ability);
    if (!ability || !channel || channel.source !== 'BUFF' || channel.buffId !== buff.buffId) {
      continue;
    }

    if (suppressJumpBar && channel.cancelOnJump) {
      return null;
    }

    const rawAppliedAt = Number((buff as any).appliedAt ?? 0);
    const rawExpiresAt = Number((buff as any).expiresAt ?? 0);
    const durationMs = rawExpiresAt > rawAppliedAt
      ? rawExpiresAt - rawAppliedAt
      : Math.max(1, channel.durationMs || 5_000);
    const startedAt = rawAppliedAt > 0
      ? rawAppliedAt
      : rawExpiresAt > 0
      ? rawExpiresAt - durationMs
      : Date.now() - durationMs;
    const tickIntervalMs = Number((buff as any).periodicMs ?? channel.tickIntervalMs ?? 0);
    const name = ability.name ?? (buff as any).name ?? '运功';
    const interruptible = (channel as any).interruptible !== false;

    const data: ChannelBarData = channel.mode === 'FORWARD'
      ? {
          kind: 'forward',
          name,
          startedAt,
          durationMs,
          cancelOnMove: channel.cancelOnMove,
          cancelOnJump: channel.cancelOnJump,
          interruptible,
        }
      : {
          kind: 'reverse',
          name,
          appliedAt: startedAt,
          durationMs,
          ...(Number.isFinite(tickIntervalMs) && tickIntervalMs > 0 ? { tickIntervalMs } : {}),
          interruptible,
        };
    return { data, abilityId: ability.id, ability };
  }

  return null;
}

function normalizePlanar(x: number, y: number): { x: number; y: number } | null {
  const len = Math.sqrt(x * x + y * y);
  if (len <= 0.01) return null;
  return { x: x / len, y: y / len };
}

function worldUnitsToNewUnits(value: number, mode?: string): number {
  return value / getStoredUnitScale(mode);
}

function facingToYaw(facing: { x: number; y: number }): number {
  return Math.atan2(facing.x, -facing.y);
}

function buildTraditionalMoveIntent(
  keys: { w: boolean; a: boolean; s: boolean; d: boolean },
  mouseLook: boolean,
  bothMouse: boolean,
  camYaw: number,
  charYaw: number,
): { direction: { dx: number; dy: number } | null; backpedalOnly: boolean } {
  let dx = 0;
  let dy = 0;
  let backpedalOnly = false;

  if (mouseLook) {
    const moveFwd = { x: Math.sin(camYaw), y: -Math.cos(camYaw) };
    const moveRight = { x: Math.cos(camYaw), y: Math.sin(camYaw) };

    let forwardInput = (keys.w ? 1 : 0) + (keys.s ? -1 : 0) + (bothMouse ? 1 : 0);
    let strafeInput = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
    if (keys.s && !keys.w && !bothMouse) {
      forwardInput = -1;
      strafeInput = 0;
      backpedalOnly = true;
    }
    if (!backpedalOnly && keys.a && keys.d) {
      strafeInput = -1;
      forwardInput += 1;
    }

    dx = moveFwd.x * forwardInput + moveRight.x * strafeInput;
    dy = moveFwd.y * forwardInput + moveRight.y * strafeInput;
  } else {
    const moveFwd = { x: Math.sin(charYaw), y: -Math.cos(charYaw) };
    if (keys.w) {
      dx += moveFwd.x;
      dy += moveFwd.y;
    } else if (keys.s) {
      dx -= moveFwd.x;
      dy -= moveFwd.y;
      backpedalOnly = true;
    }
  }

  const dir = normalizePlanar(dx, dy);
  if (!dir) return { direction: null, backpedalOnly };
  const speedMult = backpedalOnly ? 0.5 : 1.0;
  return {
    direction: { dx: dir.x * speedMult, dy: dir.y * speedMult },
    backpedalOnly,
  };
}

function estimateAirborneTicks(
  heightAboveGround: number,
  initialVz: number,
  gravityUp: number,
  gravityDown: number,
): number {
  let height = Math.max(0, heightAboveGround);
  let vz = initialVz;
  let ticks = 0;

  while (ticks < 360) {
    vz -= vz >= 0 ? gravityUp : gravityDown;
    height += vz;
    ticks += 1;
    if (height <= 0) return Math.max(1, ticks);
  }

  return 360;
}

function getTravelSpeedPerTick(distance: number, ticks: number): number {
  if (distance <= 0 || ticks <= 0) return 0;
  return distance / Math.max(1, ticks);
}

/** Resolve circle-vs-AABB collision (client-side prediction). Z-aware: skip if player is above obj. */
function resolveObjCollisionClient(
  px: number, py: number, pz: number,
  vel: { x: number; y: number },
  obj: MapObject,
  playerRadius = DEFAULT_PLAYER_RADIUS,
): { x: number; y: number } {
  if (pz >= obj.h) return { x: px, y: py }; // above rooftop
  const pr = playerRadius;
  const cx = Math.max(obj.x, Math.min(px, obj.x + obj.w));
  const cy = Math.max(obj.y, Math.min(py, obj.y + obj.d));
  const dx = px - cx;
  const dy = py - cy;
  const distSq = dx * dx + dy * dy;
  if (distSq >= pr * pr) return { x: px, y: py };
  let outX = px, outY = py;
  if (distSq < 1e-6) {
    const dL = px - obj.x;
    const dR = obj.x + obj.w - px;
    const dT = py - obj.y;
    const dB = obj.y + obj.d - py;
    const min = Math.min(dL, dR, dT, dB);
    if (min === dL)      { outX = obj.x - pr;           vel.x = Math.min(0, vel.x); }
    else if (min === dR) { outX = obj.x + obj.w + pr;   vel.x = Math.max(0, vel.x); }
    else if (min === dT) { outY = obj.y - pr;           vel.y = Math.min(0, vel.y); }
    else                 { outY = obj.y + obj.d + pr;   vel.y = Math.max(0, vel.y); }
  } else {
    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    const pen = pr - dist;
    outX += nx * pen;
    outY += ny * pen;
    const dot = vel.x * nx + vel.y * ny;
    if (dot < 0) { vel.x -= dot * nx; vel.y -= dot * ny; }
  }
  return { x: outX, y: outY };
}

/** Get ground height at XY (tallest object the player overlaps and is above). */
function getGroundHeightClient(
  px: number,
  py: number,
  pz: number,
  objects: MapObject[],
  playerRadius = DEFAULT_PLAYER_RADIUS,
): number {
  let ground = 0;
  for (const obj of objects) {
    if (pz < obj.h - 0.1) continue;
    const cx = Math.max(obj.x, Math.min(px, obj.x + obj.w));
    const cy = Math.max(obj.y, Math.min(py, obj.y + obj.d));
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy < playerRadius * playerRadius && obj.h > ground) {
      ground = obj.h;
    }
  }
  return ground;
}

/* --- BVH collision scratch objects (reused to avoid GC pressure) --- */
const _bvhCenter = new THREE.Vector3();
const _bvhVelocity = new THREE.Vector3();
// Cylinder collision shape: horizontal radius + half-height tracked separately.
// _bvhCenter.y is always the CYLINDER CENTRE (feet + half-height), never sphere-bottom.
const EXPORT_CYL_RADIUS = COLLISION_TEST_PLAYER_RADIUS / RENDER_SF;
const CYL_HALF_HEIGHT_GAME = 0.75;
const EXPORT_CYL_HALF_HEIGHT = CYL_HALF_HEIGHT_GAME / RENDER_SF;
const BVH_STEP_UP_EXPORT = 56;

function getBvhGroundProbeOriginY(centerY: number): number {
  return centerY - EXPORT_CYL_HALF_HEIGHT + BVH_STEP_UP_EXPORT;
}

function getBvhGroundSupportY(sys: MapCollisionSystem, center: THREE.Vector3): number | null {
  return sys.getSupportGroundY(center, getBvhGroundProbeOriginY(center.y));
}

function getBvhCeilingY(sys: MapCollisionSystem, center: THREE.Vector3): number | null {
  return sys.getCeilingY(center, center.y);
}

/* --- LOS BVH scratch (avoid GC in render loop) --- */
const _losFrom = new THREE.Vector3();
const _losTo   = new THREE.Vector3();
const LOS_EYE_HEIGHT_GAME = 1.5; // eye height above feet in game units

/**
 * Convert a game-space position to BVH export-unit space at eye height,
 * then check BVH LOS between caster and target.
 * Returns true = LOS is blocked.
 */
function clientCheckLOS(
  sys: import('./scene/MapCollisionSystem').MapCollisionSystem,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  halfW: number, halfH: number,
): boolean {
  if (!sys.shellBVH) return false;
  const sf = RENDER_SF;
  const gx = GROUP_POS_X, gy = GROUP_POS_Y, gz = GROUP_POS_Z;
  _losFrom.set(
    (ax - halfW - gx) / sf,
    (az + LOS_EYE_HEIGHT_GAME - gy) / sf,
    (halfH - ay - gz) / sf,
  );
  _losTo.set(
    (bx - halfW - gx) / sf,
    (bz + LOS_EYE_HEIGHT_GAME - gy) / sf,
    (halfH - by - gz) / sf,
  );
  return sys.checkLOS(_losFrom, _losTo, EXPORT_CYL_RADIUS);
}

/** Live position + height display — reads refs every 200ms.
 *  Shows:  X / Y world coords,  "↑ Xm" above-ground (new units),  "floor Xm" floor elevation (new units).
 */
function PositionDisplay({
  posRef,
  groundHRef,
  unitScale = LEGACY_STORED_UNIT_SCALE,
  inline = false,
}: {
  posRef: React.MutableRefObject<{ x: number; y: number; z: number }>;
  groundHRef?: React.MutableRefObject<number>;
  unitScale?: number;
  inline?: boolean;
}) {
  const [pos, setPos] = React.useState({ x: 0, y: 0, z: 0, groundH: 0 });
  React.useEffect(() => {
    const id = setInterval(() => {
      const p = posRef.current;
      const g = groundHRef?.current ?? 0;
      setPos({ x: p.x, y: p.y, z: p.z, groundH: g });
    }, 200);
    return () => clearInterval(id);
  }, [posRef, groundHRef]);
  const aboveGround = (pos.z - pos.groundH) / unitScale;
  const floorElev   = pos.groundH / unitScale;
  return (
    <div style={{
      ...(inline
        ? {
            background: 'rgba(255,255,255,0.04)',
            color: '#86efac',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            lineHeight: 1.6,
          }
        : {
            position: 'absolute', top: 14, left: 14, zIndex: 500,
            background: 'rgba(0,0,0,0.7)', color: '#0f0', fontFamily: 'monospace',
            fontSize: 12, padding: '4px 8px', borderRadius: 4, pointerEvents: 'none',
            lineHeight: 1.5,
          }),
    }}>
      <div>X:{pos.x.toFixed(1)} Y:{pos.y.toFixed(1)}</div>
      <div>↑ {aboveGround.toFixed(2)} u  (above ground)</div>
      <div>floor {floorElev.toFixed(2)} u  (elevation)</div>
    </div>
  );
}

/** Golden 3D line between two world-coord pins — rendered inside the R3F Canvas. */
function MeasureLine3D({
  pinA,
  pinB,
  halfX,
  halfY,
}: {
  pinA: { x: number; y: number; z: number } | null;
  pinB: { x: number; y: number; z: number } | null;
  halfX: number;
  halfY: number;
}) {
  const geoRef  = React.useRef(new THREE.BufferGeometry());
  const matRef  = React.useRef(new THREE.LineBasicMaterial({ color: '#FFD700' }));
  const lineObj = React.useRef(new THREE.Line(geoRef.current, matRef.current));
  React.useEffect(() => {
    return () => { geoRef.current.dispose(); matRef.current.dispose(); };
  }, []);
  React.useEffect(() => {
    if (!pinA || !pinB) return;
    const ax = pinA.x - halfX, ay = (pinA.z ?? 0) + 0.3, az = halfY - pinA.y;
    const bx = pinB.x - halfX, by = (pinB.z ?? 0) + 0.3, bz = halfY - pinB.y;
    geoRef.current.setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
    geoRef.current.computeBoundingSphere();
  }, [pinA, pinB, halfX, halfY]);
  return <primitive object={lineObj.current} visible={!!(pinA && pinB)} />;
}

/** 2D segment vs AABB intersection (for line-of-sight checks). */
function segmentIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) < 1e-8) { if (x1 < minX || x1 > maxX) return false; }
  else {
    let t1 = (minX - x1) / dx, t2 = (maxX - x1) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dy) < 1e-8) { if (y1 < minY || y1 > maxY) return false; }
  else {
    let t1 = (minY - y1) / dy, t2 = (maxY - y1) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Check if LOS between two positions is blocked by any map object.
 *  Returns the first blocking MapObject, or null if clear.
 *  minBlockH: objects shorter than this are ignored.
 *  casterZ / targetZ: feet heights; EYE_HEIGHT is added for eye-level check.
 */
const LOS_EYE_HEIGHT = 1.5; // game units above player feet
const CHU_HE_HAN_JIE_COLLIDER_HEIGHT = 1.5;
const CHU_HE_HAN_JIE_WALL_KIND = 'chu_he_han_jie_wall';

function getAbilityRangeBonusClient(buffs?: ActiveBuff[]): number {
  return (buffs ?? []).reduce((sum, buff) => {
    const bonus = (buff.effects ?? []).reduce((effectSum, effect) => {
      if (effect.type !== 'RANGE_BOOST') return effectSum;
      return effectSum + Math.max(0, Number((effect as any).value ?? 0));
    }, 0);
    return sum + bonus;
  }, 0);
}

function getEffectiveAbilityRangeClient(ability: any, buffs?: ActiveBuff[]): number | undefined {
  if (typeof ability?.range !== 'number') return ability?.range;
  return ability.range + getAbilityRangeBonusClient(buffs);
}

function isLOSBlockedClient(
  ax: number, ay: number, bx: number, by: number, objects: MapObject[],
  minBlockH: number = 0,
  casterZ: number = 0,
  targetZ: number = 0,
): MapObject | null {
  const casterEye = casterZ + LOS_EYE_HEIGHT;
  const targetEye = targetZ + LOS_EYE_HEIGHT;
  for (const obj of objects) {
    if (obj.h < minBlockH) continue;
    if (obj.h <= Math.min(casterEye, targetEye)) continue;
    if (segmentIntersectsAABB(ax, ay, bx, by, obj.x - 0.5, obj.y - 0.5, obj.x + obj.w + 0.5, obj.y + obj.d + 0.5)) return obj;
  }
  return null;
}

function isChuHeHanJieWallEntityClient(entity: TargetEntity | null | undefined): boolean {
  return !!entity && entity.kind === CHU_HE_HAN_JIE_WALL_KIND;
}

function getChuHeHanJieWallGeometryClient(entity: TargetEntity) {
  if (!isChuHeHanJieWallEntityClient(entity)) return null;
  const halfLength = Number(entity.wallHalfLength ?? 0);
  const halfThickness = Number(entity.wallHalfThickness ?? 0);
  const wallHeight = Number(entity.wallHeight ?? 0);
  const tangentX = Number(entity.wallTangent?.x ?? 0);
  const tangentY = Number(entity.wallTangent?.y ?? 0);
  const normalX = Number(entity.wallNormal?.x ?? 0);
  const normalY = Number(entity.wallNormal?.y ?? 0);
  const tangentLen = Math.hypot(tangentX, tangentY);
  const normalLen = Math.hypot(normalX, normalY);
  if (halfLength <= 0 || halfThickness <= 0 || wallHeight <= 0 || tangentLen < 1e-6 || normalLen < 1e-6) {
    return null;
  }
  return {
    centerX: entity.position.x,
    centerY: entity.position.y,
    halfLength,
    halfThickness,
    baseZ: entity.position.z ?? 0,
    wallHeight,
    tangentX: tangentX / tangentLen,
    tangentY: tangentY / tangentLen,
    normalX: normalX / normalLen,
    normalY: normalY / normalLen,
  };
}

function toChuHeHanJieWallLocalPoint(
  geometry: NonNullable<ReturnType<typeof getChuHeHanJieWallGeometryClient>>,
  point: { x: number; y: number },
) {
  const dx = point.x - geometry.centerX;
  const dy = point.y - geometry.centerY;
  return {
    u: dx * geometry.tangentX + dy * geometry.tangentY,
    v: dx * geometry.normalX + dy * geometry.normalY,
  };
}

function fromChuHeHanJieWallLocalPoint(
  geometry: NonNullable<ReturnType<typeof getChuHeHanJieWallGeometryClient>>,
  point: { u: number; v: number },
) {
  return {
    x: geometry.centerX + point.u * geometry.tangentX + point.v * geometry.normalX,
    y: geometry.centerY + point.u * geometry.tangentY + point.v * geometry.normalY,
  };
}

function doesClientActorOverlapChuHeHanJieWallHeight(
  geometry: NonNullable<ReturnType<typeof getChuHeHanJieWallGeometryClient>>,
  actorBaseZ: number,
  actorHeight: number,
) {
  const actorTopZ = actorBaseZ + actorHeight;
  const wallTopZ = geometry.baseZ + geometry.wallHeight;
  return actorTopZ > geometry.baseZ + 1e-4 && actorBaseZ < wallTopZ - 1e-4;
}

function isLineBlockedByEnemyChuHeHanJieWallClient(
  entities: TargetEntity[] | undefined,
  actorUserId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  casterZ: number = 0,
  targetZ: number = 0,
  ignoreEntityId?: string,
): boolean {
  const casterEye = casterZ + LOS_EYE_HEIGHT;
  const targetEye = targetZ + LOS_EYE_HEIGHT;
  const now = Date.now();
  for (const entity of entities ?? []) {
    if (!isChuHeHanJieWallEntityClient(entity)) continue;
    if (entity.ownerUserId === actorUserId) continue;
    if (entity.id === ignoreEntityId) continue;
    if ((entity.hp ?? 0) <= 0) continue;
    if ((entity.expiresAt ?? 0) <= now) continue;
    const geometry = getChuHeHanJieWallGeometryClient(entity);
    if (!geometry) continue;
    if (geometry.baseZ + geometry.wallHeight <= Math.min(casterEye, targetEye)) continue;
    const start = toChuHeHanJieWallLocalPoint(geometry, from);
    const end = toChuHeHanJieWallLocalPoint(geometry, to);
    if (
      segmentIntersectsAABB(
        start.u,
        start.v,
        end.u,
        end.v,
        -geometry.halfLength,
        -geometry.halfThickness,
        geometry.halfLength,
        geometry.halfThickness,
      )
    ) {
      return true;
    }
  }
  return false;
}

function resolveEnemyChuHeHanJieWallCollisionClient(
  px: number,
  py: number,
  actorBaseZ: number,
  vel: { x: number; y: number },
  entities: TargetEntity[] | undefined,
  actorUserId: string,
  playerRadius = DEFAULT_PLAYER_RADIUS,
): { x: number; y: number } {
  let outX = px;
  let outY = py;
  let collided = false;
  const now = Date.now();

  for (let pass = 0; pass < 2; pass += 1) {
    let passCollided = false;
    for (const entity of entities ?? []) {
      if (!isChuHeHanJieWallEntityClient(entity)) continue;
      if (entity.ownerUserId === actorUserId) continue;
      if ((entity.hp ?? 0) <= 0) continue;
      if ((entity.expiresAt ?? 0) <= now) continue;
      const geometry = getChuHeHanJieWallGeometryClient(entity);
      if (!geometry) continue;
      if (!doesClientActorOverlapChuHeHanJieWallHeight(geometry, actorBaseZ, CHU_HE_HAN_JIE_COLLIDER_HEIGHT)) continue;
      const local = toChuHeHanJieWallLocalPoint(geometry, { x: outX, y: outY });
      const closestU = Math.max(-geometry.halfLength, Math.min(local.u, geometry.halfLength));
      const closestV = Math.max(-geometry.halfThickness, Math.min(local.v, geometry.halfThickness));
      const deltaU = local.u - closestU;
      const deltaV = local.v - closestV;
      const distanceSq = deltaU * deltaU + deltaV * deltaV;
      const targetRadius = playerRadius + 1e-4;
      if (distanceSq >= targetRadius * targetRadius) continue;

      const resolved = { ...local };
      if (distanceSq > 1e-8) {
        const distance = Math.sqrt(distanceSq);
        const push = targetRadius - distance;
        resolved.u += (deltaU / distance) * push;
        resolved.v += (deltaV / distance) * push;
      } else {
        const overlapU = geometry.halfLength + targetRadius - Math.abs(local.u);
        const overlapV = geometry.halfThickness + targetRadius - Math.abs(local.v);
        if (overlapV <= overlapU) {
          resolved.v = (local.v >= 0 ? 1 : -1) * (geometry.halfThickness + targetRadius);
        } else {
          resolved.u = (local.u >= 0 ? 1 : -1) * (geometry.halfLength + targetRadius);
        }
      }

      const worldResolved = fromChuHeHanJieWallLocalPoint(geometry, resolved);
      outX = worldResolved.x;
      outY = worldResolved.y;
      passCollided = true;
      collided = true;
    }
    if (!passCollided) break;
  }

  if (collided) {
    vel.x = 0;
    vel.y = 0;
  }
  return { x: outX, y: outY };
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function facingArrow(facing: { x: number; y: number } | undefined): string {
  if (!facing) return '·';
  const len = Math.sqrt(facing.x * facing.x + facing.y * facing.y);
  if (len < 0.05) return '·';
  const angle = Math.atan2(facing.y / len, facing.x / len);
  const idx = Math.round(angle / (Math.PI / 4));
  const dirs = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  return dirs[((idx % 8) + 8) % 8];
}

const STEALTH_BUFF_IDS = new Set([1011, 1012, 1013, 1021]);
const STEALTH_ABILITY_IDS = new Set(['anchen_misan', 'fuguang_lueying', 'tiandi_wuji', 'hua_die']);
const UNTARGETABLE_BUFF_IDS = new Set([1008]);
const DISGUISE_BUFF_IDS = new Set([980001]);
const SANLIU_XIA_BUFF_IDS = new Set([1007, 1008]);
const HONG_MENG_TIAN_JIN_BUFF_IDS = new Set([2645]);
const SHU_SE_BUFF_IDS = new Set([2646]);

function buffHasEffect(buff: ActiveBuff | any, type: string): boolean {
  return Array.isArray(buff?.effects) && buff.effects.some((e: any) => e?.type === type);
}

function buffNameIncludes(buff: ActiveBuff | any, token: string): boolean {
  return typeof buff?.name === 'string' && buff.name.includes(token);
}

function hasStealthClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'STEALTH') ||
    STEALTH_BUFF_IDS.has(b.buffId) ||
    buffNameIncludes(b, '隐身') ||
    buffNameIncludes(b, '遁影')
  );
}

function hasDisguiseClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    DISGUISE_BUFF_IDS.has(b.buffId) ||
    buffHasEffect(b, 'DISGUISE') ||
    buffNameIncludes(b, '伪装')
  );
}

function hasAntiStealthClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'ANTI_STEALTH') ||
    buffNameIncludes(b, '反隐')
  );
}

function abilityUsesStealthClient(ability?: any): boolean {
  if (!ability) return false;
  if (typeof ability.id === 'string' && STEALTH_ABILITY_IDS.has(ability.id)) return true;
  const directEffects = Array.isArray(ability.effects) ? ability.effects : [];
  const channelEffects = Array.isArray(ability.channelEffects) ? ability.channelEffects : [];
  const buffs = Array.isArray(ability.buffs) ? ability.buffs : [];

  if (directEffects.some((effect: any) => effect?.type === 'STEALTH')) return true;
  if (channelEffects.some((effect: any) => effect?.type === 'STEALTH')) return true;
  return buffs.some((buff: any) =>
    buffHasEffect(buff, 'STEALTH') ||
    buffNameIncludes(buff, '隐身') ||
    buffNameIncludes(buff, '遁影')
  );
}

function hasSanliuXiaClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => SANLIU_XIA_BUFF_IDS.has(b.buffId) || buffNameIncludes(b, '散流霞'));
}

function hasHongMengTianJinClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    HONG_MENG_TIAN_JIN_BUFF_IDS.has(b.buffId) ||
    buffHasEffect(b, 'HONG_MENG_TIAN_JIN') ||
    buffNameIncludes(b, '鸿蒙天禁')
  );
}

function hasShuSeClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    SHU_SE_BUFF_IDS.has(b.buffId) ||
    buffHasEffect(b, 'HONG_MENG_TIAN_JIN_IMMUNE') ||
    buffNameIncludes(b, '曙色')
  );
}

function hasMianLaClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'KNOCKBACK_IMMUNE'));
}

function shouldHideOpponentByStealth(buffs?: ActiveBuff[]): boolean {
  return (hasStealthClient(buffs) && !hasSanliuXiaClient(buffs)) || hasHongMengTianJinClient(buffs);
}

function blocksTargetingClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'STEALTH') ||
    buffHasEffect(b, 'DISGUISE') ||
    buffHasEffect(b, 'UNTARGETABLE') ||
    STEALTH_BUFF_IDS.has(b.buffId) ||
    UNTARGETABLE_BUFF_IDS.has(b.buffId) ||
    DISGUISE_BUFF_IDS.has(b.buffId) ||
    buffNameIncludes(b, '隐身') ||
    buffNameIncludes(b, '遁影') ||
    buffNameIncludes(b, '不可选中')
  );
}

function hasQinggongSealClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) =>
    buffHasEffect(b, 'DISPLACEMENT') ||
    buffHasEffect(b, 'QINGGONG_SEAL') ||
    buffNameIncludes(b, '封轻功')
  );
}

function hasSilenceClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'SILENCE') || buffNameIncludes(b, '沉默'));
}

function hasDisarmClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'DISARM') || buffNameIncludes(b, '缴械'));
}

function hasInnerPowerLockClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'INNER_POWER_LOCK') || buffNameIncludes(b, '封内'));
}

function hasOuterPowerLockClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'OUTER_POWER_LOCK') || buffNameIncludes(b, '封外'));
}

function hasNonQinggongLockClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'NON_QINGGONG_LOCK') || buffNameIncludes(b, '轻功以外'));
}

function getAbilityDamageTypeClient(ability: any): '内功' | '外功' | undefined {
  const damageType = ability?.damageType ?? ability?.tags?.damageType;
  return damageType === '内功' || damageType === '外功' ? damageType : undefined;
}

function abilityAllowsSilenceClient(ability: any): boolean {
  return ability?.allowWhileSilenced === true ||
    (Array.isArray(ability?.effects) && ability.effects.some((effect: any) => effect.allowWhileSilenced === true));
}

function getPowerLockWarningClient(ability: any, buffs?: ActiveBuff[]): string | null {
  if (!ability) return null;
  const damageType = getAbilityDamageTypeClient(ability);
  if (hasSilenceClient(buffs) && !abilityAllowsSilenceClient(ability)) return REQUIRED_POWER_MISSING_WARNING;
  if (hasDisarmClient(buffs) && ability.noWeaponRequired !== true) return REQUIRED_POWER_MISSING_WARNING;
  if (hasInnerPowerLockClient(buffs) && damageType === '内功') return REQUIRED_POWER_MISSING_WARNING;
  if (hasOuterPowerLockClient(buffs) && damageType === '外功') return REQUIRED_POWER_MISSING_WARNING;
  return null;
}

function hasYuqiStateClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  const now = Date.now();
  return buffs.some((b: any) => b.buffId === 2741 && (b.expiresAt ?? 0) > now);
}

function hasDisplacementClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'DISPLACEMENT'));
}

function hasDashTurnOverrideClient(buffs?: ActiveBuff[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => buffHasEffect(b, 'DASH_TURN_OVERRIDE'));
}

function buffsHaveAnyEffect(buffs: ActiveBuff[] | undefined, effectTypes: string[]): boolean {
  if (!Array.isArray(buffs) || buffs.length === 0) return false;
  return buffs.some((b: any) => effectTypes.some((effectType) => buffHasEffect(b, effectType)));
}

function getSpecialAbilityBarIdsClient(buffs: ActiveBuff[] | undefined): string[] {
  const ids: string[] = [];
  const now = Date.now();
  for (const buff of buffs ?? []) {
    if (!buff || (buff.expiresAt ?? 0) <= now) continue;
    for (const effect of buff.effects ?? []) {
      if ((effect as any)?.type !== 'SPECIAL_ABILITY_BAR' || !Array.isArray((effect as any).abilityIds)) continue;
      for (const abilityId of (effect as any).abilityIds) {
        if (typeof abilityId === 'string' && abilityId && !ids.includes(abilityId)) {
          ids.push(abilityId);
        }
      }
    }
  }
  return ids;
}

function requiresFacingByDefault(ability?: { target?: 'SELF' | 'OPPONENT'; faceDirection?: boolean } | null): boolean {
  if (!ability) return false;
  if (ability.target === 'OPPONENT') return ability.faceDirection !== false;
  return ability.faceDirection === true;
}

function computeHpShieldSegments(
  hp: number | undefined,
  shield: number | undefined,
  maxHp: number | undefined,
): { hpPct: number; shieldPct: number } {
  const safeMaxHp = Math.max(1, Number(maxHp ?? 100));
  const safeHp = Math.max(0, Number(hp ?? 0));
  const safeShield = Math.max(0, Number(shield ?? 0));
  const total = safeHp + safeShield;

  if (total <= 0) {
    return { hpPct: 0, shieldPct: 0 };
  }

  if (total <= safeMaxHp) {
    return {
      hpPct: Math.max(0, Math.min(100, (safeHp / safeMaxHp) * 100)),
      shieldPct: Math.max(0, Math.min(100, (safeShield / safeMaxHp) * 100)),
    };
  }

  return {
    hpPct: Math.max(0, Math.min(100, (safeHp / total) * 100)),
    shieldPct: Math.max(0, Math.min(100, (safeShield / total) * 100)),
  };
}

function formatIconBarDistance(from: Position | undefined, to: Position | undefined, unitScale: number): string {
  if (!from || !to) return '0.0';
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  const dz = ((to as any).z ?? 0) - ((from as any).z ?? 0);
  return (Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.001, unitScale)).toFixed(1);
}

// Fixed camera direction constant — referenced in physics tick
const CAM_DIR = { x: 0, y: 1 };
const DEFAULT_PITCH = Math.atan2(10, 20);
const DEFAULT_MIN_CAMERA_PITCH = 0.08;
const COLLISION_TEST_MIN_CAMERA_PITCH = -1.05;
const MAX_CAMERA_PITCH = Math.PI * 0.47;

function clampCameraPitch(pitch: number, mode?: string): number {
  const minPitch = mode === 'collision-test' ? COLLISION_TEST_MIN_CAMERA_PITCH : DEFAULT_MIN_CAMERA_PITCH;
  return Math.max(minPitch, Math.min(MAX_CAMERA_PITCH, pitch));
}

/* ============================================================
   TYPES
   ============================================================ */
interface Position { x: number; y: number; z?: number; }

function calculateAbilitySoundSpatial(params: {
  listener?: Position | null;
  source?: Position | null;
  ability?: any;
  phase: AbilitySoundPhase;
  isSelf: boolean;
}) {
  if (params.isSelf || !params.listener || !params.source) {
    return { volume: 1, pan: 0 };
  }

  const dx = params.source.x - params.listener.x;
  const dy = params.source.y - params.listener.y;
  const distance = Math.hypot(dx, dy);
  const fullVolumeRange = 8;
  const audibleRange = getAbilitySoundAudibleRange(params.ability, params.phase);

  if (distance >= audibleRange) {
    return { volume: 0, pan: 0 };
  }

  const falloffSpan = Math.max(1, audibleRange - fullVolumeRange);
  const t = Math.max(0, Math.min(1, (distance - fullVolumeRange) / falloffSpan));
  const volume = Math.max(0, Math.min(1, Math.pow(1 - t, 1.35)));
  const pan = Math.max(-0.75, Math.min(0.75, dx / Math.max(audibleRange, 1)));

  return { volume, pan };
}

function getAbilityChannelBaseDurationMs(ability: any): number | null {
  const runtimeChannel = getRuntimeAbilityChannel(ability);
  const durationMs = Number(runtimeChannel?.durationMs ?? ability?.channelDurationMs ?? ability?.channel?.durationMs ?? 0);
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}

function getBuffChannelDurationForSound(actor: { buffs?: ActiveBuff[] } | null | undefined, ability: any, abilityId: string) {
  const runtimeChannel = getRuntimeAbilityChannel(ability);
  if (!runtimeChannel || runtimeChannel.source !== 'BUFF' || runtimeChannel.mode !== 'FORWARD') return null;

  const buffs = actor?.buffs ?? [];
  const abilityIdentity = String(ability?.id ?? abilityId);
  const buff = buffs.find((entry) => {
    if (typeof runtimeChannel.buffId === 'number' && entry.buffId === runtimeChannel.buffId) return true;
    return String(entry.sourceAbilityId ?? '') === abilityIdentity;
  });
  if (!buff) return null;

  const appliedAt = Number(buff.appliedAt ?? 0);
  const expiresAt = Number(buff.expiresAt ?? 0);
  const durationMs = expiresAt > appliedAt ? expiresAt - appliedAt : runtimeChannel.durationMs;
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}

function isFenglaiWushanSoundAbility(ability: any, abilityId: string) {
  const name = String(ability?.name ?? '').replace(/^\s*\d+\.\s*/, '').trim();
  return abilityId === 'fenglai_wushan' || name === '风来吴山' || name === '风来无山';
}

function getChannelSoundLoopDurationMs(params: {
  ability: any;
  actor: { buffs?: ActiveBuff[] } | null | undefined;
  abilityId: string;
  phase: AbilitySoundPhase;
}) {
  if (params.phase !== 'channelStart') return undefined;
  if (!isFenglaiWushanSoundAbility(params.ability, params.abilityId)) return undefined;

  const buff = (params.actor?.buffs ?? []).find((entry: any) => entry.buffId === 1014 || entry.sourceAbilityId === 'fenglai_wushan');
  if (buff) {
    const expiresAt = Number(buff.expiresAt);
    const now = Date.now();
    if (Number.isFinite(expiresAt) && expiresAt > now) {
      return Math.max(80, expiresAt - now);
    }

    const appliedAt = Number(buff.appliedAt);
    if (Number.isFinite(appliedAt) && Number.isFinite(expiresAt) && expiresAt > appliedAt) {
      return expiresAt - appliedAt;
    }
  }

  return 5000;
}

function getChannelSoundPlaybackRate(params: {
  ability: any;
  actor: { activeChannel?: ActiveChannel; buffs?: ActiveBuff[] } | null | undefined;
  abilityId: string;
  abilityInstanceId?: string;
  phase: AbilitySoundPhase;
}) {
  if (params.phase !== 'channelStart') return 1;

  const baseDurationMs = getAbilityChannelBaseDurationMs(params.ability);
  if (!baseDurationMs) return 1;

  let actualDurationMs: number | null = null;
  const activeChannel = params.actor?.activeChannel;
  if (
    activeChannel
    && activeChannel.abilityId === params.abilityId
    && (!params.abilityInstanceId || activeChannel.instanceId === params.abilityInstanceId)
    && activeChannel.forwardChannel !== false
  ) {
    const durationMs = Number(activeChannel.durationMs);
    actualDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
  }

  actualDurationMs ??= getBuffChannelDurationForSound(params.actor, params.ability, params.abilityId);
  if (!actualDurationMs) return 1;

  const playbackRate = baseDurationMs / actualDurationMs;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return 1;
  return Math.max(0.65, Math.min(2.5, playbackRate));
}

function getChannelSoundKey(actorUserId: string | undefined, abilityId: string | undefined, abilityInstanceId?: string) {
  if (!actorUserId || !abilityId) return undefined;
  return `${actorUserId}:${abilityId}:${abilityInstanceId ?? 'default'}`;
}

function isChannelStartCue(params: { ability: any; event: any; phase: AbilitySoundPhase }) {
  if (params.phase !== 'channelStart') return false;
  return params.event?.channelPhase === 'start' || params.ability?.type === 'CHANNEL' || !!params.ability?.channel;
}
interface Facing { x: number; y: number; }

interface AbilityInfo {
  id: string;        // instanceId (or abilityId fallback for common)
  abilityId: string;    // always the plain ability id (e.g. 'fuyao_zhishang')
  name: string;
  iconPath?: string;
  description?: string;
  channel?: RuntimeAbilityChannel;
  range?: number;
  baseRange?: number;
  minRange?: number;
  baseCooldownTicks?: number;
  cooldown: number;
  maxCooldown: number;
  chargeCount?: number;
  maxCharges?: number;
  chargeRegenTicksRemaining?: number;
  chargeRegenProgress?: number;
  chargeRecoveryTicks?: number;
  chargeLockTicks?: number;
  chargeCastLockTicks?: number;
  isReady: boolean;
  isCommon: boolean;
  slotIndex?: number;
  target: 'SELF' | 'OPPONENT';
  friendlyTarget?: boolean;
  canTargetSelf?: boolean;
  faceDirection?: boolean;
  requiresGrounded?: boolean;
  requiresStanding?: boolean;
  minSelfHpExclusive?: number;
  minSelfHpPercentExclusive?: number;
  damageType?: '内功' | '外功';
  noWeaponRequired?: boolean;
  canCastWhileMounted?: boolean;
  qinggong?: boolean;
  qinggongGcdImmune?: boolean;
  cannotCastWhileRooted?: boolean;
  allowGroundCastWithoutTarget?: boolean;
  losBlocked?: boolean;
  blockedByAntiStealth?: boolean;
  disabledWarning?: string;
  isSpecialBarAbility?: boolean;
}

type AbilityHintState = {
  ability: AbilityInfo;
  anchorRect: DOMRect;
};

type AbilityDragSlotKind = 'draft' | 'item';

type AbilityDropTarget = {
  kind: AbilityDragSlotKind;
  index: number;
};

type PendingDraftReorder = {
  instanceId: string;
  toIndex: number;
};

type DraftPointerDragState = {
  instanceId: string;
  sourceKind: AbilityDragSlotKind;
  sourceIndex: number;
  ability: AbilityInfo;
  startX: number;
  startY: number;
  active: boolean;
};

type DraftDragGhostState = {
  ability: AbilityInfo;
  x: number;
  y: number;
};

function createEmptyItemBarSlots(): Array<AbilityInfo | undefined> {
  return Array.from({ length: ITEM_BAR_SLOT_COUNT });
}

type ConsumableItemId = typeof CONSUMABLE_ITEMS[number]['id'];
type ConsumableItem = typeof CONSUMABLE_ITEMS[number];
type ConsumableSlotId = ConsumableItemId | null;
type ConsumableBarSettings = {
  enabled: boolean;
  slotCount: number;
  slots: ConsumableSlotId[];
};

const CONSUMABLE_ITEM_BY_ID = new Map<ConsumableItemId, ConsumableItem>(
  CONSUMABLE_ITEMS.map((item) => [item.id, item] as [ConsumableItemId, ConsumableItem]),
);
const DEFAULT_CONSUMABLE_SLOT_IDS = CONSUMABLE_ITEMS.map((item) => item.id) as ConsumableItemId[];

function normalizeConsumableSlotCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CONSUMABLE_BAR_DEFAULT_SLOTS;
  return Math.max(CONSUMABLE_BAR_MIN_SLOTS, Math.min(CONSUMABLE_BAR_MAX_SLOTS, Math.round(numeric)));
}

function normalizeConsumableSlots(value: unknown): ConsumableSlotId[] {
  const validIds = new Set<ConsumableItemId>(DEFAULT_CONSUMABLE_SLOT_IDS);
  const rawSlots = Array.isArray(value) ? value : DEFAULT_CONSUMABLE_SLOT_IDS;
  const seen = new Set<ConsumableItemId>();
  const slots: ConsumableSlotId[] = [];

  for (const rawId of rawSlots) {
    if (rawId === null) {
      slots.push(null);
      continue;
    }
    if (typeof rawId !== 'string' || !validIds.has(rawId as ConsumableItemId) || seen.has(rawId as ConsumableItemId)) {
      continue;
    }
    const id = rawId as ConsumableItemId;
    seen.add(id);
    slots.push(id);
  }

  for (const id of DEFAULT_CONSUMABLE_SLOT_IDS) {
    if (!seen.has(id)) {
      slots.push(id);
      seen.add(id);
    }
  }

  while (slots.length < CONSUMABLE_BAR_MAX_SLOTS) slots.push(null);
  return slots.slice(0, CONSUMABLE_BAR_MAX_SLOTS);
}

function loadConsumableBarSettings(): ConsumableBarSettings {
  try {
    if (typeof window === 'undefined') {
      return {
        enabled: true,
        slotCount: CONSUMABLE_BAR_DEFAULT_SLOTS,
        slots: normalizeConsumableSlots(undefined),
      };
    }
    const stored = JSON.parse(localStorage.getItem(CONSUMABLE_BAR_STORAGE_KEY) ?? '{}');
    return {
      enabled: stored?.enabled !== false,
      slotCount: normalizeConsumableSlotCount(stored?.slotCount),
      slots: normalizeConsumableSlots(stored?.slots ?? stored?.order),
    };
  } catch {
    return {
      enabled: true,
      slotCount: CONSUMABLE_BAR_DEFAULT_SLOTS,
      slots: normalizeConsumableSlots(undefined),
    };
  }
}

function getConsumableCooldownRemainingMs(player: any, consumableId: ConsumableItemId, nowMs: number): number {
  const expiresAt = Number(player?.consumableCooldowns?.[consumableId]?.expiresAt ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return 0;
  return Math.max(0, expiresAt - nowMs);
}

function getConsumableRemainingCount(player: any, consumable: ConsumableItem): number {
  const fallback = Number(consumable.startingCount ?? 0);
  const remaining = Number(player?.consumableCounts?.[consumable.id] ?? fallback);
  if (!Number.isFinite(remaining)) return Math.max(0, fallback);
  return Math.max(0, Math.floor(remaining));
}

function formatHudCooldownText(seconds: number, options?: { roundUpSeconds?: boolean }): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds > 59) return `${Math.max(1, Math.ceil(seconds / 60))}m`;

  const roundedSeconds = options?.roundUpSeconds ? Math.ceil(seconds) : Math.floor(seconds);
  return `${Math.max(0, roundedSeconds)}`;
}

function formatConsumableCooldown(ms: number): string {
  return formatHudCooldownText(ms / 1000, { roundUpSeconds: true });
}

function normalizeDraftSlotIndex(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(DRAFT_ABILITY_SLOT_COUNT - 1, Math.round(numeric)));
}

function buildDraftAbilitySlots(abilities: AbilityInfo[]): Array<AbilityInfo | undefined> {
  const slots: Array<AbilityInfo | undefined> = Array.from({ length: DRAFT_ABILITY_SLOT_COUNT });
  const overflow: AbilityInfo[] = [];
  abilities.forEach((ability, fallbackIndex) => {
    const slotIndex = normalizeDraftSlotIndex(ability.slotIndex, fallbackIndex);
    if (!slots[slotIndex]) {
      slots[slotIndex] = ability;
    } else {
      overflow.push(ability);
    }
  });
  overflow.forEach((ability) => {
    const openIndex = slots.findIndex((slot) => !slot);
    if (openIndex >= 0) slots[openIndex] = ability;
  });
  return slots;
}

function predictDraftAbilityReorder(current: AbilityInfo[], instanceId: string, toIndex: number): AbilityInfo[] | null {
  const common = current.filter((ability) => ability.isCommon);
  const special = current.filter((ability) => !ability.isCommon && ability.isSpecialBarAbility);
  if (special.length > 0) return null;

  const drafts = current.filter((ability) => !ability.isCommon && !ability.isSpecialBarAbility);
  const fromIndex = drafts.findIndex((ability) => ability.id === instanceId);
  if (fromIndex < 0) return null;

  const clampedToIndex = normalizeDraftSlotIndex(toIndex, fromIndex);
  const moved = drafts[fromIndex];
  const fromSlotIndex = normalizeDraftSlotIndex(moved.slotIndex, fromIndex);
  const reorderedDrafts = drafts.map((ability, fallbackIndex) => ({
    ...ability,
    slotIndex: normalizeDraftSlotIndex(ability.slotIndex, fallbackIndex),
  }));
  const movedDraft = reorderedDrafts.find((ability) => ability.id === instanceId);
  const targetDraft = reorderedDrafts.find((ability) => ability.id !== instanceId && normalizeDraftSlotIndex(ability.slotIndex, 0) === clampedToIndex);
  if (movedDraft) {
    movedDraft.slotIndex = clampedToIndex;
  }
  if (targetDraft) {
    targetDraft.slotIndex = fromSlotIndex;
  }
  reorderedDrafts.sort((a, b) => normalizeDraftSlotIndex(a.slotIndex, 0) - normalizeDraftSlotIndex(b.slotIndex, 0));
  return [...common, ...reorderedDrafts];
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 10 || Number.isInteger(value)) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatTopMetricsTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function formatGameAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const wan = abs / 10000;
    const rounded = wan >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, '');
    return `${sign}${text}万`;
  }
  if (abs >= 10 || Number.isInteger(abs)) return `${sign}${Math.round(abs)}`;
  return `${sign}${abs.toFixed(2)}`;
}

function formatGameHealthRatio(current: number, max: number): string {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeCurrent = Math.max(0, Number(current) || 0);
  const pct = Math.max(0, Math.min(999, Math.round((safeCurrent / safeMax) * 100)));
  return `${formatGameAmount(safeCurrent)}/${formatGameAmount(safeMax)}（${pct}%）`;
}

function formatCompactSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  return formatCompactNumber(seconds);
}

function formatGcdBarSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00';
  return seconds.toFixed(2);
}

function formatTicksAsSeconds(ticks: number | undefined): string {
  const safeTicks = Math.max(0, Number(ticks ?? 0));
  return `${formatCompactSeconds(safeTicks / SERVER_TICK_RATE)}秒`;
}

function shouldShowVisualGcd(
  gcd: VisualGcdState | null | undefined,
  settings: GcdVisibilitySettings,
): gcd is VisualGcdState {
  if (!gcd || !settings.enabled) return false;
  if (gcd.kind === 'base') return settings.base;
  if (gcd.kind === 'qinggong') return settings.qinggong;
  return settings.houyao;
}

function buildVisibleVisualGcd(
  gcd: VisualGcdState | null | undefined,
  globalGcdTicks: number | undefined,
  settings: GcdVisibilitySettings,
): VisualGcdState | null {
  if (shouldShowVisualGcd(gcd, settings)) {
    return gcd;
  }

  const remainingBaseGcdTicks = Math.max(0, Number(globalGcdTicks ?? 0));
  if (!settings.enabled || !settings.base || remainingBaseGcdTicks <= 0) {
    return null;
  }

  const remainingBaseGcdMs = (remainingBaseGcdTicks / SERVER_TICK_RATE) * 1000;
  return {
    id: 'fallback-base-gcd',
    name: '基础调息时间',
    kind: 'base',
    startedAt: Date.now() - Math.max(0, BASE_GCD_MS - remainingBaseGcdMs),
    durationMs: BASE_GCD_MS,
  };
}

function getVisualGcdElapsedMs(gcd: VisualGcdState, nowMs: number): number {
  return Math.max(0, Math.min(gcd.durationMs, nowMs - gcd.startedAt));
}

function getVisualGcdProgressPct(gcd: VisualGcdState, nowMs: number): number {
  if (!Number.isFinite(gcd.startedAt) || !Number.isFinite(gcd.durationMs) || gcd.durationMs <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (getVisualGcdElapsedMs(gcd, nowMs) / gcd.durationMs) * 100));
}

function GcdVisualBar({ gcd }: { gcd?: VisualGcdState | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [displayGcd, setDisplayGcd] = useState<VisualGcdState | null>(gcd ?? null);

  useEffect(() => {
    if (!gcd) {
      return;
    }

    setDisplayGcd((current) => {
      if (!current) {
        return gcd;
      }

      const now = Date.now();
      const currentProgressPct = getVisualGcdProgressPct(current, now);
      const nextProgressPct = getVisualGcdProgressPct(gcd, now);
      const isSameTrack =
        current.kind === gcd.kind &&
        Math.abs(current.durationMs - gcd.durationMs) <= 50;
      const currentStillRunning = now - current.startedAt < current.durationMs - 40;

      if (isSameTrack && currentStillRunning && nextProgressPct + 0.5 < currentProgressPct) {
        return current;
      }

      return gcd;
    });
  }, [gcd?.id, gcd?.kind, gcd?.startedAt, gcd?.durationMs, gcd?.name]);

  useEffect(() => {
    if (!displayGcd) return;

    let frameId = 0;
    const tick = () => {
      setNowMs(Date.now());
      frameId = window.requestAnimationFrame(tick);
    };

    setNowMs(Date.now());
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [displayGcd?.id]);

  const activeGcd = displayGcd ?? gcd ?? null;
  const isValidGcd = Boolean(
    activeGcd && Number.isFinite(activeGcd.startedAt) && Number.isFinite(activeGcd.durationMs) && activeGcd.durationMs > 0,
  );

  if (!isValidGcd || !activeGcd) {
    return null;
  }

  const elapsedMs = Math.max(0, nowMs - activeGcd.startedAt);
  if (elapsedMs >= activeGcd.durationMs + 120) {
    return null;
  }

  const clampedElapsedMs = getVisualGcdElapsedMs(activeGcd, nowMs);
  const progressPct = getVisualGcdProgressPct(activeGcd, nowMs);
  const elapsedSeconds = clampedElapsedMs / 1000;
  const durationSeconds = activeGcd.durationMs / 1000;
  const kindClass = activeGcd.kind === 'qinggong'
    ? styles.gcdBarFillQinggong
    : activeGcd.kind === 'houyao'
      ? styles.gcdBarFillHouyao
      : styles.gcdBarFillBase;

  return (
    <div className={styles.gcdBarWrap} aria-label={activeGcd.name} data-gcd-bar-root="true">
      <div className={styles.gcdBarLabel}>
        {activeGcd.name} ({formatGcdBarSeconds(elapsedSeconds)}/{formatGcdBarSeconds(durationSeconds)})
      </div>
      <div className={styles.gcdBarTrack}>
        <div
          className={`${styles.gcdBarFill} ${kindClass}`}
          style={{ transform: `scaleX(${progressPct / 100})` }}
        />
      </div>
    </div>
  );
}

function formatAbilityRangeLabel(ability: AbilityInfo): string {
  if (typeof ability.range !== 'number') {
    return ability.target === 'SELF' ? '自身' : '-';
  }

  const range = ability.range;
  const baseRange = typeof ability.baseRange === 'number' ? ability.baseRange : range;
  const rangeDelta = range - baseRange;
  const maxRangeText = Math.abs(rangeDelta) >= 0.01
    ? `${formatCompactNumber(baseRange)}(${rangeDelta > 0 ? '+' : ''}${formatCompactNumber(rangeDelta)})`
    : formatCompactNumber(range);

  if (typeof ability.minRange === 'number' && ability.minRange > 0) {
    return `${formatCompactNumber(ability.minRange)}-${maxRangeText}尺`;
  }
  return `${maxRangeText}尺`;
}

function formatAbilityCastLabel(ability: AbilityInfo): string {
  const channel = ability.channel;
  if (!channel || channel.durationMs <= 0) return '瞬间释放';
  const seconds = formatCompactSeconds(channel.durationMs / 1000);
  return `${seconds}秒`;
}

function formatAbilityCooldownLabel(ability: AbilityInfo): string {
  const cooldownTicks = Number(ability.baseCooldownTicks ?? 0);
  if (cooldownTicks > 0) return formatTicksAsSeconds(cooldownTicks);
  const recoveryTicks = Number(ability.chargeRecoveryTicks ?? 0);
  if ((ability.maxCharges ?? 0) > 1 && recoveryTicks > 0) return formatTicksAsSeconds(recoveryTicks);
  return '0秒';
}

function AbilityHoverHint({ hint }: { hint: AbilityHintState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const gap = 8;
    const safe = 8;
    const maxLeft = window.innerWidth - rect.width - safe;
    const maxTop = window.innerHeight - rect.height - safe;

    const preferAbove = hint.anchorRect.top >= rect.height + gap + safe;
    const top = preferAbove
      ? hint.anchorRect.top - rect.height - gap
      : hint.anchorRect.bottom + gap;
    const left = hint.anchorRect.left;

    setPos({
      top: Math.max(safe, Math.min(maxTop, top)),
      left: Math.max(safe, Math.min(maxLeft, left)),
    });
  }, [hint]);

  const ability = hint.ability;
  const description = ability.description?.trim() || '无';

  return (
    <div
      ref={ref}
      className={styles.abilityHintPanel}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <div className={styles.abilityHintBody}>
        <div className={styles.abilityHintMain}>
          <div className={styles.abilityHintName}>{ability.name}</div>
          <div className={styles.abilityHintMeta}>距离：{formatAbilityRangeLabel(ability)}</div>
          <div className={styles.abilityHintMeta}>武器：{ability.noWeaponRequired ? '否' : '是'}</div>
          <div className={styles.abilityHintDesc}>{description}</div>
        </div>
        <div className={styles.abilityHintSide}>
          <div>{formatAbilityCastLabel(ability)}</div>
          <div>{formatAbilityCooldownLabel(ability)}</div>
        </div>
      </div>
    </div>
  );
}

function HeartStatHoverHint({ hint }: { hint: HeartStatHintState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const gap = 8;
    const safe = 8;
    const maxLeft = window.innerWidth - rect.width - safe;
    const maxTop = window.innerHeight - rect.height - safe;
    const top = Math.max(safe, Math.min(maxTop, hint.anchorRect.top));
    const preferredLeft = hint.anchorRect.right + gap;
    const fallbackLeft = hint.anchorRect.left - rect.width - gap;
    const left = preferredLeft <= maxLeft ? preferredLeft : fallbackLeft;

    setPos({
      top,
      left: Math.max(safe, Math.min(maxLeft, left)),
    });
  }, [hint]);

  return (
    <div
      ref={ref}
      className={styles.heartStatHint}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <div className={styles.heartStatHintTitle}>{hint.title}</div>
      {hint.lines.map((line, index) => (
        <div key={`${line}-${index}`} className={styles.heartStatHintLine}>{line}</div>
      ))}
    </div>
  );
}

type DummySpawnPreset = 'enemy' | 'ally' | 'ally100';

function getDummySpawnMeta(preset: DummySpawnPreset) {
  if (preset === 'enemy') {
    return { side: 'enemy' as const, label: '敌方木桩', successText: '已生成敌方木桩', maxHp: 1_260_000 };
  }
  if (preset === 'ally100') {
    return { side: 'ally' as const, label: '友方100血木桩', successText: '已生成友方100血木桩', maxHp: 100 };
  }
  return { side: 'ally' as const, label: '友方木桩', successText: '已生成友方木桩', maxHp: 1_260_000 };
}

function getArenaAbilityIconPath(name: string | undefined | null, iconPath?: string | null) {
  return encodeIconPublicPath(iconPath) ?? getAbilityIconPath(name) ?? '/icons/fallback.png';
}

function getConsumableIconPath(name: string | undefined | null) {
  return getAbilityIconPath(name) ?? '/icons/fallback.png';
}

type CameraDebugEntry = {
  id: number;
  ts: number;
  type: string;
  message: string;
  camera: { x: number; y: number; z: number };
  lookTarget: { x: number; y: number; z: number };
  pivot: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  zoom: number;
  desiredDistance: number;
  actualDistance: number;
  wallClamp: boolean;
  probeClamp: boolean;
  groundClamp: boolean;
  recenter: boolean;
  wallDebug?: {
    hitCount: number;
    sampleCount: number;
    hitMask: string;
    spanX: number;
    spanY: number;
    minDistance: number | null;
    maxDistance: number | null;
    rawDistance: number | null;
    retainedDistance: number | null;
    clearMs: number;
    pendingExpandDistance: number | null;
    pendingExpandMs: number;
  };
  probeDebug?: {
    hitCount: number;
    sampleCount: number;
    hitMask: string;
    minDistance: number | null;
    maxDistance: number | null;
    rawDistance: number | null;
    retainedDistance: number | null;
  };
};

/** Fixed display order for the common-ability bar. */
const COMMON_ABILITY_ORDER = [
  'menghu_xiasha',
  'fuyao_zhishang',
  'nieyun_zhuyue',
  'lingxiao_lansheng',
  'yaotai_zhenhe',
  'yingfeng_huilang',
  'houyao',
  'yuqi',
] as const;

interface BattleArenaProps {
  me: { userId: string; username?: string; position: Position; hp: number; maxHp?: number; attackDamage?: number; shield?: number; huajinPct?: number; hand: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel; targetSelection?: TargetSelection; inCombat?: boolean; combatLinks?: Record<string, { lastActionAt: number }>; consumableCooldowns?: Record<string, { expiresAt: number }>; consumableCounts?: Record<string, number>; globalGcdTicks?: number; visualGcd?: VisualGcdState | null };
  opponent: { userId: string; username?: string; position: Position; hp: number; maxHp?: number; attackDamage?: number; shield?: number; huajinPct?: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel; targetSelection?: TargetSelection; inCombat?: boolean; combatLinks?: Record<string, { lastActionAt: number }> };
  /** All other players (opponents) — supports 1v1 and N-player modes */
  opponents?: { userId: string; username?: string; position: Position; hp: number; maxHp?: number; attackDamage?: number; shield?: number; huajinPct?: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel; targetSelection?: TargetSelection; inCombat?: boolean; combatLinks?: Record<string, { lastActionAt: number }> }[];
  gameId: string;
  onCastAbility: (
    abilityInstanceId: string,
    targetUserId?: string,
    groundTarget?: { x: number; y: number; z?: number },
    entityTargetId?: string,
    movementIntent?: boolean,
  ) => Promise<void>;
  onCancelChannel?: () => Promise<void>;
  onUseConsumable?: (consumableId: ConsumableItemId) => Promise<void> | void;
  onTargetSelection?: (selection: TargetSelection | null) => Promise<void> | void;
  onCancelBuff?: (buffId: number, options?: { entityTargetId?: string }) => Promise<void>;
  externalGameWarning?: InGameWarningEvent | null;
  onLeaveGame?: () => Promise<void> | void;
  onMovementRecover?: () => void;
  distance: number;
  maxHp: number;
  abilities: Record<string, any>;
  opponentPositionBufferRef?: React.MutableRefObject<Map<string, Array<{ t: number; pos: Position }>>>;
  /** Full game events array from state — used to spawn per-event floating numbers */
  events?: any[];
  /** Pickup items (ability books) currently on the ground */
  pickups?: PickupItem[];
  /** Safe zone state for poison zone rendering */
  safeZone?: { centerX: number; centerY: number; currentHalf: number; dps: number; shrinking: boolean; shrinkProgress: number; nextChangeIn: number };
  /** Persistent ground damage zones */
  groundZones?: GroundZone[];
  /** HP-bearing targetable entities (e.g. 逐云寒蕊) */
  entities?: TargetEntity[];
  /** Game mode: 'arena' (100×100) or 'pubg' (2000×2000) */
  mode?: string;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export default function BattleArena({
  me,
  opponent,
  opponents,
  gameId,
  onCastAbility,
  onCancelChannel,
  onUseConsumable,
  onTargetSelection,
  onCancelBuff,
  externalGameWarning = null,
  onLeaveGame,
  onMovementRecover,
  distance,
  maxHp,
  abilities,
  opponentPositionBufferRef,
  events = [],
  pickups = [],
  safeZone,
  groundZones,
  entities,
  mode,
}: BattleArenaProps) {
  const mapData = useMemo(() => getMapForMode(mode), [mode]);
  const ARENA_WIDTH  = mode === 'arena' ? ARENA_WIDTH_SMALL  : mode === 'collision-test' ? mapData.width : PUBG_WIDTH;
  const ARENA_HEIGHT = mode === 'arena' ? ARENA_HEIGHT_SMALL : mode === 'collision-test' ? mapData.height : PUBG_HEIGHT;
  const playerRadius = mode === 'collision-test' ? COLLISION_TEST_PLAYER_RADIUS : DEFAULT_PLAYER_RADIUS;
  ensureResizeObserverSupport();

  const storedUnitScale = getStoredUnitScale(mode);
  const modePickups = useMemo(() => (mode === 'collision-test' ? [] : pickups), [mode, pickups]);
  const channelAbilityByBuffId = useMemo(() => {
    const next = new Map<number, any>();
    for (const ability of Object.values(abilities)) {
      const channel = getRuntimeAbilityChannel(ability);
      if (channel?.source === 'BUFF' && typeof channel.buffId === 'number') {
        next.set(channel.buffId, ability);
      }
    }
    return next;
  }, [abilities]);
  const mapObjectsRef = useRef(mapData.objects);
  const entitiesRef = useRef<TargetEntity[]>(entities ?? []);
  useEffect(() => {
    mapObjectsRef.current = mapData.objects;
  }, [mapData]);
  useEffect(() => {
    entitiesRef.current = entities ?? [];
  }, [entities]);
  // CODE FRESHNESS MARKER — if you see this in console, the new code IS running
  useEffect(() => { console.log('[BA-FRESH] BattleArena v2 loaded — activeDash support active'); }, []);
  // Prevent page scroll while the game is mounted (critical for touch devices)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const wrapRef        = useRef<HTMLDivElement>(null);
  const canvasSizeRef  = useRef({ w: 800, h: 500 });
  const [canvasSize, setCanvasSize] = useState<UiViewportSize>(() => ({
    w: canvasSizeRef.current.w,
    h: canvasSizeRef.current.h,
  }));
  const playerPanelRef = useRef<HTMLDivElement>(null);
  const heartDetailsRef = useRef<HTMLDivElement>(null);
  const targetIconBarRef = useRef<HTMLDivElement>(null);
  const targetTargetIconBarRef = useRef<HTMLDivElement>(null);
  const targetOwnedAbilityBarRef = useRef<HTMLDivElement>(null);
  const ownedAbilityBarRef = useRef<HTMLDivElement>(null);
  const itemBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateCanvasSize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextSize = {
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
        if (canvasSizeRef.current.w === nextSize.w && canvasSizeRef.current.h === nextSize.h) {
          return;
        }
        canvasSizeRef.current = nextSize;
        setCanvasSize((current) => (
          current.w === nextSize.w && current.h === nextSize.h ? current : nextSize
        ));
      }
    };

    updateCanvasSize();
    const ro = new ResizeObserver(updateCanvasSize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', updateCanvasSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  const opponentsList = useMemo(
    () => ((opponents && opponents.length > 0 ? opponents : [opponent]).filter(Boolean)),
    [opponents, opponent],
  );
  const selfHasHongMengTianJin = useMemo(
    () => hasHongMengTianJinClient(me?.buffs),
    [me?.buffs],
  );
  const worldVisibleOpponentsList = useMemo(
    () => (selfHasHongMengTianJin ? [] : opponentsList),
    [opponentsList, selfHasHongMengTianJin],
  );
  const visibleOpponentsList = useMemo(
    () => worldVisibleOpponentsList.filter((o) => !shouldHideOpponentByStealth(o?.buffs)),
    [worldVisibleOpponentsList],
  );
  const targetableOpponentsList = useMemo(
    () => worldVisibleOpponentsList.filter((o) => !blocksTargetingClient(o?.buffs)),
    [worldVisibleOpponentsList],
  );

  useEffect(() => installAbilityAudioUnlock(), []);

  const visibleEntities = useMemo(
    () => (selfHasHongMengTianJin ? [] : (entities ?? []).filter((entity) => entity.hp > 0)),
    [entities, selfHasHongMengTianJin],
  );
  const targetableEntityList = useMemo(
    () => visibleEntities.filter(
      (entity) => entity.ownerUserId !== me.userId && !blocksTargetingClient(entity.buffs)
    ),
    [visibleEntities, me.userId],
  );

  /* --- React state (UI only) --- */
  const [handAbilities,    setHandAbilities]    = useState<AbilityInfo[]>([]);
  const [activeAbilityHint, setActiveAbilityHint] = useState<AbilityHintState | null>(null);
  const abilityDragActiveRef = useRef(false);
  const [rtt,              setRtt]              = useState<number | null>(null);
  const [renderFps,        setRenderFps]        = useState<number | null>(null);
  const [systemTime,       setSystemTime]       = useState(() => new Date());
  const [wasdKeys,         setWasdKeys]         = useState({ w: false, a: false, s: false, d: false });
  const [controlMode,      setControlMode]      = useState<'joystick' | 'traditional'>('traditional');
  // Mobile detection: touch device without fine pointer (mouse) = phone/tablet
  const [isMobileDevice, setIsMobileDevice]    = useState(false);
  const [showCheatWindow,  setShowCheatWindow]  = useState(false);

  const openAbilityHint = useCallback((anchorRect: DOMRect, ability: AbilityInfo) => {
    if (abilityDragActiveRef.current) return;
    setActiveAbilityHint({ anchorRect, ability });
  }, []);

  const closeAbilityHint = useCallback(() => {
    setActiveAbilityHint(null);
  }, []);

  const [cheatRarityFilter, setCheatRarityFilter] = useState<string>(() => {
    try {
      return JSON.parse(localStorage.getItem('zhenchuan-cheat-filters') ?? '{}')?.rarity ?? 'all';
    } catch {
      return 'all';
    }
  });
  const [cheatSchoolFilter, setCheatSchoolFilter] = useState<string>(() => {
    try {
      return JSON.parse(localStorage.getItem('zhenchuan-cheat-filters') ?? '{}')?.school ?? 'all';
    } catch {
      return 'all';
    }
  });
  const [cheatSchoolOpen,   setCheatSchoolOpen]   = useState(false);
  const cheatSchoolRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem('zhenchuan-cheat-filters', JSON.stringify({
        rarity: cheatRarityFilter,
        school: cheatSchoolFilter,
      }));
    } catch {}
  }, [cheatRarityFilter, cheatSchoolFilter]);
  useEffect(() => {
    if (!cheatSchoolOpen) return;
    const h = (e: MouseEvent) => {
      if (cheatSchoolRef.current && !cheatSchoolRef.current.contains(e.target as Node)) setCheatSchoolOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [cheatSchoolOpen]);

  const [addingAbility,    setAddingAbility]    = useState<string | null>(null);
  const [runningCheatAction, setRunningCheatAction] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedSelf,     setSelectedSelf]     = useState(false);
  const [pendingGroundCastAbilityId, setPendingGroundCastAbilityId] = useState<string | null>(null);
  const [groundCastPreview, setGroundCastPreview] = useState<{ x: number; y: number; z?: number; isValid?: boolean } | null>(null);
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [showHeartDetailsPanel, setShowHeartDetailsPanel] = useState(false);
  const [showHeartStatSettings, setShowHeartStatSettings] = useState(false);
  const [showCombatPresetPanel, setShowCombatPresetPanel] = useState(false);
  const [heartStatHint, setHeartStatHint] = useState<HeartStatHintState | null>(null);
  const [heartStatVisibility, setHeartStatVisibility] = useState<Record<HeartStatKey, boolean>>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_HEART_STAT_VISIBILITY;
      const stored = JSON.parse(localStorage.getItem(HEART_STAT_STORAGE_KEY) ?? '{}');
      return { ...DEFAULT_HEART_STAT_VISIBILITY, ...stored };
    } catch {
      return DEFAULT_HEART_STAT_VISIBILITY;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HEART_STAT_STORAGE_KEY, JSON.stringify(heartStatVisibility));
    } catch {}
  }, [heartStatVisibility]);
  const [gcdVisibilitySettings, setGcdVisibilitySettings] = useState<GcdVisibilitySettings>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_GCD_VISIBILITY_SETTINGS;
      const stored = JSON.parse(localStorage.getItem(GCD_VISIBILITY_STORAGE_KEY) ?? '{}');
      return { ...DEFAULT_GCD_VISIBILITY_SETTINGS, ...stored };
    } catch {
      return DEFAULT_GCD_VISIBILITY_SETTINGS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(GCD_VISIBILITY_STORAGE_KEY, JSON.stringify(gcdVisibilitySettings));
    } catch {}
  }, [gcdVisibilitySettings]);
  const [abilitySoundSettings, setAbilitySoundSettings] = useState<AbilitySoundSettings>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_ABILITY_SOUND_SETTINGS;
      const stored = JSON.parse(localStorage.getItem(ABILITY_SOUND_SETTINGS_STORAGE_KEY) ?? '{}');
      const storedVersion = Number(stored.version ?? 0);
      const hasStoredVolume = stored.volumePercent !== undefined && Number.isFinite(Number(stored.volumePercent));
      const storedVolumePercent = hasStoredVolume
        ? normalizeAbilitySoundVolumePercent(stored.volumePercent)
        : DEFAULT_ABILITY_SOUND_SETTINGS.volumePercent;
      const previousAutoDefault = storedVersion === 2 && Number(stored.volumePercent) === 150 && stored.disabled !== true;
      return {
        ...DEFAULT_ABILITY_SOUND_SETTINGS,
        volumePercent: hasStoredVolume && !previousAutoDefault
          ? storedVolumePercent
          : DEFAULT_ABILITY_SOUND_SETTINGS.volumePercent,
        disabled: stored.disabled === true,
        version: DEFAULT_ABILITY_SOUND_SETTINGS.version,
      };
    } catch {
      return DEFAULT_ABILITY_SOUND_SETTINGS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(ABILITY_SOUND_SETTINGS_STORAGE_KEY, JSON.stringify(abilitySoundSettings));
    } catch {}
  }, [abilitySoundSettings]);
  const [abilityPanelScale, setAbilityPanelScale] = useState(() => {
    try {
      if (typeof window === 'undefined') return 1;
      return normalizeAbilityPanelScale(localStorage.getItem(ABILITY_PANEL_SCALE_STORAGE_KEY));
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(ABILITY_PANEL_SCALE_STORAGE_KEY, abilityPanelScale.toFixed(2));
    } catch {}
  }, [abilityPanelScale]);
  const [inGameWarningScale, setInGameWarningScale] = useState(() => {
    try {
      if (typeof window === 'undefined') return 1;
      return normalizeInGameWarningScale(localStorage.getItem(IN_GAME_WARNING_SCALE_STORAGE_KEY));
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(IN_GAME_WARNING_SCALE_STORAGE_KEY, inGameWarningScale.toFixed(2));
    } catch {}
  }, [inGameWarningScale]);
  const [activeInGameWarning, setActiveInGameWarning] = useState<InGameWarningEvent | null>(null);
  const inGameWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inGameWarningSeqRef = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setSystemTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let frameId = 0;
    let frameCount = 0;
    let lastSampleAt = performance.now();
    const tick = () => {
      frameCount += 1;
      const now = performance.now();
      const elapsed = now - lastSampleAt;
      if (elapsed >= 500) {
        setRenderFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        lastSampleAt = now;
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    setShowHeartStatSettings(false);
    if (!showHeartDetailsPanel) {
      setHeartStatHint(null);
    }
  }, [showHeartDetailsPanel]);
  const [pendingDummySpawn, setPendingDummySpawn] = useState<DummySpawnPreset | null>(null);
  const [dummySpawnPreview, setDummySpawnPreview] = useState<{ x: number; y: number; z?: number } | null>(null);
  const pendingDummySpawnRef = useRef<DummySpawnPreset | null>(null);
  const [autoForward, setAutoForward] = useState(false);
  const [draggingDraftInstanceId, setDraggingDraftInstanceId] = useState<string | null>(null);
  const [dragHoverIndex, setDragHoverIndex] = useState<number | null>(null);
  const [dragHoverItemIndex, setDragHoverItemIndex] = useState<number | null>(null);
  const [discardZoneHover, setDiscardZoneHover] = useState(false);
  const [itemBarAbilities, setItemBarAbilities] = useState<Array<AbilityInfo | undefined>>(() => createEmptyItemBarSlots());
  const itemBarAbilitiesRef = useRef<Array<AbilityInfo | undefined>>(createEmptyItemBarSlots());
  const [consumableBarSettings, setConsumableBarSettings] = useState<ConsumableBarSettings>(() => loadConsumableBarSettings());
  const [draggingConsumableIndex, setDraggingConsumableIndex] = useState<number | null>(null);
  const [dragHoverConsumableIndex, setDragHoverConsumableIndex] = useState<number | null>(null);
  const consumableDragIndexRef = useRef<number | null>(null);
  const [draftSlotOverrides, setDraftSlotOverrides] = useState<Record<string, number>>({});
  const draftSlotOverridesRef = useRef<Record<string, number>>({});
  const pendingDraftReorderRef = useRef<PendingDraftReorder | null>(null);
  const pendingDraftDragRef = useRef<DraftPointerDragState | null>(null);
  const [draftDragGhost, setDraftDragGhost] = useState<DraftDragGhostState | null>(null);
  const [pressedAbilityInput, setPressedAbilityInput] = useState<string | null>(null);
  const [, ] = useState(0); // placeholder (was setChannelTick)

  useEffect(() => {
    try {
      localStorage.setItem(CONSUMABLE_BAR_STORAGE_KEY, JSON.stringify(consumableBarSettings));
    } catch {}
  }, [consumableBarSettings]);

  /* --- Pickup interaction state --- */
  const [nearbyPickupIds,   setNearbyPickupIds]   = useState<string[]>([]);         // sorted closest-first
  const [channelPickupId,   setChannelPickupId]   = useState<string | null>(null); // book being channeled
  const [channelProgress,   setChannelProgress]   = useState(0);                  // 0-1
  const [pickupModals,      setPickupModals]      = useState<Array<{ pickupId: string; abilityId: string; name: string; description: string }>>([]);
  const channelTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelStartRef     = useRef<number>(0);
  const channelAnimRef      = useRef<number>(0);
  const pickupsRef          = useRef<PickupItem[]>([]);
  const nearbyPickupIdsRef  = useRef<string[]>([]);  // synced from state; used in callbacks
  const pickupModalsRef     = useRef<Array<{ pickupId: string; abilityId: string; name: string; description: string }>>([]);
  const channelPickupIdRef  = useRef<string | null>(null);
  const [minimizedModals,   setMinimizedModals]   = useState<Set<string>>(new Set());

  /* --- Draggable UI positions (persisted to user profile) --- */
  const [uiPositions, setUiPositions] = useState<Record<string, UiPosition>>({});
  const uiPositionsRef = useRef<Record<string, UiPosition>>({});
  const storedUiViewportRef = useRef<UiViewportSize | null>(null);
  const lastCanvasSizeRef = useRef<UiViewportSize | null>(null);
  const [customUiMode, setCustomUiMode] = useState(false);
  const customUiSnapshotRef = useRef<Record<string, UiPosition> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadUiPositions = async () => {
      try {
        const res = await fetch('/api/game/ui-layout', {
          credentials: 'include',
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error('[BattleArena] load ui layout failed:', res.status, text);
          return;
        }

        const payload = normalizeUiPositionStoragePayload(await res.json());
        if (cancelled) {
          return;
        }

        const currentViewport = {
          w: Math.round(canvasSizeRef.current.w),
          h: Math.round(canvasSizeRef.current.h),
        };
        const targetViewport = currentViewport.w > 0 && currentViewport.h > 0
          ? currentViewport
          : payload.viewport;
        const positions = payload.viewport && targetViewport && !areUiViewportSizesEqual(payload.viewport, targetViewport)
          ? scaleUiPositions(payload.positions, payload.viewport, targetViewport)
          : payload.positions;

        uiPositionsRef.current = positions;
        setUiPositions(positions);
        storedUiViewportRef.current = targetViewport;
        if (targetViewport) {
          lastCanvasSizeRef.current = targetViewport;
        }
      } catch (err) {
        console.error('[BattleArena] load ui layout failed:', err);
      }
    };

    void loadUiPositions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextViewport = {
      w: Math.round(canvasSize.w),
      h: Math.round(canvasSize.h),
    };
    if (nextViewport.w <= 0 || nextViewport.h <= 0) {
      return;
    }

    const sourceViewport = lastCanvasSizeRef.current ?? storedUiViewportRef.current;
    lastCanvasSizeRef.current = nextViewport;

    if (!sourceViewport || areUiViewportSizesEqual(sourceViewport, nextViewport)) {
      return;
    }

    if (Object.keys(uiPositionsRef.current).length === 0) {
      return;
    }

    const scaledPositions = scaleUiPositions(uiPositionsRef.current, sourceViewport, nextViewport);
    uiPositionsRef.current = scaledPositions;
    setUiPositions(scaledPositions);

    if (customUiSnapshotRef.current) {
      customUiSnapshotRef.current = scaleUiPositions(customUiSnapshotRef.current, sourceViewport, nextViewport);
    }
  }, [canvasSize.h, canvasSize.w]);

  /* --- Debug position overlay --- */
  const [showDebugGrid, setShowDebugGrid] = useState(false);
  const [showCollisionShells, setShowCollisionShells] = useState(false);
  const [showUniqueDashRoute, setShowUniqueDashRoute] = useState(false);
  const [blueprintMode, setBlueprintMode] = useState(false);
  const hongMengOverlayActive = selfHasHongMengTianJin && !blueprintMode;
  const [sceneCanvasKey, setSceneCanvasKey] = useState(0);
  const [sceneRecovering, setSceneRecovering] = useState(false);
  const sceneRecoveryTimerRef = useRef<number | null>(null);
  const mainCanvasCleanupRef = useRef<(() => void) | null>(null);
  const [showLoadPerformancePanel, setShowLoadPerformancePanel] = useState(false);
  const [loadPerformanceSnapshot, setLoadPerformanceSnapshot] = useState<LoadPerformanceSnapshot | null>(null);
  const sceneRuntimeMetricsRef = useRef<SceneRuntimeMetrics | null>(null);
  const loadPerformanceStartedAtRef = useRef(performance.now());
  const loadPerformanceWallStartedAtRef = useRef(Date.now());
  const loadPerformanceStagesRef = useRef<Map<string, LoadPerformanceStageState>>(new Map());
  const loadPerformanceStageOrderRef = useRef(0);
  const [showTestingPanel, setShowTestingPanel] = useState(false);
  const [showSceneTestingPanel, setShowSceneTestingPanel] = useState(false);
  const [showCameraEventTestingPanel, setShowCameraEventTestingPanel] = useState(false);
  const [escPanelPage, setEscPanelPage] = useState<'main' | 'game-settings' | 'sound-settings' | 'hotkey-settings'>('main');
  const [escMainTab, setEscMainTab] = useState<'normal' | 'test'>('normal');
  const [escTestPage, setEscTestPage] = useState<'switches' | 'lighting'>('switches');
  const [customUiPromptPos, setCustomUiPromptPos] = useState<UiPosition | null>(null);
  const lightingControlsOpen = showTestingPanel && escMainTab === 'test' && escTestPage === 'lighting';

  useEffect(() => () => {
    if (sceneRecoveryTimerRef.current !== null) {
      window.clearTimeout(sceneRecoveryTimerRef.current);
    }
    if (inGameWarningTimerRef.current !== null) {
      window.clearTimeout(inGameWarningTimerRef.current);
    }
    mainCanvasCleanupRef.current?.();
    mainCanvasCleanupRef.current = null;
  }, []);

  const recordLoadStageStart = useCallback((id: string, name: string, at = performance.now(), detail = '') => {
    const stages = loadPerformanceStagesRef.current;
    const existing = stages.get(id);
    if (existing && existing.completedAtMs !== null) return;
    stages.set(id, {
      id,
      name,
      status: '进行中',
      startedAtMs: existing?.startedAtMs ?? at,
      completedAtMs: null,
      detail: detail || existing?.detail || '',
      meta: existing?.meta,
      order: existing?.order ?? loadPerformanceStageOrderRef.current++,
    });
  }, []);

  const recordLoadStageEnd = useCallback((
    id: string,
    name: string,
    at = performance.now(),
    detail = '',
    meta?: Record<string, number | string>,
    status: LoadStageStatus = '完成',
  ) => {
    const stages = loadPerformanceStagesRef.current;
    const existing = stages.get(id);
    stages.set(id, {
      id,
      name: existing?.name ?? name,
      status,
      startedAtMs: existing?.startedAtMs ?? loadPerformanceStartedAtRef.current,
      completedAtMs: at,
      detail: detail || existing?.detail || '',
      meta: meta ?? existing?.meta,
      order: existing?.order ?? loadPerformanceStageOrderRef.current++,
    });
  }, []);

  const handleSceneLoadTiming = useCallback((event: SceneLoadTimingEvent) => {
    if (event.type === 'stage-start') {
      recordLoadStageStart(event.id, event.name, event.at, event.detail ?? '');
      return;
    }
    if (event.type === 'stage-end') {
      const existing = loadPerformanceStagesRef.current.get(event.id);
      recordLoadStageEnd(event.id, existing?.name ?? event.id, event.at, event.detail ?? '', event.meta);
      return;
    }
    const existing = loadPerformanceStagesRef.current.get(event.id);
    recordLoadStageEnd(event.id, existing?.name ?? event.id, event.at, event.detail ?? '', undefined, '失败');
  }, [recordLoadStageEnd, recordLoadStageStart]);

  const handleSceneMetrics = useCallback((metrics: SceneRuntimeMetrics) => {
    sceneRuntimeMetricsRef.current = metrics;
    const alreadyCompleted = loadPerformanceStagesRef.current.get('three-scene-mounted')?.completedAtMs != null;
    if (!alreadyCompleted) {
      recordLoadStageEnd(
        'three-scene-mounted',
        'Three场景首帧',
        performance.now(),
        `${metrics.objects} objects, ${metrics.calls} draw calls`,
        { objects: metrics.objects, meshes: metrics.meshes, drawCalls: metrics.calls },
      );
    }
  }, [recordLoadStageEnd]);

  const copyLoadPerformanceReport = useCallback(async () => {
    const report = loadPerformanceSnapshot?.reportText;
    if (!report) {
      toastError('没有可复制的加载报告');
      return;
    }
    try {
      await navigator.clipboard.writeText(report);
      toastSuccess('已复制加载报告');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = report;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) toastSuccess('已复制加载报告');
      else toastError('复制加载报告失败');
    }
  }, [loadPerformanceSnapshot?.reportText]);

  useEffect(() => {
    if (!loadPerformanceSnapshot?.reportText) return;
    (window as any).__zhenchuanLoadReport = loadPerformanceSnapshot.reportText;
    (window as any).__zhenchuanLoadSnapshot = loadPerformanceSnapshot;
  }, [loadPerformanceSnapshot]);

  const handleMainCanvasCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    mainCanvasCleanupRef.current?.();
    const canvas = gl.domElement;
    const clearRecoveryTimer = () => {
      if (sceneRecoveryTimerRef.current !== null) {
        window.clearTimeout(sceneRecoveryTimerRef.current);
        sceneRecoveryTimerRef.current = null;
      }
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      clearRecoveryTimer();
      setSceneRecovering(true);
    };
    const onContextRestored = () => {
      clearRecoveryTimer();
      setSceneRecovering(true);
      sceneRecoveryTimerRef.current = window.setTimeout(() => {
        setSceneCanvasKey((value) => value + 1);
        setSceneRecovering(false);
        sceneRecoveryTimerRef.current = null;
      }, 500);
    };
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    recordLoadStageEnd(
      'main-canvas-created',
      '主场景Canvas创建',
      performance.now(),
      `${Math.round(canvasSizeRef.current.w)}x${Math.round(canvasSizeRef.current.h)}`,
    );
    mainCanvasCleanupRef.current = () => {
      clearRecoveryTimer();
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
    };
  }, []);

  const [showMeasurePanel, setShowMeasurePanel] = useState(false);
  const [showJumpDetailsPanel, setShowJumpDetailsPanel] = useState(false);
  const [showGroundDistanceDetail, setShowGroundDistanceDetail] = useState(false);
  const [envDebugInfo, setEnvDebugInfo] = useState<EnvDebugInfo | null>(null);
  const [envToggles, setEnvToggles] = useState<EnvToggles>({
    toneMapping: true, exposure: true, shadows: true,
    dirLight: true, ambLight: true, hemiLight: true,
    fog: true, skyDome: true, cameraFar: true,
  });
  const [dirLightConfig, setDirLightConfig] = useState<DirLightConfig>({
    intensity: 0.25,
    colorMode: 'export',
    customColor: '#fdf2ed',
  });
  const sceneCanvasDpr = useMemo<[number, number]>(() => isMobileDevice ? [0.75, 1] : [1, 1.5], [isMobileDevice]);
  const sceneCanvasGl = useMemo(() => ({
    antialias: !isMobileDevice,
    powerPreference: 'high-performance' as const,
    stencil: false,
    depth: true,
  }), [isMobileDevice]);
  const overlayCanvasGl = useMemo(() => ({
    antialias: !isMobileDevice,
    alpha: true,
    powerPreference: 'high-performance' as const,
    stencil: false,
    depth: true,
  }), [isMobileDevice]);
  const [cameraZoomLevel, setCameraZoomLevel] = useState(DEFAULT_CAMERA_ZOOM);
  const [allowOverrangeCameraZoom, setAllowOverrangeCameraZoom] = useState(false);
  const [cameraDebugEntries, setCameraDebugEntries] = useState<CameraDebugEntry[]>([]);
  const cameraDebugIdRef = useRef(0);
  const cameraEventTestingEnabledRef = useRef(false);
  const visibleVisualGcd = buildVisibleVisualGcd(
    me?.visualGcd ?? null,
    me?.globalGcdTicks,
    gcdVisibilitySettings,
  );
  const showInGameWarning = useCallback((text: string) => {
    const nextText = text.trim();
    if (!nextText) return;
    const nextId = inGameWarningSeqRef.current + 1;
    inGameWarningSeqRef.current = nextId;
    setActiveInGameWarning({ id: nextId, text: nextText });
    if (inGameWarningTimerRef.current !== null) {
      window.clearTimeout(inGameWarningTimerRef.current);
    }
    inGameWarningTimerRef.current = window.setTimeout(() => {
      setActiveInGameWarning((current) => (current?.id === nextId ? null : current));
      inGameWarningTimerRef.current = null;
    }, IN_GAME_WARNING_DURATION_MS);
  }, []);
  useEffect(() => {
    if (!externalGameWarning?.text) return;
    showInGameWarning(externalGameWarning.text);
  }, [externalGameWarning?.id, externalGameWarning?.text, showInGameWarning]);
  const showAbilityDisabledWarning = useCallback((ability: AbilityInfo) => {
    if (ability.blockedByAntiStealth) {
      showInGameWarning('反隐期间无法施展隐身招式');
      return;
    }
    if (ability.losBlocked) {
      showInGameWarning('视线被遮挡');
      return;
    }
    if (ability.disabledWarning) {
      showInGameWarning(ability.disabledWarning);
    }
  }, [showInGameWarning]);
  const clearCameraDebugEntries = useCallback(() => {
    cameraDebugIdRef.current = 0;
    setCameraDebugEntries(prev => (prev.length === 0 ? prev : []));
  }, []);
  const appendCameraDebugEntry = useCallback((entry: Omit<CameraDebugEntry, 'id' | 'ts'>) => {
    if (!cameraEventTestingEnabledRef.current) return;
    setCameraDebugEntries(prev => {
      const nextId = cameraDebugIdRef.current + 1;
      cameraDebugIdRef.current = nextId;
      const next = [...prev, { ...entry, id: nextId, ts: Date.now() }];
      return next.slice(-180);
    });
  }, []);
  useEffect(() => {
    cameraEventTestingEnabledRef.current = showCameraEventTestingPanel;
    if (!showCameraEventTestingPanel) {
      clearCameraDebugEntries();
    }
  }, [clearCameraDebugEntries, showCameraEventTestingPanel]);
  const formatCameraDebugEntry = useCallback((entry: CameraDebugEntry) => {
    const time = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
    const millis = String(entry.ts % 1000).padStart(3, '0');
    const flags = [
      entry.wallClamp ? 'wall' : null,
      entry.probeClamp ? 'probe' : null,
      entry.groundClamp ? 'ground' : null,
      entry.recenter ? 'recenter' : null,
    ].filter(Boolean).join('/');
    const wallLine = entry.wallDebug
      ? `wall hits=${entry.wallDebug.hitCount}/${entry.wallDebug.sampleCount} mask=${entry.wallDebug.hitMask || '-'} ` +
        `span=${entry.wallDebug.spanX.toFixed(2)}x${entry.wallDebug.spanY.toFixed(2)} ` +
        `range=${entry.wallDebug.minDistance === null ? '-' : `${entry.wallDebug.minDistance.toFixed(2)}..${entry.wallDebug.maxDistance?.toFixed(2) ?? entry.wallDebug.minDistance.toFixed(2)}`} ` +
        `raw=${entry.wallDebug.rawDistance === null ? '-' : entry.wallDebug.rawDistance.toFixed(2)} ` +
        `keep=${entry.wallDebug.retainedDistance === null ? '-' : entry.wallDebug.retainedDistance.toFixed(2)} ` +
        `clear=${entry.wallDebug.clearMs}ms ` +
        `pending=${entry.wallDebug.pendingExpandDistance === null ? '-' : `${entry.wallDebug.pendingExpandDistance.toFixed(2)}@${entry.wallDebug.pendingExpandMs}ms`}`
      : null;
    const probeLine = entry.probeDebug
      ? `probe hits=${entry.probeDebug.hitCount}/${entry.probeDebug.sampleCount} mask=${entry.probeDebug.hitMask || '-'} ` +
        `range=${entry.probeDebug.minDistance === null ? '-' : `${entry.probeDebug.minDistance.toFixed(2)}..${entry.probeDebug.maxDistance?.toFixed(2) ?? entry.probeDebug.minDistance.toFixed(2)}`} ` +
        `raw=${entry.probeDebug.rawDistance === null ? '-' : entry.probeDebug.rawDistance.toFixed(2)} ` +
        `keep=${entry.probeDebug.retainedDistance === null ? '-' : entry.probeDebug.retainedDistance.toFixed(2)}`
      : null;

    return [
      `[${time}.${millis}] ${entry.type} ${entry.message}`,
      `cam(${entry.camera.x.toFixed(2)}, ${entry.camera.y.toFixed(2)}, ${entry.camera.z.toFixed(2)}) ` +
        `look(${entry.lookTarget.x.toFixed(2)}, ${entry.lookTarget.y.toFixed(2)}, ${entry.lookTarget.z.toFixed(2)}) ` +
        `pivot(${entry.pivot.x.toFixed(2)}, ${entry.pivot.y.toFixed(2)}, ${entry.pivot.z.toFixed(2)})`,
      `yaw=${entry.yaw.toFixed(2)} pitch=${entry.pitch.toFixed(2)} zoom=${entry.zoom.toFixed(2)} ` +
        `dist=${entry.actualDistance.toFixed(2)}/${entry.desiredDistance.toFixed(2)}${flags ? ` flags=${flags}` : ''}`,
      wallLine,
      probeLine,
    ].filter(Boolean).join('\n');
  }, []);
  const copyCameraDebugEntries = useCallback(async () => {
    if (cameraDebugEntries.length === 0) {
      toastError('没有可复制的镜头日志');
      return;
    }

    try {
      await navigator.clipboard.writeText(cameraDebugEntries.map(formatCameraDebugEntry).join('\n\n'));
      toastSuccess(`已复制 ${cameraDebugEntries.length} 条镜头日志`);
    } catch {
      toastError('复制镜头日志失败');
    }
  }, [cameraDebugEntries, formatCameraDebugEntry]);
  const collisionSysRef = useRef<MapCollisionSystem | null>(null);
  const collisionReadyRef = useRef(mode !== 'collision-test');
  const [collisionReady, setCollisionReady] = useState(mode !== 'collision-test');
  const collisionDebugRef = useRef<CollisionDebugState>({
    enabled: false,
    center: { x: 0, y: 0, z: 0 },
    supportY: null,
  });
  useEffect(() => {
    collisionSysRef.current = null;
    collisionReadyRef.current = mode !== 'collision-test';
    setCollisionReady(mode !== 'collision-test');
    collisionDebugRef.current = {
      enabled: false,
      center: { x: 0, y: 0, z: 0 },
      supportY: null,
    };
  }, [mode]);
  const onCollisionSystemReady = useCallback((sys: MapCollisionSystem) => {
    collisionSysRef.current = sys;
    const pos = localPositionRef.current ?? { x: mapData.width / 2, y: mapData.height / 2 };
    const halfW = mapData.width / 2;
    const halfH = mapData.height / 2;
    const tmpCenter = new THREE.Vector3(
      (pos.x - halfW - GROUP_POS_X) / RENDER_SF,
      5000,
      (halfH - pos.y - GROUP_POS_Z) / RENDER_SF,
    );
    const groundY = getBvhGroundSupportY(sys, tmpCenter);
    collisionDebugRef.current = {
      enabled: true,
      center: { x: tmpCenter.x, y: tmpCenter.y, z: tmpCenter.z },
      supportY: groundY,
    };
    if (groundY !== null) {
      const feetGameZ = groundY * RENDER_SF + GROUP_POS_Y;
      localZRef.current = feetGameZ;
      localVzRef.current = 0;
      groundBaseRef.current = feetGameZ;
      localRenderPosRef.current = { x: pos.x, y: pos.y, z: feetGameZ };
      console.log('[BVH] Initial ground at export Y', groundY.toFixed(1), '→ game Z', feetGameZ.toFixed(3));
    } else {
      console.warn('[BVH] No ground found at spawn, using Z=0');
    }
    bvhCenterYInitRef.current = false; // force sphere center resync on first tick
    collisionReadyRef.current = true;
    setCollisionReady(true);
    recordLoadStageEnd('collision-ready', '碰撞系统可用', performance.now(), 'collision ready');
    console.log('[BVH] Collision system ready');
  }, [mapData.height, mapData.width, recordLoadStageEnd]);

  useEffect(() => {
    const collect = () => {
      const now = performance.now();
      const startedAt = loadPerformanceStartedAtRef.current;
      const metrics = sceneRuntimeMetricsRef.current;

      recordLoadStageStart('main-canvas-created', '主场景Canvas创建', startedAt, '等待 Canvas');
      recordLoadStageStart('three-scene-mounted', 'Three场景首帧', startedAt, '等待 renderer');
      if (mode === 'collision-test') {
        recordLoadStageStart('collision-ready', '碰撞系统可用', startedAt, collisionReady ? 'collision ready' : '等待 collision ready');
      }
      if (sceneRecovering) {
        recordLoadStageStart('webgl-recovery', 'WebGL恢复', now, 'context恢复中');
      } else {
        const recovery = loadPerformanceStagesRef.current.get('webgl-recovery');
        if (recovery && recovery.completedAtMs === null) {
          recordLoadStageEnd('webgl-recovery', 'WebGL恢复', now, '恢复完成');
        }
      }

      const stageStates = Array.from(loadPerformanceStagesRef.current.values())
        .sort((a, b) => a.order - b.order);
      const stages: LoadPerformanceStage[] = stageStates.map((stage) => ({
        id: stage.id,
        name: stage.name,
        status: stage.status,
        startedAtMs: Math.max(0, stage.startedAtMs - startedAt),
        completedAtMs: stage.completedAtMs === null ? null : Math.max(0, stage.completedAtMs - startedAt),
        durationMs: Math.max(0, (stage.completedAtMs ?? now) - stage.startedAtMs),
        detail: stage.detail,
        meta: stage.meta,
      }));
      const requiredStageIds = mode === 'collision-test'
        ? ['main-canvas-created', 'three-scene-mounted', 'exported-map-total', 'collision-ready']
        : ['main-canvas-created', 'three-scene-mounted'];
      const completed = requiredStageIds.every((id) => {
        const stage = loadPerformanceStagesRef.current.get(id);
        return stage?.status === '完成' && stage.completedAtMs !== null;
      });
      const totalEnd = completed
        ? Math.max(...requiredStageIds.map((id) => loadPerformanceStagesRef.current.get(id)?.completedAtMs ?? startedAt))
        : now;
      const { resourceGroups, slowestResources } = collectSceneResourceTimings(startedAt);
      const snapshotBase: Omit<LoadPerformanceSnapshot, 'reportText'> = {
        ts: Date.now(),
        startedAtIso: new Date(loadPerformanceWallStartedAtRef.current).toISOString(),
        totalMs: Math.max(0, totalEnd - startedAt),
        completed,
        stages,
        inProgressStages: stages.filter((stage) => stage.status === '进行中'),
        resourceGroups,
        slowestResources,
        sceneMetrics: metrics,
        gameCounts: {
          opponents: worldVisibleOpponentsList.length,
          visibleOpponents: visibleOpponentsList.length,
          entities: entities?.length ?? 0,
          visibleEntities: visibleEntities.length,
          groundZones: groundZones?.length ?? 0,
          pickups: modePickups.length,
          events: events.length,
          selfBuffs: me.buffs?.length ?? 0,
          abilities: Object.keys(abilities).length,
        },
      };

      setLoadPerformanceSnapshot({
        ...snapshotBase,
        reportText: buildSceneLoadReport(snapshotBase),
      });
    };

    collect();
    const id = window.setInterval(collect, 500);
    return () => window.clearInterval(id);
  }, [
    abilities,
    collisionReady,
    entities?.length,
    events.length,
    groundZones?.length,
    me.buffs?.length,
    mode,
    modePickups.length,
    recordLoadStageEnd,
    recordLoadStageStart,
    sceneRecovering,
    visibleEntities.length,
    visibleOpponentsList.length,
    worldVisibleOpponentsList.length,
  ]);

  const isClientLineBlocked = useCallback((
    from: { x: number; y: number },
    to: { x: number; y: number },
    casterZ: number,
    targetZ: number,
    ignoreEntityId?: string,
  ) => {
    const blockedByMap = mode === 'collision-test' && collisionSysRef.current
      ? clientCheckLOS(
          collisionSysRef.current,
          from.x,
          from.y,
          casterZ,
          to.x,
          to.y,
          targetZ,
          ARENA_WIDTH / 2,
          ARENA_HEIGHT / 2,
        )
      : mode !== 'collision-test'
        ? !!isLOSBlockedClient(from.x, from.y, to.x, to.y, mapObjectsRef.current, 0, casterZ, targetZ)
        : false;
    if (blockedByMap) return true;
    return isLineBlockedByEnemyChuHeHanJieWallClient(
      entitiesRef.current,
      me.userId,
      from,
      to,
      casterZ,
      targetZ,
      ignoreEntityId,
    );
  }, [ARENA_HEIGHT, ARENA_WIDTH, me.userId, mode]);
  const [debugCursor,   setDebugCursor]   = useState<{ x: number; y: number } | null>(null);
  const [debugBounds,   setDebugBounds]   = useState<{
    me:  { cx: number; topY: number; hpBarY: number } | null;
    opp: { cx: number; topY: number } | null;
    cw: number; ch: number;
  }>({ me: null, opp: null, cw: 800, ch: 500 });

  /* --- Height-above-ground display + jump timing --- */
  const [myZ, setMyZ] = useState(0);
  const myZRef = useRef(0);
  // Jump timing records (seconds, null = not yet measured)
  type JumpRecord = {
    riseMs: number | null;
    fallMs: number | null;
    totalMs: number | null;
    peakUnits: number | null;
    startSpeedUnitsPerSec: number | null;
    expectedLandUnits: number | null;
    actualLandUnits: number | null;
    jumpPhase: number | null;
    mode: 'directional' | 'upward' | null;
  };
  type JumpTelemetry = {
    startMs: number;
    peakMs: number;
    takeoffGround: number;
    peakHeightWorld: number;
    takeoffPos: { x: number; y: number };
    expectedLandWorld: number;
    startSpeedUnitsPerSec: number;
    jumpPhase: number;
    mode: 'directional' | 'upward';
  };
  const [jumpRecord, setJumpRecord] = useState<JumpRecord>({
    riseMs: null,
    fallMs: null,
    totalMs: null,
    peakUnits: null,
    startSpeedUnitsPerSec: null,
    expectedLandUnits: null,
    actualLandUnits: null,
    jumpPhase: null,
    mode: null,
  });
  // Internal tracking refs (updated every rAF frame)
  const jumpPhaseRef  = useRef<'ground' | 'rising' | 'falling'>('ground');
  const takeoffTimeRef = useRef<number>(0);   // when feet left the ground
  const takeoffGroundRef = useRef<number>(0); // floor height under feet at takeoff
  const peakTimeRef    = useRef<number>(0);   // when apex was detected
  const prevAboveGroundRef = useRef<number>(0); // previous frame height above current floor
  const peakHeightRef  = useRef<number>(0);   // max jump height above takeoff floor (world units)

  /* --- Floating damage/heal numbers --- */
  type FloatType = 'dmg_dealt' | 'dmg_taken' | 'heal' | 'huajie' | 'xishou';
  /** text: overrides the auto-generated display (used for 化解 which shows no number) */
  type FloatEntry = { id: number; value: number; type: FloatType; startTime: number; label?: string; screenPct?: { x: number; y: number }; yOffset: number; text?: string; isCrit?: boolean; white?: boolean };
  const [floats, setFloats] = useState<FloatEntry[]>([]);
  const floatIdRef = useRef(0);
  const lastCastNameRef = useRef<string | null>(null);
  // Per-type stagger counter — increments each time a float of a given type
  // is spawned, so simultaneous hits don’t visually overlap.
  const floatTypeCountRef = useRef<Record<string, number>>({});
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const processedEventOrderRef = useRef<string[]>([]);
  const eventsInitializedRef = useRef(false);
  const addFloat = (value: number, type: FloatType, opts?: { label?: string; screenPct?: { x: number; y: number }; text?: string; isCrit?: boolean; allowZero?: boolean; white?: boolean }) => {
    if (value <= 0 && type !== 'huajie' && type !== 'xishou' && opts?.allowZero !== true) return;
    const id = ++floatIdRef.current;
    const safeScreenPct =
      opts?.screenPct && Number.isFinite(opts.screenPct.x) && Number.isFinite(opts.screenPct.y)
        ? {
            x: Math.max(0, Math.min(1, opts.screenPct.x)),
            y: Math.max(0, Math.min(1, opts.screenPct.y)),
          }
        : undefined;
    // Stagger: count how many same-type floats are currently alive to offset them
    const stagger = floatTypeCountRef.current[type] ?? 0;
    floatTypeCountRef.current[type] = stagger + 1;
    const yOffset = stagger * 28; // 28px per simultaneous float of the same type
    setFloats(f => [...f, { id, value, type, startTime: Date.now(), label: opts?.label, screenPct: safeScreenPct, yOffset, text: opts?.text, isCrit: opts?.isCrit, white: opts?.white }]);
    setTimeout(() => {
      setFloats(f => f.filter(e => e.id !== id));
      floatTypeCountRef.current[type] = Math.max(0, (floatTypeCountRef.current[type] ?? 1) - 1);
    }, 1400);
  };

  const formatFloatValue = (value: number) => {
    if (!Number.isFinite(value)) return '0';
    if (Math.abs(value) >= 10000) return formatGameAmount(value);
    return String(Math.round(value));
  };

  const isCritDamageEvent = (evt: any) => {
    if ((evt as any)?.suppressCritLabel === true) return false;
    return (evt as any)?.isCrit === true;
  };

  // Split abilities into two rows for rendering
  const specialBarActive = handAbilities.some(a => a.isSpecialBarAbility);
  const commonAbilities = handAbilities.filter(a => a.isCommon);
  const itemBarAbilityIds = useMemo(
    () => new Set(itemBarAbilities.filter(Boolean).map((ability) => ability!.id)),
    [itemBarAbilities],
  );
  const draftAbilitySource = handAbilities
    .filter(a => !a.isCommon && !a.isSpecialBarAbility && !itemBarAbilityIds.has(a.id))
    .map((ability) => {
      const overrideSlotIndex = draftSlotOverrides[ability.id];
      return typeof overrideSlotIndex === 'number'
        ? { ...ability, slotIndex: normalizeDraftSlotIndex(overrideSlotIndex, overrideSlotIndex) }
        : ability;
    });
  const draftAbilities: Array<AbilityInfo | undefined> = specialBarActive
    ? handAbilities.filter(a => a.isSpecialBarAbility)
    : buildDraftAbilitySlots(draftAbilitySource);

  useEffect(() => {
    const latestById = new Map(handAbilities.map((ability) => [ability.id, ability]));
    setItemBarAbilities((currentSlots) => {
      let changed = false;
      const nextSlots = currentSlots.map((ability) => {
        if (!ability) return undefined;
        const latest = latestById.get(ability.id);
        if (!latest) {
          changed = true;
          return undefined;
        }
        if (latest !== ability) {
          changed = true;
          return latest;
        }
        return ability;
      });
      if (!changed) return currentSlots;
      itemBarAbilitiesRef.current = nextSlots;
      return nextSlots;
    });
    setDraftSlotOverrides((currentOverrides) => {
      const nextOverrides: Record<string, number> = {};
      Object.entries(currentOverrides).forEach(([instanceId, slotIndex]) => {
        if (latestById.has(instanceId)) nextOverrides[instanceId] = slotIndex;
      });
      const changed = Object.keys(nextOverrides).length !== Object.keys(currentOverrides).length;
      if (!changed) return currentOverrides;
      draftSlotOverridesRef.current = nextOverrides;
      return nextOverrides;
    });
  }, [handAbilities]);

  /* --- Game logic refs --- */
  const keysRef          = useRef({ w: false, a: false, s: false, d: false });
  const joystickDirRef   = useRef<{ dx: number; dy: number } | null>(null); // analog joystick
  const autoForwardRef   = useRef(false);

  // Ground height under player — updated every physics tick for height display.
  const groundHRef = useRef(0);
  // First stable ground height — relative-elevation baseline (0 = flat starting ground)
  const groundBaseRef = useRef<number | null>(null);
  // Height display state: updated every 50ms
  const [heightDisplay, setHeightDisplay] = React.useState({ aboveGround: 0, floorElev: 0 });
  const [speedTestState, setSpeedTestState] = React.useState({
    active: false,
    currentUnitsPerSec: 0,
    measuredDistanceUnits: 0,
    measuredElapsedMs: 0,
    averageUnitsPerSec: 0,
    maxUnitsPerSec: 0,
    baseEligible: true,
    lockReason: null as string | null,
  });
  // Measurement pins — up to 2 world-coord positions {x, y, z}
  const [measurePins, setMeasurePins] = React.useState<Array<{ x: number; y: number; z: number }>>([]);
  const dragJustEndedRef = useRef(false);
  const localPositionRef = useRef<Position | null>(null);
  const localVelocityRef = useRef({ x: 0, y: 0 });
  const initializedRef   = useRef(false);
  const movementSeqRef   = useRef(0);
  const lastMovementRecoverAtRef = useRef(0);

  /* --- Jump / Z refs --- */
  const jumpLocalRef      = useRef(false); // drives local Z prediction
  const jumpSendRef       = useRef(false); // queued for next movement POST
  const localZRef         = useRef(0);     // current Z height (world units)
  const localVzRef        = useRef(0);     // current Z velocity
  const localJumpCountRef = useRef(0);     // jumps used in current airtime (max 2)
  const tiYunZongPenaltyConsumedRef = useRef(false);
  const lastDashAbilityIdRef = useRef<string | null>(null); // track last active dash for jump-restore logic
  const airborneSpeedCarryRef = useRef(0); // latest special airborne planar speed snapshot (world units/tick)
  const jumpTelemetryRef  = useRef<JumpTelemetry | null>(null);
  const lastJumpInputAtRef = useRef(0);    // last local jump press time for air reconciliation
  const bvhCenterYInitRef = useRef(false); // true after _bvhCenter.y first initialised
  const airNudgeRemainingRef = useRef(0);  // current jump phase travel budget (world units)
  const airNudgeTicksRemainingRef = useRef(0); // current jump phase travel ticks remaining
  const airNudgeDirRef = useRef<{ x: number; y: number } | null>(null);
  const airDirectionLockedRef = useRef(false); // once this jump phase picks a direction, ignore other movement inputs
  const localFacingRef    = useRef({ x: 0, y: 1 }); // current facing direction (default +Y)
  const facingInitRef     = useRef(false);
  const meFacingRef       = useRef<Facing>({ x: 0, y: 1 });
  const oppFacingRef      = useRef<Facing>({ x: 0, y: 1 });
  const prevActiveChannelRef = useRef<ActiveChannel | null>(null);
  const activeChannelRef = useRef<ActiveChannel | null>(null);
  const activeChannelSoundKeysRef = useRef<Set<string>>(new Set());
  const channelSoundFinishAfterCompleteKeysRef = useRef<Set<string>>(new Set());
  const speedSamplePrevRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const speedTestRunRef = useRef({
    active: false,
    distanceWorld: 0,
    validElapsedMs: 0,
    maxUnitsPerSec: 0,
  });

  /* --- Opponent interpolation --- */
  const internalOpponentBufferRef = useRef<Array<{ t: number; pos: Position }>>([]);
  const opponentRawRef            = useRef<Position | null>(null);
  const RENDER_DELAY_MS           = 100;
  const activeOpponentBuffer      = opponentPositionBufferRef ?? internalOpponentBufferRef;

  // Camera direction is now pinned to CAM_DIR constant — no ref needed.
  // Keep a dummy ref so nothing else needs changing.
  const camDirRef = useRef(CAM_DIR);

  // 传统模式 camera/character state
  const controlModeRef = useRef<'joystick' | 'traditional'>('traditional');
  const charYawRef     = useRef(0);             // character facing yaw (radians, 0 = facing +Y)
  const camYawRef      = useRef(0);             // camera yaw
  const camPitchRef    = useRef(DEFAULT_PITCH); // camera pitch angle (radians)
  const camZoomRef     = useRef(DEFAULT_CAMERA_ZOOM);           // zoom multiplier (scroll wheel)
  const cameraMoveCommandActiveRef = useRef(false);
  const cameraLookInputVersionRef = useRef(0);
  const manualCameraLookActiveRef = useRef(false);
  const mouseLookFacingSyncRafRef = useRef<number | null>(null);
  const mouseStateRef  = useRef({ isLeft: false, isRight: false, lastX: 0, lastY: 0, downX: NaN, downY: NaN, downAt: 0, dragDistance: 0 });
  const groundDeselectCandidateRef = useRef(false);
  const lastQuickLeftClickAtRef = useRef(0);

  activeChannelRef.current = me?.activeChannel ?? null;

  const hasMovementIntent = useCallback((keys = keysRef.current) => {
    if (controlModeRef.current === 'traditional') {
      const mouseLook = mouseStateRef.current.isRight;
      const bothMouse = mouseStateRef.current.isRight && mouseStateRef.current.isLeft;
      return !!buildTraditionalMoveIntent(
        keys,
        mouseLook,
        bothMouse,
        camYawRef.current,
        charYawRef.current,
      ).direction;
    }

    if (joystickDirRef.current) {
      return Math.hypot(joystickDirRef.current.dx, joystickDirRef.current.dy) > 0.01;
    }

    return keys.w || keys.a || keys.s || keys.d;
  }, []);

  const isStandingCastBlocked = useCallback((keys = keysRef.current) => {
    const movementIntent = hasMovementIntent(keys) || autoForwardRef.current;
    const localPlanarSpeed = Math.hypot(localVelocityRef.current.x, localVelocityRef.current.y);
    const airborneLockedLocal =
      jumpLocalRef.current ||
      jumpSendRef.current ||
      localJumpCountRef.current > 0 ||
      Math.abs(localVzRef.current) > 0.01;
    return movementIntent || localPlanarSpeed > 0.01 || airborneLockedLocal || !!meActiveDashRef.current;
  }, [hasMovementIntent]);

  /* --- Target selection refs --- */
  const selectedTargetRef   = useRef<string | null>(null);
  const selectedEntityRef   = useRef<string | null>(null);
  const selectedSelfRef     = useRef(false);
  const syncedTargetSelectionRef = useRef<string>(JSON.stringify(null));
  const lastInstantSwapCastAtRef = useRef(0);
  const lastFengLiuYunSanCastAtRef = useRef(0);
  const lastObservedServerDashAtRef = useRef(0);
  const pendingGroundCastAbilityRef = useRef<string | null>(null);
  const mouseWorldPosRef = useRef<{ x: number; y: number; z?: number } | null>(null);
  const oppScreenBoundsRef  = useRef<ScreenBounds | null>(null);
  const meScreenBoundsRef   = useRef<ScreenBounds | null>(null);
  const opponentScreenBoundsRef = useRef<Record<string, ScreenBounds>>({});
  const entityScreenBoundsRef = useRef<Record<string, ScreenBounds>>({});
  const opponentIdsRef      = useRef<string[]>([]);
  const targetableThingRef  = useRef<Array<{ kind: 'player' | 'entity'; id: string; position: Position }>>([]);
  const opponentPositionsRef = useRef<Record<string, Position>>({});
  // Always reflects current primary opponent userId
  const opponentUserIdRef   = useRef<string>(targetableOpponentsList[0]?.userId ?? '');
  opponentUserIdRef.current = targetableOpponentsList[0]?.userId ?? '';
  opponentPositionsRef.current = Object.fromEntries(opponentsList.map((opp) => [opp.userId, opp.position]));
  targetableThingRef.current = [
    ...targetableOpponentsList.map((opp) => ({ kind: 'player' as const, id: opp.userId, position: opp.position })),
    ...targetableEntityList.map((entity) => ({ kind: 'entity' as const, id: entity.id, position: entity.position })),
  ];
  const clearTargetSelection = useCallback(() => {
    selectedTargetRef.current = null;
    selectedEntityRef.current = null;
    selectedSelfRef.current = false;
    setSelectedTargetId(null);
    setSelectedEntityId(null);
    setSelectedSelf(false);
  }, []);

  useEffect(() => {
    const selection: TargetSelection | null = selectedSelf
      ? { kind: 'self', userId: me.userId }
      : selectedTargetId
      ? { kind: 'player', userId: selectedTargetId }
      : selectedEntityId
      ? { kind: 'entity', entityId: selectedEntityId }
      : null;
    const selectionKey = JSON.stringify(selection);
    if (syncedTargetSelectionRef.current === selectionKey) return;
    syncedTargetSelectionRef.current = selectionKey;
    void onTargetSelection?.(selection);
  }, [me.userId, onTargetSelection, selectedEntityId, selectedSelf, selectedTargetId]);

  /* --- Dash animation refs --- */
  const localDashAnimRef = useRef<{ start: V3; startTime: number } | null>(null);
  const oppDashAnimRef   = useRef<{ start: V3; startTime: number } | null>(null);

  /* --- Server-authoritative dash tracking --- */
  const meActiveDashRef  = useRef<any>(null);  // mirrors me.activeDash from server
  const forcedDisplacementRef = useRef(false);
  const dashTurnOverrideRef = useRef(false);
  // *** SYNCHRONOUS ref update during render — NOT in useEffect ***
  // useEffect fires AFTER requestAnimationFrame, so if we set the ref there,
  // the render loop reads the STALE value and falls back to cosmetic easing.
  // Setting it here ensures RAF always sees the latest activeDash.
  const _prevDashRef = useRef<boolean>(false);
  {
    const ad = (me as any)?.activeDash;
    const isDashing = !!ad && ad.ticksRemaining > 0;
    meActiveDashRef.current = isDashing ? ad : null;
    if (isDashing) {
      lastObservedServerDashAtRef.current = performance.now();
    }
    dashTurnOverrideRef.current = hasDashTurnOverrideClient(me?.buffs);
    // Transition logging (synchronous, fine for refs)
    if (isDashing && !_prevDashRef.current) {
      (window as any).__dashStartMs = performance.now();
      console.log(`[DASH] >>> FRONTEND START  time=${new Date().toISOString()}`);
    }
    if (!isDashing && _prevDashRef.current) {
      const elapsed = performance.now() - ((window as any).__dashStartMs ?? 0);
      console.log(`[DASH] <<< FRONTEND END    elapsed=${elapsed.toFixed(0)}ms  (expected ~1000ms)`);
    }
    _prevDashRef.current = isDashing;
  }

  useEffect(() => {
    forcedDisplacementRef.current = buffsHaveAnyEffect(me?.buffs, ['KNOCKED_BACK', 'PULLED']);
  }, [me?.buffs]);

  /* --- Render-loop refs (avoid stale closures) --- */
  const abilitiesRef  = useRef<AbilityInfo[]>([]);
  const meHpRef       = useRef(me?.hp ?? 0);
  const oppHpRef      = useRef(opponent?.hp ?? 0);
  const maxHpRef      = useRef(maxHp);
  const distanceRef   = useRef(distance);
  distanceRef.current = distance;

  /* --- Fuyao (扶摇直上) local buff prediction --- */
  const hasFuyaoBuffRef          = useRef(false);
  const isPowerJumpRef           = useRef(false); // true while airborne from a power jump (different gravity)
  const isPowerJumpCombinedRef   = useRef(false); // true for 扶摇+鸟翔 combined 24u jump
  const maxJumpsRef              = useRef(2);     // updated from me.buffs MULTI_JUMP effect
  const yuqiMountedRef           = useRef(false);
  const lingRanTianFengActiveRef = useRef(false);
  const lingRanTianFengChargeRef = useRef(0);
  const predictedMultiJumpExpiresAtRef = useRef(0);
  const moveSpeedScaleRef        = useRef(1);     // SPEED_BOOST/SLOW local prediction multiplier
  const movementControlStateRef  = useRef({
    fullyLocked: false,
    rooted: false,
    zLocked: false,
    channelMovementLocked: false,
    jumpVzScale: 1,
    tiYunZongActive: false,
    fearedSourceUserId: null as string | null,
    shiXinGuDirection: null as { x: number; y: number } | null,
    shiXinGuStandstill: false,
  });

  const isGroundCastPointWithinRange = useCallback((ability: AbilityInfo | null | undefined, point: { x: number; y: number; z?: number }) => {
    if (!ability) return false;
    const myPos = localPositionRef.current ?? me.position;
    if (!myPos) return false;
    const distanceUnits = worldUnitsToNewUnits(Math.hypot(point.x - myPos.x, point.y - myPos.y), mode);
    const maxRange = typeof ability.range === 'number' ? ability.range : undefined;
    const minRange = typeof ability.minRange === 'number' ? ability.minRange : undefined;
    if (maxRange !== undefined && distanceUnits > maxRange) return false;
    if (minRange !== undefined && distanceUnits < minRange) return false;
    return true;
  }, [me.position, mode]);

  const beginPendingGroundCast = useCallback((abilityId: string) => {
    pendingGroundCastAbilityRef.current = abilityId;
    setPendingGroundCastAbilityId(abilityId);
    const ability = abilitiesRef.current.find((candidate) => candidate.id === abilityId);
    const hoverTarget = mouseWorldPosRef.current;
    if (ability && hoverTarget && isGroundCastPointWithinRange(ability, hoverTarget)) {
      setGroundCastPreview({ x: hoverTarget.x, y: hoverTarget.y, z: hoverTarget.z, isValid: true });
    } else {
      setGroundCastPreview(null);
    }
  }, [isGroundCastPointWithinRange]);

  /* --- Channel AOE refs (used in render loop, updated via useEffect) --- */
  const meChannelingRef  = useRef(false);
  const oppChannelingRef = useRef(false);
  const meChannelRadiusRef  = useRef(10);
  const oppChannelRadiusRef = useRef(10);

  // Ref-based cast wrapper — updated every render, so it always captures the
  // latest onCastAbility without causing keyboard/mouse useEffect re-runs.
  const castAbilityRef = useRef<(id: string) => void>(() => {});
  const useConsumableRef = useRef<(id: ConsumableItemId) => void>(() => {});
  useConsumableRef.current = (id: ConsumableItemId) => {
    void onUseConsumable?.(id);
  };
  const setConsumableBarEnabled = useCallback((enabled: boolean) => {
    setConsumableBarSettings((prev) => ({ ...prev, enabled }));
  }, []);
  const setConsumableBarSlotCount = useCallback((slotCount: unknown) => {
    setConsumableBarSettings((prev) => ({ ...prev, slotCount: normalizeConsumableSlotCount(slotCount) }));
  }, []);
  const moveConsumableSlot = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setConsumableBarSettings((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.slotCount ||
        toIndex < 0 ||
        toIndex >= prev.slotCount
      ) {
        return prev;
      }
      const slots = normalizeConsumableSlots(prev.slots);
      const dragged = slots[fromIndex];
      if (dragged === undefined) {
        return prev;
      }
      slots[fromIndex] = slots[toIndex] ?? null;
      slots[toIndex] = dragged ?? null;
      return { ...prev, slots: slots.slice(0, CONSUMABLE_BAR_MAX_SLOTS) };
    });
  }, []);
  castAbilityRef.current = (id: string) => {
    const ability = abilitiesRef.current.find(a => a.id === id);
    const abilityKey = ability?.abilityId ?? ability?.id;
    if (ability?.blockedByAntiStealth) {
      showInGameWarning('反隐期间无法施展隐身招式');
      return;
    }
    if (ability?.disabledWarning) {
      showInGameWarning(ability.disabledWarning);
      return;
    }
    // Ground-target dashes enter pending mode (shows hover circle/path, click to confirm)
    if (abilityKey === 'feng_liu_yun_san') {
      const hoverTarget = mouseWorldPosRef.current;
      if (!hoverTarget) {
        beginPendingGroundCast(id);
        return;
      }
      const myPos = localPositionRef.current ?? me.position;
      const myZ = (myPos as any)?.z ?? localZRef.current ?? 0;
      const targetZ = hoverTarget.z ?? 0;
      if (!isGroundCastPointWithinRange(ability, hoverTarget)) {
        beginPendingGroundCast(id);
        return;
      }
      if (myPos && isClientLineBlocked(myPos, hoverTarget, myZ, targetZ)) {
        showInGameWarning('视线被遮挡');
        return;
      }
      lastFengLiuYunSanCastAtRef.current = performance.now();
      lastCastNameRef.current = ability?.name ?? null;
      pendingGroundCastAbilityRef.current = null;
      setPendingGroundCastAbilityId(null);
      setGroundCastPreview(null);
      onCastAbility(id, undefined, { x: hoverTarget.x, y: hoverTarget.y, z: hoverTarget.z }, undefined, hasMovementIntent(keysRef.current));
      return;
    }
    if (isDashGroundTargetAbilityId(abilityKey)) {
      beginPendingGroundCast(id);
      return;
    }
    if (abilityKey === 'fuyao_zhishang') hasFuyaoBuffRef.current = true;
    if (abilityKey === 'niao_xiang_bi_kong') {
      predictedMultiJumpExpiresAtRef.current = performance.now() + 15_000;
    }
    if (abilityKey === 'yan_yu_xing') {
      // 烟雨行 consumes ALL remaining air jumps (interaction with 鸟翔碧空's 6 jumps)
      localJumpCountRef.current = getEffectiveMaxJumps();
    }
    if (abilityKey === 'dou_zhuan_xing_yi') {
      lastInstantSwapCastAtRef.current = performance.now();
    }
    const selectedTargetIdNow = selectedTargetRef.current;
    const selectedEntityIdNow = selectedEntityRef.current;
    const selectedSelfNow = selectedSelfRef.current;
    const selectedEntity = selectedEntityIdNow
      ? (entities ?? []).find((e) => e.id === selectedEntityIdNow)
      : null;
    const selectedTarget = selectedTargetIdNow
      ? opponentsList.find((o) => o.userId === selectedTargetIdNow)
      : null;
    const selectedSelfTarget = selectedSelfNow ? me : null;
    const isFriendlyTargetAbility = ability?.target === 'OPPONENT' && ability?.friendlyTarget === true;
    const targetPos = selectedSelfTarget?.position
      ?? selectedTarget?.position
      ?? (selectedEntity ? { x: selectedEntity.position.x, y: selectedEntity.position.y, z: selectedEntity.position.z } : undefined);

    // Abilities targeting the opponent require a target (player or entity) to be selected first
    if (ability?.target === 'OPPONENT' && selectedSelfNow && !isFriendlyTargetAbility && !ability?.canTargetSelf) {
      showInGameWarning('该技能不能以自己为目标');
      return;
    }
    if (ability?.target === 'OPPONENT' && !selectedTargetIdNow && !selectedEntityIdNow && !selectedSelfNow) {
      if (ability?.allowGroundCastWithoutTarget) {
        beginPendingGroundCast(id);
        return;
      }
      showInGameWarning('请先选择目标');
      return;
    }
    if (ability?.target === 'OPPONENT' && isFriendlyTargetAbility && selectedTargetIdNow) {
      showInGameWarning('请先选择友方目标');
      return;
    }
    if (
      ability?.target === 'OPPONENT' &&
      selectedEntity &&
      ((isFriendlyTargetAbility && selectedEntity.ownerUserId !== me.userId) ||
        (!isFriendlyTargetAbility && selectedEntity.ownerUserId === me.userId))
    ) {
      showInGameWarning(isFriendlyTargetAbility ? '请先选择友方目标' : '请先选择敌方目标');
      return;
    }
    if (ability?.target === 'OPPONENT' && selectedTarget && blocksTargetingClient(selectedTarget.buffs)) {
      showInGameWarning('目标不可选中');
      return;
    }
    if (abilityKey === 'hong_meng_tian_jin' && hasShuSeClient((selectedSelfTarget ?? selectedTarget)?.buffs)) {
      showInGameWarning('目标已受曙色影响');
      return;
    }
    if (abilityKey === 'dou_zhuan_xing_yi' && selectedEntityIdNow) {
      showInGameWarning('该技能只能对敌方玩家施放');
      return;
    }
    if (abilityKey === 'qin_yin_gong_ming' && selectedEntityIdNow) {
      showInGameWarning('该技能只能对敌方玩家施放');
      return;
    }
    if (abilityKey === 'dou_zhuan_xing_yi' && selectedTarget && hasMianLaClient(selectedTarget.buffs)) {
      showInGameWarning('目标处于免拉状态');
      return;
    }
    if (abilityKey === 'you_feng_piao_zong' && !selectedTargetIdNow) {
      showInGameWarning('请先选择敌方目标');
      return;
    }
    if (abilityKey === 'you_feng_piao_zong' && selectedTarget && blocksTargetingClient(selectedTarget.buffs)) {
      showInGameWarning('目标不可选中');
      return;
    }
    if (ability?.target === 'OPPONENT' && !targetPos) {
      if (ability?.allowGroundCastWithoutTarget) {
        beginPendingGroundCast(id);
        return;
      }
      showInGameWarning('目标不可见或已失去目标');
      return;
    }

    const airborneLockedLocal =
      jumpLocalRef.current ||
      jumpSendRef.current ||
      localJumpCountRef.current > 0 ||
      Math.abs(localVzRef.current) > 0.01;
    const mountedYuqiToggle = hasYuqiStateClient(me?.buffs) && abilityKey === 'yuqi';
    if (ability?.requiresGrounded && airborneLockedLocal && !mountedYuqiToggle) {
      showInGameWarning('该技能需要落地后施放');
      return;
    }
    if (requiresStandingAtCastClient(ability) && !mountedYuqiToggle) {
      if (isStandingCastBlocked(keysRef.current)) {
        showInGameWarning('该技能需要站立后施放');
        return;
      }
      localVelocityRef.current = { x: 0, y: 0 };
    }
    if (ability?.cannotCastWhileRooted && buffsHaveAnyEffect(me?.buffs, ['ROOT'])) {
      showInGameWarning('你被锁足，无法施展该招式');
      return;
    }
    if (abilityKey === 'ren_chi_cheng' && isLingRanSpecialJumpActiveClient(me)) {
      showInGameWarning('凌然天风特殊跳跃中无法施展任驰骋');
      return;
    }
    if (typeof ability?.minSelfHpExclusive === 'number' && (me?.hp ?? 0) <= ability.minSelfHpExclusive) {
      showInGameWarning(`当前气血必须大于${ability.minSelfHpExclusive}才能施放`);
      return;
    }
    if (typeof ability?.minSelfHpPercentExclusive === 'number') {
      const requiredHp = Math.max(1, Number(me?.maxHp ?? maxHp)) * (ability.minSelfHpPercentExclusive / 100);
      if ((me?.hp ?? 0) <= requiredHp) {
        showInGameWarning(`当前气血必须大于${ability.minSelfHpPercentExclusive}%才能施放`);
        return;
      }
    }

    // Face direction check (180° hemisphere)
    if (ability?.target === 'OPPONENT' && !isFriendlyTargetAbility && !selectedSelfNow && requiresFacingByDefault(ability)) {
      const myPos = localPositionRef.current ?? me.position;
      const myFacing = me.facing ?? meFacingRef.current;
      if (myPos && myFacing && targetPos) {
        const dx = targetPos.x - myPos.x;
        const dy = targetPos.y - myPos.y;
        const dot = myFacing.x * dx + myFacing.y * dy;
        if (dot < 0) {
          showInGameWarning('目标不在面朝方向内');
          return;
        }
      }
    }
    // Line-of-sight check (structure blocking)
    if (ability?.target === 'OPPONENT' && !isFriendlyTargetAbility && !selectedSelfNow) {
      const myPos = localPositionRef.current ?? me.position;
      const myZ = (myPos as any)?.z ?? localZRef.current ?? 0;
      const tgtZ = (targetPos as any)?.z ?? 0;
      if (myPos && targetPos) {
        const losBlocked = isClientLineBlocked(myPos, targetPos, myZ, tgtZ, selectedEntityIdNow ?? undefined);
        if (losBlocked) {
          showInGameWarning('视线被遮挡');
          return;
        }
      }
    }
    // Stamp the ability name so the damage / heal float can label itself
    lastCastNameRef.current = ability?.name ?? null;
    pendingGroundCastAbilityRef.current = null;
    setPendingGroundCastAbilityId(null);
    setGroundCastPreview(null);
    // If an entity is selected and ability targets OPPONENT, route as entity attack.
    const useEntityTarget = ability?.target === 'OPPONENT' && selectedEntityIdNow && !selectedTargetIdNow && !selectedSelfNow;
    const supportSelfTargetUserId = abilityKey === 'you_feng_piao_zong'
      ? selectedTargetIdNow ?? undefined
      : undefined;
    onCastAbility(
      id,
      ability?.target === 'OPPONENT'
        ? (selectedSelfNow ? me.userId : selectedTargetIdNow ?? undefined)
        : supportSelfTargetUserId,
      undefined,
      useEntityTarget ? selectedEntityIdNow : undefined,
      hasMovementIntent(keysRef.current),
    );
  };

  const castGroundAbilityRef = useRef<(x: number, y: number, worldZ?: number) => void>(() => {});
  castGroundAbilityRef.current = (x: number, y: number, worldZ?: number) => {
    const abilityId = pendingGroundCastAbilityRef.current;
    if (!abilityId) return;
    const ability = abilitiesRef.current.find((a) => a.id === abilityId);
    if (!ability) return;
    const abilityKey = ability.abilityId ?? ability.id;
    if (!isGroundCastPointWithinRange(ability, { x, y, z: worldZ })) {
      setGroundCastPreview(null);
      return;
    }
    if (ability.target === 'OPPONENT') {
      const myPos = localPositionRef.current ?? me.position;
      const myZ = (myPos as any)?.z ?? localZRef.current ?? 0;
      const targetZ = worldZ ?? 0;
      if (myPos && isClientLineBlocked(myPos, { x, y }, myZ, targetZ)) {
        showInGameWarning('视线被遮挡');
        return;
      }
    }

    lastCastNameRef.current = ability.name ?? null;
    if (abilityKey === 'dou_zhuan_xing_yi') {
      lastInstantSwapCastAtRef.current = performance.now();
    }
    if (abilityKey === 'feng_liu_yun_san') {
      lastFengLiuYunSanCastAtRef.current = performance.now();
    }
    pendingGroundCastAbilityRef.current = null;
    setPendingGroundCastAbilityId(null);
    setGroundCastPreview(null);
    onCastAbility(abilityId, undefined, { x, y, z: worldZ }, undefined, hasMovementIntent(keysRef.current));
  };

  /* --- Render position + dash-trail refs --- */
  const localRenderPosRef = useRef<V3>({ x: me?.position?.x ?? 50, y: me?.position?.y ?? 50, z: 0 });
  const oppRenderPosRef   = useRef<V3>({ x: opponent?.position?.x ?? 50, y: opponent?.position?.y ?? 50, z: 0 });
  const localTrailRef     = useRef<Array<{ pos: V3; alpha: number }>>([]);
  const oppTrailRef       = useRef<Array<{ pos: V3; alpha: number }>>([]);
  const lastFrameTimeRef  = useRef<number>(0);

  // Restore the old rAF render-position loop exactly.
  // Handles: smooth position lerp, dash snap animation, jump phase tracking, Z display.
  useEffect(() => {
    let rafId = 0;
    const DASH_THRESH = 3.5;
    const SNAP_THRESH = 20;

    const tick = () => {
      const frameNow = performance.now();
      const frameDt = lastFrameTimeRef.current === 0 ? 16 : Math.min(frameNow - lastFrameTimeRef.current, 50);
      lastFrameTimeRef.current = frameNow;
      const dtF = frameDt / 16.67;

      // --- local player render pos ---
      const myPos = localPositionRef.current ?? me?.position;
      if (myPos) {
        const tx = myPos.x, ty = myPos.y, tz = localZRef.current;
        const r  = localRenderPosRef.current;
        const ddx = tx - r.x, ddy = ty - r.y, ddz = tz - r.z;
        const dist2d = Math.sqrt(ddx * ddx + ddy * ddy);
        const forcedRenderDisplacement = forcedDisplacementRef.current;
        const recentDashSnap =
          frameNow - lastObservedServerDashAtRef.current < 400 ||
          frameNow - lastFengLiuYunSanCastAtRef.current < 700;
        const airborneRender =
          localJumpCountRef.current > 0 ||
          Math.abs(localVzRef.current) > 0.01 ||
          tz > groundHRef.current + 0.05;
        const justJumpedRender = frameNow - lastJumpInputAtRef.current < 320;

        // During server-authoritative dash: HARD SNAP to server position.
        // Do NOT lerp — any lerp causes the visual to lag behind the server,
        // extending the perceived dash duration beyond the actual 1-second window.
        if (meActiveDashRef.current || forcedRenderDisplacement || recentDashSnap) {
          localDashAnimRef.current = null;
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
        } else if (dist2d > SNAP_THRESH) {
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
          localDashAnimRef.current  = null;
        } else if (!localDashAnimRef.current && dist2d > DASH_THRESH) {
          localDashAnimRef.current = { start: { ...r }, startTime: frameNow };
        }
        if (!meActiveDashRef.current && !forcedRenderDisplacement && !recentDashSnap) {
          if (localDashAnimRef.current) {
            const elapsed = frameNow - localDashAnimRef.current.startTime;
            const t = Math.min(1, elapsed / DASH_ANIM_MS);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            localRenderPosRef.current = {
              x: localDashAnimRef.current.start.x + (tx - localDashAnimRef.current.start.x) * eased,
              y: localDashAnimRef.current.start.y + (ty - localDashAnimRef.current.start.y) * eased,
              z: localDashAnimRef.current.start.z + (tz - localDashAnimRef.current.start.z) * eased,
            };
            if (t >= 1) localDashAnimRef.current = null;
          } else {
            const horizontalK = Math.min(1, (airborneRender ? (justJumpedRender ? 0.52 : 0.4) : 0.3) * dtF);
            const verticalK = Math.min(1, (airborneRender ? (justJumpedRender ? 0.62 : 0.46) : 0.3) * dtF);
            localRenderPosRef.current = {
              x: r.x + ddx * horizontalK,
              y: r.y + ddy * horizontalK,
              z: r.z + ddz * verticalK,
            };
          }
        }
      }

      myZRef.current = localRenderPosRef.current.z ?? 0;

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [me?.position?.x, me?.position?.y]);

  useEffect(() => { meHpRef.current  = me?.hp ?? 0;      }, [me?.hp]);
  // Keep max-jumps ref in sync with MULTI_JUMP buff from server state
  useEffect(() => {
    const effects = me?.buffs?.flatMap((b: any) => (b.effects ?? []).filter(Boolean)) ?? [];
    const multiJump = effects.find((e: any) => e.type === 'MULTI_JUMP');
    maxJumpsRef.current = multiJump ? (multiJump.value ?? 2) : 2;
    yuqiMountedRef.current = hasYuqiStateClient(me?.buffs);
    lingRanTianFengActiveRef.current = effects.some((e: any) => e.type === 'LING_RAN_TIAN_FENG_STATE');
    const nextLingRanCharge = Number((me as any)?.lingRanTianFengCharges ?? 0);
    lingRanTianFengChargeRef.current = lingRanTianFengActiveRef.current
      ? Math.max(0, Math.min(1, Number.isFinite(nextLingRanCharge) ? nextLingRanCharge : 0))
      : 0;
  }, [me?.buffs, (me as any)?.lingRanTianFengCharges]);

  useEffect(() => {
    tiYunZongPenaltyConsumedRef.current = !!me?.tiYunZongPenaltyConsumed;
  }, [me?.tiYunZongPenaltyConsumed]);

  const getEffectiveMaxJumps = useCallback(() => {
    if (yuqiMountedRef.current) return 1;
    const predictedMultiJumpActive = predictedMultiJumpExpiresAtRef.current > performance.now();
    return predictedMultiJumpActive ? Math.max(maxJumpsRef.current, 5) : maxJumpsRef.current;
  }, []);

  const canUseYuqiMountedJumpClient = useCallback((jumpDir: { x: number; y: number } | null) => {
    if (!yuqiMountedRef.current) return true;
    if (!jumpDir) return false;

    const keys = keysRef.current;
    if (keys.s && !keys.w) return false;

    return true;
  }, []);

  const getQueuedYuqiMountedJumpDirection = useCallback(() => {
    if (joystickDirRef.current) {
      return normalizePlanar(joystickDirRef.current.dx, joystickDirRef.current.dy);
    }

    const keys = keysRef.current;
    if (controlModeRef.current === 'traditional') {
      const mouseLook = mouseStateRef.current.isRight;
      const bothMouse = mouseStateRef.current.isRight && mouseStateRef.current.isLeft;
      const moveIntent = buildTraditionalMoveIntent(
        keys,
        mouseLook,
        bothMouse,
        camYawRef.current,
        charYawRef.current,
      );
      return moveIntent.direction ? normalizePlanar(moveIntent.direction.dx, moveIntent.direction.dy) : null;
    }

    return normalizePlanar(
      (keys.a ? -1 : 0) + (keys.d ? 1 : 0),
      (keys.w ? 1 : 0) + (keys.s ? -1 : 0),
    );
  }, []);

  const tryQueueLocalJump = useCallback(() => {
    if (meActiveDashRef.current) return;
    const lingRanJumpLockImmune = lingRanTianFengActiveRef.current;
    if (
      jumpLockedRef.current ||
      (!lingRanJumpLockImmune && (
        !!me?.activeChannel ||
        hasLegacyChannelJumpLock(me?.buffs) ||
        buffsHaveAnyEffect(me?.buffs, ['NO_JUMP'])
      ))
    ) {
      return;
    }
    if (lingRanTianFengActiveRef.current) {
      if (lingRanTianFengChargeRef.current <= 0) {
        jumpLocalRef.current = false;
        jumpSendRef.current = false;
        return;
      }
      const keepLingRanCharge = hasLingRanSpecialJumpRefillBuffClient(me?.buffs);
      lastJumpInputAtRef.current = performance.now();
      jumpLocalRef.current = false;
      jumpSendRef.current = true;
      lingRanTianFengChargeRef.current = keepLingRanCharge ? 1 : 0;
      return;
    }
    const queuedYuqiJumpDir = getQueuedYuqiMountedJumpDirection();
    if (!canUseYuqiMountedJumpClient(queuedYuqiJumpDir)) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
      return;
    }
    const maxJumps = getEffectiveMaxJumps();
    if (localJumpCountRef.current >= maxJumps) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
      return;
    }
    lastJumpInputAtRef.current = performance.now();
    jumpLocalRef.current = true;
    jumpSendRef.current = true;
  }, [canUseYuqiMountedJumpClient, getEffectiveMaxJumps, getQueuedYuqiMountedJumpDirection, me?.activeChannel, me?.buffs]);

  // Keep local movement-speed prediction aligned with backend movement.ts
  useEffect(() => {
    const effects = (me?.buffs ?? []).flatMap((b: any) => (b.effects ?? []).filter(Boolean));
    const speedBoost = effects
      .filter((e: any) => e.type === 'SPEED_BOOST')
      .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
    const slow = effects
      .filter((e: any) => e.type === 'SLOW')
      .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
    moveSpeedScaleRef.current = Math.max(0, 1 + speedBoost - slow);
  }, [me?.buffs]);

  useEffect(() => {
    const getBaseSpeedLockReason = () => {
      if (meActiveDashRef.current) return '冲刺中';
      if (localJumpCountRef.current > 0 || Math.abs(localVzRef.current) > 0.01) return '空中';
      if (Math.abs(moveSpeedScaleRef.current - 1) > 0.001) return '有移速修正';
      return null;
    };

    const id = window.setInterval(() => {
      const pos = localPositionRef.current;
      const now = performance.now();
      const prev = speedSamplePrevRef.current;
      const lockReason = getBaseSpeedLockReason();
      let currentUnitsPerSec = 0;

      if (pos && prev) {
        const dtMs = now - prev.t;
        if (dtMs > 1) {
          const distanceWorld = Math.hypot(pos.x - prev.x, pos.y - prev.y);
          currentUnitsPerSec = (distanceWorld / storedUnitScale) / (dtMs / 1000);

          if (speedTestRunRef.current.active && !lockReason) {
            speedTestRunRef.current.distanceWorld += distanceWorld;
            speedTestRunRef.current.validElapsedMs += dtMs;
            speedTestRunRef.current.maxUnitsPerSec = Math.max(
              speedTestRunRef.current.maxUnitsPerSec,
              currentUnitsPerSec,
            );
          }
        }
      }

      if (pos) {
        speedSamplePrevRef.current = { x: pos.x, y: pos.y, t: now };
      }

      const measuredDistanceUnits = speedTestRunRef.current.distanceWorld / storedUnitScale;
      const measuredElapsedMs = speedTestRunRef.current.validElapsedMs;
      setSpeedTestState({
        active: speedTestRunRef.current.active,
        currentUnitsPerSec,
        measuredDistanceUnits,
        measuredElapsedMs,
        averageUnitsPerSec: measuredElapsedMs > 0 ? measuredDistanceUnits / (measuredElapsedMs / 1000) : 0,
        maxUnitsPerSec: speedTestRunRef.current.maxUnitsPerSec,
        baseEligible: !lockReason,
        lockReason,
      });
    }, 100);

    return () => window.clearInterval(id);
  }, []);

  // activeDash side-effects: reset local prediction state when dash ends
  const activeDashJson = JSON.stringify((me as any)?.activeDash ?? null);
  useEffect(() => {
    const ad = (me as any)?.activeDash;
    const isDashing = !!ad && ad.ticksRemaining > 0;
    if (isDashing) {
      // Track which ability is currently dashing so we can restore jumps correctly on end
      lastDashAbilityIdRef.current = ad.abilityId ?? null;
    }
    if (!isDashing) {
      const wasYanYuXing = lastDashAbilityIdRef.current === 'yan_yu_xing';
      const airborneAfterDash = localZRef.current > groundHRef.current + 0.01;
      // 烟雨行: consumes ALL remaining jumps (backend sets jumpCount = MAX_JUMPS)
      localJumpCountRef.current = airborneAfterDash
        ? (wasYanYuXing ? getEffectiveMaxJumps() : (getEffectiveMaxJumps() > 2 ? 0 : 1))
        : 0;
      localVzRef.current = 0;
      isPowerJumpRef.current = false;
      isPowerJumpCombinedRef.current = false;
      airborneSpeedCarryRef.current = 0;
    }
  }, [activeDashJson, getEffectiveMaxJumps]);
  useEffect(() => { oppHpRef.current = opponent?.hp ?? 0; }, [opponent?.hp]);
  useEffect(() => { maxHpRef.current = maxHp;             }, [maxHp]);
  useEffect(() => {
    const f = me?.facing;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      meFacingRef.current = { x: f.x, y: f.y };
      if (!facingInitRef.current) {
        localFacingRef.current = { x: f.x, y: f.y };
        const yaw = Math.atan2(f.x, f.y);
        charYawRef.current = yaw;
        camYawRef.current = yaw;
        facingInitRef.current = true;
      }
    }
  }, [me?.facing?.x, me?.facing?.y]);
  useEffect(() => {
    const f = opponent?.facing;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      oppFacingRef.current = { x: f.x, y: f.y };
    }
  }, [opponent?.facing?.x, opponent?.facing?.y]);

  // Auto-detect mobile, but keep gameplay on the traditional movement path.
  useEffect(() => {
    // Mobile = touch device without a fine pointer (mouse), e.g. phones/iPads
    const isMobile = typeof window !== 'undefined' &&
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia('(pointer: fine)').matches;
    setIsMobileDevice(isMobile);
    if (isMobile) {
      setEnvToggles(prev => prev.shadows ? { ...prev, shadows: false } : prev);
    }
    const mode: 'traditional' | 'joystick' = 'traditional';
    setControlMode(mode);
    controlModeRef.current = mode;
  }, []);

  const channelBarResult = buildChannelBarResultForPlayer(
    me,
    channelAbilityByBuffId,
    { suppressJumpBar: localJumpCountRef.current > 0 || Math.abs(localVzRef.current) > 0.01 },
    abilities,
  );
  const channelBarData: ChannelBarData | null = channelBarResult ? channelBarResult.data : null;

  const opponentChannelDataById = useMemo(() => {
    const map = new Map<string, ChannelBarData>();
    for (const opp of visibleOpponentsList) {
      const result = buildChannelBarResultForPlayer(opp, channelAbilityByBuffId, undefined, abilities);
      if (result) map.set(opp.userId, result.data);
    }
    return map;
  }, [visibleOpponentsList, channelAbilityByBuffId, abilities]);

  const jumpRecordNextRef = useRef<JumpRecord | null>(null);
  const jumpLockedRef = useRef(false);

  useEffect(() => {
    const buffs = me?.buffs ?? [];
    const lingRanJumpLockImmune = hasLingRanTianFengStateClient(buffs);
    const fullyLocked = buffsHaveAnyEffect(buffs, ['KNOCKED_BACK', 'CONTROL', 'ATTACK_LOCK']);
    const rooted = !fullyLocked && buffsHaveAnyEffect(buffs, ['ROOT']);
    const jumpSuppressedByChannel = !lingRanJumpLockImmune && (!!me?.activeChannel || hasLegacyChannelJumpLock(buffs));
    const noJumpLocked = !lingRanJumpLockImmune && buffsHaveAnyEffect(buffs, ['NO_JUMP']);
    const channelMovementLocked = (me?.activeChannel as any)?.lockMovement === true;
    // Z_LOCK: full vertical lock (亢龙有悔). Pin vz=0 and skip Z integration.
    const zLocked = buffsHaveAnyEffect(buffs, ['Z_LOCK']);
    // JUMP_NERF: scales jump take-off velocity by sqrt(value). Use min across stacks.
    let jumpVzScale = 1;
    // 梯云纵: persistent power-jump (acts like 弹跳 / JUMP_BOOST but does not consume).
    let tiYunZongActive = false;
    let fearedSourceUserId: string | null = null;
    let shiXinGuDirection: { x: number; y: number } | null = null;
    let shiXinGuStandstill = false;
    for (const b of buffs ?? []) {
      const now = Date.now();
      if (!b || (b.expiresAt ?? 0) <= now) continue;
      for (const e of (b.effects ?? [])) {
        if ((e as any)?.type === 'JUMP_NERF') {
          const v = Math.max(0, Math.min(1, Number((e as any).value ?? 1)));
          const s = Math.sqrt(v);
          if (s < jumpVzScale) jumpVzScale = s;
        }
        if ((e as any)?.type === 'TI_YUN_ZONG_JUMP') {
          tiYunZongActive = true;
        }
        if (!fearedSourceUserId && (e as any)?.type === 'FEARED') {
          fearedSourceUserId = b.sourceUserId ?? null;
        }
        if ((e as any)?.type === 'SHI_XIN_GU') {
          const mode = (b as any)?.forcedMovementMode;
          if (mode === 'direction') {
            const dir = (b as any)?.forcedMoveDirection;
            const dx = Number(dir?.x ?? 0);
            const dy = Number(dir?.y ?? 0);
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.0001) {
              shiXinGuDirection = { x: dx / len, y: dy / len };
              shiXinGuStandstill = false;
            }
          } else {
            shiXinGuDirection = null;
            shiXinGuStandstill = true;
          }
        }
      }
    }
    movementControlStateRef.current = {
      fullyLocked,
      rooted,
      zLocked,
      channelMovementLocked,
      jumpVzScale,
      tiYunZongActive,
      fearedSourceUserId,
      shiXinGuDirection,
      shiXinGuStandstill,
    };
    const jumpLocked =
      jumpSuppressedByChannel ||
      noJumpLocked ||
      fullyLocked ||
      rooted ||
      zLocked ||
      !!fearedSourceUserId ||
      !!shiXinGuDirection ||
      shiXinGuStandstill;
    jumpLockedRef.current = jumpLocked;
    if (jumpLocked) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
    }
  }, [me?.activeChannel, me?.buffs]);

  // Poll height + consume any finished jump record every 50 ms
  useEffect(() => {
    const id = setInterval(() => {
      const curZ  = myZRef.current;
      const gH    = groundHRef.current;
      const gBase = groundBaseRef.current ?? gH;
      setMyZ(Math.round(curZ * 10) / 10);
      setHeightDisplay({
        aboveGround: Math.max(0, (curZ - gH)) / storedUnitScale,
        floorElev:   Math.max(0, (gH - gBase)) / storedUnitScale,
      });
      const rec = jumpRecordNextRef.current;
      if (rec) {
        jumpRecordNextRef.current = null;
        setJumpRecord(rec);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Keep render-loop refs up to date for channel AOE circles
  useEffect(() => {
    const hasFengLai = me?.buffs?.some((b: any) => b.buffId === 1014);
    const hasZhanWu  = me?.buffs?.some((b: any) => b.buffId === 2712);
    meChannelingRef.current = !!(hasFengLai || hasZhanWu);
    meChannelRadiusRef.current = hasZhanWu ? 4 : 10;
  }, [me?.buffs]);
  useEffect(() => {
    const hasFengLai = opponent?.buffs?.some((b: any) => b.buffId === 1014);
    const hasZhanWu  = opponent?.buffs?.some((b: any) => b.buffId === 2712);
    oppChannelingRef.current = !!(hasFengLai || hasZhanWu);
    oppChannelRadiusRef.current = hasZhanWu ? 4 : 10;
  }, [opponent?.buffs]);

  useEffect(() => {
    const nextBounds: Record<string, ScreenBounds> = {};
    for (const opp of visibleOpponentsList) {
      const existing = opponentScreenBoundsRef.current[opp.userId];
      if (existing) {
        nextBounds[opp.userId] = existing;
      }
    }
    opponentScreenBoundsRef.current = nextBounds;
  }, [visibleOpponentsList]);

  // Keep selected target valid as opponent list changes (N-player support)
  useEffect(() => {
    const ids = targetableOpponentsList.map((o) => o.userId);
    opponentIdsRef.current = ids;
    const current = selectedTargetRef.current;
    if (ids.length === 0) {
      setSelectedTargetId(null);
      selectedTargetRef.current = null;
      return;
    }
    if (current && !ids.includes(current)) {
      setSelectedTargetId(null);
      selectedTargetRef.current = null;
    }
  }, [targetableOpponentsList]);

  useEffect(() => {
    selectedTargetRef.current = selectedTargetId;
  }, [selectedTargetId]);

  useEffect(() => {
    selectedEntityRef.current = selectedEntityId;
  }, [selectedEntityId]);

  // Drop selectedEntityId if it disappears (HP=0 / expired) from the entities list.
  useEffect(() => {
    if (!selectedEntityId) return;
    const stillExists = visibleEntities.some((e) => e.id === selectedEntityId);
    if (!stillExists) {
      setSelectedEntityId(null);
      selectedEntityRef.current = null;
    }
  }, [visibleEntities, selectedEntityId]);

  useEffect(() => {
    pendingGroundCastAbilityRef.current = pendingGroundCastAbilityId;
  }, [pendingGroundCastAbilityId]);

  useEffect(() => {
    pendingDummySpawnRef.current = pendingDummySpawn;
    if (!pendingDummySpawn) setDummySpawnPreview(null);
  }, [pendingDummySpawn]);

  // Keep pickups ref up-to-date for render loop
  useEffect(() => {
    pickupsRef.current = modePickups;
  }, [modePickups]);

  // Keep nearbyPickupIdsRef + pickupModalsRef + uiPositionsRef in sync
  useEffect(() => { nearbyPickupIdsRef.current = nearbyPickupIds; }, [nearbyPickupIds]);
  useEffect(() => { pickupModalsRef.current    = pickupModals;    }, [pickupModals]);
  useEffect(() => { uiPositionsRef.current     = uiPositions;     }, [uiPositions]);
  useEffect(() => { channelPickupIdRef.current = channelPickupId; }, [channelPickupId]);

  // Proximity check: collect ALL books within range, sorted closest-first (runs every 100ms)
  // Also auto-close pickup panels whose book is now beyond claim range (20 units)
  useEffect(() => {
    const PICKUP_RANGE = 5;
    const CLAIM_RANGE  = 20;
    const id = setInterval(() => {
      const pos = localPositionRef.current;
      if (!pos) return;
      const pz = localZRef.current;
      const items = pickupsRef.current;
      const nearby: Array<{ id: string; dist: number }> = [];
      for (const p of items) {
        const dx = pos.x - p.position.x;
        const dy = pos.y - p.position.y;
        const dz = 0;
        const dist = worldUnitsToNewUnits(Math.sqrt(dx * dx + dy * dy + dz * dz), mode);
        if (dist < PICKUP_RANGE) nearby.push({ id: p.id, dist });
      }
      nearby.sort((a, b) => a.dist - b.dist);
      const ids = nearby.map(n => n.id);
      nearbyPickupIdsRef.current = ids;
      setNearbyPickupIds(prev =>
        prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids
      );
      // Close any open panels whose book drifted beyond claim range
      const modals = pickupModalsRef.current;
      if (modals.length > 0) {
        const toClose = modals.filter(m => {
          const pu = items.find(p => p.id === m.pickupId);
          if (!pu) return true;
          const dx = pos.x - pu.position.x;
          const dy = pos.y - pu.position.y;
          return worldUnitsToNewUnits(Math.sqrt(dx * dx + dy * dy), mode) > CLAIM_RANGE;
        }).map(m => m.pickupId);
        if (toClose.length > 0) {
          setPickupModals(prev => prev.filter(m => !toClose.includes(m.pickupId)));
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Poll canvas bounds for debug overlay
  useEffect(() => {
    if (!showDebugGrid) return;
    const id = setInterval(() => {
      const me  = meScreenBoundsRef.current;
      const opp = oppScreenBoundsRef.current;
      const { w: cw, h: ch } = canvasSizeRef.current;
      setDebugBounds({
        me:  me  ? { cx: me.cx,  topY: me.topY,  hpBarY: me.topY  - 20 } : null,
        opp: opp ? { cx: opp.cx, topY: opp.topY } : null,
        cw, ch,
      });
    }, 100);
    return () => clearInterval(id);
  }, [showDebugGrid]);

  /* --- Event-based floating numbers (replaces HP-delta system) --- */
  useEffect(() => {
    const rememberEventId = (eventId: string) => {
      if (processedEventIdsRef.current.has(eventId)) return false;
      processedEventIdsRef.current.add(eventId);
      processedEventOrderRef.current.push(eventId);
      while (processedEventOrderRef.current.length > 1200) {
        const oldest = processedEventOrderRef.current.shift();
        if (oldest) processedEventIdsRef.current.delete(oldest);
      }
      return true;
    };
    const getEventId = (evt: any, index: number) => {
      if (evt?.id !== undefined && evt?.id !== null) return String(evt.id);
      return `${evt?.timestamp ?? 'no-ts'}:${evt?.turn ?? 'no-turn'}:${evt?.type ?? 'unknown'}:${index}`;
    };

    if (!eventsInitializedRef.current) {
      for (let index = 0; index < events.length; index++) {
        const evt = events[index];
        if (!evt || typeof evt !== 'object' || !('type' in evt)) continue;
        rememberEventId(getEventId(evt, index));
      }
      eventsInitializedRef.current = true;
      return;
    }

    const newEvents: any[] = [];
    for (let index = 0; index < events.length; index++) {
      const evt = events[index];
      if (!evt || typeof evt !== 'object' || !('type' in evt)) continue;
      if (rememberEventId(getEventId(evt, index))) {
        newEvents.push(evt);
      }
    }
    if (newEvents.length === 0) return;

    const myId = me?.userId;
    const playSoundForEvent = (evt: any) => {
      if ((evt.type !== 'PLAY_ABILITY' && evt.type !== 'ABILITY_SOUND' && evt.type !== 'DAMAGE' && evt.type !== 'BUFF_APPLIED') || !evt.abilityId) return;
      const ability = abilities?.[evt.abilityId];
      const cue = getAbilitySoundCue(ability, evt);
      if (!cue) return;
      if (cue.targetOnly && String(evt.targetUserId ?? '') !== String(myId ?? '')) return;

      const listenerPosition = localPositionRef.current ?? me?.position ?? null;
      const actorUserId = String(evt.actorUserId ?? '');
      const runtimeChannelForSound = getRuntimeAbilityChannel(ability);
      const eventChannelSoundKey = getChannelSoundKey(
        actorUserId,
        typeof evt.abilityId === 'string' ? evt.abilityId : undefined,
        runtimeChannelForSound?.source === 'BUFF'
          ? undefined
          : typeof evt.abilityInstanceId === 'string' ? evt.abilityInstanceId : undefined,
      );
      if ((evt.type === 'PLAY_ABILITY' || evt.type === 'ABILITY_SOUND') && evt.channelPhase === 'complete') {
        if (eventChannelSoundKey && channelSoundFinishAfterCompleteKeysRef.current.has(eventChannelSoundKey)) {
          channelSoundFinishAfterCompleteKeysRef.current.delete(eventChannelSoundKey);
          activeChannelSoundKeysRef.current.delete(eventChannelSoundKey);
        } else {
          stopAbilityChannelSound(eventChannelSoundKey);
        }
      }
      const actorState = actorUserId === myId
        ? me
        : opponentsList.find((opponentEntry) => opponentEntry.userId === actorUserId) ?? null;
      const eventSourcePosition = typeof evt.x === 'number' && typeof evt.y === 'number'
        ? { x: evt.x, y: evt.y, z: typeof evt.z === 'number' ? evt.z : 0 }
        : null;
      const sourcePosition = cue.targetOnly
        ? listenerPosition
        : eventSourcePosition
        ? eventSourcePosition
        : actorUserId === myId
        ? listenerPosition
        : opponentPositionsRef.current[actorUserId] ?? actorState?.position ?? null;
      const spatial = cue.targetOnly
        ? { volume: 1, pan: 0 }
        : calculateAbilitySoundSpatial({
            listener: listenerPosition,
            source: sourcePosition,
            ability,
            phase: cue.phase,
            isSelf: actorUserId === myId && !eventSourcePosition,
          });
      const playbackRate = getChannelSoundPlaybackRate({
        ability,
        actor: actorState,
        abilityId: evt.abilityId,
        abilityInstanceId: typeof evt.abilityInstanceId === 'string' ? evt.abilityInstanceId : undefined,
        phase: cue.phase,
      });
      const loopDurationMs = cue.loopDuringChannel
        ? getChannelSoundLoopDurationMs({
            ability,
            actor: actorState,
            abilityId: evt.abilityId,
            phase: cue.phase,
          })
        : undefined;
      const channelSoundKey = isChannelStartCue({ ability, event: evt, phase: cue.phase })
        ? eventChannelSoundKey
        : undefined;
      if (channelSoundKey) {
        activeChannelSoundKeysRef.current.add(channelSoundKey);
        if (cue.finishAfterChannelComplete) {
          channelSoundFinishAfterCompleteKeysRef.current.add(channelSoundKey);
        } else {
          channelSoundFinishAfterCompleteKeysRef.current.delete(channelSoundKey);
        }
      }

      void playAbilitySound({
        url: cue.url,
        volume: abilitySoundSettings.disabled ? 0 : spatial.volume * (abilitySoundSettings.volumePercent / 100) * ABILITY_SOUND_VOLUME_OUTPUT_SCALE,
        pan: spatial.pan,
        abilityId: evt.abilityId,
        abilityName: ability?.name ?? evt.abilityName,
        actorUserId,
        phase: cue.phase,
        playbackRate: cue.playbackRate ?? playbackRate,
        fitToDurationMs: cue.fitToDurationMs,
        preservePitch: cue.preservePitch,
        normalizeVolume: cue.normalizeVolume,
        loopDurationMs,
        extraSounds: cue.extraSounds,
        channelSoundKey,
      });
    };

    for (const evt of newEvents) {
      // WS array patches can momentarily produce sparse event slices.
      // Ignore empty/malformed entries instead of crashing the whole arena.
      if (!evt || typeof evt !== 'object' || !('type' in evt)) continue;
      playSoundForEvent(evt);
      if (evt.type === 'COMBAT_STATUS' && evt.targetUserId === myId) {
        if ((evt as any).combatStatus === 'enter' || (evt as any).inCombat === true) {
          showInGameWarning('进入战斗');
        } else {
          showInGameWarning('离开战斗');
        }
      } else if (evt.type === 'PLAY_ABILITY' && evt.abilityId === 'dou_zhuan_xing_yi') {
        lastInstantSwapCastAtRef.current = performance.now();
      } else if (evt.type === 'DAMAGE' && (((evt.value ?? 0) > 0) || (evt as any).displayZeroDamage === true) && (evt as any).effectType !== 'YING_TIAN_SHIELD') {
        const damageWasCrit = isCritDamageEvent(evt);
        const eventLabel = (evt as any).hideAbilityName === true ? '' : evt.abilityName;
        const displayZeroDamage = (evt as any).displayZeroDamage === true;
        const zeroDamageText = eventLabel ? `${eventLabel}： -1` : '-1';
        if (evt.targetUserId === myId) {
          if (!selectedTargetRef.current && !selectedEntityRef.current && !selectedSelfRef.current && evt.actorUserId && evt.actorUserId !== myId) {
            const attackerStillPresent = visibleOpponentsList.some((o) => o.userId === evt.actorUserId);
            if (attackerStillPresent) {
              setSelectedTargetId(evt.actorUserId);
              selectedTargetRef.current = evt.actorUserId;
              setSelectedSelf(false);
              selectedSelfRef.current = false;
            }
          }
          if (displayZeroDamage) {
            addFloat(0, 'dmg_taken', { text: zeroDamageText, allowZero: true, white: true });
          } else {
            // I took damage — determine 化解 (shield absorption) display
            const shieldAbs = evt.shieldAbsorbed ?? 0;
            const totalDmg = evt.value ?? 0;
            if (shieldAbs >= totalDmg) {
            // Fully blocked by shield — show 化解 only
              addFloat(1, 'huajie', { text: '化解' });
            } else if (shieldAbs > 0) {
            // Partially blocked — show 化解 and the HP damage that got through
              addFloat(1, 'huajie', { text: '化解' });
              addFloat(totalDmg - shieldAbs, 'dmg_taken', { label: eventLabel, isCrit: damageWasCrit });
            } else {
            // No shield involved — normal damage float
              addFloat(evt.value, 'dmg_taken', { label: eventLabel, isCrit: damageWasCrit });
            }
          }
        } else if (evt.actorUserId === myId) {
          // I dealt damage to opponent — account for shield absorption
          const shieldAbsAtk = evt.shieldAbsorbed ?? 0;
          const totalDmgAtk = evt.value ?? 0;
          const bounds = evt.entityId
            ? entityScreenBoundsRef.current[evt.entityId] ?? oppScreenBoundsRef.current
            : oppScreenBoundsRef.current;
          const { w, h } = canvasSizeRef.current;
          const screenPct = bounds
            ? { x: bounds.cx / w, y: Math.max(0, (bounds.topY - 55) / h) }
            : undefined;
          if (displayZeroDamage) {
            addFloat(0, 'dmg_dealt', { text: zeroDamageText, screenPct, allowZero: true, white: true });
          } else if (shieldAbsAtk >= totalDmgAtk) {
            // Fully absorbed by opponent's shield
            addFloat(1, 'huajie', { text: '化解', screenPct });
          } else if (shieldAbsAtk > 0) {
            // Partially absorbed — show net HP damage + 化解
            addFloat(totalDmgAtk - shieldAbsAtk, 'dmg_dealt', { label: eventLabel, screenPct, isCrit: damageWasCrit });
            addFloat(1, 'huajie', { text: '化解', screenPct });
          } else {
            addFloat(evt.value, 'dmg_dealt', { label: eventLabel, screenPct, isCrit: damageWasCrit });
          }
        }
      } else if (evt.type === 'HEAL' && (evt.value ?? 0) > 0 && evt.targetUserId === myId
               && (evt as any).effectType !== 'YING_TIAN_SHIELD') {
        // Heal — fixed position (x=60%, y=60%)
        addFloat(evt.value, 'heal', { label: evt.abilityName, isCrit: (evt as any).isCrit === true });
      } else if (evt.type === 'DODGE' && evt.targetUserId === myId) {
        showInGameWarning(`警告：${evt.abilityName ?? '技能'}被闪避`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, me?.userId, showInGameWarning, visibleOpponentsList]);

  useEffect(() => {
    const activeKeys = new Set<string>();
    const collectActiveChannel = (player: { userId?: string; activeChannel?: ActiveChannel; buffs?: ActiveBuff[] } | null | undefined) => {
      const key = getChannelSoundKey(player?.userId, player?.activeChannel?.abilityId, player?.activeChannel?.instanceId);
      if (key) activeKeys.add(key);

      for (const buff of player?.buffs ?? []) {
        const ability = (buff.sourceAbilityId ? abilities?.[buff.sourceAbilityId] : undefined) ?? channelAbilityByBuffId.get(buff.buffId);
        const channel = getRuntimeAbilityChannel(ability);
        if (!ability || channel?.source !== 'BUFF') continue;
        if (typeof channel.buffId === 'number' && channel.buffId !== buff.buffId) continue;
        const buffKey = getChannelSoundKey(player?.userId, ability.id, undefined);
        if (buffKey) activeKeys.add(buffKey);
      }
    };

    collectActiveChannel(me);
    for (const opponentEntry of opponentsList) {
      collectActiveChannel(opponentEntry);
    }

    for (const previousKey of activeChannelSoundKeysRef.current) {
      if (!activeKeys.has(previousKey)) {
        stopAbilityChannelSound(previousKey);
      }
    }

    activeChannelSoundKeysRef.current = activeKeys;
  }, [abilities, channelAbilityByBuffId, me, opponentsList]);

  useEffect(() => () => {
    for (const key of activeChannelSoundKeysRef.current) {
      stopAbilityChannelSound(key);
    }
    activeChannelSoundKeysRef.current.clear();
    channelSoundFinishAfterCompleteKeysRef.current.clear();
  }, []);

  // Warn when a targeted channel is interrupted because target became untargetable (e.g. entered stealth).
  useEffect(() => {
    const prev = prevActiveChannelRef.current;
    const curr = me?.activeChannel ?? null;

    if (prev && !curr) {
      const targetIsOpponent = !!prev.targetUserId && prev.targetUserId !== me.userId;
      const elapsedMs = Math.max(0, Date.now() - (prev.startedAt ?? 0));
      const interruptedEarly = elapsedMs + 120 < (prev.durationMs ?? 0);
      if (targetIsOpponent && interruptedEarly) {
        const target = opponentsList.find((o) => o.userId === prev.targetUserId);
        const targetLost = !target || blocksTargetingClient(target.buffs);
        if (targetLost) {
          showInGameWarning('警告：目标丢失，运功中断');
        }
      }
    }

    prevActiveChannelRef.current = curr ? { ...curr } : null;
  }, [me?.activeChannel, me?.userId, opponentsList, showInGameWarning]);

  /* --- Track opponent hand cooldown resets (kept for other UI purposes) --- */
  const prevOppHandRef      = useRef<any[]>([]);

  /* ========================= MOVEMENT ========================= */

  const sendMovement = useCallback(async () => {
    const k = keysRef.current;
    const mouseLook = controlModeRef.current === 'traditional' && mouseStateRef.current.isRight;
    const bothMouse = mouseStateRef.current.isRight && mouseStateRef.current.isLeft;
    // Capture & clear jump flag atomically before the async POST
    const shouldJump = jumpSendRef.current && !jumpLockedRef.current;
    if (jumpSendRef.current) jumpSendRef.current = false;
    const dashFacingLocked = !!meActiveDashRef.current && !dashTurnOverrideRef.current;
    const facingInputLocked = movementControlStateRef.current.fullyLocked || movementControlStateRef.current.rooted;
    let facingPayload = { ...meFacingRef.current };
    let directionPayload:
      | { dx: number; dy: number; jump: boolean; backpedalOnly?: boolean }
      | { up: boolean; down: boolean; left: boolean; right: boolean; jump: boolean }
      | null = null;

    const fearedSourceUserId = movementControlStateRef.current.fearedSourceUserId;
    const fearedSourcePos = fearedSourceUserId ? opponentPositionsRef.current[fearedSourceUserId] : null;
    const fearOrigin = localPositionRef.current;
    const fearedDirection = fearOrigin && fearedSourcePos
      ? normalizePlanar(fearOrigin.x - fearedSourcePos.x, fearOrigin.y - fearedSourcePos.y)
      : null;
    const shiXinGuDirection = movementControlStateRef.current.shiXinGuDirection;
    const shiXinGuStandstill = movementControlStateRef.current.shiXinGuStandstill === true;
    const channelMovementLocked = movementControlStateRef.current.channelMovementLocked === true;
    const lingRanJumpLockImmune = lingRanTianFengActiveRef.current;

    if (channelMovementLocked) {
      directionPayload = { dx: 0, dy: 0, jump: lingRanJumpLockImmune ? shouldJump : false };
    } else if (fearedDirection) {
      directionPayload = { dx: fearedDirection.x, dy: fearedDirection.y, jump: false };
      if (!dashFacingLocked && !facingInputLocked) {
        facingPayload = fearedDirection;
      }
    } else if (shiXinGuDirection) {
      directionPayload = { dx: shiXinGuDirection.x, dy: shiXinGuDirection.y, jump: false };
      if (!dashFacingLocked && !facingInputLocked) {
        facingPayload = shiXinGuDirection;
      }
    } else if (shiXinGuStandstill) {
      directionPayload = { dx: 0, dy: 0, jump: false };
    } else if (controlModeRef.current === 'traditional') {
      const moveIntent = buildTraditionalMoveIntent(
        k,
        mouseLook,
        bothMouse,
        camYawRef.current,
        charYawRef.current,
      );
      if (moveIntent.direction) {
        directionPayload = {
          dx: moveIntent.direction.dx,
          dy: moveIntent.direction.dy,
          jump: shouldJump,
          backpedalOnly: moveIntent.backpedalOnly,
        };
      } else if (shouldJump) {
        directionPayload = { dx: 0, dy: 0, jump: true };
      }

      if (!dashFacingLocked && !facingInputLocked && mouseLook) {
        facingPayload = {
          x: Math.sin(camYawRef.current),
          y: -Math.cos(camYawRef.current),
        };
      } else if (!dashFacingLocked && !facingInputLocked && moveIntent.direction && !moveIntent.backpedalOnly) {
        const facingDir = normalizePlanar(moveIntent.direction.dx, moveIntent.direction.dy);
        if (facingDir) facingPayload = facingDir;
      } else if (!dashFacingLocked && !facingInputLocked) {
        facingPayload = {
          x: Math.sin(charYawRef.current),
          y: -Math.cos(charYawRef.current),
        };
      }
    } else if (joystickDirRef.current) {
      const jd = joystickDirRef.current;
      const mag = Math.sqrt(jd.dx * jd.dx + jd.dy * jd.dy);
      if (mag >= 0.01 || shouldJump) {
        directionPayload = { dx: jd.dx, dy: jd.dy, jump: shouldJump };
      }
      if (!dashFacingLocked && !facingInputLocked) {
        const facingDir = normalizePlanar(jd.dx, jd.dy);
        if (facingDir) facingPayload = facingDir;
      }
    } else {
      if (k.w || k.a || k.s || k.d || shouldJump) {
        directionPayload = { up: k.s, down: k.w, left: k.a, right: k.d, jump: shouldJump };
      }
      if (!dashFacingLocked && !facingInputLocked) {
        const facingDir = normalizePlanar(
          (k.a ? -1 : 0) + (k.d ? 1 : 0),
          (k.w ? 1 : 0) + (k.s ? -1 : 0),
        );
        if (facingDir) facingPayload = facingDir;
      }
    }

    if (!facingInputLocked) {
      meFacingRef.current = facingPayload;
    }
    const seq = ++movementSeqRef.current;
    try {
      const res = await fetch('/api/game/movement', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gameId,
          seq,
          // Server-facing is authoritative for ability logic and stays camera-forward
          // during RMB strafing / RMB diagonals even if the local avatar is rendered sideways.
          facing: {
            x: facingPayload.x,
            y: facingPayload.y,
          },
          direction: directionPayload,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const now = Date.now();
        if (now - lastMovementRecoverAtRef.current > 2000) {
          lastMovementRecoverAtRef.current = now;
          console.warn('[BattleArena] movement update failed; requesting fresh snapshot', err ?? res.status);
          onMovementRecover?.();
        }
      }
    } catch { /* AbortError expected */ }
  }, [gameId, onMovementRecover]);

  useEffect(() => {
    if (me?.position && !initializedRef.current) {
      localPositionRef.current = { ...me.position };
      localZRef.current = (me.position as any).z ?? 0;
      groundBaseRef.current = localZRef.current;
      localRenderPosRef.current = { x: me.position.x, y: me.position.y, z: localZRef.current };
      initializedRef.current   = true;
    }
  }, [me?.position?.x, me?.position?.y, (me?.position as any)?.z]);

  useEffect(() => {
    if (!me?.position || !initializedRef.current) return;
    const local  = localPositionRef.current;
    if (!local) return;
    const dx = me.position.x - local.x;
    const dy = me.position.y - local.y;
    const activeDash = (me as any)?.activeDash;
    const forcedDisplacement = buffsHaveAnyEffect(me?.buffs, ['KNOCKED_BACK', 'PULLED']);

    // Collision-test mode: both client and backend now use BVH collision, so we can
    // reconcile position normally. Only skip reconciliation on dash (server owns dash).
    if (mode === 'collision-test') {
      if (activeDash && activeDash.ticksRemaining > 0) {
        meActiveDashRef.current = activeDash;
        localPositionRef.current = { ...me.position };
        localZRef.current  = (me.position as any).z ?? 0;
        localVzRef.current = 0;
        bvhCenterYInitRef.current = false; // resync cylinder center after dash
        return;
      }

      if (!collisionReadyRef.current) {
        const serverZ = (me.position as any).z ?? 0;
        localPositionRef.current = { ...me.position };
        localZRef.current = serverZ;
        localRenderPosRef.current = {
          x: me.position.x,
          y: me.position.y,
          z: serverZ,
        };
        return;
      }
      // Fall through to standard smooth reconciliation (fixes jump-range mismatch between
      // client prediction and server-authoritative BVH result).
    }

    const justCastInstantSwap =
      performance.now() - lastInstantSwapCastAtRef.current < 600;
    if (justCastInstantSwap && dx * dx + dy * dy > 0.01) {
      const serverZ = (me.position as any).z ?? 0;
      localPositionRef.current = { ...me.position };
      localZRef.current = serverZ;
      localVzRef.current = 0;
      localDashAnimRef.current = null;
      localRenderPosRef.current = {
        x: me.position.x,
        y: me.position.y,
        z: serverZ,
      };
      return;
    }

    // Hard-snap if server position is far away (e.g. new battle start).
    // This must also snap the render ref; otherwise the local character can
    // still fall into the old cosmetic dash easing for 5-20u corrections.
    if (dx * dx + dy * dy > 25) {
      const serverZ = (me.position as any).z ?? 0;
      localPositionRef.current = { ...me.position };
      localZRef.current = serverZ;
      localVzRef.current = 0;
      localDashAnimRef.current = null;
      localRenderPosRef.current = {
        x: me.position.x,
        y: me.position.y,
        z: serverZ,
      };
      return;
    }

    const recentDashSnap =
      performance.now() - lastObservedServerDashAtRef.current < 400 ||
      performance.now() - lastFengLiuYunSanCastAtRef.current < 700;

    // During active dash: server owns position — hard-snap XY + Z
    // Check me.activeDash directly (not ref) so this works even before React
    // fires the activeDash tracking useEffect on this render cycle.
    if (activeDash && activeDash.ticksRemaining > 0) {
      meActiveDashRef.current = activeDash;
      localPositionRef.current = { ...me.position };
      localZRef.current  = (me.position as any).z ?? 0;
      localVzRef.current = 0;
      return;
    }

    if (recentDashSnap && dx * dx + dy * dy > 0.01) {
      const serverZ = (me.position as any).z ?? 0;
      localPositionRef.current = { ...me.position };
      localZRef.current = serverZ;
      localVzRef.current = 0;
      localDashAnimRef.current = null;
      localRenderPosRef.current = {
        x: me.position.x,
        y: me.position.y,
        z: serverZ,
      };
      return;
    }

    if (forcedDisplacement && dx * dx + dy * dy > 0.01) {
      const serverZ = (me.position as any).z ?? 0;
      localPositionRef.current = { ...me.position };
      localZRef.current = serverZ;
      localVzRef.current = 0;
      localDashAnimRef.current = null;
      localRenderPosRef.current = {
        x: me.position.x,
        y: me.position.y,
        z: serverZ,
      };
      return;
    }

    // Reconcile Z with softer airborne correction to avoid double-jump snap.
    // When the client just jumped locally, trust prediction more briefly.
    const serverZ = (me.position as any).z ?? 0;
    const localZ  = localZRef.current;
    const zError = serverZ - localZ;
    const airborneLocal =
      localJumpCountRef.current > 0 ||
      Math.abs(localVzRef.current) > 0.01 ||
      localZ > groundHRef.current + 0.05;
    const justJumpedLocally = performance.now() - lastJumpInputAtRef.current < 260;
    const hardSnapThreshold = airborneLocal ? (justJumpedLocally ? 6.6 : 4.4) : 2.64;
    const settleThreshold = airborneLocal ? 0.132 : 0.044;
    const zBlend = airborneLocal ? (justJumpedLocally ? 0.08 : 0.16) : 0.35;
    const shouldSoftReconcile = !airborneLocal || !justJumpedLocally || Math.abs(zError) > 0.66;
    if (Math.abs(zError) > hardSnapThreshold) {
      localZRef.current = serverZ;
      if (!airborneLocal || serverZ <= groundHRef.current + 0.05) {
        localVzRef.current = 0;
      }
      bvhCenterYInitRef.current = false; // large Z snap — resync sphere center next tick
    } else if (shouldSoftReconcile) {
      localZRef.current = localZ + zError * zBlend;
      if (Math.abs(serverZ - localZRef.current) < settleThreshold) {
        localZRef.current = serverZ;
      }
    }
    const moving = keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d;
    const blend  = airborneLocal && justJumpedLocally ? 0 : moving ? 0.03 : 0.25;
    localPositionRef.current = {
      x: local.x + dx * blend,
      y: local.y + dy * blend,
    };
  }, [me?.position?.x, me?.position?.y, (me?.position as any)?.z]);

  useEffect(() => {
    if (!opponent?.position) return;
    opponentRawRef.current = opponent.position;
    if (!opponentPositionBufferRef) {
      const now    = performance.now();
      internalOpponentBufferRef.current.push({ t: now, pos: { ...opponent.position } });
      const cutoff = now - 1000;
      internalOpponentBufferRef.current = internalOpponentBufferRef.current.filter(e => e.t >= cutoff);
    }
  }, [opponent?.position?.x, opponent?.position?.y, opponentPositionBufferRef]);

  useEffect(() => {
    // ── Draft abilities: sourced from me.hand (only non-common abilities) ──
    const getDisplayMaxCooldown = (ab: any): number => {
      const base = ab?.cooldownTicks ?? 0;
      const gcdWindow = ab?.gcd === true ? BASE_GCD_WINDOW_TICKS : 0;
      return Math.max(base, gcdWindow);
    };
    const getSharedGcdTicks = (ab: any): number => (
      ab?.gcd === true ? Math.max(0, Number(me?.globalGcdTicks ?? 0)) : 0
    );
    const getChargeDisplay = (ab: any, instance: any) => {
      const maxCharges = Math.max(0, Number(ab?.maxCharges ?? 0));
      const sharedGcdTicks = getSharedGcdTicks(ab);
      if (maxCharges <= 1) {
        const currentCooldown = Math.max(0, Number(instance?.cooldown ?? 0), sharedGcdTicks);
        return {
          maxCharges: undefined,
          chargeCount: undefined,
          chargeRecoveryTicks: undefined,
          chargeRegenTicksRemaining: undefined,
          chargeRegenProgress: undefined,
          chargeCastLockTicks: undefined,
          chargeLockTicks: undefined,
          cooldown: currentCooldown,
          maxCooldown: Math.max(getDisplayMaxCooldown(ab), currentCooldown),
        };
      }

      const chargeCount = typeof instance?.chargeCount === 'number' ? instance.chargeCount : maxCharges;
      const chargeRecoveryTicks = Math.max(1, Number(ab?.chargeRecoveryTicks ?? ab?.cooldownTicks ?? 1));
      const chargeRegenTicksRemaining = Math.max(0, Number(instance?.chargeRegenTicksRemaining ?? 0));
      const chargeRegenProgress = chargeCount < maxCharges
        ? Math.max(0, Math.min(1, 1 - (chargeRegenTicksRemaining / chargeRecoveryTicks)))
        : undefined;
      const chargeCastLockTicks = Math.max(0, Number(ab?.chargeCastLockTicks ?? 0));
      const chargeLockTicks = Math.max(0, Number(instance?.chargeLockTicks ?? 0), sharedGcdTicks);

      if (chargeCount <= 0) {
        return {
          maxCharges,
          chargeCount,
          chargeRecoveryTicks,
          chargeRegenTicksRemaining,
          chargeRegenProgress,
          chargeCastLockTicks,
          chargeLockTicks,
          cooldown: chargeRegenTicksRemaining,
          maxCooldown: chargeRecoveryTicks,
        };
      }

      if (chargeLockTicks > 0) {
        return {
          maxCharges,
          chargeCount,
          chargeRecoveryTicks,
          chargeRegenTicksRemaining,
          chargeRegenProgress,
          chargeCastLockTicks,
          chargeLockTicks,
          cooldown: chargeLockTicks,
          maxCooldown: Math.max(1, chargeCastLockTicks),
        };
      }

      return {
        maxCharges,
        chargeCount,
        chargeRecoveryTicks,
        chargeRegenTicksRemaining,
        chargeRegenProgress,
        chargeCastLockTicks,
        chargeLockTicks,
        cooldown: 0,
        maxCooldown: chargeRecoveryTicks,
      };
    };
    const selectedTarget = selectedTargetId
      ? targetableOpponentsList.find((o) => o.userId === selectedTargetId) ?? null
      : null;
    const selectedEntity = selectedEntityId
      ? visibleEntities.find((entity) => entity.id === selectedEntityId) ?? null
      : null;
    const selectedSelfTarget = selectedSelf ? me : null;
    const getAbilityTargetContext = (ab: any) => {
      const friendlyTarget = ab?.target === 'OPPONENT' && ab?.friendlyTarget === true;
      const validSelfTarget = selectedSelfTarget && (friendlyTarget || ab?.canTargetSelf) ? selectedSelfTarget : null;
      const validPlayerTarget = friendlyTarget ? null : selectedTarget;
      const validEntityTarget = selectedEntity && (
        friendlyTarget
          ? selectedEntity.ownerUserId === me.userId
          : selectedEntity.ownerUserId !== me.userId && !blocksTargetingClient(selectedEntity.buffs)
      ) ? selectedEntity : null;
      const hasSelectedTarget = !!validSelfTarget || !!validPlayerTarget || !!validEntityTarget;
      const fallbackTarget = friendlyTarget ? null : targetableOpponentsList[0] ?? targetableEntityList[0] ?? null;
      const targetForChecks = validSelfTarget ?? validPlayerTarget ?? validEntityTarget ?? fallbackTarget;
      return {
        friendlyTarget,
        selfTarget: validSelfTarget,
        playerTarget: validPlayerTarget,
        entityTarget: validEntityTarget,
        hasSelectedTarget,
        targetForChecks,
        targetPos: targetForChecks?.position,
      };
    };
    const myPos = me.position ?? localPositionRef.current;
    const myFacing = me.facing ?? meFacingRef.current;
    const qinggongSealed = hasQinggongSealClient(me.buffs);
    const disarmed = hasDisarmClient(me.buffs);
    const nonQinggongLocked = hasNonQinggongLockClient(me.buffs);
    const rootedByDebuff = buffsHaveAnyEffect(me.buffs, ['ROOT']);
    const yuqiMounted = hasYuqiStateClient(me.buffs);

    const isAbilityReady = (ab: any, instance: any): boolean => {
      const targetContext = getAbilityTargetContext(ab);
      const targetForChecks = targetContext.targetForChecks;
      const targetPos = targetContext.targetPos;
      const abilityIdForChecks = ab?.id ?? instance?.abilityId;
      const sharedGcdTicks = getSharedGcdTicks(ab);
      const isQinggongLike = ab?.qinggong === true || ab?.qinggongGcdImmune === true;
      const mountedYuqiToggle = yuqiMounted && (ab?.id === 'yuqi' || instance?.abilityId === 'yuqi');
      const maxCharges = Math.max(0, Number(ab?.maxCharges ?? 0));
      if (maxCharges > 1) {
        const chargeCount = typeof instance?.chargeCount === 'number' ? instance.chargeCount : maxCharges;
        const chargeLockTicks = Math.max(0, Number(instance?.chargeLockTicks ?? 0), sharedGcdTicks);
        if (chargeLockTicks > 0) return false;
        if (chargeCount <= 0) return false;
      } else if (Math.max(0, Number(instance?.cooldown ?? 0), sharedGcdTicks) > 0) {
        return false;
      }
      const airborneLockedLocal =
        jumpLocalRef.current ||
        jumpSendRef.current ||
        localJumpCountRef.current > 0 ||
        Math.abs(localVzRef.current) > 0.01;
      if (ab?.requiresGrounded && airborneLockedLocal) return false;
      if (yuqiMounted && !mountedYuqiToggle && ab?.canCastWhileMounted !== true) return false;
      if (requiresStandingAtCastClient(ab) && !mountedYuqiToggle) {
        if (isStandingCastBlocked(wasdKeys)) return false;
      }
      if (typeof ab?.minSelfHpExclusive === 'number' && (me?.hp ?? 0) <= ab.minSelfHpExclusive) {
        return false;
      }
      if (typeof ab?.minSelfHpPercentExclusive === 'number') {
        const requiredHp = Math.max(1, Number(me?.maxHp ?? maxHp)) * (ab.minSelfHpPercentExclusive / 100);
        if ((me?.hp ?? 0) <= requiredHp) return false;
      }
      if (getPowerLockWarningClient(ab, me.buffs)) return false;
      if (disarmed && ab?.noWeaponRequired !== true) return false;
      if (nonQinggongLocked && !isQinggongLike) return false;
      if (isQinggongLike && qinggongSealed) return false;
      if (ab?.cannotCastWhileRooted && rootedByDebuff) return false;
      if (abilityIdForChecks === 'ren_chi_cheng' && isLingRanSpecialJumpActiveClient(me)) return false;

      // 拿云式: target HP must be < 30%
      if (ab?.id === 'na_yun_shi' || instance?.abilityId === 'na_yun_shi') {
        const tgtHp = (targetForChecks as any)?.hp ?? Infinity;
        const tgtMaxHp = Math.max(1, Number((targetForChecks as any)?.maxHp ?? 100));
        if (tgtHp >= tgtMaxHp * 0.3) return false;
      }
      // 梯云纵 / 扶摇直上 mutual exclusion (mirrors backend gate)
      if (ab?.id === 'ti_yun_zong' || instance?.abilityId === 'ti_yun_zong') {
        const now = Date.now();
        if ((me.buffs ?? []).some((b: any) => b.buffId === 9001 && b.expiresAt > now)) return false;
      }
      if (ab?.id === 'fuyao_zhishang' || instance?.abilityId === 'fuyao_zhishang') {
        const now = Date.now();
        if ((me.buffs ?? []).some((b: any) => b.buffId === 9003 && b.expiresAt > now)) return false;
      }

      // Ground-target abilities always ready regardless of target selection or range
      if (ab?.target === 'OPPONENT' && !!ab?.allowGroundCastWithoutTarget) return true;

      const needsSelectedTarget = ab?.target === 'OPPONENT' && !ab?.allowGroundCastWithoutTarget;
      if (needsSelectedTarget && targetContext.selfTarget && !targetContext.friendlyTarget && !ab?.canTargetSelf) return false;
      if (needsSelectedTarget && targetContext.friendlyTarget && !targetContext.hasSelectedTarget) return false;
      if (needsSelectedTarget && !targetPos) return false;
      if ((ab?.id === 'hong_meng_tian_jin' || instance?.abilityId === 'hong_meng_tian_jin') && hasShuSeClient((targetForChecks as any)?.buffs)) {
        return false;
      }
      if (ab?.id === 'dou_zhuan_xing_yi' || instance?.abilityId === 'dou_zhuan_xing_yi') {
        if (targetContext.entityTarget) return false;
        if (hasMianLaClient((targetForChecks as any)?.buffs)) return false;
      }
      if (ab?.id === 'qin_yin_gong_ming' || instance?.abilityId === 'qin_yin_gong_ming') {
        if (targetContext.entityTarget) return false;
      }
      if (abilityIdForChecks === 'you_feng_piao_zong' && !targetContext.playerTarget) {
        return false;
      }

      if (ab?.target !== 'OPPONENT') return true;

      const distanceToTarget = (myPos && targetPos)
        ? worldUnitsToNewUnits(Math.sqrt(
            Math.pow(targetPos.x - myPos.x, 2) +
            Math.pow(targetPos.y - myPos.y, 2) +
            Math.pow(((targetPos as any)?.z ?? 0) - ((myPos as any)?.z ?? 0), 2)
          ), mode)
        : Infinity;
      const effectiveRange = getEffectiveAbilityRangeClient(ab, me?.buffs);
      const inMaxRange = !effectiveRange || distanceToTarget <= effectiveRange;
      const inMinRange = !ab?.minRange || distanceToTarget >= ab.minRange;
      if (!inMaxRange || !inMinRange) return false;

      if (ab?.target === 'OPPONENT' && myPos && targetPos && !targetContext.selfTarget && !targetContext.friendlyTarget) {
        if (requiresFacingByDefault(ab) && myFacing) {
          const dx = targetPos.x - myPos.x;
          const dy = targetPos.y - myPos.y;
          if (myFacing.x * dx + myFacing.y * dy < 0) return false;
        }
          const myZ2 = (myPos as any)?.z ?? localZRef.current ?? 0;
          const tgtZ2 = (targetPos as any)?.z ?? 0;
          if (isClientLineBlocked(myPos, targetPos, myZ2, tgtZ2, targetContext.entityTarget?.id)) {
            return false;
          }
      }
      return true;
    };

    const antiStealthActive = hasAntiStealthClient(me?.buffs);

    let draftFallbackSlotIndex = 0;
    const draftUpdated: AbilityInfo[] = me.hand
      .map((instance: any) => {
        const ability =
          (instance.abilityId && abilities[instance.abilityId]) ||
          (instance.id    && abilities[instance.id])     ||
          (instance.name  ? instance : null);

        // Skip common abilities — they are shown in the top row independently
        if (ability?.isCommon) return null;
        const fallbackSlotIndex = draftFallbackSlotIndex;
        draftFallbackSlotIndex += 1;

        const instanceId = instance.instanceId || instance.id || String(Math.random());
        if (!ability) {
          console.warn('[BattleArena] ability lookup failed for hand item:', instance);
          return {
            id:          instanceId,
            abilityId:      instance.abilityId || instance.id || instanceId,
            name:        instance.name || instance.abilityId || instance.id || '?',
            description: instance.description ?? '',
            channel:     undefined,
            range:       undefined as number | undefined,
            baseRange:   undefined as number | undefined,
            minRange:    undefined as number | undefined,
            baseCooldownTicks: 0,
            cooldown:    instance.cooldown || 0,
            maxCooldown: 0,
            isReady:     isAbilityReady(ability, instance),
            isCommon:    false,
            slotIndex:   normalizeDraftSlotIndex(instance.slotIndex, fallbackSlotIndex),
            target:      'OPPONENT' as 'SELF' | 'OPPONENT',
            minSelfHpExclusive: undefined,
            requiresGrounded: false,
            requiresStanding: false,
            qinggong: false,
            qinggongGcdImmune: false,
            cannotCastWhileRooted: false,
            allowGroundCastWithoutTarget: false,
          };
        }
        const chargeDisplay = getChargeDisplay(ability, instance);
        const isReadyVal = isAbilityReady(ability, instance);
        const antiStealthBlocked = antiStealthActive && abilityUsesStealthClient(ability);
        const disabledWarning = getPowerLockWarningClient(ability, me.buffs) ?? undefined;
        const effectiveRange = getEffectiveAbilityRangeClient(ability, me?.buffs);
        const targetContext = getAbilityTargetContext(ability);
        const losBlockedVal = !isReadyVal && (ability as any)?.target === 'OPPONENT' && !(ability as any)?.friendlyTarget && myPos && targetContext.targetPos
          ? isClientLineBlocked(
              myPos,
              targetContext.targetPos,
              (myPos as any)?.z ?? localZRef.current ?? 0,
              (targetContext.targetPos as any)?.z ?? 0,
              targetContext.entityTarget?.id,
            )
          : false;
        return {
          id:          instanceId,
          abilityId:      ability.id,
          name:        ability.name,
          iconPath:    ability.iconPath,
          description: ability.description ?? '',
          channel:     getRuntimeAbilityChannel(ability),
          range:       effectiveRange,
          baseRange:   typeof ability.range === 'number' ? ability.range : undefined,
          minRange:    ability.minRange,
          baseCooldownTicks: typeof ability.cooldownTicks === 'number' ? ability.cooldownTicks : undefined,
          cooldown:    chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          chargeRegenTicksRemaining: chargeDisplay.chargeRegenTicksRemaining,
          chargeRegenProgress: chargeDisplay.chargeRegenProgress,
          chargeCastLockTicks: chargeDisplay.chargeCastLockTicks,
          chargeLockTicks: chargeDisplay.chargeLockTicks,
          isReady:     isReadyVal,
          losBlocked:  losBlockedVal,
          isCommon:    false,
          slotIndex:   normalizeDraftSlotIndex(instance.slotIndex, fallbackSlotIndex),
          target:      (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
          friendlyTarget: !!(ability as any).friendlyTarget,
          canTargetSelf: !!(ability as any).canTargetSelf,
          faceDirection: requiresFacingByDefault(ability as any),
          minSelfHpExclusive: typeof (ability as any).minSelfHpExclusive === 'number' ? (ability as any).minSelfHpExclusive : undefined,
          minSelfHpPercentExclusive: typeof (ability as any).minSelfHpPercentExclusive === 'number' ? (ability as any).minSelfHpPercentExclusive : undefined,
          damageType: getAbilityDamageTypeClient(ability),
          noWeaponRequired: !!(ability as any).noWeaponRequired,
          canCastWhileMounted: !!(ability as any).canCastWhileMounted,
          requiresGrounded: !!(ability as any).requiresGrounded,
          requiresStanding: !!(ability as any).requiresStanding,
          qinggong: !!(ability as any).qinggong,
          qinggongGcdImmune: !!(ability as any).qinggongGcdImmune,
          cannotCastWhileRooted: !!(ability as any).cannotCastWhileRooted,
          allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,
          blockedByAntiStealth: antiStealthBlocked,
          disabledWarning,
        };
      })
      .filter(Boolean) as AbilityInfo[];

    const specialUpdated: AbilityInfo[] = getSpecialAbilityBarIdsClient(me.buffs)
      .slice(0, 6)
      .map((abilityId) => {
        const ability = abilities[abilityId];
        if (!ability) return null;
        const instance = me?.specialAbilityStates?.[ability.id] ?? { instanceId: ability.id, abilityId: ability.id, cooldown: 0 };
        const chargeDisplay = getChargeDisplay(ability, instance);
        const isReadyVal = isAbilityReady(ability, instance);
        const antiStealthBlocked = antiStealthActive && abilityUsesStealthClient(ability);
        const disabledWarning = getPowerLockWarningClient(ability, me.buffs) ?? undefined;
        const effectiveRange = getEffectiveAbilityRangeClient(ability, me?.buffs);
        return {
          id: ability.id,
          abilityId: ability.id,
          name: ability.name,
          iconPath: ability.iconPath,
          description: ability.description ?? '',
          channel: getRuntimeAbilityChannel(ability),
          range: effectiveRange,
          baseRange: typeof ability.range === 'number' ? ability.range : undefined,
          minRange: ability.minRange,
          baseCooldownTicks: typeof ability.cooldownTicks === 'number' ? ability.cooldownTicks : undefined,
          cooldown: chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          chargeRegenTicksRemaining: chargeDisplay.chargeRegenTicksRemaining,
          chargeRegenProgress: chargeDisplay.chargeRegenProgress,
          chargeCastLockTicks: chargeDisplay.chargeCastLockTicks,
          chargeLockTicks: chargeDisplay.chargeLockTicks,
          isReady: isReadyVal,
          losBlocked: false,
          isCommon: false,
          isSpecialBarAbility: true,
          target: (ability.target as 'SELF' | 'OPPONENT') ?? 'SELF',
          friendlyTarget: !!(ability as any).friendlyTarget,
          canTargetSelf: !!(ability as any).canTargetSelf,
          faceDirection: requiresFacingByDefault(ability as any),
          minSelfHpExclusive: typeof (ability as any).minSelfHpExclusive === 'number' ? (ability as any).minSelfHpExclusive : undefined,
          minSelfHpPercentExclusive: typeof (ability as any).minSelfHpPercentExclusive === 'number' ? (ability as any).minSelfHpPercentExclusive : undefined,
          damageType: getAbilityDamageTypeClient(ability),
          noWeaponRequired: !!(ability as any).noWeaponRequired,
          canCastWhileMounted: !!(ability as any).canCastWhileMounted,
          requiresGrounded: !!(ability as any).requiresGrounded,
          requiresStanding: !!(ability as any).requiresStanding,
          qinggong: !!(ability as any).qinggong,
          qinggongGcdImmune: !!(ability as any).qinggongGcdImmune,
          cannotCastWhileRooted: !!(ability as any).cannotCastWhileRooted,
          allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,
          blockedByAntiStealth: antiStealthBlocked,
          disabledWarning,
        } as AbilityInfo;
      })
      .filter(Boolean) as AbilityInfo[];

    // ── Common abilities: always built from preload abilities in fixed display order ──
    const cardValues: any[] = Object.values(abilities);
    const commonUpdated: AbilityInfo[] = COMMON_ABILITY_ORDER
      .map((orderedCardId) => {
        const ability = cardValues.find((c: any) => c.id === orderedCardId);
        if (!ability) return null;
        const instance = me.hand.find(
          (h: any) => (h.abilityId ?? h.id) === ability.id
        );
        const chargeDisplay = getChargeDisplay(ability, instance ?? {});
        const isReadyCom = isAbilityReady(ability, instance);
        const antiStealthBlocked = antiStealthActive && abilityUsesStealthClient(ability);
        const disabledWarning = getPowerLockWarningClient(ability, me.buffs) ?? undefined;
        const effectiveRange = getEffectiveAbilityRangeClient(ability, me?.buffs);
        const targetContext = getAbilityTargetContext(ability);
        const losBlockedCom = !isReadyCom && (ability as any)?.target === 'OPPONENT' && !(ability as any)?.friendlyTarget && myPos && targetContext.targetPos
          ? isClientLineBlocked(
              myPos,
              targetContext.targetPos,
              (myPos as any)?.z ?? localZRef.current ?? 0,
              (targetContext.targetPos as any)?.z ?? 0,
              targetContext.entityTarget?.id,
            )
          : false;
        return {
          id:          ability.id,
          abilityId:      ability.id,
          name:        ability.name,
          description: ability.description ?? '',
          channel:     getRuntimeAbilityChannel(ability),
          range:       effectiveRange,
          baseRange:   typeof ability.range === 'number' ? ability.range : undefined,
          minRange:    ability.minRange,
          baseCooldownTicks: typeof ability.cooldownTicks === 'number' ? ability.cooldownTicks : undefined,
          cooldown:    chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          chargeRegenTicksRemaining: chargeDisplay.chargeRegenTicksRemaining,
          chargeRegenProgress: chargeDisplay.chargeRegenProgress,
          chargeCastLockTicks: chargeDisplay.chargeCastLockTicks,
          chargeLockTicks: chargeDisplay.chargeLockTicks,
          isReady:     isReadyCom,
          losBlocked:  losBlockedCom,
          isCommon:    true,
          target:      (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
          friendlyTarget: !!(ability as any).friendlyTarget,
          canTargetSelf: !!(ability as any).canTargetSelf,
          faceDirection: requiresFacingByDefault(ability as any),
          minSelfHpExclusive: typeof (ability as any).minSelfHpExclusive === 'number' ? (ability as any).minSelfHpExclusive : undefined,
          minSelfHpPercentExclusive: typeof (ability as any).minSelfHpPercentExclusive === 'number' ? (ability as any).minSelfHpPercentExclusive : undefined,
          damageType: getAbilityDamageTypeClient(ability),
          noWeaponRequired: !!(ability as any).noWeaponRequired,
          canCastWhileMounted: !!(ability as any).canCastWhileMounted,
          requiresGrounded: !!(ability as any).requiresGrounded,
          requiresStanding: !!(ability as any).requiresStanding,
          qinggong: !!(ability as any).qinggong,
          qinggongGcdImmune: !!(ability as any).qinggongGcdImmune,
          cannotCastWhileRooted: !!(ability as any).cannotCastWhileRooted,
          allowGroundCastWithoutTarget: !!(ability as any).allowGroundCastWithoutTarget,
          blockedByAntiStealth: antiStealthBlocked,
          disabledWarning,
        } as AbilityInfo;
      })
      .filter(Boolean) as AbilityInfo[];

    const updated = [...commonUpdated, ...(specialUpdated.length > 0 ? specialUpdated : draftUpdated)];
    const pendingReorder = pendingDraftReorderRef.current;
    let nextUpdated = updated;
    if (pendingReorder) {
      const confirmed = updated.some((ability, fallbackIndex) => (
        ability.id === pendingReorder.instanceId
        && !ability.isCommon
        && !ability.isSpecialBarAbility
        && normalizeDraftSlotIndex(ability.slotIndex, fallbackIndex) === pendingReorder.toIndex
      ));
      if (confirmed) {
        pendingDraftReorderRef.current = null;
      } else {
        const predicted = predictDraftAbilityReorder(updated, pendingReorder.instanceId, pendingReorder.toIndex);
        if (predicted) nextUpdated = predicted;
      }
    }
    setHandAbilities(nextUpdated);
    abilitiesRef.current = nextUpdated;
  }, [
    me.hand,
    me.buffs,
    me.hp,
    me.position,
    me.facing,
    selectedTargetId,
    targetableOpponentsList,
    distance,
    abilities,
    wasdKeys,
    hasMovementIntent,
    isStandingCastBlocked,
  ]);

  /* ========================= PICKUP INTERACTION ========================= */

  const persistUiPositions = useCallback((positions: Record<string, UiPosition>) => {
    const viewport = {
      w: Math.round(canvasSizeRef.current.w),
      h: Math.round(canvasSizeRef.current.h),
    };
    storedUiViewportRef.current = viewport;
    void fetch('/api/game/ui-layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ positions, viewport }),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[BattleArena] persist ui layout failed:', res.status, text);
      }
    }).catch((err) => {
      console.error('[BattleArena] persist ui layout failed:', err);
    });
  }, []);

  const getUiPositionFromRef = useCallback((
    ref: React.RefObject<HTMLDivElement | null>,
    fallback: { left: number; top: number },
  ) => {
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const rect = ref.current?.getBoundingClientRect();
    if (!wrapRect || !rect || rect.width <= 0 || rect.height <= 0) {
      return fallback;
    }
    return {
      left: Math.max(12, Math.round(rect.left - wrapRect.left)),
      top: Math.max(12, Math.round(rect.top - wrapRect.top)),
    };
  }, []);

  const getUiPositionFromElement = useCallback((
    element: Element | null,
    fallback: { left: number; top: number },
  ) => {
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const rect = element?.getBoundingClientRect();
    if (!wrapRect || !rect || rect.width <= 0 || rect.height <= 0) {
      return fallback;
    }
    return {
      left: Math.max(12, Math.round(rect.left - wrapRect.left)),
      top: Math.max(12, Math.round(rect.top - wrapRect.top)),
    };
  }, []);

  const getDefaultPlayerStatusPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round(w / 2 - 180)),
      top: Math.max(12, Math.round(h - 190)),
    };
  }, []);

  const getDefaultTargetStatusPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round(w * 0.23)),
      top: Math.max(12, Math.round(h * 0.05 + 104)),
    };
  }, []);

  const getDefaultPlayerIconBarPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return getUiPositionFromRef(playerPanelRef, {
      left: Math.max(12, Math.round(w * 0.21)),
      top: Math.max(12, Math.round(h * 0.44 - 24)),
    });
  }, [getUiPositionFromRef]);

  const getDefaultHeartStatsPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return getUiPositionFromRef(heartDetailsRef, {
      left: Math.max(12, Math.round(w * 0.21)),
      top: Math.max(12, Math.round(h * 0.44 + 62)),
    });
  }, [getUiPositionFromRef]);

  const getDefaultTargetIconBarPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return getUiPositionFromRef(targetIconBarRef, {
      left: Math.max(12, Math.round(w * 0.23)),
      top: Math.max(12, Math.round(h * 0.05)),
    });
  }, [getUiPositionFromRef]);

  const getDefaultTargetTargetIconBarPos = useCallback(() => {
    const targetBase = getDefaultTargetIconBarPos();
    return getUiPositionFromRef(targetTargetIconBarRef, {
      left: targetBase.left + 276,
      top: targetBase.top,
    });
  }, [getDefaultTargetIconBarPos, getUiPositionFromRef]);

  const getDefaultTargetOwnedAbilityBarPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return getUiPositionFromRef(targetOwnedAbilityBarRef, {
      left: Math.max(12, Math.round(w * 0.23)),
      top: Math.max(12, Math.round(h * 0.05 + 170)),
    });
  }, [getUiPositionFromRef]);

  const getDefaultOwnedAbilityBarPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return getUiPositionFromRef(ownedAbilityBarRef, {
      left: Math.max(12, Math.round(w / 2 - 188)),
      top: Math.max(12, Math.round(h - 168)),
    });
  }, [getUiPositionFromRef]);

  const getDefaultHeightCounterPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round(w * 0.30 - 58)),
      top: Math.max(12, Math.round(h * 0.67)),
    };
  }, []);

  const getDefaultDistanceIndicatorPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round(w * 0.60 - 48)),
      top: Math.max(12, Math.round(h * 0.40 - 18)),
    };
  }, []);

  const getDefaultInGameWarningPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round(w / 2)),
      top: Math.max(12, Math.round(h * 0.16)),
    };
  }, []);

  const getDefaultItemBarPos = useCallback(() => {
    const { w } = canvasSizeRef.current;
    return getUiPositionFromRef(itemBarRef, {
      left: Math.max(12, Math.round(w / 2 - 330)),
      top: 24,
    });
  }, [getUiPositionFromRef]);

  const getDefaultPlayerChannelBarPos = useCallback(() => {
    const hotbarElement = ownedAbilityBarRef.current?.querySelector(`.${styles.hotbar}`);
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const hotbarRect = hotbarElement?.getBoundingClientRect();
    const fallback = wrapRect && hotbarRect
      ? {
          left: Math.max(12, Math.round(hotbarRect.left - wrapRect.left + (hotbarRect.width / 2) - (PLAYER_CHANNEL_BAR_FLOAT_WIDTH / 2))),
          top: Math.max(12, Math.round(hotbarRect.top - wrapRect.top - PLAYER_CHANNEL_BAR_DEFAULT_TOP_OFFSET)),
        }
      : {
          left: Math.max(12, Math.round((canvasSizeRef.current.w / 2) - (PLAYER_CHANNEL_BAR_FLOAT_WIDTH / 2))),
          top: Math.max(12, Math.round(canvasSizeRef.current.h - 222)),
        };
    const channelElement = ownedAbilityBarRef.current?.querySelector('[data-channel-bar-root="true"]');
    return getUiPositionFromElement(channelElement, fallback);
  }, [getUiPositionFromElement]);

  const getDefaultPlayerGcdBarPos = useCallback(() => {
    const hotbarElement = ownedAbilityBarRef.current?.querySelector(`.${styles.hotbar}`);
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const hotbarRect = hotbarElement?.getBoundingClientRect();
    const fallback = wrapRect && hotbarRect
      ? {
          left: Math.max(12, Math.round(hotbarRect.left - wrapRect.left + (hotbarRect.width / 2) - (PLAYER_GCD_BAR_FLOAT_WIDTH / 2))),
          top: Math.max(12, Math.round(hotbarRect.top - wrapRect.top - PLAYER_GCD_BAR_DEFAULT_TOP_OFFSET)),
        }
      : {
          left: Math.max(12, Math.round((canvasSizeRef.current.w / 2) - (PLAYER_GCD_BAR_FLOAT_WIDTH / 2))),
          top: Math.max(12, Math.round(canvasSizeRef.current.h - 194)),
        };
    const gcdElement = ownedAbilityBarRef.current?.querySelector('[data-gcd-bar-root="true"]');
    return getUiPositionFromElement(gcdElement, fallback);
  }, [getUiPositionFromElement]);

  /** Start a drag session for any draggable UI panel. Key is stored in localStorage. */
  const startUIDrag = useCallback((key: string, defaultPos: { left: number; top: number }, e: React.MouseEvent, options?: { persist?: boolean }) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    mouseStateRef.current.isLeft = false;
    mouseStateRef.current.isRight = false;
    manualCameraLookActiveRef.current = false;
    const startX = e.clientX, startY = e.clientY;
    const base = uiPositionsRef.current[key] ?? defaultPos;
    const shouldPersist = options?.persist !== false;
    const dragRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clampDragPosition = (position: UiPosition): UiPosition => {
      const viewport = canvasSizeRef.current;
      const maxLeft = Math.max(12, Math.round(viewport.w - dragRect.width - 12));
      const maxTop = Math.max(12, Math.round(viewport.h - dragRect.height - 12));
      return {
        left: Math.max(12, Math.min(maxLeft, Math.round(position.left))),
        top: Math.max(12, Math.min(maxTop, Math.round(position.top))),
      };
    };
    const onMove = (me: MouseEvent) => {
      const next = clampDragPosition({ left: base.left + me.clientX - startX, top: base.top + me.clientY - startY });
      setUiPositions(prev => ({
        ...prev,
        [key]: next,
      }));
      uiPositionsRef.current = { ...uiPositionsRef.current, [key]: next };
    };
    const onUp = (me: MouseEvent) => {
      const next = clampDragPosition({ left: base.left + me.clientX - startX, top: base.top + me.clientY - startY });
      setUiPositions(prev => {
        const updated = { ...prev, [key]: next };
        uiPositionsRef.current = updated;
        if (shouldPersist) persistUiPositions(updated);
        return updated;
      });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [persistUiPositions]);

  const startCustomUiPromptDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();

    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const promptRect = e.currentTarget.getBoundingClientRect();
    if (!wrapRect || promptRect.width <= 0 || promptRect.height <= 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const base = {
      left: Math.round(promptRect.left - wrapRect.left),
      top: Math.round(promptRect.top - wrapRect.top),
    };
    const clampPromptPosition = (position: UiPosition): UiPosition => {
      const viewport = canvasSizeRef.current;
      const maxLeft = Math.max(12, Math.round(viewport.w - promptRect.width - 12));
      const maxTop = Math.max(12, Math.round(viewport.h - promptRect.height - 12));
      return {
        left: Math.max(12, Math.min(maxLeft, Math.round(position.left))),
        top: Math.max(12, Math.min(maxTop, Math.round(position.top))),
      };
    };

    const onMove = (event: MouseEvent) => {
      setCustomUiPromptPos(clampPromptPosition({
        left: base.left + event.clientX - startX,
        top: base.top + event.clientY - startY,
      }));
    };
    const onUp = (event: MouseEvent) => {
      setCustomUiPromptPos(clampPromptPosition({
        left: base.left + event.clientX - startX,
        top: base.top + event.clientY - startY,
      }));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const openCustomUiMode = useCallback(() => {
    const snapshot = Object.fromEntries(
      Object.entries(uiPositionsRef.current).map(([key, pos]) => [key, { ...pos }]),
    ) as Record<string, UiPosition>;
    customUiSnapshotRef.current = snapshot;
    setShowTestingPanel(false);
    mouseStateRef.current.isLeft = false;
    mouseStateRef.current.isRight = false;
    manualCameraLookActiveRef.current = false;
    setCustomUiPromptPos(null);
    setUiPositions(prev => {
      const playerIconBase = prev[PLAYER_ICON_BAR_UI_KEY] ?? getDefaultPlayerIconBarPos();
      const playerBase = prev[LEGACY_PLAYER_STATUS_UI_KEY] ?? getDefaultPlayerStatusPos();
      const heartStatsBase = prev[HEART_STATS_UI_KEY] ?? getDefaultHeartStatsPos();
      const playerChannelBase = prev[PLAYER_CHANNEL_BAR_UI_KEY] ?? getDefaultPlayerChannelBarPos();
      const playerGcdBase = prev[PLAYER_GCD_BAR_UI_KEY] ?? getDefaultPlayerGcdBarPos();
      const targetIconBase = prev[TARGET_ICON_BAR_UI_KEY] ?? getDefaultTargetIconBarPos();
      const targetTargetIconBase = prev[TARGET_TARGET_ICON_BAR_UI_KEY] ?? getDefaultTargetTargetIconBarPos();
      const targetOwnedAbilityBase = prev[TARGET_OWNED_ABILITY_BAR_UI_KEY] ?? getDefaultTargetOwnedAbilityBarPos();
      const heightCounterBase = prev[HEIGHT_COUNTER_UI_KEY] ?? getDefaultHeightCounterPos();
      const distanceIndicatorBase = prev[DISTANCE_INDICATOR_UI_KEY] ?? getDefaultDistanceIndicatorPos();
      const inGameWarningBase = prev[IN_GAME_WARNING_UI_KEY] ?? getDefaultInGameWarningPos();
      const itemBarBase = prev[ITEM_BAR_UI_KEY] ?? getDefaultItemBarPos();
      const targetBase = getDefaultTargetStatusPos();
      const next = {
        ...prev,
        [PLAYER_ICON_BAR_UI_KEY]: playerIconBase,
        [HEART_STATS_UI_KEY]: heartStatsBase,
        [PLAYER_CHANNEL_BAR_UI_KEY]: playerChannelBase,
        [PLAYER_GCD_BAR_UI_KEY]: playerGcdBase,
        [PLAYER_BUFF_STATUS_UI_KEY]: prev[PLAYER_BUFF_STATUS_UI_KEY] ?? playerBase,
        [PLAYER_DEBUFF_STATUS_UI_KEY]: prev[PLAYER_DEBUFF_STATUS_UI_KEY] ?? {
          left: playerBase.left,
          top: playerBase.top + STATUS_BAR_VERTICAL_OFFSET,
        },
        [TARGET_ICON_BAR_UI_KEY]: targetIconBase,
        [TARGET_TARGET_ICON_BAR_UI_KEY]: targetTargetIconBase,
        [TARGET_OWNED_ABILITY_BAR_UI_KEY]: targetOwnedAbilityBase,
        [HEIGHT_COUNTER_UI_KEY]: heightCounterBase,
        [DISTANCE_INDICATOR_UI_KEY]: distanceIndicatorBase,
        [IN_GAME_WARNING_UI_KEY]: inGameWarningBase,
        [ITEM_BAR_UI_KEY]: itemBarBase,
        [TARGET_BUFF_STATUS_UI_KEY]: prev[TARGET_BUFF_STATUS_UI_KEY] ?? targetBase,
        [TARGET_DEBUFF_STATUS_UI_KEY]: prev[TARGET_DEBUFF_STATUS_UI_KEY] ?? {
          left: targetBase.left,
          top: targetBase.top + STATUS_BAR_VERTICAL_OFFSET,
        },
      };
      uiPositionsRef.current = next;
      return next;
    });
    setCustomUiMode(true);
  }, [
    getDefaultDistanceIndicatorPos,
    getDefaultHeartStatsPos,
    getDefaultHeightCounterPos,
    getDefaultInGameWarningPos,
    getDefaultItemBarPos,
    getDefaultPlayerChannelBarPos,
    getDefaultPlayerGcdBarPos,
    getDefaultPlayerIconBarPos,
    getDefaultPlayerStatusPos,
    getDefaultTargetIconBarPos,
    getDefaultTargetTargetIconBarPos,
    getDefaultTargetOwnedAbilityBarPos,
    getDefaultTargetStatusPos,
  ]);

  const cancelCustomUiMode = useCallback(() => {
    const snapshot = customUiSnapshotRef.current ?? {};
    customUiSnapshotRef.current = null;
    uiPositionsRef.current = snapshot;
    setUiPositions(snapshot);
    persistUiPositions(snapshot);
    setCustomUiMode(false);
  }, [persistUiPositions]);

  const confirmCustomUiMode = useCallback(() => {
    customUiSnapshotRef.current = null;
    persistUiPositions(uiPositionsRef.current);
    setCustomUiMode(false);
  }, [persistUiPositions]);

  const applyCatcakeDefaultUiLayout = useCallback(() => {
    const currentViewport = {
      w: Math.round(canvasSizeRef.current.w),
      h: Math.round(canvasSizeRef.current.h),
    };
    const targetViewport = currentViewport.w > 0 && currentViewport.h > 0
      ? currentViewport
      : CATCAKE_DEFAULT_UI_VIEWPORT;
    const scaledPositions = scaleUiPositions(
      CATCAKE_DEFAULT_UI_POSITIONS,
      CATCAKE_DEFAULT_UI_VIEWPORT,
      targetViewport,
    );
    setUiPositions(prev => {
      const next = { ...prev, ...scaledPositions };
      uiPositionsRef.current = next;
      return next;
    });
  }, []);

  const handlePickupInteract = useCallback(() => {
    const target = nearbyPickupIdsRef.current[0] ?? null;
    if (!target) return;

    // Block channeling if moving or airborne
    const keys = keysRef.current;
    if (keys.w || keys.a || keys.s || keys.d) return;
    if (localJumpCountRef.current > 0 || Math.abs(localVzRef.current) > 0.01) return;

    // If the closest book's panel is already open → claim it (F toggles open→claim)
    if (pickupModalsRef.current.some(m => m.pickupId === target)) {
      claimPickup(target);
      return;
    }

    // If already channeling this same book, ignore (debounce)
    if (channelPickupId === target) return;

    // Start 0.5s channel
    setChannelPickupId(target);
    setChannelProgress(0);
    channelStartRef.current = performance.now();

    // Animate progress bar
    const animate = () => {
      const elapsed  = performance.now() - channelStartRef.current;
      const progress = Math.min(1, elapsed / 500);
      setChannelProgress(progress);
      if (progress < 1) {
        channelAnimRef.current = requestAnimationFrame(animate);
      } else {
        // Channel complete — inspect pickup
        inspectPickup(target);
      }
    };
    channelAnimRef.current = requestAnimationFrame(animate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelPickupId]);

  const handlePickupInteractRef = useRef(handlePickupInteract);
  handlePickupInteractRef.current = handlePickupInteract;

  const inspectPickup = useCallback(async (pickupId: string) => {
    setChannelPickupId(null);
    setChannelProgress(0);
    try {
      const res = await fetch('/api/game/pickup/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, pickupId }),
      });
      if (!res.ok) {
        const err = await res.json();
        toastError(err.message ?? err.error ?? '无法读取');
        return;
      }
      const data = await res.json();
      // Add panel if not already open for this pickup
      setPickupModals(prev =>
        prev.some(m => m.pickupId === data.pickupId)
          ? prev
          : [...prev, { pickupId: data.pickupId, abilityId: data.abilityId, name: data.name, description: data.description }]
      );
    } catch {
      toastError('网络错误');
    }
  }, [gameId]);

  const claimPickup = useCallback(async (pickupId: string) => {
    try {
      const res = await fetch('/api/game/pickup/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, pickupId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.message ?? data.error ?? '无法拾取');
        return; // keep panel open on failure
      }
      setPickupModals(prev => prev.filter(m => m.pickupId !== pickupId));
      toastSuccess(`拾取了 ${data.name}`);
    } catch {
      toastError('网络错误');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Clean up channel animation on unmount or when nearby pickup changes
  useEffect(() => {
    return () => {
      cancelAnimationFrame(channelAnimRef.current);
      if (channelTimerRef.current) clearTimeout(channelTimerRef.current);
    };
  }, []);

  // Cancel channel if the book being channeled leaves the nearby range
  useEffect(() => {
    if (channelPickupId && !nearbyPickupIds.includes(channelPickupId)) {
      cancelAnimationFrame(channelAnimRef.current);
      setChannelPickupId(null);
      setChannelProgress(0);
    }
  }, [nearbyPickupIds, channelPickupId]);

  // ── Keyboard input ──
  useEffect(() => {
    const getHotkeyDraftSlots = () => {
      const heldItemIds = new Set(itemBarAbilitiesRef.current.filter(Boolean).map((ability) => ability!.id));
      return buildDraftAbilitySlots(
        abilitiesRef.current
          .filter(a => !a.isCommon && !a.isSpecialBarAbility && !heldItemIds.has(a.id))
          .map((ability) => {
            const overrideSlotIndex = draftSlotOverridesRef.current[ability.id];
            return typeof overrideSlotIndex === 'number'
              ? { ...ability, slotIndex: normalizeDraftSlotIndex(overrideSlotIndex, overrideSlotIndex) }
              : ability;
          }),
      );
    };
    const resetMovementKeys = () => {
      autoForwardRef.current = false;
      setAutoForward(false);
      keysRef.current = { w: false, a: false, s: false, d: false };
      setWasdKeys({ w: false, a: false, s: false, d: false });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (customUiMode) {
          cancelCustomUiMode();
          return;
        }
        if (activeChannelRef.current && onCancelChannel) {
          void onCancelChannel();
          return;
        }
        if (selectedTargetRef.current || selectedEntityRef.current || selectedSelfRef.current) {
          selectedTargetRef.current = null;
          selectedEntityRef.current = null;
          selectedSelfRef.current = false;
          setSelectedTargetId(null);
          setSelectedEntityId(null);
          setSelectedSelf(false);
          return;
        }
        setShowTestingPanel((visible) => {
          const next = !visible;
          if (next) {
            setEscPanelPage('main');
            setEscMainTab('normal');
            setEscTestPage('switches');
          }
          return next;
        });
        return;
      }
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();

        if (k === 's' && autoForwardRef.current) {
          autoForwardRef.current = false;
          setAutoForward(false);
          keysRef.current.w = false;
          setWasdKeys(prev => ({ ...prev, w: false }));
        }
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = true;
        setWasdKeys(prev => ({ ...prev, [k]: true }));

        // Movement breaks channeling
        if (channelPickupIdRef.current) {
          cancelAnimationFrame(channelAnimRef.current);
          setChannelPickupId(null);
          setChannelProgress(0);
        }
        // Movement closes all pickup modals
        if (pickupModalsRef.current.length > 0) {
          setPickupModals([]);
        }
      }
      // Space = jump
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        if (keysRef.current.s) {
          const commons = abilitiesRef.current.filter(a => a.isCommon);
          const backstep = commons.find(a => a.abilityId === 'houyao');
          if (backstep?.isReady) {
            castAbilityRef.current(backstep.id);
            return;
          }
        }
        tryQueueLocalJump();
      }
      // F = interact with nearby pickup (channel to open panel; claim if panel already open)
      if (k === 'f') {
        e.preventDefault();
        handlePickupInteractRef.current();
        return;
      }
      // G = auto-forward (persists until S is pressed)
      if (k === 'g') {
        e.preventDefault();
        if (!e.repeat && !autoForwardRef.current) {
          autoForwardRef.current = true;
          setAutoForward(true);
          keysRef.current.w = true;
          setWasdKeys(prev => ({ ...prev, w: true }));
          toastSuccess('自动前行已开启（按 S 停止）');
        }
        return;
      }
      if (k === 'c' && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) setShowHeartDetailsPanel(v => !v);
        return;
      }
      // Tab / F1 — select the nearest currently targetable enemy player or entity.
      // Rules:
      //   - Only consider targets within ±90° of facing (180° front cone).
      //   - Exclude the currently selected target so Tab always cycles when an
      //     alternative is available.
      if (e.key === 'Tab' || e.key === 'F1') {
        e.preventDefault();
        const myPos = localPositionRef.current ?? me.position;
        const facing = localFacingRef.current ?? meFacingRef.current ?? { x: 0, y: 1 };
        const facingLen = Math.hypot(facing.x, facing.y);
        const fx = facingLen > 0.0001 ? facing.x / facingLen : 0;
        const fy = facingLen > 0.0001 ? facing.y / facingLen : 1;
        const currentSelectedId = selectedTargetRef.current ?? selectedEntityRef.current ?? null;

        const candidates = targetableThingRef.current.filter((c) => {
          if (!myPos) return false;
          if (c.id === currentSelectedId) return false; // exclude current target
          const dx = c.position.x - myPos.x;
          const dy = c.position.y - myPos.y;
          const planar = Math.hypot(dx, dy);
          if (planar < 0.0001) return true; // standing on top of target
          // dot product against facing — must be > 0 to be in front (180° cone)
          return (dx * fx + dy * fy) / planar > 0;
        });

        let nearest = candidates.reduce<null | { kind: 'player' | 'entity'; id: string; position: Position; distSq: number }>((best, candidate) => {
          if (!myPos) return best;
          const dx = candidate.position.x - myPos.x;
          const dy = candidate.position.y - myPos.y;
          const dz = (candidate.position.z ?? 0) - ((myPos as any).z ?? 0);
          const distSq = dx * dx + dy * dy + dz * dz;
          if (!best || distSq < best.distSq) {
            return { ...candidate, distSq };
          }
          return best;
        }, null);

        if (!nearest) {
          // No alternative front-cone target. If a target is currently selected,
          // keep it; otherwise notify the user.
          if (!currentSelectedId) {
            showInGameWarning('当前没有可选目标');
          }
          return;
        }
        if (nearest.kind === 'player') {
          setSelectedTargetId(nearest.id);
          selectedTargetRef.current = nearest.id;
          setSelectedEntityId(null);
          selectedEntityRef.current = null;
        } else {
          setSelectedEntityId(nearest.id);
          selectedEntityRef.current = nearest.id;
          setSelectedTargetId(null);
          selectedTargetRef.current = null;
        }
        setSelectedSelf(false);
        selectedSelfRef.current = false;
        return;
      }
      // ── Draft slots: 1  2  3  Q ──
      const specialBarHotkeysActive = abilitiesRef.current.some(a => a.isSpecialBarAbility);
      const drafts = specialBarHotkeysActive
        ? abilitiesRef.current.filter(a => a.isSpecialBarAbility)
        : getHotkeyDraftSlots();
      const triggerAbilityHotkey = (ability: AbilityInfo | undefined, pressedId: string) => {
        if (!ability) return;
        setPressedAbilityInput(pressedId);
        if (ability.isReady && !ability.blockedByAntiStealth) {
          castAbilityRef.current(ability.id);
        } else {
          showAbilityDisabledWarning(ability);
        }
      };
      if (e.key === '1' && drafts[0]) { triggerAbilityHotkey(drafts[0], 'draft-0'); return; }
      if (e.key === '2' && drafts[1]) { triggerAbilityHotkey(drafts[1], 'draft-1'); return; }
      if (e.key === '3' && drafts[2]) { triggerAbilityHotkey(drafts[2], 'draft-2'); return; }
      if (k === 'q' && !e.altKey && drafts[3]) { triggerAbilityHotkey(drafts[3], 'draft-3'); return; }
      // ── Common abilities: X  Alt+A  Alt+D  Alt+S  `  T ──
      const commons = specialBarHotkeysActive ? [] : abilitiesRef.current.filter(a => a.isCommon);
      if (k === 'x' && !e.altKey) {
        // index 0 = 猛虎下山
        triggerAbilityHotkey(commons[0], 'common-0');
        return;
      }
      if (k === 't' && !e.altKey) {
        // index 7 = 御骑
        triggerAbilityHotkey(commons[7], 'common-7');
        return;
      }
      if (e.key === '`') {
        // index 6 = 后撤
        triggerAbilityHotkey(commons[6], 'common-6');
        return;
      }
      if (e.altKey) {
        e.preventDefault(); // suppress browser Alt shortcuts
        if (k === 'w') triggerAbilityHotkey(commons[2], 'common-2'); // 蹑云逐月
        if (k === 'a') triggerAbilityHotkey(commons[3], 'common-3'); // 凌霄揽胜
        if (k === 'd') triggerAbilityHotkey(commons[4], 'common-4'); // 瑶台枕鹤
        if (k === 's') triggerAbilityHotkey(commons[5], 'common-5'); // 迎风回浪
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      setPressedAbilityInput(null);
      if (['w', 'a', 's', 'd'].includes(k)) {
        if (k === 'w' && autoForwardRef.current) {
          return;
        }
        keysRef.current[k as 'w' | 'a' | 's' | 'd'] = false;
        setWasdKeys(prev => ({ ...prev, [k]: false }));
        const nextKeys = { ...keysRef.current };
        if (!hasMovementIntent(nextKeys)) {
          localVelocityRef.current = { x: 0, y: 0 };
        }
        void sendMovement();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) resetMovementKeys();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    window.addEventListener('blur',    resetMovementKeys);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
      window.removeEventListener('blur',    resetMovementKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tryQueueLocalJump, onCancelChannel, sendMovement, customUiMode, cancelCustomUiMode, showAbilityDisabledWarning]);

  // Mouse hotkeys + camera drag + zoom:
  //   Left-drag              → rotate camera (traditional mode)
  //   Right-drag             → rotate camera + snap character facing (traditional mode)
  //   Middle-down (MD)       → common[1] 扶摇直上
  //   Alt+W                  → common[2] 蹑云逐月
  //   Button-3 / XB1 (down)  → draft[5]
  //   Button-4 / XB2 (down)  → draft[4]
  //   Wheel up/down          → zoom in/out
  useEffect(() => {
    const getHotkeyDraftSlots = () => {
      const heldItemIds = new Set(itemBarAbilitiesRef.current.filter(Boolean).map((ability) => ability!.id));
      return buildDraftAbilitySlots(
        abilitiesRef.current
          .filter(a => !a.isCommon && !a.isSpecialBarAbility && !heldItemIds.has(a.id))
          .map((ability) => {
            const overrideSlotIndex = draftSlotOverridesRef.current[ability.id];
            return typeof overrideSlotIndex === 'number'
              ? { ...ability, slotIndex: normalizeDraftSlotIndex(overrideSlotIndex, overrideSlotIndex) }
              : ability;
          }),
      );
    };
    const cancelMouseLookFacingSync = () => {
      if (mouseLookFacingSyncRafRef.current === null) return;
      window.cancelAnimationFrame(mouseLookFacingSyncRafRef.current);
      mouseLookFacingSyncRafRef.current = null;
    };
    const syncMouseLookFacing = () => {
      const ms = mouseStateRef.current;
      if (!ms.isRight) return;
      if (movementControlStateRef.current.rooted || movementControlStateRef.current.fullyLocked) return;
      if (meActiveDashRef.current && !dashTurnOverrideRef.current) return;

      const moveIntent = buildTraditionalMoveIntent(
        keysRef.current,
        true,
        ms.isLeft,
        camYawRef.current,
        charYawRef.current,
      );
      if (moveIntent.direction && !moveIntent.backpedalOnly) {
        const facingDir = normalizePlanar(moveIntent.direction.dx, moveIntent.direction.dy);
        if (facingDir) {
          localFacingRef.current = facingDir;
          charYawRef.current = facingToYaw(facingDir);
        }
        return;
      }

      localFacingRef.current = {
        x: Math.sin(camYawRef.current),
        y: -Math.cos(camYawRef.current),
      };
      charYawRef.current = camYawRef.current;
    };
    const scheduleMouseLookFacingSync = () => {
      if (mouseLookFacingSyncRafRef.current !== null) return;
      mouseLookFacingSyncRafRef.current = window.requestAnimationFrame(() => {
        mouseLookFacingSyncRafRef.current = null;
        syncMouseLookFacing();
      });
    };
    const resetMouseButtons = () => {
      cancelMouseLookFacingSync();
      mouseStateRef.current.isLeft = false;
      mouseStateRef.current.isRight = false;
      mouseStateRef.current.downAt = 0;
      mouseStateRef.current.dragDistance = 0;
      groundDeselectCandidateRef.current = false;
      manualCameraLookActiveRef.current = false;
      setPressedAbilityInput(null);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (customUiMode) {
        resetMouseButtons();
        return;
      }
      if (abilityDragActiveRef.current) {
        resetMouseButtons();
        return;
      }
      // Left button — start camera drag
      if (e.button === 0) {
        // Only start drag if not clicking a UI button or a draggable panel
        if ((e.target as HTMLElement).closest(`button, input, select, textarea, label, [data-ui-drag], [data-ui-interactive], .${styles.escOverlay}`)) return;
        mouseStateRef.current.isLeft = true;
        manualCameraLookActiveRef.current = true;
        mouseStateRef.current.lastX  = e.clientX;
        mouseStateRef.current.lastY  = e.clientY;
        mouseStateRef.current.downX  = e.clientX;
        mouseStateRef.current.downY  = e.clientY;
        mouseStateRef.current.downAt = performance.now();
        mouseStateRef.current.dragDistance = 0;
        groundDeselectCandidateRef.current = false;
        return;
      }
      // Right button — start character rotate drag (context menu already suppressed by onContextMenu)
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        mouseStateRef.current.isRight = true;
        manualCameraLookActiveRef.current = mouseStateRef.current.isLeft;
        mouseStateRef.current.lastX   = e.clientX;
        mouseStateRef.current.lastY   = e.clientY;
        return;
      }
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        const ab = abilitiesRef.current.filter(a => a.isCommon)[1]; // 扶摇直上
        if (ab?.isReady) { setPressedAbilityInput('common-1'); castAbilityRef.current(ab.id); }
        return;
      }
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        const ab = getHotkeyDraftSlots()[5]; // draft slot 6 (XB1)
        if (ab?.isReady) { setPressedAbilityInput('draft-5'); castAbilityRef.current(ab.id); }
        return;
      }
      if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        const ab = getHotkeyDraftSlots()[4]; // draft slot 5 (XB2)
        if (ab?.isReady) { setPressedAbilityInput('draft-4'); castAbilityRef.current(ab.id); }
        return;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        const ms = mouseStateRef.current;
        const wasLeftDown = ms.isLeft;
        const downX = Number.isFinite(ms.downX) ? ms.downX : e.clientX;
        const downY = Number.isFinite(ms.downY) ? ms.downY : e.clientY;
        const releaseDistance = Math.max(ms.dragDistance, Math.hypot(e.clientX - downX, e.clientY - downY));
        const releaseMs = ms.downAt > 0 ? performance.now() - ms.downAt : Number.POSITIVE_INFINITY;
        const isRapidSingleClick = wasLeftDown && releaseMs <= 220 && releaseDistance <= 6;
        cancelMouseLookFacingSync();
        mouseStateRef.current.isLeft = false;
        manualCameraLookActiveRef.current = false;
        if (isRapidSingleClick) {
          lastQuickLeftClickAtRef.current = performance.now();
          if (groundDeselectCandidateRef.current && !pendingDummySpawnRef.current && !pendingGroundCastAbilityRef.current) {
            clearTargetSelection();
          }
        }
        groundDeselectCandidateRef.current = false;
        mouseStateRef.current.downX = NaN;
        mouseStateRef.current.downY = NaN;
        mouseStateRef.current.downAt = 0;
        mouseStateRef.current.dragDistance = 0;
        return;
      }
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        cancelMouseLookFacingSync();
        mouseStateRef.current.isRight = false;
        manualCameraLookActiveRef.current = mouseStateRef.current.isLeft;
        return;
      }
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        setPressedAbilityInput(null);
        return;
      }
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        setPressedAbilityInput(null);
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (customUiMode) {
        resetMouseButtons();
        return;
      }
      if (abilityDragActiveRef.current) {
        resetMouseButtons();
        return;
      }
      const ms = mouseStateRef.current;
      if (!ms.isLeft && !ms.isRight) return;
      e.preventDefault();
      const dx = e.clientX - ms.lastX;
      const dy = e.clientY - ms.lastY;
      if (ms.isLeft && Number.isFinite(ms.downX) && Number.isFinite(ms.downY)) {
        ms.dragDistance = Math.max(ms.dragDistance, Math.hypot(e.clientX - ms.downX, e.clientY - ms.downY));
      }
      ms.lastX = e.clientX;
      ms.lastY = e.clientY;

      if (ms.isRight && !ms.isLeft) {
        // RMB only: rotate camera; character snaps to camera direction
        camYawRef.current  -= dx * 0.005;
        // Update pitch too (drag up/down tilts view)
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = clampCameraPitch(newPitch, mode);
        cameraLookInputVersionRef.current += 1;
        scheduleMouseLookFacingSync();
      } else if (ms.isLeft && !ms.isRight) {
        // LMB only: rotate camera yaw + pitch
        camYawRef.current  -= dx * 0.005;
        // dy > 0 = drag down = look more from above (increase pitch)
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = clampCameraPitch(newPitch, mode);
        cameraLookInputVersionRef.current += 1;
      } else {
        // LMB + RMB together: rotate camera + character facing; physics tick moves forward
        camYawRef.current  -= dx * 0.005;
        const newPitch = camPitchRef.current + dy * 0.003;
        camPitchRef.current = clampCameraPitch(newPitch, mode);
        cameraLookInputVersionRef.current += 1;
        scheduleMouseLookFacingSync();
      }
    };
    // Prevent native right-click context menu
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    // auxclick fires for middle-click and side-buttons — prevent browser tab-open / navigation
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1 || e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (customUiMode) return;
      if ((e.target as HTMLElement | null)?.closest(`[data-testing-panel], input, select, textarea, [data-ui-interactive], .${styles.escOverlay}`)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.12 : -0.12;
      const zoomMax = allowOverrangeCameraZoom ? CAMERA_ZOOM_OVER_MAX : CAMERA_ZOOM_MAX;
      camZoomRef.current = Math.max(0.4, Math.min(zoomMax, camZoomRef.current + delta));
      setCameraZoomLevel(camZoomRef.current);
    };
    // Use capture phase so we intercept BEFORE the browser's own navigation handlers
    window.addEventListener('mousedown',   onMouseDown,   { capture: true });
    window.addEventListener('mouseup',     onMouseUp,     { capture: true });
    window.addEventListener('mousemove',   onMouseMove,   { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('auxclick',    onAuxClick,    { capture: true });
    window.addEventListener('wheel',       onWheel,       { passive: false, capture: true });
    window.addEventListener('blur',        resetMouseButtons);
    return () => {
      cancelMouseLookFacingSync();
      window.removeEventListener('mousedown',   onMouseDown,   { capture: true });
      window.removeEventListener('mouseup',     onMouseUp,     { capture: true });
      window.removeEventListener('mousemove',   onMouseMove,   { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('auxclick',    onAuxClick,    { capture: true });
      window.removeEventListener('wheel',       onWheel,       { capture: true } as EventListenerOptions);
      window.removeEventListener('blur',        resetMouseButtons);
    };
  }, [allowOverrangeCameraZoom, clearTargetSelection, customUiMode]);

  // ── Touch camera rotation (mobile/iPad) ──────────────────────────────────
  // A single touch that starts on the 3D canvas (wrapRef) rotates camera + player
  // the same way as PC right-click drag (charYawRef also updated → facing changes).
  // UI elements (joystick, buttons) have higher z-index and consume their own
  // touches, so they never reach wrapRef.
  useEffect(() => {
    const camTouchRef = { id: null as number | null, lastX: 0, lastY: 0 };

    const onTouchStart = (e: TouchEvent) => {
      if (customUiMode) {
        camTouchRef.id = null;
        manualCameraLookActiveRef.current = false;
        return;
      }
      if (camTouchRef.id !== null) return; // already tracking one finger
      const touch = e.changedTouches[0];
      const target = touch.target as HTMLElement;
      // Only start camera rotation if the touch landed on the canvas wrapper
      if (!wrapRef.current?.contains(target)) return;
      camTouchRef.id    = touch.identifier;
      camTouchRef.lastX = touch.clientX;
      camTouchRef.lastY = touch.clientY;
      manualCameraLookActiveRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (customUiMode) {
        camTouchRef.id = null;
        manualCameraLookActiveRef.current = false;
        return;
      }
      if (camTouchRef.id === null) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === camTouchRef.id);
      if (!touch) return;
      const dx = touch.clientX - camTouchRef.lastX;
      const dy = touch.clientY - camTouchRef.lastY;
      camTouchRef.lastX = touch.clientX;
      camTouchRef.lastY = touch.clientY;
      // Right-click behaviour: camera + character facing both rotate
      camYawRef.current  -= dx * 0.005;
      if (!(movementControlStateRef.current.rooted || movementControlStateRef.current.fullyLocked) && (!meActiveDashRef.current || dashTurnOverrideRef.current)) {
        charYawRef.current  = camYawRef.current;
        localFacingRef.current = {
          x: Math.sin(charYawRef.current),
          y: -Math.cos(charYawRef.current),
        };
      }
      const newPitch = camPitchRef.current + dy * 0.003;
      camPitchRef.current = clampCameraPitch(newPitch, mode);
      cameraLookInputVersionRef.current += 1;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === camTouchRef.id);
      if (touch) {
        camTouchRef.id = null;
        manualCameraLookActiveRef.current = false;
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove',  onTouchMove,  { passive: true });
    window.addEventListener('touchend',   onTouchEnd,   { passive: true });
    window.addEventListener('touchcancel',onTouchEnd,   { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove',  onTouchMove);
      window.removeEventListener('touchend',   onTouchEnd);
      window.removeEventListener('touchcancel',onTouchEnd);
    };
  }, [customUiMode]);

  const handleJoystickDirection = useCallback(
    (keys: { w: boolean; a: boolean; s: boolean; d: boolean }) => {
      const nextKeys = { ...keys };
      if (nextKeys.s && autoForwardRef.current) {
        autoForwardRef.current = false;
        setAutoForward(false);
      }
      if (autoForwardRef.current && !nextKeys.s) {
        nextKeys.w = true;
      }
      keysRef.current = nextKeys;
      setWasdKeys(nextKeys);
    },
    [],
  );

  // Analog joystick direction — stored separately and used in sendMovement
  const handleJoystickAnalog = useCallback((dx: number, dy: number) => {
    joystickDirRef.current = (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) ? { dx, dy } : null;
  }, []);

  // Jump triggered from the virtual joystick's jump button  
  const handleJoystickJump = useCallback(() => {
    tryQueueLocalJump();
  }, [tryQueueLocalJump]);

  /* Physics — mirrors server exactly */
  useEffect(() => {
    const CLIENT_TICK_HZ = 30;
    const CLIENT_TICK_MS = 1000 / CLIENT_TICK_HZ;
    // Match backend movement constants at 30Hz.
    const UNIT_SCALE = getStoredUnitScale(mode);
    const DEFAULT_MOVE_SPEED_WORLD_PER_TICK = getDefaultMoveSpeedPerTick(mode);
    const UPWARD_JUMP_AIR_SHIFT_DISTANCE = getUpwardJumpAirShiftDistance(mode);
    const DIRECTIONAL_JUMP_DISTANCE = getDirectionalJumpDistance(mode);
    const MAX_SPEED = 0.1666667 * UNIT_SCALE, ACCEL = 0.3, DECEL = 0.9;
    // 30 Hz client physics — asymmetric gravity, tuned per jump type:
    //   Single jump : 1.7 u peak, 1.0 s rise, 0.7 s fall  → 1.7 s total
    //   Double jump : +0.755 u extra (peak 2.455 u)         → ~2.51 s total from takeoff
    //   Power jump  : 12.8 u peak, 1.77 s rise, 1.93 s fall → 3.7 s total
    const GRAVITY_UP_CLIENT         = 2 * 1.7  * UNIT_SCALE / (30 * 30);   // ≈ 0.008311 (regular rise)
    const GRAVITY_DOWN_CLIENT       = 2 * 1.7  * UNIT_SCALE / (21 * 21);   // ≈ 0.016962 (regular fall, 0.7 s)
    const JUMP_VZ_CLIENT            = GRAVITY_UP_CLIENT * 30;               // ≈ 0.24933 (1.0 s → 1.7 u)
    const DOUBLE_JUMP_VZ_CLIENT     = GRAVITY_UP_CLIENT * 20;               // ≈ 0.16622 (+0.755 u → 2.51 s total)
    const POWER_GRAVITY_UP_CLIENT   = 2 * 12.8 * UNIT_SCALE / (53.1 * 53.1); // ≈ 0.019974 (1.77 s rise)
    const POWER_GRAVITY_DOWN_CLIENT = 2 * 12.8 * UNIT_SCALE / (57.9 * 57.9); // ≈ 0.016799 (1.93 s fall)
    const POWER_JUMP_VZ_CLIENT      = POWER_GRAVITY_UP_CLIENT * 53.1;        // ≈ 1.0606  (12.8 u peak)
    // 扶摇直上 + 鸟翔碧空 combined: 24u peak, same 53.1-tick rise / 57.9-tick fall
    const COMBINED_GRAVITY_UP_CLIENT   = 2 * 24 * UNIT_SCALE / (53.1 * 53.1);
    const COMBINED_GRAVITY_DOWN_CLIENT = 2 * 24 * UNIT_SCALE / (57.9 * 57.9);
    const COMBINED_JUMP_VZ_CLIENT      = COMBINED_GRAVITY_UP_CLIENT * 53.1;
    const POWER_DIRECTIONAL_JUMP_DISTANCE = 18 * UNIT_SCALE;
    const POWER_DOUBLE_DIRECTIONAL_JUMP_DISTANCE = 12 * UNIT_SCALE;
    const MULTI_JUMP_DIRECTIONAL_JUMP_DISTANCE = 12 * UNIT_SCALE;
    const MULTI_JUMP_HEIGHT_MULT = Math.sqrt(3); // 鸟翔碧空: 3× height → √3× velocity
    const TURN_RATE = 0.055; // radians / tick at 30 Hz ≈ 95°/sec
    const tick = () => {
      const tickNowMs = performance.now();
      const pos = localPositionRef.current;
      if (!pos) {
        cameraMoveCommandActiveRef.current = false;
        return;
      }
      if (mode === 'collision-test' && !collisionReadyRef.current) {
        cameraMoveCommandActiveRef.current = false;
        localVelocityRef.current = { x: 0, y: 0 };
        localVzRef.current = 0;
        return;
      }
      const effectiveMaxSpeed = MAX_SPEED * moveSpeedScaleRef.current;
      const effectiveMaxJumps = getEffectiveMaxJumps();

      // During server-authoritative dash: skip movement + gravity, but KEEP camera/turning
      if (meActiveDashRef.current) {
        cameraMoveCommandActiveRef.current = false;
        localVelocityRef.current.x = 0;
        localVelocityRef.current.y = 0;
        jumpLocalRef.current = false;
        // Post-dash jump allowance: MULTI_JUMP → full reset, normal → 1 jump only
        localJumpCountRef.current = effectiveMaxJumps > 2 ? 0 : 1;
        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;
        // Still allow A/D camera turning while dashing
        const k = keysRef.current;
        const ms = mouseStateRef.current;
        if (controlModeRef.current === 'traditional' && !ms.isRight) {
          const turning = (k.a ? 1 : 0) + (k.d ? -1 : 0);
          if (turning !== 0) {
            camYawRef.current  += turning * TURN_RATE;
          }
        }
        return;
      }

      const vel = localVelocityRef.current;
      const k   = keysRef.current;
      const ms  = mouseStateRef.current;
      const objs = mapObjectsRef.current;
      const useBVH = mode === 'collision-test' && !!collisionSysRef.current;
      const rawTickGroundH = (() => {
        if (!useBVH) {
          return getGroundHeightClient(pos.x, pos.y, localZRef.current, objs, playerRadius);
        }

        const sys = collisionSysRef.current!;
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        _bvhCenter.set(
          (pos.x - halfW - GROUP_POS_X) / RENDER_SF,
          (localZRef.current - GROUP_POS_Y) / RENDER_SF + EXPORT_CYL_HALF_HEIGHT,
          (halfH - pos.y - GROUP_POS_Z) / RENDER_SF,
        );
        const supportY = getBvhGroundSupportY(sys, _bvhCenter);
        if (supportY === null) {
          return 0;
        }
        return supportY * RENDER_SF + GROUP_POS_Y;
      })();
      const tickGroundH = rawTickGroundH;
      const airborne = localZRef.current > tickGroundH + 0.01;
      groundHRef.current = tickGroundH; // keep height display in sync
      if (groundBaseRef.current === null) groundBaseRef.current = tickGroundH; // init baseline once
      if (!airborne && localJumpCountRef.current === 0) {
        airborneSpeedCarryRef.current = 0;
      }
      const { fullyLocked, rooted } = movementControlStateRef.current;
      const channelMovementLocked = movementControlStateRef.current.channelMovementLocked === true;
      const hardMovementLocked = fullyLocked || rooted;
      const movementLocked = hardMovementLocked || channelMovementLocked;
      const preserveUpwardJumpRise =
        airborne &&
        localJumpCountRef.current > 0 &&
        localVzRef.current > 0.01 &&
        !airDirectionLockedRef.current &&
        !airNudgeDirRef.current;

      if (hardMovementLocked && !preserveUpwardJumpRise) {
        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;
        airborneSpeedCarryRef.current = 0;
        vel.x = 0;
        vel.y = 0;
        if (airborne) {
          localVzRef.current = Math.min(localVzRef.current, -0.0001);
        }
      }

      if (channelMovementLocked && !hardMovementLocked) {
        // Match backend: lock-movement channels stop new planar input, but do not
        // cancel already-started jump air-shift carry.
        vel.x = 0;
        vel.y = 0;
      }

      let airNudgeDx = 0;
      let airNudgeDy = 0;
      let moveIntentDx = 0;
      let moveIntentDy = 0;
      let moveIntentBackpedalOnly = false;
      const jumpAirborne = airborne && localJumpCountRef.current > 0;
      const fearedSourceUserId = movementControlStateRef.current.fearedSourceUserId;
      const fearedSourcePos = fearedSourceUserId ? opponentPositionsRef.current[fearedSourceUserId] : null;
      const fearedDirection = fearedSourcePos && localPositionRef.current
        ? normalizePlanar(localPositionRef.current.x - fearedSourcePos.x, localPositionRef.current.y - fearedSourcePos.y)
        : null;
      const shiXinGuDirection = movementControlStateRef.current.shiXinGuDirection;
      const shiXinGuStandstill = movementControlStateRef.current.shiXinGuStandstill === true;

      if (jumpLocalRef.current && localJumpCountRef.current >= effectiveMaxJumps) {
        jumpLocalRef.current = false;
      }

      if (fearedDirection && !movementLocked) {
        cameraMoveCommandActiveRef.current = true;
        moveIntentDx = fearedDirection.x;
        moveIntentDy = fearedDirection.y;

        if (jumpAirborne) {
          airNudgeDx = moveIntentDx;
          airNudgeDy = moveIntentDy;
        } else {
          vel.x += (fearedDirection.x * effectiveMaxSpeed - vel.x) * ACCEL;
          vel.y += (fearedDirection.y * effectiveMaxSpeed - vel.y) * ACCEL;
          localFacingRef.current = fearedDirection;
          charYawRef.current = facingToYaw(fearedDirection);
        }
      } else if (shiXinGuDirection && !movementLocked) {
        cameraMoveCommandActiveRef.current = true;
        moveIntentDx = shiXinGuDirection.x;
        moveIntentDy = shiXinGuDirection.y;

        if (jumpAirborne) {
          airNudgeDx = moveIntentDx;
          airNudgeDy = moveIntentDy;
        } else {
          vel.x += (shiXinGuDirection.x * effectiveMaxSpeed - vel.x) * ACCEL;
          vel.y += (shiXinGuDirection.y * effectiveMaxSpeed - vel.y) * ACCEL;
          localFacingRef.current = shiXinGuDirection;
          charYawRef.current = facingToYaw(shiXinGuDirection);
        }
      } else if (shiXinGuStandstill && !movementLocked) {
        cameraMoveCommandActiveRef.current = false;
        vel.x = 0;
        vel.y = 0;
      } else if (controlModeRef.current === 'traditional') {
        const mouseLook = ms.isRight;
        const bothMouse = ms.isRight && ms.isLeft;

        if (movementLocked) {
          cameraMoveCommandActiveRef.current = false;
        } else if (mouseLook) {
          // MMO mouselook: camera turns from mouse; movement is camera-relative.
          // Facing follows movement intent except pure backpedal.
        } else {
          // WoW-style keyboard turning: A/D turn camera AND character together immediately.
          const turning = (k.a ? 1 : 0) + (k.d ? -1 : 0);
          if (turning !== 0) {
            camYawRef.current  += turning * TURN_RATE;
            charYawRef.current  = camYawRef.current;
            localFacingRef.current = {
              x: Math.sin(charYawRef.current),
              y: -Math.cos(charYawRef.current),
            };
          }
        }

        const moveIntent = buildTraditionalMoveIntent(
          k,
          mouseLook,
          bothMouse,
          camYawRef.current,
          charYawRef.current,
        );
        const moveDirection = movementLocked ? null : moveIntent.direction;
        cameraMoveCommandActiveRef.current = !!moveDirection;
        moveIntentDx = moveDirection?.dx ?? 0;
        moveIntentDy = moveDirection?.dy ?? 0;
        moveIntentBackpedalOnly = !!moveDirection && moveIntent.backpedalOnly;

        if (jumpAirborne) {
          airNudgeDx = moveIntentDx;
          airNudgeDy = moveIntentDy;
        } else if (moveDirection) {
          const traditionalMoveSpeed =
            effectiveMaxSpeed * (yuqiMountedRef.current && moveIntent.backpedalOnly ? 0.5 : 1);
          vel.x += (moveDirection.dx * traditionalMoveSpeed - vel.x) * ACCEL;
          vel.y += (moveDirection.dy * traditionalMoveSpeed - vel.y) * ACCEL;

          if (!moveIntent.backpedalOnly) {
            const facingDir = normalizePlanar(moveDirection.dx, moveDirection.dy);
            if (facingDir) {
              localFacingRef.current = facingDir;
              charYawRef.current = facingToYaw(facingDir);
            }
          } else if (mouseLook) {
            const facingDir = {
              x: Math.sin(camYawRef.current),
              y: -Math.cos(camYawRef.current),
            };
            localFacingRef.current = facingDir;
            charYawRef.current = facingToYaw(facingDir);
          }
        } else {
          if (!airborne) {
            vel.x *= DECEL;
            vel.y *= DECEL;
          }
          if (mouseLook && !movementLocked) {
            const facingDir = {
              x: Math.sin(camYawRef.current),
              y: -Math.cos(camYawRef.current),
            };
            localFacingRef.current = facingDir;
            charYawRef.current = facingToYaw(facingDir);
          }
        }
      } else {
        // 摇杆模式: WASD = absolute world directions
        let ix = 0, iy = 0;
        if (k.w) iy += 1;
        if (k.s) iy -= 1;
        if (k.a) ix -= 1;
        if (k.d) ix += 1;
        const moveDir = movementLocked ? null : normalizePlanar(ix, iy);
        cameraMoveCommandActiveRef.current = !!moveDir || (!movementLocked && !!joystickDirRef.current);
        moveIntentDx = moveDir?.x ?? 0;
        moveIntentDy = moveDir?.y ?? 0;
        if (jumpAirborne) {
          airNudgeDx = moveIntentDx;
          airNudgeDy = moveIntentDy;
        } else if (moveDir) {
          vel.x += (moveDir.x * effectiveMaxSpeed - vel.x) * ACCEL;
          vel.y += (moveDir.y * effectiveMaxSpeed - vel.y) * ACCEL;
          localFacingRef.current = moveDir;
          charYawRef.current = facingToYaw(moveDir);
        } else if (!airborne) {
          vel.x *= DECEL;
          vel.y *= DECEL;
        }
      }

      // Upward jump: first mid-air direction input locks the drift direction for this jump phase.
      if (
        jumpAirborne &&
        !jumpLocalRef.current &&
        airNudgeRemainingRef.current > 0 &&
        airNudgeTicksRemainingRef.current <= 0 &&
        !airDirectionLockedRef.current
      ) {
        const airDir = normalizePlanar(airNudgeDx, airNudgeDy);
        if (airDir) {
          airNudgeDirRef.current = airDir;
          airNudgeTicksRemainingRef.current = AIR_SHIFT_DURATION_TICKS;
          airDirectionLockedRef.current = true;
          if (jumpTelemetryRef.current?.mode === 'upward') {
            jumpTelemetryRef.current.expectedLandWorld = UPWARD_JUMP_AIR_SHIFT_DISTANCE;
          }
        }
      }

      if (airborne) {
        const planarAirborneSpeed = Math.max(
          Math.hypot(vel.x, vel.y),
          getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current),
        );
        if (planarAirborneSpeed > 0.0001) {
          airborneSpeedCarryRef.current = planarAirborneSpeed;
        }
      }

      let nudgeX = 0;
      let nudgeY = 0;
      if (
        airborne &&
        !jumpLocalRef.current &&
        airNudgeTicksRemainingRef.current > 0 &&
        airNudgeRemainingRef.current > 0 &&
        airNudgeDirRef.current
      ) {
        const ticksLeft = Math.max(1, airNudgeTicksRemainingRef.current);
        const step = Math.min(airNudgeRemainingRef.current, airNudgeRemainingRef.current / ticksLeft);
        nudgeX = airNudgeDirRef.current.x * step;
        nudgeY = airNudgeDirRef.current.y * step;
        airNudgeRemainingRef.current = Math.max(0, airNudgeRemainingRef.current - step);
        airNudgeTicksRemainingRef.current = Math.max(0, airNudgeTicksRemainingRef.current - 1);
        if (airNudgeRemainingRef.current <= 0 || airNudgeTicksRemainingRef.current <= 0) {
          airNudgeRemainingRef.current = 0;
          airNudgeTicksRemainingRef.current = 0;
          airNudgeDirRef.current = null;
        }
      }

      let newPx = Math.max(playerRadius, Math.min(ARENA_WIDTH - playerRadius, pos.x + vel.x + nudgeX));
      let newPy = Math.max(playerRadius, Math.min(ARENA_HEIGHT - playerRadius, pos.y + vel.y + nudgeY));

      // Map object collision

      if (useBVH) {
        // ── BVH sphere collision (matches export-reader exactly) ──
        const sys = collisionSysRef.current!;
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        // ── Cylinder horizontal pass ──
        // _bvhCenter.y = cylinder centre (feet + half-height); preserved between ticks.
        // Only update X/Z for horizontal movement; Y is owned by the vertical pass.
        _bvhCenter.x = (newPx - halfW - GROUP_POS_X) / RENDER_SF;
        _bvhCenter.z = (halfH - newPy - GROUP_POS_Z) / RENDER_SF;
        if (!bvhCenterYInitRef.current) {
          // First tick after spawn/teleport: set centre from current feet position.
          _bvhCenter.y = (localZRef.current - GROUP_POS_Y) / RENDER_SF + EXPORT_CYL_HALF_HEIGHT;
          bvhCenterYInitRef.current = true;
        }
        // Sphere at cylinder centre provides correct horizontal wall push (push.y=0 for walls)
        _bvhVelocity.set(
          (vel.x + nudgeX) / RENDER_SF,
          0, // vertical handled separately; don't let wall contacts corrupt Vz
          -(vel.y + nudgeY) / RENDER_SF,
        );
        sys.resolveSphereCollision(_bvhCenter, EXPORT_CYL_RADIUS, _bvhVelocity);

        // Convert back → game horizontal (clamp to arena bounds)
        newPx = Math.max(playerRadius, Math.min(ARENA_WIDTH - playerRadius,
          _bvhCenter.x * RENDER_SF + GROUP_POS_X + halfW));
        newPy = Math.max(playerRadius, Math.min(ARENA_HEIGHT - playerRadius,
          halfH - (_bvhCenter.z * RENDER_SF + GROUP_POS_Z)));
        // Do NOT read _bvhVelocity.y here — vertical velocity is managed by the vertical pass.
      } else {
        for (const obj of objs) {
          const resolved = resolveObjCollisionClient(newPx, newPy, localZRef.current, vel, obj, playerRadius);
          newPx = resolved.x;
          newPy = resolved.y;
        }
      }
      const wallResolved = resolveEnemyChuHeHanJieWallCollisionClient(
        newPx,
        newPy,
        localZRef.current,
        vel,
        entitiesRef.current,
        me.userId,
        playerRadius,
      );
      newPx = wallResolved.x;
      newPy = wallResolved.y;

      localPositionRef.current = { x: newPx, y: newPy };

      // ── Z axis: jump + gravity ──
      const zLocked = movementControlStateRef.current.zLocked === true;
      if (zLocked) {
        // 亢龙有悔 / Z_LOCK: pin vertical motion. Skip jump init + gravity step.
        localVzRef.current = 0;
        jumpLocalRef.current = false;
      }
      if (!zLocked && !movementLocked && jumpLocalRef.current && localJumpCountRef.current < effectiveMaxJumps) {
        const jumpDir = normalizePlanar(moveIntentDx, moveIntentDy);
        if (!canUseYuqiMountedJumpClient(jumpDir)) {
          jumpLocalRef.current = false;
        } else {
          const isMultiJump = effectiveMaxJumps > 2;
          const hadPowerJumpAirtime = isPowerJumpRef.current && !isPowerJumpCombinedRef.current && localJumpCountRef.current > 0;
          const usePowerDirectionalBudget = hasFuyaoBuffRef.current;
          const isBackpedalAirJump = moveIntentBackpedalOnly && localJumpCountRef.current > 0 && jumpDir !== null;
          const heightAboveGround = Math.max(0, localZRef.current - tickGroundH);
          const jumpSpeedSource = Math.max(
            effectiveMaxSpeed,
            airborneSpeedCarryRef.current,
            Math.hypot(vel.x, vel.y),
            getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current),
          );
          const jumpSpeedScale = DEFAULT_MOVE_SPEED_WORLD_PER_TICK > 0.0001
            ? jumpSpeedSource / DEFAULT_MOVE_SPEED_WORLD_PER_TICK
            : 0;
          let jumpVz: number;
          let jumpGravityUp = GRAVITY_UP_CLIENT;
          let jumpGravityDown = GRAVITY_DOWN_CLIENT;
          if (hasFuyaoBuffRef.current && isMultiJump) {
          // Combined 扶摇直上 + 鸟翔碧空: 24u peak, same timing as power jump
          jumpVz = COMBINED_JUMP_VZ_CLIENT;
          jumpGravityUp = COMBINED_GRAVITY_UP_CLIENT;
          jumpGravityDown = COMBINED_GRAVITY_DOWN_CLIENT;
          isPowerJumpCombinedRef.current = true;
          isPowerJumpRef.current = false;
        } else if (hasFuyaoBuffRef.current) {
          jumpVz = POWER_JUMP_VZ_CLIENT;
          jumpGravityUp = POWER_GRAVITY_UP_CLIENT;
          jumpGravityDown = POWER_GRAVITY_DOWN_CLIENT;
          isPowerJumpRef.current = true;
          isPowerJumpCombinedRef.current = false;
        } else if (movementControlStateRef.current.tiYunZongActive && isMultiJump) {
          // 梯云纵 + 鸟翔碧空: same combined power jump (24u peak), buff persists
          jumpVz = COMBINED_JUMP_VZ_CLIENT;
          jumpGravityUp = COMBINED_GRAVITY_UP_CLIENT;
          jumpGravityDown = COMBINED_GRAVITY_DOWN_CLIENT;
          isPowerJumpCombinedRef.current = true;
          isPowerJumpRef.current = false;
        } else if (movementControlStateRef.current.tiYunZongActive) {
          jumpVz = POWER_JUMP_VZ_CLIENT;
          jumpGravityUp = POWER_GRAVITY_UP_CLIENT;
          jumpGravityDown = POWER_GRAVITY_DOWN_CLIENT;
          isPowerJumpRef.current = true;
          isPowerJumpCombinedRef.current = false;
        } else if (localJumpCountRef.current === 0) {
          jumpVz = isMultiJump ? JUMP_VZ_CLIENT * MULTI_JUMP_HEIGHT_MULT : JUMP_VZ_CLIENT;
          isPowerJumpRef.current = false;
          isPowerJumpCombinedRef.current = false;
        } else {
          // 鸟翔碧空: every jump is full 3× strength
          jumpVz = isMultiJump ? JUMP_VZ_CLIENT * MULTI_JUMP_HEIGHT_MULT : DOUBLE_JUMP_VZ_CLIENT;
          isPowerJumpRef.current = false;
          isPowerJumpCombinedRef.current = false;
        }
        const directionalJumpDistance = isBackpedalAirJump
          ? getBackpedalDoubleJumpDistance(mode)
          : usePowerDirectionalBudget
            ? POWER_DIRECTIONAL_JUMP_DISTANCE
            : hadPowerJumpAirtime
              ? POWER_DOUBLE_DIRECTIONAL_JUMP_DISTANCE
              : isMultiJump && !hasFuyaoBuffRef.current
                ? MULTI_JUMP_DIRECTIONAL_JUMP_DISTANCE
              : DIRECTIONAL_JUMP_DISTANCE;
        hasFuyaoBuffRef.current   = false;
        const jumpVzScale = movementControlStateRef.current.jumpVzScale ?? 1;
        if (jumpVzScale < 1) jumpVz *= jumpVzScale;
        localVzRef.current        = jumpVz;
        vel.x = 0;
        vel.y = 0;
        let nextJumpPhase = localJumpCountRef.current + 1;
        if (movementControlStateRef.current.tiYunZongActive && !tiYunZongPenaltyConsumedRef.current) {
          nextJumpPhase += 1;
          tiYunZongPenaltyConsumedRef.current = true;
        }
        localJumpCountRef.current = nextJumpPhase;
        jumpLocalRef.current       = false;
        airborneSpeedCarryRef.current = jumpSpeedSource;
        jumpTelemetryRef.current = {
          startMs: tickNowMs,
          peakMs: tickNowMs,
          takeoffGround: tickGroundH,
          peakHeightWorld: 0,
          takeoffPos: {
            x: localPositionRef.current?.x ?? pos.x,
            y: localPositionRef.current?.y ?? pos.y,
          },
          expectedLandWorld: jumpDir ? directionalJumpDistance * Math.max(0, jumpSpeedScale) : 0,
          startSpeedUnitsPerSec: (jumpSpeedSource * CLIENT_TICK_HZ) / UNIT_SCALE,
          jumpPhase: nextJumpPhase,
          mode: jumpDir ? 'directional' : 'upward',
        };

        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;

        if (jumpDir) {
          airNudgeRemainingRef.current = directionalJumpDistance * Math.max(0, jumpSpeedScale);
          airNudgeTicksRemainingRef.current = estimateAirborneTicks(
            heightAboveGround,
            jumpVz,
            jumpGravityUp,
            jumpGravityDown,
          );
          airNudgeDirRef.current = jumpDir;
          airDirectionLockedRef.current = true;
          if (!isBackpedalAirJump) {
            localFacingRef.current = jumpDir;
            charYawRef.current = facingToYaw(jumpDir);
          }
        } else {
          airNudgeRemainingRef.current = UPWARD_JUMP_AIR_SHIFT_DISTANCE;
        }
      }
      }
      const gravUp   = isPowerJumpCombinedRef.current ? COMBINED_GRAVITY_UP_CLIENT
                     : isPowerJumpRef.current         ? POWER_GRAVITY_UP_CLIENT
                     : GRAVITY_UP_CLIENT;
      const gravDown = isPowerJumpCombinedRef.current ? COMBINED_GRAVITY_DOWN_CLIENT
                     : isPowerJumpRef.current         ? POWER_GRAVITY_DOWN_CLIENT
                     : GRAVITY_DOWN_CLIENT;
      if (!zLocked) {
        localVzRef.current -= (localVzRef.current >= 0 ? gravUp : gravDown);
      } else {
        localVzRef.current = 0;
      }

      // Ground height: BVH cylinder (collision-test) or AABB (other modes)
      let rawClientGroundH: number;
      if (useBVH) {
        const sys = collisionSysRef.current!;
        // ── Cylinder vertical pass ──
        // Apply gravity to cylinder centre (feet + halfHeight).
        _bvhCenter.y += localVzRef.current / RENDER_SF;

        const ceilingExportY = getBvhCeilingY(sys, _bvhCenter);
        const headExportY = _bvhCenter.y + EXPORT_CYL_HALF_HEIGHT;
        if (localVzRef.current > 0 && ceilingExportY !== null && headExportY >= ceilingExportY) {
          _bvhCenter.y = ceilingExportY - EXPORT_CYL_HALF_HEIGHT;
          localVzRef.current = -0.0001;
        }

        const groundExportY = getBvhGroundSupportY(sys, _bvhCenter);
        const feetExportY   = _bvhCenter.y - EXPORT_CYL_HALF_HEIGHT;
        let bvhOnGround = false;

        if (groundExportY !== null) {
          const gap = feetExportY - groundExportY; // negative → below surface, positive → above
          if (gap <= 0) {
            // Feet at or below terrain surface → snap up, land
            _bvhCenter.y    = groundExportY + EXPORT_CYL_HALF_HEIGHT;
            localVzRef.current = 0;
            bvhOnGround     = true;
          } else if (
            gap <= BVH_STEP_UP_EXPORT &&
            localVzRef.current <= 0 &&
            localJumpCountRef.current === 0
          ) {
            // Small gap while falling/standing → step-up snap (stairs / lips)
            _bvhCenter.y    = groundExportY + EXPORT_CYL_HALF_HEIGHT;
            localVzRef.current = 0;
            bvhOnGround     = true;
          }
        }

        // Fall recovery: if somehow far below terrain, teleport up
        const floorY = groundExportY ?? feetExportY;
        if (_bvhCenter.y - EXPORT_CYL_HALF_HEIGHT < floorY - 3500) {
          _bvhCenter.y    = floorY + EXPORT_CYL_HALF_HEIGHT + 120;
          localVzRef.current = 0;
        }

        collisionDebugRef.current = {
          enabled: true,
          center: { x: _bvhCenter.x, y: _bvhCenter.y, z: _bvhCenter.z },
          supportY: groundExportY,
        };

        // Feet = cylinder bottom = exact terrain surface when grounded (no slope float)
        const feetGameZ = (_bvhCenter.y - EXPORT_CYL_HALF_HEIGHT) * RENDER_SF + GROUP_POS_Y;
        localZRef.current = feetGameZ;
        rawClientGroundH = bvhOnGround
          ? feetGameZ
          : (groundExportY !== null ? groundExportY * RENDER_SF + GROUP_POS_Y : feetGameZ);
      } else {
        rawClientGroundH = getGroundHeightClient(localPositionRef.current.x, localPositionRef.current.y, localZRef.current, objs, playerRadius);
        localZRef.current = Math.max(rawClientGroundH, localZRef.current + localVzRef.current);
      }
      const clientGroundH = rawClientGroundH;
      if (jumpTelemetryRef.current) {
        const currentHeightWorld = Math.max(0, localZRef.current - jumpTelemetryRef.current.takeoffGround);
        if (currentHeightWorld >= jumpTelemetryRef.current.peakHeightWorld - 0.001) {
          jumpTelemetryRef.current.peakHeightWorld = Math.max(jumpTelemetryRef.current.peakHeightWorld, currentHeightWorld);
          jumpTelemetryRef.current.peakMs = tickNowMs;
        }
      }
      if (localZRef.current <= clientGroundH) {
        const telemetry = jumpTelemetryRef.current;
        if (telemetry) {
          const landPos = localPositionRef.current ?? pos;
          const actualLandWorld = Math.hypot(
            landPos.x - telemetry.takeoffPos.x,
            landPos.y - telemetry.takeoffPos.y,
          );
          jumpRecordNextRef.current = {
            riseMs: Math.max(0, telemetry.peakMs - telemetry.startMs),
            fallMs: Math.max(0, tickNowMs - telemetry.peakMs),
            totalMs: Math.max(0, tickNowMs - telemetry.startMs),
            peakUnits: telemetry.peakHeightWorld / UNIT_SCALE,
            startSpeedUnitsPerSec: telemetry.startSpeedUnitsPerSec,
            expectedLandUnits: telemetry.expectedLandWorld / UNIT_SCALE,
            actualLandUnits: actualLandWorld / UNIT_SCALE,
            jumpPhase: telemetry.jumpPhase,
            mode: telemetry.mode,
          };
          jumpTelemetryRef.current = null;
        }
        localZRef.current              = clientGroundH;
        localVzRef.current             = 0;
        localJumpCountRef.current      = 0;
        tiYunZongPenaltyConsumedRef.current = false;
        isPowerJumpRef.current         = false;
        isPowerJumpCombinedRef.current = false;
        airDirectionLockedRef.current  = false;
        airborneSpeedCarryRef.current  = 0;
        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
      }
    };
    const id = setInterval(tick, CLIENT_TICK_MS);
    return () => clearInterval(id);
  }, [ARENA_HEIGHT, ARENA_WIDTH, getEffectiveMaxJumps, me.userId, mode, playerRadius]);

  useEffect(() => {
    const id = setInterval(sendMovement, 1000 / 30);
    return () => { clearInterval(id); };
  }, [sendMovement]);

  useEffect(() => {
    const id = setInterval(async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/game/ping', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify({ gameId }),
        });
        setRtt(Math.round(performance.now() - t0));
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(id);
  }, [gameId]);

  /* ========================= HUD DATA ========================= */
  const myMaxHp = me?.maxHp ?? maxHp;
  const myAttackDamage = Math.max(0, Number((me as any)?.attackDamage ?? 50_000));
  const myShield = Math.max(0, me?.shield ?? 0);
  const myBarSegments = computeHpShieldSegments(me?.hp ?? 0, myShield, myMaxHp);
  const myHpPct = myBarSegments.hpPct;
  const myShieldPct = myBarSegments.shieldPct;
  const iconBarHpGradient = 'linear-gradient(180deg, #ff9a74 0%, #ef5b39 46%, #c92a1c 100%)';
  const selfIconBarHpGradient = 'linear-gradient(180deg, #ff9a74 0%, #ef5b39 46%, #c92a1c 100%)';
  const renderCombatStatusMarker = (active?: boolean) => active ? (
    <div className={styles.combatStatusMarker} title="战斗中" aria-label="战斗中">
      <Swords size={20} strokeWidth={2.5} aria-hidden="true" />
    </div>
  ) : null;
  const BASE_CRIT_EFFECT_MULTIPLIER = 1.75;
  const myBaseWaiGongCritChancePct = Math.max(
    0,
    Math.min(100, Number((me as any)?.waiGongCritChancePct ?? (me as any)?.critChancePct ?? 0)),
  );
  const myBaseNeiGongCritChancePct = Math.max(
    0,
    Math.min(100, Number((me as any)?.neiGongCritChancePct ?? (me as any)?.critChancePct ?? 0)),
  );
  const myBaseDefensePct = Math.max(
    0,
    Math.min(100, Number((me as any)?.defensePct ?? 0)),
  );
  const myHuajinPct = Math.max(
    0,
    Math.min(100, Number((me as any)?.huajinPct ?? 0)),
  );
  const myHasteRatePct = Math.max(0, Number((me as any)?.hasteRatePct ?? BASE_HASTE_RATE_PCT));
  const myFacingArrow = facingArrow(localFacingRef.current);
  const meEffects = (me?.buffs ?? []).flatMap((b: any) => Array.isArray(b?.effects) ? b.effects : []);
  const getTypedEffectTotal = (effectType: string, damageType: '外功' | '内功') => meEffects
    .filter((e: any) => e?.type === effectType && (!e?.damageType || e?.damageType === damageType))
    .reduce((sum: number, e: any) => sum + Number(e?.value ?? 0), 0);
  const defenseMultiplier = meEffects
    .filter((e: any) => e?.type === 'DEFENSE_MULTIPLIER')
    .reduce((multiplier: number, e: any) => {
      const value = Number(e?.value ?? e?.defenseMultiplier ?? 1);
      return Number.isFinite(value) ? multiplier * Math.max(0, value) : multiplier;
    }, 1);
  const attackDamageMultiplier = meEffects
    .filter((e: any) => e?.type === 'ATTACK_DAMAGE_MULTIPLIER')
    .reduce((bonus: number, e: any) => {
      const value = Number(e?.value ?? 1);
      return Number.isFinite(value) ? bonus + (value - 1) : bonus;
    }, 0);
  const myEffectiveAttackDamage = Math.max(0, myAttackDamage * Math.max(0, 1 + attackDamageMultiplier));
  const myDefensePct = Math.max(0, Math.min(100, myBaseDefensePct * defenseMultiplier));
  const myWaiGongCritChancePct = Math.max(
    0,
    Math.min(100, myBaseWaiGongCritChancePct + getTypedEffectTotal('CRIT_CHANCE_BONUS', '外功')),
  );
  const myNeiGongCritChancePct = Math.max(
    0,
    Math.min(100, myBaseNeiGongCritChancePct + getTypedEffectTotal('CRIT_CHANCE_BONUS', '内功')),
  );
  const myWaiGongCritEffectPct = Math.max(
    0,
    (BASE_CRIT_EFFECT_MULTIPLIER + getTypedEffectTotal('CRIT_EFFECT_BONUS', '外功')) * 100,
  );
  const myNeiGongCritEffectPct = Math.max(
    0,
    (BASE_CRIT_EFFECT_MULTIPLIER + getTypedEffectTotal('CRIT_EFFECT_BONUS', '内功')) * 100,
  );
  const moveSpeedBoostSum = meEffects
    .filter((e: any) => e?.type === 'SPEED_BOOST')
    .reduce((sum: number, e: any) => sum + Number(e?.value ?? 0), 0);
  const moveSpeedSlowSum = meEffects
    .filter((e: any) => e?.type === 'SLOW')
    .reduce((sum: number, e: any) => sum + Number(e?.value ?? 0), 0);
  const baseMoveSpeed = Number(me?.moveSpeed ?? getDefaultMoveSpeedPerTick(mode));
  const finalMoveSpeed = Math.max(0, baseMoveSpeed * Math.max(0, 1 + moveSpeedBoostSum - moveSpeedSlowSum));
  const baseMoveSpeedUnitsPerSec = baseMoveSpeed * SERVER_TICK_RATE / storedUnitScale;
  const effectiveMoveSpeedUnitsPerSec = finalMoveSpeed * SERVER_TICK_RATE / storedUnitScale;
  const damageReductionPct = Math.max(
    0,
    meEffects
      .filter((e: any) => e?.type === 'DAMAGE_REDUCTION')
      .reduce((sum: number, e: any) => sum + Number(e?.value ?? 0), 0) * 100,
  );
  const dodgeChancePct = Math.max(
    0,
    Math.min(
      100,
      meEffects
        .filter((e: any) => e?.type === 'DODGE')
        .reduce((sum: number, e: any) => sum + Number(e?.chance ?? 0), 0) * 100,
    ),
  );
  const formatStatPct = (value: number) => `${Number.isFinite(value) ? value.toFixed(2) : '0.00'}%`;
  const formatWholePct = (value: number) => `${Math.max(0, Math.round(Number.isFinite(value) ? value : 0))}%`;
  const formatMergedPct = (outerValue: number, innerValue: number) => {
    if (Math.abs(outerValue - innerValue) < 0.005) return formatStatPct(outerValue);
    return `${formatStatPct(outerValue)} / ${formatStatPct(innerValue)}`;
  };
  const formatTooltipLine = (label: string, value: string) => `${label}: ${value}`;
  const formatSpeedUnits = (value: number) => `${formatCompactNumber(value)}尺/秒`;
  const runSpeedDisplayValue = String(Math.max(0, Math.round(effectiveMoveSpeedUnitsPerSec * 4)));
  const heartStatRows: HeartStatRow[] = [
    {
      key: 'attack',
      label: '攻击力',
      value: formatGameAmount(myEffectiveAttackDamage),
      tooltipTitle: '攻击力',
      tooltipLines: Math.abs(myEffectiveAttackDamage - myAttackDamage) > 0.5
        ? [
            formatTooltipLine('基础攻击力', formatGameAmount(myAttackDamage)),
            formatTooltipLine('当前攻击力', formatGameAmount(myEffectiveAttackDamage)),
          ]
        : [formatTooltipLine('攻击力', formatGameAmount(myAttackDamage))],
    },
    {
      key: 'maxHp',
      label: '气血值',
      value: formatGameAmount(myMaxHp),
      tooltipTitle: '气血值',
      tooltipLines: [formatTooltipLine('气血值', formatGameAmount(myMaxHp))],
    },
    {
      key: 'crit',
      label: '会心',
      value: formatMergedPct(myWaiGongCritChancePct, myNeiGongCritChancePct),
      tooltipTitle: '会心',
      tooltipLines: [
        formatTooltipLine('外功会心', formatStatPct(myWaiGongCritChancePct)),
        formatTooltipLine('内功会心', formatStatPct(myNeiGongCritChancePct)),
      ],
    },
    {
      key: 'critEffect',
      label: '会心效果',
      value: formatMergedPct(myWaiGongCritEffectPct, myNeiGongCritEffectPct),
      tooltipTitle: '会心效果',
      tooltipLines: [
        formatTooltipLine('外功会心效果', formatStatPct(myWaiGongCritEffectPct)),
        formatTooltipLine('内功会心效果', formatStatPct(myNeiGongCritEffectPct)),
      ],
    },
    {
      key: 'haste',
      label: '加速率',
      value: formatStatPct(myHasteRatePct),
      tooltipTitle: '加速率',
      tooltipLines: [formatTooltipLine('加速率', formatStatPct(myHasteRatePct))],
    },
    {
      key: 'dodge',
      label: '闪避',
      value: `${Math.max(0, Math.round(dodgeChancePct))}%`,
      tooltipTitle: '闪避',
      tooltipLines: [formatTooltipLine('闪避', `${Math.max(0, Math.round(dodgeChancePct))}%`)],
    },
    {
      key: 'runSpeed',
      label: '跑速',
      value: runSpeedDisplayValue,
      tooltipTitle: '跑速',
      tooltipLines: [formatTooltipLine('移动速度', formatSpeedUnits(effectiveMoveSpeedUnitsPerSec))],
    },
    {
      key: 'defense',
      label: '防御',
      value: formatStatPct(myDefensePct),
      tooltipTitle: '防御',
      tooltipLines: [formatTooltipLine('受到伤害降低', formatStatPct(myDefensePct))],
    },
    {
      key: 'huajin',
      label: '化劲',
      value: formatStatPct(myHuajinPct),
      tooltipTitle: '化劲',
      tooltipLines: [formatTooltipLine('最终伤害降低', formatStatPct(myHuajinPct))],
    },
    {
      key: 'damageReduction',
      label: '伤害减免',
      value: formatWholePct(damageReductionPct),
      tooltipTitle: '伤害减免',
      tooltipLines: [formatTooltipLine('伤害减免', formatWholePct(damageReductionPct))],
    },
  ].sort((a, b) => HEART_STAT_ORDER.indexOf(a.key) - HEART_STAT_ORDER.indexOf(b.key));
  const openHeartStatHint = useCallback((event: React.MouseEvent<HTMLElement>, row: HeartStatRow) => {
    if (!row.tooltipLines || row.tooltipLines.length === 0) return;
    setHeartStatHint({
      title: row.tooltipTitle ?? row.label,
      lines: row.tooltipLines,
      anchorRect: event.currentTarget.getBoundingClientRect(),
    });
  }, []);
  const toggleHeartStatVisibility = useCallback((key: HeartStatKey) => {
    setHeartStatVisibility((prev) => ({
      ...prev,
      [key]: prev[key] === false,
    }));
  }, []);

  const formatCombatPresetValue = (statKey: CombatPresetStatKey, value: number) => (
    statKey === 'attackDamage' || statKey === 'maxHp' ? formatGameAmount(value) : `${value}%`
  );
  const formatCombatPresetExactValue = (statKey: CombatPresetStatKey, value: number) => (
    statKey === 'attackDamage' || statKey === 'maxHp' ? formatGameAmount(value) : `${value}%`
  );
  const isWholeCombatPresetActive = (preset: typeof COMBAT_PRESET_RARITIES[number]) => (
    Math.abs(myBaseWaiGongCritChancePct - preset.stats.critChancePct) < 0.001 &&
    Math.abs(myBaseNeiGongCritChancePct - preset.stats.critChancePct) < 0.001 &&
    Math.abs(myBaseDefensePct - preset.stats.defensePct) < 0.001 &&
    Math.abs(myHuajinPct - preset.stats.huajinPct) < 0.001 &&
    Math.abs(myMaxHp - preset.stats.maxHp) < 0.001 &&
    Math.abs(myAttackDamage - preset.stats.attackDamage) < 0.001
  );
  const isCombatPresetStatActive = (preset: typeof COMBAT_PRESET_RARITIES[number], statKey: CombatPresetStatKey) => {
    if (statKey === 'critChancePct') {
      return Math.abs(myBaseWaiGongCritChancePct - preset.stats.critChancePct) < 0.001 &&
        Math.abs(myBaseNeiGongCritChancePct - preset.stats.critChancePct) < 0.001;
    }
    if (statKey === 'defensePct') return Math.abs(myBaseDefensePct - preset.stats.defensePct) < 0.001;
    if (statKey === 'huajinPct') return Math.abs(myHuajinPct - preset.stats.huajinPct) < 0.001;
    if (statKey === 'maxHp') return Math.abs(myMaxHp - preset.stats.maxHp) < 0.001;
    return Math.abs(myAttackDamage - preset.stats.attackDamage) < 0.001;
  };
  const applyCombatPreset = (preset: typeof COMBAT_PRESET_RARITIES[number], statKey?: CombatPresetStatKey) => {
    const body: Record<string, number> = {
      waiGongCritChancePct: myBaseWaiGongCritChancePct,
      neiGongCritChancePct: myBaseNeiGongCritChancePct,
    };
    if (!statKey || statKey === 'critChancePct') {
      body.waiGongCritChancePct = preset.stats.critChancePct;
      body.neiGongCritChancePct = preset.stats.critChancePct;
    }
    if (!statKey || statKey === 'defensePct') body.defensePct = preset.stats.defensePct;
    if (!statKey || statKey === 'huajinPct') body.huajinPct = preset.stats.huajinPct;
    if (!statKey || statKey === 'maxHp') body.maxHp = preset.stats.maxHp;
    if (!statKey || statKey === 'attackDamage') body.attackDamage = preset.stats.attackDamage;

    const statText = statKey
      ? `${COMBAT_PRESET_STAT_ROWS.find((row) => row.key === statKey)?.label ?? '属性'} ${formatCombatPresetValue(statKey, preset.stats[statKey])}`
      : `外功会心/内功会心 ${preset.stats.critChancePct}%，防御力 ${preset.stats.defensePct}%，化劲 ${preset.stats.huajinPct}%，气血 ${formatGameAmount(preset.stats.maxHp)}，攻击力 ${formatGameAmount(preset.stats.attackDamage)}`;

    return runCheatAction(
      statKey ? `set-${statKey}-${preset.id}` : `set-combat-preset-${preset.id}`,
      '/api/game/cheat/set-crit-chance',
      `双方${statText}已设定`,
      body,
    );
  };
  const selectedTargetForHud = selectedTargetId
    ? opponentsList.find((o) => o.userId === selectedTargetId) ?? null
    : null;
  const selectedEntityForHud = selectedEntityId
    ? (entities ?? []).find((entity) => entity.id === selectedEntityId) ?? null
    : null;
  const selectedTargetAnchor = selectedTargetForHud?.position ?? selectedEntityForHud?.position ?? null;
  const selectedTargetDistance = selectedSelf
    ? 0
    : (selectedTargetAnchor && me.position)
    ? worldUnitsToNewUnits(Math.sqrt(
        Math.pow(selectedTargetAnchor.x - me.position.x, 2) +
        Math.pow(selectedTargetAnchor.y - me.position.y, 2) +
        Math.pow(((selectedTargetAnchor as any)?.z ?? 0) - (((me.position as any)?.z) ?? 0), 2)
      ), mode)
    : null;

    const startSpeedTest = useCallback(() => {
      const pos = localPositionRef.current;
      const now = performance.now();
      speedTestRunRef.current = {
        active: true,
        distanceWorld: 0,
        validElapsedMs: 0,
        maxUnitsPerSec: 0,
      };
      speedSamplePrevRef.current = pos ? { x: pos.x, y: pos.y, t: now } : null;
      setSpeedTestState((prev) => ({
        ...prev,
        active: true,
        measuredDistanceUnits: 0,
        measuredElapsedMs: 0,
        averageUnitsPerSec: 0,
        maxUnitsPerSec: 0,
      }));
    }, []);

    const stopSpeedTest = useCallback(() => {
      speedTestRunRef.current = {
        ...speedTestRunRef.current,
        active: false,
      };
      setSpeedTestState((prev) => ({ ...prev, active: false }));
    }, []);

    const resetSpeedTest = useCallback(() => {
      const pos = localPositionRef.current;
      const now = performance.now();
      speedTestRunRef.current = {
        active: false,
        distanceWorld: 0,
        validElapsedMs: 0,
        maxUnitsPerSec: 0,
      };
      speedSamplePrevRef.current = pos ? { x: pos.x, y: pos.y, t: now } : null;
      setSpeedTestState((prev) => ({
        ...prev,
        active: false,
        measuredDistanceUnits: 0,
        measuredElapsedMs: 0,
        averageUnitsPerSec: 0,
        maxUnitsPerSec: 0,
      }));
    }, []);

  const RARITY_ORDER: Record<string, number> = { '稀世': 0, '珍奇': 1, '卓越': 2, '精巧': 3 };
  const RARITY_COLOR: Record<string, string> = {
    '稀世': '#ff922b', '珍奇': '#cc5de8', '卓越': '#74c0fc', '精巧': '#69db7c',
  };
  const SCHOOL_COLOR: Record<string, string> = {
    '七秀': '#f9a8d4', '万花': '#b197fc', '五毒': '#60a5fa', '长歌': '#63e6be',
    '药宗': '#20c997', '天策': '#ff922b', '少林': '#fbbf24', '明教': '#f87171',
    '苍云': '#b08060', '纯阳': '#a5d8ff', '唐门': '#339af0', '藏剑': '#ffe066',
    '丐帮': '#ffa94d', '霸刀': '#4dabf7', '蓬莱': '#ced4da', '凌雪': '#e03131',
    '衍天': '#d0bfff', '刀宗': '#adb5bd', '万灵': '#fab005', '段氏': '#868e96', '通用': '#94a3b8',
  };
  const SCHOOL_TAGS_BA = ['少林','万花','天策','纯阳','七秀','藏剑','五毒','唐门','丐帮','明教','苍云','长歌','霸刀','蓬莱','凌雪','衍天','药宗','刀宗','万灵','段氏','通用'];

  const cheatAbilities = useMemo(
    () =>
      Object.values(abilities)
        .filter(
          (c: any) =>
            c &&
            !c.isCommon &&
            c.specialBarAbility !== true &&
            c.hiddenFromDraft !== true &&
            c.id &&
            c.name,
        )
        .sort((a: any, b: any) => {
          const ra = RARITY_ORDER[a.rarity] ?? 99;
          const rb = RARITY_ORDER[b.rarity] ?? 99;
          if (ra !== rb) return ra - rb;
          return a.name.localeCompare(b.name);
        }),
    [abilities],
  );

  const filteredCheatAbilities = useMemo(() => {
    let list = cheatAbilities;
    if (cheatRarityFilter === 'unset') list = list.filter((a: any) => !a.rarity);
    else if (cheatRarityFilter !== 'all') list = list.filter((a: any) => a.rarity === cheatRarityFilter);
    if (cheatSchoolFilter === 'unset') list = list.filter((a: any) => !a.tags?.school);
    else if (cheatSchoolFilter !== 'all') list = list.filter((a: any) => a.tags?.school === cheatSchoolFilter);
    return list;
  }, [cheatAbilities, cheatRarityFilter, cheatSchoolFilter]);

  const renderCheatIcon = (ability: any) => {
    const rarityBorderColor = ability.rarity ? RARITY_COLOR[ability.rarity] : '#555';
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={ability.id}
        src={getArenaAbilityIconPath(ability.name)}
        alt={ability.name}
        title={`${ability.name}${ability.rarity ? ` [${ability.rarity}]` : ''}${ability.description ? '\n' + ability.description : ''}`}
        style={{
          width: 32,
          height: 32,
          objectFit: 'contain',
          borderRadius: 4,
          border: `1.5px solid ${rarityBorderColor}`,
          cursor: addingAbility === ability.id ? 'wait' : 'pointer',
          opacity: addingAbility === ability.id ? 0.4 : 1,
          background: 'rgba(20,5,5,0.8)',
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
        onClick={async () => {
          if (addingAbility) return;
          setAddingAbility(ability.id);
          try {
            const res = await fetch('/api/game/cheat/add-ability', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ gameId, abilityId: ability.id }),
            });
            if (!res.ok) {
              const err = await res.json();
              console.error('[CheatWindow] add-ability failed:', err);
              toastError(err.error ?? '添加技能失败');
            }
          } catch (e) {
            console.error('[CheatWindow] error:', e);
          } finally {
            setAddingAbility(null);
          }
        }}
      />
    );
  };

  const runCheatAction = useCallback(
    async (actionId: string, url: string, successText: string, body?: Record<string, any>) => {
      if (runningCheatAction) return false;
      setRunningCheatAction(actionId);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ gameId, ...(body ?? {}) }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toastError(err.error ?? '操作失败');
          return false;
        }
        toastSuccess(successText);
        return true;
      } catch {
        toastError('网络错误');
        return false;
      } finally {
        setRunningCheatAction(null);
      }
    },
    [gameId, runningCheatAction],
  );

  const reorderDraftAbility = useCallback(
    async (instanceId: string, toIndex: number) => {
      const previousAbilities = abilitiesRef.current;
      const clampedToIndex = normalizeDraftSlotIndex(toIndex, toIndex);
      const predictedAbilities = predictDraftAbilityReorder(previousAbilities, instanceId, clampedToIndex);
      if (predictedAbilities) {
        pendingDraftReorderRef.current = { instanceId, toIndex: clampedToIndex };
        abilitiesRef.current = predictedAbilities;
        setHandAbilities(predictedAbilities);
      }

      try {
        const res = await fetch('/api/game/cheat/reorder-ability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ gameId, instanceId, toIndex }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (predictedAbilities) {
            pendingDraftReorderRef.current = null;
            abilitiesRef.current = previousAbilities;
            setHandAbilities(previousAbilities);
          }
          toastError(err.error ?? '拖拽换位失败');
          return false;
        }
        return true;
      } catch {
        if (predictedAbilities) {
          pendingDraftReorderRef.current = null;
          abilitiesRef.current = previousAbilities;
          setHandAbilities(previousAbilities);
        }
        toastError('网络错误');
        return false;
      }
    },
    [gameId],
  );

  const discardDraftAbility = useCallback(
    async (instanceId: string) => {
      const res = await fetch('/api/game/cheat/discard-ability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId, instanceId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toastError(err.error ?? '弃置失败');
        return false;
      }
      toastSuccess('技能已弃置');
      return true;
    },
    [gameId],
  );

  const getVisibleDraftSlotsForLocalMove = useCallback(() => {
    const heldItemIds = new Set(itemBarAbilitiesRef.current.filter(Boolean).map((ability) => ability!.id));
    return buildDraftAbilitySlots(
      abilitiesRef.current
        .filter((ability) => !ability.isCommon && !ability.isSpecialBarAbility && !heldItemIds.has(ability.id))
        .map((ability) => {
          const overrideSlotIndex = draftSlotOverridesRef.current[ability.id];
          return typeof overrideSlotIndex === 'number'
            ? { ...ability, slotIndex: normalizeDraftSlotIndex(overrideSlotIndex, overrideSlotIndex) }
            : ability;
        }),
    );
  }, []);

  const removeAbilityFromItemBar = useCallback((instanceId: string) => {
    const nextItemSlots = itemBarAbilitiesRef.current.map((ability) => (
      ability?.id === instanceId ? undefined : ability
    ));
    itemBarAbilitiesRef.current = nextItemSlots;
    setItemBarAbilities(nextItemSlots);
  }, []);

  const moveAbilityBetweenLocalBars = useCallback((dragState: DraftPointerDragState, target: AbilityDropTarget) => {
    if (dragState.sourceKind === target.kind && dragState.sourceIndex === target.index) return;
    const latestAbility = (ability: AbilityInfo) => abilitiesRef.current.find((candidate) => candidate.id === ability.id) ?? ability;
    const draggedAbility = latestAbility(dragState.ability);
    const nextItemSlots = itemBarAbilitiesRef.current.map((ability) => ability ? latestAbility(ability) : undefined);
    const nextOverrides = { ...draftSlotOverridesRef.current };
    const visibleDraftSlots = getVisibleDraftSlotsForLocalMove();

    const placeInItemSlot = (index: number, ability: AbilityInfo | undefined) => {
      nextItemSlots[index] = ability ? latestAbility(ability) : undefined;
      if (ability) delete nextOverrides[ability.id];
    };

    if (dragState.sourceKind === 'draft' && target.kind === 'item') {
      const targetItemAbility = nextItemSlots[target.index];
      placeInItemSlot(target.index, draggedAbility);
      delete nextOverrides[draggedAbility.id];
      if (targetItemAbility) {
        nextOverrides[targetItemAbility.id] = normalizeDraftSlotIndex(dragState.sourceIndex, dragState.sourceIndex);
      }
    } else if (dragState.sourceKind === 'item' && target.kind === 'draft') {
      const targetDraftAbility = visibleDraftSlots[target.index];
      placeInItemSlot(dragState.sourceIndex, targetDraftAbility ? latestAbility(targetDraftAbility) : undefined);
      nextOverrides[draggedAbility.id] = normalizeDraftSlotIndex(target.index, target.index);
    } else if (dragState.sourceKind === 'item' && target.kind === 'item') {
      const targetItemAbility = nextItemSlots[target.index];
      nextItemSlots[target.index] = draggedAbility;
      nextItemSlots[dragState.sourceIndex] = targetItemAbility;
    }

    itemBarAbilitiesRef.current = nextItemSlots;
    draftSlotOverridesRef.current = nextOverrides;
    setItemBarAbilities(nextItemSlots);
    setDraftSlotOverrides(nextOverrides);
  }, [getVisibleDraftSlotsForLocalMove]);

  const handleDraftDragStart = (e: React.DragEvent, instanceId: string, slotIndex: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', instanceId);
    try {
      const dragElement = e.currentTarget as HTMLElement;
      e.dataTransfer.setDragImage(dragElement, Math.round(dragElement.clientWidth / 2), Math.round(dragElement.clientHeight / 2));
    } catch {}
    abilityDragActiveRef.current = true;
    closeAbilityHint();
    dragJustEndedRef.current = false;
    setDraggingDraftInstanceId(instanceId);
    setDragHoverIndex(slotIndex);
    setDiscardZoneHover(false);
  };

  const handleDraftDragEnd = () => {
    abilityDragActiveRef.current = false;
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setDragHoverItemIndex(null);
    setDiscardZoneHover(false);
    dragJustEndedRef.current = true;
    window.setTimeout(() => {
      dragJustEndedRef.current = false;
    }, 120);
  };

  const handleDraftSlotDrop = async (e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const instanceId = e.dataTransfer.getData('text/plain') || draggingDraftInstanceId;
    if (!instanceId) return;
    await reorderDraftAbility(instanceId, slotIndex);
    abilityDragActiveRef.current = false;
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setDragHoverItemIndex(null);
    setDiscardZoneHover(false);
  };

  const handleDiscardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const instanceId = e.dataTransfer.getData('text/plain') || draggingDraftInstanceId;
    if (!instanceId) return;
    await discardDraftAbility(instanceId);
    abilityDragActiveRef.current = false;
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setDragHoverItemIndex(null);
    setDiscardZoneHover(false);
  };

  const beginAbilityPointerDrag = useCallback((e: React.MouseEvent, ability: AbilityInfo, sourceKind: AbilityDragSlotKind, slotIndex: number) => {
    if (e.button !== 0 || (sourceKind === 'draft' && specialBarActive)) return;
    abilityDragActiveRef.current = true;
    mouseStateRef.current.isLeft = false;
    mouseStateRef.current.isRight = false;
    manualCameraLookActiveRef.current = false;
    pendingDraftDragRef.current = {
      instanceId: ability.id,
      sourceKind,
      sourceIndex: slotIndex,
      ability,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, [specialBarActive]);

  useEffect(() => {
    const getAbilityDropTargetAtPoint = (clientX: number, clientY: number): AbilityDropTarget | null => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      if (element?.closest('[data-consumable-slot]')) return null;
      const itemSlotElement = element?.closest('[data-item-slot-index]') as HTMLElement | null;
      if (itemSlotElement) {
        const rawIndex = itemSlotElement.dataset.itemSlotIndex;
        if (rawIndex !== undefined) {
          const index = Number(rawIndex);
          if (Number.isInteger(index)) return { kind: 'item', index };
        }
      }
      const slotElement = element?.closest('[data-draft-slot-index]') as HTMLElement | null;
      if (!slotElement) return null;
      const rawIndex = slotElement.dataset.draftSlotIndex;
      if (rawIndex === undefined) return null;
      const index = Number(rawIndex);
      return Number.isInteger(index) ? { kind: 'draft', index } : null;
    };

    const isDiscardZoneAtPoint = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      return !!element?.closest('[data-discard-drop-zone]');
    };

    const clearPointerDrag = () => {
      pendingDraftDragRef.current = null;
      abilityDragActiveRef.current = false;
      setDraftDragGhost(null);
      setDraggingDraftInstanceId(null);
      setDragHoverIndex(null);
      setDragHoverItemIndex(null);
      setDiscardZoneHover(false);
      dragJustEndedRef.current = true;
      window.setTimeout(() => {
        dragJustEndedRef.current = false;
      }, 140);
    };

    const onMouseMove = (event: MouseEvent) => {
      const dragState = pendingDraftDragRef.current;
      if (!dragState) return;

      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (!dragState.active && Math.hypot(dx, dy) < 5) {
        return;
      }

      if (!dragState.active) {
        dragState.active = true;
        abilityDragActiveRef.current = true;
        dragJustEndedRef.current = false;
        closeAbilityHint();
        setDraggingDraftInstanceId(dragState.instanceId);
      }

      event.preventDefault();
      setDraftDragGhost({ ability: dragState.ability, x: event.clientX, y: event.clientY });

      if (isDiscardZoneAtPoint(event.clientX, event.clientY)) {
        setDiscardZoneHover(true);
        setDragHoverIndex(null);
        setDragHoverItemIndex(null);
        return;
      }

      setDiscardZoneHover(false);
      const dropTarget = getAbilityDropTargetAtPoint(event.clientX, event.clientY);
      setDragHoverIndex(dropTarget?.kind === 'draft' ? dropTarget.index : null);
      setDragHoverItemIndex(dropTarget?.kind === 'item' ? dropTarget.index : null);
    };

    const onMouseUp = (event: MouseEvent) => {
      const dragState = pendingDraftDragRef.current;
      if (!dragState) return;
      if (!dragState.active) {
        pendingDraftDragRef.current = null;
        abilityDragActiveRef.current = false;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragJustEndedRef.current = true;

      const droppedOnDiscard = isDiscardZoneAtPoint(event.clientX, event.clientY);
      const dropTarget = getAbilityDropTargetAtPoint(event.clientX, event.clientY);
      void (async () => {
        if (droppedOnDiscard) {
          const discarded = await discardDraftAbility(dragState.instanceId);
          if (discarded && dragState.sourceKind === 'item') {
            removeAbilityFromItemBar(dragState.instanceId);
          }
        } else if (dropTarget && !(dropTarget.kind === dragState.sourceKind && dropTarget.index === dragState.sourceIndex)) {
          if (dragState.sourceKind === 'draft' && dropTarget.kind === 'draft') {
            await reorderDraftAbility(dragState.instanceId, dropTarget.index);
          } else {
            moveAbilityBetweenLocalBars(dragState, dropTarget);
          }
        }
        clearPointerDrag();
      })();
    };

    const onWindowBlur = () => {
      if (!pendingDraftDragRef.current) return;
      clearPointerDrag();
    };

    window.addEventListener('mousemove', onMouseMove, { passive: false });
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [closeAbilityHint, discardDraftAbility, moveAbilityBetweenLocalBars, removeAbilityFromItemBar, reorderDraftAbility]);

  // Mouse move handler for debug cursor tracking
  const handleDebugMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!showDebugGrid) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDebugCursor({
      x: ((e.clientX - rect.left) / rect.width)  * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    });
  };

  const playerStatusBuffs = me?.buffs ?? [];
  const playerIconBarSavedPos = uiPositions[PLAYER_ICON_BAR_UI_KEY];
  const playerIconBarDefaultPos = getDefaultPlayerIconBarPos();
  const playerIconBarPos = playerIconBarSavedPos ?? playerIconBarDefaultPos;
  const useCustomPlayerIconBarPlacement = customUiMode || !!playerIconBarSavedPos;
  const heartStatsSavedPos = uiPositions[HEART_STATS_UI_KEY];
  const heartStatsDefaultPos = getDefaultHeartStatsPos();
  const heartStatsPos = heartStatsSavedPos ?? heartStatsDefaultPos;
  const showFloatingHeartStatsPanel = customUiMode || showHeartDetailsPanel;
  const legacyPlayerStatusSavedPos = uiPositions[LEGACY_PLAYER_STATUS_UI_KEY];
  const playerBuffStatusSavedPos = uiPositions[PLAYER_BUFF_STATUS_UI_KEY] ?? legacyPlayerStatusSavedPos;
  const playerDebuffStatusSavedPos = uiPositions[PLAYER_DEBUFF_STATUS_UI_KEY];
  const playerBuffStatusDefaultPos = getDefaultPlayerStatusPos();
  const playerDebuffStatusDefaultPos = {
    left: playerBuffStatusDefaultPos.left,
    top: playerBuffStatusDefaultPos.top + STATUS_BAR_VERTICAL_OFFSET,
  };
  const playerBuffStatusPos = playerBuffStatusSavedPos ?? playerBuffStatusDefaultPos;
  const playerDebuffStatusPos = playerDebuffStatusSavedPos ?? (
    legacyPlayerStatusSavedPos
      ? { left: legacyPlayerStatusSavedPos.left, top: legacyPlayerStatusSavedPos.top + STATUS_BAR_VERTICAL_OFFSET }
      : playerDebuffStatusDefaultPos
  );
  const playerStatusDetachedConfigured = !!legacyPlayerStatusSavedPos || !!playerBuffStatusSavedPos || !!playerDebuffStatusSavedPos;
  const playerHasBuffStatus = playerStatusBuffs.some((buff) => buff.category === 'BUFF');
  const playerHasDebuffStatus = playerStatusBuffs.some((buff) => buff.category === 'DEBUFF');
  const showDetachedPlayerBuffStatus = customUiMode || (playerHasBuffStatus && playerStatusDetachedConfigured);
  const showDetachedPlayerDebuffStatus = customUiMode || (playerHasDebuffStatus && playerStatusDetachedConfigured);
  const showInlinePlayerStatus = playerStatusBuffs.length > 0 && !customUiMode && !playerStatusDetachedConfigured;
  const playerChannelBarSavedPos = uiPositions[PLAYER_CHANNEL_BAR_UI_KEY];
  const playerChannelBarDefaultPos = getDefaultPlayerChannelBarPos();
  const playerChannelBarPos = playerChannelBarSavedPos ?? playerChannelBarDefaultPos;
  const hasPlayerChannelBar = !!channelBarData;
  const showFloatingPlayerChannelBar = customUiMode || (!!playerChannelBarSavedPos && hasPlayerChannelBar);
  const showInlinePlayerChannelBar = hasPlayerChannelBar && !showFloatingPlayerChannelBar;
  const playerGcdBarSavedPos = uiPositions[PLAYER_GCD_BAR_UI_KEY];
  const playerGcdBarDefaultPos = getDefaultPlayerGcdBarPos();
  const playerGcdBarPos = playerGcdBarSavedPos ?? playerGcdBarDefaultPos;
  const hasPlayerGcdBar = !!visibleVisualGcd;
  const showFloatingPlayerGcdBar = customUiMode || (!!playerGcdBarSavedPos && hasPlayerGcdBar);
  const showInlinePlayerGcdBar = hasPlayerGcdBar && !showFloatingPlayerGcdBar;

  const selectedTargetForStatus = selectedTargetId
    ? opponentsList.find((opponent) => opponent.userId === selectedTargetId) ?? null
    : null;
  const selectedEntityForStatus = selectedEntityId
    ? (entities ?? []).find((entity) => entity.id === selectedEntityId) ?? null
    : null;
  const targetStatusIsSelf = !!(selectedSelf && !selectedTargetId && !selectedEntityId);
  const targetStatusIsEntity = !targetStatusIsSelf && !!selectedEntityForStatus;
  const targetStatusIsDummyEntity = targetStatusIsEntity && (
    selectedEntityForStatus?.kind === 'test_dummy_ally' || selectedEntityForStatus?.kind === 'test_dummy_enemy'
  );
  const targetStatusIsOwnEntity = targetStatusIsEntity && selectedEntityForStatus?.ownerUserId === me?.userId;
  const targetStatusHasSelection = !!(selectedTargetId || selectedEntityId || selectedSelf);
  const targetStatusBuffs = targetStatusIsSelf
    ? (me?.buffs ?? [])
    : targetStatusIsEntity
    ? (selectedEntityForStatus?.buffs ?? [])
    : (selectedTargetForStatus?.buffs ?? []);
  const targetOwnedAbilityHand = targetStatusIsSelf
    ? me.hand
    : targetStatusIsEntity
    ? []
    : (selectedTargetForStatus?.hand ?? []);
  const targetIconBarSavedPos = uiPositions[TARGET_ICON_BAR_UI_KEY];
  const targetIconBarDefaultPos = getDefaultTargetIconBarPos();
  const targetIconBarPos = targetIconBarSavedPos ?? targetIconBarDefaultPos;
  const useCustomTargetIconBarPlacement = customUiMode || !!targetIconBarSavedPos;
  const targetOwnedAbilityBarSavedPos = uiPositions[TARGET_OWNED_ABILITY_BAR_UI_KEY];
  const targetOwnedAbilityBarDefaultPos = getDefaultTargetOwnedAbilityBarPos();
  const targetOwnedAbilityBarPos = targetOwnedAbilityBarSavedPos ?? targetOwnedAbilityBarDefaultPos;
  const showFloatingTargetOwnedAbilityBar = customUiMode || !!targetOwnedAbilityBarSavedPos;
  const targetBuffStatusSavedPos = uiPositions[TARGET_BUFF_STATUS_UI_KEY];
  const targetDebuffStatusSavedPos = uiPositions[TARGET_DEBUFF_STATUS_UI_KEY];
  const targetBuffStatusDefaultPos = getDefaultTargetStatusPos();
  const targetDebuffStatusDefaultPos = {
    left: targetBuffStatusDefaultPos.left,
    top: targetBuffStatusDefaultPos.top + STATUS_BAR_VERTICAL_OFFSET,
  };
  const targetBuffStatusPos = targetBuffStatusSavedPos ?? targetBuffStatusDefaultPos;
  const targetDebuffStatusPos = targetDebuffStatusSavedPos ?? targetDebuffStatusDefaultPos;
  const targetStatusDetachedConfigured = !!targetBuffStatusSavedPos || !!targetDebuffStatusSavedPos;
  const targetHasBuffStatus = targetStatusBuffs.some((buff) => buff.category === 'BUFF');
  const targetHasDebuffStatus = targetStatusBuffs.some((buff) => buff.category === 'DEBUFF');
  const showDetachedTargetBuffStatus = customUiMode || (targetStatusHasSelection && targetHasBuffStatus && targetStatusDetachedConfigured);
  const showDetachedTargetDebuffStatus = customUiMode || (targetStatusHasSelection && targetHasDebuffStatus && targetStatusDetachedConfigured);
  const showInlineTargetStatus = targetStatusHasSelection && !customUiMode && !targetStatusDetachedConfigured;
  const targetStatusAllowAnyCancel = !targetStatusIsSelf
    && targetStatusIsDummyEntity
    && targetStatusIsOwnEntity
    && selectedEntityForStatus?.kind === 'test_dummy_ally';
  const targetStatusOnCancelBuff = targetStatusIsSelf
    ? onCancelBuff
    : (targetStatusAllowAnyCancel && onCancelBuff && selectedEntityForStatus)
    ? ((buffId: number) => onCancelBuff(buffId, { entityTargetId: selectedEntityForStatus.id }))
    : undefined;
  const targetTargetActorForHud = targetStatusIsSelf ? me : targetStatusIsEntity ? null : selectedTargetForStatus;
  const targetTargetSelectionForHud = targetTargetActorForHud?.targetSelection ?? null;
  const targetTargetPlayerForHud = targetTargetSelectionForHud?.kind === 'self'
    ? targetTargetActorForHud
    : targetTargetSelectionForHud?.kind === 'player'
    ? [me, ...opponentsList].find((player) => player?.userId === targetTargetSelectionForHud.userId) ?? null
    : null;
  const targetTargetEntityForHud = targetTargetSelectionForHud?.kind === 'entity'
    ? (entities ?? []).find((entity) => entity.id === targetTargetSelectionForHud.entityId) ?? null
    : null;
  const targetTargetOwnerForHud = targetTargetEntityForHud
    ? (targetTargetEntityForHud.ownerUserId === me?.userId
        ? me
        : opponentsList.find((o) => o.userId === targetTargetEntityForHud.ownerUserId) ?? null)
    : null;
  const targetTargetHp = targetTargetEntityForHud ? (targetTargetEntityForHud.hp ?? 0) : (targetTargetPlayerForHud?.hp ?? 0);
  const targetTargetShield = Math.max(0, targetTargetEntityForHud ? (targetTargetEntityForHud.shield ?? 0) : (targetTargetPlayerForHud?.shield ?? 0));
  const targetTargetMaxHp = targetTargetEntityForHud ? (targetTargetEntityForHud.maxHp ?? 1) : (targetTargetPlayerForHud?.maxHp ?? maxHp);
  const targetTargetSegments = computeHpShieldSegments(targetTargetHp, targetTargetShield, targetTargetMaxHp);
  const targetTargetBuffs = targetTargetEntityForHud ? (targetTargetEntityForHud.buffs ?? []) : (targetTargetPlayerForHud?.buffs ?? []);
  const targetTargetHpPercentText = `${Math.max(0, Math.min(100, Math.round((Math.max(0, targetTargetHp) / Math.max(1, targetTargetMaxHp)) * 100)))}%`;
  const targetTargetName = targetTargetEntityForHud
    ? `${targetTargetOwnerForHud?.username ?? '玩家'}的目标`
    : targetTargetPlayerForHud
    ? (targetTargetPlayerForHud.username ?? '目标')
    : '';
  const targetTargetIsSelf = !targetTargetEntityForHud && targetTargetPlayerForHud?.userId === me?.userId;
  const targetTargetInCombat = !!targetTargetPlayerForHud?.inCombat;
  const showTargetTargetBar = !!(targetTargetEntityForHud || targetTargetPlayerForHud);
  const targetTargetHpGradient = targetTargetIsSelf ? selfIconBarHpGradient : iconBarHpGradient;
  const targetTargetIconBarSavedPos = uiPositions[TARGET_TARGET_ICON_BAR_UI_KEY];
  const targetTargetIconBarDefaultPos = getDefaultTargetTargetIconBarPos();
  const targetTargetIconBarPos = targetTargetIconBarSavedPos ?? targetTargetIconBarDefaultPos;
  const showFloatingTargetTargetIconBar = customUiMode || showTargetTargetBar;
  const heightCounterDefaultPos = getDefaultHeightCounterPos();
  const heightCounterPos = uiPositions[HEIGHT_COUNTER_UI_KEY] ?? heightCounterDefaultPos;
  const distanceIndicatorDefaultPos = getDefaultDistanceIndicatorPos();
  const distanceIndicatorPos = uiPositions[DISTANCE_INDICATOR_UI_KEY] ?? distanceIndicatorDefaultPos;
  const inGameWarningDefaultPos = getDefaultInGameWarningPos();
  const inGameWarningPos = uiPositions[IN_GAME_WARNING_UI_KEY] ?? inGameWarningDefaultPos;
  const inGameWarningText = activeInGameWarning?.text ?? (customUiMode ? IN_GAME_WARNING_PREVIEW_TEXT : null);
  const showFloatingInGameWarning = !!inGameWarningText;
  const itemBarDefaultPos = getDefaultItemBarPos();
  const itemBarPos = uiPositions[ITEM_BAR_UI_KEY] ?? itemBarDefaultPos;
  const renderStatusPlacement = ({
    keyName,
    label,
    pos,
    defaultPos,
    buffs,
    categoryFilter,
    debugLabel,
    showDebug = false,
    onCancel,
    allowAnyCancel = false,
  }: {
    keyName: string;
    label: string;
    pos: { left: number; top: number };
    defaultPos: { left: number; top: number };
    buffs: typeof playerStatusBuffs;
    categoryFilter: 'BUFF' | 'DEBUFF';
    debugLabel: string;
    showDebug?: boolean;
    onCancel?: (buffId: number) => Promise<void> | void;
    allowAnyCancel?: boolean;
  }) => (
    <div
      data-ui-drag="true"
      className={`${styles.customUiStatusPlacement} ${styles.customUiStatusPlacementSingle} ${customUiMode ? styles.customUiStatusPlacementEditing : ''}`}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={customUiMode ? (event) => startUIDrag(keyName, defaultPos, event, { persist: false }) : undefined}
    >
      <div className={styles.customUiStatusContent}>
        <StatusBar
          buffs={buffs}
          showDebug={showDebug}
          debugLabel={debugLabel}
          onCancelBuff={onCancel}
          allowAnyCancel={allowAnyCancel}
          playerScale={debugLabel === 'me'}
          categoryFilter={categoryFilter}
        />
        {customUiMode && (
          <div className={styles.customUiStatusGuide} aria-hidden="true">
            <div className={styles.customUiPlacementLabel}>{label}</div>
          </div>
        )}
      </div>
    </div>
  );

  const renderTargetIconBarPreview = () => (
    <div className={styles.enemyBossTopRow}>
      <div className={styles.enemyBossBar}>
        <div className={styles.enemyName}><span className={styles.targetIconDistance}>18m</span> · 目标</div>
        <div className={styles.iconBarBody}>
          <div className={styles.enemyHpTrack}>
            <div className={styles.enemyHpTick} style={{ left: '62%' }} />
            <div
              className={styles.enemyHpFill}
              style={{ width: '62%', background: iconBarHpGradient }}
            />
            <span className={styles.hpSegmentNum} style={{ left: '50%' }}>
              62%
            </span>
          </div>
          <div className={styles.iconBarResourceRow}>
            <span className={styles.iconBarResourceValue}>130</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTargetTargetIconBar = (preview = false) => {
    if (!showTargetTargetBar && !preview) {
      return null;
    }

    const hpSegments = showTargetTargetBar ? targetTargetSegments : { hpPct: 62, shieldPct: 0 };
    const hpText = showTargetTargetBar ? targetTargetHpPercentText : '62%';
    const title = showTargetTargetBar ? targetTargetName : '目标目标';
    const buffs = showTargetTargetBar ? targetTargetBuffs : [];
    const isSelf = showTargetTargetBar && targetTargetIsSelf;
    const gradient = showTargetTargetBar ? targetTargetHpGradient : iconBarHpGradient;
    const inCombat = showTargetTargetBar && targetTargetInCombat;

    return (
      <div className={styles.targetTargetBossStack}>
        <div className={`${styles.enemyBossBar} ${styles.targetTargetBossBar} ${isSelf ? styles.selfIconBar : ''}`}>
          <div className={styles.enemyName}>{title}</div>
          <div className={styles.iconBarBody}>
            <div className={styles.enemyHpTrack}>
              {hpSegments.hpPct > 0 && hpSegments.hpPct < 100 && (
                <div
                  className={styles.enemyHpTick}
                  style={{ left: `${hpSegments.hpPct}%` }}
                />
              )}
              {hpSegments.shieldPct > 0 && (
                <div
                  className={styles.enemyShieldFill}
                  style={{
                    left: `${hpSegments.hpPct}%`,
                    width: `${hpSegments.shieldPct}%`,
                  }}
                />
              )}
              <div
                className={styles.enemyHpFill}
                style={{ width: `${hpSegments.hpPct}%`, background: gradient }}
              />
              <span className={styles.hpSegmentNum} style={{ left: '50%' }}>
                {hpText}
              </span>
            </div>
            <div className={styles.iconBarResourceRow}>
              <span className={styles.iconBarResourceValue}>130</span>
            </div>
            {renderCombatStatusMarker(inCombat)}
          </div>
        </div>
        <div className={styles.targetTargetStatusSlot}>
          <StatusBar
            buffs={buffs}
            showNames={false}
            showTimers={false}
            compact
            borderlessIcons
            maxPerRow={3}
          />
        </div>
      </div>
    );
  };

  const renderTargetOwnedAbilityBar = (hand: any[], options?: { preview?: boolean }) => {
    const preview = options?.preview === true;
    const draftedTargetAbilities = hand.filter((ability: any) => {
      const abilityId = ability?.abilityId || ability?.id;
      return abilityId && !COMMON_ABILITY_ORDER.includes(abilityId as any);
    });
    const previewDraftAbilities = draftAbilities.filter(Boolean).slice(0, 4);
    const fallbackPreviewAbilities = Array.from({ length: 4 }, (_, index) => ({
      id: `target-preview-${index}`,
      name: `技能${index + 1}`,
      previewPlaceholder: true,
    }));
    const displayedAbilities = preview && draftedTargetAbilities.length === 0
      ? (previewDraftAbilities.length > 0 ? previewDraftAbilities : fallbackPreviewAbilities)
      : draftedTargetAbilities;

    return (
      <div ref={targetOwnedAbilityBarRef} className={styles.enemyAbilityRow}>
        {displayedAbilities.map((ability: any, index: number) => {
          const abilityId = ability.abilityId || ability.id;
          const cardData = abilities[abilityId];
          const name = cardData?.name || ability.name || abilityId || `技能${index + 1}`;
          const isPreviewPlaceholder = ability.previewPlaceholder === true;
          return (
            <div key={ability.instanceId || abilityId || `target-preview-${index}`} className={styles.enemyAbilityItem}>
              <div className={`${styles.enemyAbilitySlot} ${isPreviewPlaceholder ? styles.enemyAbilityPreviewSlot : ''}`} title={name}>
                {!isPreviewPlaceholder && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getArenaAbilityIconPath(name)}
                    alt={name}
                    className={styles.enemyAbilityIcon}
                    draggable={false}
                  />
                )}
              </div>
              <span className={styles.enemyAbilityName}>{name.slice(0, 2)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderPlayerChannelBar = (preview = false) => {
    if (channelBarData) {
      return <ChannelBarHost data={channelBarData} showTimer />;
    }
    if (!preview) {
      return null;
    }
    return <ChannelBar data={PLAYER_CHANNEL_BAR_PREVIEW_DATA} progressOverride={46} />;
  };

  const renderPlayerGcdBar = (preview = false) => {
    if (visibleVisualGcd) {
      return <GcdVisualBar gcd={visibleVisualGcd} />;
    }
    if (!preview) {
      return null;
    }

    const previewElapsedMs = BASE_GCD_MS * 0.42;
    return (
      <div className={styles.gcdBarWrap} data-gcd-bar-root="true">
        <div className={styles.gcdBarLabel}>
          基础调息时间 ({formatGcdBarSeconds(previewElapsedMs / 1000)}/{formatGcdBarSeconds(BASE_GCD_SECONDS)})
        </div>
        <div className={styles.gcdBarTrack}>
          <div
            className={`${styles.gcdBarFill} ${styles.gcdBarFillBase}`}
            style={{ transform: `scaleX(${previewElapsedMs / BASE_GCD_MS})` }}
          />
        </div>
      </div>
    );
  };

  const renderFloatingTimingPlacement = ({
    keyName,
    label,
    pos,
    defaultPos,
    widthVar,
    widthPx,
    content,
  }: {
    keyName: string;
    label?: string;
    pos: { left: number; top: number };
    defaultPos: { left: number; top: number };
    widthVar: '--channel-bar-width' | '--gcd-bar-width';
    widthPx: number;
    content: React.ReactNode;
  }) => {
    if (!content) {
      return null;
    }

    const placementStyle = {
      left: pos.left,
      top: pos.top,
      pointerEvents: customUiMode ? 'auto' : 'none',
      [widthVar]: `${widthPx}px`,
    } as React.CSSProperties;

    return (
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.customUiFloatingHudPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={placementStyle}
        onMouseDown={customUiMode ? (event) => startUIDrag(keyName, defaultPos, event, { persist: false }) : undefined}
      >
        {customUiMode && label ? <div className={styles.customUiPlacementLabel}>{label}</div> : null}
        {content}
      </div>
    );
  };

  const renderInGameWarning = () => {
    if (!inGameWarningText) {
      return null;
    }

    return (
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.ingameWarningPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={{
          left: inGameWarningPos.left,
          top: inGameWarningPos.top,
          pointerEvents: customUiMode ? 'auto' : 'none',
          '--game-warning-scale': inGameWarningScale,
        } as React.CSSProperties}
        onMouseDown={customUiMode ? (event) => startUIDrag(IN_GAME_WARNING_UI_KEY, inGameWarningDefaultPos, event, { persist: false }) : undefined}
      >
        {customUiMode ? (
          <div className={`${styles.customUiPlacementLabel} ${styles.ingameWarningPlacementLabel}`}>战斗警告</div>
        ) : null}
        <div
          className={`${styles.ingameWarningText} ${customUiMode && !activeInGameWarning ? styles.ingameWarningPreviewText : ''}`}
          aria-live="polite"
        >
          {inGameWarningText}
        </div>
      </div>
    );
  };

  const renderItemBar = () => {
    const consumableNowMs = systemTime.getTime();
    const visibleConsumableSlots = consumableBarSettings.enabled
      ? consumableBarSettings.slots.slice(0, consumableBarSettings.slotCount)
      : [];

    return (
    <div className={styles.itemBar} aria-label="物品栏">
      {visibleConsumableSlots.map((consumableId, index) => {
        const consumable = consumableId ? CONSUMABLE_ITEM_BY_ID.get(consumableId) : undefined;
        const cooldownMs = consumable ? getConsumableCooldownRemainingMs(me, consumable.id, consumableNowMs) : 0;
        const cooldownLabel = formatConsumableCooldown(cooldownMs);
        const remainingCount = consumable ? getConsumableRemainingCount(me, consumable) : 0;
        const unavailable = !!consumable && consumable.implemented !== true;
        const depleted = !!consumable && consumable.implemented === true && remainingCount <= 0;
        return (
          <button
            key={`consumable-slot-${index}-${consumable?.id ?? 'empty'}`}
            type="button"
            data-consumable-slot="true"
            data-consumable-slot-index={index}
            className={`${styles.itemSlot} ${styles.consumableSlot} ${!consumable ? styles.consumableSlotEmpty : ''} ${cooldownMs > 0 ? styles.consumableSlotCooling : ''} ${unavailable ? styles.consumableSlotUnavailable : ''} ${depleted ? styles.consumableSlotDepleted : ''} ${dragHoverConsumableIndex === index ? styles.consumableSlotDragHover : ''} ${draggingConsumableIndex === index ? styles.consumableSlotDragging : ''}`}
            aria-label={consumable?.name ?? `空物品格 ${index + 1}`}
            aria-disabled={!consumable || cooldownMs > 0 || unavailable || depleted}
            title={
              consumable
                ? unavailable
                  ? `${consumable.name}（暂未开放）`
                  : depleted
                    ? `${consumable.name}（已用完）`
                    : `${consumable.name}（剩余${remainingCount}）`
                : '空物品格'
            }
            draggable={!customUiMode && !!consumable}
            onDragStart={(event) => {
              if (!consumable || customUiMode) return;
              consumableDragIndexRef.current = index;
              setDraggingConsumableIndex(index);
              setDragHoverConsumableIndex(index);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-zhenchuan-consumable-slot', String(index));
              event.dataTransfer.setData('text/plain', consumable.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragHoverConsumableIndex(index);
            }}
            onDragLeave={() => setDragHoverConsumableIndex((current) => current === index ? null : current)}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const rawSourceIndex = event.dataTransfer.getData('application/x-zhenchuan-consumable-slot');
              const sourceIndex = rawSourceIndex !== '' ? Number(rawSourceIndex) : consumableDragIndexRef.current;
              if (Number.isInteger(sourceIndex)) {
                moveConsumableSlot(sourceIndex, index);
              }
              consumableDragIndexRef.current = null;
              setDraggingConsumableIndex(null);
              setDragHoverConsumableIndex(null);
            }}
            onDragEnd={() => {
              consumableDragIndexRef.current = null;
              setDraggingConsumableIndex(null);
              setDragHoverConsumableIndex(null);
            }}
            onClick={() => {
              if (!consumable || cooldownMs > 0 || unavailable || depleted || customUiMode) return;
              useConsumableRef.current(consumable.id);
            }}
          >
            {consumable && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getConsumableIconPath(consumable.name)} alt={consumable.name} className={styles.consumableIcon} draggable={false} />
            )}
            {consumable?.implemented === true && <span className={styles.consumableCount}>{remainingCount}</span>}
            {cooldownMs > 0 && <span className={styles.consumableCooldown}>{cooldownLabel}</span>}
          </button>
        );
      })}
    </div>
    );
  };

  const renderOwnedAbilityBar = (disableInteractions = false) => (
    <div
      ref={ownedAbilityBarRef}
      className={`${styles.hotbarStack} ${draggingDraftInstanceId ? styles.hotbarStackDragging : ''}`}
      style={{
        pointerEvents: disableInteractions ? 'none' : 'auto',
        '--ability-panel-scale': getAbilityPanelCssScale(abilityPanelScale),
      } as React.CSSProperties}
    >
      {showInlinePlayerStatus && (
        <div className={styles.playerBuffRow}>
          <StatusBar buffs={playerStatusBuffs} debugLabel="me" onCancelBuff={onCancelBuff} playerScale />
        </div>
      )}

      {showInlinePlayerChannelBar && renderPlayerChannelBar()}
      {showInlinePlayerGcdBar && renderPlayerGcdBar()}

      <div className={styles.draftDropCluster}>
        {!specialBarActive && draggingDraftInstanceId && (
          <div
            data-discard-drop-zone="true"
            className={`${styles.discardDropZone} ${styles.discardDropZoneReady} ${discardZoneHover ? styles.discardDropZoneActive : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragHoverIndex(null);
              setDiscardZoneHover(true);
            }}
            onDragLeave={() => setDiscardZoneHover(false)}
            onDrop={(e) => void handleDiscardDrop(e)}
          >
            <Trash2 className={styles.discardDropIcon} size={15} strokeWidth={2.3} aria-hidden="true" />
            <span>将技能拖动至此处即可遗忘</span>
          </div>
        )}

      <div className={styles.hotbar}>
        {(specialBarActive ? draftAbilities : Array.from({ length: 6 }, (_, idx) => draftAbilities[idx])).map((ability, idx) => {
          const keyHint = ['1', '2', '3', 'Q', 'XB2', 'XB1'][idx];
          return (
            <div
              data-draft-slot-index={idx}
              key={ability ? `slot-${ability.id}` : `empty-${idx}`}
              className={`${styles.draftSlot} ${!specialBarActive && dragHoverIndex === idx ? styles.draftSlotHover : ''}`}
              onDragOver={(e) => {
                if (specialBarActive) return;
                if (!draggingDraftInstanceId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDiscardZoneHover(false);
                setDragHoverIndex(idx);
              }}
              onDragLeave={() => {
                if (dragHoverIndex === idx) setDragHoverIndex(null);
              }}
              onDrop={(e) => {
                if (specialBarActive) return;
                void handleDraftSlotDrop(e, idx);
              }}
            >
              {!ability ? (
                <div className={`${styles.abilityBtn} ${styles.emptySlot}`}>
                  <span className={styles.abilityKey}>{keyHint}</span>
                </div>
              ) : (() => {
                const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
                const cdLabel = formatHudCooldownText(ability.cooldown / 30);
                const minuteCooldown = cdLabel.endsWith('m');
                const hasCharges = (ability.maxCharges ?? 0) > 1;
                const chargeCount = hasCharges ? (ability.chargeCount ?? ability.maxCharges ?? 0) : 0;
                const maxCharges = hasCharges ? Math.max(0, ability.maxCharges ?? 0) : 0;
                const chargeRegenProgress = hasCharges
                  ? Math.max(0, Math.min(1, Number(ability.chargeRegenProgress ?? 0)))
                  : 0;
                const recoveringCharge = hasCharges && chargeCount < maxCharges;
                const chargePathProgress = hasCharges ? (recoveringCharge ? chargeRegenProgress : 1) : 0;
                const chargePathLength = (Math.max(0, Math.min(1, chargePathProgress)) * 100).toFixed(2);
                const isQueTaZhi = ability.abilityId === 'que_ta_zhi';
                return (
                  <button
                    type="button"
                    className={`${styles.abilityBtn} ${ability.isReady && !ability.blockedByAntiStealth ? styles.ready : styles.notReady} ${pressedAbilityInput === `draft-${idx}` ? styles.abilityBtnPressed : ''} ${draggingDraftInstanceId === ability.id ? styles.abilityBtnDragging : ''}`}
                    aria-disabled={!ability.isReady || !!ability.blockedByAntiStealth}
                    style={ability.losBlocked ? { boxShadow: 'inset 0 0 0 1px rgba(245,245,245,0.72), 0 0 10px rgba(70,110,82,0.42)', outline: 'none' } : undefined}
                    draggable={false}
                    onMouseDown={(e) => beginAbilityPointerDrag(e, ability, 'draft', idx)}
                    onMouseEnter={(e) => openAbilityHint(e.currentTarget.getBoundingClientRect(), ability)}
                    onMouseLeave={closeAbilityHint}
                    onFocus={(e) => openAbilityHint(e.currentTarget.getBoundingClientRect(), ability)}
                    onBlur={closeAbilityHint}
                    onDragStart={(e) => {
                      if (specialBarActive) {
                        e.preventDefault();
                        return;
                      }
                      handleDraftDragStart(e, ability.id, idx);
                    }}
                    onDragEnd={handleDraftDragEnd}
                    onClick={() => {
                      if (dragJustEndedRef.current) return;
                      if (!ability.isReady || ability.blockedByAntiStealth) {
                        showAbilityDisabledWarning(ability);
                        return;
                      }
                      castAbilityRef.current(ability.id);
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={getArenaAbilityIconPath(ability.name, ability.iconPath)} alt={ability.name} className={styles.abilityIcon} draggable={false} />
                    {ability.cooldown > 0 && ability.maxCooldown > 0 && (
                      <div className={styles.cdArc} style={{ background: `conic-gradient(from 0deg, transparent ${(100 - cdPct).toFixed(1)}%, rgba(0,0,0,0.72) ${(100 - cdPct).toFixed(1)}%)` }}>
                        <span className={`${styles.cdNum} ${minuteCooldown ? styles.cdNumMinutes : ''}`}>{cdLabel}</span>
                      </div>
                    )}
                    {hasCharges && (
                      <div className={`${styles.chargeFrame} ${isQueTaZhi ? styles.chargeFrameQueTaZhi : ''}`}>
                        <svg className={styles.chargeFrameSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                          <path
                            className={styles.chargeFrameTrack}
                            d="M 96 96 L 96 4 L 4 4 L 4 96 L 96 96"
                            pathLength={100}
                          />
                          <path
                            className={styles.chargeFrameProgress}
                            d="M 96 96 L 96 4 L 4 4 L 4 96 L 96 96"
                            pathLength={100}
                            strokeDasharray={`${chargePathLength} 100`}
                          />
                        </svg>
                        <span className={`${styles.chargeStackBox} ${isQueTaZhi ? styles.chargeStackBoxQueTaZhi : ''}`}>
                          {Math.max(0, chargeCount)}
                        </span>
                      </div>
                    )}
                    <span className={styles.abilityKey}>{keyHint}</span>
                  </button>
                );
              })()}
            </div>
          );
        })}
      </div>
      </div>

      {!specialBarActive && (
        <div className={styles.commonBar}>
          {commonAbilities.map((ability, idx) => {
            const COMMON_KEY_HINTS = ['X', 'MD', 'MU', 'A+A', 'A+D', 'A+S', '`', 'T'] as const;
            const keyHint = COMMON_KEY_HINTS[idx] ?? '';
            const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
            const cdLabel = formatHudCooldownText(ability.cooldown / 30);
            const minuteCooldown = cdLabel.endsWith('m');
            const hasCharges = (ability.maxCharges ?? 0) > 1;
            const chargeCount = hasCharges ? (ability.chargeCount ?? ability.maxCharges ?? 0) : 0;
            const maxCharges = hasCharges ? Math.max(0, ability.maxCharges ?? 0) : 0;
            const chargeRegenProgress = hasCharges
              ? Math.max(0, Math.min(1, Number(ability.chargeRegenProgress ?? 0)))
              : 0;
            const recoveringCharge = hasCharges && chargeCount < maxCharges;
            const chargePathProgress = hasCharges ? (recoveringCharge ? chargeRegenProgress : 1) : 0;
            const chargePathLength = (Math.max(0, Math.min(1, chargePathProgress)) * 100).toFixed(2);
            const isQueTaZhi = ability.abilityId === 'que_ta_zhi';
            return (
              <React.Fragment key={ability.id}>
                {idx === 1 && <div className={styles.commonGap} />}
                {idx === 7 && <div className={styles.commonGap} />}
                <button
                  type="button"
                  className={`${styles.abilityBtn} ${styles.commonBtn} ${ability.isReady && !ability.blockedByAntiStealth ? styles.ready : styles.notReady} ${pressedAbilityInput === `common-${idx}` ? styles.abilityBtnPressed : ''}`}
                  aria-disabled={!ability.isReady || !!ability.blockedByAntiStealth}
                  onMouseEnter={(e) => openAbilityHint(e.currentTarget.getBoundingClientRect(), ability)}
                  onMouseLeave={closeAbilityHint}
                  onFocus={(e) => openAbilityHint(e.currentTarget.getBoundingClientRect(), ability)}
                  onBlur={closeAbilityHint}
                  onClick={() => {
                    if (!ability.isReady || ability.blockedByAntiStealth) {
                      showAbilityDisabledWarning(ability);
                      return;
                    }
                    castAbilityRef.current(ability.id);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={getArenaAbilityIconPath(ability.name, ability.iconPath)} alt={ability.name} className={styles.abilityIcon} draggable={false} />
                  {ability.cooldown > 0 && ability.maxCooldown > 0 && (
                    <div className={styles.cdArc} style={{ background: `conic-gradient(from 0deg, transparent ${(100 - cdPct).toFixed(1)}%, rgba(0,0,0,0.72) ${(100 - cdPct).toFixed(1)}%)` }}>
                      <span className={`${styles.cdNum} ${minuteCooldown ? styles.cdNumMinutes : ''}`}>{cdLabel}</span>
                    </div>
                  )}
                  {hasCharges && (
                    <div className={`${styles.chargeFrame} ${isQueTaZhi ? styles.chargeFrameQueTaZhi : ''}`}>
                      <svg className={styles.chargeFrameSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                          <path
                            className={styles.chargeFrameTrack}
                            d="M 96 96 L 96 4 L 4 4 L 4 96 L 96 96"
                            pathLength={100}
                          />
                          <path
                            className={styles.chargeFrameProgress}
                            d="M 96 96 L 96 4 L 4 4 L 4 96 L 96 96"
                            pathLength={100}
                            strokeDasharray={`${chargePathLength} 100`}
                          />
                      </svg>
                      <span className={`${styles.chargeStackBox} ${isQueTaZhi ? styles.chargeStackBoxQueTaZhi : ''}`}>
                        {Math.max(0, chargeCount)}
                      </span>
                    </div>
                  )}
                  <span className={styles.abilityKey}>{keyHint}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
      {draftDragGhost && (
        <div
          className={styles.abilityDragGhost}
          style={{
            left: draftDragGhost.x,
            top: draftDragGhost.y,
            '--ability-panel-scale': getAbilityPanelCssScale(abilityPanelScale),
          } as React.CSSProperties}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getArenaAbilityIconPath(draftDragGhost.ability.name)} alt="" className={styles.abilityDragGhostIcon} draggable={false} />
        </div>
      )}
    </div>
  );

  return (
    <div
      className={styles.container}
      onMouseMove={handleDebugMouseMove}
      onMouseLeave={() => showDebugGrid && setDebugCursor(null)}
    >
      <div className={styles.topMetricsBar} aria-label="战斗信息栏">
        <button type="button" className={styles.topMetricsSettingsButton}>设置</button>
        <div className={styles.topMetricsItem}>
          <span className={styles.topMetricsLabel}>时间:</span>
          <span className={styles.topMetricsTimeValue}>{formatTopMetricsTime(systemTime)}</span>
        </div>
        <div className={styles.topMetricsItem}>
          <span className={styles.topMetricsLabel}>渲染FPS:</span>
          <span className={styles.topMetricsGoodValue}>{renderFps !== null ? renderFps : '—'}</span>
        </div>
        <div className={styles.topMetricsItem}>
          <span className={styles.topMetricsLabel}>网络延迟:</span>
          <span className={styles.topMetricsGoodValue}>{rtt !== null ? rtt : '—'}</span>
        </div>
      </div>

      {customUiMode && (
        <div
          className={styles.customUiPrompt}
          data-ui-drag
          onMouseDown={startCustomUiPromptDrag}
          style={customUiPromptPos ? { left: customUiPromptPos.left, top: customUiPromptPos.top, transform: 'none' } : undefined}
        >
          <div className={styles.customUiTitle}>自定义界面</div>
          <div className={styles.customUiActions}>
            <button
              type="button"
              className={styles.customUiButtonSecondary}
              onClick={cancelCustomUiMode}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.customUiButtonSecondary}
              onClick={applyCatcakeDefaultUiLayout}
            >
              <RotateCcw size={14} strokeWidth={2.2} aria-hidden="true" />恢复默认
            </button>
            <button
              type="button"
              className={styles.customUiButtonPrimary}
              onClick={confirmCustomUiMode}
            >
              确定
            </button>
          </div>
        </div>
      )}

      {showDetachedPlayerBuffStatus && renderStatusPlacement({
        keyName: PLAYER_BUFF_STATUS_UI_KEY,
        label: '自身增益',
        pos: playerBuffStatusPos,
        defaultPos: playerBuffStatusDefaultPos,
        buffs: playerStatusBuffs,
        categoryFilter: 'BUFF',
        debugLabel: 'me',
        onCancel: onCancelBuff,
      })}

      {showDetachedPlayerDebuffStatus && renderStatusPlacement({
        keyName: PLAYER_DEBUFF_STATUS_UI_KEY,
        label: '自身减益',
        pos: playerDebuffStatusPos,
        defaultPos: playerDebuffStatusDefaultPos,
        buffs: playerStatusBuffs,
        categoryFilter: 'DEBUFF',
        debugLabel: 'me',
        onCancel: onCancelBuff,
      })}

      {showDetachedTargetBuffStatus && renderStatusPlacement({
        keyName: TARGET_BUFF_STATUS_UI_KEY,
        label: '目标增益',
        pos: targetBuffStatusPos,
        defaultPos: targetBuffStatusDefaultPos,
        buffs: targetStatusBuffs,
        categoryFilter: 'BUFF',
        debugLabel: targetStatusIsSelf ? 'me-target' : 'opp',
        onCancel: targetStatusOnCancelBuff,
        allowAnyCancel: targetStatusAllowAnyCancel,
      })}

      {showDetachedTargetDebuffStatus && renderStatusPlacement({
        keyName: TARGET_DEBUFF_STATUS_UI_KEY,
        label: '目标减益',
        pos: targetDebuffStatusPos,
        defaultPos: targetDebuffStatusDefaultPos,
        buffs: targetStatusBuffs,
        categoryFilter: 'DEBUFF',
        debugLabel: targetStatusIsSelf ? 'me-target' : 'opp',
        onCancel: targetStatusOnCancelBuff,
        allowAnyCancel: targetStatusAllowAnyCancel,
      })}

      {showFloatingTargetOwnedAbilityBar && (customUiMode || targetStatusHasSelection) && (
        <div
          data-ui-drag={customUiMode ? 'true' : undefined}
          className={`${styles.customUiFloatingHudPlacement} ${customUiMode ? `${styles.customUiHudPlacementEditing} ${styles.customUiAbilityPlacementEditing}` : ''}`}
          style={{ left: targetOwnedAbilityBarPos.left, top: targetOwnedAbilityBarPos.top }}
          onMouseDown={customUiMode ? (event) => startUIDrag(TARGET_OWNED_ABILITY_BAR_UI_KEY, targetOwnedAbilityBarDefaultPos, event, { persist: false }) : undefined}
        >
          {customUiMode && <div className={styles.customUiPlacementLabel}>目标技能栏</div>}
          {renderTargetOwnedAbilityBar(customUiMode ? targetOwnedAbilityHand : targetOwnedAbilityHand, { preview: customUiMode && !targetStatusHasSelection })}
        </div>
      )}

      {showFloatingPlayerChannelBar && renderFloatingTimingPlacement({
        keyName: PLAYER_CHANNEL_BAR_UI_KEY,
        pos: playerChannelBarPos,
        defaultPos: playerChannelBarDefaultPos,
        widthVar: '--channel-bar-width',
        widthPx: PLAYER_CHANNEL_BAR_FLOAT_WIDTH,
        content: renderPlayerChannelBar(customUiMode),
      })}

      {showFloatingPlayerGcdBar && renderFloatingTimingPlacement({
        keyName: PLAYER_GCD_BAR_UI_KEY,
        label: '调息条',
        pos: playerGcdBarPos,
        defaultPos: playerGcdBarDefaultPos,
        widthVar: '--gcd-bar-width',
        widthPx: PLAYER_GCD_BAR_FLOAT_WIDTH,
        content: renderPlayerGcdBar(customUiMode),
      })}

      {showFloatingInGameWarning && renderInGameWarning()}

      <div
        ref={itemBarRef}
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.itemBarPlacement} ${customUiMode ? `${styles.customUiHudPlacementEditing} ${styles.itemBarPlacementEditing}` : ''}`}
        style={{
          left: itemBarPos.left,
          top: itemBarPos.top,
          '--ability-panel-scale': getAbilityPanelCssScale(abilityPanelScale),
        } as React.CSSProperties}
        onMouseDown={customUiMode ? (event) => startUIDrag(ITEM_BAR_UI_KEY, itemBarDefaultPos, event, { persist: false }) : undefined}
      >
        {customUiMode && <div className={`${styles.customUiPlacementLabel} ${styles.itemBarPlacementLabel}`}>物品栏</div>}
        {renderItemBar()}
      </div>

      <div className={styles.critPresetBar}>
        <div className={styles.critPresetButtonStack}>
          {COMBAT_PRESET_RARITIES.map((preset) => {
            const active = isWholeCombatPresetActive(preset);
            return (
            <button
              key={preset.id}
              type="button"
              disabled={!!runningCheatAction}
              className={styles.critPresetButton}
              style={{
                borderColor: preset.color,
                color: active ? (preset.id === 'white' ? '#111827' : '#ffffff') : preset.color,
                background: active ? preset.color : 'rgba(12,18,30,0.88)',
                opacity: runningCheatAction ? 0.6 : 1,
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
              }}
              onClick={() => void runCheatAction(
                `set-combat-preset-${preset.id}`,
                '/api/game/cheat/set-crit-chance',
                `双方外功会心/内功会心已设为 ${preset.stats.critChancePct}%，防御力已设为 ${preset.stats.defensePct}%，化劲已设为 ${preset.stats.huajinPct}%，气血 ${formatGameAmount(preset.stats.maxHp)}，攻击力 ${formatGameAmount(preset.stats.attackDamage)}`,
                {
                  waiGongCritChancePct: preset.stats.critChancePct,
                  neiGongCritChancePct: preset.stats.critChancePct,
                  defensePct: preset.stats.defensePct,
                  huajinPct: preset.stats.huajinPct,
                  maxHp: preset.stats.maxHp,
                  attackDamage: preset.stats.attackDamage,
                },
              )}
            >
              {preset.label}
            </button>
            );
          })}
          <button
            type="button"
            className={`${styles.critPresetButton} ${styles.critPresetExpandButton}`}
            aria-expanded={showCombatPresetPanel}
            onClick={() => setShowCombatPresetPanel((value) => !value)}
          >
            {showCombatPresetPanel ? '<' : '>'}
          </button>
        </div>
        {showCombatPresetPanel && (
          <div className={styles.critPresetPanel}>
            {COMBAT_PRESET_STAT_ROWS.map((row) => (
              <div key={row.key} className={styles.critPresetPanelRow}>
                <span className={styles.critPresetPanelLabel}>{row.label}</span>
                <div className={styles.critPresetPanelButtons}>
                  {COMBAT_PRESET_RARITIES.map((preset) => {
                    const active = isCombatPresetStatActive(preset, row.key);
                    return (
                      <button
                        key={`${row.key}-${preset.id}`}
                        type="button"
                        disabled={!!runningCheatAction}
                        className={styles.critPresetMiniButton}
                        title={`${row.label}: ${formatCombatPresetExactValue(row.key, preset.stats[row.key])}`}
                        style={{
                          borderColor: preset.color,
                          color: active ? (preset.id === 'white' ? '#111827' : '#ffffff') : preset.color,
                          background: active ? preset.color : 'rgba(10,16,25,0.92)',
                          opacity: runningCheatAction ? 0.6 : 1,
                          cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                        }}
                        onClick={() => void applyCombatPreset(preset, row.key)}
                      >
                        <span className={styles.critPresetMiniValue}>{formatCombatPresetExactValue(row.key, preset.stats[row.key])}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* ===== FULL-SCREEN 3D CANVAS ===== */}
      {/* ===== R3F 3D CANVAS ===== */}
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <Canvas
          key={sceneCanvasKey}
          camera={{ fov: 72, near: 0.5, far: 2000 }}
          style={{ background: blueprintMode ? '#000010' : selfHasHongMengTianJin ? '#000000' : '#888888' }}
          dpr={sceneCanvasDpr}
          gl={sceneCanvasGl}
          onCreated={handleMainCanvasCreated}
          shadows={mode === 'collision-test' && envToggles.shadows && !blueprintMode ? 'percentage' : false}
          onPointerMissed={(event) => {
            if (event.button !== 0) return;
            if (pendingDummySpawnRef.current || pendingGroundCastAbilityRef.current) return;
            if (performance.now() - lastQuickLeftClickAtRef.current > 140) return;
            clearTargetSelection();
          }}
        >
          <ArenaScene
            me={me}
            allOpponents={worldVisibleOpponentsList}
            opponents={visibleOpponentsList}
            selectedTargetId={selectedTargetId}
            onSelectTarget={(userId) => {
              const clicked = worldVisibleOpponentsList.find((o) => o.userId === userId);
              if (clicked && hasDisguiseClient(clicked.buffs)) {
                return;
              }
              if (clicked && blocksTargetingClient(clicked.buffs)) {
                showInGameWarning('目标不可选中');
                return;
              }
              pendingGroundCastAbilityRef.current = null;
              setPendingGroundCastAbilityId(null);
              setGroundCastPreview(null);
              setSelectedTargetId(userId);
              selectedTargetRef.current = userId;
              setSelectedEntityId(null);
              selectedEntityRef.current = null;
              setSelectedSelf(false);
              selectedSelfRef.current = false;
            }}
            entities={visibleEntities}
            selectedEntityId={selectedEntityId}
            myUserId={me.userId}
            onSelectEntity={(entityId) => {
              pendingGroundCastAbilityRef.current = null;
              setPendingGroundCastAbilityId(null);
              setGroundCastPreview(null);
              setSelectedEntityId(entityId);
              selectedEntityRef.current = entityId;
              setSelectedTargetId(null);
              selectedTargetRef.current = null;
              setSelectedSelf(false);
              selectedSelfRef.current = false;
            }}
            pickups={modePickups}
            meChanneling={meChannelingRef.current}
            meChannelRadius={meChannelRadiusRef.current}
            channelingOpponentId={visibleOpponentsList.find((o) => !!o?.buffs?.some((b: any) => b.buffId === 1014 || b.buffId === 2712))?.userId ?? null}
            channelingOpponentRadius={(() => { const opp = visibleOpponentsList.find((o) => !!o?.buffs?.some((b: any) => b.buffId === 1014 || b.buffId === 2712)); return opp?.buffs?.some((b: any) => b.buffId === 2712) ? 4 : 10; })()}
            selectedSelf={selectedSelf}
            localRenderPosRef={localRenderPosRef}
            camYawRef={camYawRef}
            camPitchRef={camPitchRef}
            camZoomRef={camZoomRef}
            cameraMoveCommandActiveRef={cameraMoveCommandActiveRef}
            cameraLookInputVersionRef={cameraLookInputVersionRef}
            manualCameraLookActiveRef={manualCameraLookActiveRef}
            meFacingRef={localFacingRef as React.MutableRefObject<{ x: number; y: number }>}
            maxHp={maxHp}
            meScreenBoundsRef={meScreenBoundsRef}
            oppScreenBoundsRef={oppScreenBoundsRef}
            opponentScreenBoundsRef={opponentScreenBoundsRef}
            entityScreenBoundsRef={entityScreenBoundsRef}
            mode={mode}
            safeZone={safeZone}
            groundZones={groundZones}
            groundCastPreview={
              (() => {
                if (pendingDummySpawn && dummySpawnPreview) {
                  const dummyMeta = getDummySpawnMeta(pendingDummySpawn);
                  return {
                    x: dummySpawnPreview.x,
                    y: dummySpawnPreview.y,
                    z: dummySpawnPreview.z,
                    radius: 1.5 * storedUnitScale,
                    label: dummyMeta.label,
                    isValid: true,
                  };
                }
                if (!groundCastPreview) return null;

                // Pending ground cast (e.g. 百足, 五方行尽)
                if (pendingGroundCastAbilityId) {
                  const previewAbilityInfo = abilitiesRef.current.find(
                    (a: any) => a.id === pendingGroundCastAbilityId
                  );
                  const previewAbilityId = previewAbilityInfo?.abilityId ?? pendingGroundCastAbilityId;
                  const previewAbility =
                    abilities[previewAbilityId] ??
                    Object.values(abilities).find((c: any) => c.id === previewAbilityId);
                  const isDashGroundTargetPreview = isDashGroundTargetAbilityId(previewAbilityId);
                  const previewRadiusUnits = isDashGroundTargetPreview
                    ? 0.8
                    : Array.isArray((previewAbility as any)?.effects)
                    ? ((previewAbility as any).effects.find((e: any) =>
                        e.type === 'BAIZU_AOE' || e.type === 'WUFANG_XINGJIN_AOE'
                      )?.range ?? 6)
                    : 6;
                  return {
                    x: groundCastPreview.x,
                    y: groundCastPreview.y,
                    z: groundCastPreview.z,
                    radius: previewRadiusUnits * storedUnitScale,
                    label: previewAbilityInfo?.name ?? previewAbility?.name ?? '范围预览',
                    isValid: groundCastPreview.isValid !== false,
                    showPath: isDashGroundTargetPreview && showUniqueDashRoute,
                  };
                }

                // No hover unless a pending ground cast is active
                return null;
              })()
            }
            onGroundPointerMove={(x, y, worldZ, isHorizontal) => {
              mouseWorldPosRef.current = { x, y, z: worldZ };
              // Only update preview state when there is an active pending ground cast
              if (pendingGroundCastAbilityRef.current) {
                const pendingAbility = abilitiesRef.current.find((a) => a.id === pendingGroundCastAbilityRef.current);
                setGroundCastPreview(
                  pendingAbility && isGroundCastPointWithinRange(pendingAbility, { x, y, z: worldZ })
                    ? { x, y, z: worldZ, isValid: isHorizontal !== false }
                    : null
                );
              }
              if (pendingDummySpawnRef.current) {
                setDummySpawnPreview({ x, y, z: worldZ });
              }
            }}
            onGroundPointerDown={(x, y, worldZ) => {
              if (pendingDummySpawnRef.current) {
                const preset = pendingDummySpawnRef.current;
                const dummyMeta = getDummySpawnMeta(preset);
                setPendingDummySpawn(null);
                setDummySpawnPreview(null);
                void runCheatAction(
                  `spawn-dummy-${preset}`,
                  '/api/game/cheat/spawn-dummy',
                  dummyMeta.successText,
                  { side: dummyMeta.side, x, y, z: worldZ, maxHp: dummyMeta.maxHp },
                );
                return;
              }
              if (!pendingGroundCastAbilityRef.current) {
                groundDeselectCandidateRef.current = true;
                return;
              }
              castGroundAbilityRef.current(x, y, worldZ);
            }}
            showCollisionShells={showCollisionShells}
            collisionReady={collisionReady}
            collisionSystemRef={collisionSysRef}
            collisionDebugRef={collisionDebugRef}
            onCollisionSystemReady={onCollisionSystemReady}
            onCameraDebugEvent={mode === 'collision-test' && showCameraEventTestingPanel ? appendCameraDebugEntry : undefined}
            blueprintMode={blueprintMode}
            losIsBlocked={draftAbilities.some(a => !!a?.losBlocked) || commonAbilities.some(a => a.losBlocked)}
            onEnvDebug={mode === 'collision-test' && lightingControlsOpen ? setEnvDebugInfo : undefined}
            onSceneMetrics={handleSceneMetrics}
            onSceneLoadTiming={handleSceneLoadTiming}
            envToggles={mode === 'collision-test' ? envToggles : undefined}
            dirLightConfig={mode === 'collision-test' ? dirLightConfig : undefined}
            blindWorldMode={selfHasHongMengTianJin}
            opponentInstantSnapAtRef={lastInstantSwapCastAtRef}
          />
          {/* Golden measurement line */}
          <MeasureLine3D
            pinA={measurePins[0] ?? null}
            pinB={measurePins[1] ?? null}
            halfX={ARENA_WIDTH / 2}
            halfY={ARENA_HEIGHT / 2}
          />
        </Canvas>
      </div>
      {sceneRecovering && <div className={styles.canvasRecoveryNotice}>画面恢复中</div>}
      {/* per-opponent floating channel overlay removed:
         enemy channel bar is now rendered inside .enemyBossGroup
         (below the boss HP bar, above the status bar). */}
      <div className={`${styles.hongMengBlackout} ${hongMengOverlayActive ? styles.hongMengOverlayVisible : ''}`} aria-hidden="true" />
      {hongMengOverlayActive && <div className={`${styles.hongMengSelfCanvas} ${styles.hongMengOverlayVisible}`} aria-hidden="true">
        <Canvas
          camera={{ fov: 72, near: 0.5, far: 2000 }}
          style={{ background: 'transparent' }}
          frameloop="always"
          dpr={sceneCanvasDpr}
          gl={overlayCanvasGl}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
        >
          <ArenaScene
            me={me}
            allOpponents={[]}
            opponents={[]}
            selectedTargetId={null}
            onSelectTarget={() => {}}
            entities={[]}
            selectedEntityId={null}
            myUserId={me.userId}
            onSelectEntity={() => {}}
            pickups={[]}
            meChanneling={false}
            meChannelRadius={0}
            channelingOpponentId={null}
            channelingOpponentRadius={0}
            selectedSelf={selectedSelf}
            localRenderPosRef={localRenderPosRef}
            camYawRef={camYawRef}
            camPitchRef={camPitchRef}
            camZoomRef={camZoomRef}
            cameraMoveCommandActiveRef={cameraMoveCommandActiveRef}
            cameraLookInputVersionRef={cameraLookInputVersionRef}
            manualCameraLookActiveRef={manualCameraLookActiveRef}
            meFacingRef={localFacingRef as React.MutableRefObject<{ x: number; y: number }>}
            maxHp={maxHp}
            mode={mode}
            collisionReady={collisionReady}
            collisionSystemRef={collisionSysRef}
            blueprintMode={false}
            selfOnlyMode={true}
          />
        </Canvas>
      </div>}
      {mode === 'collision-test' && showSceneTestingPanel && (
        <div className={styles.uiInfoPanel} style={{ left: '5%', top: '50%', transform: 'translateY(-50%)' }}>
          <div className={styles.uiFloatingTitle}>角色状态</div>
          <div className={styles.uiInfoValue}>位置 {localRenderPosRef.current.x.toFixed(1)}, {localRenderPosRef.current.y.toFixed(1)}</div>
          <div className={styles.uiInfoValue}>移速 {effectiveMoveSpeedUnitsPerSec.toFixed(2)}</div>
          <div className={styles.uiInfoValue}>镜头距离 {cameraZoomLevel.toFixed(2)}</div>
          <div className={styles.uiInfoValue}>广角 {CAMERA_FOV}</div>
        </div>
      )}

      {mode === 'collision-test' && showCameraEventTestingPanel && (
        <div
          className={styles.uiFloatingPanel}
          style={{
            left: '5%',
            top: '60%',
            width: 'min(420px, calc(100vw - 28px))',
            maxHeight: '34vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            paddingBottom: 10,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div className={styles.uiFloatingTitle}>镜头事件</div>
              <div className={styles.uiInlineHint}>记录镜头卡墙、贴墙、回正和跳变事件</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className={styles.uiInlineButton} onClick={clearCameraDebugEntries}>清空</button>
              <button type="button" className={styles.uiInlineButton} onClick={() => void copyCameraDebugEntries()}>复制</button>
            </div>
          </div>

          <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.86)' }}>
            已记录 {cameraDebugEntries.length} 条
          </div>

          <div
            style={{
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: '24vh',
              paddingRight: 4,
            }}
          >
            {cameraDebugEntries.length === 0 ? (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.58)', lineHeight: 1.5 }}>
                暂无镜头事件。发生卡墙、贴身、回正或明显跳变时会自动写入这里。
              </div>
            ) : cameraDebugEntries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.28)',
                  padding: '7px 8px',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.9)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.45,
                }}
              >
                {formatCameraDebugEntry(entry)}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'collision-test' && showMeasurePanel && (
        <div className={styles.uiFloatingPanel} style={{ left: '70%', top: '60%', width: 220, transform: 'translate(-50%, -50%)' }}>
          <div className={styles.uiFloatingTitle}>距离测试</div>
          <div className={styles.escMeasureGrid}>
            <button
              type="button"
              onClick={() => {
                const pos = localPositionRef.current ?? localRenderPosRef.current;
                const nextPin = { x: pos.x, y: pos.y, z: localZRef.current };
                setMeasurePins(prev => prev.length >= 2 ? [nextPin, prev[1]] : [nextPin]);
              }}
              className={`${styles.escMeasureButton} ${measurePins.length >= 1 ? styles.escMeasureButtonActive : ''}`}
            >
              Pin A
            </button>
            <button
              type="button"
              onClick={() => {
                const pos = localPositionRef.current ?? localRenderPosRef.current;
                const nextPin = { x: pos.x, y: pos.y, z: localZRef.current };
                setMeasurePins(prev => {
                  if (prev.length === 0) return prev;
                  return [prev[0], nextPin];
                });
              }}
              className={`${styles.escMeasureButton} ${measurePins.length >= 2 ? styles.escMeasureButtonActive : ''}`}
            >
              Pin B
            </button>
          </div>
          {measurePins.length === 0 && <div className={styles.uiInlineHint}>先点 Pin A 记录起点。</div>}
          {measurePins.length === 1 && <div className={styles.uiInlineHint}>A 已记录，再点 Pin B 记录终点。</div>}
          {measurePins.length >= 2 && (() => {
            const dx = measurePins[1].x - measurePins[0].x;
            const dy = measurePins[1].y - measurePins[0].y;
            const dz = measurePins[1].z - measurePins[0].z;
            const flatDist = Math.sqrt(dx * dx + dy * dy) / storedUnitScale;
            const heightDelta = Math.abs(dz) / storedUnitScale;
            const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz) / storedUnitScale;
            return (
              <div className={styles.escMeasureReadout}>
                <div>A 已记录</div>
                <div>B 已记录</div>
                <div>平面 {flatDist.toFixed(1)}</div>
                <div>高差 {heightDelta.toFixed(1)}</div>
                <div className={styles.escMeasureTotal}>总长 {totalDist.toFixed(1)}</div>
              </div>
            );
          })()}
          {measurePins.length > 0 && (
            <button type="button" onClick={() => setMeasurePins([])} className={styles.escMeasureClear}>清除</button>
          )}
        </div>
      )}

      {mode === 'collision-test' && showTestingPanel && (
        <div className={styles.escOverlay}>
          <div className={`${styles.escPanelShell} ${escPanelPage !== 'main' ? styles.escPanelShellSettings : ''}`} data-testing-panel>
            {escPanelPage === 'main' ? (
              <>
                <div className={styles.escWindowHeader}>
                  <div className={styles.escWindowTitle}>系统设置</div>
                  <button
                    type="button"
                    onClick={() => setShowTestingPanel(false)}
                    className={styles.escHeaderIconButton}
                    aria-label="关闭系统设置"
                  >
                    <X size={28} strokeWidth={2.3} aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.escMainTabs}>
                  <button
                    type="button"
                    className={`${styles.escMainTabButton} ${escMainTab === 'normal' ? styles.escMainTabButtonActive : ''}`}
                    onClick={() => setEscMainTab('normal')}
                  >
                    常规
                  </button>
                  <button
                    type="button"
                    className={`${styles.escMainTabButton} ${escMainTab === 'test' ? styles.escMainTabButtonActive : ''}`}
                    onClick={() => setEscMainTab('test')}
                  >
                    测试
                  </button>
                </div>
                {escMainTab === 'normal' ? (
                  <>
                    <div className={styles.escMainGrid}>
                      <button type="button" className={styles.escMainTile} disabled>
                        <span className={styles.escMainIcon}><Gauge size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>效果性能设置</span>
                      </button>
                      <button type="button" className={styles.escMainTile} onClick={() => setEscPanelPage('game-settings')}>
                        <span className={styles.escMainIcon}><Gamepad2 size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>游戏设置</span>
                      </button>
                      <button type="button" className={styles.escMainTile} onClick={() => setEscPanelPage('sound-settings')}>
                        <span className={styles.escMainIcon}><Volume2 size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>声音设置</span>
                      </button>
                      <button
                        type="button"
                        className={styles.escMainTile}
                        onClick={() => {
                          setShowTestingPanel(false);
                          setEscPanelPage('main');
                          setEscMainTab('normal');
                          openCustomUiMode();
                        }}
                      >
                        <span className={styles.escMainIcon}><LayoutGrid size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>自定义界面</span>
                      </button>
                      <button type="button" className={styles.escMainTile} disabled>
                        <span className={styles.escMainIcon}><MessageCircle size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>聊天设置</span>
                      </button>
                      <button type="button" className={styles.escMainTile} onClick={() => setEscPanelPage('hotkey-settings')}>
                        <span className={styles.escMainIcon}><Keyboard size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>快捷键设置</span>
                      </button>
                      <button type="button" className={styles.escMainTile} disabled>
                        <span className={styles.escMainIcon}><Puzzle size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>插件管理</span>
                      </button>
                      <button type="button" className={styles.escMainTile} disabled>
                        <span className={styles.escMainIcon}><Wind size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>宏管理</span>
                      </button>
                    </div>
                    <div className={styles.escMainFooter}>
                      <button type="button" className={styles.escFooterButton} onClick={() => setShowTestingPanel(false)}>返回游戏</button>
                      <button
                        type="button"
                        className={styles.escFooterButton}
                        onClick={() => {
                          setShowTestingPanel(false);
                          void onLeaveGame?.();
                        }}
                      >
                        退出游戏
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.escTestPanel}>
                    <div className={styles.escTestLayout}>
                      <aside className={styles.escTestSidebar}>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'switches' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setEscTestPage('switches')}
                        >
                          开关
                        </button>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'lighting' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setEscTestPage('lighting')}
                        >
                          灯光控制
                        </button>
                      </aside>
                      <section className={styles.escTestContent}>
                        {escTestPage === 'switches' ? (
                          <div className={styles.escTestGrid}>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showSceneTestingPanel} onChange={(e) => setShowSceneTestingPanel(e.target.checked)} className={styles.escToggleInput} />
                              <span>角色测试状态</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showCameraEventTestingPanel} onChange={(e) => setShowCameraEventTestingPanel(e.target.checked)} className={styles.escToggleInput} />
                              <span>镜头测试</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showLoadPerformancePanel} onChange={(e) => setShowLoadPerformancePanel(e.target.checked)} className={styles.escToggleInput} />
                              <span>场景加载报告</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input
                                type="checkbox"
                                checked={showDebugGrid}
                                onChange={(e) => {
                                  setShowDebugGrid(e.target.checked);
                                }}
                                className={styles.escToggleInput}
                              />
                              <span>屏幕坐标</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showCollisionShells} onChange={(e) => setShowCollisionShells(e.target.checked)} className={styles.escToggleInput} />
                              <span>显示碰撞线</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showUniqueDashRoute} onChange={(e) => setShowUniqueDashRoute(e.target.checked)} className={styles.escToggleInput} />
                              <span>显示位移路线</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={blueprintMode} onChange={(e) => setBlueprintMode(e.target.checked)} className={styles.escToggleInput} />
                              <span>显示蓝图</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showMeasurePanel} onChange={(e) => setShowMeasurePanel(e.target.checked)} className={styles.escToggleInput} />
                              <span>距离测试窗口</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input
                                type="checkbox"
                                checked={showJumpDetailsPanel && showGroundDistanceDetail}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  setShowJumpDetailsPanel(next);
                                  setShowGroundDistanceDetail(next);
                                }}
                                className={styles.escToggleInput}
                              />
                              <span>跳跃细节和地面距离</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input
                                type="checkbox"
                                checked={allowOverrangeCameraZoom}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  setAllowOverrangeCameraZoom(next);
                                  if (!next) {
                                    camZoomRef.current = Math.min(camZoomRef.current, CAMERA_ZOOM_MAX);
                                    setCameraZoomLevel(camZoomRef.current);
                                  }
                                }}
                                className={styles.escToggleInput}
                              />
                              <span>允许超距镜头</span>
                            </label>
                          </div>
                        ) : (
                          <div className={styles.escLightingPanel}>
                            <div className={styles.escSectionTitle}><span>灯光控制</span></div>
                            <div className={styles.escLightingToggleGrid}>
                              {([
                                ['toneMapping', 'toneMapping'],
                                ['exposure', '曝光'],
                                ['shadows', '阴影'],
                                ['dirLight', '方向光'],
                                ['ambLight', '环境光'],
                                ['hemiLight', '半球光'],
                                ['fog', '雾效'],
                                ['skyDome', '天空球'],
                                ['cameraFar', '远裁剪'],
                              ] as [keyof EnvToggles, string][]).map(([key, label]) => (
                                <label key={key} className={styles.escToggleRow}>
                                  <input
                                    type="checkbox"
                                    checked={envToggles[key]}
                                    className={styles.escToggleInput}
                                    onChange={() => setEnvToggles(prev => {
                                      const next = { ...prev, [key]: !prev[key] };
                                      if (key === 'dirLight' && next.dirLight) {
                                        next.toneMapping = true;
                                        next.exposure = true;
                                        next.ambLight = true;
                                        next.hemiLight = true;
                                        next.shadows = true;
                                        next.cameraFar = true;
                                      }
                                      return next;
                                    })}
                                  />
                                  <span>{label}</span>
                                </label>
                              ))}
                            </div>
                            <div className={styles.escLightingControls}>
                              <div className={styles.escRangeHeader}>
                                <span>太阳亮度</span>
                                <span>{dirLightConfig.intensity.toFixed(2)}</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="6"
                                step="0.05"
                                value={dirLightConfig.intensity}
                                onChange={(e) => setDirLightConfig((prev) => ({ ...prev, intensity: Number(e.target.value) }))}
                                className={styles.escRangeInput}
                              />
                              <div className={styles.escLightingColorRow}>
                                <span>太阳颜色</span>
                                <input
                                  type="color"
                                  value={dirLightConfig.customColor}
                                  onChange={(e) => setDirLightConfig((prev) => ({
                                    ...prev,
                                    colorMode: 'custom',
                                    customColor: e.target.value,
                                  }))}
                                  className={styles.escColorInput}
                                />
                                <button type="button" onClick={() => setDirLightConfig({ intensity: 3.0, colorMode: 'export', customColor: '#fdf2ed' })} className={styles.escInlineButton}>导出默认</button>
                                <button type="button" onClick={() => setDirLightConfig({ intensity: 0.25, colorMode: 'export', customColor: '#fdf2ed' })} className={styles.escInlineButton}>低亮默认</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.escWindowHeader}>
                  <button
                    type="button"
                    className={styles.escHeaderIconButton}
                    aria-label="返回系统设置"
                    onClick={() => setEscPanelPage('main')}
                  >
                    <ArrowLeft size={28} strokeWidth={2.3} aria-hidden="true" />
                  </button>
                  <div className={styles.escWindowTitle}>{escPanelPage === 'hotkey-settings' ? '快捷键设置' : escPanelPage === 'sound-settings' ? '声音设置' : '游戏设置'}</div>
                  <button
                    type="button"
                    onClick={() => setShowTestingPanel(false)}
                    className={styles.escHeaderIconButton}
                    aria-label={escPanelPage === 'hotkey-settings' ? '关闭快捷键设置' : escPanelPage === 'sound-settings' ? '关闭声音设置' : '关闭游戏设置'}
                  >
                    <X size={28} strokeWidth={2.3} aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.escSettingsBody}>
                  <aside className={styles.escSettingsSidebar}>
                    {escPanelPage === 'hotkey-settings' ? (
                      <button type="button" className={`${styles.escSettingsNavButton} ${styles.escSettingsNavButtonActive}`}>物品快捷栏</button>
                    ) : escPanelPage === 'sound-settings' ? (
                      <button type="button" className={`${styles.escSettingsNavButton} ${styles.escSettingsNavButtonActive}`}>音效</button>
                    ) : (
                      <button type="button" className={`${styles.escSettingsNavButton} ${styles.escSettingsNavButtonActive}`}>综合</button>
                    )}
                  </aside>
                  <section className={styles.escSettingsContent}>
                    {escPanelPage === 'hotkey-settings' ? (
                      <>
                        <div className={styles.escSectionTitle}><span>物品快捷栏</span></div>
                        <div className={styles.escSettingsGrid}>
                          <div className={`${styles.escToggleGroup} ${styles.escSettingControl}`}>
                            <label className={styles.escToggleGroupHeader}>
                              <input
                                type="checkbox"
                                checked={!consumableBarSettings.enabled}
                                onChange={(e) => setConsumableBarEnabled(!e.target.checked)}
                                className={styles.escToggleInput}
                              />
                              <span>关闭</span>
                            </label>
                          </div>
                          <div className={styles.escSettingControl}>
                            <div className={styles.escRangeHeader}>
                              <span>格子数量</span>
                              <span>{consumableBarSettings.slotCount}</span>
                            </div>
                            <input
                              type="range"
                              min={CONSUMABLE_BAR_MIN_SLOTS}
                              max={CONSUMABLE_BAR_MAX_SLOTS}
                              step="1"
                              value={consumableBarSettings.slotCount}
                              onChange={(e) => setConsumableBarSlotCount(e.target.value)}
                              className={styles.escRangeInput}
                              aria-label="格子数量"
                            />
                          </div>
                        </div>
                      </>
                    ) : escPanelPage === 'sound-settings' ? (
                      <>
                        <div className={styles.escSectionTitle}><span>声音设置</span></div>
                        <div className={styles.escSettingsGrid}>
                          <div className={styles.escSettingControl}>
                            <div className={styles.escRangeHeader}>
                              <span>音效音量</span>
                              <span>{abilitySoundSettings.volumePercent}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={abilitySoundSettings.volumePercent}
                              onChange={(e) => {
                                const volumePercent = normalizeAbilitySoundVolumePercent(e.target.value);
                                setAbilitySoundSettings((prev) => ({ ...prev, volumePercent }));
                              }}
                              className={styles.escRangeInput}
                              aria-label="音效音量"
                              disabled={abilitySoundSettings.disabled}
                            />
                            <label className={styles.escToggleRow}>
                              <input
                                type="checkbox"
                                checked={abilitySoundSettings.disabled}
                                onChange={(e) => {
                                  const disabled = e.target.checked;
                                  setAbilitySoundSettings((prev) => ({ ...prev, disabled }));
                                }}
                                className={styles.escToggleInput}
                              />
                              <span>关闭音效</span>
                            </label>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.escSectionTitle}><span>界面设置</span></div>
                        <div className={styles.escSettingsGrid}>
                          <div className={styles.escSettingControl}>
                            <div className={styles.escRangeHeader}>
                              <span>技能栏大小</span>
                              <span>{abilityPanelScale.toFixed(2)}</span>
                            </div>
                            <input
                              type="range"
                              min="0.5"
                              max="2"
                              step="0.01"
                              value={abilityPanelScale}
                              onChange={(e) => setAbilityPanelScale(normalizeAbilityPanelScale(e.target.value))}
                              className={styles.escRangeInput}
                              aria-label="技能栏大小"
                            />
                          </div>
                          <div className={styles.escSettingControl}>
                            <div className={styles.escRangeHeader}>
                              <span>战斗警告大小</span>
                              <span>{inGameWarningScale.toFixed(2)}</span>
                            </div>
                            <input
                              type="range"
                              min="0.1"
                              max="2"
                              step="0.01"
                              value={inGameWarningScale}
                              onChange={(e) => setInGameWarningScale(normalizeInGameWarningScale(e.target.value))}
                              className={styles.escRangeInput}
                              aria-label="战斗警告大小"
                            />
                          </div>
                          <div className={`${styles.escToggleGroup} ${styles.escSettingControl}`}>
                            <label className={styles.escToggleGroupHeader}>
                              <input
                                type="checkbox"
                                checked={gcdVisibilitySettings.enabled}
                                onChange={(e) => {
                                  const enabled = e.target.checked;
                                  setGcdVisibilitySettings((prev) => ({ ...prev, enabled }));
                                }}
                                className={styles.escToggleInput}
                              />
                              <span>显示GCD</span>
                            </label>
                            {gcdVisibilitySettings.enabled && (
                              <div className={styles.escToggleSubList}>
                                <label className={`${styles.escToggleRow} ${styles.escToggleSubRow}`}>
                                  <input
                                    type="checkbox"
                                    checked={gcdVisibilitySettings.base}
                                    onChange={(e) => {
                                      const base = e.target.checked;
                                      setGcdVisibilitySettings((prev) => ({ ...prev, base }));
                                    }}
                                    className={styles.escToggleInput}
                                  />
                                  <span>显示基础GCD</span>
                                </label>
                                <label className={`${styles.escToggleRow} ${styles.escToggleSubRow}`}>
                                  <input
                                    type="checkbox"
                                    checked={gcdVisibilitySettings.qinggong}
                                    onChange={(e) => {
                                      const qinggong = e.target.checked;
                                      setGcdVisibilitySettings((prev) => ({ ...prev, qinggong }));
                                    }}
                                    className={styles.escToggleInput}
                                  />
                                  <span>显示轻功GCD</span>
                                </label>
                                <label className={`${styles.escToggleRow} ${styles.escToggleSubRow}`}>
                                  <input
                                    type="checkbox"
                                    checked={gcdVisibilitySettings.houyao}
                                    onChange={(e) => {
                                      const houyao = e.target.checked;
                                      setGcdVisibilitySettings((prev) => ({ ...prev, houyao }));
                                    }}
                                    className={styles.escToggleInput}
                                  />
                                  <span>显示后撤GCD</span>
                                </label>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                </div>
                <div className={styles.escSettingsFooter}>
                  <div className={styles.escSettingsFooterRight}>
                    <button type="button" className={styles.escFooterButton} onClick={() => setShowTestingPanel(false)}>确定</button>
                    <button type="button" className={styles.escFooterButton} onClick={() => setEscPanelPage('main')}>取消</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {mode === 'collision-test' && !collisionReady && (
        <div style={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 520,
          background: 'rgba(18, 18, 18, 0.92)',
          border: '1px solid rgba(255, 210, 74, 0.6)',
          color: '#ffd24a',
          fontSize: 18,
          padding: '14px 22px',
          borderRadius: 8,
          pointerEvents: 'none',
          fontFamily: 'monospace',
          letterSpacing: 2,
        }}>
          场景加载中
        </div>
      )}

      {showLoadPerformancePanel && loadPerformanceSnapshot && (
        <div className={`${styles.uiFloatingPanel} ${styles.loadPerfPanel}`} data-ui-interactive data-load-performance-panel>
          <div className={styles.loadPerfHeader}>
            <div>
              <div className={styles.uiFloatingTitle}>场景加载</div>
              <div className={styles.loadPerfSummary}>
                总耗时 {formatLoadPerfMs(loadPerformanceSnapshot.totalMs)} · {loadPerformanceSnapshot.completed ? '完成' : '进行中'} · {loadPerformanceSnapshot.inProgressStages.length} 项进行中
              </div>
            </div>
            <div className={styles.loadPerfHeaderActions}>
              <button
                type="button"
                className={styles.loadPerfCopyButton}
                onClick={copyLoadPerformanceReport}
              >
                <Clipboard size={13} />
                <span>复制报告</span>
              </button>
              <button
                type="button"
                className={styles.loadPerfCloseButton}
                onClick={() => setShowLoadPerformancePanel(false)}
                aria-label="关闭场景加载"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className={styles.loadPerfSection}>
            <div className={styles.loadPerfSectionTitle}>阶段耗时</div>
            <div className={styles.loadPerfStageList}>
              {loadPerformanceSnapshot.stages.map((stage) => (
                <div key={stage.id} className={styles.loadPerfStageRow}>
                  <span>{stage.name}</span>
                  <strong data-status={stage.status}>{stage.status}</strong>
                  <small>{formatLoadPerfMs(stage.durationMs)} · {formatLoadPerfMs(stage.startedAtMs)}→{stage.completedAtMs === null ? '...' : formatLoadPerfMs(stage.completedAtMs)}</small>
                  {stage.detail && <em>{stage.detail}</em>}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.loadPerfSection}>
            <div className={styles.loadPerfSectionTitle}>资源分组</div>
            {loadPerformanceSnapshot.resourceGroups.length > 0 ? (
              <div className={styles.loadPerfStageList}>
                {loadPerformanceSnapshot.resourceGroups.map((group) => (
                  <div key={group.label} className={styles.loadPerfResourceRow}>
                    <span>{group.label}</span>
                    <strong>{group.count} 个</strong>
                    <small>最慢 {formatLoadPerfMs(group.maxDurationMs)} · 合计 {formatLoadPerfMs(group.totalDurationMs)}</small>
                    <em>{group.slowestName || '-'}</em>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.loadPerfEmpty}>无 full-exports 资源计时</div>
            )}
          </div>
          <div className={styles.loadPerfSection}>
            <div className={styles.loadPerfSectionTitle}>最慢资源</div>
            {loadPerformanceSnapshot.slowestResources.length > 0 ? (
              <div className={styles.loadPerfStageList}>
                {loadPerformanceSnapshot.slowestResources.slice(0, 5).map((resource) => (
                  <div key={`${resource.label}-${resource.name}`} className={styles.loadPerfResourceRow}>
                    <span>{resource.label}</span>
                    <strong>{formatLoadPerfMs(resource.durationMs)}</strong>
                    <small>{formatLoadPerfBytes(resource.transferSizeBytes)}</small>
                    <em>{resource.name}</em>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.loadPerfEmpty}>无</div>
            )}
          </div>
          <div className={styles.loadPerfGameCounts}>
            Three {formatLoadPerfNumber(loadPerformanceSnapshot.sceneMetrics?.objects)} objects · {formatLoadPerfNumber(loadPerformanceSnapshot.sceneMetrics?.geometries)} geometries · {formatLoadPerfNumber(loadPerformanceSnapshot.sceneMetrics?.textures)} textures · {formatLoadPerfNumber(loadPerformanceSnapshot.sceneMetrics?.calls)} draws
          </div>
        </div>
      )}

      {/* ===== JUMP STATS + HEIGHT DISPLAY ===== */}
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.heightCounterPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={{ left: heightCounterPos.left, top: heightCounterPos.top }}
        onMouseDown={customUiMode ? (event) => startUIDrag(HEIGHT_COUNTER_UI_KEY, heightCounterDefaultPos, event, { persist: false }) : undefined}
      >
        {showJumpDetailsPanel && (
          <div className={styles.heightDetailsBox}>
            {jumpRecord.riseMs !== null
              ? (
                <>
                  <div>
                    {`J${jumpRecord.jumpPhase ?? '?'} ${jumpRecord.mode === 'directional' ? 'dir' : 'up'}  ↑ ${(jumpRecord.riseMs / 1000).toFixed(2)}s  ↓ ${(jumpRecord.fallMs! / 1000).toFixed(2)}s  ⟳ ${(jumpRecord.totalMs! / 1000).toFixed(2)}s  ⬆ ${jumpRecord.peakUnits!.toFixed(1)}u`}
                  </div>
                  <div>
                    {`v0 ${(jumpRecord.startSpeedUnitsPerSec ?? 0).toFixed(2)} u/s  exp ${(jumpRecord.expectedLandUnits ?? 0).toFixed(2)}u  land ${(jumpRecord.actualLandUnits ?? 0).toFixed(2)}u`}
                  </div>
                </>
              )
              : '— — —'}
          </div>
        )}
        {/* Current height: A = above current floor, B = relative floor elevation */}
        <div className={styles.heightValueBox}>
          <span style={{ color: '#44ffaa' }}>{heightDisplay.aboveGround.toFixed(1)}</span>
          {showGroundDistanceDetail && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}> | </span>
              <span style={{ color: '#ffd700' }}>{heightDisplay.floorElev.toFixed(1)}</span>
            </>
          )}
        </div>
      </div>

      {/* ===== TOP-LEFT: My HP panel ===== */}
      <div
        ref={playerPanelRef}
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.playerPanel} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={useCustomPlayerIconBarPlacement
          ? {
              left: playerIconBarPos.left,
              top: playerIconBarPos.top,
              transform: 'none',
              pointerEvents: 'all',
              cursor: customUiMode ? 'move' : 'pointer',
            }
          : { pointerEvents: 'all', cursor: 'pointer' }}
        onMouseDown={customUiMode ? (event) => startUIDrag(PLAYER_ICON_BAR_UI_KEY, playerIconBarDefaultPos, event, { persist: false }) : undefined}
        onClick={customUiMode ? undefined : () => {
          const next = !selectedSelfRef.current;
          selectedSelfRef.current = next;
          setSelectedSelf(next);
          if (next) {
            setSelectedTargetId(null);
            selectedTargetRef.current = null;
          }
        }}
      >
        <div className={`${styles.enemyBossBar} ${styles.selfIconBar} ${styles.playerIconBar}`}>
          <div className={styles.enemyName}>{me?.username ?? '玩家'}</div>
          <div className={styles.iconBarBody}>
            <div className={styles.enemyHpTrack}>
              {myHpPct > 0 && myHpPct < 100 && (
                <div
                  className={styles.enemyHpTick}
                  style={{ left: `${myHpPct}%` }}
                />
              )}
              {myShieldPct > 0 && (
                <div
                  className={styles.enemyShieldFill}
                  style={{
                    left: `${myHpPct}%`,
                    width: `${myShieldPct}%`,
                  }}
                />
              )}
              <div
                className={styles.enemyHpFill}
                style={{
                  width: `${myHpPct}%`,
                  background: selfIconBarHpGradient,
                }}
              />
              {(me?.hp ?? 0) > 0 && (
                <span
                  className={styles.hpSegmentNum}
                  style={{ left: '50%' }}
                >
                  {formatGameHealthRatio(me?.hp ?? 0, myMaxHp)}
                </span>
              )}
            </div>
            <div className={styles.iconBarResourceRow}>
              <span className={styles.iconBarResourceValue}>130</span>
            </div>
            {renderCombatStatusMarker(me?.inCombat)}
          </div>
        </div>
      </div>
      {showFloatingHeartStatsPanel && (
        <div
          ref={heartDetailsRef}
          data-ui-drag={customUiMode ? 'true' : undefined}
          className={`${styles.heartDetailsPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
          style={{ left: heartStatsPos.left, top: heartStatsPos.top }}
          onMouseDown={customUiMode ? (event) => startUIDrag(HEART_STATS_UI_KEY, heartStatsDefaultPos, event, { persist: false }) : undefined}
        >
          {customUiMode && <div className={styles.customUiPlacementLabel}>属性栏</div>}
          <div className={styles.heartDetailsPanel}>
            <div className={styles.heartDetailsHeader}>
              <span className={styles.heartDetailsTitle}>属性</span>
              <button
                type="button"
                className={styles.heartDetailsTab}
                onClick={() => setShowHeartStatSettings((value) => !value)}
                aria-pressed={showHeartStatSettings}
              >
                详细
              </button>
            </div>
            <div className={styles.heartDetailsBody}>
              {heartStatRows.map((row) => {
                const isVisible = heartStatVisibility[row.key] !== false;
                return (
                <div
                  key={row.key}
                  className={`${styles.heartDetailsRow} ${isVisible ? '' : styles.heartDetailsRowHidden}`.trim()}
                  onMouseEnter={isVisible ? (event) => openHeartStatHint(event, row) : undefined}
                  onMouseLeave={isVisible ? () => setHeartStatHint(null) : undefined}
                  aria-hidden={!isVisible}
                >
                  <span className={styles.heartDetailsLabel}>{row.label}</span>
                  <span className={styles.heartDetailsValue}>{row.value}</span>
                </div>
                );
              })}
            </div>
          </div>
          {showHeartStatSettings && (
            <div className={styles.heartSettingsPanel}>
              <div className={styles.heartSettingsHeader}>详细</div>
              <div className={styles.heartSettingsBody}>
                {heartStatRows.map((row) => (
                  <label key={row.key} className={styles.heartSettingsRow}>
                    <input
                      type="checkbox"
                      checked={heartStatVisibility[row.key] !== false}
                      onChange={() => toggleHeartStatVisibility(row.key)}
                      className={styles.heartSettingsCheckbox}
                    />
                    <span className={styles.heartSettingsLabel}>{row.label}</span>
                    <span className={styles.heartSettingsValue}>{row.value}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {heartStatHint && <HeartStatHoverHint hint={heartStatHint} />}
        </div>
      )}

      {/* ===== TOP-CENTER: Target info panel — health → buffs → abilities (self or enemy) ===== */}
      <div
        ref={targetIconBarRef}
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.enemyBossGroup} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={useCustomTargetIconBarPlacement ? { left: targetIconBarPos.left, top: targetIconBarPos.top } : undefined}
        onMouseDown={customUiMode ? (event) => startUIDrag(TARGET_ICON_BAR_UI_KEY, targetIconBarDefaultPos, event, { persist: false }) : undefined}
      >
        <div style={customUiMode ? { pointerEvents: 'none' } : undefined}>
        {targetStatusHasSelection ? (() => {
          const selectedTarget = selectedTargetId
            ? opponentsList.find((o) => o.userId === selectedTargetId) ?? null
            : null;
          const selectedEntity = selectedEntityId
            ? (entities ?? []).find((entity) => entity.id === selectedEntityId) ?? null
            : null;
          const entityOwner = selectedEntity
            ? (selectedEntity.ownerUserId === me?.userId
                ? me
                : opponentsList.find((o) => o.userId === selectedEntity.ownerUserId) ?? null)
            : null;
          const isSelf       = selectedSelf && !selectedTargetId && !selectedEntityId;
          const isEntityTarget = !isSelf && !!selectedEntity;
          const isDummyEntity = isEntityTarget && (selectedEntity?.kind === 'test_dummy_ally' || selectedEntity?.kind === 'test_dummy_enemy');
          const isOwnEntity  = isEntityTarget && selectedEntity?.ownerUserId === me?.userId;
          const targetPosition = isSelf ? me.position : isEntityTarget ? selectedEntity?.position : selectedTarget?.position;
          const targetHp     = isSelf ? (me?.hp ?? 0) : isEntityTarget ? (selectedEntity?.hp ?? 0) : (selectedTarget?.hp ?? 0);
          const targetShield = Math.max(0, isSelf ? (me?.shield ?? 0) : isEntityTarget ? (selectedEntity?.shield ?? 0) : (selectedTarget?.shield ?? 0));
          const targetMaxHp  = isSelf
            ? (me?.maxHp ?? maxHp)
            : isEntityTarget ? (selectedEntity?.maxHp ?? 1) : (selectedTarget?.maxHp ?? maxHp);
          const targetBarSegments = computeHpShieldSegments(targetHp, targetShield, targetMaxHp);
          const targetHpPct = targetBarSegments.hpPct;
          const targetShieldPct = targetBarSegments.shieldPct;
          const targetName   = isSelf
            ? (me?.username ?? '玩家')
            : isEntityTarget
            ? (isDummyEntity
                ? (isOwnEntity ? '友方木桩' : '敌方木桩')
                : `${entityOwner?.username ?? '玩家'}的逐云寒蕊`)
            : (selectedTarget?.username ?? '目标');
          const targetIconDistanceText = formatIconBarDistance(me.position, targetPosition, storedUnitScale);
          const targetBuffs  = isSelf ? (me?.buffs ?? []) : isEntityTarget ? (selectedEntity?.buffs ?? []) : (selectedTarget?.buffs ?? []);
          const hpGradient   = isSelf ? selfIconBarHpGradient : iconBarHpGradient;
          const targetInCombat = isSelf ? !!me?.inCombat : isEntityTarget ? false : !!selectedTarget?.inCombat;
          const channelTargetUserId = isSelf
            ? me?.userId
            : isEntityTarget
            ? entityOwner?.userId
            : selectedTarget?.userId;
          const enemyChannelData = channelTargetUserId
            ? (channelTargetUserId === me?.userId
              ? channelBarData
              : opponentChannelDataById.get(channelTargetUserId) ?? null)
            : null;
          return (
            <>
              <div className={styles.enemyBossTopRow}>
                <div className={styles.enemyPrimaryBossStack}>
                  <div className={`${styles.enemyBossBar} ${isSelf ? styles.selfIconBar : ''}`}>
                    <div className={styles.enemyName}><span className={styles.targetIconDistance}>{targetIconDistanceText}</span> · {targetName}</div>
                    <div className={styles.iconBarBody}>
                      <div className={styles.enemyHpTrack}>
                        {targetHpPct > 0 && targetHpPct < 100 && (
                          <div
                            className={styles.enemyHpTick}
                            style={{ left: `${targetHpPct}%` }}
                          />
                        )}
                        {targetShieldPct > 0 && (
                          <div
                            className={styles.enemyShieldFill}
                            style={{
                              left: `${targetHpPct}%`,
                              width: `${targetShieldPct}%`,
                            }}
                          />
                        )}
                        <div
                          className={styles.enemyHpFill}
                          style={{ width: `${targetHpPct}%`, background: hpGradient }}
                        />
                        {targetHp > 0 && (
                          <span
                            className={styles.hpSegmentNum}
                            style={{ left: '50%' }}
                          >
                            {formatGameHealthRatio(targetHp, targetMaxHp)}
                          </span>
                        )}
                      </div>
                      <div className={styles.iconBarResourceRow}>
                        <span className={styles.iconBarResourceValue}>130</span>
                      </div>
                      {renderCombatStatusMarker(targetInCombat)}
                    </div>
                  </div>
                  <div className={styles.enemyBossChannelSlot}>
                    <ChannelBarHost data={enemyChannelData} variant="enemy" />
                  </div>
                </div>
              </div>
              {showInlineTargetStatus && (
                <div style={{ minHeight: 72, width: '100%', pointerEvents: 'auto' }}>
                  <StatusBar
                    buffs={targetBuffs}
                    debugLabel={isSelf ? 'me-target' : 'opp'}
                    allowAnyCancel={!isSelf && isDummyEntity && isOwnEntity && selectedEntity?.kind === 'test_dummy_ally'}
                    onCancelBuff={
                      isSelf
                        ? onCancelBuff
                        : (isDummyEntity && isOwnEntity && selectedEntity?.kind === 'test_dummy_ally' && onCancelBuff)
                          ? ((buffId) => onCancelBuff(buffId, { entityTargetId: selectedEntity.id }))
                          : undefined
                    }
                  />
                </div>
              )}
              {!showFloatingTargetOwnedAbilityBar && renderTargetOwnedAbilityBar(targetOwnedAbilityHand)}
            </>
          );
        })() : customUiMode ? renderTargetIconBarPreview() : null}
        </div>
      </div>

      {showFloatingTargetTargetIconBar && (
        <div
          ref={targetTargetIconBarRef}
          data-ui-drag={customUiMode ? 'true' : undefined}
          className={`${styles.customUiFloatingHudPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
          style={{ left: targetTargetIconBarPos.left, top: targetTargetIconBarPos.top }}
          onMouseDown={customUiMode ? (event) => startUIDrag(TARGET_TARGET_ICON_BAR_UI_KEY, targetTargetIconBarDefaultPos, event, { persist: false }) : undefined}
        >
          <div style={customUiMode ? { pointerEvents: 'none' } : undefined}>
            {renderTargetTargetIconBar(customUiMode)}
          </div>
        </div>
      )}

      {/* ===== DEBUG POSITION GRID ===== */}
      {showDebugGrid && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 490 }}>
          {/* Grid lines every 10% */}
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(p => (
            <React.Fragment key={p}>
              {/* horizontal */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: `${p}%`, height: 1,
                background: p === 50 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)' }} />
              {/* vertical */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${p}%`, width: 1,
                background: p === 50 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)' }} />
              {/* Y label on left edge */}
              <div style={{
                position: 'absolute', left: 3, top: `${p}%`,
                transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.75)', color: '#ffdd00',
                fontSize: 10, fontFamily: 'monospace', padding: '1px 4px', borderRadius: 2,
              }}>Y{p}</div>
              {/* X label on top edge */}
              <div style={{
                position: 'absolute', top: 3, left: `${p}%`,
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.75)', color: '#ffdd00',
                fontSize: 10, fontFamily: 'monospace', padding: '1px 4px', borderRadius: 2,
              }}>X{p}</div>
            </React.Fragment>
          ))}

          {/* Cursor coordinates readout */}
          {debugCursor && (
            <div style={{
              position: 'absolute',
              left: `${Math.min(debugCursor.x, 80)}%`,
              top:  `${Math.min(debugCursor.y, 90)}%`,
              transform: 'translate(8px, -50%)',
              background: 'rgba(0,0,0,0.88)', color: '#ffdd00',
              fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
              padding: '3px 8px', borderRadius: 4,
              border: '1px solid rgba(255,221,0,0.6)',
              pointerEvents: 'none',
              zIndex: 495,
            }}>
              X:{debugCursor.x.toFixed(1)}% Y:{debugCursor.y.toFixed(1)}%
            </div>
          )}

          {/* Live canvas bounds markers */}
          {(() => {
            const { me, opp, cw, ch } = debugBounds;
            if (!cw || !ch) return null;
            const markers: Array<{ x: number; y: number; color: string; label: string }> = [];
            if (me) {
              const x = (me.cx / cw) * 100;
              const y = (me.hpBarY / ch) * 100;
              markers.push({ x, y, color: '#44aaff', label: `ME hp-bar\nX:${x.toFixed(1)}% Y:${y.toFixed(1)}%` });
            }
            if (opp) {
              const x = (opp.cx / cw) * 100;
              const y = (opp.topY / ch) * 100;
              markers.push({ x, y, color: '#ff5555', label: `OPP head\nX:${x.toFixed(1)}% Y:${y.toFixed(1)}%` });
            }
            return markers.map((m, i) => (
              <div key={i} style={{ position: 'absolute', left: `${m.x}%`, top: `${m.y}%`,
                transform: 'translate(-50%,-50%)', zIndex: 496 }}>
                {/* crosshair dot */}
                <div style={{ width: 10, height: 10, borderRadius: '50%',
                  background: m.color, border: '2px solid #fff',
                  boxShadow: '0 0 8px rgba(0,0,0,0.9)' }} />
                {/* horizontal tick */}
                <div style={{ position: 'absolute', top: 4, left: -18, width: 14, height: 2, background: m.color }} />
                <div style={{ position: 'absolute', top: 4, left: 12, width: 14, height: 2, background: m.color }} />
                {/* label */}
                <div style={{
                  position: 'absolute', top: 14, left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.88)', color: m.color,
                  fontSize: 10, fontFamily: 'monospace', padding: '2px 6px',
                  borderRadius: 3, border: `1px solid ${m.color}`,
                  whiteSpace: 'pre', textAlign: 'center',
                }}>
                  {m.label}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ===== CENTER: Distance floating label ===== */}
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.distIndicator} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={{ left: distanceIndicatorPos.left, top: distanceIndicatorPos.top }}
        onMouseDown={customUiMode ? (event) => startUIDrag(DISTANCE_INDICATOR_UI_KEY, distanceIndicatorDefaultPos, event, { persist: false }) : undefined}
      >
        <span className={styles.distVal}>
          {selectedTargetDistance !== null ? `${selectedTargetDistance.toFixed(1)}尺` : '没有目标'}
        </span>
      </div>

      {/* ===== PICKUP: "拾取 [F]" prompts — draggable, always visible when near books ===== */}
      {nearbyPickupIds.length > 0 && (() => {
        const promptPos = uiPositions['pickup-prompt'] ?? { left: 64, top: 60 };
        return (
          <div
            style={{
              position: 'absolute',
              left: promptPos.left,
              top: promptPos.top,
              display: 'flex', flexDirection: 'column', gap: 4,
              pointerEvents: 'auto',
              zIndex: 650,
              cursor: 'move',
            }}
            data-ui-drag="true"
            onMouseDown={(e) => startUIDrag('pickup-prompt', { left: 64, top: 60 }, e)}
          >
            {nearbyPickupIds.map((id) => (
              <div key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(26,24,20,0.84)',
                border: '1px solid rgba(190,170,110,0.50)',
                borderRadius: 22,
                padding: '5px 16px 5px 12px',
                color: '#e5d9af',
                fontSize: 13,
                fontFamily: '"Microsoft YaHei", sans-serif',
                letterSpacing: '0.05em',
                boxShadow: '0 2px 10px rgba(0,0,0,0.60)',
                userSelect: 'none',
              }}>
                拾取【<span style={{ color: '#ffe060', fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>F</span>】
              </div>
            ))}
          </div>
        );
      })()}

      {/* ===== PICKUP: Channel progress bar ===== */}
      {channelPickupId && (
        <div style={{
          position: 'absolute', bottom: '38%', left: '50%',
          transform: 'translateX(-50%)',
          width: 220,
          background: 'rgba(0,20,10,0.9)',
          border: '1px solid #00ff80',
          borderRadius: 8,
          padding: '10px 16px',
          zIndex: 600,
          textAlign: 'center',
        }}>
          <div style={{ color: '#aaffcc', fontSize: 13, marginBottom: 6, fontFamily: '"Microsoft YaHei", sans-serif' }}>正在研读秘籍…</div>
          <div style={{ background: 'rgba(0,80,40,0.5)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, #00cc55, #00ff88)',
              width: `${channelProgress * 100}%`,
              transition: 'width 0.05s linear',
              boxShadow: '0 0 8px rgba(0,255,100,0.7)',
            }} />
          </div>
        </div>
      )}

      {/* ===== PICKUP: Ability panels — draggable, stacked with no gap ===== */}
      {pickupModals.length > 0 && (() => {
        // Layout constants
        const SLOT = 40, ITEM_GAP = 3, COLS = 6;
        const BODY_PAD = 8; // px padding each side of item area
        const bodyW   = COLS * SLOT + (COLS - 1) * ITEM_GAP + BODY_PAD * 2;
        const TITLE_H = 28;
        const BODY_H  = BODY_PAD * 2 + SLOT; // 8+40+8 = 56
        const PANEL_H = TITLE_H + BODY_H + 2; // +2 borders
        const panelBase = uiPositions['pickup-panel'] ?? { left: 200, top: 150 };

        return pickupModals.slice(0, 5).map((modal, idx) => {
          return (
            <div key={modal.pickupId} style={{
              position: 'absolute',
              left: panelBase.left,
              top: panelBase.top + idx * PANEL_H,
              background: 'rgba(34,44,42,0.97)',
              border: '1px solid rgba(90,130,110,0.60)',
              borderRadius: idx === 0 ? 4 : 0,
              borderTop: idx === 0 ? undefined : 'none',
              zIndex: 700 + idx,
              width: bodyW,
              boxShadow: idx === pickupModals.length - 1 ? '0 4px 20px rgba(0,0,0,0.80)' : 'none',
              fontFamily: '"Microsoft YaHei", sans-serif',
              userSelect: 'none',
            }}>
              {/* ── Title bar — drag handle ── */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0 8px',
                  background: 'rgba(55,75,68,0.90)',
                  borderBottom: '1px solid rgba(90,130,110,0.40)',
                  borderRadius: idx === 0 ? '3px 3px 0 0' : 0,
                  height: TITLE_H,
                  cursor: 'move',
                }}
                data-ui-drag="true"
                onMouseDown={(e) => startUIDrag('pickup-panel', { left: 200, top: 150 }, e)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cde5d8', fontSize: 13, fontWeight: 600 }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>目</span>
                  技能 (1)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* Navigator: fat cursor arrow in circle, rotated to point at book */}
                  {(() => {
                    const pu2 = pickupsRef.current.find(p => p.id === modal.pickupId);
                    const pp  = localPositionRef.current;
                    let deg2  = 0;
                    let dist2 = '';
                    if (pu2 && pp) {
                      const ddx = pu2.position.x - pp.x;
                      const ddy = pu2.position.y - pp.y;
                      const d   = worldUnitsToNewUnits(Math.sqrt(ddx * ddx + ddy * ddy), mode);
                      dist2 = d < 1 ? '<1' : `${Math.round(d)}`;
                      // 0° = right (+X). SVG arrow default points up (−90°), so subtract 90
                      deg2 = ((Math.atan2(ddy, ddx) * 180 / Math.PI) - 90 + 360) % 360;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
                          {/* Circle */}
                          <circle cx="10" cy="10" r="9" fill="none" stroke="#7ab898" strokeWidth="1.5" />
                          {/* Fat cursor arrow, rotated */}
                          <g transform={`rotate(${deg2}, 10, 10)`}>
                            <polygon
                              points="10,3 13.5,12 10,10.5 6.5,12"
                              fill="#a8dfbf"
                              stroke="rgba(0,0,0,0.5)"
                              strokeWidth="0.6"
                              strokeLinejoin="round"
                            />
                          </g>
                        </svg>
                        {dist2 && <span style={{ fontSize: 10, color: '#7ab898', minWidth: 14 }}>{dist2}</span>}
                      </div>
                    );
                  })()}
                  {/* Minimize button */}
                  <button
                    onClick={() => setMinimizedModals(prev => {
                      const next = new Set(prev);
                      if (next.has(modal.pickupId)) next.delete(modal.pickupId); else next.add(modal.pickupId);
                      return next;
                    })}
                    style={{ background: 'none', border: 'none', color: '#aaccbb', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  >{minimizedModals.has(modal.pickupId) ? '+' : '−'}</button>
                  {/* Close button */}
                  <button
                    onClick={() => setPickupModals(prev => prev.filter(m => m.pickupId !== modal.pickupId))}
                    style={{ background: 'none', border: 'none', color: '#aaccbb', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  >×</button>
                </div>
              </div>

              {/* ── Items: hidden when minimized ── */}
              {!minimizedModals.has(modal.pickupId) && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: ITEM_GAP,
                  padding: BODY_PAD,
                  background: 'rgba(26,36,34,0.95)',
                  borderRadius: '0 0 3px 3px',
                }}>
                <div
                  style={{
                    position: 'relative', width: SLOT, height: SLOT,
                    borderRadius: 4, overflow: 'hidden', cursor: 'pointer',
                    border: '1px solid rgba(80,200,120,0.55)',
                    boxShadow: '0 0 6px rgba(0,200,80,0.25)',
                    flexShrink: 0,
                  }}
                  onClick={() => claimPickup(modal.pickupId)}
                  title={modal.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getArenaAbilityIconPath(modal.name)}
                    alt={modal.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.20'; }}
                  />
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'rgba(0,0,0,0.68)',
                    color: '#dff5e8',
                    fontSize: 9,
                    textAlign: 'center',
                    lineHeight: '14px',
                    padding: '0 1px',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}>{modal.name.slice(0, 4)}</div>
                </div>
                </div>
              )}
            </div>
          );
        });
      })()}

      {/* ===== CONTROL PANEL: combat helpers + dummy spawn (bottom-right, left of cheat) ===== */}
      <button
        style={{
          position: 'absolute', bottom: 80, right: 290, zIndex: 210,
          background: showControlPanel ? '#3aa0ff' : 'rgba(20,20,30,0.92)',
          color: showControlPanel ? '#fff' : '#3aa0ff',
          border: '1px solid #3aa0ff', borderRadius: 4,
          padding: '5px 12px', fontSize: 12, cursor: 'pointer',
          fontWeight: 600, letterSpacing: '0.5px',
          boxShadow: showControlPanel ? '0 0 10px rgba(58,160,255,0.5)' : 'none',
        }}
        onClick={() => setShowControlPanel(v => !v)}
        title="测试用：战斗控制 + 木桩生成"
      >
        {showControlPanel ? '✕ 关闭控制面板' : '🛠 控制面板'}
      </button>
      {showControlPanel && (
        <div style={{
          position: 'absolute', top: 96, bottom: 118, right: 290, zIndex: 210,
          background: 'rgba(10,18,28,0.97)', border: '1px solid #3aa0ff',
          borderRadius: 6, padding: 8,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 220,
        }}>
          <div style={{ fontSize: 11, color: '#9ed5ff', fontWeight: 700 }}>战斗控制</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('full-heal', '/api/game/cheat/full-heal', '双方已恢复满血')}
              style={{
                background: 'rgba(40, 160, 80, 0.20)', color: '#b6ffcd',
                border: '1px solid rgba(80, 210, 120, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >双方满血</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('reset-cd', '/api/game/cheat/reset-cooldowns', '双方技能已重置冷却')}
              style={{
                background: 'rgba(40, 100, 190, 0.20)', color: '#bcd9ff',
                border: '1px solid rgba(90, 150, 255, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >重置CD</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('clear-buffs', '/api/game/cheat/clear-buffs', '双方增益减益已清空')}
              style={{
                background: 'rgba(170, 120, 30, 0.20)', color: '#ffe0a8',
                border: '1px solid rgba(255, 180, 80, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >清空Buff</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('discard-all', '/api/game/cheat/discard-all', '已清空当前技能栏')}
              style={{
                background: 'rgba(40, 110, 210, 0.24)', color: '#c6e8ff',
                border: '1px solid rgba(120, 190, 255, 0.70)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >清空技能</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('refill-consumables', '/api/game/cheat/refill-consumables', '双方消耗品已补满')}
              style={{
                background: 'rgba(140, 95, 220, 0.20)', color: '#e1d1ff',
                border: '1px solid rgba(182, 140, 255, 0.58)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >补满物品</button>
          </div>

          <div style={{ fontSize: 11, color: '#9ed5ff', fontWeight: 700, marginTop: 4 }}>木桩</div>
          {pendingDummySpawn && (
            (() => {
              const dummyMeta = getDummySpawnMeta(pendingDummySpawn);
              return (
                <div style={{
                  fontSize: 10, color: '#ffe07a', padding: '4px 6px',
                  border: '1px solid rgba(255, 200, 80, 0.55)', borderRadius: 4,
                  background: 'rgba(255, 200, 80, 0.10)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>点击地面放置{dummyMeta.label}</span>
                  <button
                    type="button"
                    onClick={() => setPendingDummySpawn(null)}
                    style={{
                      background: 'transparent', color: '#ffe07a',
                      border: '1px solid rgba(255, 200, 80, 0.55)', borderRadius: 3,
                      fontSize: 10, padding: '1px 6px', cursor: 'pointer',
                    }}
                  >取消</button>
                </div>
              );
            })()
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            <button
              type="button"
              onClick={() => setPendingDummySpawn(prev => prev === 'enemy' ? null : 'enemy')}
              style={{
                background: pendingDummySpawn === 'enemy' ? 'rgba(220, 60, 60, 0.45)' : 'rgba(190, 60, 60, 0.20)',
                color: '#ffc6c6',
                border: '1px solid rgba(255, 100, 100, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px', cursor: 'pointer',
              }}
            >敌方木桩</button>
            <button
              type="button"
              onClick={() => setPendingDummySpawn(prev => prev === 'ally' ? null : 'ally')}
              style={{
                background: pendingDummySpawn === 'ally' ? 'rgba(60, 180, 100, 0.45)' : 'rgba(60, 180, 100, 0.20)',
                color: '#c6ffd5',
                border: '1px solid rgba(100, 220, 130, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px', cursor: 'pointer',
              }}
            >友方木桩</button>
            <button
              type="button"
              onClick={() => setPendingDummySpawn(prev => prev === 'ally100' ? null : 'ally100')}
              style={{
                background: pendingDummySpawn === 'ally100' ? 'rgba(80, 170, 220, 0.45)' : 'rgba(80, 170, 220, 0.20)',
                color: '#d2f1ff',
                border: '1px solid rgba(120, 210, 255, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px', cursor: 'pointer',
              }}
            >友方100血木桩</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('restore-dummies', '/api/game/cheat/restore-dummies', '木桩已恢复满血')}
              style={{
                background: 'rgba(40, 160, 80, 0.20)', color: '#b6ffcd',
                border: '1px solid rgba(80, 210, 120, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >木桩满血</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('clear-dummy-debuffs', '/api/game/cheat/clear-dummy-debuffs', '木桩减益已清空')}
              style={{
                background: 'rgba(170, 120, 30, 0.20)', color: '#ffe0a8',
                border: '1px solid rgba(255, 180, 80, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >清木桩Buff</button>
            <button
              type="button"
              disabled={!!runningCheatAction}
              onClick={() => void runCheatAction('clear-dummies', '/api/game/cheat/clear-dummies', '已清除所有木桩')}
              style={{
                background: 'rgba(180, 60, 60, 0.20)', color: '#ffc0c0',
                border: '1px solid rgba(255, 100, 100, 0.55)', borderRadius: 4,
                fontSize: 11, padding: '6px 8px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}
            >清除木桩</button>
          </div>
        </div>
      )}

      {/* ===== CHEAT: Ability picker (bottom-right, toggleable) ===== */}
      <button
        style={{
          position: 'absolute', bottom: 80, right: 8, zIndex: 200,
          background: showCheatWindow ? '#ff6b00' : 'rgba(20,20,30,0.92)',
          color: showCheatWindow ? '#fff' : '#ff6b00',
          border: '1px solid #ff6b00', borderRadius: 4,
          padding: '5px 12px', fontSize: 12, cursor: 'pointer',
          fontWeight: 600, letterSpacing: '0.5px',
          boxShadow: showCheatWindow ? '0 0 10px rgba(255,107,0,0.5)' : 'none',
        }}
        onClick={() => setShowCheatWindow(v => !v)}
        title="测试用：直接添加技能"
      >
        {showCheatWindow ? '✕ 关闭技能面板' : '⚡ 添加技能'}
      </button>
      {showCheatWindow && (
        <div style={{
          position: 'absolute', top: 96, bottom: 118, right: 8, zIndex: 200,
          background: 'rgba(10,18,28,0.97)', border: '1px solid #ff6b00',
          borderRadius: 6, padding: 8,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 220,
        }}>
          {/* Rarity filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {['all', '稀世', '珍奇', '卓越', '精巧', 'unset'].map((f) => {
              const label = f === 'all' ? '全部' : f === 'unset' ? '未设' : f;
              const color = RARITY_COLOR[f as keyof typeof RARITY_COLOR];
              const isActive = cheatRarityFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setCheatRarityFilter(isActive && f !== 'all' ? 'all' : f)}
                  style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${color ?? '#888'}`,
                    color: isActive ? '#fff' : (color ?? '#888'),
                    background: isActive ? (color ?? '#888') : 'transparent',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >{label}</button>
              );
            })}
            <span style={{ fontSize: 10, color: '#888' }}>({filteredCheatAbilities.length})</span>
          </div>
          {/* School filter dropdown */}
          <div ref={cheatSchoolRef} style={{ position: 'relative', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#aaa' }}>Class：</span>
              <button
                type="button"
                onClick={() => setCheatSchoolOpen((o) => !o)}
                style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${cheatSchoolFilter === 'all' ? '#555' : cheatSchoolFilter === 'unset' ? '#888' : (SCHOOL_COLOR[cheatSchoolFilter] ?? '#888')}`,
                  color: cheatSchoolFilter === 'all' ? '#aaa' : '#111',
                  background: cheatSchoolFilter === 'all' ? 'transparent' : cheatSchoolFilter === 'unset' ? '#888' : (SCHOOL_COLOR[cheatSchoolFilter] ?? '#888'),
                  fontWeight: cheatSchoolFilter !== 'all' ? 700 : 400,
                  minWidth: 52,
                }}
              >
                {cheatSchoolFilter === 'all' ? '全部 ▼' : cheatSchoolFilter === 'unset' ? '未设 ▼' : `${cheatSchoolFilter} ▼`}
              </button>
            </div>
            {cheatSchoolOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 300,
                background: 'rgba(10,10,20,0.97)', border: '1px solid #555',
                borderRadius: 6, padding: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                width: 200,
              }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {['all','unset'].map((f) => (
                    <button key={f} type="button"
                      onClick={() => { setCheatSchoolFilter(f); setCheatSchoolOpen(false); }}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                        border: '1px solid #666', color: cheatSchoolFilter === f ? '#fff' : '#aaa',
                        background: cheatSchoolFilter === f ? '#666' : 'transparent', fontWeight: cheatSchoolFilter === f ? 700 : 400 }}
                    >{f === 'all' ? '全部' : '未设置'}</button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
                  {SCHOOL_TAGS_BA.map((s) => {
                    const c = SCHOOL_COLOR[s] ?? '#888';
                    const isActive = cheatSchoolFilter === s;
                    return (
                      <button key={s} type="button"
                        onClick={() => { setCheatSchoolFilter(isActive ? 'all' : s); setCheatSchoolOpen(false); }}
                        style={{ fontSize: 10, padding: '2px 2px', borderRadius: 3, cursor: 'pointer',
                          border: `1px solid ${c}`, color: isActive ? '#111' : c,
                          background: isActive ? c : 'transparent', fontWeight: isActive ? 700 : 400,
                          textAlign: 'center' }}
                      >{s}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 32px)', gap: 4, alignContent: 'start' }}>
            {filteredCheatAbilities.map((ability: any) => renderCheatIcon(ability))}
          </div>

        </div>
      )}

      {/* ===== BOTTOM: WASD / Joystick (mobile left) + centered hotbar ===== */}
      <div className={styles.bottomHud} style={isMobileDevice ? { justifyContent: 'center' } : undefined}>

        {/* Desktop WASD buttons */}
        {!isMobileDevice && (
          <div className={styles.wasdWrap}>
            <WASDButtons onDirectionChange={handleJoystickDirection} />
          </div>
        )}

        {renderOwnedAbilityBar()}

        {!isMobileDevice && <div className={styles.wasdSpacer} />}

      </div>{/* end bottomHud */}

      {activeAbilityHint && <AbilityHoverHint hint={activeAbilityHint} />}

      {/* ===== MOBILE FORWARD/BACK + JUMP BUTTONS — anchored to root container ===== */}
      {isMobileDevice && (
        <div style={{
          position: 'absolute',
          left: '67%',
          bottom: '45%',
          transform: 'translate(-50%, 50%)',
          zIndex: 500,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'auto',
        }}>
          {/* Forward button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); handleJoystickDirection({ w: true, a: false, s: false, d: false }); }}
            onTouchEnd={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            onTouchCancel={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'rgba(0,0,0,0.45)',
              border: '2px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, color: 'rgba(255,255,255,0.85)',
              touchAction: 'none', userSelect: 'none', flexShrink: 0,
            }}
          >↑</div>
          {/* Jump button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); handleJoystickJump(); }}
            style={{
              width: 60, height: 60, borderRadius: '50%',
              background: 'rgba(80,180,255,0.25)',
              border: '2px solid rgba(100,200,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: 'rgba(160,230,255,0.9)',
              touchAction: 'none', userSelect: 'none', flexShrink: 0,
            }}
          >跳</div>
          {/* Backward button */}
          <div
            onTouchStart={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: true, d: false }); }}
            onTouchEnd={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            onTouchCancel={(e) => { e.stopPropagation(); handleJoystickDirection({ w: false, a: false, s: false, d: false }); }}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'rgba(0,0,0,0.45)',
              border: '2px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, color: 'rgba(255,255,255,0.85)',
              touchAction: 'none', userSelect: 'none', flexShrink: 0,
            }}
          >↓</div>
        </div>
      )}

      {/* ===== SAFE ZONE TIMER / PROGRESS BAR ===== */}
      {safeZone && safeZone.nextChangeIn > 0 && (
        <div style={{
          position: 'absolute',
          left: '95%',
          top: '30%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          pointerEvents: 'none',
          zIndex: 500,
        }}>
          {/* Progress bar container */}
          <div style={{
            width: 120,
            height: 12,
            background: 'rgba(0,0,0,0.5)',
            borderRadius: 3,
            border: '1px solid rgba(255,255,255,0.2)',
            overflow: 'hidden',
          }}>
            {safeZone.shrinking && (
              <div style={{
                width: `${Math.min(100, safeZone.shrinkProgress * 100)}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #ff4444, #ff8800)',
                borderRadius: 3,
                transition: 'width 0.3s linear',
              }} />
            )}
          </div>
          {/* Timer text */}
          <div style={{
            color: safeZone.shrinking ? '#ff8800' : '#ffffff',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap',
          }}>
            {safeZone.shrinking
              ? `缩圈中 ${Math.ceil(safeZone.nextChangeIn)}s`
              : `风暴倒计时: ${Math.ceil(safeZone.nextChangeIn)}`}
          </div>
        </div>
      )}

      {/* ===== FLOATING DAMAGE / HEAL NUMBERS ===== */}
      {floats.map(entry => {
        const age      = (Date.now() - entry.startTime) / 1300; // 0→1 over 1.3s
        // quick fade-in (0→8%), hold (8→75%), fade-out (75→100%)
        const opacity  = age < 0.08 ? age / 0.08 : Math.max(0, 1 - Math.max(0, age - 0.75) / 0.25);
        const travelUp = -80 * age; // floats upward
        const color = entry.white
          ? '#ffffff'
          : entry.type === 'dmg_dealt'
          ? (entry.isCrit ? '#ffe600' : '#ffffff')
          : entry.type === 'heal'
          ? '#44ff66'
          : entry.type === 'huajie'
          ? '#ffd24a'
          : entry.type === 'xishou'
          ? '#66aaff'
          : '#ff2222';
        const pctX = entry.screenPct && Number.isFinite(entry.screenPct.x) ? entry.screenPct.x * 100 : undefined;
        const pctY = entry.screenPct && Number.isFinite(entry.screenPct.y) ? entry.screenPct.y * 100 : undefined;
        let posStyle: React.CSSProperties;
        if (entry.type === 'dmg_dealt' || entry.type === 'xishou') {
          // Float above enemy — fixed-size text in screen space (not distance-scaled)
          posStyle = {
            top: `calc(${pctY ?? 12}% + ${travelUp - entry.yOffset}px)`,
            left: `${pctX ?? 50}%`,
            transform: 'translateX(-50%)',
          };
        } else if (entry.type === 'dmg_taken') {
            posStyle = {
              top: `calc(${pctY ?? 65}% + ${travelUp - entry.yOffset}px)`,
              left: `${pctX ?? 40}%`,
              transform: 'translateX(-50%)',
            };
        } else {
            // heal + huajie both appear on the right side
            posStyle = {
              top: `calc(${pctY ?? 65}% + ${travelUp - entry.yOffset}px)`,
              left: `${pctX ?? 60}%`,
              transform: 'translateX(-50%)',
            };
        }
        const displayText = entry.text
          ? entry.text
          : entry.type === 'dmg_dealt'
          ? entry.label === ''
            ? `：${entry.isCrit ? '会心 ' : ''}${formatFloatValue(entry.value)}`
            : entry.label
            ? (entry.isCrit
                ? `${entry.label}：会心 ${formatFloatValue(entry.value)}`
                : `${entry.label}：${formatFloatValue(entry.value)}`)
            : (entry.isCrit ? `会心 ${formatFloatValue(entry.value)}` : formatFloatValue(entry.value))
          : entry.type === 'dmg_taken'
          ? entry.label === ''
            ? `： ${entry.isCrit ? '会心 ' : ''}-${formatFloatValue(entry.value)}`
            : entry.label
            ? `${entry.label}： ${entry.isCrit ? '会心 ' : ''}-${formatFloatValue(entry.value)}`
            : `${entry.isCrit ? '会心 ' : ''}-${formatFloatValue(entry.value)}`
          : entry.type === 'heal'
          ? entry.label
            ? `${entry.label}: ${entry.isCrit ? '会心 ' : ''}+${formatFloatValue(entry.value)}`
            : `${entry.isCrit ? '会心 ' : ''}+${formatFloatValue(entry.value)}`
          : entry.label
          ? `${entry.label}: -${formatFloatValue(entry.value)}`
          : `-${formatFloatValue(entry.value)}`;
        return (
          <div
            key={entry.id}
            className={`${styles.floatNumber} ${entry.type === 'dmg_dealt' ? styles.floatDealt : entry.type === 'heal' ? styles.floatHeal : entry.type === 'huajie' ? styles.floatHuajie : entry.type === 'xishou' ? styles.floatXishou : styles.floatTaken}`}
            style={{ ...posStyle, opacity, color }}
          >
            {displayText}
          </div>
        );
      })}
    </div>
  );
}
