# Control Rules Notes

Purpose: persist the requested 2026-04-17 control-system redesign before implementation so future code changes stay aligned.

## Status

- No hard contradictions were found inside the requested design.
- There are several implementation boundary cases that still need confirmation; they are listed under Clarification Points.
- This file describes the target design, not the current server behavior.

## Current code baseline vs target redesign

- Current code still uses the old four-tier model: ROOT and SLOW as level 0, CONTROL and ATTACK_LOCK as level 1, KNOCKED_BACK as level 2, and SILENCE as level 3.
- Current code conflates most stun-like states and knockdown into CONTROL, except mohe_wuliang knockdown which is special-cased by buff id and source ability.
- Current code has no diminishing-returns system, no per-control resistance stacks, no pull control, and no dedicated freeze effect.
- Current movement code preserves airborne XY momentum when input is blocked, so live root, stun, and knockback do not currently force an immediate straight-down fall. The redesign explicitly requires root, stun, and freeze to kill horizontal carry and start falling.
- Current knockback is implemented as forced displacement plus a short KNOCKED_BACK buff. The redesign instead treats pull and knockback as dash-state controls with forced travel time, cast lock, and control immunity during the movement.
- Current silence is treated like a control tier. The redesign moves silence into the separate lockout system.

## Canonical terms

- Controls: movement or state-control effects that stop movement, forced-move the target, or prevent action because the target is controlled.
- Lockouts: cast-school restrictions that stop certain categories of skills but do not count as controls.
- Dashing: a movement state. During dash, the unit cannot cast anything and is immune to controls, but is not immune to lockouts.
- Remove control: the standard escape path from eligible control states.
- Can cast while controlled: must exist both in text and in code. Description text alone is not authoritative. Runtime must carry the explicit flag.

## Control type 0: root 锁足

- Root prevents movement.
- Root prevents turning or changing facing direction.
- Root blocks jump input while grounded.
- Root is intended to stop momentum immediately.
- If the target is moving forward in the air and gets rooted, horizontal motion stops at once and the remaining movement becomes straight downward until landing.
- Root uses diminishing returns.
- Successful root applies a 10-second resistance buff, 锁足抗性.
- While 锁足抗性 exists, the next successful root duration is halved.
- Each successful reapplication adds another stack of 锁足抗性, so the reduction sequence is 50 percent, then 75 percent, then 87.5 percent, and so on.
- The intended duration formula is baseDuration multiplied by 0.5 to the power of current resistance stacks.
- Diminishing returns only apply when root actually lands. If root is blocked by immunity or otherwise fails to apply, no reduction should be consumed and no resistance stack should be added.
- Each successful root refreshes the full shared 10-second timer for the whole 锁足抗性 stack.

## Slow 减速

- Slow is a common movement debuff, not a hard control tier by itself.
- Slow and root can coexist.
- New root and slow applications fail while a type 1 stun or freeze is active.
- If a target is slowed for 10 seconds and rooted for 3 seconds, the root ends after 3 seconds and the remaining 7 seconds of slow continue normally.

## Control type 1: stun 眩晕 and freeze 定身

- Stun is a hard control.
- While stunned, the target cannot use any ability unless that ability is explicitly marked as can cast while controlled or remove control.
- Stun stops momentum and makes an airborne target start falling immediately, the same way root should.
- Freeze is currently a placeholder but should behave the same as stun for now.
- Freeze also uses diminishing returns.
- Stun and freeze are the same priority level.
- Stun and freeze keep separate resistance buffs instead of sharing one resistance family.
- Applying stun over freeze, or freeze over stun, overwrites the existing type 1 control instead of stacking it.
- The overwrite rule is replacement, not extension. A shorter new type 1 control can replace a longer remaining old one.
- Pull and knockback remove active type 1 control before applying their own forced movement.

## Control type 2: knockdown 击倒

- Knockdown does not use diminishing returns.
- Knockdown cannot be overwritten by type 0, type 1, or type 3 controls.
- While knockdown is active, no other control should apply.
- If the target is already knocked down, another knockdown has no effect.
- When knockdown expires, the next knockdown can apply at full duration.
- While knocked down, the target can only use abilities that are explicitly allowed while controlled or that remove control.

## Control type 3: pull 拉 and knockback 推

- Pull and knockback are controls built on top of the dash concept.
- During pull or knockback travel, the target is considered to be dashing.
- While dashing, the target cannot cast anything.
- While dashing, the target is immune to all controls.
- While dashing, the target is not immune to lockouts.
- A second incoming pull or knockback fails during this dash-state control immunity.
- Enemy pull and enemy knockback both create this dash-state behavior.
- A pull or knockback should define at least distance and total travel time.
- Example intent: a push of 5 units in 2 seconds means the target travels those 5 units over those 2 seconds, remains in dash state for the full travel, cannot cast during that time, and cannot be controlled during that time.

## Lockouts

