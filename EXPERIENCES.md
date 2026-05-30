# Zhenchuan — Experiences Log

Record all problems solved, unresolved issues, and disproved approaches here.
Each entry goes under its relevant section header.

## Ability description source audit and backup (2026-05-30)

**Implemented / checked**:
- Audited the ability description pipeline and confirmed the usual base/original text lives inline in `BASE_ABILITIES` inside `backend/game/abilities/abilities.ts`.
- Confirmed the live edited descriptions are persisted in `backend/game/abilities/ability-property-overrides.json` and merged into runtime abilities during rebuild.
- Confirmed there is no separate persisted backup store for original ability descriptions; the typed `originalDescription` field exists, but in the ability table it is only populated for `fenglai_wushan`.
- Wrote a timestamped JSON backup of the current effective ability descriptions to `backend/game/abilities/backups/ability-descriptions-backup-2026-05-30T05-32-00.404Z.json`.

**Lesson**:
- For ability descriptions, treat `BASE_ABILITIES` as the canonical source-of-truth for the original text and `ability-property-overrides.json` as the mutable live layer. If a reversible history is needed, create an explicit snapshot file before further edits because the current editor save path does not preserve prior descriptions automatically.

## Yumen duplicate shrink-start guard (2026-05-29)

## Camera dash collision-aware prediction (2026-05-29)

**Implemented / checked**:
- Traced dash camera wall-entry jitter to frontend render prediction, not `CameraRig`: the camera follows `localRenderPosRef`, and active dash rendering used a linear predictor that ignored exported-map collision.
- Added collision-aware dash render prediction in `BattleArena.tsx`, using the same exported collision system readiness and play-area clamping path as movement prediction so the camera target stops with the visual/player body.
- Added a real `ESC -> 测试 -> 镜头测试` panel with live prediction/collision metrics and a browser probe for Playwright.
- Added a deterministic exported-map test positioning route and a live Playwright regression. The live test must cast through the in-page frontend path and refresh the browser state after cheat positioning; using `page.request` alone updates the server but can miss short active-dash states in React.

**Lesson**:
- Camera follow bugs can originate in render-target prediction rather than camera math. For short server-authoritative dashes, live browser tests should exercise the in-page state update path; request-context API calls can bypass frontend diff application and create false missed observations.

## Camera ground-clamp sky-look split (2026-05-30)

**Implemented / checked**:
- Extended collision-test camera pitch to near straight-up and split ground-clamp handling by movement intent.
- Stationary upward dragging now keeps a safe boom distance and aims into the sky instead of collapsing the camera into the avatar.
- Forward walking keeps the staged old behavior: the camera can close in at the ground clamp first, then aim upward once close enough.
- Added live Playwright probe coverage for 10 stationary expected-behavior passes across house / 城墙 / mountain labels, plus forward-walking checks for all three categories.

**Lesson**:
- Camera tests must drag far enough to reach the actual pitch clamp; partial upward drags can produce misleading halfway samples. For live WebGL checks, use a camera-specific probe and poll for a fresh frame after synthetic input instead of relying on a single immediate read.

## Camera smooth sky-look blend and W preserve (2026-05-30)

**Implemented / checked**:
- Replaced the fixed ground-clamp sky target with a pitch-derived look direction so dragging farther upward maps continuously to a higher viewing angle.
- Blended from the normal avatar look target into the pitch-derived sky target with a continuous look-up ratio, removing the mode-switch feel when entering or leaving sky view.
- Preserved the sky-facing pitch when pressing or releasing forward movement from sky view; forward movement changes camera position but does not force the angle back toward the avatar.
- Added probe fields and deterministic live Playwright sampling for smooth up/down transitions and W-preserve behavior across repeated house / 城墙 / mountain-labeled cases.

**Lesson**:
- Camera feel should avoid binary target swaps around collision clamps. Live WebGL proof is more reliable when synthetic mouse movement is backed by deterministic pitch stepping, explicit endpoint samples, and aggregate smoothness checks because headless rendering can drop individual frames.

## Yumen mountain spawn anti-stuck lift (2026-05-29)

## Yumen spectator ghost cooldown zeroing (2026-05-29)

## Yumen sandstorm defeat announcement real-name fix (2026-05-29)

## Yumen spectator frontend GCD/cooldown sync fix (2026-05-29)

## GCD bar flashing stabilization (2026-05-29)

## Yumen auto-settle shared-state sync fix (2026-05-29)

**Implemented / checked**:
- Diagnosed intermittent "自动结算不生效" as client preference contention: each player had a local auto-settle preference that could keep forcing different values to the server.
- Removed per-client auto-settle localStorage preference/sync loop in BattleArena.
- Bound the 自动结算 checkbox directly to shared server state (`safeZone.autoSettle`), so all players now see the same checked status and a single authoritative value.

**Lesson**:
- Match-wide rule toggles must be represented as shared server state only. Per-client remembered preferences create hidden state fights and intermittent behavior.

**Implemented / checked**:
- Investigated repeated GCD bar flash/restart behavior after spectator cooldown changes.
- Switched frontend GCD fallback source from raw `me.globalGcdTicks` to runtime-decayed ticks via `getRuntimeCountdownTicks(...)` so stale server values do not keep re-triggering the bar.
- Added a one-tick guard to suppress micro-fallback blips (`<= 1` tick), which removes brief flash artifacts near countdown boundaries.

**Lesson**:
- Cooldown bar fallback should use time-decayed runtime values, not raw synced snapshots; snapshot jitter near zero creates visual flicker and fake re-triggers.

**Implemented / checked**:
- Investigated ghost-form reports where frontend showed ongoing GCD and blocked 轻功 casts even though backend spectator rules allow continuous mobility.
- In BattleArena frontend logic, bypassed cooldown/GCD gating for spectator 轻功 checks so local readiness matches backend validation.
- Hidden the player GCD visual bar while `观战中` is active to avoid misleading "still cooling down" UI.

**Lesson**:
- Spectator-mode exceptions must be mirrored in frontend readiness checks and visual cooldown widgets; backend-only fixes still feel broken when UI/state prediction disagrees.

**Implemented / checked**:
- Found server chat fallback for unattributed defeats (such as 狂沙) was hardcoded to `【游客】黯然离去。`.
- Updated system defeat broadcast fallback to use the actual defeated player display name when attacker attribution is missing.

**Lesson**:
- For kill/death announcements, fallback text must still resolve identity from the defeated user record; placeholder labels like "游客" create false attribution and confuse players.

**Implemented / checked**:
- Added spectator-mode cooldown bypass in ability validation so `观战中` players are not blocked by GCD or per-skill cooldown checks when casting movement skills.
- Added runtime cooldown normalization in `GameLoop` so while `观战中` is active, ability cooldown, GCD, and charge lock/regen are continuously forced to ready state.
- Kept existing spectator lock on non-轻功 abilities unchanged; this update only removes cooldown friction for allowed ghost-form mobility.

**Lesson**:
- For spectator/ghost traversal, cooldown-state consistency must be enforced both at validation time and tick-time state maintenance; patching only one path leaves intermittent lockouts.

**Implemented / checked**:
- Investigated reports of players spawning slightly inside mountain geometry and getting stuck due to low initial Z.
- Increased Yumen battle-start/random-spawn lift height from `+5` to `+10` units to create a clearer drop-in at match start.
- Hardened lifted spawn baseline Z to `max(spawn.z override, support-ground Z, top-down-hit Z)` so bad per-point Z data cannot place players below valid terrain support.

**Lesson**:
- Spawn-point Z should be treated as a hint, not authority, in complex 3D terrain. Using the maximum valid terrain-derived floor plus a short initial lift avoids embed-on-spawn while preserving the intended "drop-in" feel.

**Implemented / checked**:
- Investigated reports of broken poison-zone behavior in multi-player Yumen games and traced a plausible cause to duplicate start requests from multiple clients joining at different times.
- The frontend auto-full-shrink effect can run on each client with the preference enabled while the zone is still `idle`.
- Added backend guards to reject `start-shrink` and `start-full-shrink` when the safe zone is already in `waiting`, `countdown`, or `shrinking`.
- Suppressed the expected `alreadyStarted` conflict in the frontend auto-full-shrink path so late joiners do not produce false error toasts.

**Lesson**:
- Join-time client automation must be backed by idempotent server routes. A per-client preference is not a safe uniqueness guarantee for match-wide state transitions like poison-zone start.

## Yumen settlement exit footer layout update (2026-05-29)

**Implemented / checked**:
- Moved the settlement auto-leave text and `离开战场` button from a right-aligned row into a centered vertical stack.
- Updated the countdown number in `将在 X 秒后离开战场` to display in yellow.

**Lesson**:
- For end-of-match dialogs, the primary exit countdown and action read more clearly when centered as a stacked call-to-action instead of competing with table content at the edge.

## Consumable gray-out softening (2026-05-29)

**Implemented / checked**:
- Reduced the consumable bar gray-out severity for empty, unavailable, and depleted states by about 30%.
- Softened the mute effect by raising icon opacity and easing grayscale/saturation/brightness suppression instead of changing cooldown overlays.

**Lesson**:
- Inventory-state mute effects should communicate missing items without making the bar feel visually disabled; reducing desaturation and opacity together keeps the state readable but calmer.

## Chat input channel color tint (2026-05-29)

**Implemented / checked**:
- Changed the chat input text color to inherit the active composer channel color instead of using a fixed near-white color.
- The map composer now visually matches the outgoing map-channel tint while typing.

**Lesson**:
- When the send channel is visually encoded, the typed text should share that channel color so the composer feels like part of the same message pipeline.

## Chat slash command handling (2026-05-29)

**Implemented / checked**:
- Updated the chat submit path so messages starting with `/` are treated as commands instead of being sent to chat.
- Added `/upz` as a command that triggers the same current-player Z rescue action as the control-panel button.
- Unknown slash commands are blocked from chat and reported as commands rather than normal messages.

**Lesson**:
- Slash-prefixed chat input should short-circuit before network send, so command-like text cannot leak into public chat.

## React error-boundary startup crash fix (2026-05-29)

**Implemented / checked**:
- Investigated a startup crash reported as `ReferenceError: Cannot access 'vh' before initialization` on the in-game client.
- Root cause was a render-time TDZ dependency in the chat command callbacks: `runChatCommand` and `submitChatMessage` were defined before `runCheatAction`, so the component tried to read the later `const` during initial render.
- Moved the chat command callbacks below `runCheatAction` so all dependencies are initialized before they are referenced.

**Lesson**:
- In React components, a callback can still crash at render time if its dependency array reads a later `const`; moving the callback below the dependency or switching to a ref avoids TDZ failures.

## Ctrl+left-click ability mention insertion in chat (2026-05-29)

**Implemented / checked**:
- Added a new shortcut on ability slots: `Ctrl + 左键点击` appends `[技能名]` into the chat input box.
- Applied the behavior to both draft ability slots and common ability slots.
- Follow-up: applied the same `Ctrl + 左键点击` mention behavior to consumable slots, appending `[物品名]` into the chat input.
- Follow-up: enabled the same `Ctrl + 左键点击` mention behavior for P-panel ability tiles, appending `[技能名]` to chat.
- P-panel safeguard: when `Ctrl + 左键点击` is used on a tile, drag/add/remove/favorite tile actions are all suppressed so only the chat-token insertion runs.
- Follow-up: added status-bar support. `Ctrl + 左键点击` on a status/buff icon now appends `[状态名]` into chat.
- Status-bar safeguard: ctrl-click on status icons suppresses cancel/other icon click side effects so only name copy runs.
- Each click appends one token, so repeated clicks produce repeated tokens (for example `[技能A][技能A]`).
- Kept normal left-click cast behavior unchanged when `Ctrl` is not held.
- Follow-up: bracketed ability tokens can now be removed as a group from chat input. `Backspace` at token end or `Delete` at token start removes the whole `[技能名]` block in one action.

**Lesson**:
- Chat mention shortcuts should append to existing input (not replace it) and preserve deterministic one-click-one-token behavior so players can compose repeated callouts quickly.

## Tab auto-target range/facing refinement (2026-05-29)

**Implemented / checked**:
- Updated `Tab/F1` auto-target selection to keep existing rules but additionally require targets to be within 60 units.
- Kept facing-direction filtering and current-target exclusion behavior unchanged.
- Removed the no-candidate warning output; when no target matches, selection now stays unchanged without showing an error message.

**Lesson**:
- Auto-target hotkeys should be deterministic and quiet: strict eligibility filters (facing + range) improve target quality, and no-match paths should fail silently to avoid UI noise.

## Ability tooltip cast text wording update (2026-05-29)

**Implemented / checked**:
- Updated channeled-ability tooltip cast text from `3秒` style to `释放: 3秒` style.
- Kept instant-cast tooltip text unchanged as `瞬间释放`.

**Lesson**:
- Tooltip cast wording should clearly distinguish cast type semantics; explicit `释放:` prefix makes channel duration read faster without affecting instant-cast readability.

## Ability tooltip zero-cooldown wording update (2026-05-30)

**Implemented / checked**:
- Updated ability hover tooltip cooldown formatting in `BattleArena.tsx` so skills with no cooldown now show `无调息时间` instead of `0秒`.
- Kept existing cooldown display behavior for positive cooldowns and multi-charge recovery unchanged.

**Lesson**:
- For tooltips, zero values that represent "no mechanic" should use explicit wording instead of numeric `0秒`, which reads like an active but empty cooldown.

## Ability editor charge cooldown review fix (2026-05-30)

**Implemented / checked**:
- Traced the cooldown review page and confirmed it only read and wrote `cooldownTicks`, which is the wrong field for charged abilities.
- Updated the cooldown review snapshot/save path so abilities with `maxCharges > 1` now review `chargeRecoveryTicks` instead.
- Updated the cooldown review UI so charged abilities show `充能时间` rather than generic `CD` / `冷却时间` wording.
- Kept non-charge abilities on the existing `cooldownTicks` review path.

**Lesson**:
- Charge skills need a separate review surface from standard cooldown skills. Reusing a generic cooldown field hides the real runtime source of truth and makes editor changes look broken.

## Charge cast lock and 生死劫月劫 timing adjustment (2026-05-30)

**Implemented / checked**:
- Reduced charge-cast lock from 1.0s to 0.5s for charge skills that previously used `chargeCastLockTicks: 30`:
  - 鹊踏枝
  - 游风飘踪
  - 盾立
- Updated these skill descriptions to match the new 0.5s cast interval.
- Kept 楚河汉界 unchanged because it already used 0.5s (`chargeCastLockTicks: 15`).
- Reduced 生死劫's 月劫 (`buffId: 1221`) duration from 15s to 12s.

**Lesson**:
- When changing runtime timing fields (like cast lock), update player-facing descriptions in the same edit pass so gameplay behavior and tooltip text remain aligned.

## Ability tooltip cooldown should use real CD, not 3s test cap (2026-05-29)

**Implemented / checked**:
- Traced ability tooltip cooldown rendering to `formatAbilityCooldownLabel()`.
- Fixed charge-skill tooltip cooldown source to use uncapped recovery ticks for display (`tooltipChargeRecoveryTicks`) instead of runtime-capped `chargeRecoveryTicks` used by test-short-cooldown mode.
- Applied the uncapped tooltip recovery value to draft/common/special bars and martial ability info so tooltip cooldown text reflects real configured cooldown values.
- Root-cause correction: `buildAbilityPreload()` had a global 3-second clamp on `cooldownTicks` and `chargeRecoveryTicks`; removed this clamp so preload metadata now carries real cooldown values for all skills.

**Lesson**:
- Tooltip metadata and runtime cooldown state can have different intents. Keep tooltip cooldown sourced from canonical config values, while runtime state can still be test-capped for gameplay experiments.

## Yumen remaining-count label style tweak (2026-05-29)

**Implemented / checked**:
- Updated the right-side `剩余人数` label style to remove the white border/outline effect by clearing `-webkit-text-stroke` and removing the white glow shadow layer.
- Increased the `剩余人数` label font size by 20% (from height ratio `0.228` to `0.274`).
- Follow-up tweak: restored a very small white border (`-webkit-text-stroke: 0.08px rgba(255,255,255,0.52)`) per visual preference.
- Follow-up tweak: reduced the `剩余人数` number stroke from `0.6px` to `0.3px` (half strength).

**Lesson**:
- For large HUD typography, white stroke plus white glow can feel too harsh; a clean solid color with only subtle dark shadow gives better readability and less visual strain.

## Ability/consumable hover intensity softened by 30% (2026-05-29)

**Implemented / checked**:
- Reduced ability-slot and consumable-slot hover glow intensity to about 70% of previous strength.
- Lowered hover shadow from `0 0 8px rgba(255, 255, 245, 0.18)` to `0 0 6px rgba(255, 255, 245, 0.126)` for the relevant slot hover paths.
- Reduced hover highlight-overlay opacity to `0.7` while keeping active/pressed feedback at full opacity.

**Lesson**:
- For HUD hover feedback tuning, reduce both shadow intensity and overlay opacity together; changing only one can still feel overly strong.

## GCD-only cooldown overlay should keep arc, hide number (2026-05-29)

**Implemented / checked**:
- Restored per-skill cooldown arc rendering for shared basic GCD lockouts by mapping shared GCD ticks into HUD cooldown display data with `cooldownDisplayKind: 'gcd'`.
- Kept the prior UX change that hides the numeric cooldown label for GCD-only lockouts.
- Follow-up correction: removed the separate GCD arc color branch and reused the normal cooldown arc visual, so GCD-only lockout now uses the same arc style as all other cooldowns.
- Applied this for both single-charge and multi-charge abilities when they are locked by shared GCD but not by their own cooldown/charge lock.

**Lesson**:
- For GCD-only lockouts, treat the arc and number as separate UI concerns: hide the number text but keep the exact same cooldown arc visual instead of introducing a second arc style.

## Ability cooldown spinner regression fix for >1s cooldowns (2026-05-29)

**Implemented / checked**:
- Restored cooldown arc progression by stabilizing `maxCooldown` against raw runtime instance values (`instance.cooldown` / `instance.chargeLockTicks`) instead of relying only on definition cooldown fields.
- This prevents cases where `maxCooldown` collapsed to the live remaining ticks, which made the conic cooldown overlay stay near 100% and feel like it stopped spinning.

**Lesson**:
- For HUD radial cooldown percentage, use a stable max baseline from runtime instance data when ability definition cooldown fields can be absent, or the arc can appear frozen even while numeric cooldown keeps ticking.

## Yumen spawn-facing alignment legacy-mode compatibility (2026-05-29)

**Implemented / checked**:
- Updated frontend `isYumen1v1BasicMode()` detection to accept both `yumenguan-classic` and legacy `yumen-1v1-basic`.
- This restores Yumen-only startup camera alignment behavior for older live sessions that still carry the legacy mode code.

**Lesson**:
- After renaming mode codes, frontend mode predicates must keep legacy compatibility wherever mode-gated runtime behavior (like spawn camera alignment) is expected on already-running sessions.

## Mode code rename: yumenguan-classic and test (2026-05-29)

**Implemented / checked**:
- Renamed canonical backend/frontend mode codes to `yumenguan-classic` and `test`.
- Updated frontend labels to `玉门关：经典` and `测试`.
- Updated mode selectors, diagnostics mode labels, room-size checks, in-game test-mode conditionals, and live test create payloads to the new codes.
- Kept legacy compatibility handling for `yumen-1v1-basic` and `collision-test` in mode normalization/predicates and labels so existing sessions still resolve correctly.

**Lesson**:
- Renaming gameplay mode ids should include a compatibility window for legacy persisted values, or older sessions/routes can silently fall into wrong mode branches.

## Chat bracket color parity for class-highlighted names (2026-05-29)

**Implemented / checked**:
- Updated battle-chat name rendering so `[` and `]` brackets use the same class color as the player name.
- Applied the same rule to both actor and target bracketed names in battle narration lines.

**Lesson**:
- If player tags are visually bracketed, color semantics should apply to the whole token (`[name]`), not only the inner text, or class highlighting looks inconsistent.

## Yumen minimap two-style ring rule (2026-05-29)

**Implemented / checked**:
- Simplified current safe-zone ring visuals to only two styles: blue or yellow dotted.
- In countdown/shrinking (non-waiting) phases, current ring now consistently renders as yellow dotted; no solid yellow fallback remains.

**Lesson**:
- When visual semantics are player-facing rules, remove fallback color variants that can reintroduce ambiguity across nearby phases.

## Yumen minimap waiting-phase blue-circle correction (2026-05-29)

**Implemented / checked**:
- Updated minimap current-circle styling so `waiting` phase always renders blue only.
- Kept yellow dotted styling only for active `shrinking` current circles, preserving the phase visual contract.

**Lesson**:
- Safe-zone phase coloring should be explicit per phase (`waiting`, `countdown`, `shrinking`) rather than inferred from fallback current-circle styling.

## Yumen minimap merged-ring blue-priority adjustment (2026-05-29)

**Implemented / checked**:
- Added overlap detection for current-zone and future-zone minimap circles.
- When yellow current ring and blue future ring are effectively merged, the yellow ring is suppressed so the minimap displays a clean blue circle.

**Lesson**:
- For layered circle overlays, merged-state rendering needs explicit priority rules, otherwise two valid styles combine into an unintended third color cue.

## Yumen minimap future-zone visual regression fix (2026-05-29)

**Implemented / checked**:
- Restored minimap zone semantics so the future safe zone is rendered in blue during countdown/shrinking phases.
- Shrinking current zone now renders as a yellow dotted circle, while non-shrinking current zone keeps a softer yellow solid outline.
- Distance text now measures against the future (blue) target zone when that future circle is visible, matching minimap visual intent.

**Lesson**:
- For staged shrinking circles, minimap visual coding and distance-reference logic must use the same phase-aware target/current selection, or players see contradictory guidance.

## Yumen auto-settle immediate trigger correction (2026-05-29)

**Implemented / checked**:
- Fixed `/cheat/yumen/auto-settle` so enabling the checkbox performs an immediate settle evaluation against current alive count.
- When `autoSettle` is enabled and alive count is already `<= 1`, the route now sets `gameOver`, writes `winnerUserId` + `yumenResults`, appends `YUMEN_GAME_END`, and broadcasts those patches in the same update.

**Lesson**:
- Toggle routes that enable automatic behavior should evaluate the terminal condition immediately, not only rely on a future loop tick or unrelated state nudge.

## Battle-start consumable stock correction (2026-05-29)

**Implemented / checked**:
- Updated the authoritative backend starting consumable stock to: 绷带 12, 金疮药 2, 月影沙 1, 砂石伪装 4.
- Synced the frontend BattleArena fallback consumable list to the same counts so local HUD defaults match backend truth before live state arrives.
- Updated the HUD coverage test assertions for `STARTING_CONSUMABLE_COUNTS` so regression checks enforce the new values.

**Lesson**:
- Starting consumable counts are duplicated between backend runtime defaults, frontend fallback display config, and string-based HUD checks. Keep all three in sync in the same change to avoid UI/runtime drift.

## Yumen prep restart and multiplayer follow-up (2026-05-29)

**Implemented / checked**:
- Fixed Yumen presence chat so initial WebSocket subscribe emits `【玩家】加入了战场。`, while `重新连接` only emits after a recorded disconnect; Yumen disconnect chat now ignores stale generic leave notices.
- Disabled the generic `/game/end` leave-notice and delayed no-winner game-over finalizer for Yumen, and guarded the frontend no-winner redirect in this mode.
- Made existing-loop `/battle/start`, next-battle start, and the new `重新开始游戏` route apply the same `准备时间` prep through `addBuff()`, while resetting the Yumen safe zone to idle so auto poison waits for prep exit.
- Fixed multiplayer damage floats to use target-user screen bounds instead of the primary opponent fallback, and made every enemy avatar use the red enemy palette.
- Matched cooldown numbers to the system-chat yellow and reduced cooldown number size/weight.
- Follow-up live verification caught auto-full-shrink racing before the prep buff reached the client; shrink-start routes now reject active `准备时间`, and the frontend only marks auto-start complete after a successful start.

**Lesson**:
- Suppressing a disconnect modal is not enough if the backend still creates `leaveNotice` and delayed no-winner game-over state; mode-specific lifecycle behavior must be disabled at the source.
- Runtime prep buffs should be applied in every battle-start path, including idempotent existing-loop paths, or live reload/second-client starts can skip the official status-bar buff channel.
- Multiplayer UI anchors must key by target id. Primary-opponent fallbacks are acceptable only as a last resort in 1v1 views.
- Client-side auto-start gates are not enough for prep timing, because persisted local preferences can race initial state hydration. Server shrink-start routes must reject active prep and let the client retry after prep ends.

## Yumen prep phase, presence chat, and cooldown HUD (2026-05-29)

**Implemented / checked**:
- Added the `准备时间` runtime debuff for Yumen battle start through `addBuff()`, with ROOT, SILENCE, and STEALTH effects, and preloaded its metadata so the status bar can display it.
- Randomized Yumen players onto exported-map spawn points at `/battle/start`, then applied the 60-second prep buff before the game loop starts.
- Replaced spectator-only ability-bar mutation checks with a Yumen prep-window lock: spectators stay locked, and non-spectators can add/reorder/discard/open skill choices only while `准备时间` is active.
- Added server-persisted system chat for Yumen disconnect/reconnect presence and suppressed the old leave/disconnect modal in this mode.
- Added one-time server countdown announcements for `30/20/10/5/4/3/2/1` and `绝境开启!祝各位洪福齐天。`, deduped through match state.
- Split hotbar cooldown display between real cooldown and GCD-only overlays so GCD shows a gray wedge without numbers, while real ability and consumable cooldown numbers are larger, yellow, and flash red below 3 seconds.

**Lesson**:
- Prep-phase UI locks must have backend route enforcement; frontend P-panel gating alone can be bypassed by direct mutation endpoints.
- Presence announcements are best emitted by the WebSocket subscription manager in Yumen mode, but reconnect chat needs a prior-disconnect key to avoid initial subscribe noise.
- Runtime-only buffs must be included in preload metadata before relying on the official status bar or frontend buff-name gates.
- For hotbars, GCD is a shared timing overlay, not an ability cooldown. Track it separately so the user sees motion feedback without misleading cooldown numbers.

## Dash identity, diagnostics stalls, and live regression proof (2026-05-29)

**Implemented / checked**:
- Added stable `startedAt` identity to directional `activeDash` payloads and included it in backend broadcast signatures plus frontend duplicate filtering/observation keys, so repeated identical 蹑云逐月 casts are not mistaken for the previous dash.
- Removed sync timestamp from the frontend dash observation key; server resends of the same dash no longer count as new frontend dash starts.
- Changed recent-dash reconciliation so server position still updates authoritative local state, but the render position does not hard-snap during the dash settle window.
- Reduced diagnostic self-pressure by keeping frontend crash breadcrumbs in memory instead of JSON-parsing/stringifying localStorage on each wrapped console call, and by not uploading latency samples directly from the main-thread stall callback.
- Completed a live Playwright proof against `https://zhenchuan.renstoolbox.com`: 10 distinct frontend-observed 蹑云逐月 dashes, no `recent-dash-snap` or `hard-snap-xy` snapback correction probes.

