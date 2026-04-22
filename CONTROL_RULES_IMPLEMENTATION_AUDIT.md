# Control Rules Implementation Audit

Date: 2026-04-17

Scope:
- Official gameplay mode: collision-test
- Authoritative runtime: backend/game/abilities/abilities.ts, backend/game/engine, backend/game/services/gameplay/playService.ts
- Legacy note only: backend/game/cards/cards.ts and validatePlayAbility are not the main source of truth for active gameplay

## High-Level Answer

Your current control system is still much closer to the old four-tier model than to the redesign in CONTROL_RULES_NOTES.md.

- Fully live today:
  - Current cast blocking for CONTROL / ATTACK_LOCK / KNOCKED_BACK / SILENCE
  - QINGGONG_SEAL blocking qinggong-tagged skills
  - CLEANSE removing level-1 control and optionally ROOT / SLOW
  - CONTROL_IMMUNE / ROOT_SLOW_IMMUNE / SILENCE_IMMUNE filtering
  - allowWhileControlled runtime flags
- Partially live:
  - ROOT behavior
  - SLOW behavior
  - Generic stun behavior
  - Knockdown behavior
  - Knockback behavior
  - Control vs lockout separation
- Missing from live gameplay:
  - Freeze as its own effect family
  - Pull as its own effect family
  - School-based lockouts for 封内 / 封外 / 缴械
  - Ability school tagging needed for those lockouts
  - General type-3 forced-dash control system

## Status Matrix

