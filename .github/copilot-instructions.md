# Zhenchuan Project – Copilot Working Instructions

## Task Handling Protocol

1. **Work point-by-point.** When the user provides numbered instructions, tackle them one at a time in order.  
   At the end of every session, output a **chart summary** with columns: Point | What Was Done | What to Test.

2. **Always build and restart after changes.**  
   - Backend: `cd /home/ubuntu/zhenchuan/backend && npm run build`  
   - Frontend: `cd /home/ubuntu/zhenchuan/frontend && npm run build`  
   - Restart: `pm2 restart all` (from `/home/ubuntu/zhenchuan`)  
   - If a port is in use: kill the occupying process (`lsof -ti:PORT | xargs kill -9`), *then* do `pm2 restart all`.  
   - Never skip the build step — ts-node compiles at startup only.

3. **Record experiences.** Every problem solved, unresolved issue, or disproved approach must be written to:  
   `/home/ubuntu/zhenchuan/EXPERIENCES.md` — filed under appropriate section headers.

## Game: Active Mode

- **`collision-test`** is the **primary / official game mode** (uses the exported 3D map, player radius 0.64).  
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
- Collision-test map is non-square (737.1 × 745.2 after 35% scale-up): use **width/2** for X offsets, **height/2** for Y/Z offsets.

## Git / Version Control

- **Never commit** unless explicitly told to. If the user says "commit once", do exactly one commit — never more.

## Common Pitfalls

- Do **not** use external URLs in `BACKEND_URL` — causes nginx 404.  
- Always set `Host` header in nginx proxies.  
- WebSocket proxy needs `http/1.1 + Upgrade` headers.  
- Mongoose Mixed fields: reassign array elements with spread `{...obj, prop: newVal}` and call `markModified()` before `save()`.