**Lesson**:
- Repeated server-owned movement with identical velocity/direction needs an explicit per-cast identity. Do not use countdown sync time as dash identity; it changes on resyncs and can create duplicate frontend starts.
- A performance diagnostic can become the lag source if warning/stall logging performs synchronous storage or upload work. Keep hot-path diagnostics memory-first and flush outside the stall callback.
- Playwright trace/screenshot/video can add WebGL readback pressure during movement regressions. Disable them for live gameplay performance proofs.
- Test cooldown reset must clear all cooldown runtime fields, including `_cooldownProgress` and `globalGcdTicks`, or API-driven repeated casts can fail for the wrong reason.

## Lobby visibility and dash snapback regression (2026-05-28)

**Implemented / checked**:
- Changed lobby waiting-room visibility to depend on `started: false` instead of a one-player size filter, so full unstarted rooms still show in the lobby.
- Added mode-aware lobby counts/status and stopped auto-joining rooms that are already full.
- Added a live Playwright dash regression that creates one Yumen battle, enables test-short cooldown, performs at least ten frontend 蹑云逐月 dashes, and fails on `recent-dash-snap` or `hard-snap-xy` frontend correction probes.
- Reworked post-dash frontend reconciliation so local authoritative position still syncs to the server, but the render ref no longer hard-snaps during the recent-dash settle window.

**Lesson**:
- Lobby availability and lobby visibility are separate concerns: full rooms should be visible until started, while join/auto-join paths enforce capacity.
- Post-dash reconciliation should not use the same hard render snap as teleport/forced displacement. After a server-owned dash ends, sync local gameplay position to the server and let the render position settle to avoid visible snapback.

## Yumen cooldown toggle, Z rescue, and dash HUD correction (2026-05-28)

**Implemented / checked**:
- Added the missing `/cheat/yumen/test-short-cooldown` route and changed runtime cooldown clamping so real cooldowns are used unless `safeZone.testShortCooldown` is enabled.
- Split Yumen rescue into the old support-ground helper (`虚空救援`) and a new current-player `Z救援` route using a top-down first-hit height helper that also considers exported AABB tops.
- Replaced Yumen spawn slots with the copied eight XYZ coordinates and preserved spawn Z during battle initialization/random spawn assignment.
- Moved coordinate copying out of the ESC panel into a lightweight HUD widget, and removed the BattleArena-level minimap pose interval that could force parent re-renders during local dashes.

**Lesson**:
- A testing checkbox needs both a backend toggle route and runtime logic gated by that state; a frontend checkbox alone just produces generic 操作失败.
- For exported-map rescue, support-ground height and top-down first-hit height are different tools. Houses/roofs need a top-down query plus AABB fallback, while void recovery can keep the support-ground path.
- Avoid parent-level intervals for fast HUD pose updates in `BattleArena`; during dash they can make only the local player feel laggy even when the server and opponent view are fine.

## Target mark SVG refinements (2026-05-28)

**Implemented / checked**:
- Refined the custom target-mark SVGs for `云`, `斧`, and `剑` under `frontend/public/icons/marks`.
- Changed `云` to strict black/white only, broadened `斧` into a clearer axe-head silhouette, and rebuilt `剑` as a more balanced centered sword.
- Corrected the follow-up pass by returning closer to the first version's silhouettes and making only small targeted changes.
- Added transparent SVG target marks for `钩子` and `红鼓` from the supplied references.

**Lessons**:
- Small target marks need strong silhouettes before surface detail; a weapon mark that reads as a throwable object at icon size should be simplified into the canonical weapon shape.
- When the user prefers an earlier art direction, preserve that base and make minimal shape/color edits instead of fully redrawing the asset.

## Cooldown import and six-player Yumen controls (2026-05-28)

**Implemented / checked**:
- Restored the ability-editor `CD纠正` tab after it had been removed from source, including backend snapshot/status routes and frontend seconds-based editing.
- Parsed `frontend/真传技能细节.xlsx` with standard-library XLSX XML parsing because `openpyxl` was not installed. The correct repeated-table columns are skill name/CD at B/C and I/J, not A/B and H/I.
- Corrected the cooldown import to cover all 151 spreadsheet rows, convert seconds to 30Hz ticks, and mark each matched cooldown row as fixed. Sixteen current in-game abilities are absent from the sheet.
- Expanded the Yumen room cap to six players, added six exported-map spawn slots, and added Yumen test controls for random spawn assignment, gathering to middle, and Z-only top-down ground rescue.
- Removed future safe-zone display controls and target-ring rendering from the control panel, minimap, and 3D safe-zone overlay.
- Added a default-off ESC testing coordinate display with a copy button.

**Lesson**:
- The live app can still show a removed ability-editor tab if old build artifacts are running; verify source and git history before assuming the route still exists.
- For spreadsheet imports, inspect the actual XML cell columns before importing. In this sheet, IDs occupy A/H while skill names occupy B/I.
- Keep cooldown overrides in `ability-property-overrides.json` rather than editing base definitions by hand, so the review page status and runtime overrides stay synchronized.
- Yumen teleport/rescue controls should update the live `GameLoop` state first and broadcast precise position/velocity patches; waiting for Mongo would make test controls feel stale.
- Removing future-zone UI also requires removing minimap and 3D target-ring rendering, not only deleting the toggle button.

## 玉门关 KILL / 观战 death state (2026-05-28)

**Implemented / checked**:
- Replaced the Yumen-only `测试重置` death reset with a `观战中` spectator state: HP stays at 0, buffs/debuffs are cleared, ability hand is saved then emptied, owned zones/entities are removed, combat links/targets are cleared, and the spectator buff grants stealth, untargetable/invulnerable/damage immunity, +100% speed, and high multi-jump count.
- Added last-hit defeat attribution for Yumen using only the current damage event window. Player final hits broadcast `【被击败者】被【击败者】重伤，黯然离去。`; poison/no-player final hits broadcast `【被击败者】黯然离去。` and do not grant kill credit.
- Added `战意` as the Yumen kill reward: 30 seconds, refreshes on reapply, heals 16130 HP each second through the normal periodic-heal path, so heal reduction and 狂沙 healing penalty apply.
- Added `复活全部玩家` to the Yumen control panel and a Yumen-only backend route that restores full HP, removes `观战中`, and restores saved ability hands.
- Follow-up tightened the spectator state: death now clears consumable counts/cooldowns in the same broadcast as the emptied hand, `观战中` is registered as a debuff in preload so the official status bar shows it without normal cancel affordance, and runtime `战意` metadata is also preloaded so the buff appears on the official bar.
- Added a Yumen-only `自动满血` test toggle, default off. When off, fatal HP enters spectator death; when on, it restores HP through the old testing heal branch.
- Added Yumen spectator ability-bar locks in backend cheat/pickup mutation paths and frontend bar/preset mutation handlers, so a ghost cannot add, reorder, discard, or claim new skills.
- Added `YUMEN_DEFEAT` events for the frontend red-brush kill notice, plus draggable/resizeable kill-notice and alive-count HUD controls under ESC → 测试 → 击杀.
- Follow-up split Yumen ghost nameplate visibility from health-meter visibility, so ghosts can hide HP bars without hiding player names.
- Follow-up Yumen death cleanup now removes combat links for the defeated player and for opponents linked to that player, emits combat-exit events, and broadcasts the combat state patches so `战斗中` does not stick forever after death.
- Follow-up polished Yumen kill UI: softened and lowered the full-screen kill broadcast, removed the white backing, added custom placement plus width/height controls for the personal kill confirmation, redesigned `剩余人数`, and added a dark sandy screen veil for `狂沙`.
- Added a manual Yumen end-game route and result overlay. When alive count is at most one, the test control can store `yumenResults`, show rank/stat/reward rows, auto-leave countdown, and a `离开战场` action while skipping the old tournament-complete flow.
- Live-verification correction: the result overlay must sit above movable chat/map/HUD panels, or the ranking table can be covered at match end.
- Corrective pass: Yumen death chat is no longer rebroadcast from the generic post-cast defeat announcer. Live Playwright verified one real `观战中` death, then two follow-up casts kept the `重伤，黯然离去。` system-chat count at one.
- Corrective pass: ghost opponent names render gray, the 狂沙 veil is lighter and sand-colored, kill-broadcast/kill-confirm visuals were softened, and ESC test controls gained preview buttons plus a single true `剩余人数缩放` control.
- Corrective pass: Yumen settlement now uses rank-by-attendee scoring. In a two-player live verification, rank 1 scored 2 for 40 display stars and rank 2 scored 1 for 20 display stars.
- Added an `自动结算` test checkbox next to `结束战场`, default off, with live verification that enabling it at one alive player stores `yumenResults` and shows the result overlay.
- Corrective pass: `战意` now keeps its written 16130-per-tick heal as a raw flat number instead of passing through the normal flat-heal scale. It still cannot crit and still receives the 狂沙 heal penalty.
- Added a `测试缩短cd` Yumen control. Default off uses real cooldowns; when enabled, ability cooldowns and charge recovery are capped at 3 seconds for testing.
- Added the ability-editor `CD纠正` tab for entering cooldown seconds and marking each ability as 未修正 / 需要补充 / 已修正.
- Corrective pass: Yumen settlement header needs explicit CSS anchors for the small `队伍排名 x/x` label. Without `yumenResultTop` + `yumenResultTeamRank`, the label drifts from the modal's top-right.
- Corrective pass: Yumen auto-settle alive counting now also honors unresolved `YUMEN_DEFEAT` events (unless a later `YUMEN_REVIVE` exists), not only HP/flag snapshots.

**Lesson**:
- Death attribution for poison-zone modes must use the fatal tick's newest positive damage event, not historical damage fallback. Otherwise old player damage can incorrectly steal poison deaths and grant kill rewards.
- Clearing a player's hand inside the game loop needs an explicit full-hand broadcast patch; cooldown-only hand diffs do not tell the client that the whole bar was emptied.
- Runtime-only buffs must be registered in the preload `buffMap`; otherwise the official `StatusBar` silently drops them even though they exist on the player state.
- If a ghost/spectator state clears ability hands, it should also clear consumable runtime fields and explicitly broadcast those paths, or the client can keep stale item counts.
- Correction pass: the generic `checkGameOver()` testing reset can still fire immediately after ability damage, before the Yumen loop handles death. Tag battle states with their mode and skip that reset for Yumen, or `[测试重置]` can appear even when the Yumen death branch no longer heals.
- Correction pass: defeat attribution needs to accept `DAMAGE` events that carry actor/target but no numeric `value`; otherwise player kills become unattributed `大漠狂沙` deaths and `战意` is not granted.
- Correction pass: fresh lobby-created battle states need `playerNames` copied into runtime state so `YUMEN_DEFEAT` events can broadcast real names instead of undefined/fallback labels.
- Correction pass: Yumen alive-count and ghost visibility should also derive defeated users from `YUMEN_DEFEAT` events, because a client can receive the event before the corresponding spectator-buff patch is reflected in opponent state.
- Correction pass: no-attacker Yumen system chat still needs the defeated player's real battle name (`【玩家名】黯然离去。`), not a generic `游客` fallback. Prefer the game state's `playerNames` map over account/default names for battle-end chat.
- Correction pass: `战意` periodic heal should carry an explicit `noCrit` marker in the buff definition, and the periodic-heal runtime should honor that marker so future refactors cannot accidentally make it 会心 again.
- Correction pass: raw-value periodic heals must opt out of `FLAT_HEAL_SCALE`; otherwise a written value like 16130 can display as an 80万-scale heal after stat scaling.
- Correction pass: 狂沙 screen color should be a darker orange sand wash with only smooth radial color layers. Do not use repeating gradients or line textures for that overlay.
- Correction pass: Yumen result rank totals should come from actual attendee rows, not a hardcoded lobby capacity such as 20.
- Correction pass: test-only cooldown shortening should be an explicit match toggle, because always capping cooldowns hides real cooldown data while tuning CD values.
- Correction pass: event-derived ghost state needs a matching `YUMEN_REVIVE` event, not an HP-patch heuristic. Otherwise alive count can be instant after death but stale after revive, or revive can unlock backend buffs while the frontend still says `观战中`.
- Correction pass: mark Yumen deaths on the player state until revive. Relying only on an active spectator buff can let later casts rediscover the same 0-HP player and rebroadcast the same `重伤` chat.
- Correction pass: clearing consumables to `{}` also needs frontend handling; missing keys inside an explicit count object mean zero, not the item's starting count.
- Correction pass: `hideHpBar` was too broad for Yumen ghosts because it hid the whole billboard, including names. Use a separate `hideHealthMeter` flag when only HP/shield bars should disappear.
- Correction pass: manual Yumen game-over needs persistent `yumenResults` in state and timestamp normalization on the client; otherwise reconnects or server/client clock drift can break the result countdown.
- Correction pass: after adding Yumen HUD/runtime fields, keep the narrow `BattleArena` prop and helper union types in sync. Next production builds skip type validation in this repo, so use editor diagnostics or a focused type check on touched files to catch these issues.
- Correction pass: mode-specific ghost deaths must bypass generic defeat-announcement fallback after every cast. The Yumen loop already has a one-time `yumenDefeated` guard, but `/play` can still inspect historical fatal events unless explicitly skipped for Yumen.
- Correction pass: Yumen score/reward display is rank and attendee-count based, not damage/kills based. Keep this formula in a shared helper so manual settlement and auto-settlement cannot drift.
- Correction pass: auto-settle is a test preference, not the default match rule. Store it on `safeZone`, preserve it through safe-zone resets, and only finish the match automatically when the flag is true and alive count reaches at most one.
- Correction pass: keep the big center rank banner (`第x名`) and the small corner team rank (`队伍排名 x/x`) as separate layout rules so visual tweaks only affect the intended text.
- Correction pass: for auto-settle and manual-end guards, rely on the same defeat/revive event truth as the UI when state snapshots can lag one tick behind event emission.

## 临时飞爪 crash, minimap target zone, and diagnostics pressure (2026-05-28)

**Implemented / checked**:
- Fixed a `ReferenceError: Cannot access 's' before initialization` crash triggered after 临时飞爪 battle events. The root cause was battle chat rendering computing target color from `battleTargetName` before `battleTargetName` was initialized.
- Removed the in-game crash diagnostics panel/download/upload controls. Fatal crash diagnostics now log a structured report object to the browser console and still upload automatically to backend logs.
- Changed the yumen minimap distance text to measure against the blue target zone during countdown/shrinking phases, while non-shrink phases still use the current safe zone.
- Flipped the yumen minimap player marker by 180 degrees so its baseline facing matches the game while preserving left/right turn direction.
- Latest latency aggregation showed movement route backend processing remained low (usually 0-3ms, max under 30ms in the newest two-account run), but PM2 backend logs still had event-loop callback gaps and GC pressure. The likely self-inflicted source was diagnostics: each latency batch scheduled a full latency-log prune, while hidden-tab main-thread stalls uploaded repeatedly. Latency-log pruning is now debounced to at most one delayed prune window, and hidden-tab stall logging/upload is rate-limited.
- Follow-up live logs showed debounced latency-log pruning was still too heavy for active gameplay: each delayed prune could take about 1.1-1.4s and align exactly with backend event-loop/game-loop callback gaps. Normal latency uploads no longer schedule pruning; pruning should stay out of the gameplay request path.
- Follow-up minimap correction inverted the displayed Y axis for marker and safe-zone circles. The facing triangle already used the inverted screen-space basis, but the marker position did not, making the avatar walk backward or sideways relative to its facing.

**Lesson**:
- A minified TDZ error after an ability cast can be caused by secondary UI event rendering, not the ability execution path. Map the chunk offset before chasing the gameplay code.
- Manual diagnostic collection UI should not appear in gameplay. Prefer F12 console output plus existing server-side logs unless the user explicitly asks for export controls.
- Diagnostic tooling can become the lag source. Avoid running whole-log prune/parse work for every uploaded sample batch, and treat hidden-tab browser timer throttling as low-value noise.
- Debouncing an expensive diagnostic prune only reduces frequency; it does not make it safe for active battles if the prune still runs on the Node event loop. Keep whole-log pruning manual/admin-side or otherwise outside active gameplay.
- For SVG minimaps, remember screen Y increases downward. If the world/map convention is north-up, convert display Y with `mapHeight - worldY`; facing rotation must use the same inverted screen-space basis.

## 玉门关 battle-log, arena line, ESC, and lag probes (2026-05-28)

**Implemented / checked**:
- Reverted the local-viewer 狂沙 self-log exception and filtered battle narration by self/same-side actors so the player only receives opponent-related battle messages.
- Restored the 3D arena current safe-zone white line independently of minimap phase semantics; minimap code was not part of this correction.
- Changed ESC handling so channel/target selection state no longer intercepts the key before the ESC panel can open.
- Added thresholded `[LAG-PROBE]` timestamps for backend event-loop delay, game-loop callback gaps, slow ticks, DB saves, structuredClone cost, WebSocket broadcast cost, diagnostics batch writes, and frontend main-thread stalls.

**Lesson**:
- Minimap safe-zone semantics and 3D arena line visibility are separate surfaces. A minimap-only instruction should not gate or hide arena overlays.
- Self-authored or same-side combat narration can create both privacy/noise bugs and target-color bugs; battle logs should be filtered from the viewer perspective before formatting.
- Random lag diagnosis needs fresh correlated timestamps from both producer and consumer paths. Old PM2 logs or older latency-page samples should not be used as evidence for a new stall report.

## 玉门关 safe-zone speed, PM2 cleanup, and movement lag correlation (2026-05-28)

**Implemented / checked**:
- Changed the final yumen full-poison shrink from 25 to 0 to complete in 1 second in the fast/test timeline, and kept the legacy generic phase table's final 25-to-0 collapse at 1 second.
- Deleted the old `frontend`, `backend`, `rencipe-frontend`, and `rencipe-backend` PM2 apps, then re-added only this project's `frontend` and `backend` apps from `ecosystem.config.js`.
- Found the ESC panel root cause: state toggled, but the panel render was still gated to `collision-test`; the panel now mounts in yumen and was verified by both the bottom-right button and Escape key.
- Correlated two-window Playwright movement runs with fresh PM2 `[LAG-PROBE]` logs. The observed hard snap happened when frontend main-thread stalls (~700-800ms) overlapped backend game-loop callback gaps (~200-260ms); the tick body itself was usually only 1-5ms.
- Removed the movement route's per-request `GameLoop.getState()` clone by adding a direct `setPlayerInputForUser()` path that returns a tiny movement ack, and added thresholded movement-route and backend GC probes.
- Disproved a backend loop resync policy: skipping catch-up after large scheduler gaps avoided burst simulation but worsened movement ack latency in live two-window verification, so the policy was backed out.
- Aligned frontend local-physics catch-up with the backend 6-tick cap and added stall-aware soft XY reconciliation. Final live verification still saw browser stalls under local two-window stress, but post-stall corrections became soft (`~1.9-2.4u`) instead of the previous `5-6u` hard snap.

**Lesson**:
- Backend lag and frontend prediction must be correlated by timestamp before choosing a fix. In this case movement/collision work was not slow; the visible failure was a frontend stall plus backend scheduler gap causing a hard reconciliation snap.
- Do not call `GameLoop.getState()` from high-frequency movement POSTs just to find a player and return an ack. Full-state structured clones in the movement path add allocation pressure and latency; use a loop method that works on the authoritative state and returns only the required fields.
- A delayed game loop catch-up is not automatically wrong, but client prediction must tolerate delayed server positions. After local main-thread stalls, normal movement should soften large reconciliation deltas unless a server-owned movement source like dash, knockback, pull, or airborne correction requires authority.
- Validate loop scheduling policy changes with real movement metrics. A plausible resync/pause strategy can make authoritative input feel worse if it turns every server scheduler gap into gameplay time loss.

## 玉门关 safe-zone corrective pass 3 (2026-05-28)

**Implemented / checked**:
- Corrected yumen minimap circle semantics: wait/no target shows a single blue current circle; countdown/shrink shows current as yellow dotted and future target as blue on top, so overlap reads as blue.
- Flipped the minimap player marker left/right rotation and kept full-poison red styling only on the range/status row, not `已刷圈/总圈数`.
- Changed `追命` to 30 seconds and stopped removing it when leaving 狂沙, while avoiding outside-zone time counting toward the next stack tick on re-entry.
- Renamed yumen poison damage events to `狂沙`, allowed their self-hit battle log line, and added `暂停 / 继续 / 重置` controls with a resume endpoint that preserves paused shrink progress.
- Added the buff timer-visibility editor tab and preload/status-bar support for hiding only an individual buff's timer text.
- Mechanically reset 167 ability description `已修正` statuses back to `未修正`.

**Lesson**:
- Yumen minimap current/future layers must be phase-aware: current-only means blue, while current-plus-target means yellow dotted current under a blue future target.
- Pause/resume of a shrink phase must preserve both remaining time and elapsed progress; otherwise the loop can resume from a later visual progress point.
- Per-buff status display preferences belong in the shared buff override/preload path so editor choices and runtime status rendering cannot drift.

## HP nameplate CJK text, jump intent latch, and speed-buff expiry (2026-05-26)

**Implemented / checked**:
- Replaced 3D player/entity HP-name text with canvas-backed sprite textures using a CJK-capable font stack, while preserving the existing billboard/world-size scaling so names like `一` do not render as boxes or become tiny.
- Broadened the DOM icon-bar `.enemyName` fallback stack to include Linux CJK fonts without changing its 13.2px special size rule.
- Added a queued jump-intent snapshot that captures direction/backpedal state at jump keypress time and reuses that same vector for both local prediction and the backend movement POST. Facing/camera payloads still update independently for RMB camera/ability logic, so turning after takeoff does not redirect the current jump while the next queued jump can capture a new direction.
- Added a local next-buff-expiry timer so movement prediction, jump locks, channel refs, status/gates, and speed scale recompute immediately after a SPEED_BOOST/SLOW-style buff expires even if no fresh buff-array diff has arrived.
- Frontend build initially exposed a corrupted `Character.tsx` HP-name JSX block; repaired it with the same canvas-text path. Backend build and frontend build passed, PM2 `frontend`/`backend` restarted online, and live browser verification showed the Chinese HP name renders at the intended size with no page errors.

**Lesson**:
- Drei text/font fallback can still miss CJK glyphs in WebGL text. For small in-world nameplates with strict size rules, browser canvas text converted to a sprite is more reliable and keeps the existing billboard scale math intact.
- Jump direction is an input-time fact, not a render-time inference. Store the movement vector when the player queues jump; use it for both prediction and the server request, and keep facing/camera as a separate stream.
- Client movement speed cannot wait for a state diff to notice wall-clock buff expiry. Schedule a wake-up at the nearest active buff `expiresAt` so prediction drops stale speed boosts before snapbacks accumulate.

## Knockback, jump carry, shield, and stealth sound parity (2026-05-26)

**Implemented / checked**:
- 无间狱-style timed knockback now moves in small collision-resolved steps and stops when forward progress is blocked by map or 楚河汉界 walls; activeDash knockbacks also carry a `stopOnWall` flag.
- Backend jump start speed now only reuses airborne carry on the first jump; frontend prediction mirrors that rule so a second air jump does not inherit a spent movement-speed boost.
- Frontend locally consumes/filters 弹跳 after a boosted jump until the server diff arrives, and movement-caused buff mutations now force a buff broadcast from the backend.
- 应天授命 shield logic ignores expired buffs for post-hit effects, reconciles linked shield display against active shield buffs, and live checked that shield `100000000` drops to `0` after the 8s buff expires.
- Opponent ability/event sound playback now skips actors who are currently stealthed, and hidden opponent channel loops are removed from the active channel-sound set.
- Live checked refreshed frontend: 扶摇直上 applied 弹跳, jumping removed backend buff `9001`, and the visible 弹跳 status count dropped from `1` to `0`. Built-code wall check showed a `stopOnWall` dash stopping at the wall boundary and clearing `activeDash`.

**Lesson**:
- Knockback cannot be a single position add followed by recovery; wall-aware displacement needs substeps and must stop based on forward progress into the wall, not total sideways slide distance.
- Jump prediction must treat movement-speed carry as a phase-local resource. The first jump may carry the boosted takeoff speed, but a later air jump should recalculate from current speed and ignore stale airborne carry.
- One-shot movement buffs need optimistic client consumption plus authoritative diff broadcast. If either side misses it, status bars and hotbar gates can think the buff still exists.
- Shield UI should display active linked shield pools, not stale numeric shield fields. Stealth privacy applies to audio/event loops too, not only targetability, visuals, and combat text.

## Expired buff runtime cleanup (2026-05-25)

**Implemented / checked**:
- Runtime buff/channel predicates now treat expired entries as inactive across backend guards, movement/jump locks, targeting, combat math, range modifiers, projectile immunity, stealth/disguise helpers, and frontend BattleArena gates.
- Linked shields now reconcile against only active shield-bearing buffs; natural expiry, turn cleanup, buff replacement/cancel, and damage depletion clear linked shield pools instead of leaving `shield` behind.
- Channel HUD bars and 3D channel rings now self-expire by time on the client, so a stale non-null buff/channel object cannot keep 风来吴山 visuals or jump suppression alive after expiry.
- Live checked 风来吴山: buff applied and bar appeared, then after expiry backend buffs/channel were empty, the channel bar DOM was empty, and a jump movement request was accepted.
- Live checked 月影沙 stealth: stealth/no-jump buff applied from consumable, then after expiry the player had no stealth buff and no remaining buffs.
- Built-code shield check confirmed an expired linked shield zeros its `shieldAmount` and normalizes total shield down to active linked shields only; removing the active linked shield drops total shield to zero.

**Lesson**:
- Buff expiry cannot rely only on array cleanup. Every runtime predicate and frontend display/gate path must check `expiresAt`, because a stale buff object can persist long enough to keep locks, stealth, shields, damage modifiers, or channel visuals alive.
- Linked effects need explicit cleanup hooks. Shields, channel indicators, stealth privacy, and movement locks should be removed or ignored from the effect source itself, not inferred later from a cosmetic/status refresh.

## In-game chat window/account layout polish (2026-05-25)

