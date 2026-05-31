# Zhenchuan - Ability Related Experiences

Record ability-related solved problems, unresolved issues, and disproved approaches here.
Use this file for ability mechanics, buffs, cooldowns, casts/channels, damage/crit, and ability editor behavior.

## 1. 驭羽骋风双 Buff 合并为单 Buff (2026-05-31)

**Implemented / checked**:
- 在 `backend/game/abilities/abilities.ts` 中将 `yu_yu_cheng_feng` 的 Buff 从 2 个合并为 1 个：
  - 保留 `buffId: 1354`（名称 `驭羽骋风`，持续 3 秒）；
  - 移除 `buffId: 1355`（`驭羽骋风·减伤`）；
  - 将 `DAMAGE_REDUCTION 0.3` 并入 `1354`，使单 Buff 同时包含控制免疫与 30% 减伤。
- 同步更新该招式说明文案，改为仅显示一个 `驭羽骋风` Buff，效果包含“免疫控制 + 受到伤害降低30%”。

**Verification**:
- `cd backend && npm run build` 通过。
- `cd frontend && npm run build` 通过。
- `pm2 restart frontend backend` 成功，`frontend/backend` 均为 `online`。

**Observed (existing, not introduced by this change)**:
- `frontend` 日志仍有历史 `MaxListenersExceededWarning`。
- `backend` error log 主要为 lag probe / websocket 断开日志，启动流程正常。

**Lesson**:
- 当技能语义要求“一个状态承载多个效果”时，应优先在同一 Buff 上聚合效果，避免 UI 状态栏重复展示造成误读。



## 2. Ability description source audit and backup (2026-05-30)

**Implemented / checked**:
- Audited the ability description pipeline and confirmed the usual base/original text lives inline in `BASE_ABILITIES` inside `backend/game/abilities/abilities.ts`.
- Confirmed the live edited descriptions are persisted in `backend/game/abilities/ability-property-overrides.json` and merged into runtime abilities during rebuild.
- Confirmed there is no separate persisted backup store for original ability descriptions; the typed `originalDescription` field exists, but in the ability table it is only populated for `fenglai_wushan`.
- Wrote a timestamped JSON backup of the current effective ability descriptions to `backend/game/abilities/backups/ability-descriptions-backup-2026-05-30T05-32-00.404Z.json`.

**Lesson**:
- For ability descriptions, treat `BASE_ABILITIES` as the canonical source-of-truth for the original text and `ability-property-overrides.json` as the mutable live layer. If a reversible history is needed, create an explicit snapshot file before further edits because the current editor save path does not preserve prior descriptions automatically.



## 3. 五项技能平衡调整（天地低昂/春泥护花/狂龙乱舞/疾/太阴指）(2026-05-30)

**Implemented / checked**:
- 将天地低昂运行时减伤从 40% 提升到 55%：同步修改描述、Buff 描述和 `DAMAGE_REDUCTION.value`（`0.4 -> 0.55`）。
- 将春泥护花 Buff 持续时间从 15 秒提升到 20 秒（`durationMs: 15000 -> 20000`）。
- 将狂龙乱舞地面区域伤害频率从默认 0.5 秒改为每 1 秒：在 `PLACE_GROUND_ZONE` 效果中显式设置 `zoneIntervalMs: 1000`，并同步描述文案。
- 将疾冲刺距离改为 30 尺，并通过 `durationTicks: 24` 维持接近原冲刺速度（原为 37/30 tick，现为 30/24 tick）。
- 将太阴指后撤距离改为 20 尺，并将调息模型改为 4 层充能：`cooldownTicks: 0`、`maxCharges: 4`、`chargeRecoveryTicks: 750`，同时更新描述文案。

**Lesson**:
- 地面区域类技能如果不显式设置 `zoneIntervalMs`，会走 `GameLoop` 默认 `500ms` 频率。涉及“每秒/每0.5秒”调优时，必须同时改效果字段和描述文本。



## 4. 天地低昂减伤覆盖回退与烈日斩/破风降防语义修复 (2026-05-30)

**Implemented / checked**:
- 复盘发现天地低昂（buffId 2326）在 `buff-attribute-overrides.json` 中仍有 `properties: [{ type: "减伤", value: 40 }]`，会覆盖技能定义中的 `0.55`，导致实战仍是 40%。
- 将 buffId 2326 覆盖值从 `40` 修正为 `55`，使实战减伤与技能定义/文案一致。
- 将烈日斩 Debuff（buffId 2512）从 `DAMAGE_TAKEN_INCREASE 0.15` 改为 `DEFENSE_MULTIPLIER 0.85`，实现“防御降低15%”而非“易伤+15%”。
- 将破风 Debuff（buffId 2615）从 `DAMAGE_TAKEN_INCREASE 0.05` 改为 `DEFENSE_MULTIPLIER 0.95`，实现“防御降低5%”。
- 同步了 `abilities.ts`、`ability-property-overrides.json`、`buff-attribute-overrides.json` 的对应描述，避免编辑器描述与运行时效果分叉。

**Lesson**:
- 若 Buff 在 `buff-attribute-overrides.json` 配置了 `properties.减伤`，其值会覆盖技能表中的 `DAMAGE_REDUCTION`；出现“文案已改但实战未变”时，必须先核查该覆盖层。



## 5. 千蝶吐瑞无减伤语义与啸如虎Buff类别调整 (2026-05-30)

**Implemented / checked**:
- `啸如虎`（buffId 2602）在技能定义中的附带 Buff `category` 从 `BUFF` 调整为 `DEBUFF`，其余效果（`MIN_HP_1`、`DAMAGE_MULTIPLIER`、`CONTROL_ONLY_IMMUNE`）保持不变。
- `千蝶吐瑞`（buffId 2003）覆盖描述中删除“受到范围类伤害降低20%”语义，改为仅“免疫一切控制效果”，避免描述层误导为带减伤。

**Lesson**:
- Buff 语义变更应同时检查“运行时效果字段”和“覆盖描述层”；即使数值层没有减伤，旧描述也会造成错误认知与验收偏差。




## 6. Camera dash collision-aware prediction (2026-05-29)

**Implemented / checked**:
- Traced dash camera wall-entry jitter to frontend render prediction, not `CameraRig`: the camera follows `localRenderPosRef`, and active dash rendering used a linear predictor that ignored exported-map collision.
- Added collision-aware dash render prediction in `BattleArena.tsx`, using the same exported collision system readiness and play-area clamping path as movement prediction so the camera target stops with the visual/player body.
- Added a real `ESC -> 测试 -> 镜头测试` panel with live prediction/collision metrics and a browser probe for Playwright.
- Added a deterministic exported-map test positioning route and a live Playwright regression. The live test must cast through the in-page frontend path and refresh the browser state after cheat positioning; using `page.request` alone updates the server but can miss short active-dash states in React.

**Lesson**:
- Camera follow bugs can originate in render-target prediction rather than camera math. For short server-authoritative dashes, live browser tests should exercise the in-page state update path; request-context API calls can bypass frontend diff application and create false missed observations.



## 7. Chat input channel color tint (2026-05-29)

**Implemented / checked**:
- Changed the chat input text color to inherit the active composer channel color instead of using a fixed near-white color.
- The map composer now visually matches the outgoing map-channel tint while typing.

**Lesson**:
- When the send channel is visually encoded, the typed text should share that channel color so the composer feels like part of the same message pipeline.



## 8. Ctrl+left-click ability mention insertion in chat (2026-05-29)

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



## 9. Ability tooltip cast text wording update (2026-05-29)

**Implemented / checked**:
- Updated channeled-ability tooltip cast text from `3秒` style to `释放: 3秒` style.
- Kept instant-cast tooltip text unchanged as `瞬间释放`.

**Lesson**:
- Tooltip cast wording should clearly distinguish cast type semantics; explicit `释放:` prefix makes channel duration read faster without affecting instant-cast readability.



## 10. Ability tooltip zero-cooldown wording update (2026-05-30)

**Implemented / checked**:
- Updated ability hover tooltip cooldown formatting in `BattleArena.tsx` so skills with no cooldown now show `无调息时间` instead of `0秒`.
- Kept existing cooldown display behavior for positive cooldowns and multi-charge recovery unchanged.

**Lesson**:
- For tooltips, zero values that represent "no mechanic" should use explicit wording instead of numeric `0秒`, which reads like an active but empty cooldown.



## 11. Ability editor charge cooldown review fix (2026-05-30)

**Implemented / checked**:
- Traced the cooldown review page and confirmed it only read and wrote `cooldownTicks`, which is the wrong field for charged abilities.
- Updated the cooldown review snapshot/save path so abilities with `maxCharges > 1` now review `chargeRecoveryTicks` instead.
- Updated the cooldown review UI so charged abilities show `充能时间` rather than generic `CD` / `冷却时间` wording.
- Kept non-charge abilities on the existing `cooldownTicks` review path.

**Lesson**:
- Charge skills need a separate review surface from standard cooldown skills. Reusing a generic cooldown field hides the real runtime source of truth and makes editor changes look broken.



## 12. Charge cast lock and 生死劫月劫 timing adjustment (2026-05-30)

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



## 13. Ability tooltip cooldown should use real CD, not 3s test cap (2026-05-29)

**Implemented / checked**:
- Traced ability tooltip cooldown rendering to `formatAbilityCooldownLabel()`.
- Fixed charge-skill tooltip cooldown source to use uncapped recovery ticks for display (`tooltipChargeRecoveryTicks`) instead of runtime-capped `chargeRecoveryTicks` used by test-short-cooldown mode.
- Applied the uncapped tooltip recovery value to draft/common/special bars and martial ability info so tooltip cooldown text reflects real configured cooldown values.
- Root-cause correction: `buildAbilityPreload()` had a global 3-second clamp on `cooldownTicks` and `chargeRecoveryTicks`; removed this clamp so preload metadata now carries real cooldown values for all skills.

**Lesson**:
- Tooltip metadata and runtime cooldown state can have different intents. Keep tooltip cooldown sourced from canonical config values, while runtime state can still be test-capped for gameplay experiments.



## 14. Ability/consumable hover intensity softened by 30% (2026-05-29)

**Implemented / checked**:
- Reduced ability-slot and consumable-slot hover glow intensity to about 70% of previous strength.
- Lowered hover shadow from `0 0 8px rgba(255, 255, 245, 0.18)` to `0 0 6px rgba(255, 255, 245, 0.126)` for the relevant slot hover paths.
- Reduced hover highlight-overlay opacity to `0.7` while keeping active/pressed feedback at full opacity.

**Lesson**:
- For HUD hover feedback tuning, reduce both shadow intensity and overlay opacity together; changing only one can still feel overly strong.



## 15. GCD-only cooldown overlay should keep arc, hide number (2026-05-29)

**Implemented / checked**:
- Restored per-skill cooldown arc rendering for shared basic GCD lockouts by mapping shared GCD ticks into HUD cooldown display data with `cooldownDisplayKind: 'gcd'`.
- Kept the prior UX change that hides the numeric cooldown label for GCD-only lockouts.
- Follow-up correction: removed the separate GCD arc color branch and reused the normal cooldown arc visual, so GCD-only lockout now uses the same arc style as all other cooldowns.
- Applied this for both single-charge and multi-charge abilities when they are locked by shared GCD but not by their own cooldown/charge lock.

**Lesson**:
- For GCD-only lockouts, treat the arc and number as separate UI concerns: hide the number text but keep the exact same cooldown arc visual instead of introducing a second arc style.



## 16. Ability cooldown spinner regression fix for >1s cooldowns (2026-05-29)

**Implemented / checked**:
- Restored cooldown arc progression by stabilizing `maxCooldown` against raw runtime instance values (`instance.cooldown` / `instance.chargeLockTicks`) instead of relying only on definition cooldown fields.
- This prevents cases where `maxCooldown` collapsed to the live remaining ticks, which made the conic cooldown overlay stay near 100% and feel like it stopped spinning.

**Lesson**:
- For HUD radial cooldown percentage, use a stable max baseline from runtime instance data when ability definition cooldown fields can be absent, or the arc can appear frozen even while numeric cooldown keeps ticking.



## 17. Yumen prep phase, presence chat, and cooldown HUD (2026-05-29)

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



## 18. Dash identity, diagnostics stalls, and live regression proof (2026-05-29)

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



## 19. Lobby visibility and dash snapback regression (2026-05-28)

**Implemented / checked**:
- Changed lobby waiting-room visibility to depend on `started: false` instead of a one-player size filter, so full unstarted rooms still show in the lobby.
- Added mode-aware lobby counts/status and stopped auto-joining rooms that are already full.
- Added a live Playwright dash regression that creates one Yumen battle, enables test-short cooldown, performs at least ten frontend 蹑云逐月 dashes, and fails on `recent-dash-snap` or `hard-snap-xy` frontend correction probes.
- Reworked post-dash frontend reconciliation so local authoritative position still syncs to the server, but the render ref no longer hard-snaps during the recent-dash settle window.

**Lesson**:
- Lobby availability and lobby visibility are separate concerns: full rooms should be visible until started, while join/auto-join paths enforce capacity.
- Post-dash reconciliation should not use the same hard render snap as teleport/forced displacement. After a server-owned dash ends, sync local gameplay position to the server and let the render position settle to avoid visible snapback.



## 20. Yumen cooldown toggle, Z rescue, and dash HUD correction (2026-05-28)

**Implemented / checked**:
- Added the missing `/cheat/yumen/test-short-cooldown` route and changed runtime cooldown clamping so real cooldowns are used unless `safeZone.testShortCooldown` is enabled.
- Split Yumen rescue into the old support-ground helper (`虚空救援`) and a new current-player `Z救援` route using a top-down first-hit height helper that also considers exported AABB tops.
- Replaced Yumen spawn slots with the copied eight XYZ coordinates and preserved spawn Z during battle initialization/random spawn assignment.
- Moved coordinate copying out of the ESC panel into a lightweight HUD widget, and removed the BattleArena-level minimap pose interval that could force parent re-renders during local dashes.

**Lesson**:
- A testing checkbox needs both a backend toggle route and runtime logic gated by that state; a frontend checkbox alone just produces generic 操作失败.
- For exported-map rescue, support-ground height and top-down first-hit height are different tools. Houses/roofs need a top-down query plus AABB fallback, while void recovery can keep the support-ground path.
- Avoid parent-level intervals for fast HUD pose updates in `BattleArena`; during dash they can make only the local player feel laggy even when the server and opponent view are fine.



## 21. Cooldown import and six-player Yumen controls (2026-05-28)

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



## 22. HP nameplate CJK text, jump intent latch, and speed-buff expiry (2026-05-26)

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



## 23. Knockback, jump carry, shield, and stealth sound parity (2026-05-26)

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



## 24. Expired buff runtime cleanup (2026-05-25)

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



## 25. Local DB config drift and dash smoothing (2026-05-25)

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



## 26. Ability grayout combat warnings (2026-05-22)

**Implemented**:
- Centralized BattleArena hotbar grayout reasons so disabled draft/common/special ability buttons keep a concrete `disabledWarning` string.
- Routed disabled hotbar clicks and hotkeys through the existing 战斗警告 overlay instead of silently doing nothing for cooldown, GCD, channeling, power locks, control states, targeting, range, facing, and line-of-sight failures.

