# Zhenchuan Project - OpenCode Working Instructions

## 1. Task Handling Protocol

### 1.1 Point-by-point execution
When the user provides numbered instructions, handle one point at a time in order.

### 1.2 Session summary format
At the end of every session, output a chart with columns: Point | What Was Done | What to Test.

### 1.3 Re-read before edit
Before editing any file, read the current file contents again first.

### 1.4 Record experiences
Record every solved problem, unresolved issue, or disproved approach in:
`/home/ubuntu/zhenchuan/EXPERIENCES.md`

### 1.5 Primary language policy
Primary project language is English.
Chinese is allowed for in-game names/terms where needed, but most documentation, code comments, and agent responses should be in English.
Respond primarily in English even when the user message is in Chinese, unless the user explicitly asks for Chinese output.

### 1.6 Ability related experience location
For ability-related experience entries, edit:
`/home/ubuntu/zhenchuan/ABILITY_EXPERIENCES.md`
Keep `EXPERIENCES.md` focused on general/system/non-ability experiences.

## 2. Build and Runtime Verification

### 2.1 Build commands
- Backend: `cd /home/ubuntu/zhenchuan/backend && npm run build`
- Frontend: `cd /home/ubuntu/zhenchuan/frontend && npm run build`

### 2.2 PM2 restart scope
Restart only this project's PM2 apps from `/home/ubuntu/zhenchuan`:
`pm2 restart frontend backend`

Do not use `pm2 restart all` for Zhenchuan checks.
Do not restart, stop, or kill `rencipe-*` processes unless explicitly requested.

### 2.3 Verification order per numbered point
At the end of each numbered round/point, run both builds again before replying.
Restart PM2 only after the newest successful build.
Reply must confirm PM2 is running the newest build with no startup-blocking errors.

### 2.4 Port conflict handling
If port `3000` or `5000` is occupied during PM2 start/restart, kill the occupying process:
`lsof -ti:PORT | xargs kill -9`
Then restart only `frontend backend` again.

### 2.5 Scope discipline
Ignore unrelated `rencipe-*` PM2 processes and ports unless the user explicitly scopes to them.

### 2.6 Build-skip exception
Do not skip the build step unless there are no code changes.

## 3. Game Rules and Active Modes

### 3.1 Primary mode
`yumenguan` is the primary/official game mode.

### 3.2 Test mode usage
`test` mode is the fast testing mode.
Use it for quicker iteration and validation when applicable.

### 3.3 Legacy modes
`arena` and `pubg` are legacy/secondary modes.

### 3.4 Backend/frontend prediction parity
After gameplay or movement changes (movement, jump, dash, collision, facing, buff timing), verify frontend prediction in:
`frontend/app/game/screens/in-game/components/BattleArena/`
Do not leave backend and frontend prediction logic knowingly out of sync.

### 3.5 UI comfort rule
Do not use blur-backed in-game panels/menus (`backdrop-filter: blur(...)`).
Use solid or semi-opaque surfaces instead.

## 4. Architecture and Coordinate Reminders

### 4.1 Key architecture files
- Game loop: `backend/game/engine/loop/GameLoop.ts` (30 Hz tick; movement/abilities/buffs)
- Movement and collision: `backend/game/engine/loop/movement.ts`
- Ability source of truth: `backend/game/abilities/abilities.ts`
- Effect pipeline: `playService -> executeAbility -> PlayAbility -> immediateEffects -> handlers -> definitions/`
- Exported collision: `backend/game/map/exportedMapCollision.ts`
- State types: `backend/game/engine/state/types/`
- Frontend battle scene: `frontend/app/game/screens/in-game/components/BattleArena/`

### 4.2 Coordinate system
- World to Three.js mapping: `threeX = worldX - worldHalf`, `threeZ = worldY - worldHalf`, `threeY = worldZ`
- Test map is non-square (819 x 828 after 50% scale-up): use `width/2` for X offsets, `height/2` for Y/Z offsets.

## 5. Editor and UI Input Rules

### 5.1 Numeric input rule
Never use `<input type="number">`.
Use `<input type="text" inputMode="decimal">` (or `inputMode="numeric"` for integers), and filter invalid characters with regex in `onChange`.

### 5.2 Spinner removal CSS
```css
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button { display: none; }
```
Also apply `-moz-appearance: textfield`.

### 5.3 Coverage scope
Apply this input rule to all editor pages (ability detail, buff detail, and future forms).

## 6. Git and Asset Rules

### 6.1 Commit safety
Never commit unless explicitly requested.
If user says "commit once", do exactly one commit.

### 6.2 Asset creation safety
Do not create icons or other art assets unless explicitly requested.
If an icon is missing, keep the intended filename reference and report the missing asset name.

## 7. Buff Implementation Rules

### 7.1 Mandatory buff entry path
All buffs must be applied via `addBuff()` in `buffRuntime.ts`.
Never directly push into a player's `buffs` array.

### 7.2 Ability declaration requirement
Every player-applied buff must be declared in the ability `buffs: []` array so it is visible, editable, and preloadable.
If custom handlers apply a buff, exclude that ability from `applyAbilityBuffs` in `buffs.ts` and call `addBuff` manually.

### 7.3 Diminishing returns behavior
CONTROL buffs automatically trigger stun diminishing returns (buffId `990101`) via `getResistanceConfig` in `addBuff`.
ROOT buffs trigger root diminishing returns (buffId `990100`).

## 8. Common Pitfalls

### 8.1 Backend URL
Do not use external URLs in `BACKEND_URL` (can cause nginx 404).

### 8.2 Proxy host header
Always set `Host` header in nginx proxies.

### 8.3 WebSocket proxy upgrade
WebSocket proxy requires `http/1.1` and `Upgrade` headers.

### 8.4 Mongoose Mixed fields
Reassign array elements with spread (`{...obj, prop: newVal}`) and call `markModified()` before `save()`.

## 9. Playwright Verification Policy

### 9.1 When to run Playwright
Run Playwright tests only when:
- The update is very large/high-impact, or
- The user explicitly asks for Playwright testing.

### 9.2 Default target when Playwright is required
When Playwright is required, use:
`https://zhenchuan.renstoolbox.com/`
unless the user explicitly asks for localhost-only verification.

### 9.3 Auth-protected flow guidance
For auth-protected frontend verification, follow:
`frontend/tests/SOUND_REVIEW_LIVE_TESTING.md`

### 9.4 Credentials handling
Use test accounts `测试一` and `测试二` with credentials from local environment variables or the active browser session.
If those are not enough for the validation scenario, create additional test accounts as needed.
Never hardcode passwords/tokens in repo files or instructions.