**Implemented / checked**:
- Added the `battle` chat channel/window path and render battle messages from server `DAMAGE` combat events on the client, keeping battle text white while coloring actor/target names by stored player school.
- Wired battle-chat generation from both WebSocket event payloads and the successful `/play` HTTP patch response, and allowed `DAMAGE` events with entity targets as well as player targets.
- Moved the chat scrollbar into the real left control rail and removed the right-side fake scrollbar; search opens/closes as a dropdown inside the message column without shifting the rail.
- Follow-up: search/log now sit inside a dedicated message column so opening search reduces the log viewport instead of overlaying the first visible message or changing the left rail geometry; the rail track was simplified to a single thumb layer and edge-disabled buttons were dimmed.
- Follow-up: battle chat now emits separate `PLAY_ABILITY` hit logs and `DAMAGE` logs in MMO-style wording, with self-perspective `你/你的` text and `[未知目标]` for stealthed actors or targets observed by other clients.
- Follow-up: chat history refresh now merges server chat with local battle messages instead of replacing the entire chat list, closing search clears the query so stale filters do not hide new battle lines, battle event seeding now runs after game-id reset while new `state.events` changes are consumed as a fallback to `/play` responses, and duplicate near-simultaneous `PLAY_ABILITY` events for one cast collapse to one hit line.
- Follow-up: battle chat now behaves as an enemy-action report: local self-authored events are hidden for the local viewer, stealthed enemy actors are skipped entirely, `DAMAGE`/`HEAL` events feed action-style hit lines instead of amount math, consumable use responses are read for battle events, 金疮药/绷带 emit action events even when no HP is restored, detached chat panels auto-scroll when already at bottom, and the disabled left-scroll thumb is fully hidden.
- Follow-up: detached battle-log auto-scroll needed layout-timed bottom following; a separate metrics refresh could mark the detached log as no longer at bottom before the sticky-scroll effect ran. Chat window settings now treat “关闭窗口” as a hidden-window flag that preserves detached group membership and position, and the chat panel waits for account layout loading before painting to avoid the default-position snap.
- Follow-up: local battle logs are now the only chat messages capped client-side, limited to 200 entries; map/system chat history remains session-scoped. Battle-log generation also filters by the enemy actor's distance to the local player, while normal chat delivery and history are unaffected.
- Follow-up: combat-log visibility range was raised to 200 units. A live system snapshot during reported lag showed MongoDB idle with a tiny local DB and no lock queue; the notable CPU sample was the backend Node process, so lag checks should look at active GameLoop/backend work before blaming local Mongo reads.
- Follow-up: two-account live profiling with authenticated API/WebSocket clients showed the heaviest server-side phase was combined movement+ability traffic: backend Node used about 18% of one core, while `mongod` stayed under 1% and disk read/write bytes stayed at 0. Backend active time was dominated by app/framework serialization plus repeated `GameLoop.getState()` structured clones from movement/snapshot/ability paths; direct movement/collision, ability logic, and WebSocket send time were small in the profile.
- Follow-up: a two-account state-diff audit showed normal movement diffs are small position patches, but ability/test-helper traffic still sends excess full arrays: generic `diffState()` replaces the whole `players` array on ability state changes, and reset-cooldowns replaces each whole `hand` array when only cooldown/charge fields changed.
- Made detached chat groups account-backed through `battleArenaUiLayout.chat.detachedWindows`, `detachedPanelSizes`, and normal detached position keys, while excluding the transient clear dialog position from account layout writes.

**Lesson**:
- Chat UI persistence needs to store both structure and geometry. Detached tab groups are not recoverable from positions alone; save group/window membership, group size, and group position together.
- Combat-system chat can be derived from authoritative event payloads instead of a separate chat write path when the messages are local combat narration. Use the existing event metadata and player-name/school maps so battle messages stay synchronized with live combat state.
- The local caster may receive combat events through the `/play` response before or instead of a WebSocket event payload, so battle chat must read successful action patches too.
- Battle chat should seed/remember combat event ids from the loaded game state before appending live event logs; `/play` responses can include historical `state.events`, so unseeded generation can replay old combat lines after reload. Keep the game-id reset before the seed effect, or the reset can wipe the dedupe seed on mount.
- Server chat history only contains persisted chat, while battle narration is currently client-local; refreshing/searching chat must merge rather than replace or it can erase fresh combat logs.
- Some ability execution paths emit more than one `PLAY_ABILITY` event around the same cast; client battle narration should dedupe near-simultaneous hit lines by actor/target/ability while leaving separate `DAMAGE` events untouched.
- Stealth-sensitive combat logs are best personalized at the client display layer using the pre-diff local state: the hidden player still sees `你`, while observers see `[未知目标]` for stealthed actors or targets in hit and damage lines.
- Enemy-action battle feeds should skip local self-authored entries for the local viewer, skip stealthed enemy actors entirely, and consume `HEAL`/`DAMAGE` as action events when the UI should report activity rather than numeric calculations. Consumable `/use` responses need the same battle-event consumption as `/play` responses, and consumables that should be reportable must emit events even when the applied heal is zero.
- Detached chat panels need their own at-bottom refs and display-length bookkeeping; the main chat `chatAtBottomRef` does not tell detached windows whether they should follow new messages.
- Do not update detached chat at-bottom refs in a generic metrics effect before the auto-scroll decision has run. New content increases `scrollHeight` first, so measuring too early flips “was at bottom” to false and prevents the intended scroll-to-bottom.
- Keep chat history caps channel-specific. If only combat logs need pruning or proximity filtering, apply that in the local battle-message generation path rather than in shared chat append/history merge code, or normal map/system messages will be lost or hidden incorrectly.
- Local MongoDB being on-box does not automatically mean DB read pressure. Check `mongod` CPU, lock queue, connection count, and DB size first; if `mongod` is idle but backend Node is hot, investigate active game loops, event volume, or render/network paths instead of switching databases prematurely.
- For CPU profiling, do not load the full 3D scene when isolating backend cost: headless Chromium software WebGL can consume a core by itself. Use lightweight authenticated HTTP/WebSocket clients, then compare process CPU with Node inspector samples, Mongo serverStatus counters, socket frame counts, and request latency.
- Current Zhenchuan backend hotspots under two-player casting are mostly state snapshot/cloning/serialization paths, especially `GameLoop.getState()`, plus some Mongoose/BSON work from snapshot/cheat/chat saves. Movement collision and ability execution were not the primary CPU consumers in the measured run.
- State-diff trimming and `getState()` clone reduction are related but separate. Trimming `STATE_DIFF` reduces network/JSON stringify/parse and frontend patch work; optimizing `getState()` reduces backend structuredClone CPU even for routes that return HTTP snapshots or validate input without broadcasting.
- State-diff array granularity must preserve identity/order safety. Patch `players` and unchanged-slot `hand` arrays by index, but fall back to whole-array replacement when player/card/entity identities change so removed fields and reorders do not leave stale client state.
- Cooldown, GCD, and activeDash countdowns should be sparse server sync fields plus local client countdowns. Sending only start/reset/end boundaries removes 30Hz countdown payloads while preserving responsive hotbar grayout and dash prediction.
- For reset-cooldowns, treat undefined cooldown-like fields and zero as the same ready state. Otherwise a reset route can avoid whole `hand` arrays but still flood clients with semantic no-op zero patches.
- Sparse activeDash sync must not let local countdown ticks become sample identities. Only new server positions or a new dash sync should re-anchor dash prediction; otherwise the render bridge can reset against stale positions and create directional dash lag or short duplicate dash starts.
- Local cooldown countdowns should animate on `requestAnimationFrame` while any timer is active, then fall back to an idle check interval. A fixed 250ms React clock preserves correctness but makes cooldown arcs visibly step.
- Resource-pack service workers should not intercept app document navigations such as `/game/in-game`; only cache asset requests. Intercepting navigations can surface `FetchEvent ... network error response` noise during reloads or route changes.
- For this MMO-style chat panel, the visible scrollbar belongs in the left rail control area. A separate right overlay reads as the wrong control even if it tracks the same scroll position.

## Alpha passed / beta stage start (2026-05-24)

**Milestone**:
- The project officially passed alpha stage on 2026-05-23 and is now moving into beta-stage feature work.
- Beta work begins with the official `P` 武学界面 / 绝境武学 ability panel, replacing the ad hoc 添加技能 flow with a player-facing panel that stays synced with the six-slot 技能栏.

**Implemented**:
- Added the official 武学界面 with 江湖/绝境 tabs, default 绝境 open state, search, 门派/稀有度 custom filters, 8-column ability grid, rarity icon borders, active six-slot strip, right-click add/remove, drag-to-slot, drag-swap, and local preset save/load controls.
- Reused the same draft ability state and reorder/discard routes as 技能栏; extended add-ability with an optional target `slotIndex` so list-to-slot dragging can place a new ability directly into a chosen active slot.
- Added 武学界面 to custom UI positioning and an ESC 测试 slider for temporary panel size tuning.
- Refined the beta 武学界面 to match the reference layout more closely: separate ESC width/height controls, left-aligned tabs/filters, 8x3 instant row-wheel list scrolling with a custom scrollbar, same-style active slots, account-backed six-slot preset plans, save/rename modals, attached preset side panel, and temporary title-bar dragging.
- Hardened the beta 武学界面 slot semantics: active slots and preset plans now reject duplicate ability ids, dragging a checked library ability moves its existing slot, checked abilities show a green check badge, right-clicking a checked library tile removes the learned ability, and preset slots swap existing entries instead of repeating them.
- Split 江湖 into a display-only page with 防身武艺、基础招式、江湖轻功、奇穴 rows; moved all 武学界面 size controls into a dedicated ESC 测试 tab; added a modal-size setting; and polished the panel defaults, active strip, preset side panel, custom scrollbar visibility, filter controls, and input isolation.
- Completed a fourth beta polish pass: no-slot add-ability now appends to the next open learned slot instead of slot 1, checked library tiles keep only the top-right badge, filter/search/scrollbar/preset spacing was tuned, the last martial tab is remembered, 江湖奇穴 sits shorter at the bottom, active/preset slot sizes were aligned, the 绝境 bottom strip now has 已学习招式 and 已激活增益 sections, learned abilities can be dragged back to the library to unlearn, ESC closes the martial panel first, bottom-right ESC/C/P icon toggles were added, and the legacy 添加技能 test picker is hidden behind an ESC 测试 switch by default.
- Completed the next beta 武学界面 refinement pass: split 门派/稀有度 filter widths, reduced the main/preset panel gap to 2px, moved the ESC quick button to the rightmost gear icon and changed the stats quick icon to a person icon, rebased the preset modal to a smaller 0.5-1.0 scale with responsive internals, made preset plans scroll four-at-a-time by one plan per wheel step, removed discard/delete success toasts, turned 已激活增益 back into a placeholder area, moved 已学习招式 to the right side, and decoupled learned slots from temporary special hotbars/hover state.
- Completed a follow-up beta 武学界面 refinement pass: neutralized selected filter button border/arrow color while keeping option colors, aligned filter row heights, kept bottom-right quick buttons visually neutral when open, restored preset modal horizontal layout with separate ESC width/height controls, added preset-plan 置顶, added placeholder hover on 已激活增益, preserved learned-slot display through temporary special hotbars, added 收藏技能 ordering mode, and improved panel/grid responsiveness on smaller PC viewports.
- Completed another 武学界面 refinement pass: selected dropdown text keeps its rarity/school color while borders/arrows stay neutral, 收藏模式 uses lighter grayscale and hides learned check badges, 收藏模式 helper text is yellow with clarified copy, the preset modal's old 0.6 size became the new 1.0 with responsive internals, ability hover hints close when P closes, the P/preset panels now render from viewport proportions plus scale settings, preset drag-hover boxes were removed, plan/learned/placeholder slots share the same hover glow, and the checked badge border was reduced.
- Completed a focused 收藏/预设 polish pass: 收藏模式 hover and active visuals are now distinct (no more hover-looking active confusion), favorited skills show a red top-right minus badge for direct un-favorite, favorite ordering storage is now account-scoped with legacy migration to the logged-in user key, and 保存预设 modal now keeps prompt text and target buttons on separate rows.
- Completed a micro-visual follow-up: reduced the 收藏红色减号 badge footprint by 20% and tightened 预设页 six-slot gap spacing by 30% for a denser card layout.
- Completed a follow-up correction: 收藏红色减号 now renders only while 收藏模式 is active, and the badge was reduced again to a much smaller footprint for a clearly visible difference from the previous pass.
- Completed another visual correction: increased 收藏红色减号 from ultra-small to a clearer medium-small size, and strengthened 收藏模式非收藏项 gray-out (higher grayscale, lower saturation/opacity) to make favorites stand out more.
- Completed a responsive 武学界面 correction: missing size settings now fall back to intended defaults instead of the 0.1 minimum, and ability columns/visible rows, icon sizes, gaps, footer height, bottom learned/buff slots, and preset card density derive from the actual panel dimensions so lower-height PC windows do not crush the ability list into the bottom strip.
- Completed the ESC 快捷键设置 polish pass: shortcut actions now render one per row with two binding boxes, skill/common/item rows use generic slot labels, 骑乘 has no default T binding, right-click clearing runs through context-menu handling, hotkey edits are staged behind 确定/取消/应用, 恢复配置/清除 moved to the footer, 物品栏 settings moved under 游戏设置, and ESC 测试 martial size sliders now start from system defaults instead of per-browser saved values.
- Completed a follow-up hotkey readability pass: 技能栏 shortcut boxes now sit directly next to their row labels instead of stretching to the far right, row spacing/height was tightened, item-bar hotkey text is 30% larger in white, and wheel bindings now render as MU/MD on the in-game skill/item bars instead of raw WU/WD.
- Completed a follow-up alignment correction: hotkey rows now use a fixed label column plus an explicit label-to-box gap so longer labels no longer push binding boxes sideways, and each shortcut binding box was widened by about 30% for a more even desktop layout.
- Completed a final hotkey color adjustment: the displayed shortcut text inside ESC shortcut binding boxes now renders in white instead of yellow for better consistency with the rest of the settings panel.

**Lesson**:
- Large new UI features should first trace the full existing gameplay, slot, route, and custom UI systems before implementation so the official surface shares live state instead of duplicating it.
- When two UI surfaces represent the same combat slots, render both from the same slot array and route all changes through the same live-state endpoints; otherwise hotbar/panel drift is almost guaranteed.
- Preset-like combat UI should save complete slot arrays, including empty slots, so applying a plan is deterministic instead of compacting abilities into earlier slots.
- Scrollable combat panels should avoid browser-native scrollbars; custom row paging gives better speed control and a more consistent in-game look.
- Duplicate prevention for combat slot UIs must live in backend routes as well as frontend affordances. UI checks make the interaction feel right, but route-level de-duping keeps account presets, live hand state, and pickup/draft edge cases from drifting back into invalid repeated slots.
- Optional slot parameters need explicit null handling. Passing no slot must not flow through numeric normalization as `0`, or append-style UI actions can silently become front-insert/swap actions.
- Keep permanent learned-slot state separate from temporary special ability bars. Short-lived replacement hotbars should not change preset saves, learned-slot rendering, or hover feedback in the 武学界面.
- 收藏/置顶 style ordering should be a display-order layer over the canonical ability list. Keep the user's favorite order separate from school/rarity/search filters so favorites stay easy to find without mutating ability definitions or live draft slots.
- For desktop-only game panels, prefer viewport-ratio defaults multiplied by user scale settings over fixed pixel defaults; this keeps the same screen footprint across different PC resolutions while still preserving custom sizing.
- When a toggle has both hover and active states, keep them visually distinct; sharing the same color creates false-state confusion when the pointer is still over the control.
- For 武学界面-style panels, derive not only outer size but also visible row count, grid columns, slots, card count, and toolbar widths from the rendered dimensions; a fixed 8x3 grid plus fixed bottom strip will overlap as soon as viewport height drops.
- LocalStorage numeric settings need explicit null/empty handling before `Number(value)`. `Number(null)` becomes `0`, which silently clamps absent martial size settings to the minimum instead of the default.
- Shortcut settings should stage edits separately from the saved binding profile when the UI exposes 确定/取消/应用. Immediate localStorage writes make a disabled/enabled Apply button and cancel behavior impossible to reason about.
- For compact in-game panels, clipping overflowing labels is preferable to adding ellipsis; the dots consume scarce horizontal space without making the control clearer.
- For hotkey-setting rows, avoid flexible full-width binding columns when the intended layout is label-plus-inputs. A max-content row track plus fixed-width binding cells keeps the two shortcut boxes visually attached to the label instead of drifting to the right edge.
- When labels and inputs must align in a settings grid, keep the label column fixed to the longest expected label width. Using content-sized label tracks makes every row start at a different X position as soon as one label is longer than the rest.
- For dense ESC settings panels, keep the editable shortcut text color consistent with other neutral UI labels unless a specific warning or capture state needs a highlight color.

## Local DB config drift and dash smoothing (2026-05-25)

**Implemented / checked**:
- Restored source/config parity for local MongoDB: `backend/db.ts`, PM2 env, package DB scripts, git snapshot exceptions, and the China VM runbook now agree on local `zhenchuan_app` instead of hardcoded `baizhan_V2`.
- Added dash render prediction during active server-authoritative dashes so the frontend keeps moving between server movement samples instead of freezing at the last authoritative position.
- Added a focused Playwright spec for dash render prediction and gap diagnostics.
- Follow-up: browser logs showed activeDash samples sometimes arriving/rendering 195-224ms apart while backend dash timing stayed near 30Hz. Expanded the client-side dash bridge to 8 ticks and raised warning diagnostics so covered gaps do not produce false alarm warnings.
- Follow-up: confirmed the dash bridge is ability-agnostic because it consumes the shared `activeDash` velocity/tick shape, added regression coverage for horizontal, ground-target, knockback-style, and vertical lift dashes, and made backend `[DASH]` end logs report expected duration from the actual starting tick count instead of hardcoding 30 ticks.
- Generalized the dash debugging method: compare authoritative backend timestamps/counters against client-observed render/network sample gaps, then add diagnostics at the handoff boundary where the two clocks disagree. This catches "backend is fine but frontend sees stale samples" bugs faster than only watching one side.
- Local DB is now branch-locked to `mongodb://127.0.0.1:27017` + `zhenchuan_app`; app startup and snapshot scripts refuse remote MongoDB URIs or other DB names. Added local user maintenance commands and seeded `testuser1` / `testuser2` for Playwright/manual auth checks.
- Follow-up: real browser logs showed occasional 269-448ms activeDash sample gaps while backend dash durations still stayed close to expected. Increased the client bridge to 20 ticks and only warn beyond 650ms, because gaps inside that bridge are now covered by prediction instead of indicating a visible stutter.

**Lesson**:
- A faster server response can expose frontend/server handoff bugs: activeDash may reach the client before the first movement tick, so hard-snapping to server position without short lead prediction can look like a mid-air freeze.
- Dash diagnostics from the React render path measure client-observed sample gaps, not necessarily backend tick pauses. Cross-check PM2 `[DASH]` timings before blaming the game loop or database.
- Dash smoothing tests should cover shapes of `activeDash` rather than only named abilities; the frontend bridge must follow velocity/tick fields so new dash abilities inherit the same render behavior automatically.
- For slow-latency and new-bug investigations, log both the producer timeline and consumer timeline with the same entity/action id. A mismatch between "server advanced" and "client sample/render did not" points to transport/render handoff; matching stalls point back to authoritative processing.
- Admin/test account maintenance now makes `testuser1` and `testuser2` admins.
- Follow-up: account switching now uses remembered authenticated browser sessions instead of selecting any local account. The switch list shows only already-authenticated accounts and is allowed only when the current or remembered sessions include an admin; first-time account add still goes through `/login`.
- Display-name changes now require a unique 1-6 Chinese-character name; `testuser1` / `testuser2` display names are `一` / `二`.
- Follow-up: topbar account menus should use fixed overlay positioning with visible overflow instead of internal scrollbars; native scroll in the panel can still leave the menu visually cut off and adds unwanted page/panel scroll behavior. Chinese display-name inputs should validate on confirm, not filter during typing, because IME/input composition can wipe partially typed Chinese text.

## China VM deployment planning (2026-05-23)

**Planning / finding**:
- Current production shape is two PM2 Node processes: Next frontend on `3000` and compiled Express/WebSocket backend on `5000`, with MongoDB via `MONGO_URI` and `/ws` proxied to the backend.
- A first mainland China deployment should start around `4 vCPU / 8 GB RAM / 80 GB SSD / 10-20 Mbps`; use `16 GB` if MongoDB is local, multiple 5-player rooms are expected, or build/install work must happen on the VM under pressure.
- Five-player gameplay is not just infrastructure: `startGame` allows up to 5, but `joinGame` still caps rooms at 2 and backend loop/channel logic still has some 2-player assumptions.
- Mainland VMs generally support SSH and VS Code Remote SSH, but ICP/domain rules, provider security groups, China-side npm/GitHub speed, and same-region MongoDB matter for a smooth launch.

**Follow-up correction**:
- For a tighter budget, `2 vCPU / 16 GB RAM` is a more realistic floor than insisting on `4 vCPU`. The backend is a single Node process, so extra cores are mainly headroom for frontend/nginx/Mongo contention rather than an absolute requirement for one active room.
- `80 GB` disk is comfort, not a hard floor. Shipping built artifacts from the dev machine can fit into `40-60 GB` if MongoDB is external and logs are managed.
- If the app VM is in mainland China but MongoDB Atlas stays in the US, cross-border DB latency and route instability are likely a bigger operational risk than raw VM size. For this scale, a local MongoDB on the VM is acceptable if it binds to localhost, has backups, and the VM keeps enough RAM headroom.
- Oracle's public OCI pricing pages state pricing is globally consistent across locations, and Oracle lists Japan as a country with two cloud regions. Using the higher public hourly rate for budgeting, an x86 E4 VM at `1 OCPU / 16 GB` (`2 vCPU / 16 GB`) is about `$36/month` before storage, `2 OCPU / 16 GB` (`4 vCPU / 16 GB`) is about `$54/month`, and `40-60 GB` block storage adds only about `$1.02-$1.53/month`.
- Oracle's Ampere A1 free tier is unusually attractive for low-budget deployment: up to `3,000 OCPU hours`, `18,000 GB hours`, and `200 GB` block storage monthly. In practice that can cover one `4-core / 24 GB` Arm VM if the chosen signup region has capacity, but it should be treated as best-effort capacity rather than a guaranteed production baseline.

**Lesson**:
- For this app, a China deployment runbook must cover nginx WebSocket proxying, same-region MongoDB, PM2 process scoping, fresh VM env files, and asset/build shipping. A copied `.next` directory alone is not enough because the frontend is not using Next standalone output.
- Oracle is a strong cost candidate when the goal is low monthly spend, but the real comparison is not only VM list price: x86 gives the least deployment friction, while Arm/free-tier value is better only if region capacity and package compatibility cooperate.

## Shortcut locked role actions and backend storage audit (2026-05-23)

**Implemented / checked**:
- Added locked, gray ESC 快捷键 rows for 角色动作 and made the exact W/S/A/D, arrow, Space, and T bindings unavailable to editable shortcut tabs.
- Added 界面开关 shortcut rows for 人物属性 (`C`) and 技能界面 (`P`), with 技能界面 toggling the existing 添加技能 panel.
- Replaced per-row 清除 buttons with right-click behavior: right-click while editing cancels capture; right-click while not editing clears the binding.
- Confirmed live MongoDB connection uses database `baizhan_V2`; current backend code writes account/profile data to `users` and game sessions to `gamesessions`, while editor override JSON and diagnostics JSONL logs live under `/home/ubuntu/zhenchuan`.

**Lesson**:
- Role/movement keys need a reserved binding layer before user-editable shortcuts are normalized or captured. Otherwise old browser-local shortcut saves can silently steal movement keys even after the UI displays them as locked.

## Ability grayout combat warnings (2026-05-22)

**Implemented**:
- Centralized BattleArena hotbar grayout reasons so disabled draft/common/special ability buttons keep a concrete `disabledWarning` string.
- Routed disabled hotbar clicks and hotkeys through the existing 战斗警告 overlay instead of silently doing nothing for cooldown, GCD, channeling, power locks, control states, targeting, range, facing, and line-of-sight failures.

**Lesson**:
- Ability readiness and disabled-click feedback must share the same predicate path. If `isReady` only returns a boolean, the UI can gray an icon without knowing what message to show when the player tries to use it.

## Common qinggong stale displacement grayout (2026-05-22)

**Finding / fix**:
- Common directional qinggong applies a short Dash Runtime buff with `DISPLACEMENT`; if the frontend state still contains that buff after its `expiresAt`, BattleArena's grayout predicates treated it as active and could lock most/all abilities with qinggong/displacement warnings.
- Added a shared active-buff filter for BattleArena client predicates so expired player buffs are ignored locally even before the next `/players/*/buffs` patch removes them from React state.

**Lesson**:
- Frontend gameplay gates must not treat a buff array entry as active solely because it is still present in client state. Always apply the `expiresAt` guard locally for lock, control, targeting, range, and visibility predicates; compact state diffs can arrive after wall-clock expiry.

## Post-dash jump prediction hitch (2026-05-22)

**Finding / fix**:
- Backend dash movement clears air-shift and airborne speed carry at dash start/end so the next jump does not inherit dash or stale airborne speed.
- BattleArena's local active-dash prediction cleared velocity and air-shift but did not clear `airborneSpeedCarryRef`, so the first jump after dash could predict a longer travel budget than the server and then visibly reconcile.
- Cleared frontend airborne speed carry during server-authoritative dash/recent dash snap, and made the recent-dash hard-snap window yield to a freshly queued local jump.

**Lesson**:
- For movement prediction, mirror not only position/velocity constants but also transient carry-state cleanup. A stale local carry value after dash can look like network or frame lag because the next jump is locally overpredicted and then corrected by server state.

## Hidden buff display and shortcut settings (2026-05-23)

**Implemented / checked**:
- Added an ESC 测试 switch that leaves normal status bars unchanged by default and can flip StatusBar into a hidden-only mode using existing `hiddenInStatusBar` preload metadata.
- Rebuilt ESC 快捷键设置 with 技能栏、通用栏、物品栏 tabs, two bindings per row, global binding uniqueness, keyboard Ctrl/Alt combos, mouse buttons, and wheel up/down capture while preserving the existing default bindings.
- Confirmed accounts are stored by the backend `User` mongoose model in MongoDB database `baizhan_V2`, collection `users`; no `copilit`/`copilot` prefixed accounts existed in the active store, so the strict delete matched zero accounts.

**Lesson**:
- Debug visibility for hidden buffs should be a display-mode switch in StatusBar, not a mutation of buff metadata. Shortcut customization should layer over the existing defaults so camera/movement behavior remains unchanged until a user explicitly binds a conflicting mouse or wheel input.

## Resource pack predownload and cache service (2026-05-22)