**Lesson**:
- Ability readiness and disabled-click feedback must share the same predicate path. If `isReady` only returns a boolean, the UI can gray an icon without knowing what message to show when the player tries to use it.



## 27. Post-dash jump prediction hitch (2026-05-22)

**Finding / fix**:
- Backend dash movement clears air-shift and airborne speed carry at dash start/end so the next jump does not inherit dash or stale airborne speed.
- BattleArena's local active-dash prediction cleared velocity and air-shift but did not clear `airborneSpeedCarryRef`, so the first jump after dash could predict a longer travel budget than the server and then visibly reconcile.
- Cleared frontend airborne speed carry during server-authoritative dash/recent dash snap, and made the recent-dash hard-snap window yield to a freshly queued local jump.

**Lesson**:
- For movement prediction, mirror not only position/velocity constants but also transient carry-state cleanup. A stale local carry value after dash can look like network or frame lag because the next jump is locally overpredicted and then corrected by server state.



## 28. Hidden buff display and shortcut settings (2026-05-23)

**Implemented / checked**:
- Added an ESC 测试 switch that leaves normal status bars unchanged by default and can flip StatusBar into a hidden-only mode using existing `hiddenInStatusBar` preload metadata.
- Rebuilt ESC 快捷键设置 with 技能栏、通用栏、物品栏 tabs, two bindings per row, global binding uniqueness, keyboard Ctrl/Alt combos, mouse buttons, and wheel up/down capture while preserving the existing default bindings.
- Confirmed accounts are stored by the backend `User` mongoose model in MongoDB database `baizhan_V2`, collection `users`; no `copilit`/`copilot` prefixed accounts existed in the active store, so the strict delete matched zero accounts.

**Lesson**:
- Debug visibility for hidden buffs should be a display-mode switch in StatusBar, not a mutation of buff metadata. Shortcut customization should layer over the existing defaults so camera/movement behavior remains unchanged until a user explicitly binds a conflicting mouse or wheel input.



## 29. Ability and item bar minimum readable size (2026-05-22)

**Implemented**:
- Raised the minimum stored `技能栏大小` from 0.5 to 0.85 and updated the ESC slider minimum so old tiny saved values normalize upward.
- Increased small-screen ability/item slot base size from 30px to 34px and enforced readable minimum hotkey/cooldown/count text sizes.

**Lesson**:
- Combining a very low saved UI scale with mobile CSS reductions can make ability and item bars unusably small on some screens. Clamp the setting to a playable minimum and test with old stored values like `0.5`, not only the default scale.



## 30. Qi-field channel timing, sound, and terrain visibility (2026-05-21)

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



## 31. Jump branch verification and Jiu Xiao cast sound (2026-05-21)

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



## 32. Channel completion stealth and load diagnostics (2026-05-21)

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



## 33. Ground dash targeting and power lock warnings (2026-05-21)

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



## 34. ESC ability sound settings range and mute (2026-05-21)

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



## 35. Browser-like 任驰骋 sound and self-AOE cast readiness (2026-05-20)

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



## 36. Carrier-centered 百足 explosion and channel sound teardown (2026-05-20)

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



## 37. Ability-level sound review decisions (2026-05-20)

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



## 38. Dash-complete sounds without audio speed-up (2026-05-20)

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



## 39. Targeted and exact-duration ability sounds (2026-05-20)

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



## 40. Ability sound special playback rules (2026-05-20)

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



## 41. Sound review ability-level judging and channel labels (2026-05-20)

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



## 42. Sound review ability editor decision tab (2026-05-20)

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



## 43. Ability sound browser, haste playback, and volume settings (2026-05-16)

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



## 44. Ability sound playback integration (2026-05-16)

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



## 45. Ability and transmission audit (2026-05-10)

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



## 46. 伪装 special bar cancel ability (2026-05-09)

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



## 47. 伪装 leash area on channel completion (2026-05-09)

**Problem set**:
1. `伪装` needed a fixed 2-unit area anchored at the channel-finish position.
2. If the disguised player is displaced out of that area for any reason after the channel completes, the disguise buff should be removed immediately.

**Fix**:
- Added runtime leash metadata to the applied `伪装` buff at the moment the consumable channel completes, using the player's channel-finish position as the anchor center.
- Added a `GameLoop` check that compares the player's current planar position against that anchored 2-unit radius and calls the shared `removeDisguiseBuffs(...)` helper when the player leaves it.

**Lessons**:
- Area-based post-channel rules belong on the applied runtime buff, not on the consumable definition alone, because the rule needs the exact resolved finish position.
- If a movement/displacement rule should remove disguise, reuse `removeDisguiseBuffs(...)` so target-selection cleanup and `BUFF_EXPIRED` events stay correct.



## 48. Forward-channel stealth timing correction (2026-05-09)

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



## 49. 御骑 root lock, disguise strip, and highlighted minute cooldown labels (2026-05-09)

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



## 50. Root-locked 扶摇直上 and minute-style HUD cooldown text (2026-05-09)

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



## 51. Bandage channel should not break disguise (2026-05-09)

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



## 52. Ability charge frame fit and status stack badge alignment (2026-05-09)

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



## 53. Debuff combat keep-alive and consumables (2026-05-09)

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



## 54. BattleArena item count, GCD/status sizing, and drag isolation follow-up (2026-05-08)

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



## 55. Ability bar pointer drag and hover styling round (2026-05-08)

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



## 56. Ability bar drag/drop follow-up and visible hover overlay (2026-05-08)

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



## 57. Ability bar hover, discard zone, and WebGL recovery round (2026-05-08)

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



## 58. Ability shield, backpedal jump, hotbar scale, and leave prompt round (2026-05-08)

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



## 59. BattleArena HUD polish, shield display, and control panel formatting (2026-05-08)

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



## 60. Target channel-bar width context and placement under icon bar (2026-05-08)

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



## 61. Target ability-bar split, status-frame resize, and self-bar width trim (2026-05-08)

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



## 62. Custom UI editing for player/target/ability HUD anchors (2026-05-08)

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



## 63. Slow one-second urgent buff fade correction (2026-05-08)

**Problem set**:
1. The under-3-second buff warning still looked instant because the previous implementation only hid the item for a tiny slice of each second.
2. The warning needed to read as a slow one-second blink cycle instead of a near-instant flash.

**Fix**:
- Changed `StatusBar` urgent behavior to derive opacity continuously from the live fractional second remaining, so each 2 → 1 → 0 warning cycle fades over the full second.
- Increased the local status countdown refresh cadence from 100ms to 50ms and added a short opacity transition to smooth the fade.
- Rebuilt frontend and backend and restarted PM2 on the newest successful build.

**Lessons**:
- A brief hide-window is not equivalent to a “slow blink”; if the user asks for a one-second blink, drive opacity across the full second rather than toggling visibility at the edge of the second.



## 64. Status readability, shield display, icon bar, and HTTPS verification (2026-05-07)

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



## 65. Cast guards, leave flow, lobby controls, target HUD, and status rows (2026-05-07)

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



## 66. Testing battle reset, channel cancellation, and manual battle exit (2026-05-07)

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



## 67. Standing casts, active-channel errors, movement feel, and map loading (2026-05-06)

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



## 68. Reverse channel finals, AD buffs, and purple defaults (2026-05-06)

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



## 69. Percent ability corrections and movement recovery diagnostics (2026-05-06)

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



## 70. Attack damage overhaul (2026-05-06)

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



## 71. Ability Editor tab grouping cleanup (2026-05-06)

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



## 72. GCD bar polish and jue mai cap tuning (2026-05-06)

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



## 73. GCD runtime/editor/visual bar overhaul (2026-05-06)

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



## 74. Pull/knockback buff audit (2026-05-06)

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



## 75. C panel display settings and GCD audit (2026-05-06)

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



## 76. In-game ability and buff hover panels (2026-05-05)

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



## 77. Editor session state, dummy buff cancel, and movement audits (2026-05-05)

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



## 78. Buff links, display metadata, and support-target cleanup (2026-05-05)

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



## 79. 减伤被顶 runtime + editor (2026-05-05)

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



## 80. 可以马上施展 editor property (2026-05-03)

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



## 81. 御骑后退限速 + 渊显示 Buff + 舍身诀命名 follow-up (2026-05-03)

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



## 82. 友方目标技能第二轮修正 + 图标路径编码 (2026-05-03)

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



## 83. 友方目标技能基础设施 + 舍身诀 / 渊 / 听风吹雪 (2026-05-02)

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



## 84. 无相诀改为施放时快照减伤档位 (2026-05-02)

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



## 85. 反隐灰置兜底 + 碎星辰/破苍穹回调 (2026-05-02)

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



## 86. 反隐灰置 + 云栖松/徐如林贯体化 + Buff 列表快速属性按钮 (2026-05-02)

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



## 87. 风袖/千蝶数值调整 + 反隐 companion cleanup + 非贯体清单审计 (2026-05-02)

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



## 88. 撼如雷 companion reveal fix + non-贯体 heal crits (2026-05-02)

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



## 89. Live 会心 panel + split 会心效果 + 紫气东来/撼如雷 (2026-05-02)

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



## 90. 碎星辰/破苍穹 channel-zone crit buffs (2026-05-02)

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



## 91. 外功会心/内功会心 split + 风来吴山/狂龙乱舞 retune (2026-05-02)

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




## 92. High-damage pass retune (2026-05-02)

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



## 93. 会心 panel toggle + damage float wording/layout follow-up (2026-05-02)

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



## 94. Crit chance presets + global crit damage pipeline (2026-05-02)

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



## 95. Special-bar GCD display, persistent per-ability cooldown, and silence bypass (2026-05-02)

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



## 96. 九霄风雷 follow-up rule corrections: dependent buff cleanup, reverse channel, special-bar GCD, 真·下车 lockout breadth (2026-05-02)

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



## 97. 洗兵雨 visual polarity + random ring placement + 九霄子技能 editor hiding + 魂压怒涛 retune (2026-05-02)

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



## 98. 九霄风雷 temporary skill bar + disarm channel interruption (2026-05-02)

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



## 99. Lockout family expansion: 缴械, 无需武器 editor, 洗兵雨 pickup zone, 抢珠式 (2026-05-02)

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



## 100. Buff-channel shield fix + FEAR_IMMUNE addition (2026-05-02 round 12)

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



## 101. Channel direction fixes + INTERRUPT_IMMUNE removal + 剑飞 dual-mode (2026-05-02 round 11)

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



## 102. 不可被打断 flip + 沉默免疫 unification + 剑飞惊天 + uninterruptible shield (2026-05-02)

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



## 103. 翔极碧落 + interruptible flag + channel filter (2026-05-02)

**Problem**: Need a new打断-style ability 翔极碧落 (20 unit, instant 1 dmg, interrupts a channel and applies SILENCE 4s) plus a per-ability "可以被打断" flag so designers can mark a channel as uninterruptible. Plus an ability-list filter for channeling abilities.

**Fix**:
- Added `interruptible?: boolean` to `AbilityChannel` (runtime metadata) and to `ActiveChannel` (live channel state). `buildRuntimeChannelInfo` now copies `(ability as any).channelInterruptible !== false` so the field defaults to true and is only false when explicitly opted out. `playService.ts` copies the same flag onto `player.activeChannel.interruptible` when starting an active channel.
- Added the editor property `channelInterruptible` (label "可以被打断"). It lives in the 读条 group, so it auto-renders in the ability detail page's "添加读条属性 / 移除" UI without any frontend changes.
- New effect type `XIANG_JI_BI_LUO` (in `effects.ts`, `categories.ts`). Handler in `immediateEffects.ts` does (in this order): (1) skip if target has `INTERRUPT_IMMUNE`; (2) detect channel — `target.activeChannel` first, fall back to scanning `target.buffs` for a buff whose `sourceAbilityId` resolves to an ability with `channel.source==='BUFF'` and matching `channel.buffId`; (3) check `interruptible !== false`; (4) if interruptible, cancel the channel — for active, mirror `cancelActiveChannel`'s clear-startedBuffIds + remove activeChannel; for buff-source, remove the buff and emit BUFF_EXPIRED; (5) apply the silence buff declared on the ability.
- Ability `xiang_ji_bi_luo` (range 20, ATTACK, OPPONENT, gcd, cd 300): `effects: [DAMAGE 1, XIANG_JI_BI_LUO]` + `buffs: [{ buffId 2719, name "翔极碧落·沉默", DEBUFF, 4s, [{type:'SILENCE'}] }]`. Excluded from `applyAbilityBuffs` so the silence buff only fires through the custom handler when interrupt succeeds.
- Verified: the user-requested "免疫打断" effect is exactly the existing `INTERRUPT_IMMUNE` effect. 千蝶吐瑞 (buff 2003) and 笑醉狂 (buff 2001) already include `INTERRUPT_IMMUNE` alongside their other immunities, so they are already protected from 翔极碧落.
- Frontend ability list page: added a 4th filter row "读条" with options 全部 / 无读条 / 任意读条 / 正读条 / 逆读条. State is `channelFilter`, persisted in the same sessionStorage key `abilityEditorFilters_v2` (already used for search + tagFilters). Filter logic checks `ability.channelInfo?.mode`.

**Lesson**: When extending channel metadata, the right seam is the `AbilityChannel` runtime type plus `buildRuntimeChannelInfo` — that single function feeds the resolved `ABILITIES[id].channel` map that backend code can reliably read at runtime. Storing the flag as a raw boolean on the ability (`channelInterruptible: false` on opt-out) plus surfacing it via the existing 读条 group property auto-wires both backend behavior and editor UI without touching the detail page. For interrupt detection across both ACTIVE and BUFF channel sources, walking `sourceAbilityId → ABILITIES[id].channel` is more robust than maintaining a hardcoded buff-id allowlist (`isChannelBuffRuntime` is the legacy approach and only knows 5 buff IDs).



## 104. Channel bar polish round 2: blue border, instant fade, larger enemy text, success-green only on enemy (2026-05-02)

**Problem**: Follow-ups on the channel-bar lifecycle: (1) the teal border wanted to be more blue; (2) both bars appeared to "wait" before disappearing — root cause turned out to be the interrupt path's 1s hold AND a tight 80ms success threshold that misclassified some buff-driven reverse channels as interrupts (clock skew between client `Date.now()` and the server-stamped `appliedAt`/`expiresAt`); (3) the enemy bar text was fully inside the 7px-tall track and hard to read; (4) the green completion flash was leaking onto the self bar.

**Fix**:
- Border tone shifted from `rgba(99, 230, 190, 0.5)` (青色 / teal) to `rgba(99, 170, 230, 0.5)` (blue-leaning 青色) on both `.channelBarTrack` and `.enemyChannelBarTrack`, with matching shadow.
- Removed the 1s interrupt hold from `ChannelBarHost`. Both success and interrupt now fade immediately on data→null; the only remaining timer is the 0.5s fade unmount.
- Bumped success detection threshold from 80ms to 300ms so reverse buff channels whose `appliedAt`/`expiresAt` come from server-stamped time still register as success when they expire naturally despite client/server clock skew.
- Enlarged `.enemyChannelBarLabel` font-size from 8px → 10px (+25%, but visually the +20% the design asked for since 8px-on-7px-track was visually flush). Combined with `overflow: visible` on the wrapper, the text now extends slightly above and below the track and is far more legible.
- Self HUD bar success/interrupt path: removed all phase visuals. On data→null we snapshot the current progress, freeze it via `progressOverride`, set `fading=true` in the same render, and let the bar fade away. No green, no orange, no snap. The enemy bar still gets the green-on-success / orange-on-interrupt visuals.
- Added `fading`-aware `useNowMs` gating: the rAF clock is paused once a `progressOverride` is supplied so the bar does not keep ticking during the fade.

