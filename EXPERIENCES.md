# Zhenchuan — Experiences Log

Record all problems solved, unresolved issues, and disproved approaches here.
Each entry goes under its relevant section header.

## Target-target title simplification and spacing retune (2026-05-07)

**Problem set**:
1. The target-target icon bar still displayed a range prefix when only the name should remain visible.
2. The target-target bar sat too low relative to the main target bar.
3. The horizontal gap between the main target bar and target-target bar needed another 50% increase.

**Fix**:
- Removed the target-target distance prefix and now render only the resolved target-target name in the compact icon bar title.
- Reduced the target-target bar top offset from `53px` to `26.5px`, effectively moving it up by 50%.
- Increased the main-target to target-target gap from `16px` to `24px`.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- The target-target title is controlled by a single local string in `BattleArena.tsx`, so removing distance text does not require touching the shared distance formatter used by the main target bar.
- For this HUD layout, a simple `margin-top` change on the compact secondary bar is enough to retune its vertical relationship to the main target without reopening the whole target stack structure.

## Status bar scale trim and target-target icon bar spacing (2026-05-07)

**Problem set**:
1. Status text outlines needed to be about 30% thinner without changing the underlying timer behavior.
2. The whole status bar needed to read about 10% smaller overall, not just with smaller icons.
3. The target-target icon bar needed another 50% width reduction.
4. The target-target bar needed a larger separation from the main target bar and a lower vertical placement by roughly one bar height.

**Fix**:
- Reduced the buff-name, stack-count, and timer stroke/shadow outline thickness values by roughly 30%.
- Scaled the status bar down by about 10% across icon size, row/item gaps, reserved label/timer height, and related text sizes, including compact mode.
- Reduced the target-target boss stack and bar width from `220px` to `110px`.
- Doubled the main-target to target-target gap from `8px` to `16px` and lowered the target-target icon bar with a `53px` top offset to match its compact bar height.
- Rebuilt backend and frontend after each numbered point, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- For this HUD, “overall size” changes need the reserved text block height and row gaps scaled with the icons; shrinking only the icons leaves the component visually too tall.
- The main target bar and target-target bar remain safest to tune with independent CSS width and offset rules.
- In this environment, chained build/restart/health commands can stop echoing after the frontend `Creating an optimized production build ...` line even when the follow-up explicit build succeeds, so final verification should use direct reruns of the frontend build and health probes when the combined output is inconclusive.

## Enemy icon bar width reduction (2026-05-07)

**Problem set**:
1. The enemy icon bar remained too wide after the previous HUD rework and needed to be reduced by 30%.

**Fix**:
- Reduced the main enemy icon bar width and min-width from `360px` to `252px`, leaving the smaller target-target bar unchanged.

**Lessons**:
- The main target bar and target-target bar use separate width rules, so width corrections can stay narrowly scoped without disturbing the secondary target stack.

## Status readability, shield display, icon bar, and HTTPS verification (2026-05-07)

**Problem set**:
1. Status placement boxes needed to be long, centered-label rows with at least 10 buffs per row.
2. Status icon/text readability needed brighter colors, larger icons, stronger text outlines, slower near-invisible urgent blinking, and hover text `马上消亡` for sub-1-second remaining time.
3. 应天授命 needed a 1亿 shield, while shield numbers above max HP should be hidden on self, target, and target-target bars.
4. Empty-ground deselect needed to happen only on a rapid left click, not on left-click drag used for camera movement.
5. The target health UI needed a screenshot-inspired icon-bar style, then was corrected to target-only, centered name text, no icon slot, no blue marker, and tighter/larger red health layout.
6. Localhost Playwright testing produced connection noise, so final browser testing needed the real HTTPS host.

**Fix**:
- Raised status rows to 10 items by default, made custom status placement boxes long, and centered their editing labels.
- Increased status icon size by 15%, brightened buff names/timers with heavier outlines, used displayed seconds for urgent blinking, and changed tooltip zero-second text to `马上消亡`.
- Set the 应天授命 linked shield to `100_000_000` and hid numeric shield labels when shield exceeds max HP while preserving the white shield fill.
- Deferred empty-ground target clearing to low-movement, short-duration left-click release, so camera drag no longer deselects.
- Reworked selected target and target-target health bars into centered red icon bars with distance-name titles, removed the temporary self-bar conversion, removed the placeholder icon area and blue marker, and removed live status debug panels from the HUD.
- Verified on `https://zhenchuan.renstoolbox.com`: login, start 玉门关, target selection via Tab, drag-vs-click deselect behavior, and 应天授命 shield application/display.

**Lessons**:
- Use the real HTTPS host for browser verification when WebSocket routing differs from localhost; localhost can create false connection failures even after PM2 is healthy.
- Visual target HUD changes should be tested against screenshots quickly, because placeholder icon areas and extra resource markers can look wrong even when the underlying markup is technically structured.
- Status debug overlays are useful while tuning timers, but must not remain enabled in live HUD paths.

## Target selection and split movable status bars (2026-05-07)

**Problem set**:
1. Target-of-target was inferred from active channels/fallbacks instead of the selected actor's real target.
2. Status bar borders, hover emphasis, urgent blinking, timer outlines, timer size, and second-mark spacing needed to better match the requested in-game visual style.
3. Player and target buff/debuff bars needed to be separate movable custom UI elements.
4. Dragging in 自定义界面 could still move the camera because global capture-phase mouse handlers saw the event before React handlers stopped it.

**Fix**:
- Added authoritative `targetSelection` to player state, a `/game/target/selection` route, frontend sync through `useGameState`, and target-of-target resolution from the selected actor's stored selection.
- Softened status icon borders to lightweight gray, made hover more obvious through icon framing, changed urgent flashing to a smooth 1-second opacity animation, enlarged centered timer text, thinned its black outline, and replaced spaced ASCII seconds marks with compact prime glyphs.
- Added `categoryFilter` to `StatusBar`, then split player and target status into independent `BUFF` and `DEBUFF` placement keys under the existing `zhenchuan-ui-positions` storage. Legacy player status placement seeds the new player buff bar so old layouts do not jump unexpectedly.
- Cleared camera drag state when entering custom UI or starting UI drag, marked draggable status placements with `data-ui-drag`, and blocked mouse/touch/wheel camera handlers while custom UI mode is active.

**Lessons**:
- Target-of-target must be shared authoritative state once the UI promises to show another actor's real target. Active channels are useful cast context, not selection state.
- Capture-phase window listeners can beat React `stopPropagation`; draggable HUD elements need both a data-attribute guard and explicit camera-state reset.
- Splitting a shared visual component is cleaner when the component gets a narrow category filter prop instead of duplicating buff rendering logic in the parent HUD.

## Homepage start styling, status hover rules, and custom UI placement (2026-05-07)

**Problem set**:
1. The homepage primary start button looked like a plain black rectangle and needed stronger game styling.
2. The in-game mode badge had been offset to avoid a home panel that is no longer displayed.
3. Status text needed thin black outlining, yellow default buff/debuff names, black icon borders, smaller icon scale, flex-start rows, and full-item blinking below 3 seconds.
4. Hovered status icons needed to read differently from non-hovered icons without turning status text white.
5. The ESC panel needed a first custom UI mode that closes the panel, shows confirm/cancel controls, and lets the player move the status bar with saved placement.

**Fix**:
- Restyled the big homepage start button with a framed, highlighted game-button treatment while keeping the existing mode selector flow.
- Moved the mode badge back to the top-left now that the home panel no longer occupies that space.
- Updated StatusBar rows to flex-start layout, reduced default icon size by 30%, added thin black borders/outlines to icons, names, timers, and stack numbers, made names yellow by default, and made sub-3-second statuses blink as a complete item.
- Replaced the old hover whitening with a blue icon border/glow so hover matches the screenshot difference while preserving text colors.
- Added 自定义界面 in the ESC panel. It opens a centered confirm/cancel panel and a green placement frame for the player status bar; confirmed positions persist through the existing `zhenchuan-ui-positions` storage, and cancel restores the snapshot.

**Lessons**:
- StatusBar hover should use icon framing for affordance when text colors carry gameplay meaning; changing text to white fights readability and screenshots.
- UI customization should reuse the existing position persistence seam and add confirm/cancel snapshot behavior instead of writing a separate storage format.

## Status layout, disconnect prompt, target-target HUD, and BVH audit (2026-05-07)

**Problem set**:
1. The status bar name/time/icon layout had drifted from the old name-above-icon presentation.
2. Status icons needed to be larger while keeping time below the icon and rows left-aligned.
3. Remaining players needed a modal choice when another player disconnects, with No/Yes and a 30-second countdown.
4. The target-target bar needed to be half-size, include compact buff/debuff icons, show percent-only health text, and still appear when self is selected.
5. The per-stat combat preset panel needed visible exact values, not hidden tooltip-only values.
6. The previous BVH helper restoration needed an audit to confirm it did not undo the intentional exported-map ground fallback cleanup.

**Fix**:
- Restored StatusBar names to the previous above-icon flow with category-colored text, set icons to 48px, moved timers below icons, and made rows consume full width so contents align left.
- Added `PLAYER_DISCONNECTED` / `PLAYER_RECONNECTED` WebSocket presence messages and a solid, non-blur disconnect modal that can dismiss or call `/game/end` and return home; the countdown auto-returns after 30 seconds.
- Added compact StatusBar options for icon-only rows, then used them under the half-width target-target boss health bar. Target-target HP now displays as a percentage, and self selection falls back to the primary opponent.
- Updated the expanded combat stat preset panel so every rarity button shows the exact stat value directly in the panel.
- Audited the BVH helper restore: the restored symbols are required by collision, vertical ground probing, and LOS, while collision-test unsupported support still returns `0` instead of falling back to legacy object heights.

**Lessons**:
- For a shared component like StatusBar, add explicit props for compact/hidden-name/hidden-timer variants instead of restyling the default and breaking existing presentation.
- Opponent disconnect prompts need a server-side presence event; a client can only observe its own socket closing.
- Restoring a missing helper can be correct even if the helper includes legacy-mode utilities, as long as the active collision-test path keeps the intended guard against legacy fallback behavior.

## Exported map BVH helper regression (2026-05-07)

**Problem set**:
1. The exported-map battle scene crashed at runtime with `ReferenceError: getBvhGroundProbeOriginY is not defined`.
2. The same broken helper seam also removed `EXPORT_CYL_RADIUS`, and the remaining collision / LOS code still referenced it during BattleArena startup.
3. Because the frontend production build skips type validation in this setup, those missing top-level symbols survived build time and only failed in the browser.

**Fix**:
- Restored the deleted shared BattleArena helper block: `getGroundHeightClient`, `_bvhCenter`, `_bvhVelocity`, `EXPORT_CYL_RADIUS`, `EXPORT_CYL_HALF_HEIGHT`, `BVH_STEP_UP_EXPORT`, and `getBvhGroundProbeOriginY`.
- Rebuilt backend and frontend, restarted PM2, and verified frontend `200` plus backend preload `200` after the fix.

**Lessons**:
- When a render or collision helper is shared across multiple runtime paths, partial cleanup can leave valid syntax but broken runtime globals. Re-check the whole helper seam, not only the first missing symbol in the browser console.
- In this repo, `next build` can still miss missing runtime identifiers when type validation is skipped, so PM2/browser failures need a direct audit of referenced top-level constants and helpers.

## Cast guards, leave flow, lobby controls, target HUD, and status rows (2026-05-07)

**Problem set**:
1. 云飞玉皇 and similar movement-cancelled channels could still be triggered while walking when latency was low, because they were not explicitly marked `requiresStanding`.
2. The global header/home affordance needed to send a leave signal, show the other player a delayed-end notice, then end the game after 5 seconds.
3. The homepage needed a default 玉门关 mode picker, nearby start button, large center start button, and far-right 技能编辑 entry.
4. The combat stat test controls needed the existing rarity presets plus an expanded per-stat rarity selector.
5. Empty left-clicks in non-UI game space needed to clear target selection.
6. The target HUD needed a target-of-target boss bar to the right of the selected target health bar.
7. Status rows needed fixed buff/debuff rows, application ordering, square neutral icons, compact gaps, hover whitening, minute/second timer formatting, and sub-3-second flashing.

**Fix**:
- Backend and frontend cast guards now treat active `CHANNEL` abilities that cancel on movement as standing-required at cast time, even if the ability definition lacks `requiresStanding`.
- `/game/end` now broadcasts `leaveNotice`, schedules terminal `GAME_OVER` 5 seconds later, and the global header title button owns the in-game leave-home flow.
- Homepage start controls now use the selected mode for both start buttons, default to collision-test/玉门关, include export viewer, and keep 技能编辑 aligned to the far right.
- BattleArena preserves the four broad rarity stat presets and adds an expandable per-stat selector that reuses the existing cheat route while sending required crit fields every time.
- BattleArena clears selected player/entity/self targets on empty left-clicks when no ground cast or dummy spawn is pending.
- The selected-target HUD now renders a right-side target-of-target health bar, using active channel target data when available and falling back to the local player for the 1v1 selected-enemy case.
- StatusBar now sorts visible statuses by applied time/original order, keeps fixed positive and negative rows, removes category-colored borders, uses square compact cells, formats timers as red seconds (`5''`) or yellow minutes (`1'`), and flashes timers below 3 seconds.

**Lessons**:
- Movement-cancelled channel abilities need a cast-time standing guard, not only runtime channel cancellation. Otherwise a low-latency walk input can spend the ability before the cancel path catches up.
- Header leave flow should be driven by shared game state (`leaveNotice` + delayed `GAME_OVER`) instead of a purely local redirect, so the other client receives a visible ending notice.
- The target-of-target bar is frontend-derived for now because selected targets are not shared state. If exact remote target selection is needed later, extend the authoritative game state rather than inferring from active channels.
- A bad JSX patch that landed inside a geometry helper compiled through diagnostics but failed `next build`; for render-heavy TSX edits, the production build is the reliable syntax backstop.

## Testing battle reset, channel cancellation, and manual battle exit (2026-05-07)

**Problem set**:
1. In testing, a lethal hit ended the battle and triggered tournament progression instead of keeping both players in the same fight.
2. Buff-backed reverse channels such as `斩无常` could remain active after another ability successfully cast.
3. The local player could keep seeing their own active channel bar briefly after movement because the frontend waited for the authoritative diff.
4. Ended or stale battles returned active-loop errors but did not consistently behave like a missing game on the frontend.
5. Collision-test self rendering waited for map collision readiness, and unsupported exported-map support checks could fall back to legacy map heights.

**Fix**:
- The shared `checkGameOver()` seam now heals only defeated players to full health and never writes `winnerUserId` / `gameOver` for testing deaths, so immediate casts cannot trigger tournament progression.
- Realtime successful casts now break existing buff-backed reverse channel buffs before applying the new ability, while failed validation leaves the old channel intact.
- The local movement-triggered active-channel suppression/cancel experiment was reverted; backend movement cancellation remains authoritative, while standing-required casts stay blocked by frontend movement intent.
- Added `/api/game/end` handling so the top-left home button marks the battle ended, broadcasts that terminal state, and both clients return to `/game`.
- Collision-test self rendering is no longer gated on collision readiness, exported-map loading yields a frame first, and unsupported BVH ground checks no longer use legacy object-height fallback.

**Lessons**:
- Testing-only death behavior belongs in the shared win-condition seam, not only in `GameLoop.tick()`. Immediate cast paths call `checkGameOver()` before the next tick, so that seam must heal defeated players before any `gameOver + winnerUserId` state can exist.
- Channel replacement rules should run only after validation succeeds, and buff-backed channel metadata may need to be inferred from canonical buff definitions rather than frontend resolved metadata.
- Be careful with local channel-cancel prediction: sending explicit cancel requests from movement input can fight normal cast/movement flow. For 云飞, keep the standing-cast prevention intent-based and let the backend channel cancellation arrive through the normal state diff.

## Standing casts, active-channel errors, movement feel, and map loading (2026-05-06)

**Problem set**:
1. `requiresStanding` casts were gated by residual planar velocity, so after key release the player could wait on deceleration instead of intent.
2. Forward channeling could be silently replaced by a new cast because realtime play bypassed active-channel validation and auto-cancelled the existing channel.
3. Gameplay routes mixed plain-text errors and uncoded JSON messages, making frontend handling inconsistent.
4. Collision-test map loading serialized GLBs, terrain, and collision sidecars, delaying collision readiness behind visual mesh loading.
5. Moving channel AOE rings followed raw server/player props while character meshes used smoothed render positions.
6. Traditional S+A/D mixed backpedal with diagonal movement/facing snaps instead of backpedaling while A/D turned facing.

**Fix**:
- Standing validation now uses current movement intent plus airborne/dash state, and standing casts clear residual planar velocity on both backend and local prediction.
- Realtime casts no longer ignore active channels; `ERR_CHANNELING` is returned and Escape uses a dedicated `/channel/cancel` path to cancel the current channel.
- Gameplay action routes now return coded JSON errors with `{ error, code, message }`, and the in-game client parses those codes for toasts.
- Exported map loading starts entities, terrain, and collision sidecars together; collision BVH readiness is no longer blocked by all GLB visuals finishing first.
- Channel AOE rings now follow the local smoothed render ref or interpolate like opponent characters.
- Traditional S+A/D now stays in backpedal movement while keyboard turning updates facing, including the backend facing payload.

**Lessons**:
- Standing checks should distinguish input intent from inertial cleanup. If residual movement still exists after release, the cast seam can snap it to zero instead of making validation wait.
- Do not make normal casts double as channel-cancel commands. Cancellation deserves an explicit route, especially when Escape has existing UI behavior.
- Moving world-space VFX should share the same smoothed position source as the actor they are attached to; mixing raw server props with smoothed meshes creates visible jitter.
- The exported map pipeline is heavy enough that independent loading phases should run concurrently, and collision readiness should be reported as soon as the collision/terrain data is ready.

## Control-only immunity, dummy stats, restart HP, and client diff load (2026-05-06)

**Problem set**:
1. 啸如虎 used `CONTROL_ONLY_IMMUNE`, but knockback and pull paths are type-3 controls implemented through forced-movement helpers, not only normal buff filtering.
2. Target dummies had 126万 HP but not the rest of the 紫色 test-preset stats.
3. A BATTLE snapshot could hydrate an unstarted or old-stat loop before `/battle/start`, causing the start route to return `battle_already_started` instead of restoring purple battle stats.
4. The frontend applied every 30Hz diff by `structuredClone`-ing the full game state, which recreated large unchanged arrays like `events` and made idle pages keep doing heavy work.

**Fix**:
- Treated `CONTROL_ONLY_IMMUNE` as knockback/pull immunity in forced-movement guards while keeping lockouts separate.
- Added purple combat stats to dummy spawn/restore: HP, AD, crit, defense, and 化劲. The 100-HP ally dummy keeps its HP override.
- Reinitialize unstarted old-stat loops in `/battle/start`, and start the next battle loop immediately after `/battle/complete` creates the fresh purple state.
- Replaced full-state frontend diff cloning with path-level immutable cloning so unchanged `events` and other heavy branches retain their references.

**Lessons**:
- Control immunity has to cover the actual runtime implementation path. Forced movement can bypass ordinary buff-effect filtering if the active dash is created before the status buff lands.
- Client-side diff application must preserve references for unchanged high-frequency branches; otherwise even capped event history still causes avoidable CPU and memory pressure.

## Reverse channel finals, AD buffs, and purple defaults (2026-05-06)

**Problem set**:
1. 加速 shortened reverse-channel duration, but final delayed effects still used the original delay and could miss the last second.
2. 连环弩 used frame-based interval checks, so the final 3rd hit could be skipped when accelerated channel completion landed before a tick frame.
3. Some requested buffs needed to increase attack damage, not post-AD damage.
4. 追命箭 needed its 60% target HP check snapshotted before the first completion hit, not after it.
5. Testing defaults still used low dummy HP, white starting stats, and a 5-second cooldown cap.

**Fix**:
- Haste-adjusted delayed buff effect `delayMs` together with duration/periodic timing, and let due delayed effects fire on the expiration tick before natural buff removal.
- Changed 连环弩 to track completed tick count and catch up all due ticks up to channel end, so the 1/2/3 hits cannot be skipped by frame timing.
- Added `ATTACK_DAMAGE_MULTIPLIER` for AD buffs and moved 女娲补天, 任驰骋, and 紫气东来 onto it; BattleArena now displays effective attack damage from those buffs.
- Added `CONTROL_ONLY_IMMUNE` for 啸如虎 so controls are blocked while lockouts still apply.
- Snapshotted channel-completion HP before processing 追命箭 effects, updated 韦陀献杵 defense values to 30%, raised dummy HP to 126万, made new battles default to 紫色 stats, and reduced the test cooldown cap to 3 seconds.

**Lessons**:
- Haste changes must adjust every timing field that participates in a channel, including final delayed effect offsets.
- Completion-condition effects that depend on pre-hit HP need a per-completion snapshot before mutating HP.
- AD increase and final damage increase must stay separate effect types after the AD overhaul.

## Percent ability corrections and movement recovery diagnostics (2026-05-06)

**Problem set**:
1. Several post-AD abilities still interpreted HP-related values as flat numbers or AD-scaled damage.
2. Fully reduced damage floats still displayed as `-0.00`, and small damage floats still showed decimals.
3. Refresh movement failures were hard to diagnose because failed `/movement` posts were ignored by the frontend and the backend only returned a generic inactive-loop message.
4. PM2 logs showed many concurrent refresh/reconnect requests racing to hydrate the same `GameLoop`, producing repeated “already has an active loop” warnings.

**Fix**:
- Added explicit effect metadata for target max-HP percentage thresholds, percent-of-max-HP true damage, no-crit true damage, and percent-of-max-HP shields.
- Updated `蛊虫献祭`, `追命箭`, `拿云式`, `坐忘无我`, and `疾电叱羽` to use the requested percent/large-HP rules without accidental AD scaling.
- Changed BattleArena damage floats so values below `10000` render as whole numbers and fully reduced hits render as `-1`.
- Added structured battle-loop hydration diagnostics to movement failures and made BattleArena request a fresh snapshot when movement posts fail, so refresh/server-restart movement issues are no longer silent.
- Added a per-game in-flight hydration guard so concurrent snapshot/movement recovery calls share one `GameLoop` recovery attempt.

**Lessons**:
- After AD scaling, every health-percentage ability needs an explicit runtime flag; reusing `DAMAGE` or a flat `threshold` silently introduces AD or flat-HP behavior.
- Movement recovery needs both server-side loop hydration and client-side detection of failed movement requests. Otherwise the player can see casting work while movement appears dead with no actionable clue.
- Hydration helpers that can be called from high-frequency routes need per-key in-flight de-duplication, not just an “already active” check before async DB work.

## Runtime reconnect, event history, 化劲, and HP percent gates (2026-05-06)

**Problem set**:
1. After page refresh or PM2/server restart, casting could still appear to work but movement failed because the realtime `GameLoop` only lived in memory.
2. Long battles could keep growing `state.events`, increasing DB payloads, WebSocket diff/index drift risk, and frontend render work.
3. New `化劲` stat needed to reduce final damage after the existing damage calculation.
4. `蛊虫献祭` needed a 35% max-HP cast gate instead of a flat 35 HP gate.

**Fix**:
- Added a shared `ensureBattleLoop()` runtime helper that hydrates a missing `GameLoop` from persisted `GameSession.state` when the tournament is in `BATTLE`, then used it from snapshot, movement, pickup, and cast/cancel paths.
- Bounded realtime event history in `GameLoop` by periodically replacing `/events` with a trimmed recent window, and changed BattleArena floating combat text to track processed event IDs instead of array length.
- Added `huajinPct` to player state, stat presets, C-panel display, and combat math. Scheduled damage now applies 化劲 at the final damage step after crit and existing reductions.
- Added `minSelfHpPercentExclusive` ability metadata and validation, exposed it through preload, and switched `蛊虫献祭` to require current HP greater than 35% max HP.

**Lessons**:
- Any route that requires an active realtime loop must either hydrate that loop from the saved battle state or fail after a process restart even though the DB snapshot still exists.
- Event consumers should identify events by stable IDs, not array length. Once the server trims or replaces history, length-based detection can miss new events written into reused indexes.
- Percentage HP gates need explicit metadata instead of overloading flat HP gates; otherwise large HP pools silently turn old flat thresholds into meaningless requirements.

## Attack damage overhaul (2026-05-06)