| Spec Area | Status | Current Runtime State | Key Evidence |
|---|---|---|---|
| Control vs lockout layer split | Partial | Silence is still treated as a universal cast block, not a school-based lockout layer. QINGGONG_SEAL exists, but 封内 / 封外 / 缴械 do not. | backend/game/engine/rules/validateAction.ts, backend/game/engine/state/types/abilities.ts |
| Root | Partial | ROOT exists as an effect type and movement code now stops grounded momentum plus directional airborne carry while preserving a pure upward-jump rise. Root DR scaffolding and visible resistance-buff metadata now exist, but there is still no live root ability to exercise it. | backend/game/engine/state/types/effects.ts, backend/game/engine/loop/movement.ts, backend/game/engine/effects/buffRuntime.ts, backend/game/abilities/abilityPreload.ts |
| Slow | Partial | SLOW works as a speed reduction and current abilities apply it. There is no logic that blocks new ROOT / SLOW while type-1 stun is active. | backend/game/engine/loop/movement.ts, backend/game/engine/effects/buffRuntime.ts |
| Stun | Partial | CONTROL already blocks cast, movement, facing, and jump. Movement now forces immediate stop/fall for grounded and directional airborne travel, with the same pure upward-jump exception as root. Visible stun DR buffs now exist and halve duration by $0.5^{stacks}$, but freeze still has no separate family. | backend/game/engine/loop/movement.ts, backend/game/engine/rules/validateAction.ts, backend/game/engine/effects/buffRuntime.ts, backend/game/abilities/abilityPreload.ts |
| Freeze | Missing | There is no FREEZE effect type, no freeze abilities, and no freeze-specific resistance or overwrite rules. | backend/game/engine/state/types/effects.ts, backend/game/abilities/abilities.ts |
| Stun / freeze overwrite rules | Missing | Current code does not define a generic type-1 family with overwrite behavior. Only mohe_wuliang and wu_jianyu contain narrow special-case control replacement logic. | backend/game/engine/effects/buffRuntime.ts, backend/game/engine/loop/GameLoop.ts |
| Knockdown as type 2 | Partial | mohe_wuliang is treated as a special-case knockdown by buffId and source ability, not as a generic control type. Reapplying it refreshes duration instead of doing nothing. | backend/game/engine/effects/buffRuntime.ts, backend/game/engine/loop/GameLoop.ts |
| Knockdown blocks all other controls | Partial | While mohe knockdown is active, incoming ROOT / CONTROL / ATTACK_LOCK / KNOCKED_BACK are filtered. SLOW is not filtered. | backend/game/engine/effects/buffRuntime.ts |
| Knockdown natural end into stun | Implemented | mohe_wuliang applies a follow-up 2 second CONTROL debuff if the target is below 30 percent HP when knockdown naturally expires. | backend/game/engine/loop/GameLoop.ts |
| Pull / knockback as type 3 forced dash | Partial | No pull exists. wu_jianyu now routes through a shared type-3 knockback helper that respects knockback immunity, rejects a second active knockback, and removes stun before pushing, but the movement is still an instant shove rather than timed forced travel. | backend/game/engine/loop/GameLoop.ts |
| Knockback removes active type-1 control first | Partial | wu_jianyu now removes stun-style CONTROL debuffs through the shared knockback helper before pushing. This is still not a generic effect-type family for all future knockback abilities. | backend/game/engine/loop/GameLoop.ts |
| While being knocked back, cannot cast | Implemented in current old model | KNOCKED_BACK blocks casts in validation unless the ability has allowWhileKnockedBack. No live ability currently ships with that flag enabled by default. | backend/game/engine/rules/validateAction.ts |
| Type-3 dash immunity to second pull / knockback | Partial | wu_jianyu now rejects a second knockback while KNOCKED_BACK is active, but the engine still does not run a real timed dash-state control immunity system for type 3 travel. | backend/game/engine/loop/GameLoop.ts |
| Knockback immunity | Implemented for wu_jianyu path | KNOCKBACK_IMMUNE now blocks wu_jianyu knockback as well as regular buff-applied knockback paths. | backend/game/engine/rules/guards.ts, backend/game/engine/loop/GameLoop.ts |
| Root / slow immunity | Implemented | ROOT_SLOW_IMMUNE filters incoming ROOT and SLOW buff effects from enemy sources. | backend/game/engine/effects/buffRuntime.ts |
| Control immunity | Implemented | CONTROL_IMMUNE filters incoming CONTROL and ATTACK_LOCK effects from enemy sources. | backend/game/engine/effects/buffRuntime.ts |
| Silence immunity | Implemented | SILENCE_IMMUNE filters incoming SILENCE effects from enemy sources. | backend/game/engine/effects/buffRuntime.ts |
| Cleanse remove-control behavior | Implemented for old model | Cleanse removes CONTROL and ATTACK_LOCK, and removes ROOT / SLOW only if cleanseRootSlow is true. It does not remove mohe knockdown, KNOCKED_BACK, or SILENCE. | backend/game/engine/effects/definitions/Cleanse.ts |
| Can cast while controlled flag | Implemented | Validation honors ability-level and effect-level allowWhileControlled. | backend/game/engine/rules/validateAction.ts |
| Can cast while knocked back flag | Implemented in validation only | Validation honors allowWhileKnockedBack, but the current live ability pool does not meaningfully exercise it by default. | backend/game/engine/rules/validateAction.ts, backend/game/engine/state/types/abilities.ts |
| Diminishing returns and resistance stacks | Partial | Visible 10-second root/stun resistance buffs now exist and duration halving is wired for incoming ROOT and stun-style CONTROL. Knockdown does not consume stun DR. Freeze DR is still missing because there is no FREEZE family yet. | backend/game/engine/effects/buffRuntime.ts, backend/game/abilities/abilityPreload.ts |
| School-based silence / lockouts | Missing | Abilities do not have 内功 / 外功 school tags, and validation has no school-specific lockout checks. Silence simply blocks all casts. | backend/game/engine/state/types/abilities.ts, backend/game/engine/rules/validateAction.ts |

## Important Current Gaps

### 1. Root and stun now follow the corrected upward-jump exception, but the wider redesign is still missing

Current movement now forces immediate stop on grounded movement and directional airborne travel under ROOT or CONTROL, but it intentionally preserves a pure upward-jump rise.

- This matches the corrected rule you gave, not the earlier straight "always kill airborne momentum" audit wording.
- There is still no live root ability and no freeze family.

