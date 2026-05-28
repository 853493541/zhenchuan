'use client';

import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';
import VirtualJoystick from './VirtualJoystick';
import StatusBar from '../GameBoard/components/StatusBar';
import { ChannelBar, ChannelBarHost, type ChannelBarData } from './ChannelBar';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowUp, ArrowUpToLine, Check, ChevronDown, Clipboard, CornerDownLeft, Download, Eraser, Gamepad2, Image as ImageIcon, LayoutGrid, ListChecks, MessageCircle, Minus, Pencil, Plus, Puzzle, RotateCcw, Save, Search, Settings, Smile, Star, Swords, Trash2, UploadCloud, UserRound, Volume2, Wind, X } from 'lucide-react';
import { toastError, toastSuccess } from '@/app/components/toast/toast';
import type { ActiveBuff, ActiveChannel, ChatChannel, ChatMessage, PickupItem, GroundZone, TargetEntity, TargetSelection, PlayAreaBounds, SafeZone } from '../../types';
import ArenaScene, { type DirLightConfig, type EnvDebugInfo, type EnvToggles, type SceneRuntimeMetrics } from './scene/ArenaScene';
import { getMapForMode, type MapObject } from './worldMap';
import type { MapCollisionSystem } from './scene/MapCollisionSystem';
import { RENDER_SF_XZ, RENDER_SF_Y, GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z, type SceneLoadTimingEvent } from './scene/ExportedMapScene';
import { encodeIconPublicPath, getAbilityIconPath } from '@/app/lib/iconPaths';
import * as THREE from 'three';
import { ensureResizeObserverSupport } from '../../ensureResizeObserverSupport';
import { getAbilitySoundAudibleRange, getAbilitySoundCue, type AbilitySoundPhase } from './abilitySoundRegistry';
import { installAbilityAudioUnlock, playAbilitySound, stopAbilityChannelSound } from './abilitySoundPlayer';
import { formatCrashDiagnosticsReport, getClientCrashRecorder, type CrashRecorderSummary } from '@/app/game/diagnostics/clientCrashRecorder';
import { getClientLatencyRecorder } from '@/app/game/diagnostics/clientLatencyRecorder';
import { predictDashRenderPosition, shouldLogDashServerGap, type DashRenderSample } from './dashRenderPrediction';
import { isExportedMapMode, isYumen1v1BasicMode } from '../../../../gameModes';

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

function createMovementClientSession() {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  const id = typeof cryptoObj?.randomUUID === 'function'
    ? cryptoObj.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, startedAt: Date.now() };
}

type MovementDirectionPayload =
  | { dx: number; dy: number; jump: boolean; backpedalOnly?: boolean }
  | { up: boolean; down: boolean; left: boolean; right: boolean; jump: boolean }
  | null;

const MOVEMENT_ACTIVE_REFRESH_MS = 250;
const MOVEMENT_IDLE_REFRESH_MS = 1_000;
const MOVEMENT_SIGNATURE_PRECISION = 1_000;

function quantizeMovementValue(value: number) {
  return Math.round(value * MOVEMENT_SIGNATURE_PRECISION) / MOVEMENT_SIGNATURE_PRECISION;
}

function movementPayloadSignature(direction: MovementDirectionPayload, facing: { x: number; y: number }) {
  const normalizedDirection = direction
    ? ('dx' in direction || 'dy' in direction)
      ? {
          dx: quantizeMovementValue(direction.dx ?? 0),
          dy: quantizeMovementValue(direction.dy ?? 0),
          jump: direction.jump === true,
          backpedalOnly: direction.backpedalOnly === true,
        }
      : {
          up: direction.up === true,
          down: direction.down === true,
          left: direction.left === true,
          right: direction.right === true,
          jump: direction.jump === true,
        }
    : null;

  return JSON.stringify({
    direction: normalizedDirection,
    facing: {
      x: quantizeMovementValue(facing.x),
      y: quantizeMovementValue(facing.y),
    },
  });
}

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