**Lesson**: Visual feedback for a "channel ended" event must be local to the surface it belongs to — green-flash-on-success is a boss-bar idiom and should never touch the self HUD bar even when both surfaces share a component. Also: any "did this buff/channel finish naturally?" check that relies on client-side elapsed time vs. server-stamped duration MUST budget for clock skew (≥ a few hundred ms) — an 80ms threshold is too tight on real networks and will silently classify legitimate completions as interrupts. Lastly: a "perceived wait before fade" almost always traces back to either an unintended hold timer or a same-render setState where the prior committed DOM never had a chance to paint the start of the transition; pause the clock and freeze the progress so the only thing animating is opacity.



## 105. Channel bar polish: per-variant completion semantics, teal border, label centered over enemy bar (2026-05-01)

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



## 106. Channel bar lifecycle: success/interrupt phases, fade-out, school-colored fill, timer label (2026-05-01)

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



## 107. Channel bar visuals: enemy is a yellow bar with name inside, forward channels show no middle 段落 (2026-05-01)

**Problem**: The enemy channel bar was a small floating overlay anchored above each opponent's head with a separate name pill, which did not match the design (a wide yellow bar with the name centered inside, sitting under the boss HP bar). Forward channels also rendered 1-second tick segments, but a forward channel's effect always lands at the very end, so middle segments are misleading. Reverse channel ticks were correct.

**Fix**:
- Reworked the `enemy` variant in `ChannelBar.tsx` to render a single yellow track with the ability name absolutely centered inside (no top label, no tick segments, regardless of forward/reverse).
- Removed the 1-second forward tick segments from `ForwardBar` for the regular HUD variant. Reverse bars still render `tickIntervalMs`-based 段落 marking the next periodic effect (heal/damage).
- Moved the enemy channel bar from the per-opponent floating overlay (`enemyChannelOverlays` + screen-bounds positioning) to a fixed slot inside `.enemyBossGroup`, immediately under the boss HP bar and above the status bar. The bar now follows the selected target (self / enemy / entity owner) and reuses `channelBarData` / `opponentChannelDataById`.
- Marked `.enemyChannelOverlayLayer` and `.enemyChannelOverlayItem` as `display: none` (kept as deprecated shims so any stray references stay valid until removed).

**Lesson**: When the design anchors an enemy UI element to a specific HUD landmark (the boss HP bar), prefer rendering it as a child of that landmark's container instead of recomputing screen-space coords from world-space. Also: forward and reverse channels have fundamentally different tick semantics — forward = single end-of-channel event, reverse = periodic effects — so a shared "always show ticks at 1s" path is wrong for forward.



## 108. Channel detail pages should show forward/reverse type first, then the concrete maintain/timing answers (2026-05-01)

**Problem**: The ability detail page already exposed `channelInfo`, but it presented channel settings as generic chips and numeric rows. That made it hard to answer the basic gameplay questions the editor user actually needs first: is this a normal channel or reverse channel, does it keep while moving, does it keep while airborne, how long is the total channel, and for reverse channels what is the tick interval.

**Fix**:
- Kept the existing editable channel controls, but added a read-first summary block at the top of the detail-page channel section.
- The summary now shows the channel type (`正读条 / Channeling` or `逆读条 / Reverse Channeling`), whether it maintains while moving, whether it maintains while airborne, the total channel duration, and the reverse-channel tick interval when one exists.
- Left the lower editable chip/numeric controls in place so the page answers the gameplay question first and the editing workflow second.

**Lesson**: For editor detail pages, the first UI layer should answer the player's or designer's semantic question directly. Raw property chips are fine as controls, but they are not a good primary representation of gameplay meaning.



## 109. Enemy channel UI needs normalized runtime channel metadata, and pure channels cannot be inferred from buffs[] alone (2026-05-01)

**Problem**: The runtime/frontend path had no canonical `ability.channel` model, so enemy channel UI had no reliable way to show both progress and spell name. At the same time, the existing editor-side channel accessor treated any `type: "CHANNEL"` ability with `buffs[]` as a buff-backed channel, which is wrong for pure channels that merely apply buffs on channel start or completion.

**Fix**:
- Added normalized runtime `ability.channel` metadata (`source`, `mode`, `durationMs`, cancel flags, optional `buffId` / `tickIntervalMs`) during `buildResolvedAbilities()`, then passed it through `/preload` so BattleArena can consume one channel model for both self and enemies.
- Changed the channel accessor classification so `applyBuffsOnComplete` / `applyBuffsOnChannelStart` abilities stay on the pure `activeChannel` path even when they also declare `buffs[]` for later application.
- Reworked BattleArena channel UI to derive bars from either `activeChannel` or a buff matched through normalized `ability.channel`, which also fixes reverse pure-channel bars that were previously rendered as forward.
- Added per-opponent screen-bound tracking in `ArenaScene` and rendered compact enemy channel bars above each visible opponent with the channel progress and ability name.

**Lesson**: In this codebase, `type: "CHANNEL"` and `buffs[]` are not enough to tell you how a channel runs. Normalize the channel runtime shape once, then let UI and tooling consume that canonical model instead of re-deriving channel behavior from partial fields.



## 110. Channeling should suppress jump pulses before movement consumes them, not cancel after jumpCount changes (2026-05-01)

**Problem**: Several channel states could already exist in mid-air or continue while airborne, but pressing Space during the channel still reached the normal jump path. That meant a channeling player could trigger fresh jump input, and the backend / frontend could both spend air-jump budget even though the intended rule was "while channeling, Space does nothing."

**Fix**:
- Treated channel jump suppression as an input rule, not a post-jump cleanup rule.
- Backend `GameLoop.ts` now suppresses jump for both `activeChannel` and the legacy runtime channel buffs (`1014 / 1017 / 2001 / 2003 / 2712`) before `applyMovement()` sees the pulse, and `setPlayerInput()` also strips the jump bit immediately so it does not linger as pending input.
- Frontend `BattleArena.tsx` now uses the same channel-state rule to block `tryQueueLocalJump()` and clear any queued local jump when a channel state arrives, so prediction stays aligned and jump counts are not locally consumed either.

**Lesson**: If a gameplay rule is "this input is disabled in state X," enforce it at the input seam. Letting the pulse through and trying to repair state later is how jump counts, airborne prediction, and cancel-on-jump side effects drift out of sync.



## 111. Replacement casts must validate through the new ability first, then cancel activeChannel and still run breakOnPlay for pure-channel starts (2026-05-01)

**Problem**: 读条 replacement casting had split behavior. If the player already had `player.activeChannel`, `validateCastAbility()` threw `ERR_CHANNELING` before the new cast could take over. Separately, pure channels started directly in `playService.ts` and only ran the narrow 十方玄机 helper, so starting a new pure channel did not necessarily break existing buff-backed channels even when those channel buffs were authored with `breakOnPlay: true`.

**Fix**:
- Audited every `type: "CHANNEL"` ability in `abilities.ts` and confirmed the system is mixed: some channels are pure `activeChannel`, some are reverse or buff-backed, and `cards.ts` still has legacy duplicates for 风来吴山 / 心诤.
- Added an `ignoreActiveChannel` validation option for the real-time cast path only, so the new cast can pass normal cooldown / silence / range / LOS checks without auto-failing on the old channel.
- After the new cast validates, `playService.ts` now cancels the existing `activeChannel` cleanly before continuing, including cleanup of `startedBuffIds`, linked shields, and `BUFF_EXPIRED` events.
- Pure-channel start now uses `breakOnPlay(...)` instead of only the 十方玄机-specific helper, so buff-backed channels with `breakOnPlay: true` also end correctly when a new pure channel begins.

**Lesson**: In this repo, "读条" is not one runtime. Replacement-cast behavior must cover both control surfaces: `activeChannel` and authored channel buffs. The safe order is: validate the new cast first, then cancel the old pure channel, and still run the standard `breakOnPlay()` path so reverse/buff channels keep the same break semantics.



## 112. Auto-derived editor lists should treat default metadata and manual decisions as separate buckets (2026-05-01)

**Problem**: 琴音共鸣 should automatically include every non-hidden 属性气劲 each time the tab is opened, so newly added attribute buffs reappear without manual maintenance. The remaining non-attribute buffs are the only ones that should need a manual decision. The first UI pass incorrectly let the active 可偷取 list write an explicit exclude state, which conflicted with the rule that attribute buffs should always stay in the stealable list.

**Fix**:
- Kept the default inclusion rule derived live from the buff attribute each time the 琴音共鸣 tab is loaded.
- Filtered hidden buffs out of the 琴音共鸣 snapshot entirely, so they never appear in the editor and never count as stealable at runtime.
- Kept a persisted `qinYinGongMingUnstealable` override, but only as a destination for undecided non-attribute buffs that the user marks NO.
- Split the tab UI into three buckets: `NO`, `未决定`, and `可偷取`. Only the `未决定` list exposes `✓` and `X`; the `可偷取` list is non-destructive.
- Removed per-row ID text from the lists and split the `可偷取` column into `默认列表` and `特殊列表`, so default 属性气劲 and manually added entries can be reviewed separately.

**Lesson**: When an editor has live auto-included defaults plus manually triaged leftovers, model them as separate buckets and separate views. Default-included items should remain driven by metadata, while only undecided items should branch into explicit YES/NO states.



## 113. Ability-specific buff stealing should reuse addBuff for ownership transfer, then patch runtime timing from the stolen instance (2026-05-01)

**Problem**: 琴音共鸣 needed to steal up to 2 target BUFFs, preserve the exact remaining duration the victim still had, and remain editable from the buff editor. Raw `ActiveBuff` cloning would bypass immunity checks, DR hooks, linked-shield cleanup, `BUFF_APPLIED` events, and status-bar integration; reapplying only the preload template would lose the runtime timer/state the player actually saw.

**Fix**:
- Built the stealable list from the existing buff-editor override system: BUFF-only entries, default-selected by the existing buff attribute classification (`阴性` / `阳性` / `毒性` / `外功` / `混元` / `蛊` / `点穴` etc.), plus a manual per-buff opt-in flag exposed in a dedicated 琴音共鸣 editor tab.
- Implemented `QIN_YIN_GONG_MING` as a custom immediate effect that removes up to 2 eligible target buffs with linked-shield cleanup and `BUFF_EXPIRED` emission, then reapplies them to the caster through `addBuff()`.
- After `addBuff()` creates the new owner-side runtime buff, copied over the stolen buff's remaining `expiresAt`, periodic timing, stack count, and related runtime fields so the transferred buff keeps the same remaining life instead of resetting.
- Mirrored the player-only targeting rule in both `validateAction.ts` and `BattleArena.tsx` so 琴音共鸣 cannot be cast on entities.

**Lesson**: When a mechanic transfers an existing buff instance rather than creating a fresh template buff, let `addBuff()` own the authoritative apply path and then sync the runtime fields that represent the live state. Direct array/object copying skips core systems; template-only reapply loses the remaining-time state the player expects to keep.



## 114. Observer-side instant-snap visuals need a server-shared trigger, not only the casting client's local timestamp (2026-05-01)

**Problem**: After fixing the caster-side and local-player snap paths for 斗转星移, the target client could still see the other player fast-walk into place. The target's own model snapped correctly, but the enemy model still lerped.

**Fix**:
- The opponent snap path in `Character.tsx` was keyed off `lastInstantSwapCastAtRef`, but that ref had only been armed inside the local cast wrapper.
- Updated BattleArena's event-processing effect to arm the same ref when a shared `PLAY_ABILITY` event arrives for `dou_zhuan_xing_yi`, so both the casting client and the target client enter the same snap window.

**Lesson**: Any visual rule that must happen on both sides of a PvP interaction should key off an authoritative shared signal like a game event or snapshot change, not only local input/cast state on the acting client.



## 115. If a hover-targeted dash already has a live world point, cast it immediately instead of routing through generic target validation (2026-05-01)

**Problem**: 风流云散 had been converted to hover-ground targeting, but BattleArena still entered generic opponent-target validation first. With a selected target, that left room for stale target checks and unnecessary `ERR_TARGET_UNAVAILABLE` failures instead of simply casting to the current hover point.

**Fix**:
- Switched 风流云散's cast wrapper to use `mouseWorldPosRef.current` directly when available, applying the normal LOS check and sending `groundTarget` immediately.
- Kept pending ground-cast mode only as a fallback when no hover world point is available yet.
- Added a short recent-dash snap window in BattleArena so 风流云散 and other short server dashes do not fall back into the old 1500ms cosmetic dash easing right after `activeDash` drops.

**Lesson**: For hover-driven movement skills, the best frontend path is: use the current hover world point immediately, and only fall back to pending ground selection when there is no live hover point. Otherwise the skill gets entangled with generic target-selection rules that it no longer semantically uses.



## 116. Ground-target-only abilities need both a pending-ground cast on the client and an explicit ground-target requirement on the server (2026-05-01)

**Problem**: 风流云散 was authored as a hover-point dash, but as long as a target was selected the client could still send a normal opponent-target cast, and the backend `GROUND_TARGET_DASH` effect would quietly fall back to the target's position.

**Fix**:
- Forced 风流云散 into the pending ground-cast flow in BattleArena even when a target is currently selected.
- Added authoritative validation that rejects 风流云散 when no `groundTarget` is supplied.
- Kept a defensive backend fallback in `GROUND_TARGET_DASH` so 风流云散 no longer reuses target coordinates even if some caller forgets the hover point.

**Lesson**: If an ability is supposed to always use mouse-hover placement, enforce that at both seams. Client-side pending ground cast prevents accidental wrong payloads, but server-side validation is still needed because generic ground-target effects often have a target-position fallback.



## 117. BattleArena cast-time ability hooks must key off AbilityInfo.abilityId, not AbilityInfo.id (2026-05-01)

**Problem**: 斗转星移 still felt like a slow movement and 风流云散 still produced `ERR_TARGET_UNAVAILABLE` even after targeted frontend patches, because the controlling cast wrapper never entered those ability-specific branches at all.

**Fix**:
- In `BattleArena.tsx`, `AbilityInfo.id` is the instance id and `AbilityInfo.abilityId` is the canonical spell id.
- The cast wrapper had been comparing special cases like 斗转星移 and 风流云散 against `id`, so those checks silently never matched during normal gameplay.
- Switched the wrapper and pending-ground-cast confirmation path to key off `ability.abilityId ?? ability.id`, and fixed the nearby stray `selectedEntityNow` typo in the same seam.

**Lesson**: In BattleArena ability handling, `id` and `abilityId` are not interchangeable. If an ability-specific client rule never seems to fire, first check whether the code is comparing against the instance id instead of the canonical ability id.