**Problem set**:
1. Existing damage numbers now represent AD multipliers rather than final flat damage.
2. Normal flat healing needs ten-thousand scaling, while lifesteal must stay based on actual damage dealt.
3. 贯体 healing numbers now represent max-health percentages, but shields remain flat values.
4. The ability editor needs a bulk AD multiplier page, and battle HUD values above 1万 need compact 万 display.

**Fix**:
- Central scheduled damage now resolves `base * attackDamage` before source multipliers, target defense, damage taken, damage reduction, and crit. Direct custom damage paths were moved onto the same resolver or explicitly converted for true-damage paths.
- Normal `resolveHealAmountRoll` / `resolveNonCritHealAmountRoll` now scale flat heal bases by `10000`; lifesteal call sites pass `scaleFlatHeal: false` so they heal from post-mitigation damage.
- Added a shared max-HP percentage heal helper and used it for instant, periodic, timed, and stack-on-hit 贯体 heals. `addShieldToTarget` stayed flat for shield effects.
- Added `attackDamage` to runtime player state, defaulted battle HP to `300000` and attack damage to `10000`, and extended the rarity preset cheat route to set HP and AD.
- Added the Ability Editor `AD控制` tab over existing damage numeric settings and changed damage labels to `伤害倍率`.
- BattleArena now formats large floating combat values, HP bars, shield text, max HP, and attack damage with 万 units.

**Lessons**:
- The safest place to reinterpret damage values as AD multipliers is the central scheduled damage resolver; patching individual ability definitions would create drift with editor overrides.
- Flat heal scaling must not be hidden inside `applyHealToTarget`, because lifesteal and 贯体 healing both need different semantics.
- Existing damage editor override storage was already the right source for AD control; adding a bulk page over those settings avoided a second override system.

## Haste stat and timing acceleration (2026-05-06)

**Problem set**:
1. 新增展示属性 `加速率 23.54%`，但实际时间缩短量独立为 `16.2%`。
2. 加速需要影响正读条、逆读条、以及 DOT 的总时间和每跳间隔，且不能误改普通控制 / 普通增益时长。
3. 需要一个 Ability Editor 判定页，让部分技能可明确设置为不受加速。

**Fix**:
- 新增 `engine/utils/haste.ts`，集中保存展示值、实际时间缩短系数，以及读条 / 周期 Buff 的时间缩放 helper。
- 正读条和 active reverse channel 在 `playService.ts` 创建 `activeChannel` 时缩短 `durationMs`，并给连环弩这类 active reverse channel 传递加速后的 `tickIntervalMs`。
- DOT 与 buff-based reverse channel 在 `addBuff()` 统一入口缩短 `durationMs` 和 `periodicMs`，因此普通无周期控制 Buff 不会被加速误伤。
- BattleArena C 面板显示 `加速率 23.54%`，并让 active reverse channel bar 使用后端下发的加速后 tick interval。
- 新增 `hasteUnaffected` ability property、后端 `/ability-editor/haste-unaffected` 路由，以及前端 `不受加速` 三列判定页。该字段会进入 resolved ability，运行时加速 helper 会直接跳过它。

**Lessons**:
- 加速的显示数值和实际缩短系数必须分开建模；把 `23.54%` 直接拿去当时间缩短量会让平衡数值漂移。
- 对 DOT/逆读条这类周期效果，最稳的落点是创建时同时缩放总时长和 `periodicMs`，而不是在 GameLoop 每跳临时折算。
- 任何“该技能不吃某个全局机制”的需求，优先复用 Ability Editor 的 tri-state property override；这样详情页、批量页、preload 和运行时 resolved ability 会自然保持一致。

**Follow-up (later same day)**:
- `不受加速` 的批量页文案已改成更准确的 `读条不受加速影响`，因为当前规则真正影响的是正读条、逆读条和相关周期读条节奏，不是所有技能都需要做这个判定。
- 这个批量页真正需要收紧的是 `未决定` 列，而不是整份 snapshot。给共享 decider 组件增加“只在未决定列显示 `CHANNEL` 技能”的开关，能保留已有手动覆盖项，同时把待决策列表压回到真正有读条的技能。
- 直接用 resolved `ABILITIES` 做一次 runtime audit 最稳：本轮检查了全部 `29` 个 `CHANNEL` 技能，确认它们都带有 `FORWARD` 或 `REVERSE` 的 channel mode，没有漏标的读条技能。

## Ability Editor tab grouping cleanup (2026-05-06)

**Problem set**:
1. Ability Editor 的批量页已经扩展到多个技能 / 气劲规则，但顶栏还是一个平铺长条，定位成本越来越高。
2. 用户需要把这些规则明确分成两组：`技能` 和 `气劲`，同时统一若干页签文案。

**Fix**:
- 保留原有 leaf `mainTab` 状态和 `?tab=` deep-link，不重写页面路由；在它之上新增了两组派生导航：`技能` 和 `气劲`。
- 顶栏现在只保留 `技能列表`、`BUFF 编辑`、`技能`、`气劲` 四个主入口；进入 `技能` / `气劲` 后，会出现对应的第二行分组页签。
- `技能` 组现在包含：`远程弹道`、`盾立白名单`、`无需武器`、`可以马上施展`、`轻功`、`不受轻功GCD 影响`、`读条不受加速影响`。
- `气劲` 组现在包含：`琴音共鸣`、`减伤被顶`、`主动取消`、`隐藏`。

**Lessons**:
- 这种 UI 重组最稳的方式，是保留现有 leaf tab 作为唯一真实状态，再在渲染层派生分组导航。这样懒加载逻辑、URL 同步、已有本地状态键都不用跟着重写。
- 文案调整最好和分组一起做，否则用户会先看到新的信息架构，再看到旧的标签名，体验上仍然会像“没整理完”。

## GCD bar polish and jue mai cap tuning (2026-05-06)

**Problem set**:
1. 用户希望视觉 GCD 条更薄一些，避免它在读条条下方占太多垂直空间。
2. 服务器延迟下，新的 `visualGcd` 状态偶尔会把条宽度往回拉；当前 CSS 过渡会把这个回退渲染成明显的倒退动画。
3. `绝脉` 的上限需要从 `12` 层下调到 `10` 层。

**Fix**:
- BattleArena 的 GCD track 高度从 `10px` 调整到 `7px`，刚好比原来低 `30%`。
- `GcdVisualBar` 不再依赖 `33ms` 的 `setInterval + width transition`；现在改成 `requestAnimationFrame` 驱动，并用 `transform: scaleX(...)` 渲染 fill，所以运动更连续，视觉上不会再有那种低帧率拖动感。
- 当新的 `visualGcd` 试图在同一种 GCD 轨道上把进度往回拉，而且当前这根条还没接近结束时，前端会继续保留当前显示中的那一根条，不接受这次 backward replacement。这样能直接挡掉延迟包导致的中途回退，而不是只把回退动画改成瞬移。
- `绝脉` 的 source-of-truth 仍然是 `abilities.ts` 里 buff `1337` 的 `maxStacks`；本轮已把它从 `12` 改成 `10`。

**Lessons**:
- 如果条的宽度本身每 `33ms` 才更新一次，再叠一层 CSS `width` 补间，观感上很容易像“卡着在追帧”。这类持续进度条更适合直接用 `requestAnimationFrame + transform`，让浏览器按合成层去画。
- 这种“偶尔收到更低进度”的问题，不一定要先改后端排序。先在最终渲染 seam 拦住 backward replacement，通常就能消掉最刺眼的视觉错误，而且改动最小。
- 对 stack cap 这类数值调整，先确认 runtime 没有第二套硬编码上限，再只改 source-of-truth，能避免 editor / preload / combat 之间出现新漂移。

## GCD runtime/editor/visual bar overhaul (2026-05-06)

**Problem set**:
1. Base GCD was still hardcoded as 45 ticks / 1.5s, and the old light-skill cooldown only targeted four IDs.
2. New rules require three layers: base 1.19s GCD for `gcd:true`, 3s 轻功 GCD for non-exempt light skills, and 后撤's 2s special lock on almost every ability.
3. The Ability Editor needed two new tri-state decider tabs: 轻功判定 and 轻功但不受轻功GCD.
4. The battle UI needed a visual GCD bar below the channel bar that can be overwritten by a later GCD trigger.

**Fix**:
- `playService.ts` now uses named helpers for ability locks, including charge skills and special-bar runtime states. Base GCD is 36 ticks with a 1.19s visual duration; non-exempt 轻功 casts apply a 90-tick 轻功 GCD; 后撤 applies a 60-tick lock to all non-exempt abilities, including non-GCD skills.
- Added `qinggongGcdImmune` ability metadata. 扶摇直上 and 后撤 default to that flag; 聂云/凌霄揽胜/迎风回浪/瑶台枕鹤/扶摇直上 now trigger base GCD through `gcd:true`.
- Ability Editor gained backend routes and frontend tabs for 轻功判定 and 轻功但不受轻功GCD, reusing tri-state override storage and copy-name controls.
- Player state now carries `visualGcd`; GameLoop broadcasts and expires it, and BattleArena renders a 0-to-100 bar under the channel bar with exact two-decimal timing.

**Lessons**:
- Shared cooldown rules should lock abilities through one helper that knows about normal cooldowns and charge locks; otherwise charge abilities silently bypass new GCD layers.
- Treating the visual GCD as backend state is cleaner than trying to infer it from client cooldowns, because 后撤 and 轻功 GCD do not map 1:1 to `globalGcdTicks`.
- “轻功但不受轻功GCD” still needs to count as 轻功 for seal/lock rules, so validation should use a helper instead of reading only `ability.qinggong`.

**Follow-up (later same day)**:
- 后撤的 2 秒特殊调息豁免列表必须显式包含 `houyao` 自己。只豁免“其他技能”会让后撤错误地被自己施放后的特殊锁定反卡住。
- BattleArena 里的视觉 GCD 过滤最稳妥的落点是最终渲染 seam。把 `base/qinggong/houyao` 显示开关持久化到 localStorage，然后在 `<GcdVisualBar />` 前按 `visualGcd.kind` 过滤，比改后端广播或改多处 UI 条件更不容易漂移。
- `轻功判定` 页的共享列表头默认会显示内部 ID 和标签行；如果只想让这个 tab 更干净，给共享 heading 一个可选 metadata 开关，比复制一份独立列表组件更小更稳。
- 如果一个轻功同时触发基础 GCD 和 轻功 GCD，而用户又隐藏了 轻功 GCD，前端不能因为后写入的 `visualGcd` 被隐藏就把基础 GCD 一起丢掉。BattleArena 需要在这种情况下回退到 `globalGcdTicks` 来补显示基础 GCD。
- `轻功但不受轻功GCD` 页真正有噪音的是 `未决定` 列，不必为了它重做整份 snapshot；在共享 decider 组件里给 `未决定` 列加一个“只看轻功”过滤，改动更小，也不会把已有手动覆盖项藏掉。
- 拼音 / 内部 ID 不应该出现在玩家可见 UI 里。这类字段最多保留给内部搜索或数据层，列表展示时只会增加噪音。

## Pull/knockback buff audit (2026-05-06)

**Audit result**:
- `龙战于野·被拉` (`2651`) is still defined on the ability, but the live cast path no longer applies it. `long_zhan_yu_ye` is excluded from generic `applyAbilityBuffs(...)`, and its custom effect now only uses the shared `pullImmediateTargetTowardAnchor(...)` pull helper.
- `守缺式·击退` (`2653`) is still live. `SHOU_QUE_SHI` calls `applyImmediateKnockback(...)` with `knockedBackBuffId: 2653` when the empowered second cast lands.
- `九转击退` (`9201`) is still live. The built-in `KNOCKBACK_DASH` effect handler for `jiu_zhuan_gui_yi` still adds buff `9201` while pushing the target.
- `沧月·击退` (`1341`) is still live. `CANG_YUE_AOE` still applies that named `KNOCKED_BACK` debuff to the secondary knockback targets.
- `龙啸九天·击退` (`1352`) is still live. `LONG_XIAO_JIU_TIAN_AOE` still applies that named `KNOCKED_BACK` debuff during the AOE knockback.

**Lesson**:
- “Using the standard pull/knockback runtime” and “not using an ability-specific displacement buff” are different goals. Some abilities already use the shared activeDash displacement model but still attach named `PULLED` / `KNOCKED_BACK` buffs for status display and control timing.

**Follow-up (later same day)**:
- Standardized the live displacement status layer onto two shared buff IDs instead of per-ability names: pull now uses `9203 / 被拉`, and knockback now uses `9101 / 击退`.
- The shared runtime seam is broader than one handler. `pullImmediateTargetTowardAnchor(...)`, `JILE_YIN_AOE_PULL`, `SHOU_QUE_SHI`, `KNOCKBACK_DASH`, `CANG_YUE_AOE`, and `LONG_XIAO_JIU_TIAN_AOE` all had to converge on the same generic buff builders, and `GameLoop.ts` had to clear `9101` before applying 九转的 `羽化` wall stun.
- Frontend status display depends on preload metadata, not just runtime Buff objects. When a displacement status is standardized to a shared buff ID, `abilityPreload.ts` must expose that shared buff as well, or the status bar silently drops it.
- After the runtime is switched over, remove the retired per-ability displacement Buff definitions from `abilities.ts`. Leaving dead definitions behind makes later audits look like those Buffs are still part of live gameplay when they are not.

**Latest follow-up (same day)**:
- Pull control should not use a standalone `PULLED / 被拉` status at all in the current ruleset. `捉影式` is the correct seam: target movement is carried by `activeDash`, and cast-lock comes from the hidden dash runtime buff with `DISPLACEMENT`, not from a visible pull debuff.
- `极乐引` had drifted from that model because it was still creating a shared `9203 / 被拉` debuff. Fixing it meant removing the shared pull buff metadata and making the instant AOE pull reuse the same dash-runtime lock path as the other pull helper.
- Before deleting a control status type, check the permission mirror. In this repo the safe condition was that every ability explicitly marked `allowWhilePulled` was already also marked `allowWhileDisplaced`, so removing live `PULLED` application did not silently break any allowed-cast cases.

## C panel display settings and GCD audit (2026-05-06)

**Problem set**:
1. 防御力 made normal damage decimal, but the frontend still inferred 会心 from decimal damage values.
2. The C-key 属性 panel needed higher layering, reordered stats, no decimals for 气血值/闪避, scaled 跑速 display, hover breakdowns, and persistent per-stat visibility.
3. Current GCD behavior needed a cross-code audit instead of relying on ability descriptions.

**Fix**:
- BattleArena now treats damage as 会心 only when the event explicitly carries `isCrit: true`; decimal damage no longer implies crit.
- The C-key panel z-index is above the jump-height overlay, uses ordered rows, shows `跑速` as the UI-scale speed while its hover shows real `尺/每秒`, and provides a `详细` checkbox panel persisted in localStorage.
- 会心 and 会心效果 are combined in the main panel and expose 外功/内功 values in the hover tooltip.

**Lessons**:
- Once damage can be modified by percentage stats such as 防御力, display code must never infer crit from non-integer damage.
- Runtime GCD has three different concepts: global `gcd:true`, qinggong shared cooldown, and charge cast locks. They need separate audit rows because they are applied and counted down in different places.

**Follow-up (later same day)**:
- The main C panel should keep a fixed footprint even when rows are hidden. Filtering rows out made the panel shrink, so the safer UI pattern is to keep row slots mounted and hide their contents with layout-preserving CSS.
- Reset transient subpanels when a parent panel is reopened. Leaving `详细` open across C-panel close/reopen felt sticky and mismatched the expected default-open state.
- Native checkbox accent colors are not reliable enough for exact art direction; custom checkbox styling is the stable way to guarantee a white background for both checked and unchecked states.
- Tooltip copy needed a shared formatter. Hardcoding `label:value` strings made spacing and wording drift; routing them through one formatter keeps `label: value` spacing consistent while still allowing special lines like 跑速 and 防御 to override their phrasing.
- `伤害减免` reads better as a whole-number percentage in this compact panel; fixed-point decimals add noise there faster than they add useful precision.

## Defense stat and combat display updates (2026-05-05)

**Problem set**:
1. 防御力 needed to reduce base damage before the existing crit and damage-reduction pipeline.
2. The crit preset buttons needed matching 防御力 presets.
3. 韦陀献杵 should modify 防御力 multiplicatively rather than acting as direct damage taken/DR.
4. Combat floats and the C-key stats panel needed clearer numeric display.

**Fix**:
- Players now carry `defensePct`, and combat math applies final 防御力 to base damage before existing target-side damage taken / DR modifiers and crit resolution.
- Added `DEFENSE_MULTIPLIER` Buff effects so 韦陀献杵易伤 uses `0.9x` defense and 韦陀献杵防御 uses `1.1x` defense.
- The four preset buttons now set crit/defense pairs of `0/0`, `20/12`, `30/16`, and `40/23`.
- Floating damage text uses two fixed decimals, and the C-key stats panel now shows 最大气血值, 防御力, 闪避, 移动速度, and DR in addition to crit stats.

**Lessons**:
- Base stats like 防御力 should be resolved before higher-level damage modifiers, while Buff changes to that stat should multiply the original stat instead of being treated as additive DR.

## In-game ability and buff hover panels (2026-05-05)

**Problem set**:
1. Native ability button `title` text could not show the full structured tooltip the user wanted, and disabled/cooldown buttons were not reliably hoverable.
2. Ability hover needed display fields from current runtime/editor metadata: name, effective range, weapon requirement from `noWeaponRequired`, full description, cast type, and cooldown seconds.
3. Buff hover needed live remaining time and top-right attribute display, but preload did not expose Buff attribute metadata to the in-game StatusBar.

**Fix**:
- BattleArena now renders a fixed-position custom ability hover panel from `AbilityInfo`, and ability buttons stay hoverable even when not ready while click handlers still block invalid casts.
- Ability tooltip data includes effective range with Buff range bonuses, base range delta formatting, `需要武器：否` when `noWeaponRequired` is true, full description text, instant/channel cast label, and cooldown seconds.
- Buff preload now includes non-empty Buff attributes, and StatusBar passes the hovered Buff through to the hint so remaining time updates live while hovering.

**Follow-up fixes**:
- Target-side Buff hover/cancel was blocked because `.enemyBossGroup` used `pointer-events: none` and the selected target Buff row did not opt back into pointer events. The Buff row now uses `pointerEvents: "auto"`.
- Owned friendly test dummy Buffs now support normal left-click cancellation in addition to right-click, while normal player Buff cancellation remains restricted to the manual-cancel path.
- Ability tooltip styling was reduced substantially, channel labels now show only the time such as `0.5秒`, weapon text is `武器：是/否`, and Buff tooltip remaining time uses whole Chinese seconds such as `12秒`.

**Lessons**:
- In-game tooltips should not rely on native `title`; they cannot show structured multi-column data and are unreliable on disabled buttons.
- UI-only display metadata such as Buff attribute still belongs in preload when the battle UI needs it for live runtime entities.
- When a parent overlay uses `pointer-events: none`, every interactive child region must explicitly opt back in; otherwise React hover/click handlers on nested components will never fire.

## Editor session state, dummy buff cancel, and movement audits (2026-05-05)

**Problem set**:
1. Ability Editor filters should remember choices only while the current page stays loaded, then reset on refresh.
2. Owned friendly test dummy buffs still could not be canceled because the normal player cancel path only allows beneficial Buffs marked `manualCancelable`.
3. `踏星行` snap-up looked instant locally but interpolated upward for the opponent.
4. `任驰骋` should be blocked only during the actual `凌然天风` special-jump activeDash, not for the full Buff duration; entering `御骑` should remove `凌然天风`.
5. Projectile and DunLi whitelist editor pages need true three-column decision state, including explicit manual exclusion, to match `琴音共鸣`.

**Fix**:
- `usePersistentState(...)` now stores editor filter/tab state in a module-level page-session map instead of browser storage, so navigation within the loaded page keeps filters but refresh clears them.
- Owned `test_dummy_ally` status bars use a testing-only cancel path: frontend passes `entityTargetId`, backend verifies ownership/kind, then `cancelAnyBuffForTesting(...)` removes the selected status and emits normal `BUFF_EXPIRED` cleanup events.
- `DirectionalDash.ts` applies `snapUpUnits` immediately at cast setup before the next broadcast, and `Character.tsx` hard-snaps large vertical opponent deltas instead of lerping them.
- `任驰骋` validation now checks `activeDash.abilityId === "ling_ran_tian_feng"` with remaining ticks; `御骑` application expires Buff `2654` if present.
- Projectile/DunLi override state now supports explicit `true`, explicit `false`, and clear. The UI can show Included / Undecided / Excluded without conflating base resolved state with manual decisions.

**Audits**:
- Knockback and pull movement paths are still using `activeDash` for real forced movement. The visible `KNOCKED_BACK` / `PULLED` Buffs act as status/control/display markers, not as the movement carrier.
- Full unused-Buff audit found one stale override-only Buff entry: `2736 舍身诀·减伤`, which was intentionally merged into `2737 舍身诀`; preload-only entries are runtime/preload metadata and not delete candidates by that fact alone.

**Lessons**:
- Test dummies need narrowly scoped testing semantics on the backend; reusing normal player rules can make editor/debug targets impossible to manipulate.
- Server-side instant position changes still need frontend interpolation rules reviewed, because a correct authoritative state can still look wrong if the renderer smooths a blink.
- Tri-state editor pages need backend storage that preserves explicit `false`; treating `false` as empty collapses “manual no” into “undecided”.

## Buff links, display metadata, and support-target cleanup (2026-05-05)

**Problem set**:
1. Several linked or companion buffs could be manually canceled, dispelled, or naturally removed without their paired runtime state disappearing.
2. `韦陀献杵·防御` had a real icon file, but preload built the icon path before applying the editor override name, so it looked for the old no-dot filename.
3. Display-only or compound mobility buffs (`踏星行`, `烟雨行`) need preload metadata and must not be hidden just because one of their effects is `DASH_TURN_OVERRIDE`.
4. The Buff Editor needs a true “no icon” filter; checking whether `iconPath` is present is insufficient because preload gives every buff a default path.

**Fix**:
- `pushBuffExpired(...)` is now the central linked-removal seam for `浮光掠影 -> 遁影`, `舍身诀/舍身诀·承伤`, `渊/渊·承伤`, and `绿野蔓生` zone cleanup. Manual cancel, dispel, natural expiry, and redirect-consume paths pass source metadata through where needed.
- `浮光掠影` movement/common-skill grace now depends on `遁影` still being present; canceling `遁影` no longer leaves the first-5-second movement grace active.
- `abilityPreload.ts` applies buff editor `name` overrides before default icon path generation, and only hides pure one-effect `DASH_TURN_OVERRIDE` marker buffs. Compound buffs with real gameplay/display effects remain visible.
- `buffTagSystem.ts` checks `frontend/public/icons` for the resolved icon file and exposes `iconMissing`, letting `BuffEditorTab.tsx` filter real no-icon buffs.
- Friendly test dummy buff cancellation reuses the existing manual-cancel route with an optional `entityTargetId`, constrained to `test_dummy_ally` entities owned by the requesting user.

**Lessons**:
- Linked buff semantics belong as close as possible to buff removal, not inside individual UI or dispel handlers. Otherwise manual cancel, dispel, damage consume, and natural expiry drift.
- For editor-derived display names, icon resolution must happen after overrides are applied. Otherwise assets can exist and still miss due to stale canonical names.
- “No icon” is a filesystem fact, not a data-shape fact, because the preload layer intentionally creates fallback-looking default paths for every buff.

## 减伤被顶 runtime + editor (2026-05-05)

**Problem set**:
1. 减伤 Buff 以前只会全部共存并按乘法叠加，无法表达“高减伤顶掉低减伤”的规则。
2. 用户需要一个类似 `琴音共鸣` 的批量页面，逐个决定减伤 Buff 是“可以被顶”还是“不可被顶”。
3. `不可被顶` 减伤必须与更高减伤或其他 `不可被顶` 共存，并按加法进入最终减伤总量，例如 `50% + 80% = 130%`。
4. 当最终减伤达到 `100%` 时，实际不能掉血，但战斗飘字要显示 `-0.1`。

