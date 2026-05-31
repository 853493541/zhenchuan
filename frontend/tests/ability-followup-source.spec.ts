import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');

const abilitiesPath = path.join(repoRoot, 'backend/game/abilities/abilities.ts');
const gameLoopPath = path.join(repoRoot, 'backend/game/engine/loop/GameLoop.ts');
const guardsPath = path.join(repoRoot, 'backend/game/engine/rules/guards.ts');
const healthPath = path.join(repoRoot, 'backend/game/engine/utils/health.ts');
const directionalDashPath = path.join(repoRoot, 'backend/game/engine/effects/definitions/DirectionalDash.ts');
const buffRuntimePath = path.join(repoRoot, 'backend/game/engine/effects/buffRuntime.ts');
const applyBuffsPath = path.join(repoRoot, 'backend/game/engine/flow/play/buffs.ts');
const immediateEffectsPath = path.join(repoRoot, 'backend/game/engine/flow/play/immediateEffects.ts');
const movementPath = path.join(repoRoot, 'backend/game/engine/loop/movement.ts');
const combatStatusPath = path.join(repoRoot, 'backend/game/engine/utils/combatStatus.ts');
const validateActionPath = path.join(repoRoot, 'backend/game/engine/rules/validateAction.ts');
const consumableServicePath = path.join(repoRoot, 'backend/game/services/gameplay/consumableService.ts');
const playServicePath = path.join(repoRoot, 'backend/game/services/gameplay/playService.ts');
const battleArenaPath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/BattleArena.tsx');
const arenaScenePath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx');
const characterPath = path.join(frontendRoot, 'app/game/screens/in-game/components/BattleArena/scene/Character.tsx');
const statusBarPath = path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/index.tsx');
const statusHintPath = path.join(frontendRoot, 'app/game/screens/in-game/components/GameBoard/components/StatusBar/Hint/index.tsx');

function readFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