## 118. If a proc dash must stop on walls, let activeDash own the travel and only validate the destination band (2026-05-01)

**Problem**: 云散 originally used a random 1-tick blink-style dash with source-to-destination LOS gating. That was fine for safe teleports, but it could not satisfy the updated rule set of "retreat or sidestep to 17-18尺, move fast like a blink, and still stop if the dash path hits a wall."

**Fix**:
- Replaced the random-around-target sampling with a deterministic destination selector: retreat straight back to 17-18尺 if too close, otherwise sidestep left or right to another 17-18尺 point.
- Kept destination stability plus candidate-to-target LOS checks, but removed source-to-destination LOS rejection so the proc can legitimately start a fast activeDash even when a wall may cut it short.
- Converted the proc movement from a 1-tick blink to a multi-tick activeDash with the requested 20尺/0.2秒 speed so exported-map collision can stop it naturally.

**Lesson**: When a follow-up movement needs both a preferred destination band and real wall interruption, do not over-validate the path up front. Validate the intended landing spot, then let the normal activeDash collision loop own the actual travel.



## 119. Pull-immunity cast gates should key off the exact pull-immunity effect, not generic control immunity (2026-05-01)

**Problem**: 斗转星移 needed to gray out and fail cast only when the target is actually immune to pull-like displacement. Some buffs bundle that with broader immunity, but some `CONTROL_IMMUNE` states do not protect against pull at all.

**Fix**:
- Implemented 斗转星移 as a player-only target swap with authoritative validation against `hasKnockbackImmune(target)`.
- Mirrored the same rule in BattleArena with a small `hasPullImmuneClient()` helper that reads `KNOCKBACK_IMMUNE` directly from the target's live buff effects before enabling the skill.
- Implemented 龙战于野 / 潜龙勿用 with a shared forward-cone targeting rule (`dot >= cos(angle / 2)`) so cone-only behavior lives in one local runtime seam instead of being recomputed differently per skill.

**Lesson**: When a cast ban is about one specific displacement immunity, key it off that exact runtime effect on both server and client. Do not infer it from broad `CONTROL_IMMUNE`, because this codebase intentionally separates pull/knockback immunity from ordinary control immunity.



## 120. Blink-like follow-up movement is safest here as a prevalidated 1-tick dash, not a raw teleport (2026-05-01)

**Problem**: 风流云散 needed a blink-like follow-up after 截阳 / 引窍, but a direct position teleport risked owner-side interpolation artifacts and unsafe destinations inside blocked exported-map geometry.

**Fix**:
- Added a shared `triggerYunSanBlink()` helper that samples random points within 20u of the target, rejects any point that resolves out of collision, rejects any caster→candidate or candidate→target line blocked by the exported collision shell or 楚河汉界, then applies a 1-tick authoritative dash and consumes one 云散 stack.
- Hooked that helper from `jieyang` immediate cast and from `yin_qiao` channel completion so both triggers use the same movement rule.
- Let 引窍 keep its base 2 damage on the normal channel-completion path, then separately consume 绝脉 for extra damage only when the completion hit actually lands.

**Lesson**: In this repo, a 1-tick server-authoritative dash is a better "blink" primitive than mutating position directly. The local player already hard-snaps during `activeDash`, while destination sampling can still enforce LOS and collision safety before movement begins.



## 121. 盾立 reflect whitelist plumbed through ability override system (2026-04-30)

**Problem**: Some abilities should be blocked by 盾立's damage immunity but should NOT be reflected (e.g. 毒手's 1 damage is irrelevant; the player wants the 毒手 buff to land on the shielded defender, not bounce back).

**Fix**:
- Added `dunLiWhitelisted?: boolean` to `AbilityEditorOverrideEntry` so it persists in `ability-property-overrides.json` exactly like `isProjectile`.
- `buildResolvedAbilities` copies the flag onto the runtime ability object as `(ability as any).dunLiWhitelisted`.
- `PlayAbility.shouldReflectToCaster` ANDs `&& !(ability as any).dunLiWhitelisted` — gate trips before recursive reflect, but DAMAGE_IMMUNE in `handleDamage` is untouched.
- New `setAbilityDunLiWhitelisted` mirror of `setAbilityIsProjectile`, exposed via `PUT /ability-editor/:abilityId/dun-li-whitelist`.
- Frontend: `DunLiWhitelistTab.tsx` clones `ProjectileEditorTab.tsx` (two-column undecided/whitelist lists). Tab registered in `page.tsx` as `mainTab === "dunLiWhitelist"`.

**Lesson**: When a runtime gate needs a per-ability boolean editable from the UI, the cheapest path is to mirror the existing `isProjectile` plumbing — same override file, same buildResolvedAbilities seam, same route shape, same tab template — instead of inventing a parallel persistence layer.



## 122. Whole-cast reflection belongs in PlayAbility, not inside damage math, and it should only trigger on direct player-targeted casts (2026-04-30)

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



## 123. If the effect should feel like another dimension, ease the overlay and tint it to the ability fantasy instead of snapping to flat black (2026-04-30)

**Problem**: The Hong Meng overlay finally had the correct layer order, but it still felt too harsh because it snapped in and out instantly and used a flat black fill.

**Root causes**:
- Opacity and visibility were toggled without transitions, so the effect read as a hard screen cut.
- A pure black overlay matched the old blindness implementation more than the new "other dimension" fantasy suggested by the ability icon.

**Fix**:
- Added eased opacity transitions to both the blackout layer and the self-only layer.
- Replaced flat black with a dark-purple gradient tint so the screen reads as dimensional rather than simply disabled.

**Key lesson**: Once the layering is correct, presentation matters. If an effect is supposed to feel mystical or dimensional, use the ability's color language and animate opacity instead of hard-cutting to black.



## 124. Backend-only target-buff cast bans should usually be mirrored in frontend readiness too (2026-04-30)

**Problem**: After moving 鸿蒙天禁's 曙色 restriction into backend validation, the skill was still shown as castable on the frontend. The user wanted the frontend to gray it out as well.

**Root causes**:
- The authoritative rule was fixed on the backend, but BattleArena's local readiness logic and click-time guard still treated 曙色 targets as valid.
- That mismatch leaves the user with a cast button that looks usable until the server rejects it.

**Fix**:
- Added a local `hasShuSeClient()` helper and used it in both BattleArena's `isAbilityReady()` path and the direct cast wrapper for `hong_meng_tian_jin`.

**Key lesson**: When a cast ban depends on a visible target buff, mirror it in frontend readiness whenever possible. The backend remains authoritative, but the client should still gray out obviously invalid casts instead of waiting for a round-trip rejection.



## 125. If a buff should make a target ineligible for a cast, reject it in validateAction instead of silently no-oping the effect (2026-04-30)

**Problem**: 鸿蒙天禁 was supposed to be unusable on targets that already had 曙色, but the only guard lived inside the custom `HONG_MENG_TIAN_JIN` immediate-effect handler. That meant the action could still pass validation and begin execution before the effect quietly aborted.

**Root causes**:
- The 曙色 check was happening too late in the cast pipeline, after normal validation had already accepted the target.
- A late `break` inside custom effect execution does not behave like a true cast rejection; it only skips the manual buff application.

**Fix**:
- Added a narrow `hong_meng_tian_jin` target-buff check in `validateAction.ts` that throws `ERR_BLOCKED_BY_BUFF` when the selected target already has active 曙色.

**Key lesson**: If a target buff should make an ability uncastable, enforce it in the authoritative validation phase. Effect-layer early exits are only safe as fallback guards, not as the primary gameplay rule.



## 126. Some custom debuffs should bypass the shared diminishing-returns pipeline entirely (2026-04-30)

**Problem**: 蚀心蛊 was still interacting with the shared 递减 system because its debuff includes `SILENCE`, so the generic buff runtime treated it like any other lockout debuff: existing resistance stacks shortened it, and applying it refreshed lockout resistance afterward. The user wanted 蚀心蛊 to use only its own built-in duration-halving rule and never respect or apply 递减.

**Root causes**:
- Shared diminishing returns are derived centrally in `buffRuntime.ts` from buff category/effect shape, not from the ability's custom cast logic.
- Because 蚀心蛊 includes `SILENCE`, the generic `getResistanceConfig()` path classified it as a shared lockout debuff even though this skill already has its own separate repeat-cast duration rule via 蚀心.

**Fix**:
- Added a narrow exclusion for buff `2643` in `getResistanceConfig()` so 蚀心蛊 never receives duration reduction from existing resistance stacks and never grants new resistance stacks when applied.

**Key lesson**: If a debuff has a bespoke repeat-hit mechanic, exclude it at the resistance classification hook instead of trying to undo diminishing returns later. That removes both halves of the interaction at the single authoritative source.



## 127. Forced-loss-of-control rolls can still depend on the target's current control state at cast time (2026-04-30)

**Problem**: 蚀心蛊 originally picked its forced-movement mode with a pure random roll, but the user wanted a stricter rule: if the target is already controlled (except simple slows) or is currently airborne, 蚀心蛊 should always choose the standstill result instead of the fixed-direction march.

**Root causes**:
- The random mode was being decided in one place inside `immediateEffects.ts`, but it had no awareness of the target's live CC/debuff state or whether the target was off the ground.
- Because the chosen mode is stored on the runtime buff and then mirrored by both backend movement and frontend prediction, the right place to add this rule is the cast-time roll itself, not the movement loop.

**Fix**:
- Added a small `shouldShiXinGuForceStandstill()` helper in `immediateEffects.ts` that checks live debuff controls (stun/root/fear/knockback/pull/knockdown-style states, excluding simple slows) and current airborne state using the existing map ground-height helper.
- 蚀心蛊 now forces `forcedMovementMode: "standstill"` whenever that helper returns true; otherwise it keeps the existing random direction-vs-standstill roll.

**Key lesson**: When a debuff stores a one-time random outcome on the runtime buff, any conditional override to that randomness should happen exactly where the buff is created. That keeps backend authority and frontend prediction aligned without adding extra movement-side special cases.



## 128. If a targeted channel should break on target range, use the standard channelCancelOnOutOfRange path (2026-04-30)

**Problem**: 十方玄机 already required its selected target to still be within 20尺 at channel completion, but the user also wanted it to break immediately during the channel once the target moved beyond 20尺, just like the repo's other targeted channels.

**Root causes**:
- The prior implementation only used a completion-time range gate (`requireTargetInRangeOnChannelComplete`), so the channel could continue ticking even after the target had already escaped the allowed range.
- GameLoop already has a generic active-channel cancellation path driven by `activeChannel.cancelOnOutOfRange`; this ability simply was not authored onto that existing rule.

**Fix**:
- Added `channelCancelOnOutOfRange: 20` to 十方玄机 so its active channel now uses the same mid-channel range-break logic as other targeted channels.
- Kept the completion-time 20尺 recheck in place, so both behaviors now hold: leaving range mid-channel breaks immediately, and the end-of-channel validation still protects completion.

**Key lesson**: When a channel should fail as soon as the target leaves range, do not invent a custom per-ability GameLoop branch. Use the existing `channelCancelOnOutOfRange` authoring hook, then keep any end-of-channel validation only for completion-time guarantees.



## 129. Hidden untargetable states need a view-layer hide rule plus a natural-expiry follow-up buff (2026-04-30)

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



## 130. Forced-movement debuffs should store their chosen mode on the runtime buff, and "target anyone" can be modeled as opponent-target + self opt-in (2026-04-30)

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



## 131. Fixed-distance knockbacks must be tuned by dash duration, and cast-breaking buffs on pure channels need a pure-channel hook too (2026-04-30)

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



## 132. New custom buffs must be declared for preload/status bar, and redirect callers must always trust `adjustedDamage` (2026-04-30)

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



## 133. Very-short refreshed buffs need duration headroom or `hiddenInStatusBar` (2026-04-29)

**Problem**: 逐云寒蕊·隐藏 (buffId 2716) had `durationMs: 500`, refreshed every tick by `GameLoop`. The frontend `StatusBar` filters `getRemainingSeconds(b) > 0` and renders `secsLeft.toFixed(1)`, so the buff often displayed as `0.0` between refreshes and was filtered out.

**Fix**: Raise `durationMs` to 2000 ms (and `ZHU_YUN_STEALTH_DURATION_MS` in `GameLoop` to match). Per-tick refresh keeps `expiresAt` always ~2s in the future, giving the client headroom to render a stable countdown without ever flickering to 0.

**Key lesson**: For periodically-refreshed buffs, the authored `durationMs` must comfortably exceed the worst-case client lag between refreshes. 500 ms is too tight for a status-bar display; either bump duration or hide via `hiddenInStatusBar`.



## 134. Entity targets need first-class buff runtime, not damage-only support (2026-04-29)

**Problem**: 逐云寒蕊 could be damaged, but it still could not reliably receive buffs, debuffs, or controls, and the frontend target HUD always showed an empty status row for selected entities.

**Root cause**: The previous entity work only widened damage paths. `TargetEntity` still had no runtime `buffs` storage, generic `ability.buffs` application still targeted the opposing player object, and the selected-target UI hardcoded entity buffs to `[]`.

**Fix**:
- Extend `TargetEntity` with first-class runtime combat fields (`userId`, `shield`, `buffs`) so it can reuse shared buff/combat helpers.
- Route generic `applyAbilityBuffs(...)` through `entityTarget` when a cast explicitly targets an entity instead of always falling back to the opposing player.
- Widen shared immediate/GameLoop buff-control surfaces (`AOE_APPLY_BUFFS`, `SAN_CAI_HUA_SHENG_AOE`, `JILE_YIN_AOE_PULL`, dash-end CC, periodic entity buff ticking/expiry) so entities participate in the same authoritative buff runtime.
- Mirror entity `buffs`/`shield` in frontend in-game types and feed selected entity buffs into the existing `StatusBar` target HUD.

**Key lesson**: Once an object is a real combat target, the clean design is to make it a buff-bearing runtime target and reuse the shared buff engine. Damage-only entity support leads to one-off fixes and misses debuff/control behavior immediately.



## 135. Entity-targeted casts must not consult the opposing player's dodge state (2026-04-29)

**Problem**: After wiring entity buff support, explicit entity-targeted casts could still inherit dodge behavior from the opposing player, because `applyAbility()` computed `abilityDodged` before it knew the real target class.

**Fix**:
- When `entityTargetId` resolves to a live entity target, force `abilityDodged = false` for that cast path.
- Let entity-side immunity buffs be handled by the shared target guard checks on the entity itself, instead of accidentally borrowing player dodge/avoidance state.

**Key lesson**: When an ability can target different target classes, any early shared decision like dodge or avoidance must be computed against the actual resolved target, not a placeholder player target chosen only for indexing convenience.



## 136. Entity targets must flow through cast validation (2026-04-29)

**Problem**: Attacking 逐云寒蕊 could be selected in the client, but backend cast validation still failed with `ERR_TARGET_UNAVAILABLE` / `目标丢失或者不可选中`.

**Root cause**: `playCastAbility(...)` already accepted `entityTargetId`, but did not pass it into `validateCastAbility(...)`. The validator therefore fell back to the opposing player target, then ran the normal `blocksCardTargeting(enemy)` stealth/untargetable check against that player instead of the intended entity.