**Fix**:
- `buffRuntime.ts` 在 `addBuff()` 的统一入口加入了“减伤被顶”规则。新的可被顶减伤会被已有更高或相等减伤挡掉；更高的新减伤会立刻移除较低的“可以被顶”减伤；`不可被顶` 永远不会被这条规则移除。
- 减伤比较按 `damageType` 覆盖关系处理：不带伤害类型的减伤视为全局覆盖，带类型的减伤只覆盖相同类型。
- `combatMath.ts` 把目标侧 `DAMAGE_REDUCTION` 从乘法叠加改成加法汇总，再用 `max(0, 1 - totalReduction)` 结算；同一轮也把 `fullyReducedByDamageReduction` 标记带回伤害 roll。
- `Damage.ts` 在即时伤害被 `100%+` 减伤完全抵消时，不调用扣血，只发一个 `value: 0.1` 且 `suppressCritLabel: true` 的 `DAMAGE` 事件，让 BattleArena 显示 `-0.1` 而不会误判为会心。
- 新增 `damageReductionOverride.ts`、后端路由 `/ability-editor/damage-reduction-override`、前端 `DamageReductionOverrideTab.tsx`，并接入 Ability Editor 主页面的“减伤被顶”tab。页面写回现有 `buff-attribute-overrides.json` 的 `properties[].noOverride`，因此 Buff 详情页和批量页共用同一份配置。
- 顺手补了 `StoredBuffEditorOverrideEntry.properties` 类型与 `buffTagSystem.ts` 对 `qinYinGongMingUnstealable` 的保留，避免新增批量页保存时意外丢掉既有配置字段。

**Lessons**:
- 减伤被顶必须落在 `addBuff()`，因为项目规则要求所有 Buff 都通过这里进入运行时；如果在伤害结算时才临时挑选最高减伤，低减伤 Buff 仍会错误留在状态栏。
- “不可被顶”已经存在于 Buff 属性覆盖模型中，新增批量页时应复用这条字段，而不是另开一个配置文件。
- `-0.1` 飘字最好作为显示事件处理，不应该把 `resolveScheduledDamage()` 直接返回 `0.1`，否则其他直接扣血分支可能真的扣掉这 `0.1` HP。

**Follow-up (later same day)**:
- 用户随后要求 `100%+` 减伤飘字从 `-0.1` 改成白色 `-0`，且所有受伤路径都要统一。最终做法是继续保持真实伤害为 `0`，在 `GameEvent` 上加 `displayZeroDamage`，由 `Damage.ts`、`GameLoop.ts`、`immediateEffects.ts` 的伤害分支发出零伤害展示事件，再由 `BattleArena.tsx` 以白字 `-0` 展示。
- `风来吴山` 的不工 Buff 需要免疫击退但不免疫拉拽，因此使用已有窄语义 `KNOCKED_BACK_IMMUNE`，不能改成完整的 `KNOCKBACK_IMMUNE`。

**手动点掉 Buff + decider pages follow-up (later same day)**:
- 新增 `manualCancelableBuffs.ts` 与 `/ability-editor/manual-cancelable-buffs`，把“可以主动取消 / 不可主动取消 / 未决定”写入现有 `buff-attribute-overrides.json`，避免再造一份配置。
- 运行时取消入口是 `cancelManualBuff(...)`：只允许 `BUFF` 且必须被标记为 `manualCancelable`；移除时会清 linked shield、删 active buff，并发 `BUFF_EXPIRED`，这样表现与过期/驱散保持一致。
- 前端只在本方 StatusBar 的可见 Buff 图标上响应右键，且只在 preload metadata 标记 `manualCancelable` 时发送 `/api/game/buff/cancel`。
- 新增隐藏 Buff 批量页 `/ability-editor/hidden-buffs`，复用现有 `hidden` override 字段；同时把远程弹道技能、盾立白名单、无需武器、可以马上施展、琴音共鸣、减伤被顶以及新增两个 Buff decider 页统一成更接近三列判定样式，并给列表名旁补复制按钮。
- `无相诀·五十/六十/七十/八十/九十` 的图标不是缺文件，而是 preload override 指向不存在的 `/icons/无相.png`。实际文件存在于 `frontend/public/icons/无相诀·*.png`，已改成逐档精确路径。

## 渊落点修正 + 雾暗迷云混乱重定向 (2026-05-03)

**Problem set**:
1. `渊` 友方 dash 之前会直接落到目标身上，没有保持和 `龙牙` 一样的 `1尺` 停距。
2. 需要新增 `雾暗迷云`：站立运功 `1.5s` 后给目标 `【迷云】`，目标在 `迷云` 期间释放技能时会重新随机目标且不分敌我；`迷云` 消失后还要获得 `20s` 的 `【雾释】` 免疫。
3. 这次的“混乱”不能只修单体技能。用户明确要求多段/多目标 AOE 也要按“原本会命中的每一个敌方命中槽位，分别独立重掷一次合法目标”处理，例如 `风来吴山` 每一跳都应独立 `50/50`。
4. 旧代码的目标判定散在 `validateAction.ts`、`playService.ts`、`immediateEffects.ts`、`GameLoop.ts` 多个层面；如果在其中一层硬写特殊分支，很容易让单体、延时、channel tick、zone tick 表现不一致。

**Fix**:
- `渊` 的友方 dash 现在复用了和 `龙牙` 同样的停距计算：先算 `1尺` stop distance，再按缩短后的 travel distance 设置 dash 速度，因此落点稳定停在目标前 `1尺`，而不是重叠。
- 新增 `backend/game/engine/utils/miyun.ts` 作为共享混乱辅助层，集中放 `迷云/雾释` Buff 常量、混乱/免疫判定，以及“按原命中槽位数量重新随机候选目标”的 area reroll helper。
- `validateCastAbility(...)` 现在会在施法者带 `迷云` 时递归复用自己去枚举合法候选目标，再随机选出一个 resolved target 返回给 `playService.ts`。这样现有射程、最小距离、朝向、LOS、特殊技能约束都会自动复用，而不是重写第二套验证逻辑。
- `playService.ts -> applyEffects(...) -> applyAbilityBuffs(...)` 整条链路新增了 `ignoreTargetAllegiance / forceEnemyApplied` 上下文，所以“原本是敌方技能但被混乱改打到友方”或“原本是友方技能但被混乱改打到敌方”时，伤害/控制/增益仍保持原技能的敌我语义，而不是被目标阵营反向篡改。
- `immediateEffects.ts` 的显式玩家/实体目标 helper 已放宽到支持混乱后的 player/entity 目标；即时 AOE、扇形 AOE、多段即时伤害现在都会按“先算原本会打中的敌方槽位数，再对每个槽位独立 reroll 候选目标”处理。
- `GameLoop.ts` 中的 dash-end AOE、channel tick、periodic AOE、地面 zone 爆炸/持续伤害也切到了同一套 reroll 语义；其中 `CHANNEL_AOE_TICK` 额外保留了原本的 LOS 检查，只在 LOS 合法候选集内随机，避免把混乱目标选到被墙挡住的位置。
- `雾暗迷云` / `迷云` / `雾释` 已写入 `abilities.ts` 和 `cards.ts`。当前落地参数是：技能射程 `20`、冷却 `300 ticks`、`迷云 8s`、`雾释 20s`。这是因为用户只明确给了 channel 时长和 `雾释` 时长，其余数值本轮先按现有技能常用档位补齐。
- `buffRuntime.ts` 现在会阻止带 `雾释` 的目标再次吃到 `迷云`，并在 `迷云` 自然结束或被提前移除时统一补上 `雾释`。`GameLoop.ts` 也顺手补了 channel-complete buff 对 entity target 的支持，避免这类读条完成型 debuff 只对 player 生效。

**Lessons**:
- 对“混乱改目标”这类需求，最稳的 seam 不是某个具体技能 handler，而是验证层返回“resolved target”。先在验证层把合法候选集合算准，后面的施法/即时效果/读条完成逻辑只消费 resolved target，就不会在每个技能里散落重复判断。
- 多目标混乱不能直接把初始目标列表改成“全场所有单位”。正确语义是先保留原本会命中的敌方槽位数，再让每个槽位独立 reroll；否则像 `风来吴山` 这种多跳技能会连总命中次数都一起漂移。
- 这轮 PM2 重启后的 backend/frontend 都成功上线了最新 build，但日志里仍能看到旧的 `backend-error.log` `GameLoop not active` 噪音，以及 frontend 旧的 `.next/prerender-manifest.json` `ENOENT` 记录。它们不是这次改动引入的新启动失败，后续排查日志时要和本轮功能回归分开看。

**Follow-up fixes (later same day)**:
- 单体 `迷云` 重定向第一次上线后，递归候选枚举虽然已经用 `ignoreTargetAllegiance: true` 放宽了敌我限制，但外层最终 `validateCastAbility(...)` 仍按原始敌方规则再次校验，导致“随机到友方后又被 `ERR_TARGET_UNAVAILABLE` 否掉”。修复方式不是再跳过一整段验证，而是把 `miYunRetarget !== null` 也视作最终外层校验的 allegiance-bypass 条件，仅绕过敌我归属判定，继续保留射程/最小距离/LOS/朝向等其他规则。
- `迷云 -> 雾释` 没有生效的根因不是 `pushBuffExpired(...)` 内的加 Buff 逻辑，而是 `GameLoop.ts` 的主自然过期 sweep 只删除了过期 Buff，却没有为这些自然过期 Buff 调 `pushBuffExpired(...)`。现在 player/entity 两条自然过期路径都会统一发出 `BUFF_EXPIRED`，因此 `迷云` 自然结束或实体上的 `迷云` 自然结束时，都能走到同一条 `雾释` 补发逻辑。
- 这次还顺手把 `buffsChanged` 判定补成了“只要有自然过期就算变化”，避免“一个 Buff 自然结束、同时立刻补上另一个 Buff，导致总 Buff 数量刚好不变”时，状态变更没有被及时广播。

**Latest follow-up (same day)**:
- 用户随后明确要求 `雾释` 不是增益而是减益，因此已把 `雾释` 在 `abilities.ts` 和 `cards.ts` 中的 `category` 从 `BUFF` 改为 `DEBUFF`。它的免疫效果类型仍保持 `MIYUN_IMMUNE`，只改状态栏/展示侧的类别语义。
- 还对当前 preload Buff 表做了一次全量图标审计，按真实运行时 `buff.iconPath` 与 `frontend/public/icons` 比对后，发现仍缺 `32` 个 Buff 图标或图标映射：`散流霞隐藏`、`穹隆化生·转向`、`踏星行·转向`、`摩诃无量·眩晕`、`生太极·迟滞`、`被击不会解除五方锁足`、`沧月·击退`、`亢龙有悔·定身`、`龙啸九天·定身`、`龙啸九天·击退`、`韦陀献杵·易伤`、`韦陀献杵·防御`、`鹤归孤山·震慑`、`穿心弩·减疗`、`三才化生·前半保护`、`如意法·待发`、`龙战于野·被拉`、`守缺式·击退`、`无相诀·五十/六十/七十/八十/九十`、`破势`、`九转击退`、`被拉`、`锁足抗性`、`眩晕抗性`、`锁招抗性`、`定身抗性`。其中 `无相诀` 五档不是单纯缺文件，而是当前 preload override 仍指向不存在的 `/icons/无相.png`，而仓库里实际存在的是 `无相诀.png` 与各档 `无相诀·*.png`。

## 凌然天风特殊跳跃实现 (2026-05-03)

**Problem set**:
1. 新轻功 `凌然天风` 需要可移动中/空中施放，施放时上跳 `9尺/1秒`，并附带 `7秒` 特殊跳跃 Buff。
2. Buff 期间要禁用普通跳跃，但保留地面正常移动；特殊跳跃次数是独立 `0/1` 资源，不受 `扶摇直上 / 梯云纵 / 鸟翔碧空` 这类跳跃强化影响。
3. 特殊跳跃本身需要两种形态：纯空格 `4尺` 竖直跳，`W/A/S/D + 空格` 则在 `1秒` 内走完整个 `4尺上升 + 8尺定向位移` 弧线。
4. Buff 本身只免疫普通控制，不免疫拉拽/击退；并且 Buff 期间任意成功施放招式都要把特殊跳跃次数回满到 `1`。
5. 这次是 movement 改动，BattleArena 不能继续本地预测成普通跳，否则客户端会在 Buff 期间错误地显示常规起跳。

**Fix**:
- 新增 `LING_RAN_TIAN_FENG_CAST` 与 `LING_RAN_TIAN_FENG_STATE` 两个 effect 类型；能力定义里用前者做施放上跳，用后者做 Buff 状态标记。
- `abilities.ts` 中新增 `ling_ran_tian_feng`：`300 ticks` CD、`qinggong: true`、`7s` Buff，Buff 效果为 `CONTROL_IMMUNE`、`RANGE_BOOST +5` 和 `LING_RAN_TIAN_FENG_STATE`。
- `applyImmediateEffects(...)` 在成功施放结算时统一处理特殊跳跃充能：如果施法者当前有 `凌然天风` Buff，或当前施放的就是 `凌然天风`，则把 `lingRanTianFengCharges` 设为 `1`。这样“施放任意招式回满一次跳跃”落在共享施法成功 seam，而不是散落到每个技能里。
- `凌然天风` 施放本体复用了现有 `activeDash` 竖直位移路径：不加共享 dash runtime buff，只创建 `1秒` 纯竖直 activeDash，因此控制免疫完全来自 `凌然天风` Buff 本身。
- `movement.ts` 在普通跳跃入口前先检查 `LING_RAN_TIAN_FENG_STATE`。Buff 期间：
  - 有充能时，空格改为启动一个 `1秒` 的弧线 activeDash（固定 `4尺` 峰值，定向时再带 `8尺` 水平位移），并消耗充能到 `0`。
  - 没充能时，空格直接失效，不会落回普通跳跃逻辑。
- 由于特殊跳跃走的是 activeDash，而不是原本 jump/air-nudge 分支，所以不会吃到 `JUMP_BOOST`、`TI_YUN_ZONG_JUMP`、`MULTI_JUMP`、`JUMP_NERF` 这些普通跳分支里的高度/距离改写。
- BattleArena 侧没有再去本地伪造第二套特殊跳轨迹，只做了必要的 prediction 对齐：Buff 生效时本地空格不再进入普通 jumpLocal 预测，而是只发送 jump 输入并等待服务端的 activeDash 状态接管，这样不会在 Buff 期间错误显示普通跳。

**Lessons**:
- 当一个“特殊跳”既要固定轨迹、又要允许中途施法、还要完全绕开普通跳跃增益时，直接复用 `activeDash` 比往普通 jump 分支里塞更多例外更稳。
- 对这类 Buff 驱动的独立位移资源，最稳的“回充”位置是共享施法成功 seam；如果把回充逻辑分别写进单个技能 handler，后续一定会漏掉自定义 effect 或空 effect 技能。
- 前端 prediction 不一定非要完整本地复刻轨迹。只要客户端别在 Buff 期间错误走进旧的普通跳预测，而服务端又能很快下发 `activeDash`，就已经比“错误预测成普通跳”更可靠。

**Follow-up retune (later same day)**:
- `凌然天风` 本体现在 `gcd: false`，不会再占用公共调息。
- 初始施放上跳进一步改成 `12尺/0.5秒`，并同步了能力说明与 cast handler 的默认值。
- 特殊跳再改为“`1秒` 到达 `4尺上升 + 8.7尺定向位移` 的终点后，再交回普通下落”。实现上仍然不让这段 activeDash 在持续时间内自己落回地面，而是让它在结束时正好到达 apex，然后由正常重力继续下落。

**Extra lesson from retune**:
- 如果设计要求的是“在指定位移时间点到达顶点，然后再自然下落”，dash 内的竖直速度不能按完整抛物线总时长去算；应当按“结束时速度归零、位置到顶点”来反推离散重力和初速度，否则会错误地在 dash 持续时间内把下落也一起算进去。

**Latest follow-up retune (same day)**:
- 初始施放上跳再次下调为 `9尺/0.5秒`。
- 特殊跳拆成了两条运行时分支：纯空格上跳现在是 `8尺/0.5秒`；带方向的特殊跳仍保持“`1秒` 到达 `4尺上升 + 8.7尺定向位移` 终点后再自然下落”。
- 如果玩家在 `凌然天风` 初始上跳过程中进入 `九霄风雷` 的初始 `3秒` 运功，竖直 activeDash 现在会被刻意维持到运功结束，再立刻结束这段上升，复现旧 bug 的趣味交互。最终实现没有继续依赖“原始 activeDash 一定还在”，而是在 `九霄风雷` 开始运功时把这段上升记录到 `PlayerState` 上；这样即使中途有别的路径清掉了 dash，`movement.ts` 也会在运功期间把竖直上升补回去。
- `凌然天风` Buff 期间新增“跳跃锁定免疫”：通用 channel jump suppression、`风来吴山` / `斩无常` 的旧硬锁、`九霄风雷` 的 `NO_JUMP`，以及 `channelLockMovement` 对 jump 脉冲的清零，都不会再拦住这次跳跃；BattleArena 的本地发包门槛也同步放开。
- 如果同时持有 `凌然天风` 与 `风来吴山 / 斩无常` Buff，使用一次 `凌然天风` 特殊跳后会立刻把特殊跳次数回满到 `1`。BattleArena 也同步改成在这两个 Buff 下不把本地特殊跳次数预扣到 `0`，避免客户端短时间误判“没次数”。

**Disproved approach from latest retune**:
- 先前直接把 `凌然天风` 特殊跳的共享常量整体改成 `8尺/0.5秒` 会连带把定向特殊跳也一起改快，和用户“只改 special upward jump”的要求不符。最终必须按“有无方向输入”拆成两套高度/时长参数。
- 单纯在 `movement.ts` 里冻结原始 `凌然天风` cast-lift dash 的 `ticksRemaining` 还不够稳，因为一旦别的控制路径提前清掉了那段 dash，`九霄风雷` 期间就会重新表现成“正常停止上升”。要复现这个旧 bug，必须把“当前正在延续的上升速度”单独记到玩家状态上，而不是只依赖原始 dash 对象仍然存在。

## 御骑 mounted runtime (2026-05-03)

**Problem set**:
1. `御骑` 之前只是一个占位 common skill，没有真正的“上马 / 下马”运行时状态，也没有任何 mounted 限制。
2. 需求是双态技能：未上马时必须站立运功 `3s`，移动或跳跃会打断；已上马时再次施放应立刻下马，而不是再走一次读条。
3. 上马后要同时满足三条运行时规则：移动速度 `+100%`、只能施放带“可以马上施展”标记的招式、每次腾空最多只保留 `1` 次跳跃。
4. `御骑` 获得时要立刻移除 `弹跳(JUMP_BOOST)`；受到除 `ROOT/SLOW` 以外的控制时，要立即失去 `御骑`。
5. 这是 movement / cast-rule 变更，BattleArena 也必须同步 mounted 灰置与跳跃上限，否则前端会继续把非法招式点亮，或者本地多给一次跳跃。

**Fix**:
- 把 `yuqi` 从占位 instant skill 改成了真实 pure channel：未上马时 `requiresStanding + channelDurationMs: 3000 + channelCancelOnMove/jump`，运功完成后通过 `applyBuffsOnComplete` 获得长期 `【御骑】` Buff。
- `playService.ts` 为 `yuqi` 增加了 mounted toggle-off 分支：如果玩家当前已有 `御骑` Buff，再次施放不会重新开读条，而是直接移除 `御骑`（并为后续 linked buffs 预留统一清理路径）。
- 新增共享 mounted helper 后，`validateAction.ts` 会在服务端统一拦截“上马状态下但没有 `canCastWhileMounted` 标记”的招式；`yuqi` 自己则特判为 mounted 下仍可施放，并忽略 `requiresStanding` 这条进入态约束。
- `buffRuntime.ts` 把 mounted 相关副作用收口到了 Buff seam：`御骑` Buff 成功加上后会清掉所有 `JUMP_BOOST` Buff；如果之后吃到 `CONTROL / ATTACK_LOCK / KNOCKED_BACK / PULLED / SILENCE / DISARM / NON_QINGGONG_LOCK / FEARED` 这类实际生效的控制，则会立刻把 `御骑` 状态移除。
- `movement.ts` 与 `BattleArena.tsx` 都改成“若当前有 `御骑`，有效最大跳跃数恒为 `1`”；客户端 readiness 也新增了 mounted 灰置规则，只保留 `canCastWhileMounted` 招式亮起，并允许 `御骑` 自己在空中立即下马。

**Lessons**:
- 这种“进入态是读条、退出态是瞬发”的技能不要硬塞进单一 channel 行为里；让 channel 只负责进入态，再在 cast service 里为退出态做一个极小 special-case，整体比拧 channel pipeline 更稳。
- `御骑` 的限制不是单一 movement 规则，而是 cast validation、buff apply/remove、副作用清理、前端按钮灰置、跳跃上限的组合。只补其中一层，玩家立刻就会看到“按钮能点但服务器报错”或“本地还能二段跳”这类明显不同步。

## 御骑高度 / 跳跃限制 follow-up (2026-05-03)

**Problem set**:
1. 新需求要求 `御骑` 进入时角色立刻抬高 `3尺`，因为没有马匹模型，视觉上就让角色悬空代替坐骑高度。
2. 如果只在上马瞬间做一次 `z += 3尺`，下一帧重力就会把角色重新拉回地面，看不到持续的“骑在马上”。
3. 上马时如果角色身上还有 `女娲补天`，需要立刻移除；`任驰骋` 则不应再允许在已上马状态下施放。
4. 骑乘期间要禁用原地跳和后跳，只保留前/左/右方向跳跃；这次也是 movement 变更，BattleArena 不能继续预测成普通原地跳。
5. `下马` 仍要允许在移动中或空中施放，不能被前端那层旧的 `requiresStanding` 提前挡掉。

**Fix**:
- `movement.ts` / `BattleArena.tsx` 都新增了“mounted ground height”概念：只要当前有 `御骑`，有效地面高度就等于真实地面 `+3尺`。这样角色会稳定站在悬空高度上，而不会被下一帧重力直接拉回去。
- `buffRuntime.ts` 在 `YUQI_BUFF_ID` 成功加上时会立刻把玩家高度再抬高一次，保证上马当帧就能看到抬升，而不是等下一个 movement tick 才浮起来。
- 同一个 `addBuff()` seam 里顺手移除了 `女娲补天`（buff `1019`），这样 `御骑` 无论来自原始 `御骑` 还是 `任驰骋`，都会统一清掉该状态。
- `任驰骋` 去掉了 `canCastWhileMounted`，因此它现在只能在未上马时读条进入，不能在已经 `御骑` 的状态下重放。
- 普通跳跃分支新增了 mounted jump gate：骑乘时必须存在方向输入，且方向不能是 rearward；BattleArena 本地发跳和本地 jump prediction 也同步改成拒绝 `空格原地跳` 与 `S` 系后跳。
- BattleArena 之前还有一层更早的客户端施法门槛，会在点按钮时直接按 `requiresStanding` 拦掉 `御骑`。这次给 mounted `yuqi` toggle-off 加了同样的例外，所以移动中/空中都能正常下马。

**Lessons**:
- “坐骑高度”这类长期悬空状态不能靠一次性位置抬升实现；真正稳定的做法是把它建模成一层持续存在的有效地面偏移。
- 如果某个技能已经在 `isAbilityReady(...)` 里有特判，不代表前端别的 cast wrapper 也同步了。同一个 `requiresStanding` 规则很可能在多个按钮入口重复实现，必须一起排查。

**Latest retune (same day)**:
- 用户随后又明确要求取消这层“骑在马上”的悬空视觉，所以之前那套 `mounted ground height + addBuff 立即抬升 + BattleArena 同步地面偏移` 已被整段移除；`御骑` 现在重新回到普通地面高度。
- `御骑` 的移动速度也从原先的 `+100%` 改成了 `SLOW 0.5`，最终速度等于普通角色按 `S` 后退步行的速度；前后端原有的 `1 + SPEED_BOOST - SLOW` 速度计算公式因此无需额外特判。

**Extra lesson from retune**:
- 一旦这种“手感型”需求被撤回，最好把整条实现链一次删干净，而不是只改掉其中一层。否则很容易留下 buff 抬高、服务端地面判定、客户端 prediction 三者里某一层的残余偏移。

## 可以马上施展 editor property (2026-05-03)

**Problem set**:
1. `御骑` 已经有了新的 mounted cast 规则，但还缺一个可编辑的能力属性，来决定“哪些技能在御骑期间仍可施放”。
2. 这个属性不能只做成独立列表页，否则技能详情页会看不到它；用户明确要求“能力列表详情页”与单独 tab 都能操作。
3. 如果把这条规则单独塞到另一个 override 存储里，运行时、详情页、列表 tab 会很快漂移。