**Implemented**:
- Added a standalone `/resource-pack` page reachable from the lobby so players can warm local browser cache before entering a game.
- Added `/resource-pack/manifest` outside `/api` because this project's Next `/api/*` paths are proxied to the backend before frontend route handlers.
- Added a Cache Storage + service worker resource pack for normal game URLs: icons, fonts, game audio/assets, exported map files, and Next static chunks.
- Moved lobby actions to `开始` → `下载资源包` → `校验`, with query actions that open the resource-pack flow directly.
- Changed the lobby `下载资源包` / `校验` actions to open an embedded same-origin modal instead of navigating away from the lobby; the resource-pack route uses its own page chrome and hides the global top bar.
- Added a download/check modal with file progress, cache completeness, live download speed, estimated remaining time, and last verification timestamp.
- Added exported-map asset discovery so GLBs, textures, terrain textures, heightmaps, and collision sidecars are included without manual upload.
- Made service-worker registration best-effort with a timeout and populated the manifest list before registration, preventing the page from staying at `0 / 0` if a browser's service-worker registration stalls.
- Switched the resource-pack manifest to include the real `/full-exports/...` game URLs with file sizes instead of adding zero-sized map URLs client-side.

**Lesson**:
- A zip file alone cannot make existing `<img>`, audio, GLB loaders, and `fetch()` calls read local resources. Browser predownload should use Cache Storage and a service worker so the original URLs resolve from local cache during play.
- Do not block the resource-pack UI on service-worker readiness; load and show the manifest first, then report cache-service availability separately.
- `校验` should be an actual Cache Storage scan against the current manifest. If every URL is present, set a completion/verification marker and show `已完成`; otherwise clear the ready marker so stale or partial packs are not trusted.
- Zip delivery can reduce request count and compress large JSON, but it is not directly usable by the game. A zip option must download once, stream-unzip client-side, and write each original URL into Cache Storage; otherwise normal icon/audio/GLB/map fetches cannot read it.
- Live cold-vs-pack test showed the pack works at the transport layer: cold game load fetched about 101 MB of icon/map/GLB resources from network with map asset responseEnd around 5s; after resource-pack download, game load used Cache Storage for icons/map/GLBs with about 37 KB transfer and map asset responseEnd around 1s. If `场景加载中` remains afterward, investigate map parse/render readiness separately from resource download.

## Ability and item bar minimum readable size (2026-05-22)

**Implemented**:
- Raised the minimum stored `技能栏大小` from 0.5 to 0.85 and updated the ESC slider minimum so old tiny saved values normalize upward.
- Increased small-screen ability/item slot base size from 30px to 34px and enforced readable minimum hotkey/cooldown/count text sizes.

**Lesson**:
- Combining a very low saved UI scale with mobile CSS reductions can make ability and item bars unusably small on some screens. Clamp the setting to a playable minimum and test with old stored values like `0.5`, not only the default scale.

## Network diagnostics flight recorder for China-to-US testing (2026-05-22)

**Implemented**:
- Added authenticated latency diagnostics endpoints that write sanitized JSONL batches/reports under `/home/ubuntu/zhenchuan/logs/latency/`.
- Added a client latency recorder that auto-starts during in-game sessions and batches samples while the tester plays.
- Added `/network-diagnostics` as the standalone 网络诊断 page with recent/starred game selection, player tabs, metric cards, slow-transfer rows, and readable timelines.
- Added a compact 快速诊断 panel that uses the best/catcake player as the baseline, compares latency/state/movement/HTTP/transfer symptoms, and suggests whether to fix player network path, WebSocket/diff payload, `/movement`, nginx, or backend processing first.
- Tightened 快速诊断 reliability: one-way up/down estimates from client/server timestamps are treated as clock-derived estimates, not decisive slow-transfer evidence; RTT needs sustained average/latest evidence or corroborating state/movement problems before blaming a player connection.
- Display detailed outliers as 异常样本 rate instead of a raw scary slow-count, so rare tail spikes do not contradict a healthy quick diagnosis.
- Measured existing latency reports and found the real gameplay transport waste was not the report reader: movement input was POSTed every 33ms even when unchanged, BattleArena also ran a duplicate HTTP ping loop despite WebSocket RTT pings, and server WebSocket broadcasts included many unchanged state patches.
- Reduced real gameplay traffic without hiding diagnostics: full latency sample rows are kept, movement POSTs now send on input/facing change, jump, or a safety heartbeat, the duplicate HTTP ping loop was removed, WebSocket RTT feeds the HUD, and unchanged server state patches are filtered before broadcast.
- Fixed diagnostics sanitizers to preserve boolean values; stringifying `true`/`false` made later analysis of idle movement, jumps, accepted flags, and failures unreliable.
- Removed the in-game latency upload/download controls; gameplay UI should only record silently, not host the report reader.
- Captured WebSocket PING/PONG RTT, server receive/send timestamps, state-diff cadence/payload sizes, snapshot/action HTTP timings, and movement POST timings with backend receive/respond timestamps.
- Retains the latest 5 unstarred recorded games plus any starred games, and ignores generated `logs/latency/*.jsonl` / starred-store files alongside the existing diagnostics logs.

**Lesson**:
- For remote latency tests, record both client-observed timings and server timestamps, then read them from a separate diagnostics surface. RTT alone cannot distinguish China-to-US network delay, server processing time, state-diff jitter, HTTP input ACK delay, or reconnect gaps.
- Long telemetry lists are hard to act on; always put a baseline-based summary and fix suggestion above raw timelines so a quick scan says whether the likely problem is player route, transmission direction, WebSocket state sync, movement HTTP, or backend processing.
- Do not diagnose a nearby/same-network device as bad from P95-only or one-way timestamp estimates. Prefer reliable client-observed intervals/durations, server processing time, and multi-signal corroboration; show low-confidence observations separately.
- Do not solve gameplay latency investigations by hiding diagnostic samples. First inspect the actual transport path: in this app, player movement upload is `/api/game/movement` HTTP, WebSocket client upload is mostly PING, and server WebSocket download can waste bandwidth by resending unchanged patches.

## Generated crash/frontend logs should stay untracked (2026-05-22)

**Finding**:
- GitHub rejected a push because `logs/client-crashes/2026-05-22.jsonl` had grown to 121 MB and the repo was already tracking generated diagnostics JSONL files under `logs/client-crashes/` and `logs/frontend/`.

**Fix / lesson**:
- Added git ignore rules for generated diagnostics JSONL logs and removed the tracked log files from the Git index without deleting the local copies.
- Crash/frontend recorder outputs are runtime evidence, not source artifacts; they should stay local or be archived outside Git.

## Refresh movement sequence reset (2026-05-22)

**Finding**:
- Real post-refresh logs showed W key events, direction payloads, and successful `/api/game/movement` HTTP responses, but the authoritative position and velocity stayed unchanged before snapping the locally predicted player back.
- The frontend movement sequence starts at `1` after page refresh, while the live backend `GameLoop` kept the old high `playerInputSeq` for that player. `setPlayerInput` silently ignored every lower post-refresh seq, and the route still returned `success: true`, making the ACK misleading.

**Fix / lesson**:
- Movement POSTs now include a per-page movement client session id and start timestamp. `GameLoop` tracks that session per player, resets the sequence guard when a newer page session appears, and rejects older page sessions/stale seqs with `accepted: false`.
- The movement route returns `accepted` so diagnostics can distinguish transport success from authoritative input acceptance.
- The refresh regression test now primes a high backend movement seq before reload, then verifies the refreshed page's low seq movement changes the backend position. Refresh reconnect tests must reproduce sequence history, not just reload a fresh low-seq page.

## Crash recorder normal-end cleanup and refresh checklist (2026-05-22)

**Finding**:
- Treating `InGameClient` unmount as a clean exit is wrong because refresh, route replacement during a broken reconnect, and tab destruction all unmount the component without proving the game ended normally.
- The refresh/reconnect bug needs an initial-start checklist and an after-refresh checklist that includes snapshot, WebSocket open/close, PONG, state diff progress, and backend movement acknowledgement; visual local walking alone does not prove the backend accepted movement.
- Live refresh testing with `catcake` showed snapshot, WebSocket, PONG, state diffs, and movement requests were alive after reload, but W movement rehydrated through the wrong facing/yaw convention. `me.facing` was converted with `atan2(f.x, f.y)` while movement/camera code uses `atan2(f.x, -f.y)`, so post-refresh W could point into collision and appear like backend movement was not reconnecting.

**Fix / lesson**:
- Normal diagnostic cleanup is now limited to explicit leave and true game-over paths. Refresh/unmount keeps crash evidence and records a warning breadcrumb instead of marking a clean exit.
- Added a session-scoped cleanup endpoint that removes only matching JSONL entries for the authenticated user/game/session after a normal ending, preserving abnormal sessions.
- Added compact connection-checklist breadcrumbs and a live two-player Playwright regression test that verifies backend position changes before and after refreshing the in-game page.
- Rehydrate BattleArena yaw through the shared `facingToYaw` helper; duplicating coordinate conversions is exactly how refresh-only movement drift appears.

## PC hard-disconnect finding after state-diff sampling (2026-05-21)

**Finding**:
- The follow-up crash for PC user `catcake` in game `6a0f8d643edda46d6c578aba` still did not emit a browser fatal error, unhandled rejection, WebGL context loss, pagehide, beforeunload, or frontend/backend PM2 process crash.
- The state-diff sampling fix worked: frontend batches were small, had no dropped entries, and showed `skippedSinceLastLog` summaries instead of tick-rate persistent writes.
- PC Chrome's last uploaded heartbeat/logs were normal (`visible`, online, one canvas, stable scene counts, roughly 100 MB heap). The last PC frontend entry was a sampled `STATE_DIFF` at `2026-05-21T23:04:25.964Z`; the survivor saw `PLAYER_DISCONNECTED` for `catcake` at `2026-05-21T23:04:29.610Z`.
- Server logs only said the PC WebSocket unsubscribed, so the next missing evidence is the WebSocket close code/reason and whether the server heartbeat terminated a dead socket.

**Action / lesson**:
- Added backend WebSocket close-code logging and heartbeat-termination logging so the next hard disappearance distinguishes browser abnormal close, network drop, and server heartbeat cleanup.
- When no client fatal/page lifecycle event is captured and the socket simply disappears, treat it as a renderer/browser/network-level loss until close-code evidence says otherwise.

## PC crash diagnostics overhead finding (2026-05-21)

**Finding**:
- The Safari guest `GAME_OVER` / root-route clean exit was expected behavior and was not the PC crash. The useful survivor-side clue was `PLAYER_DISCONNECTED` for PC user `catcake` at `2026-05-21T19:18:55.854Z`.
- PC Chrome remained visible/online with normal heap, DOM, canvas, and scene metrics in the last heartbeat/log batches. There was no captured uncaught fatal error, WebGL context loss, or PM2 backend/frontend process crash.
- The frontend recorder was persisting every 30 Hz `STATE_DIFF` message as a breadcrumb. Each breadcrumb appended to the durable frontend log queue with synchronous localStorage parse/stringify, creating avoidable main-thread work and causing uploaded batches to lag behind real time.

**Fix / lesson**:
- Coalesce high-frequency `STATE_DIFF` diagnostics: keep the latest state version current, persist a sampled breadcrumb every few seconds, and include a skipped-count summary instead of writing every tick.
- Diagnostics for renderer crashes must never add per-frame or per-tick synchronous storage work; keep persistent logs focused on fatal/error/lifecycle events plus sampled health breadcrumbs.

## Random white-screen crash recorder implementation (2026-05-21)

**Follow-up correction**:
- ESC diagnostics are only useful while the UI is still alive. Added an automatic frontend log stream at `/api/diagnostics/client-frontend-log` that writes sanitized JSONL batches under `/home/ubuntu/zhenchuan/logs/frontend/` during play.
- The recorder now keeps a bounded frontend-log queue across refresh, uploads it every few seconds, and forces keepalive/beacon uploads on page hide, unload, disconnect-style major events, WebGL loss, and fatal errors.

**Lesson**:
- For a true white-screen or renderer crash, the primary evidence must already be in backend frontend logs before the crash; localStorage recovery and ESC copy/upload are fallback/convenience paths, not the main path.

**Implemented**:
- Added a frontend crash recorder with durable localStorage session/breadcrumb buffers, global error/unhandled-rejection hooks, console warn/error capture, page lifecycle capture, heartbeat uploads, previous unclean-session upload, and redaction for token/cookie/password-like fields.
- Added a React crash boundary around the in-game battle view so render/runtime errors upload a report and show a solid fallback instead of a plain white screen.
- Added an authenticated backend endpoint at `/api/diagnostics/client-crash-report` that writes sanitized JSONL entries under `/home/ubuntu/zhenchuan/logs/client-crashes/`.
- Wired WebSocket connect/error/close/reconnect messages and player disconnect/reconnect messages into the recorder, including last disconnect time and crash/event-to-disconnect relation.
- Wired BattleArena behavior breadcrumbs: movement samples, jump attempts, ability casts, ground casts, keyboard inputs, mouse/touch camera actions, movement failures, scene metrics, WebGL context loss/restoration, and ESC -> 测试 -> 崩溃诊断 copy/download/upload controls.
- Removed token-bearing WebSocket debug output from browser console logs while preserving redacted connection context.

**Verification plan**:
- Build backend/frontend, restart only `frontend` and `backend`, then use the diagnostics panel or `window.__zhenchuanCrashRecorder` to upload a manual report and confirm JSONL output.

**Lesson**:
- Crash logging must explicitly record the timing relationship between behavior, heartbeat, WebSocket disconnect, reconnect, and fatal/error events; otherwise delayed white-screen failures are almost impossible to separate from network drops.

## Random white-screen crash investigation plan (2026-05-21)

**Unresolved issue**:
- The live game can randomly collapse into a white screen after running for a while, and DevTools/F12 may not be usable afterward. This suggests console-only debugging is not enough and the failure may be renderer-process, WebGL/GPU, memory, or fatal runtime related.

**Plan recorded**:
- Added `CRASH_DIAGNOSTICS_PLAN.md` with a flight-recorder approach: durable frontend ring buffer, IndexedDB/localStorage fallback, backend JSONL crash-report endpoint, heartbeat snapshots, WebGL/context-loss metrics, an in-game diagnostics panel, and a live Playwright soak test plan.

**Lesson**:
- Random delayed white screens should be debugged with evidence captured before the crash, not by relying on post-crash DevTools access.

## Qi-field channel timing, sound, and terrain visibility (2026-05-21)

**Problem set**:
1. Channeling 气场 fields had mixed base channel times: 冲阴阳、凌太虚、生太极、吞日月 were 1.0s, while 碎星辰、破苍穹 were 0.5s.
2. The shared 气场 channel-start sound could be playback-rate shortened by haste/channel duration and then stopped on completion, which made the same OGG sound different in battle.
3. Flat AOE/field discs could be partially hidden by uphill terrain because their material still depth-tested against the terrain mesh.

**Fix / verification**:
- Set the six channeling 气场 skills to a 1.5s base channel. With the current haste timing factor, they adjust to 1257ms, still longer than their old base times.
- Left 镇山河 listed as an instant 气场 because it has no channel in canonical data.
- Routed the shared 气场 channel-start cue at natural playback rate with pitch preservation and allowed it to finish naturally on successful channel completion.
- Made `AoeZone` fill/ring materials render without depth testing and with stable render order so terrain cannot hide the displayed area.
- Verified with TypeScript diagnostics, a canonical timing/haste audit script, and static sound/zone material checks.

**Lessons**:
- When channel sounds are tied to gameplay duration, haste can change audio character unless pitch and cutoff behavior are handled explicitly.
- For gameplay readability, ground-zone indicators should not depth-test against uneven terrain; the server range is flat/cylindrical, and the visual indicator should remain fully visible.

## Qi-field ground placement and owner colors (2026-05-21)

**Problem set**:
1. 穹隆化生's generated 生太极 zone used the player's current Z at dash end, so ending in the air could place the field in the air instead of on the ground below.
2. That special 生太极 needed a much taller vertical reach than normal range-relative zones.
3. 碎星辰 and 破苍穹 were forced red in the frontend renderer, so the owner could see their own 气场 as enemy-colored.
4. Canonical 气场 `zoneHeight` values still said 10 even when the actual intended radius/height was 8 or 15.

**Fix / verification**:
- Snapped 穹隆化生's generated 生太极 zone Z to `getGroundHeightForMap` at dash end and set its height to 99 world units while keeping its radius 8.
- Removed the forced-red frontend override for 碎星辰/破苍穹 so normal owner-relative coloring applies: owner blue, enemy red.
- Updated canonical 气场 height data: 镇山河 8, and 冲阴阳、凌太虚、生太极、吞日月、碎星辰、破苍穹 15.
- Verified with TypeScript diagnostics, a canonical 气场 height audit script, and a static frontend color-branch check.

**Lessons**:
- Ground fields cast while airborne should store ground Z for placement, then use `height` for vertical reach; storing player-air Z changes both visuals and enter/exit checks.
- Avoid ability-specific color overrides for team-readable field visuals unless the owner/enemy relationship is still applied.

## AoE vertical cylinder hit range (2026-05-21)

**Problem set**:
1. Several AoE target filters used horizontal-only range checks, so targets far above or below the caster/area could still be hit if their X/Y position was inside the radius.
2. Timed/channel AoEs used sphere-style distance in shared loop helpers, which did not match the requested cylinder rule of horizontal radius plus the same amount above/below.
3. Persistent ground zones had old independent height fallbacks such as 10 or 2, instead of deriving vertical half-height from each zone radius/range.
4. Mi Yun retargeting could choose candidates from a wider vertical space than the original AoE.

**Fix / verification**:
- Changed immediate AoE damage/buff helpers, loop timed/channel AoE helpers, Mi Yun area candidate/reroll helpers, and ground-zone creation/tick paths to use a cylinder: XY radius equals AoE range and vertical half-height equals the same range.
- Kept entity radius tolerance in both planar and vertical checks so summoned/entity targets still behave consistently at boundaries.
- Verified with backend checks for 魂压怒涛, 横扫六合, 大狮子吼, 五方行尽, shared Mi Yun/loop area selection, and persistent zone height/radius parity for 镇山河、极点迟御、振翅图南、天绝地灭、绿野蔓生、洗兵雨.

**Lessons**:
- AoE retarget pools must use the same 3D volume as the original effect, or confusion effects can create illegal hits.
- For gameplay AoEs, persistent zone `height` should be treated as vertical half-height and kept equal to `radius` unless an ability intentionally defines a different volume later.

## Jump branch verification and Jiu Xiao cast sound (2026-05-21)

**Problem set**:
1. After changing normal directional jump distance to match walking progress, all special jump branches needed a quick regression check.
2. 九霄风雷 had an on-cast/channel-start sound that needed to be removed without deleting its manifest asset or affecting other abilities.

**Fix / verification**:
- Ran backend `applyMovement` checks for normal first jump, normal double jump, backpedal double jump, JUMP_BOOST power jump, power-air double jump, MULTI_JUMP, MULTI_JUMP + JUMP_BOOST, TI_YUN_ZONG_JUMP, upward delayed drift, and Ling Ran directional/upward special jumps.
- Verified normal and speed-buffed cases still scale correctly, and special fixed-budget jumps still resolve to their expected existing distances.
- Suppressed only `jiu_xiao_feng_lei` at the ability sound registry `channelStart` phase, leaving any later channel-complete behavior untouched.

**Lessons**:
- Movement formula changes should be checked through `applyMovement` itself, not only with standalone arithmetic, so buff effects and branch gates are exercised.
- Channel abilities use the `channelStart` phase as their on-cast sound in the frontend registry.

## Camera distance display remap and jump parity research (2026-05-21)

**Problem set**:
1. The camera view that visually matched the reference game was the real 20-unit camera distance, but the in-game reference labels that as 24.
2. The ESC camera setting needed to show and cap at `24.00` without changing the actual camera view angle/distance.
3. Repeated normal forward jumps felt slower than walking forward, even though normal walking speed itself is correct.

**Fix / finding**:
- Remapped camera setting display so `24.00` maps to the same real camera distance as the previous 20-unit view, leaving `CameraRig`'s real `CAM_DIST_BACK = 20` unchanged.
- Capped the camera setting at `24.00` and versioned the stored camera preference so the old 22/30 defaults migrate to the new reference scale.
- Researched jump math: normal directional jump was traveling a fixed 6 units over about 51 ticks, while walking for the same ticks travels about 8.5 units at 30Hz.

**Jump fix**:
- Keep walking speed, jump height, gravity, and airtime unchanged.
- For normal forward directional jumps only, replaced the fixed 6-unit horizontal budget with `jumpStartPlanarSpeed * estimatedAirborneTicks` on backend and mirrored it in frontend prediction.
- Verified the same formula at normal and double movement speed: 2x movement speed produces 2x jump-forward travel over the same airtime, matching 2x walking.
- Left special jump budgets (power jump, multi-jump, backpedal, Ling Ran special jump) separate unless they are intentionally recalibrated later.

**Lessons**:
- Camera setting labels can be remapped independently from physical camera distance when matching another game's UI scale.
- A fixed jump horizontal distance becomes slower than walking whenever airtime exceeds `distance / walkSpeed`; at 5 units/sec, 6 units only equals 36 ticks, not a full normal jump arc.
- Backend movement and BattleArena prediction must be changed together for jump horizontal parity, or the client will predict a different landing point from the server.

## ESC camera settings for game matching (2026-05-21)

**Problem set**:
1. Camera tuning lived behind mouse-wheel zoom and a test-only overrange toggle, so there was no normal ESC game setting matching the reference camera panel.
2. The default camera distance was still based on the old `0.7` zoom multiplier, giving a much shorter starting camera than the requested 22-unit reference.
3. Follow-mode options are not implemented in the battle camera, but the UI needed to show the same three camera-type slots with only `从不追随` selectable.

**Fix**:
- Added ESC → 游戏设置 → 综合 → 镜头设置 with locked camera type options and a `镜头最大距离` range control.
- Persisted camera settings in localStorage with default distance `22.00`, max `30.00`, and live camera update when the slider changes.
- Removed the old test-only overrange camera toggle so max camera distance has one visible source of truth.
- Confirmed the deployed live chunk contains the new settings UI and values; full ESC visual verification needs an active authenticated battle canvas.

**Lessons**:
- Settings that tune live camera feel should update both the persistent preference and the ref read by the render loop immediately.
- If follow modes are not implemented, disabled placeholders are safer than exposing inactive choices.
- A deployed static chunk marker check can confirm live bundle rollout when a full authenticated match cannot be opened from the current browser session.

## Horizontal-only exported map footprint scale (2026-05-21)

**Problem set**:
1. Building footprint measurements in collision-test mode were too small horizontally: examples were about 18.4 vs expected 20.9 and 22.8 vs expected 25.4.
2. Vertical height already matched, so increasing the uniform exported-map scale would have broken height calibration.
3. Frontend prediction, backend authoritative BVH collision, LOS, camera collision, map bounds, spawns, and fallback AABBs all depended on the old uniform scale.

**Fix**:
- Added a `1.125` horizontal footprint multiplier and split exported-map scale into X/Z and Y components.
- Kept Y/height conversion unchanged while scaling X/Z render transforms, group X/Z offsets, collision radius, LOS, camera conversion, frontend prediction, backend movement collision, map bounds, spawns, and fallback object footprints.
- Verified backend and frontend builds, restarted only PM2 `frontend` and `backend`, and confirmed the live in-game bundle contains the new horizontal scale marker. Full live battle canvas verification was blocked because the created room waited for a second player.

**Lessons**:
- When height is correct but footprint is short, split horizontal and vertical calibration instead of changing the global map scale.
- Scaling exported map X/Z from the same origin as map bounds keeps visual world coordinates, server collision, spawns, and ruler distances aligned.
- Every exported-map conversion must be mirrored across backend and frontend; updating only the visual mesh would make range tools look different from collision and prediction.

## BattleArena camera centering at upward pitch (2026-05-21)

**Problem set**:
1. In collision-test mode, dragging the camera upward made the local character drift lower on screen.
2. The camera boom followed the avatar, but the render camera still looked at a forward/up offset target, so pitch changes changed the character's screen position.
3. After removing the old look-ahead offset, aiming at the upper pivot centered the HP/cap anchor but left the body reading slightly low/high depending on pitch.

**Fix**:
- Kept the existing camera collision boom pivot unchanged for wall, probe, and ground clamping.
- Changed the render `lookAt` target to a fixed avatar body-center height so the model itself remains centered as pitch changes.
- Updated the movement recenter visibility check to use the same visual-center target.

**Lessons**:
- Camera collision pivots and visual framing targets should be separate; collision can orbit around a stable upper pivot while `lookAt` frames the body center.
- Playwright canvas screenshots plus pixel checks are useful for confirming visual drift, while live React refs help prove pitch changed during the test.

## Exported map cache and warmup optimization (2026-05-21)

**Problem set**:
1. The load panel showed very slow exported-map resources, including small PNG/JSON files taking many seconds.
2. `/full-exports/<package>/<file>` resolved packages by scanning export roots for every asset request, multiplying filesystem work across hundreds of map files.
3. Exported-map assets were served without long-lived immutable cache headers, so repeat loads could still revalidate or redownload stable package files.
4. The waiting room did not preload the in-game route or warm the browser cache for the official collision-test map before BattleArena mounted.
5. After the optimization, the load report was useful enough to keep, but the `I` hotkey exposed it too prominently for normal play.

**Fix**:
- Added a short-lived backend full-export index cache and startup warmup so package lookup is reused across asset requests.
- Added immutable cache headers and resource timing headers for exported-map package assets while keeping export list responses revalidatable.
- Added a frontend exported-map warmup helper that fetches manifests, GLBs, textures, terrain files, and collision sidecars with bounded concurrency into the browser HTTP cache.
- Started route prefetch and map warmup from the room page, and also triggers warmup from the in-game client once `collision-test` mode is known.
- User reported total scene load improved to about 9 seconds after cache/warmup changes.
- Removed the `I` hotkey toggle and moved the scene-load report behind ESC → 测试 → 开关 → 场景加载报告.

**Lessons**:
- Tiny map files taking many seconds can indicate server-side request overhead or queueing, not only bandwidth or asset size.
- Package-named exports are good candidates for immutable browser caching; list/discovery endpoints should stay revalidatable.
- Preloading should begin in the waiting room when possible, because warming the cache after the Three scene mounts competes with the real scene loader.
- Keep deep diagnostics inside the testing panel once the issue is understood; normal hotkeys should stay reserved for gameplay/debug flows players deliberately need.

**Future enhancement options, if load speed becomes a problem again**:
- Add a service worker or Cache Storage prewarmer for exported-map assets so room warmup can persist and report progress more explicitly.
- Generate an asset dependency manifest at export/build time so warmup does not need to derive GLB, texture, terrain, and sidecar URLs in the browser.
- Precompute a collision world-triangle cache for the exact exported map to skip JSON parse/triangle transform work while keeping gameplay geometry unchanged.
- Add nginx/CDN static serving for `/full-exports` with HTTP/2 or HTTP/3 tuning, Brotli for JSON, and OS file-cache warmup after deployment.
- Use route-level code splitting to keep non-battle editor/test code out of the first in-game JS path.
- If quality-preserving asset work is later allowed, test lossless PNG optimization before considering format changes.

## Scene loading timeline report and loader parallelism (2026-05-21)