const formatCrashDiagTime = (ts: number | null | undefined) => {
  if (!ts) return '-';
  const date = new Date(ts);
  const time = date.toLocaleTimeString('en-GB', { hour12: false });
  return `${time}.${String(ts % 1000).padStart(3, '0')}`;
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

type CameraSettings = {
  maxDistance: number;
  followMode: 'never';
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
  chat: ChatUiLayoutPayload | null;
};

const EMPTY_UI_POSITION_STORAGE_PAYLOAD: UiPositionStoragePayload = {
  positions: {},
  viewport: null,
  chat: null,
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
    chat: normalizeChatUiLayoutPayload(payload.chat),
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
const CAMERA_SETTINGS_STORAGE_KEY = 'zhenchuan-camera-settings-v1';
const ABILITY_PANEL_SCALE_STORAGE_KEY = 'zhenchuan-ability-panel-scale-v2';
const YUMEN_DAMAGE_MODE_STORAGE_KEY = 'zhenchuan-yumen-safe-zone-damage-mode-v1';
const YUMEN_AUTO_FULL_SHRINK_STORAGE_KEY = 'zhenchuan-yumen-auto-full-shrink-v1';
const YUMEN_SHOW_FUTURE_SAFE_ZONE_STORAGE_KEY = 'zhenchuan-yumen-show-future-safe-zone-v1';
const YUMEN_SAFE_ZONE_DISPLAY_MODE_STORAGE_KEY = 'zhenchuan-yumen-safe-zone-display-mode-v1';
const ABILITY_PANEL_MIN_SCALE = 0.85;
const ABILITY_PANEL_BASE_VISUAL_SCALE = 1.175;
const ABILITY_PANEL_MAX_VISUAL_SCALE = 2;
const MARTIAL_PRESET_PANEL_OPEN_STORAGE_KEY = 'zhenchuan-martial-preset-panel-open-v1';
const MARTIAL_FAVORITE_ORDER_STORAGE_KEY = 'zhenchuan-martial-favorite-order-v1';
const MARTIAL_PANEL_TAB_STORAGE_KEY = 'zhenchuan-martial-panel-tab-v1';
const MARTIAL_SETTING_MIN_SCALE = 0.1;
const MARTIAL_SETTING_MAX_SCALE = 2;
const MARTIAL_PANEL_BASE_WIDTH = 880;
const MARTIAL_PANEL_BASE_HEIGHT = 560;
const MARTIAL_PRESET_PANEL_BASE_WIDTH = 370;
const MARTIAL_PANEL_VIEWPORT_WIDTH_RATIO = 0.455;
const MARTIAL_PANEL_VIEWPORT_HEIGHT_RATIO = 0.514;
const MARTIAL_PRESET_PANEL_VIEWPORT_WIDTH_RATIO = 0.193;
const MARTIAL_PANEL_MIN_WIDTH = Math.round(MARTIAL_PANEL_BASE_WIDTH * MARTIAL_SETTING_MIN_SCALE);
const MARTIAL_PANEL_MAX_WIDTH = Math.round(MARTIAL_PANEL_BASE_WIDTH * MARTIAL_SETTING_MAX_SCALE);
const MARTIAL_PANEL_DEFAULT_WIDTH = MARTIAL_PANEL_BASE_WIDTH;
const MARTIAL_PANEL_MIN_HEIGHT = Math.round(MARTIAL_PANEL_BASE_HEIGHT * MARTIAL_SETTING_MIN_SCALE);
const MARTIAL_PANEL_MAX_HEIGHT = Math.round(MARTIAL_PANEL_BASE_HEIGHT * MARTIAL_SETTING_MAX_SCALE);
const MARTIAL_PANEL_DEFAULT_HEIGHT = MARTIAL_PANEL_BASE_HEIGHT;
const MARTIAL_PRESET_PANEL_MIN_WIDTH = Math.round(MARTIAL_PRESET_PANEL_BASE_WIDTH * MARTIAL_SETTING_MIN_SCALE);
const MARTIAL_PRESET_PANEL_MAX_WIDTH = Math.round(MARTIAL_PRESET_PANEL_BASE_WIDTH * MARTIAL_SETTING_MAX_SCALE);
const MARTIAL_PRESET_PANEL_DEFAULT_WIDTH = MARTIAL_PRESET_PANEL_BASE_WIDTH;
const MARTIAL_MODAL_BASE_WIDTH = 312;
const MARTIAL_MODAL_BASE_HEIGHT = 162;
const MARTIAL_MODAL_SETTING_MIN_SCALE = 0.1;
const MARTIAL_MODAL_SETTING_MAX_SCALE = 2;
const MARTIAL_MODAL_MIN_WIDTH = Math.round(MARTIAL_MODAL_BASE_WIDTH * MARTIAL_MODAL_SETTING_MIN_SCALE);
const MARTIAL_MODAL_MAX_WIDTH = Math.round(MARTIAL_MODAL_BASE_WIDTH * MARTIAL_MODAL_SETTING_MAX_SCALE);
const MARTIAL_MODAL_DEFAULT_WIDTH = MARTIAL_MODAL_BASE_WIDTH;
const MARTIAL_MODAL_MIN_HEIGHT = Math.round(MARTIAL_MODAL_BASE_HEIGHT * MARTIAL_MODAL_SETTING_MIN_SCALE);
const MARTIAL_MODAL_MAX_HEIGHT = Math.round(MARTIAL_MODAL_BASE_HEIGHT * MARTIAL_MODAL_SETTING_MAX_SCALE);
const MARTIAL_MODAL_DEFAULT_HEIGHT = MARTIAL_MODAL_BASE_HEIGHT;
const MARTIAL_PRESET_LIMIT = 8;
const MARTIAL_PRESET_VISIBLE_PLANS = 4;
const MARTIAL_VISIBLE_COLUMNS = 8;
const MARTIAL_VISIBLE_ROWS = 3;
const MARTIAL_COMPACT_COLUMNS = 6;
const MARTIAL_NARROW_COLUMNS = 4;
const IN_GAME_WARNING_SCALE_STORAGE_KEY = 'zhenchuan-ingame-warning-scale-v1';
const IN_GAME_WARNING_UI_KEY = 'in-game-warning';
const IN_GAME_WARNING_DURATION_MS = 1500;
const IN_GAME_WARNING_PREVIEW_TEXT = '无法施展该招式';
const REQUIRED_POWER_MISSING_WARNING = '经脉受损 无法运功';
const DASH_GROUND_TARGET_ABILITY_IDS = new Set(['lin_shi_fei_zhua', 'han_di', 'gu_feng_sa_ta']);
const JUMP_CORRECTION_WARNING_MIN_XY = 0.6;
const JUMP_CORRECTION_WARNING_MIN_Z = 0.6;
const JUMP_CORRECTION_WARNING_COOLDOWN_MS = 500;
const POSITION_CORRECTION_PROBE_MIN_XY = 0.75;
const POSITION_CORRECTION_PROBE_MIN_Z = 0.75;
const POSITION_CORRECTION_PROBE_COOLDOWN_MS = 500;
const JUMP_CORRECTION_SERVER_LAG_TICKS = 10;
const JUMP_CORRECTION_SERVER_LAG_MIN_XY = 1.1;
const JUMP_CORRECTION_SERVER_LAG_MIN_Z = 1.1;
const JUMP_CORRECTION_PENDING_PHASE_MS = 900;
const JUMP_CORRECTION_LANDING_GRACE_XY = 5.0;
const JUMP_CORRECTION_LANDING_GRACE_Z = 6.0;
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
const MARTIAL_PANEL_UI_KEY = 'martial-panel';
const CHAT_PANEL_UI_KEY = 'chat-panel';
const CHAT_CLEAR_DIALOG_UI_KEY = 'chat-clear-dialog';
const YUMEN_MINIMAP_UI_KEY = 'yumen-minimap';
const getDetachedChatWindowUiKey = (detachedId: string) => `chat-detached-${detachedId}`;
const isDetachedChatWindowUiKey = (key: string) => key.startsWith('chat-detached-');
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
  [MARTIAL_PANEL_UI_KEY]: { left: 24, top: 88 },
  [CHAT_PANEL_UI_KEY]: { left: 10, top: 667 },
  [CHAT_CLEAR_DIALOG_UI_KEY]: { left: 665, top: 114 },
};
const DRAFT_ABILITY_SLOT_COUNT = 6;
const ITEM_BAR_SLOT_COUNT = 14;
const CONSUMABLE_BAR_STORAGE_KEY = 'zhenchuan-consumable-bar-settings-v1';
const HOTKEY_SETTINGS_STORAGE_KEY = 'zhenchuan-hotkey-settings-v1';
const HOTKEY_SETTINGS_VERSION = 1;
const HOTKEY_MAX_BINDINGS_PER_ACTION = 2;
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
const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  maxDistance: 24,
  followMode: 'never',
  version: 2,
};
type ChatSettings = {
  fontFamily: 'simhei';
  fontSize: number;
  backgroundOpacity: number;
};
type ChatPanelSize = {
  width: number;
  height: number;
};
type ChatSettingsModalSize = {
  width: number;
  height: number;
};
type ChatSettingsMainTab = 'page' | 'window';
type ChatWindowConfig = {
  id: string;
  name: string;
  channels: ChatChannel[];
  hidden?: boolean;
  lockedName?: boolean;
  lockedDelete?: boolean;
};
type ChatClearDialogLayout = {
  width: number;
  height: number;
};
type DetachedChatWindow = {
  id: string;
  windowIds: string[];
  activeWindowId: string;
};
type ChatSearchState = {
  open: boolean;
  query: string;
};
type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};
type ChatUiLayoutPayload = {
  panelSize: ChatPanelSize;
  settings?: ChatSettings;
  settingsModalSize?: ChatSettingsModalSize;
  windows?: ChatWindowConfig[];
  activeWindowId?: string;
  detachedWindows?: DetachedChatWindow[];
  detachedPanelSizes?: Record<string, ChatPanelSize>;
};
const CHAT_SETTINGS_STORAGE_KEY = 'zhenchuan-chat-settings-v1';
const CHAT_SETTINGS_MODAL_SIZE_STORAGE_KEY = 'zhenchuan-chat-settings-modal-size-v1';
const CHAT_WINDOWS_STORAGE_KEY = 'zhenchuan-chat-windows-v1';
const CHAT_ACTIVE_WINDOW_STORAGE_KEY = 'zhenchuan-chat-active-window-v1';
const CHAT_CLEAR_DIALOG_LAYOUT_STORAGE_KEY = 'zhenchuan-chat-clear-dialog-layout-v1';
const CHAT_FONT_OPTIONS = [
  { id: 'simhei' as const, label: '黑体', css: 'SimHei, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif' },
];
const CHAT_FONT_SIZE_OPTIONS = [15, 16, 17, 18, 19, 20];
const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  fontFamily: 'simhei',
  fontSize: 18,
  backgroundOpacity: 50,
};
const CHAT_PANEL_DEFAULT_WIDTH = 548;
const CHAT_PANEL_DEFAULT_HEIGHT = 236;
const CHAT_MAX_INPUT_LENGTH = 180;
const CHAT_SETTINGS_MODAL_BASE_WIDTH = 705;
const CHAT_SETTINGS_MODAL_BASE_HEIGHT = 495;
const CHAT_SETTINGS_MODAL_SETTING_MIN_SCALE = 0.5;
const CHAT_SETTINGS_MODAL_SETTING_MAX_SCALE = 2;
const CHAT_SETTINGS_MODAL_MIN_WIDTH = Math.round(CHAT_SETTINGS_MODAL_BASE_WIDTH * CHAT_SETTINGS_MODAL_SETTING_MIN_SCALE);
const CHAT_SETTINGS_MODAL_MAX_WIDTH = Math.round(CHAT_SETTINGS_MODAL_BASE_WIDTH * CHAT_SETTINGS_MODAL_SETTING_MAX_SCALE);
const CHAT_SETTINGS_MODAL_MIN_HEIGHT = Math.round(CHAT_SETTINGS_MODAL_BASE_HEIGHT * CHAT_SETTINGS_MODAL_SETTING_MIN_SCALE);
const CHAT_SETTINGS_MODAL_MAX_HEIGHT = Math.round(CHAT_SETTINGS_MODAL_BASE_HEIGHT * CHAT_SETTINGS_MODAL_SETTING_MAX_SCALE);
const DEFAULT_CHAT_SETTINGS_MODAL_SIZE: ChatSettingsModalSize = {
  width: CHAT_SETTINGS_MODAL_BASE_WIDTH,
  height: CHAT_SETTINGS_MODAL_BASE_HEIGHT,
};
const CHAT_CLEAR_DIALOG_LEGACY_BASE_WIDTH = 590;
const CHAT_CLEAR_DIALOG_LEGACY_BASE_HEIGHT = 206;
const CHAT_CLEAR_DIALOG_BASE_WIDTH = Math.round(CHAT_CLEAR_DIALOG_LEGACY_BASE_WIDTH * 0.3);
const CHAT_CLEAR_DIALOG_BASE_HEIGHT = Math.round(CHAT_CLEAR_DIALOG_LEGACY_BASE_HEIGHT * 0.3);
const CHAT_CLEAR_DIALOG_DEFAULT_WIDTH_SCALE = 1.3;
const CHAT_CLEAR_DIALOG_DEFAULT_HEIGHT_SCALE = 2;
const CHAT_CLEAR_DIALOG_SETTING_MIN_SCALE = 0.1;
const CHAT_CLEAR_DIALOG_SETTING_MAX_SCALE = 2;
const CHAT_CLEAR_DIALOG_MIN_WIDTH = Math.round(CHAT_CLEAR_DIALOG_BASE_WIDTH * CHAT_CLEAR_DIALOG_SETTING_MIN_SCALE);
const CHAT_CLEAR_DIALOG_MAX_WIDTH = Math.round(CHAT_CLEAR_DIALOG_BASE_WIDTH * CHAT_CLEAR_DIALOG_SETTING_MAX_SCALE);
const CHAT_CLEAR_DIALOG_MIN_HEIGHT = Math.round(CHAT_CLEAR_DIALOG_BASE_HEIGHT * CHAT_CLEAR_DIALOG_SETTING_MIN_SCALE);
const CHAT_CLEAR_DIALOG_MAX_HEIGHT = Math.round(CHAT_CLEAR_DIALOG_BASE_HEIGHT * CHAT_CLEAR_DIALOG_SETTING_MAX_SCALE);
const DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT: ChatClearDialogLayout = {
  width: Math.round(CHAT_CLEAR_DIALOG_BASE_WIDTH * CHAT_CLEAR_DIALOG_DEFAULT_WIDTH_SCALE),
  height: Math.round(CHAT_CLEAR_DIALOG_BASE_HEIGHT * CHAT_CLEAR_DIALOG_DEFAULT_HEIGHT_SCALE),
};
const EMPTY_CHAT_SEARCH_STATE: ChatSearchState = { open: false, query: '' };
const EMPTY_CHAT_SCROLL_METRICS: ChatScrollMetrics = { scrollTop: 0, scrollHeight: 1, clientHeight: 1 };
const CHAT_CHANNEL_LABELS: Record<ChatChannel, string> = {
  map: '地图',
  system: '系统',
  battle: '战斗',
};
const CHAT_CHANNEL_COLORS: Record<ChatChannel, string> = {
  map: '#ff7f86',
  system: '#ffff00',
  battle: '#f4f4f1',
};
const DEFAULT_CHAT_WINDOWS: ChatWindowConfig[] = [
  { id: 'combined', name: '综合', channels: ['map', 'system'], lockedName: true, lockedDelete: true },
  { id: 'map', name: '地图', channels: ['map'], lockedDelete: false },
  { id: 'system', name: '系统', channels: ['system'], lockedDelete: false },
  { id: 'battle', name: '战斗', channels: ['battle'], lockedDelete: false },
];
const CHAT_WINDOW_CHANNEL_OPTIONS: Array<{ id: ChatChannel; label: string; disabled?: boolean }> = [
  { id: 'map', label: '地图频道' },
  { id: 'system', label: '系统频道' },
  { id: 'battle', label: '战斗频道' },
];

function normalizeChatFontSize(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CHAT_SETTINGS.fontSize;
  return Math.round(Math.max(15, Math.min(20, numeric)));
}

function normalizeChatOpacity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CHAT_SETTINGS.backgroundOpacity;
  return Math.round(Math.max(0, Math.min(100, numeric)));
}

function normalizeChatSettings(value: unknown): ChatSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<ChatSettings> : {};
  return {
    fontFamily: 'simhei',
    fontSize: normalizeChatFontSize(candidate.fontSize),
    backgroundOpacity: normalizeChatOpacity(candidate.backgroundOpacity),
  };
}

