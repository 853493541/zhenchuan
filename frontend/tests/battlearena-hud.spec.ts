import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');

const battleArenaTsxPath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/BattleArena.tsx');
const battleArenaCssPath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/BattleArena.module.css');
const arenaScenePath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx');
const characterScenePath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/scene/Character.tsx');
const exportedMapScenePath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/scene/ExportedMapScene.tsx');
const frontendTypesPath = path.join(frontendRoot, 'app/game/screens/in-game/types.ts');
const statusCssPath = path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/styles.module.css');
const statusHintCssPath = path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/Hint/styles.module.css');
const inGameClientPath = path.join(frontendRoot, 'app/game/screens/in-game/InGameClient.tsx');
const inGameCssPath = path.join(frontendRoot, 'app/game/screens/in-game/styles.module.css');
const layoutShellCssPath = path.join(frontendRoot, 'app/components/layout/LayoutShell/styles.module.css');
const useGameStatePath = path.join(frontendRoot, 'app/game/screens/in-game/hooks/useGameState.ts');
const abilitiesPath = path.join(repoRoot, 'backend/game/abilities/abilities.ts');
const movementPath = path.join(repoRoot, 'backend/game/engine/loop/movement.ts');
const gameLoopPath = path.join(repoRoot, 'backend/game/engine/loop/GameLoop.ts');
const combatStatusPath = path.join(repoRoot, 'backend/game/engine/utils/combatStatus.ts');
const disguiseUtilsPath = path.join(repoRoot, 'backend/game/engine/utils/disguise.ts');
const yueYingShaUtilsPath = path.join(repoRoot, 'backend/game/engine/utils/yueYingSha.ts');
const backendStateTypesPath = path.join(repoRoot, 'backend/game/engine/state/types/state.ts');
const backendEventTypesPath = path.join(repoRoot, 'backend/game/engine/state/types/events.ts');
const backendEffectTypesPath = path.join(repoRoot, 'backend/game/engine/state/types/effects.ts');
const backendEffectCategoriesPath = path.join(repoRoot, 'backend/game/engine/effects/definitions/categories.ts');
const breakOnPlayPath = path.join(repoRoot, 'backend/game/engine/flow/play/breakOnPlay.ts');
const immediateEffectsPath = path.join(repoRoot, 'backend/game/engine/flow/play/immediateEffects.ts');
const buffRuntimePath = path.join(repoRoot, 'backend/game/engine/effects/buffRuntime.ts');
const onDamageHooksPath = path.join(repoRoot, 'backend/game/engine/effects/onDamageHooks.ts');
const abilityPreloadPath = path.join(repoRoot, 'backend/game/abilities/abilityPreload.ts');
const battleServicePath = path.join(repoRoot, 'backend/game/services/battle/battleService.ts');
const playServicePath = path.join(repoRoot, 'backend/game/services/gameplay/playService.ts');
const consumableServicePath = path.join(repoRoot, 'backend/game/services/gameplay/consumableService.ts');
const gameplayRoutesPath = path.join(repoRoot, 'backend/game/routes/gameplay.routes.ts');
const draftRoutesPath = path.join(repoRoot, 'backend/game/routes/draft.routes.ts');
const tournamentPath = path.join(repoRoot, 'backend/game/engine/state/types/tournament.ts');
const abilityTypesPath = path.join(repoRoot, 'backend/game/engine/state/types/abilities.ts');
const subscriptionManagerPath = path.join(repoRoot, 'backend/websocket/GameSubscriptionManager.ts');
const statusBarIndexPath = path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/index.tsx');

function readFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

function cssBlock(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  expect(match, `${selector} block should exist`).not.toBeNull();
  return match?.[1] ?? '';
}