**Problem set**:
1. The `I` panel mixed scene loading with element counts, so it did not clearly show total scene load time or per-stage durations.
2. The first implementation showed page runtime as a loading duration, making old sessions look like very slow scene loads.
3. The exported map loader fetched unique GLBs, terrain heightmaps, and collision sidecars mostly in serial, which made scene loading vulnerable to long request chains.
4. Live Playwright report capture was blocked because the browser redirected to `/login` and `ZHENCHUAN_TEST_PASSWORD` was not set in the runtime environment.

**Fix**:
- Changed the `I` panel to focus on `场景加载`: total scene time, stage durations, browser resource timing groups, slowest resources, and a `复制报告` button.
- Added exported-map timing events for manifest, entity GLB/texture, terrain, collision sidecar, BVH, and total map stages.
- Exposed the full report on `window.__zhenchuanLoadReport` for Playwright retrieval after authentication.
- Parallelized GLB, terrain, and collision sidecar loading with bounded concurrency.

**Lessons**:
- Loading diagnostics should measure stage start/end times, not how long the page has been open.
- Browser `PerformanceResourceTiming` is useful for reportable scene-load evidence because it identifies slow resource groups without adding custom network instrumentation.
- Live Playwright checks that require authentication need runtime credentials or an already-authenticated shared browser page; do not route passwords through chat or logs.

## Channel completion stealth and load diagnostics (2026-05-21)

**Problem set**:
1. 散流霞 correctly survived forward channel start, but a successful channel finish was still not treated as an action that breaks it.
2. 任驰骋 needed to be castable while moving during the channel, but only if the caster starts on the ground.
3. White-screen/crash investigation needed an in-game way to see scene loading stages and whether DOM or Three.js object counts are growing over time.

**Fix**:
- Added successful channel-completion removal for 散流霞 buff 1007 in the runtime loop, separate from cancel handling.
- Marked 任驰骋 as `requiresGrounded: true` in canonical and legacy ability data without adding `requiresStanding`, so movement during the channel remains allowed.
- Added an `I` hotkey load-performance panel showing in-progress scene stages, DOM element/canvas/SVG/image counts, JS heap when available, and Three.js object/geometry/texture/render counts with peak values.

**Lessons**:
- Channel start, channel cancel, and channel complete need separate buff-break semantics; preserving a buff at start does not imply preserving it at successful resolution.
- Ground-only casting and movement-lock casting are separate constraints; use `requiresGrounded` for the initial floor check and leave `requiresStanding`/movement lock off when motion is allowed.
- For intermittent white screens, collect both DOM counts and renderer-side object/memory counts so gradual growth is visible before the browser crashes.

## Ground dash targeting and power lock warnings (2026-05-21)

**Problem set**:
1. 散流霞's runtime buff was created with `breakOnPlay: false`, so successful casts did not remove it.
2. Ground dash skills could fall back to selected/opponent/facing targets or clamp to max range, causing the character to land somewhere other than the clicked point.
3. Ground-only opponent-target casts emitted `PLAY_ABILITY` with the default enemy target from both `playService` and the inner `applyAbility` entry point, so combat status treated the cast as enemy contact.
4. LOS failures showed both the battle warning and an old debug overlay.

**Fix**:
- Added 散流霞 buff 1007 to successful-cast break handling while preserving channel-start immunity.
- Required explicit ground targets for 临时飞爪、撼地、孤风飒踏 and removed backend dash fallback/clamping for those exact-point casts.
- Suppressed enemy `targetUserId` on both ground-only `PLAY_ABILITY` event emitters.
- Added 封内/封外 effect types and mapped silence/disarm/inner/outer local/server cast failures to `经脉受损 无法运功`.
- Replaced the legacy LOS overlay with the battle-warning path only, and added dash hover range filtering plus path-line preview.
- Changed 散流霞 so forward channel start keeps it, but reverse channel start breaks it like a normal successful cast.

**Lessons**:
- For mouse-target mobility, backend validation and effect execution must both require the explicit ground point; UI-only checks are not enough.
- Opponent-target abilities that are actually ground-only should not reuse fallback enemy targets in gameplay events, or secondary systems may infer combat contact.
- Runtime-applied buffs need break metadata and central break rules aligned; otherwise editor/canonical defaults do not describe the live buff behavior.

## Live ESC sound settings deployment verification (2026-05-21)

**Problem set**:
1. The local source enabled the ESC `声音设置` tile and moved ability sound controls into a dedicated page, but the live site still showed the tile disabled.
2. Localhost/browser checks were insufficient because the user was seeing the deployed `https://zhenchuan.renstoolbox.com` build.
3. The default terminal channel returned stale PM2-path text for unrelated commands, hiding whether builds and restarts actually ran.

**Fix**:
- Verified the authenticated live game with Playwright and confirmed the deployed `声音设置` button still had the `disabled` attribute.
- Updated project instructions so all Zhenchuan Playwright/browser verification defaults to the live site and the `catcake` account while keeping credentials runtime-only.
- Recovered command execution by starting a fresh async terminal and using that terminal ID for build/restart commands.

**Lessons**:
- For UI complaints seen on the production host, verify `https://zhenchuan.renstoolbox.com` first; a correct source tree does not prove PM2 is serving the newest build.
- Never write plaintext credentials into repo instructions or logs; use runtime input, local environment variables, or an already-authenticated browser session.
- If a persistent terminal returns stale output for every command, open a fresh async terminal and continue from the returned terminal ID.

## ESC ability sound settings range and mute (2026-05-21)

**Problem set**:
1. The ESC panel ability-sound slider needed a clear 0-100% range, but earlier work temporarily raised it to 150%.
2. The main ESC `声音设置` tile existed but was disabled, so sound controls were hidden inside the general game/interface settings page.
3. The desired baseline changed to 80%, while preserving explicit stored user sound settings when present.
4. iPad testing suggested audio may not unlock even though desktop playback works.

**Fix**:
- Enabled the ESC `声音设置` tile and moved ability sound controls into its own sound settings page.
- Changed ability sound settings to version 4 with default `volumePercent: 80`; stored explicit values are preserved within the 0-100% range, while the previous auto-default 150% migrates down to 80%.
- Kept the slider at 0-100% and renamed the checkbox to `关闭音效`.
- Calibrated the playback multiplier so UI `80%` equals the old `50%` output level, and capped the ability sound player at 100%.
- Added an iOS-friendly silent AudioContext warmup and broader touch/click unlock listeners for iPad playback.

**Lessons**:
- Sound setting ranges must be supported in the settings UI, the stored-value normalizer, and the final playback clamp; changing only one side creates a false control.
- Version localStorage-backed settings when changing defaults so old saved defaults do not mask the new requested baseline.
- On iOS Safari, `AudioContext.resume()` alone can be insufficient; starting a tiny silent source during the user gesture is a low-risk unlock warmup.

## Browser-like 任驰骋 sound and self-AOE cast readiness (2026-05-20)

**Problem set**:
1. 任驰骋 still sounded wrong in battle because its channel-start cue either played at natural length and got cut by the 0.75s channel, or could inherit channel playback-rate adjustment that changed the sound character.
2. Channel-start sounds could keep playing if the channel started and stopped before the frontend observed a stable `activeChannel` snapshot.
3. Self-centered AOE abilities such as 大狮子吼 and 霞流宝石 could appear uncastable when a selected/fallback target was too far away because frontend readiness still ran opponent range checks for `target: "SELF"` abilities.

**Fix**:
- Routed 任驰骋 through a pitch-preserving media-element playback path, fitting the cue to 750ms while keeping browser pitch preservation enabled and volume normalization disabled.
- Let the fitted 任驰骋 start cue finish naturally on normal channel completion, while still allowing cancellation cleanup when the channel ends early.
- Added channel sound keys immediately when a channel-start cue plays, and included BUFF-backed channel keys in active channel cleanup so canceled channels stop their sound even if the active-channel state was short-lived.
- Short-circuited BattleArena readiness checks for non-OPPONENT abilities before selected-target distance/facing/LOS checks.
- Changed `离开战斗` to use the same in-game warning display path as `进入战斗`, instead of the app-level toast.

**Lessons**:
- WebAudio buffer playback changes pitch when speeding a clip up; use an `HTMLAudioElement` with `preservesPitch` routed through WebAudio when a short channel needs pitch-preserving compression.
- Channel sound cleanup must track the started sound key as well as the currently visible channel state; otherwise very short-lived channels can miss the cleanup window.
- A self-centered AOE's `range` is effect radius, not cast distance to the currently selected enemy.

## Carrier-centered 百足 explosion and channel sound teardown (2026-05-20)

**Problem set**:
1. 百足's delayed ending was modeled as self-only extra damage, but desired gameplay is a second carrier-centered explosion that does not reapply the DOT.
2. The 百足 follow-up explosion needed to replay the ability sound from the explosion location, not from the original caster.
3. Reverse/active channel sounds could keep playing after the channel ended because the WebAudio source had no channel lifecycle key.
4. 霞流宝石 needed to become a self-centered 6-unit AOE instead of requiring a target.

**Fix**:
- Added `TIMED_SOURCE_CENTER_AOE_DAMAGE` for 百足's delayed carrier-centered explosion, including the short ground marker and a positioned follow-up `ABILITY_SOUND` event.
- Extended BattleArena sound events with optional `x/y/z` positions and a `followUp` sound phase so 百足 can replay the same cue at the final explosion point.
- Added channel sound keys to `abilitySoundPlayer` and BattleArena cleanup so channel-start audio stops on completion, cancellation, or unmount.
- Added `XIA_LIU_BAO_SHI_AOE` to damage, dispel listed BUFF attributes, and apply the disarm debuff to nearby enemies without selecting a target.
- Synced stale legacy card data for 百足 and 大狮子吼 so older consumers match canonical ability behavior.

**Lessons**:
- Delayed AOE effects that belong to the original caster need to carry source ownership separately from the buff carrier's position.
- Sound-only follow-up events need explicit world coordinates when the audible source is not the actor.
- Long channel sounds should be stoppable by channel identity, not only by guessed duration.

## Ability-level sound review decisions (2026-05-20)

**Problem set**:
1. Sound review decisions were still stored and shown per sound file, so multi-sound abilities could be split across columns.
2. 任驰骋's channel-start sound had been pinned to 0.75s, but the desired behavior is natural full-length playback.

**Fix**:
- Changed the sound review board to store one decision per ability and show decision buttons in the ability header.
- Left individual sound rows as playback/duration rows only.
- Added a migration from old per-sound localStorage reviews to ability-level reviews.
- Removed 任驰骋's `fitToDurationMs` cue so it plays at natural length.

**Lessons**:
- Review workflows should key state to the thing being approved; if the user approves abilities, per-file status creates confusing split decisions.
- For distinctive ability audio, default to natural playback unless the user explicitly prioritizes exact duration.

## Dash-complete sounds without audio speed-up (2026-05-20)

**Problem set**:
1. Speeding up distinctive ability sounds made them sound like different effects.
2. 乘黄之威 needed its second sound at actual dash completion while the first sound stayed natural.
3. 跃潮斩波 was audible twice because it still had cast playback in addition to impact playback.
4. 任驰骋 needed a longer 0.75s base channel; its sound-length handling was later changed back to natural playback.

**Fix**:
- Added dash-complete `ABILITY_SOUND` events for 乘黄之威 and 跃潮斩波.
- Reverted 乘黄之威 and 千蝶吐瑞 speed-up/fit behavior so their audio keeps its natural character.
- Suppressed 跃潮斩波 cast and per-damage playback; it now plays one impact cue only when the dash lands on at least one target.
- Updated 任驰骋 channel duration metadata to 750ms in abilities and cards; a 750ms sound fit was tried and later removed.

**Lessons**:
- Prefer gameplay-timed events over changing playback rate when a sound's identity depends on its original speed.
- Impact sounds for area hits should be emitted once from the gameplay moment, not inferred from every damage event.

## Targeted and exact-duration ability sounds (2026-05-20)

**Problem set**:
1. Some ability sounds should not fire at cast time; they belong to dash impact, channel completion, or buff application.
2. 雾暗迷云 and 鸿蒙天禁 sounds should only be heard by the affected target, not by everyone near the caster.
3. 笑醉狂 needed audio stretched to match its exact gameplay window; 乘黄之威 and 千蝶吐瑞 were later kept at natural speed after testing.
4. 御骑's dismount toggle reused the cast event shape and accidentally triggered the mount channel sound.

**Fix**:
- Added target-only BUFF_APPLIED sound cues for 雾暗迷云 and 鸿蒙天禁, filtered on the frontend by local player id.
- Moved 跃潮斩波 playback to a dash-impact event and 引窍 playback to channel completion.
- Fit 笑醉狂 to 9s; 乘黄之威 and 千蝶吐瑞 speed-up was tried but reverted because it changed the sound identity.
- Required 御骑 sound playback to come from a real channel-start event, so the mounted 下马 toggle stays silent.
- Removed 幽月轮's extra manifest sound entries and left only its first sound.

**Lessons**:
- Target-personal sounds should be represented as target-only cues on events that already include `targetUserId`, instead of trying to infer privacy from spatial range.
- Fit-to-duration playback needs a wider clamp than normal playback, but it should be used only when preserving natural sound identity is less important than exact duration.
- Channel abilities with one sound may still need completion-only behavior; a single manifest file should not always mean cast/start playback.

## Ability sound special playback rules (2026-05-20)

**Problem set**:
1. Several two-file abilities needed non-default playback order: chained completion sounds, simultaneous cast/channel sounds, timed overlap, or follow-up attack sounds.
2. 盾立 needed the second sound to mean `反击` and play only when reflect actually triggers.
3. Some manifest clips were no longer wanted, and several 气场 skills needed to share 生太极's exact sound files/order.
4. Zero-sound abilities still needed an obvious ability-level checkbox in the sound review board.

**Fix**:
- Added cue metadata for delayed, simultaneous, and follow-up sounds in the frontend sound registry/player.
- Added special rules for 乘黄之威, 穹隆化生, 无间狱, 七星拱瑞, 千蝶吐瑞, 御骑, 真·下车, 盾立, and 风来吴山.
- Emitted backend `ABILITY_SOUND` counter cues when 盾立 reflect triggers.
- Removed unused manifest entries for 生死劫's second sound, 七星拱瑞's channeling sound, and 魂压怒涛's second sound.
- Pointed 冲阴阳, 吞日月, 破苍穹, 碎星辰, and 凌太虚 at 生太极's two sound files so their order and runtime behavior match 生太极.
- Made sound review ability checkboxes custom and larger so zero-sound ability rows expose the checkbox clearly.

**Lessons**:
- Ability sound behavior needs cue-level metadata; file order alone cannot represent simultaneous, delayed-overlap, or follow-up-trigger sounds.
- For reflected abilities, the sound cue belongs at the gameplay reflect event, not at ordinary 盾立 cast/expiration.
- Sound review counts should distinguish zero-sound ability rows from zero sound rows, otherwise the column header can imply the checkbox row is missing.

## PM2 restart scope for Zhenchuan checks (2026-05-20)

**Problem set**:
1. Running `pm2 restart all` during Zhenchuan verification also touched unrelated `rencipe-*` PM2 processes.
2. The unrelated `rencipe-frontend` process produced port `4000` noise/crash-loop signals, distracting from the actual Zhenchuan frontend/backend verification.

**Fix**:
- Updated project instructions so Zhenchuan checks restart only PM2 apps `frontend` and `backend`.
- Recorded that `rencipe-*` processes and ports should be left alone unless the user explicitly scopes the task to them.

**Lessons**:
- PM2 verification should be app-scoped in shared hosts; `pm2 restart all` can destabilize unrelated services and produce misleading startup errors.

## Sound review ability-level judging and channel labels (2026-05-20)

**Problem set**:
1. Abilities without sound files needed an ability-level checkbox because there are no per-sound rows to judge.
2. Ability-level checks should mark unjudged sounds good without overwriting existing per-sound judgments.
3. Needs-work abilities needed a local note field for review notes.
4. Sound phase labels needed to use the basic line names `释放 / 读条 / 完成`, and `风来吴山` needed its one sound treated as a channel sound that loops until its channel finishes.

**Fix**:
- Added local ability-level checkbox state to the sound review board and kept existing per-sound review storage intact.
- Checking an ability now marks only unjudged sounds as good; existing `需要处理` judgments are preserved.
- Added persisted note text boxes for ability groups in the `需要继续处理` column.
- Changed review labels from `主音效 / 起手 / 变体` to `释放 / 读条 / 完成`, with `风来吴山` single-sound rows labeled `读条`.
- Added a scoped `风来吴山` channel-loop cue so its first sound repeats for the remaining channel duration, without affecting other abilities.

**Lessons**:
- Ability-level review state and sound-level review state should be separate; otherwise zero-sound abilities cannot be represented cleanly.
- Bulk review controls must only fill undecided rows unless the user explicitly asks to rewrite prior judgments.
- Special channel sound looping should be driven by cue metadata plus runtime channel/buff duration, not by making all channel-start sounds loop.

## Sound review simplified identity and count filters (2026-05-20)

**Problem set**:
1. The sound review board was visually noisy because each ability header showed type/target/rarity/school tags and a description snippet.
2. The per-ability sound count appeared as a separate `1 个` badge instead of being attached to the ability name.
3. Search was hidden inside collapsed filters, and there was no way to filter abilities by sound count, especially `0` sounds.

**Fix**:
- Simplified sound review ability headers to icon plus `技能名（音效数量）`, removing visible tags and descriptions.
- Moved the old separate count badge into the title, so entries render like `回风扫叶（1）`.
- Added a top-level skill-name search and a custom `音效数量` segmented filter for `全部 / 0 / 1 / >1`.
- Built sound groups from the full ability snapshot before merging manifest sounds, allowing the `0` filter to show abilities with no sound files.

**Lessons**:
- A `0` sound-count filter needs the complete ability catalog, not just the sound manifest, because absent manifest rows are the data being searched for.
- For review-board density, ability identity should stay compact while per-sound decisions carry the actionable controls.

## Sound review live crash and Playwright guard (2026-05-20)

**Problem set**:
1. The deployed sound review tab on `https://zhenchuan.renstoolbox.com/ability-editor?tab=soundReview` was crashing instead of rendering the grouped review board.
2. Local source checks were not enough; the regression only became obvious when the deployed bundle was opened and exercised through login.
3. The repo needed a repeatable live Playwright workflow for protected sound review verification.

**Fix**:
- Reproduced the issue on the live site after login and traced it to `SoundReviewTab.tsx`, where `SectionHeader` referenced an undefined `active` variable.
- Removed that bad runtime reference and kept active button coloring inside `IconButton`, where the prop actually exists.
- Promoted `音效审核` to its own top-level ability editor tab, hid the large editor overview on this tab, and collapsed filters behind a summary so the three decision columns and actions appear in the first viewport.
- Added `frontend/tests/sound-review.live.spec.ts` and `frontend/tests/SOUND_REVIEW_LIVE_TESTING.md`, then linked that workflow from `.github/copilot-instructions.md`.

**Lessons**:
- A client-only runtime typo can survive type checks and still kill a deployed page, so protected editor flows need real browser coverage on the deployed host.
- For live auth verification, store the workflow in-repo but pass credentials through environment variables instead of baking passwords into files.

## Sound review ability editor decision tab (2026-05-20)

**Problem set**:
1. The sound browser needed to live inside the ability editor instead of remaining a standalone page.
2. Sound review needed the same three-state workflow as other editor decision tabs: good, needs more work, and undecided.
3. Multi-sound abilities still needed to stay grouped under ability identity while each sound kept its own decision.

**Fix**:
- Added an `音效审核` skill sub-tab to the ability editor and routed the old `/sound-browser` page plus the lobby sound button to `/ability-editor?tab=soundReview`.
- Reworked the sound review UI into three columns: `需要继续处理`, `未决定`, and `音效可用`, matching the Qin Yin Gong Ming decision-board pattern.
- Preserved per-sound local review state with migration from the previous `bad` value to `needsWork`, while continuing to hide raw sound filenames from the UI.

**Lessons**:
- A review board can still keep ability-level grouping by duplicating an ability group into status columns when its individual sounds have different decisions.
- Local review storage keys should stay stable across UI moves so previous review work survives route consolidation.

## Sound browser grouped review UI (2026-05-20)

**Problem set**:
1. The sound browser listed individual sound files with filenames, making multi-sound abilities hard to review as one skill.
2. Review needed ability-editor-style filtering by rarity and class/school, plus ability icons.
3. Sound audition needed a simple way to mark each sound as good or not good.

**Fix**:
- Reworked `/sound-browser` into ability cards grouped by ability name, with each ability's sounds nested as playable rows.
- Enriched the page with the ability editor snapshot so sound groups can show ability icons, type/target tags, rarity, and school filters.
- Removed visible sound filenames and added local `localStorage` review state for pass/reject/clear controls per sound.

**Lessons**:
- Sound review UI should key visible organization by ability identity, while keeping manifest file keys only as hidden stable storage/playback identifiers.
- Reusing ability-editor tag metadata avoids drifting rarity/school labels between review tools.

## Ability sound browser, haste playback, and volume settings (2026-05-16)

**Problem set**:
1. The imported ability sound pack needed an in-app page for auditioning files and seeing each file duration.
2. Forward-channel start sounds needed to track shortened channel time when haste accelerates the channel.
3. Skill sounds varied in loudness and needed automatic alignment plus an ESC-panel user volume percentage.

**Fix**:
- Added a shared sound catalog export and a `/sound-browser` page that lists every imported `.ogg`, loads metadata for duration display, supports search, and plays preview audio.
- Extended the Web Audio player with `playbackRate` support and BattleArena channel-rate calculation from active-channel or buff-channel runtime duration versus base channel duration.
- Added RMS-based normalization during decode, clamped to avoid extreme boosts/clipping, and added a persisted `音效音量` range control in the ESC game settings.

**Lessons**:
- Keep sound-pack listing data in the same registry combat playback uses; duplicating manifest parsing makes later mapping changes easy to miss.
- Haste-aware audio should use the resolved runtime channel duration, not recalculate haste from stats, because buffs and server rules own the final timing.
- Lightweight RMS normalization is practical for browser playback; a full LUFS pipeline would be heavier than the current skill-sound need.

## Ability sound playback integration (2026-05-16)

**Problem set**:
1. Imported ability sounds needed to play from the public sound pack when related skills are used.
2. Instant casts and channel skills need different timing: cast start for normal skills, channel start plus separate success cue for channels with multiple sound files.
3. Sound volume needed to respect world distance from the local player instead of playing every remote cast at full volume.

**Fix**:
- Added a frontend BattleArena sound registry that maps preloaded ability names to the imported `tani-sound-zc-2026-05-15T11-26-31-705Z` manifest and chooses start/complete sounds from each skill folder.
- Added a lightweight Web Audio player with decoded-buffer caching, first-interaction unlock, repeat suppression, distance falloff, stereo panning, and a `window.__zcAbilitySoundDebug` test log for Playwright verification.
- Added backend `ABILITY_SOUND` events for active-channel completion and buff-backed channel natural completion, avoiding duplicate visible `PLAY_ABILITY` cards while giving the frontend an authoritative success cue.

**Lessons**:
- Keep audio triggers event-driven from authoritative server events; button-click sounds would fire on failed casts and desync from channel completion.
- Use a separate sound-only event for completion cues so combat history and current-action UI do not show fake second casts.
- For browser audio testing, a debug play log is more reliable than trying to observe OS-level sound output from Playwright.

## Ability and transmission audit (2026-05-10)

**Problem set**:
1. Ability runtime needed an audit for split paths, especially channels that might bypass the normalized `ability.channel` / `activeChannel` flow.
2. Repeated game-state transmission needed an audit to identify what clients receive every tick and which fields look redundant.

**Findings**:
- Canonical `ABILITIES` is structurally consistent: 168 abilities load, all object keys match ability ids, all 29 channel abilities have normalized `ability.channel`, and all immediate effect types used by abilities have handler coverage.
- Active/pure channels are centralized through `playService -> activeChannel -> GameLoop`; legacy buff-backed reverse channels still exist intentionally through `ability.channel.source === "BUFF"` and status-bar buff metadata.
- Non-channel real-time casts appear to emit `PLAY_ABILITY` twice: once inside `applyAbility()` and once again after `applyEffects()` returns in `playService.ts`.
- `backend/game/cards/cards.ts` is an unused stale duplicate: 37 legacy entries, one id no longer present in canonical abilities (`jiangchun_zhuxiu`), 132 canonical abilities missing from it, and 23 overlapping abilities with drift.
- Direct channel cancellation still appears outside the shared cancel helpers in knockback paths (`immediateEffects.ts` and `GameLoop.ts`), which can skip cleanup for `startedBuffIds` and `BUFF_EXPIRED` side effects.
- Direct runtime buff pushes still exist for dash/knockback helper buffs, bypassing `addBuff()`'s shared immunity/DR/event rules.
- GameLoop movement broadcasts run at roughly 30Hz and always include each player's position, facing, global GCD, visual GCD, special ability states, every hand cooldown/charge field, plus full `groundZones`/`entities` arrays whenever those roots exist. Buffs/HP/shield/combat links and events are appended when gameplay state changes.

**Lessons**:
- Keep `backend/game/abilities/abilities.ts` as the only live ability table; either delete or quarantine `backend/game/cards/cards.ts` so future work does not accidentally revive stale definitions.
- Channel teardown should use one helper wherever possible, even from special knockback/interrupt paths, so start-applied buffs and expiration events remain consistent.
- Per-tick broadcasts should be change-aware for cooldown roots, special ability states, zones, and entities; position/facing are the true high-frequency payloads.

## In-game warning overlay and controls (2026-05-09)

**Problem set**:
1. Gameplay failure messages still depended on app-level toasts, which are detached from the actual combat HUD.
2. The new warning needed to be plain red text with a black outline, plus its own ESC-panel scale control and custom-UI drag anchor.

**Fix**:
- Added a BattleArena-owned in-game warning overlay with a short-lived red outlined text treatment, its own saved HUD position, and a preview anchor in custom-UI mode.
- Added an ESC panel slider for warning scale from `1.00` to `2.00`, persisted in local storage.
- Routed central gameplay error-code messages from `InGameClient.tsx` into the overlay and switched the local combat validation warnings in `BattleArena.tsx` off app toasts and onto the new HUD warning path.
- Reduced the baseline warning text size by 30%, so slider value `1.00` now starts from a smaller default footprint.
- Reduced the baseline warning text by another 30% and widened the slider range to `0.10` through `2.00`.

**Lessons**:
- If a warning is combat-local, keep both the renderer and the drag anchor in the combat HUD owner; only the text source needs to cross the client boundary.
- A combat-only widget still needs a preview in custom-UI mode, otherwise users cannot place it until the exact failure state happens live.
- When a HUD scale slider starts too large, lowering the base size is safer than widening the slider range downward; saved user scale values keep the same meaning.
- If the user still wants finer control after shrinking the base, widening the lower clamp is the direct fix; it should be done in both the slider min and the normalization helper so saved values and live drag stay consistent.