Evidence:
- backend/game/engine/loop/movement.ts now forces stop/fall through applyForcedControlFall().
- The same file preserves only pure upward-jump rise via isPureUpwardJumpRise().

### 2. Silence is not the new lockout system

Current silence is still a hard universal cast stop. It is not split into school-based lockouts.

- There is no 内功 / 外功 / 轻功 school matrix.
- QINGGONG_SEAL is the only school-like restriction currently wired.
- A silenced remove-control ability is always blocked, not conditionally blocked by skill school.

### 3. Knockdown is still mohe-specific

The code does not have a generic knockdown effect family.

- mohe_wuliang knockdown is recognized by buffId 1002 and source ability mohe_wuliang.
- Reapplying mohe refreshes the buff because same-buff replacement still happens.
- That does not match the redesign rule that a second knockdown should have no effect while knockdown is active.

### 4. wu_jianyu knockback is still not a real type-3 forced dash

Current wu_jianyu knockback does this:

- remove active stun-style CONTROL debuffs
- reject targets with KNOCKBACK_IMMUNE
- reject a second incoming knockback while KNOCKED_BACK is active
- instantly move the target position by knockbackUnits
- add a short KNOCKED_BACK buff for knockbackSilenceMs

It does not do this:

- timed forced travel over a duration
- target dash state
- target control immunity during travel

### 5. wu_jianyu timing and follow-up interaction are now partially normalized

- wu_jianyu remains a 10-second buff.
- The three front-cone hits fire at t+2s, t+3s, and t+4s.
- The final 360-degree hit plus knockback also fires at t+4s.
- Delayed follow-up strikes are now handled through a whitelist-style stealth-break hook instead of a one-off hardcoded branch.
- That hook is still stealth-only; it does not create a general triggered-attack channel-break system.

### 6. DR is now visible and testable, but only for live root/stun families

- Stun DR now creates a visible 10-second resistance buff with stacks.
- That visible resistance buff is the only DR counter; once it is gone, the next stun starts back at 1 stack.
- Knockdown does not consume stun DR.
- mohe knockdown's natural follow-up stun now goes through the same buff pipeline, so it can use stun DR correctly after knockdown ends.
- Freeze still has no effect family, so freeze DR is still missing.

## Rechecked Ability Pool

I rechecked the live ability pool in backend/game/abilities/abilities.ts. Only the following current abilities touch control, lockout, cleanse, immunity, or channel interruption behavior.

### Current live control-relevant abilities