function loadChatSettings(): ChatSettings {
  try {
    if (typeof window === 'undefined') return DEFAULT_CHAT_SETTINGS;
    return normalizeChatSettings(JSON.parse(localStorage.getItem(CHAT_SETTINGS_STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

function normalizeChatSettingsModalWidth(value: unknown): number {
  return normalizeNumberInRange(value, DEFAULT_CHAT_SETTINGS_MODAL_SIZE.width, CHAT_SETTINGS_MODAL_MIN_WIDTH, CHAT_SETTINGS_MODAL_MAX_WIDTH);
}

function normalizeChatSettingsModalHeight(value: unknown): number {
  return normalizeNumberInRange(value, DEFAULT_CHAT_SETTINGS_MODAL_SIZE.height, CHAT_SETTINGS_MODAL_MIN_HEIGHT, CHAT_SETTINGS_MODAL_MAX_HEIGHT);
}

function normalizeChatSettingsModalSize(value: unknown): ChatSettingsModalSize {
  const candidate = value && typeof value === 'object' ? value as Partial<ChatSettingsModalSize> : {};
  return {
    width: normalizeChatSettingsModalWidth(candidate.width),
    height: normalizeChatSettingsModalHeight(candidate.height),
  };
}

function loadChatSettingsModalSize(): ChatSettingsModalSize {
  try {
    if (typeof window === 'undefined') return DEFAULT_CHAT_SETTINGS_MODAL_SIZE;
    return normalizeChatSettingsModalSize(JSON.parse(localStorage.getItem(CHAT_SETTINGS_MODAL_SIZE_STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_CHAT_SETTINGS_MODAL_SIZE;
  }
}

function normalizeChatPanelWidth(value: unknown): number {
  return normalizeNumberInRange(value, CHAT_PANEL_DEFAULT_WIDTH, 120, 1400);
}

function normalizeChatPanelHeight(value: unknown): number {
  return normalizeNumberInRange(value, CHAT_PANEL_DEFAULT_HEIGHT, 92, 1000);
}

function normalizeChatPanelSize(value: unknown): ChatPanelSize {
  const candidate = value && typeof value === 'object' ? value as Partial<ChatPanelSize> : {};
  return {
    width: normalizeChatPanelWidth(candidate.width),
    height: normalizeChatPanelHeight(candidate.height),
  };
}

function normalizeChatSettingsModalScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(CHAT_SETTINGS_MODAL_SETTING_MIN_SCALE, Math.min(CHAT_SETTINGS_MODAL_SETTING_MAX_SCALE, numeric)) * 10) / 10;
}

function getChatSettingsModalScale(value: number, base: number): number {
  return normalizeChatSettingsModalScale(value / base);
}

function scaleChatSettingsModalValue(scale: unknown, base: number, normalize: (value: unknown) => number): number {
  return normalize(base * normalizeChatSettingsModalScale(scale));
}

function normalizeChatWindowName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? Array.from(value.trim()).slice(0, 8).join('') : '';
  return text || fallback;
}

function normalizeChatWindows(value: unknown): ChatWindowConfig[] {
  const source = Array.isArray(value) ? value : [];
  const defaultsById = new Map(DEFAULT_CHAT_WINDOWS.map((entry) => [entry.id, entry]));
  const usedIds = new Set<string>();
  const next: ChatWindowConfig[] = [];

  for (const defaultWindow of DEFAULT_CHAT_WINDOWS) {
    const saved = source.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as any).id === defaultWindow.id) as Partial<ChatWindowConfig> | undefined;
    const savedChannels = Array.isArray(saved?.channels)
      ? saved.channels.filter((channel): channel is ChatChannel => channel === 'map' || channel === 'system' || channel === 'battle')
      : null;
    const channels = defaultWindow.id === 'battle' && (!savedChannels || savedChannels.length === 0)
      ? defaultWindow.channels
      : savedChannels ?? defaultWindow.channels;
    next.push({
      ...defaultWindow,
      name: defaultWindow.lockedName ? defaultWindow.name : normalizeChatWindowName(saved?.name, defaultWindow.name),
      channels: [...new Set(channels)],
      hidden: defaultWindow.id === 'combined' ? undefined : saved?.hidden === true || undefined,
    });
    usedIds.add(defaultWindow.id);
  }

  for (const entry of source) {
    const candidate = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Partial<ChatWindowConfig> : null;
    const rawId = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    if (!rawId || usedIds.has(rawId) || defaultsById.has(rawId)) continue;
    const channels = Array.isArray(candidate?.channels)
      ? candidate.channels.filter((channel): channel is ChatChannel => channel === 'map' || channel === 'system' || channel === 'battle')
      : [];
    next.push({
      id: rawId.slice(0, 48),
      name: normalizeChatWindowName(candidate?.name, `窗口${next.length + 1}`),
      channels: [...new Set(channels)],
      hidden: candidate?.hidden === true || undefined,
    });
    usedIds.add(rawId);
  }

  return next.slice(0, 8);
}

function loadChatWindows(): ChatWindowConfig[] {
  try {
    if (typeof window === 'undefined') return DEFAULT_CHAT_WINDOWS;
    return normalizeChatWindows(JSON.parse(localStorage.getItem(CHAT_WINDOWS_STORAGE_KEY) ?? '[]'));
  } catch {
    return DEFAULT_CHAT_WINDOWS;
  }
}

function loadActiveChatWindowId(windows: ChatWindowConfig[]): string {
  try {
    if (typeof window === 'undefined') return windows[0]?.id ?? 'combined';
    const saved = localStorage.getItem(CHAT_ACTIVE_WINDOW_STORAGE_KEY);
    return windows.some((entry) => entry.id === saved) ? saved! : windows[0]?.id ?? 'combined';
  } catch {
    return windows[0]?.id ?? 'combined';
  }
}

function normalizeChatClearDialogHeight(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric > CHAT_CLEAR_DIALOG_MAX_HEIGHT) return DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT.height;
  return normalizeNumberInRange(numeric, DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT.height, CHAT_CLEAR_DIALOG_MIN_HEIGHT, CHAT_CLEAR_DIALOG_MAX_HEIGHT);
}

function normalizeChatClearDialogWidth(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric > CHAT_CLEAR_DIALOG_MAX_WIDTH) return DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT.width;
  return normalizeNumberInRange(numeric, DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT.width, CHAT_CLEAR_DIALOG_MIN_WIDTH, CHAT_CLEAR_DIALOG_MAX_WIDTH);
}

function normalizeChatClearDialogLayout(value: unknown): ChatClearDialogLayout {
  const candidate = value && typeof value === 'object' ? value as Partial<ChatClearDialogLayout> : {};
  const width = normalizeChatClearDialogWidth(candidate.width);
  const height = normalizeChatClearDialogHeight(candidate.height);
  if (width === CHAT_CLEAR_DIALOG_BASE_WIDTH && height === CHAT_CLEAR_DIALOG_BASE_HEIGHT) {
    return DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT;
  }
  return {
    width,
    height,
  };
}

function loadChatClearDialogLayout(): ChatClearDialogLayout {
  try {
    if (typeof window === 'undefined') return DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT;
    return normalizeChatClearDialogLayout(JSON.parse(localStorage.getItem(CHAT_CLEAR_DIALOG_LAYOUT_STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_CHAT_CLEAR_DIALOG_LAYOUT;
  }
}

function normalizeChatClearDialogScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(CHAT_CLEAR_DIALOG_SETTING_MIN_SCALE, Math.min(CHAT_CLEAR_DIALOG_SETTING_MAX_SCALE, numeric)) * 10) / 10;
}

function getChatClearDialogScale(value: number, base: number): number {
  return normalizeChatClearDialogScale(value / base);
}

function scaleChatClearDialogValue(scale: unknown, base: number, normalize: (value: unknown) => number): number {
  return normalize(base * normalizeChatClearDialogScale(scale));
}

function normalizeDetachedChatWindows(value: unknown, windows: ChatWindowConfig[]): DetachedChatWindow[] {
  if (!Array.isArray(value)) return [];
  const windowIds = new Set(windows.map((entry) => entry.id));
  const seen = new Set<string>();
  const next: DetachedChatWindow[] = [];
  for (const entry of value) {
    const candidate = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Partial<DetachedChatWindow> : null;
    const id = typeof candidate?.id === 'string' ? candidate.id.trim().slice(0, 64) : '';
    const sourceIds = Array.isArray(candidate?.windowIds)
      ? candidate.windowIds
      : typeof (candidate as any)?.windowId === 'string'
      ? [(candidate as any).windowId]
      : [];
    const normalizedIds = sourceIds
      .filter((windowId): windowId is string => typeof windowId === 'string')
      .map((windowId) => windowId.trim().slice(0, 48))
      .filter((windowId) => windowId !== 'combined' && windowIds.has(windowId) && !seen.has(windowId));
    if (!id || seen.has(id) || normalizedIds.length === 0) continue;
    normalizedIds.forEach((windowId) => seen.add(windowId));
    const rawActiveWindowId = typeof candidate?.activeWindowId === 'string' ? candidate.activeWindowId.trim() : '';
    const activeWindowId = normalizedIds.includes(rawActiveWindowId) ? rawActiveWindowId : normalizedIds[0];
    seen.add(id);
    next.push({ id, windowIds: normalizedIds, activeWindowId });
    if (next.length >= 6) break;
  }
  return next;
}

function normalizeChatUiLayoutPayload(value: unknown): ChatUiLayoutPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const payload: ChatUiLayoutPayload = {
    panelSize: normalizeChatPanelSize(candidate.panelSize),
  };
  if ('settings' in candidate) {
    payload.settings = normalizeChatSettings(candidate.settings);
  }
  if ('settingsModalSize' in candidate) {
    payload.settingsModalSize = normalizeChatSettingsModalSize(candidate.settingsModalSize);
  }
  if ('windows' in candidate) {
    const windows = normalizeChatWindows(candidate.windows);
    payload.windows = windows;
    if (typeof candidate.activeWindowId === 'string') {
      payload.activeWindowId = normalizeActiveChatWindowId(candidate.activeWindowId, windows);
    }
    if ('detachedWindows' in candidate) {
      payload.detachedWindows = normalizeDetachedChatWindows(candidate.detachedWindows, windows);
    }
    if ('detachedPanelSizes' in candidate && candidate.detachedPanelSizes && typeof candidate.detachedPanelSizes === 'object' && !Array.isArray(candidate.detachedPanelSizes)) {
      const detachedIds = new Set((payload.detachedWindows ?? []).map((entry) => entry.id));
      const sizes: Record<string, ChatPanelSize> = {};
      for (const [id, size] of Object.entries(candidate.detachedPanelSizes as Record<string, unknown>)) {
        if (detachedIds.has(id)) {
          sizes[id] = normalizeChatPanelSize(size);
        }
      }
      payload.detachedPanelSizes = sizes;
    }
  }
  return payload;
}

function normalizeActiveChatWindowId(value: string, windows: ChatWindowConfig[]): string {
  return windows.some((entry) => entry.id === value) ? value : windows[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id;
}

function formatChatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
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
const CAMERA_BASE_DISTANCE = 24;
const CAMERA_DISTANCE_MIN = 8;
const CAMERA_DISTANCE_MAX = 24;
const DEFAULT_CAMERA_ZOOM = DEFAULT_CAMERA_SETTINGS.maxDistance / CAMERA_BASE_DISTANCE;
const CAMERA_ZOOM_MIN = CAMERA_DISTANCE_MIN / CAMERA_BASE_DISTANCE;
const DEFAULT_PLAYER_RADIUS = 2; // must match backend
const COLLISION_TEST_PLAYER_RADIUS = 0.384;
const LEGACY_STORED_UNIT_SCALE = 2.2;
const SERVER_TICK_RATE = 30;
const COOLDOWN_IDLE_CLOCK_INTERVAL_MS = 250;
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
  return isExportedMapMode(mode) ? 1 : LEGACY_STORED_UNIT_SCALE;
}

function clampPositionToPlayAreaClient(
  worldX: number,
  worldY: number,
  playArea: PlayAreaBounds | undefined,
  arenaWidth: number,
  arenaHeight: number,
  playerRadius: number,
  velocity?: { x: number; y: number },
) {
  const rawMinX = Math.max(0, Math.min(arenaWidth, Number(playArea?.minX ?? 0)));
  const rawMaxX = Math.max(0, Math.min(arenaWidth, Number(playArea?.maxX ?? arenaWidth)));
  const rawMinY = Math.max(0, Math.min(arenaHeight, Number(playArea?.minY ?? 0)));
  const rawMaxY = Math.max(0, Math.min(arenaHeight, Number(playArea?.maxY ?? arenaHeight)));
  const left = Math.min(rawMinX, rawMaxX);
  const right = Math.max(rawMinX, rawMaxX);
  const top = Math.min(rawMinY, rawMaxY);
  const bottom = Math.max(rawMinY, rawMaxY);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const minX = right - left <= playerRadius * 2 ? centerX : left + playerRadius;
  const maxX = right - left <= playerRadius * 2 ? centerX : right - playerRadius;
  const minY = bottom - top <= playerRadius * 2 ? centerY : top + playerRadius;
  const maxY = bottom - top <= playerRadius * 2 ? centerY : bottom - playerRadius;
  let nextX = worldX;
  let nextY = worldY;
  if (nextX < minX) {
    nextX = minX;
    if (velocity && velocity.x < 0) velocity.x = 0;
  }
  if (nextX > maxX) {
    nextX = maxX;
    if (velocity && velocity.x > 0) velocity.x = 0;
  }
  if (nextY < minY) {
    nextY = minY;
    if (velocity && velocity.y < 0) velocity.y = 0;
  }
  if (nextY > maxY) {
    nextY = maxY;
    if (velocity && velocity.y > 0) velocity.y = 0;
  }
  return { x: nextX, y: nextY };
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
  return Math.round(Math.max(ABILITY_PANEL_MIN_SCALE, Math.min(2, numeric)) * 100) / 100;
}

function normalizeNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.max(min, Math.min(max, numeric)));
}