function sourceFunction(source: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`function ${escaped}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  expect(match, `${name} should exist`).not.toBeNull();
  return match?.[1] ?? '';
}

test('BattleArena buff lock predicates ignore expired player buffs', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);

  expect(sourceFunction(battleArenaTsx, 'isActiveBuffClient')).toContain('expiresAt > now');
  expect(sourceFunction(battleArenaTsx, 'activeBuffsClient')).toContain('isActiveBuffClient(buff, now)');
  expect(sourceFunction(battleArenaTsx, 'hasQinggongSealClient')).toContain('activeBuffsClient(buffs).some');
  expect(sourceFunction(battleArenaTsx, 'hasDisplacementClient')).toContain('activeBuffsClient(buffs).some');
  expect(sourceFunction(battleArenaTsx, 'buffsHaveAnyEffect')).toContain('activeBuffsClient(buffs).some');
});

test('BattleArena post-dash jump prediction does not inherit dash carry', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);

  expect(battleArenaTsx).toMatch(/const justJumpedRender = frameNow - lastJumpInputAtRef\.current < 320;[\s\S]*const recentDashSnap =\s*!justJumpedRender/);
  expect(battleArenaTsx).toMatch(/const justJumpedLocally = performance\.now\(\) - lastJumpInputAtRef\.current < 260;[\s\S]*const recentDashSnap =\s*!justJumpedLocally/);
  expect(battleArenaTsx).toMatch(/if \(meActiveDashRef\.current\) \{[\s\S]*airborneSpeedCarryRef\.current = 0;[\s\S]*airNudgeRemainingRef\.current = 0;/);
  expect(battleArenaTsx).toMatch(/const ad = \(me as any\)\?\.activeDash;[\s\S]*const isDashing = !!ad && ad\.ticksRemaining > 0;[\s\S]*if \(!isDashing\) \{[\s\S]*airborneSpeedCarryRef\.current = 0;/);
});

test('BattleArena jump correction ignores normal delayed server samples', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);

  expect(battleArenaTsx).toContain('JUMP_CORRECTION_SERVER_LAG_TICKS');
  expect(battleArenaTsx).toContain('JUMP_CORRECTION_PENDING_PHASE_MS');
  expect(battleArenaTsx).toContain('JUMP_CORRECTION_LANDING_GRACE_Z');
  expect(battleArenaTsx).toContain('getTravelSpeedPerTick(airNudgeRemainingRef.current, airNudgeTicksRemainingRef.current)');
  expect(battleArenaTsx).toContain('const airborneLocalForCorrection = localJumpCountRef.current > 0;');
  expect(battleArenaTsx).toMatch(/localJumpCount > serverJumpCount[\s\S]*waitingForServerJumpPhase[\s\S]*waitingForLocalLanding[\s\S]*xyError <= jumpLagXyTolerance[\s\S]*absZError <= jumpLagZTolerance[\s\S]*return;/);
  expect(battleArenaTsx).toContain("console.warn('[JUMP-CORRECTION] server corrected local jump prediction'");
  expect(battleArenaTsx).toContain('serverJumpCount');
  expect(battleArenaTsx).toContain('serverVz: Number((Number.isFinite(serverVz) ? serverVz : 0).toFixed(3))');
});

test('BattleArena local physics catches up delayed browser ticks', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);

  expect(battleArenaTsx).toContain('const MAX_CLIENT_PHYSICS_CATCHUP_TICKS = 30;');
  expect(battleArenaTsx).toContain('advanceLocalPhysicsRef.current();');
  expect(battleArenaTsx).toContain('advanceLocalPhysicsRef.current = runPhysics;');
  expect(battleArenaTsx).toMatch(/physicsAccumulatorMs \+= elapsedMs[\s\S]*while \(physicsAccumulatorMs >= CLIENT_TICK_MS[\s\S]*tick\(simulatedPhysicsAtMs\)/);
  expect(battleArenaTsx).toContain('const id = setInterval(runPhysics, CLIENT_TICK_MS);');
});

test('BattleArena test tab can switch status bars to hidden buffs only', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);
  const statusBarIndex = readFile(statusBarIndexPath);

  expect(battleArenaTsx).toContain("const [showHiddenBuffStatusBar, setShowHiddenBuffStatusBar] = useState(false)");
  expect(battleArenaTsx).toContain('显示隐藏buff');
  expect(battleArenaTsx).toContain("visibilityMode={showHiddenBuffStatusBar ? 'hidden-only' : 'visible'}");
  expect(statusBarIndex).toContain('visibilityMode?: "visible" | "hidden-only"');
  expect(statusBarIndex).toMatch(/if \(visibilityMode === "visible" && hiddenInStatusBar\) return null;/);
  expect(statusBarIndex).toMatch(/if \(visibilityMode === "hidden-only" && !hiddenInStatusBar\) return null;/);
});

test('BattleArena hotkey settings preserve existing defaults and support two bindings', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);

  expect(battleArenaTsx).toContain("const HOTKEY_MAX_BINDINGS_PER_ACTION = 2");
  expect(battleArenaTsx).toContain("{ id: 'ability', label: '技能栏' }");
  expect(battleArenaTsx).toContain("{ id: 'common', label: '通用栏' }");
  expect(battleArenaTsx).toContain("{ id: 'consumable', label: '物品栏' }");
  expect(battleArenaTsx).toContain("'draft:0': ['1']");
  expect(battleArenaTsx).toContain("'draft:5': ['XB1']");
  expect(battleArenaTsx).toContain("'common:2': ['A+W']");
  expect(battleArenaTsx).toContain("'common:5': ['A+S']");
  expect(sourceFunction(battleArenaTsx, 'normalizeWheelHotkey')).toContain("deltaY < 0 ? 'WU' : 'WD'");
  expect(battleArenaTsx).toMatch(/next\[actionId\] = \[\.\.\.\(current\[actionId\] \?\? \[\]\)\]\.filter\(\(existing\) => existing !== binding\.id\)/);
});

test('source guards cover BattleArena HUD regression points', async () => {
  const battleArenaTsx = readFile(battleArenaTsxPath);
  const battleArenaCss = readFile(battleArenaCssPath);
  const arenaScene = readFile(arenaScenePath);
  const characterScene = readFile(characterScenePath);
  const exportedMapScene = readFile(exportedMapScenePath);
  const frontendTypes = readFile(frontendTypesPath);
  const statusCss = readFile(statusCssPath);
  const statusHintCss = readFile(statusHintCssPath);
  const statusBarIndex = readFile(statusBarIndexPath);
  const inGameClient = readFile(inGameClientPath);
  const inGameCss = readFile(inGameCssPath);
  const layoutShellCss = readFile(layoutShellCssPath);
  const useGameState = readFile(useGameStatePath);
  const abilities = readFile(abilitiesPath);
  const movement = readFile(movementPath);
  const gameLoop = readFile(gameLoopPath);
  const combatStatus = readFile(combatStatusPath);
  const disguiseUtils = readFile(disguiseUtilsPath);
  const yueYingShaUtils = readFile(yueYingShaUtilsPath);
  const backendStateTypes = readFile(backendStateTypesPath);
  const backendEventTypes = readFile(backendEventTypesPath);
  const backendEffectTypes = readFile(backendEffectTypesPath);
  const backendEffectCategories = readFile(backendEffectCategoriesPath);
  const breakOnPlay = readFile(breakOnPlayPath);
  const immediateEffects = readFile(immediateEffectsPath);
  const buffRuntime = readFile(buffRuntimePath);
  const onDamageHooks = readFile(onDamageHooksPath);
  const abilityPreload = readFile(abilityPreloadPath);
  const battleService = readFile(battleServicePath);
  const playService = readFile(playServicePath);
  const consumableService = readFile(consumableServicePath);
  const gameplayRoutes = readFile(gameplayRoutesPath);
  const draftRoutes = readFile(draftRoutesPath);
  const tournament = readFile(tournamentPath);
  const abilityTypes = readFile(abilityTypesPath);
  const subscriptionManager = readFile(subscriptionManagerPath);

  expect(battleArenaTsx).not.toContain('全部技能（按稀有度）');
  expect(tournament).toContain('STARTING_BATTLE_HP = 1_200_000');
  expect(tournament).toContain('STARTING_CRIT_CHANCE_PCT = 46');
  expect(battleArenaTsx).toMatch(/id: 'green'[\s\S]*critChancePct: 30/);
  expect(battleArenaTsx).toMatch(/id: 'blue'[\s\S]*critChancePct: 36/);
  expect(battleArenaTsx).toMatch(/id: 'purple'[\s\S]*critChancePct: 46/);
  expect(battleArenaTsx).toMatch(/id: 'purple'[\s\S]*maxHp: 1200000/);

  expect(abilities).toMatch(/id: "guchong_xianji"[\s\S]*type: "SHIELD", value: 50, percentOfTargetMaxHp: true/);
  expect(abilities).toContain('50%最大气血护盾');
  expect(abilities).not.toContain('提供50点护盾');
  expect(abilities).toMatch(/id: "fuyao_zhishang"[\s\S]*cannotCastWhileRooted: true/);
  expect(abilities).toMatch(/id: "yuqi"[\s\S]*cannotCastWhileRooted: true/);

  expect(movement).toContain('BACKPEDAL_DOUBLE_JUMP_DISTANCE = 3.7 * UNIT_SCALE');
  expect(movement).toContain('const jumpIntent = input.jumpIntent ?? input');
  expect(movement).toContain('isBackpedalAirJump = jumpIntent?.backpedalOnly === true');
  expect(gameLoop).toContain('const snapshotJumpIntent = (source: MovementInput)');
  expect(movement).toContain('if (!isBackpedalAirJump)');
  expect(battleArenaTsx).toContain('function getBackpedalDoubleJumpDistance');
  expect(battleArenaTsx).toContain('getBackpedalDoubleJumpDistance(mode)');

  expect(subscriptionManager).toContain('Date.now() + 5_000');
  expect(gameplayRoutes).toContain('endsAt: Date.now() + 5_000');
  expect(subscriptionManager).not.toContain('Date.now() + 30_000');
  expect(useGameState).toContain('const promptEndsAt = Date.now() + 5_000');
  expect(useGameState).toContain('Math.min(message.endsAt ?? promptEndsAt, promptEndsAt)');
  expect(inGameClient).toContain('useState(5)');
  expect(inGameClient).toContain('setDisconnectCountdown(5)');
  expect(inGameClient).toContain('reason: "left" as const');
  expect(inGameClient).toContain('Player left');
  expect(inGameClient).toContain('LeaveNoticePrompt');

  expect(inGameClient).toContain('import { Home } from "lucide-react"');
  expect(inGameClient).toContain('function getGameErrorText(rawCode: string)');
  expect(inGameClient).toContain('return "无法在受控下施展"');
  expect(inGameClient).toContain('externalGameWarning={battleWarningEvent}');
  expect(inGameClient).toContain('aria-label="首页"');
  expect(inGameClient).toContain('<Home size={27}');
  expect(inGameClient).not.toContain('>\n          首页\n        </button>');
  expect(inGameCss).toContain('width: 51px');
  expect(inGameCss).toContain('top: calc(env(safe-area-inset-top, 0px) + 38px)');
  expect(battleArenaTsx).not.toContain('MODE INDICATOR');
  expect(battleArenaTsx).not.toContain('玉门关');
  expect(battleArenaTsx).toContain('className={styles.topMetricsBar}');
  expect(battleArenaTsx).toContain('topMetricsSettingsButton');
  expect(battleArenaTsx).toContain('formatTopMetricsTime(systemTime)');
  expect(battleArenaTsx).toContain("const IN_GAME_WARNING_UI_KEY = 'in-game-warning'");
  expect(battleArenaTsx).toContain('战斗警告大小');
  expect(battleArenaTsx).toContain('showInGameWarning');
  expect(battleArenaTsx).toContain('setRenderFps(Math.round((frameCount * 1000) / elapsed))');
  expect(battleArenaTsx).toContain('网络延迟:');
  expect(battleArenaTsx).not.toContain('className={styles.rttBadge}');
  expect(battleArenaCss).not.toContain('.rttBadge');
  expect(cssBlock(battleArenaCss, '.ingameWarningPlacement')).toContain('position: absolute');
  expect(cssBlock(battleArenaCss, '.ingameWarningPlacementLabel')).toContain('position: static');
  expect(cssBlock(battleArenaCss, '.ingameWarningText')).toContain('background: transparent');
  expect(cssBlock(battleArenaCss, '.ingameWarningText')).toContain('color: #ff2a1f');
  expect(cssBlock(battleArenaCss, '.ingameWarningText')).toContain('font-size: calc(14.7px * var(--game-warning-scale, 1));');
  expect(battleArenaTsx).toContain('Math.max(0.1, Math.min(2, numeric))');
  expect(battleArenaTsx).toContain('min="0.1"');
  expect(cssBlock(battleArenaCss, '.topMetricsBar')).toContain('height: 18.85px');
  expect(cssBlock(battleArenaCss, '.topMetricsBar')).toContain('font-size: 14.3px');
  expect(cssBlock(battleArenaCss, '.topMetricsBar')).toContain('gap: 19.5px');
  expect(cssBlock(battleArenaCss, '.topMetricsSettingsButton')).toContain('min-width: 73px');
  expect(cssBlock(battleArenaCss, '.critPresetBar')).toContain('top: 56%');
  expect(battleArenaTsx).toContain("const [escPanelPage, setEscPanelPage]");
  expect(battleArenaTsx).toContain("const [escMainTab, setEscMainTab]");
  expect(battleArenaTsx).toContain("const [escTestPage, setEscTestPage]");
  expect(battleArenaTsx).toContain('系统设置');
  expect(battleArenaTsx).toContain('setEscPanelPage(\'game-settings\')');
  expect(battleArenaTsx).toContain('游戏设置');
  expect(battleArenaTsx).toContain('自定义界面');
  expect(battleArenaTsx).toContain('openCustomUiMode();');
  expect(battleArenaTsx).toContain('startCustomUiPromptDrag');
  expect(battleArenaTsx).toContain('onLeaveGame?: () => Promise<void> | void');
  expect(inGameClient).toContain("onLeaveGame={() => leaveGameAndReturnHome('EscExitButton')}");
  expect(battleArenaTsx).toContain('void onLeaveGame?.();');
  expect(battleArenaTsx).not.toContain('返回角色');
  expect(battleArenaTsx).not.toContain('返回登录');
  expect(battleArenaTsx).not.toContain('LogOut');
  expect(battleArenaTsx).toContain('测试');
  expect(battleArenaTsx).toContain('开关');
  expect(battleArenaTsx).toContain('灯光控制');
  expect(battleArenaTsx).toContain('角色测试状态');
  expect(battleArenaTsx).toContain('镜头测试');
  expect(battleArenaTsx).toContain('屏幕坐标');
  expect(battleArenaTsx).toContain('显示碰撞线');
  expect(battleArenaTsx).toContain('显示蓝图');
  expect(battleArenaTsx).not.toContain('体积碰撞开关');
  expect(battleArenaTsx).not.toContain('showCollisionControlPanel');
  expect(battleArenaTsx).not.toContain('显示碰撞体');
  expect(battleArenaTsx).not.toContain('显示蓝本');
  expect(battleArenaTsx).toContain('距离测试窗口');
  expect(battleArenaTsx).toContain('跳跃细节和地面距离');
  expect(battleArenaTsx).not.toContain('showScreenCoordPanel');
  expect(battleArenaTsx).not.toContain('showEnvTestingPanel');
  expect(battleArenaTsx).toContain('技能栏大小');
  expect(battleArenaTsx).toContain('显示GCD');
  expect(battleArenaTsx).toContain('DEFAULT_GCD_VISIBILITY_SETTINGS');
  expect(battleArenaTsx).toContain('CATCAKE_DEFAULT_UI_VIEWPORT');
  expect(battleArenaTsx).toContain('CATCAKE_DEFAULT_UI_POSITIONS');
  expect(battleArenaTsx).toContain('applyCatcakeDefaultUiLayout');
  expect(combatStatus).toContain('COMBAT_STATUS_RANGE_UNITS = 60');
  expect(combatStatus).toContain('COMBAT_STATUS_TIMEOUT_MS = 3_000');
  expect(combatStatus).toContain('COMBAT_STATUS_CHECK_INTERVAL_MS = 3_000');
  expect(combatStatus).toContain('event.type === "DAMAGE"');
  expect(combatStatus).toContain('refreshTimerOnlyInRange: true');
  expect(combatStatus).toContain('event.buffCategory === "DEBUFF"');
  expect(combatStatus).not.toContain('requireRange: true');
  expect(combatStatus).toContain('hasActiveEnemyDebuffFrom');
  expect(combatStatus).toContain('hasActiveDebuffCombatLink');
  expect(combatStatus).toContain('buff?.sourceUserId !== sourceUserId');
  expect(combatStatus).toContain('links[combatantUserId] = { lastActionAt: timestamp }');
  expect(combatStatus).toContain('timestamp - COMBAT_STATUS_TIMEOUT_MS');
  expect(combatStatus).toContain('timestamp - lastActionAt >= COMBAT_STATUS_TIMEOUT_MS');
  expect(combatStatus).toContain('!arePlayersWithinCombatRange');
  expect(combatStatus).toContain('removeDisguiseBuffs(state, player, timestamp)');
  expect(buffRuntime).toContain('removeDisguiseBuffs(state, buffTarget as any, now)');
  expect(buffRuntime).toContain('const DISGUISE_STEALTH_OVERLAP_MS = 1_000');
  expect(buffRuntime).toContain('shortenDisguiseBuffsForStealthOverlap');
  expect(buffRuntime).toContain('activeBuff.expiresAt = overlapExpiresAt');
  expect(buffRuntime).toContain('!incomingDisguise && hasDisguiseBuff(buffTarget as any) && incomingStealthPackage');
  expect(buffRuntime).toContain('const MAX_DISGUISE_DURATION_MS = 4 * 60_000');
  expect(buffRuntime).toContain('durationMs: Math.min(runtimeBuff.durationMs, MAX_DISGUISE_DURATION_MS)');
  expect(disguiseUtils).toContain('SAND_DISGUISE_CONSUMABLE_ID = "sha_shi_wei_zhuang"');
  expect(disguiseUtils).toContain('SAND_DISGUISE_BUFF_ID = 980001');
  expect(disguiseUtils).toContain('SAND_DISGUISE_DURATION_MS = 4 * 60_000');
  expect(disguiseUtils).toContain('SAND_DISGUISE_LEASH_RADIUS_UNITS = 2');
  expect(disguiseUtils).toContain('createSandDisguiseRuntimeBuff');
  expect(disguiseUtils).toContain('{ type: "SPECIAL_ABILITY_BAR", abilityIds: ["jie_chu_wei_zhuang"] }');
  expect(disguiseUtils).toContain('type: "STEALTH"');
  expect(disguiseUtils).toContain('type: "ROOT"');
  expect(disguiseUtils).toContain('type: "DISGUISE"');
  expect(disguiseUtils).toContain('clearTargetSelectionsTargetingPlayer');
  expect(yueYingShaUtils).toContain('YUE_YING_SHA_BUFF_ID = 980002');
  expect(yueYingShaUtils).toContain('durationMs: 7_000');
  expect(yueYingShaUtils).toContain('breakOnPlay: true');
  expect(yueYingShaUtils).toContain('{ type: "SPEED_BOOST", value: 0.3 }');
  expect(yueYingShaUtils).toContain('{ type: "NO_JUMP" }');
  expect(backendStateTypes).toContain('inCombat?: boolean');
  expect(backendStateTypes).toContain('combatLinks?: Record<PlayerID, { lastActionAt: number }>');
  expect(backendStateTypes).toContain('consumableCooldowns?: Record<string, { expiresAt: number }>');
  expect(backendStateTypes).toContain('consumableCounts?: Record<string, number>;');
  expect(backendStateTypes).toContain('consumableId?: string');
  expect(backendEventTypes).toContain('| "COMBAT_STATUS"');
  expect(backendEventTypes).toContain('channelPhase?: "start" | "complete"');
  expect(backendEventTypes).toContain('combatStatus?: "enter" | "exit"');
  expect(backendEffectTypes).toContain('| "DISGUISE"');
  expect(backendEffectCategories).toContain('DISGUISE: "BUFF"');
  expect(abilityPreload).toContain('SAND_DISGUISE_BUFF');
  expect(abilityPreload).toContain('iconPath: (ability as any).iconPath');
  expect(abilityPreload).toContain('manualCancelable: true');
  expect(abilityPreload).toContain('...YUE_YING_SHA_BUFF,');
  expect(battleService).toContain('inCombat: false');
  expect(battleService).toContain('combatLinks: {}');
  expect(battleService).toContain('consumableCounts: createStartingConsumableCounts()');
  expect(gameLoop).toContain('expireCombatStatusLinks(this.state, combatCheckNow)');
  expect(gameLoop).toContain('syncCombatStatusFromEvents(this.state, eventDiffStart)');
  expect(gameLoop).toContain('createSandDisguiseRuntimeBuff(player.position)');
  expect(gameLoop).toContain('const leftDisguiseLeashArea = player.buffs.some');
  expect(gameLoop).toContain('removeDisguiseBuffs(this.state, player as any, now)');
  expect(gameLoop).toContain('naturallyExpired.some((b) => isDisguiseBuff(b as any))');
  expect(gameLoop).toContain('combatStatusChanged');
  expect(gameLoop).toContain('eventsPruned || combatStatusChanged');
  expect(gameLoop).toContain('pushPatchIfChanged(`/players/${pidx}/inCombat`, p.inCombat === true)');
  expect(gameLoop).toContain('pushPatchIfChanged(`/players/${pidx}/combatLinks`, (p as any).combatLinks ?? {})');
  expect(playService).toContain('syncCombatStatusFromEvents(state, prevState.events.length);');
  expect(playService).toContain('type: "PLAY_ABILITY"');
  expect(frontendTypes).toContain('| "COMBAT_STATUS"');
  expect(frontendTypes).toContain('channelPhase?: "start" | "complete"');
  expect(frontendTypes).toContain('inCombat?: boolean');
  expect(frontendTypes).toContain('consumableCooldowns?: Record<string, { expiresAt: number }>');
  expect(frontendTypes).toContain('consumableCounts?: Record<string, number>;');
  expect(frontendTypes).toContain('consumableId?: string');
  expect(statusBarIndex).toContain('remainingTurns={getRemainingSeconds(activeHint.buff)}');
  expect(readFile(path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/Hint/index.tsx'))).toContain('function formatRemainingTime(totalSeconds: number)');
  expect(readFile(path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/Hint/index.tsx'))).toContain('return `${minutes}分 ${seconds}秒`;');
  expect(battleArenaTsx).toContain("showInGameWarning('进入战斗')");
  expect(battleArenaTsx).toContain("showInGameWarning('离开战斗')");
  expect(battleArenaTsx).toContain('Swords size={20}');
  expect(battleArenaTsx).toContain('styles.combatStatusMarker');
  expect(battleArenaCss).not.toContain('.combatStatusMarker::after');
  expect(consumableService).toContain('jin_chuang_yao');
  expect(consumableService).toContain('name: "金疮药"');
  expect(consumableService).toContain('healBase: 48.3');
  expect(consumableService).toContain('cooldownMs: 120_000');
  expect(consumableService).toContain('usableInCombat: true');
  expect(consumableService).toContain('beng_dai');
  expect(consumableService).toContain('breaksDisguise: false');
  expect(consumableService).toContain('durationMs: 10_000');
  expect(consumableService).toContain('tickIntervalMs: 1_000');
  expect(consumableService).toContain('healBase: 1.93');
  expect(consumableService).toContain('usableInCombat: false');
  expect(consumableService).toContain('sha_shi_wei_zhuang');
  expect(consumableService).toContain('砂石伪装');
  expect(consumableService).toContain('durationMs: 2_000');
  expect(consumableService).toContain('forwardChannel: true');
  expect(consumableService).toContain('lockMovement: false');
  expect(consumableService).toContain('cancelOnMove: true');
  expect(consumableService).toContain('applyDisguiseOnComplete: true');
  expect(consumableService).toContain('yue_ying_sha');
  expect(consumableService).toMatch(/yue_ying_sha:[\s\S]*cooldownMs: 30_000[\s\S]*usableInCombat: true[\s\S]*implemented: true[\s\S]*requiresGrounded: true/);
  expect(consumableService).toContain('applyYueYingShaBuff(state, player)');
  expect(consumableService).toContain('STEALTH_BREAK_BUFF_IDS = new Set([1011, 1012, 1013, SAND_DISGUISE_BUFF_ID, YUE_YING_SHA_BUFF_ID])');
  expect(consumableService).toContain('"ROOT"');
  expect(consumableService).toContain('throw new Error("ERR_REQUIRES_GROUNDED")');
  expect(consumableService).toContain('guan_mu_wei_zhuang');
  expect(consumableService).toContain('wa_guan_wei_zhuang');
  expect(consumableService).toContain('sha_xing_xie');
  expect(consumableService).toContain('ma_cao');
  expect(consumableService).toContain('yi_jie_wu_qi_he');
  expect(consumableService).toContain('er_jie_wu_qi_he');
  expect(consumableService).toContain('san_jie_wu_qi_he');
  expect(consumableService).toContain('tian_jie_wu_qi_he');
  expect(consumableService).toContain('ERR_CONSUMABLE_NOT_IMPLEMENTED');
  expect(consumableService).toContain('STARTING_CONSUMABLE_COUNTS');
  expect(consumableService).toContain('beng_dai: 12');
  expect(consumableService).toContain('jin_chuang_yao: 2');
  expect(consumableService).toContain('yue_ying_sha: 1');
  expect(consumableService).toContain('sha_shi_wei_zhuang: 4');
  expect(consumableService).toContain('function getConsumableCounts(player: PlayerState)');
  expect(consumableService).toContain('throw new Error("ERR_CONSUMABLE_EMPTY")');
  expect(consumableService).toContain('consumableCounts[consumable.id] = Math.max(0, Number(consumableCounts[consumable.id] ?? 0) - 1);');
  expect(consumableService).toContain('BLOCKING_CONSUMABLE_EFFECTS');
  expect(consumableService).toContain('buff.effects.some((effect: any) => BLOCKING_CONSUMABLE_EFFECTS.has(effect?.type))');
  expect(consumableService).not.toContain('buff?.category === "DEBUFF"');
  expect(consumableService).not.toContain('"NON_QINGGONG_LOCK"');
  expect(arenaScene).not.toContain('if (hasDisguiseBuff(buffs)) return false;');
  expect(battleArenaTsx).not.toContain('if (hasDisguiseClient(buffs)) return false;');
  expect(characterScene).toContain('modelRef: MutableRefObject<THREE.Object3D | null>;');
  expect(characterScene).toContain('const disguiseRef = useRef<THREE.Object3D>(null);');
  expect(characterScene).toContain('disguiseRef.current.rotation.set(0, yaw, 0);');
  expect(characterScene).toContain('<DisguiseCartModel facingYaw={facingYaw} modelRef={disguiseRef} />');
  expect(characterScene).not.toContain('{(facing || facingRef) && isSelected && !isDisguised && (');
  expect(immediateEffects).toContain('removeDisguiseBuffs(state, source as any, Date.now())');
  expect(immediateEffects).toContain('removeIds.has(SAND_DISGUISE_BUFF_ID)');
  expect(abilities).toContain('jie_chu_wei_zhuang');
  expect(abilities).toContain('name: "解除伪装"');
  expect(abilities).toContain('iconPath: "/icons/砂石伪装.png"');
  expect(abilities).toContain('specialBarAbility: true');
  expect(abilities).toContain('hiddenFromDraft: true');
  expect(battleArenaTsx).toContain('encodeIconPublicPath(iconPath)');
  expect(battleArenaTsx).toContain('iconPath?: string;');
  expect(battleArenaTsx).toContain('iconPath: ability.iconPath');
  expect(consumableService).not.toContain('"ATTACK_LOCK"');
  expect(consumableService).toContain('breakReverseChannels(state, player)');
  expect(consumableService).toContain('breakStealthForConsumable(state, player, consumable)');
  expect(consumableService).toContain('if (consumable.channel?.forwardChannel === true) return false;');
  expect(consumableService).toContain('buff.buffId === SAND_DISGUISE_BUFF_ID && consumable.breaksDisguise === false');
  expect(abilityPreload).toContain('YUE_YING_SHA_BUFF');
  expect(breakOnPlay).toContain('case 1012:');
  expect(breakOnPlay).toContain('common abilities break immediately; 遁影 only protects movement');
  expect(breakOnPlay).toContain('return channelCast ? isForward : false;');
  expect(breakOnPlay).toContain('case YUE_YING_SHA_BUFF_ID:');
  expect(onDamageHooks).toContain('breakYueYingShaOnIncomingHit');
  expect(onDamageHooks).toContain('if (hpDamage <= 0 && shieldAbsorbed <= 0) return;');
  expect(onDamageHooks).toContain('result.hpDamage > 0 || result.shieldAbsorbed > 0');
  expect(combatStatus).toContain('event.type === "PLAY_ABILITY" && event.channelPhase === "start"');
  expect(playService).toContain('channelPhase: player.activeChannel.forwardChannel === true ? "start" : undefined');
  expect(buffRuntime).toContain('isConsumableChannel');
  expect(buffRuntime).toContain('!isConsumableChannel && (');
  expect(gameLoop).toContain('isConsumableChannel');
  expect(gameLoop).toContain('completedTickCount');
  expect(gameLoop).toContain('effectType: "PERIODIC_HEAL"');
  expect(gameLoop).toContain('SAND_DISGUISE_CONSUMABLE_ID');
  expect(gameLoop).toContain('hasCombatActivityAgainstPlayerDuringChannel');
  expect(gameLoop).toContain('player.inCombat !== true');
  expect(gameLoop).toContain('SAND_DISGUISE_BUFF');
  expect(gameLoop).toContain('isHostileForwardChannelResolution');
  expect(gameLoop).toContain('breakStealthOnForwardChannelResolution');
  expect(gameLoop).toContain('channelPhase: "complete"');
  expect(gameplayRoutes).toContain('router.post("/consumable/use"');
  expect(gameplayRoutes).toContain('blocksCardTargeting(targetPlayer as any)');
  expect(useGameState).toContain('fetch("/api/game/consumable/use"');
  expect(inGameClient).toContain('onUseConsumable={async (consumableId)');
  expect(inGameClient).toContain('ERR_CONSUMABLE_NOT_IMPLEMENTED');
  expect(inGameClient).toContain('return "该物品已用完"');
  expect(battleArenaTsx).toContain('CONSUMABLE_ITEMS');
  expect(battleArenaTsx).toContain("{ id: 'beng_dai', name: '绷带', implemented: true, startingCount: 12 }");
  expect(battleArenaTsx).toContain("{ id: 'guan_mu_wei_zhuang', name: '灌木伪装', implemented: false, startingCount: 0 }");
  expect(battleArenaTsx).toMatch(/name: '绷带'[\s\S]*name: '金疮药'[\s\S]*name: '月影沙'[\s\S]*name: '砂石伪装'[\s\S]*name: '灌木伪装'[\s\S]*name: '瓦罐伪装'[\s\S]*name: '沙行蝎'[\s\S]*name: '马草'[\s\S]*name: '一阶武器盒'[\s\S]*name: '二阶武器盒'[\s\S]*name: '三阶武器盒'[\s\S]*name: '天阶武器盒'/);
  expect(battleArenaTsx).toContain('CONSUMABLE_BAR_MIN_SLOTS = 12');
  expect(battleArenaTsx).toContain('CONSUMABLE_BAR_MAX_SLOTS = 16');
  expect(battleArenaTsx).toContain('CONSUMABLE_BAR_DEFAULT_SLOTS = 12');
  expect(battleArenaTsx).toContain('function formatHudCooldownText');
  expect(battleArenaTsx).toContain("if (seconds > 59) return `${Math.max(1, Math.ceil(seconds / 60))}m`;");
  expect(battleArenaTsx).toContain("const minuteCooldown = cdLabel.endsWith('m');");
  expect(battleArenaTsx).toContain('styles.cdNumMinutes');
  expect(battleArenaTsx).toContain('loadConsumableBarSettings');
  expect(battleArenaTsx).toContain('moveConsumableSlot');
  expect(battleArenaTsx).toContain('data-consumable-slot-index');
  expect(battleArenaTsx).toContain('application/x-zhenchuan-consumable-slot');
  expect(battleArenaTsx).toContain('function getConsumableRemainingCount');
  expect(battleArenaTsx).toContain('const unavailable = !!consumable && consumable.implemented !== true;');
  expect(battleArenaTsx).toContain('const remainingCount = consumable ? getConsumableRemainingCount(me, consumable) : 0;');
  expect(battleArenaTsx).toContain('const depleted = !!consumable && consumable.implemented === true && remainingCount <= 0;');
  expect(battleArenaTsx).toContain("`${consumable.name}（暂未开放）`");
  expect(battleArenaTsx).toContain("`${consumable.name}（剩余${remainingCount}）`");
  expect(battleArenaTsx).toContain("`${consumable.name}（已用完）`");
  expect(battleArenaTsx).toContain('styles.consumableSlotUnavailable');
  expect(battleArenaTsx).toContain('styles.consumableSlotDepleted');
  expect(battleArenaTsx).toContain('styles.consumableCount');
  expect(battleArenaTsx).toContain('getConsumableIconPath(consumable.name)');
  expect(battleArenaCss).toContain('.consumableSlotUnavailable');
  expect(battleArenaCss).toContain('.consumableSlotDepleted');
  expect(battleArenaCss).toContain('.consumableCount');
  expect(cssBlock(battleArenaCss, '.consumableCount')).toContain('right: 1px');
  expect(cssBlock(battleArenaCss, '.consumableCount')).toContain('bottom: 1px');
  expect(cssBlock(battleArenaCss, '.consumableCount')).toContain('font-weight: 600');
  expect(cssBlock(battleArenaCss, '.consumableCount')).toContain('background: transparent');
  expect(battleArenaCss).toContain('filter: grayscale(1) saturate(0.12) brightness(0.72);');
  expect(battleArenaTsx).toContain("runCheatAction('refill-consumables', '/api/game/cheat/refill-consumables', '双方消耗品已补满')");
  expect(draftRoutes).toContain('router.post("/cheat/refill-consumables"');
  expect(draftRoutes).toContain('const consumableCounts = createStartingConsumableCounts();');
  expect(battleArenaTsx).toContain("const noJumpLocked = !lingRanJumpLockImmune && buffsHaveAnyEffect(buffs, ['NO_JUMP']);");
  expect(battleArenaTsx).not.toContain("useConsumableRef.current('jin_chuang_yao')");
  expect(battleArenaTsx).not.toContain("useConsumableRef.current('beng_dai')");
  expect(battleArenaTsx).not.toContain("useConsumableRef.current('sha_shi_wei_zhuang')");
  expect(battleArenaTsx).toContain('styles.consumableHotkey');
  expect(battleArenaCss).toContain('.consumableHotkey');
  expect(battleArenaTsx).toContain("setEscPanelPage('hotkey-settings')");
  expect(battleArenaTsx).toContain('格子数量');
  expect(battleArenaTsx).toContain('<span>关闭</span>');
  expect(battleArenaTsx).toContain('data-consumable-slot="true"');
  expect(battleArenaTsx).toContain("element?.closest('[data-consumable-slot]')");
  expect(battleArenaTsx).toContain('hasDisguiseClient');
  expect(battleArenaTsx).toContain('DISGUISE_BUFF_IDS');
  expect(battleArenaTsx).toContain('getConsumableCooldownRemainingMs');
  expect(battleArenaTsx).toContain('styles.targetIconDistance');
  expect(battleArenaTsx).toContain('dpr={sceneCanvasDpr}');
  expect(battleArenaTsx).toContain('antialias: !isMobileDevice');
  expect(battleArenaTsx).toContain('webglcontextrestored');
  expect(exportedMapScene).toContain('collisionWorldTrianglesRef');
  expect(exportedMapScene).toContain('buildCollisionShellLines');
  expect(exportedMapScene).toContain('new Float32Array(worldFlat)');
  expect(exportedMapScene).toContain('EXPORTED_MAP_DATA_PATH');
  expect(exportedMapScene).not.toContain('boxLinesRef');
  expect(arenaScene).toContain('hasDisguiseBuff');
  expect(arenaScene).toContain('isDisguised={disguised}');
  expect(characterScene).toContain('wj_木车002_hd.glb');
  expect(characterScene).toContain('DisguiseCartModel');
  expect(characterScene).toContain('EXPORTED_MAP_DATA_PATH');
  expect(characterScene).toContain('DISGUISE_TEXTURE_MAP_URL');
  expect(characterScene).toContain('applyDisguiseCartTextureMaterials');
  expect(characterScene).toContain('loadDisguiseTextureCached');
  expect(characterScene).toContain('loadDisguiseMRECached');
  expect(characterScene).toContain('textureMap?.[DISGUISE_CART_GLB_NAME]');
  expect(combatStatus).toContain('eventCountsAsEnemyAbilityContact');
  expect(combatStatus).toContain('event.type === "COMBAT_STATUS" || event.type === "BUFF_EXPIRED" || event.type === "HEAL"');
  expect(draftRoutes).toContain('consumableCooldowns: {}');
  expect(movement).toContain('facingInputLocked');
  expect(battleArenaTsx).toContain('const facingInputLocked = movementControlStateRef.current.fullyLocked || movementControlStateRef.current.rooted');
  expect(arenaScene).toContain('sun.shadow.mapSize.width = 1024');
  expect(battleArenaTsx).toContain('界面开关');
  expect(battleArenaTsx).not.toContain('操作开关');
  expect(battleArenaTsx).toContain('applyEscSettings');
  expect(battleArenaTsx).toContain('应用</button>');
  expect(cssBlock(battleArenaCss, '.escPanelShell')).toContain('width: min(688px, 96vw)');
  expect(cssBlock(battleArenaCss, '.escPanelShell')).toContain('height: min(437px, 94vh)');
  expect(cssBlock(battleArenaCss, '.escMainGrid')).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
  expect(cssBlock(battleArenaCss, '.escMainTile:disabled')).toContain('color: rgba(172, 181, 181, 0.72)');
  expect(cssBlock(battleArenaCss, '.escSettingsBody')).toContain('grid-template-columns: 140px 1fr');
  expect(cssBlock(battleArenaCss, '.escTestLayout')).toContain('grid-template-columns: 120px 1fr');
  expect(cssBlock(battleArenaCss, '.escTestGrid')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  expect(cssBlock(battleArenaCss, '.escLightingToggleGrid')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  expect(battleArenaCss).not.toContain('.escMainFooter .escFooterButton:first-child');
  expect(cssBlock(battleArenaCss, '.targetIconDistance')).toContain('font-size: 90%');
  expect(cssBlock(battleArenaCss, '.combatStatusMarker')).toContain('bottom: -11px');
  expect(cssBlock(battleArenaCss, '.combatStatusMarker')).toContain('color: #b11b1b');
  expect(cssBlock(layoutShellCss, '.container')).not.toContain('background: #010409');
  expect(cssBlock(layoutShellCss, '.mainFullscreenNoTopbar')).toContain('position: fixed');
  expect(cssBlock(layoutShellCss, '.mainFullscreenNoTopbar')).toContain('inset: 0');
  expect(cssBlock(layoutShellCss, '.mainFullscreenNoTopbar')).toContain('width: auto');
  expect(cssBlock(layoutShellCss, '.mainFullscreenNoTopbar')).toContain('height: auto');
  expect(cssBlock(layoutShellCss, '.mainFullscreenNoTopbar')).not.toContain('height: 100dvh');
  expect(cssBlock(layoutShellCss, '.mainFullscreenNoTopbar')).not.toContain('min-height: 100vh');
  expect(cssBlock(battleArenaCss, '.customUiPrompt')).toContain('cursor: move');

  const buffNameBlock = cssBlock(statusCss, '.buffName');
  expect(buffNameBlock).toContain('color: #ffe033');
  expect(buffNameBlock).toContain('-webkit-text-stroke: 0');
  expect(cssBlock(statusCss, '.buffTurns')).toContain('font-weight: 315');
  expect(cssBlock(statusCss, '.buffTurns')).toContain('font-size: 11.66px');
  expect(cssBlock(statusCss, '.playerStatusBar .buffTurns')).toContain('font-size: 12.83px');
  const stackBadgeBlock = cssBlock(statusCss, '.stackBadge');
  expect(stackBadgeBlock).toContain('top: auto');
  expect(stackBadgeBlock).toContain('right: 0');
  expect(stackBadgeBlock).toContain('bottom: 0');
  expect(stackBadgeBlock).toContain('min-width: 0.72em');
  expect(stackBadgeBlock).toContain('font-size: 14.58px');
  expect(stackBadgeBlock).toContain('line-height: 0.82');
  expect(stackBadgeBlock).toContain('text-align: right');
  expect(stackBadgeBlock).toContain('transform: translate(8%, 10%)');
  expect(cssBlock(statusCss, '.compactStatusBar .stackBadge')).toContain('font-size: 9.72px');
  expect(cssBlock(statusCss, '.playerStatusBar .stackBadge')).toContain('font-size: 16.04px');

  const abilityEditBlock = cssBlock(battleArenaCss, '.customUiAbilityPlacementEditing');
  expect(abilityEditBlock).not.toContain('border: 0');
  expect(abilityEditBlock).not.toContain('border-radius: 0');
  expect(cssBlock(battleArenaCss, '.customUiHudPlacementEditing')).toContain('padding: 0');
  expect(cssBlock(battleArenaCss, '.customUiHudPlacementEditing')).toContain('border: 0');
  expect(cssBlock(battleArenaCss, '.customUiHudPlacementEditing')).toContain('z-index: 980');
  expect(cssBlock(battleArenaCss, '.customUiHudPlacementEditing::before')).toContain('inset: -6px');
  expect(cssBlock(battleArenaCss, '.customUiHudPlacementEditing::before')).toContain('z-index: 4');
  expect(cssBlock(battleArenaCss, '.customUiStatusGuide')).toContain('top: -6px');
  expect(cssBlock(battleArenaCss, '.customUiStatusGuide')).toContain('z-index: 4');
  expect(cssBlock(battleArenaCss, '.customUiPlacementLabel')).toContain('z-index: 6');

  expect(cssBlock(battleArenaCss, '.hotbarStack')).toContain('gap: calc(8px * var(--ability-panel-scale))');
  expect(cssBlock(battleArenaCss, '.hotbar')).toContain('gap: calc(2px * var(--ability-panel-scale))');
  expect(cssBlock(battleArenaCss, '.commonBar')).toContain('gap: calc(2px * var(--ability-panel-scale))');
  expect(cssBlock(battleArenaCss, '.gcdBarWrap')).toContain('width: var(--gcd-bar-width, 59.4%)');
  expect(cssBlock(battleArenaCss, '.gcdBarWrap')).toContain('min-width: 224px');
  expect(cssBlock(battleArenaCss, '.enemyBossBar')).toContain('width: 227px');
  expect(cssBlock(battleArenaCss, '.enemyPrimaryBossStack')).toContain('min-width: 227px');

  expect(battleArenaTsx).toContain('className={styles.enemyShieldFill}');
  expect(battleArenaTsx).not.toContain('styles.shieldSegmentNum');
  const shieldBlock = cssBlock(battleArenaCss, '.enemyShieldFill');
  expect(shieldBlock).toContain('min-width: 3px');
  expect(shieldBlock).toContain('border-radius: 2px');
  expect(shieldBlock).toContain('z-index: 2');

  expect(battleArenaTsx).not.toContain('#ff3333');

  expect(cssBlock(battleArenaCss, '.hotbar')).toContain('background: transparent');
  expect(cssBlock(battleArenaCss, '.commonBar')).toContain('background: transparent');
  expect(cssBlock(battleArenaCss, '.abilityBtn')).toContain('background: transparent');
  expect(cssBlock(battleArenaCss, '.abilityBtn')).toContain('border: 2.5px solid rgba(22, 59, 38, 0.98)');
  expect(cssBlock(battleArenaCss, '.abilityBtn')).toContain('border-radius: 5px');
  const abilityHoverOverlayBlock = cssBlock(battleArenaCss, '.abilityBtn::after,\n.itemSlot::after');
  expect(abilityHoverOverlayBlock).toContain('z-index: 6');
  expect(abilityHoverOverlayBlock).toContain('linear-gradient(90deg');
  expect(abilityHoverOverlayBlock).toContain('transparent 12px');
  expect(abilityHoverOverlayBlock).toContain('border: 1px solid rgba(156, 255, 239, 0.62)');
  expect(abilityHoverOverlayBlock).toContain('opacity: 0');
  expect(cssBlock(battleArenaCss, '.abilityBtn:hover:not(:disabled)')).toContain('border-color: rgba(22, 59, 38, 0.98)');
  expect(battleArenaCss).toContain('.abilityBtn:hover:not(:disabled)::after');
  expect(battleArenaCss).toContain('.draftSlotHover .abilityBtn::after');
  expect(cssBlock(battleArenaCss, '.abilityKey')).toContain('top: 2px');
  expect(cssBlock(battleArenaCss, '.abilityKey')).toContain('bottom: auto');
  expect(cssBlock(battleArenaCss, '.abilityKey')).toContain('font-size: 11.7px');
  expect(cssBlock(battleArenaCss, '.abilityBtn.emptySlot')).toContain('background: rgba(88, 92, 96, 0.5)');
  expect(cssBlock(battleArenaCss, '.draftDropCluster')).toContain('gap: 0');
  expect(cssBlock(battleArenaCss, '.enemyAbilityRow')).toContain('gap: 1px');
  expect(cssBlock(battleArenaCss, '.enemyAbilityRow')).toContain('min-height: 47px');
  expect(cssBlock(battleArenaCss, '.enemyAbilitySlot')).toContain('width: 32px');
  expect(cssBlock(battleArenaCss, '.enemyAbilitySlot')).toContain('height: 32px');
  expect(cssBlock(battleArenaCss, '.enemyAbilityPreviewSlot')).toContain('background: rgba(88, 92, 96, 0.46)');
  expect(cssBlock(battleArenaCss, '.enemyAbilitySlot')).toContain('border-radius: 0');
  expect(cssBlock(battleArenaCss, '.enemyAbilityIcon')).toContain('border-radius: 0');
  expect(cssBlock(battleArenaCss, '.discardDropZone')).toContain('width: calc(238px * var(--ability-panel-scale, 1))');
  expect(cssBlock(battleArenaCss, '.discardDropZone')).toContain('height: calc(36px * var(--ability-panel-scale, 1))');
  expect(cssBlock(battleArenaCss, '.discardDropZone')).toContain('border-bottom: 1px solid rgba(77, 166, 255, 0.98)');
  expect(cssBlock(battleArenaCss, '.discardDropZone')).toContain('background: transparent');
  expect(cssBlock(battleArenaCss, '.discardDropZone')).toContain('color: rgba(77, 166, 255, 0.98)');
  expect(cssBlock(battleArenaCss, '.discardDropZone')).toContain('inset 0 -2px 0 rgba(77, 166, 255, 0.76)');
  expect(cssBlock(battleArenaCss, '.discardDropZoneActive')).toContain('box-shadow: inset 0 -2px 0 rgba(110, 190, 255, 0.9)');
  expect(cssBlock(battleArenaCss, '.discardDropZoneActive')).not.toContain('0 0 10px');
  expect(cssBlock(battleArenaCss, '.abilityBtnDragging')).toContain('opacity: 0.48');
  expect(cssBlock(battleArenaCss, '.abilityDragGhost')).toContain('width: calc(19px * var(--ability-panel-scale, 1))');
  expect(cssBlock(battleArenaCss, '.abilityDragGhost')).toContain('pointer-events: none');
  expect(cssBlock(battleArenaCss, '.abilityHintPanel')).toContain('background: rgba(0, 0, 0, 0.7)');
  expect(cssBlock(battleArenaCss, '.abilityHintDesc')).not.toContain('background:');
  expect(cssBlock(statusHintCss, '.hint')).toContain('background: rgba(0, 0, 0, 0.7)');
  expect(cssBlock(battleArenaCss, '.itemBar')).toContain('--item-slot-size: calc(38px * var(--ability-panel-scale, 1))');
  expect(cssBlock(battleArenaCss, '.itemBar')).toContain('gap: calc(2px * var(--ability-panel-scale, 1))');
  expect(cssBlock(battleArenaCss, '.itemSlot')).toContain('width: var(--item-slot-size)');
  expect(cssBlock(battleArenaCss, '.itemSlot')).toContain('height: var(--item-slot-size)');
  expect(cssBlock(battleArenaCss, '.itemSlot')).toContain('border: 2.5px solid rgba(22, 59, 38, 0.98)');
  expect(cssBlock(battleArenaCss, '.consumableSlot')).toContain('border: 2.5px solid rgba(22, 59, 38, 0.98)');
  expect(cssBlock(battleArenaCss, '.consumableSlot')).toContain('background: transparent');
  expect(cssBlock(battleArenaCss, '.consumableSlot')).toContain('appearance: none');
  expect(cssBlock(battleArenaCss, '.consumableCooldown')).toContain('background: rgba(0, 0, 0, 0.58)');
  expect(cssBlock(battleArenaCss, '.cdNumMinutes')).toContain('font-size: 12px');
  expect(cssBlock(battleArenaCss, '.cdNumMinutes')).toContain('color: #ffe033');
  expect(cssBlock(battleArenaCss, '.itemSlotFilled')).toContain('cursor: grab');
  expect(cssBlock(battleArenaCss, '.itemAbilityIcon')).toContain('object-fit: cover');
  expect(cssBlock(battleArenaCss, '.itemBarPlacementEditing')).toContain('pointer-events: auto');
  expect(cssBlock(battleArenaCss, '.itemBarPlacementLabel')).toContain('position: absolute');
  expect(cssBlock(battleArenaCss, '.heartDetailsPlacement')).toContain('position: absolute');
  expect(cssBlock(battleArenaCss, '.heartDetailsPlacement .heartDetailsPanel')).toContain('position: static');
  expect(battleArenaCss).toContain('.abilityBtn::after,\n.itemSlot::after');
  expect(battleArenaCss).toContain('.itemSlot:hover::after');
  expect(battleArenaCss).toContain('.itemSlotHover::after');
  expect(cssBlock(battleArenaCss, '.chargeFrameTrack')).toContain('stroke: rgba(80, 14, 14, 0.95)');
  expect(cssBlock(battleArenaCss, '.chargeFrameProgress')).toContain('stroke: #ff2e2e');
  expect(cssBlock(battleArenaCss, '.chargeFrameSvg')).toContain('position: absolute');
  expect(cssBlock(battleArenaCss, '.chargeStackBox')).toContain('font-size: 9.36px');
  expect(cssBlock(battleArenaCss, '.chargeStackBox')).toContain('border: none');
  expect(cssBlock(battleArenaCss, '.chargeStackBox')).toContain('width: 12px');
  expect(cssBlock(battleArenaCss, '.chargeStackBox')).toContain('z-index: 2');
  expect(cssBlock(battleArenaCss, '.enemyName')).toContain('font-size: 13.2px');
  expect(cssBlock(battleArenaCss, '.enemyName')).toContain('opacity: 1');
  expect(cssBlock(battleArenaCss, '.iconBarResourceRow')).toContain('opacity: 1');
  expect(cssBlock(battleArenaCss, '.iconBarBody')).toContain('rgba(198, 57, 43, 0.7)');
  expect(cssBlock(battleArenaCss, '.heightCounterPlacement')).toContain('position: absolute');
  expect(battleArenaTsx).toContain('ABILITY_PANEL_SCALE_STORAGE_KEY');
  expect(battleArenaTsx).toContain('ABILITY_PANEL_BASE_VISUAL_SCALE = 1.175');
  expect(battleArenaTsx).toContain('Math.max(ABILITY_PANEL_MIN_SCALE, Math.min(2, numeric))');
  expect(battleArenaTsx).toContain('normalized <= 1');
  expect(battleArenaTsx).toContain('getAbilityPanelCssScale(abilityPanelScale)');
  expect(battleArenaTsx).toContain('input, select, textarea');
  expect(battleArenaTsx).toContain('type="range"');
  expect(battleArenaTsx).toContain('min={ABILITY_PANEL_MIN_SCALE}');
  expect(battleArenaTsx).toContain('max="2"');
  expect(battleArenaTsx).toContain('--ability-panel-scale');
  expect(battleArenaTsx).toContain('pressedAbilityInput');
  expect(battleArenaTsx).toContain('styles.abilityBtnPressed');
  expect(battleArenaTsx).toContain('abilityDragActiveRef.current');
  expect(battleArenaTsx).toContain('document.elementFromPoint');
  expect(battleArenaTsx).toContain('slotIndex');
  expect(battleArenaTsx).toContain('buildDraftAbilitySlots');
  expect(battleArenaTsx).toContain('draftFallbackSlotIndex');
  expect(battleArenaTsx).toContain('HEIGHT_COUNTER_UI_KEY');
  expect(battleArenaTsx).toContain('DISTANCE_INDICATOR_UI_KEY');
  expect(battleArenaTsx).toContain('HEART_STATS_UI_KEY');
  expect(battleArenaTsx).not.toContain('高度显示');
  expect(battleArenaTsx).not.toContain('距离显示');
  expect(battleArenaTsx).not.toContain('自身血条');
  expect(battleArenaTsx).toContain('dragRect.height');
  expect(battleArenaTsx).toContain('M 96 96 L 96 4 L 4 4 L 4 96 L 96 96');
  expect(battleArenaTsx).toContain('data-draft-slot-index');
  expect(battleArenaTsx).toContain('data-discard-drop-zone="true"');
  expect(battleArenaTsx).toContain('className={`${styles.abilityDragGhost} ${draftDragGhost.large ? styles.abilityDragGhostLarge : \'\'}`}');
  expect(battleArenaTsx).toContain('draggable={false}');
  expect(abilityTypes).toContain('slotIndex?: number');
  expect(draftRoutes).toContain('DRAFT_ABILITY_SLOT_COUNT = 6');
  expect(draftRoutes).toContain('DRAFT_ABILITY_LIMIT_ERROR = "只能拾取6个技能"');
  expect(draftRoutes).toContain('getFirstAvailableDraftSlot');
  expect(draftRoutes).toContain('splitDraftAndCommonCards');
  expect(draftRoutes).toContain('moved.slotIndex = clampedToIndex');
  expect(draftRoutes).toContain('targetCard.slotIndex = fromSlotIndex');
  expect(gameplayRoutes).toContain('ERR_PICKUP_HAND_FULL: "只能拾取6个技能"');
  expect(gameplayRoutes).toContain('slotIndex:  firstOpenSlot');
  expect(inGameClient).toContain('return "只能拾取6个技能"');
  expect(battleArenaTsx).toContain("'draft:0': ['1']");
  expect(battleArenaTsx).toContain('return triggerAbilityHotkey(drafts[parsed.index], `draft-${parsed.index}`);');
  expect(battleArenaTsx).toContain('styles.abilityBtnDragging');
  expect(battleArenaTsx).toContain('draggingDraftInstanceId && (');
  expect(battleArenaTsx).toContain('ITEM_BAR_UI_KEY');
  expect(battleArenaTsx).toContain('ITEM_BAR_SLOT_COUNT = 14');
  expect(battleArenaTsx).toContain('PLAYER_GCD_BAR_FLOAT_WIDTH = 224');
  expect(battleArenaTsx).toContain('itemBarAbilities');
  expect(battleArenaTsx).toContain('draftSlotOverrides');
  expect(battleArenaTsx).toContain('getDefaultItemBarPos');
  expect(battleArenaTsx).toContain('renderItemBar');
  expect(battleArenaTsx).toContain('aria-label="物品栏"');
  expect(battleArenaTsx).toContain('data-item-slot-index');
  expect(battleArenaTsx).toContain('moveAbilityBetweenLocalBars');
  expect(battleArenaTsx).toContain('beginAbilityPointerDrag');
  expect(battleArenaTsx).toContain('getHotkeyDraftSlots');
  expect(battleArenaTsx).toContain('heldItemIds.has(a.id)');
  expect(battleArenaTsx).toContain('if (abilityDragActiveRef.current)');
  expect(battleArenaTsx).toContain('mouseStateRef.current.isLeft = false;\n    mouseStateRef.current.isRight = false;\n    manualCameraLookActiveRef.current = false;\n    pendingDraftDragRef.current');
  expect(battleArenaTsx).toContain('styles.itemBarPlacementEditing');
  expect(battleArenaTsx).toContain('styles.itemBarPlacementLabel');
  expect(battleArenaTsx).toContain('styles.heartDetailsPlacement');
  expect(battleArenaTsx).toContain('fallbackPreviewAbilities');
  expect(battleArenaTsx).toContain('previewPlaceholder: true');
  expect(battleArenaTsx).toContain('styles.enemyAbilityPreviewSlot');
  expect(battleArenaTsx).toContain('predictDraftAbilityReorder');
  expect(battleArenaTsx).toContain('pendingDraftReorderRef');
  expect(battleArenaTsx).toContain('const previousAbilities = abilitiesRef.current');
  expect(battleArenaTsx).toContain('setHandAbilities(predictedAbilities)');
  expect(battleArenaTsx).toContain('setHandAbilities(previousAbilities)');
  expect(battleArenaTsx).toContain('e.dataTransfer.dropEffect = \'move\'');
  expect(battleArenaTsx).toContain('webglcontextlost');
  expect(battleArenaTsx).toContain('setSceneCanvasKey');
  expect(battleArenaTsx).toContain('sceneRecovering && <div className={styles.canvasRecoveryNotice}');
  expect(battleArenaTsx).toContain('{hongMengOverlayActive && <div className={`${styles.hongMengSelfCanvas} ${styles.hongMengOverlayVisible}`');
  expect(battleArenaTsx).not.toContain('critPresetMiniLabel');
  expect(battleArenaCss).not.toContain('critPresetMiniLabel');
  expect(statusBarIndex).not.toContain('getLowTimeBlinkOpacity');
  expect(statusBarIndex).not.toContain('opacity: lowTimeBlinkOpacity');
});