**Fix**:
- 把“可以马上施展”直接加入 `AbilityPropertyId` 与 canonical `abilityPropertyDefinitions`，底层字段是 `ability.canCastWhileMounted`。这样详情页会自动通过现有 property catalog 渲染出来，不需要再单独改 `[abilityId]/page.tsx`。
- `abilities.ts` 里新增了 `buildCanCastWhileMountedSnapshot()` / `setAbilityCanCastWhileMountedOverride()`，但 override 仍然写回同一个 `ability-property-overrides.json` 的 `properties` 字段，而不是新开第二份配置。
- `abilityEditor.routes.ts` 增加了 `/ability-editor/can-cast-while-mounted` 的 GET/PUT 路由；前端新增 `CanCastWhileMountedTab.tsx`，UI 复用 `NoWeaponRequiredTab` 的三列决策模式：手动排除 / 未决定 / 可以马上施展。
- `Ability Editor` 主页新增了“可以马上施展” tab，并复用现有的 lazy-load + updatedAt 刷新模式，所以列表 tab 和详情页操作会看到同一份最新结果。

**Lessons**:
- 这类“既要出现在详情页，又要有单独批量操作 tab”的布尔能力属性，最稳的做法是先进入 canonical property catalog，再额外做一个 snapshot/tab 视图；反过来只做专门 tab，详情页和运行时迟早分叉。
- 如果列表 tab 本质上只是同一个 property 的批量视图，就不要再造第二套存储模型。继续写回原来的 `properties` override，后续 preload/runtime 已经能自然吃到这条规则。

## 任驰骋 + 纵轻骑 mounted follow-up (2026-05-03)

**Problem set**:
1. 需要新增 `任驰骋`：`0.5s` 运功、可移动、跳跃会打断，完成后同时获得 `御骑`、`任驰骋` 和 `纵轻骑` 三个 Buff。
2. `任驰骋` Buff 要持续 `12s` 并给 `15%` 伤害提升；`纵轻骑` 要持续 `5s`，提供“控制免疫但仍会被拉”的 mounted 爆发窗口。
3. `纵轻骑` 的“仍会被拉”不能复用现有 `KNOCKBACK_IMMUNE`，因为那个效果会把 `击退` 和 `拉拽` 一起挡掉。
4. 用户还要求“离开御骑时一定移除 `纵轻骑`，但不能误删 `任驰骋`”。这意味着不能只在手动下马分支里清理一次。

**Fix**:
- 在 `abilities.ts` / `cards.ts` 中新增 `ren_chi_cheng`：`CHANNEL` 自身技能，`0.5s` 运功，`channelCancelOnMove: false`、`channelCancelOnJump: true`，结算后一次性应用 Buff `2741/2742/2743`。
- `任驰骋` Buff (`2742`) 使用 `DAMAGE_MULTIPLIER 1.15`，不是 `0.15`。这个引擎里乘区字段存的是最终倍率，不是增量。
- 为了实现“免击退但不免拉”，新增了狭义效果类型 `KNOCKED_BACK_IMMUNE`，并把纯击退路径（立即击退、慢速击退、连环弩近身击退等）切到新的 guard；拉拽/换位等仍继续只认完整的 `KNOCKBACK_IMMUNE`。
- `buffRuntime.ts` 也同步改成分别过滤 `KNOCKED_BACK` 和 `PULLED`，避免 `纵轻骑` 被当成完整免拉。
- `GameLoop.ts` 新增 mounted invariant：只要玩家当前已经没有 `御骑`，就会主动清掉残留的 `纵轻骑` 并发 `BUFF_EXPIRED`。这样无论是手动下马、吃控制掉马，还是其他路径让 `御骑` 消失，都不会留下悬空的 `纵轻骑`。

**Lessons**:
- 当设计写的是“免击退但仍会被拉”，不要在现有效果上硬加特判；加一个语义更窄的 immunity type，然后只替换真正的击退 call-site，成本更低，也不容易误伤拉拽逻辑。
- 对“依附于另一状态存在”的 Buff，最稳的做法不是只信任几个显式移除入口，而是在主循环里补一条廉价 invariant。这样后续出现新的移除路径时，子 Buff 也不会残留。

**Latest retune (same day)**:
- 后续实测发现 `channelDurationMs: 500` 本身不会让技能自动进入运功；当前引擎只有 `ability.type === "CHANNEL"` 才会在 `playService.ts` 里创建 `activeChannel`。因此 `任驰骋` 必须从 `SUPPORT` 改成真正的 `CHANNEL`，前端运功条才会出现，技能也才不会继续表现成瞬发。

## 御骑后退限速 + 渊显示 Buff + 舍身诀命名 follow-up (2026-05-03)

**Problem set**:
1. 把 `御骑` 直接改成 `SLOW 0.5` 虽然能让后退速度变慢，但会把骑乘下的所有方向一起限速，和用户“只限制纯 `S` 后退”的手感要求不符。
2. `渊` 的落地击退仍在使用它自己的专用 Buff `2740`，而不是共享的标准 `9101 / 击退` 标记。
3. `渊` 只有友方侧的拦伤 Buff，没有给施法者一个可见的“我正在替队友承伤”的状态提示，触发后也不会和友方 Buff 一起清掉。
4. 这轮还新增了一个工作流约束：如果图标不存在，不要擅自创建图标文件，应该按用户给的命名去对齐代码并回报缺失文件名。
5. `舍身诀` 的 Buff 名称需要和现有图标文件名对齐，否则 preload 默认路径会继续指向不存在或不匹配的文件名。

**Fix**:
- `御骑` Buff 恢复为 `SPEED_BOOST 1`；服务端 `MovementInput` 新增 `backpedalOnly` 标记，只有传统模式纯 `S` 后退时才额外乘 `0.5`。`BattleArena.tsx` 的发包与本地 prediction 也同步走同一条判定，因此 mounted 前进/侧移恢复正常，只有纯后退仍保持“和普通按 `S` 步行相同”。
- `GameLoop.ts` 的共享击退 helper 现在能直接生成标准 `9101 / 击退` Buff；`渊` 的 dash-end AOE 也切到了这条共享路径，不再依赖专用 `2740` 击退 Buff。
- `渊` 的两个展示 Buff 重新整理成：友方侧 `2739 = 渊`，施法者侧 `2740 = 渊·承伤`。`immediateEffects.ts` 会一起加上这两个 Buff，`onDamageHooks.ts` 则要求两边 Buff 同时存在才生效，并在第一次 redirect 触发时一起消费，避免 self-side 提示残留。
- `.github/copilot-instructions.md` 新增了明确规则：不要创建图标或其他美术资源，除非用户明确要求。另在用户 memory 里也记录了同样偏好，方便后续会话沿用。
- `舍身诀` 的 Buff 名称改为 `舍身诀`、`舍身诀·减伤`、`舍身诀·承伤`。这里特意没有用“舍身诀·减伤害”，因为仓库内现成文件名是 `frontend/public/icons/舍身诀·减伤.png`，默认 icon 路径会直接按这个名字命中。

**Lessons**:
- 如果用户只想改某一种输入形态的手感，不要直接改 Buff 的全局速度系数；应该把判定放在输入/移动 seam，这样服务端和客户端 prediction 都能精准同步。
- 像 `9101 / 击退` 这种共享运行时 Buff，真正的复用点在“生成 Buff 的 helper”，不是单独某个技能的 call-site。只改 call-site 而 helper 仍然只认技能私有 Buff 表时，状态图标会直接丢失。
- 当前图标加载默认走“`/icons/${buff.name}.png`”这条命名约定，因此 Buff 改名时应该优先服从磁盘上的真实文件名，而不是只看文案是否更完整。

## 友方目标技能第二轮修正 + 图标路径编码 (2026-05-03)

**Problem set**:
1. `听风吹雪` 的血量平衡阶段仍在发伤害/治疗飘字，但这个阶段本质是静默设定双方当前血量，不应该被当作受伤或治疗展示。
2. `听风吹雪` 后续双方 `+20` 的治疗需要明确按 `贯体` 路径展示和处理。
3. `舍身诀` 在后续实战里再次表现为失效，根因不是主伤害链，而是仍有多条 active-mode 伤害分支绕过了共享 redirect seam，导致被保护者直接掉血。
4. `渊` 需要保持原来的击退总时长，但把击退距离翻倍。
5. 新技能/新 Buff 图标文件已经存在，但前端仍有部分界面加载失败，需要确认是真缺文件、路径不一致，还是运行时 URL 构造问题。

**Fix**:
- `immediateEffects.ts` 中把 `TING_FENG_CHUI_XUE` 的均血阶段改成静默状态写入，不再发送即时血量调整事件；只保留后续真实治疗事件。
- 即时 `贯体` 治疗辅助函数现在统一把事件名写成 `（贯体）`，这样 BattleArena 飘字和其他 `贯体` 治疗保持一致。
- 为了修复 `舍身诀`，把仍然遗漏的伤害分支全部接回共享 redirect 流程：`BonusDamageIfHpGt.ts`、`Channel.ts`、`DirectionalDash.ts`、`GameLoop.ts` 的 `TIMED_SELF_DAMAGE` 与 `STACK_ON_HIT_DAMAGE` 现在都会先走 `preCheckRedirect(...)`，再走 `applyRedirectToOpponent(...)` / `processOnDamageTaken(...)`。
- `渊` 只把击退距离从 `6` 提到 `12`，保持 `durationTicks: 15` 不变，因此飞行总时间还是 `0.5s`。
- 图标问题最终确认不是“文件不存在”也不是“目录写错”：文件在 `frontend/public/icons/` 中存在且非空，服务端对 percent-encoded URL 返回 `200`，但原始 Unicode 文件名 URL 可能返回 `400`。前端新增共享 icon-path 编码辅助，并把能力图标、Buff 图标、BattleArena 内联图标、选牌/商店/备战区图标统一改为先编码文件名再请求 `/icons/...`。

**Lessons**:
- 中文文件名静态资源不能只看磁盘上有没有文件；必须验证运行中的 HTTP 路径。文件存在但 URL 未编码时，服务端仍可能拒绝请求。
- `舍身诀` 这类保护技能是否“偶发失效”，通常不是单点逻辑问题，而是共享 redirect seam 覆盖面不完整；任何绕开该 seam 的伤害分支都会让保护看起来随机失灵。
- 当需求是“击退更远但时间不变”时，优先只改位移距离，不要顺手改 AOE 半径或持续 tick 数，否则手感会一起漂移。

## 友方目标技能基础设施 + 舍身诀 / 渊 / 听风吹雪 (2026-05-02)

**Problem set**:
1. The first ally-targeted support skills were requested, but the real-time cast pipeline only had `SELF` and hostile `OPPONENT` semantics. Backend validation, play routing, and `BattleArena.tsx` all assumed `OPPONENT` meant enemy-only, even though ally-owned dummies/entities already existed in runtime.
2. `舍身诀` needed to target a friendly player/NPC, remove removable controls except knockdown, grant `30%` DR, and redirect `100%` of post-mitigation damage to the caster. The redirected damage must ignore the protector's DR/shield but still respect damage immunity.
3. `渊` needed friendly targeting with a `6-20` range gate, a dash to the ally, an AOE knockback around that ally, and a one-hit intercept buff that makes the caster take the next incoming hit for the target.
4. `听风吹雪` needed to equalize current HP between caster and friendly target, then apply flat `贯体` healing to both sides.

**Fix**:
- Added a lightweight `friendlyTarget` ability flag in shared ability types and preload, instead of introducing a third target enum. This let the existing `targetUserId` / `entityTargetId` payload survive with minimal churn.
- Updated backend validation and play routing so `friendlyTarget` + `target: "OPPONENT"` now means “self or owned entity” rather than “enemy”, and skipped enemy-only facing/LOS rules for those casts.
- Updated `BattleArena.tsx` readiness/cast logic to distinguish hostile vs friendly entity selection, keep ally entity clicks valid, and honor `minRange` / `range` on the selected friendly target. This is what makes `渊` gray out when the ally is closer than `6`.
- Extended the shared redirect seam in `onDamageHooks.ts` with two redirect modes:
  - `舍身诀`: full post-mitigation redirect to the caster via direct HP loss, bypassing shield/DR but still stopped by `DAMAGE_IMMUNE`.
  - `渊`: one-hit redirect to the caster, then explicitly expires the ally buff on trigger.
- Patched entity damage paths (`immediateEffects.ts`, `GameLoop.ts`) to run through the same redirect hook, so ally NPCs/dummies are protected by `舍身诀` / `渊` instead of only player characters.
- Implemented the three new abilities as custom immediate effects in `abilities.ts` + `immediateEffects.ts`, with generic `applyAbilityBuffs(...)` disabled for them.
- Rechecked BattleArena movement prediction after adding `渊`'s dash. No ability-specific client prediction hook was needed because the scene already mirrors server `activeDash` generically.

**Lessons**:
- A small `friendlyTarget` flag is lower risk than a new target enum when the rest of the engine already knows how to carry explicit `targetUserId` and `entityTargetId`; the real work is in the hostile assumptions layered on top of `OPPONENT`.
- If an ally-protection ability can affect owned entities, every entity damage branch must share the same redirect hook as player damage branches. Fixing only player damage paths leaves NPC support abilities half-broken.
- The original `舍身诀` text conflicted between `10s` target buffs and “during this `12 seconds` self buff”. This implementation uses `10s` for the self buff as well, because the redirect window should match the stated target-buff duration.
- `渊`'s design text specified “one hit” but no timeout. The runtime implementation adds a `10s` safety duration so stale intercept buffs do not persist forever if the protected target is never hit.

**Follow-up fixes (later same day)**:
- Added a friendly `100` HP dummy test path end-to-end: `/cheat/spawn-dummy` now accepts optional `maxHp`, and `BattleArena.tsx` exposes a separate `友方100血木桩` spawn preset.
- Corrected `舍身诀` redirect semantics after playtesting disproved the first read of the design. Redirected damage now resolves through the protector's own target-side DR and shields via `resolveRedirectedDamageToTarget(...)`, while `DAMAGE_IMMUNE` still nullifies the redirected hit.
- Moved `渊` knockback from cast time into the existing dash-end seam in `GameLoop.ts`. The cast now stores ally/knockback metadata on `activeDash`, and the AOE knockback only fires if the caster lands within `4尺` of the protected ally.
- Added explicit `hideAbilityName` event support so `舍身诀` and `渊` redirect hits suppress the damage source text in BattleArena floats without changing other damage-label behavior.

**Lessons from follow-up**:
- For support dash skills, landing-timed gameplay belongs in `GameLoop`'s dash-completion hooks, not in immediate cast handlers. `BattleArena`'s generic server-authoritative `activeDash` path was already sufficient once the backend timing moved.
- Redirect-damage wording is easy to misread. “Redirect the hit” should be validated separately against the protector's DR, shields, and immunity instead of assuming the original target's post-mitigation number must bypass the protector's own defenses.
- If only a few mechanics should hide combat-text source labels, use an explicit event flag instead of overloading blank ability names; that keeps float formatting local and avoids accidental regressions for other unlabeled events.

## 龙啸九天气场/机关摧毁 + 人剑合一气场联动 (2026-05-02)

**Problem set**:
1. `龙啸九天` needed a new effect on top of its current self-cleanse / self-buffs / AOE knockback package: destroy enemy `气场` and `机关` within `6尺`.
2. In the current zone model, the relevant `气场` are the ground zones from `生太极 / 吞日月 / 镇山河 / 破苍穹 / 碎星辰 / 凌太虚 / 冲阴阳`; the only current `机关` zone is `天绝地灭`.
3. Destroying a zone early must stop all future zone effects immediately, including `天绝地灭`'s explode-on-expire behavior, and must also clear any zone-granted runtime buff that would otherwise linger forever after the zone disappears.
4. A new ability `人剑合一` was requested: destroy `13尺`内气场; if any destroyed气场 belonged to the caster, then enemy players within `13尺` gain `【破势】5秒：定身`.

**Fix**:
- Added shared immediate-effect helpers in `immediateEffects.ts` to classify current `气场/机关` ground zones, destroy them by range/ownership, and clear the specific zone-tied runtime buffs that otherwise would not self-clean if the source zone vanished early.
- Extended `龙啸九天` so its existing `LONG_XIAO_JIU_TIAN_AOE` handler now destroys enemy-owned `气场` and `天绝地灭` within `6尺` before applying the old AOE damage + knockback. Tooltip text in `abilities.ts` was updated to match.
- Added new ability `人剑合一` in `abilities.ts` as a self-cast control skill with custom effect `REN_JIAN_HE_YI_AOE`, plus buff `2735` `【破势】`.
- Implemented `REN_JIAN_HE_YI_AOE` in `immediateEffects.ts` by destroying all nearby `气场`, counting whether any destroyed one was friendly, and only then applying `【破势】` to nearby enemy players. `人剑合一` was excluded from generic `applyAbilityBuffs(...)` so the debuff is only applied conditionally.
- Registered the new effect type in `state/types/effects.ts` and `effects/definitions/categories.ts`, and added a `纯阳 / 外功 / 卓越` editor tag entry in `ability-property-overrides.json`.

**Lessons**:
- Ground-zone destruction is not just `state.groundZones = filter(...)`. Several current zones grant persistent buffs in `GameLoop` that only clean up on leave/zone tick; if the zone is removed out-of-band, those buffs must be explicitly expired too.
- Reusing one destruction helper for both enemy-only (`龙啸九天`) and mixed-ownership (`人剑合一`) cases keeps ownership semantics local and avoids duplicating the qi-field list in multiple handlers.
- New abilities and buffs also need art plumbing. No icon assets currently exist for `人剑合一` or `破势` under `frontend/public/icons`, so the mechanic is live but the ability icon still needs art to avoid a missing-image button in the frontend.

## 无相诀改为施放时快照减伤档位 (2026-05-02)

**Problem set**:
1. `无相诀` still used a dynamic `DAMAGE_REDUCTION_HP_SCALING` path in `combatMath.ts`, so its damage reduction kept recalculating from the holder's current HP every time they were hit.
2. The intended rule was snapshot-at-cast behavior: cast once, lock in one fixed减伤档位 for the whole buff duration, and keep the natural-expire 贯体 heal.
3. The requested named tiers were `无相诀·五十 / 六十 / 七十 / 八十 / 九十`, with the explicit rule example that `10%` HP at cast should snapshot to `90%` DR.

**Fix**:
- Reworked `wu_xiang_jue` in `abilities.ts` from one dynamic buff into five declared fixed `DAMAGE_REDUCTION` buffs: `2710` (`50%`), `2731` (`60%`), `2732` (`70%`), `2733` (`80%`), `2734` (`90%`).
- Excluded `wu_xiang_jue` from generic `applyAbilityBuffs(...)` and applied its buff manually in `immediateEffects.ts`, choosing the tier from the caster's HP at cast time.
- Implemented the snapshot thresholds to match the requested five named tiers and the explicit low-HP example: `>75% -> 50`, `>50% -> 60`, `>25% -> 70`, `>10% -> 80`, `<=10% -> 90`.
- Removed the old dynamic DR branch from `combatMath.ts` and deleted the now-unused `DAMAGE_REDUCTION_HP_SCALING` effect type/category entries.
- Updated `GameLoop.ts` so the natural-expire 贯体 heal triggers off any of the five snapshot buff ids, not only the old `2710` buff.
- Removed the stale preload-only dynamic metadata block in `abilityPreload.ts` and pinned all five renamed buffs to the existing `/icons/无相.png` icon so the status bar/editor stay stable after the rename.

**Lessons**:
- If a combat rule is described as “based on HP when cast”, the controlling seam should be buff application, not per-hit damage math. Leaving the decision in damage math guarantees drift the moment HP changes after cast.
- When a single buff becomes multiple named runtime variants, update all three surfaces together: cast-time application seam, natural-expire hooks keyed by buff id, and preload/status metadata. Fixing only one or two of them leaves the engine and UI out of sync.

## 反隐灰置兜底 + 碎星辰/破苍穹回调 (2026-05-02)

**Problem set**:
1. The first client gray-out pass for `撼如雷·反隐` was still too soft/fragile: it depended on ability metadata arriving perfectly and the draft bar buttons were not actually disabled.
2. `碎星辰` and `破苍穹` needed their zone crit chance bonus reduced from `60%` to `10%`, and their channel time reduced from `1s` to `0.5s`.

**Fix**:
- In `BattleArena.tsx`, added a stable `STEALTH_ABILITY_IDS` fallback (`anchen_misan`, `fuguang_lueying`, `tiandi_wuji`, `hua_die`) on top of the metadata-based stealth detector, and set the draft/special bar buttons to real `disabled` state when anti-stealth blocks them. This makes the gray-out independent of preload drift and visually matches the common bar behavior.
- Updated `碎星辰` / `破苍穹` in `abilities.ts` to `channelDurationMs: 500` with synced descriptions.
- Updated both preload metadata and runtime zone application (`abilityPreload.ts`, `GameLoop.ts`) so the granted `CRIT_CHANCE_BONUS` is now `10` instead of `60`, while the `+15%` crit-effect bonus stays unchanged.

**Lessons**:
- When the user asks for a client gray-out rule, make the button state authoritative (`disabled`) rather than relying only on class styling and click guards.
- For zone buffs, tune all three surfaces together: canonical ability text, preload/status-bar metadata, and the runtime buff application in `GameLoop`. If one is left behind, the game and UI immediately drift.

## 反隐灰置 + 云栖松/徐如林贯体化 + Buff 列表快速属性按钮 (2026-05-02)

**Problem set**:
1. Heal crit floats should keep the normal green heal color instead of switching to a brighter crit-only green.
2. While carrying `撼如雷·反隐`, stealth-casting abilities should be visibly grayed out on the client instead of only failing at runtime.
3. `云栖松` and `徐如林·回复` needed to count as 贯体 heals rather than ordinary 非贯体 heals.
4. Lifesteal needed an explicit follow-up audit to confirm no branch still crits after the non-crit helper split.
5. The Buff list page needed a faster batch-edit workflow for 属性 tags, similar to the quick tag buttons already used elsewhere in the editor.

**Fix**:
- In `BattleArena.tsx`, removed the crit-only heal color override. Heal crits still show `会心`, but they keep the same green color as ordinary heals.
- Added client helpers in `BattleArena.tsx` for `ANTI_STEALTH` and for detecting abilities that actually apply `STEALTH`. While anti-stealth is active, those abilities are marked blocked in the ability model, grayed out in both the draft/special and common bars, and rejected by the shared cast wrapper with a toast.
- Converted `云栖松` to `PERIODIC_GUAN_TI_HEAL` with matching `(贯体)` descriptions, so it now uses the existing periodic 贯体 path.
- Kept `徐如林·回复` on its custom natural-expire trigger, but changed that loop branch to apply direct 贯体 healing and emit the heal event as `（贯体）` without heal crit metadata.
- Re-audited all lifesteal callers and confirmed they now all use `resolveNonCritHealAmountRoll(...)`: immediate damage, explicit entity-target damage, scheduled damage, and timed-AOE damage.
- In `BuffEditorTab.tsx`, reused the existing `/ability-editor/buffs/:buffId/attribute` endpoint to add a per-card quick attribute row for all attributes plus `无`. Successful writes refresh the shared snapshot immediately, and hidden buffs remain non-editable from the list.

**Lessons**:
- If the user reads crit information mainly from text, not color, do not spend a separate color channel on heal crits; keeping the semantic heal color stable makes the combat UI easier to parse.
- Client gray-out rules should key off the same mechanical metadata the server uses (`STEALTH` on ability buffs/effects), not raw description text, or unrelated abilities that merely mention stealth in text will get blocked incorrectly.
- When converting a heal to 贯体, changing the combat path matters more than changing the label. The authoritative distinction is whether the heal bypasses ordinary heal-reduction/crit handling, not whether its tooltip text says `贯体`.

## 风袖/千蝶数值调整 + 反隐 companion cleanup + 非贯体清单审计 (2026-05-02)

**Problem set**:
1. `风袖低昂` needed its direct heal reduced to `30`, and `千蝶吐瑞` needed its per-tick heal increased to `5`.
2. `撼如雷·反隐` blocked `浮光掠影` itself but could still leave or reapply the companion `遁影(1021)`, which several runtime/client paths still treat as part of hidden state.
3. While auditing all 非贯体 heals, one remaining timed-AOE lifesteal path was still healing directly instead of using the shared heal-crit roll.
4. Lifesteal itself should not crit, because the triggering damage already had its own crit roll.