## Charge stack box border removal (2026-05-09)

**Problem set**:
1. The charged-ability count box still showed a visible white border around its black background.
2. The requested visual was to keep the black background but remove that border entirely.

**Fix**:
- Changed `.chargeStackBox` in `BattleArena.module.css` from a white bordered box to `border: none`.

**Lessons**:
- Small overlay counters on already framed hotbar buttons do not need a second bright outline; it creates visual noise faster than it adds readability.
- If a variant class already has the right treatment (`.chargeStackBoxQueTaZhi`), align the base class to the same border policy instead of layering another special-case style.

## Consumable count badge simplified (2026-05-09)

**Problem set**:
1. The consumable count badge looked like a full chip instead of just a small number in the corner.
2. The requested style was a plain bottom-right number with thinner text and no background panel.

**Fix**:
- Simplified `.consumableCount` in `BattleArena.module.css` to sit as plain text in the bottom-right corner.
- Reduced the weight to `600` and removed the pill-like background treatment so the count reads as a lightweight corner number.

**Lessons**:
- Small stock counters read better as unobtrusive corner text than as full badges when the slot already has strong icon framing.
- If a HUD marker should feel secondary, remove both the background block and the heavier font weight together; changing only one still leaves it visually noisy.

## Consumable stock counts and control-panel refill (2026-05-09)

**Problem set**:
1. Consumables needed finite stock counts instead of infinite reuse.
2. New battles should start both players with `8` 金疮药, `12` 绷带, `4` 月影沙, and `4` 砂石伪装.
3. The HUD needed to show remaining consumable stock, and the control panel needed a button to refill it for testing.

**Fix**:
- Added `consumableCounts` to player runtime state and initialized new battle players with the requested starting stock.
- Updated `consumableService.ts` to sanitize counts, reject use with `ERR_CONSUMABLE_EMPTY`, and decrement stock on successful consumable use attempts.
- Added item-bar count badges plus depleted-slot disabling in `BattleArena.tsx`, and wired a new control-panel cheat action to `/api/game/cheat/refill-consumables` to reset both players' consumable stock.

**Lessons**:
- Finite consumable systems need both a backend source of truth and a visible HUD count; doing only one side makes the state either abusable or unreadable.
- Refill/test helpers belong with the existing cheat/control routes so the UI can reuse the same fetch-and-toast path instead of inventing another debug channel.

## Consumable bar greys out unopened items (2026-05-09)

**Problem set**:
1. Only the first four consumables are implemented, but the item bar rendered the remaining consumables as if they were equally usable.
2. That made the HUD misleading and encouraged clicks into `ERR_CONSUMABLE_NOT_IMPLEMENTED` for items that are not open yet.

**Fix**:
- Added explicit `implemented` flags to the frontend consumable bar list in `BattleArena.tsx`.
- Greyed out unimplemented consumables with a dedicated unavailable style and updated their tooltip title to include `暂未开放`.
- Blocked local click handling for those unimplemented slots so the bar reflects the current live consumable set more honestly.

**Lessons**:
- If the backend has placeholder item ids that are intentionally not open yet, the HUD should surface that state directly instead of waiting for an error response.
- Static HUD catalog entries need explicit availability metadata when the live item roster is only partially implemented.

## 浮光掠影 遁影 only protects movement (2026-05-09)

**Problem set**:
1. `浮光掠影` was still keeping stealth when the player used the 6 common movement abilities during the first 5 seconds of `遁影`.
2. The intended rule is narrower: `遁影` only allows ordinary movement without breaking stealth; using those common abilities should still break `浮光掠影` stealth.
3. `暗尘弥散` and other stealth buffs needed to keep their existing common-ability exceptions.

**Fix**:
- Removed the special first-5-seconds common-ability grace rule from `breakOnPlay.ts` for buff `1012` (`浮光掠影`).
- Kept the existing forward-channel exception for `浮光掠影`, so only the common-ability stealth retention changed.
- Left `暗尘弥散`, `天地无极`, `月影沙`, and the rest of the stealth-break rules untouched.

**Lessons**:
- If a stealth sub-buff like `遁影` is only meant to protect movement, encode that at the central stealth-break owner instead of folding common-ability exceptions into it.
- When multiple stealth buffs have similar exception logic, isolate the change to the exact buff id to avoid accidental rules drift across other stealth families.

## 月影沙 blocked by 伪装 root state (2026-05-09)

**Problem set**:
1. `月影沙` was still castable while the player was under `伪装`, even though `伪装` applies a real `ROOT` effect and should count as control for consumable blocking.
2. The failure toast for blocked consumables still said `受控状态无法使用`, which did not match the requested rule wording.

**Fix**:
- Removed the `DEBUFF`-only filter from the consumable control gate in `consumableService.ts`, so any active buff carrying `ROOT`, `CONTROL`, `KNOCKED_BACK`, `PULLED`, `DISPLACEMENT`, `FEARED`, or `FREEZE` now blocks consumable use, including `伪装`.
- Updated the frontend error mapping for `ERR_CONSUMABLE_CONTROLLED` to show `无法在受控下施展`.

**Lessons**:
- Consumable control validation must key off control effects, not buff category, because runtime states like `伪装` can deliberately carry control on a `BUFF` entry.
- If the rule language is user-facing and specific, keep the toast text aligned with the gameplay rule instead of leaving a generic fallback message.

## 伪装 special bar cancel ability (2026-05-09)

**Problem set**:
1. After `伪装` channel completion, the player needed the draft/special section of the skill bar to collapse to a single cancel action like `九霄风雷` does.
2. That action needed to be `解除伪装` and use the same icon as `砂石伪装`.
3. Triggering the cancel action needed to remove disguise through the shared disguise cleanup path, not a raw buff-id filter.

**Fix**:
- Added a hidden special-bar ability `解除伪装` and attached it to `伪装` through the existing `SPECIAL_ABILITY_BAR` buff effect, so the bar replacement uses the same runtime pattern as `九霄风雷`.
- Set an explicit `iconPath` on that ability and passed ability icon overrides through preload and BattleArena's icon resolver so the button keeps the `砂石伪装` icon.
- Taught `REMOVE_SELF_BUFFS` to route disguise removal through `removeDisguiseBuffs(...)` when it is removing buff `980001`, preserving target-selection cleanup and normal `BUFF_EXPIRED` emission.

**Lessons**:
- Temporary replacement bars are already first-class in this repo via `SPECIAL_ABILITY_BAR`; reusing that is safer than a HUD-only exception.
- If a cancel action removes a special-state buff with side effects, do not rely on a generic raw buff filter; call the owning removal helper instead.
- Icon reuse for special-bar actions is cleaner through explicit ability `iconPath` support than by falsifying the ability name.

## 伪装 facing preservation and GLB rotation sync (2026-05-09)

**Problem set**:
1. While `伪装`, the local player should still preserve their current facing direction instead of visually losing it.
2. Selecting yourself while disguised should still show the facing arc.
3. The disguise GLB needed to rotate from the live facing path, not just the initial render-time yaw.

**Fix**:
- Kept the facing arc visible for selected disguised characters in `Character.tsx`, which covers self-selection while disguised.
- Added a dedicated disguise model ref and updated its rotation inside the same per-frame facing block that already drives the normal character body.
- Passed that live ref into `DisguiseCartModel`, so both the fallback mesh and the loaded GLB stay aligned with current facing instead of freezing at the initial yaw.

**Lessons**:
- If a disguised mesh replaces the main body, it still needs to share the same live facing update path; a render-time prop alone is not enough for local continuously updated facing.
- Self-selection affordances like facing arcs should key off selection state, not whether the body is currently replaced by a disguise model.

## 伪装 leash area on channel completion (2026-05-09)

**Problem set**:
1. `伪装` needed a fixed 2-unit area anchored at the channel-finish position.
2. If the disguised player is displaced out of that area for any reason after the channel completes, the disguise buff should be removed immediately.

**Fix**:
- Added runtime leash metadata to the applied `伪装` buff at the moment the consumable channel completes, using the player's channel-finish position as the anchor center.
- Added a `GameLoop` check that compares the player's current planar position against that anchored 2-unit radius and calls the shared `removeDisguiseBuffs(...)` helper when the player leaves it.

**Lessons**:
- Area-based post-channel rules belong on the applied runtime buff, not on the consumable definition alone, because the rule needs the exact resolved finish position.
- If a movement/displacement rule should remove disguise, reuse `removeDisguiseBuffs(...)` so target-selection cleanup and `BUFF_EXPIRED` events stay correct.

## 月影沙 grounded/control correction and disguise-stealth overlap correction (2026-05-09)

**Problem set**:
1. `月影沙` was still usable while `ROOT` was active because the consumable control gate did not treat root as blocking control.
2. `月影沙` was not manually cancelable from the status bar.
3. `月影沙` only needed to be blocked while airborne, but the first pass incorrectly blocked ground movement too.
4. The earlier disguise-versus-stealth mutual-exclusion rule was wrong. The actual rule is: if a player already has `伪装` and then gains stealth, keep the stealth, shorten `伪装` to a 1-second overlap, and do not let disguise visuals override enemy stealth visibility during that overlap.

**Fix**:
- Added `ROOT` to the consumable control-block list so `月影沙` respects the "all control except slow" rule even when the control source is `伪装`.
- Marked `月影沙(980002)` as runtime manual-cancelable and exposed that flag through preload metadata so the existing right-click cancel flow works without a new UI path.
- Relaxed the `月影沙` cast-position gate from standing to grounded-only, so moving on the ground is allowed while airborne use is still blocked.
- Replaced the bad mutual-exclusion rule with a shared overlap rule in `buffRuntime.ts`: incoming non-disguise stealth now shortens active `伪装` buffs to a 1-second overlap instead of deleting stealth.
- Updated natural disguise expiry in `GameLoop.ts` to clear enemy target selections, so delayed disguise expiry behaves like normal disguise removal.
- Updated enemy visibility helpers in `ArenaScene.tsx` and `BattleArena.tsx` so stealth hides disguised opponents too; enemies no longer keep seeing the `伪装` cart GLB while the player is actually stealthed.

**Lessons**:
- Manual cancel needs both backend permission and preload metadata. Updating only one side makes the buff either uncancelable or invisible to the UI affordance.
- For consumables with "not in air" requirements, use grounded validation only; reusing standing semantics will incorrectly block ordinary ground movement.
- When concealment states overlap, enemy visibility should follow the stronger hidden state. A disguise visual must not override an actual stealth hide.
- If a fix relies on natural buff expiry instead of explicit removal, audit the natural-expiry path for side effects like target-selection cleanup.

## Forward-channel stealth timing correction (2026-05-09)

**Problem set**:
1. Positive-channel start was still being treated like enemy ability contact, so some forward channels could enter `战斗中` before they actually finished.
2. Forward-channel completion was using a blanket raw stealth strip, which incorrectly broke stealth for non-hostile completions like `砂石伪装` and did not emit `BUFF_EXPIRED` consistently.
3. `月影沙` needed to survive forward-channel startup but still break when a hostile forward-channel attack actually resolved.

**Fix**:
- Marked forward-channel `PLAY_ABILITY` start events with `channelPhase: "start"` and taught combat-status sync to ignore those start events for enemy-contact entry.
- Emitted the real forward-channel `PLAY_ABILITY` event on hostile completion with `channelPhase: "complete"`, so combat entry happens when the attack takes effect instead of when the bar starts.
- Replaced the old blanket completion stealth filter with a hostile-resolution helper in `GameLoop.ts`; it skips consumable/self forward channels like `砂石伪装`, breaks `月影沙` and the existing stealth families on hostile completion, and emits normal `BUFF_EXPIRED` events.
- Stopped consumable startup from breaking stealth when the consumable itself is a forward channel, so starting `砂石伪装` no longer strips stealth on use.

**Lessons**:
- For channel interactions, split the lifecycle into `start` and `complete`; stealth and combat entry care about different phases.
- A forward channel is not automatically an attack. Consumables like `砂石伪装` still use the standard active-channel system, but their completion should not inherit hostile stealth-break rules just because the bar fills forward.
- Raw array filtering for stealth removal is brittle; use a helper that also emits `BUFF_EXPIRED` so runtime/UI state stays consistent.

## Disguise duration cap, status hover time formatting, and 月影沙 consumable (2026-05-09)

**Problem set**:
1. All `伪装` states needed a hard maximum duration of 4 minutes instead of relying on per-source durations.
2. The status-bar hover hint needed remaining time in `分 / 秒` instead of raw seconds.
3. `月影沙` needed to become a real consumable: 30s cooldown, usable in combat, blocked by hard control except slow, grants a 7s stealth/speed/no-jump buff, breaks on normal casts, and breaks instantly when hit.

**Fix**:
- Clamped disguise duration in the shared disguise definition and again in the centralized `addBuff()` runtime path so every disguise source obeys the same 4-minute ceiling.
- Replaced the status-bar hover raw-seconds text with a shared `分 / 秒` formatter so long buff durations stay readable.
- Implemented `月影沙` as a shared runtime buff definition with `STEALTH`, `SPEED_BOOST(30%)`, and `NO_JUMP`, wired the consumable to apply it via `addBuff()`, and exposed the buff through preload metadata.
- Added centralized cast-break handling in `breakOnPlay.ts` and centralized incoming-hit handling in `onDamageHooks.ts`; the hit path now treats shield-absorbed damage as a real hit so `月影沙` still breaks even when HP damage is 0.

**Lessons**:
- For a rule that applies to a whole buff family, clamp it centrally instead of trusting each source definition to stay aligned.
- `NO_JUMP` already exists end-to-end in this codebase, so jump suppression should reuse that effect rather than inventing another movement lock.
- If a stealth-like effect should break "on hit", wire the shared damage hook with both `hpDamage` and `shieldAbsorbed`; a post-HP-only hook will silently miss shield-only hits.
- When a stealth buff should survive positive channel flow, keep it out of the forward-channel completion strip list and only control the start-of-cast break behavior in `breakOnPlay.ts`.

## 御骑 root lock, disguise strip, and highlighted minute cooldown labels (2026-05-09)

**Problem set**:
1. Minute-style HUD cooldown labels like `2m` needed to stand out more than second-scale labels.
2. `御骑` should not be castable while rooted.
3. Any new `御骑` buff application should immediately remove `伪装`, including other abilities that grant the same mounted buff.

**Fix**:
- Added a minute-only BattleArena cooldown-label modifier so `Xm` overlays render yellow and 20% larger without changing second-based cooldown labels.
- Added `cannotCastWhileRooted: true` to the `yuqi` ability definition so both backend validation and the existing frontend readiness gate block it while rooted.
- Hooked disguise stripping into the centralized `addBuff()` path when buff `2741` is applied, so any source of `御骑` clears `伪装` instead of duplicating the rule per ability handler.

**Lessons**:
- If only one formatted cooldown variant needs visual emphasis, key the style off the rendered label type rather than broadening the base cooldown-text class.
- When multiple abilities share one mounted-state buff, attach the side effect to the shared buff id in `addBuff()` so future grant paths inherit the same rule automatically.

## Root-locked 扶摇直上 and minute-style HUD cooldown text (2026-05-09)

**Problem set**:
1. `扶摇直上` could still be cast while rooted.
2. HUD cooldown text above 59 seconds still rendered as raw seconds or `M:SS` instead of compact minute labels like `1m` and `2m`.

**Fix**:
- Added `cannotCastWhileRooted: true` to the `fuyao_zhishang` ability definition, which automatically feeds both backend validation and the existing BattleArena client readiness gate.
- Added a shared `formatHudCooldownText(...)` helper in `BattleArena.tsx` and routed both ability-icon cooldown text and consumable cooldown text through it.
- Minute-scale HUD cooldowns now render as ceil-style `Xm` labels once they exceed 59 seconds, so `2m` covers `1:01` through `2:00`, `3m` covers `2:01` through `3:00`, and so on.

**Lessons**:
- If the client already mirrors a gameplay lockout flag, first verify the owning ability metadata before changing validation logic or input handling.
- When the HUD shows the same concept in multiple places, centralize the formatter; otherwise one surface can be updated while another keeps the old display style.
- For MMO-style minute cooldown text, the player expectation is usually bucketed upward (`1:01` -> `2m`) rather than floored (`1m`), so confirm the rounding rule before wiring the formatter.

## Bandage channel should not break disguise (2026-05-09)

**Problem set**:
1. Starting the `绷带` consumable channel while disguised immediately removed `伪装`.
2. The bug came from the shared consumable stealth-break hook, not from channel completion or combat-status cleanup.

**Fix**:
- Added a per-consumable `breaksDisguise` flag in `consumableService.ts`.
- Set `绷带` to `breaksDisguise: false` and taught `breakStealthForConsumable(...)` to preserve buff `980001` only for consumables that explicitly opt out.
- Kept the existing stealth-break behavior for other concealment buffs and other consumables.

**Lessons**:
- If a consumable should preserve a special concealment state, do not hardcode another one-off outside the shared break hook; pass the consumable definition into the hook and let metadata decide.
- `伪装` is close to stealth in targeting rules, but not every stealth-breaking action should automatically remove it.

## Ability charge frame fit and status stack badge alignment (2026-05-09)

**Problem set**:
1. The red charge border on hotbar abilities sat slightly too far inside the icon frame instead of matching the inner edge of the ability border.
2. Status-bar stack counts were anchored in the top-right corner and were too small to read comfortably.
3. This request was a HUD-only polish change, so validation needed to avoid live Playwright work and rely on build coverage.

**Fix**:
- Tightened the BattleArena charge-frame SVG square from the old `5..95` inset path to a `4..96` path so the red charge border tracks the icon edge more closely.
- Moved status-bar stack badges to the bottom-right corner and increased stack-count font sizes by 50% across normal, compact, and player-scaled variants.
- After the first pass was still visually too subtle in-game, tightened the stack badge's line box and added an explicit bottom-right glyph offset so the number itself, not just its span box, sits in the corner.
- Updated the HUD regression spec to encode the new stack-badge placement/font sizes and the new charge-frame path.

**Lessons**:
- When a HUD border overlay looks misaligned, verify whether the issue is the overlay container or the drawn path geometry; here the container was already correct and the SVG path inset was the real cause.
- For status icons, stack counts read better when anchored bottom-right because they avoid colliding with short buff names and match player expectation from MMO buff bars.
- If a badge is positioned with plain text only, changing `bottom/right` on the span may still look unchanged because the glyph sits high inside its own line box; tighten the line-height or offset the glyph explicitly.

## iPad in-game load failure from missing ResizeObserver support (2026-05-09)

**Problem set**:
1. After the desktop RMB-drag fix, the game could still fail to load on iPad and collapse into a generic client-side application error before the in-game scene appeared.
2. The failure was device-specific, so desktop checks alone did not reveal the root cause.
3. BattleArena and `@react-three/fiber` both depend on `ResizeObserver` during scene boot, and older Safari/iPad builds may not provide it.

**Fix**:
- Confirmed the failure mode by forcing `window.ResizeObserver = undefined` in a live browser session; the page crashed with `This browser does not support ResizeObserver out of the box` from `react-use-measure`.
- Added a lightweight `ResizeObserver` fallback that reports initial element bounds and refreshes on `window`/`visualViewport` resize.
- Installed that fallback from `InGameClient` before `BattleArena` and the R3F canvas mount, so older iPad/Safari builds get a compatible observer before in-game rendering starts.

**Lessons**:
- If iPad shows a generic Next.js client error while loading the battle screen, verify browser API support before chasing gameplay/runtime logic.
- For client-only compatibility shims used by scene libraries, install the shim before the arena tree mounts; patching only inside a deeper child can be too late for library startup.

## Combat icon darkening and right-drag camera smoothing (2026-05-09)

**Problem set**:
1. The icon-bar `战斗中` marker was visually too bright and needed a darker red.
2. PC right-click camera drag became visibly laggy after the recent camera anti-clip work.
3. Live in-game verification for this project needs to run against the HTTPS deployment, not localhost, so WebSocket/runtime behavior matches production.

**Fix**:
- Darkened the BattleArena combat marker from `#ff2424` to `#b11b1b` and updated the HUD source/browser style guards.
- Trimmed CameraRig collision sampling during active look input: keep the full wall/probe sample set when the camera is settled, but use a smaller support/probe subset for a short recent-look window so RMB drag does not spend as many BVH raycasts per frame.
- Stopped `ExportedMapScene` from raycasting the full exported GLB on mouse-drag pointer moves; hover hit-testing is unnecessary while the user is actively dragging the camera.
- Rate-limited the RMB visual facing sync in `BattleArena` to one `requestAnimationFrame` callback per frame instead of recomputing facing on every raw `mousemove`; the existing 30 Hz movement tick still keeps RMB camera-plus-facing behavior authoritative.
- Rebuilt backend/frontend, restarted PM2, and live-checked `https://zhenchuan.renstoolbox.com/` with the `catcake` account in Playwright; the in-battle HUD stayed at 60 FPS both idle and during scripted RMB drag.

**Lessons**:
- The recent camera anti-clip path is expensive because each frame can issue many BVH probe raycasts; when the symptom is RMB drag stutter, inspect CameraRig sampling before blaming generic React rerenders.
- In collision-test mode, exported-map canvas hover picking should not keep raycasting the full GLB while any mouse button is held for camera drag.
- If RMB mouse-look already has a lower-frequency authoritative movement/facing tick, avoid duplicating the same facing solve on every raw mouse event; cap visual sync to animation frames instead.
- For live gameplay verification in this repo, prefer the HTTPS deployment and the approved `catcake` test account so the browser test exercises the real WebSocket/runtime path.

## Consumable bar settings, disguise texture, and root-facing fixes (2026-05-09)

**Problem set**:
1. Consumables needed a configurable saved shortcut bar with 12-16 total slots, no default 4/5/6 hotkeys, real icon paths, and drag reorder between consumable slots.
2. The 伪装 cart GLB rendered white because the standalone character loader did not apply the exported map `texture-map.json` PBR textures.
3. Enemy abilities with no damage or debuff still needed to enter `战斗中` when they affected another player.
4. Root should freeze facing direction on both backend movement and frontend prediction, and control-panel cooldown reset needed to include consumables.
5. 砂石伪装 channeling should allow movement input but break when the player moves, and the resulting 伪装 buff should be right-click cancelable.

**Fix**:
- Replaced the three fixed consumable buttons with the ordered twelve-item catalog, image icons resolved through `/icons/{name}.png`, saved slot count/order/enabled settings, and native drag/drop reorder across visible consumable slots.
- Kept ability drag hit testing blocked from consumable slots while allowing consumable-specific drop handling; removed rendered hotkey labels and 4/5/6 key bindings.
- Added the ESC `快捷键设置` page with a left `物品快捷栏` tab, `关闭` toggle, and `格子数量` range from 12 to 16.
- Removed the old always-rendered placeholder item-slot strip from the same HUD row so the default live bar shows exactly the twelve consumables and no extra boxes.
- Loaded the cart GLB with exported texture-map albedo/MRE/normal material assignment matching `ExportedMapScene`.
- Added normal `PLAY_ABILITY` events and combat-status handling for enemy ability contact, reset `consumableCooldowns` in the testing cooldown reset, and made root block client/server facing changes.
- Changed 砂石伪装 to `lockMovement: false` + `cancelOnMove: true`, and marked runtime 伪装 metadata/backend cancelability as manual-cancelable.

**Lessons**:
- If a standalone GLB is reused outside `ExportedMapScene`, it still needs the export package texture-map material pass; the raw GLB may not carry the visual textures.
- For rooted facing rules, patch both the outgoing input payload and local camera-look prediction, otherwise the server can be correct while the client appears to turn.
- A configurable shortcut bar should persist slot order separately from visible slot count so hiding or shrinking the bar does not erase the user's arrangement.
- Consumable drag/drop should treat the bar as fixed slots, not list insertion; dropping into an empty visible slot must move the item to that exact index and leave the source empty.
- If the consumable row is the user-facing item bar, do not leave a second placeholder slot strip rendered after it; default visual count should match the actual default consumable slot count.

## 砂石伪装 consumable and disguise targeting (2026-05-09)

**Problem set**:
1. A new consumable needed a 2-second positive channel, a second combat check on completion, and a disguise state that self-roots without triggering control diminishing returns.
2. Disguised players needed to be visible as a normal exported-map object but not directly targetable or selectable, while still hittable by AOE.
3. Consumable slots needed to visually match ability-slot borders, and ability dragging needed to ignore consumable slots.

**Fix**:
- Added `砂石伪装` as `sha_shi_wei_zhuang`, a no-cooldown non-combat consumable with a locked 2-second forward channel; completion rechecks `inCombat` and recent enemy damage/debuff events before applying `伪装`.
- Implemented `伪装` as a self-applied BUFF with `STEALTH`, `ROOT`, and `DISGUISE`, using `STEALTH` for direct-target blocking instead of `UNTARGETABLE` so AOE enumeration can still hit the player.
- Combat-status entry now removes disguise immediately and clears enemy target selections aimed at the disguised player; backend target-selection also refuses stealth/disguise-blocked player targets.
- Frontend renders disguised players as the exported-map `wj_木车002_hd.glb`, keeps them visible through the stealth filter, hides their health/name billboard, and prevents click/tab selection.
- Consumable buttons now use ability-slot border styling and expose `data-consumable-slot` so ability drag hit testing explicitly ignores them.

**Lessons**:
- For “not selectable but still AOE-hittable,” prefer `STEALTH` plus UI/selection guards over `UNTARGETABLE`; `UNTARGETABLE` would block more enemy effect paths than intended.
- Self-root is safe for disguise immobilization because control diminishing returns only apply when `addBuff()` sees `sourceUserId !== targetUserId`.
- Reuse the exported map renderer's full-export path for disguise meshes instead of creating duplicate assets.

## Debuff combat keep-alive and consumables (2026-05-09)

**Problem set**:
1. Enemy-applied debuffs needed to enter/refresh `战斗中`, including debuffs applied by zones, while long-lived debuffs should only keep the pair in combat while the source and target stay within 60 units.
2. The existing combat status only stored a short event timestamp, so a 12-second debuff like 撼如雷 could fall out of combat after 3 seconds even if both players stayed close.
3. Consumables needed their own validator because ability lockouts such as silence/non-qinggong locks should not block consumable use or break consumable reverse channels.
4. A terminal build attempt used relative `cd backend` after the persistent terminal was left in `frontend`, so absolute project paths are safer for required build commands.

**Fix**:
- Enemy debuff application now records combat activity without the old range gate; periodic combat expiry keeps an existing link alive while an active enemy debuff remains on either player and the pair is within 60 units, and still drops the link when they leave range.
- Added a consumable runtime service and route with `金创药` as a 48.3万 heal-reduced instant heal on a 120s cooldown, and `绷带` as a 10s reverse-channel consumable ticking 1.93万 heal-reduced healing every second.
- Added consumable channel metadata so hard control, pull, knockback, and displacement can break bandage while lockout effects do not; frontend gets cooldown state and fixed lucide-icon item slots with 4/5 hotkeys.
- Removed the custom slash overlay from the `战斗中` marker so the icon bar uses the standard red lucide double-swords icon only.

