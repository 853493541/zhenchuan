# Zhenchuan — Experiences Log

Record all problems solved, unresolved issues, and disproved approaches here.
Each entry goes under its relevant section header.

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

- Player radius for collision-test: **0.64** (authoritative, set in `GameLoop.ts`).
- Ground support radius must be tight (≈ playerRadius + small epsilon); too large causes "floating on air" near edges.
- Side-collision Z gating must be consistent with ground-support epsilon, or players bounce/get rejected on rooftops.
- Critical broadphase rule: every spatial query must use the segment bounds (min/max of sx/sy/ex/ey), not legacy x/y/w/d, or you get invisible blockers / walk-through colliders.

---

## Dashing Abilities

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

---