**Fix**:
- Pass `entityTargetId` from `backend/game/services/gameplay/playService.ts` into `validateCastAbility(...)`.
- Extend `validateCastAbility(...)` in `backend/game/engine/rules/validateAction.ts` to resolve entity targets from `state.entities`.
- For entity targets, validate existence, living HP, and enemy ownership, then use the entity position for range, facing, and LOS checks.
- Keep the old `blocksCardTargeting(enemy)` path only for real player targets.

**Key lesson**: Adding entity targeting to the frontend and effect-resolution path is not enough. Every cast-time validation gate must receive and understand `entityTargetId`, or the server will silently validate against the wrong target class.



## 137. Entity targets need every shared damage loop, not just direct DAMAGE (2026-04-29)

**Problem**: After direct targeted attacks could hit 逐云寒蕊, several other damage paths still ignored it: pure channel completion (`云飞玉皇`), channel AOE ticks (`风来吴山`), timed AOE buff damage, dash-end AOE damage, ground-zone periodic damage, and immediate AOE effect branches like `百足 / 五方行尽 / 横扫六合`.

**Root cause**: The first entity fix only covered the direct `DAMAGE` effect branch. Many other backend damage paths still hardcoded either the opposing player (`opp`) or loops over `state.players`, so the entity never entered those hit-resolution paths.

**Fix**:
- Preserve `entityTargetId` on pure channels so channel completion can still resolve the entity target.
- Extend shared GameLoop damage branches to include hostile `state.entities` alongside players for channel completion, channel AOE ticks, timed AOE buff damage, dash-end AOE damage, and ground-zone periodic damage.
- Extend immediate AOE effect branches in `immediateEffects.ts` to damage hostile entities and emit normal DAMAGE events with `entityId/entityName`.
- Keep player-only secondary effects such as dodge, knockback, and buff application on the player path only.

**Key lesson**: For targetable entities, “can be selected” and “can take direct single-target damage” are only the first layer. Any shared damage surface that enumerates enemies must be audited for `state.entities`, or abilities will fail one category at a time.



## 138. 化解 (Shield Absorption) Display System (2026-04-26)

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



## 139. Ability DamageType Tag System (2026-04-25)

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



## 140. Buff Duration Override Not Taking Effect (2026-04-23)

**Root cause**: `addBuff()` in `buffRuntime.ts` applied property overrides from the live editor file at runtime, but `durationMs` was only applied at preload time (server startup). Changing duration via the editor saved to the overrides JSON, but the game kept using the preload-cached value until PM2 was restarted.

**Fix**: Added a second live-override block in `addBuff` right after the properties block:
```typescript
if (typeof propEntry?.durationMs === "number") {
  runtimeBuff = { ...runtimeBuff, durationMs: propEntry.durationMs };
}
```
Now both properties and duration are read live from the overrides file, so changes take effect immediately without a server restart.

**Lesson**: Any editor override that needs to work during a running game session must be applied in `addBuff` at runtime, not just at preload. Preload is for initial state and snapshot building only.



## 141. Dashing Abilities

### 141.1 Control-system redesign baseline and gaps (2026-04-17)
- **Current model mismatch**: Live code still treats `ROOT/SLOW` as level 0, `CONTROL/ATTACK_LOCK` as level 1, `KNOCKED_BACK` as level 2, and `SILENCE` as level 3. The requested redesign moves silence into lockouts, splits knockdown from generic stun, and defines pull/knockback as dash-state controls instead of a standalone `KNOCKED_BACK` tier.
- **Important movement gap**: Current `movement.ts` only blocks input under root/control/knockback. If the player is already airborne, XY momentum is preserved because the movement loop keeps existing airborne velocity when there is no directional intent. That means live root/stun/knockback do **not** currently force the immediate straight-down fall required by the redesign.
- **Ability-pool gap**: There is no live root ability, no live pull ability, and no dedicated freeze effect yet. Current pool only covers slow, stun-like `CONTROL`, mohe knockdown via special case, knockback via `wu_jianyu`, silence via `chan_xiao`, and qinggong seal via `jianpo_xukong`.
- **Implementation takeaway**: The redesign will require backend effect typing, cast validation, buff application rules, movement handling, and frontend prediction in `BattleArena.tsx` to change together. This is not just a buff-table edit.
- **Clarifications now resolved**: root blocks jump input while grounded; root resistance reapplications refresh one shared 10-second timer; stun and freeze use separate resistance buffs; root and slow fail under active type-1 stun/freeze; a second pull/knockback fails during type-3 dash immunity.
- **Audit lesson**: The biggest live mismatch is not only missing abilities; it is missing control-state architecture. Silence is still a universal cast stop instead of a school-based lockout layer, mohe knockdown is still a buffId special case instead of a generic type-2 control, and wu_jianyu knockback is still a direct shove plus short `KNOCKED_BACK` debuff instead of a true forced-dash type-3 control.
- **Important engine gap**: Direct loop-applied knockback in `GameLoop.ts` bypasses the normal `addBuff()` filtering path, so `KNOCKBACK_IMMUNE` does not currently protect against `wu_jianyu` the way the general immunity model suggests it should.
- **Testing lesson**: A complete control-rule regression list needs two layers: live-pool tests for currently shippable abilities, and harness-only tests for redesign areas the current pool cannot cover yet, such as root, freeze, pull, attack-lock, diminishing returns, and school-based lockouts.

### 141.2 Corrected control fixes for upward jump, knockback, and mohe cleanse (2026-04-17)
- **Dash facing-lock lesson**: The clean model for dash turning is a shared runtime lock plus a narrow override buff, not ability-specific movement branches. Put the default "lock facing while dashing" rule on the shared displacement runtime buff, then let only abilities like `穹隆化生` and `踏星行` carry a separate `DASH_TURN_OVERRIDE` buff so backend steering and frontend prediction stay on one permission check.
- **Lockout DR lesson**: Shared lockouts need their own resistance bucket and overwrite rule, but dash self-lock should not live inside that bucket. Treat enemy-applied `沉默/ATTACK_LOCK` as one overwrite + DR family, leave `封轻功` outside it, and represent self dash cast-lock as a separate `DISPLACEMENT` runtime so movement states do not pollute lockout DR.
- **Upward-jump exception**: The corrected rule is not "always kill airborne momentum." Under root/control, grounded movement and directional airborne travel should stop immediately, but a pure upward-jump rise should continue. The clean implementation point is `movement.ts`, by clearing air shift and horizontal carry only when the player is not in a pure upward-jump rise state.
- **Knockback consistency lesson**: If an ability applies knockback from a timed loop path instead of the normal buff-application path, it still needs to go through one named helper or it will drift away from immunity and control rules. Centralizing `wu_jianyu` knockback in a shared helper fixed `KNOCKBACK_IMMUNE` handling and second-knockback rejection without changing the existing instant-shove feel.
- **Shared displacement runtime lesson**: Type-3 displacement states should not invent separate hidden lockouts. Reusing the same dash-runtime buff for knockback keeps mohe knockdown and other incoming hard-control checks on one shared immunity path, and exposing that runtime buff in preload is enough to make it render in the HUD.
- **Knockdown cleanse lesson**: mohe knockdown is currently encoded as a `CONTROL` buff, so generic level-1 cleanse logic will remove it unless the knockdown is explicitly excluded. If type-2 knockdown is meant to survive skills like `蝶弄足`, the current code needs a special-case exclusion until knockdown becomes its own effect family.
- **Triggered-follow-up lesson**: Special attacks like `无间狱` follow-up hits are easier to maintain behind a whitelist helper than as naked `abilityId === ...` branches inside the loop. The useful split here is "break stealth only" versus "count as a normal play," not a generic all-or-nothing triggered-cast rule.
- **Timing correction correction**: The previous `3s / 4s / 5s` follow-up change was wrong. `无间狱` is still a full 10-second buff, but its actual strike checkpoints should be `2s / 3s / 4s` after buff gain, which means the buff bar is around `8s / 7s / 6s` remaining when they fire.

### 141.3 DR visibility and stale-build lesson (2026-04-17)
- **Visible DR lesson**: DR that exists only as hidden math is not testable enough for this project. Resistance has to exist as a normal runtime buff with a countdown and stack value so the player can verify it live from the buff row.
- **DR source-of-truth lesson**: The visible resistance buff itself has to be the only counter. If it has expired, the next control must recreate it at 1 stack instead of inheriting any hidden count.
- **Knockdown separation lesson**: Because `摩诃无量` knockdown is still encoded as `CONTROL`, any generic stun-DR check that keys off `CONTROL` too early will accidentally reduce or consume knockdown. The safe rule is to key knockdown off its specific buff identity and exclude it before any stun DR logic runs.
- **Pipeline consistency lesson**: The natural-end `摩诃无量·眩晕` follow-up should go through `addBuff()` rather than being pushed directly in `GameLoop.ts`, otherwise it bypasses the same DR, event, and filtering logic as all other stuns.
- **Build artifact lesson**: When runtime behavior and TypeScript source disagree, check `dist/` immediately. In this repo the backend runs `dist/index.js`, so stale compiled control logic can survive until a clean rebuild replaces it.
- **Buff timer UI lesson**: A countdown fed by `expiresAt` should be seeded immediately and displayed as the real remaining time. Flooring a fresh timer or clamping tooltip text to a fake minimum makes 5-second buffs appear to start at 4 seconds even when backend timing is correct.

### 141.4 Realtime countdowns need server-time alignment (2026-04-17)
- **Root cause**: Buffs, channels, and ground-zone timers are authored with absolute server `Date.now()` timestamps, but the frontend countdowns were reading them back with each client's local `Date.now()`. If one client clock is ahead by about 2 seconds, that client will see every 5-second buff as roughly 3 seconds while another client can still look correct.
- **Fix pattern**: Add a server timestamp to snapshots and websocket heartbeat replies, track a client/server clock offset in `useGameState.ts`, and normalize incoming absolute timestamps as they enter frontend state. Do not leave each widget to guess against local machine time on its own.
- **UI follow-up**: Channel bars also need elapsed-time alignment on mount. A CSS animation keyed only by `appliedAt` or `startedAt` restarts from full duration unless it also receives a negative animation delay for the already-elapsed portion.
- **Stability follow-up (2026-04-19)**: Recomputing clock offset from every high-frequency `STATE_DIFF` packet can add jitter and make channel bars appear too fast/unstable. The safer approach is to treat heartbeat/snapshot timestamps as the sync source, clamp one-way latency compensation, and smooth offset updates before normalizing UI timestamps.

### 141.5 Zone invulnerability needs effect-layer blocking, not target-validation failure (2026-04-17)
- **Invulnerability lesson**: If a defensive state is meant to let enemy abilities consume cooldowns normally while doing nothing, it cannot live in target-validation. Add a separate `INVULNERABLE` effect to the enemy-effect guard layer so casts still resolve but damage, knockback, and debuff application are filtered out during resolution.
- **Internal-cooldown lesson**: `玄剑 -> 化生势` is cleanest as a natural buff-expiry transform in `GameLoop.ts`, not as a special timer outside the buff system. The zone only needs to apply `玄剑` once on first eligibility, and the regular expiry pass can promote it into the longer lockout buff.

### 141.6 Dash reach-hit + control immunity filtering updates (2026-04-19)
- **Dash completion hook lesson**: For abilities that apply control at dash start but damage on arrival (like `棒打狗头`), store a tiny on-complete hit payload on `activeDash` and resolve the damage in `GameLoop.ts` only when dash ends naturally.
- **Root + control immunity lesson**: In this project's control model, `CONTROL_IMMUNE` states (including dash runtime immunity) must filter `ROOT` in `addBuff()` as well; otherwise you can incorrectly produce root DR (`锁足递减`) on applications the user expects to fail.
- **Ground-cast UX lesson**: For abilities with `allowGroundCastWithoutTarget`, silently entering ground-target mode is clearer than showing repetitive "请选择地面位置施放" toasts on every cast attempt.
- **Cooldown-slow stack lesson**: `COOLDOWN_SLOW` currently sums raw effect values per buff effect entry in `GameLoop.ts`; if a debuff is authored as fixed 3 stacks on apply, represent the total slowdown directly in effect values (or multiple effect entries), not by relying on `stacks` alone.

### 141.7 镇山河 guaranteed self-buff and single dash runtime lesson (2026-04-18)
- **Self-buff split lesson**: `镇山河` self-cast protection and zone refresh protection cannot share the same runtime buff id. The guaranteed 2-second self-buff must always apply on cast, while `化生势` should block only the zone-pulse refresh path.
- **Fast-exit zone lesson**: If the goal is "leave the area and lose the effect almost immediately," the zone pulse duration must be as short as the pulse cadence. A `100ms` pulse that grants `100ms` of zone-only invulnerability drops cleanly on exit; a long refreshed duration does not.
- **Single dash-state lesson**: If dash is supposed to be one visible state, put `CONTROL_IMMUNE`, `KNOCKBACK_IMMUNE`, `DISPLACEMENT`, and `DASH_TURN_LOCK` on one shared runtime buff and reuse it for both `DASH` and `DIRECTIONAL_DASH`. Separate runtime ids for immunity versus cast-lock only create duplicate HUD buffs.
- **UI-only helper lesson**: Some abilities may still need a private helper buff for gameplay timing, such as `散流霞隐藏`. If the user wants to see only one dash buff, hide those helper buffs from the status bar instead of surfacing duplicate dash-state rows.
- **Prediction parity lesson**: Once backend dash runtime is fully facing-locked, remove all frontend dash-turn override paths in `BattleArena.tsx`. Leaving client-side override checks behind makes prediction drift back toward the old model.
- **Air-cast gate lesson**: For instant self skills like `镇山河`, the airborne restriction is just `requiresGrounded`. If the skill should work while jumping or falling, remove that authored flag instead of trying to special-case movement validation.
- **Hidden override lesson**: The shared dash runtime can stay as the one visible dash buff while still allowing skill-specific turn exceptions. The clean pattern is a hidden helper buff carrying `DASH_TURN_OVERRIDE`, with the same override check in both backend `movement.ts` and frontend `BattleArena.tsx`.
- **Ground-projected zone lesson**: Letting airborne self-casts author `groundZones.z` from the caster's current altitude makes the whole volume float in mid-air. `PLACE_GROUND_ZONE` needs to project the zone center onto the map support height under that XY, using the same map context as movement, so a high-air `镇山河` lands on the floor below and only affects players who actually descend into it.

---



## 142. Abilities / Editor

### 142.1 Range bonuses must extend channel cancel thresholds and actual ground-target dash travel, and lockout immunity must stay narrower than control immunity (2026-05-01)
- **Problem**: After 枯残蛊 was added, three separate follow-on mismatches remained: pure channels still seeded `activeChannel.cancelOnOutOfRange` from raw authored values, ground-target dash executors still capped real travel to the base effect distance even when the cast range had been boosted, and 迷心蛊 had been authored with `CONTROL_IMMUNE`, which incorrectly granted stun/root immunity instead of only lockout immunity.
- **Fix**: Applied the active range bonus when creating pure-channel runtime state in `playService.ts`, applied the same `+12` bonus to actual travel distance in both `GROUND_TARGET_DASH` and `LIN_SHI_FEI_ZHUA_DASH` inside `immediateEffects.ts`, and added a dedicated `LOCKOUT_IMMUNE` effect in `buffRuntime.ts` that strips/purges only shared lockouts (`SILENCE` and `ATTACK_LOCK`). 迷心蛊 now uses `LOCKOUT_IMMUNE` instead of `CONTROL_IMMUNE`, while 枯残蛊 was switched to `gcd: false` as requested.
- **Lesson**: When a buff changes range, check not just validation and tooltips but every runtime that caches or converts range into some other control value, such as channel cancel distances and dash travel caps. And if a skill spec says "lockout immunity," do not reuse `CONTROL_IMMUNE` as a shortcut — introduce the narrower semantic so roots/stuns do not accidentally become immune too.