**Fix**:
- Updated canonical ability values in `abilities.ts`: `风袖低昂` heal `30`, `千蝶吐瑞` periodic heal `5`, with descriptions kept in sync.
- Updated the legacy `cards.ts` mirror for `风袖低昂` to the same `30` heal so old duplicate data does not drift further from runtime.
- In `buffRuntime.ts`, widened the anti-stealth gate so it treats `遁影(1021)` as part of the blocked stealth attempt, and added a small helper that removes any already-present `遁影` companion buff when `ANTI_STEALTH` rejects stealth entry.
- Added shared `resolveNonCritHealAmountRoll(...)` in `combatMath.ts` for lifesteal-style healing that should still respect `HEAL_REDUCTION` but must never roll a second crit.
- Switched all lifesteal branches (`Damage.ts`, `immediateEffects.ts`, `resolveScheduled.ts`, `GameLoop.ts` timed-AOE branch) onto that non-crit helper. This closed the remaining timed-AOE bypass found during the audit and aligned all lifesteal paths with the intended rule.

**Lessons**:
- For stealth bundles like `浮光掠影 + 遁影`, blocking only the visible `STEALTH` effect is insufficient if the companion buff is also interpreted as hidden-state elsewhere. The anti-stealth seam has to block and clean up the companion id too.
- After introducing a shared combat-math helper, audit every direct `applyHealToTarget(...)` branch in the engine. Timed or scheduled side paths are the common misses, especially lifesteal branches living outside the generic HEAL handler.
- “非贯体 heals can crit” still needs one carve-out: lifesteal inherits the damage result and should not get a second independent heal crit on top.

## 撼如雷 companion reveal fix + non-贯体 heal crits (2026-05-02)

**Problem set**:
1. `撼如雷` removed `浮光掠影` but could leave `遁影` behind, and several client/runtime paths still treat `1021` as part of the hidden state.
2. Non-贯体 healing needed to crit, using the healer's 内功会心 chance and 内功会心效果 multiplier.

**Fix**:
- Simplified `遁影` companion detection in the stealth-break helpers (`immediateEffects.ts`, `buffRuntime.ts`, `breakOnPlay.ts`, `GameLoop.ts`) to the authoritative identity `buffId === 1021`. This makes reveal/cleanup logic robust even if buff names or copied-source metadata differ.
- Added shared `resolveHealAmountRoll(...)` in `combatMath.ts` for non-贯体 heals. It applies target-side `HEAL_REDUCTION`, then rolls crit using healer-side 内功会心 / 会心效果.
- Moved ordinary HEAL paths onto that shared roll: direct HEAL effects, periodic heals, timed self-heals, scheduled legacy heals, and 徐如林·回复. Lifesteal now uses a separate non-crit heal helper, while dedicated 贯体 branches (`INSTANT_GUAN_TI_HEAL`, periodic/timed 贯体 heal, 无相诀贯体, 应天授命贯体, etc.) remain unchanged.
- HEAL events now carry `isCrit` metadata, and the existing heal float in `BattleArena.tsx` shows `会心` plus a brighter crit-heal color for easier validation.

**Lessons**:
- When a buff is mechanically identified by a stable runtime id, matching on name/source metadata is weaker than necessary and can fail under copies, editor renames, or synthesized applications.
- "All non-贯体 heals can crit" belongs in one shared heal roll, not scattered per ability. The real cleanup work is the bypass list: lifesteal and natural-expire heals are easy to miss if you only patch the obvious HEAL handler.

## Live 会心 panel + split 会心效果 + 紫气东来/撼如雷 (2026-05-02)

**Problem set**:
1. The 会心 detail panel did not update when buffs changed crit stats because it only read persisted base crit fields and a hardcoded `175%` 会心效果.
2. 会心效果 now needed to be split by damage type, just like 外功会心 / 内功会心.
3. New self-buff `紫气东来` was requested: 12s, +25% damage, +25 外/内功会心, +25% 外/内功会心效果, no GCD.
4. `碎星辰` / `破苍穹` needed an extra +15% typed 会心效果 while inside the zone.
5. New skill `撼如雷` was requested: instant self buff (+10 外/内功会心, +20% 外/内功会心效果), 15u reveal, and a 20s anti-stealth debuff that breaks future stealth entries.

**Fix**:
- Added shared `CRIT_EFFECT_BONUS` support to effect types, category mapping, and `combatMath.ts`; crit multiplier is no longer fixed at `1.75` once buffs are involved.
- Updated `BattleArena.tsx` to derive displayed 外功会心 / 内功会心 and 外功会心效果 / 内功会心效果 from active buff effects instead of base-only player state. The preset buttons still key off base cheat values, so temporary buffs do not make the preset highlight misleading.
- Added `紫气东来` in `abilities.ts` as a standard declared self buff (`2706`), so preload/status-bar metadata is automatic.
- Extended `碎星辰` / `破苍穹` runtime zone buffs and preload metadata with typed `CRIT_EFFECT_BONUS` `0.15`.
- Added `ANTI_STEALTH` and custom immediate effect `HAN_RU_LEI_AOE` for `撼如雷`. The custom handler applies the self buff, removes existing stealth buffs in radius, and applies `撼如雷·反隐` (`2708`) to enemy players. `addBuff()` now centrally rejects any incoming buff carrying `STEALTH` while the target has `ANTI_STEALTH`, so future stealth sources break consistently.

**Lessons**:
- If the UI shows combat-derived stats, derive them from the same buff/effect model the server uses. Reading only stored base fields guarantees drift the moment a zone or temporary buff is involved.
- “Reveal now and block future stealth” is two different mechanics: one immediate removal pass plus one central stealth-application gate. Doing only one of them leaves either existing stealth or future stealth incorrect.

## 碎星辰/破苍穹 channel-zone crit buffs (2026-05-02)

**Problem set**:
1. Add `碎星辰`: 1s forward channel (movable + air-cast), then drop a 15u radius zone for 30s that grants +60% 外功会心 while inside.
2. Add `破苍穹`: same channel/zone shell, but grant +60% 内功会心 while inside.
3. These zone buffs must be standard runtime buffs (status bar visible with metadata), not hidden state.

**Fix**:
- Added new channel abilities in `abilities.ts`:
  - `sui_xing_chen` and `po_cang_qiong`
  - `channelDurationMs: 1000`, `channelForward: true`, `requiresGrounded: false`, `channelCancelOnMove: false`, `channelCancelOnJump: false`
  - `PLACE_GROUND_ZONE` with `range: 15`, `zoneDurationMs: 30000`.
- Added new buff effect type `CRIT_CHANCE_BONUS` in shared effect unions and category map.
- Extended `combatMath.ts` crit resolution to include additive `CRIT_CHANCE_BONUS` effects from active buffs, filtered by `damageType` (`外功` / `内功`) and stack-aware.
- Added GameLoop zone enter/leave handlers:
  - `sui_xing_chen` applies/removes buff `2704` with `CRIT_CHANCE_BONUS +60 (外功)`.
  - `po_cang_qiong` applies/removes buff `2705` with `CRIT_CHANCE_BONUS +60 (内功)`.
- Added buff preload entries (`2704`, `2705`) in `abilityPreload.ts`, so status bar and tooltip metadata are available.
- Frontend scene updated to render both new zones as red circles with timers, matching the requested visual direction.

**Lessons**:
- Zone-granted combat stats should be modeled as ordinary buffs and consumed by central math helpers; this keeps status UI, combat logic, and expiry/removal behavior in sync.
- For typed stat bonuses, it is cleaner to add a generic effect (`CRIT_CHANCE_BONUS` + `damageType`) than to hardcode per-buff-id branches in combat math.

## 外功会心/内功会心 split + 风来吴山/狂龙乱舞 retune (2026-05-02)

**Problem set**:
1. 风来吴山 needed its per-hit damage reduced to 5.
2. 狂龙乱舞 needed ground-zone tick damage reduced to 3.
3. Crit had to be split into 外功会心 and 内功会心, with runtime selection based on ability damage type (`外功` / `内功`) rather than one global crit rate.

**Fix**:
- `abilities.ts`:
  - 风来吴山 `CHANNEL_AOE_TICK` value changed to `5` and description synced.
  - 狂龙乱舞 `PLACE_GROUND_ZONE` value changed to `3` and description synced.
- `cards.ts` legacy mirror: 风来吴山 scheduled damage values updated from `8` to `5` to avoid historical data drift.
- `combatMath.ts`:
  - Added split source fields `waiGongCritChancePct` / `neiGongCritChancePct` support.
  - Crit chance selection now keys off incoming `damageType`:
    - `外功` -> 外功会心
    - `内功` -> 内功会心
    - otherwise -> legacy fallback (`critChancePct`).
  - `resolveScheduledDamageRoll(...)` now forwards `damageType` into raw crit resolution.
- `draft.routes.ts` cheat API upgraded:
  - `POST /cheat/set-crit-chance` now accepts either legacy `critChancePct` or split `waiGongCritChancePct` / `neiGongCritChancePct`.
  - Broadcasts and saves both split fields, while still writing legacy `critChancePct` for compatibility with older clients.
- Backend/frontend player state types now include split crit fields.
- `BattleArena.tsx` panel now displays 外功会心 and 内功会心 separately; preset buttons still set both together for fast testing.
- Additional raw-damage paths that bypass scheduled damage now pass `damageType` where known (TRUE_DAMAGE, STACK_ON_HIT_DAMAGE, and related trigger paths) so split crit logic applies consistently.

**Lessons**:
- For mechanic splits (one field -> two typed fields), preserve a compatibility write path for old clients first, then migrate UI/readers incrementally.
- Damage-type keyed systems only work if every non-scheduled raw-damage path also forwards `damageType`; scheduled-only migration leaves hidden inconsistency.

## 会心 float polish + 龙吟 crit-reset follow-up (2026-05-02)

## High-damage pass retune (2026-05-02)

**Problem set**:
1. The requested high-damage balance pass lowered multiple burst profiles at once: 百足, 云飞玉皇, 孔雀翎, 追命箭, 龙牙, 破风, 三环套月.
2. Two of these abilities are not fully data-only: `破风` base hit is hardcoded in a custom immediate-effect handler, and 三环套月 3-stack explosion damage is hardcoded in buff stacking runtime.

**Fix**:
- Updated authored values/descriptions in `abilities.ts`:
  - 百足: upfront `3`, periodic `4/3s`, expiry `3`.
  - 云飞玉皇: `10` + `5` within 4.
  - 孔雀翎: upfront `4`, on-hit proc `1` each.
  - 追命箭: `10` + `6` bonus.
  - 龙牙: `15`.
  - 破风: upfront description updated to `1` (bleed remains `1/2s`).
  - 三环套月: base hit `1`, explosion text `1`.
  - 拿云式 left unchanged as requested.
- Updated `immediateEffects.ts` custom `PO_FENG_STRIKE` handler base damage from `2` to `1`.
- Updated `buffRuntime.ts` 三环套月 stack-consume bonus from `3` to `1`.

**Lessons**:
- For balance rounds, ability metadata alone is not enough; always grep custom effect handlers and buff runtime hooks for hardcoded damage numbers tied to the same ability.
- Updating descriptions together with runtime values avoids immediate player-facing mismatch during tuning verification.

**Problem set**:
1. The dealt-damage float still rendered normal hits as `技能名 5` instead of the requested `技能名：5`.
2. The dealt-crit yellow needed to be shifted to the brighter screenshot-matching color.
3. A new melee ability `龙吟` was requested: 4 range, 2 damage, and if that hit crits it should reset only its own cooldown while still respecting shared GCD.

**Fix**:
- Updated `BattleArena.tsx` dealt-float formatting so both normal and crit dealt hits use the Chinese colon form: `技能名：5` and `技能名：会心 5`.
- Shifted dealt-crit float color to a brighter yellow (`#ffe600`) while leaving taken-damage colors unchanged.
- Added `long_yin` to `abilities.ts` as a standard target-required 4-range attack with 2 damage and a normal authored cooldown (`300` ticks), so the reset has meaningful runtime effect.
- In `playService.ts`, reused the post-cast ability-specific hook seam: after `applyEffects(...)` but before shared GCD application finishes, detect whether `龙吟` emitted a crit DAMAGE event for the caster during that cast window; if yes, zero out only that ability instance's cooldown and `_cooldownProgress`. The later shared-GCD pass still reapplies GCD, matching the requested behavior.

**Lessons**:
- For “reset cooldown but keep GCD”, the correct seam is after the cast has already produced events and consumed runtime charges/cooldown, but before the generic GCD pass is fully done. Resetting earlier can be overwritten by `consumeAbilityUseRuntime`; resetting later risks bypassing shared GCD.
- Small combat-text punctuation differences are user-visible gameplay feedback, not cosmetic trivia. Treat them like behavior fixes and validate them with the same care as backend combat changes.

## 会心 panel toggle + damage float wording/layout follow-up (2026-05-02)

**Problem set**:
1. The prior implementation showed crit chance inline on the left HP panel, but the requested UI was a separate `C`-toggle attribute panel using 会心 / 会心效果 wording.
2. Crit preset buttons belonged on the left, below the mode indicator, not top-center.
3. Damage float wording/sign rules differed for dealt vs taken damage, and dealt crits needed a yellow highlight.

**Fix**:
- Removed the inline left-panel `暴击率` row from `BattleArena.tsx`.
- Added `C` hotkey toggle state for a new attribute panel rendered below the player HP block, styled after the provided screenshot and showing `会心` plus fixed `会心效果 175%`.
- Moved the crit preset buttons under the mode indicator and updated labels/toasts to 会心 wording.
- Reworked float formatting: dealt damage now shows `技能名 5` or `技能名: 会心 5` with no minus sign; taken damage shows `技能名： -5` or `技能名： 会心 -10`.
- Dealt crit floats now render yellow; taken damage remains red whether crit or not.
- Added backend `isCrit` metadata to shared DAMAGE events for the main scheduled/immediate helper paths, with a fractional-value fallback on the frontend for older/unpatched event shapes.

**Lessons**:
- Combat-float phrasing should be treated as a UX contract, not incidental formatting. Dealt and taken damage want different punctuation/sign conventions even when sourced from the same DAMAGE event type.
- When a UI needs “panel, not inline row”, it is better to delete the old inline readout entirely instead of duplicating the same stat in two places.

## Crit chance presets + global crit damage pipeline (2026-05-02)

**Problem set**:
1. Needed a fast in-battle way to set BOTH players' crit chance presets (0 / 36 / 40 / 46) from top-screen buttons.
2. Needed the local player's crit chance shown on the left HUD.
3. Required crit damage base = 175% and to apply across the damage pipeline, without mutating 会心 / 会心效果 editor/runtime attributes.
4. During implementation, a misplaced insertion in `BattleArena.tsx` landed inside `buildChannelBarDataForPlayer()`, causing Next/SWC parse failure (`'import'/'export' cannot be used outside of module code`).

**Fix**:
- Added backend cheat route `POST /api/game/cheat/set-crit-chance` in `draft.routes.ts`, updating both players' `critChancePct` in live loop state + persisted state, broadcasting diffs.
- Added `critChancePct?: number` to backend/frontend player state types.
- Added top-screen preset buttons in `BattleArena.tsx` (`No Crit`, `绿`, `蓝`, `紫`) wired to the new cheat route, and left-panel crit chance readout (`暴击率 xx.x%`).
- In combat math, added shared raw crit resolver with base multiplier `1.75`; `resolveScheduledDamage()` now flows through crit resolution.
- Updated direct raw-damage branches (e.g. trigger/true-damage paths in `playService.ts`, `PlayAbility.ts`, `immediateEffects.ts`, and selected `GameLoop.ts` branches) to use crit-aware raw damage resolution.
- Updated damage application to support fractional values so crit examples like `10 -> 17.5` are representable.
- Fixed the malformed frontend edit by restoring the missing function brace and re-applying crit UI code at the correct JSX locations.

**Lessons / disproved approach**:
- A large-file patch on `BattleArena.tsx` can silently match the wrong region; always re-check `git diff` immediately when touching repeated patterns. The parse error surfaced far away from the actual mistake.
- For “all damage can crit”, centralizing at `resolveScheduledDamage()` covers most ability damage; remaining direct raw-damage branches should be explicitly converted to the shared crit resolver instead of ad-hoc per-file formulas.

## Special-bar GCD display, persistent per-ability cooldown, and silence bypass (2026-05-02)

**Problem set**:
1. 洞烛机微 showed in the normal per-ability cooldown display when spammed, but the shared GCD (1.5 s) was not displayed. The frontend had no knowledge of `globalGcdTicks` because the backend never diffed it.
2. 魂压怒涛 still had no meaningful cooldown because special-bar casts spent cooldown on a throwaway synthetic `{ cooldown: 0 }` instance created fresh each time, not on any persistent state.
3. 真·下车 was blocked by unconditional `ERR_SILENCED` in backend validation, even though the ability should bypass silence.

**Fix**:
1. Backend `GameLoop.ts` was extended to diff `/players/${pidx}/globalGcdTicks` every tick. Frontend `types.ts` gained `globalGcdTicks?: number`. Frontend `BattleArena.tsx` `getChargeDisplay()` and `isAbilityReady()` now incorporate the shared GCD so the cooldown arc fills and the button grays out during the 1.5 s window.
2. Added `specialAbilityStates?: Record<string, AbilityInstance>` to `PlayerState` (both `state.ts` and `runtime.ts`). New `getOrCreateSpecialAbilityState()` helper in `specialAbilityBar.ts` lazy-creates a durable runtime instance per special-bar ability ID. Validation, play, and GameLoop cooldown ticking all use this persistent record instead of a synthetic `{ cooldown: 0 }`. GameLoop diffs `/players/${pidx}/specialAbilityStates` every tick. Frontend `specialUpdated` mapping now reads `me?.specialAbilityStates?.[ability.id]`.
3. Added `allowWhileSilenced?: boolean` to the shared `Ability` interface. Both silence gates in `validateAction.ts` (`validateCastAbility` and `validatePlayAbility`) now compute an `allowsSilence` flag and only throw `ERR_SILENCED` when it is false. `zhen_xia_che` has `allowWhileSilenced: true` and an updated description.

**Lessons**:
- A special-bar ability can appear to have correct authored values (e.g. `gcd: true`, non-zero `cooldownTicks`) while still being broken at runtime if the ability instance it mutates is a throwaway object allocated at cast time. Always trace where `consumeAbilityUseRuntime` writes to before assuming an authored value reaches the runtime.
- If the server does not diff a field, the frontend cannot show it reliably. For any new shared-state field (GCD ticks, persistent special-bar states), diffing must be added explicitly to the GameLoop broadcast block.
- Silence and similar cast-gate conditions should carry a typed bypass flag (`allowWhileSilenced`) rather than requiring per-condition special-case blocks in the validator. This keeps the gate logic consistent for both `validateCastAbility` and `validatePlayAbility`.

## 九霄风雷 follow-up rule corrections: dependent buff cleanup, reverse channel, special-bar GCD, 真·下车 lockout breadth (2026-05-02)

**Problem set**:
1. 洞烛机微在某些路径下会比九霄风雷本体活得更久；只在真·下车分支里删 buff 不够，任何方式移除九霄风雷时都必须同时结束洞烛机微。
2. 九霄风雷起手时长和起手无敌都要改为 3 秒，并且读条方向要改成倒读条。
3. 魂压怒涛要改成 10 尺击退、0.5 秒完成、8 秒冷却。
4. 洞烛机微虽然数据上已经写了 `gcd: true`，但运行时仍然可以连续施放，说明问题不在能力定义而在特殊技能栏的 GCD 结算/校验路径。
5. 真·下车要能在更宽的锁定家族里施放，不只是 `CONTROL`。
6. 魂压怒涛的击退阶段不应该再给目标挂一个可见的 knockback debuff；它应该只是标准 dash 式击退，保留位移本身和落地后的【冲撞】眩晕。

**Fix**:
- `GameLoop.ts` 新增服务端不变量：只要玩家身上已经没有 buff `2727`（九霄风雷），就立即把 `2728`（洞烛机微）从身上清掉。这样不依赖“是谁移除的 buff”，自然过期、手动下车、其它效果移除都统一收口。
- `abilities.ts` 中把 `jiu_xiao_feng_lei.channelDurationMs` 和起手无敌 buff `2726.durationMs` 一起改成 `3_000`，文案同步改成 3 秒；同一个 ability 上把 `channelForward` 设为 `false`，直接复用已有 reverse-channel 管线。
- `abilities.ts` 中把 `hun_ya_nu_tao.cooldownTicks` 改成 `240`，把 `effect.durationTicks` 改成 `15`，文案同步为 10 尺 / 0.5 秒 / 8 秒冷却。
- 真正导致洞烛机微“无 GCD”的根因在于：特殊技能栏技能不在真实 hand 里，`validateCastAbility()` / `playService.ts` 为它们临时造了 `{ cooldown: 0 }` 的 synthetic instance；全局 GCD 只会写到 hand 里的卡，下一次校验看 synthetic instance 时自然总是 0。修复方式不是再改 ability 数据，而是给 `PlayerState` 增加 `globalGcdTicks`：`playService.ts` 在任何 `gcd:true` 技能施放时设置它，`GameLoop.ts` 按与普通冷却相同的 `cooldownRate` 递减它，`validateAction.ts` 在校验 `gcd:true` 技能时先检查它。这样 temporary special-bar skills 也会被同一条 GCD 锁住。
- 真·下车在 `abilities.ts` 上补齐 `allowWhileKnockedBack`, `allowWhilePulled`, `allowWhileDisplaced`，文案同步改为“可在受控、被击退、被拉拽或位移中施放”。
- 魂压怒涛从 `abilities.ts` 里移除了击退 debuff `2729`，`immediateEffects.ts` 也不再 `addBuff()`；保留 `activeDash` 位移和 `_hunYaNuTaoSourceUserId`，GameLoop 在 dash 结束时继续追加 `2730`【冲撞】眩晕。由于原来的 debuff 还承担了“打断目标当前读条”的副作用，所以在 `HUN_YA_NU_TAO` handler 里显式保留了 `activeChannel = undefined` 的打断逻辑。

**Lessons / disproved approaches**:
- **“ability 已经写了 `gcd: true`，那就不是后端问题” 这个判断是错的。** 对临时技能栏技能，单纯的 ability 元数据不够，因为它们没有真实 hand runtime；要追到 synthetic instance 的创建点，确认冷却/GCD 状态到底存在哪里。
- 当一个 buff B 的合法存在前提是 buff A 仍在身上时，最稳的修法不是在某个移除分支里补一刀，而是在 authoritative loop 里写成不变量。这样任何过期/清除路径都会自动收敛到正确状态。
- 去掉一个控制 debuff 时，要先确认它有没有承担别的副作用。魂压怒涛这里如果只删 `2729` 而不补显式 `activeChannel` 打断，会把“击退会断读条”一起删掉。

## 洗兵雨 visual polarity + random ring placement + 九霄子技能 editor hiding + 魂压怒涛 retune (2026-05-02)

**Problem set**:
1. 洗兵雨拾武区在前端仍沿用通用地圈配色，导致施法者看到的是“友方蓝圈”，但这个圈对施法者是坏事、对中招目标是好事；同时 1 尺圈沿用默认粗边框，视觉上几乎只剩边框。
2. 洗兵雨拾武区上一轮虽然已经移出目标脚下，但仍固定生成在施法者→目标的同一侧，不满足“目标周围 6 尺环上随机一点”的设计。
3. 真·下车 / 洞烛机微 / 魂压怒涛是九霄风雷形态子技能，不应该继续出现在技能编辑面板里。
4. 魂压怒涛需要加大数值：击退范围改为 10 尺，完成时间改为 1 秒；运行时击退 Debuff 时长也必须同步，不然会出现表现和结算脱节。

**Fix**:
- `ArenaScene.tsx` 为 `xi_bing_yu` 单独走颜色分支：本地玩家如果是拾武目标则显示蓝圈，否则显示红圈；这样施法者看到危险色，被命中者看到收益色。`GroundZone` 前端类型也补了 `pickupTargetUserId`，不再靠 `any` 读这个字段。
- `AoeZone.tsx` 新增 `ringThickness`，洗兵雨圈单独传更细的边框，避免 1 尺圈被默认 `0.3` 的粗 ring 吃掉大半面积。其它地圈维持原视觉。
- `immediateEffects.ts` 的 `PLACE_XI_BING_YU_ZONE` 不再用施法者朝向或 source→target 向量，而是用 `Math.random() * 2π` 在目标中心外侧 6 尺环上取随机点；之前“永远同一方向”的问题本质上是偏移向量被写死了。
- `buildAbilityEditorSnapshot()` 和 `buildNoWeaponRequiredSnapshot()` 统一过滤 `specialBarAbility === true`，因此九霄风雷子技能会从主技能编辑页和“无需武器”页一起消失，但运行时通过 `SPECIAL_ABILITY_BAR` 仍可正常显示和施放。
- `hun_ya_nu_tao` 的能力定义改为 `range: 10`, `value: 10`, `durationTicks: 30`，文案同步更新为 10 尺 / 1 秒；`immediateEffects.ts` 不再硬编码 500ms 的击退 buff，而是按 `durationTicks / 30` 推导实际毫秒时长，这样将来再调位移时长时不会漏改 buff 持续时间。