| Ability Id | Name | Current control relevance |
|---|---|---|
| jianpo_xukong | 剑破虚空 | Applies SLOW 20% and QINGGONG_SEAL |
| mohe_wuliang | 摩诃无量 | Special-case knockdown via CONTROL buff; natural expiry can add follow-up stun |
| shengsi_jie | 生死劫 | Applies CONTROL stun |
| chan_xiao | 蟾啸 | Applies SILENCE |
| da_shizi_hou | 大狮子吼 | AOE CONTROL stun |
| jiru_feng | 疾如风 | CLEANSE, allowWhileControlled, CONTROL_IMMUNE |
| sanliu_xia | 散流霞 | CLEANSE, allowWhileControlled, dash while controlled, self SILENCE during hidden phase |
| que_ta_zhi | 鹊踏枝 | CLEANSE, allowWhileControlled, CONTROL_IMMUNE |
| qionglong_huasheng | 穹隆化生 | CLEANSE with cleanseRootSlow, dash, self SILENCE, CONTROL_IMMUNE, KNOCKBACK_IMMUNE |
| anchen_misan | 暗尘弥散 | DRAW effect has allowWhileControlled |
| fenglai_wushan | 风来吴山 | Channel buff with CONTROL_IMMUNE and INTERRUPT_IMMUNE |
| wu_jianyu | 无间狱 | Timed strikes now fire at 2s/3s/4s on a full 10-second buff; knockback respects KNOCKBACK_IMMUNE, rejects second active knockback, and removes stun first |
| xinzheng | 心诤 | Reverse channel with CONTROL_IMMUNE and INTERRUPT_IMMUNE |
| nuwa_butian | 女娲补天 | ROOT_SLOW_IMMUNE plus self SLOW |
| taxingxing | 踏星行 | CLEANSE with cleanseRootSlow, dash, self SILENCE, CONTROL_IMMUNE, KNOCKBACK_IMMUNE |
| qiandie_turui | 千蝶吐瑞 | Reverse channel with CONTROL_IMMUNE and INTERRUPT_IMMUNE |
| xiao_zui_kuang | 笑醉狂 | CLEANSE, allowWhileControlled, CONTROL_IMMUNE, INTERRUPT_IMMUNE |
| kong_que_ling | 孔雀翎 | Applies SLOW 50% |
| leizhenzi | 雷震子 | Applies CONTROL stun |
| zhuan_qiankun | 转乾坤 | CLEANSE, allowWhileControlled, CONTROL_IMMUNE, SILENCE_IMMUNE |
| dican_longxiang | 帝骖龙翔 | AOE CONTROL stun |
| dienong_zu | 蝶弄足 | CLEANSE with cleanseRootSlow, allowWhileControlled, CONTROL_IMMUNE |
| xinglou_yueying | 星楼月影 | CLEANSE, allowWhileControlled, CONTROL_IMMUNE |
| duangu_jue | 锻骨诀 | CLEANSE, allowWhileControlled, ROOT_SLOW_IMMUNE, CONTROL_IMMUNE, KNOCKBACK_IMMUNE, SILENCE_IMMUNE |
| guchong_xianji | 蛊虫献祭 | CLEANSE, allowWhileControlled, CONTROL_IMMUNE |
| zhuiming_jian | 追命箭 | Pure forward channel; movement, jump, range, facing, LOS cancellation rules matter |
| changzhen | 长针 | Pure forward channel; movement and jump interruption matter |
| yun_fei_yu_huang | 云飞玉皇 | Pure forward channel; move, jump, range, facing, LOS matter |
| kuang_long_luan_wu | 狂龙乱舞 | Pure forward channel; movement and jump interruption matter |

### No current live ability for these redesign areas

- ROOT application
- FREEZE application
- ATTACK_LOCK application
- Pull application
- 封内
- 封外
- 缴械

## Legacy Divergence To Keep In Mind

- backend/game/cards/cards.ts is legacy turn-based content and should not be treated as the source of truth for collision-test gameplay.
- backend/game/engine/rules/validateAction.ts still has a turn-based validatePlayAbility path, but the active gameplay path is validateCastAbility.

## Test Checklist

Use this as the control-rules regression checklist.

Legend:
- Live: can be tested with the current shipped ability pool
- Harness: needs a temporary dev ability, direct buff injection, or a temporary test command because the live pool cannot exercise it

### A. Cast-blocking and override checks

- [ ] Live: Apply shengsi_jie or leizhenzi to a target and confirm a normal skill like menghu_xiasha fails with ERR_CONTROLLED.
- [ ] Live: Under the same CONTROL, confirm anchen_misan still casts because it has allowWhileControlled.
- [ ] Live: Under the same CONTROL, confirm each remove-control skill can cast: jiru_feng, sanliu_xia, que_ta_zhi, zhuan_qiankun, dienong_zu, xinglou_yueying, duangu_jue, guchong_xianji, xiao_zui_kuang.
- [ ] Live: Apply chan_xiao and confirm all skills are blocked with ERR_SILENCED, including remove-control skills and anchen_misan.
- [ ] Live: Apply jianpo_xukong and confirm qinggong-tagged skills fail with ERR_QINGGONG_SEALED.
- [ ] Live: Confirm a non-qinggong skill is still castable while QINGGONG_SEAL is active.
- [ ] Live: Use wu_jianyu and confirm KNOCKED_BACK blocks normal casting during the short debuff window.
- [ ] Harness: Toggle allowWhileKnockedBack onto a skill in the ability editor or a dev ability, then confirm it can cast during KNOCKED_BACK.

