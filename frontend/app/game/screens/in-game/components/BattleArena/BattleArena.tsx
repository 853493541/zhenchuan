'use client';

import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import styles from './BattleArena.module.css';
import WASDButtons from './WASDButtons';
import VirtualJoystick from './VirtualJoystick';
import StatusBar from '../GameBoard/components/StatusBar';
import { ChannelBar, ChannelBarHost, type ChannelBarData } from './ChannelBar';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowUp, ArrowUpToLine, Check, ChevronDown, Clipboard, CornerDownLeft, Eraser, Gamepad2, Image as ImageIcon, LayoutGrid, ListChecks, MessageCircle, Minus, Pencil, Plus, Puzzle, RotateCcw, Save, Search, Settings, Smile, Star, Swords, Trash2, UserRound, Volume2, Wind, X } from 'lucide-react';
import { toastError, toastSuccess } from '@/app/components/toast/toast';
import type { ActiveBuff, ActiveChannel, ChatChannel, ChatMessage, PickupItem, GroundZone, TargetEntity, TargetSelection, PlayAreaBounds, SafeZone, YumenResults } from '../../types';
import ArenaScene, { type DirLightConfig, type EnvDebugInfo, type EnvToggles, type SceneRuntimeMetrics } from './scene/ArenaScene';
import { getMapForMode, type MapObject } from './worldMap';
import type { MapCollisionSystem } from './scene/MapCollisionSystem';
import { RENDER_SF_XZ, RENDER_SF_Y, GROUP_POS_X, GROUP_POS_Y, GROUP_POS_Z, type SceneLoadTimingEvent } from './scene/ExportedMapScene';
import { encodeIconPublicPath, getAbilityIconPath } from '@/app/lib/iconPaths';
import * as THREE from 'three';
import { ensureResizeObserverSupport } from '../../ensureResizeObserverSupport';
import { getAbilitySoundAudibleRange, getAbilitySoundCue, type AbilitySoundPhase } from './abilitySoundRegistry';
import { installAbilityAudioUnlock, playAbilitySound, stopAbilityChannelSound } from './abilitySoundPlayer';
import { getClientCrashRecorder } from '@/app/game/diagnostics/clientCrashRecorder';
import { getClientLatencyRecorder } from '@/app/game/diagnostics/clientLatencyRecorder';
import { DASH_RENDER_MAX_LEAD_TICKS, predictDashRenderPosition, shouldLogDashServerGap, type DashRenderPredictionOptions, type DashRenderSample } from './dashRenderPrediction';
import { isExportedMapMode, isYumen1v1BasicMode } from '../../../../gameModes';

type V3 = { x: number; y: number; z: number };
type LoadStageStatus = '完成' | '进行中' | '失败';

type CameraDashPredictionDebugSnapshot = {
  active: boolean;
  collisionAware: boolean;
  collisionReady: boolean;
  leadTicks: number;
  requestedLeadTicks: number;
  simulatedTicks: number;
  collisionDelta: number;
  stoppedByCollision: boolean;
  serverRenderGap: number;
  renderPredictionGap: number;
  cameraPitch: number;
  minPitch: number;
  maxPitch: number;
  cameraZoom: number;
  serverPosition: V3 | null;
  renderPosition: V3 | null;
  predictedPosition: V3 | null;
  linearPosition: V3 | null;
};

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

function isVectorMovementPayload(direction: MovementDirectionPayload): direction is { dx: number; dy: number; jump: boolean; backpedalOnly?: boolean } {
  return !!direction && 'dx' in direction;
}

function movementPayloadSignature(direction: MovementDirectionPayload, facing: { x: number; y: number }) {
  const normalizedDirection = direction
    ? isVectorMovementPayload(direction)
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

type YumenDefeatNotice = {
  id: string;
  attackerName?: string | null;
  defeatedName: string;
  attributed: boolean;
};

type YumenKillConfirmNotice = {
  id: string;
  defeatedName: string;
};

type YumenHudSize = {
  width: number;
  height: number;
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

  const payload = raw as { positions?: unknown; viewport?: unknown; chat?: unknown };
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
const YUMEN_KILL_NOTICE_UI_KEY = 'yumen-kill-notice';
const YUMEN_KILL_CONFIRM_UI_KEY = 'yumen-kill-confirm';
const YUMEN_ALIVE_COUNT_UI_KEY = 'yumen-alive-count';
const YUMEN_KILL_NOTICE_DURATION_MS = 5000;
const YUMEN_KILL_CONFIRM_DURATION_MS = 3000;
const YUMEN_KILL_NOTICE_SIZE_STORAGE_KEY = 'zhenchuan-yumen-kill-notice-size-v1';
const YUMEN_KILL_CONFIRM_SIZE_STORAGE_KEY = 'zhenchuan-yumen-kill-confirm-size-v1';
const YUMEN_ALIVE_COUNT_SIZE_STORAGE_KEY = 'zhenchuan-yumen-alive-count-size-v1';
const YUMEN_KILL_NOTICE_BASE_WIDTH = 430;
const YUMEN_KILL_NOTICE_BASE_HEIGHT = 86;
const YUMEN_KILL_CONFIRM_BASE_WIDTH = 330;
const YUMEN_KILL_CONFIRM_BASE_HEIGHT = 78;
const YUMEN_ALIVE_COUNT_BASE_WIDTH = 168;
const YUMEN_ALIVE_COUNT_BASE_HEIGHT = 74;
const YUMEN_HUD_SETTING_MIN_SCALE = 0.5;
const YUMEN_HUD_SETTING_MAX_SCALE = 2;
const YUMEN_KILL_NOTICE_MIN_WIDTH = Math.round(YUMEN_KILL_NOTICE_BASE_WIDTH * YUMEN_HUD_SETTING_MIN_SCALE);
const YUMEN_KILL_NOTICE_MAX_WIDTH = Math.round(YUMEN_KILL_NOTICE_BASE_WIDTH * YUMEN_HUD_SETTING_MAX_SCALE);
const YUMEN_KILL_NOTICE_MIN_HEIGHT = Math.round(YUMEN_KILL_NOTICE_BASE_HEIGHT * YUMEN_HUD_SETTING_MIN_SCALE);
const YUMEN_KILL_NOTICE_MAX_HEIGHT = Math.round(YUMEN_KILL_NOTICE_BASE_HEIGHT * YUMEN_HUD_SETTING_MAX_SCALE);
const YUMEN_KILL_CONFIRM_MIN_WIDTH = Math.round(YUMEN_KILL_CONFIRM_BASE_WIDTH * YUMEN_HUD_SETTING_MIN_SCALE);
const YUMEN_KILL_CONFIRM_MAX_WIDTH = Math.round(YUMEN_KILL_CONFIRM_BASE_WIDTH * YUMEN_HUD_SETTING_MAX_SCALE);
const YUMEN_KILL_CONFIRM_MIN_HEIGHT = Math.round(YUMEN_KILL_CONFIRM_BASE_HEIGHT * YUMEN_HUD_SETTING_MIN_SCALE);
const YUMEN_KILL_CONFIRM_MAX_HEIGHT = Math.round(YUMEN_KILL_CONFIRM_BASE_HEIGHT * YUMEN_HUD_SETTING_MAX_SCALE);
const YUMEN_ALIVE_COUNT_MIN_WIDTH = Math.round(YUMEN_ALIVE_COUNT_BASE_WIDTH * YUMEN_HUD_SETTING_MIN_SCALE);
const YUMEN_ALIVE_COUNT_MAX_WIDTH = Math.round(YUMEN_ALIVE_COUNT_BASE_WIDTH * YUMEN_HUD_SETTING_MAX_SCALE);
const YUMEN_ALIVE_COUNT_MIN_HEIGHT = Math.round(YUMEN_ALIVE_COUNT_BASE_HEIGHT * YUMEN_HUD_SETTING_MIN_SCALE);
const YUMEN_ALIVE_COUNT_MAX_HEIGHT = Math.round(YUMEN_ALIVE_COUNT_BASE_HEIGHT * YUMEN_HUD_SETTING_MAX_SCALE);
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

function recordDashProbe(type: 'start' | 'end' | 'correction', payload: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  const target = window as any;
  const probe = target.__zhenchuanDashProbe ?? { starts: 0, ends: 0, corrections: [], events: [] };
  if (type === 'start') probe.starts = Number(probe.starts ?? 0) + 1;
  if (type === 'end') probe.ends = Number(probe.ends ?? 0) + 1;
  const event = { type, ts: Date.now(), ...payload };
  probe.events = [...(Array.isArray(probe.events) ? probe.events : []), event].slice(-80);
  if (type === 'correction') {
    probe.corrections = [...(Array.isArray(probe.corrections) ? probe.corrections : []), event].slice(-80);
  }
  target.__zhenchuanDashProbe = probe;
}

function createEmptyCameraDashPredictionSnapshot(): CameraDashPredictionDebugSnapshot {
  return {
    active: false,
    collisionAware: false,
    collisionReady: false,
    leadTicks: 0,
    requestedLeadTicks: 0,
    simulatedTicks: 0,
    collisionDelta: 0,
    stoppedByCollision: false,
    serverRenderGap: 0,
    renderPredictionGap: 0,
    cameraPitch: 0,
    minPitch: 0,
    maxPitch: 0,
    cameraZoom: DEFAULT_CAMERA_ZOOM,
    serverPosition: null,
    renderPosition: null,
    predictedPosition: null,
    linearPosition: null,
  };
}

function recordCameraDashPredictionProbe(snapshot: CameraDashPredictionDebugSnapshot) {
  if (typeof window === 'undefined') return;
  const target = window as any;
  const probe = target.__zhenchuanCameraDashProbe ?? { active: false, dashes: [], samples: [] };
  probe.last = snapshot;
  probe.samples = [...(Array.isArray(probe.samples) ? probe.samples : []), { ts: Date.now(), ...snapshot }].slice(-240);

  if (snapshot.active) {
    if (!probe.active) {
      probe.active = true;
      probe.current = {
        startedAt: Date.now(),
        samples: 0,
        maxCollisionDelta: 0,
        maxRenderPredictionGap: 0,
        maxServerRenderGap: 0,
        stoppedByCollision: false,
        collisionAware: false,
      };
    }
    probe.current.samples += 1;
    probe.current.maxCollisionDelta = Math.max(Number(probe.current.maxCollisionDelta ?? 0), snapshot.collisionDelta);
    probe.current.maxRenderPredictionGap = Math.max(Number(probe.current.maxRenderPredictionGap ?? 0), snapshot.renderPredictionGap);
    probe.current.maxServerRenderGap = Math.max(Number(probe.current.maxServerRenderGap ?? 0), snapshot.serverRenderGap);
    probe.current.stoppedByCollision = probe.current.stoppedByCollision || snapshot.stoppedByCollision;
    probe.current.collisionAware = probe.current.collisionAware || snapshot.collisionAware;
  } else if (probe.active) {
    const finished = {
      ...(probe.current ?? {}),
      endedAt: Date.now(),
    };
    probe.dashes = [...(Array.isArray(probe.dashes) ? probe.dashes : []), finished].slice(-80);
    probe.active = false;
    probe.current = null;
  }

  target.__zhenchuanCameraDashProbe = probe;
}
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
  [YUMEN_KILL_NOTICE_UI_KEY]: { left: 745, top: 82 },
  [YUMEN_KILL_CONFIRM_UI_KEY]: { left: 795, top: 420 },
  [YUMEN_ALIVE_COUNT_UI_KEY]: { left: 1704, top: 292 },
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
  { id: 'beng_dai', name: '绷带', implemented: true, startingCount: 12, cooldownMs: 0 },
  { id: 'jin_chuang_yao', name: '金疮药', implemented: true, startingCount: 2, cooldownMs: 120_000 },
  { id: 'yue_ying_sha', name: '月影沙', implemented: true, startingCount: 1, cooldownMs: 30_000 },
  { id: 'sha_shi_wei_zhuang', name: '砂石伪装', implemented: true, startingCount: 4, cooldownMs: 0 },
  { id: 'guan_mu_wei_zhuang', name: '灌木伪装', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'wa_guan_wei_zhuang', name: '瓦罐伪装', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'sha_xing_xie', name: '沙行蝎', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'ma_cao', name: '马草', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'yi_jie_wu_qi_he', name: '一阶武器盒', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'er_jie_wu_qi_he', name: '二阶武器盒', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'san_jie_wu_qi_he', name: '三阶武器盒', implemented: false, startingCount: 0, cooldownMs: 0 },
  { id: 'tian_jie_wu_qi_he', name: '天阶武器盒', implemented: false, startingCount: 0, cooldownMs: 0 },
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
const TEST_COOLDOWN_CAP_TICKS = 3 * SERVER_TICK_RATE;
const YUMEN_SANDSTORM_OVERLAY_STORAGE_KEY = 'zhenchuan-yumen-sandstorm-overlay';
const BASE_MOVE_SPEED_PER_TICK = 0.1666667;
const AIR_SHIFT_DURATION_TICKS = SERVER_TICK_RATE;
const LEGACY_CHANNEL_JUMP_LOCK_BUFF_IDS = new Set([1014, 1017, 2001, 2003, 2712]);

type YumenSandstormOverlaySettings = {
  orangeAmount: number;
  brightness: number;
};

const DEFAULT_YUMEN_SANDSTORM_OVERLAY: YumenSandstormOverlaySettings = {
  orangeAmount: 55,
  brightness: 0,
};

function clampSandstormSetting(value: unknown, min: number, max: number, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeSandstormOverlaySettings(value: unknown): YumenSandstormOverlaySettings {
  const source = value && typeof value === 'object' ? value as Partial<YumenSandstormOverlaySettings> : {};
  return {
    orangeAmount: clampSandstormSetting(source.orangeAmount, 0, 100, DEFAULT_YUMEN_SANDSTORM_OVERLAY.orangeAmount),
    brightness: clampSandstormSetting(source.brightness, -40, 40, DEFAULT_YUMEN_SANDSTORM_OVERLAY.brightness),
  };
}

function buildYumenSandstormOverlayValues(settings: YumenSandstormOverlaySettings) {
  const amountRatio = clampRatio(settings.orangeAmount / 100);
  const neutral = { r: 92, g: 78, b: 62 };
  const orange = { r: 218, g: 132, b: 52 };
  const shift = Math.round(settings.brightness);
  const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value + shift)));
  const r = clampChannel(neutral.r + (orange.r - neutral.r) * amountRatio);
  const g = clampChannel(neutral.g + (orange.g - neutral.g) * amountRatio);
  const b = clampChannel(neutral.b + (orange.b - neutral.b) * amountRatio);
  const alpha = Number((0.12 + amountRatio * 0.34).toFixed(3));
  const rgba = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  return {
    r,
    g,
    b,
    alpha,
    rgba,
    cssVars: {
      '--yumen-sandstorm-r': String(r),
      '--yumen-sandstorm-g': String(g),
      '--yumen-sandstorm-b': String(b),
      '--yumen-sandstorm-alpha': alpha.toFixed(3),
    } as React.CSSProperties,
  };
}

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

function normalizeYumenHudSettingScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.round(Math.max(YUMEN_HUD_SETTING_MIN_SCALE, Math.min(YUMEN_HUD_SETTING_MAX_SCALE, numeric)) * 10) / 10;
}

function getYumenHudSettingScale(value: number, base: number): number {
  return normalizeYumenHudSettingScale(value / base);
}

function scaleYumenHudSettingValue(scale: unknown, base: number, normalize: (value: unknown) => number): number {
  return normalize(base * normalizeYumenHudSettingScale(scale));
}

function normalizeYumenKillNoticeWidth(value: unknown): number {
  return normalizeNumberInRange(value, YUMEN_KILL_NOTICE_BASE_WIDTH, YUMEN_KILL_NOTICE_MIN_WIDTH, YUMEN_KILL_NOTICE_MAX_WIDTH);
}

function normalizeYumenKillNoticeHeight(value: unknown): number {
  return normalizeNumberInRange(value, YUMEN_KILL_NOTICE_BASE_HEIGHT, YUMEN_KILL_NOTICE_MIN_HEIGHT, YUMEN_KILL_NOTICE_MAX_HEIGHT);
}

function normalizeYumenKillConfirmWidth(value: unknown): number {
  return normalizeNumberInRange(value, YUMEN_KILL_CONFIRM_BASE_WIDTH, YUMEN_KILL_CONFIRM_MIN_WIDTH, YUMEN_KILL_CONFIRM_MAX_WIDTH);
}

function normalizeYumenKillConfirmHeight(value: unknown): number {
  return normalizeNumberInRange(value, YUMEN_KILL_CONFIRM_BASE_HEIGHT, YUMEN_KILL_CONFIRM_MIN_HEIGHT, YUMEN_KILL_CONFIRM_MAX_HEIGHT);
}

function normalizeYumenAliveCountWidth(value: unknown): number {
  return normalizeNumberInRange(value, YUMEN_ALIVE_COUNT_BASE_WIDTH, YUMEN_ALIVE_COUNT_MIN_WIDTH, YUMEN_ALIVE_COUNT_MAX_WIDTH);
}

function normalizeYumenAliveCountHeight(value: unknown): number {
  return normalizeNumberInRange(value, YUMEN_ALIVE_COUNT_BASE_HEIGHT, YUMEN_ALIVE_COUNT_MIN_HEIGHT, YUMEN_ALIVE_COUNT_MAX_HEIGHT);
}

function normalizeYumenHudSize(value: unknown, defaults: YumenHudSize, normalizeWidth: (value: unknown) => number, normalizeHeight: (value: unknown) => number): YumenHudSize {
  const candidate = value && typeof value === 'object' ? value as Partial<YumenHudSize> : {};
  return {
    width: normalizeWidth(candidate.width ?? defaults.width),
    height: normalizeHeight(candidate.height ?? defaults.height),
  };
}

function loadYumenHudSize(storageKey: string, defaults: YumenHudSize, normalizeWidth: (value: unknown) => number, normalizeHeight: (value: unknown) => number): YumenHudSize {
  try {
    if (typeof window === 'undefined') return defaults;
    return normalizeYumenHudSize(JSON.parse(localStorage.getItem(storageKey) ?? '{}'), defaults, normalizeWidth, normalizeHeight);
  } catch {
    return defaults;
  }
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

type CollisionAwareDashPredictionContext = {
  arenaWidth: number;
  arenaHeight: number;
  playerRadius: number;
  isExportedMap: boolean;
  collisionSystem: MapCollisionSystem | null;
  objects: MapObject[];
  entities: TargetEntity[];
  actorUserId: string;
  playArea?: PlayAreaBounds;
};

type CollisionAwareDashPrediction = {
  position: V3;
  debug: {
    collisionAware: boolean;
    collisionReady: boolean;
    leadTicks: number;
    requestedLeadTicks: number;
    simulatedTicks: number;
    collisionDelta: number;
    stoppedByCollision: boolean;
    linearPosition: V3;
  };
};

const _dashPredictBvhCenter = new THREE.Vector3();
const _dashPredictBvhVelocity = new THREE.Vector3();
const _dashPredictGroundCenter = new THREE.Vector3();

function computeDashRenderLeadTicks(sample: DashRenderSample, options: DashRenderPredictionOptions) {
  const tickMs = options.tickMs ?? (1000 / SERVER_TICK_RATE);
  const maxLeadTicks = options.maxLeadTicks ?? DASH_RENDER_MAX_LEAD_TICKS;
  const elapsedMs = Math.max(0, options.nowMs - sample.sampledAtMs);
  const elapsedTicks = tickMs > 0 ? elapsedMs / tickMs : 0;
  return {
    requestedLeadTicks: elapsedTicks,
    leadTicks: Math.max(0, Math.min(elapsedTicks, maxLeadTicks, sample.ticksRemaining)),
  };
}

function getDashPredictionGroundHeight(x: number, y: number, z: number, ctx: CollisionAwareDashPredictionContext): number {
  if (ctx.isExportedMap && ctx.collisionSystem) {
    const halfW = ctx.arenaWidth / 2;
    const halfH = ctx.arenaHeight / 2;
    _dashPredictGroundCenter.set(
      (x - halfW - GROUP_POS_X) / RENDER_SF_XZ,
      (z - GROUP_POS_Y) / RENDER_SF_Y + EXPORT_CYL_HALF_HEIGHT,
      (halfH - y - GROUP_POS_Z) / RENDER_SF_XZ,
    );
    const supportY = getBvhGroundSupportY(ctx.collisionSystem, _dashPredictGroundCenter);
    return supportY === null ? z : supportY * RENDER_SF_Y + GROUP_POS_Y;
  }
  return getGroundHeightClient(x, y, z, ctx.objects, ctx.playerRadius);
}

function applyDashPredictionCollisionStep(
  pos: V3,
  stepX: number,
  stepY: number,
  ctx: CollisionAwareDashPredictionContext,
) {
  let x = pos.x;
  let y = pos.y;
  const velocity = { x: stepX, y: stepY };
  const intendedStep = Math.hypot(stepX, stepY);
  const maxSubStep = Math.max(0.001, ctx.playerRadius * 0.85);
  const numSubSteps = Math.max(1, Math.ceil(intendedStep / maxSubStep));
  let stoppedByCollision = false;

  for (let subIndex = 0; subIndex < numSubSteps; subIndex += 1) {
    const subX = stepX / numSubSteps;
    const subY = stepY / numSubSteps;
    const beforeX = x;
    const beforeY = y;
    let nextX = Math.max(ctx.playerRadius, Math.min(ctx.arenaWidth - ctx.playerRadius, x + subX));
    let nextY = Math.max(ctx.playerRadius, Math.min(ctx.arenaHeight - ctx.playerRadius, y + subY));
    const playAreaClamped = clampPositionToPlayAreaClient(
      nextX,
      nextY,
      ctx.playArea,
      ctx.arenaWidth,
      ctx.arenaHeight,
      ctx.playerRadius,
      velocity,
    );
    nextX = playAreaClamped.x;
    nextY = playAreaClamped.y;

    if (ctx.isExportedMap && ctx.collisionSystem) {
      const halfW = ctx.arenaWidth / 2;
      const halfH = ctx.arenaHeight / 2;
      _dashPredictBvhCenter.set(
        (nextX - halfW - GROUP_POS_X) / RENDER_SF_XZ,
        (pos.z - GROUP_POS_Y) / RENDER_SF_Y + EXPORT_CYL_HALF_HEIGHT,
        (halfH - nextY - GROUP_POS_Z) / RENDER_SF_XZ,
      );
      _dashPredictBvhVelocity.set(subX / RENDER_SF_XZ, 0, -subY / RENDER_SF_XZ);
      ctx.collisionSystem.resolveSphereCollision(_dashPredictBvhCenter, EXPORT_CYL_RADIUS, _dashPredictBvhVelocity);
      nextX = Math.max(ctx.playerRadius, Math.min(ctx.arenaWidth - ctx.playerRadius,
        _dashPredictBvhCenter.x * RENDER_SF_XZ + GROUP_POS_X + halfW));
      nextY = Math.max(ctx.playerRadius, Math.min(ctx.arenaHeight - ctx.playerRadius,
        halfH - (_dashPredictBvhCenter.z * RENDER_SF_XZ + GROUP_POS_Z)));
      const bvhPlayAreaClamped = clampPositionToPlayAreaClient(
        nextX,
        nextY,
        ctx.playArea,
        ctx.arenaWidth,
        ctx.arenaHeight,
        ctx.playerRadius,
        velocity,
      );
      nextX = bvhPlayAreaClamped.x;
      nextY = bvhPlayAreaClamped.y;
    } else {
      for (const obj of ctx.objects) {
        const resolved = resolveObjCollisionClient(nextX, nextY, pos.z, velocity, obj, ctx.playerRadius);
        nextX = resolved.x;
        nextY = resolved.y;
      }
    }

    const wallResolved = resolveEnemyChuHeHanJieWallCollisionClient(
      nextX,
      nextY,
      pos.z,
      velocity,
      ctx.entities,
      ctx.actorUserId,
      ctx.playerRadius,
    );
    nextX = wallResolved.x;
    nextY = wallResolved.y;
    const finalPlayAreaClamped = clampPositionToPlayAreaClient(
      nextX,
      nextY,
      ctx.playArea,
      ctx.arenaWidth,
      ctx.arenaHeight,
      ctx.playerRadius,
      velocity,
    );
    nextX = finalPlayAreaClamped.x;
    nextY = finalPlayAreaClamped.y;

    const actualStepX = nextX - beforeX;
    const actualStepY = nextY - beforeY;
    const intendedSubStep = Math.hypot(subX, subY);
    if (intendedSubStep > 1e-4) {
      const along = (actualStepX * subX + actualStepY * subY) / intendedSubStep;
      if (along < intendedSubStep * 0.35) stoppedByCollision = true;
    }
    x = nextX;
    y = nextY;
    if (stoppedByCollision) break;
  }

  pos.x = x;
  pos.y = y;
  return stoppedByCollision;
}

function predictDashRenderPositionWithCollision(
  sample: DashRenderSample | null,
  options: DashRenderPredictionOptions,
  ctx: CollisionAwareDashPredictionContext,
): CollisionAwareDashPrediction | null {
  if (!sample) return null;

  const { requestedLeadTicks, leadTicks } = computeDashRenderLeadTicks(sample, options);
  const linearPosition = predictDashRenderPosition(sample, options) ?? sample.position;
  const collisionReady = !ctx.isExportedMap || !!ctx.collisionSystem;

  if (!collisionReady || leadTicks <= 0) {
    return {
      position: { ...linearPosition },
      debug: {
        collisionAware: false,
        collisionReady,
        leadTicks,
        requestedLeadTicks,
        simulatedTicks: 0,
        collisionDelta: 0,
        stoppedByCollision: false,
        linearPosition: { ...linearPosition },
      },
    };
  }

  const pos: V3 = { ...sample.position };
  let simulatedTicks = 0;
  let stoppedByCollision = false;
  const fullTicks = Math.floor(leadTicks);
  const fractionalTick = leadTicks - fullTicks;
  const stepScales: number[] = [];
  for (let tickIndex = 0; tickIndex < fullTicks; tickIndex += 1) stepScales.push(1);
  if (fractionalTick > 1e-4) stepScales.push(fractionalTick);

  for (const stepScale of stepScales) {
    const stepX = sample.vxPerTick * stepScale;
    const stepY = sample.vyPerTick * stepScale;
    if (Math.hypot(stepX, stepY) > 1e-5) {
      stoppedByCollision = applyDashPredictionCollisionStep(pos, stepX, stepY, ctx) || stoppedByCollision;
    }
    const nextZ = sample.position.z + sample.vzPerTick * (simulatedTicks + stepScale);
    const groundZ = getDashPredictionGroundHeight(pos.x, pos.y, nextZ, ctx);
    pos.z = Math.max(groundZ, nextZ);
    simulatedTicks += stepScale;
    if (stoppedByCollision) break;
  }

  const collisionDelta = Math.hypot(
    linearPosition.x - pos.x,
    linearPosition.y - pos.y,
    linearPosition.z - pos.z,
  );

  return {
    position: pos,
    debug: {
      collisionAware: true,
      collisionReady: true,
      leadTicks,
      requestedLeadTicks,
      simulatedTicks,
      collisionDelta,
      stoppedByCollision,
      linearPosition: { ...linearPosition },
    },
  };
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
const YUMEN_KUANG_SHA_BUFF_ID = 990200;
const YUMEN_SPECTATOR_BUFF_ID = 990202;
const YUMEN_PREP_BUFF_ID = 990204;
const DISGUISE_BUFF_IDS = new Set([980001]);
const SANLIU_XIA_BUFF_IDS = new Set([1007, 1008]);
const HONG_MENG_TIAN_JIN_BUFF_IDS = new Set([2645]);
const SHU_SE_BUFF_IDS = new Set([2646]);
const SHI_FANG_XUAN_JI_BUFF_ID = 2642;

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

function hasShiFangXuanJiClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    Number(b?.buffId) === SHI_FANG_XUAN_JI_BUFF_ID || buffNameIncludes(b, '十方玄机')
  );
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

function hasYumenSpectatorClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    Number(b?.buffId) === YUMEN_SPECTATOR_BUFF_ID || buffNameIncludes(b, '观战中')
  );
}

function hasYumenKuangShaClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    Number(b?.buffId) === YUMEN_KUANG_SHA_BUFF_ID || buffNameIncludes(b, '狂沙')
  );
}

function hasYumenPrepClient(buffs?: ActiveBuff[]): boolean {
  return activeBuffsClient(buffs).some((b: any) =>
    Number(b?.buffId) === YUMEN_PREP_BUFF_ID || buffNameIncludes(b, '准备时间')
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
const COLLISION_TEST_MIN_CAMERA_PITCH = -Math.PI * 0.49;
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

type CooldownDisplayKind = 'cooldown' | 'gcd' | 'charge';

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
  cooldownDisplayKind?: CooldownDisplayKind;
  chargeCount?: number;
  maxCharges?: number;
  chargeRegenTicksRemaining?: number;
  chargeRegenProgress?: number;
  chargeRecoveryTicks?: number;
  tooltipChargeRecoveryTicks?: number;
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
  const counts = player?.consumableCounts;
  const hasExplicitCounts = counts && typeof counts === 'object';
  const remaining = Number(hasExplicitCounts
    ? Object.prototype.hasOwnProperty.call(counts, consumable.id) ? counts[consumable.id] : 0
    : fallback);
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

function getCooldownOverlayStyle(cooldownPct: number, kind: CooldownDisplayKind = 'cooldown'): React.CSSProperties {
  const pct = Math.max(0, Math.min(100, Number(cooldownPct) || 0));
  const startPct = (100 - pct).toFixed(1);
  const color = 'rgba(0, 0, 0, 0.50)';
  return { background: `conic-gradient(from 0deg, transparent ${startPct}%, ${color} ${startPct}%)` };
}

function isCooldownFlashDanger(remainingMs: number): boolean {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs >= 3000) return false;
  const phaseMs = ((remainingMs % 1000) + 1000) % 1000;
  return phaseMs > 500;
}

function getConsumableCooldownPct(consumable: ConsumableItem | undefined, remainingMs: number): number {
  const maxMs = Math.max(0, Number(consumable?.cooldownMs ?? 0));
  if (maxMs <= 0) return 100;
  return Math.max(0, Math.min(100, (remainingMs / maxMs) * 100));
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

function getRuntimeCountdownTicks(source: any, valueKey: string, syncedAtKey: string, nowMs: number): number {
  const value = Number(source?.[valueKey] ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const syncedAt = Number(source?.[syncedAtKey] ?? 0);
  if (!Number.isFinite(syncedAt) || syncedAt <= 0) return Math.max(0, Math.ceil(value));
  const elapsedTicks = Math.max(0, ((nowMs - syncedAt) / 1000) * SERVER_TICK_RATE);
  return Math.max(0, Math.ceil(value - elapsedTicks));
}

function hasRuntimeCountdown(source: any, valueKey: string, syncedAtKey: string, nowMs: number): boolean {
  return getRuntimeCountdownTicks(source, valueKey, syncedAtKey, nowMs) > 0;
}

function playerHasRuntimeCountdown(player: any, nowMs: number): boolean {
  if (!player) return false;
  if (hasRuntimeCountdown(player, 'globalGcdTicks', '_globalGcdSyncedAt', nowMs)) return true;
  if (hasRuntimeCountdown(player.activeDash, 'ticksRemaining', '_ticksRemainingSyncedAt', nowMs)) return true;
  const hand = Array.isArray(player.hand) ? player.hand : [];
  if (hand.some((ability: any) => (
    hasRuntimeCountdown(ability, 'cooldown', '_cooldownSyncedAt', nowMs) ||
    hasRuntimeCountdown(ability, 'chargeRegenTicksRemaining', '_chargeRegenTicksRemainingSyncedAt', nowMs) ||
    hasRuntimeCountdown(ability, 'chargeLockTicks', '_chargeLockTicksSyncedAt', nowMs)
  ))) return true;
  const specialStates = player.specialAbilityStates && typeof player.specialAbilityStates === 'object'
    ? Object.values(player.specialAbilityStates)
    : [];
  return specialStates.some((ability: any) => (
    hasRuntimeCountdown(ability, 'cooldown', '_cooldownSyncedAt', nowMs) ||
    hasRuntimeCountdown(ability, 'chargeRegenTicksRemaining', '_chargeRegenTicksRemainingSyncedAt', nowMs) ||
    hasRuntimeCountdown(ability, 'chargeLockTicks', '_chargeLockTicksSyncedAt', nowMs)
  ));
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
  if (!settings.enabled || !settings.base || remainingBaseGcdTicks <= 1) {
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
  if (ability.target === 'SELF') {
    return '无';
  }

  if (typeof ability.range !== 'number') {
    return '-';
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
  return `释放: ${seconds}秒`;
}

function formatAbilityCooldownLabel(ability: AbilityInfo): string {
  const cooldownTicks = Number(ability.baseCooldownTicks ?? 0);
  if (cooldownTicks > 0) return formatTicksAsSeconds(cooldownTicks);
  const recoveryTicks = Number(ability.tooltipChargeRecoveryTicks ?? ability.chargeRecoveryTicks ?? 0);
  if ((ability.maxCharges ?? 0) > 1 && recoveryTicks > 0) return formatTicksAsSeconds(recoveryTicks);
  return '无调息时间';
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
  skyLook: boolean;
  recenter: boolean;
  forwardMove: boolean;
  lookUpRatio: number;
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

function YumenMiniMap({
  mapWidth,
  mapHeight,
  playerPosition,
  playerFacing,
  safeZone,
  panelPosition,
  onPanelPositionChange,
}: {
  mapWidth: number;
  mapHeight: number;
  playerPosition: { x: number; y: number };
  playerFacing: { x: number; y: number };
  safeZone?: SafeZone;
  panelPosition?: UiPosition;
  onPanelPositionChange?: (position: UiPosition, persist: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(true);
  const size = 244;
  const headerHeight = 27;
  const infoHeight = 40;
  const padding = 10;
  const chromePadding = 2;
  const panelWidth = size + chromePadding * 2;
  const mapBodyHeight = expanded ? size + chromePadding * 2 : 0;
  const frameHeight = headerHeight + mapBodyHeight;
  const panelHeight = infoHeight + frameHeight;
  const mapScale = Math.min((size - padding * 2) / Math.max(1, mapWidth), (size - padding * 2) / Math.max(1, mapHeight));
  const renderedWidth = mapWidth * mapScale;
  const renderedHeight = mapHeight * mapScale;
  const offsetX = (size - renderedWidth) / 2;
  const offsetY = (size - renderedHeight) / 2;
  const toMapX = (x: number) => offsetX + Math.max(0, Math.min(mapWidth, x)) * mapScale;
  const toMapY = (y: number) => offsetY + (mapHeight - Math.max(0, Math.min(mapHeight, y))) * mapScale;
  const rawCircleX = (x: number) => offsetX + x * mapScale;
  const rawCircleY = (y: number) => offsetY + (mapHeight - y) * mapScale;
  const safeZonePhase = safeZone?.phase;
  const isWaiting = safeZonePhase === 'waiting';
  const isCountdownOrShrinking = safeZonePhase === 'countdown' || safeZonePhase === 'shrinking';
  const isShrinking = safeZone?.shrinking === true || safeZonePhase === 'shrinking';
  const currentRadius = Math.max(0, Number(safeZone?.currentHalf ?? 0)) * mapScale;
  const hasCurrentCircle = !!safeZone && currentRadius > 0;
  const targetRadius = Math.max(0, Number(safeZone?.targetHalf ?? 0)) * mapScale;
  const hasFutureCircle = !!safeZone && isCountdownOrShrinking && safeZone.targetVisible === true && targetRadius > 0;
  const mergedCircleEpsilon = 0.6;
  const circlesMerged = hasCurrentCircle && hasFutureCircle && (() => {
    const currentCx = Number(safeZone?.centerX ?? 0);
    const currentCy = Number(safeZone?.centerY ?? 0);
    const futureCx = Number(safeZone?.targetCenterX ?? safeZone?.centerX ?? 0);
    const futureCy = Number(safeZone?.targetCenterY ?? safeZone?.centerY ?? 0);
    const centerDelta = Math.hypot(rawCircleX(currentCx) - rawCircleX(futureCx), rawCircleY(currentCy) - rawCircleY(futureCy));
    const radiusDelta = Math.abs(currentRadius - targetRadius);
    return centerDelta <= mergedCircleEpsilon && radiusDelta <= mergedCircleEpsilon;
  })();
  const markerX = toMapX(playerPosition.x);
  const markerY = toMapY(playerPosition.y);
  const facingLength = Math.hypot(playerFacing.x, playerFacing.y) || 1;
  const facingX = playerFacing.x / facingLength;
  const facingY = playerFacing.y / facingLength;
  const markerRotation = Math.atan2(facingX, facingY) * 180 / Math.PI;
  const totalCircles = Math.max(1, Math.floor(Number(safeZone?.totalCircles ?? 8)));
  const inferredCircleNumber = (() => {
    if (typeof safeZone?.circleNumber === 'number') return safeZone.circleNumber;
    const phase = safeZone?.phase;
    const stageIndex = phase === 'countdown' || phase === 'shrinking'
      ? Number(safeZone?.targetStageIndex ?? (Number(safeZone?.stageIndex ?? 0) + 1))
      : Number(safeZone?.stageIndex ?? 0);
    return 3 + Math.max(0, Math.floor(Number.isFinite(stageIndex) ? stageIndex : 0));
  })();
  const displayCircleNumber = Math.max(1, Math.min(totalCircles, Math.floor(inferredCircleNumber)));
  const fullPoisonActive = !safeZone || safeZone.fullPoison || safeZone.phase === 'complete' || Number(safeZone.currentHalf ?? 0) <= 0;
  const distanceSafeZone = safeZone
    ? {
        centerX: hasFutureCircle ? Number(safeZone.targetCenterX ?? safeZone.centerX) : Number(safeZone.centerX),
        centerY: hasFutureCircle ? Number(safeZone.targetCenterY ?? safeZone.centerY) : Number(safeZone.centerY),
        radius: Math.max(0, hasFutureCircle ? Number(safeZone.targetHalf ?? 0) : Number(safeZone.currentHalf ?? 0)),
      }
    : null;
  const distanceText = fullPoisonActive
    ? '已全毒'
    : distanceSafeZone
      ? (() => {
          const distanceToEdge = Math.max(0, Math.hypot(playerPosition.x - distanceSafeZone.centerX, playerPosition.y - distanceSafeZone.centerY) - distanceSafeZone.radius);
          return distanceToEdge <= 0.05 ? '安全区内' : `距离安全区: ${distanceToEdge.toFixed(1)}尺`;
        })()
      : '安全区内';

  const beginDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const baseLeft = rect.left;
    const baseTop = rect.top;
    const clampPosition = (left: number, top: number) => {
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      return {
        left: Math.max(8, Math.min(maxLeft, left)),
        top: Math.max(8, Math.min(maxTop, top)),
      };
    };

    const move = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      onPanelPositionChange?.(clampPosition(baseLeft + moveEvent.clientX - startX, baseTop + moveEvent.clientY - startY), false);
    };
    const end = (upEvent: MouseEvent) => {
      onPanelPositionChange?.(clampPosition(baseLeft + upEvent.clientX - startX, baseTop + upEvent.clientY - startY), true);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
    };
    onPanelPositionChange?.(clampPosition(baseLeft, baseTop), false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
  };

  return (
    <div
      ref={panelRef}
      data-ui-interactive
      aria-label="玉门关小地图"
      style={{
        position: 'absolute',
        ...(panelPosition ? { left: panelPosition.left, top: panelPosition.top } : { top: 50, right: 14 }),
        width: panelWidth,
        height: panelHeight,
        zIndex: 545,
        pointerEvents: 'auto',
        overflow: 'visible',
      }}
    >
      <div style={{
        height: infoHeight,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 3,
        paddingLeft: 4,
        color: '#fff7d4',
        fontSize: 13,
        fontWeight: 800,
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        lineHeight: 1.05,
        textShadow: '0 1px 3px rgba(0,0,0,0.9)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}>
        <div style={{ color: fullPoisonActive ? '#ff4a3d' : '#fff7d4' }}>{distanceText}</div>
        <div>{`已刷圈/总圈数: ${displayCircleNumber}/${totalCircles}`}</div>
      </div>
      <div style={{
        height: frameHeight,
        borderRadius: 2,
        background: 'rgba(45, 47, 36, 0.94)',
        border: '1px solid rgba(23, 26, 20, 0.88)',
        boxShadow: '0 10px 24px rgba(0,0,0,0.42)',
        overflow: 'hidden',
      }}>
        <div
          data-ui-drag
          onMouseDown={beginDrag}
          style={{
            height: headerHeight,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '0 7px',
            background: 'rgba(36, 39, 29, 0.98)',
            borderBottom: expanded ? '1px solid rgba(13, 16, 12, 0.86)' : 'none',
            color: '#e6e6dd',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            lineHeight: 1,
            cursor: 'move',
            userSelect: 'none',
          }}
        >
          <span style={{ width: 14, color: '#bed6e2', fontSize: 14, textAlign: 'center' }}>≡</span>
          <button
            type="button"
            aria-label={expanded ? '收起小地图' : '展开小地图'}
            aria-expanded={expanded}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setExpanded((value) => !value)}
            style={{
              marginLeft: 'auto',
              width: 22,
              height: 22,
              border: 'none',
              borderRadius: 2,
              background: 'transparent',
              color: '#c7d8e6',
              fontSize: 15,
              lineHeight: '20px',
              padding: 0,
              cursor: 'pointer',
              fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
            }}
          >{expanded ? '⌃' : '⌄'}</button>
        </div>
        {expanded && (
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display: 'block', margin: chromePadding, pointerEvents: 'none' }}>
            <defs>
              <clipPath id="yumen-minimap-map-clip">
                <rect x={offsetX} y={offsetY} width={renderedWidth} height={renderedHeight} />
              </clipPath>
            </defs>
            <rect x={offsetX} y={offsetY} width={renderedWidth} height={renderedHeight} fill="#c99a58" stroke="rgba(37, 35, 26, 0.78)" strokeWidth="1.5" />
            {hasFutureCircle && (
              <circle
                cx={rawCircleX(Number(safeZone.targetCenterX ?? safeZone.centerX))}
                cy={rawCircleY(Number(safeZone.targetCenterY ?? safeZone.centerY))}
                r={targetRadius}
                fill="none"
                stroke="#22b8ff"
                strokeWidth="3"
                clipPath="url(#yumen-minimap-map-clip)"
              />
            )}
            {hasCurrentCircle && !circlesMerged && (
              <circle
                cx={rawCircleX(Number(safeZone.centerX))}
                cy={rawCircleY(Number(safeZone.centerY))}
                r={currentRadius}
                fill="none"
                stroke={isWaiting ? '#22b8ff' : '#ffd04a'}
                strokeWidth={isWaiting ? '3' : '2.5'}
                strokeDasharray={isWaiting ? undefined : '8 5'}
                clipPath="url(#yumen-minimap-map-clip)"
              />
            )}
            <g transform={`translate(${markerX} ${markerY}) rotate(${markerRotation})`}>
              <path d="M 0 -8.5 C 3.2 -3.4 5.1 1.4 5 5.1 C 2.1 3.8 -2.1 3.8 -5 5.1 C -5.1 1.4 -3.2 -3.4 0 -8.5 Z" fill="#e7df60" stroke="rgba(54, 65, 38, 0.95)" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M 0 -5.5 C 1.3 -2.6 2.1 0.1 2.1 2.1 C 0.9 1.6 -0.9 1.6 -2.1 2.1 C -2.1 0.1 -1.3 -2.6 0 -5.5 Z" fill="rgba(255,255,255,0.42)" />
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

function formatCoordinateText(position: Partial<V3> | null | undefined, fallback: Partial<V3>) {
  const x = Number.isFinite(position?.x) ? Number(position?.x) : Number(fallback.x ?? 0);
  const y = Number.isFinite(position?.y) ? Number(position?.y) : Number(fallback.y ?? 0);
  const z = Number.isFinite(position?.z) ? Number(position?.z) : Number(fallback.z ?? 0);
  return `X ${x.toFixed(2)}  Y ${y.toFixed(2)}  Z ${z.toFixed(2)}`;
}

function formatCameraDashNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function formatCameraDashPosition(position: V3 | null) {
  return position ? formatCoordinateText(position, position) : '-';
}

function FloatingCoordinateDisplay({
  visible,
  positionRef,
  fallbackPosition,
  onCopy,
}: {
  visible: boolean;
  positionRef: React.MutableRefObject<V3>;
  fallbackPosition: Partial<V3>;
  onCopy: () => void;
}) {
  const [text, setText] = useState(() => formatCoordinateText(positionRef.current, fallbackPosition));

  useEffect(() => {
    if (!visible) return;
    const update = () => setText(formatCoordinateText(positionRef.current, fallbackPosition));
    update();
    const id = window.setInterval(update, 100);
    return () => window.clearInterval(id);
  }, [fallbackPosition.x, fallbackPosition.y, fallbackPosition.z, positionRef, visible]);

  if (!visible) return null;

  return (
    <div
      data-ui-interactive
      style={{
        position: 'fixed',
        left: '50%',
        top: 52,
        transform: 'translateX(-50%)',
        zIndex: 991,
        minHeight: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 7px 5px 10px',
        borderRadius: 4,
        border: '1px solid rgba(138, 189, 255, 0.50)',
        background: 'rgba(18, 31, 48, 0.92)',
        color: '#d8ecff',
        fontSize: 12,
        fontWeight: 800,
        pointerEvents: 'auto',
        userSelect: 'text',
      }}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onCopy}
        title="复制坐标"
        aria-label="复制坐标"
        style={{
          width: 26,
          height: 26,
          borderRadius: 4,
          border: '1px solid rgba(138, 189, 255, 0.58)',
          background: 'rgba(39, 69, 105, 0.82)',
          color: '#d8ecff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Clipboard size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}

interface BattleArenaProps {
  me: { userId: string; username?: string; position: Position; hp: number; maxHp?: number; attackDamage?: number; shield?: number; huajinPct?: number; hand: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel; activeDash?: any; targetSelection?: TargetSelection; inCombat?: boolean; combatLinks?: Record<string, { lastActionAt: number }>; consumableCooldowns?: Record<string, { expiresAt: number }>; consumableCounts?: Record<string, number>; globalGcdTicks?: number; visualGcd?: VisualGcdState | null; moveSpeed?: number; tiYunZongPenaltyConsumed?: boolean; yumenDefeated?: boolean; yumenDefeatedAt?: number; specialAbilityStates?: Record<string, any> };
  opponent: { userId: string; username?: string; position: Position; hp: number; maxHp?: number; attackDamage?: number; shield?: number; huajinPct?: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel; targetSelection?: TargetSelection; inCombat?: boolean; combatLinks?: Record<string, { lastActionAt: number }>; yumenDefeated?: boolean; yumenDefeatedAt?: number };
  /** All other players (opponents) — supports 1v1 and N-player modes */
  opponents?: { userId: string; username?: string; position: Position; hp: number; maxHp?: number; attackDamage?: number; shield?: number; huajinPct?: number; hand?: any[]; buffs?: ActiveBuff[]; facing?: Facing; activeChannel?: ActiveChannel; targetSelection?: TargetSelection; inCombat?: boolean; combatLinks?: Record<string, { lastActionAt: number }>; yumenDefeated?: boolean; yumenDefeatedAt?: number }[];
  isAdmin?: boolean;
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
  rtt?: number | null;
  distance: number;
  maxHp: number;
  abilities: Record<string, any>;
  opponentPositionBufferRef?: React.MutableRefObject<Map<string, Array<{ t: number; pos: Position }>>>;
  /** Full game events array from state — used to spawn per-event floating numbers */
  events?: any[];
  /** Pickup items (ability books) currently on the ground */
  pickups?: PickupItem[];
  /** Safe zone state for poison zone rendering */
  safeZone?: SafeZone;
  /** Hard movement boundary for yumen. */
  playArea?: PlayAreaBounds;
  /** Persistent ground damage zones */
  groundZones?: GroundZone[];
  /** HP-bearing targetable entities (e.g. 逐云寒蕊) */
  entities?: TargetEntity[];
  yumenResults?: YumenResults;
  chatMessages?: ChatMessage[];
  onSendChatMessage?: (text: string, channel: ChatChannel) => Promise<{ ok: boolean; error?: string } | void> | { ok: boolean; error?: string } | void;
  onFetchChatMessages?: () => Promise<{ ok: boolean; messages?: ChatMessage[]; error?: string }>;
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
  isAdmin = false,
  gameId,
  onCastAbility,
  onCancelChannel,
  onUseConsumable,
  onTargetSelection,
  onCancelBuff,
  externalGameWarning = null,
  onLeaveGame,
  onMovementRecover,
  rtt = null,
  distance,
  maxHp,
  abilities,
  opponentPositionBufferRef,
  events = [],
  pickups = [],
  safeZone,
  playArea,
  groundZones,
  entities,
  yumenResults,
  chatMessages = [],
  onSendChatMessage,
  onFetchChatMessages,
  mode,
}: BattleArenaProps) {
  const isExportedMap = isExportedMapMode(mode);
  const isYumenMode = isYumen1v1BasicMode(mode);
  const canAccessTestingPanels = !isYumenMode || isAdmin;
  const yumenDefeatedUserIdsFromEvents = useMemo(() => {
    if (!isYumenMode) return new Set<string>();
    const defeatedIds = new Set<string>();
    for (const event of events) {
      if (event?.type === 'YUMEN_DEFEAT') {
        const defeatedUserId = typeof event.defeatedUserId === 'string' ? event.defeatedUserId : event.targetUserId;
        if (typeof defeatedUserId === 'string' && defeatedUserId) defeatedIds.add(defeatedUserId);
      } else if (event?.type === 'YUMEN_REVIVE') {
        const revivedUserId = typeof event.revivedUserId === 'string' ? event.revivedUserId : event.targetUserId;
        if (typeof revivedUserId === 'string' && revivedUserId) defeatedIds.delete(revivedUserId);
      }
    }
    return defeatedIds;
  }, [events, isYumenMode]);
  const mapData = useMemo(() => getMapForMode(mode), [mode]);
  const ARENA_WIDTH  = mode === 'arena' ? ARENA_WIDTH_SMALL  : isExportedMap ? mapData.width : PUBG_WIDTH;
  const ARENA_HEIGHT = mode === 'arena' ? ARENA_HEIGHT_SMALL : isExportedMap ? mapData.height : PUBG_HEIGHT;
  const playerRadius = isExportedMap ? COLLISION_TEST_PLAYER_RADIUS : DEFAULT_PLAYER_RADIUS;
  ensureResizeObserverSupport();

  const crashRecorder = useMemo(() => getClientCrashRecorder(), []);
  const latencyRecorder = useMemo(() => getClientLatencyRecorder(), []);
  const storedUnitScale = getStoredUnitScale(mode);
  const modePickups = useMemo(() => (isExportedMap ? [] : pickups), [isExportedMap, pickups]);
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
  const [localPlayAreaOverride, setLocalPlayAreaOverride] = useState<PlayAreaBounds | null>(null);
  const effectivePlayArea = localPlayAreaOverride ?? playArea;
  const playAreaRef = useRef<PlayAreaBounds | undefined>(playArea);
  const entitiesRef = useRef<TargetEntity[]>(entities ?? []);
  useEffect(() => {
    mapObjectsRef.current = mapData.objects;
  }, [mapData]);
  useEffect(() => {
    entitiesRef.current = entities ?? [];
  }, [entities]);
  useEffect(() => {
    playAreaRef.current = effectivePlayArea;
  }, [effectivePlayArea]);
  useEffect(() => {
    if (!isYumenMode) setLocalPlayAreaOverride(null);
  }, [isYumenMode]);
  useEffect(() => {
    setLocalPlayAreaOverride(null);
  }, [gameId]);
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
  const yumenSpectatorUserIds = useMemo(() => {
    if (!isYumenMode) return new Set<string>();
    const ids = new Set<string>();
    for (const playerEntry of [me, ...opponentsList]) {
      if (!playerEntry?.userId) continue;
      if (hasYumenSpectatorClient(playerEntry.buffs) || playerEntry.yumenDefeated === true) {
        ids.add(playerEntry.userId);
        continue;
      }
      if (yumenDefeatedUserIdsFromEvents.has(playerEntry.userId)) {
        ids.add(playerEntry.userId);
      }
    }
    return ids;
  }, [isYumenMode, me, opponentsList, yumenDefeatedUserIdsFromEvents]);
  const selfHasHongMengTianJin = useMemo(
    () => hasHongMengTianJinClient(me?.buffs),
    [me?.buffs],
  );
  const selfYumenSpectating = useMemo(
    () => isYumenMode && typeof me?.userId === 'string' && yumenSpectatorUserIds.has(me.userId),
    [isYumenMode, me?.userId, yumenSpectatorUserIds],
  );
  const selfHasYumenPrep = isYumenMode && hasYumenPrepClient(me?.buffs);
  const canOpenMartialPanel = !isYumenMode || selfHasYumenPrep;
  const selfHasYumenKuangSha = isYumenMode && hasYumenKuangShaClient(me?.buffs);
  useEffect(() => {
    if (!canOpenMartialPanel) {
      setShowMartialPanel(false);
    }
  }, [canOpenMartialPanel]);
  const worldVisibleOpponentsList = useMemo(
    () => (selfHasHongMengTianJin ? [] : opponentsList),
    [opponentsList, selfHasHongMengTianJin],
  );
  const visibleOpponentsList = useMemo(
    () => worldVisibleOpponentsList.filter((o) => {
      const opponentIsYumenSpectator = typeof o?.userId === 'string' && yumenSpectatorUserIds.has(o.userId);
      if (selfYumenSpectating && opponentIsYumenSpectator) return true;
      return !shouldHideOpponentByStealth(o?.buffs);
    }),
    [selfYumenSpectating, worldVisibleOpponentsList, yumenSpectatorUserIds],
  );
  const targetableOpponentsList = useMemo(
    () => worldVisibleOpponentsList.filter((o) => !blocksTargetingClient(o?.buffs)),
    [worldVisibleOpponentsList],
  );
  const yumenAlivePlayerCount = useMemo(() => {
    if (!isYumenMode) return 0;
    return [me, ...opponentsList].filter((playerEntry) => {
      if (!playerEntry) return false;
      if (typeof playerEntry.userId === 'string' && yumenSpectatorUserIds.has(playerEntry.userId)) return false;
      if (hasYumenSpectatorClient(playerEntry.buffs)) return false;
      return Number(playerEntry.hp ?? 0) > 0;
    }).length;
  }, [isYumenMode, me, opponentsList, yumenSpectatorUserIds]);

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
  const [renderFps,        setRenderFps]        = useState<number | null>(null);
  const [systemTime,       setSystemTime]       = useState(() => new Date());
  const [cooldownClockMs,  setCooldownClockMs]  = useState(() => Date.now());
  const cooldownRuntimePlayerRef = useRef<any>(me);
  cooldownRuntimePlayerRef.current = me;
  const [wasdKeys,         setWasdKeys]         = useState({ w: false, a: false, s: false, d: false });
  const [controlMode,      setControlMode]      = useState<'joystick' | 'traditional'>('traditional');
  // Mobile detection: touch device without fine pointer (mouse) = phone/tablet
  const [isMobileDevice, setIsMobileDevice]    = useState(false);
  const [showCheatWindow,  setShowCheatWindow]  = useState(false);
  const [showCheatAbilityPanelEntry, setShowCheatAbilityPanelEntry] = useState(() => !isYumenMode);
  const [showMartialPanel, setShowMartialPanel] = useState(false);
  const [chatWindows, setChatWindows] = useState<ChatWindowConfig[]>(() => loadChatWindows());
  const [chatMainWindowIds, setChatMainWindowIds] = useState<string[]>(() => loadChatWindows().map((entry) => entry.id));
  const [activeChatWindowId, setActiveChatWindowId] = useState(() => loadActiveChatWindowId(loadChatWindows()));
  const [chatWindowDrafts, setChatWindowDrafts] = useState<ChatWindowConfig[]>(() => loadChatWindows());
  const [selectedChatWindowId, setSelectedChatWindowId] = useState(() => loadActiveChatWindowId(loadChatWindows()));
  const [chatSettingsMainTab, setChatSettingsMainTab] = useState<ChatSettingsMainTab>('page');
  const [chatInputValue, setChatInputValue] = useState('');
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatPanelSize, setChatPanelSize] = useState<ChatPanelSize>({ width: CHAT_PANEL_DEFAULT_WIDTH, height: CHAT_PANEL_DEFAULT_HEIGHT });
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings>(() => loadChatSettings());
  const [chatSettingsDraft, setChatSettingsDraft] = useState<ChatSettings>(() => loadChatSettings());
  const [chatSettingsModalSize, setChatSettingsModalSize] = useState<ChatSettingsModalSize>(() => loadChatSettingsModalSize());
  const [chatClearDialogLayout, setChatClearDialogLayout] = useState<ChatClearDialogLayout>(() => loadChatClearDialogLayout());
  const [detachedChatWindows, setDetachedChatWindows] = useState<DetachedChatWindow[]>([]);
  const [uiLayoutReady, setUiLayoutReady] = useState(false);
  const [detachedChatSearchStates, setDetachedChatSearchStates] = useState<Record<string, ChatSearchState>>({});
  const [detachedChatPanelSizes, setDetachedChatPanelSizes] = useState<Record<string, ChatPanelSize>>({});
  const [detachedChatScrollMetrics, setDetachedChatScrollMetrics] = useState<Record<string, ChatScrollMetrics>>({});
  const [draggingChatGroupId, setDraggingChatGroupId] = useState<string | null>(null);
  const [chatFontMenuOpen, setChatFontMenuOpen] = useState(false);
  const [chatSizeMenuOpen, setChatSizeMenuOpen] = useState(false);
  const [chatScrollMetrics, setChatScrollMetrics] = useState({ scrollTop: 0, scrollHeight: 1, clientHeight: 1 });
  const [chatBottomAlert, setChatBottomAlert] = useState(false);
  const [chatClearDialog, setChatClearDialog] = useState<null | { scope: 'current' | 'all' }>(null);
  const [clearedChatMessageIds, setClearedChatMessageIds] = useState<Record<string, Set<string>>>(() => ({}));
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatSearchInputRef = useRef<HTMLInputElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatSettingsFontRef = useRef<HTMLDivElement>(null);
  const chatSettingsSizeRef = useRef<HTMLDivElement>(null);
  const chatResizeRef = useRef<{ groupId: 'main' | string; positionKey: string | null; startX: number; startY: number; startWidth: number; startHeight: number; startTop: number | null; lockBottom: boolean } | null>(null);
  const chatAtBottomRef = useRef(true);
  const chatDisplayStateRef = useRef({ key: '', length: 0 });
  const detachedChatAtBottomRef = useRef<Record<string, boolean>>({});
  const detachedChatDisplayStateRef = useRef<Record<string, { key: string; length: number }>>({});
  const chatInputCursorEndPendingRef = useRef(false);
  const chatInputCursorPendingRef = useRef<number | null>(null);
  const lastChatSearchFetchKeyRef = useRef('');
  const chatTabClickSuppressedRef = useRef<string | null>(null);
  const detachedChatLogRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const uiLayoutLoadedRef = useRef(false);
  const chatSettingsRef = useRef(chatSettings);
  const chatPanelSizeRef = useRef(chatPanelSize);
  const detachedChatPanelSizesRef = useRef(detachedChatPanelSizes);
  const chatSettingsModalSizeRef = useRef(chatSettingsModalSize);
  const chatClearDialogLayoutRef = useRef(chatClearDialogLayout);
  const chatWindowsRef = useRef(chatWindows);
  const chatMainWindowIdsRef = useRef(chatMainWindowIds);
  const activeChatWindowIdRef = useRef(activeChatWindowId);
  const detachedChatWindowsRef = useRef(detachedChatWindows);
  const selectedChatFont = CHAT_FONT_OPTIONS[0];
  const mainChatWindows = useMemo(() => {
    const byId = new Map(chatWindows.map((entry) => [entry.id, entry]));
    return chatMainWindowIds.map((id) => byId.get(id)).filter((entry): entry is ChatWindowConfig => !!entry && !entry.hidden);
  }, [chatMainWindowIds, chatWindows]);
  const activeChatWindow = useMemo(
    () => mainChatWindows.find((entry) => entry.id === activeChatWindowId) ?? mainChatWindows[0] ?? null,
    [activeChatWindowId, mainChatWindows],
  );
  const activeChatWindowChannels = useMemo(() => new Set<ChatChannel>(activeChatWindow?.channels ?? []), [activeChatWindow]);
  const windowChatMessages = useMemo(
    () => chatMessages.filter((message) => activeChatWindowChannels.has(message.channel)),
    [activeChatWindowChannels, chatMessages],
  );
  const chatSearchActive = chatSearchOpen && chatSearchQuery.trim().length > 0;
  const displayedWindowChatMessages = useMemo(() => {
    if (!activeChatWindow) return [];
    if (chatSearchActive) return windowChatMessages;
    const windowHiddenIds = clearedChatMessageIds[activeChatWindow.id];
    const allHiddenIds = clearedChatMessageIds.all;
    if ((!windowHiddenIds || windowHiddenIds.size === 0) && (!allHiddenIds || allHiddenIds.size === 0)) return windowChatMessages;
    return windowChatMessages.filter((message) => !windowHiddenIds?.has(message.id) && !allHiddenIds?.has(message.id));
  }, [activeChatWindow, windowChatMessages, chatSearchActive, clearedChatMessageIds]);
  const visibleChatMessages = useMemo(() => {
    const query = chatSearchOpen ? chatSearchQuery.trim().toLowerCase() : '';
    if (!query) return displayedWindowChatMessages;
    return displayedWindowChatMessages.filter((message) => {
      return message.text.toLowerCase().includes(query)
        || message.username.toLowerCase().includes(query);
    });
  }, [chatSearchOpen, chatSearchQuery, displayedWindowChatMessages]);
  const buildChatPanelStyle = useCallback((panelSize: ChatPanelSize) => ({
    '--chat-font-family': selectedChatFont.css,
    '--chat-font-size': `${chatSettings.fontSize}px`,
    '--chat-log-bg': `rgba(36, 36, 40, ${(chatSettings.backgroundOpacity / 100) * 0.5})`,
    '--chat-panel-width': `${panelSize.width}px`,
    '--chat-panel-height': `${panelSize.height}px`,
    '--chat-settings-modal-width': `${chatSettingsModalSize.width}px`,
    '--chat-settings-modal-height': `${chatSettingsModalSize.height}px`,
  } as React.CSSProperties), [chatSettings.backgroundOpacity, chatSettings.fontSize, chatSettingsModalSize.height, chatSettingsModalSize.width, selectedChatFont.css]);
  const chatPanelStyle = useMemo(() => buildChatPanelStyle(chatPanelSize), [buildChatPanelStyle, chatPanelSize]);
  useEffect(() => { chatSettingsRef.current = chatSettings; }, [chatSettings]);
  useEffect(() => { chatPanelSizeRef.current = chatPanelSize; }, [chatPanelSize]);
  useEffect(() => { detachedChatPanelSizesRef.current = detachedChatPanelSizes; }, [detachedChatPanelSizes]);
  useEffect(() => { chatSettingsModalSizeRef.current = chatSettingsModalSize; }, [chatSettingsModalSize]);
  useEffect(() => { chatClearDialogLayoutRef.current = chatClearDialogLayout; }, [chatClearDialogLayout]);
  useEffect(() => { chatWindowsRef.current = chatWindows; }, [chatWindows]);
  useEffect(() => { chatMainWindowIdsRef.current = chatMainWindowIds; }, [chatMainWindowIds]);
  useEffect(() => { activeChatWindowIdRef.current = activeChatWindowId; }, [activeChatWindowId]);
  useEffect(() => { detachedChatWindowsRef.current = detachedChatWindows; }, [detachedChatWindows]);
  useEffect(() => {
    const validDetachedIds = new Set(detachedChatWindows.map((entry) => entry.id));
    setDetachedChatSearchStates((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => validDetachedIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setDetachedChatPanelSizes((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => validDetachedIds.has(id))) as Record<string, ChatPanelSize>;
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setDetachedChatScrollMetrics((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => validDetachedIds.has(id))) as Record<string, ChatScrollMetrics>;
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    detachedChatAtBottomRef.current = Object.fromEntries(Object.entries(detachedChatAtBottomRef.current).filter(([id]) => validDetachedIds.has(id)));
    detachedChatDisplayStateRef.current = Object.fromEntries(Object.entries(detachedChatDisplayStateRef.current).filter(([id]) => validDetachedIds.has(id)));
  }, [detachedChatWindows]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify(chatSettings));
    } catch {}
  }, [chatSettings]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SETTINGS_MODAL_SIZE_STORAGE_KEY, JSON.stringify(chatSettingsModalSize));
    } catch {}
  }, [chatSettingsModalSize]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_CLEAR_DIALOG_LAYOUT_STORAGE_KEY, JSON.stringify(chatClearDialogLayout));
    } catch {}
  }, [chatClearDialogLayout]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_WINDOWS_STORAGE_KEY, JSON.stringify(chatWindows));
    } catch {}
  }, [chatWindows]);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_ACTIVE_WINDOW_STORAGE_KEY, activeChatWindowId);
    } catch {}
  }, [activeChatWindowId]);
  useEffect(() => {
    if (mainChatWindows.length === 0 || mainChatWindows.some((entry) => entry.id === activeChatWindowId)) return;
    setActiveChatWindowId(mainChatWindows[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id);
  }, [activeChatWindowId, mainChatWindows]);
  const updateChatScrollMetrics = useCallback(() => {
    const log = chatLogRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= 2;
    chatAtBottomRef.current = atBottom;
    if (atBottom) {
      setChatBottomAlert(false);
    }
    setChatScrollMetrics({
      scrollTop: log.scrollTop,
      scrollHeight: Math.max(1, log.scrollHeight),
      clientHeight: Math.max(1, log.clientHeight),
    });
  }, []);
  const updateDetachedChatScrollMetrics = useCallback((detachedId: string) => {
    const log = detachedChatLogRefs.current[detachedId];
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= 2;
    detachedChatAtBottomRef.current[detachedId] = atBottom;
    setDetachedChatScrollMetrics((current) => ({
      ...current,
      [detachedId]: {
        scrollTop: log.scrollTop,
        scrollHeight: Math.max(1, log.scrollHeight),
        clientHeight: Math.max(1, log.clientHeight),
      },
    }));
  }, []);
  const getChatScrollVisual = useCallback((metrics: ChatScrollMetrics) => {
    const canScroll = metrics.scrollHeight > metrics.clientHeight + 2;
    const isAtTop = metrics.scrollTop <= 2;
    const isAtBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 2;
    const thumbHeightPct = Math.max(12, Math.min(100, (metrics.clientHeight / metrics.scrollHeight) * 100));
    const thumbTopPct = canScroll
      ? Math.min(100 - thumbHeightPct, (metrics.scrollTop / Math.max(1, metrics.scrollHeight - metrics.clientHeight)) * (100 - thumbHeightPct))
      : 0;
    return { canScroll, isAtTop, isAtBottom, thumbHeightPct, thumbTopPct };
  }, []);
  const beginChatScrollTrackDrag = useCallback((groupId: 'main' | string, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget;
    const getLog = () => groupId === 'main' ? chatLogRef.current : detachedChatLogRefs.current[groupId];
    const applyScroll = (clientY: number) => {
      const log = getLog();
      if (!log) return;
      const rect = track.getBoundingClientRect();
      const scrollable = Math.max(1, log.scrollHeight - log.clientHeight);
      const thumbHeight = Math.max(10, Math.min(rect.height, (log.clientHeight / Math.max(1, log.scrollHeight)) * rect.height));
      const maxThumbTop = Math.max(1, rect.height - thumbHeight);
      const nextThumbTop = Math.max(0, Math.min(maxThumbTop, clientY - rect.top - thumbHeight / 2));
      log.scrollTop = (nextThumbTop / maxThumbTop) * scrollable;
      if (groupId === 'main') updateChatScrollMetrics();
      else updateDetachedChatScrollMetrics(groupId);
    };
    applyScroll(event.clientY);
    const handleMove = (moveEvent: PointerEvent) => applyScroll(moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, [updateChatScrollMetrics, updateDetachedChatScrollMetrics]);
  useEffect(() => {
    const log = chatLogRef.current;
    if (!log || !activeChatWindow) return;
    const displayKey = activeChatWindow.id;
    const previous = chatDisplayStateRef.current;
    const keyChanged = previous.key !== displayKey;
    const lengthIncreased = visibleChatMessages.length > previous.length;
    const shouldScrollBottom = keyChanged || (lengthIncreased && !chatSearchActive && chatAtBottomRef.current);

    if (shouldScrollBottom) {
      log.scrollTop = log.scrollHeight;
      chatAtBottomRef.current = true;
      setChatBottomAlert(false);
    } else if (lengthIncreased && !chatSearchActive) {
      setChatBottomAlert(true);
    }

    chatDisplayStateRef.current = { key: displayKey, length: visibleChatMessages.length };
    updateChatScrollMetrics();
  }, [activeChatWindow, chatSearchActive, updateChatScrollMetrics, visibleChatMessages.length]);
  useEffect(() => {
    if (!chatSearchOpen) return;
    window.requestAnimationFrame(() => chatSearchInputRef.current?.focus());
  }, [chatSearchOpen]);
  useEffect(() => {
    if (!chatSearchOpen) {
      lastChatSearchFetchKeyRef.current = '';
    }
  }, [chatSearchOpen]);
  useEffect(() => {
    const query = chatSearchQuery.trim();
    if (!activeChatWindow || !chatSearchOpen || !query || !onFetchChatMessages) return;
    const fetchKey = `${activeChatWindow.id}:${query}`;
    if (lastChatSearchFetchKeyRef.current === fetchKey) return;
    const timer = window.setTimeout(() => {
      lastChatSearchFetchKeyRef.current = fetchKey;
      void onFetchChatMessages().then((result) => {
        if (result?.ok) {
          setClearedChatMessageIds({});
        }
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeChatWindow, chatSearchOpen, chatSearchQuery, onFetchChatMessages]);
  useEffect(() => {
    const moveToEnd = chatInputCursorEndPendingRef.current;
    const moveToCursor = chatInputCursorPendingRef.current;
    if (!moveToEnd && moveToCursor === null) return;
    chatInputCursorEndPendingRef.current = false;
    chatInputCursorPendingRef.current = null;
    window.requestAnimationFrame(() => {
      const input = chatInputRef.current;
      if (!input) return;
      input.focus();
      if (moveToEnd) {
        const end = input.value.length;
        input.setSelectionRange(end, end);
        return;
      }
      if (moveToCursor !== null) {
        const clamped = Math.max(0, Math.min(moveToCursor, input.value.length));
        input.setSelectionRange(clamped, clamped);
      }
    });
  }, [chatInputValue]);
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = chatResizeRef.current;
      if (!resize) return;
      const maxWidth = Math.max(1, Math.round(window.innerWidth * 0.6));
      const maxHeight = Math.max(1, Math.round(window.innerHeight * 0.8));
      const nextWidth = Math.min(maxWidth, Math.max(120, resize.startWidth + event.clientX - resize.startX));
      const nextHeight = Math.min(maxHeight, Math.max(92, resize.startHeight - (event.clientY - resize.startY)));
      if (resize.groupId === 'main') {
        setChatPanelSize({ width: nextWidth, height: nextHeight });
      } else {
        setDetachedChatPanelSizes((current) => ({
          ...current,
          [resize.groupId]: { width: nextWidth, height: nextHeight },
        }));
      }
      if (resize.lockBottom && resize.startTop !== null) {
        const nextTop = Math.max(12, Math.round(resize.startTop + resize.startHeight - nextHeight));
        setUiPositions((current) => {
          const next = {
            ...current,
            [resize.positionKey ?? CHAT_PANEL_UI_KEY]: {
              left: current[resize.positionKey ?? CHAT_PANEL_UI_KEY]?.left ?? 10,
              top: nextTop,
            },
          };
          uiPositionsRef.current = next;
          return next;
        });
      }
    };
    const handlePointerUp = () => {
      chatResizeRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);
  useEffect(() => {
    if (!showChatSettings || (!chatFontMenuOpen && !chatSizeMenuOpen)) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (chatFontMenuOpen && chatSettingsFontRef.current && !chatSettingsFontRef.current.contains(target)) {
        setChatFontMenuOpen(false);
      }
      if (chatSizeMenuOpen && chatSettingsSizeRef.current && !chatSettingsSizeRef.current.contains(target)) {
        setChatSizeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [chatFontMenuOpen, chatSizeMenuOpen, showChatSettings]);
  const focusChatInput = useCallback(() => {
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  }, []);
  const copyMessageToChatInput = useCallback((text: string) => {
    chatInputCursorEndPendingRef.current = true;
    setChatInputValue(text.slice(0, CHAT_MAX_INPUT_LENGTH));
  }, []);
  const appendAbilityNameToChatInput = useCallback((abilityName: string) => {
    chatInputCursorEndPendingRef.current = true;
    const tag = `[${abilityName}]`;
    setChatInputValue((current) => (current + tag).slice(0, CHAT_MAX_INPUT_LENGTH));
  }, []);
  const scrollChatLog = useCallback((target: 'up' | 'top' | 'down' | 'bottom') => {
    const log = chatLogRef.current;
    if (!log) return;
    const page = Math.max(24, Math.round(log.clientHeight * 0.8));
    const nextTop = target === 'top'
      ? 0
      : target === 'bottom'
      ? log.scrollHeight
      : target === 'up'
      ? log.scrollTop - page
      : log.scrollTop + page;
    log.scrollTo({ top: nextTop, behavior: target === 'top' || target === 'bottom' ? 'auto' : 'smooth' });
    window.requestAnimationFrame(updateChatScrollMetrics);
    if (target === 'bottom') {
      setChatBottomAlert(false);
    }
  }, [updateChatScrollMetrics]);
  const scrollDetachedChatLog = useCallback((detachedId: string, target: 'up' | 'top' | 'down' | 'bottom') => {
    const log = detachedChatLogRefs.current[detachedId];
    if (!log) return;
    const page = Math.max(24, Math.round(log.clientHeight * 0.8));
    const nextTop = target === 'top'
      ? 0
      : target === 'bottom'
      ? log.scrollHeight
      : target === 'up'
      ? log.scrollTop - page
      : log.scrollTop + page;
    log.scrollTo({ top: nextTop, behavior: target === 'top' || target === 'bottom' ? 'auto' : 'smooth' });
    if (target === 'bottom') {
      detachedChatAtBottomRef.current[detachedId] = true;
    }
    window.requestAnimationFrame(() => updateDetachedChatScrollMetrics(detachedId));
  }, [updateDetachedChatScrollMetrics]);
  const getVisibleChatMessagesForWindow = useCallback((windowConfig: ChatWindowConfig, searchState?: ChatSearchState) => {
    const channels = new Set<ChatChannel>(windowConfig.channels);
    let messages = chatMessages.filter((message) => channels.has(message.channel));
    const activeSearch = searchState ?? { open: chatSearchOpen, query: chatSearchQuery };
    const query = activeSearch.query.trim().toLowerCase();
    if (!activeSearch.open || !query) {
      const windowHiddenIds = clearedChatMessageIds[windowConfig.id];
      const allHiddenIds = clearedChatMessageIds.all;
      if (windowHiddenIds?.size || allHiddenIds?.size) {
        messages = messages.filter((message) => !windowHiddenIds?.has(message.id) && !allHiddenIds?.has(message.id));
      }
      return messages;
    }
    return messages.filter((message) => (
      message.text.toLowerCase().includes(query)
      || message.username.toLowerCase().includes(query)
    ));
  }, [chatMessages, chatSearchOpen, chatSearchQuery, clearedChatMessageIds]);
  useLayoutEffect(() => {
    if (detachedChatWindows.length === 0) return;
    const followUpFrames: number[] = [];
    for (const detachedWindow of detachedChatWindows) {
      const log = detachedChatLogRefs.current[detachedWindow.id];
      if (!log) continue;
      const activeWindowConfig = chatWindows.find((entry) => entry.id === detachedWindow.activeWindowId && !entry.hidden)
        ?? chatWindows.find((entry) => detachedWindow.windowIds.includes(entry.id) && !entry.hidden)
        ?? null;
      if (!activeWindowConfig) continue;
      const searchState = detachedChatSearchStates[detachedWindow.id] ?? EMPTY_CHAT_SEARCH_STATE;
      const messages = getVisibleChatMessagesForWindow(activeWindowConfig, searchState);
      const displayKey = `${detachedWindow.id}:${activeWindowConfig.id}:${searchState.open ? searchState.query.trim() : ''}`;
      const previous = detachedChatDisplayStateRef.current[detachedWindow.id] ?? { key: '', length: 0 };
      const keyChanged = previous.key !== displayKey;
      const lengthIncreased = messages.length > previous.length;
      const wasAtBottom = detachedChatAtBottomRef.current[detachedWindow.id] ?? true;
      const shouldStickToBottom = keyChanged || (lengthIncreased && wasAtBottom);

      if (shouldStickToBottom) {
        log.scrollTop = log.scrollHeight;
        detachedChatAtBottomRef.current[detachedWindow.id] = true;
        followUpFrames.push(window.requestAnimationFrame(() => {
          const latestLog = detachedChatLogRefs.current[detachedWindow.id];
          if (!latestLog) return;
          latestLog.scrollTop = latestLog.scrollHeight;
          detachedChatAtBottomRef.current[detachedWindow.id] = true;
          updateDetachedChatScrollMetrics(detachedWindow.id);
        }));
      } else {
        updateDetachedChatScrollMetrics(detachedWindow.id);
      }
      detachedChatDisplayStateRef.current[detachedWindow.id] = { key: displayKey, length: messages.length };
    }
    return () => followUpFrames.forEach((frame) => window.cancelAnimationFrame(frame));
  }, [chatWindows, detachedChatWindows, detachedChatSearchStates, getVisibleChatMessagesForWindow, updateDetachedChatScrollMetrics]);
  const openChatSettings = useCallback(() => {
    setChatSettingsDraft(chatSettings);
    setChatWindowDrafts(chatWindows.map((entry) => ({ ...entry, channels: [...entry.channels] })));
    setSelectedChatWindowId(activeChatWindow?.id ?? chatWindows.find((entry) => !entry.hidden)?.id ?? chatWindows[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id);
    setChatSettingsMainTab('page');
    setChatFontMenuOpen(false);
    setChatSizeMenuOpen(false);
    setShowChatSettings(true);
  }, [activeChatWindow, chatSettings, chatWindows]);
  const applyChatSettings = useCallback(() => {
    setChatSettings(normalizeChatSettings(chatSettingsDraft));
    const normalizedWindows = normalizeChatWindows(chatWindowDrafts);
    setChatWindows(normalizedWindows);
    if (!normalizedWindows.some((entry) => entry.id === activeChatWindowId && !entry.hidden)) {
      setActiveChatWindowId(normalizedWindows.find((entry) => !entry.hidden)?.id ?? normalizedWindows[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id);
    }
  }, [activeChatWindowId, chatSettingsDraft, chatWindowDrafts]);
  const confirmChatSettings = useCallback(() => {
    setChatSettings(normalizeChatSettings(chatSettingsDraft));
    const normalizedWindows = normalizeChatWindows(chatWindowDrafts);
    setChatWindows(normalizedWindows);
    if (!normalizedWindows.some((entry) => entry.id === activeChatWindowId && !entry.hidden)) {
      setActiveChatWindowId(normalizedWindows.find((entry) => !entry.hidden)?.id ?? normalizedWindows[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id);
    }
    setShowChatSettings(false);
  }, [activeChatWindowId, chatSettingsDraft, chatWindowDrafts]);
  const cancelChatSettings = useCallback(() => {
    setChatSettingsDraft(chatSettings);
    setChatWindowDrafts(chatWindows.map((entry) => ({ ...entry, channels: [...entry.channels] })));
    setShowChatSettings(false);
  }, [chatSettings, chatWindows]);
  const resetChatSettings = useCallback(() => {
    if (chatSettingsMainTab === 'window') {
      const defaults = DEFAULT_CHAT_WINDOWS.map((entry) => ({ ...entry, channels: [...entry.channels] }));
      setChatWindowDrafts(defaults);
      setChatWindows(defaults);
      setSelectedChatWindowId(defaults[0].id);
      setActiveChatWindowId(defaults[0].id);
      return;
    }
    setChatSettingsDraft(DEFAULT_CHAT_SETTINGS);
    setChatSettings(DEFAULT_CHAT_SETTINGS);
  }, [chatSettingsMainTab]);
  const setSelectedChatWindowAsDefault = useCallback(() => {
    if (!chatWindowDrafts.some((entry) => entry.id === selectedChatWindowId)) return;
    setChatWindowDrafts((current) => current.map((entry) => entry.id === selectedChatWindowId ? { ...entry, hidden: undefined } : entry));
    setActiveChatWindowId(selectedChatWindowId);
  }, [chatWindowDrafts, selectedChatWindowId]);
  const createChatWindow = useCallback(() => {
    setChatWindowDrafts((current) => {
      if (current.length >= 8) return current;
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const next = [...current, { id, name: `窗口${current.length + 1}`, channels: [] as ChatChannel[] }];
      setSelectedChatWindowId(id);
      return next;
    });
  }, []);
  const deleteSelectedChatWindow = useCallback(() => {
    setChatWindowDrafts((current) => {
      const selected = current.find((entry) => entry.id === selectedChatWindowId);
      if (!selected || selected.lockedDelete) return current;
      const next = current.filter((entry) => entry.id !== selectedChatWindowId);
      setSelectedChatWindowId(next[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id);
      return next;
    });
  }, [selectedChatWindowId]);
  const clearChatMessages = useCallback((scope: 'current' | 'all') => {
    if (!activeChatWindow) return;
    setClearedChatMessageIds((current) => {
      if (scope === 'all') {
        return {
          ...current,
          all: new Set([...(current.all ?? []), ...chatMessages.map((message) => message.id)]),
        };
      }
      return {
        ...current,
        [activeChatWindow.id]: new Set([...(current[activeChatWindow.id] ?? []), ...windowChatMessages.map((message) => message.id)]),
      };
    });
    setChatBottomAlert(false);
  }, [activeChatWindow, chatMessages, windowChatMessages]);
  const handleChatEraseClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.altKey) {
      clearChatMessages('all');
      return;
    }
    if (event.ctrlKey) {
      clearChatMessages('current');
      return;
    }
    setChatClearDialog({ scope: 'current' });
  }, [clearChatMessages]);
  const confirmChatClear = useCallback(() => {
    if (chatClearDialog) {
      clearChatMessages(chatClearDialog.scope);
    }
    setChatClearDialog(null);
  }, [chatClearDialog, clearChatMessages]);
  const sendChatText = useCallback(async (rawText: string, channel: ChatChannel, restoreOnFailure: boolean) => {
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_INPUT_LENGTH);
    if (!text) return false;
    const result = await onSendChatMessage?.(text, channel);
    if (result && result.ok === false) {
      if (restoreOnFailure) {
        setChatInputValue(text);
        focusChatInput();
      }
      return false;
    }
    return true;
  }, [focusChatInput, onSendChatMessage]);
  const beginChatResize = useCallback((groupId: 'main' | string, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest(`.${styles.chatPanel}`) as HTMLDivElement | null;
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const lockBottom = panel?.style.bottom === 'auto';
    const startTop = wrapRect && panelRect ? Math.round(panelRect.top - wrapRect.top) : null;
    const startSize = groupId === 'main'
      ? chatPanelSizeRef.current
      : (detachedChatPanelSizesRef.current[groupId] ?? chatPanelSizeRef.current);
    chatResizeRef.current = {
      groupId,
      positionKey: groupId === 'main' ? CHAT_PANEL_UI_KEY : getDetachedChatWindowUiKey(groupId),
      startX: event.clientX,
      startY: event.clientY,
      startWidth: startSize.width,
      startHeight: startSize.height,
      startTop,
      lockBottom,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);
  const [martialPanelTab, setMartialPanelTab] = useState<'jianghu' | 'jujing'>(() => {
    try {
      if (typeof window === 'undefined') return 'jianghu';
      const stored = localStorage.getItem(MARTIAL_PANEL_TAB_STORAGE_KEY);
      return stored === 'jujing' || stored === 'jianghu' ? stored : 'jianghu';
    } catch {
      return 'jianghu';
    }
  });
  const [martialSearch, setMartialSearch] = useState('');
  const [martialRarityFilter, setMartialRarityFilter] = useState('all');
  const [martialSchoolFilter, setMartialSchoolFilter] = useState('all');
  const [martialEmpoweredOnly, setMartialEmpoweredOnly] = useState(false);
  const [martialRarityOpen, setMartialRarityOpen] = useState(false);
  const [martialSchoolOpen, setMartialSchoolOpen] = useState(false);
  const [martialPresetPlans, setMartialPresetPlans] = useState<MartialPresetPlan[]>([]);
  const [martialPresetApplying, setMartialPresetApplying] = useState(false);
  const [martialPresetSaving, setMartialPresetSaving] = useState(false);
  const [martialPresetModal, setMartialPresetModal] = useState<MartialPresetModalState>(null);
  const [martialPresetDropHover, setMartialPresetDropHover] = useState<MartialPresetDropHover>(null);
  const [martialAbilityRowOffset, setMartialAbilityRowOffset] = useState(0);
  const [martialPresetPlanOffset, setMartialPresetPlanOffset] = useState(0);
  const [martialPanelTempPos, setMartialPanelTempPos] = useState<UiPosition | null>(null);
  const martialPanelTempPosRef = useRef<UiPosition | null>(null);
  const martialRarityRef = useRef<HTMLDivElement>(null);
  const martialSchoolRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!martialRarityOpen && !martialSchoolOpen) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (martialRarityOpen && martialRarityRef.current && !martialRarityRef.current.contains(target)) {
        setMartialRarityOpen(false);
      }
      if (martialSchoolOpen && martialSchoolRef.current && !martialSchoolRef.current.contains(target)) {
        setMartialSchoolOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [martialRarityOpen, martialSchoolOpen]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/game/martial-presets', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text().catch(() => '加载预设招式失败'));
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setMartialPresetPlans(normalizeMartialPresetPlans(data?.plans));
      })
      .catch((err) => {
        if (!cancelled) console.error('[MartialPanel] load presets failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistMartialPresetPlans = useCallback(async (plans: MartialPresetPlan[]) => {
    const normalizedPlans = normalizeMartialPresetPlans(plans);
    setMartialPresetSaving(true);
    try {
      const res = await fetch('/api/game/martial-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plans: normalizedPlans }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? err?.error ?? '保存预设招式失败');
      }
      const data = await res.json().catch(() => ({}));
      const savedPlans = normalizeMartialPresetPlans(data?.plans ?? normalizedPlans);
      setMartialPresetPlans(savedPlans);
      return savedPlans;
    } catch (err: any) {
      console.error('[MartialPanel] save presets failed:', err);
      toastError(err?.message ?? '保存预设招式失败');
      return null;
    } finally {
      setMartialPresetSaving(false);
    }
  }, []);

  const openAbilityHint = useCallback((anchorRect: DOMRect, ability: AbilityInfo) => {
    if (abilityDragActiveRef.current) return;
    setActiveAbilityHint({ anchorRect, ability });
  }, []);

  const closeAbilityHint = useCallback(() => {
    setActiveAbilityHint(null);
  }, []);

  useEffect(() => {
    if (!showMartialPanel) closeAbilityHint();
  }, [closeAbilityHint, showMartialPanel]);

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
  const [yumenBoundaryEditMode, setYumenBoundaryEditMode] = useState(false);
  const [yumenDamageMode, setYumenDamageMode] = useState<'test' | 'full'>(() => {
    try {
      if (typeof window === 'undefined') return 'test';
      return localStorage.getItem(YUMEN_DAMAGE_MODE_STORAGE_KEY) === 'full' ? 'full' : 'test';
    } catch {
      return 'test';
    }
  });
  const [yumenAutoFullShrink, setYumenAutoFullShrink] = useState(false);
  const yumenBoundaryEditModeRef = useRef(false);
  const yumenAutoFullShrinkStartedRef = useRef<string | null>(null);
  const [showHeartDetailsPanel, setShowHeartDetailsPanel] = useState(false);
  const [showHeartStatSettings, setShowHeartStatSettings] = useState(false);
  const [showCombatPresetBar, setShowCombatPresetBar] = useState(false);
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
    yumenBoundaryEditModeRef.current = yumenBoundaryEditMode;
  }, [yumenBoundaryEditMode]);
  useEffect(() => {
    if (!isYumenMode && yumenBoundaryEditMode) setYumenBoundaryEditMode(false);
  }, [isYumenMode, yumenBoundaryEditMode]);
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      setYumenAutoFullShrink(localStorage.getItem(YUMEN_AUTO_FULL_SHRINK_STORAGE_KEY) === '1');
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(YUMEN_DAMAGE_MODE_STORAGE_KEY, yumenDamageMode);
    } catch {}
  }, [yumenDamageMode]);
  useEffect(() => {
    try {
      localStorage.setItem(YUMEN_AUTO_FULL_SHRINK_STORAGE_KEY, yumenAutoFullShrink ? '1' : '0');
    } catch {}
  }, [yumenAutoFullShrink]);
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
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(() => loadCameraSettings());
  useEffect(() => {
    try {
      localStorage.setItem(CAMERA_SETTINGS_STORAGE_KEY, JSON.stringify(cameraSettings));
    } catch {}
  }, [cameraSettings]);
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
  const [martialPanelWidth, setMartialPanelWidth] = useState(MARTIAL_PANEL_DEFAULT_WIDTH);
  const [martialPanelHeight, setMartialPanelHeight] = useState(MARTIAL_PANEL_DEFAULT_HEIGHT);
  const [martialPresetPanelWidth, setMartialPresetPanelWidth] = useState(MARTIAL_PRESET_PANEL_DEFAULT_WIDTH);
  const [martialModalWidth, setMartialModalWidth] = useState(MARTIAL_MODAL_DEFAULT_WIDTH);
  const [martialModalHeight, setMartialModalHeight] = useState(MARTIAL_MODAL_DEFAULT_HEIGHT);
  const martialFavoriteStorageKey = useMemo(
    () => `${MARTIAL_FAVORITE_ORDER_STORAGE_KEY}:${me.userId || 'guest'}`,
    [me.userId],
  );
  const [martialFavoriteMode, setMartialFavoriteMode] = useState(false);
  const [martialFavoriteOrder, setMartialFavoriteOrder] = useState<string[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const accountValue = localStorage.getItem(`${MARTIAL_FAVORITE_ORDER_STORAGE_KEY}:${me.userId || 'guest'}`);
      if (accountValue) {
        return normalizeMartialFavoriteOrder(JSON.parse(accountValue));
      }
      return normalizeMartialFavoriteOrder(JSON.parse(localStorage.getItem(MARTIAL_FAVORITE_ORDER_STORAGE_KEY) ?? '[]'));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(martialFavoriteStorageKey, JSON.stringify(martialFavoriteOrder));
    } catch {}
  }, [martialFavoriteOrder, martialFavoriteStorageKey]);
  useEffect(() => {
    try {
      const accountValue = localStorage.getItem(martialFavoriteStorageKey);
      if (accountValue) {
        setMartialFavoriteOrder(normalizeMartialFavoriteOrder(JSON.parse(accountValue)));
        return;
      }
      const legacyValue = localStorage.getItem(MARTIAL_FAVORITE_ORDER_STORAGE_KEY);
      const normalized = normalizeMartialFavoriteOrder(JSON.parse(legacyValue ?? '[]'));
      setMartialFavoriteOrder(normalized);
      localStorage.setItem(martialFavoriteStorageKey, JSON.stringify(normalized));
    } catch {
      setMartialFavoriteOrder([]);
    }
  }, [martialFavoriteStorageKey]);
  const [showMartialPresetPanel, setShowMartialPresetPanel] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      return localStorage.getItem(MARTIAL_PRESET_PANEL_OPEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(MARTIAL_PRESET_PANEL_OPEN_STORAGE_KEY, showMartialPresetPanel ? '1' : '0');
    } catch {}
  }, [showMartialPresetPanel]);
  useEffect(() => {
    try {
      localStorage.setItem(MARTIAL_PANEL_TAB_STORAGE_KEY, martialPanelTab);
    } catch {}
  }, [martialPanelTab]);
  useEffect(() => {
    if (!showCheatAbilityPanelEntry) {
      setShowCheatWindow(false);
    }
  }, [showCheatAbilityPanelEntry]);
  useEffect(() => {
    if (!showCombatPresetBar) {
      setShowCombatPresetPanel(false);
    }
  }, [showCombatPresetBar]);
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
  const inGameWarningTimerRef = useRef<number | null>(null);
  const inGameWarningSeqRef = useRef(0);
  const [activeYumenDefeatNotice, setActiveYumenDefeatNotice] = useState<YumenDefeatNotice | null>(null);
  const yumenDefeatNoticeTimerRef = useRef<number | null>(null);
  const [activeYumenKillConfirm, setActiveYumenKillConfirm] = useState<YumenKillConfirmNotice | null>(null);
  const yumenKillConfirmTimerRef = useRef<number | null>(null);
  const yumenResultAutoLeaveKeyRef = useRef<number | null>(null);
  const [yumenKillNoticeSize, setYumenKillNoticeSize] = useState<YumenHudSize>(() => loadYumenHudSize(
    YUMEN_KILL_NOTICE_SIZE_STORAGE_KEY,
    { width: YUMEN_KILL_NOTICE_BASE_WIDTH, height: YUMEN_KILL_NOTICE_BASE_HEIGHT },
    normalizeYumenKillNoticeWidth,
    normalizeYumenKillNoticeHeight,
  ));
  const [yumenKillConfirmSize, setYumenKillConfirmSize] = useState<YumenHudSize>(() => loadYumenHudSize(
    YUMEN_KILL_CONFIRM_SIZE_STORAGE_KEY,
    { width: YUMEN_KILL_CONFIRM_BASE_WIDTH, height: YUMEN_KILL_CONFIRM_BASE_HEIGHT },
    normalizeYumenKillConfirmWidth,
    normalizeYumenKillConfirmHeight,
  ));
  const [yumenAliveCountSize, setYumenAliveCountSize] = useState<YumenHudSize>(() => loadYumenHudSize(
    YUMEN_ALIVE_COUNT_SIZE_STORAGE_KEY,
    { width: YUMEN_ALIVE_COUNT_BASE_WIDTH, height: YUMEN_ALIVE_COUNT_BASE_HEIGHT },
    normalizeYumenAliveCountWidth,
    normalizeYumenAliveCountHeight,
  ));

  useEffect(() => {
    try {
      localStorage.setItem(YUMEN_KILL_NOTICE_SIZE_STORAGE_KEY, JSON.stringify(yumenKillNoticeSize));
    } catch {}
  }, [yumenKillNoticeSize]);

  useEffect(() => {
    try {
      localStorage.setItem(YUMEN_KILL_CONFIRM_SIZE_STORAGE_KEY, JSON.stringify(yumenKillConfirmSize));
    } catch {}
  }, [yumenKillConfirmSize]);

  useEffect(() => {
    try {
      localStorage.setItem(YUMEN_ALIVE_COUNT_SIZE_STORAGE_KEY, JSON.stringify(yumenAliveCountSize));
    } catch {}
  }, [yumenAliveCountSize]);

  useEffect(() => {
    const id = window.setInterval(() => setSystemTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isYumenMode || !yumenResults?.autoLeaveAt) return;
    const endedAt = Number(yumenResults.endedAt ?? 0);
    if (yumenResultAutoLeaveKeyRef.current === endedAt) return;
    if (systemTime.getTime() < yumenResults.autoLeaveAt) return;
    yumenResultAutoLeaveKeyRef.current = endedAt;
    void onLeaveGame?.();
  }, [isYumenMode, onLeaveGame, systemTime, yumenResults?.autoLeaveAt, yumenResults?.endedAt]);

  useEffect(() => {
    let disposed = false;
    let frameId = 0;
    let timeoutId = 0;

    const clearScheduled = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = 0;
      }
    };

    const schedule = () => {
      clearScheduled();
      const nowMs = Date.now();
      if (playerHasRuntimeCountdown(cooldownRuntimePlayerRef.current, nowMs)) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        timeoutId = window.setTimeout(tick, COOLDOWN_IDLE_CLOCK_INTERVAL_MS);
      }
    };

    const tick = () => {
      if (disposed) return;
      setCooldownClockMs(Date.now());
      schedule();
    };

    schedule();
    return () => {
      disposed = true;
      clearScheduled();
    };
  }, []);

  useEffect(() => {
    if (playerHasRuntimeCountdown(me, Date.now())) {
      setCooldownClockMs(Date.now());
    }
  }, [me.activeDash, me.globalGcdTicks, me.hand, me.specialAbilityStates]);

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
  const [martialDragHoverIndex, setMartialDragHoverIndex] = useState<number | null>(null);
  const [dragHoverItemIndex, setDragHoverItemIndex] = useState<number | null>(null);
  const [discardZoneHover, setDiscardZoneHover] = useState(false);
  const [itemBarAbilities, setItemBarAbilities] = useState<Array<AbilityInfo | undefined>>(() => createEmptyItemBarSlots());
  const itemBarAbilitiesRef = useRef<Array<AbilityInfo | undefined>>(createEmptyItemBarSlots());
  const [stableLearnedDraftAbilities, setStableLearnedDraftAbilities] = useState<Array<AbilityInfo | undefined>>(() => Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }));
  const [consumableBarSettings, setConsumableBarSettings] = useState<ConsumableBarSettings>(() => loadConsumableBarSettings());
  const [savedHotkeySettings, setSavedHotkeySettings] = useState<HotkeySettings>(() => loadHotkeySettings());
  const [hotkeySettings, setHotkeySettings] = useState<HotkeySettings>(() => loadHotkeySettings());
  const [hotkeySettingsTab, setHotkeySettingsTab] = useState<HotkeyTabId>('character-action');
  const [capturingHotkey, setCapturingHotkey] = useState<HotkeyCaptureTarget>(null);
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
        const accountPositions = Object.fromEntries(
          Object.entries(positions).filter(([key]) => key !== CHAT_CLEAR_DIALOG_UI_KEY)
        );

        uiPositionsRef.current = accountPositions;
        setUiPositions(accountPositions);
        if (payload.chat) {
          chatPanelSizeRef.current = payload.chat.panelSize;
          setChatPanelSize(payload.chat.panelSize);
          if (payload.chat.settings) {
            chatSettingsRef.current = payload.chat.settings;
            setChatSettings(payload.chat.settings);
            setChatSettingsDraft(payload.chat.settings);
          }
          if (payload.chat.settingsModalSize) {
            chatSettingsModalSizeRef.current = payload.chat.settingsModalSize;
            setChatSettingsModalSize(payload.chat.settingsModalSize);
          }
          if (payload.chat.windows) {
            const accountWindows = payload.chat.windows;
            const accountDetachedWindows = normalizeDetachedChatWindows(payload.chat.detachedWindows, accountWindows);
            chatWindowsRef.current = accountWindows;
            setChatWindows(accountWindows);
            detachedChatWindowsRef.current = accountDetachedWindows;
            setDetachedChatWindows(accountDetachedWindows);
            const accountActiveWindowId = payload.chat.activeWindowId
              ? normalizeActiveChatWindowId(payload.chat.activeWindowId, accountWindows)
              : accountWindows[0]?.id ?? DEFAULT_CHAT_WINDOWS[0].id;
            activeChatWindowIdRef.current = accountActiveWindowId;
            setActiveChatWindowId(accountActiveWindowId);
            setChatWindowDrafts(accountWindows.map((entry) => ({ ...entry, channels: [...entry.channels] })));
            setSelectedChatWindowId(accountActiveWindowId);
            if (payload.chat.detachedPanelSizes) {
              const validDetachedIds = new Set(accountDetachedWindows.map((entry) => entry.id));
              const accountDetachedSizes = Object.fromEntries(
                Object.entries(payload.chat.detachedPanelSizes).filter(([id]) => validDetachedIds.has(id))
              ) as Record<string, ChatPanelSize>;
              detachedChatPanelSizesRef.current = accountDetachedSizes;
              setDetachedChatPanelSizes(accountDetachedSizes);
            }
          }
        }
        uiLayoutLoadedRef.current = true;
        storedUiViewportRef.current = targetViewport;
        if (targetViewport) {
          lastCanvasSizeRef.current = targetViewport;
        }
      } catch (err) {
        console.error('[BattleArena] load ui layout failed:', err);
      } finally {
        if (!cancelled) {
          uiLayoutLoadedRef.current = true;
          setUiLayoutReady(true);
        }
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
  const [showHiddenBuffStatusBar, setShowHiddenBuffStatusBar] = useState(false);
  const [showCoordinateDisplay, setShowCoordinateDisplay] = useState(false);
  const [escPanelPage, setEscPanelPage] = useState<'main' | 'game-settings' | 'sound-settings' | 'hotkey-settings'>('main');
  const [escMainTab, setEscMainTab] = useState<'normal' | 'test'>('normal');
  const [escTestPage, setEscTestPage] = useState<'switches' | 'lighting' | 'camera' | 'martial' | 'chat' | 'kill' | 'sandstorm'>('switches');
  const [yumenSandstormOverlaySettings, setYumenSandstormOverlaySettings] = useState<YumenSandstormOverlaySettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_YUMEN_SANDSTORM_OVERLAY;
    try {
      return normalizeSandstormOverlaySettings(JSON.parse(localStorage.getItem(YUMEN_SANDSTORM_OVERLAY_STORAGE_KEY) ?? '{}'));
    } catch {
      return DEFAULT_YUMEN_SANDSTORM_OVERLAY;
    }
  });
  const yumenSandstormOverlayValues = useMemo(
    () => buildYumenSandstormOverlayValues(yumenSandstormOverlaySettings),
    [yumenSandstormOverlaySettings],
  );
  const [gameSettingsTab, setGameSettingsTab] = useState<GameSettingsTabId>('general');
  const [customUiPromptPos, setCustomUiPromptPos] = useState<UiPosition | null>(null);
  const lightingControlsOpen = canAccessTestingPanels && showTestingPanel && escMainTab === 'test' && escTestPage === 'lighting';

  useEffect(() => {
    if (canAccessTestingPanels) return;
    if (escMainTab === 'test') setEscMainTab('normal');
    if (escTestPage !== 'switches') setEscTestPage('switches');
    if (showControlPanel) setShowControlPanel(false);
    if (showSceneTestingPanel) setShowSceneTestingPanel(false);
    if (showCameraEventTestingPanel) setShowCameraEventTestingPanel(false);
    if (showCheatAbilityPanelEntry) setShowCheatAbilityPanelEntry(false);
    if (showCheatWindow) setShowCheatWindow(false);
  }, [
    canAccessTestingPanels,
    escMainTab,
    escTestPage,
    showCameraEventTestingPanel,
    showCheatAbilityPanelEntry,
    showCheatWindow,
    showControlPanel,
    showSceneTestingPanel,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(YUMEN_SANDSTORM_OVERLAY_STORAGE_KEY, JSON.stringify(yumenSandstormOverlaySettings));
  }, [yumenSandstormOverlaySettings]);

  useEffect(() => () => {
    if (sceneRecoveryTimerRef.current !== null) {
      window.clearTimeout(sceneRecoveryTimerRef.current);
    }
    if (inGameWarningTimerRef.current !== null) {
      window.clearTimeout(inGameWarningTimerRef.current);
    }
    if (yumenDefeatNoticeTimerRef.current !== null) {
      window.clearTimeout(yumenDefeatNoticeTimerRef.current);
    }
    if (yumenKillConfirmTimerRef.current !== null) {
      window.clearTimeout(yumenKillConfirmTimerRef.current);
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
    crashRecorder.updateSceneMetrics(metrics as unknown as Record<string, unknown>);
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
  }, [crashRecorder, recordLoadStageEnd]);

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
    crashRecorder.updateGameSnapshot({
      gameId,
      gameMode: mode,
      selfHp: me.hp,
      selfMaxHp: me.maxHp ?? maxHp,
      selfPosition: localPositionRef.current ?? me.position,
      loadCompleted: loadPerformanceSnapshot.completed,
      loadTotalMs: loadPerformanceSnapshot.totalMs,
      gameCounts: loadPerformanceSnapshot.gameCounts,
      sceneMetrics: loadPerformanceSnapshot.sceneMetrics,
    });
  }, [crashRecorder, gameId, loadPerformanceSnapshot, maxHp, me.hp, me.maxHp, me.position, mode]);

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
      crashRecorder.recordWebGLContextLost({
        gameId,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
      setSceneRecovering(true);
    };
    const onContextRestored = () => {
      clearRecoveryTimer();
      crashRecorder.recordWebGLContextRestored({ gameId });
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
  }, [crashRecorder, gameId]);

  const [showMeasurePanel, setShowMeasurePanel] = useState(false);
  useEffect(() => {
    if (canAccessTestingPanels || !showMeasurePanel) return;
    setShowMeasurePanel(false);
  }, [canAccessTestingPanels, showMeasurePanel]);
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
  const [cameraZoomLevel, setCameraZoomLevel] = useState(() => cameraDistanceToZoom(cameraSettings.maxDistance));
  const [cameraDebugEntries, setCameraDebugEntries] = useState<CameraDebugEntry[]>([]);
  const cameraDashPredictionDebugRef = useRef<CameraDashPredictionDebugSnapshot>(createEmptyCameraDashPredictionSnapshot());
  const [cameraDashPredictionDebug, setCameraDashPredictionDebug] = useState<CameraDashPredictionDebugSnapshot>(() => createEmptyCameraDashPredictionSnapshot());
  const cameraDebugIdRef = useRef(0);
  const cameraEventTestingEnabledRef = useRef(false);
  const runtimeGlobalGcdTicks = getRuntimeCountdownTicks(me, 'globalGcdTicks', '_globalGcdSyncedAt', cooldownClockMs);
  const visibleVisualGcd = selfYumenSpectating
    ? null
    : buildVisibleVisualGcd(
        me?.visualGcd ?? null,
        runtimeGlobalGcdTicks,
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
  const showYumenSpectatorAbilityLockWarning = useCallback(() => {
    showInGameWarning('观战中无法调整技能栏');
  }, [showInGameWarning]);
  const showYumenDefeatNotice = useCallback((notice: YumenDefeatNotice) => {
    if (yumenDefeatNoticeTimerRef.current !== null) {
      window.clearTimeout(yumenDefeatNoticeTimerRef.current);
      yumenDefeatNoticeTimerRef.current = null;
    }
    setActiveYumenDefeatNotice(notice);
    yumenDefeatNoticeTimerRef.current = window.setTimeout(() => {
      setActiveYumenDefeatNotice((current) => current?.id === notice.id ? null : current);
      yumenDefeatNoticeTimerRef.current = null;
    }, YUMEN_KILL_NOTICE_DURATION_MS);
  }, []);
  const showYumenKillConfirm = useCallback((notice: YumenKillConfirmNotice) => {
    if (yumenKillConfirmTimerRef.current !== null) {
      window.clearTimeout(yumenKillConfirmTimerRef.current);
      yumenKillConfirmTimerRef.current = null;
    }
    setActiveYumenKillConfirm(notice);
    yumenKillConfirmTimerRef.current = window.setTimeout(() => {
      setActiveYumenKillConfirm((current) => current?.id === notice.id ? null : current);
      yumenKillConfirmTimerRef.current = null;
    }, YUMEN_KILL_CONFIRM_DURATION_MS);
  }, []);
  const previewYumenKillNotice = useCallback(() => {
    showYumenDefeatNotice({
      id: `preview-kill-notice:${Date.now()}`,
      attackerName: '剑心猫猫糕',
      defeatedName: '测试账号二',
      attributed: true,
    });
  }, [showYumenDefeatNotice]);
  const previewYumenKillConfirm = useCallback(() => {
    showYumenKillConfirm({
      id: `preview-kill-confirm:${Date.now()}`,
      defeatedName: '测试账号二',
    });
  }, [showYumenKillConfirm]);
  useEffect(() => {
    if (!externalGameWarning?.text) return;
    showInGameWarning(externalGameWarning.text);
  }, [externalGameWarning?.id, externalGameWarning?.text, showInGameWarning]);
  const showAbilityDisabledWarning = useCallback((ability: AbilityInfo) => {
    if (ability.disabledWarning) {
      showInGameWarning(ability.disabledWarning);
      return;
    }
    if (ability.blockedByAntiStealth) {
      showInGameWarning('反隐期间无法施展隐身招式');
      return;
    }
    if (ability.losBlocked) {
      showInGameWarning('视线被遮挡');
      return;
    }
    showInGameWarning(IN_GAME_WARNING_PREVIEW_TEXT);
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
  useEffect(() => {
    if (!showCameraEventTestingPanel && !(showTestingPanel && escMainTab === 'test' && escTestPage === 'camera')) return;
    const id = window.setInterval(() => {
      setCameraDashPredictionDebug({ ...cameraDashPredictionDebugRef.current });
    }, 100);
    return () => window.clearInterval(id);
  }, [escMainTab, escTestPage, showCameraEventTestingPanel, showTestingPanel]);
  const formatCameraDebugEntry = useCallback((entry: CameraDebugEntry) => {
    const time = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
    const millis = String(entry.ts % 1000).padStart(3, '0');
    const flags = [
      entry.wallClamp ? 'wall' : null,
      entry.probeClamp ? 'probe' : null,
      entry.groundClamp ? 'ground' : null,
      entry.skyLook ? 'sky' : null,
      entry.forwardMove ? 'forward' : null,
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
        `dist=${entry.actualDistance.toFixed(2)}/${entry.desiredDistance.toFixed(2)} lookUp=${entry.lookUpRatio.toFixed(2)}${flags ? ` flags=${flags}` : ''}`,
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
  const copyYumenSandstormOverlayValues = useCallback(async () => {
    const text = `RGB ${yumenSandstormOverlayValues.r}, ${yumenSandstormOverlayValues.g}, ${yumenSandstormOverlayValues.b}\nAlpha ${yumenSandstormOverlayValues.alpha.toFixed(3)}\n${yumenSandstormOverlayValues.rgba}`;
    try {
      await navigator.clipboard.writeText(text);
      toastSuccess('已复制狂沙数值');
    } catch {
      toastError('复制狂沙数值失败');
    }
  }, [yumenSandstormOverlayValues]);
  const collisionSysRef = useRef<MapCollisionSystem | null>(null);
  const collisionReadyRef = useRef(!isExportedMap);
  const [collisionReady, setCollisionReady] = useState(!isExportedMap);
  const collisionDebugRef = useRef<CollisionDebugState>({
    enabled: false,
    center: { x: 0, y: 0, z: 0 },
    supportY: null,
  });
  useEffect(() => {
    collisionSysRef.current = null;
    collisionReadyRef.current = !isExportedMap;
    setCollisionReady(!isExportedMap);
    collisionDebugRef.current = {
      enabled: false,
      center: { x: 0, y: 0, z: 0 },
      supportY: null,
    };
  }, [isExportedMap]);
  const onCollisionSystemReady = useCallback((sys: MapCollisionSystem) => {
    collisionSysRef.current = sys;
    const pos = localPositionRef.current ?? { x: mapData.width / 2, y: mapData.height / 2 };
    const halfW = mapData.width / 2;
    const halfH = mapData.height / 2;
    const tmpCenter = new THREE.Vector3(
      (pos.x - halfW - GROUP_POS_X) / RENDER_SF_XZ,
      5000,
      (halfH - pos.y - GROUP_POS_Z) / RENDER_SF_XZ,
    );
    const groundY = getBvhGroundSupportY(sys, tmpCenter);
    collisionDebugRef.current = {
      enabled: true,
      center: { x: tmpCenter.x, y: tmpCenter.y, z: tmpCenter.z },
      supportY: groundY,
    };
    if (groundY !== null) {
      const feetGameZ = groundY * RENDER_SF_Y + GROUP_POS_Y;
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
      if (isExportedMap) {
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
      const requiredStageIds = isExportedMap
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
    isExportedMap,
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
    const blockedByMap = isExportedMap && collisionSysRef.current
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
      : !isExportedMap
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
  }, [ARENA_HEIGHT, ARENA_WIDTH, isExportedMap, me.userId]);
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
  const draftAbilitySource = useMemo(() => (
    handAbilities
      .filter(a => !a.isCommon && !a.isSpecialBarAbility && !itemBarAbilityIds.has(a.id))
      .map((ability) => {
        const overrideSlotIndex = draftSlotOverrides[ability.id];
        return typeof overrideSlotIndex === 'number'
          ? { ...ability, slotIndex: normalizeDraftSlotIndex(overrideSlotIndex, overrideSlotIndex) }
          : ability;
      })
  ), [draftSlotOverrides, handAbilities, itemBarAbilityIds]);
  const currentLearnedDraftAbilities = useMemo(() => buildDraftAbilitySlots(draftAbilitySource), [draftAbilitySource]);
  const currentLearnedDraftSignature = currentLearnedDraftAbilities.map((ability) => ability ? `${ability.id}:${ability.abilityId}:${ability.slotIndex ?? ''}` : '').join('|');
  useEffect(() => {
    if (!specialBarActive) setStableLearnedDraftAbilities(currentLearnedDraftAbilities);
  }, [currentLearnedDraftAbilities, currentLearnedDraftSignature, specialBarActive]);
  const learnedDraftAbilities = specialBarActive ? stableLearnedDraftAbilities : currentLearnedDraftAbilities;
  const draftAbilities: Array<AbilityInfo | undefined> = specialBarActive
    ? handAbilities.filter(a => a.isSpecialBarAbility)
    : learnedDraftAbilities;

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
  const movementClientSessionRef = useRef<{ id: string; startedAt: number } | null>(null);
  if (!movementClientSessionRef.current) {
    movementClientSessionRef.current = createMovementClientSession();
  }
  const lastMovementRecoverAtRef = useRef(0);
  const lastMovementOkLogAtRef = useRef(0);
  const lastMovementSendRef = useRef<{ signature: string; sentAt: number } | null>(null);
  const skippedMovementFramesRef = useRef(0);
  const lastLocalPhysicsStallAtRef = useRef(0);

  /* --- Jump / Z refs --- */
  const jumpLocalRef      = useRef(false); // drives local Z prediction
  const jumpSendRef       = useRef(false); // queued for next movement POST
  const localZRef         = useRef(0);     // current Z height (world units)
  const localVzRef        = useRef(0);     // current Z velocity
  const localJumpCountRef = useRef(0);     // jumps used in current airtime (max 2)
  const advanceLocalPhysicsRef = useRef<() => void>(() => {});
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
  const lastYumenCameraAlignKeyRef = useRef<string | null>(null);
  const previousYumenCameraAlignPositionRef = useRef<{ x: number; y: number } | null>(null);
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
  const camZoomRef     = useRef(cameraZoomLevel);           // zoom multiplier (scroll wheel)
  const cameraMoveCommandActiveRef = useRef(false);
  const cameraForwardMoveCommandActiveRef = useRef(false);
  const cameraLookInputVersionRef = useRef(0);
  const manualCameraLookActiveRef = useRef(false);
  const mouseLookFacingSyncRafRef = useRef<number | null>(null);
  const mouseStateRef  = useRef({ isLeft: false, isRight: false, lastX: 0, lastY: 0, downX: NaN, downY: NaN, downAt: 0, dragDistance: 0 });
  const groundDeselectCandidateRef = useRef(false);
  const lastQuickLeftClickAtRef = useRef(0);

  activeChannelRef.current = getActiveChannelClient(me?.activeChannel ?? null);

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
  const dashServerSampleRef = useRef<DashRenderSample | null>(null);
  const dashServerSampleKeyRef = useRef('');
  const lastDashStutterLogAtRef = useRef(0);
  const lastJumpCorrectionWarnAtRef = useRef(0);
  const lastPositionCorrectionProbeAtRef = useRef(0);
  const dashStartExpectedMsRef = useRef(1000);
  const dashStartAbilityIdRef = useRef<string | null>(null);
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
  const observedDashKeyRef = useRef<string>('');
  {
    const ad = (me as any)?.activeDash;
    const activeDashTicksRemaining = getRuntimeCountdownTicks(ad, 'ticksRemaining', '_ticksRemainingSyncedAt', Date.now());
    const rawDashTicks = Math.max(0, Number(ad?.ticksRemaining ?? 0));
    const rootedByDebuff = buffsHaveAnyEffect(me?.buffs, ['ROOT']);
    // 临时飞爪 / ccStopsMe dashes are canceled by ROOT on backend movement tick.
    // Skip local dash prediction while rooted to avoid one-frame surge + snap-back.
    const suppressDashPredictionWhileRooted = rootedByDebuff && ad?.ccStopsMe === true;
    const dashObservationKey = ad
      ? JSON.stringify({
          abilityId: ad.abilityId ?? null,
          startedAt: ad.startedAt ?? null,
          vxPerTick: ad.vxPerTick ?? null,
          vyPerTick: ad.vyPerTick ?? null,
          vzPerTick: ad.vzPerTick ?? null,
          forceVzPerTick: ad.forceVzPerTick ?? null,
        })
      : '';
    const firstRenderForDash = !!dashObservationKey && dashObservationKey !== observedDashKeyRef.current && rawDashTicks > 0;
    const isDashing = !!ad && !suppressDashPredictionWhileRooted && (activeDashTicksRemaining > 0 || firstRenderForDash);
    const renderDashTicksRemaining = isDashing
      ? Math.max(1, activeDashTicksRemaining > 0 ? activeDashTicksRemaining : Math.ceil(rawDashTicks || 1))
      : 0;
    const predictedActiveDash = isDashing ? { ...ad, ticksRemaining: renderDashTicksRemaining } : null;
    meActiveDashRef.current = predictedActiveDash;
    if (isDashing) {
      const nowMs = performance.now();
      lastObservedServerDashAtRef.current = nowMs;

      const serverDashPosition = {
        x: me.position.x,
        y: me.position.y,
        z: (me.position as any).z ?? 0,
      };
      const sampleKey = [
        ad.abilityId ?? '',
        ad.startedAt ?? '',
        ad._ticksRemainingSyncedAt ?? '',
        serverDashPosition.x.toFixed(3),
        serverDashPosition.y.toFixed(3),
        serverDashPosition.z.toFixed(3),
      ].join(':');

      if (dashServerSampleKeyRef.current !== sampleKey) {
        const previousSample = dashServerSampleRef.current;
        const gapMs = previousSample ? nowMs - previousSample.sampledAtMs : 0;
        if (
          previousSample &&
          shouldLogDashServerGap(gapMs) &&
          nowMs - lastDashStutterLogAtRef.current > 500
        ) {
          lastDashStutterLogAtRef.current = nowMs;
          console.warn('[DASH-STUTTER] delayed server dash sample', {
            abilityId: ad.abilityId ?? null,
            gapMs: Math.round(gapMs),
            ticksRemaining: activeDashTicksRemaining,
          });
        }
        dashServerSampleRef.current = {
          position: serverDashPosition,
          sampledAtMs: nowMs,
          ticksRemaining: renderDashTicksRemaining,
          vxPerTick: Number(ad.vxPerTick ?? 0),
          vyPerTick: Number(ad.vyPerTick ?? 0),
          vzPerTick: Number(ad.vzPerTick ?? ad.forceVzPerTick ?? 0),
        };
        dashServerSampleKeyRef.current = sampleKey;
      }
    } else {
      dashServerSampleRef.current = null;
      dashServerSampleKeyRef.current = '';
    }
    dashTurnOverrideRef.current = hasDashTurnOverrideClient(me?.buffs);
    // Transition logging (synchronous, fine for refs)
    if (isDashing && !_prevDashRef.current) {
      observedDashKeyRef.current = dashObservationKey;
      const nowMs = performance.now();
      const remainingTicks = Math.max(1, renderDashTicksRemaining);
      dashStartExpectedMsRef.current = Math.round(remainingTicks * (1000 / 30));
      dashStartAbilityIdRef.current = ad?.abilityId ?? null;
      (window as any).__dashStartMs = nowMs;
      recordDashProbe('start', {
        abilityId: dashStartAbilityIdRef.current ?? 'unknown',
        expectedRemainingMs: dashStartExpectedMsRef.current,
      });
      console.log(`[DASH] >>> FRONTEND START  time=${new Date().toISOString()} ability=${dashStartAbilityIdRef.current ?? 'unknown'} expectedRemaining=${dashStartExpectedMsRef.current}ms`);
    }
    if (!isDashing && _prevDashRef.current) {
      const elapsed = performance.now() - ((window as any).__dashStartMs ?? 0);
      recordDashProbe('end', {
        abilityId: dashStartAbilityIdRef.current ?? 'unknown',
        elapsedMs: Math.round(elapsed),
        expectedRemainingMs: dashStartExpectedMsRef.current,
      });
      console.log(`[DASH] <<< FRONTEND END    elapsed=${elapsed.toFixed(0)}ms  (expected ~${dashStartExpectedMsRef.current}ms remaining, ability=${dashStartAbilityIdRef.current ?? 'unknown'})`);
      dashStartAbilityIdRef.current = null;
    }
    if (!ad) observedDashKeyRef.current = '';
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
  const [locallyConsumedJumpBoostAt, setLocallyConsumedJumpBoostAt] = useState(0);
  const locallyConsumedJumpBoostAtRef = useRef(0);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const enableDashProbe = params.has('playwrightCameraDashProbe');
    const enableSkyProbe = params.has('playwrightCameraSkyProbe');
    if (!enableDashProbe && !enableSkyProbe) return;
    const target = window as any;
    if (enableDashProbe) {
      target.__zhenchuanCastAbilityForProbe = (
        abilityInstanceId: string,
        options?: {
          targetUserId?: string;
          groundTarget?: { x: number; y: number; z?: number };
          entityTargetId?: string;
          movementIntent?: boolean;
        },
      ) => onCastAbility(
        abilityInstanceId,
        options?.targetUserId,
        options?.groundTarget,
        options?.entityTargetId,
        options?.movementIntent ?? false,
      );
      target.__zhenchuanRefreshGameForProbe = () => Promise.resolve(onMovementRecover?.());
    }
    if (enableSkyProbe) {
      target.__zhenchuanCameraSkyProbe = { samples: [], last: null };
    }
    target.__zhenchuanSetCameraForProbe = (next: { yaw?: number; pitch?: number; zoom?: number }) => {
      if (Number.isFinite(next?.yaw)) camYawRef.current = Number(next.yaw);
      if (Number.isFinite(next?.pitch)) camPitchRef.current = clampCameraPitch(Number(next.pitch), mode);
      if (Number.isFinite(next?.zoom)) camZoomRef.current = Math.max(0.25, Math.min(2.5, Number(next.zoom)));
      cameraLookInputVersionRef.current += 1;
      return { yaw: camYawRef.current, pitch: camPitchRef.current, zoom: camZoomRef.current };
    };
    target.__zhenchuanSetForwardForProbe = (active: boolean) => {
      const forwardActive = active === true;
      keysRef.current.w = forwardActive;
      setWasdKeys(prev => ({ ...prev, w: forwardActive }));
      if (!forwardActive) cameraForwardMoveCommandActiveRef.current = false;
      return { keys: { ...keysRef.current }, forward: cameraForwardMoveCommandActiveRef.current };
    };
    return () => {
      if (target.__zhenchuanCastAbilityForProbe) delete target.__zhenchuanCastAbilityForProbe;
      if (target.__zhenchuanRefreshGameForProbe) delete target.__zhenchuanRefreshGameForProbe;
      if (target.__zhenchuanSetCameraForProbe) delete target.__zhenchuanSetCameraForProbe;
      if (target.__zhenchuanSetForwardForProbe) delete target.__zhenchuanSetForwardForProbe;
      if (target.__zhenchuanCameraSkyProbe) delete target.__zhenchuanCameraSkyProbe;
    };
  }, [mode, onCastAbility, onMovementRecover]);

  const getHotkeyDraftSlots = useCallback(() => {
    const heldItemIds = new Set(itemBarAbilitiesRef.current.filter(Boolean).map((ability) => ability!.id));
    return buildDraftAbilitySlots(
      abilitiesRef.current
        .filter((ability) => !ability.isCommon && !ability.isSpecialBarAbility && !heldItemIds.has(ability.id))
        .map((ability) => {
          const overrideSlotIndex = draftSlotOverridesRef.current[ability.id];
          return typeof overrideSlotIndex === 'number'
            ? { ...ability, slotIndex: normalizeDraftSlotIndex(overrideSlotIndex, overrideSlotIndex) }
            : ability;
        })
    );
  }, []);
  const triggerAbilityHotkey = useCallback((ability: AbilityInfo | undefined, pressedId: string) => {
    if (!ability) return false;
    if (!ability.isReady || ability.blockedByAntiStealth) {
      showAbilityDisabledWarning(ability);
      return true;
    }
    setPressedAbilityInput(pressedId);
    castAbilityRef.current(ability.id);
    return true;
  }, [showAbilityDisabledWarning]);
  const toggleEscPanel = useCallback(() => {
    setShowTestingPanel((visible) => {
      const next = !visible;
      if (next) {
        setEscPanelPage('main');
        setEscMainTab('normal');
        setEscTestPage('switches');
      }
      return next;
    });
  }, []);
  const toggleMartialPanel = useCallback(() => {
    if (!canOpenMartialPanel) {
      setShowMartialPanel(false);
      setMartialPanelTempPos(null);
      martialPanelTempPosRef.current = null;
      showInGameWarning('战斗警告：当前无法打开武学界面');
      return;
    }
    setShowMartialPanel((visible) => {
      setMartialPanelTempPos(null);
      martialPanelTempPosRef.current = null;
      return !visible;
    });
  }, [canOpenMartialPanel, showInGameWarning]);
  const triggerHotkeyBinding = useCallback((bindingId: string) => {
    const actionId = findHotkeyActionByBinding(hotkeySettings, bindingId);
    if (!actionId) return false;
    const parsed = parseHotkeyActionId(actionId);
    if (!parsed) return false;

    if (parsed.kind === 'interface') {
      if (parsed.index === 0) {
        setShowHeartDetailsPanel((visible) => !visible);
        return true;
      }
      if (parsed.index === 1) {
        toggleMartialPanel();
        return true;
      }
      return false;
    }

    if (parsed.kind === 'draft') {
      const specialBarHotkeysActive = abilitiesRef.current.some((ability) => ability.isSpecialBarAbility);
      const drafts = specialBarHotkeysActive
        ? abilitiesRef.current.filter((ability) => ability.isSpecialBarAbility)
        : getHotkeyDraftSlots();
      return triggerAbilityHotkey(drafts[parsed.index], `draft-${parsed.index}`);
    }

    if (parsed.kind === 'common') {
      if (abilitiesRef.current.some((ability) => ability.isSpecialBarAbility)) return true;
      const commons = abilitiesRef.current.filter((ability) => ability.isCommon);
      return triggerAbilityHotkey(commons[parsed.index], `common-${parsed.index}`);
    }

    const consumableId = consumableBarSettings.slots[parsed.index];
    const consumable = consumableId ? CONSUMABLE_ITEM_BY_ID.get(consumableId) : undefined;
    if (selfYumenSpectating) {
      showInGameWarning('观战中无法使用物品');
      return true;
    }
    if (!consumableBarSettings.enabled) {
      showInGameWarning('物品栏已关闭');
      return true;
    }
    if (!consumable) {
      showInGameWarning('该物品格为空');
      return true;
    }
    if (consumable.implemented !== true) {
      showInGameWarning('该物品暂未开放');
      return true;
    }
    const count = getConsumableRemainingCount(me, consumable);
    if (count <= 0) {
      showInGameWarning('该物品已用完');
      return true;
    }
    const cooldownExpiresAt = Number(me.consumableCooldowns?.[consumable.id]?.expiresAt ?? 0);
    if (cooldownExpiresAt > Date.now()) {
      showInGameWarning('物品调息中');
      return true;
    }
    useConsumableRef.current(consumable.id);
    return true;
  }, [consumableBarSettings, getHotkeyDraftSlots, hotkeySettings, me, me.consumableCooldowns, me.consumableCounts, selfYumenSpectating, showAbilityDisabledWarning, showInGameWarning, toggleMartialPanel, triggerAbilityHotkey]);

  const captureHotkeyBinding = useCallback((target: HotkeyCaptureTarget, binding: HotkeyBinding | null) => {
    if (!target || !binding || !isHotkeyActionId(target.actionId)) return;
    if (isReservedCharacterActionBinding(binding.id)) {
      toastError('角色动作按键不可占用');
      return;
    }
    setHotkeySettings((current) => {
      const next: HotkeySettings = {};
      HOTKEY_ACTION_IDS.forEach((actionId) => {
        next[actionId] = [...(current[actionId] ?? [])].filter((existing) => existing !== binding.id);
      });
      const list = [...(next[target.actionId] ?? [])];
      list[target.bindingIndex] = binding.id;
      next[target.actionId] = list.filter(Boolean).slice(0, HOTKEY_MAX_BINDINGS_PER_ACTION);
      return next;
    });
    setCapturingHotkey(null);
  }, []);

  const clearHotkeyBinding = useCallback((actionId: string, bindingIndex: number) => {
    if (!isHotkeyActionId(actionId)) return;
    setHotkeySettings((current) => {
      const next: HotkeySettings = {};
      HOTKEY_ACTION_IDS.forEach((id) => {
        next[id] = [...(current[id] ?? [])];
      });
      next[actionId] = (next[actionId] ?? []).filter((_, index) => index !== bindingIndex);
      return next;
    });
  }, []);

  const resetHotkeySettings = useCallback(() => {
    setHotkeySettings(buildDefaultHotkeySettings());
    setCapturingHotkey(null);
  }, []);

  const hotkeySettingsDirty = !areHotkeySettingsEqual(hotkeySettings, savedHotkeySettings);

  const applyHotkeySettings = useCallback(() => {
    const normalized = persistHotkeySettings(hotkeySettings);
    setHotkeySettings(normalized);
    setSavedHotkeySettings(normalized);
    setCapturingHotkey(null);
  }, [hotkeySettings]);

  const applyEscSettings = useCallback(() => {
    if (escPanelPage === 'hotkey-settings' && hotkeySettingsDirty) {
      applyHotkeySettings();
    }
  }, [applyHotkeySettings, escPanelPage, hotkeySettingsDirty]);

  const confirmEscSettings = useCallback(() => {
    if (escPanelPage === 'hotkey-settings' && hotkeySettingsDirty) {
      applyHotkeySettings();
    }
    setShowTestingPanel(false);
  }, [applyHotkeySettings, escPanelPage, hotkeySettingsDirty]);

  const cancelEscSettings = useCallback(() => {
    if (escPanelPage === 'hotkey-settings') {
      setHotkeySettings(savedHotkeySettings);
      setCapturingHotkey(null);
    }
    setShowTestingPanel(false);
  }, [escPanelPage, savedHotkeySettings]);

  const setConsumableBarEnabled = useCallback((enabled: boolean) => {
    setConsumableBarSettings((prev) => ({ ...prev, enabled }));
  }, []);
  const setConsumableBarSlotCount = useCallback((slotCount: unknown) => {
    setConsumableBarSettings((prev) => ({ ...prev, slotCount: normalizeConsumableSlotCount(slotCount) }));
  }, []);
  const setCameraMaxDistance = useCallback((value: unknown) => {
    const maxDistance = normalizeCameraMaxDistance(value);
    setCameraSettings((prev) => ({ ...prev, maxDistance, followMode: 'never', version: DEFAULT_CAMERA_SETTINGS.version }));
    const nextZoom = cameraDistanceToZoom(maxDistance);
    camZoomRef.current = nextZoom;
    setCameraZoomLevel(nextZoom);
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
    crashRecorder.recordBehavior('ability-input', {
      id,
      abilityId: abilityKey,
      abilityName: ability?.name,
      selectedTargetId: selectedTargetRef.current,
      selectedEntityId: selectedEntityRef.current,
      selectedSelf: selectedSelfRef.current,
      position: localPositionRef.current ?? me.position,
      z: localZRef.current,
    });
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
    if (abilityKey === 'fuyao_zhishang') {
      hasFuyaoBuffRef.current = true;
      locallyConsumedJumpBoostAtRef.current = 0;
      setLocallyConsumedJumpBoostAt(0);
    }
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
      showInGameWarning('目标类型不正确');
      return;
    }
    if (ability?.target === 'OPPONENT' && !selectedTargetIdNow && !selectedEntityIdNow && !selectedSelfNow) {
      if (ability?.allowGroundCastWithoutTarget) {
        beginPendingGroundCast(id);
        return;
      }
      showInGameWarning('目标类型不正确');
      return;
    }
    if (ability?.target === 'OPPONENT' && isFriendlyTargetAbility && selectedTargetIdNow) {
      showInGameWarning('目标类型不正确');
      return;
    }
    if (
      ability?.target === 'OPPONENT' &&
      !isFriendlyTargetAbility &&
      selectedTarget &&
      hasShiFangXuanJiClient(selectedTarget.buffs)
    ) {
      showInGameWarning('请选择敌方目标');
      return;
    }
    if (
      ability?.target === 'OPPONENT' &&
      selectedEntity &&
      ((isFriendlyTargetAbility && selectedEntity.ownerUserId !== me.userId) ||
        (!isFriendlyTargetAbility && selectedEntity.ownerUserId === me.userId))
    ) {
      showInGameWarning('目标类型不正确');
      return;
    }
    if (ability?.target === 'OPPONENT' && selectedTarget && blocksTargetingClient(selectedTarget.buffs)) {
      showInGameWarning('目标不可选中');
      return;
    }
    if (abilityKey === 'hong_meng_tian_jin' && hasShuSeClient((selectedSelfTarget ?? selectedTarget)?.buffs)) {
      showInGameWarning('招式施展失败');
      return;
    }
    if (abilityKey === 'dou_zhuan_xing_yi' && selectedEntityIdNow) {
      showInGameWarning('招式施展失败');
      return;
    }
    if (abilityKey === 'qin_yin_gong_ming' && selectedEntityIdNow) {
      showInGameWarning('招式施展失败');
      return;
    }
    if (abilityKey === 'dou_zhuan_xing_yi' && selectedTarget && hasMianLaClient(selectedTarget.buffs)) {
      showInGameWarning('目标处于免拉状态');
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
      showInGameWarning('招式施展失败');
      return;
    }
    if (abilityKey === 'ren_chi_cheng' && isLingRanSpecialJumpActiveClient(me)) {
      showInGameWarning('招式施展失败');
      return;
    }
    if (typeof ability?.minSelfHpExclusive === 'number' && (me?.hp ?? 0) <= ability.minSelfHpExclusive) {
      showInGameWarning('气血要求不足');
      return;
    }
    if (typeof ability?.minSelfHpPercentExclusive === 'number') {
      const requiredHp = Math.max(1, Number(me?.maxHp ?? maxHp)) * (ability.minSelfHpPercentExclusive / 100);
      if ((me?.hp ?? 0) <= requiredHp) {
        showInGameWarning('气血要求不足');
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
    crashRecorder.recordBehavior('ground-cast-confirm', {
      abilityId: abilityKey,
      abilityName: ability.name,
      target: { x, y, z: worldZ },
      position: localPositionRef.current ?? me.position,
    });
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

  const getCurrentCoordinateText = useCallback(() => {
    const pos = localRenderPosRef.current ?? me.position;
    return formatCoordinateText(pos, me.position);
  }, [me.position]);

  const copyCurrentCoordinateText = useCallback(async () => {
    const text = getCurrentCoordinateText();
    try {
      await navigator.clipboard.writeText(text);
      toastSuccess('坐标已复制');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) toastSuccess('坐标已复制');
      else toastError('复制坐标失败');
    }
  }, [getCurrentCoordinateText]);

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
      let dashPrediction: CollisionAwareDashPrediction | null = null;

      // --- local player render pos ---
      const myPos = localPositionRef.current ?? me?.position;
      if (myPos) {
        let tx = myPos.x, ty = myPos.y, tz = localZRef.current;
        dashPrediction = meActiveDashRef.current
          ? predictDashRenderPositionWithCollision(dashServerSampleRef.current, { nowMs: frameNow }, {
              arenaWidth: ARENA_WIDTH,
              arenaHeight: ARENA_HEIGHT,
              playerRadius,
              isExportedMap,
              collisionSystem: collisionSysRef.current,
              objects: mapObjectsRef.current,
              entities: entitiesRef.current,
              actorUserId: me.userId,
              playArea: playAreaRef.current,
            })
          : null;
        if (dashPrediction) {
          tx = dashPrediction.position.x;
          ty = dashPrediction.position.y;
          tz = dashPrediction.position.z;
        }
        const r  = localRenderPosRef.current;
        const ddx = tx - r.x, ddy = ty - r.y, ddz = tz - r.z;
        const dist2d = Math.sqrt(ddx * ddx + ddy * ddy);
        const forcedRenderDisplacement = forcedDisplacementRef.current;
        const justJumpedRender = frameNow - lastJumpInputAtRef.current < 320;
        const recentDashSettle =
          !justJumpedRender &&
          (
            frameNow - lastObservedServerDashAtRef.current < 400 ||
            frameNow - lastFengLiuYunSanCastAtRef.current < 700
          );
        const airborneRender =
          localJumpCountRef.current > 0 ||
          Math.abs(localVzRef.current) > 0.01 ||
          tz > groundHRef.current + 0.05;

        // During server-authoritative dash: HARD SNAP to server position.
        // Do NOT lerp — any lerp causes the visual to lag behind the server,
        // extending the perceived dash duration beyond the actual 1-second window.
        if (recentDashSettle) {
          localDashAnimRef.current = null;
        }
        const snapThreshold = recentDashSettle ? 80 : SNAP_THRESH;

        if (meActiveDashRef.current || forcedRenderDisplacement) {
          localDashAnimRef.current = null;
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
        } else if (dist2d > snapThreshold) {
          localRenderPosRef.current = { x: tx, y: ty, z: tz };
          localDashAnimRef.current  = null;
        } else if (!recentDashSettle && !localDashAnimRef.current && dist2d > DASH_THRESH) {
          localDashAnimRef.current = { start: { ...r }, startTime: frameNow };
        }
        if (!meActiveDashRef.current && !forcedRenderDisplacement) {
          if (!recentDashSettle && localDashAnimRef.current) {
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
            const horizontalK = Math.min(1, (recentDashSettle ? 0.34 : airborneRender ? (justJumpedRender ? 0.52 : 0.4) : 0.3) * dtF);
            const verticalK = Math.min(1, (recentDashSettle ? 0.34 : airborneRender ? (justJumpedRender ? 0.62 : 0.46) : 0.3) * dtF);
            localRenderPosRef.current = {
              x: r.x + ddx * horizontalK,
              y: r.y + ddy * horizontalK,
              z: r.z + ddz * verticalK,
            };
          }
        }
      }

      const renderPosition = localRenderPosRef.current ? { ...localRenderPosRef.current } : null;
      const serverPosition = me?.position ? { x: me.position.x, y: me.position.y, z: Number((me.position as any).z ?? localZRef.current ?? 0) } : null;
      const predictedPosition = dashPrediction?.position ? { ...dashPrediction.position } : null;
      const linearPosition = dashPrediction?.debug.linearPosition ? { ...dashPrediction.debug.linearPosition } : null;
      const serverRenderGap = renderPosition && serverPosition
        ? Math.hypot(renderPosition.x - serverPosition.x, renderPosition.y - serverPosition.y, renderPosition.z - serverPosition.z)
        : 0;
      const renderPredictionGap = renderPosition && predictedPosition
        ? Math.hypot(renderPosition.x - predictedPosition.x, renderPosition.y - predictedPosition.y, renderPosition.z - predictedPosition.z)
        : 0;
      const minPitch = isExportedMapMode(mode) ? COLLISION_TEST_MIN_CAMERA_PITCH : DEFAULT_MIN_CAMERA_PITCH;
      const snapshot: CameraDashPredictionDebugSnapshot = {
        active: !!meActiveDashRef.current,
        collisionAware: !!dashPrediction?.debug.collisionAware,
        collisionReady: dashPrediction?.debug.collisionReady ?? (!isExportedMap || !!collisionSysRef.current),
        leadTicks: dashPrediction?.debug.leadTicks ?? 0,
        requestedLeadTicks: dashPrediction?.debug.requestedLeadTicks ?? 0,
        simulatedTicks: dashPrediction?.debug.simulatedTicks ?? 0,
        collisionDelta: dashPrediction?.debug.collisionDelta ?? 0,
        stoppedByCollision: dashPrediction?.debug.stoppedByCollision ?? false,
        serverRenderGap,
        renderPredictionGap,
        cameraPitch: camPitchRef.current,
        minPitch,
        maxPitch: MAX_CAMERA_PITCH,
        cameraZoom: camZoomRef.current,
        serverPosition,
        renderPosition,
        predictedPosition,
        linearPosition,
      };
      cameraDashPredictionDebugRef.current = snapshot;
      recordCameraDashPredictionProbe(snapshot);

      myZRef.current = localRenderPosRef.current.z ?? 0;

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [ARENA_HEIGHT, ARENA_WIDTH, isExportedMap, me?.position?.x, me?.position?.y, (me?.position as any)?.z, me.userId, mode, playerRadius]);

  useEffect(() => { meHpRef.current  = me?.hp ?? 0;      }, [me?.hp]);
  // Keep max-jumps ref in sync with MULTI_JUMP buff from server state
  useEffect(() => {
    const effects = activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt).flatMap((b: any) => (b.effects ?? []).filter(Boolean));
    const multiJump = effects.find((e: any) => e.type === 'MULTI_JUMP');
    maxJumpsRef.current = multiJump ? (multiJump.value ?? 2) : 2;
    yuqiMountedRef.current = hasYuqiStateClient(me?.buffs);
    lingRanTianFengActiveRef.current = effects.some((e: any) => e.type === 'LING_RAN_TIAN_FENG_STATE');
    const nextLingRanCharge = Number((me as any)?.lingRanTianFengCharges ?? 0);
    lingRanTianFengChargeRef.current = lingRanTianFengActiveRef.current
      ? Math.max(0, Math.min(1, Number.isFinite(nextLingRanCharge) ? nextLingRanCharge : 0))
      : 0;
  }, [me?.buffs, locallyConsumedJumpBoostAt, (me as any)?.lingRanTianFengCharges]);

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
    const activeChannel = getActiveChannelClient(me?.activeChannel ?? null);
    if (meActiveDashRef.current) {
      crashRecorder.recordBehavior('jump-blocked', { reason: 'active-dash', position: localPositionRef.current ?? me.position });
      return;
    }
    const lingRanJumpLockImmune = lingRanTianFengActiveRef.current;
    if (
      jumpLockedRef.current ||
      (!lingRanJumpLockImmune && (
        !!activeChannel ||
        hasLegacyChannelJumpLock(me?.buffs) ||
        buffsHaveAnyEffect(me?.buffs, ['NO_JUMP'])
      ))
    ) {
      crashRecorder.recordBehavior('jump-blocked', {
        reason: 'locked-or-channeling',
        jumpLocked: jumpLockedRef.current,
        activeChannel: !!activeChannel,
        position: localPositionRef.current ?? me.position,
      });
      return;
    }
    if (lingRanTianFengActiveRef.current) {
      if (lingRanTianFengChargeRef.current <= 0) {
        jumpLocalRef.current = false;
        jumpSendRef.current = false;
        crashRecorder.recordBehavior('jump-blocked', { reason: 'ling-ran-no-charge', position: localPositionRef.current ?? me.position });
        return;
      }
      const keepLingRanCharge = hasLingRanSpecialJumpRefillBuffClient(me?.buffs);
      lastJumpInputAtRef.current = performance.now();
      jumpLocalRef.current = false;
      jumpSendRef.current = true;
      lingRanTianFengChargeRef.current = keepLingRanCharge ? 1 : 0;
      crashRecorder.recordBehavior('jump-queued', {
        kind: 'ling-ran-special',
        keepCharge: keepLingRanCharge,
        position: localPositionRef.current ?? me.position,
      });
      return;
    }
    const queuedYuqiJumpDir = getQueuedYuqiMountedJumpDirection();
    if (!canUseYuqiMountedJumpClient(queuedYuqiJumpDir)) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
      crashRecorder.recordBehavior('jump-blocked', { reason: 'yuqi-direction', queuedYuqiJumpDir, position: localPositionRef.current ?? me.position });
      return;
    }
    const maxJumps = getEffectiveMaxJumps();
    if (localJumpCountRef.current >= maxJumps) {
      jumpLocalRef.current = false;
      jumpSendRef.current = false;
      crashRecorder.recordBehavior('jump-blocked', { reason: 'max-jumps', localJumpCount: localJumpCountRef.current, maxJumps, position: localPositionRef.current ?? me.position });
      return;
    }
    lastJumpInputAtRef.current = performance.now();
    jumpLocalRef.current = true;
    jumpSendRef.current = true;
    crashRecorder.recordBehavior('jump-queued', {
      kind: 'normal',
      localJumpCount: localJumpCountRef.current,
      maxJumps,
      direction: queuedYuqiJumpDir,
      position: localPositionRef.current ?? me.position,
      z: localZRef.current,
    });
  }, [canUseYuqiMountedJumpClient, crashRecorder, getEffectiveMaxJumps, getQueuedYuqiMountedJumpDirection, me?.activeChannel, me?.buffs, me.position]);

  // Keep local movement-speed prediction aligned with backend movement.ts
  useEffect(() => {
    const effects = activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt).flatMap((b: any) => (b.effects ?? []).filter(Boolean));
    const speedBoost = effects
      .filter((e: any) => e.type === 'SPEED_BOOST')
      .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
    const slow = effects
      .filter((e: any) => e.type === 'SLOW')
      .reduce((sum: number, e: any) => sum + (e.value ?? 0), 0);
    moveSpeedScaleRef.current = Math.max(0, 1 + speedBoost - slow);
  }, [me?.buffs, locallyConsumedJumpBoostAt]);

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
        const yaw = facingToYaw(f);
        charYawRef.current = yaw;
        camYawRef.current = yaw;
        facingInitRef.current = true;
      }
    }
  }, [me?.facing?.x, me?.facing?.y]);
  useEffect(() => {
    if (!isYumenMode) {
      lastYumenCameraAlignKeyRef.current = null;
      previousYumenCameraAlignPositionRef.current = null;
      return;
    }
    const pos = me?.position;
    const facing = me?.facing;
    if (!pos || !facing || !Number.isFinite(facing.x) || !Number.isFinite(facing.y)) return;

    const prevPos = previousYumenCameraAlignPositionRef.current;
    previousYumenCameraAlignPositionRef.current = { x: pos.x, y: pos.y };
    const teleported = !prevPos || Math.hypot(pos.x - prevPos.x, pos.y - prevPos.y) >= 25;
    if (!selfHasYumenPrep && !teleported) return;

    const centerX = ARENA_WIDTH / 2;
    const centerY = ARENA_HEIGHT / 2;
    const toCenterX = centerX - pos.x;
    const toCenterY = centerY - pos.y;
    const toCenterLen = Math.hypot(toCenterX, toCenterY);
    if (toCenterLen <= 0.001) return;
    const facingLen = Math.hypot(facing.x, facing.y) || 1;
    const dot = ((facing.x / facingLen) * (toCenterX / toCenterLen)) + ((facing.y / facingLen) * (toCenterY / toCenterLen));
    if (dot < 0.98) return;

    const alignKey = `${gameId}:${Math.round(pos.x * 10)}:${Math.round(pos.y * 10)}:${Math.round(facing.x * 1000)}:${Math.round(facing.y * 1000)}`;
    if (lastYumenCameraAlignKeyRef.current === alignKey) return;
    lastYumenCameraAlignKeyRef.current = alignKey;

    const nextFacing = { x: facing.x / facingLen, y: facing.y / facingLen };
    meFacingRef.current = nextFacing;
    localFacingRef.current = nextFacing;
    const yaw = facingToYaw(nextFacing);
    charYawRef.current = yaw;
    camYawRef.current = yaw;
    manualCameraLookActiveRef.current = false;
    cameraLookInputVersionRef.current += 1;
  }, [ARENA_HEIGHT, ARENA_WIDTH, gameId, isYumenMode, me?.facing?.x, me?.facing?.y, me?.position?.x, me?.position?.y, selfHasYumenPrep]);
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
    const buffs = activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt);
    const activeChannel = getActiveChannelClient(me?.activeChannel ?? null);
    const lingRanJumpLockImmune = hasLingRanTianFengStateClient(buffs);
    const fullyLocked = buffsHaveAnyEffect(buffs, ['KNOCKED_BACK', 'CONTROL', 'ATTACK_LOCK']);
    const rooted = !fullyLocked && buffsHaveAnyEffect(buffs, ['ROOT']);
    const jumpSuppressedByChannel = !lingRanJumpLockImmune && (!!activeChannel || hasLegacyChannelJumpLock(buffs));
    const noJumpLocked = !lingRanJumpLockImmune && buffsHaveAnyEffect(buffs, ['NO_JUMP']);
    const channelMovementLocked = (activeChannel as any)?.lockMovement === true;
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
      if (!b) continue;
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
  }, [me?.activeChannel, me?.buffs, locallyConsumedJumpBoostAt]);

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
    const activeBuffs = activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt);
    const hasFengLai = activeBuffs.some((b: any) => b.buffId === 1014);
    const hasZhanWu  = activeBuffs.some((b: any) => b.buffId === 2712);
    meChannelingRef.current = !!(hasFengLai || hasZhanWu);
    meChannelRadiusRef.current = hasZhanWu ? 4 : 10;
  }, [me?.buffs, locallyConsumedJumpBoostAt]);
  useEffect(() => {
    const activeBuffs = activeBuffsClient(opponent?.buffs);
    const hasFengLai = activeBuffs.some((b: any) => b.buffId === 1014);
    const hasZhanWu  = activeBuffs.some((b: any) => b.buffId === 2712);
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
    const selfSpectating = hasYumenSpectatorClient(me?.buffs);
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
      if (actorUserId !== myId && hasStealthClient(actorState?.buffs)) {
        if (eventChannelSoundKey) {
          stopAbilityChannelSound(eventChannelSoundKey);
          activeChannelSoundKeysRef.current.delete(eventChannelSoundKey);
          channelSoundFinishAfterCompleteKeysRef.current.delete(eventChannelSoundKey);
        }
        return;
      }
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
      if (selfSpectating && evt.type === 'DAMAGE' && (evt.targetUserId === myId || evt.actorUserId === myId)) continue;
      playSoundForEvent(evt);
      if (evt.type === 'YUMEN_DEFEAT') {
        const defeatedName = typeof evt.defeatedName === 'string' && evt.defeatedName.trim() ? evt.defeatedName.trim() : '玩家';
        const attackerName = typeof evt.attackerName === 'string' && evt.attackerName.trim() ? evt.attackerName.trim() : '大漠狂沙';
        const noticeId = `${evt.timestamp ?? Date.now()}:${evt.defeatedUserId ?? defeatedName}`;
        showYumenDefeatNotice({
          id: noticeId,
          attackerName,
          defeatedName,
          attributed: true,
        });
        if (evt.attackerUserId === myId && evt.defeatedUserId !== myId) {
          showYumenKillConfirm({ id: noticeId, defeatedName });
        }
      } else if (evt.type === 'COMBAT_STATUS' && evt.targetUserId === myId) {
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
          const playerTargetBounds = evt.targetUserId
            ? opponentScreenBoundsRef.current[evt.targetUserId] ?? null
            : null;
          const bounds = evt.entityId
            ? entityScreenBoundsRef.current[evt.entityId] ?? oppScreenBoundsRef.current
            : playerTargetBounds ?? oppScreenBoundsRef.current;
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
  }, [events, me?.userId, showInGameWarning, showYumenDefeatNotice, showYumenKillConfirm, visibleOpponentsList]);

  useEffect(() => {
    const activeKeys = new Set<string>();
    const collectActiveChannel = (player: { userId?: string; activeChannel?: ActiveChannel; buffs?: ActiveBuff[] } | null | undefined) => {
      if (player?.userId !== me?.userId && hasStealthClient(player?.buffs)) return;
      const activeChannel = getActiveChannelClient(player?.activeChannel ?? null);
      const key = getChannelSoundKey(player?.userId, activeChannel?.abilityId, activeChannel?.instanceId);
      if (key) activeKeys.add(key);

      for (const buff of activeBuffsClient(player?.buffs)) {
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
    const curr = getActiveChannelClient(me?.activeChannel ?? null);

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
    let directionPayload: MovementDirectionPayload = null;

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

    const movementSignature = movementPayloadSignature(directionPayload, facingPayload);
    const movementNow = Date.now();
    const lastMovementSend = lastMovementSendRef.current;
    const movementChanged = !lastMovementSend || lastMovementSend.signature !== movementSignature;
    const movementRefreshMs = directionPayload !== null ? MOVEMENT_ACTIVE_REFRESH_MS : MOVEMENT_IDLE_REFRESH_MS;
    const movementDue = shouldJump
      || movementChanged
      || !lastMovementSend
      || movementNow - lastMovementSend.sentAt >= movementRefreshMs;

    if (!movementDue) {
      skippedMovementFramesRef.current += 1;
      return;
    }

    const skippedBeforeSend = skippedMovementFramesRef.current;
    skippedMovementFramesRef.current = 0;
    const timeSinceLastMovementSendMs = lastMovementSend ? movementNow - lastMovementSend.sentAt : null;
    const movementSendReason = shouldJump
      ? 'jump'
      : !lastMovementSend
      ? 'initial'
      : movementChanged
      ? 'changed'
      : 'heartbeat';
    lastMovementSendRef.current = { signature: movementSignature, sentAt: movementNow };

    const seq = ++movementSeqRef.current;
    const movementClientSession = movementClientSessionRef.current;
    crashRecorder.recordMovementSample({
      gameId,
      seq,
      movementClientSessionId: movementClientSession?.id,
      movementClientStartedAt: movementClientSession?.startedAt,
      direction: directionPayload,
      facing: facingPayload,
      shouldJump,
      keys: { ...k },
      controlMode: controlModeRef.current,
      mouseLook,
      movementSendReason,
      movementChanged,
      skippedBeforeSend,
      timeSinceLastMovementSendMs,
      movementRefreshMs,
      position: localPositionRef.current,
      z: localZRef.current,
      locks: {
        dashFacingLocked,
        facingInputLocked,
        channelMovementLocked,
        feared: !!fearedDirection,
        shiXinGu: !!shiXinGuDirection || shiXinGuStandstill,
      },
    }, shouldJump || directionPayload !== null);
    const movementRequestStartedAt = movementNow;
    const movementRequestStartedPerf = performance.now();
    try {
      const res = await fetch('/api/game/movement', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gameId,
          seq,
          movementClientSessionId: movementClientSession?.id,
          movementClientStartedAt: movementClientSession?.startedAt,
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
        latencyRecorder.recordMovementRequest({
          gameId,
          seq,
          ok: false,
          status: res.status,
          error: err,
          clientStartedAt: movementRequestStartedAt,
          clientCompletedAt: Date.now(),
          durationMs: performance.now() - movementRequestStartedPerf,
          shouldJump,
          hasDirection: directionPayload !== null,
          movementSendReason,
          movementChanged,
          skippedBeforeSend,
          timeSinceLastMovementSendMs,
          movementRefreshMs,
          movementClientSessionId: movementClientSession?.id,
        });
        crashRecorder.recordBehavior('movement-failed', { gameId, seq, status: res.status, error: err });
        const now = Date.now();
        if (now - lastMovementRecoverAtRef.current > 2000) {
          lastMovementRecoverAtRef.current = now;
          console.warn('[BattleArena] movement update failed; requesting fresh snapshot', err ?? res.status);
          onMovementRecover?.();
        }
      } else {
        const ack = await res.json().catch(() => null);
        const now = Date.now();
        latencyRecorder.recordMovementRequest({
          gameId,
          seq,
          ok: true,
          status: res.status,
          accepted: ack?.accepted,
          ackSeq: ack?.seq,
          clientStartedAt: movementRequestStartedAt,
          clientCompletedAt: now,
          durationMs: performance.now() - movementRequestStartedPerf,
          shouldJump,
          hasDirection: directionPayload !== null,
          movementSendReason,
          movementChanged,
          skippedBeforeSend,
          timeSinceLastMovementSendMs,
          movementRefreshMs,
          movementClientSessionId: movementClientSession?.id,
          serverReceivedAt: ack?.serverReceivedAt,
          serverRespondedAt: ack?.serverRespondedAt,
          serverTimestamp: ack?.serverTimestamp,
          serverProcessingMs: ack?.serverProcessingMs,
        });
        if (shouldJump || now - lastMovementOkLogAtRef.current >= 2_000) {
          lastMovementOkLogAtRef.current = now;
          crashRecorder.recordConnectionChecklist('movement-ok', {
            gameId,
            seq,
            ackSeq: ack?.seq,
            accepted: ack?.accepted,
            hasDirection: directionPayload !== null,
            shouldJump,
            movementSendReason,
            movementChanged,
            skippedBeforeSend,
            timeSinceLastMovementSendMs,
            movementRefreshMs,
            serverPosition: ack?.position,
            serverVelocity: ack?.velocity,
            returnedInput: ack?.input,
          });
        }
      }
    } catch (err) {
      latencyRecorder.recordMovementRequest({
        gameId,
        seq,
        ok: false,
        error: err,
        clientStartedAt: movementRequestStartedAt,
        clientCompletedAt: Date.now(),
        durationMs: performance.now() - movementRequestStartedPerf,
        shouldJump,
        hasDirection: directionPayload !== null,
        movementSendReason,
        movementChanged,
        skippedBeforeSend,
        timeSinceLastMovementSendMs,
        movementRefreshMs,
        movementClientSessionId: movementClientSession?.id,
      });
      crashRecorder.recordBehavior('movement-error', { gameId, seq, error: err });
    }
  }, [crashRecorder, gameId, latencyRecorder, onMovementRecover]);

  useEffect(() => {
    if (me?.position && !initializedRef.current) {
      localPositionRef.current = { ...me.position };
      localZRef.current = (me.position as any).z ?? 0;
      groundBaseRef.current = localZRef.current;
      localRenderPosRef.current = { x: me.position.x, y: me.position.y, z: localZRef.current };
      initializedRef.current   = true;
    }
  }, [isExportedMap, me?.position?.x, me?.position?.y, (me?.position as any)?.z]);

  useEffect(() => {
    if (!me?.position || !initializedRef.current) return;
    advanceLocalPhysicsRef.current();
    const local  = localPositionRef.current;
    if (!local) return;
    const dx = me.position.x - local.x;
    const dy = me.position.y - local.y;
    const activeDash = (me as any)?.activeDash;
    const activeDashTicksRemaining = getRuntimeCountdownTicks(activeDash, 'ticksRemaining', '_ticksRemainingSyncedAt', Date.now());
    const rootedByDebuff = buffsHaveAnyEffect(me?.buffs, ['ROOT']);
    const suppressDashPredictionWhileRooted = rootedByDebuff && activeDash?.ccStopsMe === true;
    const predictedActiveDash = activeDash && activeDashTicksRemaining > 0
      ? (suppressDashPredictionWhileRooted ? null : { ...activeDash, ticksRemaining: activeDashTicksRemaining })
      : null;
    const forcedDisplacement = buffsHaveAnyEffect(me?.buffs, ['KNOCKED_BACK', 'PULLED']);
    const serverZ = (me.position as any).z ?? 0;
    const localZ = localZRef.current;
    const zError = serverZ - localZ;
    const absZError = Math.abs(zError);
    const xyError = Math.hypot(dx, dy);
    const airborneLocalForCorrection = localJumpCountRef.current > 0;
    const serverVelocity = (me as any)?.velocity ?? {};
    const serverVx = Number(serverVelocity.vx ?? 0);
    const serverVy = Number(serverVelocity.vy ?? 0);
    const serverVz = Number(serverVelocity.vz ?? 0);
    const serverJumpCountRaw = Number((me as any)?.jumpCount ?? 0);
    const serverJumpCount = Number.isFinite(serverJumpCountRaw) ? serverJumpCountRaw : 0;
    const localJumpCount = localJumpCountRef.current;
    const localPlanarPredictionSpeed = Math.max(
      Math.hypot(localVelocityRef.current.x, localVelocityRef.current.y),
      getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current),
    );
    const serverPlanarSpeed = Math.hypot(
      Number.isFinite(serverVx) ? serverVx : 0,
      Number.isFinite(serverVy) ? serverVy : 0,
    );
    const jumpLagXyTolerance = Math.max(
      JUMP_CORRECTION_SERVER_LAG_MIN_XY,
      Math.max(localPlanarPredictionSpeed, serverPlanarSpeed) * JUMP_CORRECTION_SERVER_LAG_TICKS + 0.25,
    );
    const jumpLagZTolerance = Math.max(
      JUMP_CORRECTION_SERVER_LAG_MIN_Z,
      Math.max(Math.abs(localVzRef.current), Math.abs(Number.isFinite(serverVz) ? serverVz : 0)) * JUMP_CORRECTION_SERVER_LAG_TICKS + 0.25,
    );
    const justJumpedLocally = performance.now() - lastJumpInputAtRef.current < 260;
    const waitingForServerJumpPhase =
      airborneLocalForCorrection &&
      localJumpCount > serverJumpCount &&
      performance.now() - lastJumpInputAtRef.current < JUMP_CORRECTION_PENDING_PHASE_MS;
    const waitingForLocalLanding =
      airborneLocalForCorrection &&
      localJumpCount > 0 &&
      serverJumpCount === 0 &&
      Math.abs(Number.isFinite(serverVz) ? serverVz : 0) < 0.05 &&
      xyError <= Math.max(JUMP_CORRECTION_LANDING_GRACE_XY, jumpLagXyTolerance) &&
      absZError <= JUMP_CORRECTION_LANDING_GRACE_Z;
    const warnJumpCorrection = (reason: string, force = false) => {
      if (!airborneLocalForCorrection) return;
      if (!force && xyError < JUMP_CORRECTION_WARNING_MIN_XY && absZError < JUMP_CORRECTION_WARNING_MIN_Z) return;
      const now = performance.now();
      if (now - lastJumpCorrectionWarnAtRef.current < JUMP_CORRECTION_WARNING_COOLDOWN_MS) return;
      lastJumpCorrectionWarnAtRef.current = now;
      console.warn('[JUMP-CORRECTION] server corrected local jump prediction', {
        reason,
        xyError: Number(xyError.toFixed(3)),
        zError: Number(zError.toFixed(3)),
        localJumpCount,
        serverJumpCount,
        localVz: Number(localVzRef.current.toFixed(3)),
        serverVz: Number((Number.isFinite(serverVz) ? serverVz : 0).toFixed(3)),
        justJumpedLocally,
        server: {
          x: Number(me.position.x.toFixed(3)),
          y: Number(me.position.y.toFixed(3)),
          z: Number(serverZ.toFixed(3)),
        },
        local: {
          x: Number(local.x.toFixed(3)),
          y: Number(local.y.toFixed(3)),
          z: Number(localZ.toFixed(3)),
        },
      });
    };
    const recordPositionCorrectionProbe = (reason: string, force = false) => {
      if (!force && xyError < POSITION_CORRECTION_PROBE_MIN_XY && absZError < POSITION_CORRECTION_PROBE_MIN_Z) return;
      const now = performance.now();
      if (now - lastPositionCorrectionProbeAtRef.current < POSITION_CORRECTION_PROBE_COOLDOWN_MS) return;
      lastPositionCorrectionProbeAtRef.current = now;
      const data = {
        reason,
        gameId,
        xyError: Number(xyError.toFixed(3)),
        zError: Number(zError.toFixed(3)),
        moving: keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d,
        activeDash: Boolean(predictedActiveDash),
        forcedDisplacement,
        airborne: airborneLocalForCorrection,
        localJumpCount,
        serverJumpCount,
        server: {
          x: Number(me.position.x.toFixed(3)),
          y: Number(me.position.y.toFixed(3)),
          z: Number(serverZ.toFixed(3)),
        },
        local: {
          x: Number(local.x.toFixed(3)),
          y: Number(local.y.toFixed(3)),
          z: Number(localZ.toFixed(3)),
        },
      };
      recordDashProbe('correction', data);
      console.warn(`[LAG-PROBE][frontend] ${JSON.stringify({
        schemaVersion: 1,
        kind: 'frontend-position-correction',
        ts: Date.now(),
        iso: new Date().toISOString(),
        ...data,
      })}`);
      latencyRecorder.recordWebSocketLifecycle('frontend-position-correction', data);
    };

    // Exported-map modes: both client and backend use BVH collision, so we can
    // reconcile position normally. Only skip reconciliation on dash (server owns dash).
    if (isExportedMap) {
      if (predictedActiveDash) {
        meActiveDashRef.current = predictedActiveDash;
        localPositionRef.current = { ...me.position };
        localZRef.current  = (me.position as any).z ?? 0;
        localVzRef.current = 0;
        airborneSpeedCarryRef.current = 0;
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
      airborneSpeedCarryRef.current = 0;
      localDashAnimRef.current = null;
      localRenderPosRef.current = {
        x: me.position.x,
        y: me.position.y,
        z: serverZ,
      };
      return;
    }

    if (
      airborneLocalForCorrection &&
      !forcedDisplacement &&
      (
        waitingForServerJumpPhase ||
        waitingForLocalLanding ||
        (
          xyError <= jumpLagXyTolerance &&
          absZError <= jumpLagZTolerance
        )
      )
    ) {
      return;
    }

    const recentLocalPhysicsStall = performance.now() - lastLocalPhysicsStallAtRef.current < 1_500;
    const moving = keysRef.current.w || keysRef.current.a || keysRef.current.s || keysRef.current.d;
    const recentDashSettle =
      !justJumpedLocally &&
      (
        performance.now() - lastObservedServerDashAtRef.current < 400 ||
        performance.now() - lastFengLiuYunSanCastAtRef.current < 700
      );
    const hardSnapDistanceSq = recentDashSettle
      ? 6400
      : recentLocalPhysicsStall && moving && !forcedDisplacement && !airborneLocalForCorrection ? 100 : 25;

    // Hard-snap if server position is far away (e.g. new battle start).
    // This must also snap the render ref; otherwise the local character can
    // still fall into the old cosmetic dash easing for 5-20u corrections.
    if (dx * dx + dy * dy > hardSnapDistanceSq) {
      warnJumpCorrection('hard-snap-xy', true);
      recordPositionCorrectionProbe('hard-snap-xy', true);
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

    // During active dash: server owns position — hard-snap XY + Z
    // Check me.activeDash directly (not ref) so this works even before React
    // fires the activeDash tracking useEffect on this render cycle.
    if (predictedActiveDash) {
      meActiveDashRef.current = predictedActiveDash;
      localPositionRef.current = { ...me.position };
      localZRef.current  = (me.position as any).z ?? 0;
      localVzRef.current = 0;
      airborneSpeedCarryRef.current = 0;
      return;
    }

    if (recentDashSettle && dx * dx + dy * dy > 0.01) {
      const serverZ = (me.position as any).z ?? 0;
      localPositionRef.current = { ...me.position };
      localZRef.current = serverZ;
      localVzRef.current = 0;
      airborneSpeedCarryRef.current = 0;
      localDashAnimRef.current = null;
      return;
    }

    if (forcedDisplacement && dx * dx + dy * dy > 0.01) {
      const serverZ = (me.position as any).z ?? 0;
      recordPositionCorrectionProbe('forced-displacement-snap');
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
    const airborneLocal = airborneLocalForCorrection;
    const hardSnapThreshold = airborneLocal ? (justJumpedLocally ? 6.6 : 4.4) : 2.64;
    const settleThreshold = airborneLocal ? 0.132 : 0.044;
    const zBlend = airborneLocal ? (justJumpedLocally ? 0.08 : 0.16) : 0.35;
    const shouldSoftReconcile = !airborneLocal || !justJumpedLocally || Math.abs(zError) > 0.66;
    if (Math.abs(zError) > hardSnapThreshold) {
      warnJumpCorrection('hard-snap-z', true);
      recordPositionCorrectionProbe('hard-snap-z', true);
      localZRef.current = serverZ;
      if (!airborneLocal || serverZ <= groundHRef.current + 0.05) {
        localVzRef.current = 0;
      }
      bvhCenterYInitRef.current = false; // large Z snap — resync sphere center next tick
    } else if (shouldSoftReconcile) {
      if (Math.abs(zError) >= JUMP_CORRECTION_WARNING_MIN_Z) {
        warnJumpCorrection('soft-z');
      }
      localZRef.current = localZ + zError * zBlend;
      if (Math.abs(serverZ - localZRef.current) < settleThreshold) {
        localZRef.current = serverZ;
      }
    }
    const blend  = airborneLocal && justJumpedLocally ? 0 : recentLocalPhysicsStall ? (moving ? 0.18 : 0.35) : moving ? 0.03 : 0.25;
    if (blend > 0) {
      warnJumpCorrection('soft-xy');
      recordPositionCorrectionProbe('soft-xy');
    }
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
    const yumenTestShortCooldown = safeZone?.testShortCooldown === true;
    const getAbilityRealCooldownTicks = (ab: any): number => {
      const base = Math.max(0, Math.round(Number(ab?.cooldownTicks ?? 0)));
      if (base > 0) return base;
      if (Number(ab?.maxCharges ?? 0) > 1) {
        return Math.max(0, Math.round(Number(ab?.chargeRecoveryTicks ?? 0)));
      }
      return 0;
    };
    const getAbilityRuntimeCooldownTicks = (ab: any): number => {
      const base = getAbilityRealCooldownTicks(ab);
      return yumenTestShortCooldown && base > 0 ? Math.min(base, TEST_COOLDOWN_CAP_TICKS) : base;
    };
    const getChargeRecoveryDisplayTicks = (ab: any): number => {
      const base = Math.max(1, Math.round(Number(ab?.chargeRecoveryTicks ?? ab?.cooldownTicks ?? 1)));
      return yumenTestShortCooldown ? Math.min(base, TEST_COOLDOWN_CAP_TICKS) : base;
    };
    const getDisplayMaxCooldown = (ab: any): number => {
      return getAbilityRuntimeCooldownTicks(ab);
    };
    const getSharedGcdTicks = (ab: any): number => {
      const isQinggongLike = ab?.qinggong === true || ab?.qinggongGcdImmune === true;
      if (selfYumenSpectating && isQinggongLike) return 0;
      return ab?.gcd === true ? getRuntimeCountdownTicks(me, 'globalGcdTicks', '_globalGcdSyncedAt', cooldownClockMs) : 0;
    };
    const getChargeDisplay = (ab: any, instance: any) => {
      const sharedGcdTicks = getSharedGcdTicks(ab);
      const baseGcdTicks = Math.max(1, Math.round((BASE_GCD_MS / 1000) * SERVER_TICK_RATE));
      const maxCharges = Math.max(0, Number(ab?.maxCharges ?? 0));
      const isQinggongLike = ab?.qinggong === true || ab?.qinggongGcdImmune === true;
      const ignoreSpectatorCooldown = selfYumenSpectating && isQinggongLike;
      if (maxCharges <= 1) {
        const instanceCooldown = ignoreSpectatorCooldown
          ? 0
          : getRuntimeCountdownTicks(instance, 'cooldown', '_cooldownSyncedAt', cooldownClockMs);
        const rawInstanceCooldown = Math.max(0, Math.round(Number(instance?.cooldown ?? 0)));
        const currentCooldown = Math.max(0, instanceCooldown);
        if (currentCooldown <= 0 && sharedGcdTicks > 0) {
          return {
            maxCharges: undefined,
            chargeCount: undefined,
            chargeRecoveryTicks: undefined,
            chargeRegenTicksRemaining: undefined,
            chargeRegenProgress: undefined,
            chargeCastLockTicks: undefined,
            chargeLockTicks: undefined,
            cooldown: sharedGcdTicks,
            maxCooldown: Math.max(baseGcdTicks, sharedGcdTicks),
            cooldownDisplayKind: 'gcd' as CooldownDisplayKind,
          };
        }
        return {
          maxCharges: undefined,
          chargeCount: undefined,
          chargeRecoveryTicks: undefined,
          chargeRegenTicksRemaining: undefined,
          chargeRegenProgress: undefined,
          chargeCastLockTicks: undefined,
          chargeLockTicks: undefined,
          cooldown: currentCooldown,
          maxCooldown: Math.max(getDisplayMaxCooldown(ab), rawInstanceCooldown, currentCooldown),
          cooldownDisplayKind: 'cooldown' as CooldownDisplayKind,
        };
      }

      const chargeCount = typeof instance?.chargeCount === 'number' ? instance.chargeCount : maxCharges;
      const chargeRecoveryTicks = getChargeRecoveryDisplayTicks(ab);
      const chargeRegenTicksRemaining = ignoreSpectatorCooldown
        ? 0
        : getRuntimeCountdownTicks(
            instance,
            'chargeRegenTicksRemaining',
            '_chargeRegenTicksRemainingSyncedAt',
            cooldownClockMs,
          );
      const chargeRegenProgress = chargeCount < maxCharges
        ? Math.max(0, Math.min(1, 1 - (chargeRegenTicksRemaining / chargeRecoveryTicks)))
        : undefined;
      const chargeCastLockTicks = Math.max(0, Number(ab?.chargeCastLockTicks ?? 0));
      const instanceChargeLockTicks = ignoreSpectatorCooldown
        ? 0
        : getRuntimeCountdownTicks(instance, 'chargeLockTicks', '_chargeLockTicksSyncedAt', cooldownClockMs);
      const rawInstanceChargeLockTicks = Math.max(0, Math.round(Number(instance?.chargeLockTicks ?? 0)));
      const chargeLockTicks = Math.max(0, instanceChargeLockTicks);

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
          cooldownDisplayKind: 'charge' as CooldownDisplayKind,
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
          maxCooldown: Math.max(1, chargeCastLockTicks, rawInstanceChargeLockTicks, chargeLockTicks),
          cooldownDisplayKind: 'cooldown' as CooldownDisplayKind,
        };
      }

      if (sharedGcdTicks > 0) {
        return {
          maxCharges,
          chargeCount,
          chargeRecoveryTicks,
          chargeRegenTicksRemaining,
          chargeRegenProgress,
          chargeCastLockTicks,
          chargeLockTicks,
          cooldown: sharedGcdTicks,
          maxCooldown: Math.max(baseGcdTicks, sharedGcdTicks),
          cooldownDisplayKind: 'gcd' as CooldownDisplayKind,
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
        cooldownDisplayKind: 'cooldown' as CooldownDisplayKind,
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
    const nonQinggongLocked = hasNonQinggongLockClient(me.buffs);
    const rootedByDebuff = buffsHaveAnyEffect(me.buffs, ['ROOT']);
    const displaced = hasDisplacementClient(me.buffs);
    const knockedBack = buffsHaveAnyEffect(me.buffs, ['KNOCKED_BACK']);
    const pulled = buffsHaveAnyEffect(me.buffs, ['PULLED']);
    const controlled = buffsHaveAnyEffect(me.buffs, ['CONTROL', 'ATTACK_LOCK']);
    const yuqiMounted = hasYuqiStateClient(me.buffs);

    const abilityAllowsRuntimeBlockClient = (ab: any, flag: string): boolean => (
      ab?.[flag] === true ||
      (Array.isArray(ab?.effects) && ab.effects.some((effect: any) => effect?.[flag] === true))
    );

    const getAbilityDisabledWarning = (ab: any, instance: any): string | undefined => {
      if (!ab) return '该招式不存在';
      const targetContext = getAbilityTargetContext(ab);
      const targetForChecks = targetContext.targetForChecks;
      const targetPos = targetContext.targetPos;
      const abilityIdForChecks = ab?.id ?? instance?.abilityId;
      const isQinggongLike = ab?.qinggong === true || ab?.qinggongGcdImmune === true;
      const ignoreSpectatorCooldown = selfYumenSpectating && isQinggongLike;
      const sharedGcdTicks = ignoreSpectatorCooldown ? 0 : getSharedGcdTicks(ab);
      const mountedYuqiToggle = yuqiMounted && (ab?.id === 'yuqi' || instance?.abilityId === 'yuqi');
      const maxCharges = Math.max(0, Number(ab?.maxCharges ?? 0));
      if (!ignoreSpectatorCooldown && maxCharges > 1) {
        const chargeCount = typeof instance?.chargeCount === 'number' ? instance.chargeCount : maxCharges;
        const chargeLockTicks = getRuntimeCountdownTicks(instance, 'chargeLockTicks', '_chargeLockTicksSyncedAt', cooldownClockMs);
        if (sharedGcdTicks > 0) return '招式施展失败';
        if (chargeLockTicks > 0) return '招式施展失败';
        if (chargeCount <= 0) return '招式施展失败';
      } else if (!ignoreSpectatorCooldown) {
        const instanceCooldown = getRuntimeCountdownTicks(instance, 'cooldown', '_cooldownSyncedAt', cooldownClockMs);
        if (instanceCooldown > 0) return '招式施展失败';
        if (sharedGcdTicks > 0) return '招式施展失败';
      }

      const airborneLockedLocal =
        jumpLocalRef.current ||
        jumpSendRef.current ||
        localJumpCountRef.current > 0 ||
        Math.abs(localVzRef.current) > 0.01;
      if (isQinggongLike && qinggongSealed) return '招式施展失败';
      if (selfYumenSpectating && !isQinggongLike) return '招式施展失败';
      if (abilityIdForChecks === 'ren_chi_cheng' && isLingRanSpecialJumpActiveClient(me)) {
        return '招式施展失败';
      }
      if (getActiveChannelClient(me?.activeChannel ?? null)) return '正在进行其他动作';
      if (yuqiMounted && !mountedYuqiToggle && ab?.canCastWhileMounted !== true) return '该招式无法在骑行状态下施展';
      const powerLockWarning = getPowerLockWarningClient(ab, me.buffs);
      if (powerLockWarning) return powerLockWarning;
      if (nonQinggongLocked && !isQinggongLike) return '招式施展失败';
      if (displaced && !abilityAllowsRuntimeBlockClient(ab, 'allowWhileDisplaced')) return '该招式无法在位移时施展';
      if (knockedBack && !abilityAllowsRuntimeBlockClient(ab, 'allowWhileKnockedBack')) return '该招式无法在位移时施展';
      if (pulled && !abilityAllowsRuntimeBlockClient(ab, 'allowWhilePulled')) return '该招式无法在位移时施展';
      if (controlled && !abilityAllowsRuntimeBlockClient(ab, 'allowWhileControlled')) return '招式施展失败';
      if (ab?.cannotCastWhileRooted && rootedByDebuff) return '招式施展失败';
      if (ab?.requiresGrounded && airborneLockedLocal && !mountedYuqiToggle) return '该技能需要落地后施放';
      if (requiresStandingAtCastClient(ab) && !mountedYuqiToggle) {
        if (isStandingCastBlocked(wasdKeys)) return '该技能需要站立后施放';
      }
      if (typeof ab?.minSelfHpExclusive === 'number' && (me?.hp ?? 0) <= ab.minSelfHpExclusive) {
        return '气血要求不足';
      }
      if (typeof ab?.minSelfHpPercentExclusive === 'number') {
        const requiredHp = Math.max(1, Number(me?.maxHp ?? maxHp)) * (ab.minSelfHpPercentExclusive / 100);
        if ((me?.hp ?? 0) <= requiredHp) return '气血要求不足';
      }

      // Ground-target abilities stay available after caster-state checks.
      if (ab?.target === 'OPPONENT' && !!ab?.allowGroundCastWithoutTarget) return undefined;

      const needsSelectedTarget = ab?.target === 'OPPONENT' && !ab?.allowGroundCastWithoutTarget;
      if (needsSelectedTarget && selectedSelf && !targetContext.friendlyTarget && !ab?.canTargetSelf) {
        return '目标类型不正确';
      }
      if (needsSelectedTarget && targetContext.friendlyTarget && !targetContext.hasSelectedTarget) return '目标类型不正确';
      if (needsSelectedTarget && !targetPos) return '目标类型不正确';

      // 拿云式: target HP must be < 30%
      if (ab?.id === 'na_yun_shi' || instance?.abilityId === 'na_yun_shi') {
        const tgtHp = (targetForChecks as any)?.hp ?? Infinity;
        const tgtMaxHp = Math.max(1, Number((targetForChecks as any)?.maxHp ?? 100));
        if (tgtHp >= tgtMaxHp * 0.3) return '招式施展失败';
      }
      // 梯云纵 / 扶摇直上 mutual exclusion (mirrors backend gate)
      if (ab?.id === 'ti_yun_zong' || instance?.abilityId === 'ti_yun_zong') {
        if (activeSelfBuffsClient(me.buffs, locallyConsumedJumpBoostAt).some((b: any) => b.buffId === 9001)) return '该招式被当前气劲阻止';
      }
      if (ab?.id === 'fuyao_zhishang' || instance?.abilityId === 'fuyao_zhishang') {
        if (activeSelfBuffsClient(me.buffs, locallyConsumedJumpBoostAt).some((b: any) => b.buffId === 9003)) return '该招式被当前气劲阻止';
      }
      if ((ab?.id === 'hong_meng_tian_jin' || instance?.abilityId === 'hong_meng_tian_jin') && hasShuSeClient((targetForChecks as any)?.buffs)) {
        return '招式施展失败';
      }
      if (ab?.id === 'dou_zhuan_xing_yi' || instance?.abilityId === 'dou_zhuan_xing_yi') {
        if (targetContext.entityTarget) return '招式施展失败';
        if (hasMianLaClient((targetForChecks as any)?.buffs)) return '目标处于免拉状态';
      }
      if (
        ab?.target === 'OPPONENT' &&
        !targetContext.friendlyTarget &&
        targetContext.playerTarget &&
        hasShiFangXuanJiClient((targetContext.playerTarget as any)?.buffs)
      ) {
        return '请选择敌方目标';
      }
      if (ab?.id === 'qin_yin_gong_ming' || instance?.abilityId === 'qin_yin_gong_ming') {
        if (targetContext.entityTarget) return '招式施展失败';
      }
      if (ab?.target !== 'OPPONENT') return undefined;

      const distanceToTarget = (myPos && targetPos)
        ? worldUnitsToNewUnits(Math.sqrt(
            Math.pow(targetPos.x - myPos.x, 2) +
            Math.pow(targetPos.y - myPos.y, 2) +
            Math.pow(((targetPos as any)?.z ?? 0) - ((myPos as any)?.z ?? 0), 2)
          ), mode)
        : Infinity;
      const effectiveRange = getEffectiveAbilityRangeClient(ab, me?.buffs);
      const inMaxRange = typeof effectiveRange !== 'number' || distanceToTarget <= effectiveRange;
      const inMinRange = typeof ab?.minRange !== 'number' || distanceToTarget >= ab.minRange;
      if (!inMaxRange) return '目标在招式范围之外';
      if (!inMinRange) return '目标在招式范围之外';

      if (ab?.target === 'OPPONENT' && myPos && targetPos && !targetContext.selfTarget && !targetContext.friendlyTarget) {
        if (requiresFacingByDefault(ab) && myFacing) {
          const dx = targetPos.x - myPos.x;
          const dy = targetPos.y - myPos.y;
          if (myFacing.x * dx + myFacing.y * dy < 0) return '目标不在面朝方向内';
        }
          const myZ2 = (myPos as any)?.z ?? localZRef.current ?? 0;
          const tgtZ2 = (targetPos as any)?.z ?? 0;
          if (isClientLineBlocked(myPos, targetPos, myZ2, tgtZ2, targetContext.entityTarget?.id)) {
            return '视线被遮挡';
          }
      }
      return undefined;
    };

    const isAbilityReady = (ab: any, instance: any): boolean => !getAbilityDisabledWarning(ab, instance);

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
            disabledWarning: getAbilityDisabledWarning(ability, instance),
          };
        }
        const chargeDisplay = getChargeDisplay(ability, instance);
        const antiStealthBlocked = antiStealthActive && abilityUsesStealthClient(ability);
        const disabledWarning = antiStealthBlocked
          ? '反隐期间无法施展隐身招式'
          : getAbilityDisabledWarning(ability, instance);
        const isReadyVal = !disabledWarning;
        const effectiveRange = getEffectiveAbilityRangeClient(ability, me?.buffs);
        const losBlockedVal = disabledWarning === '视线被遮挡';
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
          baseCooldownTicks: getAbilityRealCooldownTicks(ability),
          cooldown:    chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          cooldownDisplayKind: chargeDisplay.cooldownDisplayKind,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          tooltipChargeRecoveryTicks: Number(ability?.maxCharges ?? 0) > 1
            ? Math.max(1, Math.round(Number(ability?.chargeRecoveryTicks ?? ability?.cooldownTicks ?? 1)))
            : undefined,
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
        const antiStealthBlocked = antiStealthActive && abilityUsesStealthClient(ability);
        const disabledWarning = antiStealthBlocked
          ? '反隐期间无法施展隐身招式'
          : getAbilityDisabledWarning(ability, instance);
        const isReadyVal = !disabledWarning;
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
          baseCooldownTicks: getAbilityRealCooldownTicks(ability),
          cooldown: chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          cooldownDisplayKind: chargeDisplay.cooldownDisplayKind,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          tooltipChargeRecoveryTicks: Number(ability?.maxCharges ?? 0) > 1
            ? Math.max(1, Math.round(Number(ability?.chargeRecoveryTicks ?? ability?.cooldownTicks ?? 1)))
            : undefined,
          chargeRegenTicksRemaining: chargeDisplay.chargeRegenTicksRemaining,
          chargeRegenProgress: chargeDisplay.chargeRegenProgress,
          chargeCastLockTicks: chargeDisplay.chargeCastLockTicks,
          chargeLockTicks: chargeDisplay.chargeLockTicks,
          isReady: isReadyVal,
          losBlocked: disabledWarning === '视线被遮挡',
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
        ) ?? (selfYumenSpectating ? me.specialAbilityStates?.[ability.id] : undefined);
        const chargeDisplay = getChargeDisplay(ability, instance ?? {});
        const antiStealthBlocked = antiStealthActive && abilityUsesStealthClient(ability);
        const disabledWarning = antiStealthBlocked
          ? '反隐期间无法施展隐身招式'
          : getAbilityDisabledWarning(ability, instance);
        const isReadyCom = !disabledWarning;
        const effectiveRange = getEffectiveAbilityRangeClient(ability, me?.buffs);
        const losBlockedCom = disabledWarning === '视线被遮挡';
        return {
          id:          ability.id,
          abilityId:      ability.id,
          name:        ability.name,
          description: ability.description ?? '',
          channel:     getRuntimeAbilityChannel(ability),
          range:       effectiveRange,
          baseRange:   typeof ability.range === 'number' ? ability.range : undefined,
          minRange:    ability.minRange,
          baseCooldownTicks: getAbilityRealCooldownTicks(ability),
          cooldown:    chargeDisplay.cooldown,
          maxCooldown: chargeDisplay.maxCooldown,
          cooldownDisplayKind: chargeDisplay.cooldownDisplayKind,
          maxCharges: chargeDisplay.maxCharges,
          chargeCount: chargeDisplay.chargeCount,
          chargeRecoveryTicks: chargeDisplay.chargeRecoveryTicks,
          tooltipChargeRecoveryTicks: Number(ability?.maxCharges ?? 0) > 1
            ? Math.max(1, Math.round(Number(ability?.chargeRecoveryTicks ?? ability?.cooldownTicks ?? 1)))
            : undefined,
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
    me.activeChannel,
    locallyConsumedJumpBoostAt,
    selectedTargetId,
    selectedEntityId,
    selectedSelf,
    selfYumenSpectating,
    targetableOpponentsList,
    targetableEntityList,
    visibleEntities,
    distance,
    abilities,
    mode,
    wasdKeys,
    hasMovementIntent,
    isStandingCastBlocked,
    cooldownClockMs,
    safeZone?.testShortCooldown,
  ]);

  /* ========================= PICKUP INTERACTION ========================= */

  const buildChatUiLayoutPayload = useCallback((overrides?: Partial<ChatUiLayoutPayload>): ChatUiLayoutPayload => {
    const windows = normalizeChatWindows(overrides?.windows ?? chatWindowsRef.current);
    const detachedWindows = normalizeDetachedChatWindows(overrides?.detachedWindows ?? detachedChatWindowsRef.current, windows);
    const detachedIds = new Set(detachedWindows.map((entry) => entry.id));
    const sourceDetachedSizes = overrides?.detachedPanelSizes ?? detachedChatPanelSizesRef.current;
    const detachedPanelSizes = Object.fromEntries(
      Object.entries(sourceDetachedSizes).filter(([id]) => detachedIds.has(id)).map(([id, size]) => [id, normalizeChatPanelSize(size)])
    ) as Record<string, ChatPanelSize>;
    return {
      panelSize: normalizeChatPanelSize(overrides?.panelSize ?? chatPanelSizeRef.current),
      settings: normalizeChatSettings(overrides?.settings ?? chatSettingsRef.current),
      settingsModalSize: normalizeChatSettingsModalSize(overrides?.settingsModalSize ?? chatSettingsModalSizeRef.current),
      windows,
      activeWindowId: normalizeActiveChatWindowId(overrides?.activeWindowId ?? activeChatWindowIdRef.current, windows),
      detachedWindows,
      detachedPanelSizes,
    };
  }, []);

  const persistUiLayout = useCallback((positions: Record<string, UiPosition>, chatOverrides?: Partial<ChatUiLayoutPayload>) => {
    const viewport = {
      w: Math.round(canvasSizeRef.current.w),
      h: Math.round(canvasSizeRef.current.h),
    };
    const persistedPositions = Object.fromEntries(
      Object.entries(positions).filter(([key]) => key !== CHAT_CLEAR_DIALOG_UI_KEY)
    );
    storedUiViewportRef.current = viewport;
    void fetch('/api/game/ui-layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ positions: persistedPositions, viewport, chat: buildChatUiLayoutPayload(chatOverrides) }),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[BattleArena] persist ui layout failed:', res.status, text);
      }
    }).catch((err) => {
      console.error('[BattleArena] persist ui layout failed:', err);
    });
  }, [buildChatUiLayoutPayload]);

  const persistUiPositions = useCallback((positions: Record<string, UiPosition>) => {
    persistUiLayout(positions);
  }, [persistUiLayout]);

  const updateYumenMiniMapPosition = useCallback((position: UiPosition, shouldPersist: boolean) => {
    setUiPositions((current) => {
      const next = { ...current, [YUMEN_MINIMAP_UI_KEY]: position };
      uiPositionsRef.current = next;
      if (shouldPersist) persistUiPositions(next);
      return next;
    });
  }, [persistUiPositions]);

  useEffect(() => {
    if (!uiLayoutLoadedRef.current) return;
    persistUiLayout(uiPositionsRef.current);
  }, [chatPanelSize, detachedChatPanelSizes, persistUiLayout]);

  useEffect(() => {
    if (!uiLayoutLoadedRef.current) return;
    persistUiLayout(uiPositionsRef.current);
  }, [activeChatWindowId, chatSettings, chatSettingsModalSize, chatWindows, detachedChatWindows, persistUiLayout]);

  useEffect(() => {
    const validWindowIds = new Set(chatWindows.map((entry) => entry.id));
    const assignedWindowIds = new Set<string>();
    const nextDetachedWindows = detachedChatWindowsRef.current
      .map((entry) => {
        const windowIds = entry.windowIds.filter((windowId) => windowId !== 'combined' && validWindowIds.has(windowId) && !assignedWindowIds.has(windowId));
        windowIds.forEach((windowId) => assignedWindowIds.add(windowId));
        return {
          ...entry,
          windowIds,
          activeWindowId: windowIds.includes(entry.activeWindowId) ? entry.activeWindowId : windowIds[0] ?? entry.activeWindowId,
        };
      })
      .filter((entry) => entry.windowIds.length > 0);
    const nextMainWindowIds = chatMainWindowIdsRef.current.filter((windowId) => validWindowIds.has(windowId) && !assignedWindowIds.has(windowId));
    for (const windowConfig of chatWindows) {
      if (!assignedWindowIds.has(windowConfig.id) && !nextMainWindowIds.includes(windowConfig.id)) {
        nextMainWindowIds.push(windowConfig.id);
      }
    }
    detachedChatWindowsRef.current = nextDetachedWindows;
    chatMainWindowIdsRef.current = nextMainWindowIds;
    setDetachedChatWindows(nextDetachedWindows);
    setChatMainWindowIds(nextMainWindowIds);
  }, [chatWindows]);

  const clampDetachedChatPosition = useCallback((position: UiPosition): UiPosition => {
    const viewport = canvasSizeRef.current;
    const size = chatPanelSizeRef.current;
    const maxLeft = Math.max(12, Math.round(viewport.w - size.width - 12));
    const maxTop = Math.max(12, Math.round(viewport.h - size.height - 12));
    return {
      left: Math.max(12, Math.min(maxLeft, Math.round(position.left))),
      top: Math.max(12, Math.min(maxTop, Math.round(position.top))),
    };
  }, []);

  const updateDetachedChatGroupPosition = useCallback((detachedId: string, clientX: number, clientY: number, pointerOffset?: { x: number; y: number }) => {
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return;
    const positionKey = getDetachedChatWindowUiKey(detachedId);
    const nextPosition = clampDetachedChatPosition({
      left: clientX - wrapRect.left - (pointerOffset?.x ?? Math.round(chatPanelSizeRef.current.width / 2)),
      top: clientY - wrapRect.top - (pointerOffset?.y ?? 14),
    });
    setUiPositions((current) => {
      const next = { ...current, [positionKey]: nextPosition };
      uiPositionsRef.current = next;
      return next;
    });
  }, [clampDetachedChatPosition]);

  const detachChatWindow = useCallback((windowId: string, sourceGroupId: string, clientX: number, clientY: number, pointerOffset?: { x: number; y: number }): string | null => {
    const windowConfig = chatWindowsRef.current.find((entry) => entry.id === windowId);
    if (!windowConfig || windowConfig.id === 'combined') return null;
    let detachedId = `detached-${windowId}-${Date.now().toString(36)}`;
    let nextMainWindowIds = chatMainWindowIdsRef.current;
    let nextDetachedWindows = detachedChatWindowsRef.current;

    if (sourceGroupId === 'main') {
      nextMainWindowIds = chatMainWindowIdsRef.current.filter((id) => id !== windowId);
      if (activeChatWindowIdRef.current === windowId) {
        setActiveChatWindowId(nextMainWindowIds[0] ?? DEFAULT_CHAT_WINDOWS[0].id);
      }
      nextDetachedWindows = [...nextDetachedWindows, { id: detachedId, windowIds: [windowId], activeWindowId: windowId }];
    } else {
      const sourceGroup = nextDetachedWindows.find((entry) => entry.id === sourceGroupId);
      if (!sourceGroup || !sourceGroup.windowIds.includes(windowId)) return null;
      if (sourceGroup.windowIds.length <= 1) {
        detachedId = sourceGroup.id;
      } else {
        nextDetachedWindows = nextDetachedWindows.map((entry) => {
          if (entry.id !== sourceGroupId) return entry;
          const windowIds = entry.windowIds.filter((id) => id !== windowId);
          return {
            ...entry,
            windowIds,
            activeWindowId: windowIds.includes(entry.activeWindowId) ? entry.activeWindowId : windowIds[0] ?? entry.activeWindowId,
          };
        });
        nextDetachedWindows = [...nextDetachedWindows, { id: detachedId, windowIds: [windowId], activeWindowId: windowId }];
      }
    }

    chatMainWindowIdsRef.current = nextMainWindowIds;
    detachedChatWindowsRef.current = nextDetachedWindows;
    setChatMainWindowIds(nextMainWindowIds);
    setDetachedChatWindows(nextDetachedWindows);
    updateDetachedChatGroupPosition(detachedId, clientX, clientY, pointerOffset);
    return detachedId;
  }, [updateDetachedChatGroupPosition]);

  const mergeDetachedChatGroup = useCallback((detachedId: string, targetGroupId: string) => {
    if (detachedId === targetGroupId) return;
    const draggedGroup = detachedChatWindowsRef.current.find((entry) => entry.id === detachedId);
    if (!draggedGroup) return;
    const positionKey = getDetachedChatWindowUiKey(detachedId);
    const nextPositions = { ...uiPositionsRef.current };
    delete nextPositions[positionKey];
    uiPositionsRef.current = nextPositions;
    setUiPositions(nextPositions);

    if (targetGroupId === 'main') {
      const nextMainWindowIds = [...chatMainWindowIdsRef.current];
      for (const windowId of draggedGroup.windowIds) {
        if (!nextMainWindowIds.includes(windowId)) nextMainWindowIds.push(windowId);
      }
      const nextDetachedWindows = detachedChatWindowsRef.current.filter((entry) => entry.id !== detachedId);
      chatMainWindowIdsRef.current = nextMainWindowIds;
      detachedChatWindowsRef.current = nextDetachedWindows;
      setChatMainWindowIds(nextMainWindowIds);
      setDetachedChatWindows(nextDetachedWindows);
      setActiveChatWindowId(draggedGroup.activeWindowId);
      return;
    }

    const targetGroup = detachedChatWindowsRef.current.find((entry) => entry.id === targetGroupId);
    if (!targetGroup) return;
    const nextDetachedWindows = detachedChatWindowsRef.current
      .filter((entry) => entry.id !== detachedId)
      .map((entry) => {
        if (entry.id !== targetGroupId) return entry;
        const windowIds = [...entry.windowIds];
        for (const windowId of draggedGroup.windowIds) {
          if (!windowIds.includes(windowId)) windowIds.push(windowId);
        }
        return { ...entry, windowIds, activeWindowId: draggedGroup.activeWindowId };
      });
    setDetachedChatWindows(nextDetachedWindows);
    detachedChatWindowsRef.current = nextDetachedWindows;
  }, []);

  const findChatTabBarDropTarget = useCallback((clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const tabBar = element?.closest('[data-chat-tab-bar-group="true"]') as HTMLElement | null;
    return tabBar?.dataset.chatGroupId ?? null;
  }, []);

  const beginChatTabDetachDrag = useCallback((windowConfig: ChatWindowConfig, sourceGroupId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (windowConfig.id === 'combined' || event.button !== 0) return;
    const headerRect = (event.currentTarget.closest('[data-chat-tab-bar-group="true"]') as HTMLElement | null)?.getBoundingClientRect();
    if (!headerRect) return;
    const tabRect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const dragPointerOffset = {
      x: Math.max(0, Math.round(startX - tabRect.left)),
      y: Math.max(0, Math.round(startY - headerRect.top)),
    };
    let dragGroupId: string | null = null;

    const onMove = (moveEvent: MouseEvent) => {
      const movedEnough = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8;
      if (!dragGroupId && movedEnough) {
        const outsideHeader = moveEvent.clientX < headerRect.left
          || moveEvent.clientX > headerRect.right
          || moveEvent.clientY < headerRect.top
          || moveEvent.clientY > headerRect.bottom;
        if (outsideHeader) {
          chatTabClickSuppressedRef.current = sourceGroupId;
          dragGroupId = detachChatWindow(windowConfig.id, sourceGroupId, moveEvent.clientX, moveEvent.clientY, dragPointerOffset);
          if (dragGroupId) setDraggingChatGroupId(dragGroupId);
        }
      }
      if (dragGroupId) {
        updateDetachedChatGroupPosition(dragGroupId, moveEvent.clientX, moveEvent.clientY, dragPointerOffset);
      }
    };
    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragGroupId) {
        const targetGroupId = findChatTabBarDropTarget(upEvent.clientX, upEvent.clientY);
        if (targetGroupId && targetGroupId !== dragGroupId) {
          mergeDetachedChatGroup(dragGroupId, targetGroupId);
        }
        persistUiLayout(uiPositionsRef.current, {
          detachedWindows: detachedChatWindowsRef.current,
          detachedPanelSizes: detachedChatPanelSizesRef.current,
        });
        setDraggingChatGroupId(null);
      }
      window.setTimeout(() => {
        if (chatTabClickSuppressedRef.current === sourceGroupId) {
          chatTabClickSuppressedRef.current = null;
        }
      }, 250);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [detachChatWindow, findChatTabBarDropTarget, mergeDetachedChatGroup, persistUiLayout, updateDetachedChatGroupPosition]);

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

  const getDefaultMartialPanelPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(8, Math.round(w * 0.012)),
      top: Math.max(52, Math.round(h * 0.15)),
    };
  }, []);

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

  const getDefaultYumenKillNoticePos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round((w - yumenKillNoticeSize.width) / 2)),
      top: Math.max(12, Math.round(h * 0.10)),
    };
  }, [yumenKillNoticeSize.width]);

  const getDefaultYumenKillConfirmPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round((w - yumenKillConfirmSize.width) / 2)),
      top: Math.max(12, Math.round(h * 0.42 - yumenKillConfirmSize.height / 2)),
    };
  }, [yumenKillConfirmSize.height, yumenKillConfirmSize.width]);

  const getDefaultYumenAliveCountPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round(w - yumenAliveCountSize.width - 52)),
      top: Math.max(12, Math.round(h * 0.29)),
    };
  }, [yumenAliveCountSize.width]);

  const getDefaultItemBarPos = useCallback(() => {
    const { w } = canvasSizeRef.current;
    return getUiPositionFromRef(itemBarRef, {
      left: Math.max(12, Math.round(w / 2 - 330)),
      top: 24,
    });
  }, [getUiPositionFromRef]);

  const getDefaultChatPanelPos = useCallback(() => {
    const { h } = canvasSizeRef.current;
    return getUiPositionFromRef(chatPanelRef, {
      left: 10,
      top: Math.max(12, Math.round(h - chatPanelSize.height - 42)),
    });
  }, [chatPanelSize.height, getUiPositionFromRef]);

  const getDefaultChatClearDialogPos = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    return {
      left: Math.max(12, Math.round((w - chatClearDialogLayout.width) / 2)),
      top: Math.max(12, Math.round(h * 0.12)),
    };
  }, [chatClearDialogLayout.width]);

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
    return getUiPositionFromElement(channelElement ?? null, fallback);
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
    return getUiPositionFromElement(gcdElement ?? null, fallback);
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

  const startMartialPanelTemporaryDrag = useCallback((e: React.MouseEvent, basePos: UiPosition, size: { width: number; height: number }) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    e.stopPropagation();
    mouseStateRef.current.isLeft = false;
    mouseStateRef.current.isRight = false;
    manualCameraLookActiveRef.current = false;

    const startX = e.clientX;
    const startY = e.clientY;
    const base = martialPanelTempPosRef.current ?? basePos;
    const clampPanelPosition = (position: UiPosition): UiPosition => {
      const viewport = canvasSizeRef.current;
      const maxLeft = Math.max(12, Math.round(viewport.w - size.width - 12));
      const maxTop = Math.max(12, Math.round(viewport.h - size.height - 12));
      return {
        left: Math.max(12, Math.min(maxLeft, Math.round(position.left))),
        top: Math.max(12, Math.min(maxTop, Math.round(position.top))),
      };
    };
    const onMove = (event: MouseEvent) => {
      const next = clampPanelPosition({ left: base.left + event.clientX - startX, top: base.top + event.clientY - startY });
      martialPanelTempPosRef.current = next;
      setMartialPanelTempPos(next);
    };
    const onUp = (event: MouseEvent) => {
      const next = clampPanelPosition({ left: base.left + event.clientX - startX, top: base.top + event.clientY - startY });
      martialPanelTempPosRef.current = next;
      setMartialPanelTempPos(next);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

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
      const yumenKillNoticeBase = prev[YUMEN_KILL_NOTICE_UI_KEY] ?? getDefaultYumenKillNoticePos();
      const yumenKillConfirmBase = prev[YUMEN_KILL_CONFIRM_UI_KEY] ?? getDefaultYumenKillConfirmPos();
      const yumenAliveCountBase = prev[YUMEN_ALIVE_COUNT_UI_KEY] ?? getDefaultYumenAliveCountPos();
      const itemBarBase = prev[ITEM_BAR_UI_KEY] ?? getDefaultItemBarPos();
      const martialPanelBase = prev[MARTIAL_PANEL_UI_KEY] ?? getDefaultMartialPanelPos();
      const chatPanelBase = prev[CHAT_PANEL_UI_KEY] ?? getDefaultChatPanelPos();
      const chatClearDialogBase = prev[CHAT_CLEAR_DIALOG_UI_KEY] ?? getDefaultChatClearDialogPos();
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
        [YUMEN_KILL_NOTICE_UI_KEY]: yumenKillNoticeBase,
        [YUMEN_KILL_CONFIRM_UI_KEY]: yumenKillConfirmBase,
        [YUMEN_ALIVE_COUNT_UI_KEY]: yumenAliveCountBase,
        [ITEM_BAR_UI_KEY]: itemBarBase,
        [MARTIAL_PANEL_UI_KEY]: martialPanelBase,
        [CHAT_PANEL_UI_KEY]: chatPanelBase,
        [CHAT_CLEAR_DIALOG_UI_KEY]: chatClearDialogBase,
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
    getDefaultChatPanelPos,
    getDefaultChatClearDialogPos,
    getDefaultInGameWarningPos,
    getDefaultItemBarPos,
    getDefaultMartialPanelPos,
    getDefaultPlayerChannelBarPos,
    getDefaultPlayerGcdBarPos,
    getDefaultPlayerIconBarPos,
    getDefaultPlayerStatusPos,
    getDefaultTargetIconBarPos,
    getDefaultTargetTargetIconBarPos,
    getDefaultTargetOwnedAbilityBarPos,
    getDefaultTargetStatusPos,
    getDefaultYumenAliveCountPos,
    getDefaultYumenKillConfirmPos,
    getDefaultYumenKillNoticePos,
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
    const resetMovementKeys = () => {
      autoForwardRef.current = false;
      setAutoForward(false);
      keysRef.current = { w: false, a: false, s: false, d: false };
      setWasdKeys({ w: false, a: false, s: false, d: false });
      crashRecorder.recordBehavior('movement-reset', { reason: document.hidden ? 'hidden' : 'blur' });
    };
    const onDown = (e: KeyboardEvent) => {
      if (!e.repeat) {
        crashRecorder.recordBehavior('key-down', { key: e.key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey });
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (chatClearDialog) {
          setChatClearDialog(null);
          return;
        }
        if (showChatSettings) {
          cancelChatSettings();
          return;
        }
        if (customUiMode) {
          cancelCustomUiMode();
          return;
        }
        if (martialPresetModal) {
          setMartialPresetModal(null);
          return;
        }
        if (showMartialPanel) {
          setShowMartialPanel(false);
          setMartialPanelTempPos(null);
          martialPanelTempPosRef.current = null;
          return;
        }
        toggleEscPanel();
        return;
      }
      const functionKeyNumber = /^F(\d{1,2})$/.exec(e.key)?.[1];
      const blockedFunctionKey = functionKeyNumber ? Number(functionKeyNumber) >= 1 && Number(functionKeyNumber) <= 10 : false;
      const blockedRefreshShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r';
      const blockedHistoryShortcut = e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
      const blockedBrowserKey = e.key === 'BrowserBack' || e.key === 'BrowserForward';
      if (blockedFunctionKey || blockedRefreshShortcut || blockedHistoryShortcut || blockedBrowserKey) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const keyboardTarget = e.target;
      if (keyboardTarget instanceof Element && keyboardTarget.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Enter' && !showTestingPanel && !showChatSettings && !chatClearDialog && !customUiMode && !martialPresetModal) {
        e.preventDefault();
        focusChatInput();
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
        crashRecorder.recordBehavior('movement-key-down', { key: k, keys: { ...keysRef.current }, autoForward: autoForwardRef.current });

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
        crashRecorder.recordBehavior('jump-key', { keys: { ...keysRef.current }, z: localZRef.current });
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
          crashRecorder.recordBehavior('auto-forward-on', { keys: { ...keysRef.current } });
          toastSuccess('自动前行已开启（按 S 停止）');
        }
        return;
      }
      // Tab / F1 — select the nearest currently targetable enemy player or entity.
      // Rules:
      //   - Only consider targets within ±90° of facing (180° front cone).
      //   - Only consider targets within 60 units.
      //   - Exclude the currently selected target so Tab always cycles when an
      //     alternative is available.
      if (e.key === 'Tab' || e.key === 'F1') {
        e.preventDefault();
        const TARGET_SELECT_MAX_UNITS = 60;
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
          const dz = (c.position.z ?? 0) - ((myPos as any).z ?? 0);
          const distUnits = worldUnitsToNewUnits(Math.sqrt(dx * dx + dy * dy + dz * dz), mode);
          if (distUnits > TARGET_SELECT_MAX_UNITS) return false;
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
          // No alternative target inside facing cone + range. Keep current target unchanged.
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
        crashRecorder.recordBehavior('target-selected-hotkey', { kind: nearest.kind, id: nearest.id });
        setSelectedSelf(false);
        selectedSelfRef.current = false;
        return;
      }
      const pressedHotkey = normalizeKeyboardHotkey(e);
      if (pressedHotkey && triggerHotkeyBinding(pressedHotkey.id)) {
        e.preventDefault();
        return;
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
        crashRecorder.recordBehavior('movement-key-up', { key: k, keys: { ...keysRef.current }, autoForward: autoForwardRef.current });
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
    window.addEventListener('keydown', onDown, { capture: true });
    window.addEventListener('keyup',   onUp);
    window.addEventListener('blur',    resetMovementKeys);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onDown, { capture: true });
      window.removeEventListener('keyup',   onUp);
      window.removeEventListener('blur',    resetMovementKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [crashRecorder, tryQueueLocalJump, sendMovement, customUiMode, cancelCustomUiMode, cancelChatSettings, chatClearDialog, martialPresetModal, showMartialPanel, showTestingPanel, showChatSettings, focusChatInput, toggleEscPanel, triggerHotkeyBinding, mode]);

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
    const isMouseUiTarget = (target: EventTarget | null) => {
      return target instanceof Element && !!target.closest(`button, input, select, textarea, label, [data-ui-drag], [data-ui-interactive], .${styles.escOverlay}`);
    };
    const isTextEntryTarget = (target: EventTarget | null) => {
      return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]');
    };
    const isTextEntryActive = (target: EventTarget | null) => {
      return isTextEntryTarget(target) || isTextEntryTarget(document.activeElement);
    };
    const hasSideButtonCombo = (buttons: number) => (buttons & 8) !== 0 && (buttons & 16) !== 0;

    const onMouseDown = (e: MouseEvent) => {
      if (hasSideButtonCombo(e.buttons) && isTextEntryActive(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (customUiMode) {
        resetMouseButtons();
        return;
      }
      if (abilityDragActiveRef.current) {
        resetMouseButtons();
        return;
      }
      crashRecorder.recordBehavior('mouse-down', { button: e.button, x: e.clientX, y: e.clientY });
      const mouseHotkey = normalizeMouseHotkey(e.button);
      if (mouseHotkey && !isMouseUiTarget(e.target) && triggerHotkeyBinding(mouseHotkey.id)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Left button — start camera drag
      if (e.button === 0) {
        // Only start drag if not clicking a UI button or a draggable panel
        if (isMouseUiTarget(e.target)) return;
        if (yumenBoundaryEditModeRef.current) {
          mouseStateRef.current.isLeft = false;
          manualCameraLookActiveRef.current = false;
          return;
        }
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
      if (e.button === 1 || e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      crashRecorder.recordBehavior('mouse-up', { button: e.button, x: e.clientX, y: e.clientY });
      setPressedAbilityInput(null);
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
        return;
      }
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (hasSideButtonCombo(e.buttons) && isTextEntryActive(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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
      if (yumenBoundaryEditModeRef.current && ms.isLeft) {
        ms.isLeft = false;
        manualCameraLookActiveRef.current = false;
        if (!ms.isRight) return;
      }
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
      if (e.button === 1 || ((e.button === 3 || e.button === 4) && isTextEntryActive(e.target))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onSideButtonPointer = (e: PointerEvent) => {
      if (isTextEntryActive(e.target) && (e.button === 3 || e.button === 4 || hasSideButtonCombo(e.buttons))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (customUiMode) return;
      if (e.target instanceof Element && e.target.closest(`[data-testing-panel], input, select, textarea, [data-ui-interactive], .${styles.escOverlay}`)) return;
      const wheelHotkey = normalizeWheelHotkey(e.deltaY);
      if (wheelHotkey && triggerHotkeyBinding(wheelHotkey.id)) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.12 : -0.12;
      const zoomMax = cameraDistanceToZoom(cameraSettings.maxDistance);
      camZoomRef.current = Math.max(CAMERA_ZOOM_MIN, Math.min(zoomMax, camZoomRef.current + delta));
      setCameraZoomLevel(camZoomRef.current);
      crashRecorder.recordBehavior('camera-wheel', { deltaY: e.deltaY, zoom: camZoomRef.current, zoomMax });
    };
    // Use capture phase so we intercept BEFORE the browser's own navigation handlers
    window.addEventListener('mousedown',   onMouseDown,   { capture: true });
    window.addEventListener('mouseup',     onMouseUp,     { capture: true });
    window.addEventListener('pointerdown', onSideButtonPointer, { capture: true });
    window.addEventListener('pointerup',   onSideButtonPointer, { capture: true });
    window.addEventListener('pointermove', onSideButtonPointer, { capture: true });
    window.addEventListener('mousemove',   onMouseMove,   { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('auxclick',    onAuxClick,    { capture: true });
    window.addEventListener('wheel',       onWheel,       { passive: false, capture: true });
    window.addEventListener('blur',        resetMouseButtons);
    return () => {
      cancelMouseLookFacingSync();
      window.removeEventListener('mousedown',   onMouseDown,   { capture: true });
      window.removeEventListener('mouseup',     onMouseUp,     { capture: true });
      window.removeEventListener('pointerdown', onSideButtonPointer, { capture: true });
      window.removeEventListener('pointerup',   onSideButtonPointer, { capture: true });
      window.removeEventListener('pointermove', onSideButtonPointer, { capture: true });
      window.removeEventListener('mousemove',   onMouseMove,   { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('auxclick',    onAuxClick,    { capture: true });
      window.removeEventListener('wheel',       onWheel,       { capture: true } as EventListenerOptions);
      window.removeEventListener('blur',        resetMouseButtons);
    };
  }, [cameraSettings.maxDistance, clearTargetSelection, crashRecorder, customUiMode, triggerHotkeyBinding]);

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
      crashRecorder.recordBehavior('touch-camera-start', { x: touch.clientX, y: touch.clientY });
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
        crashRecorder.recordBehavior('touch-camera-end', { x: touch.clientX, y: touch.clientY });
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
  }, [crashRecorder, customUiMode]);

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
    // Keep the client catch-up cap aligned with the backend GameLoop cap.
    const MAX_CLIENT_PHYSICS_CATCHUP_TICKS = 6;
    const tick = (tickNowMs = performance.now()) => {
      const pos = localPositionRef.current;
      if (!pos) {
        cameraMoveCommandActiveRef.current = false;
        cameraForwardMoveCommandActiveRef.current = false;
        return;
      }
      if (isExportedMap && !collisionReadyRef.current) {
        cameraMoveCommandActiveRef.current = false;
        cameraForwardMoveCommandActiveRef.current = false;
        localVelocityRef.current = { x: 0, y: 0 };
        localVzRef.current = 0;
        return;
      }
      cameraForwardMoveCommandActiveRef.current = false;
      const effectiveMaxSpeed = MAX_SPEED * moveSpeedScaleRef.current;
      const effectiveMaxJumps = getEffectiveMaxJumps();

      // During server-authoritative dash: skip movement + gravity, but KEEP camera/turning
      if (meActiveDashRef.current) {
        cameraMoveCommandActiveRef.current = false;
        cameraForwardMoveCommandActiveRef.current = false;
        localVelocityRef.current.x = 0;
        localVelocityRef.current.y = 0;
        jumpLocalRef.current = false;
        // Post-dash jump allowance: MULTI_JUMP → full reset, normal → 1 jump only
        localJumpCountRef.current = effectiveMaxJumps > 2 ? 0 : 1;
        airborneSpeedCarryRef.current = 0;
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
      const useBVH = isExportedMap && !!collisionSysRef.current;
      const rawTickGroundH = (() => {
        if (!useBVH) {
          return getGroundHeightClient(pos.x, pos.y, localZRef.current, objs, playerRadius);
        }

        const sys = collisionSysRef.current!;
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        _bvhCenter.set(
          (pos.x - halfW - GROUP_POS_X) / RENDER_SF_XZ,
          (localZRef.current - GROUP_POS_Y) / RENDER_SF_Y + EXPORT_CYL_HALF_HEIGHT,
          (halfH - pos.y - GROUP_POS_Z) / RENDER_SF_XZ,
        );
        const supportY = getBvhGroundSupportY(sys, _bvhCenter);
        if (supportY === null) {
          return 0;
        }
        return supportY * RENDER_SF_Y + GROUP_POS_Y;
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
        cameraForwardMoveCommandActiveRef.current = !!moveDirection && !moveIntent.backpedalOnly && (
          mouseLook
            ? ((k.w && !k.s) || bothMouse || (k.a && k.d && !k.s))
            : (k.w && !k.s)
        );
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
        cameraForwardMoveCommandActiveRef.current = !movementLocked && (
          (!!moveDir && k.w && !k.s) ||
          (Math.hypot(joystickDirRef.current?.dx ?? 0, joystickDirRef.current?.dy ?? 0) > 0.01 && (joystickDirRef.current?.dy ?? 0) > 0.01)
        );
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
      const playAreaClamped = clampPositionToPlayAreaClient(newPx, newPy, playAreaRef.current, ARENA_WIDTH, ARENA_HEIGHT, playerRadius, vel);
      newPx = playAreaClamped.x;
      newPy = playAreaClamped.y;

      // Map object collision

      if (useBVH) {
        // ── BVH sphere collision (matches export-reader exactly) ──
        const sys = collisionSysRef.current!;
        const halfW = ARENA_WIDTH / 2;
        const halfH = ARENA_HEIGHT / 2;
        // ── Cylinder horizontal pass ──
        // _bvhCenter.y = cylinder centre (feet + half-height); preserved between ticks.
        // Only update X/Z for horizontal movement; Y is owned by the vertical pass.
        _bvhCenter.x = (newPx - halfW - GROUP_POS_X) / RENDER_SF_XZ;
        _bvhCenter.z = (halfH - newPy - GROUP_POS_Z) / RENDER_SF_XZ;
        if (!bvhCenterYInitRef.current) {
          // First tick after spawn/teleport: set centre from current feet position.
          _bvhCenter.y = (localZRef.current - GROUP_POS_Y) / RENDER_SF_Y + EXPORT_CYL_HALF_HEIGHT;
          bvhCenterYInitRef.current = true;
        }
        // Sphere at cylinder centre provides correct horizontal wall push (push.y=0 for walls)
        _bvhVelocity.set(
          (vel.x + nudgeX) / RENDER_SF_XZ,
          0, // vertical handled separately; don't let wall contacts corrupt Vz
          -(vel.y + nudgeY) / RENDER_SF_XZ,
        );
        sys.resolveSphereCollision(_bvhCenter, EXPORT_CYL_RADIUS, _bvhVelocity);

        // Convert back → game horizontal (clamp to arena bounds)
        newPx = Math.max(playerRadius, Math.min(ARENA_WIDTH - playerRadius,
          _bvhCenter.x * RENDER_SF_XZ + GROUP_POS_X + halfW));
        newPy = Math.max(playerRadius, Math.min(ARENA_HEIGHT - playerRadius,
          halfH - (_bvhCenter.z * RENDER_SF_XZ + GROUP_POS_Z)));
        const bvhPlayAreaClamped = clampPositionToPlayAreaClient(newPx, newPy, playAreaRef.current, ARENA_WIDTH, ARENA_HEIGHT, playerRadius, vel);
        newPx = bvhPlayAreaClamped.x;
        newPy = bvhPlayAreaClamped.y;
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
      const wallPlayAreaClamped = clampPositionToPlayAreaClient(newPx, newPy, playAreaRef.current, ARENA_WIDTH, ARENA_HEIGHT, playerRadius, vel);
      newPx = wallPlayAreaClamped.x;
      newPy = wallPlayAreaClamped.y;
      if (useBVH) {
        _bvhCenter.x = (newPx - ARENA_WIDTH / 2 - GROUP_POS_X) / RENDER_SF_XZ;
        _bvhCenter.z = (ARENA_HEIGHT / 2 - newPy - GROUP_POS_Z) / RENDER_SF_XZ;
      }

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
          const consumeLocalJumpBoost = hasFuyaoBuffRef.current;
          const isBackpedalAirJump = moveIntentBackpedalOnly && localJumpCountRef.current > 0 && jumpDir !== null;
          const heightAboveGround = Math.max(0, localZRef.current - tickGroundH);
          const includeAirborneCarryForJump = localJumpCountRef.current <= 0;
          const jumpSpeedSource = Math.max(
            effectiveMaxSpeed,
            includeAirborneCarryForJump ? airborneSpeedCarryRef.current : 0,
            Math.hypot(vel.x, vel.y),
            includeAirborneCarryForJump ? getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current) : 0,
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
        const usesWalkMatchedBudget =
          !isBackpedalAirJump &&
          !usePowerDirectionalBudget &&
          !movementControlStateRef.current.tiYunZongActive &&
          !hadPowerJumpAirtime &&
          !isMultiJump;
        hasFuyaoBuffRef.current   = false;
        if (consumeLocalJumpBoost) {
          const consumedAt = Date.now();
          locallyConsumedJumpBoostAtRef.current = consumedAt;
          setLocallyConsumedJumpBoostAt(consumedAt);
        }
        const jumpVzScale = movementControlStateRef.current.jumpVzScale ?? 1;
        if (jumpVzScale < 1) jumpVz *= jumpVzScale;
        const jumpTravelTicks = estimateAirborneTicks(
          heightAboveGround,
          jumpVz,
          jumpGravityUp,
          jumpGravityDown,
        );
        const jumpTravelDistance = usesWalkMatchedBudget
          ? Math.max(0, jumpSpeedSource) * jumpTravelTicks
          : directionalJumpDistance * Math.max(0, jumpSpeedScale);
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
          expectedLandWorld: jumpDir ? jumpTravelDistance : 0,
          startSpeedUnitsPerSec: (jumpSpeedSource * CLIENT_TICK_HZ) / UNIT_SCALE,
          jumpPhase: nextJumpPhase,
          mode: jumpDir ? 'directional' : 'upward',
        };

        airNudgeRemainingRef.current = 0;
        airNudgeTicksRemainingRef.current = 0;
        airNudgeDirRef.current = null;
        airDirectionLockedRef.current = false;

        if (jumpDir) {
          airNudgeRemainingRef.current = jumpTravelDistance;
          airNudgeTicksRemainingRef.current = jumpTravelTicks;
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
        _bvhCenter.y += localVzRef.current / RENDER_SF_Y;

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
        const feetGameZ = (_bvhCenter.y - EXPORT_CYL_HALF_HEIGHT) * RENDER_SF_Y + GROUP_POS_Y;
        localZRef.current = feetGameZ;
        rawClientGroundH = bvhOnGround
          ? feetGameZ
          : (groundExportY !== null ? groundExportY * RENDER_SF_Y + GROUP_POS_Y : feetGameZ);
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
    let lastPhysicsAtMs = performance.now();
    let simulatedPhysicsAtMs = lastPhysicsAtMs;
    let physicsAccumulatorMs = 0;
    const runPhysics = () => {
      const nowMs = performance.now();
      const rawElapsedMs = nowMs - lastPhysicsAtMs;
      if (rawElapsedMs >= 250) {
        lastLocalPhysicsStallAtRef.current = nowMs;
      }
      const elapsedMs = Math.max(0, Math.min(rawElapsedMs, CLIENT_TICK_MS * MAX_CLIENT_PHYSICS_CATCHUP_TICKS));
      lastPhysicsAtMs = nowMs;
      physicsAccumulatorMs += elapsedMs;

      let catchupTicks = 0;
      while (physicsAccumulatorMs >= CLIENT_TICK_MS && catchupTicks < MAX_CLIENT_PHYSICS_CATCHUP_TICKS) {
        simulatedPhysicsAtMs += CLIENT_TICK_MS;
        tick(simulatedPhysicsAtMs);
        physicsAccumulatorMs -= CLIENT_TICK_MS;
        catchupTicks += 1;
      }

      if (physicsAccumulatorMs > CLIENT_TICK_MS * MAX_CLIENT_PHYSICS_CATCHUP_TICKS) {
        physicsAccumulatorMs = CLIENT_TICK_MS * MAX_CLIENT_PHYSICS_CATCHUP_TICKS;
      }
    };
    advanceLocalPhysicsRef.current = runPhysics;
    const id = setInterval(runPhysics, CLIENT_TICK_MS);
    return () => {
      advanceLocalPhysicsRef.current = () => {};
      clearInterval(id);
    };
  }, [ARENA_HEIGHT, ARENA_WIDTH, getEffectiveMaxJumps, isExportedMap, me.userId, mode, playerRadius]);

  useEffect(() => {
    const id = setInterval(sendMovement, 1000 / 30);
    return () => { clearInterval(id); };
  }, [sendMovement]);

  /* ========================= HUD DATA ========================= */
  const myMaxHp = me?.maxHp ?? maxHp;
  const myAttackDamage = Math.max(0, Number((me as any)?.attackDamage ?? 50_000));
  const myShield = getLinkedShieldDisplayClient(me);
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
  const meEffects = activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt).flatMap((b: any) => Array.isArray(b?.effects) ? b.effects : []);
  const getTypedEffectTotal = (effectType: string, damageType: '外功' | '内功') => activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt)
    .reduce((sum: number, buff: any) => {
      const stackCount = Math.max(1, Number(buff?.stacks ?? 1));
      const effects = Array.isArray(buff?.effects) ? buff.effects : [];
      const buffContribution = effects
        .filter((e: any) => e?.type === effectType && (!e?.damageType || e?.damageType === damageType))
        .reduce((effectSum: number, e: any) => effectSum + Number(e?.value ?? 0), 0);
      return sum + (buffContribution * stackCount);
    }, 0);
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
  const heartStatRows: HeartStatRow[] = ([
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
  ] satisfies HeartStatRow[]).sort((a, b) => HEART_STAT_ORDER.indexOf(a.key) - HEART_STAT_ORDER.indexOf(b.key));
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

  const martialRarityOptions = [
    { id: 'all', label: '全部稀有度', optionLabel: '全部', color: '#8aa3a1' },
    { id: '稀世', label: '稀世', color: RARITY_COLOR['稀世'] },
    { id: '珍奇', label: '珍奇', color: RARITY_COLOR['珍奇'] },
    { id: '卓越', label: '卓越', color: RARITY_COLOR['卓越'] },
    { id: '精巧', label: '精巧', color: RARITY_COLOR['精巧'] },
  ];
  const martialSchoolOptions = [
    { id: 'all', label: '全部门派', optionLabel: '全部', color: '#8aa3a1' },
    ...SCHOOL_TAGS_BA.map((school) => ({ id: school, label: school, color: SCHOOL_COLOR[school] ?? '#8a9297' })),
  ];
  const martialViewportWidth = Math.max(1, Math.round(canvasSizeRef.current.w || canvasSize.w || 1200));
  const martialViewportHeight = Math.max(1, Math.round(canvasSizeRef.current.h || canvasSize.h || 800));
  const martialPanelDimensions = computeMartialPanelDimensions({
    viewportWidth: martialViewportWidth,
    viewportHeight: martialViewportHeight,
    martialPanelWidth,
    martialPanelHeight,
    martialPresetPanelWidth,
    showMartialPresetPanel,
    isJujingTab: martialPanelTab === 'jujing',
    preview: false,
  });
  const martialResponsiveLayout = computeMartialResponsiveLayout(martialPanelDimensions);
  const filteredMartialAbilities = useMemo(() => {
    if (martialPanelTab !== 'jujing') return [];
    if (martialEmpoweredOnly) return [];
    const query = martialSearch.trim().toLowerCase();
    let list = cheatAbilities;
    if (query) {
      list = list.filter((ability: any) => (
        String(ability.name ?? '').toLowerCase().includes(query) ||
        String(ability.description ?? '').toLowerCase().includes(query)
      ));
    }
    if (martialRarityFilter !== 'all') list = list.filter((ability: any) => ability.rarity === martialRarityFilter);
    if (martialSchoolFilter !== 'all') list = list.filter((ability: any) => ability.tags?.school === martialSchoolFilter);
    const favoriteRank = new Map(martialFavoriteOrder.map((abilityId, index) => [abilityId, index]));
    return list
      .map((ability: any, index: number) => ({ ability, index, favoriteIndex: favoriteRank.get(ability.id) }))
      .sort((left, right) => {
        const leftFavorite = typeof left.favoriteIndex === 'number';
        const rightFavorite = typeof right.favoriteIndex === 'number';
        if (leftFavorite && rightFavorite) return left.favoriteIndex! - right.favoriteIndex!;
        if (leftFavorite) return -1;
        if (rightFavorite) return 1;
        return left.index - right.index;
      })
      .map((entry) => entry.ability);
  }, [cheatAbilities, martialEmpoweredOnly, martialFavoriteOrder, martialPanelTab, martialRarityFilter, martialSchoolFilter, martialSearch]);
  const martialTotalRows = Math.max(1, Math.ceil(filteredMartialAbilities.length / martialResponsiveLayout.abilityColumns));
  const martialMaxRowOffset = Math.max(0, martialTotalRows - martialResponsiveLayout.abilityVisibleRows);
  useEffect(() => {
    setMartialAbilityRowOffset(0);
  }, [martialEmpoweredOnly, martialFavoriteOrder, martialPanelTab, martialRarityFilter, martialSchoolFilter, martialSearch]);
  useEffect(() => {
    setMartialAbilityRowOffset((offset) => Math.min(offset, martialMaxRowOffset));
  }, [martialMaxRowOffset]);
  const visibleMartialAbilities = useMemo(() => {
    const startIndex = martialAbilityRowOffset * martialResponsiveLayout.abilityColumns;
    return filteredMartialAbilities.slice(startIndex, startIndex + martialResponsiveLayout.abilityColumns * martialResponsiveLayout.abilityVisibleRows);
  }, [filteredMartialAbilities, martialAbilityRowOffset, martialResponsiveLayout.abilityColumns, martialResponsiveLayout.abilityVisibleRows]);
  const martialPresetMaxPlanOffset = Math.max(0, martialPresetPlans.length - martialResponsiveLayout.presetVisiblePlans);
  useEffect(() => {
    setMartialPresetPlanOffset((offset) => Math.min(offset, martialPresetMaxPlanOffset));
  }, [martialPresetMaxPlanOffset]);

  const favoriteMartialAbility = useCallback((abilityId: string) => {
    setMartialFavoriteOrder((current) => [abilityId, ...current.filter((id) => id !== abilityId)]);
    setMartialAbilityRowOffset(0);
  }, []);

  const removeMartialFavorite = useCallback((abilityId: string) => {
    setMartialFavoriteOrder((current) => current.filter((id) => id !== abilityId));
    setMartialAbilityRowOffset(0);
  }, []);

  const postAddAbility = useCallback(async (abilityId: string, slotIndex?: number) => {
    const res = await fetch('/api/game/cheat/add-ability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        gameId,
        abilityId,
        ...(typeof slotIndex === 'number' ? { slotIndex } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? '添加技能失败');
    }
    return res.json().catch(() => ({}));
  }, [gameId]);

  const addAbilityToDraftBar = useCallback(async (abilityId: string, slotIndex?: number) => {
    if (addingAbility) return false;
    if (selfYumenSpectating) {
      showYumenSpectatorAbilityLockWarning();
      return false;
    }
    setAddingAbility(abilityId);
    try {
      await postAddAbility(abilityId, slotIndex);
      return true;
    } catch (err: any) {
      console.error('[MartialPanel] add-ability failed:', err);
      toastError(err?.message ?? '添加技能失败');
      return false;
    } finally {
      setAddingAbility(null);
    }
  }, [addingAbility, postAddAbility, selfYumenSpectating, showYumenSpectatorAbilityLockWarning]);

  const getCurrentMartialPresetSlots = useCallback(() => (
    Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }, (_, index) => learnedDraftAbilities[index]?.abilityId ?? null)
  ), [learnedDraftAbilities]);

  const openSaveMartialPresetModal = useCallback(() => {
    const targetIndex = Math.min(martialPresetPlans.length, MARTIAL_PRESET_LIMIT - 1);
    const existingPlan = martialPresetPlans[targetIndex];
    setMartialPresetModal({
      kind: 'save',
      targetIndex,
      name: existingPlan?.name ?? getDefaultMartialPlanName(targetIndex),
    });
  }, [martialPresetPlans]);

  const saveMartialPresetToPlan = useCallback(async () => {
    if (martialPresetModal?.kind !== 'save') return;
    const targetIndex = Math.max(0, Math.min(MARTIAL_PRESET_LIMIT - 1, martialPresetModal.targetIndex));
    const nextPlans = [...martialPresetPlans];
    const existingPlan = nextPlans[targetIndex];
    nextPlans[targetIndex] = {
      id: existingPlan?.id ?? createMartialPresetId(),
      name: sanitizeMartialPlanName(martialPresetModal.name, existingPlan?.name ?? getDefaultMartialPlanName(targetIndex)),
      slots: getCurrentMartialPresetSlots(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await persistMartialPresetPlans(nextPlans);
    if (saved) {
      setMartialPresetModal(null);
      toastSuccess('预设已保存');
    }
  }, [getCurrentMartialPresetSlots, martialPresetModal, martialPresetPlans, persistMartialPresetPlans]);

  const applyMartialPreset = useCallback(async (plan: MartialPresetPlan) => {
    if (martialPresetApplying || runningCheatAction) return;
    if (selfYumenSpectating) {
      showYumenSpectatorAbilityLockWarning();
      return;
    }
    const slots = normalizeMartialPresetSlots(plan.slots);
    setMartialPresetApplying(true);
    try {
      const clearRes = await fetch('/api/game/cheat/discard-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gameId }),
      });
      if (!clearRes.ok) {
        const err = await clearRes.json().catch(() => ({}));
        throw new Error(err.error ?? '预设招式失败');
      }
      for (let index = 0; index < DRAFT_ABILITY_SLOT_COUNT; index += 1) {
        const abilityId = slots[index];
        if (!abilityId) continue;
        await postAddAbility(abilityId, index);
      }
      toastSuccess('预设招式已启用');
    } catch (err: any) {
      toastError(err?.message ?? '预设招式失败');
    } finally {
      setMartialPresetApplying(false);
    }
  }, [gameId, martialPresetApplying, postAddAbility, runningCheatAction, selfYumenSpectating, showYumenSpectatorAbilityLockWarning]);

  const createEmptyMartialPresetPlan = useCallback(async () => {
    if (martialPresetPlans.length >= MARTIAL_PRESET_LIMIT) {
      toastError('预设招式最多8个');
      return;
    }
    const nextIndex = martialPresetPlans.length;
    const nextPlans = [
      ...martialPresetPlans,
      {
        id: createMartialPresetId(),
        name: getDefaultMartialPlanName(nextIndex),
        slots: normalizeMartialPresetSlots([]),
        updatedAt: new Date().toISOString(),
      },
    ];
    const saved = await persistMartialPresetPlans(nextPlans);
    if (saved) toastSuccess('预设已创建');
  }, [martialPresetPlans, persistMartialPresetPlans]);

  const deleteMartialPresetPlan = useCallback(async (planId: string) => {
    await persistMartialPresetPlans(martialPresetPlans.filter((plan) => plan.id !== planId));
  }, [martialPresetPlans, persistMartialPresetPlans]);

  const moveMartialPresetPlanToTop = useCallback(async (planId: string) => {
    const planIndex = martialPresetPlans.findIndex((plan) => plan.id === planId);
    if (planIndex <= 0) {
      setMartialPresetPlanOffset(0);
      return;
    }
    const targetPlan = martialPresetPlans[planIndex];
    const nextPlans = [targetPlan, ...martialPresetPlans.filter((plan) => plan.id !== planId)];
    const saved = await persistMartialPresetPlans(nextPlans);
    if (saved) setMartialPresetPlanOffset(0);
  }, [martialPresetPlans, persistMartialPresetPlans]);

  const openRenameMartialPresetModal = useCallback((plan: MartialPresetPlan) => {
    setMartialPresetModal({ kind: 'rename', planId: plan.id, name: plan.name });
  }, []);

  const renameMartialPresetPlan = useCallback(async () => {
    if (martialPresetModal?.kind !== 'rename') return;
    const planIndex = martialPresetPlans.findIndex((plan) => plan.id === martialPresetModal.planId);
    if (planIndex < 0) return;
    const nextPlans = martialPresetPlans.map((plan, index) => plan.id === martialPresetModal.planId
      ? {
          ...plan,
          name: sanitizeMartialPlanName(martialPresetModal.name, plan.name || getDefaultMartialPlanName(index)),
          updatedAt: new Date().toISOString(),
        }
      : plan);
    const saved = await persistMartialPresetPlans(nextPlans);
    if (saved) {
      setMartialPresetModal(null);
      toastSuccess('预设已重命名');
    }
  }, [martialPresetModal, martialPresetPlans, persistMartialPresetPlans]);

  const updateMartialPresetSlot = useCallback(async (planId: string, slotIndex: number, abilityId: string | null) => {
    const nextPlans = martialPresetPlans.map((plan) => {
      if (plan.id !== planId) return plan;
      const nextSlots = normalizeMartialPresetSlots(plan.slots);
      const targetIndex = normalizeDraftSlotIndex(slotIndex, slotIndex);
      if (!abilityId) {
        nextSlots[targetIndex] = null;
        return { ...plan, slots: nextSlots, updatedAt: new Date().toISOString() };
      }
      const existingIndex = nextSlots.findIndex((slotAbilityId, index) => index !== targetIndex && slotAbilityId === abilityId);
      if (existingIndex >= 0) {
        const targetAbilityId = nextSlots[targetIndex];
        nextSlots[targetIndex] = abilityId;
        nextSlots[existingIndex] = targetAbilityId ?? null;
      } else {
        nextSlots[targetIndex] = abilityId;
      }
      return { ...plan, slots: nextSlots, updatedAt: new Date().toISOString() };
    });
    await persistMartialPresetPlans(nextPlans);
  }, [martialPresetPlans, persistMartialPresetPlans]);

  const getMartialAbilityDefinition = useCallback((abilityId: string | null | undefined) => {
    if (!abilityId) return null;
    return (abilities as any)[abilityId] ?? cheatAbilities.find((ability: any) => ability.id === abilityId) ?? null;
  }, [abilities, cheatAbilities]);

  const toMartialAbilityInfo = useCallback((ability: any): AbilityInfo => ({
    id: ability.id,
    abilityId: ability.id,
    name: ability.name,
    iconPath: ability.iconPath,
    description: ability.description ?? '',
    channel: getRuntimeAbilityChannel(ability) ?? undefined,
    range: getEffectiveAbilityRangeClient(ability, me?.buffs),
    baseRange: typeof ability.range === 'number' ? ability.range : undefined,
    minRange: ability.minRange,
    baseCooldownTicks: typeof ability.cooldownTicks === 'number' ? ability.cooldownTicks : undefined,
    cooldown: 0,
    maxCooldown: Math.max(0, Number(ability.cooldownTicks ?? 0)),
    maxCharges: typeof ability.maxCharges === 'number' ? ability.maxCharges : undefined,
    chargeRecoveryTicks: typeof ability.chargeRecoveryTicks === 'number' ? ability.chargeRecoveryTicks : undefined,
    tooltipChargeRecoveryTicks: typeof ability.chargeRecoveryTicks === 'number'
      ? ability.chargeRecoveryTicks
      : undefined,
    isReady: true,
    isCommon: !!ability.isCommon,
    target: (ability.target as 'SELF' | 'OPPONENT') ?? 'OPPONENT',
    friendlyTarget: !!ability.friendlyTarget,
    canTargetSelf: !!ability.canTargetSelf,
    faceDirection: requiresFacingByDefault(ability),
    minSelfHpExclusive: typeof ability.minSelfHpExclusive === 'number' ? ability.minSelfHpExclusive : undefined,
    minSelfHpPercentExclusive: typeof ability.minSelfHpPercentExclusive === 'number' ? ability.minSelfHpPercentExclusive : undefined,
    damageType: getAbilityDamageTypeClient(ability),
    noWeaponRequired: !!ability.noWeaponRequired,
    canCastWhileMounted: !!ability.canCastWhileMounted,
    requiresGrounded: !!ability.requiresGrounded,
    requiresStanding: !!ability.requiresStanding,
    qinggong: !!ability.qinggong,
    qinggongGcdImmune: !!ability.qinggongGcdImmune,
    cannotCastWhileRooted: !!ability.cannotCastWhileRooted,
    allowGroundCastWithoutTarget: !!ability.allowGroundCastWithoutTarget,
  }), [me?.buffs]);

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
        onClick={() => void addAbilityToDraftBar(ability.id)}
      />
    );
  };

  const runCheatAction = useCallback(
    async (actionId: string, url: string, successText: string, body?: Record<string, any>, options?: { suppressError?: (status: number, payload: any) => boolean }) => {
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
          if (!options?.suppressError?.(res.status, err)) {
            toastError(err.error ?? '操作失败');
          }
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

  const runChatCommand = useCallback(async (rawText: string) => {
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_INPUT_LENGTH);
    if (!text.startsWith('/')) return false;
    const command = text.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (command === 'upz') {
      return runCheatAction('chat-command-upz', '/api/game/cheat/yumen/drop-to-top-hit', '已执行 Z救援');
    }
    toastError(`未知命令：${text}`);
    return false;
  }, [runCheatAction]);

  const submitChatMessage = useCallback(async () => {
    const text = chatInputValue.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_INPUT_LENGTH);
    setChatInputValue('');
    if (!text) return;
    if (text.startsWith('/')) {
      await runChatCommand(text);
      return;
    }
    setActiveChatWindowId('map');
    await sendChatText(text, 'map', true);
  }, [chatInputValue, runChatCommand, sendChatText]);

  useEffect(() => {
    if (!isYumenMode || !yumenAutoFullShrink || selfHasYumenPrep || safeZone?.phase !== 'idle' || runningCheatAction === 'yumen-auto-full-shrink') return;
    const autoStartKey = `${gameId}:${safeZone?.phaseStartedAt ?? 0}`;
    if (yumenAutoFullShrinkStartedRef.current === autoStartKey) return;
    void (async () => {
      const ok = await runCheatAction(
        'yumen-auto-full-shrink',
        '/api/game/cheat/yumen/start-full-shrink',
        '完整缩圈已自动开始',
        undefined,
        { suppressError: (status, payload) => status === 409 && (payload?.prepActive === true || payload?.alreadyStarted === true) },
      );
      if (ok) yumenAutoFullShrinkStartedRef.current = autoStartKey;
    })();
  }, [gameId, isYumenMode, runCheatAction, runningCheatAction, safeZone?.phase, safeZone?.phaseStartedAt, selfHasYumenPrep, yumenAutoFullShrink]);

  const updateYumenPlayArea = useCallback(async (
    nextPlayArea: PlayAreaBounds,
    options?: { actionId?: string; successText?: string },
  ) => {
    setLocalPlayAreaOverride(nextPlayArea);
    playAreaRef.current = nextPlayArea;
    const ok = await runCheatAction(
      options?.actionId ?? 'yumen-play-area',
      '/api/game/cheat/yumen/play-area',
      options?.successText ?? '边界已更新',
      { playArea: nextPlayArea },
    );
    if (!ok) {
      setLocalPlayAreaOverride(null);
      playAreaRef.current = playArea;
    }
  }, [playArea, runCheatAction]);

  const restoreYumenPlayAreaDefault = useCallback(() => {
    void updateYumenPlayArea(
      { minX: 0, minY: 0, maxX: mapData.width, maxY: mapData.height },
      { actionId: 'yumen-play-area-default', successText: '边界已恢复默认' },
    );
  }, [mapData.height, mapData.width, updateYumenPlayArea]);

  const reorderDraftAbility = useCallback(
    async (instanceId: string, toIndex: number) => {
      if (selfYumenSpectating) {
        showYumenSpectatorAbilityLockWarning();
        return false;
      }
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
    [gameId, selfYumenSpectating, showYumenSpectatorAbilityLockWarning],
  );

  const discardDraftAbility = useCallback(
    async (instanceId: string) => {
      if (selfYumenSpectating) {
        showYumenSpectatorAbilityLockWarning();
        return false;
      }
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
      return true;
    },
    [gameId, selfYumenSpectating, showYumenSpectatorAbilityLockWarning],
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
    const sourceIsDraft = dragState.sourceKind === 'draft' || dragState.sourceKind === 'martial-draft';
    const targetIsDraft = target.kind === 'draft' || target.kind === 'martial-draft';
    const latestAbility = (ability: AbilityInfo) => abilitiesRef.current.find((candidate) => candidate.id === ability.id) ?? ability;
    const draggedAbility = latestAbility(dragState.ability);
    const nextItemSlots = itemBarAbilitiesRef.current.map((ability) => ability ? latestAbility(ability) : undefined);
    const nextOverrides = { ...draftSlotOverridesRef.current };
    const visibleDraftSlots = getVisibleDraftSlotsForLocalMove();

    const placeInItemSlot = (index: number, ability: AbilityInfo | undefined) => {
      nextItemSlots[index] = ability ? latestAbility(ability) : undefined;
      if (ability) delete nextOverrides[ability.id];
    };

    if (sourceIsDraft && target.kind === 'item') {
      const targetItemAbility = nextItemSlots[target.index];
      placeInItemSlot(target.index, draggedAbility);
      delete nextOverrides[draggedAbility.id];
      if (targetItemAbility) {
        nextOverrides[targetItemAbility.id] = normalizeDraftSlotIndex(dragState.sourceIndex, dragState.sourceIndex);
      }
    } else if (dragState.sourceKind === 'item' && targetIsDraft) {
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
    setMartialDragHoverIndex(null);
    setDiscardZoneHover(false);
  };

  const handleDraftDragEnd = () => {
    abilityDragActiveRef.current = false;
    setDraggingDraftInstanceId(null);
    setDragHoverIndex(null);
    setMartialDragHoverIndex(null);
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
    setMartialDragHoverIndex(null);
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
    setMartialDragHoverIndex(null);
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

  const beginLibraryAbilityPointerDrag = useCallback((e: React.MouseEvent, ability: any) => {
    if (e.button !== 0 || !ability?.id) return;
    e.preventDefault();
    e.stopPropagation();
    const visibleDraftSlots = getVisibleDraftSlotsForLocalMove();
    const existingIndex = visibleDraftSlots.findIndex((slot) => slot?.abilityId === ability.id);
    const existingAbility = existingIndex >= 0 ? visibleDraftSlots[existingIndex] : undefined;
    abilityDragActiveRef.current = true;
    mouseStateRef.current.isLeft = false;
    mouseStateRef.current.isRight = false;
    manualCameraLookActiveRef.current = false;
    pendingDraftDragRef.current = {
      instanceId: existingAbility?.id ?? `library:${ability.id}`,
      sourceKind: existingAbility ? 'draft' : 'library',
      sourceIndex: existingAbility ? existingIndex : -1,
      ability: existingAbility ?? toMartialAbilityInfo(ability),
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, [getVisibleDraftSlotsForLocalMove, toMartialAbilityInfo]);

  useEffect(() => {
    const getAbilityDropTargetAtPoint = (clientX: number, clientY: number): AbilityDropTarget | null => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      if (element?.closest('[data-consumable-slot]')) return null;
      const presetSlotElement = element?.closest('[data-martial-preset-slot]') as HTMLElement | null;
      if (presetSlotElement) {
        const planId = presetSlotElement.dataset.martialPresetPlanId;
        const rawIndex = presetSlotElement.dataset.martialPresetSlot;
        const index = Number(rawIndex);
        if (planId && Number.isInteger(index)) return { kind: 'preset', planId, index };
      }
      const itemSlotElement = element?.closest('[data-item-slot-index]') as HTMLElement | null;
      if (itemSlotElement) {
        const rawIndex = itemSlotElement.dataset.itemSlotIndex;
        if (rawIndex !== undefined) {
          const index = Number(rawIndex);
          if (Number.isInteger(index)) return { kind: 'item', index };
        }
      }
      const martialSlotElement = element?.closest('[data-martial-draft-slot-index]') as HTMLElement | null;
      if (martialSlotElement) {
        const rawIndex = martialSlotElement.dataset.martialDraftSlotIndex;
        if (rawIndex !== undefined) {
          const index = Number(rawIndex);
          if (Number.isInteger(index)) return { kind: 'martial-draft', index };
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

    const isMartialAbilityLibraryAtPoint = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      return !!element?.closest('[data-martial-ability-library]');
    };

    const clearPointerDrag = () => {
      pendingDraftDragRef.current = null;
      abilityDragActiveRef.current = false;
      setDraftDragGhost(null);
      setDraggingDraftInstanceId(null);
      setDragHoverIndex(null);
      setMartialDragHoverIndex(null);
      setDragHoverItemIndex(null);
      setMartialPresetDropHover(null);
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
      setDraftDragGhost({ ability: dragState.ability, x: event.clientX, y: event.clientY, large: dragState.sourceKind === 'library' });

      if (isDiscardZoneAtPoint(event.clientX, event.clientY)) {
        setDiscardZoneHover(true);
        setDragHoverIndex(null);
        setMartialDragHoverIndex(null);
        setDragHoverItemIndex(null);
        setMartialPresetDropHover(null);
        return;
      }

      setDiscardZoneHover(false);
      const dropTarget = getAbilityDropTargetAtPoint(event.clientX, event.clientY);
      if (dragState.sourceKind === 'library' && dropTarget?.kind !== 'draft' && dropTarget?.kind !== 'martial-draft' && dropTarget?.kind !== 'preset') {
        setDragHoverIndex(null);
        setMartialDragHoverIndex(null);
        setDragHoverItemIndex(null);
        setMartialPresetDropHover(null);
        return;
      }
      setDragHoverIndex(dropTarget?.kind === 'draft' ? dropTarget.index : null);
      setMartialDragHoverIndex(dropTarget?.kind === 'martial-draft' ? dropTarget.index : null);
      setDragHoverItemIndex(dropTarget?.kind === 'item' ? dropTarget.index : null);
      setMartialPresetDropHover(dropTarget?.kind === 'preset' ? { planId: dropTarget.planId, slotIndex: dropTarget.index } : null);
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
      const droppedOnMartialLibrary = isMartialAbilityLibraryAtPoint(event.clientX, event.clientY);
      const dropTarget = getAbilityDropTargetAtPoint(event.clientX, event.clientY);
      void (async () => {
        if (dragState.sourceKind === 'library') {
          if (dropTarget?.kind === 'draft' || dropTarget?.kind === 'martial-draft') {
            await addAbilityToDraftBar(dragState.ability.abilityId ?? dragState.ability.id, dropTarget.index);
          } else if (dropTarget?.kind === 'preset') {
            await updateMartialPresetSlot(dropTarget.planId, dropTarget.index, dragState.ability.abilityId ?? dragState.ability.id);
          }
        } else if (dropTarget?.kind === 'preset') {
          await updateMartialPresetSlot(dropTarget.planId, dropTarget.index, dragState.ability.abilityId ?? dragState.ability.id);
        } else if ((dragState.sourceKind === 'draft' || dragState.sourceKind === 'martial-draft') && droppedOnMartialLibrary) {
          await discardDraftAbility(dragState.instanceId);
        } else if (droppedOnDiscard) {
          const discarded = await discardDraftAbility(dragState.instanceId);
          if (discarded && dragState.sourceKind === 'item') {
            removeAbilityFromItemBar(dragState.instanceId);
          }
        } else if ((dropTarget?.kind === 'draft' || dropTarget?.kind === 'martial-draft' || dropTarget?.kind === 'item') && !(dropTarget.kind === dragState.sourceKind && dropTarget.index === dragState.sourceIndex)) {
          if ((dragState.sourceKind === 'draft' || dragState.sourceKind === 'martial-draft') && (dropTarget.kind === 'draft' || dropTarget.kind === 'martial-draft')) {
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
  }, [addAbilityToDraftBar, closeAbilityHint, discardDraftAbility, moveAbilityBetweenLocalBars, removeAbilityFromItemBar, reorderDraftAbility, updateMartialPresetSlot]);

  // Mouse move handler for debug cursor tracking
  const handleDebugMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!showDebugGrid) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDebugCursor({
      x: ((e.clientX - rect.left) / rect.width)  * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    });
  };

  const playerStatusBuffs = activeSelfBuffsClient(me?.buffs, locallyConsumedJumpBoostAt);
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
    ? playerStatusBuffs
    : targetStatusIsEntity
    ? activeBuffsClient(selectedEntityForStatus?.buffs as any)
    : activeBuffsClient(selectedTargetForStatus?.buffs);
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
  const targetTargetShield = targetTargetEntityForHud
    ? getLinkedShieldDisplayClient(targetTargetEntityForHud as any)
    : getLinkedShieldDisplayClient(targetTargetPlayerForHud as any);
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
  const yumenKillNoticeDefaultPos = getDefaultYumenKillNoticePos();
  const yumenKillNoticePos = uiPositions[YUMEN_KILL_NOTICE_UI_KEY] ?? yumenKillNoticeDefaultPos;
  const yumenKillNoticeText = activeYumenDefeatNotice
    ? `${activeYumenDefeatNotice.attackerName ?? '大漠狂沙'} 重伤 ${activeYumenDefeatNotice.defeatedName}`
    : customUiMode
    ? '剑心猫猫糕 重伤 测试账号二'
    : null;
  const yumenKillNoticeParts = activeYumenDefeatNotice
    ? {
        attackerName: activeYumenDefeatNotice.attackerName ?? '大漠狂沙',
        defeatedName: activeYumenDefeatNotice.defeatedName,
      }
    : customUiMode
    ? { attackerName: '剑心猫猫糕', defeatedName: '测试账号二' }
    : null;
  const showFloatingYumenKillNotice = !!yumenKillNoticeText;
  const yumenKillConfirmDefaultPos = getDefaultYumenKillConfirmPos();
  const yumenKillConfirmPos = uiPositions[YUMEN_KILL_CONFIRM_UI_KEY] ?? yumenKillConfirmDefaultPos;
  const yumenKillConfirmText = activeYumenKillConfirm
    ? `击杀 ${activeYumenKillConfirm.defeatedName}`
    : customUiMode
    ? '击杀 测试账号二'
    : null;
  const showFloatingYumenKillConfirm = !!yumenKillConfirmText;
  const yumenAliveCountDefaultPos = getDefaultYumenAliveCountPos();
  const yumenAliveCountPos = uiPositions[YUMEN_ALIVE_COUNT_UI_KEY] ?? yumenAliveCountDefaultPos;
  const showFloatingYumenAliveCount = customUiMode || isYumenMode;
  const yumenAliveCountScale = normalizeYumenHudSettingScale(
    ((yumenAliveCountSize.width / YUMEN_ALIVE_COUNT_BASE_WIDTH) + (yumenAliveCountSize.height / YUMEN_ALIVE_COUNT_BASE_HEIGHT)) / 2,
  );
  const itemBarDefaultPos = getDefaultItemBarPos();
  const itemBarPos = uiPositions[ITEM_BAR_UI_KEY] ?? itemBarDefaultPos;
  const chatPanelSavedPos = uiPositions[CHAT_PANEL_UI_KEY];
  const chatPanelDefaultPos = getDefaultChatPanelPos();
  const chatPanelPos = chatPanelSavedPos ?? chatPanelDefaultPos;
  const useCustomChatPanelPlacement = customUiMode || !!chatPanelSavedPos;
  const chatClearDialogDefaultPos = getDefaultChatClearDialogPos();
  const chatClearDialogPos = uiPositions[CHAT_CLEAR_DIALOG_UI_KEY] ?? chatClearDialogDefaultPos;
  const beginChatPanelCustomDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!customUiMode) return;
    if ((event.target as HTMLElement | null)?.closest('button, input, textarea, select, [data-chat-resize-handle="true"]')) return;
    startUIDrag(CHAT_PANEL_UI_KEY, chatPanelDefaultPos, event, { persist: false });
  }, [chatPanelDefaultPos, customUiMode, startUIDrag]);
  const beginChatClearDialogCustomDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!customUiMode) return;
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    startUIDrag(CHAT_CLEAR_DIALOG_UI_KEY, chatClearDialogDefaultPos, event, { persist: false });
  }, [chatClearDialogDefaultPos, customUiMode, startUIDrag]);
  const martialPanelDefaultPos = getDefaultMartialPanelPos();
  const martialPanelPos = uiPositions[MARTIAL_PANEL_UI_KEY] ?? martialPanelDefaultPos;
  const martialPanelDisplayPos = martialPanelTempPos ?? martialPanelPos;
  const showFloatingMartialPanel = customUiMode || showMartialPanel;
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
          onCopyBuffName={appendAbilityNameToChatInput}
          allowAnyCancel={allowAnyCancel}
          playerScale={debugLabel === 'me'}
          categoryFilter={categoryFilter}
          visibilityMode={showHiddenBuffStatusBar ? 'hidden-only' : 'visible'}
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
            onCopyBuffName={appendAbilityNameToChatInput}
            visibilityMode={showHiddenBuffStatusBar ? 'hidden-only' : 'visible'}
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

  const renderMartialPanel = (preview = false) => {
    const panelLocked = preview || customUiMode;
    const activeSlots = Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }, (_, index) => learnedDraftAbilities[index]);
    const activeAbilityByAbilityId = new Map(
      activeSlots
        .map((ability, index) => ability ? [ability.abilityId, { ability, index }] as const : null)
        .filter(Boolean) as Array<readonly [string, { ability: AbilityInfo; index: number }]>,
    );
    const nextOpenDraftSlotIndex = activeSlots.findIndex((ability) => !ability);
    const getNextOpenDraftSlot = () => nextOpenDraftSlotIndex >= 0 ? nextOpenDraftSlotIndex : undefined;
    const renderVerticalLabel = (label: string) => (
      <div className={styles.martialActiveVerticalLabel} aria-label={label}>
        {Array.from(label).map((character, index) => <span key={`${label}-${index}`}>{character}</span>)}
      </div>
    );
    const selectedRarity = martialRarityOptions.find((option) => option.id === martialRarityFilter) ?? martialRarityOptions[0];
    const selectedSchool = martialSchoolOptions.find((option) => option.id === martialSchoolFilter) ?? martialSchoolOptions[0];
    const isJujingTab = martialPanelTab === 'jujing';
    const dimensions = preview
      ? computeMartialPanelDimensions({
          viewportWidth: martialViewportWidth,
          viewportHeight: martialViewportHeight,
          martialPanelWidth,
          martialPanelHeight,
          martialPresetPanelWidth,
          showMartialPresetPanel,
          isJujingTab,
          preview,
        })
      : martialPanelDimensions;
    const responsiveLayout = preview ? computeMartialResponsiveLayout(dimensions) : martialResponsiveLayout;
    const { panelWidth, panelHeight, presetPanelWidth, bundleWidth, panelResponsiveScale } = dimensions;
    const scrollbarThumbHeight = Math.max(24, Math.min(100, (responsiveLayout.abilityVisibleRows / martialTotalRows) * 100));
    const scrollbarTravel = Math.max(0, 100 - scrollbarThumbHeight);
    const scrollbarThumbTop = martialMaxRowOffset > 0 ? (martialAbilityRowOffset / martialMaxRowOffset) * scrollbarTravel : 0;

    const renderFilterMenu = ({
      label,
      selected,
      options,
      open,
      setOpen,
      onSelect,
      ref,
      singleColumn = false,
    }: {
      label: string;
      selected: { id: string; label: string; optionLabel?: string; color?: string };
      options: Array<{ id: string; label: string; optionLabel?: string; color?: string }>;
      open: boolean;
      setOpen: (value: boolean) => void;
      onSelect: (id: string) => void;
      ref: React.RefObject<HTMLDivElement | null>;
      singleColumn?: boolean;
    }) => (
      <div ref={ref} className={`${styles.martialFilterMenu} ${singleColumn ? styles.martialRarityFilterMenu : ''}`}>
        <button
          type="button"
          className={styles.martialFilterButton}
          style={{ '--martial-filter-color': selected.color ?? '#8aa3a1' } as React.CSSProperties}
          aria-label={label}
          aria-expanded={open}
          disabled={panelLocked}
          onClick={() => setOpen(!open)}
        >
          <span>{selected.label}</span>
          <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
        {open && !panelLocked && (
          <div className={`${styles.martialFilterList} ${singleColumn ? styles.martialFilterListSingle : ''}`}>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`${styles.martialFilterOption} ${selected.id === option.id ? styles.martialFilterOptionActive : ''}`}
                style={{ '--martial-filter-color': option.color ?? '#8aa3a1' } as React.CSSProperties}
                onClick={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
              >
                {option.optionLabel ?? option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );

    const renderAbilityTile = (ability: any, keyPrefix: string, options: { disabled?: boolean; presetPlanId?: string; presetSlotIndex?: number; activeIndex?: number } = {}) => {
      const abilityInfo = toMartialAbilityInfo(ability);
      const rarityBorderColor = ability.rarity ? RARITY_COLOR[ability.rarity] : '#53606a';
      const isBusy = addingAbility === ability.id;
      const isPresetTile = !!options.presetPlanId;
      const activeEntry = activeAbilityByAbilityId.get(ability.id);
      const isCheckedLibraryTile = !martialFavoriteMode && !isPresetTile && !!activeEntry;
      const isFavoritedAbility = martialFavoriteOrder.includes(ability.id);
      const favoriteModeTile = martialFavoriteMode && !isPresetTile;
      return (
        <button
          key={`${keyPrefix}-${ability.id}`}
          type="button"
          className={`${styles.martialAbilityItem} ${isCheckedLibraryTile ? styles.martialAbilityItemChecked : ''} ${favoriteModeTile ? styles.martialAbilityItemFavoriteMode : ''} ${favoriteModeTile && isFavoritedAbility ? styles.martialAbilityItemFavorited : ''}`}
          aria-label={ability.name}
          disabled={panelLocked || isBusy || options.disabled}
          onMouseDown={(event) => {
            if (event.ctrlKey && event.button === 0) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (isPresetTile) return;
            if (martialFavoriteMode) {
              event.preventDefault();
              return;
            }
            beginLibraryAbilityPointerDrag(event, ability);
          }}
          onClick={(event) => {
            if (event.ctrlKey) {
              event.preventDefault();
              event.stopPropagation();
              appendAbilityNameToChatInput(ability.name);
              return;
            }
            if (!favoriteModeTile || !isFavoritedAbility) return;
            event.preventDefault();
            favoriteMartialAbility(ability.id);
          }}
          onMouseEnter={(event) => openAbilityHint(event.currentTarget.getBoundingClientRect(), abilityInfo)}
          onMouseLeave={closeAbilityHint}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (panelLocked || isBusy) return;
            if (favoriteModeTile) {
              favoriteMartialAbility(ability.id);
              return;
            }
            if (options.presetPlanId && typeof options.presetSlotIndex === 'number') {
              void updateMartialPresetSlot(options.presetPlanId, options.presetSlotIndex, null);
              return;
            }
            if (activeEntry) {
              void discardDraftAbility(activeEntry.ability.id);
              return;
            }
            void addAbilityToDraftBar(ability.id, getNextOpenDraftSlot());
          }}
        >
          <span className={styles.martialAbilityIconFrame} style={{ borderColor: rarityBorderColor }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={getArenaAbilityIconPath(ability.name, ability.iconPath)} alt={ability.name} draggable={false} />
            {martialFavoriteMode && isFavoritedAbility && !isPresetTile && (
              <span
                className={styles.martialAbilityFavoriteRemoveBadge}
                aria-label="取消收藏"
                role="button"
                aria-disabled={panelLocked}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (panelLocked) return;
                  removeMartialFavorite(ability.id);
                }}
              >
                <Minus size={8} strokeWidth={3.1} />
              </span>
            )}
            {isCheckedLibraryTile && !martialFavoriteMode && (
              <span className={styles.martialAbilityCheckBadge} aria-hidden="true">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
          </span>
          <span className={styles.martialAbilityName}>{ability.name}</span>
        </button>
      );
    };

    const renderDisplayAbilityTile = (ability: any, keyPrefix: string) => {
      const abilityInfo = toMartialAbilityInfo(ability);
      const rarityBorderColor = ability.rarity ? RARITY_COLOR[ability.rarity] : '#53606a';
      return (
        <div
          key={`${keyPrefix}-${ability.id}`}
          className={`${styles.martialAbilityItem} ${styles.martialDisplayAbilityItem}`}
          onMouseEnter={(event) => openAbilityHint(event.currentTarget.getBoundingClientRect(), abilityInfo)}
          onMouseLeave={closeAbilityHint}
        >
          <span className={styles.martialAbilityIconFrame} style={{ borderColor: rarityBorderColor }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={getArenaAbilityIconPath(ability.name, ability.iconPath)} alt={ability.name} draggable={false} />
          </span>
          <span className={styles.martialAbilityName}>{ability.name}</span>
        </div>
      );
    };

    const renderJianghuPage = () => {
      const bodyAbility = getMartialAbilityDefinition('menghu_xiasha');
      const mountAbility = getMartialAbilityDefinition('yuqi');
      const qinggongAbilities = COMMON_ABILITY_ORDER
        .filter((abilityId) => abilityId !== 'menghu_xiasha' && abilityId !== 'yuqi')
        .map((abilityId) => getMartialAbilityDefinition(abilityId))
        .filter(Boolean);
      const rows = [
        { label: '防身武艺', abilities: bodyAbility ? [bodyAbility] : [] },
        { label: '基础招式', abilities: mountAbility ? [mountAbility] : [] },
        { label: '江湖轻功', abilities: qinggongAbilities },
      ];
      return (
        <div className={styles.martialJianghuPage}>
          {rows.map((row) => (
            <div key={row.label} className={styles.martialJianghuRow}>
              <div className={styles.martialJianghuRowLabel}>{row.label}</div>
              <div className={styles.martialJianghuRowBody}>
                {row.abilities.map((ability: any) => renderDisplayAbilityTile(ability, `jianghu-${row.label}`))}
              </div>
            </div>
          ))}
          <div className={`${styles.martialJianghuRow} ${styles.martialJianghuQixueRow}`}>
            <div className={styles.martialJianghuRowLabel}>奇穴</div>
            <div className={styles.martialJianghuEmptyBody} />
          </div>
        </div>
      );
    };

    const renderPlanSlot = (plan: MartialPresetPlan, abilityId: string | null, index: number) => {
      const ability = getMartialAbilityDefinition(abilityId);
      const isHover = martialPresetDropHover?.planId === plan.id && martialPresetDropHover.slotIndex === index;
      return (
        <div
          key={`${plan.id}-${index}`}
          data-martial-preset-plan-id={plan.id}
          data-martial-preset-slot={index}
          className={`${styles.martialPresetSlot} ${isHover ? styles.martialPresetSlotHover : ''}`}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!ability || panelLocked) return;
            void updateMartialPresetSlot(plan.id, index, null);
          }}
        >
          {ability ? renderAbilityTile(ability, `plan-${plan.id}-${index}`, { presetPlanId: plan.id, presetSlotIndex: index }) : <div className={styles.martialPresetEmptySlot} />}
        </div>
      );
    };

    const renderPresetPanel = () => presetPanelWidth > 0 && (
      (() => {
        const visiblePlans = martialPresetPlans.slice(martialPresetPlanOffset, martialPresetPlanOffset + responsiveLayout.presetVisiblePlans);
        const presetScrollbarThumbHeight = Math.max(24, Math.min(100, (responsiveLayout.presetVisiblePlans / Math.max(1, martialPresetPlans.length)) * 100));
        const presetScrollbarTravel = Math.max(0, 100 - presetScrollbarThumbHeight);
        const presetScrollbarThumbTop = martialPresetMaxPlanOffset > 0 ? (martialPresetPlanOffset / martialPresetMaxPlanOffset) * presetScrollbarTravel : 0;
        const presetPanelStyle = {
          width: presetPanelWidth,
          height: panelHeight,
          ...getMartialPresetLayoutStyle(responsiveLayout),
        } as React.CSSProperties;
        return (
      <aside className={styles.martialPresetPanel} style={presetPanelStyle} aria-label="预设招式">
        <div className={styles.martialPresetPanelHeader}>
          <div className={styles.martialPresetTitleRow}>
            <div className={styles.martialPresetPanelTitle}>预设招式({martialPresetPlans.length}/{MARTIAL_PRESET_LIMIT})</div>
            <button type="button" className={styles.martialIconButton} disabled={panelLocked || martialPresetSaving || martialPresetPlans.length >= MARTIAL_PRESET_LIMIT} onClick={() => void createEmptyMartialPresetPlan()} aria-label="新建预设">
              <Plus size={17} strokeWidth={2.3} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.martialPresetHeaderActions}>
            <button type="button" className={styles.martialIconButton} disabled={panelLocked} onClick={() => setShowMartialPresetPanel(false)} aria-label="关闭预设招式">
              <X size={18} strokeWidth={2.3} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          className={styles.martialPresetList}
          onWheel={(event) => {
            if (panelLocked || martialPresetMaxPlanOffset <= 0) return;
            event.preventDefault();
            setMartialPresetPlanOffset((offset) => Math.max(0, Math.min(martialPresetMaxPlanOffset, offset + (event.deltaY > 0 ? 1 : -1))));
          }}
        >
          <div className={styles.martialPresetListItems}>
          {visiblePlans.map((plan) => (
            <div key={plan.id} className={styles.martialPresetCard}>
              <div className={styles.martialPresetCardHeader}>
                <div className={styles.martialPresetNameRow}>
                  <span>{plan.name}</span>
                  <div className={styles.martialPresetCardActions}>
                    <button type="button" className={styles.martialIconButton} disabled={panelLocked || martialPresetSaving} onClick={() => openRenameMartialPresetModal(plan)} aria-label="编辑方案名">
                      <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                    <button type="button" className={styles.martialIconButton} disabled={panelLocked || martialPresetSaving} onClick={() => void deleteMartialPresetPlan(plan.id)} aria-label="删除预设">
                      <Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className={styles.martialPresetPrimaryActions}>
                  <button type="button" className={styles.martialPresetTopButton} disabled={panelLocked || martialPresetSaving} onClick={() => void moveMartialPresetPlanToTop(plan.id)} aria-label="置顶预设">
                    <ArrowUp size={14} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.martialPresetEnableButton} disabled={panelLocked || martialPresetApplying} onClick={() => void applyMartialPreset(plan)}>启用</button>
                </div>
              </div>
              <div className={styles.martialPresetSlots}>{normalizeMartialPresetSlots(plan.slots).map((abilityId, index) => renderPlanSlot(plan, abilityId, index))}</div>
            </div>
          ))}
          </div>
          {martialPresetMaxPlanOffset > 0 && (
            <div className={styles.martialPresetScrollbar} aria-hidden="true">
              <div className={styles.martialCustomScrollbarTrack}>
                <div className={styles.martialCustomScrollbarThumb} style={{ height: `${presetScrollbarThumbHeight}%`, top: `${presetScrollbarThumbTop}%` }} />
              </div>
            </div>
          )}
        </div>
      </aside>
        );
      })()
    );

    const panelStyle = {
      width: panelWidth,
      height: panelHeight,
      '--martial-panel-scale': panelResponsiveScale,
      ...getMartialLayoutStyle(responsiveLayout),
    } as React.CSSProperties;

    return (
      <div className={styles.martialPanelBundle} style={{ width: bundleWidth, height: panelHeight }}>
        <div
          className={`${styles.martialPanel} ${preview ? styles.martialPanelPreview : ''}`}
          style={panelStyle}
          aria-label="武学界面"
        >
        <div className={styles.martialPanelHeader} onMouseDown={!panelLocked ? (event) => startMartialPanelTemporaryDrag(event, martialPanelDisplayPos, { width: bundleWidth, height: panelHeight }) : undefined}>
          <div className={styles.martialPanelTitle}>绝境武学</div>
          {!customUiMode && (
            <button
              type="button"
              className={styles.martialPanelCloseButton}
              aria-label="关闭武学界面"
              onClick={() => {
                setShowMartialPanel(false);
                setMartialPanelTempPos(null);
                martialPanelTempPosRef.current = null;
              }}
            >
              <X size={18} strokeWidth={2.3} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className={styles.martialTabs} role="tablist" aria-label="武学分类">
          <button
            type="button"
            className={`${styles.martialTabButton} ${martialPanelTab === 'jianghu' ? styles.martialTabButtonActive : ''}`}
            aria-selected={martialPanelTab === 'jianghu'}
            disabled={panelLocked}
            onClick={() => setMartialPanelTab('jianghu')}
          >江湖</button>
          <button
            type="button"
            className={`${styles.martialTabButton} ${martialPanelTab === 'jujing' ? styles.martialTabButtonActive : ''}`}
            aria-selected={martialPanelTab === 'jujing'}
            disabled={panelLocked}
            onClick={() => setMartialPanelTab('jujing')}
          >绝境</button>
        </div>

        {isJujingTab ? (
          <>
            <div className={styles.martialFilters}>
              <label className={styles.martialSearchBox}>
                <Search size={16} strokeWidth={2.2} aria-hidden="true" />
                <input
                  type="text"
                  value={martialSearch}
                  disabled={panelLocked}
                  placeholder="搜索招式"
                  onChange={(event) => setMartialSearch(event.target.value)}
                />
              </label>
              {renderFilterMenu({
                label: '筛选门派',
                selected: selectedSchool,
                options: martialSchoolOptions,
                open: martialSchoolOpen,
                setOpen: setMartialSchoolOpen,
                onSelect: setMartialSchoolFilter,
                ref: martialSchoolRef,
              })}
              {renderFilterMenu({
                label: '筛选稀有度',
                selected: selectedRarity,
                options: martialRarityOptions,
                open: martialRarityOpen,
                setOpen: setMartialRarityOpen,
                onSelect: setMartialRarityFilter,
                ref: martialRarityRef,
                singleColumn: true,
              })}
              <label className={styles.martialEmpoweredToggle}>
                <input
                  type="checkbox"
                  checked={martialEmpoweredOnly}
                  disabled={panelLocked}
                  onChange={(event) => setMartialEmpoweredOnly(event.target.checked)}
                />
                <span>强化招式</span>
              </label>
              <span className={styles.martialFilterSpacer} />
              <button
                type="button"
                className={`${styles.martialFavoriteModeButton} ${martialFavoriteMode ? styles.martialFavoriteModeButtonActive : ''}`}
                disabled={panelLocked}
                onClick={() => setMartialFavoriteMode((active) => !active)}
              >
                <Star size={14} strokeWidth={2.2} aria-hidden="true" />
                <span>收藏技能</span>
              </button>
            </div>

            <div
              data-martial-ability-library="true"
              className={styles.martialAbilityViewport}
              onWheel={(event) => {
                if (panelLocked || martialMaxRowOffset <= 0) return;
                event.preventDefault();
                setMartialAbilityRowOffset((offset) => Math.max(0, Math.min(martialMaxRowOffset, offset + (event.deltaY > 0 ? 1 : -1))));
              }}
            >
              <div className={styles.martialAbilityGrid}>
                {visibleMartialAbilities.map((ability: any) => renderAbilityTile(ability, 'library'))}
              </div>
              {martialMaxRowOffset > 0 && (
                <div className={styles.martialCustomScrollbar} aria-hidden="true">
                  <div className={styles.martialCustomScrollbarTrack}>
                    <div className={styles.martialCustomScrollbarThumb} style={{ height: `${scrollbarThumbHeight}%`, top: `${scrollbarThumbTop}%` }} />
                  </div>
                </div>
              )}
            </div>

            <div className={styles.martialPanelFooterRow}>
              <div className={`${styles.martialPanelHint} ${martialFavoriteMode ? styles.martialPanelHintFavorite : ''}`}>{martialFavoriteMode ? '右键收藏技能，左键置顶已经收藏招式' : '右键图标激活/取消该招式'}</div>
              <div className={styles.martialPresetActions}>
                <button type="button" className={styles.martialPresetButton} disabled={panelLocked || martialPresetApplying || martialPresetSaving} onClick={openSaveMartialPresetModal}>
                  <Save size={14} strokeWidth={2.2} aria-hidden="true" />
                  <span>存为预设</span>
                </button>
                <button type="button" className={styles.martialPresetButton} disabled={panelLocked} onClick={() => setShowMartialPresetPanel((open) => !open)}>
                  <ListChecks size={14} strokeWidth={2.2} aria-hidden="true" />
                  <span>预设招式</span>
                </button>
              </div>
            </div>

            <div className={styles.martialActivePanel}>
              <section className={`${styles.martialActiveSection} ${styles.martialBuffSection}`} aria-label="已激活增益">
                <div className={styles.martialActiveTab}>{renderVerticalLabel('已激活增益')}</div>
                <div className={`${styles.martialActiveSlots} ${styles.martialBuffSlots}`}>
                  {Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }, (_, index) => (
                    <div key={`martial-future-empty-${index}`} className={styles.martialBuffSlot}>
                      <div className={`${styles.martialActiveEmptySlot} ${styles.martialBuffEmptySlot}`} />
                    </div>
                  ))}
                </div>
              </section>
              <section className={`${styles.martialActiveSection} ${styles.martialLearnedSection}`} aria-label="已学习招式">
                <div className={styles.martialActiveTab}>{renderVerticalLabel('已学习招式')}</div>
                <div className={styles.martialActiveSlots}>
                  {activeSlots.map((ability, index) => {
                    const abilityRarity = ability?.abilityId ? abilities[ability.abilityId]?.rarity : undefined;
                    const rarityBorderColor = abilityRarity ? RARITY_COLOR[abilityRarity] ?? '#53606a' : '#53606a';
                    return (
                      <div
                        key={ability ? `martial-active-${ability.id}` : `martial-empty-${index}`}
                        data-martial-draft-slot-index={index}
                        className={`${styles.martialActiveSlot} ${martialDragHoverIndex === index ? styles.martialActiveSlotHover : ''}`}
                        onDragOver={(event) => {
                          if (panelLocked || !draggingDraftInstanceId) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDiscardZoneHover(false);
                          setMartialDragHoverIndex(index);
                        }}
                        onDragLeave={() => {
                          if (martialDragHoverIndex === index) setMartialDragHoverIndex(null);
                        }}
                        onDrop={(event) => {
                          if (panelLocked) return;
                          void handleDraftSlotDrop(event, index);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!ability || panelLocked) return;
                          void discardDraftAbility(ability.id);
                        }}
                      >
                        {ability ? (
                          <button
                            type="button"
                            className={`${styles.martialActiveAbility} ${draggingDraftInstanceId === ability.id ? styles.abilityBtnDragging : ''}`}
                            disabled={panelLocked}
                            onMouseDown={(event) => beginAbilityPointerDrag(event, ability, 'martial-draft', index)}
                            onMouseEnter={(event) => openAbilityHint(event.currentTarget.getBoundingClientRect(), ability)}
                            onMouseLeave={closeAbilityHint}
                          >
                            <span className={styles.martialAbilityIconFrame} style={{ borderColor: rarityBorderColor }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={getArenaAbilityIconPath(ability.name, ability.iconPath)} alt={ability.name} draggable={false} />
                            </span>
                            <span className={styles.martialAbilityName}>{ability.name}</span>
                          </button>
                        ) : (
                          <div className={styles.martialActiveEmptySlot} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </>
        ) : renderJianghuPage()}
        </div>
        {renderPresetPanel()}
      </div>
    );
  };

  const renderMartialPresetModal = () => {
    if (!martialPresetModal) return null;
    const isSaveModal = martialPresetModal.kind === 'save';
    const saveTargetCount = Math.min(MARTIAL_PRESET_LIMIT, martialPresetPlans.length + 1);
    const setModalName = (name: string) => {
      const limitedName = Array.from(name).slice(0, 8).join('');
      setMartialPresetModal((prev) => prev ? { ...prev, name: limitedName } : prev);
    };
    const confirmAction = isSaveModal ? saveMartialPresetToPlan : renameMartialPresetPlan;
    const modalLayoutScale = Math.max(0.34, Math.min(1, martialModalWidth / 520, martialModalHeight / 270));
    const modalPx = (base: number, min: number) => `${Math.max(min, Math.round(base * modalLayoutScale))}px`;
    const modalStyle = {
      '--martial-modal-width': `${martialModalWidth}px`,
      '--martial-modal-height': `${martialModalHeight}px`,
      '--martial-modal-header-height': modalPx(45, 24),
      '--martial-modal-title-font': modalPx(22, 13),
      '--martial-modal-body-gap': modalPx(16, 6),
      '--martial-modal-body-pad-top': modalPx(22, 7),
      '--martial-modal-body-pad-x': modalPx(38, 10),
      '--martial-modal-body-pad-bottom': modalPx(24, 8),
      '--martial-modal-save-gap': modalPx(14, 6),
      '--martial-modal-prompt-font': modalPx(18, 11),
      '--martial-modal-target-gap': modalPx(6, 3),
      '--martial-modal-target-size': modalPx(34, 18),
      '--martial-modal-target-font': modalPx(20, 11),
      '--martial-modal-input-width': modalPx(360, 170),
      '--martial-modal-input-height': modalPx(42, 24),
      '--martial-modal-input-pad-x': modalPx(10, 6),
      '--martial-modal-input-font': modalPx(20, 12),
      '--martial-modal-action-gap': modalPx(44, 12),
      '--martial-modal-button-width': modalPx(156, 76),
      '--martial-modal-button-height': modalPx(43, 24),
      '--martial-modal-button-font': modalPx(22, 12),
    } as React.CSSProperties;
    return (
      <div className={styles.martialModalBackdrop} data-ui-interactive>
        <div
          className={styles.martialModal}
          role="dialog"
          aria-modal="true"
          aria-label={isSaveModal ? '保存预设招式' : '编辑方案名'}
          style={modalStyle}
        >
          <div className={styles.martialModalHeader}>
            <div className={styles.martialModalTitle}>{isSaveModal ? '保存预设招式' : '编辑方案名'}</div>
          </div>
          <div className={styles.martialModalBody}>
            {isSaveModal ? (
              <div className={styles.martialModalSaveRow}>
                <div className={styles.martialModalPrompt}>将当前学习招式保存为预设：</div>
                <div className={styles.martialModalTargetGrid}>
                  {Array.from({ length: saveTargetCount }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`${styles.martialModalTargetButton} ${martialPresetModal.targetIndex === index ? styles.martialModalTargetButtonActive : ''}`}
                      onClick={() => setMartialPresetModal({
                        kind: 'save',
                        targetIndex: index,
                        name: martialPresetPlans[index]?.name ?? getDefaultMartialPlanName(index),
                      })}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.martialModalPrompt}>请输入方案名，字数不能超过8个字</div>
            )}
            <input
              type="text"
              value={martialPresetModal.name}
              maxLength={16}
              className={styles.martialModalInput}
              onChange={(event) => setModalName(event.target.value)}
              autoFocus
            />
            <div className={styles.martialModalActions}>
              <button type="button" className={styles.martialModalButton} disabled={martialPresetSaving} onClick={() => void confirmAction()}>确定</button>
              <button type="button" className={styles.martialModalButton} disabled={martialPresetSaving} onClick={() => setMartialPresetModal(null)}>取消</button>
            </div>
          </div>
        </div>
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

  const renderYumenKillNotice = () => {
    if (!showFloatingYumenKillNotice || !yumenKillNoticeText) return null;
    return (
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.yumenKillNoticePlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={{
          left: yumenKillNoticePos.left,
          top: yumenKillNoticePos.top,
          width: yumenKillNoticeSize.width,
          height: yumenKillNoticeSize.height,
          pointerEvents: customUiMode ? 'auto' : 'none',
          '--yumen-kill-notice-width': `${yumenKillNoticeSize.width}px`,
          '--yumen-kill-notice-height': `${yumenKillNoticeSize.height}px`,
        } as React.CSSProperties}
        onMouseDown={customUiMode ? (event) => startUIDrag(YUMEN_KILL_NOTICE_UI_KEY, yumenKillNoticeDefaultPos, event, { persist: false }) : undefined}
      >
        {customUiMode ? (
          <div className={styles.customUiPlacementLabel}>击杀提示</div>
        ) : null}
        <div key={activeYumenDefeatNotice?.id ?? 'preview'} className={`${styles.yumenKillNoticeBrush} ${activeYumenDefeatNotice ? styles.yumenKillNoticeActive : styles.yumenKillNoticePreview}`}>
          <span className={`${styles.yumenKillNoticeName} ${styles.yumenKillNoticeNameLeft}`}>{yumenKillNoticeParts?.attackerName}</span>
          <span className={styles.yumenKillNoticeAction}>重伤</span>
          <span className={`${styles.yumenKillNoticeName} ${styles.yumenKillNoticeNameRight}`}>{yumenKillNoticeParts?.defeatedName}</span>
        </div>
      </div>
    );
  };

  const renderYumenKillConfirm = () => {
    if (!showFloatingYumenKillConfirm || !yumenKillConfirmText) return null;
    return (
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.yumenKillConfirmPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={{
          left: yumenKillConfirmPos.left,
          top: yumenKillConfirmPos.top,
          width: yumenKillConfirmSize.width,
          height: yumenKillConfirmSize.height,
          pointerEvents: customUiMode ? 'auto' : 'none',
          '--yumen-kill-confirm-width': `${yumenKillConfirmSize.width}px`,
          '--yumen-kill-confirm-height': `${yumenKillConfirmSize.height}px`,
        } as React.CSSProperties}
        onMouseDown={customUiMode ? (event) => startUIDrag(YUMEN_KILL_CONFIRM_UI_KEY, yumenKillConfirmDefaultPos, event, { persist: false }) : undefined}
      >
        {customUiMode ? (
          <div className={styles.customUiPlacementLabel}>击杀确认</div>
        ) : null}
        <div key={activeYumenKillConfirm?.id ?? 'preview'} className={`${styles.yumenKillConfirm} ${activeYumenKillConfirm ? styles.yumenKillConfirmActive : styles.yumenKillConfirmPreview}`} aria-live="polite">
          {yumenKillConfirmText}
        </div>
      </div>
    );
  };

  const renderYumenAliveCount = () => {
    if (!showFloatingYumenAliveCount) return null;
    const displayCount = customUiMode && !isYumenMode ? 2 : yumenAlivePlayerCount;
    return (
      <div
        data-ui-drag={customUiMode ? 'true' : undefined}
        className={`${styles.yumenAliveCountPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
        style={{
          left: yumenAliveCountPos.left,
          top: yumenAliveCountPos.top,
          width: yumenAliveCountSize.width,
          height: yumenAliveCountSize.height,
          pointerEvents: customUiMode ? 'auto' : 'none',
          '--yumen-alive-count-width': `${yumenAliveCountSize.width}px`,
          '--yumen-alive-count-height': `${yumenAliveCountSize.height}px`,
          '--yumen-alive-count-scale': yumenAliveCountScale,
        } as React.CSSProperties}
        onMouseDown={customUiMode ? (event) => startUIDrag(YUMEN_ALIVE_COUNT_UI_KEY, yumenAliveCountDefaultPos, event, { persist: false }) : undefined}
      >
        {customUiMode ? (
          <div className={styles.customUiPlacementLabel}>剩余人数</div>
        ) : null}
        <div className={styles.yumenAliveCountPanel}>
          <span className={styles.yumenAliveCountLabel}>剩余人数</span>
          <span className={styles.yumenAliveCountValue}>{displayCount}</span>
        </div>
      </div>
    );
  };

  const renderYumenResultOverlay = () => {
    if (!isYumenMode || !yumenResults) return null;
    const rows = Array.isArray(yumenResults.rows) ? yumenResults.rows : [];
    const selfRow = rows.find((row) => row.userId === me.userId) ?? rows[0];
    const selfRank = selfRow?.rank ?? 1;
    const rankTotal = Math.max(1, rows.length || 1);
    const countdown = Math.max(0, Math.ceil((Number(yumenResults.autoLeaveAt ?? 0) - systemTime.getTime()) / 1000));
    const rankClass = selfRank === 1
      ? styles.yumenResultRankGold
      : selfRank === 2
      ? styles.yumenResultRankSilver
      : selfRank === 3
      ? styles.yumenResultRankBronze
      : styles.yumenResultRankGray;
    return (
      <div className={styles.yumenResultOverlay} role="dialog" aria-modal="true">
        <div className={styles.yumenResultWindow}>
          <div className={styles.yumenResultTop}>
            <div className={`${styles.yumenResultBanner} ${rankClass}`}><span>第{selfRank}名</span></div>
            <div className={styles.yumenResultTeamRank}>队伍排名：{selfRank}/{rankTotal}</div>
          </div>
          <div className={styles.yumenResultSubtitle}>{selfRank === 1 ? '绝处睥睨，傲视群星' : '棋差一招，下次努力'}</div>
          <div className={styles.yumenResultTable}>
            <div className={`${styles.yumenResultRow} ${styles.yumenResultHeader}`}>
              <span>玩家名字</span>
              <span>击杀</span>
              <span>伤害量</span>
              <span>评分结算</span>
              <span>奖励</span>
            </div>
            <div className={styles.yumenResultList}>
              {rows.map((row) => {
                const rowRankClass = row.rank === 1
                  ? styles.yumenResultMedalGold
                  : row.rank === 2
                  ? styles.yumenResultMedalSilver
                  : row.rank === 3
                  ? styles.yumenResultMedalBronze
                  : styles.yumenResultMedalGray;
                return (
                  <div key={row.userId} className={`${styles.yumenResultRow} ${row.userId === me.userId ? styles.yumenResultSelfRow : ''}`}>
                    <span className={styles.yumenResultNameCell}>
                      <span className={`${styles.yumenResultMedal} ${rowRankClass}`}>{row.rank}</span>
                      <span className={styles.yumenResultName}>{row.username}</span>
                    </span>
                    <span>{formatGameAmount(row.kills)}</span>
                    <span>{formatGameAmount(row.damage)}</span>
                    <span>{formatGameAmount(row.score)}</span>
                    <span className={styles.yumenResultReward}><Star size={16} strokeWidth={2.2} aria-hidden="true" />{formatGameAmount(row.reward)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={styles.yumenResultFooter}>
            <span className={styles.yumenResultCountdown}>将在<span className={styles.yumenResultCountdownNumber}>{countdown}</span>秒后离开战场</span>
            <button type="button" className={styles.yumenResultLeaveButton} onClick={() => void onLeaveGame?.()}>离开战场</button>
          </div>
        </div>
      </div>
    );
  };

  const renderChatMessageLines = (messages: ChatMessage[]) => messages.map((message) => {
    const speakerColor = message.school ? SCHOOL_COLOR[message.school] : undefined;
    const isSystemMessage = message.channel === 'system' && (message.variant === 'system' || message.userId === 'system');
    const isBattleMessage = message.channel === 'battle' || message.variant === 'battle';
    const battleAbilityName = message.abilityName || '攻击';
    const battleTargetName = message.targetUsername ?? '目标';
    const targetColor = message.targetSchool ? SCHOOL_COLOR[message.targetSchool] : battleTargetName === message.username ? speakerColor : undefined;
    const renderBracketedBattleName = (name: string, color?: string) => (
      <>
        <span style={color ? { color } : undefined}>[</span>
        <span className={styles.chatSpeaker} style={color ? { color } : undefined}>{name}</span>
        <span style={color ? { color } : undefined}>]</span>
      </>
    );
    const renderBattleActor = () => message.username === '你'
      ? <span>你</span>
      : renderBracketedBattleName(message.username, speakerColor);
    const renderBattleTarget = () => battleTargetName === '你'
      ? <span>你</span>
      : renderBracketedBattleName(battleTargetName, targetColor);
    return (
      <div key={message.id} className={`${styles.chatMessageLine} ${isSystemMessage ? styles.chatSystemMessageLine : ''} ${isBattleMessage ? styles.chatBattleMessageLine : ''}`} data-chat-message-line="true">
        <span className={styles.chatPrefix}>
          <button
            type="button"
            className={styles.chatTimeButton}
            data-chat-part="time"
            onClick={() => copyMessageToChatInput(message.text)}
            onContextMenu={(event) => {
              event.preventDefault();
              void sendChatText(message.text, 'map', false);
            }}
          >[{formatChatTimestamp(message.timestamp)}]</button>{isSystemMessage || isBattleMessage ? null : <><span className={styles.chatChannel} data-chat-part="channel">[{CHAT_CHANNEL_LABELS[message.channel]}]</span><span className={styles.chatSpeaker} data-chat-part="speaker" style={speakerColor ? { color: speakerColor } : undefined}>[{message.username}]</span></>}
        </span>{isSystemMessage ? <span className={styles.chatSystemText} data-chat-part="text">{message.text}</span> : isBattleMessage ? (
          <span className={styles.chatBattleText} data-chat-part="text">
            {renderBattleActor()}<span>的[{battleAbilityName}]命中了</span>{renderBattleTarget()}
          </span>
        ) : <span className={styles.chatText} data-chat-part="text">:{message.text}</span>}
      </div>
    );
  });

  const renderChatScrollTrack = (groupId: 'main' | string, visual: ReturnType<typeof getChatScrollVisual>) => (
    <div
      className={`${styles.chatScrollTrack} ${!visual.canScroll ? styles.chatScrollTrackDisabled : ''}`}
      aria-hidden="true"
      onPointerDown={visual.canScroll ? (event) => beginChatScrollTrackDrag(groupId, event) : undefined}
    >
      <div
        className={styles.chatScrollThumb}
        style={{ height: `${visual.thumbHeightPct}%`, top: `${visual.thumbTopPct}%` }}
      />
    </div>
  );

  const renderChatPanel = () => {
    if (!activeChatWindow) return null;
    const scrollVisual = getChatScrollVisual(chatScrollMetrics);
    const placementStyle = useCustomChatPanelPlacement
      ? { left: chatPanelPos.left, top: chatPanelPos.top, bottom: 'auto' as const }
      : undefined;

    return (
      <div
        ref={chatPanelRef}
        className={`${styles.chatPanel} ${chatSearchOpen ? styles.chatPanelSearchOpen : ''} ${customUiMode ? styles.chatPanelCustomEditing : ''}`}
        style={{ ...chatPanelStyle, ...placementStyle }}
        data-ui-interactive
        data-ui-drag={customUiMode ? 'true' : undefined}
        onMouseDown={customUiMode ? beginChatPanelCustomDrag : undefined}
      >
        <div className={styles.chatHeader} data-chat-tab-bar-group="true" data-chat-group-id="main">
          <button type="button" className={styles.chatGearButton} aria-label="聊天设置" title="聊天设置" onClick={openChatSettings}>
            <Settings size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
          {mainChatWindows.map((windowConfig) => (
            <button
              key={windowConfig.id}
              type="button"
              className={`${styles.chatTabButton} ${activeChatWindow.id === windowConfig.id ? styles.chatTabButtonActive : ''}`}
              onMouseDown={(event) => beginChatTabDetachDrag(windowConfig, 'main', event)}
              onClick={() => {
                if (chatTabClickSuppressedRef.current === 'main') {
                  chatTabClickSuppressedRef.current = null;
                  return;
                }
                setActiveChatWindowId(windowConfig.id);
              }}
            >
              {windowConfig.name}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.chatSearchButton} ${chatSearchOpen ? styles.chatSearchButtonActive : ''}`}
            aria-label="搜索聊天"
            title="搜索聊天"
            onClick={() => setChatSearchOpen((open) => !open)}
          >
            <Search size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <div className={styles.chatResizeHandle} data-chat-resize-handle="true" onPointerDown={(event) => beginChatResize('main', event)} aria-hidden="true" />
        </div>

        <div className={styles.chatLogShell}>
          <div className={styles.chatScrollControls}>
            <button type="button" className={`${styles.chatScrollButton} ${scrollVisual.isAtTop ? styles.chatScrollButtonEdge : ''}`} disabled={!scrollVisual.canScroll || scrollVisual.isAtTop} aria-label="滚动到顶部" title="滚动到顶部" onClick={() => scrollChatLog('top')}>
              <ArrowUpToLine size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button type="button" className={`${styles.chatScrollButton} ${scrollVisual.isAtTop ? styles.chatScrollButtonEdge : ''}`} disabled={!scrollVisual.canScroll || scrollVisual.isAtTop} aria-label="向上滚动" title="向上滚动" onClick={() => scrollChatLog('up')}>
              <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {renderChatScrollTrack('main', scrollVisual)}
            <button type="button" className={`${styles.chatScrollButton} ${scrollVisual.isAtBottom ? styles.chatScrollButtonEdge : ''}`} disabled={!scrollVisual.canScroll || scrollVisual.isAtBottom} aria-label="向下滚动" title="向下滚动" onClick={() => scrollChatLog('down')}>
              <ArrowDown size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button type="button" className={`${styles.chatScrollButton} ${scrollVisual.isAtBottom ? styles.chatScrollButtonEdge : ''} ${chatBottomAlert && !scrollVisual.isAtBottom ? styles.chatScrollButtonFlash : ''}`} disabled={!scrollVisual.canScroll || scrollVisual.isAtBottom} aria-label="滚动到底部" title="滚动到底部" onClick={() => scrollChatLog('bottom')}>
              <ArrowDownToLine size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.chatLogColumn}>
            <div className={`${styles.chatSearchRow} ${chatSearchOpen ? styles.chatSearchRowOpen : styles.chatSearchRowClosed}`} aria-hidden={!chatSearchOpen}>
              <div className={styles.chatSearchField}>
                <input
                  ref={chatSearchInputRef}
                  type="text"
                  value={chatSearchQuery}
                  className={styles.chatSearchInput}
                  tabIndex={chatSearchOpen ? 0 : -1}
                  disabled={!chatSearchOpen}
                  onChange={(event) => setChatSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      setChatSearchOpen(false);
                      setChatSearchQuery('');
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.chatSearchCloseButton}
                  aria-label="关闭搜索"
                  title="关闭搜索"
                  tabIndex={chatSearchOpen ? 0 : -1}
                  onClick={() => {
                    setChatSearchOpen(false);
                    setChatSearchQuery('');
                  }}
                >
                  <X size={15} strokeWidth={2.3} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div ref={chatLogRef} className={styles.chatLog} onScroll={updateChatScrollMetrics}>
              {renderChatMessageLines(visibleChatMessages)}
            </div>
          </div>
        </div>

        <div className={styles.chatComposer}>
          <button type="button" className={styles.chatChannelPlaceholder}>频道</button>
          <label className={styles.chatInputWrap}>
            <span>地图:</span>
            <input
              ref={chatInputRef}
              type="text"
              value={chatInputValue}
              maxLength={CHAT_MAX_INPUT_LENGTH}
              className={styles.chatInput}
              onChange={(event) => setChatInputValue(event.target.value.slice(0, CHAT_MAX_INPUT_LENGTH))}
              onKeyDown={(event) => {
                event.stopPropagation();
                if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.altKey && !event.metaKey) {
                  const input = event.currentTarget;
                  const selectionStart = input.selectionStart;
                  const selectionEnd = input.selectionEnd;
                  if (selectionStart !== null && selectionEnd !== null && selectionStart === selectionEnd) {
                    const caret = selectionStart;
                    const text = chatInputValue;
                    let tokenStart = -1;
                    let tokenEnd = -1;

                    if (event.key === 'Backspace' && caret > 0 && text[caret - 1] === ']') {
                      const open = text.lastIndexOf('[', caret - 1);
                      if (open >= 0) {
                        const token = text.slice(open, caret);
                        if (/^\[[^\[\]]+\]$/.test(token)) {
                          tokenStart = open;
                          tokenEnd = caret;
                        }
                      }
                    }

                    if (event.key === 'Delete' && caret < text.length && text[caret] === '[') {
                      const close = text.indexOf(']', caret + 1);
                      if (close >= 0) {
                        const token = text.slice(caret, close + 1);
                        if (/^\[[^\[\]]+\]$/.test(token)) {
                          tokenStart = caret;
                          tokenEnd = close + 1;
                        }
                      }
                    }

                    if (tokenStart >= 0 && tokenEnd > tokenStart) {
                      event.preventDefault();
                      chatInputCursorPendingRef.current = tokenStart;
                      setChatInputValue((text.slice(0, tokenStart) + text.slice(tokenEnd)).slice(0, CHAT_MAX_INPUT_LENGTH));
                      return;
                    }
                  }
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                  void submitChatMessage();
                }
                if (event.key === 'Escape') {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <button type="button" className={styles.chatIconButton} aria-label="发送" title="发送" onClick={() => void submitChatMessage()}>
            <CornerDownLeft size={17} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <button type="button" className={styles.chatIconButton} aria-label="图片" title="图片" disabled>
            <ImageIcon size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button type="button" className={styles.chatIconButton} aria-label="清空聊天" title="清空聊天" onClick={handleChatEraseClick}>
            <Eraser size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button type="button" className={styles.chatIconButton} aria-label="表情" title="表情" disabled>
            <Smile size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  const renderDetachedChatPanels = () => detachedChatWindows.map((detachedWindow, index) => {
    const byId = new Map(chatWindows.map((entry) => [entry.id, entry]));
    const groupWindows = detachedWindow.windowIds.map((windowId) => byId.get(windowId)).filter((entry): entry is ChatWindowConfig => !!entry && !entry.hidden);
    if (groupWindows.length === 0) return null;
    const activeWindowConfig = groupWindows.find((entry) => entry.id === detachedWindow.activeWindowId) ?? groupWindows[0];
    const detachedSearchState = detachedChatSearchStates[detachedWindow.id] ?? EMPTY_CHAT_SEARCH_STATE;
    const messages = getVisibleChatMessagesForWindow(activeWindowConfig, detachedSearchState);
    const detachedScrollVisual = getChatScrollVisual(detachedChatScrollMetrics[detachedWindow.id] ?? EMPTY_CHAT_SCROLL_METRICS);
    const positionKey = getDetachedChatWindowUiKey(detachedWindow.id);
    const defaultPos = clampDetachedChatPosition({
      left: chatPanelPos.left + 34 * (index + 1),
      top: chatPanelPos.top - 34 * (index + 1),
    });
    const position = uiPositions[positionKey] ?? defaultPos;
    const detachedPanelSize = detachedChatPanelSizes[detachedWindow.id] ?? chatPanelSize;
    const beginDetachedDrag = (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement | null)?.closest('button, input, textarea, select')) return;
      startUIDrag(positionKey, defaultPos, event);
    };

    return (
      <div
        key={detachedWindow.id}
        className={`${styles.chatPanel} ${styles.detachedChatPanel} ${draggingChatGroupId === detachedWindow.id ? styles.chatPanelDragging : ''} ${detachedSearchState.open ? styles.chatPanelSearchOpen : ''} ${customUiMode ? styles.chatPanelCustomEditing : ''}`}
        style={{ ...buildChatPanelStyle(detachedPanelSize), left: position.left, top: position.top, bottom: 'auto' }}
        data-ui-interactive
        data-ui-drag="true"
      >
        <div className={styles.chatHeader} data-chat-tab-bar-group="true" data-chat-group-id={detachedWindow.id} onMouseDown={beginDetachedDrag}>
          {groupWindows.map((windowConfig) => (
            <button
              key={windowConfig.id}
              type="button"
              className={`${styles.chatTabButton} ${activeWindowConfig.id === windowConfig.id ? styles.chatTabButtonActive : ''}`}
              onMouseDown={(event) => beginChatTabDetachDrag(windowConfig, detachedWindow.id, event)}
              onClick={() => {
                if (chatTabClickSuppressedRef.current === detachedWindow.id) {
                  chatTabClickSuppressedRef.current = null;
                  return;
                }
                const nextDetachedWindows = detachedChatWindowsRef.current.map((entry) => (
                  entry.id === detachedWindow.id ? { ...entry, activeWindowId: windowConfig.id } : entry
                ));
                detachedChatWindowsRef.current = nextDetachedWindows;
                setDetachedChatWindows(nextDetachedWindows);
              }}
            >
              {windowConfig.name}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.chatSearchButton} ${detachedSearchState.open ? styles.chatSearchButtonActive : ''}`}
            aria-label="搜索聊天"
            title="搜索聊天"
            onClick={() => setDetachedChatSearchStates((current) => ({
              ...current,
              [detachedWindow.id]: {
                ...(current[detachedWindow.id] ?? EMPTY_CHAT_SEARCH_STATE),
                open: !(current[detachedWindow.id]?.open ?? false),
              },
            }))}
          >
            <Search size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <div className={styles.chatResizeHandle} data-chat-resize-handle="true" onPointerDown={(event) => beginChatResize(detachedWindow.id, event)} aria-hidden="true" />
        </div>

        <div className={styles.chatLogShell}>
          <div className={styles.chatScrollControls}>
            <button type="button" className={`${styles.chatScrollButton} ${detachedScrollVisual.isAtTop ? styles.chatScrollButtonEdge : ''}`} disabled={!detachedScrollVisual.canScroll || detachedScrollVisual.isAtTop} aria-label="滚动到顶部" title="滚动到顶部" onClick={() => scrollDetachedChatLog(detachedWindow.id, 'top')}>
              <ArrowUpToLine size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button type="button" className={`${styles.chatScrollButton} ${detachedScrollVisual.isAtTop ? styles.chatScrollButtonEdge : ''}`} disabled={!detachedScrollVisual.canScroll || detachedScrollVisual.isAtTop} aria-label="向上滚动" title="向上滚动" onClick={() => scrollDetachedChatLog(detachedWindow.id, 'up')}>
              <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {renderChatScrollTrack(detachedWindow.id, detachedScrollVisual)}
            <button type="button" className={`${styles.chatScrollButton} ${detachedScrollVisual.isAtBottom ? styles.chatScrollButtonEdge : ''}`} disabled={!detachedScrollVisual.canScroll || detachedScrollVisual.isAtBottom} aria-label="向下滚动" title="向下滚动" onClick={() => scrollDetachedChatLog(detachedWindow.id, 'down')}>
              <ArrowDown size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button type="button" className={`${styles.chatScrollButton} ${detachedScrollVisual.isAtBottom ? styles.chatScrollButtonEdge : ''}`} disabled={!detachedScrollVisual.canScroll || detachedScrollVisual.isAtBottom} aria-label="滚动到底部" title="滚动到底部" onClick={() => scrollDetachedChatLog(detachedWindow.id, 'bottom')}>
              <ArrowDownToLine size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.chatLogColumn}>
            <div className={`${styles.chatSearchRow} ${detachedSearchState.open ? styles.chatSearchRowOpen : styles.chatSearchRowClosed}`} aria-hidden={!detachedSearchState.open}>
              <div className={styles.chatSearchField}>
                <input
                  type="text"
                  value={detachedSearchState.query}
                  className={styles.chatSearchInput}
                  tabIndex={detachedSearchState.open ? 0 : -1}
                  disabled={!detachedSearchState.open}
                  onChange={(event) => setDetachedChatSearchStates((current) => ({
                    ...current,
                    [detachedWindow.id]: {
                      ...(current[detachedWindow.id] ?? EMPTY_CHAT_SEARCH_STATE),
                      query: event.target.value,
                    },
                  }))}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      setDetachedChatSearchStates((current) => ({
                        ...current,
                        [detachedWindow.id]: {
                          ...(current[detachedWindow.id] ?? EMPTY_CHAT_SEARCH_STATE),
                          open: false,
                          query: '',
                        },
                      }));
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.chatSearchCloseButton}
                  aria-label="关闭搜索"
                  title="关闭搜索"
                  tabIndex={detachedSearchState.open ? 0 : -1}
                  onClick={() => setDetachedChatSearchStates((current) => ({
                    ...current,
                    [detachedWindow.id]: {
                      ...(current[detachedWindow.id] ?? EMPTY_CHAT_SEARCH_STATE),
                      open: false,
                      query: '',
                    },
                  }))}
                >
                  <X size={15} strokeWidth={2.3} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div ref={(node) => { detachedChatLogRefs.current[detachedWindow.id] = node; }} className={styles.chatLog} onScroll={() => updateDetachedChatScrollMetrics(detachedWindow.id)}>
              {renderChatMessageLines(messages)}
            </div>
          </div>
        </div>
      </div>
    );
  });

  const renderChatSettingsModal = () => {
    if (!showChatSettings) return null;
    const normalizedWindowDrafts = normalizeChatWindows(chatWindowDrafts);
    const settingsDirty = chatSettingsDraft.fontSize !== chatSettings.fontSize
      || chatSettingsDraft.backgroundOpacity !== chatSettings.backgroundOpacity
      || JSON.stringify(normalizedWindowDrafts) !== JSON.stringify(normalizeChatWindows(chatWindows));
    const selectedWindowDraft = chatWindowDrafts.find((entry) => entry.id === selectedChatWindowId) ?? chatWindowDrafts[0] ?? DEFAULT_CHAT_WINDOWS[0];
    const selectedWindowCanClose = selectedWindowDraft.id !== 'combined';
    const selectedWindowChannels = new Set(selectedWindowDraft.channels);
    const settingsWindowStyle = {
      '--chat-settings-modal-width': `${chatSettingsModalSize.width}px`,
      '--chat-settings-modal-height': `${chatSettingsModalSize.height}px`,
    } as React.CSSProperties;

    return (
      <div className={styles.chatSettingsOverlay} data-ui-interactive>
        <div className={styles.chatSettingsWindow} role="dialog" aria-modal="true" aria-label="聊天设置" style={settingsWindowStyle}>
          <div className={styles.chatSettingsTitleBar}>
            <button type="button" className={styles.chatSettingsBackButton} aria-label="返回" title="返回" onClick={cancelChatSettings}>
              <ArrowLeft size={17} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <div className={styles.chatSettingsTitle}>聊天设置</div>
            <button type="button" className={styles.chatSettingsCloseButton} aria-label="关闭" title="关闭" onClick={cancelChatSettings}>
              <X size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.chatSettingsMainTabs}>
            <button type="button" className={`${styles.chatSettingsMainTab} ${chatSettingsMainTab === 'page' ? styles.chatSettingsMainTabActive : ''}`} onClick={() => setChatSettingsMainTab('page')}>聊天页面</button>
            <button type="button" className={`${styles.chatSettingsMainTab} ${chatSettingsMainTab === 'window' ? styles.chatSettingsMainTabActive : ''}`} onClick={() => setChatSettingsMainTab('window')}>聊天窗口</button>
          </div>
          {chatSettingsMainTab === 'page' ? (
            <div className={styles.chatSettingsBody}>
              <div className={styles.chatSettingsSidebar}>
                <button type="button" className={`${styles.chatSettingsNavButton} ${styles.chatSettingsNavButtonActive}`}>界面设置</button>
              </div>
              <div className={styles.chatSettingsContent}>
                <div className={styles.chatSettingsSectionLabel}>文字</div>
                <div className={styles.chatSettingsTwoColumnRow}>
                  <div className={styles.chatSettingsControlRow}>
                    <span className={styles.chatSettingsControlLabel}>字体</span>
                    <div ref={chatSettingsFontRef} className={styles.chatSettingsMenu}>
                      <button
                        type="button"
                        className={styles.chatSettingsMenuButton}
                        onClick={() => setChatFontMenuOpen((open) => !open)}
                      >
                        <span>{selectedChatFont.label}</span>
                        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                      {chatFontMenuOpen && (
                        <div className={styles.chatSettingsMenuList}>
                          {CHAT_FONT_OPTIONS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className={styles.chatSettingsMenuOption}
                              onClick={() => {
                                setChatSettingsDraft((current) => ({ ...current, fontFamily: option.id }));
                                setChatFontMenuOpen(false);
                              }}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.chatSettingsControlRow}>
                    <span className={styles.chatSettingsControlLabel}>字号</span>
                    <div ref={chatSettingsSizeRef} className={styles.chatSettingsMenu}>
                      <button
                        type="button"
                        className={styles.chatSettingsMenuButton}
                        onClick={() => setChatSizeMenuOpen((open) => !open)}
                      >
                        <span>{chatSettingsDraft.fontSize}号字体</span>
                        <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                      {chatSizeMenuOpen && (
                        <div className={styles.chatSettingsMenuList}>
                          {CHAT_FONT_SIZE_OPTIONS.map((size) => (
                            <button
                              key={size}
                              type="button"
                              className={styles.chatSettingsMenuOption}
                              onClick={() => {
                                setChatSettingsDraft((current) => ({ ...current, fontSize: size }));
                                setChatSizeMenuOpen(false);
                              }}
                            >
                              {size}号字体
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className={styles.chatSettingsSectionLabel}>背景</div>
                <div className={styles.chatSettingsTwoColumnRow}>
                  <div className={styles.chatSettingsRangeBlock}>
                    <div className={styles.chatSettingsRangeHeader}>
                      <span>调整背景透明度</span>
                      <span>{chatSettingsDraft.backgroundOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={chatSettingsDraft.backgroundOpacity}
                      onChange={(event) => setChatSettingsDraft((current) => ({ ...current, backgroundOpacity: normalizeChatOpacity(event.target.value) }))}
                      className={styles.chatSettingsRangeInput}
                      aria-label="调整背景透明度"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.chatWindowSettingsBody}>
              <div className={styles.chatWindowList}>
                {chatWindowDrafts.map((windowConfig) => (
                  <button
                    key={windowConfig.id}
                    type="button"
                    className={`${styles.chatWindowListButton} ${selectedWindowDraft.id === windowConfig.id ? styles.chatWindowListButtonActive : ''}`}
                    onClick={() => setSelectedChatWindowId(windowConfig.id)}
                  >
                    {windowConfig.name}
                  </button>
                ))}
              </div>
              <div className={styles.chatWindowEditor}>
                <div className={styles.chatWindowNameRow}>
                  <span>名称</span>
                  <input
                    type="text"
                    value={selectedWindowDraft.name}
                    disabled={selectedWindowDraft.lockedName}
                    className={styles.chatWindowNameInput}
                    onChange={(event) => {
                      const nextName = Array.from(event.target.value).slice(0, 8).join('');
                      setChatWindowDrafts((current) => current.map((entry) => entry.id === selectedWindowDraft.id ? { ...entry, name: nextName } : entry));
                    }}
                  />
                  <button
                    type="button"
                    className={`${styles.chatWindowReminderToggle} ${selectedWindowDraft.hidden ? styles.chatWindowReminderToggleActive : ''}`}
                    disabled={!selectedWindowCanClose}
                    onClick={() => {
                      if (!selectedWindowCanClose) return;
                      setChatWindowDrafts((current) => current.map((entry) => entry.id === selectedWindowDraft.id ? { ...entry, hidden: entry.hidden ? undefined : true } : entry));
                    }}
                  >
                    <span className={styles.chatSettingsCheckBox}>{selectedWindowDraft.hidden ? <Check size={18} strokeWidth={2.8} aria-hidden="true" /> : null}</span>
                    <span>关闭窗口</span>
                  </button>
                </div>
                <div className={styles.chatWindowChannelSection}>
                  <div className={styles.chatSettingsSectionLabel}>常用</div>
                  <div className={styles.chatWindowChannelGrid}>
                    {CHAT_WINDOW_CHANNEL_OPTIONS.map((channelOption) => {
                      const checked = selectedWindowChannels.has(channelOption.id);
                      return (
                        <button
                          key={channelOption.id}
                          type="button"
                          className={`${styles.chatWindowChannelCheck} ${checked ? styles.chatWindowChannelCheckActive : ''} ${channelOption.disabled ? styles.chatWindowChannelCheckDisabled : ''}`}
                          disabled={channelOption.disabled}
                          onClick={() => {
                            setChatWindowDrafts((current) => current.map((entry) => {
                              if (entry.id !== selectedWindowDraft.id) return entry;
                              const channels = new Set(entry.channels);
                              if (channels.has(channelOption.id)) channels.delete(channelOption.id);
                              else channels.add(channelOption.id);
                              return { ...entry, channels: [...channels] };
                            }));
                          }}
                        >
                          <span className={styles.chatSettingsCheckBox}>{checked ? <Check size={18} strokeWidth={2.8} aria-hidden="true" /> : null}</span>
                          <span>{channelOption.label}</span>
                          <span className={styles.chatWindowChannelColor} style={{ backgroundColor: CHAT_CHANNEL_COLORS[channelOption.id] }} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className={styles.chatSettingsFooter}>
            <div className={styles.chatSettingsFooterTools}>
              {chatSettingsMainTab === 'window' ? (
                <>
                  <button type="button" className={styles.chatSettingsFooterButton} onClick={createChatWindow}>新建</button>
                  <button type="button" className={styles.chatSettingsFooterButton} disabled={selectedWindowDraft.lockedDelete} onClick={deleteSelectedChatWindow}>删除</button>
                  <button type="button" className={styles.chatSettingsFooterButton} onClick={resetChatSettings}>恢复默认</button>
                  <button type="button" className={styles.chatSettingsFooterButton} onClick={setSelectedChatWindowAsDefault}>设为默认</button>
                </>
              ) : (
                <button type="button" className={styles.chatSettingsFooterButton} onClick={resetChatSettings}>恢复默认</button>
              )}
            </div>
            <div className={styles.chatSettingsFooterActions}>
              <button type="button" className={styles.chatSettingsFooterButton} onClick={confirmChatSettings}>确定</button>
              <button type="button" className={styles.chatSettingsFooterButton} onClick={cancelChatSettings}>取消</button>
              <button type="button" className={styles.chatSettingsFooterButton} disabled={!settingsDirty} onClick={applyChatSettings}>应用</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderChatClearDialog = () => {
    if (!chatClearDialog && !customUiMode) return null;
    const clearDialogStyle = {
      '--chat-clear-dialog-width': `${chatClearDialogLayout.width}px`,
      '--chat-clear-dialog-height': `${chatClearDialogLayout.height}px`,
      left: `${chatClearDialogPos.left}px`,
      top: `${chatClearDialogPos.top}px`,
    } as React.CSSProperties;
    return (
      <div className={styles.chatClearOverlay} data-ui-interactive data-ui-drag={customUiMode ? 'true' : undefined}>
        <div
          className={`${styles.chatClearDialog} ${customUiMode ? styles.chatClearDialogCustomEditing : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="清空聊天栏"
          style={clearDialogStyle}
          onMouseDown={customUiMode ? beginChatClearDialogCustomDrag : undefined}
        >
          {customUiMode && <div className={styles.chatClearDialogPlacementBox} aria-hidden="true" />}
          <div className={styles.chatClearText}>清除当前窗口聊天记录？</div>
          <div className={`${styles.chatClearText} ${styles.chatClearHintText}`}>按住CTRL点击可以跳过该警告。</div>
          <div className={`${styles.chatClearText} ${styles.chatClearHintText}`}>按住ALT点击可以清空所有聊天栏。</div>
          <div className={styles.chatClearActions}>
            <button type="button" className={styles.chatClearButton} onClick={confirmChatClear}>确定</button>
            <button type="button" className={styles.chatClearButton} onClick={() => setChatClearDialog(null)}>取消</button>
          </div>
        </div>
      </div>
    );
  };

  const getHotkeySettingsRows = (): HotkeySettingsRow[] => {
    if (hotkeySettingsTab === 'character-action') {
      return LOCKED_CHARACTER_ACTION_HOTKEY_ROWS;
    }
    if (hotkeySettingsTab === 'interface-toggle') {
      return INTERFACE_HOTKEY_ROWS;
    }
    if (hotkeySettingsTab === 'ability') {
      return Array.from({ length: DRAFT_ABILITY_SLOT_COUNT }, (_, index) => ({
        actionId: `draft:${index}`,
        label: `技能${index + 1}`,
      }));
    }
    if (hotkeySettingsTab === 'common') {
      return Array.from({ length: COMMON_ABILITY_ORDER.length }, (_, index) => ({
        actionId: `common:${index}`,
        label: `技能${index + 1}`,
      }));
    }
    return Array.from({ length: consumableBarSettings.slotCount }, (_, index) => ({
      actionId: `consumable:${index}`,
      label: `物品${index + 1}`,
    }));
  };

  const renderHotkeyBindingButton = (row: HotkeySettingsRow, bindingIndex: number) => {
    const actionId = row.actionId;
    const bindings = row.locked ? (row.bindings ?? []) : getHotkeyActionBindingLabels(hotkeySettings, actionId);
    const isCapturing = !row.locked && capturingHotkey?.actionId === actionId && capturingHotkey.bindingIndex === bindingIndex;
    const bindingId = bindings[bindingIndex];
    const label = bindingId ? formatHotkeyBindingLabel(bindingId) : '';
    return (
      <div className={styles.escHotkeyBindingCell} key={`${actionId}-${bindingIndex}`}>
        <button
          type="button"
          data-ui-interactive="true"
          className={`${styles.escHotkeyButton} ${row.locked ? styles.escHotkeyButtonLocked : ''} ${isCapturing ? styles.escHotkeyButtonCapturing : ''}`}
          disabled={row.locked}
          aria-label={`${row.label}快捷键${bindingIndex + 1}`}
          onClick={() => {
            if (row.locked || isCapturing) return;
            setCapturingHotkey({ actionId, bindingIndex });
          }}
          onKeyDown={(event) => {
            if (row.locked || !isCapturing) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') {
              setCapturingHotkey(null);
              return;
            }
            captureHotkeyBinding(capturingHotkey, normalizeKeyboardHotkey(event));
          }}
          onMouseDown={(event) => {
            if (row.locked) return;
            if (event.button === 2) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (!isCapturing || event.button === 0) return;
            event.preventDefault();
            event.stopPropagation();
            captureHotkeyBinding(capturingHotkey, normalizeMouseHotkey(event.button));
          }}
          onWheel={(event) => {
            if (row.locked || !isCapturing) return;
            event.preventDefault();
            event.stopPropagation();
            captureHotkeyBinding(capturingHotkey, normalizeWheelHotkey(event.deltaY));
          }}
          onContextMenu={(event) => {
            if (row.locked) return;
            event.preventDefault();
            event.stopPropagation();
            if (isCapturing) {
              setCapturingHotkey(null);
            } else if (bindingId) {
              clearHotkeyBinding(actionId, bindingIndex);
            }
          }}
        >
          {label}
        </button>
      </div>
    );
  };

  const renderHotkeySettingsRows = () => (
    <div className={styles.escHotkeyGrid}>
      {getHotkeySettingsRows().map((row) => (
        <div className={styles.escHotkeyRow} key={row.actionId}>
          <div className={styles.escHotkeyLabel}>{row.label}</div>
          <div className={styles.escHotkeyBindings}>
            {Array.from({ length: HOTKEY_MAX_BINDINGS_PER_ACTION }, (_, index) => renderHotkeyBindingButton(row, index))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderConsumableBarSettings = () => (
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
  );

  const renderItemBar = () => {
    const consumableNowMs = systemTime.getTime();
    const visibleConsumableSlots = consumableBarSettings.enabled && !selfYumenSpectating
      ? consumableBarSettings.slots.slice(0, consumableBarSettings.slotCount)
      : [];

    return (
    <div className={styles.itemBar} aria-label="物品栏">
      {visibleConsumableSlots.map((consumableId, index) => {
        const consumable = consumableId ? CONSUMABLE_ITEM_BY_ID.get(consumableId) : undefined;
        const cooldownMs = consumable ? getConsumableCooldownRemainingMs(me, consumable.id, consumableNowMs) : 0;
        const cooldownLabel = formatConsumableCooldown(cooldownMs);
        const cooldownPct = getConsumableCooldownPct(consumable, cooldownMs);
        const cooldownDanger = isCooldownFlashDanger(cooldownMs);
        const remainingCount = consumable ? getConsumableRemainingCount(me, consumable) : 0;
        const unavailable = !!consumable && consumable.implemented !== true;
        const depleted = !!consumable && consumable.implemented === true && remainingCount <= 0;
        const hotkeyLabel = formatHotkeyHintLabel(getHotkeyActionBindingLabels(hotkeySettings, `consumable:${index}`)[0] ?? '');
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
              if (typeof sourceIndex === 'number' && Number.isInteger(sourceIndex)) {
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
            onClick={(event) => {
              if (!consumable) return;
              if (event.ctrlKey) {
                appendAbilityNameToChatInput(consumable.name);
                return;
              }
              if (cooldownMs > 0 || unavailable || depleted || customUiMode) return;
              useConsumableRef.current(consumable.id);
            }}
          >
            {consumable && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getConsumableIconPath(consumable.name)} alt={consumable.name} className={styles.consumableIcon} draggable={false} />
            )}
            {consumable?.implemented === true && <span className={styles.consumableCount}>{remainingCount}</span>}
            {hotkeyLabel && <span className={styles.consumableHotkey}>{hotkeyLabel}</span>}
            {cooldownMs > 0 && <span className={`${styles.consumableCooldown} ${cooldownDanger ? styles.consumableCooldownDanger : ''}`} style={getCooldownOverlayStyle(cooldownPct, 'cooldown')}>{cooldownLabel}</span>}
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
          <StatusBar buffs={playerStatusBuffs} debugLabel="me" onCancelBuff={onCancelBuff} onCopyBuffName={appendAbilityNameToChatInput} playerScale visibilityMode={showHiddenBuffStatusBar ? 'hidden-only' : 'visible'} />
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
              setMartialDragHoverIndex(null);
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
          const keyHint = formatHotkeyHintLabel(getHotkeyActionBindingLabels(hotkeySettings, `draft:${idx}`)[0] ?? '');
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
                setMartialDragHoverIndex(null);
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
                const cooldownDisplayKind = ability.cooldownDisplayKind ?? 'cooldown';
                const showCooldownNumber = cooldownDisplayKind !== 'gcd';
                const cooldownDanger = showCooldownNumber && isCooldownFlashDanger((ability.cooldown / SERVER_TICK_RATE) * 1000);
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
                    onClick={(event) => {
                      if (dragJustEndedRef.current) return;
                      if (event.ctrlKey) {
                        appendAbilityNameToChatInput(ability.name);
                        return;
                      }
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
                      <div className={`${styles.cdArc} ${cooldownDisplayKind === 'gcd' ? styles.cdArcGcd : ''}`} style={getCooldownOverlayStyle(cdPct, cooldownDisplayKind)}>
                        {showCooldownNumber && <span className={`${styles.cdNum} ${minuteCooldown ? styles.cdNumMinutes : ''} ${cooldownDanger ? styles.cdNumDanger : ''}`}>{cdLabel}</span>}
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
            const keyHint = formatHotkeyHintLabel(getHotkeyActionBindingLabels(hotkeySettings, `common:${idx}`)[0] ?? '');
            const cdPct = ability.maxCooldown > 0 ? (ability.cooldown / ability.maxCooldown) * 100 : 0;
            const cdLabel = formatHudCooldownText(ability.cooldown / 30);
            const minuteCooldown = cdLabel.endsWith('m');
            const cooldownDisplayKind = ability.cooldownDisplayKind ?? 'cooldown';
            const showCooldownNumber = cooldownDisplayKind !== 'gcd';
            const cooldownDanger = showCooldownNumber && isCooldownFlashDanger((ability.cooldown / SERVER_TICK_RATE) * 1000);
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
                  onClick={(event) => {
                    if (event.ctrlKey) {
                      appendAbilityNameToChatInput(ability.name);
                      return;
                    }
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
                    <div className={`${styles.cdArc} ${cooldownDisplayKind === 'gcd' ? styles.cdArcGcd : ''}`} style={getCooldownOverlayStyle(cdPct, cooldownDisplayKind)}>
                      {showCooldownNumber && <span className={`${styles.cdNum} ${minuteCooldown ? styles.cdNumMinutes : ''} ${cooldownDanger ? styles.cdNumDanger : ''}`}>{cdLabel}</span>}
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

      {isYumenMode && (
        <YumenMiniMap
          mapWidth={ARENA_WIDTH}
          mapHeight={ARENA_HEIGHT}
          playerPosition={{ x: me.position.x, y: me.position.y }}
          playerFacing={{ x: me.facing?.x ?? 0, y: me.facing?.y ?? 1 }}
          safeZone={safeZone}
          panelPosition={uiPositions[YUMEN_MINIMAP_UI_KEY]}
          onPanelPositionChange={updateYumenMiniMapPosition}
        />
      )}

      <FloatingCoordinateDisplay
        visible={showCoordinateDisplay}
        positionRef={localRenderPosRef}
        fallbackPosition={me.position}
        onCopy={() => void copyCurrentCoordinateText()}
      />

      {uiLayoutReady ? renderChatPanel() : null}
      {uiLayoutReady ? renderDetachedChatPanels() : null}
      {renderChatSettingsModal()}
      {renderChatClearDialog()}

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
      {showFloatingYumenKillNotice && renderYumenKillNotice()}
      {showFloatingYumenKillConfirm && renderYumenKillConfirm()}
      {showFloatingYumenAliveCount && renderYumenAliveCount()}

      {showFloatingMartialPanel && (
        <div
          data-ui-interactive
          data-ui-drag={customUiMode ? 'true' : undefined}
          className={`${styles.martialPanelPlacement} ${customUiMode ? styles.customUiHudPlacementEditing : ''}`}
          style={{ left: customUiMode ? martialPanelPos.left : martialPanelDisplayPos.left, top: customUiMode ? martialPanelPos.top : martialPanelDisplayPos.top }}
          onMouseDown={customUiMode ? (event) => startUIDrag(MARTIAL_PANEL_UI_KEY, martialPanelDefaultPos, event, { persist: false }) : undefined}
        >
          {customUiMode && <div className={styles.customUiPlacementLabel}>武学界面</div>}
          {renderMartialPanel(customUiMode && !showMartialPanel)}
        </div>
      )}

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

      {showCombatPresetBar && (
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
            {showCombatPresetPanel ? '>' : '<'}
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
      )}
      {/* ===== FULL-SCREEN 3D CANVAS ===== */}
      {/* ===== R3F 3D CANVAS ===== */}
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <Canvas
          key={sceneCanvasKey}
          camera={{ fov: CAMERA_FOV, near: 0.5, far: 2000 }}
          style={{ background: blueprintMode ? '#000010' : selfHasHongMengTianJin ? '#000000' : '#888888' }}
          dpr={sceneCanvasDpr}
          gl={sceneCanvasGl}
          onCreated={handleMainCanvasCreated}
          shadows={isExportedMap && envToggles.shadows && !blueprintMode ? 'percentage' : false}
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
            yumenSpectatorUserIds={Array.from(yumenSpectatorUserIds)}
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
            meChanneling={playerStatusBuffs.some((b: any) => b.buffId === 1014 || b.buffId === 2712)}
            meChannelRadius={playerStatusBuffs.some((b: any) => b.buffId === 2712) ? 4 : 10}
            channelingOpponentId={visibleOpponentsList.find((o) => activeBuffsClient(o?.buffs).some((b: any) => b.buffId === 1014 || b.buffId === 2712))?.userId ?? null}
            channelingOpponentRadius={(() => { const opp = visibleOpponentsList.find((o) => activeBuffsClient(o?.buffs).some((b: any) => b.buffId === 1014 || b.buffId === 2712)); return activeBuffsClient(opp?.buffs).some((b: any) => b.buffId === 2712) ? 4 : 10; })()}
            selectedSelf={selectedSelf}
            localRenderPosRef={localRenderPosRef}
            camYawRef={camYawRef}
            camPitchRef={camPitchRef}
            camZoomRef={camZoomRef}
            cameraMoveCommandActiveRef={cameraMoveCommandActiveRef}
            cameraForwardMoveCommandActiveRef={cameraForwardMoveCommandActiveRef}
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
            playArea={effectivePlayArea}
            onPlayAreaChange={updateYumenPlayArea}
            boundaryEditMode={yumenBoundaryEditMode}
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
            onCameraDebugEvent={isExportedMap && showCameraEventTestingPanel ? appendCameraDebugEntry : undefined}
            blueprintMode={blueprintMode}
            losIsBlocked={draftAbilities.some(a => !!a?.losBlocked) || commonAbilities.some(a => a.losBlocked)}
            onEnvDebug={isExportedMap && lightingControlsOpen ? setEnvDebugInfo : undefined}
            onSceneMetrics={handleSceneMetrics}
            onSceneLoadTiming={handleSceneLoadTiming}
            envToggles={isExportedMap ? envToggles : undefined}
            dirLightConfig={isExportedMap ? dirLightConfig : undefined}
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
      <div className={`${styles.yumenGhostScreenVeil} ${selfYumenSpectating ? styles.yumenGhostScreenVeilVisible : ''}`} aria-hidden="true" />
      <div className={`${styles.yumenSandstormScreenVeil} ${selfHasYumenKuangSha ? styles.yumenSandstormScreenVeilVisible : ''}`} style={yumenSandstormOverlayValues.cssVars} aria-hidden="true" />
      {renderYumenResultOverlay()}
      {/* per-opponent floating channel overlay removed:
         enemy channel bar is now rendered inside .enemyBossGroup
         (below the boss HP bar, above the status bar). */}
      <div className={`${styles.hongMengBlackout} ${hongMengOverlayActive ? styles.hongMengOverlayVisible : ''}`} aria-hidden="true" />
      {hongMengOverlayActive && <div className={`${styles.hongMengSelfCanvas} ${styles.hongMengOverlayVisible}`} aria-hidden="true">
        <Canvas
          camera={{ fov: CAMERA_FOV, near: 0.5, far: 2000 }}
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
            yumenSpectatorUserIds={Array.from(yumenSpectatorUserIds)}
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
            cameraForwardMoveCommandActiveRef={cameraForwardMoveCommandActiveRef}
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
      {(mode === 'test' || mode === 'collision-test') && showSceneTestingPanel && (
        <div className={styles.uiInfoPanel} style={{ left: '5%', top: '50%', transform: 'translateY(-50%)' }}>
          <div className={styles.uiFloatingTitle}>角色状态</div>
          <div className={styles.uiInfoValue}>位置 {localRenderPosRef.current.x.toFixed(1)}, {localRenderPosRef.current.y.toFixed(1)}</div>
          <div className={styles.uiInfoValue}>移速 {effectiveMoveSpeedUnitsPerSec.toFixed(2)}</div>
          <div className={styles.uiInfoValue}>镜头距离 {cameraZoomToDistance(cameraZoomLevel).toFixed(2)}</div>
          <div className={styles.uiInfoValue}>广角 {CAMERA_FOV}</div>
        </div>
      )}

      {(mode === 'test' || mode === 'collision-test') && showCameraEventTestingPanel && (
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

      {(mode === 'test' || mode === 'collision-test') && showMeasurePanel && (
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

      {showTestingPanel && (
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
                  {canAccessTestingPanels && (
                    <button
                      type="button"
                      className={`${styles.escMainTabButton} ${escMainTab === 'test' ? styles.escMainTabButtonActive : ''}`}
                      onClick={() => setEscMainTab('test')}
                    >
                      测试
                    </button>
                  )}
                </div>
                {escMainTab === 'normal' || !canAccessTestingPanels ? (
                  <>
                    <div className={styles.escMainGrid}>
                      <button type="button" className={styles.escMainTile} disabled>
                        <span className={styles.escMainIcon}><UserRound size={78} strokeWidth={1.6} aria-hidden="true" /></span>
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
                      <button
                        type="button"
                        className={styles.escMainTile}
                        onClick={() => {
                          setShowTestingPanel(false);
                          setEscPanelPage('main');
                          setEscMainTab('normal');
                          openChatSettings();
                        }}
                      >
                        <span className={styles.escMainIcon}><MessageCircle size={78} strokeWidth={1.6} aria-hidden="true" /></span>
                        <span>聊天设置</span>
                      </button>
                      <button type="button" className={styles.escMainTile} onClick={() => setEscPanelPage('hotkey-settings')}>
                        <span className={styles.escMainIcon}><Settings size={78} strokeWidth={1.6} aria-hidden="true" /></span>
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
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'camera' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => {
                            setEscTestPage('camera');
                            setShowCameraEventTestingPanel(true);
                          }}
                        >
                          镜头测试
                        </button>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'martial' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setEscTestPage('martial')}
                        >
                          武学界面
                        </button>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'chat' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setEscTestPage('chat')}
                        >
                          聊天
                        </button>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'kill' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setEscTestPage('kill')}
                        >
                          击杀
                        </button>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${escTestPage === 'sandstorm' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setEscTestPage('sandstorm')}
                        >
                          狂沙
                        </button>
                      </aside>
                      <section className={styles.escTestContent}>
                        {escTestPage === 'switches' ? (
                          <>
                          <div className={styles.escTestGrid}>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showSceneTestingPanel} onChange={(e) => setShowSceneTestingPanel(e.target.checked)} className={styles.escToggleInput} />
                              <span>角色测试状态</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input
                                type="checkbox"
                                checked={showCameraEventTestingPanel}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  setShowCameraEventTestingPanel(next);
                                  if (next) setEscTestPage('camera');
                                }}
                                className={styles.escToggleInput}
                              />
                              <span>镜头测试</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showLoadPerformancePanel} onChange={(e) => setShowLoadPerformancePanel(e.target.checked)} className={styles.escToggleInput} />
                              <span>场景加载报告</span>
                            </label>
                            <label className={styles.escToggleRow}>
                              <input type="checkbox" checked={showHiddenBuffStatusBar} onChange={(e) => setShowHiddenBuffStatusBar(e.target.checked)} className={styles.escToggleInput} />
                              <span>显示隐藏buff</span>
                            </label>
                            {canAccessTestingPanels && (
                              <label className={styles.escToggleRow}>
                                <input
                                  type="checkbox"
                                  checked={showCheatAbilityPanelEntry}
                                  onChange={(e) => setShowCheatAbilityPanelEntry(e.target.checked)}
                                  className={styles.escToggleInput}
                                />
                                <span>打开测试添加技能面板</span>
                              </label>
                            )}
                            <label className={styles.escToggleRow}>
                              <input
                                type="checkbox"
                                checked={showCombatPresetBar}
                                onChange={(e) => setShowCombatPresetBar(e.target.checked)}
                                className={styles.escToggleInput}
                              />
                              <span>装备测试栏</span>
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
                              <input
                                type="checkbox"
                                checked={showCoordinateDisplay}
                                onChange={(e) => setShowCoordinateDisplay(e.target.checked)}
                                className={styles.escToggleInput}
                              />
                              <span>打开坐标显示</span>
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
                          </div>
                          </>
                        ) : escTestPage === 'camera' ? (
                          <div className={styles.escCameraTestPanel}>
                            <div className={styles.escCameraTestToolbar}>
                              <label className={`${styles.escToggleRow} ${styles.escCameraEventToggle}`}>
                                <input
                                  type="checkbox"
                                  checked={showCameraEventTestingPanel}
                                  onChange={(e) => setShowCameraEventTestingPanel(e.target.checked)}
                                  className={styles.escToggleInput}
                                />
                                <span>镜头事件记录</span>
                              </label>
                              <button type="button" className={styles.escInlineButton} onClick={clearCameraDebugEntries}>清空</button>
                              <button type="button" className={styles.escInlineButton} onClick={() => void copyCameraDebugEntries()}>复制</button>
                            </div>
                            <div className={styles.escCameraMetricGrid}>
                              <div className={styles.escCameraMetricBox}>
                                <span>冲刺状态</span>
                                <strong>{cameraDashPredictionDebug.active ? '冲刺中' : '待机'}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>碰撞预测</span>
                                <strong>{cameraDashPredictionDebug.collisionAware ? '运行' : cameraDashPredictionDebug.collisionReady ? '就绪' : '等待'}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>领先帧</span>
                                <strong>{formatCameraDashNumber(cameraDashPredictionDebug.leadTicks, 1)}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>预测修正</span>
                                <strong>{formatCameraDashNumber(cameraDashPredictionDebug.collisionDelta)}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>服务端差</span>
                                <strong>{formatCameraDashNumber(cameraDashPredictionDebug.serverRenderGap)}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>渲染误差</span>
                                <strong>{formatCameraDashNumber(cameraDashPredictionDebug.renderPredictionGap)}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>镜头距离</span>
                                <strong>{formatCameraDashNumber(cameraZoomToDistance(cameraDashPredictionDebug.cameraZoom))}</strong>
                              </div>
                              <div className={styles.escCameraMetricBox}>
                                <span>俯仰角</span>
                                <strong>{formatCameraDashNumber(cameraDashPredictionDebug.cameraPitch)} / {formatCameraDashNumber(cameraDashPredictionDebug.minPitch)}..{formatCameraDashNumber(cameraDashPredictionDebug.maxPitch)}</strong>
                              </div>
                            </div>
                            <div className={styles.escCameraVectorPanel}>
                              <div className={styles.escCameraSectionHeader}>
                                <span>位置</span>
                                <span>{cameraDashPredictionDebug.stoppedByCollision ? '碰撞停止' : '跟随中'}</span>
                              </div>
                              <div className={styles.escCameraVectorRow}>
                                <span>服务端</span>
                                <strong>{formatCameraDashPosition(cameraDashPredictionDebug.serverPosition)}</strong>
                              </div>
                              <div className={styles.escCameraVectorRow}>
                                <span>渲染</span>
                                <strong>{formatCameraDashPosition(cameraDashPredictionDebug.renderPosition)}</strong>
                              </div>
                              <div className={styles.escCameraVectorRow}>
                                <span>碰撞预测</span>
                                <strong>{formatCameraDashPosition(cameraDashPredictionDebug.predictedPosition)}</strong>
                              </div>
                              <div className={styles.escCameraVectorRow}>
                                <span>线性预测</span>
                                <strong>{formatCameraDashPosition(cameraDashPredictionDebug.linearPosition)}</strong>
                              </div>
                            </div>
                            <div className={styles.escCameraEventPanel}>
                              <div className={styles.escCameraSectionHeader}>
                                <span>事件日志</span>
                                <span>{cameraDebugEntries.length}</span>
                              </div>
                              <div className={styles.escCameraEventList}>
                                {cameraDebugEntries.length === 0 ? (
                                  <div className={styles.escCameraEmptyState}>暂无记录</div>
                                ) : cameraDebugEntries.slice(-8).reverse().map((entry) => (
                                  <div className={styles.escCameraEventItem} key={entry.id}>
                                    <span>{entry.type}</span>
                                    <strong>{entry.message}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : escTestPage === 'martial' ? (
                          <div className={styles.escTestGrid}>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>武学界面宽度</span>
                                <span>{formatMartialSettingScale(getMartialSettingScale(martialPanelWidth, MARTIAL_PANEL_BASE_WIDTH))}</span>
                              </div>
                              <input
                                type="range"
                                min={MARTIAL_SETTING_MIN_SCALE}
                                max={MARTIAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getMartialSettingScale(martialPanelWidth, MARTIAL_PANEL_BASE_WIDTH)}
                                onChange={(e) => setMartialPanelWidth(scaleMartialSettingValue(e.target.value, MARTIAL_PANEL_BASE_WIDTH, normalizeMartialPanelWidth))}
                                className={styles.escRangeInput}
                                aria-label="武学界面宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>武学界面高度</span>
                                <span>{formatMartialSettingScale(getMartialSettingScale(martialPanelHeight, MARTIAL_PANEL_BASE_HEIGHT))}</span>
                              </div>
                              <input
                                type="range"
                                min={MARTIAL_SETTING_MIN_SCALE}
                                max={MARTIAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getMartialSettingScale(martialPanelHeight, MARTIAL_PANEL_BASE_HEIGHT)}
                                onChange={(e) => setMartialPanelHeight(scaleMartialSettingValue(e.target.value, MARTIAL_PANEL_BASE_HEIGHT, normalizeMartialPanelHeight))}
                                className={styles.escRangeInput}
                                aria-label="武学界面高度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>预设面板宽度</span>
                                <span>{formatMartialSettingScale(getMartialSettingScale(martialPresetPanelWidth, MARTIAL_PRESET_PANEL_BASE_WIDTH))}</span>
                              </div>
                              <input
                                type="range"
                                min={MARTIAL_SETTING_MIN_SCALE}
                                max={MARTIAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getMartialSettingScale(martialPresetPanelWidth, MARTIAL_PRESET_PANEL_BASE_WIDTH)}
                                onChange={(e) => setMartialPresetPanelWidth(scaleMartialSettingValue(e.target.value, MARTIAL_PRESET_PANEL_BASE_WIDTH, normalizeMartialPresetPanelWidth))}
                                className={styles.escRangeInput}
                                aria-label="预设面板宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>预设弹窗宽度</span>
                                <span>{formatMartialSettingScale(getMartialModalSettingScale(martialModalWidth, MARTIAL_MODAL_BASE_WIDTH))}</span>
                              </div>
                              <input
                                type="range"
                                min={MARTIAL_MODAL_SETTING_MIN_SCALE}
                                max={MARTIAL_MODAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getMartialModalSettingScale(martialModalWidth, MARTIAL_MODAL_BASE_WIDTH)}
                                onChange={(e) => setMartialModalWidth(scaleMartialModalSettingValue(e.target.value, MARTIAL_MODAL_BASE_WIDTH, normalizeMartialModalWidth))}
                                className={styles.escRangeInput}
                                aria-label="预设弹窗宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>预设弹窗高度</span>
                                <span>{formatMartialSettingScale(getMartialModalSettingScale(martialModalHeight, MARTIAL_MODAL_BASE_HEIGHT))}</span>
                              </div>
                              <input
                                type="range"
                                min={MARTIAL_MODAL_SETTING_MIN_SCALE}
                                max={MARTIAL_MODAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getMartialModalSettingScale(martialModalHeight, MARTIAL_MODAL_BASE_HEIGHT)}
                                onChange={(e) => setMartialModalHeight(scaleMartialModalSettingValue(e.target.value, MARTIAL_MODAL_BASE_HEIGHT, normalizeMartialModalHeight))}
                                className={styles.escRangeInput}
                                aria-label="预设弹窗高度"
                              />
                            </div>
                          </div>
                        ) : escTestPage === 'chat' ? (
                          <div className={styles.escTestGrid}>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>聊天设置宽度</span>
                                <span>{getChatSettingsModalScale(chatSettingsModalSize.width, CHAT_SETTINGS_MODAL_BASE_WIDTH).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={CHAT_SETTINGS_MODAL_SETTING_MIN_SCALE}
                                max={CHAT_SETTINGS_MODAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getChatSettingsModalScale(chatSettingsModalSize.width, CHAT_SETTINGS_MODAL_BASE_WIDTH)}
                                onChange={(e) => setChatSettingsModalSize((current) => ({
                                  ...current,
                                  width: scaleChatSettingsModalValue(e.target.value, CHAT_SETTINGS_MODAL_BASE_WIDTH, normalizeChatSettingsModalWidth),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="聊天设置宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>聊天设置高度</span>
                                <span>{getChatSettingsModalScale(chatSettingsModalSize.height, CHAT_SETTINGS_MODAL_BASE_HEIGHT).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={CHAT_SETTINGS_MODAL_SETTING_MIN_SCALE}
                                max={CHAT_SETTINGS_MODAL_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getChatSettingsModalScale(chatSettingsModalSize.height, CHAT_SETTINGS_MODAL_BASE_HEIGHT)}
                                onChange={(e) => setChatSettingsModalSize((current) => ({
                                  ...current,
                                  height: scaleChatSettingsModalValue(e.target.value, CHAT_SETTINGS_MODAL_BASE_HEIGHT, normalizeChatSettingsModalHeight),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="聊天设置高度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>清除记录宽度</span>
                                <span>{getChatClearDialogScale(chatClearDialogLayout.width, CHAT_CLEAR_DIALOG_BASE_WIDTH).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={CHAT_CLEAR_DIALOG_SETTING_MIN_SCALE}
                                max={CHAT_CLEAR_DIALOG_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getChatClearDialogScale(chatClearDialogLayout.width, CHAT_CLEAR_DIALOG_BASE_WIDTH)}
                                onChange={(e) => setChatClearDialogLayout((current) => ({
                                  ...current,
                                  width: scaleChatClearDialogValue(e.target.value, CHAT_CLEAR_DIALOG_BASE_WIDTH, normalizeChatClearDialogWidth),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="清除聊天记录宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>清除记录高度</span>
                                <span>{getChatClearDialogScale(chatClearDialogLayout.height, CHAT_CLEAR_DIALOG_BASE_HEIGHT).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={CHAT_CLEAR_DIALOG_SETTING_MIN_SCALE}
                                max={CHAT_CLEAR_DIALOG_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getChatClearDialogScale(chatClearDialogLayout.height, CHAT_CLEAR_DIALOG_BASE_HEIGHT)}
                                onChange={(e) => setChatClearDialogLayout((current) => ({
                                  ...current,
                                  height: scaleChatClearDialogValue(e.target.value, CHAT_CLEAR_DIALOG_BASE_HEIGHT, normalizeChatClearDialogHeight),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="清除聊天记录高度"
                              />
                            </div>
                          </div>
                        ) : escTestPage === 'kill' ? (
                          <div className={styles.escTestGrid}>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>击杀提示宽度</span>
                                <button type="button" className={styles.escInlineButton} onClick={previewYumenKillNotice}>预览</button>
                                <span>{getYumenHudSettingScale(yumenKillNoticeSize.width, YUMEN_KILL_NOTICE_BASE_WIDTH).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={YUMEN_HUD_SETTING_MIN_SCALE}
                                max={YUMEN_HUD_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getYumenHudSettingScale(yumenKillNoticeSize.width, YUMEN_KILL_NOTICE_BASE_WIDTH)}
                                onChange={(e) => setYumenKillNoticeSize((current) => ({
                                  ...current,
                                  width: scaleYumenHudSettingValue(e.target.value, YUMEN_KILL_NOTICE_BASE_WIDTH, normalizeYumenKillNoticeWidth),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="击杀提示宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>击杀提示高度</span>
                                <span>{getYumenHudSettingScale(yumenKillNoticeSize.height, YUMEN_KILL_NOTICE_BASE_HEIGHT).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={YUMEN_HUD_SETTING_MIN_SCALE}
                                max={YUMEN_HUD_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getYumenHudSettingScale(yumenKillNoticeSize.height, YUMEN_KILL_NOTICE_BASE_HEIGHT)}
                                onChange={(e) => setYumenKillNoticeSize((current) => ({
                                  ...current,
                                  height: scaleYumenHudSettingValue(e.target.value, YUMEN_KILL_NOTICE_BASE_HEIGHT, normalizeYumenKillNoticeHeight),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="击杀提示高度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>击杀确认宽度</span>
                                <button type="button" className={styles.escInlineButton} onClick={previewYumenKillConfirm}>预览</button>
                                <span>{getYumenHudSettingScale(yumenKillConfirmSize.width, YUMEN_KILL_CONFIRM_BASE_WIDTH).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={YUMEN_HUD_SETTING_MIN_SCALE}
                                max={YUMEN_HUD_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getYumenHudSettingScale(yumenKillConfirmSize.width, YUMEN_KILL_CONFIRM_BASE_WIDTH)}
                                onChange={(e) => setYumenKillConfirmSize((current) => ({
                                  ...current,
                                  width: scaleYumenHudSettingValue(e.target.value, YUMEN_KILL_CONFIRM_BASE_WIDTH, normalizeYumenKillConfirmWidth),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="击杀确认宽度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>击杀确认高度</span>
                                <span>{getYumenHudSettingScale(yumenKillConfirmSize.height, YUMEN_KILL_CONFIRM_BASE_HEIGHT).toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={YUMEN_HUD_SETTING_MIN_SCALE}
                                max={YUMEN_HUD_SETTING_MAX_SCALE}
                                step="0.1"
                                value={getYumenHudSettingScale(yumenKillConfirmSize.height, YUMEN_KILL_CONFIRM_BASE_HEIGHT)}
                                onChange={(e) => setYumenKillConfirmSize((current) => ({
                                  ...current,
                                  height: scaleYumenHudSettingValue(e.target.value, YUMEN_KILL_CONFIRM_BASE_HEIGHT, normalizeYumenKillConfirmHeight),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="击杀确认高度"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>剩余人数缩放</span>
                                <span>{yumenAliveCountScale.toFixed(1)}</span>
                              </div>
                              <input
                                type="range"
                                min={YUMEN_HUD_SETTING_MIN_SCALE}
                                max={YUMEN_HUD_SETTING_MAX_SCALE}
                                step="0.1"
                                value={yumenAliveCountScale}
                                onChange={(e) => setYumenAliveCountSize(() => ({
                                  width: scaleYumenHudSettingValue(e.target.value, YUMEN_ALIVE_COUNT_BASE_WIDTH, normalizeYumenAliveCountWidth),
                                  height: scaleYumenHudSettingValue(e.target.value, YUMEN_ALIVE_COUNT_BASE_HEIGHT, normalizeYumenAliveCountHeight),
                                }))}
                                className={styles.escRangeInput}
                                aria-label="剩余人数缩放"
                              />
                            </div>
                          </div>
                        ) : escTestPage === 'sandstorm' ? (
                          <div className={styles.escTestGrid}>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>橙色量</span>
                                <span>{Math.round(yumenSandstormOverlaySettings.orangeAmount)}%</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={yumenSandstormOverlaySettings.orangeAmount}
                                onChange={(e) => setYumenSandstormOverlaySettings((current) => normalizeSandstormOverlaySettings({ ...current, orangeAmount: e.target.value }))}
                                className={styles.escRangeInput}
                                aria-label="狂沙橙色量"
                              />
                            </div>
                            <div className={styles.escSettingControl}>
                              <div className={styles.escRangeHeader}>
                                <span>明暗</span>
                                <span>{Math.round(yumenSandstormOverlaySettings.brightness)}</span>
                              </div>
                              <input
                                type="range"
                                min="-40"
                                max="40"
                                step="1"
                                value={yumenSandstormOverlaySettings.brightness}
                                onChange={(e) => setYumenSandstormOverlaySettings((current) => normalizeSandstormOverlaySettings({ ...current, brightness: e.target.value }))}
                                className={styles.escRangeInput}
                                aria-label="狂沙明暗"
                              />
                            </div>
                            <div className={`${styles.escSettingControl} ${styles.sandstormValuePanel}`}>
                              <div className={styles.escRangeHeader}>
                                <span>最终值</span>
                                <button type="button" className={styles.escInlineButton} onClick={copyYumenSandstormOverlayValues}>复制</button>
                              </div>
                              <div className={styles.sandstormValueRows}>
                                <div><span>RGB</span> {yumenSandstormOverlayValues.r}, {yumenSandstormOverlayValues.g}, {yumenSandstormOverlayValues.b}</div>
                                <div><span>Alpha</span> {yumenSandstormOverlayValues.alpha.toFixed(3)}</div>
                                <div>{yumenSandstormOverlayValues.rgba}</div>
                              </div>
                            </div>
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
                    onClick={cancelEscSettings}
                    className={styles.escHeaderIconButton}
                    aria-label={escPanelPage === 'hotkey-settings' ? '关闭快捷键设置' : escPanelPage === 'sound-settings' ? '关闭声音设置' : '关闭游戏设置'}
                  >
                    <X size={28} strokeWidth={2.3} aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.escSettingsBody}>
                  <aside className={styles.escSettingsSidebar}>
                    {escPanelPage === 'hotkey-settings' ? (
                      HOTKEY_SETTINGS_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`${styles.escSettingsNavButton} ${hotkeySettingsTab === tab.id ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setHotkeySettingsTab(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))
                    ) : escPanelPage === 'sound-settings' ? (
                      <button type="button" className={`${styles.escSettingsNavButton} ${styles.escSettingsNavButtonActive}`}>音效</button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${gameSettingsTab === 'general' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setGameSettingsTab('general')}
                        >
                          综合
                        </button>
                        <button
                          type="button"
                          className={`${styles.escSettingsNavButton} ${gameSettingsTab === 'items' ? styles.escSettingsNavButtonActive : ''}`}
                          onClick={() => setGameSettingsTab('items')}
                        >
                          物品栏
                        </button>
                      </>
                    )}
                  </aside>
                  <section className={styles.escSettingsContent}>
                    {escPanelPage === 'hotkey-settings' ? (
                      <>
                        <div className={styles.escSectionTitle}><span>{HOTKEY_SETTINGS_TABS.find((tab) => tab.id === hotkeySettingsTab)?.label ?? '快捷键'}</span></div>
                        {renderHotkeySettingsRows()}
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
                    ) : gameSettingsTab === 'items' ? (
                      <>
                        <div className={styles.escSectionTitle}><span>物品栏</span></div>
                        {renderConsumableBarSettings()}
                      </>
                    ) : (
                      <>
                        <div className={styles.escSectionTitle}><span>镜头设置</span></div>
                        <div className={`${styles.escSettingsGrid} ${styles.escCameraSettingsGrid}`}>
                          <div className={`${styles.escSettingControl} ${styles.escCameraModeControl}`}>
                            <div className={styles.escCameraFieldLabel}>镜头类型</div>
                            <div className={styles.escCameraModeRow} role="radiogroup" aria-label="镜头类型">
                              <button
                                type="button"
                                className={`${styles.escCameraModeButton} ${styles.escCameraModeButtonActive}`}
                                aria-pressed="true"
                              >
                                <span className={styles.escCameraRadio} aria-hidden="true" />
                                <span>从不追随</span>
                              </button>
                              <button type="button" className={styles.escCameraModeButton} disabled aria-pressed="false">
                                <span className={styles.escCameraRadio} aria-hidden="true" />
                                <span>总是追随</span>
                              </button>
                              <button type="button" className={styles.escCameraModeButton} disabled aria-pressed="false">
                                <span className={styles.escCameraRadio} aria-hidden="true" />
                                <span>智能追随</span>
                              </button>
                            </div>
                          </div>
                          <div className={styles.escSettingControl}>
                            <div className={styles.escRangeHeader}>
                              <span>镜头最大距离</span>
                              <span>{cameraSettings.maxDistance.toFixed(2)}</span>
                            </div>
                            <input
                              type="range"
                              min={CAMERA_DISTANCE_MIN}
                              max={CAMERA_DISTANCE_MAX}
                              step="0.01"
                              value={cameraSettings.maxDistance}
                              onChange={(e) => setCameraMaxDistance(e.target.value)}
                              className={styles.escRangeInput}
                              aria-label="镜头最大距离"
                            />
                          </div>
                        </div>
                        <div className={styles.escSectionTitle}><span>界面设置</span></div>
                        <div className={styles.escSettingsGrid}>
                          <div className={styles.escSettingControl}>
                            <div className={styles.escRangeHeader}>
                              <span>技能栏大小</span>
                              <span>{abilityPanelScale.toFixed(2)}</span>
                            </div>
                            <input
                              type="range"
                              min={ABILITY_PANEL_MIN_SCALE}
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
                  <div className={styles.escSettingsFooterLeft}>
                    {escPanelPage === 'hotkey-settings' && (
                      <>
                        <button type="button" className={styles.escFooterButton} onClick={resetHotkeySettings}>恢复配置</button>
                        <button type="button" className={styles.escFooterButton} disabled>清除</button>
                      </>
                    )}
                  </div>
                  <div className={styles.escSettingsFooterRight}>
                    <button type="button" className={styles.escFooterButton} onClick={confirmEscSettings}>确定</button>
                    <button type="button" className={styles.escFooterButton} onClick={cancelEscSettings}>取消</button>
                    <button type="button" className={styles.escFooterButton} disabled={escPanelPage !== 'hotkey-settings' || !hotkeySettingsDirty} onClick={applyEscSettings}>应用</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {isExportedMap && !collisionReady && (
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
          const targetShield = isSelf
            ? myShield
            : isEntityTarget
            ? getLinkedShieldDisplayClient(selectedEntity as any)
            : getLinkedShieldDisplayClient(selectedTarget as any);
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
          const targetBuffs  = isSelf ? playerStatusBuffs : isEntityTarget ? activeBuffsClient(selectedEntity?.buffs as any) : activeBuffsClient(selectedTarget?.buffs);
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
                    onCopyBuffName={appendAbilityNameToChatInput}
                    visibilityMode={showHiddenBuffStatusBar ? 'hidden-only' : 'visible'}
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

      <div className={styles.bottomRightQuickToggles} data-ui-interactive>
        <button
          type="button"
          className={`${styles.bottomRightQuickButton} ${showMartialPanel ? styles.bottomRightQuickButtonActive : ''} ${!canOpenMartialPanel ? styles.bottomRightQuickButtonBlocked : ''}`}
          aria-label="打开武学界面"
          aria-disabled={!canOpenMartialPanel}
          title="武学界面"
          onClick={toggleMartialPanel}
        >
          <Swords size={18} strokeWidth={2.35} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.bottomRightQuickButton} ${showHeartDetailsPanel ? styles.bottomRightQuickButtonActive : ''}`}
          aria-label="打开人物属性"
          title="人物属性"
          onClick={() => setShowHeartDetailsPanel((visible) => !visible)}
        >
          <UserRound size={18} strokeWidth={2.35} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.bottomRightQuickButton} ${showTestingPanel ? styles.bottomRightQuickButtonActive : ''}`}
          aria-label="打开ESC面板"
          title="ESC面板"
          onClick={toggleEscPanel}
        >
          <Settings size={18} strokeWidth={2.35} aria-hidden="true" />
        </button>
      </div>

      {/* ===== CONTROL PANEL: combat helpers + dummy spawn (bottom-right, left of cheat) ===== */}
      {canAccessTestingPanels && (
        <>
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
            {isYumenMode && (
              <label style={{
                minHeight: 29,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 4,
                border: '1px solid rgba(120, 195, 255, 0.42)',
                background: 'rgba(45, 70, 95, 0.22)',
                color: '#c8e7ff',
                fontSize: 11,
                fontWeight: 700,
                padding: '5px 7px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={safeZone?.autoFullHeal === true}
                  disabled={!!runningCheatAction}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void runCheatAction(
                      'yumen-auto-full-heal',
                      '/api/game/cheat/yumen/auto-full-heal',
                      enabled ? '自动满血已开启' : '自动满血已关闭',
                      { enabled },
                    );
                  }}
                  style={{ margin: 0, width: 13, height: 13, flexShrink: 0 }}
                />
                <span>自动满血</span>
              </label>
            )}
            {isYumenMode && (
              <label style={{
                minHeight: 29,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 4,
                border: '1px solid rgba(180, 165, 255, 0.42)',
                background: 'rgba(65, 58, 105, 0.22)',
                color: '#ded8ff',
                fontSize: 11,
                fontWeight: 700,
                padding: '5px 7px',
                cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                opacity: runningCheatAction ? 0.55 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={safeZone?.testShortCooldown === true}
                  disabled={!!runningCheatAction}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void runCheatAction(
                      'yumen-test-short-cooldown',
                      '/api/game/cheat/yumen/test-short-cooldown',
                      enabled ? '测试缩短CD已开启' : '测试缩短CD已关闭',
                      { enabled },
                    );
                  }}
                  style={{ margin: 0, width: 13, height: 13, flexShrink: 0 }}
                />
                <span>测试缩短cd</span>
              </label>
            )}
          </div>

          {isYumenMode && (
            <>
              <div style={{ fontSize: 11, color: '#9ed5ff', fontWeight: 700, marginTop: 4 }}>玉门关</div>
              <button
                type="button"
                disabled={!!runningCheatAction}
                onClick={() => void runCheatAction('yumen-revive-all', '/api/game/cheat/yumen/revive-all', '全部玩家已复活')}
                style={{
                  background: 'rgba(40, 160, 80, 0.22)', color: '#c8ffd8',
                  border: '1px solid rgba(95, 225, 135, 0.62)', borderRadius: 4,
                  fontSize: 11, padding: '6px 8px',
                  cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                  opacity: runningCheatAction ? 0.55 : 1,
                }}
              >复活全部玩家</button>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={() => void runCheatAction('yumen-random-spawn-points', '/api/game/cheat/yumen/random-spawn-points', '已随机分配出生点')}
                  style={{
                    background: 'rgba(70, 145, 210, 0.22)', color: '#c8e7ff',
                    border: '1px solid rgba(115, 185, 255, 0.62)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >随机出生点</button>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={() => void runCheatAction('yumen-gather-middle', '/api/game/cheat/yumen/gather-middle', '已集合到中间')}
                  style={{
                    background: 'rgba(60, 155, 120, 0.22)', color: '#bff5da',
                    border: '1px solid rgba(105, 220, 165, 0.62)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >集合到中间</button>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={() => void runCheatAction('yumen-drop-to-ground', '/api/game/cheat/yumen/drop-to-ground', '已执行虚空救援')}
                  style={{
                    background: 'rgba(95, 85, 45, 0.28)', color: '#f7e0a0',
                    border: '1px solid rgba(230, 195, 100, 0.62)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >虚空救援</button>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={() => void runCheatAction('yumen-drop-to-top-hit', '/api/game/cheat/yumen/drop-to-top-hit', 'Z轴已落到顶部命中点')}
                  style={{
                    background: 'rgba(55, 115, 160, 0.28)', color: '#c8e7ff',
                    border: '1px solid rgba(105, 190, 245, 0.64)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >Z救援</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 }}>
                <button
                  type="button"
                  disabled={!!runningCheatAction || yumenAlivePlayerCount > 1}
                  onClick={() => void runCheatAction('yumen-end-game', '/api/game/cheat/yumen/end-game', '战场已结算')}
                  style={{
                    background: yumenAlivePlayerCount <= 1 ? 'rgba(210, 80, 70, 0.24)' : 'rgba(70, 80, 92, 0.20)',
                    color: yumenAlivePlayerCount <= 1 ? '#ffc4bd' : '#aeb9c3',
                    border: yumenAlivePlayerCount <= 1 ? '1px solid rgba(255, 130, 120, 0.62)' : '1px solid rgba(150, 165, 178, 0.42)',
                    borderRadius: 4,
                    fontSize: 11,
                    padding: '6px 8px',
                    cursor: runningCheatAction || yumenAlivePlayerCount > 1 ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >结束战场</button>
                <label style={{
                  minHeight: 29,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 4,
                  border: '1px solid rgba(255, 176, 104, 0.48)',
                  background: 'rgba(92, 54, 28, 0.28)',
                  color: '#ffd7b8',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '5px 7px',
                  cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                  opacity: runningCheatAction ? 0.55 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={safeZone?.autoSettle === true}
                    disabled={!!runningCheatAction}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void (async () => {
                        await runCheatAction(
                          'yumen-auto-settle',
                          '/api/game/cheat/yumen/auto-settle',
                          enabled ? '自动结算已开启' : '自动结算已关闭',
                          { enabled },
                        );
                      })();
                    }}
                    style={{ margin: 0, width: 13, height: 13, flexShrink: 0 }}
                  />
                  <span>自动结算</span>
                </label>
              </div>
              <button
                type="button"
                disabled={!!runningCheatAction}
                onClick={() => void (async () => {
                  const ok = await runCheatAction('yumen-restart-game', '/api/game/cheat/yumen/restart-game', '游戏已重新开始');
                  if (ok) yumenAutoFullShrinkStartedRef.current = null;
                })()}
                style={{
                  width: '100%',
                  background: 'rgba(70, 145, 210, 0.22)',
                  color: '#c8e7ff',
                  border: '1px solid rgba(115, 185, 255, 0.62)',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '6px 8px',
                  cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                  opacity: runningCheatAction ? 0.55 : 1,
                }}
              >重新开始游戏</button>
              <div style={{ fontSize: 11, color: '#9ed5ff', fontWeight: 700, marginTop: 4 }}>毒圈</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={() => void runCheatAction('yumen-start-shrink', '/api/game/cheat/yumen/start-shrink', '快速缩圈已开始', { damageMode: yumenDamageMode })}
                  style={{
                    background: 'rgba(210, 80, 70, 0.22)', color: '#ffc4bd',
                    border: '1px solid rgba(255, 130, 120, 0.62)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >开始快速缩圈</button>
                <select
                  value={yumenDamageMode}
                  disabled={!!runningCheatAction}
                  onChange={(event) => {
                    const nextMode = event.target.value === 'full' ? 'full' : 'test';
                    setYumenDamageMode(nextMode);
                    void runCheatAction('yumen-damage-mode', '/api/game/cheat/yumen/damage-mode', nextMode === 'full' ? '毒圈伤害已切换为完整' : '毒圈伤害已切换为测试', { damageMode: nextMode });
                  }}
                  style={{
                    minHeight: 29,
                    borderRadius: 4,
                    border: '1px solid rgba(255, 210, 120, 0.58)',
                    background: 'rgba(35, 28, 18, 0.94)',
                    color: '#ffe0a0',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '5px 7px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                  title="快速缩圈伤害模式"
                >
                  <option value="full">完整</option>
                  <option value="test">测试</option>
                </select>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={() => void runCheatAction('yumen-start-full-shrink', '/api/game/cheat/yumen/start-full-shrink', '完整缩圈已开始')}
                  style={{
                    background: 'rgba(60, 155, 120, 0.22)', color: '#bff5da',
                    border: '1px solid rgba(105, 220, 165, 0.62)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >开始完整缩圈</button>
                <label style={{
                  minHeight: 29,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 4,
                  border: '1px solid rgba(120, 195, 255, 0.42)',
                  background: 'rgba(45, 70, 95, 0.22)',
                  color: '#c8e7ff',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '5px 7px',
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={yumenAutoFullShrink}
                    onChange={(event) => setYumenAutoFullShrink(event.target.checked)}
                    style={{ margin: 0, width: 13, height: 13, flexShrink: 0 }}
                  />
                  <span>游戏开始时自动开始</span>
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
                  <button
                    type="button"
                    disabled={!!runningCheatAction}
                    onClick={() => void runCheatAction('yumen-pause-shrink', '/api/game/cheat/yumen/pause-shrink', '缩圈已暂停')}
                    style={{
                      background: 'rgba(95, 85, 45, 0.28)', color: '#f7e0a0',
                      border: '1px solid rgba(230, 195, 100, 0.62)', borderRadius: 4,
                      fontSize: 11, padding: '6px 8px',
                      cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                      opacity: runningCheatAction ? 0.55 : 1,
                    }}
                  >暂停</button>
                  <button
                    type="button"
                    disabled={!!runningCheatAction}
                    onClick={() => void runCheatAction('yumen-resume-shrink', '/api/game/cheat/yumen/resume-shrink', '缩圈已继续')}
                    style={{
                      background: 'rgba(70, 145, 210, 0.22)', color: '#c8e7ff',
                      border: '1px solid rgba(115, 185, 255, 0.62)', borderRadius: 4,
                      fontSize: 11, padding: '6px 8px',
                      cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                      opacity: runningCheatAction ? 0.55 : 1,
                    }}
                  >继续</button>
                  <button
                    type="button"
                    disabled={!!runningCheatAction}
                    onClick={() => void runCheatAction('yumen-reset-shrink', '/api/game/cheat/yumen/reset-shrink', '缩圈已重置')}
                    style={{
                      background: 'rgba(110, 125, 150, 0.24)', color: '#d9e4f2',
                      border: '1px solid rgba(175, 195, 220, 0.58)', borderRadius: 4,
                      fontSize: 11, padding: '6px 8px',
                      cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                      opacity: runningCheatAction ? 0.55 : 1,
                    }}
                  >重置</button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#9ed5ff', fontWeight: 700, marginTop: 4 }}>边界</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !yumenBoundaryEditMode;
                    setYumenBoundaryEditMode(next);
                    if (next) {
                      mouseStateRef.current.isLeft = false;
                      mouseStateRef.current.isRight = false;
                      mouseStateRef.current.dragDistance = 0;
                      manualCameraLookActiveRef.current = false;
                    }
                  }}
                  style={{
                    background: yumenBoundaryEditMode ? 'rgba(245, 210, 80, 0.38)' : 'rgba(245, 210, 80, 0.16)',
                    color: '#fff0a8',
                    border: '1px solid rgba(255, 225, 120, 0.66)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px', cursor: 'pointer',
                  }}
                >{yumenBoundaryEditMode ? '退出边界编辑' : '边界编辑'}</button>
                <button
                  type="button"
                  disabled={!!runningCheatAction}
                  onClick={restoreYumenPlayAreaDefault}
                  style={{
                    background: 'rgba(70, 145, 210, 0.20)', color: '#c8e7ff',
                    border: '1px solid rgba(115, 185, 255, 0.62)', borderRadius: 4,
                    fontSize: 11, padding: '6px 8px',
                    cursor: runningCheatAction ? 'not-allowed' : 'pointer',
                    opacity: runningCheatAction ? 0.55 : 1,
                  }}
                >恢复默认边界</button>
              </div>
            </>
          )}

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
        </>
      )}

      {/* ===== CHEAT: Ability picker (bottom-right, toggleable) ===== */}
      {showCheatAbilityPanelEntry && (
        <>
      <button
        style={{
          position: 'absolute', bottom: 80, right: 8, zIndex: 760,
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
          position: 'absolute', top: 96, bottom: 118, right: 8, zIndex: 760,
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
                position: 'absolute', top: '100%', left: 0, zIndex: 780,
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
        </>
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

      {draftDragGhost && (
        <div
          className={`${styles.abilityDragGhost} ${draftDragGhost.large ? styles.abilityDragGhostLarge : ''}`}
          style={{
            left: draftDragGhost.x,
            top: draftDragGhost.y,
            '--ability-panel-scale': getAbilityPanelCssScale(abilityPanelScale),
          } as React.CSSProperties}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getArenaAbilityIconPath(draftDragGhost.ability.name, draftDragGhost.ability.iconPath)} alt="" className={styles.abilityDragGhostIcon} draggable={false} />
        </div>
      )}

      {renderMartialPresetModal()}

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
      {safeZone && (safeZone.nextChangeIn > 0 || safeZone.phase === 'complete' || safeZone.fullPoison) && (() => {
        const isShrinking = safeZone.shrinking || safeZone.phase === 'shrinking';
        const isComplete = safeZone.phase === 'complete' || safeZone.fullPoison || Number(safeZone.currentHalf ?? 0) <= 0;
        const seconds = Math.max(0, Math.ceil(Number(safeZone.nextChangeIn ?? 0)));
        const phaseStartedAt = Number(safeZone.phaseStartedAt ?? 0);
        const phaseEndsAt = Number(safeZone.phaseEndsAt ?? 0);
        const phaseDuration = Math.max(1, phaseEndsAt - phaseStartedAt);
        const phaseRemainingMs = Math.max(0, Number(safeZone.nextChangeIn ?? 0) * 1000);
        const barPercent = isComplete ? 100 : Math.min(100, Math.max(0, ((phaseDuration - phaseRemainingMs) / phaseDuration) * 100));
        const timerLabel = isComplete ? '已全毒' : isShrinking ? '风暴缩圈中' : safeZone.phase === 'waiting' ? '风暴等待中' : '风暴倒计时';
        const phaseLabel = isComplete ? '全毒' : isShrinking ? '缩圈中' : safeZone.phase === 'countdown' ? '倒计时' : '等待中';
        const phaseColor = isComplete
          ? 'rgba(218, 70, 54, 0.82)'
          : isShrinking
            ? 'linear-gradient(90deg, rgba(228,81,48,0.95), rgba(247,128,67,0.95))'
            : safeZone.phase === 'countdown'
              ? 'linear-gradient(90deg, rgba(230,186,45,0.95), rgba(255,222,92,0.95))'
              : 'linear-gradient(90deg, rgba(61,177,205,0.92), rgba(145,224,235,0.92))';
        return (
          <div style={{
            position: 'absolute',
            right: 32,
            top: 374,
            width: 214,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            pointerEvents: 'none',
            zIndex: 500,
            fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
          }}>
            <div style={{
              height: 18,
              position: 'relative',
              borderRadius: 3,
              overflow: 'hidden',
              background: 'rgba(20, 34, 40, 0.86)',
              border: '1px solid rgba(115, 210, 231, 0.34)',
              boxShadow: '0 3px 10px rgba(0,0,0,0.42)',
            }}>
              <div style={{
                width: `${barPercent}%`,
                height: '100%',
                background: phaseColor,
              }} />
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#eaffff',
                fontSize: 11,
                fontWeight: 800,
                textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                letterSpacing: 0,
              }}>{phaseLabel}</div>
            </div>
            <div style={{
              alignSelf: 'center',
              minWidth: 142,
              padding: '2px 10px',
              borderRadius: 3,
              background: 'transparent',
              border: 'none',
              color: '#e8fbff',
              fontSize: 13,
              fontWeight: 800,
              textAlign: 'center',
              textShadow: '0 1px 2px rgba(0,0,0,0.85)',
              whiteSpace: 'nowrap',
            }}>
              {isComplete ? '已全毒' : `${timerLabel}: ${seconds}`}
            </div>
          </div>
        );
      })()}

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