test('layout shell keeps normal pages white and in-game fullscreen covering viewport', async ({ page }) => {
  const layoutShellCss = readFile(layoutShellCssPath);

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.setContent(`
    <style>
      html, body { margin: 0; min-height: 100%; background: rgb(255, 255, 255); }
    </style>
    <style>${layoutShellCss}</style>
    <div class="container" id="normalShell">
      <main class="main"><button id="homeAction">开始游戏</button></main>
    </div>
  `);

  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#normalShell')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#homeAction')).toBeVisible();

  await page.setContent(`
    <style>
      html, body { margin: 0; width: 100%; min-height: 100%; background: rgb(255, 255, 255); }
    </style>
    <style>${layoutShellCss}</style>
    <div class="container">
      <main class="mainFullscreenNoTopbar" id="gameShell">
        <div id="gameSurface" style="width:100%;height:100%;background:rgb(1, 4, 9)"></div>
      </main>
    </div>
  `);

  const fullscreenMetrics = await page.locator('#gameShell').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bottomElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bottomElementId: bottomElement?.id ?? '',
      backgroundColor: getComputedStyle(element).backgroundColor,
    };
  });

  expect(fullscreenMetrics.top).toBe(0);
  expect(fullscreenMetrics.left).toBe(0);
  expect(fullscreenMetrics.width).toBe(fullscreenMetrics.viewportWidth);
  expect(fullscreenMetrics.height).toBe(fullscreenMetrics.viewportHeight);
  expect(['gameShell', 'gameSurface']).toContain(fullscreenMetrics.bottomElementId);
  expect(fullscreenMetrics.backgroundColor).toBe('rgb(1, 4, 9)');
});