function normalizeMartialPanelWidth(value: unknown): number {
  return normalizeNumberInRange(value, MARTIAL_PANEL_DEFAULT_WIDTH, MARTIAL_PANEL_MIN_WIDTH, MARTIAL_PANEL_MAX_WIDTH);
}

function normalizeMartialPanelHeight(value: unknown): number {
  return normalizeNumberInRange(value, MARTIAL_PANEL_DEFAULT_HEIGHT, MARTIAL_PANEL_MIN_HEIGHT, MARTIAL_PANEL_MAX_HEIGHT);
}

function normalizeMartialPresetPanelWidth(value: unknown): number {
  return normalizeNumberInRange(value, MARTIAL_PRESET_PANEL_DEFAULT_WIDTH, MARTIAL_PRESET_PANEL_MIN_WIDTH, MARTIAL_PRESET_PANEL_MAX_WIDTH);
}

function normalizeMartialModalWidth(value: unknown): number {
  return normalizeNumberInRange(value, MARTIAL_MODAL_DEFAULT_WIDTH, MARTIAL_MODAL_MIN_WIDTH, MARTIAL_MODAL_MAX_WIDTH);
}

function normalizeMartialModalHeight(value: unknown): number {
  return normalizeNumberInRange(value, MARTIAL_MODAL_DEFAULT_HEIGHT, MARTIAL_MODAL_MIN_HEIGHT, MARTIAL_MODAL_MAX_HEIGHT);
}

function normalizeMartialSettingScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(MARTIAL_SETTING_MIN_SCALE, Math.min(MARTIAL_SETTING_MAX_SCALE, numeric)) * 10) / 10;
}

function getMartialSettingScale(value: number, base: number): number {
  return normalizeMartialSettingScale(value / base);
}

type MartialPanelDimensions = {
  panelWidth: number;
  panelHeight: number;
  presetPanelWidth: number;
  presetPanelGap: number;
  bundleWidth: number;
  panelResponsiveScale: number;
};

type MartialResponsiveLayout = {
  abilityColumns: number;
  abilityVisibleRows: number;
  abilityIconSize: number;
  abilityCellWidth: number;
  abilityRowHeight: number;
  abilityColumnGap: number;
  abilityRowGap: number;
  abilityPaddingX: number;
  abilityPaddingY: number;
  abilityNameFontSize: number;
  abilityItemGap: number;
  headerHeight: number;
  tabsHeight: number;
  filtersHeight: number;
  filterHeight: number;
  filterGap: number;
  filterPaddingX: number;
  filterFontSize: number;
  searchWidth: number;
  schoolFilterWidth: number;
  rarityFilterWidth: number;
  toggleWidth: number;
  favoriteWidth: number;
  footerHeight: number;
  footerFontSize: number;
  footerButtonHeight: number;
  footerButtonPaddingX: number;
  activePanelHeight: number;
  activeBuffFlex: string;
  activeLearnedFlex: string;
  activeTabWidth: number;
  activeIconSize: number;
  activeSlotWidth: number;
  activeSlotHeight: number;
  activeGap: number;
  activeBuffGap: number;
  activePaddingX: number;
  activeBuffPaddingX: number;
  activePaddingY: number;
  activeNameFontSize: number;
  activeEmptyFontSize: number;
  presetVisiblePlans: number;
  presetHeaderHeight: number;
  presetTitleFontSize: number;
  presetIconButtonSize: number;
  presetListPaddingTop: number;
  presetListPaddingRight: number;
  presetListPaddingBottom: number;
  presetListPaddingLeft: number;
  presetListGap: number;
  presetCardPaddingX: number;
  presetCardPaddingY: number;
  presetCardGap: number;
  presetCardHeaderFontSize: number;
  presetSlotWidth: number;
  presetSlotHeight: number;
  presetSlotGap: number;
  presetIconSize: number;
  presetNameFontSize: number;
  presetEnableWidth: number;
  presetEnableHeight: number;
  presetTopButtonSize: number;
};

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computeMartialPanelDimensions({
  viewportWidth,
  viewportHeight,
  martialPanelWidth,
  martialPanelHeight,
  martialPresetPanelWidth,
  showMartialPresetPanel,
  isJujingTab,
  preview,
}: {
  viewportWidth: number;
  viewportHeight: number;
  martialPanelWidth: number;
  martialPanelHeight: number;
  martialPresetPanelWidth: number;
  showMartialPresetPanel: boolean;
  isJujingTab: boolean;
  preview: boolean;
}): MartialPanelDimensions {
  const panelWidthScale = getMartialSettingScale(martialPanelWidth, MARTIAL_PANEL_BASE_WIDTH);
  const panelHeightScale = getMartialSettingScale(martialPanelHeight, MARTIAL_PANEL_BASE_HEIGHT);
  const presetPanelWidthScale = getMartialSettingScale(martialPresetPanelWidth, MARTIAL_PRESET_PANEL_BASE_WIDTH);
  const maxBundleWidth = Math.max(240, viewportWidth - 24);
  const maxPanelHeight = Math.max(160, viewportHeight - 48);
  let panelWidth = Math.round(viewportWidth * MARTIAL_PANEL_VIEWPORT_WIDTH_RATIO * panelWidthScale);
  let panelHeight = Math.round(viewportHeight * MARTIAL_PANEL_VIEWPORT_HEIGHT_RATIO * panelHeightScale);
  let presetPanelWidth = showMartialPresetPanel && !preview && isJujingTab
    ? Math.round(viewportWidth * MARTIAL_PRESET_PANEL_VIEWPORT_WIDTH_RATIO * presetPanelWidthScale)
    : 0;
  const desiredBundleWidth = panelWidth + presetPanelWidth + (presetPanelWidth > 0 ? 2 : 0);
  if (desiredBundleWidth > maxBundleWidth) {
    const shrinkRatio = maxBundleWidth / desiredBundleWidth;
    panelWidth = Math.max(220, Math.round(panelWidth * shrinkRatio));
    presetPanelWidth = presetPanelWidth > 0 ? Math.max(120, Math.round(presetPanelWidth * shrinkRatio)) : 0;
  }
  panelHeight = Math.max(160, Math.min(maxPanelHeight, panelHeight));
  const presetPanelGap = presetPanelWidth > 0 ? 2 : 0;
  const bundleWidth = panelWidth + presetPanelWidth + presetPanelGap;
  const panelResponsiveScale = Math.max(0.58, Math.min(1, panelWidth / MARTIAL_PANEL_BASE_WIDTH, panelHeight / MARTIAL_PANEL_BASE_HEIGHT));
  return { panelWidth, panelHeight, presetPanelWidth, presetPanelGap, bundleWidth, panelResponsiveScale };
}