- 封内: cannot cast 内功 skills.
- 封外: cannot cast 外功 skills.
- 封轻功: cannot cast 轻功 skills.
- 缴械: combination of 封内 and 封外.
- 沉默: highest lockout tier. Cannot cast 内功, 外功, or 轻功 skills.
- Lockouts are not controls.
- Lockouts and controls can coexist.
- Consumables are not skills, so lockouts do not block them.
- Consumables should still be blocked by controls unless a future consumable is explicitly allowed while controlled.

## Relationship between controls and lockouts

- Controls and lockouts do not conflict with each other.
- They are separate layers and may be combined intentionally.
- A player may be stunned and silenced at the same time.
- Stun prevents normal casting but still leaves room for remove-control abilities.
- Silence can be combined with stun to also block the remove-control skill if that skill belongs to a silenced category.

## Diminishing-returns rule

- Diminishing returns exist to stop repeated control loops from the same control family.
- Root uses diminishing returns.
- Stun uses diminishing returns.
- Freeze uses diminishing returns.
- Knockdown does not use diminishing returns.
- Pull and knockback were not described as using diminishing returns, so current design intent is no diminishing returns for type 3 unless specified later.
- Diminishing returns only advance when the control actually works.
- Failed control due to immunity, cleanse immunity, or any other prevention should not create future duration reduction.

## Clarification points resolved

- Root does block jump input while grounded.
- Root resistance uses one shared stack timer, and each successful reapplication refreshes that timer back to 10 seconds.
- Stun and freeze use separate resistance buffs.
- Root and slow fail if the target is already under type 1 stun or freeze.
- A second pull or knockback fails during active type 3 dash-state control immunity.

## Ability-pool mapping and examples

### Controls currently present in the live ability pool

- Type 0 root: no live root ability yet.
- Slow: jianpo_xukong currently applies a 20 percent slow and qinggong seal.
- Type 1 stun: shengsi_jie, da_shizi_hou, leizhenzi, and dican_longxiang are live stun examples.
- Type 1 freeze: no live freeze ability yet.
- Type 2 knockdown: mohe_wuliang is the current knockdown example.
- Type 3 knockback: wu_jianyu is the current knockback example.
- Type 3 pull: no live pull ability yet.

### Escape or override examples currently present in the live ability pool

- Remove-control examples: jiru_feng, sanliu_xia, zhuan_qiankun, dienong_zu, xinglou_yueying, duangu_jue, and guchong_xianji.
- Can-cast-while-controlled example that is not a cleanse: anchen_misan currently carries the runtime allowWhileControlled flag on its DRAW effect.
- Self-dash examples that already express part of the dash idea: nieyun_zhuyue, qionglong_huasheng, and taxingxing.

### Lockout examples currently present in the live ability pool

- Silence example: chan_xiao.
- 封轻功-like example: jianpo_xukong currently applies qinggong seal.
- 封内, 封外, and 缴械 do not yet exist as dedicated live abilities.

### Concrete understanding examples using current abilities

- Example 1: jianpo_xukong slow plus future root. Today jianpo_xukong already provides the slow half of the rule. Under the redesign, if a future root lands during that slow, root should stop movement and facing immediately, but when root ends the remaining slow time should still continue.
- Example 2: shengsi_jie stun into wu_jianyu knockback. Under the redesign, the target first enters type 1 stun. When wu_jianyu's timed knockback fires, it should remove the stun first, then apply type 3 knockback travel. During that forced travel the target cannot cast anything and is immune to further controls.
- Example 3: shengsi_jie stun into mohe_wuliang knockdown. Under the redesign, mohe_wuliang should replace the stun with type 2 knockdown. While knockdown is active, later root, stun, freeze, pull, and knockback attempts should all fail. If mohe_wuliang reaches its natural end and the low-health condition is met, the follow-up 2-second stun should then apply as a fresh type 1 control after knockdown has ended.
- Example 4: stun plus silence lockdown. shengsi_jie provides the control portion and chan_xiao provides the lockout portion. This is the intended combo case: the target is controlled by stun and also locked out by silence, so even a remove-control skill can be blocked if its skill category is covered by silence.
- Example 5: remove-control while under control. If the target is stunned by leizhenzi, a skill like zhuan_qiankun or jiru_feng should still be legal because it is explicitly a remove-control tool. If the same target is also silenced by chan_xiao, then the lockout layer may still block that skill depending on its school tagging.
- Example 6: self-dash and enemy-forced dash should follow the same dash-state principle. nieyun_zhuyue, qionglong_huasheng, and taxingxing already express the self-dash side. wu_jianyu should become the enemy-forced version of the same concept: while the knockback travel is happening, the target cannot cast and cannot be controlled.

## Working summary of intent

- Root is a movement-and-facing shutdown with diminishing returns and momentum kill.
- Slow is separate and can coexist with root.
- Stun and freeze are the same hard-control family for behavior and overwrite priority.
- Knockdown is the highest hard control and blocks all other controls while active.
- Pull and knockback are forced-movement controls implemented through dash state.
- Silence belongs to lockouts, not controls.
- Controls and lockouts are designed to stack for deliberate lockdown play.