### 142.2 Buff-driven range bonuses must go through one shared effective-range helper on both backend and frontend (2026-05-01)
- **Problem**: 枯残蛊 increases all ability ranges by 12尺 for 12 seconds, but the repo had multiple independent places still reading raw `ability.range`: authoritative cast validation, a custom follow-up target recheck, targeted channel completion, and BattleArena's local readiness/range display.
- **Fix**: Added a shared `RANGE_BOOST` effect type plus backend `getEffectiveAbilityRange()` helper that sums active buff bonuses, then replaced the backend range checks in `validateAction.ts`, `immediateEffects.ts`, and `GameLoop.ts`. Mirrored the same calculation in `BattleArena.tsx` so local cast gating and displayed range values match the server while 枯残蛊 is active.
- **Lesson**: If a buff modifies a core authored stat like cast range, do not patch one validation site at a time. Centralize the derived stat and route every authoritative and predicted check through that same helper, or the buff will desync between server rules, client readiness, and tooltip numbers.

### 142.3 Dynamic wall abilities need shared geometry helpers across backend validation, GameLoop, and BattleArena (2026-05-01)
- **Problem**: 楚河汉界 is not just a targetable entity. It must block enemy movement, line-of-sight casts, and ground-target AoEs while still letting the owner walk through it, and the frontend must not locally predict the player through the wall.
- **Fix**: Stored oriented wall metadata (`wallHalfLength`, `wallHalfThickness`, `wallHeight`, tangent/normal) directly on the spawned `TargetEntity`, then used that same geometry in shared helper functions for backend LOS checks (`validateAction.ts`, channel/tick LOS in `GameLoop.ts`) and enemy collision resolution (`GameLoop.ts`). On the frontend, mirrored the same rule in `BattleArena.tsx` for local LOS readiness/ground-cast checks and local movement prediction, and rendered the entity as a real wall mesh in `TargetEntityVisual.tsx` instead of a generic cylinder.
- **Lesson**: If a summoned structure changes both movement and visibility rules, do not approximate it as "just a big radius" or only render it visually. Give it explicit geometry once, then reuse that geometry everywhere the game decides movement or LOS.

### 142.4 Follow-self protection fields are easier as visual zones plus buff-keyed runtime rules than as pure damage zones (2026-05-01)
- **Problem**: 绿野蔓生 needed a 6尺 area that follows the caster, grants anti-control through a buff, stops incoming dashes at the boundary, and knocks attackers back out to the edge while dealing retaliation damage.
- **Fix**: Implemented the visible field as a self-following `GroundZone`, but kept the real gameplay logic keyed off the owner buff and authoritative runtime loops: dash interception is handled in the player `activeDash` path by clamping enemy dash endpoints to the 6尺 boundary, while retaliation is driven from same-tick damage events by applying a short knockback `activeDash`, adding `KNOCKED_BACK`, and dealing 3 damage from the protected player.
- **Lesson**: When a field's behavior depends on who attacked whom or whether a dash crossed the boundary, use the zone for ownership/visualization and keep the actual rules in the movement/event pipeline. That is much simpler than trying to force all of the behavior through periodic zone ticks.

### 142.5 Forward strip walls and instant knockback follow-ups should reuse the existing geometry/knockback rules instead of inventing a parallel feel (2026-05-01)
- **Problem**: 楚河汉界 initially felt wrong because it was authored as a perpendicular barrier centered in front of the caster, while the reference wanted a very thin strip that starts 1尺 ahead and extends forward along facing. 绿野蔓生 retaliation also felt off because it used a custom short `activeDash`, so wall-stop and frontend display did not match the game's normal knockbacks.
- **Fix**: Re-authored 楚河汉界 so the wall tangent follows the caster facing and the entity center is placed at `1尺 + halfLength` ahead of the caster. On the frontend, changed the wall to a thin semi-transparent viewer-colored strip. For 绿野蔓生 retaliation, replaced the custom push dash with `applyType3KnockbackControl()` and added a BattleArena hard snap when the local player is under `KNOCKED_BACK`/`PULLED`, so the shown endpoint matches the authoritative knockback immediately.
- **Lesson**: If a new movement result is supposed to "feel like the rest of the game," reuse the shared knockback path and client reconciliation behavior. Custom micro-dashes are easy to author but they drift visually and collide differently from the established control system.

### 142.6 Wall visuals must use the same world-to-Three facing basis as characters, and forced displacement must bypass cosmetic easing in the render loop (2026-05-01)
- **Problem**: Even after the wall geometry was made forward-facing on the backend, the rendered 楚河汉界 wall could still look angled away from the caster because the wall mesh yaw used a mirrored sign compared with the character-facing conversion. The wall also showed an extra bright line because multiple translucent wall overlays were stacked. Separately, 绿野蔓生 knockback could still feel inconsistently slow on the client because the render loop only hard-snapped some reconciliation paths, but still eased other forced-movement frames cosmetically.
- **Fix**: Changed the wall mesh yaw to use the same world basis as other forward-facing visuals, removed the extra overlay planes, and reduced the shared wall thickness constant so both the rendered strip and collision body are thinner together. In `BattleArena.tsx`, added a dedicated forced-displacement ref and made the local render loop skip dash-style easing entirely while `KNOCKED_BACK` or `PULLED` is active.
- **Lesson**: When a gameplay object is supposed to project straight out from the player's facing, match the exact world-to-render orientation math already used by characters instead of inventing a nearby formula. And if the server owns displacement, every client render path for that state must opt out of cosmetic interpolation, not just one reconciliation effect.

### 142.7 Thin translucent walls need unlit color-preserving materials, and fast movement against newly spawned walls needs sweep-based near-side resolution (2026-05-01)
- **Problem**: After thinning 楚河汉界, the wall color could wash out to nearly white under the scene lighting because the translucent wall body was still using a lit material setup. Also, when a wall appeared during a dash, the later overlap-only collision resolution could clamp the player to the far side of the wall because it only saw the already-moved position.
- **Fix**: Switched the wall body to a transparent `meshBasicMaterial` with stronger light-blue/light-red palette values so the rendered color stays stable instead of bleaching out. In `chuHeHanJieWall.ts`, added sweep-based wall collision using the actor's pre-move position and the earliest expanded-rectangle entry time; `GameLoop.ts` now passes the player's previous XY into the wall resolver after movement so dashes stop on the near side of newly spawned walls.
- **Lesson**: For intentionally stylized translucent gameplay geometry, preserve authored color first and avoid lighting setups that can whiten the whole mesh. And for thin blockers that can appear while a high-speed movement is already in progress, overlap resolution alone is not enough; you need a sweep test from the previous position to prevent tunneling-to-far-side corrections.

### 142.8 Charge-based rapid-cast abilities should keep tooltip timing and `chargeCastLockTicks` in sync (2026-05-01)
- **Problem**: 楚河汉界's intended between-cast lock was reduced to 0.5s, but the authored runtime lock and the player-facing description both still said 1.0s.
- **Fix**: Reduced `chargeCastLockTicks` from 30 to 15 in `abilities.ts` and updated the ability description text to match the new 0.5s lock.
- **Lesson**: For charge-based abilities, cast cadence is controlled by `chargeCastLockTicks`, not just by description text or cooldown fields. Any timing tweak has to update both the runtime lock and the displayed tooltip together.

### 142.9 If a wall should visually extend outward, animate only the mesh, but if it should stop airborne players only when it reaches them, both server and client collision must respect vertical overlap (2026-05-01)
- **Problem**: After the color and near-side stop fixes, 楚河汉界 still felt wrong in two ways: the wall looked like a single full slab popping in instantly instead of shooting outward, and airborne players could still be blocked even when they appeared high enough above the wall body.
- **Fix**: Added `spawnedAt` to the wall entity and used it only on the frontend to animate the wall mesh over 0.5s from the near edge toward the far edge, keeping gameplay collision unchanged. Separately, added a vertical-overlap gate to wall collision on both backend and frontend prediction so movement is blocked only when the actor's feet/body actually overlap the wall height range.
- **Lesson**: Presentation timing and collision timing are different problems. Use render-only scale/offset animation for the "shoot out" fantasy, but make sure both authoritative and predicted collision share the same vertical overlap rule or the wall will feel taller than it looks.

### 142.10 If a spawn animation should read clearly, the mesh must mount in its animated state on frame 1, not pop in full-size and only shrink on the next `useFrame` tick (2026-05-01)
- **Problem**: The first version of 楚河汉界's shoot-out animation still looked instant because the wall mesh mounted at full length on initial render, then only started scaling in `useFrame`, so the player could still perceive a full-wall pop-in.
- **Fix**: Moved the extension animation to a near-edge-anchored inner group with an initial render-time progress value derived from `spawnedAt`, then continued animating that same group in `useFrame`. Added a solid bottom strip in the same team color to make the wall footprint easier to read during the extension.
- **Lesson**: For short spawn animations, first-frame state matters. If the initial JSX mounts the final geometry, the effect will still feel like a pop even if later frames animate correctly. Anchor from the intended origin edge and mount the object already partway through the animation timeline.

### 142.11 DAMAGE_IMMUNE must be checked in every damage code path (2026-04-29)
- **Bug**: `hasDamageImmune` existed in `guards.ts` and was checked in `Damage.ts` (handleDamage) and `GameLoop.ts` PERIODIC_DAMAGE, but multiple custom ability handlers in `immediateEffects.ts` called `applyDamageToTarget` directly without checking it first.
- **Affected paths**: `BAIZU_AOE`, `WUFANG_XINGJIN_AOE`, `HENG_SAO_LIU_HE_AOE` victim loops; `BANG_DA_GOU_TOU` fallback damage branch; `SETTLE_SOURCE_DOTS` DoT flush; `YIN_YUE_ZHAN` and `LIE_RI_ZHAN` damage cases; dash reach damage in `GameLoop.ts`.
- **Symptom**: 雷霆震怒's `DAMAGE_IMMUNE` buff effect did not block damage from these paths.
- **Fix**: Added `if (hasDamageImmune(victim)) continue/break;` before every `applyDamageToTarget` call in custom handlers. For `SETTLE_SOURCE_DOTS`, wrapped the DoT apply in `if (!hasDamageImmune(...))`. For `BANG_DA_GOU_TOU` fallback, changed `} else {` to `} else if (!hasDamageImmune(victim)) {`.
- **Lesson**: Any new ability with a custom damage path MUST add `hasDamageImmune` check. `handleDamage` in `Damage.ts` is NOT guaranteed to be the only code path that deals damage.

### 142.12 Ability rarity system (2026-04-29)
- **Design**: Rarity is stored as an optional override in `ability-property-overrides.json` per ability, alongside other editor overrides. Values: `精巧` (green), `卓越` (blue), `珍奇` (purple), `稀世` (orange).
- **Backend**: `ABILITY_RARITIES` + `AbilityRarity` type in `abilityPropertySystem.ts`. `setAbilityRarity()` in `abilities.ts`. PUT route `/api/game/ability-editor/:abilityId/rarity`. Rarity included in `abilityPreload.ts` `cardPayload`.
- **Frontend editor**: Rarity selector buttons in `/ability-editor/[abilityId]/page.tsx`. `updateRarity()` calls PUT route, clicking the currently-active rarity deselects it (sets to null).
- **Frontend cheat panel**: `RARITY_ORDER` sort + `RARITY_COLOR` border in `BattleArena.tsx`. Single flat grid replacing the old 已测试/持续伤害/测试中/待重做 tab sections. Icon border color reflects rarity (gray for unset).

### 142.13 Cheat ability picker must exclude hidden special-bar skills (2026-05-02)
- **Bug**: The in-battle cheat window in `BattleArena.tsx` was listing every non-common preload ability, so temporary/form sub-skills like 真·下车 / 洞烛机微 / 魂压怒涛 leaked into the manual add-to-hand panel.
- **Fix**: Expose `specialBarAbility` and `hiddenFromDraft` through `abilityPreload.ts`, filter them out in the BattleArena cheat picker, and reject them again in `/api/game/cheat/add-ability` so direct requests cannot bypass the UI.
- **Lesson**: Any ability hidden from draft or reserved for a temporary special bar must be blocked at both the preload/UI layer and the cheat API; front-end filtering alone is not enough for debug tools.

### 142.14 九霄风雷 form-skill rules must stay split per sub-ability (2026-05-02)
- `jiu_xiao_feng_lei` now uses GCD.
- `dong_zhu_ji_wei` uses GCD but keeps `cooldownTicks: 0`.
- `zhen_xia_che` keeps no cooldown and no GCD, but needs `allowWhileControlled: true` so `validateAction.ts` does not throw `ERR_CONTROLLED`.
- `hun_ya_nu_tao` keeps `gcd: false` but now has `cooldownTicks: 300` (10 seconds).
- **Lesson**: These temporary bar skills do not share one blanket rule. Author each one explicitly in `abilities.ts` and update the description text alongside the runtime flag so the UI does not lie about GCD / cooldown behavior.

### 142.15 Frontend lock-movement channels must not cancel active jump air-shift carry (2026-05-02)
- **Bug**: On 九霄风雷 startup, the frontend `channelMovementLocked` branch in `BattleArena.tsx` was clearing `airNudge*`, `airDirectionLocked`, and `airborneSpeedCarry`, so a player who started the channel mid-jump stopped in place locally even though the backend kept resolving already-started jump drift.
- **Fix**: When `channelMovementLocked && !hardMovementLocked`, zero only planar `vel.x/vel.y`. Do not clear existing jump air-shift / carry refs there.
- **Lesson**: Match the backend distinction exactly: lock-movement channels block new planar input, but they do not retroactively cancel previously-started jump drift. Full control/root locks are a different branch and can still clear movement state.

### 142.16 New abilities added 2026-04-20: 春泥护花, 圣明佑, 烟雨行, 太阴指
- **春泥护花** (chun_ni_hu_hua): buffId 2316. Self-cast, 8 stacks. New effect type `STACK_ON_HIT_GUAN_TI_HEAL` (贯体 heal on hit, stack consumed). 40% DR from DAMAGE_REDUCTION effect. Implemented in GameLoop.ts stack proc section (same loop as STACK_ON_HIT_DAMAGE). Uses GCD.
- **圣明佑** (sheng_ming_you): buffId 2317. New effect type `INSTANT_GUAN_TI_HEAL` handled in immediateEffects.ts (direct `applyHealToTarget`, bypasses HEAL_REDUCTION). Buff: 20% DODGE. No GCD.
- **烟雨行** (yan_yu_xing): DIRECTIONAL_DASH forward 20u, 2 charges (chargeRecoveryTicks 300), CLEANSE root/slow. No GCD, 轻功.
- **太阴指** (tai_yin_zhi): buffId 2318. DIRECTIONAL_DASH backward 30u, `durationTicks: 21` (0.7s). Buff "太阴指" 100% DODGE 800ms. Uses GCD, 轻功.