function abilityBlock(source: string, abilityId: string) {
  const start = source.indexOf(`  ${abilityId}: {`);
  expect(start, `${abilityId} block should exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n  // ─', start + 1);
  return source.slice(start, next > start ? next : source.length);
}

test('shield dispel removes linked shield after the buff leaves the active list', async () => {
  const gameLoop = readFile(gameLoopPath);

  expect(gameLoop).toMatch(/const removed = \(dispelTarget\.buffs as any\[\]\)\[idx\];\s*\(dispelTarget\.buffs as any\[\]\)\.splice\(idx, 1\);\s*removeLinkedShield\(dispelTarget as any, removed\);/);
});

test('Jinghong only grants physical dodge and guard code keeps it external-only', async () => {
  const abilities = readFile(abilitiesPath);
  const guards = readFile(guardsPath);
  const jinghong = abilityBlock(abilities, 'jing_hong_you_long');

  expect(jinghong).toContain('type: "PHYSICAL_DODGE", chance: 0.65');
  expect(jinghong).not.toContain('type: "DODGE", chance: 0.65');
  expect(guards).toContain('if (damageType === "外功")');
  expect(guards).toContain('sumChances(target, "PHYSICAL_DODGE")');
});

test('Shifang remains targetable, clears existing targeters, avoids combat entry, and keeps consumables from breaking it', async () => {
  const abilities = readFile(abilitiesPath);
  const gameLoop = readFile(gameLoopPath);
  const combatStatus = readFile(combatStatusPath);
  const validateAction = readFile(validateActionPath);
  const consumableService = readFile(consumableServicePath);
  const arenaScene = readFile(arenaScenePath);
  const character = readFile(characterPath);
  const shifang = abilityBlock(abilities, 'shi_fang_xuan_ji');

  expect(shifang).toContain('requiresGrounded: false');
  expect(shifang).toContain('channelCancelOnJump: false');
  expect(shifang).toContain('type: "INVULNERABLE"');
  expect(shifang).not.toContain('type: "UNTARGETABLE"');
  expect(gameLoop).toContain('ch.abilityId === "shi_fang_xuan_ji"');
  expect(gameLoop).toContain('clearTargetSelectionsTargetingPlayer(this.state, player.userId)');
  expect(combatStatus).toContain('if (event.abilityId === "shi_fang_xuan_ji") return false;');
  expect(validateAction).toContain('const SHI_FANG_XUAN_JI_BUFF_ID = 2642;');
  expect(validateAction).toContain('throw new Error("ERR_SELECT_ENEMY_TARGET");');
  expect(validateAction).toContain('isFriendlyTargetAbility && !ignoreTargetAllegiance && hasShiFangXuanJi(player as any)');
  expect(consumableService).not.toContain('SHI_FANG_XUAN_JI_BUFF_ID');
  expect(arenaScene).toContain('const oppShiFang = hasShiFangXuanJiBuff(opp.buffs);');
  expect(arenaScene).toContain("color={oppShiFang ? '#2acb6b'");
  expect(arenaScene).toContain("nameColorOverride={oppYumenSpectator ? '#b7b7b7' : (oppShiFang ? '#7cffb0' : undefined)}");
  expect(character).toContain("color={nameColorOverride ?? (isSelected ? '#ff99bb' : '#ff3333')}");
});

test('Xinzheng Songyan is official, stacks on tick, lasts 99s, and is removed when Xinzheng ends', async () => {
  const abilities = readFile(abilitiesPath);
  const applyBuffs = readFile(applyBuffsPath);
  const gameLoop = readFile(gameLoopPath);
  const xinzheng = abilityBlock(abilities, 'xinzheng');

  expect(xinzheng).toContain('buffId: 1018');
  expect(xinzheng).toContain('durationMs: 99_000');
  expect(xinzheng).toContain('maxStacks: 30');
  expect(applyBuffs).toContain('ability.id === "xinzheng" && buff.buffId === 1018');
  expect(gameLoop).toContain('const XINZHENG_CHANNEL_BUFF_ID = 1017;');
  expect(gameLoop).toContain('const XINZHENG_SONG_YAN_BUFF_ID = 1018;');
  expect(gameLoop).toContain('const songYanBuff = (ability as any)?.buffs?.find((entry: any) => entry?.buffId === XINZHENG_SONG_YAN_BUFF_ID);');
  expect(gameLoop).toMatch(/if \(buff\.sourceAbilityId === XINZHENG_ABILITY_ID\) \{\s*addXinzhengSongYanStack\(this\.state, player as any\);\s*\}/);
  expect(gameLoop).toContain('if (!hasActiveXinzhengChannelBuff(player as any, now)) {');
  expect(gameLoop).toContain('removeXinzhengSongYanStacks(this.state, player as any)');
});

test('heal events use the effective heal amount even when HP is already full', async () => {
  const health = readFile(healthPath);

  expect(health).toMatch(/target\.hp = Math\.min\(getMaxHp\(target\), target\.hp \+ heal\);\s*return heal;/);
});

test('Fenglai schedules eight ticks before its five-second expiry', async () => {
  const abilities = readFile(abilitiesPath);
  const fenglai = abilityBlock(abilities, 'fenglai_wushan');

  expect(fenglai).toContain('durationMs: 5_000');
  expect(fenglai).toContain('periodicMs: 625');
  expect(fenglai).toContain('periodicStartImmediate: true');
});

test('Yinyue DOT base duration is twelve seconds', async () => {
  const abilities = readFile(abilitiesPath);
  const yinyue = abilityBlock(abilities, 'yin_yue_zhan');

  expect(yinyue).toContain('durationMs: 12_000');
  expect(yinyue).toContain('periodicMs: 2_000');
});

test('Mi Xin Gu grants lockout and interrupt immunity via SILENCE_IMMUNE', async () => {
  const abilities = readFile(abilitiesPath);
  const mixingu = abilityBlock(abilities, 'mi_xin_gu');

  expect(mixingu).toContain('{ type: "LOCKOUT_IMMUNE" }');
  expect(mixingu).toContain('{ type: "SILENCE_IMMUNE" }');
});

test('Sanliu dash arc uses discrete end-at-ground math for the full parabola', async () => {
  const abilities = readFile(abilitiesPath);
  const directionalDash = readFile(directionalDashPath);
  const sanliu = abilityBlock(abilities, 'sanliu_xia');

  expect(sanliu).toContain('arcPeakHeight: 2.5');
  expect(directionalDash).toContain('const velocityFactor = (totalTicks - 1) / 2;');
  expect(directionalDash).toContain('const peakFactor = Math.max(1, (peakStep * velocityFactor) - ((peakStep * (peakStep - 1)) / 2));');
  expect(directionalDash).toContain('forceVzPerTick = g * velocityFactor;');
});

test('Fuguang can be cast while controlled but cannot keep stealth under non-slow control', async () => {
  const abilities = readFile(abilitiesPath);
  const buffRuntime = readFile(buffRuntimePath);
  const fuguang = abilityBlock(abilities, 'fuguang_lueying');

  expect(fuguang).toContain('allowWhileControlled: true');
  expect(buffRuntime).toContain('const NON_SLOW_CONTROL_BREAK_TYPES = ["ROOT", "CONTROL", "ATTACK_LOCK", "KNOCKED_BACK", "PULLED", "SILENCE", "NON_QINGGONG_LOCK"]');
  expect(buffRuntime).toContain('const FUGUANG_MIN_VISIBLE_MS = 100;');
  expect(buffRuntime).not.toContain('NON_SLOW_CONTROL_BREAK_TYPES = ["SLOW"');
  expect(buffRuntime).toContain('const shouldKeepFuguangBriefly = (buff: ActiveBuff) => {');
  expect(buffRuntime).toContain('const minExpireAt = appliedAt + FUGUANG_MIN_VISIBLE_MS;');
  expect(buffRuntime).toContain('removeFuguangIfCurrentControl');
  expect(buffRuntime).toContain('active.buffId === FUGUANG_LUEYING_BUFF_ID || active.buffId === DUNYING_COMPANION_BUFF_ID');
});

test('temporary grappling hook refunds forty seconds outside combat', async () => {
  const playService = readFile(playServicePath);
  const battleArena = readFile(battleArenaPath);

  expect(playService).toMatch(/ability\.id === "lin_shi_fei_zhua" && \(player as any\)\.inCombat !== true[\s\S]*played\.cooldown = Math\.max\(0, \(played\.cooldown \?\? 0\) - \(40 \* 30\)\)/);
  expect(battleArena).toContain('const suppressDashPredictionWhileRooted = rootedByDebuff && ad?.ccStopsMe === true;');
  expect(battleArena).toContain('const suppressDashPredictionWhileRooted = rootedByDebuff && activeDash?.ccStopsMe === true;');
});

test('Tiyun has separate combat and out-of-combat runtime paths', async () => {
  const abilities = readFile(abilitiesPath);
  const applyBuffs = readFile(applyBuffsPath);
  const immediateEffects = readFile(immediateEffectsPath);
  const movement = readFile(movementPath);
  const combatStatus = readFile(combatStatusPath);
  const tiyun = abilityBlock(abilities, 'ti_yun_zong');

  expect(tiyun).toContain('buffId: 9003');
  expect(tiyun).toContain('buffId: 9004');
  expect(tiyun).toContain('durationMs: 30_000');
  expect(applyBuffs).toContain('ability.id === "ti_yun_zong"');
  expect(immediateEffects).toContain('const sourceInCombat = (source as any).inCombat === true;');
  expect(immediateEffects).toContain('const buffId = sourceInCombat ? 9004 : 9003;');
  expect(movement).toContain('buff.buffId !== 9004');
  expect(combatStatus).toContain('TI_YUN_ZONG_OUT_OF_COMBAT_BUFF_ID');
});

test('Ting Lei lasts until combat exit and is explicitly removed there', async () => {
  const abilities = readFile(abilitiesPath);
  const combatStatus = readFile(combatStatusPath);
  const tinglei = abilityBlock(abilities, 'ting_lei');

  expect(tinglei).toContain('buffId: 2322');
  expect(tinglei).toContain('durationMs: 9_999_000');
  expect(combatStatus).toContain('const TING_LEI_BUFF_ID = 2322;');
  expect(combatStatus).toContain('removeCombatStatusBuffs(state, player, timestamp, [TING_LEI_BUFF_ID])');
});

test('C panel crit display applies buff stack counts for typed crit bonuses', async () => {
  const battleArena = readFile(battleArenaPath);

  expect(battleArena).toContain('const stackCount = Math.max(1, Number(buff?.stacks ?? 1));');
  expect(battleArena).toContain('return sum + (buffContribution * stackCount);');
});

test('buff tooltip hides remaining time when status-bar timer is hidden', async () => {
  const statusBar = readFile(statusBarPath);
  const statusHint = readFile(statusHintPath);

  expect(statusBar).toContain('const showRemainingTime = showTimers && !b.hideTimer;');
  expect(statusBar).toContain('showRemainingTime={activeHint.showRemainingTime}');
  expect(statusHint).toContain('showRemainingTime?: boolean;');
  expect(statusHint).toContain('showRemainingTime = true');
  expect(statusHint).toContain('{showRemainingTime && (');
});