**Lessons**:
- 有“正负收益相反”的特殊地圈时，不能继续复用“owner=蓝、enemy=红”的通用语义。像洗兵雨这种圈，配色应该按本地玩家进入后的结果来定，而不是只按 owner 来定。
- 小半径圈不要直接沿用通用 ring 厚度；把边框厚度做成可选参数，比为单个技能复制一份 AOE 组件更稳。
- 如果一个子技能只通过形态/载具/特殊 buff 临时出现，最好在 editor snapshot 层统一过滤，而不是让前端每个 tab 各自做隐藏判断。
- 这次把魂压怒涛的“10 尺”同时落实到了作用半径和位移距离，确保文案与运行时一致；如果后续只想改其中一个值，必须在 ability 描述里明确写“范围”还是“位移距离”。

## 九霄风雷 temporary skill bar + disarm channel interruption (2026-05-02)

**Problem set**:
1. 洗兵雨的拾武区半径应为 1 尺，但位置必须在目标外侧 6 尺处，不能生成在目标脚下。
2. 缴械成功套用时，如果目标正在运功且该运功来源技能不是“无需武器”，运功必须立刻停止。
3. 九霄风雷需要一个 1.5 秒起手运功：可空中施放，运功期间不能移动并获得 1.5 秒无敌；完成后获得 20 秒九霄风雷形态，临时技能栏替换为 3 个形态技能，形态中不能跳跃。

**Fix**:
- 洗兵雨的 `PLACE_XI_BING_YU_ZONE` 现在用施法者到目标的方向，把 zone 中心放到目标外侧 `zoneOffsetUnits: 6` 的位置；半径仍取 `effect.range ?? 1`，所以维持 1 尺圈。
- `buffRuntime.ts` 在成功加入 `DISARM` buff 后统一取消不具备 `noWeaponRequired` 的 activeChannel / channel buff；这样怖畏暗刑、霞流宝石、洗兵雨都走同一条规则，不需要 per-ability 分支。
- 新增九霄风雷起手与形态：`jiu_xiao_feng_lei` 是纯 activeChannel，`channelLockMovement` 锁水平移动；`channelStartBuffIds` 只在开始时给【九霄风雷·无敌】，`channelCompleteBuffIds` 只在完成时给【九霄风雷】。形态 buff 携带 `SPECIAL_ABILITY_BAR` 和 `NO_JUMP`，前端据此临时显示洞烛机微、魂压怒涛、真·下车。
- 特殊技能不进入商店 / 拾取池：用 `specialBarAbility` + `hiddenFromDraft` 标记，并在 economy / pickup 生成处过滤。后端 `validateCastAbility()` / `playService.ts` 只在当前 buff 的 `SPECIAL_ABILITY_BAR.abilityIds` 包含该技能时接受它，不改写玩家真实 hand。
- 洞烛机微使用 `CLEANSE` + 8 秒 `SPEED_BOOST 1` / `CONTROL_IMMUNE`；魂压怒涛新增 `HUN_YA_NU_TAO` 即时效果，击退 6 尺内敌方玩家 6 尺/0.5 秒，dash 结束后 GameLoop 追加【冲撞】4 秒 `CONTROL`；真·下车用 `REMOVE_SELF_BUFFS` 移除九霄风雷和洞烛机微。
- 前端 `BattleArena.tsx` 从 active buff 的 `SPECIAL_ABILITY_BAR` 派生临时热键行：1-6 个技能显示几个，不再固定填满 6 格；形态激活时禁用拖拽。`NO_JUMP` 与 `activeChannel.lockMovement` 也同步进本地跳跃 / 移动预测。

**Lessons**:
- 临时技能栏最好由 buff 暴露“当前可用技能 id 列表”，不要直接改写 `player.hand`。这样形态结束时 UI 自动恢复，原技能的冷却 / 充能状态也不会被临时技能污染。
- 同一个 channel ability 如果既有起手 buff 又有完成 buff，不能再用旧的“apply all buffs on start/complete”粗粒度开关。用 `channelStartBuffIds` / `channelCompleteBuffIds` 做白名单，既保留 preload/HUD 元数据，又不会把形态 buff 提前套上。
- 新增 channel 元数据时要同步扩展共享 `Ability` / `ActiveChannel` 类型。构建时暴露了 `channelDurationMs` 未声明的问题；补齐类型比对单个 ability 做 `as any` 更稳。

## Lockout family expansion: 缴械, 无需武器 editor, 洗兵雨 pickup zone, 抢珠式 (2026-05-02)

**Problem set**:
1. 逐云寒蕊的瞬发自 Buff `2715` 不能再带 `SILENCE_IMMUNE`；用户明确要去掉的是 `2715`，不是隐藏的 2 秒潜行 Buff `2716`。
2. 需要把“缴械”做成一个新的锁招子类型：会吃锁招递减，受 `LOCKOUT_IMMUNE` 影响，但只禁止没有“无需武器”属性的技能。
3. 前端要在有缴械时直接灰掉不满足“无需武器”的技能，而不是只等后端报错。
4. 需要一个类似琴音共鸣的专门编辑页，用来三态判定哪些技能拥有“无需武器”属性，并且改完后要立刻影响运行时判定。
5. 新技能需求：怖畏暗刑（4s 缴械）、霞流宝石（1 dmg + 按属性驱散 + 4s 缴械）、洗兵雨（5s 缴械 + 目标走回拾武区解除）、抢珠式（只能施展轻功，其余招式锁住），并且这些新技能都不进 GCD。

**Fix**:
- 按用户明确指定的 buff id 修改了 `abilities.ts` 里的 `2715`：移除 `SILENCE_IMMUNE`，同步修正文案，只保留控制 / 击退相关免疫。没有动 `2716`。
- 新增效果 `DISARM`，并把 `Ability.noWeaponRequired` 接进完整链路：`buildResolvedAbilities()`、`abilityPreload.ts`、后端 `validateCastAbility()` / `validatePlayAbility()`、前端 `BattleArena.tsx` readiness 灰置逻辑、以及 `InGameClient.tsx` 的 `ERR_DISARMED` 提示。
- `DISARM` 被加入 `SHARED_LOCKOUT_EFFECT_TYPES`，因此自动获得锁招递减、共享锁招互斥清理、以及 `LOCKOUT_IMMUNE` 过滤；同时它被加入 `SILENCE_FAMILY_EFFECT_TYPES`，所以 `SILENCE_IMMUNE` 也会免疫缴械。
- 做了专门的“无需武器”编辑页：后端在 `ability-property-overrides.json` 顶层新增 `noWeaponRequired?: boolean` 三态覆盖，提供 `/ability-editor/no-weapon-required` GET/PUT 路由；前端新增 `NoWeaponRequiredTab.tsx`，以“已声明仍需武器 / 未决定 / 无需武器”三列方式做判定。这个页改的是运行时 override，所以会立刻影响缴械可施放判定。
- 新增 `怖畏暗刑`（buff 2722, 4s `DISARM`）、`霞流宝石`（buff 2723, `DAMAGE 1` + `DISPEL_BUFF_ATTRIBUTE` 各 1 + 4s `DISARM`）、`洗兵雨`（buff 2724, 5s `DISARM` + 新效果 `PLACE_XI_BING_YU_ZONE` 在目标脚下放 1 尺拾武区）、`抢珠式`（buff 2725, 4s `NON_QINGGONG_LOCK`）。这 4 个技能都显式 `gcd: false`。
- `洗兵雨` 的拾武机制没有另开新系统，而是复用现有 `groundZones`：`immediateEffects.ts` 只负责生成绑定目标 userId 的 zone，`GameLoop.ts` 每帧检查该目标是否走回 zone；命中后移除 `2724` 并发出 `BUFF_EXPIRED`。这样和现有地面圈生命周期、同步、前端渲染全部共用同一套结构。
- 为 `抢珠式` 新增 `NON_QINGGONG_LOCK` 效果类型，并把它加入共享锁招 DR/互斥集合。后端校验在该效果存在时只允许 `qinggong === true` 的技能；前端也同步灰掉非轻功技能，并添加 `ERR_NON_QINGGONG_LOCKED` toast。

**Disproved approaches / lessons**:
- **不要复用 `ATTACK_LOCK` 实现缴械。** 这条路是错的：`ATTACK_LOCK` 在这个仓库里被当成可净化的一层控制来处理，还参与站桩/移动限制语义；如果直接拿来做缴械，会把“只能锁需要武器的招式”错误地退化成旧的一层控制。
- 对这类“锁招家族扩展”，最稳的做法是拆出独立 effect type，然后只把真正共享的行为并到 `SHARED_LOCKOUT_EFFECT_TYPES`。这样 DR、互斥、免疫、前端灰置可以按族共享，但每个子类型自己的施放规则还能单独写清楚。
- `groundZones` 已经承担了 enter/exit 型逻辑（生太极、吞日月、疾电叱羽等），所以像洗兵雨这种“走回去解除 debuff”的机制应该直接挂到 `GameLoop` 的 zone 分支上，而不是再发明一个 pickup-like 子系统。
- `抢珠式` 的持续时间这轮用户没有写明，当前先按 4 秒实现，和这轮其它瞬发锁招保持同级；如果后续要改数值，只需要改 `abilities.ts` 里的 buff `2725.durationMs`。

## Buff-channel shield fix + FEAR_IMMUNE addition (2026-05-02 round 12)

**Problem set**:
1. Only 连环弩 showed the enemy-side "不可被打断" shield even though other buff-driven channels (风来吴山 / 千蝶吐瑞 / 笑醉狂 / 心诤 / 斩无常) were marked `channelNotInterruptible: true`.
2. Needed an authoritative audit of every buff carrying `SILENCE_IMMUNE` and to confirm they all still count as interrupt-immune after removing `INTERRUPT_IMMUNE`.
3. Needed a new `恐惧免疫` property/effect and to add it to 笑醉狂.

**Fix**:
- Root cause of the missing shield: the frontend helper `getRuntimeAbilityChannel()` dropped `channel.interruptible` when converting `ability.channel` into the local `RuntimeAbilityChannel`. Direct `activeChannel` bars (like 连环弩) still worked because the backend sends `activeChannel.interruptible`; buff-driven channels always fell back to `true`. Fix was to preserve `interruptible` in the helper return shape.
- Verified with built preload data that the unique `SILENCE_IMMUNE` buffs are: 1014 不工, 1017 心诤, 2003 千蝶吐瑞, 2001 笑醉狂, 2304 转乾坤减伤, 2312 折骨, 2712 斩无常, 2715 逐云寒蕊, 2717 逐云寒蕊·不摇, 2630 连环弩. Runtime still treats `SILENCE_IMMUNE` as interrupt immunity in `immediateEffects.ts` (interrupt abilities), `buffRuntime.ts` (CC-cancels-activeChannel guard), `GameLoop.ts` (silence-removes-channel-buffs guard), and `BattleArena.tsx` (client-side interrupt-immune detection).
- Added new effect type `FEAR_IMMUNE`, categorized as a BUFF effect. Implemented it in `addBuff()` so any incoming buff containing `FEARED` has both `FEARED` and its companion `SILENCE` stripped when the target already has `FEAR_IMMUNE`. Exposed the property in both backend/frontend buff editor property catalogs and base-property extraction, then added `{ type: "FEAR_IMMUNE" }` to 笑醉狂 (buff 2001).

**Lesson**:
- If a behavior differs between pure channels and buff-driven channels, compare the shared normalization helper before touching engine logic. Here the backend/channel flag was correct; the frontend projection silently discarded one field.
- New immunity concepts belong in `addBuff()` if they gate debuff application. That keeps all current and future abilities consistent automatically and avoids scattering per-ability special cases.

## Channel direction fixes + INTERRUPT_IMMUNE removal + 剑飞 dual-mode (2026-05-02 round 11)

**Problem set**:
1. Channel direction was wrong: 连环弩 was forward (should be reverse); 傍花随柳 + 少明指 were reverse (should be forward).
2. Uninterruptible shield never appeared — no channel actually had `channelNotInterruptible: true` yet.
3. 剑飞 needed mutually exclusive buffs: success → silence only, failure → 惊惧 only (previously 惊惧 always applied).
4. Standalone INTERRUPT_IMMUNE buff effect was redundant with SILENCE_IMMUNE; should be removed and represented purely as a *channel* property (channelNotInterruptible).
5. The five canonical uninterruptible channels (风来吴山, 千蝶吐瑞, 笑醉狂, 心诤, 斩无常, 连环弩) needed both 沉默免疫 on their buff and channelNotInterruptible on their ability.

**Fix**:
- Flipped `channelForward` on 3 abilities (lian_huan_nu→false, bang_hua_sui_liu→true, shao_ming_zhi→true). Channel direction is purely a UI flag — tick/effect timing is wall-clock based, so flipping it does not change game effects.
- Reworked the `XIANG_JI_BI_LUO` handler in `immediateEffects.ts`: pre-classify ability buffs into silence/non-silence; on FAILURE (immune or no interruptible channel) apply only non-silence buffs; on SUCCESS apply only silence buffs. Both branches are now mutually exclusive.
- Removed `INTERRUPT_IMMUNE` from the `EffectType` union, `categories.ts`, all runtime checks (`buffRuntime.ts`, `GameLoop.ts`, `immediateEffects.ts`, `BattleArena.tsx`), and `extractBaseProperties` in `buffTagSystem.ts`. Replaced 5 `INTERRUPT_IMMUNE` buff entries with `SILENCE_IMMUNE` (buffs 1014, 1017, 2003, 2001, 2712 in both abilities.ts and abilityPreload.ts); deleted the now-redundant entry from buff 2630.
- Added `channelNotInterruptible?: boolean` to the canonical `Ability` type. Set it to `true` on 6 abilities: fenglai_wushan, xinzheng, qiandie_turui, xiao_zui_kuang, zhan_wu_chang, lian_huan_nu.
- Effects of these two changes: any silence-immune buff also confers interrupt immunity; only the channel itself (via channelNotInterruptible) decides if a 翔极碧落/剑飞惊天 strike succeeds. Buff-side immunity (新 SILENCE_IMMUNE alone) and channel-side immunity (channelNotInterruptible) are now non-overlapping.

**Lesson**:
- When a feature flag exists in two places (effect on a buff vs property on a channel), pick one canonical home and remove the other. The split caused: (1) 风来吴山·不工 redundantly carrying CONTROL_IMMUNE+INTERRUPT_IMMUNE on the buff while the channel had no opt-out, (2) editors couldn't display channel-level immunity, (3) handlers had to OR-check both. Consolidating cuts every site cleanly.
- Buff-driven channels (风来吴山, 千蝶吐瑞, etc.) read channelNotInterruptible from the *ability*, not the buff — `buildRuntimeChannelInfo` casts `(ability as any).channelNotInterruptible`. Adding the flag to `Ability` type avoids `as any` casts at every call site.

## 不可被打断 flip + 沉默免疫 unification + 剑飞惊天 + uninterruptible shield (2026-05-02)

**Problem set** (round 10):
1. The previous "可以被打断" property defaults to true and most abilities never opt out — invert the semantics so the property is the rare *uninterruptible* opt-in.
2. The buff editor never surfaced INTERRUPT_IMMUNE / SILENCE_IMMUNE on a buff (e.g. 风来吴山·不工 has INTERRUPT_IMMUNE in code but the UI showed nothing).
3. User suspected 风来吴山 didn't have 免疫打断 but the code clearly does (line 956 of abilities.ts) — UI gap, not data gap.
4. Wanted a buff list filter that surfaces all buffs whose effect grants 沉默免疫.
5. There is no design reason for separate `INTERRUPT_IMMUNE` and `SILENCE_IMMUNE` effects: any silence-immune buff is also interrupt-immune by design. Consolidate.
6. Implement 剑飞惊天: 1 damage + 惊惧 50% slow 5s always, plus on successful interrupt → 沉默 5s.
7. 翔极碧落 / 剑飞惊天 should be GCD-free.
8. Silence buff names should match the ability name ("翔极碧落", "剑飞惊天").
9. Visual: when a target is channeling an uninterruptible bar, draw a small shield icon to the left of the enemy channel bar.

**Fix**:
- Renamed property `channelInterruptible` → `channelNotInterruptible`. Default value is `false` (channel is interruptible). Storage flag is set only when opted-out (`channelNotInterruptible: true`). `buildRuntimeChannelInfo` and `playService` both compute `interruptible: (ability as any).channelNotInterruptible !== true`.
- Added `沉默免疫` to `BuffPropertyType` and `BUFF_PROPERTY_TYPES` (backend `buffEditorOverrides.ts` + frontend `editorShared.ts`). `applyPropertyOverridesToEffects` adds `SILENCE_IMMUNE` (no removal of code-defined immunity). `extractBaseProperties` in `buffTagSystem.ts` surfaces 沉默免疫 if a buff's effects contain *either* SILENCE_IMMUNE or INTERRUPT_IMMUNE — which automatically makes 风来吴山·不工 display 沉默免疫 in the editor.
- Engine-wide consolidation: `GameLoop.ts` silence-cancels-channel-buffs check, `buffRuntime.ts` CC-cancels-channel guard, `immediateEffects.ts` XIANG_JI_BI_LUO interrupt-immunity gate, and `BattleArena.tsx` `hasInterruptImmune` helper *all* now treat `SILENCE_IMMUNE` as conferring interrupt immunity (alongside the existing `INTERRUPT_IMMUNE` and where applicable `CONTROL_IMMUNE`).
- Added `BuffEditorTab` filter chip 沉默免疫 (toggle); when active, filters by buffs whose merged `properties + baseProperties` contains 沉默免疫.
- Added `jian_fei_jing_tian` ability (range 20, ATTACK, OPPONENT, cooldownTicks 300, gcd:false). Effects: DAMAGE 1 + XIANG_JI_BI_LUO. Buffs: 惊惧 (buffId 2720, DEBUFF, 5_000ms, SLOW 0.5) and 剑飞惊天 (buffId 2721, DEBUFF, 5_000ms, SILENCE).
- Generalised the `XIANG_JI_BI_LUO` effect handler so any non-silence buff in `ability.buffs` is applied unconditionally (so 惊惧 lands every cast) while silence buffs apply only on successful interrupt. Same handler now serves both 翔极碧落 and 剑飞惊天.
- Added `jian_fei_jing_tian` to `applyAbilityBuffs` exclusion list in `buffs.ts` (its handler manually applies its buffs).
- Set `gcd: false` on `xiang_ji_bi_luo`. Renamed its silence buff `name` from "翔极碧落·沉默" → "翔极碧落".
- Channel bar shield: extended `ChannelBarData` with optional `interruptible?: boolean`. `BattleArena.tsx`'s `buildChannelBarResultForPlayer` populates it from `player.activeChannel.interruptible` (or the ability's static channel flag for buff-source channels). `ChannelBar.tsx` renders a small SVG shield (.uninterruptibleShield) absolutely positioned to the left of the enemy variant when `interruptible === false`.

**Lessons**:
- When a user reports "buff X doesn't have effect Y" and the engine behavior contradicts that, *read the ability source first* before changing logic. The bug was the editor not surfacing INTERRUPT_IMMUNE in `extractBaseProperties`, not missing data.
- Consolidating two effect types behind a single buff property is best done by (a) adding the new property type, (b) auto-deriving from either underlying effect in `extractBaseProperties`, (c) widening every check site that previously only matched one. This keeps existing data unchanged while merging the user-facing surface.
- For "always vs on-success" buff semantics on a single ability, partition `ability.buffs[]` by SILENCE-effect presence inside the effect handler — one ability handler can serve multiple abilities (翔极碧落, 剑飞惊天) without per-id branches.
- Property semantics inversion: when a default-true flag is rarely false in practice, flip the storage so the rare case is the explicit boolean and the default case stores nothing. That matches Bayesian prior of designer intent and keeps JSON small.

## 翔极碧落 + interruptible flag + channel filter (2026-05-02)

**Problem**: Need a new打断-style ability 翔极碧落 (20 unit, instant 1 dmg, interrupts a channel and applies SILENCE 4s) plus a per-ability "可以被打断" flag so designers can mark a channel as uninterruptible. Plus an ability-list filter for channeling abilities.

**Fix**:
- Added `interruptible?: boolean` to `AbilityChannel` (runtime metadata) and to `ActiveChannel` (live channel state). `buildRuntimeChannelInfo` now copies `(ability as any).channelInterruptible !== false` so the field defaults to true and is only false when explicitly opted out. `playService.ts` copies the same flag onto `player.activeChannel.interruptible` when starting an active channel.
- Added the editor property `channelInterruptible` (label "可以被打断"). It lives in the 读条 group, so it auto-renders in the ability detail page's "添加读条属性 / 移除" UI without any frontend changes.
- New effect type `XIANG_JI_BI_LUO` (in `effects.ts`, `categories.ts`). Handler in `immediateEffects.ts` does (in this order): (1) skip if target has `INTERRUPT_IMMUNE`; (2) detect channel — `target.activeChannel` first, fall back to scanning `target.buffs` for a buff whose `sourceAbilityId` resolves to an ability with `channel.source==='BUFF'` and matching `channel.buffId`; (3) check `interruptible !== false`; (4) if interruptible, cancel the channel — for active, mirror `cancelActiveChannel`'s clear-startedBuffIds + remove activeChannel; for buff-source, remove the buff and emit BUFF_EXPIRED; (5) apply the silence buff declared on the ability.
- Ability `xiang_ji_bi_luo` (range 20, ATTACK, OPPONENT, gcd, cd 300): `effects: [DAMAGE 1, XIANG_JI_BI_LUO]` + `buffs: [{ buffId 2719, name "翔极碧落·沉默", DEBUFF, 4s, [{type:'SILENCE'}] }]`. Excluded from `applyAbilityBuffs` so the silence buff only fires through the custom handler when interrupt succeeds.
- Verified: the user-requested "免疫打断" effect is exactly the existing `INTERRUPT_IMMUNE` effect. 千蝶吐瑞 (buff 2003) and 笑醉狂 (buff 2001) already include `INTERRUPT_IMMUNE` alongside their other immunities, so they are already protected from 翔极碧落.
- Frontend ability list page: added a 4th filter row "读条" with options 全部 / 无读条 / 任意读条 / 正读条 / 逆读条. State is `channelFilter`, persisted in the same sessionStorage key `abilityEditorFilters_v2` (already used for search + tagFilters). Filter logic checks `ability.channelInfo?.mode`.

**Lesson**: When extending channel metadata, the right seam is the `AbilityChannel` runtime type plus `buildRuntimeChannelInfo` — that single function feeds the resolved `ABILITIES[id].channel` map that backend code can reliably read at runtime. Storing the flag as a raw boolean on the ability (`channelInterruptible: false` on opt-out) plus surfacing it via the existing 读条 group property auto-wires both backend behavior and editor UI without touching the detail page. For interrupt detection across both ACTIVE and BUFF channel sources, walking `sourceAbilityId → ABILITIES[id].channel` is more robust than maintaining a hardcoded buff-id allowlist (`isChannelBuffRuntime` is the legacy approach and only knows 5 buff IDs).

## Channel bar polish round 2: blue border, instant fade, larger enemy text, success-green only on enemy (2026-05-02)

**Problem**: Follow-ups on the channel-bar lifecycle: (1) the teal border wanted to be more blue; (2) both bars appeared to "wait" before disappearing — root cause turned out to be the interrupt path's 1s hold AND a tight 80ms success threshold that misclassified some buff-driven reverse channels as interrupts (clock skew between client `Date.now()` and the server-stamped `appliedAt`/`expiresAt`); (3) the enemy bar text was fully inside the 7px-tall track and hard to read; (4) the green completion flash was leaking onto the self bar.

**Fix**:
- Border tone shifted from `rgba(99, 230, 190, 0.5)` (青色 / teal) to `rgba(99, 170, 230, 0.5)` (blue-leaning 青色) on both `.channelBarTrack` and `.enemyChannelBarTrack`, with matching shadow.
- Removed the 1s interrupt hold from `ChannelBarHost`. Both success and interrupt now fade immediately on data→null; the only remaining timer is the 0.5s fade unmount.
- Bumped success detection threshold from 80ms to 300ms so reverse buff channels whose `appliedAt`/`expiresAt` come from server-stamped time still register as success when they expire naturally despite client/server clock skew.
- Enlarged `.enemyChannelBarLabel` font-size from 8px → 10px (+25%, but visually the +20% the design asked for since 8px-on-7px-track was visually flush). Combined with `overflow: visible` on the wrapper, the text now extends slightly above and below the track and is far more legible.
- Self HUD bar success/interrupt path: removed all phase visuals. On data→null we snapshot the current progress, freeze it via `progressOverride`, set `fading=true` in the same render, and let the bar fade away. No green, no orange, no snap. The enemy bar still gets the green-on-success / orange-on-interrupt visuals.
- Added `fading`-aware `useNowMs` gating: the rAF clock is paused once a `progressOverride` is supplied so the bar does not keep ticking during the fade.