**Lessons**:
- Combat entry and combat keep-alive are separate rules: debuff application can count immediately, but the long debuff sustain rule should be range-checked during expiry.
- Consumables should not reuse the ability validator wholesale when lockout semantics differ; give them a narrow validator and mark consumable channels explicitly.
- Use absolute paths for mandatory build/restart commands in this repo because the shared terminal keeps its working directory between commands.

## LayoutShell home background and F11 fullscreen correction (2026-05-08)

**Problem set**:
1. A game fullscreen fix put `background: #010409` on the shared `LayoutShell` `.container`, turning normal pages such as the home/game room page black behind their controls.
2. The in-game no-topbar shell still used an explicit `height: 100dvh`; browser fullscreen/F11 can make that dynamic viewport unit shorter than the visible viewport, exposing the white body at the bottom.
3. The focused Playwright suite only checked source strings for the fullscreen shell and did not verify normal-page background or bottom-pixel fullscreen coverage.

**Fix**:
- Removed the dark background from the shared `LayoutShell` container so normal pages inherit their white page background again.
- Kept the dark background only on the in-game fullscreen shell and changed it to fixed `inset: 0` with `height: auto`, so top/bottom constraints fill the viewport instead of trusting `100dvh`.
- Added Playwright coverage that renders a normal shell over a white body, then renders the in-game shell over a white body and verifies the bottom of the viewport is covered by the game shell/surface.

**Lessons**:
- Never put game-only dark surfaces on a shared app shell; scope them to the in-game route class.
- For browser fullscreen shells, fixed `inset: 0` with auto height is safer than explicit `100dvh` when the user's symptom is a bottom gap.
- A source guard is not enough for layout regressions; include a browser-computed viewport coverage check.

## BattleArena 战斗中 status and fullscreen HUD fixes (2026-05-08)

**Problem set**:
1. The game needed a non-buff `战斗中` status that enters on player-vs-player damage or in-range debuff hits and exits in symmetric pairs after a 3-second check.
2. Out-of-range DOT damage should still show `进入战斗`, but should not refresh the stay-in-combat timer unless the linked players are within 60 units.
3. The HUD needed `进入战斗` / `离开战斗` toasts plus a crossed-swords red marker on self, target, and target-target icon bars without using the buff/status bar.
4. The ESC footer still had an obsolete disabled login action, target range text was slightly too large, and F11 fullscreen could reveal a white strip below the game.

**Fix**:
- Added backend `inCombat` and symmetric `combatLinks` state plus a `COMBAT_STATUS` event, initialized on new battles.
- Centralized combat entry/exit in `combatStatus.ts`: damage events enter immediately, debuff-hit events require 60-unit range, and stale/out-of-range/dead links expire together every 3 seconds.
- Fed the combat-status helper from both immediate ability casts and the realtime game loop so direct casts, loop damage, DOTs, and debuff events share the same rules.
- Added frontend type support, toast handling, and a red crossed-swords marker to the icon bars, while keeping `战斗中` out of buff lists.
- Removed the obsolete ESC login button, reduced target distance text by 10%, and made the fullscreen no-topbar shell fixed/inset so the game covers the entire F11 viewport.

**Lessons**:
- A pair status is easier to keep symmetric when stored as links on each player and reconciled from events, rather than trying to patch every damage call site manually.
- DOT damage and stay-in-combat refresh are different rules: out-of-range damage can notify entry without extending the 3-second in-range activity window.
- Fullscreen game shells should cover the viewport with fixed inset sizing; otherwise body/page background can show through during browser fullscreen size changes.

## BattleArena ESC scaling, Catcake defaults, and WebGL recovery (2026-05-08)

**Problem set**:
1. The compact ESC shell needed to grow by 15% while keeping the existing page structure.
2. The game-settings `恢复默认` footer button felt out of place, but custom UI still needed a default-layout restore action.
3. The `体积碰撞开关` indirection hid the useful collision controls behind a second floating panel.
4. The top-left home button was too small for the current HUD scale.
5. 玉门关 could repeatedly hit WebGL context loss on iPad/other constrained devices, showing recovery text and sometimes disconnecting/crashing.
6. Catcake's saved custom UI layout needed to become the responsive default layout.

**Fix**:
- Increased the ESC shell to `688px` by `437px` and updated the responsive height cap.
- Removed the game-settings footer reset button, then added `恢复默认` to the custom-UI prompt where it applies Catcake's saved `1920 x 945` HUD positions through the existing viewport scaling helper.
- Removed the `showCollisionControlPanel` floating panel path and put direct `显示碰撞线` / `显示蓝图` checkboxes in the ESC `开关` test page.
- Increased the home button and icon from `34px`/`18px` to `51px`/`27px`.
- Changed WebGL recovery to wait for `webglcontextrestored` before remounting the canvas, capped mobile DPR, disabled mobile antialias, disabled mobile shadows by default, reduced exported-map shadow maps to `1024`, and made exported collision wireframes lazy so hidden debug geometry is not allocated during normal loading.

**Lessons**:
- WebGL context-loss recovery should reduce pressure and wait for restoration; immediately remounting the same heavy scene can create a visible recovery loop.
- Hidden collision debug lines still cost memory if their geometry is built up front. Keep the CPU collision data for gameplay, but allocate GPU wireframes only when a debug view is active.
- Responsive HUD defaults should store the authored viewport with the coordinates and scale at load/apply time rather than hardcoding screen-specific pixels.

## BattleArena compact ESC test/settings rework (2026-05-08)

**Problem set**:
1. The ESC panel needed to be reduced to half its previous footprint.
2. The centered custom-UI confirmation panel needed to be draggable without becoming a green custom-UI guide.
3. ESC footer actions needed `返回角色` removed and `退出游戏` wired to the same leave-game flow as the top-left home button.
4. The `测试` tab needed left-list pages for `开关` and `灯光控制`, with renamed switches and direct `屏幕坐标` behavior.
5. Lighting controls needed to move inside the ESC test page instead of rendering a separate floating panel.
6. Normal ESC placeholders needed to read as disabled gray, and game settings placeholders needed to be removed.

**Fix**:
- Shrunk the ESC shell to `598px` by `380px` with matching compact header, tabs, tiles, footer buttons, sidebars, toggles, and ranges.
- Added a dedicated non-persistent drag handler for the center `自定义界面` prompt; it uses neutral panel styling and never receives the green edit-guide class.
- Passed `leaveGameAndReturnHome` from `InGameClient` into `BattleArena` as `onLeaveGame`, removed `返回角色`, and made `退出游戏` call that handler.
- Replaced the flat test grid with a left-list layout: `开关` contains renamed test switches and `灯光控制` contains the moved light toggles, brightness slider, color picker, and presets.
- Made `屏幕坐标` toggle the screen coordinate overlay directly and removed the old secondary screen-coordinate panel state.
- Removed game settings placeholder sidebar/action entries and strengthened disabled normal-tile gray styling.

**Lessons**:
- When a control panel is moved inside ESC, separate the panel's visibility from the underlying debug state so live scene props continue to work without rendering duplicate floating UI.
- Draggable utility prompts should use a local, non-persisted position rather than joining the saved HUD placement map unless the user explicitly wants that prompt saved as part of custom UI.

## BattleArena ESC settings menu rework and top bar resize (2026-05-08)

**Problem set**:
1. The compact top metrics bar needed to grow by 30% along with its text.
2. The ESC panel needed a first-page system-settings layout similar to the provided screenshots.
3. Only `游戏设置` and `自定义界面` should be functional in the first-page placeholder grid.
4. `游戏设置` needed a second page with a back button and working `技能栏大小` / `显示GCD` controls.
5. The remaining debug/testing controls needed to move out of the normal settings view into a `测试` tab.

**Fix**:
- Increased the top metrics strip from `14.5px` to `18.85px`, with matching text and spacing growth.
- Replaced the old ESC control list with a large solid `系统设置` panel containing `常规` and `测试` tabs.
- Added placeholder setting tiles for the normal tab and wired `游戏设置` to a second page plus `自定义界面` to close ESC and enter custom UI mode.
- Moved `技能栏大小` and the full GCD visibility group into the `游戏设置` second page.
- Moved the remaining collision/debug controls into the `测试` tab with the same panel control styling.

**Lessons**:
- ESC overlays that block arena input should keep a single active shell and route pages with local state; this avoids duplicating settings persistence or keyboard handling.
- When moving live controls between panels, preserve the existing state keys and localStorage effects so the UI changes do not reset player preferences.

## BattleArena compact top bar and custom UI guide visibility follow-up (2026-05-08)

**Problem set**:
1. The top metrics bar and its text needed to be reduced by 50%.
2. The `玉门关` mode badge should no longer display.
3. Combat stat control buttons were too high and needed to move into the bottom half of the screen.
4. The `目标技能栏` custom UI box could collapse to nearly no height when there was no live target ability content.
5. Custom UI green guides could be hidden behind the actual widget and were too tight around the UI.

**Fix**:
- Reduced the top metrics strip from `29px`/`22px` text to `14.5px`/`11px` text and halved its spacing/button chrome.
- Removed the in-scene mode badge render entirely.
- Moved `.critPresetBar` to `top: 56%` so stat controls sit in the lower half of the arena.
- Added target skill preview placeholders plus fixed `32px` target skill slots so the custom UI guide includes icon height and ability-name text.
- Raised shared custom UI green overlays above widgets and expanded them by `6px` without adding layout padding or moving saved positions.

**Lessons**:
- A non-layout pseudo-element can be visually larger than the widget and still preserve exact saved placement if the parent padding/border remain zero.
- Custom UI preview content should include realistic placeholder dimensions; otherwise edit guides for context-dependent HUD widgets collapse when the live target state is empty.

## BattleArena top metrics bar and custom UI placement correction (2026-05-08)

**Problem set**:
1. The temporary `物品栏` needed to be reduced from sixteen slots to fourteen.
2. The self HP custom-UI guide showed an unnecessary `自身血条` label.
3. The C-key attribute panel was not included in custom UI positioning.
4. The top-right latency badge needed to become a full-width top metrics strip with `设置`, system time, render FPS, and network latency.
5. Floating custom-UI green edit boxes shifted after confirm because their editing border/padding changed the measured widget box.

**Fix**:
- Changed `ITEM_BAR_SLOT_COUNT` to `14` and re-centered the item-bar default fallback.
- Removed the self HP guide label in custom UI mode.
- Added a `heart-stats-bar` custom UI key and draggable placement wrapper for the C stats panel.
- Added a 29px full-width translucent gray top metrics bar with live system time, rAF-based render FPS, and the existing ping latency value, then removed the old RTT badge.
- Converted shared floating custom-UI edit chrome to an exact overlay pseudo-element so the green line displays the widget bounds without changing layout.

**Lessons**:
- Custom-UI edit chrome should use non-layout outline/overlay styling; any padding or border on the draggable element changes both saved geometry and the post-confirm visual position.
- HUD metrics that replace a corner badge should reuse existing measurement state when possible, then remove the old rendered surface entirely to avoid duplicate readouts.

## BattleArena item count, GCD/status sizing, and drag isolation follow-up (2026-05-08)

**Problem set**:
1. The temporary `物品栏` needed sixteen slots instead of ten.
2. The player GCD bar was still too wide, and status remaining-time numbers were too large.
3. Saving custom UI after moving `物品栏` made the bar appear to shift because edit chrome/label affected its layout box.
4. Holding an ability should fully suppress camera drag, even if the pointer moves away from the hotbar.

**Fix**:
- Increased `ITEM_BAR_SLOT_COUNT` to `16` and re-centered the default item-bar fallback.
- Reduced the GCD bar width/min-width and floating GCD width by about 10%.
- Reduced status timer font sizes by about 10%, including the player-scaled and mobile variants.
- Added scoped item-bar edit classes so the custom-UI label/chrome are absolute overlays and do not move the actual saved bar position.
- Guarded mouse camera handlers with `abilityDragActiveRef` so ability drags clear camera mouse state and do not rotate the camera.

**Lessons**:
- Draggable HUD edit labels should be overlay chrome, not layout content, when the saved coordinate is meant to anchor the real widget.
- If a drag operation has its own global pointer tracking, other global mouse systems must explicitly bail while that drag is active.

## BattleArena icon chrome, item slots, and reorder prediction follow-up (2026-05-08)

**Problem set**:
1. Icon-bar transparency was applied to text rows, so the name/range and resource number were dimmed along with the frame.
2. The item bar placeholder used a different slot size than the skill bar.
3. Optimistic skill reorders could flicker because derived ability state from the still-stale server hand briefly overwrote the prediction.
4. The temporary item bar needed to accept ability drags and swap with skill slots locally.

**Fix**:
- Removed text-row opacity from icon bars, reduced the name/range font size slightly, and moved 30% transparency to the surrounding chrome/background colors.
- Scaled item slots from the same `--ability-panel-scale` math as skill slots.
- Kept pending optimistic skill reorders applied until the authoritative slot index confirms the move, while still rolling back on request failure.
- Added local item-bar ability slots, draft-slot overrides, hotkey filtering, and pointer drop handling so abilities can temporarily move/swap between skill and item slots without staying castable from their old hotkey.

**Lessons**:
- When only HUD chrome should be translucent, use alpha colors on the frame/background instead of `opacity` on parent text rows.
- Optimistic UI that is derived from server state needs a pending overlay, not just a one-time state set, or normal state hydration can visibly snap it back.
- Temporary local inventory slots need explicit hidden-id and slot-override state in both render and hotkey paths so moving an ability out of the hotbar leaves a real empty slot instead of duplicating or preserving the old cast binding.

## BattleArena item bar, tooltip alpha, and optimistic hotbar reorder (2026-05-08)

**Problem set**:
1. Tooltip alpha was interpreted as 30% visible instead of 30% transparent, so ability and buff hover panels were too transparent.
2. Draft slot switching only updated after the reorder endpoint returned, making the interaction feel slow.
3. The discard strip needed more height, a bluer accent, and no hover border/glow.
4. A future item bar placeholder needed ten empty boxes with the same edge hover effect as ability slots, while not accepting skill drops.

**Fix**:
- Changed ability and buff hover panels to `rgba(0, 0, 0, 0.7)` for 30% transparency.
- Added frontend optimistic slot reorder prediction with rollback if the backend reorder request fails.
- Increased discard-strip height by 50%, changed the accent from cyan to bluer light blue, and removed the active outer hover glow.
- Added a draggable custom-UI `item-bar` placement with ten inert item slots that share the ability-slot edge hover overlay and have no drop target attributes.

**Lessons**:
- For UI opacity language, confirm whether the user means visible alpha or transparency amount; `30% transparent` maps to alpha `0.7`.
- Reorder prediction should use the same slot-index swap helper as the final state update and keep a previous-state rollback for failed requests.
- Future HUD containers that should not accept ability drops should avoid draft/drop data attributes entirely, so pointer hit testing naturally ignores them.

## BattleArena slot order, charge frame, and status blink follow-up (2026-05-08)

**Problem set**:
1. New non-common skills could land in the last visual slot because `slotIndex` fallback used full hand order after common abilities were appended.
2. Reorder behavior could feel like the wrong boxes were swapping when existing cards had duplicate or missing slot indexes.
3. Height and distance custom UI placements had unnecessary label text, tooltip panels were too opaque, and the discard strip still had a background tint.
4. Charge frames needed bottom-right path order, a smaller count badge, and explicit layering so shortcut text stays above the red frame while the count badge covers it.
5. Status bar icons blinked invisible below two seconds even though they should remain visible until the buff naturally expires.

**Fix**:
- Normalized draft slots separately from common abilities on frontend and backend, assigned new skills to the first available draft slot, kept common abilities after draft cards, and rejected the seventh skill with `只能拾取6个技能` for cheat add, draft selected slots, and pickup claims.
- Changed charge frame SVGs from `rect` to an explicit bottom-right-starting path, reduced charge badge width/font size, and added z-index ordering for badge/frame/shortcut text.
- Removed the height/distance custom UI label text, reduced ability and buff hint backgrounds to 30% black, removed discard background entirely, and switched its accent to light blue.
- Replaced full-slot cyan hover fill with edge-weighted gradients so the center stays transparent.
- Removed low-time opacity blinking from `StatusBar`; buffs now disappear only when their remaining time reaches zero.

**Lessons**:
- Draft slot fallback must be based on draft-card order only; using full hand order breaks as soon as common abilities are present.
- A compact array cannot be treated as visual slot truth after holes are allowed; normalize explicit slots, fill invalid/missing slots into first openings, then render from slot metadata.
- SVG stroke direction is safest when the path is written in the exact desired order instead of relying on browser `rect` path starts.

## BattleArena tooltip, custom UI, and empty-slot hotbar round (2026-05-08)

**Problem set**:
1. Ability and buff hover boxes needed to revert to whole-box black half-transparent styling instead of gray panels or desc-only backgrounds.
2. The height counter and blue range/distance text were still fixed HUD elements and could not be positioned in custom UI mode.
3. Icon-bar chrome needed to be half-transparent without dimming the actual health/shield fills.
4. The target-owned ability strip still had visible gaps and rounded icons, while the ability hover overlay did not match the desired cyan filled hover state.
5. Hotbar charge frames were accidentally restyled away from red, charge count badges were too small, discard used a yellow background, and dropping a skill onto an empty slot did not persist.

**Fix**:
- Restyled ability and buff hint containers to `rgba(0, 0, 0, 0.5)` and removed the separate gray ability-desc background.
- Added `height-counter` and `distance-indicator` custom UI keys, default placements, edit labels, and drag height clamping based on the actual dragged element size.
- Reduced alpha on icon-bar chrome/title/resource rows while leaving health and shield track/fill rules untouched.
- Tightened target-owned ability gaps, removed target-owned icon radius, changed ability hover to a translucent cyan fill/glow, restored red charge ring strokes, enlarged charge stack badges to match shortcut text, and replaced the discard strip with a dark transparent base plus cyan bottom indentation.
- Added draft `slotIndex` support on frontend and backend reorder persistence so moving an ability to an empty hotbar slot survives the authoritative update instead of compacting back.
- Updated Playwright HUD coverage to assert source guards and browser-computed styles for the tooltip, hover, charge, discard, custom UI, icon-bar, target-owned ability, and slot-index behaviors.

**Lessons**:
- Empty hotbar slots require persisted slot metadata; reordering only a compact array cannot represent holes after the server broadcasts state.
- Hover effects on icon buttons should be validated through pseudo-element computed styles because visually thin border overlays can pass source checks while missing the intended filled state.
- For draggable HUD elements, clamp against the measured element width and height, not just the mouse point, or large labels can be dragged partially off-screen.

## Ability bar pointer drag and hover styling round (2026-05-08)

**Problem set**:
1. Native HTML5 drag/drop over ability buttons was unreliable for slot-to-slot reorder, and dragging could leave the hover tooltip visible.
2. The dragged ability needed to follow the cursor at half slot size and invalid drops should return without changing order.
3. Cooldown hotkeys needed to show the same pressed visual feedback even when the ability could not cast.
4. The ability slot border, hover line, discard strip, scale mapping, and tooltip description background needed another visual pass.

**Fix**:
- Added pointer-based draft dragging that starts after a small movement threshold, renders a half-size fixed ghost, resolves release targets with `document.elementFromPoint`, and calls the existing reorder/discard endpoints only for valid slot or discard drops.
- Closed ability hover hints when dragging begins and blocked new hint opens while a drag is active.
- Updated hotkey handling so occupied draft/common slots set `pressedAbilityInput` before checking readiness, while casts still require `isReady` and no anti-stealth block.
- Doubled the source slot border to `2.5px`, added a small radius, changed the hover/pressed overlay into a thin semi-transparent line effect, restyled the discard strip with beige/cyan screenshot-inspired colors, and gave ability descriptions a gray tooltip background.
- Remapped the displayed ability-bar `1.00x` to the old `0.94x` visual size while preserving the `0.50x`-`2.00x` slider range.

**Lessons**:
- For hotbar reorder controls, pointer release plus `elementFromPoint` is more dependable than native drag/drop when nested buttons, images, overlays, and drop-strip children all participate in hit testing.
- Set the post-drag click guard before awaiting network reorder/discard work; otherwise a mouseup click can cast the ability before the async cleanup runs.
- Discard-zone child icons/text should ignore pointer events so hit testing returns the zone wrapper and not the decorative child.

## Ability bar drag/drop follow-up and visible hover overlay (2026-05-08)

**Problem set**:
1. The previous hover test checked `box-shadow`, but the white inset was under the ability icon image and therefore not visibly glowing in-game.
2. The ability-bar scale control needed to display down to `0.50x` while keeping the old `1.25x` visual size as the new `1.00x`.
3. The blue discard strip should appear only while dragging and touch the draft slots with no gap.
4. Draft abilities needed drag-to-reorder so moving slot 1 to slot 2 changes the hotkey slot after drop.
5. Invalid drops should naturally return the dragged ability to its original slot.

**Fix**:
- Moved the white hover/pressed glow to `.abilityBtn::after`, above the icon layer, and updated Playwright to assert the pseudo-element opacity/color rather than the hidden button shadow.
- Extended displayed ability scale to `0.50`-`2.00`; values below `1.00` now scale relative to the new default visual size.
- Wrapped the discard strip and draft slots in a zero-gap cluster, made the strip render only while a draft ability is being dragged, and kept it as a broad drop target above the slots.
- Used the existing `/cheat/reorder-ability` endpoint on slot drops and immediately mirrored the successful reorder into local `handAbilities`/`abilitiesRef` so hotkeys follow the new order without waiting for the WebSocket diff.
- Kept native drag cancellation as the invalid-drop return path and set a centered drag image so the held ability sticks to the cursor during drag.

**Lessons**:
- A computed `box-shadow` test can pass while a child image visually covers the effect; for icon buttons, put hover chrome in a positioned overlay layer and assert `::after` styles.
- Drag/drop HUD controls should use one continuous hit area for destructive actions; small gaps make the action feel unreliable even when handlers are correct.
- When reordering hotkey-bound slots, update the local hotkey source immediately after a successful backend response, then let the authoritative WebSocket diff confirm it.

## Ability bar hover, discard zone, and WebGL recovery round (2026-05-08)

**Problem set**:
1. Ability-slot hover changed the real border to white instead of keeping the dark border and drawing the glow inside it.
2. The ability-bar scale slider needed the old visual `1.25x` size to become the new displayed `1.00x`, and dragging the ESC-panel range control was being intercepted by arena input handlers.
3. Shortcut text and slot borders needed a small size increase, empty slots needed a gray fill, and a permanent blue discard strip needed to sit above the draft slots.
4. Pressing or holding ability hotkeys/mouse buttons needed to show the same visual feedback as hover until release.
5. The fullscreen/idle white-screen crash still had no direct stack trace, but the scene had a hidden second R3F canvas rendering continuously.

**Fix**:
- Moved the hover/pressed white effect into an inset `box-shadow` while preserving the dark green border color, increased shortcut text by 30%, and bumped the slot border source declaration to `1.25px`.
- Added a v2 ability-scale storage key and mapped displayed `1.00`-`2.00` to visual `1.25`-`2.00`, so the previous `1.25x` appearance is now the default `1.00x`.
- Excluded inputs, labels, interactive controls, and the ESC overlay from arena capture handlers so the range slider can drag normally.
- Made empty ability slots gray with a more-specific `.abilityBtn.emptySlot` rule after Playwright exposed CSS-order override by `.abilityBtn`.
- Added a permanent blue discard drop zone above the draft slots using the existing discard endpoint and added pressed-state tracking for keyboard and mouse ability inputs.
- Reduced idle GPU pressure by mounting the HongMeng self canvas only while active, and added main-canvas `webglcontextlost` recovery that remounts the scene with a dark recovery overlay instead of leaving a white viewport.

**Lessons**:
- For hover effects that must preserve a real border, assert both source and browser-computed border color; use inset shadows for the inner glow.
- Fractional CSS borders may compute as `1px` in Chromium even when the source is `1.25px`, so source guards are better than computed-width assertions for this exact tweak.
- Hidden always-running WebGL canvases are a likely source of idle/fullscreen instability; mount expensive overlays only while active and handle context-loss recovery explicitly.

## Ability shield, backpedal jump, hotbar scale, and leave prompt round (2026-05-08)

**Problem set**:
1. 蛊虫献祭 described a percentage shield but applied a flat shield value.
2. The owned ability bar needed screenshot-matched spacing, darker green borders, top-left key text, a corrected hover state, and a user-controlled 1x-2x scale in the ESC panel.
3. A backpedal double jump with S+Space incorrectly turned the player around instead of jumping backward while preserving facing.
4. Combat preset crit values and the detailed stat preset display were stale.
5. Explicit home-button leave needed to notify the remaining player with the same 5-second prompt style as a disconnect.

**Fix**:
- Changed 蛊虫献祭 to use `percentOfTargetMaxHp: true` on its shield effect and updated the ability descriptions to say `50%最大气血护盾`.
- Added a backpedal-air-jump path on backend authority and frontend prediction: S+Space double jumps use `3.7` units of backward travel and skip facing changes.
- Updated green/blue/purple crit presets to `30%`/`36%`/`46%`, aligned the backend starting crit with purple, and removed `x装` text from detailed stat buttons.
- Restyled owned ability icons with transparent rows/buttons, darker green borders, gaps between abilities, wider row spacing, top-left shortcut labels, matching shield corners, and the ESC-panel ability scale slider.
- Reused the disconnect modal for `leaveNotice`, so when one player exits via the home button the opponent sees a `Player left` prompt with the same 5-second countdown and Yes action.

**Lessons**:
- Percentage shield fixes should change both the effect payload and the visible ability copy so editor/runtime expectations stay aligned.
- Any movement authority change that affects prediction must be mirrored in `BattleArena.tsx` in the same pass, especially for facing-sensitive inputs.
- Leave flows can share one modal as long as the prompt records the cause (`left` vs `disconnected`) and keys the auto-return guard by user plus deadline.

## BattleArena HUD correction round and Playwright coverage (2026-05-08)

**Problem set**:
1. Several earlier HUD changes were incomplete because frontend-only values were changed while backend defaults or WebSocket payloads still used old values.
2. The skill bar visual changes needed computed-style verification: tray backgrounds, icon gaps, border colors, hover inner borders, shield visibility, and custom UI guide borders.
3. The repo had no Playwright setup, so UI regressions were only checked by build output.
4. Playwright creates result metadata after each run, which should not keep dirtying the working tree.