### B. Slow, root, and movement checks

- [ ] Live: Apply jianpo_xukong and confirm move speed is reduced by 20% for the target.
- [ ] Live: Apply kong_que_ling and confirm move speed is reduced by 50% for the target.
- [ ] Live: Apply nuwa_butian or duangu_jue, then confirm incoming slow from jianpo_xukong or kong_que_ling no longer lands.
- [ ] Harness: Add a temporary ROOT ability and confirm grounded movement input is blocked.
- [ ] Harness: With the same ROOT ability, confirm turning input is blocked.
- [ ] Harness: With the same ROOT ability, confirm jump input is blocked while grounded.
- [ ] Harness: Apply ROOT during airborne forward travel and confirm horizontal carry is killed immediately and the target starts falling.
- [ ] Harness: Apply ROOT during a pure upward jump and confirm the upward rise is preserved.
- [ ] Harness: Apply ROOT while grounded and confirm movement stops immediately instead of easing out.

### C. Stun, freeze, and overwrite checks

- [ ] Live: Apply shengsi_jie, da_shizi_hou, leizhenzi, and dican_longxiang one by one and confirm each behaves as full CONTROL.
- [ ] Live: Under CONTROL, confirm movement, facing change, and jump are all blocked.
- [ ] Live: Confirm CLEANSE removes CONTROL.
- [ ] Live: Confirm CONTROL_IMMUNE from jiru_feng, que_ta_zhi, zhuan_qiankun, xinglou_yueying, duangu_jue, guchong_xianji, qionglong_huasheng, taxingxing blocks incoming CONTROL.
- [ ] Harness: Add a temporary FREEZE ability and verify whether it behaves identically to CONTROL in movement and cast validation.
- [ ] Live: Apply shengsi_jie or leizhenzi once and confirm 眩晕抗性 appears with a 10-second timer.
- [ ] Live: Reapply stun within that 10-second window and confirm the new stun duration is halved and the 眩晕抗性 stack increases.
- [ ] Live: Wait until 眩晕抗性 fully expires, then apply stun again and confirm the next stun returns to full duration.
- [ ] Live: Confirm mohe knockdown itself does not create or consume 眩晕抗性.
- [ ] Harness gap-check: Add separate stun and freeze abilities and confirm the current engine still lacks the requested freeze family with separate overwrite handling.

### D. Knockdown checks

- [ ] Live: Apply mohe_wuliang and confirm the target is fully locked like CONTROL.
- [ ] Live: Let mohe_wuliang expire naturally above 30% HP and confirm no follow-up stun appears.
- [ ] Live: Let mohe_wuliang expire naturally below 30% HP and confirm the follow-up 2 second CONTROL buff appears.
- [ ] Live: If 眩晕抗性 is already active, let mohe_wuliang expire naturally below 30% HP and confirm only the follow-up stun is reduced, not the knockdown.
- [ ] Live: While mohe knockdown is active, try to apply shengsi_jie or leizhenzi and confirm the new stun does not land.
- [ ] Live: While mohe knockdown is active, apply chan_xiao and confirm silence can still land, because silence is not filtered by the mohe knockdown special case.
- [ ] Live: While mohe knockdown is active, cast dienong_zu and confirm the knockdown remains.
- [ ] Live gap-check: Reapply mohe_wuliang while the target is still knocked down and record whether the duration refreshes. Current code is expected to refresh rather than do nothing.
- [ ] Harness gap-check: Apply a slow during mohe knockdown and confirm current code still allows SLOW even though the redesign says no other control should apply.

### E. Knockback and type-3 control checks