test('browser-computed HUD styles match requested layout and visual rules', async ({ page }) => {
  const battleArenaCss = readFile(battleArenaCssPath);
  const statusCss = readFile(statusCssPath);
  const statusHintCss = readFile(statusHintCssPath);
  const inGameCss = readFile(inGameCssPath);

  await page.setContent(`
    <style>${battleArenaCss}\n${statusCss}\n${statusHintCss}\n${inGameCss}</style>
    <button class="homeButton" aria-label="首页" title="首页"><svg width="18" height="18"></svg></button>
    <div class="topMetricsBar"><button class="topMetricsSettingsButton">设置</button><div class="topMetricsItem"><span class="topMetricsLabel">时间:</span><span class="topMetricsTimeValue">2025-03-02 22:49:20</span></div><div class="topMetricsItem"><span class="topMetricsLabel">渲染FPS:</span><span class="topMetricsGoodValue">66</span></div><div class="topMetricsItem"><span class="topMetricsLabel">网络延迟:</span><span class="topMetricsGoodValue">113</span></div></div>
    <div class="customUiFloatingHudPlacement customUiHudPlacementEditing customUiAbilityPlacementEditing"><div class="enemyAbilityRow"><div class="enemyAbilityItem"><div class="enemyAbilitySlot enemyAbilityPreviewSlot"></div><span class="enemyAbilityName">技能</span></div><div class="enemyAbilityItem"><div class="enemyAbilitySlot enemyAbilityPreviewSlot"></div><span class="enemyAbilityName">技能</span></div></div></div>
    <div class="heartDetailsPlacement customUiHudPlacementEditing" style="left: 220px; top: 120px"><div class="customUiPlacementLabel">属性栏</div><div class="heartDetailsPanel"><div class="heartDetailsHeader"><span class="heartDetailsTitle">属性</span><button class="heartDetailsTab">详细</button></div><div class="heartDetailsBody"><div class="heartDetailsRow"><span class="heartDetailsLabel">攻击力</span><span class="heartDetailsValue">5万</span></div></div></div></div>
    <div class="enemyBossBar"><div class="enemyName"><span class="targetIconDistance">18m</span> · 目标</div><div class="iconBarBody"><div class="enemyHpTrack"><div class="enemyHpFill" style="width:60%"></div><div class="enemyShieldFill" style="left:60%;width:18%"></div></div><div class="iconBarResourceRow"><span class="iconBarResourceValue">130</span></div><div class="combatStatusMarker" aria-label="战斗中"><svg></svg></div></div></div>
    <div class="enemyAbilityRow"><div class="enemyAbilityItem"><div class="enemyAbilitySlot"><img class="enemyAbilityIcon" alt="" /></div><span class="enemyAbilityName">技能</span></div><div class="enemyAbilityItem"><div class="enemyAbilitySlot"><img class="enemyAbilityIcon" alt="" /></div><span class="enemyAbilityName">技能</span></div></div>
    <div class="statusBar"><div class="buffItem"><div class="buffName buffText">山河</div><div class="iconWrapper"><div class="buffIcon"></div><span class="stackBadge">4</span></div><div class="buffTurns secondTime">5″</div></div></div>
    <div class="statusBar playerStatusBar"><div class="buffItem"><div class="buffName buffText">山河</div><div class="iconWrapper"><div class="buffIcon"></div><span class="stackBadge">6</span></div><div class="buffTurns secondTime">5″</div></div></div>
    <div class="hint">buff hint</div>
    <div class="abilityHintPanel"><div class="abilityHintBody"><div class="abilityHintMain"><div class="abilityHintDesc">desc</div></div></div></div>
    <div class="heightCounterPlacement" style="left: 900px; top: 180px"><div class="heightValueBox">1.0</div></div>
    <div class="distIndicator" style="left: 900px; top: 260px"><span class="distVal">12.0尺</span></div>
    <div class="itemBarPlacement customUiHudPlacementEditing itemBarPlacementEditing" style="left: 80px; top: 80px; z-index: 10000; --ability-panel-scale: 1.5"><div class="customUiPlacementLabel itemBarPlacementLabel">物品栏</div><div class="itemBar" aria-label="物品栏">${Array.from({ length: 14 }, (_, index) => `<div class="itemSlot" data-item-slot-index="${index}"></div>`).join('')}</div></div>
    <div id="escFixture" class="escPanelShell" style="position:absolute;left:-2200px;top:-2200px"><div class="escWindowHeader"><div class="escWindowTitle">系统设置</div><button class="escHeaderIconButton">×</button></div><div class="escMainTabs"><button class="escMainTabButton escMainTabButtonActive">常规</button><button class="escMainTabButton">测试</button></div><div class="escMainGrid"><button class="escMainTile" disabled><span class="escMainIcon"></span><span>效果性能设置</span></button><button class="escMainTile"><span class="escMainIcon"></span><span>游戏设置</span></button><button class="escMainTile"><span class="escMainIcon"></span><span>自定义界面</span></button></div><div class="escMainFooter"><button class="escFooterButton">返回游戏</button><button class="escFooterButton">退出游戏</button></div></div>
    <div id="escSettingsFixture" class="escPanelShell escPanelShellSettings" style="position:absolute;left:-3600px;top:-2200px"><div class="escWindowHeader"><button class="escHeaderIconButton">←</button><div class="escWindowTitle">游戏设置</div><button class="escHeaderIconButton">×</button></div><div class="escSettingsBody"><aside class="escSettingsSidebar"><button class="escSettingsNavButton escSettingsNavButtonActive">综合</button></aside><section class="escSettingsContent"><div class="escSectionTitle"><span>界面设置</span></div><div class="escSettingsGrid"><div class="escSettingControl"><div class="escRangeHeader"><span>技能栏大小</span><span>1.00</span></div><input class="escRangeInput" type="range" /></div><div class="escToggleGroup escSettingControl"><label class="escToggleGroupHeader"><input class="escToggleInput" type="checkbox" /><span>显示GCD</span></label></div></div></section></div></div>
    <div id="escTestFixture" class="escPanelShell" style="position:absolute;left:-5000px;top:-2200px"><div class="escWindowHeader"><div class="escWindowTitle">系统设置</div></div><div class="escTestPanel"><div class="escTestLayout"><aside class="escTestSidebar"><button class="escSettingsNavButton escSettingsNavButtonActive">开关</button><button class="escSettingsNavButton">灯光控制</button></aside><section class="escTestContent"><div class="escTestGrid"><label class="escToggleRow"><input class="escToggleInput" type="checkbox" /><span>角色测试状态</span></label><label class="escToggleRow"><input class="escToggleInput" type="checkbox" /><span>屏幕坐标</span></label><label class="escToggleRow"><input class="escToggleInput" type="checkbox" /><span>显示碰撞线</span></label><label class="escToggleRow"><input class="escToggleInput" type="checkbox" /><span>显示蓝图</span></label></div></section></div></div></div>
    <div id="customPromptFixture" class="customUiPrompt" style="left:-6400px;top:-2200px;transform:none"><div class="customUiTitle">自定义界面</div><div class="customUiActions"><button class="customUiButtonSecondary">取消</button><button class="customUiButtonSecondary">恢复默认</button><button class="customUiButtonPrimary">确定</button></div></div>
    <div class="hotbarStack" style="--ability-panel-scale: 1.5">
      <div class="commonBar"><button class="abilityBtn commonBtn ready"></button><span class="commonGap"></span><button class="abilityBtn commonBtn ready"></button></div>
      <div class="draftDropCluster">
        <div class="discardDropZone"><svg class="discardDropIcon"></svg><span>将技能拖动至此处即可遗忘</span></div>
        <div class="hotbar"><button class="abilityBtn ready"><img class="abilityIcon" alt="" /><div class="chargeFrame"><svg class="chargeFrameSvg"><path class="chargeFrameTrack" d="M 96 96 L 96 4 L 4 4 L 4 96 L 96 96"></path><path class="chargeFrameProgress" d="M 96 96 L 96 4 L 4 4 L 4 96 L 96 96"></path></svg><span class="chargeStackBox">2</span></div><span class="abilityKey">1</span></button><button class="abilityBtn ready"><span class="abilityKey">2</span></button></div>
      </div>
      <div class="abilityDragGhost"><img class="abilityDragGhostIcon" alt="" /></div>
      <div class="hotbar"><div class="abilityBtn emptySlot"><span class="abilityKey">Q</span></div></div>
    </div>
  `);

  const home = page.locator('.homeButton');
  await expect(home).toHaveText('');
  await expect(home).toHaveCSS('width', '51px');
  await expect(home).toHaveCSS('height', '51px');
  await expect(home).toHaveCSS('top', '38px');
  const homeBox = await home.boundingBox();
  const topBarBox = await page.locator('.topMetricsBar').boundingBox();
  expect(homeBox && topBarBox && homeBox.y >= topBarBox.y + topBarBox.height).toBeTruthy();
  await expect(page.getByText('玉门关')).toHaveCount(0);

  const topMetricsStyle = await page.locator('.topMetricsBar').evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: style.height, fontSize: style.fontSize };
  });
  expect(parseFloat(topMetricsStyle.height)).toBeCloseTo(18.85, 1);
  expect(topMetricsStyle.fontSize).toBe('14.3px');
  await expect(page.locator('.topMetricsBar')).toHaveCSS('background-color', 'rgba(56, 56, 56, 0.7)');
  await expect(page.locator('.topMetricsSettingsButton')).toHaveText('设置');
  await expect(page.locator('.topMetricsSettingsButton')).toHaveCSS('min-width', '73px');
  await expect(page.locator('.topMetricsTimeValue')).toHaveText('2025-03-02 22:49:20');
  await expect(page.locator('.topMetricsLabel').first()).toHaveCSS('color', 'rgb(243, 242, 81)');
  await expect(page.locator('.topMetricsGoodValue').first()).toHaveCSS('color', 'rgb(33, 216, 90)');
  await expect(page.locator('#escFixture')).toHaveCSS('width', '688px');
  const escFixtureHeight = await page.locator('#escFixture').evaluate((element) => parseFloat(getComputedStyle(element).height));
  expect(escFixtureHeight).toBeCloseTo(437, 1);
  await expect(page.locator('#escFixture .escWindowTitle')).toHaveText('系统设置');
  await expect(page.locator('#escFixture .escMainTile').first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('#escFixture .escMainTile').first()).toHaveCSS('color', 'rgba(172, 181, 181, 0.72)');
  await expect(page.locator('#escFixture .escMainIcon').first()).toHaveCSS('width', '75px');
  await expect(page.locator('#escFixture')).not.toContainText('返回角色');
  await expect(page.locator('#escFixture')).not.toContainText('返回登录');
  await expect(page.locator('#escFixture')).toContainText('退出游戏');
  await expect(page.locator('#escFixture .escMainFooter .escFooterButton')).toHaveCount(2);
  await expect(page.locator('#escFixture .escMainFooter .escFooterButton').first()).toBeEnabled();
  await expect(page.locator('#escSettingsFixture .escWindowTitle')).toHaveText('游戏设置');
  await expect(page.locator('#escSettingsFixture .escSettingsBody')).toHaveCSS('grid-template-columns', '140px 548px');
  await expect(page.locator('#escSettingsFixture')).not.toContainText('界面开关');
  await expect(page.locator('#escSettingsFixture .escRangeHeader').first()).toHaveCSS('font-size', '12px');
  await expect(page.locator('#escTestFixture .escTestLayout')).toHaveCSS('display', 'grid');
  await expect(page.locator('#escTestFixture .escTestLayout')).toHaveCSS('grid-template-columns', '120px 484px');
  await expect(page.locator('#escTestFixture')).toContainText('开关');
  await expect(page.locator('#escTestFixture')).toContainText('灯光控制');
  await expect(page.locator('#escTestFixture')).toContainText('显示碰撞线');
  await expect(page.locator('#escTestFixture')).toContainText('显示蓝图');
  await expect(page.locator('#customPromptFixture')).toContainText('恢复默认');
  await expect(page.locator('#customPromptFixture')).toHaveCSS('cursor', 'move');
  const customPromptBorder = await page.locator('#customPromptFixture').evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(customPromptBorder).not.toContain('34, 197, 94');

  await expect(page.locator('.customUiAbilityPlacementEditing')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.customUiAbilityPlacementEditing')).toHaveCSS('padding-top', '0px');
  const customBorder = await page.locator('.customUiAbilityPlacementEditing').evaluate((element) => getComputedStyle(element, '::before').borderTopColor);
  expect(customBorder).toContain('34, 197, 94');
  await expect(page.locator('.customUiAbilityPlacementEditing')).toHaveCSS('z-index', '980');
  const customBeforeInset = await page.locator('.customUiAbilityPlacementEditing').evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    return { top: style.top, right: style.right, bottom: style.bottom, left: style.left, zIndex: style.zIndex, borderTopWidth: style.borderTopWidth };
  });
  expect(customBeforeInset).toEqual({ top: '-6px', right: '-6px', bottom: '-6px', left: '-6px', zIndex: '4', borderTopWidth: '2px' });
  const targetSkillBox = await page.locator('.customUiAbilityPlacementEditing').boundingBox();
  expect(targetSkillBox && targetSkillBox.height >= 47).toBeTruthy();
  await expect(page.locator('.customUiAbilityPlacementEditing .enemyAbilityName').first()).toHaveText('技能');
  const heartPanelBox = await page.locator('.heartDetailsPanel').boundingBox();
  const heartPlacementBox = await page.locator('.heartDetailsPlacement').boundingBox();
  expect(heartPanelBox && heartPlacementBox && Math.round(heartPanelBox.y - heartPlacementBox.y)).toBe(0);

  await expect(page.locator('.enemyBossBar')).toHaveCSS('width', '227px');
  await expect(page.locator('.enemyName')).toHaveCSS('opacity', '1');
  await expect(page.locator('.enemyName')).toHaveCSS('font-size', '13.2px');
  await expect(page.locator('.targetIconDistance')).toHaveCSS('font-size', '11.88px');
  await expect(page.locator('.iconBarResourceRow')).toHaveCSS('opacity', '1');
  await expect(page.locator('.combatStatusMarker')).toHaveCSS('color', 'rgb(177, 27, 27)');
  const iconBarBodyBg = await page.locator('.iconBarBody').evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(iconBarBodyBg).toContain('rgba(198, 57, 43, 0.7)');
  await expect(page.locator('.hotbarStack')).toHaveCSS('gap', '12px');
  await expect(page.locator('.hotbar').first()).toHaveCSS('gap', '3px');
  await expect(page.locator('.commonBar')).toHaveCSS('gap', '3px');
  await expect(page.locator('.hotbar').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.commonBar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  const shieldStyle = await page.locator('.enemyShieldFill').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      minWidth: style.minWidth,
      borderTopLeftRadius: style.borderTopLeftRadius,
      zIndex: style.zIndex,
      backgroundImage: style.backgroundImage,
    };
  });
  expect(shieldStyle).toMatchObject({ minWidth: '3px', borderTopLeftRadius: '2px', zIndex: '2' });
  expect(shieldStyle.backgroundImage).toContain('rgb(255, 255, 255)');

  const buffNameStyle = await page.locator('.statusBar:not(.playerStatusBar) .buffName').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      webkitTextStrokeWidth: style.webkitTextStrokeWidth,
    };
  });
  expect(buffNameStyle).toEqual({
    color: 'rgb(255, 224, 51)',
    webkitTextStrokeWidth: '0px',
  });
  await expect(page.locator('.statusBar:not(.playerStatusBar) .buffTurns')).toHaveCSS('font-size', '11.66px');
  await expect(page.locator('.playerStatusBar .buffTurns')).toHaveCSS('font-size', '12.83px');
  const stackBadgePosition = await page.locator('.statusBar:not(.playerStatusBar) .stackBadge').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      right: style.right,
      bottom: style.bottom,
      fontSize: style.fontSize,
    };
  });
  expect(stackBadgePosition).toEqual({
    right: '0px',
    bottom: '0px',
    fontSize: '14.58px',
  });
  await expect(page.locator('.playerStatusBar .stackBadge')).toHaveCSS('font-size', '16.04px');

  const ability = page.locator('.draftDropCluster .abilityBtn.ready').first();
  await expect(ability).toHaveCSS('width', '57px');
  await expect(ability).toHaveCSS('height', '57px');
  const abilityBorderColor = await ability.evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(abilityBorderColor).toContain('22, 59, 38');
  await expect(ability).toHaveCSS('border-top-width', '2px');
  await expect(ability).toHaveCSS('border-top-left-radius', '5px');
  const keyPosition = await page.locator('.abilityKey').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { top: style.top, bottom: style.bottom, left: style.left, fontSize: style.fontSize };
  });
  expect(keyPosition.top).toBe('2px');
  expect(keyPosition.left).toBe('3px');
  expect(keyPosition.bottom).not.toBe('2px');
  expect(keyPosition.fontSize).toBe('11.7px');
  await expect(page.locator('.chargeStackBox')).toHaveCSS('font-size', '9.36px');
  await expect(page.locator('.chargeStackBox')).toHaveCSS('width', '12px');
  await expect(page.locator('.chargeStackBox')).toHaveCSS('z-index', '2');
  const chargeProgressStroke = await page.locator('.chargeFrameProgress').evaluate((element) => getComputedStyle(element).stroke);
  expect(chargeProgressStroke).toContain('rgb(255, 46, 46)');
  await expect(page.locator('.chargeFrameProgress')).toHaveAttribute('d', 'M 96 96 L 96 4 L 4 4 L 4 96 L 96 96');
  await expect(page.locator('.enemyAbilityRow').first()).toHaveCSS('gap', '1px');
  await expect(page.locator('.enemyAbilitySlot').first()).toHaveCSS('border-top-left-radius', '0px');
  await expect(page.locator('.enemyAbilityIcon').first()).toHaveCSS('border-top-left-radius', '0px');
  await expect(page.locator('.hint')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.7)');
  await expect(page.locator('.abilityHintPanel')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.7)');
  const abilityHintDescBg = await page.locator('.abilityHintDesc').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(abilityHintDescBg).toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.heightCounterPlacement')).toHaveCSS('position', 'absolute');
  await expect(page.locator('.distIndicator')).toHaveCSS('position', 'absolute');
  const discardZoneStyle = await page.locator('.discardDropZone').evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, borderBottomColor: style.borderBottomColor, width: style.width, boxShadow: style.boxShadow };
  });
  expect(discardZoneStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(discardZoneStyle.backgroundImage).toBe('none');
  expect(discardZoneStyle.borderBottomColor).toContain('77, 166, 255');
  expect(discardZoneStyle.boxShadow).toContain('77, 166, 255');
  expect(discardZoneStyle.width).toBe('357px');
  await expect(page.locator('.discardDropZone')).toHaveCSS('height', '54px');
  await expect(page.locator('.itemBarPlacement')).toHaveCSS('padding-top', '0px');
  await expect(page.locator('.itemBarPlacement')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.itemSlot')).toHaveCount(14);
  const itemSlot = page.locator('.itemSlot').first();
  const itemBarPlacementBox = await page.locator('.itemBarPlacement').boundingBox();
  const itemBarBox = await page.locator('.itemBar').boundingBox();
  expect(itemBarPlacementBox && itemBarBox && Math.round(itemBarBox.y - itemBarPlacementBox.y)).toBe(0);
  await expect(itemSlot).toHaveCSS('width', '57px');
  await expect(itemSlot).toHaveCSS('height', '57px');
  const itemSlotBeforeHover = await itemSlot.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { opacity: style.opacity, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
  });
  expect(itemSlotBeforeHover.opacity).toBe('0');
  expect(itemSlotBeforeHover.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(itemSlotBeforeHover.backgroundImage).toContain('rgba(0, 0, 0, 0) 12px');
  await itemSlot.hover();
  await expect.poll(async () => (
    await itemSlot.evaluate((element) => getComputedStyle(element, '::after').opacity)
  )).toBe('1');
  await expect(page.locator('.abilityDragGhost')).toHaveCSS('width', '28.5px');
  await expect(page.locator('.abilityDragGhost')).toHaveCSS('height', '28.5px');
  const discardBox = await page.locator('.discardDropZone').boundingBox();
  const draftBox = await page.locator('.draftDropCluster .hotbar').boundingBox();
  expect(discardBox && draftBox && Math.round(draftBox.y - (discardBox.y + discardBox.height))).toBe(0);
  const emptySlotBg = await page.locator('.emptySlot').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(emptySlotBg).toContain('88, 92, 96');
  const beforeHoverGlow = await ability.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { opacity: style.opacity, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, borderTopColor: style.borderTopColor, zIndex: style.zIndex };
  });
  expect(beforeHoverGlow).toMatchObject({ opacity: '0', backgroundColor: 'rgba(0, 0, 0, 0)', zIndex: '6' });
  expect(beforeHoverGlow.backgroundImage).toContain('rgba(0, 0, 0, 0) 12px');
  await ability.hover();
  const hoveredBorderColor = await ability.evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(hoveredBorderColor).toContain('22, 59, 38');
  await expect.poll(async () => (
    await ability.evaluate((element) => getComputedStyle(element, '::after').opacity)
  )).toBe('1');
  const hoverGlow = await ability.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { borderTopColor: style.borderTopColor, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
  });
  expect(hoverGlow.borderTopColor).toContain('156, 255, 239');
  expect(hoverGlow.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(hoverGlow.backgroundImage).toContain('rgba(102, 232, 216, 0.42)');
  expect(hoverGlow.backgroundImage).toContain('rgba(0, 0, 0, 0) 12px');
});