function pickMartialAbilityColumns(panelWidth: number): number {
  if (panelWidth < 430) return MARTIAL_NARROW_COLUMNS;
  if (panelWidth < 560) return MARTIAL_COMPACT_COLUMNS;
  return MARTIAL_VISIBLE_COLUMNS;
}

function pickVisibleCount(availableHeight: number, maxCount: number, minItemHeight: number, gap: number): number {
  for (let count = maxCount; count > 1; count -= 1) {
    if (availableHeight >= (count * minItemHeight) + ((count - 1) * gap)) return count;
  }
  return 1;
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

function computeMartialResponsiveLayout(dimensions: MartialPanelDimensions): MartialResponsiveLayout {
  const { panelWidth, panelHeight, presetPanelWidth } = dimensions;
  const widthRatio = clampRatio((panelWidth - 420) / (MARTIAL_PANEL_BASE_WIDTH - 420));
  const heightRatio = clampRatio((panelHeight - 320) / (MARTIAL_PANEL_BASE_HEIGHT - 320));
  const compactRatio = Math.min(widthRatio, heightRatio);

  const headerHeight = Math.round(28 + 4 * heightRatio);
  const tabsHeight = Math.round(32 + 6 * heightRatio);
  const filtersHeight = Math.round(35 + 9 * heightRatio);
  const footerHeight = Math.round(31 + 7 * heightRatio);
  const activePanelHeight = Math.round(66 + 26 * heightRatio);
  const availableAbilityHeight = Math.max(44, panelHeight - headerHeight - tabsHeight - filtersHeight - footerHeight - activePanelHeight);

  let abilityColumns = pickMartialAbilityColumns(panelWidth);
  const minAbilityIconSize = 32;
  const minAbilityColumnGap = 4;
  const minAbilityPaddingX = 8;
  while (abilityColumns > MARTIAL_NARROW_COLUMNS) {
    const minimumGridWidth = (abilityColumns * minAbilityIconSize) + ((abilityColumns - 1) * minAbilityColumnGap) + (minAbilityPaddingX * 2) + 16;
    if (panelWidth >= minimumGridWidth) break;
    abilityColumns = abilityColumns === MARTIAL_VISIBLE_COLUMNS ? MARTIAL_COMPACT_COLUMNS : MARTIAL_NARROW_COLUMNS;
  }

  const baseAbilityIconSize = Math.round(34 + 8 * compactRatio);
  const baseAbilityNameFontSize = Math.round(11 + 2 * compactRatio);
  const baseAbilityItemGap = Math.round(3 + 2 * compactRatio);
  const baseAbilityRowHeight = Math.round(50 + 17 * compactRatio);
  const baseAbilityRowGap = Math.round(5 + 19 * heightRatio);
  const baseAbilityPaddingY = Math.round(6 + 10 * heightRatio);
  const minAbilityRowHeight = minAbilityIconSize + 17;
  let abilityVisibleRows = MARTIAL_VISIBLE_ROWS;
  while (abilityVisibleRows > 1) {
    const minimumHeight = (minAbilityRowHeight * abilityVisibleRows) + (minAbilityColumnGap * (abilityVisibleRows - 1)) + 10;
    if (availableAbilityHeight >= minimumHeight) break;
    abilityVisibleRows -= 1;
  }
  const minimumAbilityHeight = (minAbilityRowHeight * abilityVisibleRows) + (minAbilityColumnGap * (abilityVisibleRows - 1)) + 10;
  const desiredAbilityHeight = (baseAbilityRowHeight * abilityVisibleRows) + (baseAbilityRowGap * (abilityVisibleRows - 1)) + (baseAbilityPaddingY * 2);
  const heightFitRatio = desiredAbilityHeight === minimumAbilityHeight
    ? 1
    : clampRatio((availableAbilityHeight - minimumAbilityHeight) / (desiredAbilityHeight - minimumAbilityHeight));
  const abilityIconSize = Math.round(minAbilityIconSize + (baseAbilityIconSize - minAbilityIconSize) * heightFitRatio);
  const abilityNameFontSize = Math.round(10 + (baseAbilityNameFontSize - 10) * heightFitRatio);
  const abilityItemGap = Math.round(3 + (baseAbilityItemGap - 3) * heightFitRatio);
  const abilityRowGap = Math.round(minAbilityColumnGap + (baseAbilityRowGap - minAbilityColumnGap) * heightFitRatio);
  const abilityPaddingY = Math.round(5 + (baseAbilityPaddingY - 5) * heightFitRatio);
  const abilityRowHeight = Math.max(
    minAbilityRowHeight,
    Math.min(
      baseAbilityRowHeight,
      Math.floor((availableAbilityHeight - (abilityPaddingY * 2) - (abilityRowGap * (abilityVisibleRows - 1))) / abilityVisibleRows),
    ),
  );
  const abilityColumnGap = Math.round(minAbilityColumnGap + (18 - minAbilityColumnGap) * widthRatio);
  const abilityPaddingX = Math.round(minAbilityPaddingX + (28 - minAbilityPaddingX) * widthRatio);
  const abilityGridWidth = Math.max(
    abilityColumns * abilityIconSize,
    panelWidth - (abilityPaddingX * 2) - 18,
  );
  const abilityCellWidth = Math.max(
    abilityIconSize,
    Math.floor((abilityGridWidth - (abilityColumnGap * (abilityColumns - 1))) / abilityColumns),
  );

  const filterHeight = Math.round(27 + 2 * compactRatio);
  const filterGap = Math.round(4 + 2 * widthRatio);
  const filterPaddingX = Math.round(7 + 2 * widthRatio);
  const filterFontSize = Math.round(12 + compactRatio);
  const filterWidthRatio = clampRatio((panelWidth - 430) / 450);
  const searchWidth = Math.round(92 + 72 * filterWidthRatio);
  const schoolFilterWidth = Math.round(78 + 23 * filterWidthRatio);
  const rarityFilterWidth = Math.round(90 + 36 * filterWidthRatio);
  const toggleWidth = Math.round(94 + 10 * filterWidthRatio);
  const favoriteWidth = Math.round(82 + 14 * filterWidthRatio);

  const activeWidthRatio = clampRatio((panelWidth - 360) / 520);
  const useEvenActiveSections = panelWidth < 700;
  const activeSmallSectionRatio = useEvenActiveSections ? 0.5 : 0.4;
  const activeDesiredIconSize = Math.round(28 + 10 * Math.min(activeWidthRatio, heightRatio));
  const activeTabWidth = Math.round(24 + 7 * activeWidthRatio);
  const activeGap = Math.round(3 + 5 * activeWidthRatio);
  const activePaddingX = Math.round(5 + 5 * activeWidthRatio);
  const activePaddingY = Math.round(5 + 4 * heightRatio);
  const activeSmallSectionInnerWidth = (panelWidth * activeSmallSectionRatio) - activeTabWidth - (activePaddingX * 2) - (activeGap * 5);
  const activeSlotWidthLimit = Math.floor(activeSmallSectionInnerWidth / 6);
  const activeSlotWidth = Math.max(24, Math.min(activeDesiredIconSize + 12, activeSlotWidthLimit));
  const activeIconSize = Math.max(22, Math.min(activeDesiredIconSize, activeSlotWidth - 8));
  const activeSlotHeight = Math.max(activeIconSize + 16, activePanelHeight - (activePaddingY * 2));
  const activeNameFontSize = Math.round(10 + Math.min(activeWidthRatio, heightRatio));
  const activeBuffGap = Math.max(2, Math.round(activeGap * 0.75));
  const activeBuffPaddingX = Math.max(4, Math.round(activePaddingX * 0.8));
  const activeEmptyFontSize = Math.round(18 + 4 * Math.min(activeWidthRatio, heightRatio));

  const presetWidthRatio = clampRatio((presetPanelWidth - 180) / (MARTIAL_PRESET_PANEL_BASE_WIDTH - 180));
  const presetHeaderHeight = Math.round(31 + 8 * Math.min(presetWidthRatio, heightRatio));
  const presetListPaddingTop = Math.round(7 + 5 * heightRatio);
  const presetListPaddingBottom = Math.round(7 + 5 * heightRatio);
  const presetListPaddingLeft = Math.round(8 + 4 * presetWidthRatio);
  const presetListPaddingRight = Math.round(10 + 10 * presetWidthRatio);
  const presetListGap = Math.round(6 + 6 * heightRatio);
  const presetAvailableListHeight = Math.max(60, panelHeight - presetHeaderHeight - presetListPaddingTop - presetListPaddingBottom);
  const presetVisiblePlans = presetPanelWidth > 0
    ? pickVisibleCount(presetAvailableListHeight, MARTIAL_PRESET_VISIBLE_PLANS, 94, presetListGap)
    : MARTIAL_PRESET_VISIBLE_PLANS;
  const presetCardPaddingX = Math.round(5 + 4 * presetWidthRatio);
  const presetCardPaddingY = Math.round(5 + 3 * heightRatio);
  const presetCardGap = Math.round(4 + 3 * heightRatio);
  const presetInnerWidth = Math.max(150, presetPanelWidth - presetListPaddingLeft - presetListPaddingRight - (presetCardPaddingX * 2) - 8);
  const presetSlotGap = Math.max(2, Math.round(2 + 2 * presetWidthRatio));
  const presetSlotWidth = Math.max(26, Math.floor((presetInnerWidth - (presetSlotGap * 5)) / 6));
  const presetIconSize = Math.max(24, Math.min(38, presetSlotWidth - 5));
  const presetSlotHeight = presetIconSize + Math.round(15 + 5 * heightRatio);
  const presetIconButtonSize = Math.round(22 + 6 * Math.min(presetWidthRatio, heightRatio));
  const presetEnableHeight = Math.round(22 + 3 * Math.min(presetWidthRatio, heightRatio));
  const presetEnableWidth = Math.round(46 + 12 * presetWidthRatio);
  const presetTopButtonSize = Math.round(22 + 3 * Math.min(presetWidthRatio, heightRatio));

  return {
    abilityColumns,
    abilityVisibleRows,
    abilityIconSize,
    abilityCellWidth,
    abilityRowHeight,
    abilityColumnGap,
    abilityRowGap,
    abilityPaddingX,
    abilityPaddingY,
    abilityNameFontSize,
    abilityItemGap,
    headerHeight,
    tabsHeight,
    filtersHeight,
    filterHeight,
    filterGap,
    filterPaddingX,
    filterFontSize,
    searchWidth,
    schoolFilterWidth,
    rarityFilterWidth,
    toggleWidth,
    favoriteWidth,
    footerHeight,
    footerFontSize: Math.round(13 + compactRatio),
    footerButtonHeight: Math.round(26 + 2 * compactRatio),
    footerButtonPaddingX: Math.round(7 + 2 * widthRatio),
    activePanelHeight,
    activeBuffFlex: useEvenActiveSections ? '1fr' : '2fr',
    activeLearnedFlex: useEvenActiveSections ? '1fr' : '3fr',
    activeTabWidth,
    activeIconSize,
    activeSlotWidth,
    activeSlotHeight,
    activeGap,
    activeBuffGap,
    activePaddingX,
    activeBuffPaddingX,
    activePaddingY,
    activeNameFontSize,
    activeEmptyFontSize,
    presetVisiblePlans,
    presetHeaderHeight,
    presetTitleFontSize: Math.round(12 + 2 * presetWidthRatio),
    presetIconButtonSize,
    presetListPaddingTop,
    presetListPaddingRight,
    presetListPaddingBottom,
    presetListPaddingLeft,
    presetListGap,
    presetCardPaddingX,
    presetCardPaddingY,
    presetCardGap,
    presetCardHeaderFontSize: Math.round(12 + 2 * Math.min(presetWidthRatio, heightRatio)),
    presetSlotWidth,
    presetSlotHeight,
    presetSlotGap,
    presetIconSize,
    presetNameFontSize: Math.round(9 + Math.min(presetWidthRatio, heightRatio)),
    presetEnableWidth,
    presetEnableHeight,
    presetTopButtonSize,
  };
}

function getMartialLayoutStyle(layout: MartialResponsiveLayout): React.CSSProperties {
  return {
    '--martial-panel-header-height': px(layout.headerHeight),
    '--martial-panel-tabs-height': px(layout.tabsHeight),
    '--martial-panel-filters-height': px(layout.filtersHeight),
    '--martial-panel-footer-height': px(layout.footerHeight),
    '--martial-ability-columns': layout.abilityColumns,
    '--martial-ability-icon-size': px(layout.abilityIconSize),
    '--martial-ability-cell-width': px(layout.abilityCellWidth),
    '--martial-ability-row-height': px(layout.abilityRowHeight),
    '--martial-ability-column-gap': px(layout.abilityColumnGap),
    '--martial-ability-row-gap': px(layout.abilityRowGap),
    '--martial-ability-pad-x': px(layout.abilityPaddingX),
    '--martial-ability-pad-y': px(layout.abilityPaddingY),
    '--martial-ability-name-font': px(layout.abilityNameFontSize),
    '--martial-ability-item-gap': px(layout.abilityItemGap),
    '--martial-filter-height': px(layout.filterHeight),
    '--martial-filter-gap': px(layout.filterGap),
    '--martial-filter-pad-x': px(layout.filterPaddingX),
    '--martial-filter-font-size': px(layout.filterFontSize),
    '--martial-search-width': px(layout.searchWidth),
    '--martial-school-filter-width': px(layout.schoolFilterWidth),
    '--martial-rarity-filter-width': px(layout.rarityFilterWidth),
    '--martial-toggle-width': px(layout.toggleWidth),
    '--martial-favorite-width': px(layout.favoriteWidth),
    '--martial-footer-font-size': px(layout.footerFontSize),
    '--martial-footer-button-height': px(layout.footerButtonHeight),
    '--martial-footer-button-pad-x': px(layout.footerButtonPaddingX),
    '--martial-active-panel-height': px(layout.activePanelHeight),
    '--martial-active-buff-flex': layout.activeBuffFlex,
    '--martial-active-learned-flex': layout.activeLearnedFlex,
    '--martial-active-tab-width': px(layout.activeTabWidth),
    '--martial-active-icon-size': px(layout.activeIconSize),
    '--martial-active-slot-width': px(layout.activeSlotWidth),
    '--martial-active-slot-height': px(layout.activeSlotHeight),
    '--martial-active-gap': px(layout.activeGap),
    '--martial-active-buff-gap': px(layout.activeBuffGap),
    '--martial-active-pad-x': px(layout.activePaddingX),
    '--martial-active-buff-pad-x': px(layout.activeBuffPaddingX),
    '--martial-active-pad-y': px(layout.activePaddingY),
    '--martial-active-name-font': px(layout.activeNameFontSize),
    '--martial-active-empty-font': px(layout.activeEmptyFontSize),
  } as React.CSSProperties;
}

function getMartialPresetLayoutStyle(layout: MartialResponsiveLayout): React.CSSProperties {
  return {
    '--martial-preset-visible-plans': layout.presetVisiblePlans,
    '--martial-preset-header-height': px(layout.presetHeaderHeight),
    '--martial-preset-title-font': px(layout.presetTitleFontSize),
    '--martial-preset-icon-button-size': px(layout.presetIconButtonSize),
    '--martial-preset-list-pad-top': px(layout.presetListPaddingTop),
    '--martial-preset-list-pad-right': px(layout.presetListPaddingRight),
    '--martial-preset-list-pad-bottom': px(layout.presetListPaddingBottom),
    '--martial-preset-list-pad-left': px(layout.presetListPaddingLeft),
    '--martial-preset-list-gap': px(layout.presetListGap),
    '--martial-preset-card-pad-x': px(layout.presetCardPaddingX),
    '--martial-preset-card-pad-y': px(layout.presetCardPaddingY),
    '--martial-preset-card-gap': px(layout.presetCardGap),
    '--martial-preset-card-header-font': px(layout.presetCardHeaderFontSize),
    '--martial-preset-slot-width': px(layout.presetSlotWidth),
    '--martial-preset-slot-height': px(layout.presetSlotHeight),
    '--martial-preset-slot-gap': px(layout.presetSlotGap),
    '--martial-preset-icon-size': px(layout.presetIconSize),
    '--martial-preset-name-font': px(layout.presetNameFontSize),
    '--martial-preset-enable-width': px(layout.presetEnableWidth),
    '--martial-preset-enable-height': px(layout.presetEnableHeight),
    '--martial-preset-top-button-size': px(layout.presetTopButtonSize),
  } as React.CSSProperties;
}

function formatMartialSettingScale(value: number): string {
  return value.toFixed(1);
}

function scaleMartialSettingValue(scale: unknown, base: number, normalize: (value: unknown) => number): number {
  return normalize(base * normalizeMartialSettingScale(scale));
}

function normalizeMartialModalSettingScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(MARTIAL_MODAL_SETTING_MIN_SCALE, Math.min(MARTIAL_MODAL_SETTING_MAX_SCALE, numeric)) * 10) / 10;
}