### 142.17 STACK_ON_HIT_GUAN_TI_HEAL effect type pattern (2026-04-20)
- Added to effects.ts, categories.ts (BUFF category), and GameLoop.ts stack-proc scan section.
- Healing bypasses HEAL_REDUCTION (uses raw `applyHealToTarget`).
- Push HEAL event with `effectType: "STACK_ON_HIT_GUAN_TI_HEAL"`.

### 142.18 Pull immunity via KNOCKBACK_IMMUNE (2026-04-20)
- The `TIMED_PULL_TARGET_TO_FRONT` code in GameLoop.ts did NOT previously check `hasKnockbackImmune`. Fixed by adding the guard before the pull activeDash setup.
- 心诤 (buffId 1017), 千蝶吐瑞 (buffId 2003), 笑醉狂 (buffId 2001) now have `KNOCKBACK_IMMUNE` in their buff effects, making them immune to both knockback and pull.

### 142.19 Channel bar on jump (frontend, 2026-04-20)
- For forward channels with `cancelOnJump: true`, the frontend bar now immediately hides when `localJumpCountRef.current > 0 || |localVzRef| > 0.01`.
- For reverse channel buffs 2001/2003 (jump-cancelling ones), same local airborne check applied.
- Pattern: read refs directly in the IIFE that computes `channelBarData`; re-renders happen every 50ms via `setMyZ` interval.

### 142.20 绝脉 max stacks 3→12 (2026-04-20)
- Changed `maxStacks: 3` to `maxStacks: 12` in the 绝脉 buff (buffId 1337) in abilities.ts.
- Each cast still applies 3 initial stacks; they now accumulate up to 12.

### 142.21 Charged GCD must use `chargeLockTicks` (2026-04-19)
- **Bug**: Global GCD was writing only `cooldown`, but charge-based abilities recompute `cooldown` from `chargeCount/chargeLockTicks` each tick. Result: charged skills could visually and functionally bypass the intended 1.5s GCD after a cast.
- **Fix**: When applying global GCD to a charged ability, initialize charge runtime and set `chargeLockTicks = max(existing, gcdTicks)` in addition to `cooldown`.
- **Takeaway**: For charged skills, runtime lock state is authoritative; setting `cooldown` alone is not enough.

### 142.22 Ability property editor should layer runtime JSON overrides over canonical abilities (2026-04-17)
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

### 142.23 Dash in collision-test mode bypassed BVH (FIXED)
- **Bug**: During `activeDash` in `movement.ts`, horizontal collision used `resolveObjectCollision` (AABB) instead of `resolveExportedHorizontalCollision` (BVH). Vertical ground snapping used `getGroundHeight` (AABB) instead of `getExportedGroundHeight` (BVH).
- **Symptom**: In collision-test mode, dashes could clip through BVH-only walls; terrain height wasn't followed during dashes; player floated above/clipped into terrain while dashing.
- **Fix**: In the `activeDash` block of `movement.ts`, now uses `hasExportedCollision(mapCtx)` to switch between BVH and AABB collision for both horizontal and vertical handling.
- **Files**: `backend/game/engine/loop/movement.ts`

### 142.24 疾 ability visual "collision with opponent" in frontend
- **Root cause**: Was caused by AABB building collision during dash (entity-level AABBs in exportedMap.objects include entity_13 right at spawn, h=4.62). Small AABB buildings were stopping the dash via `resolveObjectCollision`, causing the player to appear to bounce. Fixed by the above BVH dash fix.
- The BVH system passes through thin obstacles correctly instead of bouncing.

---



## 143. Buff Editor (2026-04-22)

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

### 143.1 LOS still false-blocking at range — eye-height + AABB-inside fix (2025)
- **Root cause**: Entity-level AABBs in the exported map over-approximate reality. E.g., entity_0 (h=135, 89×115 footprint) covers a huge area including open spaces players stand in.
- **Two new filters added** (both backend + frontend):
  1. **Eye-height**: Object is skipped if `obj.h <= Math.min(casterZ + 1.5, targetZ + 1.5)`. Objects shorter than both players' eye heights can't block LOS.
  2. **Player-inside-AABB**: If either player is standing inside the object's 2D footprint (point-in-AABB check), the object is skipped. This handles the over-large AABB problem where players in open areas within a building's bounding box should not be blocked by that building.
- **Return type changes**: `isLOSBlocked()` now returns `string | null` (blocking entity id or null). `isLOSBlockedClient()` returns `MapObject | null`.
- **Debug overlay added**: When a cast fails with LOS blocked, a red overlay shows the blocking entity ID and bounds. A wireframe red box highlights it in the 3D scene.
- **Backend logging**: `validateAction.ts` now logs `[LOS] blocked by entity_X (casterZ=N targetZ=N)` for server-side debugging.
- **Files**: Same + `frontend/app/game/screens/in-game/components/BattleArena/scene/ArenaScene.tsx`

---



## 144. Dash Wall Tunneling

### 144.1 Fast dashes clipping through walls (FIXED)
- **Bug**: During `activeDash`, horizontal movement was applied in one large step (~1.23 game units/tick for 疾). BVH collision only resolved at the final position, not along the path.
- **Symptom**: 疾 and 蹑云逐月 could dash straight through BVH walls that were thinner than the dash step size.
- **Fix**: Added sub-stepping in `movement.ts` for dash XY movement. Max sub-step = `playerRadius × 0.85 ≈ 0.544u`. `疾` → ~3 sub-steps/tick, `蹑云逐月` → ~2 sub-steps/tick. Each sub-step applies partial XY, clamps arena bounds, and runs full BVH collision resolution.
- **Files**: `backend/game/engine/loop/movement.ts`

---



## 145. Buff Attribute Tag System (2025)

**Feature: Buff editor tab in ability editor**:

- Added `buffTagSystem.ts` (backend) for loading/saving buff attribute overrides to `buff-attribute-overrides.json`.
- Added two new API routes: `GET /ability-editor/buffs` and `PUT /ability-editor/buffs/:buffId/attribute`.
- Added buff types (`BuffAttribute`, `BuffEditorEntry`, `BuffEditorSnapshot`, `getBuffSubtitle`, `getBuffIconPath`) to `editorShared.ts`.
- Created `BuffEditorTab.tsx` component with 有利/不利 sub-tabs, search, and attribute chip selector.
- Added `mainTabBar` / `mainTab` CSS and all buff-related CSS classes to `page.module.css`.
- Added `mainTab` tab bar to `page.tsx` (技能列表 | BUFF编辑), with lazy-loading buff snapshot on first tab open.

**Pitfall: replace_string_in_file only replaces the matched segment**:

When the old imports block was replaced (only the top few lines), the rest of the old file content was NOT removed. This caused duplicate function/export declarations (`buildOverviewTags`, `export default AbilityEditorPage`, `abilityTypeLabel`).  
**Fix:** Use `head -N` to truncate the file at the correct line after identifying the start of the duplicate section with `grep -n`.


### 145.1 Buff property editor architecture — engine override path

- The buff editor UI saves overrides to `buff-attribute-overrides.json` via `saveBuffEditorOverrides`.
- **abilityPreload.ts** builds the frontend-facing snapshot (UI display only) — modifying effects here changes what the editor shows.
- **Engine path**: `addBuff()` in `buffRuntime.ts` receives the buff definition directly from `ABILITIES`. It does NOT go through `buildAbilityPreload`. To make the editor values actually affect gameplay, property overrides must also be applied inside `addBuff()`.
- Fix: Added `applyPropertyOverridesToEffects()` in `buffEditorOverrides.ts` called from both `abilityPreload.ts` (UI) and `addBuff()` (engine). Now changes to 减伤/无敌/闪避 values in the editor actually affect combat calculations.
- Property mapping: 减伤 → DAMAGE_REDUCTION (value 0–100 → 0–1.0), 无敌 → INVULNERABLE, 闪避 → DODGE (count).
- `properties: []` is now a valid override sentinel meaning "user explicitly cleared all code-defined properties". This required changing `normalizeProperties` to return `[]` instead of `undefined` for empty arrays.

### 145.2 Buff detail page pattern

- Buff list tab (`BuffEditorTab.tsx`) is now read-only — shows name, desc, attribute, property tags, and an "编辑 →" link.
- Edit page lives at `/ability-editor/buff/[buffId]` — fetches the full buff snapshot, finds buff by ID, renders the full edit form.
- Initialize local properties from `entry.properties` if non-empty (user has already set overrides), else copy from `entry.baseProperties` (first-time edit). This lets 守如山's 80% DR show up for editing without requiring prior manual input.
- The `prevEntryBuffId` pattern prevents re-initialization when the snapshot refreshes after a save.


### 145.3 Dispel system (DISPEL_BUFF_ATTRIBUTE effect type)

- New effect type `DISPEL_BUFF_ATTRIBUTE` added to remove BUFF-category buffs from a target by attribute.
- Attribute data lives in `buff-attribute-overrides.json`; must call `loadBuffEditorOverrides()` at runtime to look up each buff's attribute.
- Effect format: `{ type: "DISPEL_BUFF_ATTRIBUTE", attributes: ["阴性", "混元", "阳性", "毒性"] }` — one buff per attribute is removed per effect execution.
- The `attributes` field was added to `AbilityEffect` interface; since the ability file uses `as any`, TS casts are needed only in ability definitions.
- After adding a new `EffectType` member, must also add it to `EFFECT_CATEGORY_MAP` in `categories.ts` (Record<EffectType, string>) — otherwise tsc fails.
- The dispel handler calls `effTarget.buffs.splice(idx, 1)` + `pushBuffExpired(...)` to properly remove and emit events; do NOT use `victim.buffs = victim.buffs.filter(...)` as that replaces the array reference.
- Dodge interaction for dispel abilities is automatic: the `shouldSkipDueToDodge` check before the switch already skips enemy-targeted effects when `abilityDodged=true`.

### 145.4 ignoreDodge ability property

- Added `ignoreDodge?: boolean` to the `Ability` interface in `types/abilities.ts`.
- `computeAbilityDodge` in `dodge.ts` now checks `if (ability.ignoreDodge) return false;` before calling `shouldDodge`.
- This is the cleanest approach — no change needed in PlayAbility.ts, the dodge result flows through automatically.

### 145.5 Canonical Class (School) Ordering

Always use this order for any list, filter, or display of schools:
少林 万花 天策 纯阳 七秀 藏剑 唐门 明教 丐帮 苍云 长歌 霸刀 蓬莱 凌雪 衍天 药宗 刀宗 万灵 段氏 五毒 通用

Code arrays (20 schools + 通用):
["少林","万花","天策","纯阳","七秀","藏剑","唐门","明教","丐帮","苍云","长歌","霸刀","蓬莱","凌雪","衍天","药宗","刀宗","万灵","段氏","五毒","通用"]

Locations to update when adding new schools: editorShared.ts SCHOOL_TAGS, BattleArena.tsx SCHOOL_TAGS_BA.

### 145.6 New Effect Types (April 2026 batch)

- `MIN_HP_1`: prevents HP going below 1 (cannot-die). Implemented in `applyDamageToTarget` in health.ts.
- `NIEYUN_DASH_REDUCTION`: reduces 蹑云逐月 dash distance and duration by 70%. Implemented in DirectionalDash.ts.
- `DAMAGE_REDIRECT_55`: semantic marker on 毒手 debuff. Actual redirect logic lives in Damage.ts handleDamage.

### 145.7 玄水蛊 Damage Redirect Design

- Buff 2607 (玄水蛊) on CASTER = redirect is active
- Buff 2606 (毒手) on TARGET = they absorb the redirect
- When caster takes enemy HP damage, 55% is restored to them and dealt directly (bypassing DR) to the target with 毒手
- Logic in Damage.ts handleDamage, after applyDamageToTarget, checks isEnemyEffect + actualHpDamage > 0

### 145.8 七星拱瑞 On-Damage Break Design

- Buff 2600 (七星拱瑞): CONTROL + ROOT + PERIODIC_GUAN_TI_HEAL 5/s, 15s. Applied via applyBuffsOnComplete.
- On any enemy damage to the holder, buff is removed (via splice + BUFF_EXPIRED event) and buff 2601 (七星拱瑞·眩晕) is applied via addBuff for 4s.
- Logic in Damage.ts handleDamage, triggered when isEnemyEffect and target has buffId 2600.

### 145.9 On-Damage Hooks Refactor (七星拱瑞 break + 玄水蛊 redirect)

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



## 146. Pre-Damage Redirect Pattern (玄水蛊 Fix)
- **Problem**: Post-damage HP-restore redirect was correct for HP bar but the DAMAGE event still emitted the full `final` value, so A's damage float showed `-10` while HP only dropped 4.
- **Solution**: Changed to pre-damage split via `preCheckRedirect()` in `onDamageHooks.ts`. Export `preCheckRedirect` + `applyRedirectToOpponent`; call before `applyDamageToTarget` in all 6 damage paths (Damage.ts + 5 GameLoop paths). The DAMAGE event naturally carries the reduced value.



## 147. Round 3: Ability Fixes + New Abilities (Session 3 Cont.)

**Fixes Applied**:
- **极乐引 (ji_le_yin)**: Converted from CHANNEL targeted to instant SELF-cast AOE pull. Custom effect `JILE_YIN_AOE_PULL` in immediateEffects.ts teleports all enemies within 10u to 1u in front of caster, then applies buff 2608 stun 4s. Removed from `PULL_CHANNEL_POST_STUN_CONFIG` in GameLoop.ts.
- **傍花随柳 (bang_hua_sui_liu)**: Changed `channelCancelOnMove: true` → `false`. Removed silence logic from PlayAbility.ts trigger; ALL 3 stacks now deal 1 damage only. Removed buff 2612 (束发) from abilityPreload.ts.
- **化蝶 (hua_die)**: Replaced simple DIRECTIONAL_DASH with 2-phase system. Phase 1: custom `HUA_DIE_PHASE1` effect (diagonal: 2u forward + 4u up over 30 ticks, CC immune). Phase 2: triggered in GameLoop when Phase 1 ends (forward 27u, stealth+damage_immune buff 2613). `_huaDieP2Done` flag prevents double-trigger.

