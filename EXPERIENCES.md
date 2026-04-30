# Zhenchuan — Experiences Log

Record all problems solved, unresolved issues, and disproved approaches here.
Each entry goes under its relevant section header.

## In React render scope, do not derive from a state variable before that state is declared (2026-04-30)

**Problem**: BattleArena crashed on load with `ReferenceError: Cannot access '<minified name>' before initialization` immediately after the Hong Meng overlay changes.

**Root causes**:
- A derived constant for the overlay visibility was declared before the `blueprintMode` state that it referenced.
- `const` bindings in component render scope still obey temporal dead zone rules, so the entire render crashed before WebSocket or Three.js could stabilize.

**Fix**:
- Moved the derived `hongMengOverlayActive` flag below the `blueprintMode` state declaration.

**Key lesson**: In large React components, treat render-scope derived flags like ordinary `const` variables. If they read from a state variable or later `const`, they must be declared after that dependency or the runtime will hard-crash in production.

## For blackout effects, keep the blackout and self-only layers mounted so activation does not flash or hide self (2026-04-30)

**Problem**: The initial solid-black plus self-only overlay still behaved poorly on activation: the blackout could appear before the self layer was ready, and the self-only layer could inherit local camera fade behavior.

**Root causes**:
- Conditionally mounting the blackout/self overlay layers on buff activation introduces timing artifacts because the blackout becomes visible before the second canvas has rendered the avatar.
- Reusing the local character renderer without disabling camera fade lets the self-only layer fade the avatar out, which defeats the point of keeping self visible above blackout.

**Fix**:
- Kept both Hong Meng overlay layers mounted at all times and toggled them with visibility/opacity instead of mounting them on demand.
- Forced the self-only overlay canvas to clear with alpha 0 and disabled camera-fade behavior for the self-only render path.

**Key lesson**: For "black screen but still see self," treat blackout and self-render as persistent layers. Do not mount them lazily at effect start, and do not let the self-only layer reuse fade rules meant for the normal camera-clipping case.

## A blackout hole reads like a spotlight; if only self should remain, render self above a solid blackout instead (2026-04-30)

**Problem**: A tracked transparent hole around the player technically preserved self during 鸿蒙天禁, but visually it looked like a spotlight cutout in the middle of the screen, which was not the intended effect.

**Root causes**:
- A hole in the blackout exposes everything inside that region, including leftover ground color and surrounding scene context, so the effect reads as "looking through a tunnel" instead of "the screen is black except self."
- The requirement was not to reveal an area around the player; it was to keep only the player visible.

**Fix**:
- Removed the tracked hole from the blackout overlay.
- Kept the blackout fully opaque and added a separate transparent overlay canvas that renders only the local character above the blackout and below HUD/UI.

**Key lesson**: If the effect should keep only the avatar visible, do not punch a hole through the blackout. Use a solid blackout and re-render the avatar in a higher visual layer.

## If off-map space is still visible, scene hiding is not enough; add a viewport blackout layer (2026-04-30)

**Problem**: Hiding terrain, GLBs, and other actors was not enough for 鸿蒙天禁 because the player could still see the yellow off-map background outside the exported map. The requirement was to cover the screen, not just remove world meshes.

**Root causes**:
- Scene-layer hiding only affects known world render layers; it does not cover empty or off-map canvas space.
- A plain fullscreen blackout would cover the local character too, which conflicts with the requirement to keep self and HUD visible.

**Fix**:
- Kept the scene-layer hiding for world content, but added a fullscreen blackout overlay above the canvas and below HUD/UI.
- Preserved self with a separately rendered self-only layer above the blackout rather than trying to reveal a window through the blackout.

**Key lesson**: When the requirement is "cover the screen except self and UI," scene hiding alone is insufficient. Cover the viewport explicitly, then solve self visibility in a separate higher layer.

## Backend-only target-buff cast bans should usually be mirrored in frontend readiness too (2026-04-30)

**Problem**: After moving 鸿蒙天禁's 曙色 restriction into backend validation, the skill was still shown as castable on the frontend. The user wanted the frontend to gray it out as well.

**Root causes**:
- The authoritative rule was fixed on the backend, but BattleArena's local readiness logic and click-time guard still treated 曙色 targets as valid.
- That mismatch leaves the user with a cast button that looks usable until the server rejects it.

**Fix**:
- Added a local `hasShuSeClient()` helper and used it in both BattleArena's `isAbilityReady()` path and the direct cast wrapper for `hong_meng_tian_jin`.

**Key lesson**: When a cast ban depends on a visible target buff, mirror it in frontend readiness whenever possible. The backend remains authoritative, but the client should still gray out obviously invalid casts instead of waiting for a round-trip rejection.

## If the player should still see self and HUD, blind the world at the scene layer instead of painting over the viewport (2026-04-30)

**Problem**: The fullscreen blackout solved "hide everything" too literally. The user only wanted terrain / house GLBs / other players-NPCs gone, while still seeing their own character and all UI.

**Root causes**:
- A viewport-wide black overlay has no notion of self-vs-world separation, so it inevitably hides the local character along with the terrain.
- In collision-test, the exported map renderer also owns pointer raycasts, so simply removing the whole map component would risk breaking ground targeting.

**Fix**:
- Removed the fullscreen blackout overlay from `BattleArena.tsx`.
- Added a local blind-world mode that blacks the canvas background, keeps self rendering, filters out other actors as before, and tells `ArenaScene` / `ExportedMapScene` / `Ground` to hide only world visuals while keeping pointer-hit surfaces active.

**Key lesson**: When an effect should hide the world but not the player avatar or HUD, solve it where the world layers are composed. A scene-layer visual gate is the right abstraction; a fullscreen overlay is too blunt.

## If a buff should make a target ineligible for a cast, reject it in validateAction instead of silently no-oping the effect (2026-04-30)

**Problem**: 鸿蒙天禁 was supposed to be unusable on targets that already had 曙色, but the only guard lived inside the custom `HONG_MENG_TIAN_JIN` immediate-effect handler. That meant the action could still pass validation and begin execution before the effect quietly aborted.

**Root causes**:
- The 曙色 check was happening too late in the cast pipeline, after normal validation had already accepted the target.
- A late `break` inside custom effect execution does not behave like a true cast rejection; it only skips the manual buff application.

**Fix**:
- Added a narrow `hong_meng_tian_jin` target-buff check in `validateAction.ts` that throws `ERR_BLOCKED_BY_BUFF` when the selected target already has active 曙色.

**Key lesson**: If a target buff should make an ability uncastable, enforce it in the authoritative validation phase. Effect-layer early exits are only safe as fallback guards, not as the primary gameplay rule.

## A JSX overlay inside an event callback is dead code even if the file still compiles (2026-04-30)

**Problem**: The 鸿蒙天禁 blackout effect was authored, but the user still could not see any blackout at runtime.

**Root causes**:
- The blackout JSX block had accidentally been inserted inside the `onSelectTarget` callback body on `ArenaScene` instead of as part of the returned render tree.
- React happily compiled that as an unused expression statement inside a function body, so the build stayed green while the overlay never rendered.

**Fix**:
- Moved the blackout `<div>` out of the callback and into the actual `BattleArena` render tree as a sibling above the canvas wrapper.

**Key lesson**: When a visual effect "does nothing" despite clean builds, inspect the exact JSX location before debugging state. A rendered element inside an event handler body is just dead code unless it is returned or otherwise mounted into the tree.

## Some custom debuffs should bypass the shared diminishing-returns pipeline entirely (2026-04-30)

**Problem**: 蚀心蛊 was still interacting with the shared 递减 system because its debuff includes `SILENCE`, so the generic buff runtime treated it like any other lockout debuff: existing resistance stacks shortened it, and applying it refreshed lockout resistance afterward. The user wanted 蚀心蛊 to use only its own built-in duration-halving rule and never respect or apply 递减.

**Root causes**:
- Shared diminishing returns are derived centrally in `buffRuntime.ts` from buff category/effect shape, not from the ability's custom cast logic.
- Because 蚀心蛊 includes `SILENCE`, the generic `getResistanceConfig()` path classified it as a shared lockout debuff even though this skill already has its own separate repeat-cast duration rule via 蚀心.

**Fix**:
- Added a narrow exclusion for buff `2643` in `getResistanceConfig()` so 蚀心蛊 never receives duration reduction from existing resistance stacks and never grants new resistance stacks when applied.

**Key lesson**: If a debuff has a bespoke repeat-hit mechanic, exclude it at the resistance classification hook instead of trying to undo diminishing returns later. That removes both halves of the interaction at the single authoritative source.

## When a status should blind the player, a canvas blackout layer is cheaper and safer than hiding every scene mesh (2026-04-30)

**Problem**: After hiding opponents/entities for 鸿蒙天禁, the user wanted to go further and prevent the affected player from seeing the ground, meshes, and other scene content as well. Doing that by individually hiding terrain, collision/debug meshes, effects, and world props would be broad and fragile.

**Root causes**:
- The 3D scene is composed from many different visual systems, so a per-mesh/per-feature hide pass would spread the rule across a large part of `ArenaScene` and related render helpers.
- The gameplay requirement was fundamentally perceptual (blind the player while keeping UI usable), which does not require the world simulation to disappear one object type at a time.

**Fix**:
- Added a full-screen black overlay in `BattleArena.tsx` above the 3D canvas and below the HUD/UI whenever the local player has 鸿蒙天禁.
- Kept the existing local world filtering in place as the gameplay layer, while the blackout overlay handles the visual "cannot see the scene" requirement in one place.

**Key lesson**: If the intended effect is "the player should see nothing but UI," prefer a render-layer blackout over selectively disabling every world mesh. It is smaller, easier to reason about, and less likely to miss one rendering path.

## If a player should become unable to see others, filter their local scene inputs once at BattleArena entry (2026-04-30)

**Problem**: 鸿蒙天禁 already hid the affected target from everyone else, but the user also wanted the affected player to be unable to see anyone except self while the buff is active. In the same adjustment, 曙色 needed to be treated as a DEBUFF instead of a BUFF.

**Root causes**:
- The previous frontend logic only handled the "hide this target from enemies" direction. It did not have a symmetric rule for "when I have 鸿蒙天禁, remove everyone else from my own world view."
- `ArenaScene` already renders from the arrays it is handed, so the clean control point is the BattleArena list derivation layer, not the individual mesh components.
- 曙色's authored buff category and effect category both still said BUFF, so the runtime/state metadata did not match the updated gameplay request.

**Fix**:
- Added a local `selfHasHongMengTianJin` gate in `BattleArena.tsx` that feeds empty opponent/entity arrays to the scene and target-selection lists while the local player has 鸿蒙天禁.
- Reused that filtered entity list to clear stale selected entities when they disappear from the player's allowed view.
- Changed 曙色 to `category: "DEBUFF"` in the ability definition and aligned `HONG_MENG_TIAN_JIN_IMMUNE` to the DEBUFF effect category map.

**Key lesson**: If an effect changes what the affected player can see, do the filtering at the top of the local render/selection pipeline so one rule controls the scene, click targets, and stale-selection cleanup together.

## Forced-loss-of-control rolls can still depend on the target's current control state at cast time (2026-04-30)

**Problem**: 蚀心蛊 originally picked its forced-movement mode with a pure random roll, but the user wanted a stricter rule: if the target is already controlled (except simple slows) or is currently airborne, 蚀心蛊 should always choose the standstill result instead of the fixed-direction march.

**Root causes**:
- The random mode was being decided in one place inside `immediateEffects.ts`, but it had no awareness of the target's live CC/debuff state or whether the target was off the ground.
- Because the chosen mode is stored on the runtime buff and then mirrored by both backend movement and frontend prediction, the right place to add this rule is the cast-time roll itself, not the movement loop.

**Fix**:
- Added a small `shouldShiXinGuForceStandstill()` helper in `immediateEffects.ts` that checks live debuff controls (stun/root/fear/knockback/pull/knockdown-style states, excluding simple slows) and current airborne state using the existing map ground-height helper.
- 蚀心蛊 now forces `forcedMovementMode: "standstill"` whenever that helper returns true; otherwise it keeps the existing random direction-vs-standstill roll.

**Key lesson**: When a debuff stores a one-time random outcome on the runtime buff, any conditional override to that randomness should happen exactly where the buff is created. That keeps backend authority and frontend prediction aligned without adding extra movement-side special cases.

## If a targeted channel should break on target range, use the standard channelCancelOnOutOfRange path (2026-04-30)

**Problem**: 十方玄机 already required its selected target to still be within 20尺 at channel completion, but the user also wanted it to break immediately during the channel once the target moved beyond 20尺, just like the repo's other targeted channels.

**Root causes**:
- The prior implementation only used a completion-time range gate (`requireTargetInRangeOnChannelComplete`), so the channel could continue ticking even after the target had already escaped the allowed range.
- GameLoop already has a generic active-channel cancellation path driven by `activeChannel.cancelOnOutOfRange`; this ability simply was not authored onto that existing rule.

**Fix**:
- Added `channelCancelOnOutOfRange: 20` to 十方玄机 so its active channel now uses the same mid-channel range-break logic as other targeted channels.
- Kept the completion-time 20尺 recheck in place, so both behaviors now hold: leaving range mid-channel breaks immediately, and the end-of-channel validation still protects completion.

**Key lesson**: When a channel should fail as soon as the target leaves range, do not invent a custom per-ability GameLoop branch. Use the existing `channelCancelOnOutOfRange` authoring hook, then keep any end-of-channel validation only for completion-time guarantees.

## Hidden untargetable states need a view-layer hide rule plus a natural-expiry follow-up buff (2026-04-30)

**Problem**: 鸿蒙天禁 needed to target anyone within 20尺, apply a 6-second DEBUFF that makes the target impossible to target, impossible to damage, and invisible to everyone else while still allowing free movement/casting, then grant 曙色 for 20 seconds when the effect ends. Self-cast also had to cleanse 2 debuffs each of 阴性 / 阳性 / 混元 / 毒性 / 持续伤害.

**Root causes**:
- `UNTARGETABLE + INVULNERABLE` is enough for backend protection, but it does not remove the actor from enemy rendering by itself. The frontend must also treat that buff as a hide-from-enemy-view state, not only as a targetability block.
- The follow-up anti-repeat window (`曙色`) belongs on the natural-expiry path of 鸿蒙天禁, not in the cast handler. Otherwise canceled/overwritten states and end-of-duration states can drift.
- Self-cleanse and target-side immunity (`曙色`) need a manual custom effect path, so the ability can cleanse self first, then selectively skip applying 鸿蒙天禁 if the immunity marker is already present.

**Fix**:
- Implemented 鸿蒙天禁 as a manual custom effect that applies DEBUFF 2645 for 6 seconds, uses `UNTARGETABLE + INVULNERABLE` for backend immunity, and cleanses the specified debuff attributes when self-cast.
- Added 曙色 buff 2646 and attached its application to Hong Meng Tian Jin's natural-expiry hook in `GameLoop.ts`, so the 20-second immunity window is granted exactly when the main buff ends.
- Extended both `BattleArena.tsx` and `ArenaScene.tsx` hide helpers so opponents with 鸿蒙天禁 are filtered out of enemy view entirely instead of only becoming untargetable.

**Key lesson**: For effects that say "cannot be targeted and also should not be seen", backend targeting guards are only half the implementation. You need a separate frontend visibility rule, and if the effect grants an anti-repeat marker afterward, attach that marker to the natural-expiry path of the main buff rather than the cast path.

## Forced-movement debuffs should store their chosen mode on the runtime buff, and "target anyone" can be modeled as opponent-target + self opt-in (2026-04-30)

**Problem**: 蚀心蛊 needed to target anyone within 20尺, including self, apply a 6-second silence / +50% move-speed / 50% damage-reduction debuff, then randomly force either fixed-direction walking or complete standstill without granting CC immunity. Friendly/self targets halve the duration, and a separate 20-second 蚀心 marker halves the next 蚀心蛊 again.

**Root causes**:
- The existing target model is `SELF` or `OPPONENT`; "cast on anyone" in this codebase is best treated as an opponent-targeted skill with an explicit `canTargetSelf` escape hatch instead of a third broad target mode.
- The existing `FEARED` path already proves the correct architecture for "ignore player input but still let root / knockdown / displacement win": override movement intent in GameLoop and BattleArena prediction, do not fake it with `CONTROL` or a forced dash.
- Random forced-movement behavior has to be stored on the runtime buff itself (`forcedMovementMode` + optional direction). If you leave the randomness only in the ability cast handler, the frontend cannot predict movement consistently across snapshots.

**Fix**:
- Added `canTargetSelf` to ability metadata and wired validate/cast/client selection so opponent-targeted abilities can explicitly choose self without triggering enemy-only dodge/facing/LOS rules.
- Implemented 蚀心蛊 as a manual custom effect that applies buff 2643 with a computed duration (self target and existing 蚀心 each halve it) and refreshes buff 2644 as the repeat-hit marker.
- The 蚀心蛊 runtime buff now carries its forced mode on the live buff object, and both GameLoop and BattleArena read that metadata to force fixed-direction walking or standstill while still yielding to root, knockback, and other control states.

**Key lesson**: For debuffs that remove control without providing control immunity, do not model them as standard `CONTROL`. Treat them as input-override states layered on top of the normal movement lock pipeline, and store any random choice on the runtime buff so backend authority and frontend prediction stay in sync.

## Fixed-distance knockbacks must be tuned by dash duration, and cast-breaking buffs on pure channels need a pure-channel hook too (2026-04-30)

**Problem**: 连环弩 was mistakenly changed by doubling knockback distance when the real spec was "still 4尺, but at 20尺/秒". In the same round, 十方玄机 needed a 20-second post-channel disguise buff that should fall off when casting any non-base skill, but stay for the exact whitelist `蹑云逐月 / 迎风回浪 / 凌霄揽胜 / 瑶台枕鹤 / 扶摇直上 / 后撤`. Allowed casts were still removing the buff.

**Root causes**:
- For forced dashes, speed is derived from `distance / ticks`. If the gameplay spec fixes both distance and speed, the thing to change is `ticksRemaining`, not the distance itself.
- `breakOnPlay()` only runs on the normal `PlayAbility` path. Pure channels are started directly in `playService.ts`, so any special "remove this buff when casting" rule that exists only in `breakOnPlay()` will silently fail for future pure-channel casts.
- A custom keep/remove helper is not enough by itself if the buff is still authored with `breakOnPlay: true`; the later generic break filter will still delete it even when the helper said to keep it.

**Fix**:
- 连环弩 knockback now stays at 4尺 and reaches 20尺/秒 by shortening the forced-dash duration to 6 ticks instead of increasing the distance.
- 十方玄机 is implemented as a pure channel with `applyBuffsOnComplete: true`, and its 20-second disguise buff uses `UNTARGETABLE + INVULNERABLE` for backend protection while the frontend scene paints that player's HP bar and name green.
- 十方玄机 now requires a selected 20尺 target, can only start on the ground, cancels if the player jumps into the air during the channel, and only completes if that selected target is still within 20尺 when the channel ends.
- The 十方玄机 removal rule is centralized in a narrow helper (`breakShiFangXuanJiOnPlay`) and invoked from both `breakOnPlay()` and the pure-channel start branch in `playService.ts`, so non-common normal casts and non-common pure channels both strip the buff consistently.
- The actual allowlist is `蹑云逐月 / 迎风回浪 / 凌霄揽胜 / 瑶台枕鹤 / 扶摇直上 / 后撤`, and the buff itself must have `breakOnPlay: false` so those allowed casts can survive the generic break pass.

**Key lesson**: When a dash spec says "same distance, faster speed", do the math on duration first. And if a buff must break on *some* casts but not others, verify every cast entry path and the authored buff flags: normal play and pure-channel start are separate control surfaces, and `breakOnPlay: true` can override a helper-level whitelist if left in place. For movable channels that are supposed to stay ground-only, you need both a grounded cast gate and a jump-cancel rule; otherwise the player can still start grounded and then continue channeling in the air.

## Control-copy cleanse skills need a dedicated capture path, and BattleArena filter state can safely persist via localStorage (2026-04-30)

**Problem**: New skills like 游风飘踪 / 如意法 need to do more than generic `CLEANSE`: they must remove knockdown, know exactly which control kind was removed, and later re-apply that control through `addBuff()` so 递减 still works. 游风飘踪 also needed to become self-cast with optional target reflection instead of hard-requiring a target, and 如意法's visible next-attack marker still failed to fire on real attacks because its trigger loop was placed in the wrong GameLoop scope. Separately, the in-game ability cheat panel kept forgetting the user's rarity/school filters on every reload.

**Root causes**:
- `handleCleanse()` is intentionally simple. It removes normal CONTROL / ATTACK_LOCK (and optional ROOT/SLOW), but it does not preserve any metadata about what was removed, and it deliberately leaves 摩诃无量-style knockdown alone.
- Re-applying copied control by pushing raw runtime buff objects would bypass immunity checks, status-bar metadata, BUFF_APPLIED events, and 递减.
- For one-shot on-hit mechanics like 如意法, putting the trigger scan inside an unrelated stack-expire branch can make the buff appear in UI while never firing during normal outgoing attacks.
- The cheat-panel filters in `BattleArena.tsx` were plain `useState('all')` values with no persistence path, so reloads always reset them.

**Fix**:
- Added a dedicated `captureAndCleanseControls()` helper in `Cleanse.ts` that removes root / freeze / stun / knockdown / attack-lock style controls from self, classifies the removed control kind, and records duration metadata for later re-application.
- 游风飘踪 now casts as a self skill, always grants its 8-second anti-control buff, and only mirrors control when an explicit target exists. Its mirrored control now uses a fixed 5-second duration instead of the cleansed buff's remaining time.
- 如意法 now uses the same capture helper, stores the captured control package on a real runtime buff (`如意法·待发`), and consumes that buff from the authoritative GameLoop damage-event scan on the next eligible outgoing attack. The copied control is still applied through `addBuff()`, so DR/immunity/status-bar behavior stays correct.
- Cheat-panel rarity/school filters now load from and save to `localStorage` under `zhenchuan-cheat-filters`.