**Fix**:
- Removed the remaining add-skill panel header, aligned backend starting battle HP to `120万`, and changed WebSocket disconnect prompts to 5 seconds with a frontend clamp for stale 30-second payloads.
- Replaced the top-left text home button with a compact icon button and moved the mode badge so `玉门关` is not covered.
- Put status names directly on standard yellow with no dark stroke, restored ability custom-UI green borders, tightened owned ability gaps, reduced the target icon bar by 10%, and kept the shield white fill visible while removing only shield amount text.
- Removed red charge/LOS ability borders, removed gray hotbar/common-bar tray backgrounds, and restyled ability borders to dark gray-green with a white inner hover line.
- Added frontend Playwright config, a `test:e2e` script, and HUD regression tests that cover the source constants/rendered text plus browser-computed CSS for the visual rules.
- Added Playwright output directories to `.gitignore` and removed generated result metadata from the tracked diff.

**Lessons**:
- For timing or default-value changes, update every producer of the value, not only the component fallback that displays it.
- Visual HUD requests need browser-computed style tests when CSS transitions, module selectors, and stacked overrides can make source edits misleading.
- When adding tests to an existing app, include source guards for backend/frontend constants plus a small rendered CSS fixture for visual rules that do not require a full authenticated game session.
- Ignore Playwright output directories when introducing the runner, or the first successful test run will create unrelated result files.

## BattleArena HUD polish, shield display, and control panel formatting (2026-05-08)

**Problem set**:
1. Several HUD visual changes needed to affect only specific widgets: status timer weight, target-of-target edit chrome, shield overlays, owned ability icons, latency badge sizing, and the in-game home button.
2. Shield amount text on icon bars added clutter, and shield fill rounded corners looked wrong when the shield segment started after HP.
3. Combat preset labels and values needed clearer Chinese equipment labels and consistent `万` number formatting.

**Fix**:
- Reduced status timer font weight, changed status buff/debuff names to the standard yellow, widened target-of-target by 30%, and removed its centered custom-UI label.
- Removed shield amount labels from icon health bars and squared the left corners of shield fill overlays.
- Squared owned ability icons, reduced owned ability button size, and tightened ability gaps substantially.
- Shrunk and nudged the in-game `首页` button so it no longer overlaps the top-left preset controls.
- Renamed preset buttons to `白装`/`绿装`/`蓝装`/`紫装`, made the stats panel use `万` formatting, reduced purple preset HP to `120万`, shortened disconnect auto-quit to 5 seconds, removed the add-ability panel notice, and tightened the latency badge background.

**Lessons**:
- When a single shared HUD component handles multiple contexts, tune narrowly through the exact class or call site requested so target/enemy/player variants do not drift together.
- Shield overlays should avoid showing a second number inside compact health bars; the health ratio already carries enough numeric context.
- Inline debug/control panels often carry stale helper text and exact-number formatting that must be revisited when the UI becomes a player-facing tool.

## BattleArena HUD sizing and target-of-target custom UI split (2026-05-08)

**Problem set**:
1. Player-only HUD requests needed careful scoping so self icon/status changes did not resize enemy, target, or target-of-target UI.
2. Target-of-target was nested inside the target icon bar, which meant custom UI mode could not position it independently.
3. The remaining ability-bar custom UI guide needed a different edit-box shape than generic HUD placements.

**Fix**:
- Reduced only the player icon bar width, added a player-only `StatusBar` scale variant, and kept target/enemy status bars on the default sizing path.
- Lightened status timer text by reducing its weight and removing timer-only black stroke/shadow while leaving names and stack badges unchanged.
- Rebalanced the bottom skill bar upward by about 10% after the earlier reduction.
- Added a dedicated `target-target-icon-bar` custom UI key, default placement, preview, and standalone renderer so target-of-target can be dragged separately from the target icon bar.
- Added a target ability-bar custom UI edit style that is half the status guide width and removes the guide border/radius.

**Lessons**:
- For shared components like `StatusBar`, add explicit variant props for player-only tuning instead of changing base CSS that target/enemy panels reuse.
- Nested HUD widgets that need independent placement should compute their live data outside the parent render branch and use their own persisted custom UI key.
- Generic custom UI edit chrome is useful, but each HUD family may still need a scoped override when the desired edit box differs from the common green guide.

## BattleArena HUD save moved from localStorage to user profile (2026-05-08)

**Problem set**:
1. The BattleArena custom UI layout was only saved in browser `localStorage`, so the HUD arrangement was device-local and could disappear across browsers, devices, or cleared storage.
2. The user explicitly wanted this layout to behave like a real saved profile setting instead of a session-local browser cache.

**Fix**:
- Added `battleArenaUiLayout` to the backend `User` model so each account can persist HUD positions and the viewport they were authored against.
- Added authenticated gameplay endpoints at `/api/game/ui-layout` to load and save the sanitized HUD layout payload.
- Rewired `BattleArena.tsx` to hydrate draggable HUD positions from the server on load and persist changes back through the authenticated API while keeping the existing viewport-scaling logic.

**Lessons**:
- HUD personalization that the player expects to follow their account should live on the authenticated user profile, not in browser-only storage.
- When replacing a legacy localStorage save path, keep the payload shape compatible enough to reuse existing normalization and scaling code instead of branching persistence logic.

## Fullscreen-safe BattleArena custom UI scaling (2026-05-08)

**Problem set**:
1. The BattleArena custom UI saved HUD placements as raw pixel coordinates with no viewport metadata.
2. Entering or leaving fullscreen changes the arena viewport size, so saved custom HUD layouts could drift or look wrong even though the player wanted the same relative arrangement.

**Fix**:
- Changed BattleArena UI-position persistence to store both the HUD positions and the arena viewport size that those positions were saved against.
- Added resize-time scaling so existing in-memory HUD placements rescale proportionally when the arena viewport changes, including fullscreen transitions.
- Also scale the custom-UI edit snapshot during viewport changes, so cancelling out of custom UI in fullscreen still restores the correct relative layout instead of old raw pixels.

**Lessons**:
- Any draggable HUD layout intended to survive fullscreen changes must either store normalized coordinates or carry the source viewport and rescale on resize.
- If custom UI has a cancel snapshot, resize logic must update that snapshot too or fullscreen entry will make cancel restore the wrong geometry.

## In-game home button, timing-bar resize, and top-bar route gating (2026-05-08)

**Problem set**:
1. The self timing bars needed their sizes retuned again: the self channel bar should be longer than the GCD bar, and both should be about 20% larger.
2. After moving the global top bar out of the in-game view, the arena still needed its own top-left home button that uses the same `/api/game/end` leave flow before routing home.
3. The shared layout shell only treated `/game/in-game` as in-game, so the duplicate `/game/screens/in-game` route could still render the global top bar incorrectly.

**Fix**:
- Retuned the self timing bars by setting the HUD channel bar to `70%` / `264px` and the GCD bar to `60%` / `226px`, which swaps their relative lengths and makes both about 20% larger.
- Added a fixed top-left `首页` button in `InGameClient.tsx` and routed it through the same `/api/game/end` request before `router.replace('/')`; the disconnect prompt now reuses that same helper too.
- Updated `LayoutShell` to treat both `/game/in-game` and `/game/screens/in-game` as in-game routes, skip rendering the shared `TopBar` there, and give the game view a full `100dvh` content area when the top bar is hidden.

**Lessons**:
- For these HUD bars, percentage width plus a floating-width constant must be tuned together or the inline and custom-UI placements drift apart.
- When replacing a shared navigation control with an in-scene button, reuse the same leave endpoint so battle teardown behavior stays consistent.
- Route gating for layout chrome should match every mounted route alias, not just the canonical page path, or duplicate screen entry points will regress independently.

## Self timing bars custom-UI anchors and icon-bar title trim (2026-05-08)

**Problem set**:
1. The self channel bar and self GCD bar were rendered inside the owned ability stack, so custom UI mode could only move them together with the hotbar instead of as independent HUD widgets.
2. When those bars are inactive, custom UI mode still needs visible previews and stable default anchor positions so the user can drag them before they appear in combat.
3. The icon-bar title above self/target bars needed to read about 10% smaller without retuning the rest of the bar.

**Fix**:
- Added dedicated `player-channel-bar` and `player-gcd-bar` UI position keys in `BattleArena.tsx`, seeded them when custom UI mode opens, and rendered the self timing bars as separate floating placements whenever the user is editing or has saved a custom position.
- Kept the old inline layout as the default path until a custom position exists, and used preview renderers plus hotbar-relative fallback placement so custom UI mode can drag both bars even when they are not currently active.
- Added CSS custom-property width overrides for the channel/GCD bar roots so the floating draggable boxes match the live bar widths, and reduced `.enemyName` font size from `16px` to `14.4px` for the requested 10% title trim.

**Lessons**:
- If a HUD widget should be draggable independently, it needs its own persisted anchor key even when it normally lives inside a larger shared stack.
- Preview renderers matter for combat-only HUD elements; otherwise the custom UI editor can store positions for panels the user cannot currently see.
- For percentage-width HUD bars reused in floating placements, a CSS variable width override is a low-risk way to preserve the inline layout while giving detached anchors a stable measured size.

## Target channel-bar width context and placement under icon bar (2026-05-08)

**Problem set**:
1. The selected target channel bar was rendered below the entire target HUD row instead of directly under the primary target icon bar.
2. Even though the enemy channel-bar component already used `70%` width, that width was being measured against the wider target HUD group, not the 252px target icon bar itself.
3. The bar needed to count visually as part of the target icon bar: centered under it with a small gap.

**Fix**:
- Moved the selected target channel bar render path in `BattleArena.tsx` into a new `enemyPrimaryBossStack` that contains the main target icon bar plus its channel bar.
- Kept the existing `variant="enemy"` channel styling, so the inner bar remains `70%` wide, but now that `70%` is measured against the target icon bar stack instead of the whole top row.
- Added a dedicated `enemyPrimaryBossStack` layout in `BattleArena.module.css` and removed the old negative top offset from `enemyBossChannelSlot`, replacing it with a normal stacked gap so the channel bar sits directly underneath with visible spacing.
- Rebuilt frontend and backend, restarted PM2 on the newest successful build, then flushed logs and restarted frontend once more to clear a transient backend-startup race before verifying clean PM2 tails.

**Lessons**:
- If a child already has the correct percentage width but still looks wrong, check what parent width it is being measured against before retuning the child itself.
- For HUD elements that should read as part of the same widget, place them in the same local stack instead of trying to position them correctly from a wider outer group.

## Status countdown checkpoint blink and full-height edit overlay (2026-05-08)

**Problem set**:
1. The urgent status blink still did not follow the requested checkpoints; it needed to start below 2 seconds and reach exact fully hidden / fully visible points at 1.49, 0.99, 0.49, and 0.01 before disappearing at 0.00.
2. Screenshot review showed the custom-UI green guide still used a fixed height, so the timer text could fall below the box even after a previous height increase.
3. The live status icons, names, and timer text needed to be about 10% smaller while keeping the editor guide aligned to the actual content.

**Fix**:
- Changed `StatusBar/index.tsx` so urgent blinking starts only when `secsLeft < 2` and uses explicit piecewise opacity interpolation for the 1.99 → 1.49 → 0.99 → 0.49 → 0.01 checkpoints.
- Reduced shared StatusBar icon, timer, name, stack-badge, spacing, and compact-mode sizing by 10% in `StatusBar/styles.module.css`.
- Replaced the fixed-height `customUiStatusGuide` overlay in `BattleArena.module.css` with a full-height `top/right/bottom/left: 0` overlay so the green frame always covers the full live status content.
- Rebuilt frontend and backend after each numbered point, flushed PM2 logs before the final restart, and verified fresh frontend/backend PM2 tails without startup errors.

**Lessons**:
- When the user gives explicit blink checkpoints, encode the opacity curve directly instead of deriving it from the fractional part of the current second.
- In a HUD editor, overlay guides should stretch to the real content height rather than guessing a fixed pixel height, or timer text will drift outside the frame as component sizing changes.
- If a guide box must match a live shared component, shrink the shared component and stretch the guide to it rather than tuning both with separate hard-coded heights.

## Custom UI status overlay restore and guide height retune (2026-05-08)

**Problem set**:
1. The user specifically meant the green custom-UI edit boxes in BattleArena, not the underlying StatusBar content size.
2. Replacing the real detached `StatusBar` with a guide-only placeholder in custom UI mode made it impossible to verify whether the live HUD was aligned correctly while dragging.
3. After restoring the live status UI, the green guide box still needed to be taller by 50%.
4. The edit labels for green draggable boxes needed to stay centered inside the guide box instead of above it.

**Fix**:
- Changed `renderStatusPlacement` in `BattleArena.tsx` so the live `StatusBar` keeps rendering during custom UI mode and the green drag guide is layered over it instead of replacing it.
- Kept `.customUiPlacementLabel` centered inside the green guide overlay so the edit-box name stays readable without hiding the drag frame.
- Initially increased the overlay guide height in `BattleArena.module.css` from `28px` to `42px`; later screenshot review showed that a fixed height was still insufficient, so the final solution became a full-height overlay tied to the live content.
- Rebuilt frontend and backend after each numbered point, flushed PM2 logs before the final restart, and verified fresh frontend/backend PM2 tails with no startup errors.

**Lessons**:
- In a HUD editor, the drag guide should be an overlay on the live component, not a replacement for it, or the user loses the ability to judge alignment.
- Keep drag-guide sizing in the overlay CSS so visual tuning does not accidentally change the real HUD content path.

## Status-bar custom UI height correction after wrong-layer edit (2026-05-08)

**Problem set**:
1. The earlier custom-UI size change was applied in `BattleArena.module.css`, but the user still saw effectively no height change on the detached buff/debuff placement boxes.
2. The visible custom-UI status placement height was actually being held open by the shared `StatusBar` component, which always reserved two rows of height even when a filtered BUFF-only or DEBUFF-only bar rendered only one row.

**Fix**:
- Added a `singleRowStatusBar` path in the shared `StatusBar` styles and applied it automatically whenever `categoryFilter` reduces the bar to a single row.
- Left the widened custom-UI placement wrapper in place, so once the shared status-bar min-height was corrected, the green edit box became both shorter and wider as intended.
- Rebuilt frontend and backend and restarted PM2 on the newest successful build; fresh frontend/backend PM2 tails again showed no startup errors.

**Lessons**:
- When a visual wrapper change appears to do nothing, check whether the child component is enforcing a larger intrinsic size; fixing the wrong layer can be technically valid but visually irrelevant.
- Detached BUFF-only and DEBUFF-only status bars should not inherit the two-row min-height used by the combined status display.

## Target ability-bar split, status-frame resize, and self-bar width trim (2026-05-08)

**Problem set**:
1. The target drafted-ability row was still bundled inside the target HP cluster, so custom UI mode could not position the target ability bar independently from the target icon bar.
2. Custom UI status-bar indicator frames were taller than needed and not wide enough for easier placement reading.
3. The self icon health bar still needed to be about 25% narrower without changing the target bar widths.

**Fix**:
- Added a dedicated `target-owned-ability-bar` UI position key, ref-based default placement, and floating render path so the target ability row can be positioned independently from the target HP cluster while staying inline until a custom position exists.
- Removed the literal `目标血条` custom-mode text from the target HP anchor by dropping the label there and changing the preview title to `18m · 目标`.
- Retuned the custom UI status placement frame in `BattleArena.module.css` to halve its minimum height, reduce vertical padding, and widen its width by about 30%.
- Reduced `.playerIconBar` width from `252px` to `189px`, trimming the self bar by exactly 25% while leaving target bars unchanged.
- Rebuilt frontend and backend after each numbered point, restarted PM2 on the newest successful build each round, and verified fresh backend/frontend PM2 tails without startup errors.

**Lessons**:
- If a HUD element can be repositioned independently in the UI editor, it needs its own persisted anchor key even when it is visually nested under another cluster in the default layout.
- For custom placement frames, reducing vertical padding matters as much as reducing min-height; otherwise the “green box” still reads too tall even after shrinking the nominal height.
- When a width change is intended for the self HUD only, adjust the self-specific class rather than the shared boss-bar width so target bars do not regress.

## Custom UI editing for player/target/ability HUD anchors (2026-05-08)

**Problem set**:
1. Custom UI editing only exposed detached buff/debuff status rows, so the always-visible self icon bar, target icon bar, and owned ability bar could not be repositioned.
2. The owned ability bar lived inside the bottom HUD flex layout, so it needed a draggable path that could preserve the default centered layout until a saved custom position exists.
3. The target icon bar can be absent when nothing is selected, but custom UI mode still needs a draggable anchor for it.

**Fix**:
- Added dedicated UI position keys for the self icon bar, target icon bar, and owned ability bar, all stored in the existing `zhenchuan-ui-positions` localStorage payload.
- Seeded those keys from current on-screen DOM positions when custom UI mode opens, so confirming without dragging keeps the HUD visually stable instead of jumping to guessed coordinates.
- Reused the existing drag session flow for the self and target bars, extracted the owned ability bar into a reusable renderer so it can stay inline by default and switch to a floating absolute placement once configured, and added a target-bar preview in custom UI mode when no target is selected.
- Rebuilt frontend and backend and restarted PM2 on the newest successful build; a clean post-flush PM2 restart showed empty fresh error logs plus backend server start and frontend `Ready` lines.

**Lessons**:
- HUD panels that already have a stable live DOM position are safer to seed from measured rects than from guessed pixel offsets when introducing custom placement persistence.
- For panels embedded in a flex layout, the least disruptive migration is to keep the original inline layout until a custom position exists, then switch to a floating absolute render path that reuses the same content renderer.
- Custom UI edit frames must explicitly restore pointer events on normally non-interactive HUD containers, or the drag handlers will be wired but unreachable.

## Slow one-second urgent buff fade correction (2026-05-08)

**Problem set**:
1. The under-3-second buff warning still looked instant because the previous implementation only hid the item for a tiny slice of each second.
2. The warning needed to read as a slow one-second blink cycle instead of a near-instant flash.

**Fix**:
- Changed `StatusBar` urgent behavior to derive opacity continuously from the live fractional second remaining, so each 2 → 1 → 0 warning cycle fades over the full second.
- Increased the local status countdown refresh cadence from 100ms to 50ms and added a short opacity transition to smooth the fade.
- Rebuilt frontend and backend and restarted PM2 on the newest successful build.

**Lessons**:
- A brief hide-window is not equivalent to a “slow blink”; if the user asks for a one-second blink, drive opacity across the full second rather than toggling visibility at the edge of the second.

## Single HP-boundary divider, second-aligned blink, and borderless target-target icons (2026-05-08)

**Problem set**:
1. The BattleArena icon bars showed three fixed white divider ticks, but the requested visual was a single softer divider only at the live boundary between filled HP and missing HP.
2. Sub-3-second buff blinking was driven by a free-running CSS animation, so it did not blank once per actual displayed second and could appear to blink only twice before expiry.
3. The compact target-target status bar should keep its icons but remove the icon borders entirely.

**Fix**:
- Replaced the 25/50/75 tick rendering in `BattleArena.tsx` with a single divider tied to each bar's current HP percentage and retuned the divider in `BattleArena.module.css` to a 2px half-transparent white line.
- Replaced the free-running urgent CSS animation in `StatusBar` with a live time-sliced hide window based on remaining seconds, so the buff blanks once during each displayed second under 3 seconds and the final blank happens during `0.x` before removal.
- Added an opt-in `borderlessIcons` variant to `StatusBar` and applied it only to the target-target compact status row in `BattleArena.tsx`.
- Rebuilt frontend and backend after each numbered point and restarted PM2 on the newest successful build each time.

**Lessons**:
- Divider visuals in segmented bars need to follow the live fill boundary rather than using static percentage markers when the UI intent is “current HP vs missing HP.”
- Countdown blink behavior that must align with displayed seconds is more reliable when derived from live remaining time than from a free-running CSS animation loop.
- Shared HUD components are easier to tune safely when special cases such as borderless compact icons stay behind explicit opt-in props.

## Status-bar timing spacing frame retune and enemy divider restore (2026-05-08)

**Problem set**:
1. Status-bar second timers rounded up, so `0.x` seconds showed `1″` and `1.x` seconds showed `2″`.
2. The gap between status names and icons was too large.
3. Status text still read weaker than the reference image; the main visual difference was stronger dark text outline/shadow separation rather than icon border alone.
4. Status icon borders needed a more neutral gray frame at about half the previous thickness.
5. The enemy icon bar should show lost health as a muted gray-red track rather than a pure neutral gray track.
6. The vertical HP divider lines were not visible because the CSS existed but the tick elements were not rendered into the bars.

**Fix**:
- Changed StatusBar sub-minute timer display to floor whole seconds, so live countdowns now show `0″`, `1″`, `2″`, etc. instead of rounding up.
- Split StatusBar internal spacing so the name-to-icon gap is about 70% smaller without collapsing the icon-to-timer spacing.
- Retuned the StatusBar icon frame to a thinner neutral gray border and matching thinner hover framing.
- Retuned the enemy icon-bar empty-health track in `BattleArena.module.css` to a desaturated gray-red tone.
- Rendered 25/50/75% tick elements into all BattleArena icon bars and changed the tick styling to visible white dividers above the fill.
- Rebuilt frontend and backend after each numbered point and restarted PM2 on the newest successful build each time.

**Lessons**:
- If the UI should display “time remaining as whole seconds left”, floor-based display is the correct rule; ceil-based display overstates near-expiry timers.
- In this HUD, readability differences between reference text and in-game text come mostly from text stroke/shadow strength and brightness separation, not just icon border color.
- Divider CSS alone is not enough for segmented HP bars; confirm the separator elements are actually rendered into each bar variant.

## Icon-bar empty-health gray state and white-track inset fix (2026-05-07)

**Problem set**:
1. The red target icon bar kept showing a red empty-health area after damage instead of the neutral gray look already used by the white self bar.
2. On the white self icon bar, the HP fill sat flush against the track border, which made the lower edge read slightly outside the border.

**Fix**:
- Updated the shared `enemyHpTrack` background and inner highlight in `BattleArena.module.css` so the exposed empty-health area reads gray while preserving the red HP fill gradient.
- Added a white-bar-only `top: 1px; bottom: 1px;` inset for `.selfIconBar .enemyHpFill` and `.selfIconBar .enemyShieldFill` so the fill sits inside the track border.
- Rebuilt frontend and backend after each numbered point and restarted PM2 on the newest successful build each time.

**Lessons**:
- In this HUD, the color of lost health is controlled by the track background, not by the HP fill itself.
- Light icon-bar palettes reveal fill-to-border overlap much more than dark ones, so a small vertical inset is a safer fix than retuning the whole track height.

## Self border darkening and target-target self relationship styling (2026-05-07)

**Problem set**:
1. The silver-white self border still read too light against the new self icon bar body.
2. The target-target bar was still visually treated as an enemy target even when it resolved to the local player, so its border and name remained red.

**Fix**:
- Darkened the self icon bar outer border and inner HP track border in `BattleArena.module.css`.
- Added `targetTargetIsSelf` detection in `BattleArena.tsx` and apply `selfIconBar` styling to the compact target-target bar when the resolved target-target player is the local player.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- The target-target bar does not infer relationship styling from the resolved actor by itself; it needs an explicit self-style class branch when the resolved player is the local user.
- Because `.selfIconBar` rules come later than `.targetTargetBossBar` rules in `BattleArena.module.css`, the self palette can override the compact target-target red styling without duplicating another CSS variant.

## Shared icon-bar HP color retune (2026-05-07)

**Problem set**:
1. The new orange HP fill still leaned too orange and dark.
2. The lighter, slightly redder correction needed to apply not only to self, but also to the main target bar and target-target bar.

**Fix**:
- Retuned both `iconBarHpGradient` and `selfIconBarHpGradient` in `BattleArena.tsx` to the same lighter red-orange gradient: `#ff9a74 -> #ef5b39 -> #c92a1c`.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- All three icon-bar HP fills are controlled by the two gradient constants in `BattleArena.tsx`, so cross-bar color retunes can stay as a single-file change when the bar structure itself is already aligned.

## Self icon bar conversion and silver-orange palette update (2026-05-07)

**Problem set**:
1. The always-visible self HUD was still using the older compact `playerPanel` instead of the newer icon-bar shape used by target bars.
2. The self bar needed the same icon-bar structure as the target bar, but with a silver-white body and orange HP fill matching the provided reference image.
3. The selected-self top bar and the lower self panel needed to share the same self-specific HP gradient instead of inheriting the enemy red fill.

**Fix**:
- Replaced the lower self panel markup in `BattleArena.tsx` with the same `enemyBossBar` / `iconBarBody` structure used by the target bar while keeping the existing self-select click behavior.
- Added a self-only HP gradient branch in `BattleArena.tsx` so self bars use an orange fill instead of the enemy red gradient.
- Updated `.selfIconBar` styling to a silver-white body, cooler empty HP track, brighter white shield fill, and yellow title/resource text, and sized the lower self bar to the same width as the main target bar.
- Rebuilt backend and frontend, restarted PM2 on the newest build, and re-checked local frontend, backend preload, and deployed HTTPS health.

**Lessons**:
- The cleanest way to keep self and target bars visually aligned is to reuse the same icon-bar markup and branch only the self-specific palette.
- VS Code chat storage did not expose the uploaded reference screenshot as a directly readable image file in this session, so exact pixel sampling was not possible through the available file/image tools; the applied silver-orange palette was matched from the visible reference instead.

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

## Ability description regex migration (41 -> 32 first batch) (2026-05-30)

### What was changed
- Applied a targeted text migration in `backend/game/abilities/ability-property-overrides.json` for full main-damage fragments only: `X...(+[coef*...攻击])...伤害` -> `（coef*攻击力）点伤害`.
- Total replacements in batch 1: 32.
- Applied requested explicit mapping for 剑主天地: `86-95点(+[2.0781*最终阴性内功攻击])伤害` -> `（3.8541*攻击力）点伤害`.

### Why 41 became 32
- The original 41-count search matched any `(+[...攻击...])` fragment.
- 9 of those are not the same sentence shape as main-hit damage clauses (e.g., periodic damage suffixes, control-duration scaling, multi-clause projectile lines), so they were intentionally excluded from batch 1 to avoid over-replacement.

### Lesson
- For description cleanup, split passes by semantic shape first (main-hit clause vs periodic/control/auxiliary clause). This avoids changing non-damage or secondary formula text accidentally.

## Ability description parenthesis normalization + remaining 9 conversion (2026-05-30)

### What was changed
- Normalized ability override descriptions to ASCII parentheses in `backend/game/abilities/ability-property-overrides.json` by replacing full-width `（ ）` with `()`.
- Completed the previously excluded 9 formula fragments (periodic lines, multi-segment line, and one control-scaling suffix) to the simplified attack-power style.

### Validation
- Post-change scan result: full-width parentheses count `0` and legacy `(+[...攻击...])` fragments in descriptions count `0`.

### Lesson
- If style consistency requires ASCII punctuation, run punctuation normalization before formula migration to avoid mixed-width output and reduce cleanup passes.
