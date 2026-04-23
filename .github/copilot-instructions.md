# Zhenchuan Project – Copilot Working Instructions

## Task Handling Protocol

1. **Work point-by-point.** When the user provides numbered instructions, tackle them one at a time in order.  
   At the end of every session, output a **chart summary** with columns: Point | What Was Done | What to Test.

2. **Always build and restart after changes.**  
   - Backend: `cd /home/ubuntu/zhenchuan/backend && npm run build`  
   - Frontend: `cd /home/ubuntu/zhenchuan/frontend && npm run build`  
   - Restart: `pm2 restart all` (from `/home/ubuntu/zhenchuan`)  
   - At the end of **each numbered round / point**, run both builds again to check for errors before replying.  
   - PM2 must be restarted only after the newest successful build, and the reply must confirm PM2 is running that newest build with no reported startup errors.  
   - If port `3000` or `5000` is in use when PM2 starts or restarts, kill the occupying process (`lsof -ti:PORT | xargs kill -9`) and start PM2 again.  
   - If a different required port is in use: kill the occupying process (`lsof -ti:PORT | xargs kill -9`), *then* do `pm2 restart all`.  
   - Never skip the build step — ts-node compiles at startup only.

3. **Record experiences.** Every problem solved, unresolved issue, or disproved approach must be written to:  
   `/home/ubuntu/zhenchuan/EXPERIENCES.md` — filed under appropriate section headers.

4. **Re-read every file before editing it.** Before making changes to any file, read its current contents again first. This prevents edits from being made against stale file state.

5. **After gameplay or movement changes, always check frontend prediction.** If backend movement, jump, dash, collision, facing, or buff timing changes, verify the frontend prediction path in `BattleArena.tsx` and correct it in the same session. Do not leave backend and prediction logic knowingly out of sync.

6. **Do not use blur-backed UI panels.** Never use `backdrop-filter: blur(...)` or blur-style overlay backgrounds for in-game panels or menus. Use solid or semi-opaque surfaces instead; blur hurts the user's eyes.

## Game: Active Mode

- **`collision-test`** is the **primary / official game mode** (uses the exported 3D map and the authoritative collision body defined in `exportedMapCollision.ts`).  
  Treat all game-play logic, collision, ability, and movement work as targeting this mode unless otherwise stated.  
  Modes `arena` and `pubg` are legacy/secondary.

## Key Architecture Reminders

- GameLoop: `backend/game/engine/loop/GameLoop.ts` — 30 Hz tick; handles movement, abilities, buff ticks.
- Movement + collision: `backend/game/engine/loop/movement.ts`.
- Abilities: canonical definition in `backend/game/abilities/abilities.ts`.
- Effect pipeline: `playService → executeAbility → PlayAbility → immediateEffects → handlers → definitions/`.
- Exported collision system: `backend/game/map/exportedMapCollision.ts`.
- State types: `backend/game/engine/state/types/`.
- Frontend battle scene: `frontend/app/game/screens/in-game/components/BattleArena/`.

## Coordinate System

- World → Three.js: `threeX = worldX − worldHalf`, `threeZ = worldY − worldHalf`, `threeY = worldZ`.
- Collision-test map is non-square (819 × 828 after 50% scale-up): use **width/2** for X offsets, **height/2** for Y/Z offsets.

## Input Fields

- **Never use `<input type="number">`.** It renders browser arrow spinners that are visually unacceptable. Always use `<input type="text" inputMode="decimal">` (or `inputMode="numeric"` for integers), with a regex `onChange` filter that strips non-numeric characters. Add `-moz-appearance: textfield` and hide webkit spin buttons in CSS:
  ```css
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button { display: none; }
  ```
- Apply this rule to ALL editor pages (ability detail, buff detail, and any future forms).

## Git / Version Control

- **Never commit** unless explicitly told to. If the user says "commit once", do exactly one commit — never more.

## Buff Implementation Rules

- **All buffs must go through `addBuff()` in `buffRuntime.ts`.** Never directly push objects into a player's `buffs` array. Direct pushes bypass immunity checks, the 递减 (diminishing returns) system, BUFF_APPLIED event emission, and the status bar display.
- **Every buff applied to a player must be declared in the ability's `buffs: []` array** so it is visible, editable, and preloadable. If an ability's custom handler applies a buff, exclude that ability from `applyAbilityBuffs` in `buffs.ts` and call `addBuff` manually.
- **CONTROL buffs automatically trigger 眩晕递减** (stun diminishing returns, buffId 990101) via `getResistanceConfig` in `addBuff`. ROOT buffs trigger 锁足递减 (990100). No extra code needed — just use `addBuff`.

## Common Pitfalls

- Do **not** use external URLs in `BACKEND_URL` — causes nginx 404.  
- Always set `Host` header in nginx proxies.  
- WebSocket proxy needs `http/1.1 + Upgrade` headers.  
- Mongoose Mixed fields: reassign array elements with spread `{...obj, prop: newVal}` and call `markModified()` before `save()`.