**Lesson**: Visual feedback for a "channel ended" event must be local to the surface it belongs to — green-flash-on-success is a boss-bar idiom and should never touch the self HUD bar even when both surfaces share a component. Also: any "did this buff/channel finish naturally?" check that relies on client-side elapsed time vs. server-stamped duration MUST budget for clock skew (≥ a few hundred ms) — an 80ms threshold is too tight on real networks and will silently classify legitimate completions as interrupts. Lastly: a "perceived wait before fade" almost always traces back to either an unintended hold timer or a same-render setState where the prior committed DOM never had a chance to paint the start of the transition; pause the clock and freeze the progress so the only thing animating is opacity.

## Channel bar polish: per-variant completion semantics, teal border, label centered over enemy bar (2026-05-01)

**Problem**: Several follow-up issues with the channel bar lifecycle work: (1) the school-color fill was unwanted — bars should keep the original yellow/gold gradient; (2) borders were yellow on every variant — should always be teal/青色 at half opacity; (3) the opponent bar was not horizontally centered under the boss HP bar; (4) the opponent label sat above the bar instead of vertically centered over it; (5) the success animation held the green flash for 1s before fading — should fade immediately over 0.5s; (6) self-bar success showed the green flash and a snap, but the green flash is supposed to be a boss-bar visual only — self bar should just snap (or stay) at 100% then fade.

**Fix**:
- Removed the school-color path entirely from `BattleArena.tsx` (deleted `CHANNEL_SCHOOL_COLOR` and `getChannelColorForAbility`) and dropped the `color` prop from `ChannelBarHost`. Default fill is now the original yellow/gold gradient via `.channelBarFill` CSS.
- Replaced the yellow border on `.channelBarTrack` and `.enemyChannelBarTrack` with `rgba(99, 230, 190, 0.5)` (青色 half-transparent), and matched the box-shadow to the new tone.
- Enemy variant `.enemyChannelBarWrap` now uses `margin: 0 auto; align-self: center; display: block` so the 70%-wide bar is reliably centered under the boss HP bar group.
- Enemy label is now `position: absolute; left:0; right:0; top:50%; transform: translateY(-50%)`, vertically centered over the track instead of sitting above with a negative margin.
- Reworked `ChannelBarHost` completion behavior:
  - **Success**: no hold — sets `phase='success'` and `fading=true` in the same render so the 0.5s fade starts immediately. Enemy variant additionally flips fill to green (`#43d977`); HUD variant keeps the yellow/gold fill (no color change) but still snaps to 100% so reverse channels visually fill on completion (matches "instantly fill the bar like at the moment it starts" for self reverse, and is a no-op for self forward which already finishes at 100%).
  - **Interrupt**: unchanged — orange freeze + darker orange trailing, hold 1s, then 0.5s fade.
- Switched `ChannelBar` color override mechanism: replaced `color` prop with explicit `fillColorOverride`, `progressOverride`, `trailingColor` props. Default active fill comes from CSS gradient when no override is provided.

**Lesson**: Different surfaces want different completion visuals even when they share a component — the boss HP bar is a "raid feedback" surface (green flash on success, orange on interrupt), while the self HUD bar is a "did my own action land" surface (snap to full + fade is enough, no extra color noise). Encode that as `variant`-aware behavior in the host, not as visual props at the call site. Also: when the design wants "instant" feedback, do the state change and the fade in the same render; do not schedule a 1-tick gap or use a hold delay.

## Channel bar lifecycle: success/interrupt phases, fade-out, school-colored fill, timer label (2026-05-01)

**Problem**: The channel bar previously rendered only the active channel and disappeared instantly on completion or cancel. There was no visual feedback for "the channel finished cleanly" vs "the channel was interrupted", no time-remaining readout on the self bar, and the fill color was always the same yellow regardless of the ability's school. The opponent bar also rendered the name centered inside the bar instead of above it like the original reference.

**Fix**:
- Added a `ChannelBarHost` wrapper that owns the channel-bar lifecycle. It tracks the previous active channel via a ref, and when the active channel disappears it transitions to either `success` (if elapsed ≥ duration − 80ms) or `interrupted`, holds for 1s, then fades the bar opacity to 0 over 0.5s before unmounting.
- During `success` the bar is forced to 100% with a green fill (`#43d977`). During `interrupted` the bar is frozen at the snapshot progress with an orange fill (`#f08a2a`) and the unfilled remainder gets a darker orange shadow (`#a85a18` @ 55% opacity) — matches the reference picture for a stopped channel under the boss HP bar.
- Self channel bar now appends `(elapsed.xx/total.xx)` to the ability name when `showTimer` is enabled.
- Added a top-level `CHANNEL_SCHOOL_COLOR` map and `getChannelColorForAbility()` helper. The active-fill color now comes from the originating ability's `tags.school`; abilities without a school fall back to a pale green-blue (`#8de5c4`) matching the reference. The opponent bar still defaults to yellow.
- Reworked `buildChannelBarResultForPlayer()` to also return the originating ability so the color can be derived at the call site.
- Both the self bar (in the hotbar stack) and the per-target enemy bar (inside `.enemyBossGroup`) are now always mounted so the host can run its post-channel animations even after the channel ends.
- Restyled the enemy variant: width 70%, height 7px (was 18px), label sits above with negative bottom margin so the label slightly overlaps the bar (matches the original reference). Removed the deprecated "label inside the bar" path.

**Lesson**: Channel feedback is part of the channel — completing or being interrupted is a meaningful gameplay event and the bar should outlive the underlying state by a short hold + fade window. The cleanest way to do this is keep the host component mounted across the active→ended transition and snapshot the previous data plus elapsed time at the moment the channel disappears. Also: tying visual color to gameplay metadata (school) is best done with a tiny top-level lookup helper that operates on the preloaded card payload, not by reaching into per-component state.

## Channel bar visuals: enemy is a yellow bar with name inside, forward channels show no middle 段落 (2026-05-01)

**Problem**: The enemy channel bar was a small floating overlay anchored above each opponent's head with a separate name pill, which did not match the design (a wide yellow bar with the name centered inside, sitting under the boss HP bar). Forward channels also rendered 1-second tick segments, but a forward channel's effect always lands at the very end, so middle segments are misleading. Reverse channel ticks were correct.

**Fix**:
- Reworked the `enemy` variant in `ChannelBar.tsx` to render a single yellow track with the ability name absolutely centered inside (no top label, no tick segments, regardless of forward/reverse).
- Removed the 1-second forward tick segments from `ForwardBar` for the regular HUD variant. Reverse bars still render `tickIntervalMs`-based 段落 marking the next periodic effect (heal/damage).
- Moved the enemy channel bar from the per-opponent floating overlay (`enemyChannelOverlays` + screen-bounds positioning) to a fixed slot inside `.enemyBossGroup`, immediately under the boss HP bar and above the status bar. The bar now follows the selected target (self / enemy / entity owner) and reuses `channelBarData` / `opponentChannelDataById`.
- Marked `.enemyChannelOverlayLayer` and `.enemyChannelOverlayItem` as `display: none` (kept as deprecated shims so any stray references stay valid until removed).

**Lesson**: When the design anchors an enemy UI element to a specific HUD landmark (the boss HP bar), prefer rendering it as a child of that landmark's container instead of recomputing screen-space coords from world-space. Also: forward and reverse channels have fundamentally different tick semantics — forward = single end-of-channel event, reverse = periodic effects — so a shared "always show ticks at 1s" path is wrong for forward.

## Channel detail pages should show forward/reverse type first, then the concrete maintain/timing answers (2026-05-01)

**Problem**: The ability detail page already exposed `channelInfo`, but it presented channel settings as generic chips and numeric rows. That made it hard to answer the basic gameplay questions the editor user actually needs first: is this a normal channel or reverse channel, does it keep while moving, does it keep while airborne, how long is the total channel, and for reverse channels what is the tick interval.

**Fix**:
- Kept the existing editable channel controls, but added a read-first summary block at the top of the detail-page channel section.
- The summary now shows the channel type (`正读条 / Channeling` or `逆读条 / Reverse Channeling`), whether it maintains while moving, whether it maintains while airborne, the total channel duration, and the reverse-channel tick interval when one exists.
- Left the lower editable chip/numeric controls in place so the page answers the gameplay question first and the editing workflow second.

**Lesson**: For editor detail pages, the first UI layer should answer the player's or designer's semantic question directly. Raw property chips are fine as controls, but they are not a good primary representation of gameplay meaning.

## Enemy channel UI needs normalized runtime channel metadata, and pure channels cannot be inferred from buffs[] alone (2026-05-01)

**Problem**: The runtime/frontend path had no canonical `ability.channel` model, so enemy channel UI had no reliable way to show both progress and spell name. At the same time, the existing editor-side channel accessor treated any `type: "CHANNEL"` ability with `buffs[]` as a buff-backed channel, which is wrong for pure channels that merely apply buffs on channel start or completion.

**Fix**:
- Added normalized runtime `ability.channel` metadata (`source`, `mode`, `durationMs`, cancel flags, optional `buffId` / `tickIntervalMs`) during `buildResolvedAbilities()`, then passed it through `/preload` so BattleArena can consume one channel model for both self and enemies.
- Changed the channel accessor classification so `applyBuffsOnComplete` / `applyBuffsOnChannelStart` abilities stay on the pure `activeChannel` path even when they also declare `buffs[]` for later application.
- Reworked BattleArena channel UI to derive bars from either `activeChannel` or a buff matched through normalized `ability.channel`, which also fixes reverse pure-channel bars that were previously rendered as forward.
- Added per-opponent screen-bound tracking in `ArenaScene` and rendered compact enemy channel bars above each visible opponent with the channel progress and ability name.

**Lesson**: In this codebase, `type: "CHANNEL"` and `buffs[]` are not enough to tell you how a channel runs. Normalize the channel runtime shape once, then let UI and tooling consume that canonical model instead of re-deriving channel behavior from partial fields.

## Channeling should suppress jump pulses before movement consumes them, not cancel after jumpCount changes (2026-05-01)

**Problem**: Several channel states could already exist in mid-air or continue while airborne, but pressing Space during the channel still reached the normal jump path. That meant a channeling player could trigger fresh jump input, and the backend / frontend could both spend air-jump budget even though the intended rule was "while channeling, Space does nothing."

**Fix**:
- Treated channel jump suppression as an input rule, not a post-jump cleanup rule.
- Backend `GameLoop.ts` now suppresses jump for both `activeChannel` and the legacy runtime channel buffs (`1014 / 1017 / 2001 / 2003 / 2712`) before `applyMovement()` sees the pulse, and `setPlayerInput()` also strips the jump bit immediately so it does not linger as pending input.
- Frontend `BattleArena.tsx` now uses the same channel-state rule to block `tryQueueLocalJump()` and clear any queued local jump when a channel state arrives, so prediction stays aligned and jump counts are not locally consumed either.

**Lesson**: If a gameplay rule is "this input is disabled in state X," enforce it at the input seam. Letting the pulse through and trying to repair state later is how jump counts, airborne prediction, and cancel-on-jump side effects drift out of sync.

## Replacement casts must validate through the new ability first, then cancel activeChannel and still run breakOnPlay for pure-channel starts (2026-05-01)

**Problem**: 读条 replacement casting had split behavior. If the player already had `player.activeChannel`, `validateCastAbility()` threw `ERR_CHANNELING` before the new cast could take over. Separately, pure channels started directly in `playService.ts` and only ran the narrow 十方玄机 helper, so starting a new pure channel did not necessarily break existing buff-backed channels even when those channel buffs were authored with `breakOnPlay: true`.

**Fix**:
- Audited every `type: "CHANNEL"` ability in `abilities.ts` and confirmed the system is mixed: some channels are pure `activeChannel`, some are reverse or buff-backed, and `cards.ts` still has legacy duplicates for 风来吴山 / 心诤.
- Added an `ignoreActiveChannel` validation option for the real-time cast path only, so the new cast can pass normal cooldown / silence / range / LOS checks without auto-failing on the old channel.
- After the new cast validates, `playService.ts` now cancels the existing `activeChannel` cleanly before continuing, including cleanup of `startedBuffIds`, linked shields, and `BUFF_EXPIRED` events.
- Pure-channel start now uses `breakOnPlay(...)` instead of only the 十方玄机-specific helper, so buff-backed channels with `breakOnPlay: true` also end correctly when a new pure channel begins.

**Lesson**: In this repo, "读条" is not one runtime. Replacement-cast behavior must cover both control surfaces: `activeChannel` and authored channel buffs. The safe order is: validate the new cast first, then cancel the old pure channel, and still run the standard `breakOnPlay()` path so reverse/buff channels keep the same break semantics.

## Auto-derived editor lists should treat default metadata and manual decisions as separate buckets (2026-05-01)

**Problem**: 琴音共鸣 should automatically include every non-hidden 属性气劲 each time the tab is opened, so newly added attribute buffs reappear without manual maintenance. The remaining non-attribute buffs are the only ones that should need a manual decision. The first UI pass incorrectly let the active 可偷取 list write an explicit exclude state, which conflicted with the rule that attribute buffs should always stay in the stealable list.

**Fix**:
- Kept the default inclusion rule derived live from the buff attribute each time the 琴音共鸣 tab is loaded.
- Filtered hidden buffs out of the 琴音共鸣 snapshot entirely, so they never appear in the editor and never count as stealable at runtime.
- Kept a persisted `qinYinGongMingUnstealable` override, but only as a destination for undecided non-attribute buffs that the user marks NO.
- Split the tab UI into three buckets: `NO`, `未决定`, and `可偷取`. Only the `未决定` list exposes `✓` and `X`; the `可偷取` list is non-destructive.
- Removed per-row ID text from the lists and split the `可偷取` column into `默认列表` and `特殊列表`, so default 属性气劲 and manually added entries can be reviewed separately.

**Lesson**: When an editor has live auto-included defaults plus manually triaged leftovers, model them as separate buckets and separate views. Default-included items should remain driven by metadata, while only undecided items should branch into explicit YES/NO states.

## Ability-specific buff stealing should reuse addBuff for ownership transfer, then patch runtime timing from the stolen instance (2026-05-01)

**Problem**: 琴音共鸣 needed to steal up to 2 target BUFFs, preserve the exact remaining duration the victim still had, and remain editable from the buff editor. Raw `ActiveBuff` cloning would bypass immunity checks, DR hooks, linked-shield cleanup, `BUFF_APPLIED` events, and status-bar integration; reapplying only the preload template would lose the runtime timer/state the player actually saw.

**Fix**:
- Built the stealable list from the existing buff-editor override system: BUFF-only entries, default-selected by the existing buff attribute classification (`阴性` / `阳性` / `毒性` / `外功` / `混元` / `蛊` / `点穴` etc.), plus a manual per-buff opt-in flag exposed in a dedicated 琴音共鸣 editor tab.
- Implemented `QIN_YIN_GONG_MING` as a custom immediate effect that removes up to 2 eligible target buffs with linked-shield cleanup and `BUFF_EXPIRED` emission, then reapplies them to the caster through `addBuff()`.
- After `addBuff()` creates the new owner-side runtime buff, copied over the stolen buff's remaining `expiresAt`, periodic timing, stack count, and related runtime fields so the transferred buff keeps the same remaining life instead of resetting.
- Mirrored the player-only targeting rule in both `validateAction.ts` and `BattleArena.tsx` so 琴音共鸣 cannot be cast on entities.

**Lesson**: When a mechanic transfers an existing buff instance rather than creating a fresh template buff, let `addBuff()` own the authoritative apply path and then sync the runtime fields that represent the live state. Direct array/object copying skips core systems; template-only reapply loses the remaining-time state the player expects to keep.

## Observer-side instant-snap visuals need a server-shared trigger, not only the casting client's local timestamp (2026-05-01)

**Problem**: After fixing the caster-side and local-player snap paths for 斗转星移, the target client could still see the other player fast-walk into place. The target's own model snapped correctly, but the enemy model still lerped.

**Fix**:
- The opponent snap path in `Character.tsx` was keyed off `lastInstantSwapCastAtRef`, but that ref had only been armed inside the local cast wrapper.
- Updated BattleArena's event-processing effect to arm the same ref when a shared `PLAY_ABILITY` event arrives for `dou_zhuan_xing_yi`, so both the casting client and the target client enter the same snap window.

**Lesson**: Any visual rule that must happen on both sides of a PvP interaction should key off an authoritative shared signal like a game event or snapshot change, not only local input/cast state on the acting client.

## A local hard-snap branch must update both localPositionRef and localRenderPosRef, or instant swaps still look like movement (2026-05-01)

**Problem**: 斗转星移 still looked like the local player sliding to the swapped position even after the cast-specific snap marker was fixed. The opponent already snapped, but the local player could still fall into the old 1500ms cosmetic dash easing.

**Fix**:
- In BattleArena reconciliation, the `dx * dx + dy * dy > 25` "hard-snap" branch was running before the 斗转 instant-swap branch, but it only updated `localPositionRef`.
- Updated that branch to also snap `localRenderPosRef`, clear `localDashAnimRef`, and reset local Z velocity so large authoritative corrections no longer visually animate.

**Lesson**: In this frontend, `localPositionRef` is only prediction state. If a branch is supposed to be a real visual snap, it must also update `localRenderPosRef`; otherwise the render loop can still animate stale-to-new movement even though the logic path says "hard-snap".

## Instant backend swaps can still look like travel if opponent character rendering keeps an unconditional lerp (2026-05-01)

**Problem**: 斗转星移 was already an instant authoritative position swap on the backend and the local player had a snap window, but the swap could still look like a pull because enemy models in `Character.tsx` always lerped toward their new prop position.

**Fix**:
- Added a short instant-snap window for opponent `Character` instances and passed the existing 斗转 cast timestamp through `ArenaScene` so the swapped target model stops lerping during that window.

**Lesson**: For instant movement skills, do not only patch the local-player reconciler. Any separate opponent/observer render path with unconditional smoothing can reintroduce fake travel even when the authoritative state already snapped.

## If a hover-targeted dash already has a live world point, cast it immediately instead of routing through generic target validation (2026-05-01)

**Problem**: 风流云散 had been converted to hover-ground targeting, but BattleArena still entered generic opponent-target validation first. With a selected target, that left room for stale target checks and unnecessary `ERR_TARGET_UNAVAILABLE` failures instead of simply casting to the current hover point.

**Fix**:
- Switched 风流云散's cast wrapper to use `mouseWorldPosRef.current` directly when available, applying the normal LOS check and sending `groundTarget` immediately.
- Kept pending ground-cast mode only as a fallback when no hover world point is available yet.
- Added a short recent-dash snap window in BattleArena so 风流云散 and other short server dashes do not fall back into the old 1500ms cosmetic dash easing right after `activeDash` drops.

**Lesson**: For hover-driven movement skills, the best frontend path is: use the current hover world point immediately, and only fall back to pending ground selection when there is no live hover point. Otherwise the skill gets entangled with generic target-selection rules that it no longer semantically uses.

## Ground-target-only abilities need both a pending-ground cast on the client and an explicit ground-target requirement on the server (2026-05-01)

**Problem**: 风流云散 was authored as a hover-point dash, but as long as a target was selected the client could still send a normal opponent-target cast, and the backend `GROUND_TARGET_DASH` effect would quietly fall back to the target's position.

**Fix**:
- Forced 风流云散 into the pending ground-cast flow in BattleArena even when a target is currently selected.
- Added authoritative validation that rejects 风流云散 when no `groundTarget` is supplied.
- Kept a defensive backend fallback in `GROUND_TARGET_DASH` so 风流云散 no longer reuses target coordinates even if some caller forgets the hover point.

**Lesson**: If an ability is supposed to always use mouse-hover placement, enforce that at both seams. Client-side pending ground cast prevents accidental wrong payloads, but server-side validation is still needed because generic ground-target effects often have a target-position fallback.

## Repositioning from one distance band to the same distance band should use circle intersections, not perpendicular shortcuts (2026-05-01)

**Problem**: 云散's first side-step implementation worked when the caster needed to move outward to the 17-18尺 band, but it broke when already at that band because the perpendicular-offset math collapsed to zero movement and could select the current position.

**Fix**:
- Replaced the side-step branch with a circle-intersection solver: destination must be 17-18尺 from the target and 10-12尺 from the current caster position.
- Tried left/right intersections in priority order and then reused the existing collision, arena-bounds, and target-LOS validation on the resulting candidate.

**Lesson**: When movement has two simultaneous geometric constraints like "end on this ring" and "travel this far," solve the actual geometry. Ad hoc perpendicular offsets are brittle at the boundary cases and can easily degenerate to zero-distance moves.

## BattleArena cast-time ability hooks must key off AbilityInfo.abilityId, not AbilityInfo.id (2026-05-01)

**Problem**: 斗转星移 still felt like a slow movement and 风流云散 still produced `ERR_TARGET_UNAVAILABLE` even after targeted frontend patches, because the controlling cast wrapper never entered those ability-specific branches at all.

**Fix**:
- In `BattleArena.tsx`, `AbilityInfo.id` is the instance id and `AbilityInfo.abilityId` is the canonical spell id.
- The cast wrapper had been comparing special cases like 斗转星移 and 风流云散 against `id`, so those checks silently never matched during normal gameplay.
- Switched the wrapper and pending-ground-cast confirmation path to key off `ability.abilityId ?? ability.id`, and fixed the nearby stray `selectedEntityNow` typo in the same seam.

**Lesson**: In BattleArena ability handling, `id` and `abilityId` are not interchangeable. If an ability-specific client rule never seems to fire, first check whether the code is comparing against the instance id instead of the canonical ability id.

## If a proc dash must stop on walls, let activeDash own the travel and only validate the destination band (2026-05-01)

**Problem**: 云散 originally used a random 1-tick blink-style dash with source-to-destination LOS gating. That was fine for safe teleports, but it could not satisfy the updated rule set of "retreat or sidestep to 17-18尺, move fast like a blink, and still stop if the dash path hits a wall."

**Fix**:
- Replaced the random-around-target sampling with a deterministic destination selector: retreat straight back to 17-18尺 if too close, otherwise sidestep left or right to another 17-18尺 point.
- Kept destination stability plus candidate-to-target LOS checks, but removed source-to-destination LOS rejection so the proc can legitimately start a fast activeDash even when a wall may cut it short.
- Converted the proc movement from a 1-tick blink to a multi-tick activeDash with the requested 20尺/0.2秒 speed so exported-map collision can stop it naturally.

**Lesson**: When a follow-up movement needs both a preferred destination band and real wall interruption, do not over-validate the path up front. Validate the intended landing spot, then let the normal activeDash collision loop own the actual travel.

## Instant swaps and forced pulls should use different client/runtime signals even if they share pull-immunity checks (2026-05-01)

**Problem**: 龙战于野 and 斗转星移 both touch displacement rules, but they broke in opposite ways: 龙战于野 reused a declared debuff on a `SELF` ability and leaked that debuff onto the caster through generic buff application, while 斗转星移 already swapped positions instantly on the backend but still looked like a pull because the local player reconciler smoothed short teleports.

**Fix**:
- Excluded 龙战于野 from `applyAbilityBuffs` and moved its victim movement onto `applyDashRuntimeBuff()` so forced pull uses the standard displacement runtime state instead of a custom self-leaking debuff.
- Kept 斗转星移 as an instant authoritative position swap with the same `KNOCKBACK_IMMUNE` cast gate, but added a short local snap window in BattleArena so the caster does not cosmetically lerp through the swap.
- Added 守缺式 as a custom-effect charge ability because it needs one self-buff declared in `buffs[]` plus a separate manually-applied knockback buff that only exists on the empowered follow-up cast.

**Lesson**: In this repo, `KNOCKBACK_IMMUNE` is the shared cast gate for pull-like mechanics, but the movement presentation still needs to match the mechanic. Forced pulls should use Dash Runtime / displacement state; instant swaps should not, and the frontend must be told to snap instead of smoothing them.

## Pull-immunity cast gates should key off the exact pull-immunity effect, not generic control immunity (2026-05-01)