function getMartialModalSettingScale(value: number, base: number): number {
  return normalizeMartialModalSettingScale(value / base);
}

function scaleMartialModalSettingValue(scale: unknown, base: number, normalize: (value: unknown) => number): number {
  return normalize(base * normalizeMartialModalSettingScale(scale));
}

function normalizeMartialFavoriteOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

const MARTIAL_PLAN_NUMBER_TEXT = ['一', '二', '三', '四', '五', '六', '七', '八'];

function getDefaultMartialPlanName(index: number): string {
  return `预设${MARTIAL_PLAN_NUMBER_TEXT[index] ?? index + 1}`;
}

function sanitizeMartialPlanName(value: string, fallback: string): string {
  const name = Array.from(value.trim()).slice(0, 8).join('');
  return name || fallback;
}

function normalizeMartialPresetSlots(slots: unknown): Array<string | null> {
  const source = Array.isArray(slots) ? slots : [];
  const seen = new Set<string>();
  return Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }, (_, index) => {
    const value = source[index];
    if (typeof value !== 'string') return null;
    const abilityId = value.trim();
    if (!abilityId || seen.has(abilityId)) return null;
    seen.add(abilityId);
    return abilityId;
  });
}

function normalizeMartialPresetPlans(plans: unknown): MartialPresetPlan[] {
  if (!Array.isArray(plans)) return [];
  return plans.slice(0, MARTIAL_PRESET_LIMIT).map((plan: any, index) => ({
    id: typeof plan?.id === 'string' && plan.id.trim() ? plan.id.trim() : `martial-plan-${Date.now()}-${index}`,
    name: sanitizeMartialPlanName(typeof plan?.name === 'string' ? plan.name : '', getDefaultMartialPlanName(index)),
    slots: normalizeMartialPresetSlots(plan?.slots),
    updatedAt: typeof plan?.updatedAt === 'string' ? plan.updatedAt : new Date().toISOString(),
  }));
}

function createMartialPresetId(): string {
  try {
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  } catch {}
  return `martial-plan-${Date.now()}-${Math.round(Math.random() * 100000)}`;
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

function normalizeCameraMaxDistance(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CAMERA_SETTINGS.maxDistance;
  return Math.round(Math.max(CAMERA_DISTANCE_MIN, Math.min(CAMERA_DISTANCE_MAX, numeric)) * 100) / 100;
}

function cameraDistanceToZoom(distance: unknown): number {
  return normalizeCameraMaxDistance(distance) / CAMERA_BASE_DISTANCE;
}

function cameraZoomToDistance(zoom: unknown): number {
  const numeric = typeof zoom === 'number' ? zoom : Number(zoom);
  if (!Number.isFinite(numeric)) return DEFAULT_CAMERA_SETTINGS.maxDistance;
  return normalizeCameraMaxDistance(numeric * CAMERA_BASE_DISTANCE);
}

function loadCameraSettings(): CameraSettings {
  try {
    if (typeof window === 'undefined') return DEFAULT_CAMERA_SETTINGS;
    const stored = JSON.parse(localStorage.getItem(CAMERA_SETTINGS_STORAGE_KEY) ?? '{}');
    const storedVersion = Number(stored.version ?? 0);
    if (storedVersion < DEFAULT_CAMERA_SETTINGS.version) return DEFAULT_CAMERA_SETTINGS;
    return {
      ...DEFAULT_CAMERA_SETTINGS,
      maxDistance: normalizeCameraMaxDistance(stored.maxDistance),
      followMode: 'never',
      version: DEFAULT_CAMERA_SETTINGS.version,
    };
  } catch {
    return DEFAULT_CAMERA_SETTINGS;
  }
}

function getAbilityPanelCssScale(value: number): number {
  const normalized = normalizeAbilityPanelScale(value);
  const visualScale = normalized <= 1
    ? ABILITY_PANEL_BASE_VISUAL_SCALE * normalized
    : ABILITY_PANEL_BASE_VISUAL_SCALE + (normalized - 1) * (ABILITY_PANEL_MAX_VISUAL_SCALE - ABILITY_PANEL_BASE_VISUAL_SCALE);
  return Math.round(visualScale * 1000) / 1000;
}

function hasLegacyChannelJumpLock(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((buff) => LEGACY_CHANNEL_JUMP_LOCK_BUFF_IDS.has(buff.buffId));
}

function hasLingRanTianFengStateClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((buff: any) =>
    (buff.effects ?? []).some((effect: any) => effect?.type === 'LING_RAN_TIAN_FENG_STATE')
  );
}