- [ ] Live: Apply shengsi_jie first, then trigger wu_jianyu knockback and confirm the stun is removed before the target is pushed.
- [ ] Live: Confirm wu_jianyu timed hits now happen at roughly 2 seconds, 3 seconds, and 4 seconds after buff gain.
- [ ] Live: Confirm wu_jianyu immediately changes target position instead of moving the target over time.
- [ ] Live: Confirm wu_jianyu applies KNOCKED_BACK for the short silence window.
- [ ] Live: Apply wu_jianyu to a target with KNOCKBACK_IMMUNE from qionglong_huasheng, taxingxing, or duangu_jue and confirm the push does not happen.
- [ ] Harness: Apply two knockbacks in rapid succession and confirm the second one is rejected while KNOCKED_BACK is active.
- [ ] Harness: Add a temporary pull ability and verify there is no current forced-dash pull system.

### F. Cleanse and immunity checks

- [ ] Live: Confirm jiru_feng, que_ta_zhi, zhuan_qiankun, xinglou_yueying, duangu_jue, guchong_xianji, and xiao_zui_kuang remove CONTROL.
- [ ] Live: Confirm dienong_zu, qionglong_huasheng, and taxingxing remove SLOW because they use cleanseRootSlow.
- [ ] Live: Confirm those same cleanseRootSlow abilities still do not remove SILENCE.
- [ ] Live: Confirm duangu_jue and zhuan_qiankun block incoming SILENCE because of SILENCE_IMMUNE.
- [ ] Live: Confirm nuwa_butian and duangu_jue block incoming SLOW because of ROOT_SLOW_IMMUNE.
- [ ] Harness: Add a temporary ATTACK_LOCK source and confirm CLEANSE removes it and CONTROL_IMMUNE blocks it.

### G. Lockout-system gap checks

- [ ] Live: Confirm silence blocks every ability regardless of any missing school tag, showing the current system is universal rather than school-based.
- [ ] Harness: Add temporary 内功 and 外功 ability school tags plus temporary 封内 / 封外 / 缴械 buffs, then verify the requested lockout matrix. This cannot be fully tested with the current data model.

### H. Channel interruption and control-adjacent checks

- [ ] Live: Confirm zhuiming_jian, changzhen, yun_fei_yu_huang, and kuang_long_luan_wu cancel on movement when configured.
- [ ] Live: Confirm zhuiming_jian, changzhen, yun_fei_yu_huang, and kuang_long_luan_wu cancel on jump when configured.
- [ ] Live: Confirm zhuiming_jian and yun_fei_yu_huang cancel when target leaves range.
- [ ] Live: Confirm zhuiming_jian and yun_fei_yu_huang cancel when target leaves the 180 degree facing arc.
- [ ] Live: Confirm zhuiming_jian and yun_fei_yu_huang cancel when LOS is blocked.
- [ ] Live: Confirm pure active channels are interrupted by silence.
- [ ] Live: Confirm fenglai_wushan, xinzheng, qiandie_turui, and xiao_zui_kuang keep channeling through incoming CONTROL because they carry INTERRUPT_IMMUNE and CONTROL_IMMUNE.
- [ ] Live: Confirm fenglai_wushan blocks jump input while active.

### I. Stealth interaction checks

- [ ] Live: Confirm incoming CONTROL breaks 浮光掠影 and 天地无极 stealth.
- [ ] Live: Confirm incoming control does not break 暗尘弥散 stealth.
- [ ] Live: Confirm wu_jianyu knockback also breaks 浮光掠影 and 天地无极 stealth.

### J. Missing-feature harness list

These redesign items cannot be fully validated against the live pool without temporary test content:

- [ ] Root application ability
- [ ] Freeze application ability
- [ ] Pull application ability
- [ ] ATTACK_LOCK application ability
- [ ] Freeze-specific diminishing returns and resistance-buff family
- [ ] 封内 / 封外 / 缴械 school-lockout abilities
- [ ] Ability school tags for 内功 / 外功

## Suggested Priority Order For Real Implementation Work

1. Split silence out of the control-tier mental model and add explicit skill-school lockout tagging.
2. Add a real generic knockdown / freeze / pull / knockback control taxonomy instead of mohe and wu_jianyu special cases.
3. Add DR stack families and timers for root, stun, and freeze.
4. Fix movement so root and stun actually kill momentum immediately.
5. Update frontend prediction in BattleArena.tsx in the same session as backend movement changes.