**Problem**: 斗转星移 needed to gray out and fail cast only when the target is actually immune to pull-like displacement. Some buffs bundle that with broader immunity, but some `CONTROL_IMMUNE` states do not protect against pull at all.

**Fix**:
- Implemented 斗转星移 as a player-only target swap with authoritative validation against `hasKnockbackImmune(target)`.
- Mirrored the same rule in BattleArena with a small `hasPullImmuneClient()` helper that reads `KNOCKBACK_IMMUNE` directly from the target's live buff effects before enabling the skill.
- Implemented 龙战于野 / 潜龙勿用 with a shared forward-cone targeting rule (`dot >= cos(angle / 2)`) so cone-only behavior lives in one local runtime seam instead of being recomputed differently per skill.

**Lesson**: When a cast ban is about one specific displacement immunity, key it off that exact runtime effect on both server and client. Do not infer it from broad `CONTROL_IMMUNE`, because this codebase intentionally separates pull/knockback immunity from ordinary control immunity.

## Blink-like follow-up movement is safest here as a prevalidated 1-tick dash, not a raw teleport (2026-05-01)

**Problem**: 风流云散 needed a blink-like follow-up after 截阳 / 引窍, but a direct position teleport risked owner-side interpolation artifacts and unsafe destinations inside blocked exported-map geometry.

**Fix**:
- Added a shared `triggerYunSanBlink()` helper that samples random points within 20u of the target, rejects any point that resolves out of collision, rejects any caster→candidate or candidate→target line blocked by the exported collision shell or 楚河汉界, then applies a 1-tick authoritative dash and consumes one 云散 stack.
- Hooked that helper from `jieyang` immediate cast and from `yin_qiao` channel completion so both triggers use the same movement rule.
- Let 引窍 keep its base 2 damage on the normal channel-completion path, then separately consume 绝脉 for extra damage only when the completion hit actually lands.

**Lesson**: In this repo, a 1-tick server-authoritative dash is a better "blink" primitive than mutating position directly. The local player already hard-snaps during `activeDash`, while destination sampling can still enforce LOS and collision safety before movement begins.

## 盾立 reflect whitelist plumbed through ability override system (2026-04-30)

**Problem**: Some abilities should be blocked by 盾立's damage immunity but should NOT be reflected (e.g. 毒手's 1 damage is irrelevant; the player wants the 毒手 buff to land on the shielded defender, not bounce back).

**Fix**:
- Added `dunLiWhitelisted?: boolean` to `AbilityEditorOverrideEntry` so it persists in `ability-property-overrides.json` exactly like `isProjectile`.
- `buildResolvedAbilities` copies the flag onto the runtime ability object as `(ability as any).dunLiWhitelisted`.
- `PlayAbility.shouldReflectToCaster` ANDs `&& !(ability as any).dunLiWhitelisted` — gate trips before recursive reflect, but DAMAGE_IMMUNE in `handleDamage` is untouched.
- New `setAbilityDunLiWhitelisted` mirror of `setAbilityIsProjectile`, exposed via `PUT /ability-editor/:abilityId/dun-li-whitelist`.
- Frontend: `DunLiWhitelistTab.tsx` clones `ProjectileEditorTab.tsx` (two-column undecided/whitelist lists). Tab registered in `page.tsx` as `mainTab === "dunLiWhitelist"`.

**Lesson**: When a runtime gate needs a per-ability boolean editable from the UI, the cheapest path is to mirror the existing `isProjectile` plumbing — same override file, same buildResolvedAbilities seam, same route shape, same tab template — instead of inventing a parallel persistence layer.

## Whole-cast reflection belongs in PlayAbility, not inside damage math, and it should only trigger on direct player-targeted casts (2026-04-30)

**Problem**: 盾立 needs to turn "A casts ability on B" into "B casts that same ability on A" so source-side damage buffs, target-side damage reduction, and normal buff application all recalculate from the reflected caster/target pair.

**Root causes**:
- Reflecting only the damage number is too shallow; it would keep A's offensive modifiers and would not correctly flip ability-applied buffs.
- Hooking reflection too late also misses custom immediate-effect handlers that do manual damage or buff work.
- Untargeted ground-cast abilities can still flow through `targetIndex`, so a reflect gate based only on the default target player is too broad.

**Fix**:
- Added a dedicated 盾立 reflect marker buff effect and intercepted casts in `PlayAbility` before dodge / immediate effects / ability buffs.
- When the defender has 盾立, explicit player-targeted enemy casts are re-run with swapped source and target, while damage/buff math naturally uses the reflected caster's buffs and the reflected target's mitigation.
- Limited the reflect gate to direct player-targeted casts so untargeted ground casts do not reflect just because the other player is the fallback target index.

**Key lesson**: If a mechanic says "the defender becomes the caster," implement it at the whole-ability execution boundary. That keeps custom handlers, damage math, buffs, and mitigation aligned without duplicating combat logic.

## If the effect should feel like another dimension, ease the overlay and tint it to the ability fantasy instead of snapping to flat black (2026-04-30)

**Problem**: The Hong Meng overlay finally had the correct layer order, but it still felt too harsh because it snapped in and out instantly and used a flat black fill.

**Root causes**:
- Opacity and visibility were toggled without transitions, so the effect read as a hard screen cut.
- A pure black overlay matched the old blindness implementation more than the new "other dimension" fantasy suggested by the ability icon.

**Fix**:
- Added eased opacity transitions to both the blackout layer and the self-only layer.
- Replaced flat black with a dark-purple gradient tint so the screen reads as dimensional rather than simply disabled.

**Key lesson**: Once the layering is correct, presentation matters. If an effect is supposed to feel mystical or dimensional, use the ability's color language and animate opacity instead of hard-cutting to black.

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
- The public nginx route currently serves `/icons/*.png` with `Cache-Control: public, max-age=2592000, immutable`. If a desktop browser cached an earlier missing/bad icon response, it can keep showing broken icons while a phone with a fresh cache shows the new files. Fix by versioning generated icon URLs in the frontend helper so icon requests move to a fresh cache key.

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

### Range bonuses must extend channel cancel thresholds and actual ground-target dash travel, and lockout immunity must stay narrower than control immunity (2026-05-01)
- **Problem**: After 枯残蛊 was added, three separate follow-on mismatches remained: pure channels still seeded `activeChannel.cancelOnOutOfRange` from raw authored values, ground-target dash executors still capped real travel to the base effect distance even when the cast range had been boosted, and 迷心蛊 had been authored with `CONTROL_IMMUNE`, which incorrectly granted stun/root immunity instead of only lockout immunity.
- **Fix**: Applied the active range bonus when creating pure-channel runtime state in `playService.ts`, applied the same `+12` bonus to actual travel distance in both `GROUND_TARGET_DASH` and `LIN_SHI_FEI_ZHUA_DASH` inside `immediateEffects.ts`, and added a dedicated `LOCKOUT_IMMUNE` effect in `buffRuntime.ts` that strips/purges only shared lockouts (`SILENCE` and `ATTACK_LOCK`). 迷心蛊 now uses `LOCKOUT_IMMUNE` instead of `CONTROL_IMMUNE`, while 枯残蛊 was switched to `gcd: false` as requested.
- **Lesson**: When a buff changes range, check not just validation and tooltips but every runtime that caches or converts range into some other control value, such as channel cancel distances and dash travel caps. And if a skill spec says "lockout immunity," do not reuse `CONTROL_IMMUNE` as a shortcut — introduce the narrower semantic so roots/stuns do not accidentally become immune too.

### Buff-driven range bonuses must go through one shared effective-range helper on both backend and frontend (2026-05-01)
- **Problem**: 枯残蛊 increases all ability ranges by 12尺 for 12 seconds, but the repo had multiple independent places still reading raw `ability.range`: authoritative cast validation, a custom follow-up target recheck, targeted channel completion, and BattleArena's local readiness/range display.
- **Fix**: Added a shared `RANGE_BOOST` effect type plus backend `getEffectiveAbilityRange()` helper that sums active buff bonuses, then replaced the backend range checks in `validateAction.ts`, `immediateEffects.ts`, and `GameLoop.ts`. Mirrored the same calculation in `BattleArena.tsx` so local cast gating and displayed range values match the server while 枯残蛊 is active.
- **Lesson**: If a buff modifies a core authored stat like cast range, do not patch one validation site at a time. Centralize the derived stat and route every authoritative and predicted check through that same helper, or the buff will desync between server rules, client readiness, and tooltip numbers.

### Dynamic wall abilities need shared geometry helpers across backend validation, GameLoop, and BattleArena (2026-05-01)
- **Problem**: 楚河汉界 is not just a targetable entity. It must block enemy movement, line-of-sight casts, and ground-target AoEs while still letting the owner walk through it, and the frontend must not locally predict the player through the wall.
- **Fix**: Stored oriented wall metadata (`wallHalfLength`, `wallHalfThickness`, `wallHeight`, tangent/normal) directly on the spawned `TargetEntity`, then used that same geometry in shared helper functions for backend LOS checks (`validateAction.ts`, channel/tick LOS in `GameLoop.ts`) and enemy collision resolution (`GameLoop.ts`). On the frontend, mirrored the same rule in `BattleArena.tsx` for local LOS readiness/ground-cast checks and local movement prediction, and rendered the entity as a real wall mesh in `TargetEntityVisual.tsx` instead of a generic cylinder.
- **Lesson**: If a summoned structure changes both movement and visibility rules, do not approximate it as "just a big radius" or only render it visually. Give it explicit geometry once, then reuse that geometry everywhere the game decides movement or LOS.

### Follow-self protection fields are easier as visual zones plus buff-keyed runtime rules than as pure damage zones (2026-05-01)
- **Problem**: 绿野蔓生 needed a 6尺 area that follows the caster, grants anti-control through a buff, stops incoming dashes at the boundary, and knocks attackers back out to the edge while dealing retaliation damage.
- **Fix**: Implemented the visible field as a self-following `GroundZone`, but kept the real gameplay logic keyed off the owner buff and authoritative runtime loops: dash interception is handled in the player `activeDash` path by clamping enemy dash endpoints to the 6尺 boundary, while retaliation is driven from same-tick damage events by applying a short knockback `activeDash`, adding `KNOCKED_BACK`, and dealing 3 damage from the protected player.
- **Lesson**: When a field's behavior depends on who attacked whom or whether a dash crossed the boundary, use the zone for ownership/visualization and keep the actual rules in the movement/event pipeline. That is much simpler than trying to force all of the behavior through periodic zone ticks.

### Forward strip walls and instant knockback follow-ups should reuse the existing geometry/knockback rules instead of inventing a parallel feel (2026-05-01)
- **Problem**: 楚河汉界 initially felt wrong because it was authored as a perpendicular barrier centered in front of the caster, while the reference wanted a very thin strip that starts 1尺 ahead and extends forward along facing. 绿野蔓生 retaliation also felt off because it used a custom short `activeDash`, so wall-stop and frontend display did not match the game's normal knockbacks.
- **Fix**: Re-authored 楚河汉界 so the wall tangent follows the caster facing and the entity center is placed at `1尺 + halfLength` ahead of the caster. On the frontend, changed the wall to a thin semi-transparent viewer-colored strip. For 绿野蔓生 retaliation, replaced the custom push dash with `applyType3KnockbackControl()` and added a BattleArena hard snap when the local player is under `KNOCKED_BACK`/`PULLED`, so the shown endpoint matches the authoritative knockback immediately.
- **Lesson**: If a new movement result is supposed to "feel like the rest of the game," reuse the shared knockback path and client reconciliation behavior. Custom micro-dashes are easy to author but they drift visually and collide differently from the established control system.

### Wall visuals must use the same world-to-Three facing basis as characters, and forced displacement must bypass cosmetic easing in the render loop (2026-05-01)
- **Problem**: Even after the wall geometry was made forward-facing on the backend, the rendered 楚河汉界 wall could still look angled away from the caster because the wall mesh yaw used a mirrored sign compared with the character-facing conversion. The wall also showed an extra bright line because multiple translucent wall overlays were stacked. Separately, 绿野蔓生 knockback could still feel inconsistently slow on the client because the render loop only hard-snapped some reconciliation paths, but still eased other forced-movement frames cosmetically.
- **Fix**: Changed the wall mesh yaw to use the same world basis as other forward-facing visuals, removed the extra overlay planes, and reduced the shared wall thickness constant so both the rendered strip and collision body are thinner together. In `BattleArena.tsx`, added a dedicated forced-displacement ref and made the local render loop skip dash-style easing entirely while `KNOCKED_BACK` or `PULLED` is active.
- **Lesson**: When a gameplay object is supposed to project straight out from the player's facing, match the exact world-to-render orientation math already used by characters instead of inventing a nearby formula. And if the server owns displacement, every client render path for that state must opt out of cosmetic interpolation, not just one reconciliation effect.

### Thin translucent walls need unlit color-preserving materials, and fast movement against newly spawned walls needs sweep-based near-side resolution (2026-05-01)
- **Problem**: After thinning 楚河汉界, the wall color could wash out to nearly white under the scene lighting because the translucent wall body was still using a lit material setup. Also, when a wall appeared during a dash, the later overlap-only collision resolution could clamp the player to the far side of the wall because it only saw the already-moved position.
- **Fix**: Switched the wall body to a transparent `meshBasicMaterial` with stronger light-blue/light-red palette values so the rendered color stays stable instead of bleaching out. In `chuHeHanJieWall.ts`, added sweep-based wall collision using the actor's pre-move position and the earliest expanded-rectangle entry time; `GameLoop.ts` now passes the player's previous XY into the wall resolver after movement so dashes stop on the near side of newly spawned walls.
- **Lesson**: For intentionally stylized translucent gameplay geometry, preserve authored color first and avoid lighting setups that can whiten the whole mesh. And for thin blockers that can appear while a high-speed movement is already in progress, overlap resolution alone is not enough; you need a sweep test from the previous position to prevent tunneling-to-far-side corrections.

### Charge-based rapid-cast abilities should keep tooltip timing and `chargeCastLockTicks` in sync (2026-05-01)
- **Problem**: 楚河汉界's intended between-cast lock was reduced to 0.5s, but the authored runtime lock and the player-facing description both still said 1.0s.
- **Fix**: Reduced `chargeCastLockTicks` from 30 to 15 in `abilities.ts` and updated the ability description text to match the new 0.5s lock.
- **Lesson**: For charge-based abilities, cast cadence is controlled by `chargeCastLockTicks`, not just by description text or cooldown fields. Any timing tweak has to update both the runtime lock and the displayed tooltip together.

### If a wall should visually extend outward, animate only the mesh, but if it should stop airborne players only when it reaches them, both server and client collision must respect vertical overlap (2026-05-01)
- **Problem**: After the color and near-side stop fixes, 楚河汉界 still felt wrong in two ways: the wall looked like a single full slab popping in instantly instead of shooting outward, and airborne players could still be blocked even when they appeared high enough above the wall body.
- **Fix**: Added `spawnedAt` to the wall entity and used it only on the frontend to animate the wall mesh over 0.5s from the near edge toward the far edge, keeping gameplay collision unchanged. Separately, added a vertical-overlap gate to wall collision on both backend and frontend prediction so movement is blocked only when the actor's feet/body actually overlap the wall height range.
- **Lesson**: Presentation timing and collision timing are different problems. Use render-only scale/offset animation for the "shoot out" fantasy, but make sure both authoritative and predicted collision share the same vertical overlap rule or the wall will feel taller than it looks.

### If a spawn animation should read clearly, the mesh must mount in its animated state on frame 1, not pop in full-size and only shrink on the next `useFrame` tick (2026-05-01)
- **Problem**: The first version of 楚河汉界's shoot-out animation still looked instant because the wall mesh mounted at full length on initial render, then only started scaling in `useFrame`, so the player could still perceive a full-wall pop-in.
- **Fix**: Moved the extension animation to a near-edge-anchored inner group with an initial render-time progress value derived from `spawnedAt`, then continued animating that same group in `useFrame`. Added a solid bottom strip in the same team color to make the wall footprint easier to read during the extension.
- **Lesson**: For short spawn animations, first-frame state matters. If the initial JSX mounts the final geometry, the effect will still feel like a pop even if later frames animate correctly. Anchor from the intended origin edge and mount the object already partway through the animation timeline.

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

### Cheat ability picker must exclude hidden special-bar skills (2026-05-02)
- **Bug**: The in-battle cheat window in `BattleArena.tsx` was listing every non-common preload ability, so temporary/form sub-skills like 真·下车 / 洞烛机微 / 魂压怒涛 leaked into the manual add-to-hand panel.
- **Fix**: Expose `specialBarAbility` and `hiddenFromDraft` through `abilityPreload.ts`, filter them out in the BattleArena cheat picker, and reject them again in `/api/game/cheat/add-ability` so direct requests cannot bypass the UI.
- **Lesson**: Any ability hidden from draft or reserved for a temporary special bar must be blocked at both the preload/UI layer and the cheat API; front-end filtering alone is not enough for debug tools.

### 九霄风雷 form-skill rules must stay split per sub-ability (2026-05-02)
- `jiu_xiao_feng_lei` now uses GCD.
- `dong_zhu_ji_wei` uses GCD but keeps `cooldownTicks: 0`.
- `zhen_xia_che` keeps no cooldown and no GCD, but needs `allowWhileControlled: true` so `validateAction.ts` does not throw `ERR_CONTROLLED`.
- `hun_ya_nu_tao` keeps `gcd: false` but now has `cooldownTicks: 300` (10 seconds).
- **Lesson**: These temporary bar skills do not share one blanket rule. Author each one explicitly in `abilities.ts` and update the description text alongside the runtime flag so the UI does not lie about GCD / cooldown behavior.

### Frontend lock-movement channels must not cancel active jump air-shift carry (2026-05-02)
- **Bug**: On 九霄风雷 startup, the frontend `channelMovementLocked` branch in `BattleArena.tsx` was clearing `airNudge*`, `airDirectionLocked`, and `airborneSpeedCarry`, so a player who started the channel mid-jump stopped in place locally even though the backend kept resolving already-started jump drift.
- **Fix**: When `channelMovementLocked && !hardMovementLocked`, zero only planar `vel.x/vel.y`. Do not clear existing jump air-shift / carry refs there.
- **Lesson**: Match the backend distinction exactly: lock-movement channels block new planar input, but they do not retroactively cancel previously-started jump drift. Full control/root locks are a different branch and can still clear movement state.

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
- If the user wants `属性: 隐藏` in the Buff detail editor, keep `隐藏` as a UI alias that writes to the existing hidden-buff override. Do not promote it into the real attribute enum, or the attribute filters and dispel-related tagging semantics drift again.
- The Buff list card should not spend vertical space on `来源` if that metadata is only useful on the detail page. Keep the list optimized for scanning name, description, property tags, and quick actions.
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

## 盾立 Reflect — Universal Coverage (round 2)
Issue: PlayAbility-level reflect was too narrow. AoE / channel-tick / zone-tick / dash-route / knockback / control-buff paths bypassed it. Many call sites pre-skipped via `if (hasDamageImmune) continue;` which blocked damage but never reflected.

Fix:
- Centralized reflect helper `backend/game/engine/effects/dunLiReflect.ts` already in place.
- Damage chokepoints now reflect: `handleDamage` (Damage.ts), `applyImmediateDamageToEnemyTarget` (immediateEffects.ts), `applyDamageToHostileTarget` (GameLoop.ts).
- Removed pre-immunity skips at GameLoop.ts (TIMED_AOE_DAMAGE, channel completion, CHANNEL_AOE_TICK_DAMAGE, 天绝地灭 explode) so the reflect-aware helper actually receives the call.
- Added 盾立 reflect for buffs in `addBuff()` (buffRuntime.ts) — any debuff applied to a 盾立 holder is redirected to caster (covers 帝骖龙翔, 极乐引 stun, etc).
- DirectionalDash route damage (疾) now checks immunity + reflects.
- 龙啸九天 knockback: redirects activeDash to caster when victim has 盾立.
- 极乐引 pull: skipped on 盾立 holder (buffs reflect via addBuff hook).

Lesson: damage/buff/movement reflection MUST hook at every chokepoint. Pre-immunity skips block reflection — remove them where the helper now handles immunity.

## 盾立 Reflect — regression fixes after round 2

### 捉影式 reflected only the debuff, not the pull movement
- `TIMED_PULL_TARGET_TO_FRONT` in `GameLoop.ts` applied `activeDash` directly to the original target, then applied the qinggong-seal debuff via `addBuff()`. Result: 盾立 correctly reflected the debuff, but the 盾立 holder still got pulled.
- Fix: resolve `getDunLiReflectVictim(...)` inside the timed-pull branch and switch the actual movement recipient, post-pull stun recipient, 雷霆震怒 strip target, and qinggong-seal target to the reflected victim. For reflected pulls, anchor/facing now come from the 盾立 holder, so the original caster is pulled to the 盾立 holder’s front.

### Ground-zone tick loops still had one raw `hasDamageImmune()` bypass
- The generic ground-zone damage loop (used by 狂龙乱舞 and similar persistent zones) still did `if (hasDamageImmune(target)) continue;` before calling `applyDamageToHostileTarget()`. That made the earlier reflect work look correct in helper code but unreachable in live zone ticks.
- Fix: remove the raw skip and let `applyDamageToHostileTarget()` handle both immunity and reflect.

### 百足 / 五方 need payload-only reflect, not cast-entry reflect
- `PlayAbility.ts` reflects any direct opponent-target cast before `applyImmediateEffects()`. For targetable area spells like 百足 and 五方行尽, that bounces the whole cast back to the caster, which is wrong because the zone/impact point should stay where the player aimed it. Only the emitted damage/root/DoT payload should reflect.
- Fix: skip cast-entry reflect for `BAIZU_AOE` and `WUFANG_XINGJIN_AOE`, and rely on downstream reflect-aware damage/buff handlers to redirect the payload only.

## 盾立 Reflect — six-point follow-up round

### 百足 / 五方 still skipped 盾立 before the shared helper
- `getImmediateEnemyDamageTargets()` in `immediateEffects.ts` still filtered out `hasDamageImmune()` players/entities before BAIZU_AOE and WUFANG_XINGJIN_AOE reached `applyImmediateDamageToEnemyTarget()` / `addBuff()`. Result: the cast-entry reflect was gone, the zone place stayed correct, but the actual damage/root payload never saw the 盾立 target at all.
- Fix: remove the early damage-immune filter from `getImmediateEnemyDamageTargets()` and let the downstream damage/buff handlers handle immunity + reflect.

### 少明指 dispel payload had no reflect path of its own
- Both `DISPEL_BUFF_ATTRIBUTE` handlers (channel-completion in `GameLoop.ts` and immediate in `immediateEffects.ts`) directly stripped buffs from the current target with no `getDunLiReflectVictim()` step. For the channel case, dispel was also skipped if the prior damage leg set `channelEffectDodged`.
- Fix: resolve the dispel target through `getDunLiReflectVictim()` in both handlers. In the channel version, only skip dispel on `channelEffectDodged` when there was no 盾立 redirect.

### 振翅图南 / 飞刃回转 follow-zones must resolve 盾立 before choosing the follow target
- `PLACE_FOLLOW_ZONE` always attached the zone to the selected enemy target. If that target had 盾立, the zone still spawned on and followed them, which bypassed the intended direct-target reflect behavior for the follow lock-on itself.
- Fix: in `PLACE_FOLLOW_ZONE`, resolve the selected target through `getDunLiReflectVictim()` before setting the zone center / `followTargetUserId`.

### 极乐引 reflected only the CC buffs, not the pull movement
- The earlier hotfix explicitly `continue`d after reflecting the pull/stun buffs, so the activeDash pull never switched to the caster.
- Fix: resolve `pullSource` / `pullTarget` through `getDunLiReflectVictim()` and assign both the activeDash movement and the pull/stun buffs to the reflected target.

### 连环弩 used a fully custom tick path outside the shared damage helper
- The `lian_huan_nu` tick branch in `GameLoop.ts` did all of its own work: raw `!hasDamageImmune()` gating, manual `resolveScheduledDamage()`, direct `applyDamageToTarget()`, and direct `activeDash` knockback. That bypassed 盾立 reflect entirely. It also applied no actual `KNOCKED_BACK` CC state, so reflected knockback did not reliably break the caster’s channel.
- Fix: route damage through `applyDamageToHostileTarget()`, resolve the actual knockback victim through `getDunLiReflectVictim()`, add a short `KNOCKED_BACK` debuff when knockback lands, and explicitly clear `activeChannel` on the knockback victim so reflected self-knockback breaks 连环弩 immediately.