function isLingRanSpecialJumpActiveClient(player?: any): boolean {
  const dash = player?.activeDash;
  return dash?.abilityId === 'ling_ran_tian_feng' && dash.ticksRemaining > 0 && dash.lingRanCastLift !== true;
}

function hasLingRanSpecialJumpRefillBuffClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((buff) => buff.buffId === 1014 || buff.buffId === 2712);
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
  const buffs = activeBuffsClient(player?.buffs);
  const suppressJumpBar = options?.suppressJumpBar === true;

  const hasBlockingCC = buffsHaveAnyEffect(buffs, ['CONTROL', 'KNOCKED_BACK', 'ATTACK_LOCK']);
  const hasInterruptImmune = buffsHaveAnyEffect(buffs, ['CONTROL_IMMUNE', 'SILENCE_IMMUNE']);
  if (hasBlockingCC && !hasInterruptImmune) {
    return null;
  }

  const activeChannel = getActiveChannelClient(player?.activeChannel ?? null);
  if (activeChannel) {
    const channel = activeChannel;
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
const EXPORT_CYL_RADIUS = COLLISION_TEST_PLAYER_RADIUS / RENDER_SF_XZ;
const CYL_HALF_HEIGHT_GAME = 0.75;
const EXPORT_CYL_HALF_HEIGHT = CYL_HALF_HEIGHT_GAME / RENDER_SF_Y;
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
  const sfXZ = RENDER_SF_XZ;
  const sfY = RENDER_SF_Y;
  const gx = GROUP_POS_X, gy = GROUP_POS_Y, gz = GROUP_POS_Z;
  _losFrom.set(
    (ax - halfW - gx) / sfXZ,
    (az + LOS_EYE_HEIGHT_GAME - gy) / sfY,
    (halfH - ay - gz) / sfXZ,
  );
  _losTo.set(
    (bx - halfW - gx) / sfXZ,
    (bz + LOS_EYE_HEIGHT_GAME - gy) / sfY,
    (halfH - by - gz) / sfXZ,
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
  return activeBuffsClient(buffs).reduce((sum, buff) => {
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

function isActiveBuffClient(buff: ActiveBuff | any, now = Date.now()): boolean {
  const expiresAt = Number(buff?.expiresAt ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return true;
  return expiresAt > now;
}

function activeBuffsClient(buffs?: ActiveBuff[]): ActiveBuff[] {
  if (!Array.isArray(buffs) || buffs.length === 0) return [];
  const now = Date.now();
  return buffs.filter((buff) => isActiveBuffClient(buff, now));
}

function isJumpBoostClientBuff(buff: ActiveBuff | any): boolean {
  return Number(buff?.buffId) === 9001 || buffHasEffect(buff, 'JUMP_BOOST');
}

function isLocallyConsumedJumpBoostClient(buff: ActiveBuff | any, consumedAt: number): boolean {
  if (!isJumpBoostClientBuff(buff) || consumedAt <= 0) return false;
  const appliedAt = Number(buff?.appliedAt ?? 0);
  if (Number.isFinite(appliedAt) && appliedAt > 0) {
    return appliedAt <= consumedAt + 1000;
  }
  return Date.now() - consumedAt < 3000;
}

function activeSelfBuffsClient(buffs: ActiveBuff[] | undefined, consumedJumpBoostAt: number): ActiveBuff[] {
  return activeBuffsClient(buffs).filter((buff) => !isLocallyConsumedJumpBoostClient(buff, consumedJumpBoostAt));
}

function getLinkedShieldDisplayClient(target?: { shield?: number; buffs?: ActiveBuff[] } | null): number {
  const rawShield = Math.max(0, Number(target?.shield ?? 0));
  if (rawShield <= 0) return 0;
  const linkedShield = activeBuffsClient(target?.buffs).reduce((sum, buff: any) => {
    const amount = Number(buff?.shieldAmount ?? 0);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
  if (linkedShield <= 0) return 0;
  return Math.min(rawShield, linkedShield);
}

function isActiveChannelClient(channel: ActiveChannel | null | undefined, now = Date.now()): boolean {
  if (!channel) return false;
  const startedAt = Number((channel as any).startedAt ?? 0);
  const durationMs = Number((channel as any).durationMs ?? 0);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return true;
  return now < startedAt + durationMs;
}

function getActiveChannelClient(channel: ActiveChannel | null | undefined): ActiveChannel | null {
  return isActiveChannelClient(channel) ? channel ?? null : null;
}

function hasStealthClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    buffHasEffect(b, 'STEALTH') ||
    STEALTH_BUFF_IDS.has(b.buffId) ||
    buffNameIncludes(b, '隐身') ||
    buffNameIncludes(b, '遁影')
  );
}

function hasDisguiseClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    DISGUISE_BUFF_IDS.has(b.buffId) ||
    buffHasEffect(b, 'DISGUISE') ||
    buffNameIncludes(b, '伪装')
  );
}

function hasAntiStealthClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
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
  return activeBuffsClient(buffs).some((b: any) => SANLIU_XIA_BUFF_IDS.has(b.buffId) || buffNameIncludes(b, '散流霞'));
}

function hasHongMengTianJinClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    HONG_MENG_TIAN_JIN_BUFF_IDS.has(b.buffId) ||
    buffHasEffect(b, 'HONG_MENG_TIAN_JIN') ||
    buffNameIncludes(b, '鸿蒙天禁')
  );
}

function hasShuSeClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    SHU_SE_BUFF_IDS.has(b.buffId) ||
    buffHasEffect(b, 'HONG_MENG_TIAN_JIN_IMMUNE') ||
    buffNameIncludes(b, '曙色')
  );
}

function hasMianLaClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'KNOCKBACK_IMMUNE'));
}

function shouldHideOpponentByStealth(buffs?: ActiveBuff[]): boolean {
  return (hasStealthClient(buffs) && !hasSanliuXiaClient(buffs)) || hasHongMengTianJinClient(buffs);
}

function blocksTargetingClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
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
  return activeBuffsClient(buffs).some((b: any) =>
    buffHasEffect(b, 'DISPLACEMENT') ||
    buffHasEffect(b, 'QINGGONG_SEAL') ||
    buffNameIncludes(b, '封轻功')
  );
}

function hasSilenceClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'SILENCE') || buffNameIncludes(b, '沉默'));
}

function hasDisarmClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'DISARM') || buffNameIncludes(b, '缴械'));
}

function hasInnerPowerLockClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'INNER_POWER_LOCK') || buffNameIncludes(b, '封内'));
}

function hasOuterPowerLockClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'OUTER_POWER_LOCK') || buffNameIncludes(b, '封外'));
}

function hasNonQinggongLockClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'NON_QINGGONG_LOCK') || buffNameIncludes(b, '轻功以外'));
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
  return activeBuffsClient(buffs).some((b: any) => b.buffId === 2741);
}

function hasDisplacementClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'DISPLACEMENT'));
}

function hasDashTurnOverrideClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => buffHasEffect(b, 'DASH_TURN_OVERRIDE'));
}

function buffsHaveAnyEffect(buffs: ActiveBuff[] | undefined, effectTypes: string[]): boolean {
  return activeBuffsClient(buffs).some((b: any) => effectTypes.some((effectType) => buffHasEffect(b, effectType)));
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
  const minPitch = isExportedMapMode(mode) ? COLLISION_TEST_MIN_CAMERA_PITCH : DEFAULT_MIN_CAMERA_PITCH;
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

  const buffs = activeBuffsClient(actor?.buffs);
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

  const buff = activeBuffsClient(params.actor?.buffs).find((entry: any) => entry.buffId === 1014 || entry.sourceAbilityId === 'fenglai_wushan');
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
  const activeChannel = getActiveChannelClient(params.actor?.activeChannel ?? null);
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

type AbilityDragSlotKind = 'draft' | 'martial-draft' | 'item' | 'library';

type AbilityDropTarget = {
  kind: 'draft' | 'martial-draft' | 'item';
  index: number;
} | {
  kind: 'preset';
  planId: string;
  index: number;
};

type MartialPresetPlan = {
  id: string;
  name: string;
  slots: Array<string | null>;
  updatedAt?: string;
};

type MartialPresetModalState =
  | { kind: 'save'; targetIndex: number; name: string }
  | { kind: 'rename'; planId: string; name: string }
  | null;

type MartialPresetDropHover = {
  planId: string;
  slotIndex: number;
} | null;

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
  large?: boolean;
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

type HotkeyTabId = 'character-action' | 'interface-toggle' | 'ability' | 'common' | 'consumable';
type GameSettingsTabId = 'general' | 'items';
type HotkeyActionKind = 'interface' | 'draft' | 'common' | 'consumable';
type HotkeySettings = Record<string, string[]>;
type HotkeyBinding = { id: string; label: string };
type HotkeyCaptureTarget = { actionId: string; bindingIndex: number } | null;
type HotkeySettingsRow = { actionId: string; label: string; locked?: boolean; bindings?: string[] };

const HOTKEY_SETTINGS_TABS: Array<{ id: HotkeyTabId; label: string }> = [
  { id: 'character-action', label: '角色动作' },
  { id: 'interface-toggle', label: '界面开关' },
  { id: 'ability', label: '技能栏' },
  { id: 'common', label: '通用栏' },
  { id: 'consumable', label: '物品栏' },
];

const LOCKED_CHARACTER_ACTION_HOTKEY_ROWS: HotkeySettingsRow[] = [
  { actionId: 'character-action:forward', label: '前进', locked: true, bindings: ['W', 'DOWN'] },
  { actionId: 'character-action:backward', label: '后退', locked: true, bindings: ['S', 'UP'] },
  { actionId: 'character-action:turn-left', label: '左转', locked: true, bindings: ['A', 'RIGHT'] },
  { actionId: 'character-action:turn-right', label: '右转', locked: true, bindings: ['D', 'LEFT'] },
  { actionId: 'character-action:strafe-left', label: '左平移', locked: true, bindings: [] },
  { actionId: 'character-action:strafe-right', label: '右平移', locked: true, bindings: [] },
  { actionId: 'character-action:jump', label: '跳跃', locked: true, bindings: ['SPACE'] },
  { actionId: 'character-action:mount', label: '骑乘', locked: true, bindings: [] },
];

const INTERFACE_HOTKEY_ROWS: HotkeySettingsRow[] = [
  { actionId: 'interface:0', label: '人物属性' },
  { actionId: 'interface:1', label: '武学界面' },
];

const RESERVED_CHARACTER_ACTION_BINDINGS = new Set(
  LOCKED_CHARACTER_ACTION_HOTKEY_ROWS.flatMap((row) => row.bindings ?? []),
);

const HOTKEY_ACTION_IDS = [
  ...INTERFACE_HOTKEY_ROWS.map((row) => row.actionId),
  ...Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }, (_, index) => `draft:${index}`),
  ...Array.from({ length: 8 }, (_, index) => `common:${index}`),
  ...Array.from({ length: CONSUMABLE_BAR_MAX_SLOTS }, (_, index) => `consumable:${index}`),
];