**Key lesson**: Any skill that "cleanses and then copies/echoes the removed control" should not be built on top of bare `handleCleanse()`. Treat it as a two-step system: capture authoritative control snapshots first, then re-apply via `addBuff()` later. For one-shot follow-up mechanics like 如意法, attach the trigger scan to the normal outgoing damage-event pass itself, not to a neighboring proc branch that only runs on a subset of hits. For BattleArena UI preferences, small floating-panel filters are fine to persist directly in localStorage when there is already a client-only state pattern nearby.

## New custom buffs must be declared for preload/status bar, and redirect callers must always trust `adjustedDamage` (2026-04-30)

**Problem**: Round-5 custom buffs looked like they existed in the raw runtime debug list, but did not appear in the real status bar; 疾电叱羽 also showed its runtime buff while still letting full damage through. 连环弩 also lost its channel bar/effect entirely after a self-buff was added directly to the channel ability.

**Root causes**:
- StatusBar does **not** render from live runtime buff fields alone. It resolves metadata from `abilityPreload -> buffMap`, which is built from static `ability.buffs`. If a buff is only created manually in GameLoop/custom handlers and is not declared in `ability.buffs`, the debug panel can still show it, but the real status bar has no metadata and will hide it.
- `preCheckRedirect()` returns the **actual damage to apply to the primary target** in `adjustedDamage`. Callers must always apply `adjustedDamage`, even when `redirectPlayer` is null. 疾电叱羽 is the counterexample: it absorbs damage into a zone and deliberately returns `{ adjustedDamage: 0, redirectPlayer: null }`. Any caller that uses `redirectPlayer ? adjustedDamage : rawDamage` will silently bypass the redirect and deal full damage.
- The pure channel system (`player.activeChannel`) only starts for channel abilities that have no normal cast-time buffs, or that are explicitly marked for a special channel path. Adding a normal self buff to a channel ability can accidentally downgrade it out of the pure-channel path, which removes the forward channel bar and all channel tick handling.

**Fix**:
- Declare every custom runtime buff in `ability.buffs` so preload/status-bar metadata exists.
- If the buff is applied manually by custom logic, exclude that ability from `applyAbilityBuffs()` so the metadata declaration does not also auto-apply on cast.
- Treat `adjustedDamage` as authoritative at every `preCheckRedirect()` call site.
- Preserve custom runtime buff fields when `addBuff()` materializes `ActiveBuff` instances. If the static buff definition carries extra runtime linkage like `linkedZoneId`, dropping that field makes the buff appear correctly in UI while the dependent engine behavior silently fails.
- For channels that need a self buff during the channel, keep them on the pure-channel path and use an explicit channel-start buff path with cleanup on channel cancel/end.

**Key lesson**: There are three separate systems that must all line up for a “new buffed ability” to work: preload/status-bar metadata (`ability.buffs`), runtime application (`addBuff` / custom handler), and the owning behavior system (pure channel vs normal cast). Missing any one of those produces the exact kind of half-working state seen here.

## Full HP must never suppress HEAL events (system rule, 2026-05 session)
HEAL events drive the floating-text visuals. Even when the player is already at
max HP, the float should still show. Therefore: **always emit a HEAL event with
the intended heal amount** (e.g. the value defined on the effect / buff). Do
NOT gate on the actual hp delta (`applied > 0`). The actual hp clamping happens
inside `applyHealToTarget`; the event uses the *intended* value.
- Lifesteal entity path (`Damage.ts`): emits with `healAmt`.
- 徐如林·回复 expire (`GameLoop.ts`): emits with `healVal`.
- Apply this to any new heal source.

## Test-only target dummies (cheat) belong in their own panel and reuse `TargetEntity` (2026-04-29)

**Problem**: Combat-helper cheat buttons (双方满血 etc.) lived inside the ability-picker cheat window, and there was no way to place arbitrary practice dummies for testing damage/CC/heal flows.

**Fix**:
- Split the existing cheat window: combat helpers + new dummy controls now live in a separate `控制面板` floating panel beside the ability list. The ability cheat window now only contains the ability picker.
- Reuse `TargetEntity` for ally / enemy dummies (`kind: "test_dummy_ally" | "test_dummy_enemy"`). Owner is the caller (ally) or the opponent / synthetic id (enemy), so existing friendly/enemy logic naturally applies.
- Click-to-place flow mirrors `pendingGroundCastAbilityId`: a `pendingDummySpawn` ref + ground hover preview + `onGroundPointerDown` posts to `/api/game/cheat/spawn-dummy`. No range limit since this is a debugging tool.
- Added `/cheat/restore-dummies` and `/cheat/clear-dummy-debuffs` endpoints. They iterate `state.entities` and only mutate entries whose `kind` is in the `DUMMY_KINDS` set.

**Key lesson**: When testing tools need to interact with combat systems, build them on the same primitives the real systems use (`TargetEntity` + `addBuff`) — that way controls, damage, healing, and HUDs all "just work" without parallel code paths.

## Very-short refreshed buffs need duration headroom or `hiddenInStatusBar` (2026-04-29)

**Problem**: 逐云寒蕊·隐藏 (buffId 2716) had `durationMs: 500`, refreshed every tick by `GameLoop`. The frontend `StatusBar` filters `getRemainingSeconds(b) > 0` and renders `secsLeft.toFixed(1)`, so the buff often displayed as `0.0` between refreshes and was filtered out.

**Fix**: Raise `durationMs` to 2000 ms (and `ZHU_YUN_STEALTH_DURATION_MS` in `GameLoop` to match). Per-tick refresh keeps `expiresAt` always ~2s in the future, giving the client headroom to render a stable countdown without ever flickering to 0.

**Key lesson**: For periodically-refreshed buffs, the authored `durationMs` must comfortably exceed the worst-case client lag between refreshes. 500 ms is too tight for a status-bar display; either bump duration or hide via `hiddenInStatusBar`.

## Entity targets need first-class buff runtime, not damage-only support (2026-04-29)

**Problem**: 逐云寒蕊 could be damaged, but it still could not reliably receive buffs, debuffs, or controls, and the frontend target HUD always showed an empty status row for selected entities.

**Root cause**: The previous entity work only widened damage paths. `TargetEntity` still had no runtime `buffs` storage, generic `ability.buffs` application still targeted the opposing player object, and the selected-target UI hardcoded entity buffs to `[]`.

**Fix**:
- Extend `TargetEntity` with first-class runtime combat fields (`userId`, `shield`, `buffs`) so it can reuse shared buff/combat helpers.
- Route generic `applyAbilityBuffs(...)` through `entityTarget` when a cast explicitly targets an entity instead of always falling back to the opposing player.
- Widen shared immediate/GameLoop buff-control surfaces (`AOE_APPLY_BUFFS`, `SAN_CAI_HUA_SHENG_AOE`, `JILE_YIN_AOE_PULL`, dash-end CC, periodic entity buff ticking/expiry) so entities participate in the same authoritative buff runtime.
- Mirror entity `buffs`/`shield` in frontend in-game types and feed selected entity buffs into the existing `StatusBar` target HUD.

**Key lesson**: Once an object is a real combat target, the clean design is to make it a buff-bearing runtime target and reuse the shared buff engine. Damage-only entity support leads to one-off fixes and misses debuff/control behavior immediately.

## Entity-targeted casts must not consult the opposing player's dodge state (2026-04-29)

**Problem**: After wiring entity buff support, explicit entity-targeted casts could still inherit dodge behavior from the opposing player, because `applyAbility()` computed `abilityDodged` before it knew the real target class.

**Fix**:
- When `entityTargetId` resolves to a live entity target, force `abilityDodged = false` for that cast path.
- Let entity-side immunity buffs be handled by the shared target guard checks on the entity itself, instead of accidentally borrowing player dodge/avoidance state.

**Key lesson**: When an ability can target different target classes, any early shared decision like dodge or avoidance must be computed against the actual resolved target, not a placeholder player target chosen only for indexing convenience.

## Entity targets must flow through cast validation (2026-04-29)

**Problem**: Attacking 逐云寒蕊 could be selected in the client, but backend cast validation still failed with `ERR_TARGET_UNAVAILABLE` / `目标丢失或者不可选中`.

**Root cause**: `playCastAbility(...)` already accepted `entityTargetId`, but did not pass it into `validateCastAbility(...)`. The validator therefore fell back to the opposing player target, then ran the normal `blocksCardTargeting(enemy)` stealth/untargetable check against that player instead of the intended entity.

**Fix**:
- Pass `entityTargetId` from `backend/game/services/gameplay/playService.ts` into `validateCastAbility(...)`.
- Extend `validateCastAbility(...)` in `backend/game/engine/rules/validateAction.ts` to resolve entity targets from `state.entities`.
- For entity targets, validate existence, living HP, and enemy ownership, then use the entity position for range, facing, and LOS checks.
- Keep the old `blocksCardTargeting(enemy)` path only for real player targets.

**Key lesson**: Adding entity targeting to the frontend and effect-resolution path is not enough. Every cast-time validation gate must receive and understand `entityTargetId`, or the server will silently validate against the wrong target class.

## Entity targets need every shared damage loop, not just direct DAMAGE (2026-04-29)

**Problem**: After direct targeted attacks could hit 逐云寒蕊, several other damage paths still ignored it: pure channel completion (`云飞玉皇`), channel AOE ticks (`风来吴山`), timed AOE buff damage, dash-end AOE damage, ground-zone periodic damage, and immediate AOE effect branches like `百足 / 五方行尽 / 横扫六合`.

**Root cause**: The first entity fix only covered the direct `DAMAGE` effect branch. Many other backend damage paths still hardcoded either the opposing player (`opp`) or loops over `state.players`, so the entity never entered those hit-resolution paths.

**Fix**:
- Preserve `entityTargetId` on pure channels so channel completion can still resolve the entity target.
- Extend shared GameLoop damage branches to include hostile `state.entities` alongside players for channel completion, channel AOE ticks, timed AOE buff damage, dash-end AOE damage, and ground-zone periodic damage.
- Extend immediate AOE effect branches in `immediateEffects.ts` to damage hostile entities and emit normal DAMAGE events with `entityId/entityName`.
- Keep player-only secondary effects such as dodge, knockback, and buff application on the player path only.

**Key lesson**: For targetable entities, “can be selected” and “can take direct single-target damage” are only the first layer. Any shared damage surface that enumerates enemies must be audited for `state.entities`, or abilities will fail one category at a time.

## 化解 (Shield Absorption) Display System (2026-04-26)

**Feature**: When a shield absorbs incoming damage, show "化解" floating text instead of (or alongside) the damage number.

**Implementation**:
- Added `shieldAbsorbed?: number` to `GameEvent` in `events.ts`.
- In `Damage.ts` (`handleDamage`), captured `shieldAbsorbed` from `applyDamageToTarget` result and included it in the DAMAGE event.
- In `GameLoop.ts`, updated 3 DAMAGE event pushes (periodic buff DoT, safe zone, ground zone) to capture and emit `shieldAbsorbed`.
- Frontend `BattleArena.tsx`: added `'huajie'` to `FloatType`, added `text?` field to `FloatEntry` for display override, modified DAMAGE event handler to check `evt.shieldAbsorbed`:
  - Fully blocked (shieldAbsorbed >= value): only show "化解" float
  - Partially blocked: show "化解" + reduced dmg_taken float
  - No shield: normal damage float