**New Abilities**:
- **少明指 (shao_ming_zhi)**: CHANNEL 1s, can move, cannot jump. DAMAGE:1 + `DISPEL_BUFF_ATTRIBUTE` with `count: 2` per attribute. Required adding `count` loop to DISPEL_BUFF_ATTRIBUTE handler (previously removed 1 per attribute, now loops `count` times).
- **临时飞爪 (lin_shi_fei_zhua)**: Ground-target dash 40u. Custom `LIN_SHI_FEI_ZHUA_DASH` effect — sets `activeDash.ccStopsMe = true` and does NOT call applyDashRuntimeBuff. movement.ts checks `ccStopsMe` and cancels dash if CONTROL/ROOT/ATTACK_LOCK active.
- **剑主天地 (jian_zhu_tian_di)**: Custom `JIAN_ZHU_TIAN_DI_STRIKE`. At 3 stacks → detonate (settle remaining ticks + this hit damage). Otherwise: 1 damage + addBuff 2614 (stacks up to 3). Similar to 三环套月 in buffRuntime.ts but done in immediateEffects.ts.
- **破风 (po_feng)**: Custom `PO_FENG_STRIKE`. 1 damage + buff 2615 (DAMAGE_TAKEN_FLAT +5) + buff 2616 流血 (bleed stack). Extra stack of 流血 if target has CONTROL_IMMUNE (check via `blocksControlByImmunity("CONTROL", target)`).

**New Effect Types Added**:
- `JILE_YIN_AOE_PULL`, `LIN_SHI_FEI_ZHUA_DASH`, `HUA_DIE_PHASE1`, `DAMAGE_TAKEN_FLAT`, `JIAN_ZHU_TIAN_DI_STRIKE`, `PO_FENG_STRIKE` — added to `effects.ts` EffectType union and `categories.ts` EFFECT_CATEGORY_MAP.
- `DAMAGE_TAKEN_FLAT`: Added to `combatMath.ts` — applied after multiplicative modifiers as a flat addition.

**Lessons Learned**:
- `pushEvent` is NOT available in immediateEffects.ts — use `state.events.push({ id: randomUUID(), timestamp: Date.now(), ... })` directly.
- `blocksControlByImmunity(effectType, target)` takes 2 arguments.
- New EffectTypes must be added to BOTH `effects.ts` (union) AND `categories.ts` (Record<EffectType, string>) or tsc fails with a missing key error.
- 化蝶 Phase 2 uses `_huaDieP2Done` flag on the player object to prevent retriggering every tick.



## 148. Typed Damage Reduction + Zone Channel Abilities (2026-04-25)

**Architecture: damageType propagation gap**:

**Problem**: `resolveScheduledDamage` accepts `damageType?: string`, and DAMAGE_REDUCTION buff effects can have a `damageType` field to make them type-specific. However, ALL 13 call sites in `GameLoop.ts` (periodic damage, channel AOE ticks, TIMED_AOE_DAMAGE, dash-on-hit, zone damage, etc.) did NOT pass `damageType`. This meant typed reductions (e.g., 30% 内功减伤 from 冲阴阳) never activated — only damage from `immediateEffects.ts` (instant-cast effects) was type-filtered correctly.

**Fix**: For each `resolveScheduledDamage` call in GameLoop.ts, pass the source ability's damageType:
- Buff-sourced damage: `damageType: (ABILITIES[buff.sourceAbilityId ?? ""] as any)?.damageType`
- Channel-completion damage: `damageType: (ABILITIES[ch.abilityId] as any)?.damageType`
- Specific ability landing damage: `damageType: (ABILITIES["ability_id"] as any)?.damageType`
- Zone damage: `damageType: (ABILITIES[zone.abilityId ?? ""] as any)?.damageType`
- Dash-on-reach damage: `damageType: (reachAbility as any)?.damageType`

**Same root cause existed before**: 外功闪避 (PHYSICAL_DODGE) had the same gap and was fixed in a prior session for GameLoop damage paths.

**Architecture: DAMAGE_REDUCTION stacking**:

**Problem**: `combatMath.ts` used `.find()` to get ONE DAMAGE_REDUCTION effect, then `dmg *= 1 - value`. This means only the FIRST matching reduction applied; stacked reductions were silently ignored.

**Fix**: Changed to `.filter()` + loop — all matching reductions apply multiplicatively:
```typescript
const matchingReductions = allEffects(params.target).filter(...);
for (const dr of matchingReductions) { dmg *= 1 - (dr.value ?? 0); }
```
A typed reduction (`e.damageType === "内功"`) only applies when `params.damageType` matches exactly. An untyped reduction applies to all damage.

### 148.1 Zone channel buffs: use addBuff()

**Problem**: 冲阴阳/凌太虚/吞日月 zone pulse handlers pushed buffs directly to `player.buffs` (bypassing `addBuff()`), so BUFF_APPLIED events weren't emitted and status bar didn't show them.

**Fix**: Replaced `owner.buffs.push({...})` with `addBuff({state, sourceUserId, targetUserId, ability: ABILITIES["chong_yin_yang"], buffTarget: owner, buff: { buffId, name, category, durationMs: 2000, effects }})`. The `addBuff` function handles refresh (same buffId → old removed, new added), immunity checks, and BUFF_APPLIED event emission. Zone pulsed every 1s with `durationMs: 2000` keeps the buff active as long as owner stays in zone.

### 148.2 PM2 restart loop deadlock

**Problem**: After many rapid restarts (>15 in a short window), PM2 enters "errored" state and stops retrying. Even after killing port-occupying processes, PM2 won't restart. `lsof -ti:PORT` may miss processes that only show in `ss -tlnp`.

**Fix**: 
1. Use `ss -tlnp | grep PORT` to find hidden listening processes (lsof missed a `next-server` process).
2. `kill -9 <pid>` to kill it.
3. `pm2 reset <name>` to reset restart counter.
4. `pm2 start <name>` to start fresh.

### 148.3 Zone buff enter/exit architecture (2026-04-25)

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

### 148.4 4 new abilities: 无相诀, 应天授命, 斩无常, 灭 (2026-04-xx)

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



## 149. 远程弹道技能 Editor Tab (2026-05 session)

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



## 150. isProjectile Blocking Bug Fix (2026-05 session)

**Bug**: Abilities marked `isProjectile: true` in `ability-property-overrides.json` still dealt damage through 斩无常's PROJECTILE_IMMUNE. The check in `Damage.ts` was present and correct, and `buildResolvedAbilities()` applied the flag correctly. The bug was in `normalizeAbilityOverrideEntry()` in `abilityPropertySystem.ts` — it stripped `isProjectile` from the JSON on load. The function parsed `properties`, `numeric`, `tags` but never read `isProjectile`, so `abilityOverrides?.isProjectile` was always `undefined` at rebuild time.

**Fix**: Added `isProjectile` parsing in `normalizeAbilityOverrideEntry`: read `entryRecord.isProjectile` (boolean), include it in the return object, and updated the empty-check guard to also consider `isProjectile`.

**Root cause pattern**: When a new field is added to `AbilityEditorOverrideEntry` and `saveAbilityEditorOverrides`, the `normalizeAbilityOverrideEntry` function must also be updated to parse and pass through that field — it doesn't do a generic passthrough.



## 151. 斩无常 Channel Range Display (2026-05 session)

**Feature**: Added 4-unit AOE ring for 斩无常 (buffId 2712) just like 风来吴山 (buffId 1014) has.

**Implementation**:
- `ArenaScene.tsx`: Added `meChannelRadius?: number` and `channelingOpponentRadius?: number` props (default 10). The AOE zone `radius` now uses these instead of the hardcoded `10 * storedUnitScale`.
- `BattleArena.tsx`: Added `meChannelRadiusRef` and `oppChannelRadiusRef` (default 10). The `useEffect` watching `me?.buffs` now checks both buffId 1014 and 2712, setting radius to 4 for 2712. Same for opponent buffs. `ArenaScene` receives `meChannelRadius` and `channelingOpponentRadius` derived from the refs.

### 151.1 isProjectile Display Fix verification (2026-04 session)
After the `normalizeAbilityOverrideEntry` fix was compiled, verified via:
```node -e "const {loadAbilityEditorOverrides}=require('./backend/dist/game/abilities/abilityPropertySystem.js'); const r=loadAbilityEditorOverrides(); console.log(Object.entries(r.overrides).filter(([,v])=>v.isProjectile===true).length);"```
→ Returns 21, confirming the JSON's `isProjectile: true` entries are now read.

### 151.2 PROJECTILE_IMMUNE: Buff bypass fix (2026-04 session)
**Bug**: When PROJECTILE_IMMUNE blocked damage, enemy-targeted buffs from the same projectile ability still applied (e.g. slows, stuns from ranged attacks).

**Fix 1 - immediateEffects.ts**: Added PROJECTILE_IMMUNE check in the main effect loop BEFORE the switch statement. If `enemyApplied && ability.isProjectile === true && target has PROJECTILE_IMMUNE buff` → `continue` (skip ALL enemy effects: damage, controls, knockbacks, etc.).

**Fix 2 - buffs.ts**: Added same check in the per-buff loop of `applyAbilityBuffs`. If `localEnemyApplied && ability.isProjectile === true && localBuffTarget has PROJECTILE_IMMUNE` → `continue`.

**Pattern**: PROJECTILE_IMMUNE must be checked in BOTH `immediateEffects.ts` (for effects[]) AND `buffs.ts` (for buffs[]) because the ability pipeline handles effects and buffs in separate passes.



## 152. Legacy Damage Route Audit (2026-04-26 session)

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



## 153. 孤影化双 ability implementation (2025)

**Pattern: snapshot + deferred restore via buff expiry**:
- Added `GU_YING_HUA_SHUANG` to `EffectType` union in `effects.ts` and `EFFECT_CATEGORY_MAP` in `categories.ts` — every new custom effect type needs both updates.
- Snapshot is stored as `(liveBuff as any).snapshot = { hp, shield, cooldowns }` AFTER calling `addBuff()`, by finding the buff in `source.buffs` by buffId.
- `addBuff()` does NOT support custom extra fields — attach custom data to the returned live buff object post-call.
- Restore happens in `GameLoop.ts` in the `naturallyExpired` section, same pattern as `wuxiangExpired` and `xuanjianNaturallyExpired`.
- Buff declared in `ability.buffs[]` is auto-included in abilityPreload — no manual `buffs.push()` needed.
- The CLEANSE effect (declared separately in `effects[]`) handles control removal; the custom effect only handles snapshot + buff application.



## 154. TargetEntity Round 3 — wall stops, knockback angle, clear-all

### 154.1 Entity knockback ignored walls/terrain
- Round-2 entity dash integrator just added `vxPerTick`/`vyPerTick` to position with no collision pass, so dummies tunneled through walls and floated up onto raised floors. Fixed in `GameLoop` entity dash loop: sub-step the move (≤0.5u per sub-step), call `resolveMapCollisions(entity as any, this.mapCtx)` per sub-step, then snap `entity.position.z` to `getGroundHeightForMap(...)` so they walk over terrain naturally and stop at walls. If actual step < 35% of intended, the dash is canceled (matches the player wall-block heuristic).

### 154.2 沧月 knockback direction must originate from the caster
- Original handler used `target − primary` for the outward direction. That made the side targets fan around the *primary* dummy regardless of where the caster was — which looked wrong when the caster stood off-axis. Fixed to use `target − source` (caster → victim) so all secondary targets get pushed away from the caster. Fallback uses caster facing if a victim sits on top of the caster.

### 154.3 Clear-all-dummies button
- Added `POST /cheat/clear-dummies` (mirrors restore-dummies / clear-dummy-debuffs) which `filter()`s out any entity whose `kind` is in `DUMMY_KINDS`. Wired a red "清除木桩" button next to "清木桩Buff" in the dummy control panel.



## 155. Round: 5 new test abilities + 沧月 polish

- Renamed buff 1340 沧月·击倒 → 沧月·倒地.
- Reverted 沧月 knockback direction to caster-relative (safe now: entity dash uses velocity-free `resolveEntityHorizontalCollision` from prior round).



## 156. Ability Editor 加成修正批量重置为未修正 (2026-05-31)

- 用户反馈 `ability-editor?tab=adControl` 列表状态过期，需要保留现有条目与系数，仅重置审查状态。
- 在 `backend/game/abilities/ability-property-overrides.json` 批量将全部 167 个技能条目的 `adControlStatus` 统一改为 `"unfixed"`，不改动 `numeric`、`description`、`tags` 等字段。
- 校验结果：`adControlStatus` 统计为 `unfixed: 167, fixed: 0, needs-more: 0`。

**Lesson**:
- 对加成修正页做“回炉重审”时，优先只重置 `adControlStatus`，避免误动系数与文案数据。
- Made `lifestealPct` work for immediate DAMAGE effects (player→player in `Damage.ts`, player→entity in `immediateEffects.ts`). Previously only TIMED_AOE_DAMAGE/scheduled supported it.
- Added EffectTypes `XU_RU_LIN_PROC` (parent self-buff marker) and `XU_RU_LIN_RESTORE` (child buff marker) — registered in `effects.ts` union and `categories.ts` map (both BUFF).
- Added 5 new abilities: `qu_ye_duan_chou` (驱夜断愁, 50% lifesteal), `bu_feng_shi` (捕风式, 20% slow 3s), `you_yue_lun` (幽月轮, 1 damage), `xu_ru_lin` (徐如林, 50%-on-hit-proc → heal 5 on expire), `kang_long_you_hui` (亢龙有悔, 2×3 damage + self-CONTROL 1s + DOT 24s/2-stack/2s tick).
- Pattern for self-target debuff on opponent-targeted ability: set `applyTo: "SELF"` per-buff (亢龙有悔·定身).
- Pattern for dynamic on-hit proc buff: declare both parent + child buffs in `ability.buffs[]` for editor visibility, exclude ability from `applyAbilityBuffs`, apply parent on cast via custom hook in `immediateEffects.ts`, apply child via attacker-side proc loop in `GameLoop.ts` (placed just before `stackProcScanIndex` update). Heal-on-expire handled by filtering `naturallyExpired` near other expire handlers.



## 157. Round: lifesteal-at-full-HP, ability tweaks, 4 new abilities

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



## 158. Ability description regex migration (41 -> 32 first batch) (2026-05-30)

**What was changed**:
- Applied a targeted text migration in `backend/game/abilities/ability-property-overrides.json` for full main-damage fragments only: `X...(+[coef*...攻击])...伤害` -> `（coef*攻击力）点伤害`.
- Total replacements in batch 1: 32.
- Applied requested explicit mapping for 剑主天地: `86-95点(+[2.0781*最终阴性内功攻击])伤害` -> `（3.8541*攻击力）点伤害`.

**Why 41 became 32**:
- The original 41-count search matched any `(+[...攻击...])` fragment.
- 9 of those are not the same sentence shape as main-hit damage clauses (e.g., periodic damage suffixes, control-duration scaling, multi-clause projectile lines), so they were intentionally excluded from batch 1 to avoid over-replacement.

**Lesson**:
- For description cleanup, split passes by semantic shape first (main-hit clause vs periodic/control/auxiliary clause). This avoids changing non-damage or secondary formula text accidentally.



## 159. Ability description parenthesis normalization + remaining 9 conversion (2026-05-30)

**What was changed**:
- Normalized ability override descriptions to ASCII parentheses in `backend/game/abilities/ability-property-overrides.json` by replacing full-width `（ ）` with `()`.
- Completed the previously excluded 9 formula fragments (periodic lines, multi-segment line, and one control-scaling suffix) to the simplified attack-power style.

**Validation**:
- Post-change scan result: full-width parentheses count `0` and legacy `(+[...攻击...])` fragments in descriptions count `0`.

**Lesson**:
- If style consistency requires ASCII punctuation, run punctuation normalization before formula migration to avoid mixed-width output and reduce cleanup passes.