const DEFAULT_HOTKEY_BINDINGS: HotkeySettings = {
  'interface:0': ['C'],
  'interface:1': ['P'],
  'draft:0': ['1'],
  'draft:1': ['2'],
  'draft:2': ['3'],
  'draft:3': ['Q'],
  'draft:4': ['XB2'],
  'draft:5': ['XB1'],
  'common:0': ['X'],
  'common:1': ['MB3'],
  'common:2': ['A+W'],
  'common:3': ['A+A'],
  'common:4': ['A+D'],
  'common:5': ['A+S'],
  'common:6': ['`'],
};

function isHotkeyActionId(actionId: string): boolean {
  return HOTKEY_ACTION_IDS.includes(actionId);
}

function buildDefaultHotkeySettings(): HotkeySettings {
  const settings: HotkeySettings = {};
  HOTKEY_ACTION_IDS.forEach((actionId) => {
    settings[actionId] = [...(DEFAULT_HOTKEY_BINDINGS[actionId] ?? [])];
  });
  return settings;
}

function normalizeHotkeyBindingId(value: unknown): string | null {
  const bindingId = String(value ?? '').trim().toUpperCase();
  if (!bindingId) return null;
  return bindingId;
}

function isReservedCharacterActionBinding(bindingId: string): boolean {
  const normalizedBinding = normalizeHotkeyBindingId(bindingId);
  return !!normalizedBinding && RESERVED_CHARACTER_ACTION_BINDINGS.has(normalizedBinding);
}

function normalizeHotkeyBindingList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  value.forEach((entry) => {
    const bindingId = normalizeHotkeyBindingId(entry);
    if (!bindingId || next.includes(bindingId)) return;
    next.push(bindingId);
  });
  return next.slice(0, HOTKEY_MAX_BINDINGS_PER_ACTION);
}

function normalizeHotkeySettings(raw: unknown): HotkeySettings {
  const defaults = buildDefaultHotkeySettings();
  const bindings = raw && typeof raw === 'object' && 'bindings' in raw
    ? (raw as { bindings?: unknown }).bindings
    : raw;
  if (!bindings || typeof bindings !== 'object') return defaults;
  HOTKEY_ACTION_IDS.forEach((actionId) => {
    if (Object.prototype.hasOwnProperty.call(bindings, actionId)) {
      defaults[actionId] = normalizeHotkeyBindingList((bindings as Record<string, unknown>)[actionId])
        .filter((bindingId) => !isReservedCharacterActionBinding(bindingId));
    }
  });
  return defaults;
}

function loadHotkeySettings(): HotkeySettings {
  if (typeof window === 'undefined') return buildDefaultHotkeySettings();
  try {
    const raw = window.localStorage.getItem(HOTKEY_SETTINGS_STORAGE_KEY);
    if (!raw) return buildDefaultHotkeySettings();
    return normalizeHotkeySettings(JSON.parse(raw));
  } catch {
    return buildDefaultHotkeySettings();
  }
}

function serializeHotkeySettings(settings: HotkeySettings): string {
  const normalized = normalizeHotkeySettings(settings);
  return JSON.stringify(HOTKEY_ACTION_IDS.map((actionId) => [actionId, normalized[actionId] ?? []]));
}

function areHotkeySettingsEqual(left: HotkeySettings, right: HotkeySettings): boolean {
  return serializeHotkeySettings(left) === serializeHotkeySettings(right);
}

function persistHotkeySettings(settings: HotkeySettings): HotkeySettings {
  const normalized = normalizeHotkeySettings(settings);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(HOTKEY_SETTINGS_STORAGE_KEY, JSON.stringify({ version: HOTKEY_SETTINGS_VERSION, bindings: normalized }));
    } catch {}
  }
  return normalized;
}

function getHotkeyActionBindingLabels(settings: HotkeySettings, actionId: string): string[] {
  return (settings[actionId] ?? []).slice(0, HOTKEY_MAX_BINDINGS_PER_ACTION);
}

function formatHotkeyBindingLabel(bindingId: string): string {
  const parts = bindingId.split('+').filter(Boolean);
  const base = parts.pop();
  if (!base) return '';
  const modifierLabels: Record<string, string> = {
    C: 'Ctrl',
    A: 'Alt',
    S: 'Shift',
    M: 'Meta',
  };
  const baseLabels: Record<string, string> = {
    SPACE: 'Space',
    UP: 'Up',
    DOWN: 'Down',
    LEFT: 'Left',
    RIGHT: 'Right',
    WU: 'MouseWheelUp',
    WD: 'MouseWheelDown',
    MB1: 'MouseButton1',
    MB2: 'MouseButton2',
    MB3: 'MouseButton3',
    XB1: 'XButton1',
    XB2: 'XButton2',
  };
  return [
    ...parts.map((part) => modifierLabels[part] ?? part),
    baseLabels[base] ?? base,
  ].join('+');
}

function formatHotkeyHintLabel(bindingId: string): string {
  const normalized = normalizeHotkeyBindingId(bindingId);
  if (!normalized) return '';
  return normalized
    .split('+')
    .filter(Boolean)
    .map((part, index, parts) => {
      if (index === parts.length - 1) {
        if (part === 'WU') return 'MU';
        if (part === 'WD') return 'MD';
      }
      return part;
    })
    .join('+');
}

function findHotkeyActionByBinding(settings: HotkeySettings, bindingId: string): string | null {
  const normalizedBinding = normalizeHotkeyBindingId(bindingId);
  if (!normalizedBinding) return null;
  for (const actionId of HOTKEY_ACTION_IDS) {
    if ((settings[actionId] ?? []).includes(normalizedBinding)) return actionId;
  }
  return null;
}

function parseHotkeyActionId(actionId: string): { kind: HotkeyActionKind; index: number } | null {
  const [kind, indexRaw] = actionId.split(':');
  const index = Number(indexRaw);
  if ((kind === 'interface' || kind === 'draft' || kind === 'common' || kind === 'consumable') && Number.isInteger(index) && index >= 0) {
    return { kind, index };
  }
  return null;
}

function normalizeKeyboardHotkey(event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): HotkeyBinding | null {
  if (event.key === 'Escape') return null;
  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') return null;

  let base = '';
  if (/^Key[A-Z]$/.test(event.code)) base = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) base = event.code.slice(5);
  else if (/^Numpad[0-9]$/.test(event.code)) base = `NUM${event.code.slice(6)}`;
  else if (/^F\d{1,2}$/i.test(event.key)) base = event.key.toUpperCase();
  else if (event.code === 'Space') base = 'SPACE';
  else if (event.code === 'ArrowUp') base = 'UP';
  else if (event.code === 'ArrowDown') base = 'DOWN';
  else if (event.code === 'ArrowLeft') base = 'LEFT';
  else if (event.code === 'ArrowRight') base = 'RIGHT';
  else if (event.code === 'Backquote') base = '`';
  else if (event.code === 'Minus') base = '-';
  else if (event.code === 'Equal') base = '=';
  else if (event.code === 'BracketLeft') base = '[';
  else if (event.code === 'BracketRight') base = ']';
  else if (event.code === 'Semicolon') base = ';';
  else if (event.code === 'Quote') base = "'";
  else if (event.code === 'Comma') base = ',';
  else if (event.code === 'Period') base = '.';
  else if (event.code === 'Slash') base = '/';
  else if (event.code === 'Backslash') base = '\\';
  else if (event.key.length === 1) base = event.key.toUpperCase();
  else base = event.key.toUpperCase().replace(/\s+/g, '');

  if (!base || base === 'ESCAPE') return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('C');
  if (event.altKey) parts.push('A');
  if (event.shiftKey) parts.push('S');
  if (event.metaKey) parts.push('M');
  parts.push(base.toUpperCase());
  const label = parts.join('+');
  return { id: label, label };
}

function normalizeMouseHotkey(button: number): HotkeyBinding | null {
  const label = button === 0
    ? 'MB1'
    : button === 2
      ? 'MB2'
      : button === 1
        ? 'MB3'
        : button === 3
          ? 'XB1'
          : button === 4
            ? 'XB2'
            : '';
  return label ? { id: label, label } : null;
}

function normalizeWheelHotkey(deltaY: number): HotkeyBinding | null {
  if (deltaY === 0) return null;
  const label = deltaY < 0 ? 'WU' : 'WD';
  return { id: label, label };
}

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

function formatCompactNumber(value: number): stri