- "化解" floats appear on the right column (same 60% left as heals), yellow (#ffd24a), Chinese font, with glow text-shadow.

**Key lesson**: `addFloat` had a `value <= 0` guard — bypass it for the `'huajie'` type since it carries no meaningful numeric value (always pass value=1).

## DISPLACEMENT Bypass for 镇山河 (2026-05 session)

**Problem**: 镇山河 (`zhen_shan_he`) failed with `ERR_DISPLACEMENT` when cast while being pulled by 捉影式.

**Root cause**: 捉影式's channel completion triggers `TIMED_PULL_TARGET_TO_FRONT` in GameLoop.ts, which calls `applyDashRuntimeBuff` on the *target* with effects `[CONTROL_IMMUNE, KNOCKBACK_IMMUNE, DISPLACEMENT, DASH_TURN_LOCK]`. The `DISPLACEMENT` buff blocks all casting via `validateCastAbility` / `validatePlayAbility` with no bypass mechanism. 镇山河 already had `allowWhileKnockedBack` and `allowWhilePulled` flags, but those are checked *after* DISPLACEMENT.

**Fix**:
- Added `allowWhileDisplaced?: boolean` to `Ability` interface in `abilities.ts` type.
- Added `allowWhileDisplaced?: boolean` to `AbilityEffect` interface in `effects.ts`.
- Replaced the unconditional `throw new Error("ERR_DISPLACEMENT")` in both `validateCastAbility` and `validatePlayAbility` in `validateAction.ts` with a bypass check (same pattern as allowWhileKnockedBack/allowWhilePulled).
- Added `allowWhileDisplaced: true` to 镇山河 in `abilities.ts`.

**Key lesson**: The `DISPLACEMENT` check in `validateAction.ts` was hardcoded with no bypass — any future ability that should be castable during dashes/pulls needs `allowWhileDisplaced: true`.

## 捉影式 Pull Distance Fix (2026-05 session)

**Problem**: 捉影式 had `range: 35` (cast range) but `value: 20` in `TIMED_PULL_TARGET_TO_FRONT`, meaning a target at 35u away would only be pulled 20u (reaching 15u from caster). Description said "最多20单位" which was inconsistent with the 35u cast range.

**Fix**: Changed `value: 20` → `value: 35` (pull travels full cast range). Updated description accordingly.

## Ability DamageType Tag System (2026-04-25)

**What was built**: Added a new `damageType` tag group (values: 外功 / 内功 / 无) to the ability editor.

**Architecture**:
- Tag stored in `ability-property-overrides.json` under `tags.damageType` (same pattern as `rarity`/`school`).
- `buildResolvedAbilities` now copies `tags.damageType` to `(nextAbility as any).damageType` so it's available at runtime (game engine reads it from the resolved ability object).
- `resolveScheduledDamage` now accepts `damageType?: string`. When a `DAMAGE_REDUCTION` buff effect has a `damageType` filter, the reduction only applies when the incoming attack's `damageType` matches.
- All `resolveScheduledDamage` call sites in `immediateEffects.ts` and `Damage.ts` now pass `(ability as any).damageType`.
- Periodic/scheduled damage (from `resolveScheduled.ts`, `onPlayEffects.ts`, etc.) does NOT pass a `damageType` — these are buff-based DoT/self-damage where source ability type is unavailable. Typed `DAMAGE_REDUCTION` effects will not apply to such damage.

**Frontend**: Added filter bar row (伤害类型) below school filter, and inline `外功/内功/无` buttons on each ability card, consistent with existing rarity/school patterns.

**Ability update**: 惊鸿游龙 `DAMAGE_REDUCTION` effect now has `damageType: "内功"`, limiting its 45% reduction to magical incoming damage only.

**Key lesson**: `damageType` is a runtime-accessible field on the resolved ability; the tag system only stores it in the JSON editor overrides. `buildResolvedAbilities` bridges the two.

## Buff Duration Override Not Taking Effect (2026-04-23)

**Root cause**: `addBuff()` in `buffRuntime.ts` applied property overrides from the live editor file at runtime, but `durationMs` was only applied at preload time (server startup). Changing duration via the editor saved to the overrides JSON, but the game kept using the preload-cached value until PM2 was restarted.

**Fix**: Added a second live-override block in `addBuff` right after the properties block:
```typescript
if (typeof propEntry?.durationMs === "number") {
  runtimeBuff = { ...runtimeBuff, durationMs: propEntry.durationMs };
}
```
Now both properties and duration are read live from the overrides file, so changes take effect immediately without a server restart.

**Lesson**: Any editor override that needs to work during a running game session must be applied in `addBuff` at runtime, not just at preload. Preload is for initial state and snapshot building only.

## Icon Asset Reorganization

- **Flattening `public/game/icons` and `public/icons/class_icons` into `public/icons`**: Completed successfully. All 114 game icons preserved. Source paths updated from `/game/icons/` to `/icons/` across 8 files: `abilityPreload.ts`, `buffIcons.ts`, `editorShared.ts`, `Card/index.tsx`, `SelectedAbilities.tsx`, `DraftShop.tsx`, `BenchArea.tsx`, `BattleArena.tsx`. Do NOT touch `layout.tsx` or `TopBar/index.tsx` — they correctly use `/icons/app_icon*` already.
- **Pitfall**: When two identical img tags exist in the same file, multi-replace fails with "multiple matches". Use surrounding context lines (title attribute, class names) to uniquely identify each occurrence.
- **Order matters**: Do point 0 (clean legacy icons from `public/icons`) BEFORE moving `game/icons` into it, to avoid accidentally cleaning the real game icons.

---

## Coordinate System

- World → Three.js transform: `threeX = worldX − worldHalf`, `threeZ = worldY − worldHalf`, `threeY = worldZ`.
- Collision-test map is **non-square (819 × 828 after 50% scale-up)**. Always use `width/2` for X offsets and `height/2` for Y/Z offsets. Reusing `width/2` for Z causes slope-support drift and airborne-state issues.

### Scaling the exported 3D map (50% scale-up, 2026-04-12)
The map is a coupled system — all of these must stay in sync when scaling:
1. `MAP_SCALE` in both `exportedMapCollision.ts` (backend) and `ExportedMapScene.tsx` (frontend): the GLB group scale factor.
2. `GROUP_POS_X/Y/Z` in both files: scale linearly by the same factor as MAP_SCALE (they're in Three.js world units derived from the scale).
3. `EXPORTED_MAP_WIDTH/HEIGHT` (backend `exportedMap.ts`) and `COLLISION_TEST_MAP_WIDTH/HEIGHT` (frontend `collisionTestMap.ts`): the world boundary.
4. All entity AABBs in `exportedMap.ts` and `collisionTestMap.ts`: x, y, w, d, h all scale proportionally.
5. Spawn positions in `exportedMap.ts` → `EXPORTED_MAP_SPAWN_POSITIONS`: scale x, y by the same factor.
The BVH collision triangles in the GLBs do NOT change — only the coordinate mapping constants change.

---

## CORS / Nginx

- Using an external URL in `BACKEND_URL` causes nginx 404 — always point to `http://localhost:5000` for server-side calls.
- WebSocket proxy requires `http/1.1 + Upgrade + Connection` headers, or the connection silently fails.
- Missing `Host` header in nginx proxy causes cookie routing failures.

---

## Mongoose Mixed Fields

- Mongoose does not track nested property mutations on `Mixed` fields.  
  Solution: reassign the whole object using spread (`{ ...obj, prop: newVal }`) and call `markModified()` on both parent path and specific nested path before `save()`.

---

## Collision System (collision-test mode)

- Player radius for collision-test: **0.384** (authoritative via `exportedMapCollision.ts` → `GameLoop.ts`).
- Ground support radius must be tight (≈ playerRadius + small epsilon); too large causes "floating on air" near edges.
- Side-collision Z gating must be consistent with ground-support epsilon, or players bounce/get rejected on rooftops.
- Critical broadphase rule: every spatial query must use the segment bounds (min/max of sx/sy/ex/ey), not legacy x/y/w/d, or you get invisible blockers / walk-through colliders.

### 玉门关 camera wall clamp + close-body hide (2026-04-15)
- **Problem**: The third-person camera always used its full offset, so backing into a wall let the view look over the wall while the local body stayed hidden behind it. Pitch was also clamped to non-negative values, so the view could not tilt upward from below the character.
- **Fix**:
  - Camera pitch in collision-test mode now allows negative values, and the look target rises as pitch goes upward so the view can tilt into the sky from below the avatar instead of only orbiting above.
  - The 玉门关 camera now raycasts against the exported BVH and clamps the camera to the first blocking surface behind the player, keeping the camera on the wall instead of beyond it.
  - The local avatar, HP bar, and facing arc now fade out and fully disappear once the camera is pushed to about one body-length from the character, producing the intended first-person feel near walls.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/CameraRig.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/Character.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/MapCollisionSystem.ts`
- **Follow-up tuning**:
  - Upward look is now ground-aware: the camera lowers first, then clamps to the local support ground under the camera, and only overflow beyond that clamp turns into sky-looking angle. This prevents the camera from dropping below the walked surface.
  - Move commands now recenter only the camera's aim back to the avatar when the avatar has drifted out of frame. The camera body stays where it is, and this recenter is skipped when the avatar is already hidden only because the camera is too close.
  - Active manual camera intent now wins over move-command recentering. While left-drag or touch-look is still being held, movement input no longer forces the camera away from the user's deliberate sky-look.
  - Rooftop sky-look needed a separate clamp rule: the camera back-ray could hit the roof/floor surface itself before any real wall, which stopped the camera from ever reaching the grounded state that should transition into sky angle. The camera ray now skips downward floor-like hits and still respects real wall blockers.
  - House / wall transitions needed a wider camera body test than a single center ray. The camera now fires side and corner probe rays around the desired camera position and uses the tightest allowed distance, which keeps the whole camera frustum on the avatar side of the wall instead of letting one half peek outside roofs or wall edges.
  - When the wall clamp compresses the camera, the look target now blends back toward the avatar instead of staying far ahead. This makes the back-against-wall transition feel closer to a smooth close-up rather than a clipped outside-looking view.
  - Added an in-game camera debug window at 5% / 60% for 玉门关. It records wall clamp start/end, probe clamp start/end, ground clamp start/end, close-body mode, recenter events, and large snap jumps together with camera position and yaw/pitch so bad transitions can be copied straight out of the client.
  - House-entry snap logs showed the real cause: the camera target could change from full boom length to a very short blocked distance in one frame, while probe clamp and ground clamp were also toggling on neighboring frames. That produced visible in/out snapping even though the wall logic itself was technically correct.
  - Fix for that case: collision-driven camera position now blends quickly in and out instead of hard-copying the blocked target each frame, and probe / ground clamp state uses hysteresis so tiny one-frame changes do not repeatedly enter and leave clamp mode.
  - Follow-up log review showed a second issue after the first smoothing pass: even without a hard snap, the camera was still "breathing" far/close/far because the whole world position was being smoothed while the blocked direction kept changing. Smoothing the camera distance along the current blocked direction works better than smoothing the whole position.
  - Ground clamp also needs a roof filter while wall-blocked. If the support point under the camera is much higher than the player's current feet while the wall clamp is active, that support is usually an outside roof/top surface and should not lift the camera away from the avatar.
  - Thin roof ribs / trim pieces can still confuse probe clamp even when the center wall clamp is correct. A more stable camera rule is to ignore single outlier probe hits and only apply extra probe shortening when multiple probe rays agree on a shorter distance.
  - Wall transition feel is better when both compression and release are slowed down. Fast damping makes the camera look technically smooth but still feel like a snap; slower in/out rates feel more like a deliberate zoom.
  - Once the big snaps are gone, the remaining problem is usually probe chatter: very small probe shortenings start and end on adjacent frames and make the camera feel shaky even though nothing is visibly "jumping." Adding an enter/exit hold time for probe clamp and retaining the last reliable probe distance for a short time makes the view feel much calmer.
  - Close-body state also needs hysteresis. If the near-camera threshold is symmetric, the camera can hover around that boundary and repeatedly enter/leave the close-body state while sliding along a wall.
  - Bridge slats / fence-like gaps need wall-clamp persistence, not a blind global cooldown. The better rule is: zoom in immediately when blocked, but do not release the wall clamp until the path has been clear for a short grace period. That prevents bad in-out-in-out oscillation when the ray alternates between wooden slats and tiny gaps.
  - While wall-blocked, the retained wall distance should also grow much more slowly than it shrinks. Fast growth makes the camera breathe outward through tiny clear gaps; slow growth keeps the wall view stable until clearance is sustained.
  - Release hold alone is not enough for slatted bridges. Even while the wall clamp is still active, the allowed blocked distance can jump between "near slat" and "far slat" hits. A better rule is to require the farther wall distance to remain stable for a short hold time before letting the retained wall distance expand.
  - The same "ignore isolated thin hits" rule should be applied to the primary wall clamp, not only the probe clamp. If the main wall ray reacts to a single thin side stick while nearby support rays stay clear, treat that as an outlier and ignore it.
  - When the user asks for slower auto zoom, halve the damping speeds consistently across the collision zoom, retained wall distance, and retained probe distance. Slowing only one of those layers leaves the camera feeling inconsistent.
  - If thin side sticks still trigger the primary wall clamp after adding support rays, the main wall consensus is still too permissive. Requiring a broader agreement across support rays and a larger minimum shortening threshold helps reject narrow side-stick blockers that hit only part of the camera body.
  - Bridge-gap breathing can also persist if the blocked-distance expansion hold is too short. Expanding farther while still occluded should usually need a noticeably longer hold than the initial clamp-in.
  - When camera tuning stalls because the blocker is "somewhere between tiny and real", the debug log needs blocker-size metrics, not just camera position. Log the wall support hit count, hit mask, support span, raw distance range, retained distance, and pending expansion hold so the next tuning pass can use measured blocker coverage instead of guessing.
  - The new blocker metrics revealed a concrete issue: the original main wall-support footprint was only about 0.48 × 0.32, so a narrow stick could still hit every support ray and look like a full wall. When the log shows full support coverage over a tiny footprint, the next step is to enlarge the wall-support footprint and sample corners so the camera test better matches a real camera body.
  - If widening the wall-support footprint still shows masks like `C,R,U,D,UR,DR` with no left-side hits, the remaining bug is blocker shape, not blocker size. Treat one-sided support clusters as edge occluders for the probe clamp, not as a full wall that should collapse the main boom distance.
  - Even after wall and probe retention are stable, the final camera-distance smoother can still feel bad if it is allowed to reverse direction instantly. A short reversal cooldown at the smoothing layer works better than more ray tuning: hold outward release briefly after a compression, and if a release just started, soften the immediate re-compression instead of snapping back at full speed.
  - Camera testing UI must be explicitly gated. Leaving mirror/log tooling always active in collision-test means camera events keep appending React state even when the panel is hidden, which adds avoidable long-session UI churn. The camera event panel should be off by default and only collect events when its ESC toggle is enabled.
  - Whole camera-upgrade path: fix look space first (negative pitch + ground-aware sky-look), then occlusion correctness (BVH wall clamp + probe clamp + close-body hide), then transition feel (distance smoothing, hysteresis, release holds, reversal cooldown), then instrumentation (camera event panel + blocker metrics), then blocker classification (size coverage first, shape coverage second). That order made later tuning measurable instead of guesswork.

### Long-session React churn during collision-test (2026-04-16)
- **Symptoms**: After long testing sessions, the client became laggy and could surface `Maximum update depth exceeded` from the live battle client.
- **Root causes**:
  - Camera event testing had been wired as always-on React state updates in `BattleArena.tsx`, even when the debug panel was not being used.
  - Battle completion in `InGameClient.tsx` had no one-shot guard, so the `gameOver` effect could schedule repeated refetch-driven updates for the same finished battle.
  - `useGameState.ts` was also updating RTT state on every diff packet, which is unnecessary churn because heartbeat `PONG` already provides RTT.
- **Fixes**:
  - Add an explicit ESC toggle for camera event testing and keep it off by default; only pass `onCameraDebugEvent` when enabled.
  - Default `显示距离地面距离` to off in the ESC panel.
  - Guard battle completion with a one-shot ref keyed by battle number + winner, and clear that guard only when the battle state changes.
  - Update RTT state from heartbeat `PONG` only, not from every state-diff packet.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/InGameClient.tsx`, `frontend/app/game/screens/in-game/hooks/useGameState.ts`

---

## Dashing Abilities

### Control-system redesign baseline and gaps (2026-04-17)
- **Current model mismatch**: Live code still treats `ROOT/SLOW` as level 0, `CONTROL/ATTACK_LOCK` as level 1, `KNOCKED_BACK` as level 2, and `SILENCE` as level 3. The requested redesign moves silence into lockouts, splits knockdown from generic stun, and defines pull/knockback as dash-state controls instead of a standalone `KNOCKED_BACK` tier.
- **Important movement gap**: Current `movement.ts` only blocks input under root/control/knockback. If the player is already airborne, XY momentum is preserved because the movement loop keeps existing airborne velocity when there is no directional intent. That means live root/stun/knockback do **not** currently force the immediate straight-down fall required by the redesign.
- **Ability-pool gap**: There is no live root ability, no live pull ability, and no dedicated freeze effect yet. Current pool only covers slow, stun-like `CONTROL`, mohe knockdown via special case, knockback via `wu_jianyu`, silence via `chan_xiao`, and qinggong seal via `jianpo_xukong`.
- **Implementation takeaway**: The redesign will require backend effect typing, cast validation, buff application rules, movement handling, and frontend prediction in `BattleArena.tsx` to change together. This is not just a buff-table edit.
- **Clarifications now resolved**: root blocks jump input while grounded; root resistance reapplications refresh one shared 10-second timer; stun and freeze use separate resistance buffs; root and slow fail under active type-1 stun/freeze; a second pull/knockback fails during type-3 dash immunity.
- **Audit lesson**: The biggest live mismatch is not only missing abilities; it is missing control-state architecture. Silence is still a universal cast stop instead of a school-based lockout layer, mohe knockdown is still a buffId special case instead of a generic type-2 control, and wu_jianyu knockback is still a direct shove plus short `KNOCKED_BACK` debuff instead of a true forced-dash type-3 control.
- **Important engine gap**: Direct loop-applied knockback in `GameLoop.ts` bypasses the normal `addBuff()` filtering path, so `KNOCKBACK_IMMUNE` does not currently protect against `wu_jianyu` the way the general immunity model suggests it should.
- **Testing lesson**: A complete control-rule regression list needs two layers: live-pool tests for currently shippable abilities, and harness-only tests for redesign areas the current pool cannot cover yet, such as root, freeze, pull, attack-lock, diminishing returns, and school-based lockouts.

### Corrected control fixes for upward jump, knockback, and mohe cleanse (2026-04-17)
- **Dash facing-lock lesson**: The clean model for dash turning is a shared runtime lock plus a narrow override buff, not ability-specific movement branches. Put the default "lock facing while dashing" rule on the shared displacement runtime buff, then let only abilities like `穹隆化生` and `踏星行` carry a separate `DASH_TURN_OVERRIDE` buff so backend steering and frontend prediction stay on one permission check.
- **Lockout DR lesson**: Shared lockouts need their own resistance bucket and overwrite rule, but dash self-lock should not live inside that bucket. Treat enemy-applied `沉默/ATTACK_LOCK` as one overwrite + DR family, leave `封轻功` outside it, and represent self dash cast-lock as a separate `DISPLACEMENT` runtime so movement states do not pollute lockout DR.
- **Upward-jump exception**: The corrected rule is not "always kill airborne momentum." Under root/control, grounded movement and directional airborne travel should stop immediately, but a pure upward-jump rise should continue. The clean implementation point is `movement.ts`, by clearing air shift and horizontal carry only when the player is not in a pure upward-jump rise state.
- **Knockback consistency lesson**: If an ability applies knockback from a timed loop path instead of the normal buff-application path, it still needs to go through one named helper or it will drift away from immunity and control rules. Centralizing `wu_jianyu` knockback in a shared helper fixed `KNOCKBACK_IMMUNE` handling and second-knockback rejection without changing the existing instant-shove feel.
- **Shared displacement runtime lesson**: Type-3 displacement states should not invent separate hidden lockouts. Reusing the same dash-runtime buff for knockback keeps mohe knockdown and other incoming hard-control checks on one shared immunity path, and exposing that runtime buff in preload is enough to make it render in the HUD.
- **Knockdown cleanse lesson**: mohe knockdown is currently encoded as a `CONTROL` buff, so generic level-1 cleanse logic will remove it unless the knockdown is explicitly excluded. If type-2 knockdown is meant to survive skills like `蝶弄足`, the current code needs a special-case exclusion until knockdown becomes its own effect family.
- **Triggered-follow-up lesson**: Special attacks like `无间狱` follow-up hits are easier to maintain behind a whitelist helper than as naked `abilityId === ...` branches inside the loop. The useful split here is "break stealth only" versus "count as a normal play," not a generic all-or-nothing triggered-cast rule.
- **Timing correction correction**: The previous `3s / 4s / 5s` follow-up change was wrong. `无间狱` is still a full 10-second buff, but its actual strike checkpoints should be `2s / 3s / 4s` after buff gain, which means the buff bar is around `8s / 7s / 6s` remaining when they fire.

### DR visibility and stale-build lesson (2026-04-17)
- **Visible DR lesson**: DR that exists only as hidden math is not testable enough for this project. Resistance has to exist as a normal runtime buff with a countdown and stack value so the player can verify it live from the buff row.
- **DR source-of-truth lesson**: The visible resistance buff itself has to be the only counter. If it has expired, the next control must recreate it at 1 stack instead of inheriting any hidden count.
- **Knockdown separation lesson**: Because `摩诃无量` knockdown is still encoded as `CONTROL`, any generic stun-DR check that keys off `CONTROL` too early will accidentally reduce or consume knockdown. The safe rule is to key knockdown off its specific buff identity and exclude it before any stun DR logic runs.
- **Pipeline consistency lesson**: The natural-end `摩诃无量·眩晕` follow-up should go through `addBuff()` rather than being pushed directly in `GameLoop.ts`, otherwise it bypasses the same DR, event, and filtering logic as all other stuns.
- **Build artifact lesson**: When runtime behavior and TypeScript source disagree, check `dist/` immediately. In this repo the backend runs `dist/index.js`, so stale compiled control logic can survive until a clean rebuild replaces it.
- **Buff timer UI lesson**: A countdown fed by `expiresAt` should be seeded immediately and displayed as the real remaining time. Flooring a fresh timer or clamping tooltip text to a fake minimum makes 5-second buffs appear to start at 4 seconds even when backend timing is correct.

### Realtime countdowns need server-time alignment (2026-04-17)
- **Root cause**: Buffs, channels, and ground-zone timers are authored with absolute server `Date.now()` timestamps, but the frontend countdowns were reading them back with each client's local `Date.now()`. If one client clock is ahead by about 2 seconds, that client will see every 5-second buff as roughly 3 seconds while another client can still look correct.
- **Fix pattern**: Add a server timestamp to snapshots and websocket heartbeat replies, track a client/server clock offset in `useGameState.ts`, and normalize incoming absolute timestamps as they enter frontend state. Do not leave each widget to guess against local machine time on its own.
- **UI follow-up**: Channel bars also need elapsed-time alignment on mount. A CSS animation keyed only by `appliedAt` or `startedAt` restarts from full duration unless it also receives a negative animation delay for the already-elapsed portion.
- **Stability follow-up (2026-04-19)**: Recomputing clock offset from every high-frequency `STATE_DIFF` packet can add jitter and make channel bars appear too fast/unstable. The safer approach is to treat heartbeat/snapshot timestamps as the sync source, clamp one-way latency compensation, and smooth offset updates before normalizing UI timestamps.

### Zone invulnerability needs effect-layer blocking, not target-validation failure (2026-04-17)
- **Invulnerability lesson**: If a defensive state is meant to let enemy abilities consume cooldowns normally while doing nothing, it cannot live in target-validation. Add a separate `INVULNERABLE` effect to the enemy-effect guard layer so casts still resolve but damage, knockback, and debuff application are filtered out during resolution.
- **Internal-cooldown lesson**: `玄剑 -> 化生势` is cleanest as a natural buff-expiry transform in `GameLoop.ts`, not as a special timer outside the buff system. The zone only needs to apply `玄剑` once on first eligibility, and the regular expiry pass can promote it into the longer lockout buff.

### Dash reach-hit + control immunity filtering updates (2026-04-19)
- **Dash completion hook lesson**: For abilities that apply control at dash start but damage on arrival (like `棒打狗头`), store a tiny on-complete hit payload on `activeDash` and resolve the damage in `GameLoop.ts` only when dash ends naturally.
- **Root + control immunity lesson**: In this project's control model, `CONTROL_IMMUNE` states (including dash runtime immunity) must filter `ROOT` in `addBuff()` as well; otherwise you can incorrectly produce root DR (`锁足递减`) on applications the user expects to fail.
- **Ground-cast UX lesson**: For abilities with `allowGroundCastWithoutTarget`, silently entering ground-target mode is clearer than showing repetitive "请选择地面位置施放" toasts on every cast attempt.
- **Cooldown-slow stack lesson**: `COOLDOWN_SLOW` currently sums raw effect values per buff effect entry in `GameLoop.ts`; if a debuff is authored as fixed 3 stacks on apply, represent the total slowdown directly in effect values (or multiple effect entries), not by relying on `stacks` alone.

### 镇山河 guaranteed self-buff and single dash runtime lesson (2026-04-18)
- **Self-buff split lesson**: `镇山河` self-cast protection and zone refresh protection cannot share the same runtime buff id. The guaranteed 2-second self-buff must always apply on cast, while `化生势` should block only the zone-pulse refresh path.
- **Fast-exit zone lesson**: If the goal is "leave the area and lose the effect almost immediately," the zone pulse duration must be as short as the pulse cadence. A `100ms` pulse that grants `100ms` of zone-only invulnerability drops cleanly on exit; a long refreshed duration does not.
- **Single dash-state lesson**: If dash is supposed to be one visible state, put `CONTROL_IMMUNE`, `KNOCKBACK_IMMUNE`, `DISPLACEMENT`, and `DASH_TURN_LOCK` on one shared runtime buff and reuse it for both `DASH` and `DIRECTIONAL_DASH`. Separate runtime ids for immunity versus cast-lock only create duplicate HUD buffs.
- **UI-only helper lesson**: Some abilities may still need a private helper buff for gameplay timing, such as `散流霞隐藏`. If the user wants to see only one dash buff, hide those helper buffs from the status bar instead of surfacing duplicate dash-state rows.
- **Prediction parity lesson**: Once backend dash runtime is fully facing-locked, remove all frontend dash-turn override paths in `BattleArena.tsx`. Leaving client-side override checks behind makes prediction drift back toward the old model.
- **Air-cast gate lesson**: For instant self skills like `镇山河`, the airborne restriction is just `requiresGrounded`. If the skill should work while jumping or falling, remove that authored flag instead of trying to special-case movement validation.
- **Hidden override lesson**: The shared dash runtime can stay as the one visible dash buff while still allowing skill-specific turn exceptions. The clean pattern is a hidden helper buff carrying `DASH_TURN_OVERRIDE`, with the same override check in both backend `movement.ts` and frontend `BattleArena.tsx`.
- **Ground-projected zone lesson**: Letting airborne self-casts author `groundZones.z` from the caster's current altitude makes the whole volume float in mid-air. `PLACE_GROUND_ZONE` needs to project the zone center onto the map support height under that XY, using the same map context as movement, so a high-air `镇山河` lands on the floor below and only affects players who actually descend into it.

---

## Abilities / Editor

### DAMAGE_IMMUNE must be checked in every damage code path (2026-04-29)
- **Bug**: `hasDamageImmune` existed in `guards.ts` and was checked in `Damage.ts` (handleDamage) and `GameLoop.ts` PERIODIC_DAMAGE, but multiple custom ability handlers in `immediateEffects.ts` called `applyDamageToTarget` directly without checking it first.
- **Affected paths**: `BAIZU_AOE`, `WUFANG_XINGJIN_AOE`, `HENG_SAO_LIU_HE_AOE` victim loops; `BANG_DA_GOU_TOU` fallback damage branch; `SETTLE_SOURCE_DOTS` DoT flush; `YIN_YUE_ZHAN` and `LIE_RI_ZHAN` damage cases; dash reach damage in `GameLoop.ts`.
- **Symptom**: 雷霆震怒's `DAMAGE_IMMUNE` buff effect did not block damage from these paths.
- **Fix**: Added `if (hasDamageImmune(victim)) continue/break;` before every `applyDamageToTarget` call in custom handlers. For `SETTLE_SOURCE_DOTS`, wrapped the DoT apply in `if (!hasDamageImmune(...))`. For `BANG_DA_GOU_TOU` fallback, changed `} else {` to `} else if (!hasDamageImmune(victim)) {`.
- **Lesson**: Any new ability with a custom damage path MUST add `hasDamageImmune` check. `handleDamage` in `Damage.ts` is NOT guaranteed to be the only code path that deals damage.

### Ability rarity system (2026-04-29)
- **Design**: Rarity is stored as an optional override in `ability-property-overrides.json` per ability, alongside other editor overrides. Values: `精巧` (green), `卓越` (blue), `珍奇` (purple), `稀世` (orange).
- **Backend**: `ABILITY_RARITIES` + `AbilityRarity` type in `abilityPropertySystem.ts`. `setAbilityRarity()` in `abilities.ts`. PUT route `/api/game/ability-editor/:abilityId/rarity`. Rarity included in `abilityPreload.ts` `cardPayload`.
- **Frontend editor**: Rarity selector buttons in `/ability-editor/[abilityId]/page.tsx`. `updateRarity()` calls PUT route, clicking the currently-active rarity deselects it (sets to null).
- **Frontend cheat panel**: `RARITY_ORDER` sort + `RARITY_COLOR` border in `BattleArena.tsx`. Single flat grid replacing the old 已测试/持续伤害/测试中/待重做 tab sections. Icon border color reflects rarity (gray for unset).

### New abilities added 2026-04-20: 春泥护花, 圣明佑, 烟雨行, 太阴指
- **春泥护花** (chun_ni_hu_hua): buffId 2316. Self-cast, 8 stacks. New effect type `STACK_ON_HIT_GUAN_TI_HEAL` (贯体 heal on hit, stack consumed). 40% DR from DAMAGE_REDUCTION effect. Implemented in GameLoop.ts stack proc section (same loop as STACK_ON_HIT_DAMAGE). Uses GCD.
- **圣明佑** (sheng_ming_you): buffId 2317. New effect type `INSTANT_GUAN_TI_HEAL` handled in immediateEffects.ts (direct `applyHealToTarget`, bypasses HEAL_REDUCTION). Buff: 20% DODGE. No GCD.
- **烟雨行** (yan_yu_xing): DIRECTIONAL_DASH forward 20u, 2 charges (chargeRecoveryTicks 300), CLEANSE root/slow. No GCD, 轻功.
- **太阴指** (tai_yin_zhi): buffId 2318. DIRECTIONAL_DASH backward 30u, `durationTicks: 21` (0.7s). Buff "太阴指" 100% DODGE 800ms. Uses GCD, 轻功.

### STACK_ON_HIT_GUAN_TI_HEAL effect type pattern (2026-04-20)
- Added to effects.ts, categories.ts (BUFF category), and GameLoop.ts stack-proc scan section.
- Healing bypasses HEAL_REDUCTION (uses raw `applyHealToTarget`).
- Push HEAL event with `effectType: "STACK_ON_HIT_GUAN_TI_HEAL"`.

### Pull immunity via KNOCKBACK_IMMUNE (2026-04-20)
- The `TIMED_PULL_TARGET_TO_FRONT` code in GameLoop.ts did NOT previously check `hasKnockbackImmune`. Fixed by adding the guard before the pull activeDash setup.
- 心诤 (buffId 1017), 千蝶吐瑞 (buffId 2003), 笑醉狂 (buffId 2001) now have `KNOCKBACK_IMMUNE` in their buff effects, making them immune to both knockback and pull.

### Channel bar on jump (frontend, 2026-04-20)
- For forward channels with `cancelOnJump: true`, the frontend bar now immediately hides when `localJumpCountRef.current > 0 || |localVzRef| > 0.01`.
- For reverse channel buffs 2001/2003 (jump-cancelling ones), same local airborne check applied.
- Pattern: read refs directly in the IIFE that computes `channelBarData`; re-renders happen every 50ms via `setMyZ` interval.

### 绝脉 max stacks 3→12 (2026-04-20)
- Changed `maxStacks: 3` to `maxStacks: 12` in the 绝脉 buff (buffId 1337) in abilities.ts.
- Each cast still applies 3 initial stacks; they now accumulate up to 12.

### Charged GCD must use `chargeLockTicks` (2026-04-19)
- **Bug**: Global GCD was writing only `cooldown`, but charge-based abilities recompute `cooldown` from `chargeCount/chargeLockTicks` each tick. Result: charged skills could visually and functionally bypass the intended 1.5s GCD after a cast.
- **Fix**: When applying global GCD to a charged ability, initialize charge runtime and set `chargeLockTicks = max(existing, gcdTicks)` in addition to `cooldown`.
- **Takeaway**: For charged skills, runtime lock state is authoritative; setting `cooldown` alone is not enough.

### Ability property editor should layer runtime JSON overrides over canonical abilities (2026-04-17)
- **Problem**: The user needs a self-serve UI for toggling gameplay properties such as “can cast while controlled” without asking for source edits every time.
- **Disproved approach**: Rewriting `backend/game/abilities/abilities.ts` from the UI is the wrong persistence model. It is brittle, mixes authored defaults with live tuning, and makes “remove override / return to code default” much harder.
- **Working approach**: Keep `backend/game/abilities/abilities.ts` as the canonical authored baseline, store only diffs in `backend/game/abilities/ability-property-overrides.json`, rebuild the exported `ABILITIES` object from `BASE_ABILITIES + overrides`, and expose an authenticated `/api/game/ability-editor` API for the frontend UI.
- **Important implementation detail**: Some legacy flags like `allowWhileControlled`, `allowWhileKnockedBack`, and `cleanseRootSlow` were previously encoded only on effects. For editing, add ability-level runtime flags and keep validation/effect handling compatible with both the new top-level flags and old effect-level data.
- **Acceptance-test proof**: `暗尘弥散` keeps casting under CONTROL when `allowWhileControlled` is enabled, fails with `ERR_CONTROLLED` after the property is removed through the runtime override path, and works again after restoring the default.
- **UI semantics lesson**: If most abilities share the same behavior, expose the exception in the editor, not the default. `gcd` as a positive property was noisy because most skills use it; flipping it to `不触发GCD` keeps the visible property list small and matches the user’s mental model.
- **Damage editor lesson**: Damage editing works best as path-based numeric overrides derived from the canonical ability shape. Build a list of editable damage slots from live effect paths like `effects.0.value`, `effects.1.routeDamage`, and `buffs.0.effects.0.value`, then store only those numeric diffs beside the boolean property diffs in the same override JSON.
- **Icon and naming lesson**: Ability icons should reuse the same battle UI rule instead of creating a second mapping path: `/game/icons/Skills/${ability.name}.png`. If the editor is meant for non-technical use, do not show internal ability ids by default; keep them only for internal lookup, saves, and search.
- **Overview/detail editor lesson**: The ability list should stay browseable and dense. A compact 4-up overview card grid with icon, short description, and a few tags works better than a giant inline form. Put all real editing on a separate detail page, and group channel-specific properties plus channel timing there instead of mixing them into the overview.
- **Channel editor lesson**: Do not invent a second editor-only model for 读条. Reuse the live runtime fields already used by gameplay: pure channels come from ability-level `channelDurationMs/channelForward/channelCancelOnMove/channelCancelOnJump`, while reverse or buff-style channels come from the buff channel fields. That lets the editor show true 正读条/逆读条 state, editable total duration, editable tick count where supported, and derived per-tick timing from the same authoritative data.

### Dash in collision-test mode bypassed BVH (FIXED)
- **Bug**: During `activeDash` in `movement.ts`, horizontal collision used `resolveObjectCollision` (AABB) instead of `resolveExportedHorizontalCollision` (BVH). Vertical ground snapping used `getGroundHeight` (AABB) instead of `getExportedGroundHeight` (BVH).
- **Symptom**: In collision-test mode, dashes could clip through BVH-only walls; terrain height wasn't followed during dashes; player floated above/clipped into terrain while dashing.
- **Fix**: In the `activeDash` block of `movement.ts`, now uses `hasExportedCollision(mapCtx)` to switch between BVH and AABB collision for both horizontal and vertical handling.
- **Files**: `backend/game/engine/loop/movement.ts`

### 疾 ability visual "collision with opponent" in frontend
- **Root cause**: Was caused by AABB building collision during dash (entity-level AABBs in exportedMap.objects include entity_13 right at spawn, h=4.62). Small AABB buildings were stopping the dash via `resolveObjectCollision`, causing the player to appear to bounce. Fixed by the above BVH dash fix.
- The BVH system passes through thin obstacles correctly instead of bouncing.

---

## LOS / Vision Checks

### Small terrain-level objects falsely blocking LOS (FIXED)
- **Bug**: `isLOSBlocked` and `isLOSBlockedClient` checked ALL AABB objects, including tiny ground-level props in the exported map (e.g., h=2.84, h=2.96, h=3.04, h=3.72, h=3.82, h=4.62, h=5.76). The map floor is 3D terrain, so these objects represent ground bumps that players can stand on, not walls.
- **Symptom**: In collision-test mode, targeting abilities showed "视线被建筑遮挡" even when the path was open. Channel spells cancelled immediately on slightly uneven ground.
- **Also found**: `validateAction.ts` was hardcoded to `worldMap.objects` for LOS regardless of game mode — this is now fixed to use the correct map via `options.mapObjects`.
- **Fix**: 
  - Added `minBlockH` parameter to `isLOSBlocked` (backend) and `isLOSBlockedClient` (frontend). Objects with h < 5.5 game units are now ignored as LOS blockers.
  - Added `casterZ` / `targetZ` parameters: if both players' feet are at or above the object's top, the object doesn't block (handles elevated terrain).
  - In collision-test mode, `minLOSBlockH = 5.5` is passed at all call sites.

---

## Buff Editor (2026-04-22)

- Buff editor filtering works best as a two-step slice: first `有利 / 不利`, then an attribute sub-filter over the already-sliced list. Counting the attribute buckets against the full list makes the second row misleading.
- If the buff card attribute is editable and the allowed values can grow, use a dropdown instead of per-card chips. Chips scale badly once the attribute list grows past a handful of options.
- Buff editor overrides are no longer just attributes. Store both `attribute` and `description` in one shared override file and keep backward compatibility with the older string-only attribute shape so existing override JSON still loads.
- Buff description overrides should be applied in `buildAbilityPreload()` as well as the editor snapshot. Otherwise the editor shows the new text while preload-driven runtime UI such as the status bar still shows the old description.
- Missing buff icons need one shared fallback rule, not separate ad hoc behavior. A shared helper plus a real `fallback` asset keeps the editor `<img>` path and the in-game status-bar background path aligned.
- `隐藏` should not live in the attribute enum. Treat it as a separate persisted boolean flag, or attribute filters and dispel-oriented tagging both become semantically wrong.
- If buff names become editable, freeze icon lookup to the original icon path before applying the name override. Using the edited display name as the icon filename immediately turns most renamed buffs into fallback icons.
- Hidden-state filtering needs its own dropdown separate from the attribute filter, and the default slice should be `显示`. Defaulting the editor to `全部状态` makes hidden buffs leak back into the main working list.
- If the name action is meant to feel attached to the title, do not let the title text flex across the whole row. Otherwise the pen icon drifts toward the card edge instead of staying visually next to the name.
- Once `无` becomes a real dispel attribute and `未选择` becomes the workflow placeholder, the override loader needs a versioned migration rule. Old files used `无` to mean “not set yet”, so only pre-migration versions should remap stored `无` to `未选择`.
- The hidden-buff rule has to be enforced in the backend snapshot/update layer, not just by disabling the dropdown in the UI. Otherwise old overrides or direct API calls can still leave a hidden buff carrying a stale attribute.
- Flattening `Skills/` and `buffs/` into one `/game/icons/` root is only safe after checking filename collisions. Most duplicate names were byte-identical, but `心诤`, `散流霞`, `长针`, and `风袖低昂` used different art and needed explicit buff-specific filenames plus explicit `iconPath` overrides.
- After an icon-folder merge, update both the source path builders and the stored preload `iconPath` defaults together. Changing only frontend helpers leaves backend-authored buff metadata pointing at dead asset paths.
- If the project is still expected to serve icons from `public/game/icons`, preserve that folder and its full inventory. Moving those files into `public/icons` may look harmless, but it breaks the agreed asset root and forces every render/preload caller to change with it.
  - `validateCastAbility` now receives `mapObjects` and `minLOSBlockH` via options (set by `playService.ts` from `loop.getMapCtx()`).
  - Added `GameLoop.getMapCtx()` public method.
- **Files**: `backend/game/engine/loop/GameLoop.ts`, `backend/game/engine/rules/validateAction.ts`, `backend/game/services/gameplay/playService.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### LOS still false-blocking at range — eye-height + AABB-inside fix (2025)
- **Root cause**: Entity-level AABBs in the exported map over-approximate reality. E.g., entity_0 (h=135, 89×115 footprint) covers a huge area including open spaces players stand in.
- **Two new filters added** (both backend + frontend):
  1. **Eye-height**: Object is skipped if `obj.h <= Math.min(casterZ + 1.5, targetZ + 1.5)`. Objects shorter than both players' eye heights can't block LOS.
  2. **Player-inside-AABB**: If either player is standing inside the object's 2D footprint (point-in-AABB check), the object is skipped. This handles the over-large AABB problem where players in open areas within a building's bounding box should not be blocked by that building.
- **Return type changes**: `isLOSBlocked()` now returns `string | null` (blocking entity id or null). `isLOSBlockedClient()` returns `MapObject | null`.
- **Debug overlay added**: When a cast fails with LOS blocked, a red overlay shows the blocking entity ID and bounds. A wireframe red box highlights it in the 3D scene.
- **Backend logging**: `validateAction.ts` now logs `[LOS] blocked by entity_X (casterZ=N targetZ=N)` for server-side debugging.
- **Files**: Same + `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`

---

## Build / Deployment

- Build order: backend first (`npm run build`), then frontend (`npm run build`), then `pm2 restart all`.
- If a port is stuck: `lsof -ti:PORT | xargs kill -9`, then `pm2 restart all`.
- Never edit `.ts` files and expect changes to appear without rebuilding — ts-node compiles only at startup.

### Atlas connectivity failure is separate from gameplay/unit edits (2026-04-14)
- **Diagnosis**: The MongoDB failure seen after the collision-test unit migration was not caused by changes to `backend/db.ts`, `backend/app.ts`, or `backend/index.ts` — those files were not modified.
- **Verified facts**:
  - The backend still loads the same `mongodb+srv://...@cluster0.sedw7v9.mongodb.net/...` URI from `.env`.
  - SRV lookup for `_mongodb._tcp.cluster0.sedw7v9.mongodb.net` resolves correctly to the three Atlas shard hosts.
  - Direct TCP connection attempts from this VM to all three shard hosts on port `27017` return `ECONNREFUSED`.
  - An isolated `mongoose.connect()` probe reproduces the same `MongooseServerSelectionError` without involving gameplay code.
- **Practical takeaway**: If Atlas access breaks immediately after gameplay edits, do not assume the gameplay code caused it. First verify SRV resolution and raw socket reachability from the VM. In this case the failure is at Atlas/network access level from public IP `147.224.13.78`, not in the movement or unit-conversion code path.

### PM2 frontend restart can fail with stale port ownership (2026-04-14)
- **Symptom**: After restoring apps from `ecosystem.config.js`, PM2 showed the frontend in `errored` state with `EADDRINUSE: address already in use :::3000`.
- **Fix**: Follow the repo deployment rule literally: `lsof -ti:3000 | xargs -r kill -9`, then `pm2 restart frontend`.
- **Takeaway**: When PM2 state is rebuilt or a stale daemon is replaced, do not assume the old process released port `3000` cleanly. Verify with `pm2 logs frontend` and clear the port before retrying the restart.

### PM2/frontend can flap when a separate `next dev` owns port 3000 (2026-04-19)
- **Symptom**: PM2 frontend repeatedly moved between `online` and `errored`, while port checks intermittently returned `HTTP 200`. Logs showed alternating `EADDRINUSE :3000` and `Could not find a production build in the '.next' directory`.
- **Root cause**: A separate terminal had `next dev` running and reclaiming port `3000`, while PM2 frontend expected production startup. This created misleading mixed-state signals between `pm2 status`, `curl`, and logs.
- **Fix**: Identify listener ownership (`ss -ltnp '( sport = :3000 )'`), kill the non-PM2 process, rebuild frontend (`npm run build`) to ensure `.next/BUILD_ID` exists, then restart PM2 frontend.
- **Takeaway**: For frontend startup issues, always verify all three together: PM2 process state, actual port owner (`ss`/`lsof`), and production artifact presence (`frontend/.next/BUILD_ID`).

### Collision-test movement regression check after canonical-unit migration (2026-04-14)
- **Flat sandbox backend verification** (`unitScale = 1`, no terrain/walls):
  - Directional jump lands at ~`5.882u` (expected discrete-tick result for the 6-unit budget).
  - Upward jump drift lands at exactly `2.0u` and does not rotate facing.
  - Directional dashes hit authored distances exactly: `蹑云逐月 20`, `迎风回浪 10`, `凌霄揽胜 7`, `瑶台枕鹤 7`, `后撤 2.7`, `疾 37`, `踏星行 62.5`.
  - `扶摇直上` and combined `扶摇 + 鸟翔碧空` still produce the expected tall-jump behavior (measured discrete peaks ~`12.56u` and ~`23.55u`).
- **Collision-test map spot-check** (real exported map + BVH):
  - `蹑云逐月` still travels ~`20u` from the tested spawn.
  - `疾` measured slightly short on the real map at the chosen spawn because environment/collision constrains the path; the flat sandbox confirms the authored distance conversion itself is correct.
- **Takeaway**: After a unit-system migration, verify movement twice: once in a flat sandbox to confirm pure authored values, and once on the real collision-test map to catch environment interactions.

### Atlas connect failure root cause: local nftables blocked outbound MongoDB port (2026-04-14)
- **Disproved first**: The failure was not caused by gameplay/unit edits, not by a stale SRV record, and not by a bad Mongo URI. `backend/.env` still pointed at `cluster0.sedw7v9.mongodb.net`, and public DNS resolvers returned the same Atlas SRV/A records as the VM.
- **Manual proof**:
  - Direct Mongo driver heartbeats failed with `ECONNREFUSED` to all three Atlas shard IPs: `89.192.9.170`, `89.192.9.179`, `89.192.9.173`.
  - `openssl s_client` to shard port `27017` also failed before the fix, which ruled out a Mongoose-only issue.
  - The VM's active nftables ruleset had `tcp dport { 6379, 11211, 27017 } reject` in the `OUTPUT` chain.
- **Actual fix**:
  - Remove `27017` from the live nftables `OUTPUT` reject rule.
  - Persist the same change in `/etc/nftables.conf`, then reload nftables.
  - After that, all three Atlas shard TLS handshakes succeeded and a direct MongoDB `ping` returned `{ ok: 1 }`.
- **Takeaway**: If Atlas suddenly fails with `ECONNREFUSED` from a whitelisted VM, inspect the VM's own outbound firewall before blaming Atlas IP access. In this case the VM itself was rejecting MongoDB egress on port `27017`.

### Post-dash jumps must not inherit dash-speed carry (2026-04-14)
- **Symptom**: After a qinggong dash ended in air, the next forward jump could arm an oversized horizontal travel budget because jump scaling still saw the dash's planar speed snapshot.
- **Root cause**: `movement.ts` kept writing `airborneSpeedCarry` from `activeDash`, and airborne dash completion did not clear it. The next jump then took the max of base move speed and the stale dash carry.
- **Fix**: Completed dashes now clear `airborneSpeedCarry`, and active dash ticks no longer refresh that carry. Follow-up jumps after dash completion now use restored movement speed again.
- **Frontend parity**: `BattleArena.tsx` had the same stale carry pattern. Local prediction no longer seeds `airborneSpeedCarry` from `activeDash`, and dash end always clears it.
- **Verification**: Backend simulation confirmed that a follow-up forward jump after airborne `蹑云逐月` or `疾` now re-arms the normal `6u` directional jump budget instead of a dash-scaled value.

### Prediction drift root cause: frontend duplicates backend movement state machine (2026-04-14)
- **Current reality**: Almost all real prediction lives inside `frontend/.../BattleArena.tsx`, where jump, dash, grounded checks, BVH collision, LOS checks, range checks, and movement reconciliation are all manually mirrored from backend logic.
- **Why drift keeps happening**: Backend movement changes are not flowing through a shared simulation core. Small state-machine changes like dash carry, jump budgeting, step-up rules, or support handling can be fixed server-side and still remain stale in the frontend mirror.
- **Durable plan**:
  1. Extract a shared pure movement/prediction core that both backend and frontend import.
  2. Keep transport, reconciliation, and rendering in `BattleArena.tsx`, but move jump/dash/grounded state transitions out of it.
  3. Add a tick-by-tick parity harness for representative cases: grounded run, directional jump, double jump, dash end into jump, wall hit, and roof walk-off.
  4. Until the shared core exists, treat "backend movement change" and "frontend prediction check" as one task. This rule was added to `.github/copilot-instructions.md`.

### Collision-test player collision body reduced to 1.5h / 0.32r (2026-04-14)
- **Change**: Collision-test player radius was reduced from `0.64` to `0.32`, and the exported BVH cylinder height was reduced from `2.0` to `1.5` units (`half-height 0.75`).
- **Files**: Backend collision constants and movement cylinder sizing were updated, plus frontend local prediction, collision debug shell, and rendered character body sizing.
- **Sweep result**: After the change, no stray source-side `0.64`, old `2.0` player-height comments, or raw runtime `2.2` fallbacks remained in the gameplay code path. Remaining `2.2` references are intentional named legacy conversion constants for non-collision-test modes or raw exported asset remapping.

### Collision-test player body width retuned to 1.5h / 0.384r (2026-04-14)
- **Change**: After the first reduction to `0.32` radius, the body felt too thin. Final tuning is `0.384` radius (20% wider) while keeping height at `1.5`.
- **Sync requirement**: Backend exported collision radius, frontend local prediction radius, debug collision shell, and rendered character width must all change together or wall/edge behavior and visuals drift apart again.

### House-wall and roof-edge behavior in collision-test (2026-04-14)
- **Vertical wall while jumping**: The authoritative BVH horizontal pass blocks XY immediately but does not cancel upward motion. A backend probe against `entity_13` showed `x` freezing on the first tick while `z` kept rising each tick, which means house walls behave like slide/block surfaces, not jump-cancel surfaces.
- **Roof support rule**: Standing support comes from `getSupportGroundY(center)` under the cylinder center. There is no footprint-percentage check such as "50% of the body must still be over the roof." If the center still has support, the player stays supported; once support under the center falls away, the player starts falling.
- **Observed walk-off behavior**: On walkable roof `entity_0`, the player stayed grounded while the support under the center still tracked the roof surface. Once the center moved far enough that support dropped faster than the grounded snap could follow, `vz` became negative and the fall started.
- **Ceiling / roof-hit fix**: The BVH vertical pass now also probes the nearest ceiling above the player and clamps the 1.5-unit collision body under it. Upward momentum is killed immediately on contact and `vz` flips negative so both upward and directional jumps start falling right after the head hits the roof.
- **Important support fix**: Ground support for movement now probes from just above the feet instead of from above the whole body. Without this, nearby low roofs could be misread as "ground" and cause bad snap behavior.
- **Verified feel case**: A backend probe at a real low-ceiling point with only about `0.09` units of headroom above the 1.5-unit body stopped the jump on tick 2 and started the fall immediately after contact.
- **Remaining limitation**: Ceiling detection is still center-line based, like the current roof-support rule. It solves direct roof hits above the player, but it is not yet a full body-footprint ceiling solver for edge-only head contacts.

---

## Mobile Controls

### Virtual joystick for touch devices
- **Implementation**: `VirtualJoystick.tsx` — analog circular joystick using `React.TouchEvent`, tracks single touch ID, fires `onDirectionChange` (WASD booleans for keysRef) and `onAnalogMove` (dx/dy for smooth server-side movement).
- **Mobile detection**: `navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches` — detects phones/iPads without a fine pointer (mouse). Auto-switches `controlMode` to 'joystick' on first load if mobile is detected.
- **Jump button**: Integrated as a separate touch circle next to the joystick.
- **Analog movement**: `joystickDirRef.current` stores the latest normalized (dx, dy). In `sendMovement`, joystick mode now sends `{dx, dy, jump}` directly when the joystick is active (same as traditional mode's precise direction vector). The backend `MovementInput` interface already supports optional `dx/dy` overrides.
- **Files**: `VirtualJoystick.tsx` (rewritten), `BattleArena.tsx`

### Touch camera rotation (iPad/iPhone)
- **Implementation**: A `useEffect` in `BattleArena.tsx` adds `touchstart/touchmove/touchend` on `window`, matching the touch to a finger that started inside `wrapRef` (the 3D canvas div). Swipe rotates camera + player facing (same as PC right-click drag).
- **Critical**: Joystick's `onTouchStart` uses `e.preventDefault()` so it captures its own touches before the canvas-level listener sees them.
- **Lesson**: Touch listeners for camera must be `passive: true` on `window`, but this means we can't call `preventDefault` to block scroll. Use `touch-action: none` on the `.container` CSS class and `document.body.style.overflow = 'hidden'` in a `useEffect` to prevent page scroll.
- **Joystick position**: Expressed as `left: '70%', bottom: '60%', transform: 'translate(-50%, 50%)'` — must use CSS % strings, not pixel integers, for proper screen-relative placement.
- **Files**: `BattleArena.tsx`, `BattleArena.module.css`

---

## Frontend Client-Side BVH LOS

### Real-time ability LOS indicator without server round-trip
- **Problem**: In collision-test mode, AABB `isLOSBlockedClient` was disabled (mode guard `!== 'collision-test'`), so abilities targeting an opponent behind a wall showed no indicator until server rejection.
- **Solution**: Added `MapCollisionSystem.checkLOS(from, to, radius)` using the same BVH raycast as the existing `shellBVH`. Added `clientCheckLOS()` helper in `BattleArena.tsx` that converts game coordinates to BVH space using the same formula as the backend (`ExportedMapCollisionSystem.checkLOS`).
- **Coordinate transform**: `x = (px - halfW - GROUP_POS_X) / RENDER_SF`, `y = (pz + 1.5 - GROUP_POS_Y) / RENDER_SF`, `z = (halfH - py - GROUP_POS_Z) / RENDER_SF`.
- **LOS eye height**: `1.5` game units added to Z (height) so the ray shoots from chest-level, not floor-level.
- **Result**: Abilities now gray out with red glow border in real time when target is behind a BVH wall. Blueprint mode shows a green/red line to the target.
- **Files**: `MapCollisionSystem.ts`, `BattleArena.tsx`, `ArenaScene.tsx`

### Legacy "ghost" AABB entities blocking LOS (the root breakthrough)
- **Root cause was NOT a ground/terrain problem**: The original complaint "opponent near a house blocks vision" was caused by the old AABB entity bounding boxes (e.g., `entity_73`, `entity_74`). These AABBs are massively over-approximate — they cover entire courtyard areas including places the player stands. When targeting from "inside" one AABB, the AABB check always failed.
- **Disproved approach**: Spent time trying `minBlockH` filters and eye-height filters on the AABB path — partial fix but still wrong for large AABBs.
- **Actual fix**: Switch LOS entirely to BVH raycast in collision-test mode, both client and backend. The BVH uses actual triangle geometry (exported from the 3D map via Three.js BVH), so it is always accurate. AABB checks are now only used as fallback for non-collision-test modes.
- **Key insight**: The frontend blueprint wireframe mode (cyan collision mesh) and the BVH raycast use identical geometry → if the line in blueprint mode passes through open space, the ability should be castable.
- **Files**: `exportedMapCollision.ts` (backend), `MapCollisionSystem.ts` (frontend)

---

## Dash Wall Tunneling

### Fast dashes clipping through walls (FIXED)
- **Bug**: During `activeDash`, horizontal movement was applied in one large step (~1.23 game units/tick for 疾). BVH collision only resolved at the final position, not along the path.
- **Symptom**: 疾 and 蹑云逐月 could dash straight through BVH walls that were thinner than the dash step size.
- **Fix**: Added sub-stepping in `movement.ts` for dash XY movement. Max sub-step = `playerRadius × 0.85 ≈ 0.544u`. `疾` → ~3 sub-steps/tick, `蹑云逐月` → ~2 sub-steps/tick. Each sub-step applies partial XY, clamps arena bounds, and runs full BVH collision resolution.
- **Files**: `backend/game/engine/loop/movement.ts`

---

## Debug/Display Cleanup

### AABB "Part Boxes" button replaced with BVH mesh
- The "Part Boxes" orange AABB debug display was inaccurate (over-approximate boxes). Replaced with the actual BVH shell mesh (`showCollisionShells`). The "Shell+Probe" and "Part Boxes" buttons were merged into a single "碰撞体" button that toggles the BVH wireframe.
- **Key insight**: Never use AABB for visual collision debugging in collision-test mode — the real collision uses BVH, so the debug display should too.
- **Files**: `BattleArena.tsx`, `ArenaScene.tsx`, `ExportedMapScene.tsx`

### `instanceId` undefined crash in commonUpdated map
- **Bug**: In the `commonUpdated` `.map()` block, the return object referenced `instanceId` which is a `const` declared inside the sibling `draftUpdated` block — not in scope.
- **Fix**: Common abilities use `ability.id` as their stable ID (they have no per-instance ID).
- **Lesson**: Code copying between the draft and common ability map blocks must be careful about scope. Always check what `const` variables are actually declared in the current block.

### `allowOverrangeCameraZoom` runtime crash from helper-scope leak (2026-04-19)
- **Bug**: `MeasureLine3D` (a top-level helper component) accidentally used `allowOverrangeCameraZoom` in its `useEffect` dependency array. That state only exists inside `BattleArena`, so the browser threw `ReferenceError: allowOverrangeCameraZoom is not defined` at runtime.
- **Fix**: Restore `MeasureLine3D` cleanup effect dependency to `[]`, and bind the wheel-listener effect inside `BattleArena` to `[allowOverrangeCameraZoom]`, which is the correct scope for zoom-cap toggling.
- **Lesson**: When moving hook dependencies, verify lexical scope. A dependency that compiles can still crash in production bundles if it references state from a different component scope.

### `Cannot access 'nx' before initialization` from misplaced hook dependency (2026-04-19)
- **Bug**: During the above dependency move, `[allowOverrangeCameraZoom]` was briefly attached to an earlier body-scroll lock effect that runs before the `useState` declaration of `allowOverrangeCameraZoom` inside `BattleArena`.
- **Symptom**: Production bundle crashed with `ReferenceError: Cannot access 'nx' before initialization` (`nx` was the minified symbol for `allowOverrangeCameraZoom`).
- **Fix**: Put the body-scroll effect back to `[]` and keep `[allowOverrangeCameraZoom]` only on the wheel-listener effect that actually reads it.
- **Lesson**: In React function components, dependency arrays are evaluated immediately in declaration order. Referencing a later `const`/`useState` value in an earlier hook can trigger runtime TDZ even if TypeScript build passes.

### `PCFSoftShadowMap` deprecation warning cleanup (2026-04-19)
- **Symptom**: Browser console showed `THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.` during in-game rendering.
- **Root causes**:
  - Collision-test renderer setup explicitly set `gl.shadowMap.type = THREE.PCFSoftShadowMap`.
  - R3F `Canvas` shadow prop used boolean mode, which mapped to deprecated soft mode in current runtime.
  - Export reader initialization also set `renderer.shadowMap.type = THREE.PCFSoftShadowMap`.
- **Fix**:
  - Switched renderer shadow type to `THREE.PCFShadowMap` in `ArenaScene.tsx` and `public/js/export-reader.js`.
  - Changed `Canvas` shadows config to explicit `'percentage'` mode instead of boolean so it no longer chooses soft by default.
- **Lesson**: When Three.js deprecates a shadow mode, update both explicit renderer constants and any framework-level defaults (`Canvas` shadow props), otherwise warnings can persist from implicit settings.

### Export-reader sunlight is not static (collision-test lighting)
- **Root cause**: The export-reader `DirectionalLight` is not just a fixed light with `intensity=3`, color, and shadow settings. Every frame it re-centers the sun around the camera and moves the light target to the camera position:
  `sun.position = camera.position + dir * 100000`, `sun.target.position = camera.position`.
- **Why this matters**: Copying only the numeric light props into collision-test mode is not enough. A static world-space sun can make the scene look wrong and break shadow coverage, even when the light color/intensity look identical on paper.
- **Lesson**: When matching export-reader visuals, compare the full runtime behavior, not just the constructor arguments. Renderer state, per-frame light updates, and material/shader setup all matter.

### Export-reader fill lights use linear colors, not hex approximations
- **Bug**: Collision-test mode initially recreated export-reader ambient/hemisphere lights with hex strings like `#7f7f7f` and `#667299`. Export-reader does **not** get those colors from sRGB hex — it gets them from linear float arrays in `environment.json` (`ambientColor`, `skyLightColor * skyColorMultiplier`).
- **Symptom**: With only ambient/hemi enabled the scene looked like a dark "6pm" fill, and when the directional sun turned on it overwhelmed the scene like a floodlight because the fill lights were much darker than export-reader.
- **Fix**: Use exact linear `THREE.Color(r, g, b)` values for ambient and hemisphere sky lights in collision-test mode. This keeps the sun/fill balance consistent with export-reader.

### Remaining export-reader parity gaps after sun matching
- **Camera mismatch**: export-reader camera is `PerspectiveCamera(60, aspect, 20, 500000)` with orbit distance `220..1800` and camera height `120`. Collision-test gameplay camera is a different rig entirely (`fov=72`, `near=0.5`, default `far=2000`, third-person follow camera with `CAM_DIST_BACK=20`, `CAM_HEIGHT=10`). The same sunlight will read differently under a very different camera/framing setup.
- **Renderer mismatch**: export-reader creates `WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true })` and caps pixel ratio to `min(devicePixelRatio, 1.5)`. Collision-test currently only sets `antialias: true` on the R3F canvas. This can affect depth precision and overall visual response on large terrain.
- **Takeaway**: If a scene must look exactly like export-reader, matching the light alone is insufficient. Camera model and renderer construction are part of the visual pipeline.

### Centralize test UI behind one hotkey panel
- **Problem**: Floating debug/test widgets piled up on screen and interfered with visual comparison work.
- **Fix**: Moved env toggles + sun controls into a centered testing panel opened by `F8`, with section-level show/hide toggles so future tools can live in one place.
- **Default policy**: Keep the testing UI hidden by default, but preserve useful debug controls behind the hotkey instead of deleting them.

### Use `Esc` as the primary in-game testing/debug panel hotkey
- **Problem**: The testing panel was on `F8` only, while the user expected an `Esc` panel. Existing top-right widgets (`碰撞体`, `Blueprint`, `XY%`, control mode gear) were still scattered outside the panel.
- **Fix**: `Esc` now toggles the centered debug panel. The panel now contains environment toggles, sun config, live XYZ position, movement/combat status, collision/grid toggles, and control mode settings.
- **Current input policy**: Keep `Esc` for the panel, but leave the original camera zoom behavior on the mouse wheel. Avoid piling extra debug bindings onto unrelated gameplay keys unless explicitly requested.

### Height / jump HUD must be floor-relative, not absolute-Z
- **Bug**: The frontend jump HUD tracked takeoff/landing with `Z > 0.01` / `Z <= 0.01`, which only works when the current floor is world Z=0. Rooftop jumps never measured correctly, and peak height was reported in absolute world Z instead of height above the floor the player jumped from.
- **Fix**: Track jump state from `currentZ - groundBelowMe`, store the floor height at takeoff, and report peak jump height as `(peakZ - takeoffFloor) / 2.2` in new units. This also keeps the live `A | B` HUD correct on rooftops.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### Double-jump prediction can feel wrong even when jump constants match
- **Root cause**: The client and backend jump constants already matched. The visible snap came from frontend Z reconciliation being too aggressive immediately after a local jump input, especially on double jump where the server naturally lags the client by about one movement tick.
- **Fix**: Keep the same jump physics, but soften in-air Z reconciliation. Briefly trust local prediction more after a jump press, use larger airborne snap thresholds, and avoid zeroing vertical velocity unless the player is effectively grounded.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### Invalid extra jump input can corrupt local airborne state
- **Symptom**: After a legal double jump, pressing `Space` again while no jumps remained could still latch `jumpLocalRef` on the frontend. That made the client feel like the player instantly dropped or stalled until the backend corrected the state.
- **Root cause**: Keyboard and joystick jump handlers queued local jump input without checking the current local jump budget. Once an impossible jump was latched, some airborne helper branches treated the player as still waiting to jump.
- **Fix**: Add one guarded local jump queue path in `BattleArena.tsx`. It now checks the effective jump cap before latching the press, and the physics tick clears any stale impossible jump request before it can interfere with airborne handling.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### 鸟翔碧空 needs a local jump-cap prediction bridge
- **Symptom**: Right after casting `鸟翔碧空`, the frontend could still think the player only had the normal 2-jump cap until the server buff snapshot arrived. That created a short prediction mismatch window for extra jumps.
- **Fix**: Add a short-lived local `MULTI_JUMP` prediction bridge in `BattleArena.tsx` when `鸟翔碧空` is cast, so local jump gating and post-dash jump allowance stop lagging behind the server buff.
- **Authoritative flat-map measurements**:
  - `鸟翔碧空` first jump: peak `~5.002u`, rise `51` ticks (`~1700ms`), total airtime `88` ticks (`~2933ms`).
  - `扶摇直上 + 鸟翔碧空` first jump: peak `~23.549u`, rise `53` ticks (`~1767ms`), total airtime `110` ticks (`~3667ms`).
  - `扶摇` only: a third `Space` after the double jump is already a backend no-op; `jumpCount` stays at `2` and `vz` continues naturally.
- **Takeaway**: Backend Bird stats were already correct. The main remaining risk was frontend state lag, not authoritative jump math.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `backend/game/abilities/abilities.ts`

### 玉门关 mode should not surface pickups
- **Change**: Collision-test / 玉门关 no longer initializes pickups in battle state, clears legacy pickups from already-started collision-test loops, and filters pickup rendering/interactions out of `BattleArena.tsx`.
- **Takeaway**: If a mode should not use a shared subsystem, disable it at both state initialization and frontend presentation. Hiding the UI alone is not enough when older loop state can still contain data.
- **Files**: `backend/game/services/battle/battleService.ts`, `backend/game/routes/draft.routes.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### Fuyao directional jump has special travel budgets
- **Rule update**: Non-`鸟翔碧空` Fuyao directional jumps do not use the normal `6u` travel budget. The first directional Fuyao jump uses `18u`, and a directional double jump performed during a Fuyao airtime uses `12u`.
- **Important distinction**: This applies to forward, left, and right directional jumps because they all share the same directional jump path. It does **not** apply to the special `扶摇直上 + 鸟翔碧空` combined jump, which keeps its previous movement behavior.
- **Implementation detail**: The first Fuyao directional jump keys off the live `JUMP_BOOST` consumption. The follow-up directional double jump keys off `isPowerJump` from the current airtime, because the Fuyao buff has already been consumed by then.
- **Flat-map backend verification**:
  - Fuyao directional first jump: travel `~17.84u`, peak `~12.56u`, airtime `110` ticks.
  - Fuyao directional double jump: travel `~11.85u`, peak `~13.27u`, airtime `133` ticks from takeoff.
  - Fuyao + Bird directional first jump stayed unchanged at `~5.95u` travel.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### Frontend Fuyao arc smoothing depends on budget order and render follow-through
- **Bug**: The client cleared `hasFuyaoBuffRef` before picking the directional jump budget, so the first directional Fuyao jump still predicted the old `6u` travel budget locally. That caused visible reconciliation and made the Fuyao jump arc feel rough.
- **Fix**: Pick the local directional jump budget before consuming the Fuyao flag, then let the render position follow airborne jump prediction more tightly right after jump input so the curve stays smooth through Fuyao into double jump.
- **UI cleanup shipped with the same pass**: The measurement tool now lives inside the `Esc` panel behind its own toggle, the standalone floating measurement widget is gone, the boss-style self HP bar no longer shows a mana strip, and the center distance HUD keeps only the numeric readout.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.module.css`

### Bird directional jumps can use the same travel budget as Fuyao follow-up jumps
- **Rule update**: `鸟翔碧空` directional jumps felt too short at the default `6u` budget. For Bird-only directional jumps, use the same `12u` travel budget as the Fuyao follow-up jump.
- **Important distinction**: This does not change the special first jump of `扶摇直上 + 鸟翔碧空`. The combined opener keeps its old behavior; only Bird directional jumps without a live Fuyao consumption get the longer travel.
- **Frontend/UI update in the same pass**: `Esc` now prioritizes clearing target/self selection before opening the Esc menu. The Esc menu is now a checkbox-only `控制面板` with a three-column toggle grid and larger checkboxes. It directly toggles on-screen widgets: `灯光控制` at the top-left, `角色状态` around `x=5% / y=50%`, `体积碰撞开关` now rendered as two simple top-right checkbox boxes (`显示碰撞体`, `显示蓝本`) instead of a titled sub-panel, `显示屏幕坐标` as its own top-right checkbox box, and `距离测试` at `x=70% / y=60%`. `跳跃细节` and `显示距离地面的距离` remain independent jump/height HUD toggles. The old blur-backed overlay style is removed, and the obsolete desktop joystick-mode switch UI was removed without changing touch controls.
- **Runtime verification note**: A previous PM2 tail showed stale frontend `EADDRINUSE :3000` lines even though the app later came up cleanly. `pm2 flush && pm2 restart all` is a useful follow-up when validating restart health so the next log read reflects only the latest boot. After a clean restart, frontend logs were clean, while backend still emitted repeated `[MOVEMENT] GameLoop not active ...` warnings that appear unrelated to this UI pass.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.module.css`, `.github/copilot-instructions.md`

### Mid-air facing must stay authoritative, and the combined 扶摇+鸟翔 opener can now use the boosted forward budget
- **Bug**: During jump airtime, the frontend kept rotating the avatar and facing display, but the backend skipped its facing-update branch entirely. That meant mid-air turns looked correct locally while server-facing stayed frozen, so directional dashes and front-facing ability checks could still use the old jump-start direction.
- **Fix**: Apply explicit `input.facing` on the backend even during jump airtime, while still leaving the one intentional RMB-diagonal display mismatch to the client payload rule. This lets players turn mid-jump and have the authoritative facing update for later dashes.
- **Rule update**: The special `扶摇直上 + 鸟翔碧空` directional opener no longer falls back to the old `6u` travel budget. When the combined opener consumes a live Fuyao boost, it now uses the same boosted forward budget as a Fuyao directional jump, and the frontend prediction mirrors that change.
- **Visual update**: The selected facing hemisphere in `scene/Character.tsx` was still positioned for the older larger avatar. Move the arc origin closer to the current body and expand the facing display radius to `7u` so the indicator no longer floats with a visible gap in front of the character.
- **Runtime verification note**: PM2 restart failures on this repo can come from stray manual dev servers, not only stale PM2 children. In this pass, a standalone `ts-node index.ts` backend on `5000` and a standalone `next dev` / `next-server` frontend on `3000` kept causing `EADDRINUSE` during PM2 restarts. When that happens, inspect the live listeners and kill the occupying processes first, then `pm2 flush` and restart again.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/Character.tsx`

### Unit rescale mistake: ability-layer distances were scaled when only locomotion needed scaling
- **Mistake**: Dash distance, cast range, and knockback were multiplied by `2.2` on top of the locomotion rescale. That made abilities travel/check farther than the user intended.
- **Fix**: Keep the `2.2` conversion only in movement/jump physics. Remove it from `DirectionalDash.ts`, `Dash.ts`, `validateAction.ts`, and `GameLoop.ts` knockback so ability numbers remain literal.
- **Files**: `backend/game/engine/effects/definitions/DirectionalDash.ts`, `backend/game/engine/effects/definitions/Dash.ts`, `backend/game/engine/rules/validateAction.ts`, `backend/game/engine/loop/GameLoop.ts`, `backend/game/engine/loop/movement.ts`

### Explicit steer-dash speeds can still be old-scale even after dash-distance rollback
- **Bug**: `踏星行` and `穹隆化生` were still using authored `speedPerTick` values like `0.4166667`, which are old-scale movement units per tick. After removing the broader dash-distance scaling, those two became obviously too slow.
- **Attempted fix (later reverted)**: Scaling authored `speedPerTick` through `UNIT_SCALE` in `movement.ts` made `踏星行` far too fast. The correct resolution is to keep authored `speedPerTick` literal and retune per-ability values where needed.
- **Audit result**: Frontend has no separate active-dash physics for the local player; active dashes are server-authoritative. Jump prediction in `BattleArena.tsx` still mirrors backend jump constants and was not double-scaled the way dash/range had been.
- **Files**: `backend/game/engine/loop/movement.ts`, `backend/game/abilities/abilities.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### Correction: explicit steer-dash `speedPerTick` values are literal authored units
- **Correction**: The runtime `movement.ts` scaling above was wrong for authored `speedPerTick`. `踏星行` should stay at `12.5 u/s` (`0.4166667` per tick) with no extra runtime multiplier, while `穹隆化生` should be authored directly as `33 units / 2 seconds = 0.55` per tick.
- **Requested tuning**: `疾` reverted to a `1s` dash, and `散流霞` now completes its `10-unit` forward dash in `0.5s`.
- **Files**: `backend/game/engine/loop/movement.ts`, `backend/game/abilities/abilities.ts`

### Uneven exported terrain can sink flat ground-effect visuals below the floor
- **Bug**: AOE rings/discs for effects like `穹隆化生`, `风来吴山`, `狂龙乱舞`, and `百足` were rendered at raw `zone.z` / `player.z`, so on non-flat exported terrain parts of the visual could clip underground.
- **Fix**: In `ArenaScene.tsx`, clamp effect visuals to the local support ground under the zone center in `collision-test` mode and add a small vertical lift so the full animation stays above the floor.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### Exported-map ground casts need their own pointer surface
- **Bug**: `百足` ground-cast stopped working after switching to the exported collision-test map because `ArenaScene` only forwarded pointer events through the old flat `Ground` component. The exported-map path rendered no interactive cast surface, so ground preview/click never fired.
- **Fix**: Add pointer props to `ExportedMapScene` and attach them to an invisible-but-raycastable plane sized to the map. This restores ground-target preview and click casting for abilities like `百足` in collision-test mode.
- **Files**: `frontend/app/game/screens/in-game/components/BattleArena/scene/ExportedMapScene.tsx`, `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`

### Base movement must be normalized across all control modes
- **Bug**: Traditional mode already sent normalized `dx/dy`, but the backend boolean-input path summed `up/down/left/right` directly. That made joystick/boolean diagonal movement faster than the intended base speed.
- **Fix**: Normalize boolean movement vectors in `movement.ts` before multiplying by `effectiveMoveSpeed`. The configured base move speed remains `0.3666667` world units per tick, which is exactly `5.0` new units per second after dividing by `2.2` and multiplying by `30Hz`.
- **Testing method**: Add a `Base Move Speed Test` widget in `BattleArena.tsx` that shows configured base speed, live measured speed, and a base-only capture that ignores dash / jump / speed-buff samples.
- **Files**: `backend/game/engine/loop/movement.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

### RMB strafe facing + jump-phase travel budgets (2026-04-14)
- **Bug**: In traditional RMB movement, `A/D` strafe and `W+A/D` diagonal movement moved correctly but the avatar kept facing camera-forward because both the raw mouse-drag path and the movement POST always forced facing from `camYaw` instead of the actual move vector.
- **Definition**: RMB `A/D` strafe and RMB `W+A/D` diagonal facing are frontend-only visuals. The local avatar can render facing sideways/diagonal, but backend-facing stays camera-forward in traditional RMB mode so facing-based abilities still use the forward direction.
- **Jump-system mismatch**: The old jump logic mixed preserved XY momentum with a generic air-steering limiter. That could not match the requested rules: upward jump with one locked 2-unit air shift over 1 second, and directional jump with a fixed 6-unit travel budget scaled from move speed at jump start and spread over that jump phase's airtime.
- **Fix**:
  - Frontend `BattleArena.tsx` now derives one shared traditional-mode movement intent and uses it for both the rendered local-facing and the movement POST, but the POST sends backend-facing separately.
  - RMB `A/D` and RMB `W+A/D` now rotate the rendered facing to the actual movement direction immediately; pure backpedal still keeps facing unchanged.
  - Upward-jump drift is translation-only. Locking the mid-air drift direction must NOT rotate facing on either backend or frontend.
  - Backend `movement.ts` now zeroes horizontal velocity on jump start and treats each jump as its own phase: upward jump arms a 2-unit one-direction air shift that locks on the first airborne input for up to 1 second, while directional jump immediately locks direction and spends a 6-unit budget across the jump's remaining airtime, scaled by the move-speed snapshot taken when the jump starts.
  - The abrupt mid-air "drop straight down" feeling came from directional jumps consuming their horizontal budget over a fixed 1 second while the vertical arc lasted longer. Estimating airtime per jump phase fixes that.
  - Follow-up airborne jumps were under-scaling because jump distance only looked at buffed run speed. The fix is to carry forward the latest special airborne planar speed snapshot (for example, dash speed) and let the next jump phase scale from that when it is higher than base movement speed.
  - Frontend prediction also had a dash-end bug: it reset local jump state to grounded even when the backend kept the player airborne with one remaining jump. Local dash-end state now mirrors backend airborne/grounded handling.
  - Double-jump snapping root cause: jump is a one-shot pulse, but movement input was being overwritten every packet. A later non-jump movement packet could replace the pending jump before the next loop tick consumed it, and frontend movement fetch aborts made that even easier to reproduce. The fix is to latch pending jump input in `GameLoop.setPlayerInput()` until a tick clears it, stop aborting movement POSTs in the frontend, and send monotonic movement sequence numbers so stale packets cannot overwrite newer input.
  - Collision-test jump overshoot + end-snap root cause: the exported-map BVH step-up rule was allowed to fire during jump airtime. On rising terrain this could snap a player to the floor while they were still about 0.5 gameplay units above it, which made the jump visibly drop at the end and resumed normal ground movement early, inflating measured forward distance far beyond the intended 6-unit base jump. Restricting BVH step-up to non-jump states fixes both the snap and the distance inflation. Backend simulation after the fix measured about 5.88u at base speed, 12.00u at +100% move speed, and 2.94u at -50% speed on the collision-test map.
  - Later confirmation: one of the reported "12-unit single jump" readings was not jump travel at all. It was the center HUD value showing player-to-target distance. That display must be labeled explicitly as target distance so it is not confused with jump-range telemetry.
  - Later WASD changes in the same jump phase are ignored until the next jump or landing.
- **Disproved approach**: Only fixing facing was not enough. As long as the old airborne velocity steering stayed in place, jump distance still depended on preserved momentum and mid-air redirection, so it could not hit deterministic 6-unit / 12-unit directional jump ranges.
- **Files**: `backend/game/engine/loop/movement.ts`, `backend/game/engine/loop/GameLoop.ts`, `backend/game/engine/state/types/state.ts`, `backend/game/routes/gameplay.routes.ts`, `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx`

---

## Unit Rescale (2026-04-14)

### Problem
Maps imported from real games have a different scale than our original arena. Measurement confirmed: a specific house is 22 units tall in our world and 10 units in the reference game → ratio = 2.2. Without rescaling, the player moves too slowly across the map and attack/dash ranges feel short.

### Solution — `UNIT_SCALE = 2.2` (1 new unit = 2.2 old world units)
All game-design values (move speed, jump heights, dash distances, ranges, knockback) stay the same **numbers** in abilities.ts and configs. The physics/validation code multiplies by `UNIT_SCALE = 2.2` at every point where a design value is converted to a world-coordinate displacement.

### Collision-test canonical-unit migration (2026-04-14)
- Collision-test runtime now stores canonical gameplay units directly (`state.unitScale = 1`) instead of relying on the legacy `2.2` stored scale.
- Legacy modes keep their previous stored scale (`state.unitScale = 2.2`) so their behavior stays stable.
- Collision-test map boundaries, spawn positions, frontend collision-test AABBs, and exported-map render/BVH bridge constants are now converted once at the asset boundary. Gameplay code no longer needs extra `/ 2.2` or `* 2.2` math in collision-test mode.
- Shared helpers (`calculateDistance`, `gameplayUnitsToWorldUnits`, `worldUnitsToGameplayUnits`) now read the active state's stored-unit scale so range checks, dash travel, ground zones, and pickup ranges stay consistent across modes.
- Frontend collision-test prediction, jump telemetry, movement-speed HUD, range checks, pickup distance labels, and measurement tools now display and simulate the same canonical units the backend stores.
- Remaining legacy-scale references are now intentionally isolated to compatibility paths for non-collision-test modes or to the one-time import bridge from raw exported assets.

### Files changed
| File | What changed |
|---|---|
| `backend/game/engine/loop/movement.ts` | Added `UNIT_SCALE=2.2`; all GRAVITY/VZ jump constants now include `×2.2`; `AIR_NUDGE_TOTAL_DISTANCE = 1 × 2.2`; dead zones for dash angle capture scaled ×2.2; `snapUpUnits` and `diveVzPerTick` multiplied by `UNIT_SCALE` at apply-time |
| `backend/game/services/battle/battleService.ts` | `moveSpeed: 0.1666667 → 0.3666667` |
| `backend/game/routes/draft.routes.ts` | Same moveSpeed update |
| `backend/game/engine/effects/definitions/DirectionalDash.ts` | Added `UNIT_SCALE`; `worldDistance = distance × 2.2` used for `vxPerTick`, `vyPerTick`, angle caps, arc peak height, route-damage endpoint, and route radius |
| `backend/game/engine/effects/definitions/Dash.ts` | Added `UNIT_SCALE`; stop distance 1→2.2 world units; dash speed ×2.2 |
| `backend/game/engine/rules/validateAction.ts` | Added `UNIT_SCALE`; range check: `distance > ability.range × 2.2`; minRange check: `distance < ability.minRange × 2.2` |
| `backend/game/engine/loop/GameLoop.ts` | `knockbackUnits` multiplied by `UNIT_SCALE` (inline constant) before applying to position |
| `frontend/app/game/screens/in-game/components/BattleArena/BattleArena.tsx` | `MAX_SPEED` and all GRAVITY/VZ prediction constants scaled ×2.2; `AIR_NUDGE_TOTAL_DISTANCE = 2.2`; fallback `baseMoveSpeed` updated |

### Key principle
**Never change the numbers in abilities.ts** (range: 20, value: 1.7, etc.). Only scale at the physics/validation boundary. This way the design intent is readable in one place and the scale factor is in one constant (`UNIT_SCALE = 2.2`).

### Follow-up clarification — gameplay range must use new units end-to-end (2026-04-14)
- **Problem**: After jump rescaling was fixed, several other systems still mixed raw map distance with authored gameplay distance. Result: jump telemetry could say `6u`, but cast range, dash travel, target distance HUD, and some zone radii still behaved like the old raw coordinate system.
- **Definition**:
  - Raw player/map positions remain in legacy world coordinates.
  - Authored gameplay numbers in abilities and configs are in new world units.
  - Conversion rule: `1 new unit = 2.2 old/raw units`, so `raw = new × 2.2` and `new = raw / 2.2`.
- **Fix**:
  - Added shared conversion helpers in `backend/game/engine/state/types/position.ts`.
  - Backend `calculateDistance()` now returns new-unit distance so cast validation, channel break range, timed AOE range, and buff cancel-on-range all compare in the same unit system as ability definitions.
  - Any backend geometry that must stay in raw coordinate space now converts authored new units explicitly before writing world-space values: directional dash travel, dash stop distance/speed, route radius, arc height, ground-zone radii, and forward zone offsets.
  - Frontend target distance display, selected-opponent nameplate distance, local range gating, pickup distance readouts, and ground-cast preview radius now convert raw coordinates back into new units for display/comparison.
- **Practical result**:
  - `蹑云逐月` authored as `value: 20` should travel `20` new units, which is `44` raw map units.
  - A measured raw separation of `13.2` means `6` new units.

### Remaining blocker — canonical runtime state is still raw coordinates (2026-04-14)
- **Unresolved issue**: The project still has two unit systems in runtime architecture. New units are the gameplay/design language, but core stored coordinates and imported collision/map assets are still raw/legacy units.
- **Where raw units still fundamentally own the data**:
  - `backend/game/engine/state/types/position.ts`: `Position.x/y/z` are still stored as raw coordinates; conversion helpers wrap around them.
  - `backend/game/engine/state/types/map.ts`: `MapObject` is still documented in generic "world units" rather than explicitly new units, and current map objects use raw values.
  - `backend/game/map/exportedMap.ts` and `frontend/.../collisionTestMap.ts`: exported entity AABBs are stored in raw coordinates.
  - `backend/game/map/exportedMapCollision.ts` and `frontend/.../scene/ExportedMapScene.tsx`: collision/render transforms still depend on raw export-space constants (`BASE_RENDER_SF`, `MAP_SCALE`, `GROUP_POS_*`).
  - `backend/game/engine/loop/movement.ts` and `frontend/.../BattleArena.tsx`: jump/movement physics still multiply by `2.2` because movement state is raw.
  - `backend/game/routes/gameplay.routes.ts`: pickup inspect/claim ranges are still compared directly against raw XYZ deltas.
- **Migration direction**:
  - Make new units the only canonical runtime unit for `Position`, `Velocity`, `moveSpeed`, `MapObject`, ground-zone radius/height, and all gameplay interactions.
  - Convert imported/exported map assets from raw to new units once at load/build time instead of converting distances repeatedly during gameplay.
  - Keep only render/BVH-space transforms that are unrelated to the old-vs-new gameplay unit distinction.

### 新增锁足技能与锁足施法限制联动 (2026-04-19)
- **需求实现**: 新增 `五方行尽`（`wufang_xingjin`）为类百足的对地/对目标范围技能，半径 `6`，命中立即造成 `1` 点伤害并附加 `10s ROOT`。
- **实现要点**: 不复用 `BAIZU_AOE` 的硬编码分支，而是新增独立效果 `WUFANG_XINGJIN_AOE`，避免错误复用百足专属标记与 buff 名称匹配逻辑。
- **施法限制经验**: ROOT 默认只限制移动与转向，不限制施法。若要实现“部分技能被锁足时不可放”，应新增能力级布尔属性（`cannotCastWhileRooted`）并在 `validateCastAbility` 与 `validatePlayAbility` 同步校验。
- **默认赋值范围**: 该属性默认开启于四个通用位移轻功（`蹑云逐月/迎风回浪/凌霄揽胜/瑶台枕鹤`）以及 `后撤`、`疾`、`鸟翔碧空`，并同步下发到 preload 与前端就绪判断，避免前后端判定漂移。
- **免疫联动确认**: `女娲补天` 通过 `ROOT_SLOW_IMMUNE` 生效；`addBuff()` 会在敌方施加前先过滤 `ROOT/SLOW`，过滤后若无剩余效果直接返回，因此 `五方行尽` 在女娲状态下仍可吃到伤害但不会被锁足。

### 五方行尽地面施法、递减层数与后半段受击解除修正 (2026-04-19)
- **灰置根因**: 前端 readiness 在无选中目标时仍会回退检查首个敌人距离，导致可对地施法技能在敌人超距时被错误置灰。
- **修正**: 对 `allowGroundCastWithoutTarget` 技能，在“未选中目标”分支直接判定可施放（仍保留自身控制/冷却/姿态限制），不再被回退目标距离和朝向条件误伤。
- **双层递减根因**: `五方行尽` 的 ROOT 既在自定义 `WUFANG_XINGJIN_AOE` 分支施加，又被通用 `applyAbilityBuffs()` 额外施加一次，导致同次命中触发两次 ROOT 递减。
- **修正**: 将 `wufang_xingjin` 标记为自定义施加路径，跳过通用 buff 自动附加，确保每次命中只结算一次 ROOT。
- **后半段受击解除实现**: 新增 `buffId=1331` 保护 buff（“被击不会解除五方锁足”）。每次成功施加 ROOT 后，按实际 ROOT 持续时间的 `50%` 动态生成保护时长；ROOT 进入后半段后，目标每次受伤按 `100%` 概率移除 `buffId=1330`。
- **时长缩放要点**: 保护 buff 时长不写死 5 秒，而是读取本次实际落地 ROOT 的 runtime 持续时间（已包含递减），再按一半计算，确保 `10s -> 5s`、`5s -> 2.5s` 等比例保持正确。

### 条件强化技能“棒打狗头”实现经验 (2026-04-19)
- **核心机制**: 技能基础为 `0` 基础冷却且吃 GCD；命中无 `心怵·一` 目标时施加 `2s ROOT + 心怵·一(6s, 易伤6%)`。
- **升级分支**: 若目标已有 `心怵·一`，则移除 `心怵·一`，改为施加 `棒打狗头·定身(2s CONTROL)` 和 `心怵·二(6s, 易伤6%)`，并将本次技能实例冷却提升为 `16s`。
- **冷却判定实现**: 通过施放后检查目标是否在本次施放窗口内获得 `心怵·二`（`appliedAt` 时间窗）来触发 16 秒冷却覆盖，避免在未触发升级分支时误加长冷却。

### 读条同步与充能并行恢复修正 (2026-04-19)
- **读条问题根因**: 后端在每个广播 tick 都重复下发 `activeChannel`，前端读条又使用 `animationDelay` 反复重算 CSS 动画，叠加后会出现进度条观感“忽快忽慢/重置感”。
- **修正**: `GameLoop` 仅在 `activeChannel` 内容变化时下发 diff（开始/变化/结束），前端 `ChannelBar` 改为按当前时间直接计算宽度（forward/reverse 都用显式 width），不再依赖重复重启动画。
- **截阳充能根因**: 原实现是单一 `chargeRegenTicksRemaining` 串行恢复，连续消耗多层后会出现“回到 2 层后还要等一整段才回 3 层”的体感停顿。
- **修正**: 改为缺失层独立并行恢复队列 `_chargeRegenQueueTicks`，每次消耗新增一个恢复计时；循环内统一推进并在完成时批量返还层数，同时继续对前端暴露最近一层的 `chargeRegenTicksRemaining` 供 UI 进度显示。

### 新技能实现与位移预测核对 (2026-04-19)
- **新增技能**: `云栖松`（12s 60% 闪避 + 5s 每秒回 1，吃 GCD）、`捉影式`（0.5s 无 GCD 读条，结束拉到施法者前方 1 尺并附加 `滞影` 封轻功 5s）、`守如山`（8s 80% 减伤）。
- **新效果类型**: 新增 `TIMED_PULL_TARGET_TO_FRONT` 并在 `GameLoop` 读条完成分支处理，落点后执行碰撞解算与地面高度修正，再附加 `滞影` debuff。
- **前端预测核对**: 本次位移属于“目标被敌方技能拉拽”的后端权威位置更改，`BattleArena.tsx` 当前没有对敌方受控位移做本地预测分支，表现以服务端位置同步为准；本次无需额外前端预测公式改动。

### 捉影式时序与空中拉拽修正 (2026-04-19)
- **绝脉时长修正**: `截阳` 的 `绝脉` 若需作为持续压制 debuff，6 秒会过短。将 buff 时长从 `6_000ms` 调整为 `30_000ms`。
- **读条顺滑度经验**: 读条条本地进度若按 `setInterval(50ms)` 驱动，会有明显“台阶感”。改为 `requestAnimationFrame` 后，进度更新与浏览器渲染节奏一致，观感更连贯。
- **空中拉拽经验**: 拉拽逻辑若只取地面高度会把目标强制贴地，破坏空战手感。应以施法者当前 Z 为目标高度上限（且不低于地面），实现“施法者在空中时目标也被拉到空中”。
- **拉拽同步经验**: 即时改坐标会造成“看起来没拉拽过程”的不同步体感。把捉影改为目标 `activeDash` 位移（30 tick 基准）后，后端逐 tick 推进、前端按同一 runtime 状态渲染，1 秒 20 单位拉拽的时间感更稳定。
- **技能体验修正**: `捉影式` 射程提升到 `35`，并设置读条不因移动/跳跃中断；命中后仍附加 `滞影（封轻功）5秒`。

### Bug fixes and new abilities (2026-04-21)

#### Bug fix: buffRuntime.ts stacking increment
- **Root cause**: Stack increment was hardcoded `+ 1` regardless of `initialStacks`.
- **Fix**: Changed to `+ (runtimeBuff.initialStacks ?? 1)` — re-applying 截阳 now correctly adds 3 stacks of 绝脉 per cast.

#### Bug fix: GameLoop.ts TIMED_AOE_DAMAGE range check (world units vs gameplay units)
- **Root cause**: Range check used raw `Math.sqrt(dx*dx+dy*dy+dz*dz)` in world units, but `e.range` is in gameplay units. This caused 心诤 final AOE to never fire because the world-unit distances were much larger than the 10-unit gameplay range.
- **Fix**: Replaced raw distance with `calculateDistance(player.position, opp.position, storedUnitScale)` which returns gameplay units. Also fixed the cone angle check to use its own local dx/dy vars.

#### Item 3: 烟雨行 jump consumption
- Added check `dash.abilityId === "yan_yu_xing"` at both dash-start and dash-end-airborne points in movement.ts, setting `player.jumpCount = MAX_JUMPS` (consumes all air jumps, prevents mid-dash or post-dash air jumping).

#### Item 4: 春泥护花 duration/stacks update
- Changed: `durationMs: 60_000 → 15_000`, `initialStacks: 8 → 5`, `maxStacks: 8 → 5`.

#### Item 5: combatMath.ts stack-scaled HEAL_REDUCTION
- `resolveHealAmount` now sums HEAL_REDUCTION × (buff.stacks ?? 1) across all debuffs instead of using `.find()`. Existing single-stack heal reduction buffs unaffected.

#### New effect type: GROUND_TARGET_DASH
- Added to `effects.ts` EffectType union and `categories.ts` map.
- Handler in `immediateEffects.ts`: computes direction from source to `castContext.groundTarget` (or opponent position), sets `source.facing`, then delegates to `handleDirectionalDash` with `dirMode: "TOWARD"`.

#### New abilities (2026-04-21)
- **万剑归宗** (wan_jian_gui_zong): SELF-target, no GCD, `AOE_APPLY_BUFFS` range 6 → ROOT 3s (buffId 2319) + 玄一 5 stacks HEAL_REDUCTION 10%/stack (buffId 2320, 30s).
- **孤风飒踏** (gu_feng_sa_ta): OPPONENT+allowGroundCastWithoutTarget, `GROUND_TARGET_DASH` 20u/0.5s (15 ticks), CLEANSE, no GCD. Uses 百足-style pending ground-cast mode: key press → setPendingGroundCastAbilityId, hover circle shown, left-click confirms, right-click cancels.
- **撼地** (han_di): OPPONENT+allowGroundCastWithoutTarget+qinggong, `GROUND_TARGET_DASH` 20u/0.5s (15 ticks), GCD, range 20. On land: AOE stun (5u/3s, buffId 2321). Handled in GameLoop.ts post-dash check. Uses 百足-style pending ground-cast mode.
- **跃潮斩波** (yue_chao_zhan_bo): OPPONENT, DIRECTIONAL_DASH TOWARD 20u/30 ticks, qinggong, GCD, range 25. On land: 15 damage to enemies within 8u world units. Handled in GameLoop.ts post-dash check.
- **无我无剑** (wu_wo_wu_jian): OPPONENT, DAMAGE 7, range 4, GCD.
- **听雷** (ting_lei): OPPONENT, range 4, no GCD, DAMAGE 3, mobile/airborne. Buff 听雷·伤 (buffId 2322, applyTo: "SELF", DAMAGE_MULTIPLIER 1.1 with restrictToAbilityId: 'ting_lei', 12s, maxStacks 3). DAMAGE_MULTIPLIER.restrictToAbilityId added to BuffEffect type; combatMath.ts skips restricted buffs unless abilityId matches; Damage.ts passes ability.id to resolveScheduledDamage.
- **绛唇珠袖** (jiang_chun_zhu_xiu): excluded from applyAbilityBuffs; cast-time applies only buff 2323 (debuff) via addBuff in PlayAbility.ts. Buff 2324 (silence) only fires via qinggong trigger in playService.ts.
- **鹤归孤山** (he_gui_gu_shan): GameLoop post-dash handler now pushes DAMAGE events for both base (10u AOE) and inner (4u) hits. After all opponent processing, applies 0.5s dash runtime buff (CONTROL_IMMUNE + KNOCKBACK_IMMUNE) to caster via applyDashRuntimeBuff.
- **Hover circle on walls**: ExportedMapScene.tsx getHitPoint now returns {point, isHorizontal} using face.normal.transformDirection(matrixWorld).y > 0.5. ArenaScene passes isHorizontal as 4th arg to onGroundPointerMove. groundCastPreview state tracks isValid; circle shows red (#ff3333) and uses raw hit Z (no getZoneVisualZ snap) when isValid === false.
- **绛唇珠袖** (jiang_chun_zhu_xiu): OPPONENT, range 22, GCD. Debuff 绛唇珠袖 (buffId 2323, 9s) on target. Trigger hook in playService.ts: after any qinggong ability is cast, if caster has buffId 2323, apply 绛唇珠袖·沉默 (buffId 2324, SILENCE 2s) via addBuff + 1 damage. Child buff 2324 declared in ability.buffs for preload visibility.
- **鹤归孤山** (he_gui_gu_shan): OPPONENT, DIRECTIONAL_DASH TOWARD 15u/30ticks, qinggong, GCD, range 25. Post-dash GameLoop handler: 2 damage + stun 3s (buffId 2325, via addBuff, triggers 眩晕递减) to enemies within 10u; extra 2 damage to enemies within 4u.
- **天地低昂** (tian_di_di_ang): SELF, instant, DAMAGE_REDUCTION 40% 10s (buffId 2326), allowWhileControlled: true. Normal buff via applyAbilityBuffs.
- **九转归一** (jiu_zhuan_gui_yi): OPPONENT, range 8, GCD. New effect type `KNOCKBACK_DASH` (value 12, durationTicks 18 = 12u ÷ 20u/sec × 30tick/sec, wallStunMs 4000). In immediateEffects.ts: checks `hasKnockbackImmune` first; sets `activeDash` on target with 18 ticks at 20u/sec; stores `_wallKnockSourceUserId` on target; applies KNOCKED_BACK buff (buffId 9201 "九转击退", 1000ms) via `addBuff`. After 18 ticks of movement, KNOCKED_BACK buff holds target locked for the remaining ~12 ticks = 1 second total CC. Wall hit: movement.ts sets `_wallKnockStunMs` + `_wallKnockAbilityId` on player; GameLoop removes buffId 9201 then calls `addBuff` for buffId 9202 "羽化" (CONTROL 4000ms) — triggers 眩晕递减 automatically.
- **Buff direct-push anti-pattern** (2026-04-22): Never use `buffs.push({...})` directly — bypasses status bar, immunity checks, 递减 system, and BUFF_APPLIED events. Always use `addBuff()`. For forced dashes on opponents, store caster's userId as `(target as any)._wallKnockSourceUserId` so GameLoop can use it as `sourceUserId` in the addBuff call.

---

## Buff Attribute Tag System (2025)

### Feature: Buff editor tab in ability editor

- Added `buffTagSystem.ts` (backend) for loading/saving buff attribute overrides to `buff-attribute-overrides.json`.
- Added two new API routes: `GET /ability-editor/buffs` and `PUT /ability-editor/buffs/:buffId/attribute`.
- Added buff types (`BuffAttribute`, `BuffEditorEntry`, `BuffEditorSnapshot`, `getBuffSubtitle`, `getBuffIconPath`) to `editorShared.ts`.
- Created `BuffEditorTab.tsx` component with 有利/不利 sub-tabs, search, and attribute chip selector.
- Added `mainTabBar` / `mainTab` CSS and all buff-related CSS classes to `page.module.css`.
- Added `mainTab` tab bar to `page.tsx` (技能列表 | BUFF编辑), with lazy-loading buff snapshot on first tab open.

### Pitfall: replace_string_in_file only replaces the matched segment

When the old imports block was replaced (only the top few lines), the rest of the old file content was NOT removed. This caused duplicate function/export declarations (`buildOverviewTags`, `export default AbilityEditorPage`, `abilityTypeLabel`).  
**Fix:** Use `head -N` to truncate the file at the correct line after identifying the start of the duplicate section with `grep -n`.


### Buff property editor architecture — engine override path

- The buff editor UI saves overrides to `buff-attribute-overrides.json` via `saveBuffEditorOverrides`.
- **abilityPreload.ts** builds the frontend-facing snapshot (UI display only) — modifying effects here changes what the editor shows.
- **Engine path**: `addBuff()` in `buffRuntime.ts` receives the buff definition directly from `ABILITIES`. It does NOT go through `buildAbilityPreload`. To make the editor values actually affect gameplay, property overrides must also be applied inside `addBuff()`.
- Fix: Added `applyPropertyOverridesToEffects()` in `buffEditorOverrides.ts` called from both `abilityPreload.ts` (UI) and `addBuff()` (engine). Now changes to 减伤/无敌/闪避 values in the editor actually affect combat calculations.
- Property mapping: 减伤 → DAMAGE_REDUCTION (value 0–100 → 0–1.0), 无敌 → INVULNERABLE, 闪避 → DODGE (count).
- `properties: []` is now a valid override sentinel meaning "user explicitly cleared all code-defined properties". This required changing `normalizeProperties` to return `[]` instead of `undefined` for empty arrays.

### Buff detail page pattern

- Buff list tab (`BuffEditorTab.tsx`) is now read-only — shows name, desc, attribute, property tags, and an "编辑 →" link.
- Edit page lives at `/ability-editor/buff/[buffId]` — fetches the full buff snapshot, finds buff by ID, renders the full edit form.
- Initialize local properties from `entry.properties` if non-empty (user has already set overrides), else copy from `entry.baseProperties` (first-time edit). This lets 守如山's 80% DR show up for editing without requiring prior manual input.
- The `prevEntryBuffId` pattern prevents re-initialization when the snapshot refreshes after a save.


### Dispel system (DISPEL_BUFF_ATTRIBUTE effect type)

- New effect type `DISPEL_BUFF_ATTRIBUTE` added to remove BUFF-category buffs from a target by attribute.
- Attribute data lives in `buff-attribute-overrides.json`; must call `loadBuffEditorOverrides()` at runtime to look up each buff's attribute.
- Effect format: `{ type: "DISPEL_BUFF_ATTRIBUTE", attributes: ["阴性", "混元", "阳性", "毒性"] }` — one buff per attribute is removed per effect execution.
- The `attributes` field was added to `AbilityEffect` interface; since the ability file uses `as any`, TS casts are needed only in ability definitions.
- After adding a new `EffectType` member, must also add it to `EFFECT_CATEGORY_MAP` in `categories.ts` (Record<EffectType, string>) — otherwise tsc fails.
- The dispel handler calls `effTarget.buffs.splice(idx, 1)` + `pushBuffExpired(...)` to properly remove and emit events; do NOT use `victim.buffs = victim.buffs.filter(...)` as that replaces the array reference.
- Dodge interaction for dispel abilities is automatic: the `shouldSkipDueToDodge` check before the switch already skips enemy-targeted effects when `abilityDodged=true`.

### ignoreDodge ability property

- Added `ignoreDodge?: boolean` to the `Ability` interface in `types/abilities.ts`.
- `computeAbilityDodge` in `dodge.ts` now checks `if (ability.ignoreDodge) return false;` before calling `shouldDodge`.
- This is the cleanest approach — no change needed in PlayAbility.ts, the dodge result flows through automatically.

### Canonical Class (School) Ordering

Always use this order for any list, filter, or display of schools:
少林 万花 天策 纯阳 七秀 藏剑 唐门 明教 丐帮 苍云 长歌 霸刀 蓬莱 凌雪 衍天 药宗 刀宗 万灵 段氏 五毒 通用

Code arrays (20 schools + 通用):
["少林","万花","天策","纯阳","七秀","藏剑","唐门","明教","丐帮","苍云","长歌","霸刀","蓬莱","凌雪","衍天","药宗","刀宗","万灵","段氏","五毒","通用"]

Locations to update when adding new schools: editorShared.ts SCHOOL_TAGS, BattleArena.tsx SCHOOL_TAGS_BA.

### New Effect Types (April 2026 batch)

- `MIN_HP_1`: prevents HP going below 1 (cannot-die). Implemented in `applyDamageToTarget` in health.ts.
- `NIEYUN_DASH_REDUCTION`: reduces 蹑云逐月 dash distance and duration by 70%. Implemented in DirectionalDash.ts.
- `DAMAGE_REDIRECT_55`: semantic marker on 毒手 debuff. Actual redirect logic lives in Damage.ts handleDamage.

### 玄水蛊 Damage Redirect Design

- Buff 2607 (玄水蛊) on CASTER = redirect is active
- Buff 2606 (毒手) on TARGET = they absorb the redirect
- When caster takes enemy HP damage, 55% is restored to them and dealt directly (bypassing DR) to the target with 毒手
- Logic in Damage.ts handleDamage, after applyDamageToTarget, checks isEnemyEffect + actualHpDamage > 0

### 七星拱瑞 On-Damage Break Design

- Buff 2600 (七星拱瑞): CONTROL + ROOT + PERIODIC_GUAN_TI_HEAL 5/s, 15s. Applied via applyBuffsOnComplete.
- On any enemy damage to the holder, buff is removed (via splice + BUFF_EXPIRED event) and buff 2601 (七星拱瑞·眩晕) is applied via addBuff for 4s.
- Logic in Damage.ts handleDamage, triggered when isEnemyEffect and target has buffId 2600.

### On-Damage Hooks Refactor (七星拱瑞 break + 玄水蛊 redirect)

Created `backend/game/engine/effects/onDamageHooks.ts` — a shared utility that
must be called after any `applyDamageToTarget` call that could affect a player
who has buff 2600 (七星拱瑞 freeze) or buff 2607 (玄水蛊 redirect).

`processOnDamageTaken(state, damagedPlayer, hpDamage, attackerUserId?)`:
- 七星拱瑞 break: removes buff 2600, calls pushBuffExpired, then addBuff(2601 北斗, 4s CONTROL)
- 玄水蛊 redirect: if damagedPlayer has buff 2607 and opponent has buff 2606,
  heals 55% back to damagedPlayer and deals it to opponent
- NO isEnemyEffect restriction — fires for any damage source (enemy, self, env)
- Checks `b.expiresAt > now` to skip already-expired buffs not yet cleaned up

Damage.ts now calls processOnDamageTaken instead of inline logic.
GameLoop.ts added calls at: PERIODIC_DAMAGE buff ticks, TIMED_AOE_DAMAGE,
CHANNEL_AOE_TICK, ground zone damage, reach/dash damage-on-complete.

Buff 2601 renamed from "七星拱瑞·眩晕" → "北斗".
Buff 2601 added to qixing_gongrui.buffs[] in abilities.ts (for editor visibility).
啸如虎 buff 2602: added { type: "CONTROL_IMMUNE" } effect.

Note: DAMAGE_REDIRECT_55 effect type comment in EXPERIENCES.md was outdated —
the actual redirect logic now lives in onDamageHooks.ts, not Damage.ts.

## Pre-Damage Redirect Pattern (玄水蛊 Fix)
- **Problem**: Post-damage HP-restore redirect was correct for HP bar but the DAMAGE event still emitted the full `final` value, so A's damage float showed `-10` while HP only dropped 4.
- **Solution**: Changed to pre-damage split via `preCheckRedirect()` in `onDamageHooks.ts`. Export `preCheckRedirect` + `applyRedirectToOpponent`; call before `applyDamageToTarget` in all 6 damage paths (Damage.ts + 5 GameLoop paths). The DAMAGE event naturally carries the reduced value.

## Post-Pull Stun Pattern (极乐引)
- CONTROL buffs are blocked by CONTROL_IMMUNE which is applied at pull start alongside `activeDash`.
- Solution: `PULL_CHANNEL_POST_STUN_CONFIG` constant + `pendingPostPullStuns Map<targetUserId, ...>` class field in GameLoop. When pull activeDash clears (`dashStateBefore && !player.activeDash`), apply the stun via `addBuff` (which now passes since CONTROL_IMMUNE expired with the dash buff).

## On-Play Trigger Hook (傍花随柳)
- Implemented directly in `PlayAbility.ts` at the end of `applyAbility()`. Check by `buffId === 2611`; decrement stacks; last stack → `ATTACK_LOCK` silence via `addBuff`; earlier stacks → direct `applyDamageToTarget` + DAMAGE event.
- `applyDamageToTarget` called directly (not via handleDamage) to bypass redirect/shields for this trigger damage, as intended.

## Round 3: Ability Fixes + New Abilities (Session 3 Cont.)

### Fixes Applied
- **极乐引 (ji_le_yin)**: Converted from CHANNEL targeted to instant SELF-cast AOE pull. Custom effect `JILE_YIN_AOE_PULL` in immediateEffects.ts teleports all enemies within 10u to 1u in front of caster, then applies buff 2608 stun 4s. Removed from `PULL_CHANNEL_POST_STUN_CONFIG` in GameLoop.ts.
- **傍花随柳 (bang_hua_sui_liu)**: Changed `channelCancelOnMove: true` → `false`. Removed silence logic from PlayAbility.ts trigger; ALL 3 stacks now deal 1 damage only. Removed buff 2612 (束发) from abilityPreload.ts.
- **化蝶 (hua_die)**: Replaced simple DIRECTIONAL_DASH with 2-phase system. Phase 1: custom `HUA_DIE_PHASE1` effect (diagonal: 2u forward + 4u up over 30 ticks, CC immune). Phase 2: triggered in GameLoop when Phase 1 ends (forward 27u, stealth+damage_immune buff 2613). `_huaDieP2Done` flag prevents double-trigger.

### New Abilities
- **少明指 (shao_ming_zhi)**: CHANNEL 1s, can move, cannot jump. DAMAGE:1 + `DISPEL_BUFF_ATTRIBUTE` with `count: 2` per attribute. Required adding `count` loop to DISPEL_BUFF_ATTRIBUTE handler (previously removed 1 per attribute, now loops `count` times).
- **临时飞爪 (lin_shi_fei_zhua)**: Ground-target dash 40u. Custom `LIN_SHI_FEI_ZHUA_DASH` effect — sets `activeDash.ccStopsMe = true` and does NOT call applyDashRuntimeBuff. movement.ts checks `ccStopsMe` and cancels dash if CONTROL/ROOT/ATTACK_LOCK active.
- **剑主天地 (jian_zhu_tian_di)**: Custom `JIAN_ZHU_TIAN_DI_STRIKE`. At 3 stacks → detonate (settle remaining ticks + this hit damage). Otherwise: 1 damage + addBuff 2614 (stacks up to 3). Similar to 三环套月 in buffRuntime.ts but done in immediateEffects.ts.
- **破风 (po_feng)**: Custom `PO_FENG_STRIKE`. 1 damage + buff 2615 (DAMAGE_TAKEN_FLAT +5) + buff 2616 流血 (bleed stack). Extra stack of 流血 if target has CONTROL_IMMUNE (check via `blocksControlByImmunity("CONTROL", target)`).

### New Effect Types Added
- `JILE_YIN_AOE_PULL`, `LIN_SHI_FEI_ZHUA_DASH`, `HUA_DIE_PHASE1`, `DAMAGE_TAKEN_FLAT`, `JIAN_ZHU_TIAN_DI_STRIKE`, `PO_FENG_STRIKE` — added to `effects.ts` EffectType union and `categories.ts` EFFECT_CATEGORY_MAP.
- `DAMAGE_TAKEN_FLAT`: Added to `combatMath.ts` — applied after multiplicative modifiers as a flat addition.

### Lessons Learned
- `pushEvent` is NOT available in immediateEffects.ts — use `state.events.push({ id: randomUUID(), timestamp: Date.now(), ... })` directly.
- `blocksControlByImmunity(effectType, target)` takes 2 arguments.
- New EffectTypes must be added to BOTH `effects.ts` (union) AND `categories.ts` (Record<EffectType, string>) or tsc fails with a missing key error.
- 化蝶 Phase 2 uses `_huaDieP2Done` flag on the player object to prevent retriggering every tick.

## Typed Damage Reduction + Zone Channel Abilities (2026-04-25)

### Architecture: damageType propagation gap

**Problem**: `resolveScheduledDamage` accepts `damageType?: string`, and DAMAGE_REDUCTION buff effects can have a `damageType` field to make them type-specific. However, ALL 13 call sites in `GameLoop.ts` (periodic damage, channel AOE ticks, TIMED_AOE_DAMAGE, dash-on-hit, zone damage, etc.) did NOT pass `damageType`. This meant typed reductions (e.g., 30% 内功减伤 from 冲阴阳) never activated — only damage from `immediateEffects.ts` (instant-cast effects) was type-filtered correctly.

**Fix**: For each `resolveScheduledDamage` call in GameLoop.ts, pass the source ability's damageType:
- Buff-sourced damage: `damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType`
- Channel-completion damage: `damageType: (ABILITIES[ch.abilityId] as any)?.damageType`
- Specific ability landing damage: `damageType: (ABILITIES["ability_id"] as any)?.damageType`
- Zone damage: `damageType: (ABILITIES[zone.abilityId ?? ""] as any)?.damageType`
- Dash-on-reach damage: `damageType: (reachAbility as any)?.damageType`

**Same root cause existed before**: 外功闪避 (PHYSICAL_DODGE) had the same gap and was fixed in a prior session for GameLoop damage paths.

### Architecture: DAMAGE_REDUCTION stacking

**Problem**: `combatMath.ts` used `.find()` to get ONE DAMAGE_REDUCTION effect, then `dmg *= 1 - value`. This means only the FIRST matching reduction applied; stacked reductions were silently ignored.

**Fix**: Changed to `.filter()` + loop — all matching reductions apply multiplicatively:
```typescript
const matchingReductions = allEffects(params.target).filter(...);
for (const dr of matchingReductions) { dmg *= 1 - (dr.value ?? 0); }
```
A typed reduction (`e.damageType === "内功"`) only applies when `params.damageType` matches exactly. An untyped reduction applies to all damage.

### Zone channel buffs: use addBuff()

**Problem**: 冲阴阳/凌太虚/吞日月 zone pulse handlers pushed buffs directly to `player.buffs` (bypassing `addBuff()`), so BUFF_APPLIED events weren't emitted and status bar didn't show them.

**Fix**: Replaced `owner.buffs.push({...})` with `addBuff({state, sourceUserId, targetUserId, ability: ABILITIES["chong_yin_yang"], buffTarget: owner, buff: { buffId, name, category, durationMs: 2000, effects }})`. The `addBuff` function handles refresh (same buffId → old removed, new added), immunity checks, and BUFF_APPLIED event emission. Zone pulsed every 1s with `durationMs: 2000` keeps the buff active as long as owner stays in zone.

### PM2 restart loop deadlock

**Problem**: After many rapid restarts (>15 in a short window), PM2 enters "errored" state and stops retrying. Even after killing port-occupying processes, PM2 won't restart. `lsof -ti:PORT` may miss processes that only show in `ss -tlnp`.

**Fix**: 
1. Use `ss -tlnp | grep PORT` to find hidden listening processes (lsof missed a `next-server` process).
2. `kill -9 <pid>` to kill it.
3. `pm2 reset <name>` to reset restart counter.
4. `pm2 start <name>` to start fresh.

### Zone buff enter/exit architecture (2026-04-25)

**Problem**: Pulsing a short-duration buff every tick (e.g., `durationMs: 2000` refreshed each 1s) is fragile — there is always a 1s window where the buff appears live but the zone has expired, or the buff stacks unexpectedly with the addBuff refresh path. It also fires addBuff every second for every player in every zone.

**Solution**: Move the 4 new zone ability handlers (生太极, 冲阴阳, 凌太虚, 吞日月) BEFORE the `intervalMs` gate so they run every game loop frame (~33ms). Use pure enter/exit logic:
- **Enter** (`inZone && !hasBuff`): call `addBuff()` with `durationMs: zone.expiresAt - now` — buff naturally expires when zone does.
- **Exit** (`!inZone && hasBuff`): filter buff from array + call `pushBuffExpired()`.

For 镇山河 (100ms interval tick — needed for debuff cleanse):
- Keep inside the 100ms gate.
- Modified `pulseZhenShanHeTarget` to accept `zoneExpiresAt?: number`.
- Apply zone invulnerable (buffId 1323) once on entry with `durationMs = zoneExpiresAt - now` instead of refreshing 100ms every tick.
- Added `else` branch in GameLoop for when player is outside the zone: removes buff 1323 if present.

**CC cleanse on 生太极 entry**: Changed to only run when buff is FIRST applied (the `ownerInside && !ownerHasBuff` branch), not every tick. Proper `pushBuffExpired` events are emitted for each cleansed CC buff.

**生太极 now uses `addBuff()`** instead of direct `owner.buffs.push()` — ensures BUFF_APPLIED event, immunity checks, and status bar visibility.

### 4 new abilities: 无相诀, 应天授命, 斩无常, 灭 (2026-04-xx)

**New effect types added** (effects.ts + categories.ts):
- `DAMAGE_REDUCTION_HP_SCALING` — DR scaling with target HP% (for 无相诀)
- `PROJECTILE_IMMUNE` — blocks `isProjectile: true` abilities (for 斩无常)
- `YING_TIAN_SHIELD` — huge shield + periodic settle + on-hit heal (for 应天授命)
- `MIE_STRIKE` — conditional 2/12 dmg + MIN_HP_1 buff (for 灭)
- `CHANNEL_AOE_TICK_HEAL` — like CHANNEL_AOE_TICK but heals nearby targets (贯体)

**isProjectile flag on Ability** — abilities with `isProjectile: true` are blocked by PROJECTILE_IMMUNE buff (checked in Damage.ts handleDamage).

**DAMAGE_REDUCTION_HP_SCALING logic** (combatMath.ts `resolveScheduledDamage`):
- Base DR = buff effect value (0.5 = 50%)
- +10% per 25% HP below 100%: `bonus = floor((1 - hpPct) / 0.25) * 0.1`
- Capped at 0.8 (80%)

**应天授命 (YING_TIAN_SHIELD) mechanic**:
- `buffRuntime.ts`: when buff has YING_TIAN_SHIELD effect, sets `effectiveShield = 999_999_999` and calls `addShieldToTarget`; otherwise uses normal SHIELD effects sum
- GameLoop STACK_ON_HIT scan: finds YING_TIAN_SHIELD buff on hit target, accumulates `buff.yingTianAccum += tickDmg`; heals 6% of lost HP (贯体)
- GameLoop periodic tick (periodicMs: 1000): settles `Math.min(accum, maxHp * 0.2)` as true damage (direct `player.hp` subtract), resets accumulator

**无相诀 natural expire** — After `player.buffs.filter(expired)`, check for buff 2710: if `player.hp < maxHp * 0.1`, apply `applyHealToTarget(player, maxHp * 0.5)` (贯体).

**斩无常 CHANNEL_AOE_TICK_HEAL** — new periodic effect type, heals `e.value` to all players within `gameplayUnitsToWorldUnits(e.range)`. Heals self + nearby opponents (贯体).

**Buff IDs**: 2710 = 无相, 2711 = 应天授命, 2712 = 斩无常, 2713 = 灭

## 远程弹道技能 Editor Tab (2026-05 session)

**What was built**: Third tab "远程弹道技能" in the ability editor to manage which abilities are ranged projectiles blocked by 斩无常's PROJECTILE_IMMUNE buff.

**Architecture**:
- `isProjectile?: boolean` added to `AbilityEditorOverrideEntry` in `abilityPropertySystem.ts` — persisted in `ability-property-overrides.json`.
- `buildResolvedAbilities` applies override to `(nextAbility as any).isProjectile` so the game engine sees it at runtime.
- `buildAbilityEditorEntry` exposes `isProjectile: boolean` in the snapshot.
- `setAbilityIsProjectile(abilityId, bool)` in `abilities.ts` — same pattern as `setAbilityTag`.
- Route: `PUT /api/game/ability-editor/:abilityId/is-projectile` with body `{ isProjectile: boolean }`.
- Frontend: `ProjectileEditorTab.tsx` — rarity filter + left/right two-column layout (undecided | decided).
- Frontend: Third tab "远程弹道技能" added to `page.tsx`, `MainTab` type extended, URL `?tab=projectiles` supported.

**Blocking**: `Damage.ts` checks `(ability as any).isProjectile === true` + target has buff with `PROJECTILE_IMMUNE` effect. 斩无常 (buff 2712) has PROJECTILE_IMMUNE. The override system feeds isProjectile into the runtime ability object, completing the chain.

## isProjectile Blocking Bug Fix (2026-05 session)

**Bug**: Abilities marked `isProjectile: true` in `ability-property-overrides.json` still dealt damage through 斩无常's PROJECTILE_IMMUNE. The check in `Damage.ts` was present and correct, and `buildResolvedAbilities()` applied the flag correctly. The bug was in `normalizeAbilityOverrideEntry()` in `abilityPropertySystem.ts` — it stripped `isProjectile` from the JSON on load. The function parsed `properties`, `numeric`, `tags` but never read `isProjectile`, so `abilityOverrides?.isProjectile` was always `undefined` at rebuild time.

**Fix**: Added `isProjectile` parsing in `normalizeAbilityOverrideEntry`: read `entryRecord.isProjectile` (boolean), include it in the return object, and updated the empty-check guard to also consider `isProjectile`.

**Root cause pattern**: When a new field is added to `AbilityEditorOverrideEntry` and `saveAbilityEditorOverrides`, the `normalizeAbilityOverrideEntry` function must also be updated to parse and pass through that field — it doesn't do a generic passthrough.

## 斩无常 Channel Range Display (2026-05 session)

**Feature**: Added 4-unit AOE ring for 斩无常 (buffId 2712) just like 风来吴山 (buffId 1014) has.

**Implementation**:
- `ArenaScene.tsx`: Added `meChannelRadius?: number` and `channelingOpponentRadius?: number` props (default 10). The AOE zone `radius` now uses these instead of the hardcoded `10 * storedUnitScale`.
- `BattleArena.tsx`: Added `meChannelRadiusRef` and `oppChannelRadiusRef` (default 10). The `useEffect` watching `me?.buffs` now checks both buffId 1014 and 2712, setting radius to 4 for 2712. Same for opponent buffs. `ArenaScene` receives `meChannelRadius` and `channelingOpponentRadius` derived from the refs.

### isProjectile Display Fix verification (2026-04 session)
After the `normalizeAbilityOverrideEntry` fix was compiled, verified via:
```node -e "const {loadAbilityEditorOverrides}=require('./backend/dist/game/abilities/abilityPropertySystem.js'); const r=loadAbilityEditorOverrides(); console.log(Object.entries(r.overrides).filter(([,v])=>v.isProjectile===true).length);"```
→ Returns 21, confirming the JSON's `isProjectile: true` entries are now read.

### PROJECTILE_IMMUNE: Buff bypass fix (2026-04 session)
**Bug**: When PROJECTILE_IMMUNE blocked damage, enemy-targeted buffs from the same projectile ability still applied (e.g. slows, stuns from ranged attacks).

**Fix 1 - immediateEffects.ts**: Added PROJECTILE_IMMUNE check in the main effect loop BEFORE the switch statement. If `enemyApplied && ability.isProjectile === true && target has PROJECTILE_IMMUNE buff` → `continue` (skip ALL enemy effects: damage, controls, knockbacks, etc.).

**Fix 2 - buffs.ts**: Added same check in the per-buff loop of `applyAbilityBuffs`. If `localEnemyApplied && ability.isProjectile === true && localBuffTarget has PROJECTILE_IMMUNE` → `continue`.

**Pattern**: PROJECTILE_IMMUNE must be checked in BOTH `immediateEffects.ts` (for effects[]) AND `buffs.ts` (for buffs[]) because the ability pipeline handles effects and buffs in separate passes.

## Legacy Damage Route Audit (2026-04-26 session)

**Background**: An audit was triggered when 追命箭's `TIMED_AOE_DAMAGE_IF_SELF_HP_GT` handler was found to skip dodge, damage immunity, redirect, processOnDamageTaken, and shieldAbsorbed.

**Modern damage pattern** (must be applied everywhere in immediateEffects.ts and GameLoop.ts):
```
const adjXxx = resolveScheduledDamage({...});
if (adjXxx > 0 && !hasDamageImmune(target)) {
  const { adjustedDamage: adXxx, redirectPlayer: rtXxx, redirectAmt: raXxx } = preCheckRedirect(state, target, adjXxx);
  const applyXxx = rtXxx ? adXxx : adjXxx;
  const resultXxx = applyXxx > 0 ? applyDamageToTarget(target, applyXxx) : { hpDamage: 0, shieldAbsorbed: 0 };
  state.events.push({ type: "DAMAGE", value: applyXxx, shieldAbsorbed: (resultXxx.shieldAbsorbed ?? 0) > 0 ? resultXxx.shieldAbsorbed : undefined, ... });
  if (resultXxx.hpDamage > 0) processOnDamageTaken(state, target, resultXxx.hpDamage, source.userId);
  if (rtXxx && raXxx > 0) applyRedirectToOpponent(state, rtXxx, raXxx);
}
```

**Fixes applied** (all in immediateEffects.ts and GameLoop.ts):
- GameLoop.ts: TIMED_AOE_DAMAGE → added shieldAbsorbed (fix fallback `{ hpDamage: 0 }` must also include `shieldAbsorbed: 0`)
- GameLoop.ts: TIMED_AOE_DAMAGE_IF_SELF_HP_GT → fully rewritten with modern pattern
- immediateEffects.ts: 百足 (RANGED_MULTI_TARGET_AOE_DAMAGE), 五方行尽 (WUFANG_XINGJIN_AOE), BANG_DA_GOU_TOU fallback, SETTLE_DOT, YIN_YUE_ZHAN, LIE_RI_ZHAN, HENG_SAO_LIU_HE_AOE, JIAN_ZHU_TIAN_DI_STRIKE (burst + normal), PO_FENG_STRIKE, MIE_STRIKE

**Pitfalls encountered**:
1. **Removing const declarations**: When the old replace-string ends with `const dotBuff = ...` or `const debuff = ...`, that line gets consumed. Always include that line in the new string too.
2. **Removing `if (rootBuff) {` guard in 五方行尽**: The old replace-string ended with `if (rootBuff) {` so the guard opening was consumed. The closing `}` was still there. Fixed by replacing `hitAtLeastOneEnemy = true;` (the duplicate) with `if (rootBuff) {`.
3. **Fallback `{ hpDamage: 0 }` TypeScript error**: When the ternary fallback object is `{ hpDamage: 0 }` but the success branch returns an object with `shieldAbsorbed`, TypeScript infers a union type and `.shieldAbsorbed` access fails. Always use `{ hpDamage: 0, shieldAbsorbed: 0 }` as fallback.
4. **Variable name conflicts**: Use unique prefix per handler (adjBurst, rtBurst, etc.) to avoid shadowing.

## 孤影化双 ability implementation (2025)

### Pattern: snapshot + deferred restore via buff expiry
- Added `GU_YING_HUA_SHUANG` to `EffectType` union in `effects.ts` and `EFFECT_CATEGORY_MAP` in `categories.ts` — every new custom effect type needs both updates.
- Snapshot is stored as `(liveBuff as any).snapshot = { hp, shield, cooldowns }` AFTER calling `addBuff()`, by finding the buff in `source.buffs` by buffId.
- `addBuff()` does NOT support custom extra fields — attach custom data to the returned live buff object post-call.
- Restore happens in `GameLoop.ts` in the `naturallyExpired` section, same pattern as `wuxiangExpired` and `xuanjianNaturallyExpired`.
- Buff declared in `ability.buffs[]` is auto-included in abilityPreload — no manual `buffs.push()` needed.
- The CLEANSE effect (declared separately in `effects[]`) handles control removal; the custom effect only handles snapshot + buff application.

## 逐云寒蕊 (zhu_yun_han_rui) — first targetable HP-bearing entity

- Introduced new top-level `state.entities: TargetEntity[]` (separate from `groundZones`).
  Diffed/published like other state arrays. Defined in `backend/game/engine/state/types/state.ts` and re-exported via `state/types.ts` barrel.
- Cast pipeline plumbed `entityTargetId?` through:
  `gameplay.routes.ts` → `playService.playAbility` → `applyEffects` → `applyAbility` (PlayAbility.ts/executeAbility.ts) → `applyImmediateEffects` (`castContext.entityTargetId`).
- DAMAGE effect routes to entity HP when `castContext.entityTargetId` is set and effect is enemy-applied (skip player damage path entirely).
- Custom effect `PLACE_ZHU_YUN_HAN_RUI` creates the entity at caster's snapped ground Z and applies caster control-immune buff via `addBuff`.
- Buff 2715 covers ALL control levels: must include both `CONTROL_IMMUNE` and `KNOCKBACK_IMMUNE` effects (CONTROL_IMMUNE filter does not strip KNOCKED_BACK / PULLED — those are handled by `hasKnockbackImmune`).
- Per-tick stealth granting: GameLoop iterates entities → in-zone friendlies → entry timestamp + 1 s grant delay → `addBuff(2716)` with `breakOnPlay`. Buff 2716 has short `durationMs` (500 ms) refreshed every tick; out-of-zone immediately removes it. Death/expiry cascades via emit `BUFF_EXPIRED` for all stealth buffs sourced from the dying entity.
- Frontend: separate `selectedEntityId` state in BattleArena; mutually exclusive with `selectedTargetId`. OPPONENT-target abilities prefer player target if both set. Entity rendered via new `TargetEntityVisual` (clickable orb + ground ring + HP bar billboard).
- Gotcha: Custom effect type names must be added in 3 places: `effects.ts` EffectType union, `categories.ts` EFFECT_CATEGORY_MAP, AND `applyAbilityBuffs` exclusion list in `buffs.ts` if the handler manages buffs manually.
- GameLoop movement broadcasts must include `/entities` once targetable ability-created objects exist; otherwise entity HP/expiry/destruction changes never reach the client and zones appear stuck after their server-side expiry.
- For 逐云寒蕊-style hidden states, reuse the 散流霞 visual path only for transparency, but add a separate `hideHpBar` switch on the character renderer so enemy HP/name billboards can be suppressed without making the unit fully invisible.
- Tab targeting should use a live ref of all current targetable enemies (players + ability-created entities), not a stale opponent-only list captured by the keyboard effect.
- If PM2 restart races port 3000 and leaves stale `EADDRINUSE` lines, use a clean frontend-only restart: `pm2 stop frontend` -> kill `lsof -ti:3000` -> `pm2 flush frontend` -> `pm2 restart frontend`.
- Entity selection must feed the SAME top-center target HUD path as player selection. If `selectedEntityId` is handled only in cast checks, the object can technically be targetable but still feels unselectable to the player.
- Arena target feedback has 3 separate surfaces to keep in sync for non-player targets: top-center target panel, center distance label, and the 3D target line. Missing any one of them makes selection feel broken.
- Entity damage events should not reuse the owner player's `targetUserId`; otherwise frontend hit feedback attaches to the owner player instead of the entity. Emit `entityId`/`entityName` on DAMAGE events for targetable objects.
- For entity floating damage numbers, track per-entity projected screen bounds in the scene layer and use them when processing DAMAGE events from the local attacker.
- In large React arena components, never compute values for JSX inside an effect-local helper if the JSX reads them later. `selectedTargetDistance` was added inside a `useEffect` draft-ability block, so production build succeeded but runtime render crashed with `ReferenceError`. Put render-consumed target values in top-level render scope.

### Entity-target combat surfaces (2026-04-22)
- **Custom effect handlers must consult `explicitEntityTarget`**: `applyImmediateEffects` previously set `effTarget = state.players[effTargetIndex]` for every effect in the loop. Custom handlers (BANG_DA_GOU_TOU, dash effects, AoE pulls) used that `effTarget` and ignored entity targeting, so casting a dash on a dummy actually flew toward the opposing player and damaged both.
  - Fix: when `explicitEntityTarget && enemyApplied`, override `effTarget` with the entity. Entities expose `userId / position / hp / buffs / shield` which is enough for `handleDash`, `addBuff`, and the existing damage helpers. Also patched `DIRECTIONAL_DASH` and `GROUND_TARGET_DASH` to take entity position when an entity is targeted.
- **Static dummies and pull**: dummies have no movement loop, so `JILE_YIN_AOE_PULL` and `TIMED_PULL_TARGET_TO_FRONT` previously silently no-op'd on entity targets. Workaround: teleport the entity to the pull endpoint (1u in front of caster for single-target pull, STOP_DISTANCE from caster for AoE pull) and still apply the PULLED buff for status visibility.
- **`getImmediateEnemyDamageTargets` already includes entities**, so `BAIZU_AOE` / `WUFANG_XINGJIN_AOE` / channel AoE damage paths require no change for Point 7.
- **Frontend selection of own dummies**: `TargetEntityVisual` previously gated `onClick` behind `!isOwn` which prevented inspecting friendly dummies. Removed the gate — users may always click any entity for selection / inspection. The cast layer still rejects entity targets owned by the caster (`getExplicitEnemyEntityTarget`), so this only affects HUD selection.
- **Target HUD label**: the top-center target panel hard-coded `${owner}的逐云寒蕊`. Added dummy-aware branch (`敌方木桩` / `友方木桩`) and made `entityOwner` lookup also include the local player so own-dummy ownership resolves correctly.
- **Dummy 3D model**: added a player-style cylinder body to `TargetEntityVisual` (radius 0.42, height 1.5, matching `Character.tsx`) so dummies are visible as upright cylinders rather than just a ring on the ground.
- **Layout**: cheat ability grid widened to `repeat(7, 32px)` (7 icons per row instead of 6) to use the previously empty horizontal space; control panel button + panel relocated to `right: 290` so the open cheat panel never covers them.

## TargetEntity 综合战斗作业 (Round 2)

### Pull on entities was a teleport
- TIMED_PULL_TARGET_TO_FRONT and JILE_YIN_AOE_PULL set entity position directly because there was no entity movement loop. Replaced with `entity.activeDash = { vxPerTick, vyPerTick, ticksRemaining }` plus a new entity integrator in `GameLoop.tickGame` (parallel to the player movement section). Use proportional duration based on `pullDistance / maxPullDistance` to keep speed consistent.

### Ground-AOE on entity targeted player position
- 百足/无方·星辰 pulled `groundTarget ?? target.position` for AOE center. When the user has an entity selected (no mouse-ground), `target` is the opposing player. Fix: prefer `explicitEntityTarget.position` over `target.position` whenever no `groundTarget` is provided.

### Tab cycling needed exclusion + front cone
- New rule: Tab/F1 must (a) exclude `currentSelectedId` so re-pressing always advances and (b) only consider candidates in the 180° front cone (`dot(facing, dir) > 0`). Implemented in `BattleArena.tsx` Tab handler. When no candidate found, silently keep current selection.

### Knockback didn't push dummies
- Dummies have `buffs: []`; the bug was missing entity movement integrator (same root cause as Pull). After adding the entity activeDash tick, dummies are pushed correctly. **Never** whitelist entities — treat them like an unbuffed player; rely on `hasKnockbackImmune`/`blocksControlByImmunity` instead.

### 沧月 (multi-target test ability)
- Added EffectType `CANG_YUE_AOE` (3 registration sites: types/effects.ts, definitions/categories.ts, flow/play/buffs.ts exclusion list) plus ability `cang_yue` and a custom handler that:
  1. Damage 1 to primary (entity or player)
  2. addBuff knockdown 1340 (CONTROL 2s)
  3. Iterate `getImmediateEnemyBuffTargets` within 6u of primary (excluding primary by reference); for each non-immune target set `activeDash` (30u over 30 ticks) + addBuff KNOCKED_BACK 1341 1s.
- Used `t === primary` for dedupe (entities have no userId).
- Buff IDs collide easily — checked with grep `buffId: 1[3-4][0-9][0-9]` before picking 1340/1341 (1336/1337 already used by 无方/棒打 series).

## TargetEntity Round 3 — wall stops, knockback angle, clear-all

### Entity knockback ignored walls/terrain
- Round-2 entity dash integrator just added `vxPerTick`/`vyPerTick` to position with no collision pass, so dummies tunneled through walls and floated up onto raised floors. Fixed in `GameLoop` entity dash loop: sub-step the move (≤0.5u per sub-step), call `resolveMapCollisions(entity as any, this.mapCtx)` per sub-step, then snap `entity.position.z` to `getGroundHeightForMap(...)` so they walk over terrain naturally and stop at walls. If actual step < 35% of intended, the dash is canceled (matches the player wall-block heuristic).

### 沧月 knockback direction must originate from the caster
- Original handler used `target − primary` for the outward direction. That made the side targets fan around the *primary* dummy regardless of where the caster was — which looked wrong when the caster stood off-axis. Fixed to use `target − source` (caster → victim) so all secondary targets get pushed away from the caster. Fallback uses caster facing if a victim sits on top of the caster.

### Clear-all-dummies button
- Added `POST /cheat/clear-dummies` (mirrors restore-dummies / clear-dummy-debuffs) which `filter()`s out any entity whose `kind` is in `DUMMY_KINDS`. Wired a red "清除木桩" button next to "清木桩Buff" in the dummy control panel.

## TargetEntity Round 3 hotfix — entity collision crash + revert 沧月 angle

### `resolveMapCollisions` is player-only (reads `velocity`)
- Calling `resolveMapCollisions(entity as any, mapCtx)` on a TargetEntity from the GameLoop entity-dash loop crashed with `TypeError: Cannot read properties of undefined (reading 'vz')` because both `resolveExportedRecovery` and `resolveObjectCollision` write/read `player.velocity.{vx,vy,vz}`. The crash threw mid-tick, so the cang_yue secondary knockback never executed (knockdown ran before the crash, hence "knockdown works, knockback doesn't") and clients were disconnected by the broken loop.
- Added `resolveEntityHorizontalCollision(ent, mapCtx)` in `movement.ts` which only does the BVH horizontal sphere resolve and never reads/writes velocity. Use this for any non-player object dashed by an ability.

### 沧月 angle reverted to primary-relative
- User confirmed primary-relative outward direction looks correct in practice. Reverted from caster-relative back to `victim − primary` outward (caster-relative fallback retained for the same-spot case).

## Round: 5 new test abilities + 沧月 polish

- Renamed buff 1340 沧月·击倒 → 沧月·倒地.
- Reverted 沧月 knockback direction to caster-relative (safe now: entity dash uses velocity-free `resolveEntityHorizontalCollision` from prior round).
- Made `lifestealPct` work for immediate DAMAGE effects (player→player in `Damage.ts`, player→entity in `immediateEffects.ts`). Previously only TIMED_AOE_DAMAGE/scheduled supported it.
- Added EffectTypes `XU_RU_LIN_PROC` (parent self-buff marker) and `XU_RU_LIN_RESTORE` (child buff marker) — registered in `effects.ts` union and `categories.ts` map (both BUFF).
- Added 5 new abilities: `qu_ye_duan_chou` (驱夜断愁, 50% lifesteal), `bu_feng_shi` (捕风式, 20% slow 3s), `you_yue_lun` (幽月轮, 1 damage), `xu_ru_lin` (徐如林, 50%-on-hit-proc → heal 5 on expire), `kang_long_you_hui` (亢龙有悔, 2×3 damage + self-CONTROL 1s + DOT 24s/2-stack/2s tick).
- Pattern for self-target debuff on opponent-targeted ability: set `applyTo: "SELF"` per-buff (亢龙有悔·定身).
- Pattern for dynamic on-hit proc buff: declare both parent + child buffs in `ability.buffs[]` for editor visibility, exclude ability from `applyAbilityBuffs`, apply parent on cast via custom hook in `immediateEffects.ts`, apply child via attacker-side proc loop in `GameLoop.ts` (placed just before `stackProcScanIndex` update). Heal-on-expire handled by filtering `naturallyExpired` near other expire handlers.

## Round: lifesteal-at-full-HP, ability tweaks, 4 new abilities

- Lifesteal now emits HEAL event with the *intended* heal amount (not capped by available HP), so the heal float text appears even at full HP. Both `Damage.ts` and the entity-target lifesteal path in `immediateEffects.ts`.
- 幽月轮 cooldown 300 → 0 (still uses GCD).
- 徐如林 buff (1343) duration 30s → 20s.
- Added `Z_LOCK` effect type: when active on a player, suspends gravity and Z-integration in `movement.ts`. Combined with `CONTROL` produces an "anchor in mid-air" lock. Wired into both the gravity step and `applyForcedControlFall`. 亢龙·定身 (1345) and 龙啸九天·定身 (1351) both use `[CONTROL, Z_LOCK]`.
- Added `JUMP_NERF` effect type: `value` = peak-height multiplier (0.5 = 50% jump height). Implemented as `vzScale = sqrt(value)` because peak-height ∝ vz². Used by 抱残式.
- DAMAGE_TAKEN_INCREASE in `combatMath.ts` now sums across all buffs and multiplies by stack count (was: only first matching effect). Required for stacking 太极无极.
- New ability **抱残式** `bao_can_shi`: 8u, applies debuff 1347 (JUMP_NERF 0.5 + SLOW 0.48, 8s).
- New ability **太极无极** `tai_ji_wu_ji`: 20u, 2 dmg + GCD; if target had CONTROL/ROOT/FREEZE at cast, apply stacking debuff 1348 (DAMAGE_TAKEN_INCREASE 0.2, 12s, max 5 stacks). Pre-damage CC state captured into `taiJiCcOnTarget` since damage may strip control buffs. Custom buff application excluded from `applyAbilityBuffs`.
- New ability **拿云式** `na_yun_shi`: 4u, target HP < 30 precondition (early-return in `applyImmediateEffects`); deals 5 normal damage + 10 `TRUE_DAMAGE`. New `TRUE_DAMAGE` effect bypasses DR/shield/dodge but still respects INVULNERABLE/UNTARGETABLE/DAMAGE_IMMUNE.
- New ability **龙啸九天** `long_xiao_jiu_tian`: SELF, `allowWhileControlled: true`. Custom `LONG_XIAO_JIU_TIAN_AOE` effect handler: cleanses self, applies buffs 1349 (CONTROL_IMMUNE 3s) + 1350 (DAMAGE_REDUCTION 0.6, 6s) + 1351 (CONTROL+Z_LOCK 1s self-stuck), AOE 6u: 1 damage + slow knockback (10u over 300 ticks = 10s) with KNOCKED_BACK buff 1352. Excluded from `applyAbilityBuffs` (custom application).
