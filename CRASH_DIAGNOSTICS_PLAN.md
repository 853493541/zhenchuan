# Random White-Screen Crash Diagnostics Plan

Date: 2026-05-21

## What The Symptom Suggests

The game turning into a white screen after running for a while, especially when DevTools/F12 is not usable afterward, is a sign that console logs are not enough. The likely classes are:

- Browser renderer process crash or out-of-memory.
- WebGL/GPU context loss.
- Uncaught React/runtime exception that unmounts the app without a useful fallback.
- Resource leak over time: textures, geometries, DOM nodes, audio nodes, timers, WebSocket/event queues, or large game snapshots.
- Backend/network failure causing the client to enter a bad state, though a total white screen is more often client/render-process side.

The correct approach is to build a small in-game flight recorder that persists evidence outside the F12 console.

## Implementation Status

Implemented on 2026-05-21:

- Frontend recorder: `frontend/app/game/diagnostics/clientCrashRecorder.ts`.
- React crash fallback: `frontend/app/game/diagnostics/ClientCrashBoundary.tsx`.
- Backend JSONL endpoint: `POST /api/diagnostics/client-crash-report`.
- Report files: `/home/ubuntu/zhenchuan/logs/client-crashes/YYYY-MM-DD.jsonl`.
- Automatic frontend log stream: `POST /api/diagnostics/client-frontend-log`.
- Frontend log files: `/home/ubuntu/zhenchuan/logs/frontend/YYYY-MM-DD.jsonl`.
- ESC access: `系统设置 -> 测试 -> 崩溃诊断`.
- Behavior timeline: key input, movement samples, jump attempts, ability casts, ground casts, mouse/touch camera actions, API failures, WebSocket messages, disconnects, reconnects, WebGL context loss/restoration, fatal errors, page lifecycle, and heartbeat snapshots.
- Crash/disconnect relationship: each report includes the event/crash timestamp, last heartbeat, last disconnect time, last reconnect time, disconnect counts, and whether the event happened before/after/near the last disconnect.
- Important correction: ESC is only a manual convenience. The useful crash evidence is now streamed automatically into backend frontend logs during play, including forced `sendBeacon` attempts on page hide, unload, and fatal events.

Still useful later:

- Add an admin/recent-report browser if reading JSONL directly becomes inconvenient.
- Add a longer Playwright soak test that intentionally uploads periodic snapshots and records report ids.

## Storage Targets

Use three layers so one failure does not erase everything:

1. **In-memory ring buffer** for cheap high-frequency events.
2. **IndexedDB/localStorage durable buffer** flushed every few seconds and on major events.
3. **Backend frontend-log endpoint** that writes small rolling JSONL batches under `/home/ubuntu/zhenchuan/logs/frontend/` during normal play.
4. **Backend crash-report endpoint** that writes larger summary JSONL reports under `/home/ubuntu/zhenchuan/logs/client-crashes/`.

The backend frontend log is the primary evidence source after a hard crash because it is written before the crash. IndexedDB/localStorage is only a fallback queue when network upload fails, and should be uploaded automatically on the next page load.

## Frontend Flight Recorder

Create a small frontend module, for example `frontend/app/game/diagnostics/clientCrashRecorder.ts`, loaded before or at the top of the in-game client.

It should capture:

- `window.onerror` and `window.onunhandledrejection` with stack traces.
- React error boundary reports around the game screen.
- Wrapped `console.error` / `console.warn` entries, capped and sanitized.
- WebGL context events: `webglcontextlost`, `webglcontextrestored`, renderer info.
- Periodic heartbeat every 5 seconds.
- Page lifecycle: `visibilitychange`, `pagehide`, `beforeunload`.
- Last N WebSocket events and patch sizes, without secrets.
- Last N user inputs / ability casts / ground casts at a summary level.
- Renderer metrics: FPS, frame delta spikes, Three object count, geometry count, texture count, draw calls.
- Browser metrics when available: `performance.memory`, long tasks, resource counts, DOM/canvas/image counts.
- Current game summary: gameId, mode, userId, player count, entity count, ground zone count, event count, buff count, active channel, position, camera settings.

Do not record passwords, auth tokens, cookies, full request headers, or `.env` data.

## Crash Session Detection

On in-game mount:

- Generate `clientSessionId`.
- Save `activeSession = { sessionId, startedAt, gameId, userId, buildId }` to durable storage.
- Every heartbeat updates `lastAliveAt` and uploads a compact snapshot to the backend.
- Every few seconds, the frontend log queue uploads a compact batch to `/api/diagnostics/client-frontend-log` so a refresh or hard white-screen does not erase the latest behavior trail.
- On `pagehide`, `beforeunload`, disconnects, WebGL loss, and fatal events, the recorder forces an immediate keepalive/beacon upload attempt.
- On clean leave/unmount, mark `cleanExitAt`.

On next load:

- If a prior active session has no clean exit and `lastAliveAt` is recent, mark it as suspected crash.
- Upload the saved flight-recorder buffer as `reason: suspected-previous-crash`.
- Show an ESC/Test panel entry so the report can be copied or downloaded without DevTools.

## Backend Report Endpoint

Add an authenticated route such as:

- `POST /api/diagnostics/client-crash-report`
- `GET /api/diagnostics/client-crash-report/recent` for admin/debug use later, if needed.

The POST handler should:

- Validate a maximum payload size.
- Redact obvious sensitive keys: token, password, cookie, authorization, jwt, secret.
- Add server timestamp, user id, IP prefix only if needed, user agent, app version/build marker.
- Append JSONL to `/home/ubuntu/zhenchuan/logs/client-crashes/YYYY-MM-DD.jsonl`.
- Return a short report id.

This must not spam logs: heartbeat uploads should be compact and rate-limited; full reports only on crash signals, WebGL loss, fatal errors, or suspected previous crash.

## In-Game Access Outside F12

Add ESC -> 测试 -> 崩溃诊断 with:

- Current session id.
- Last upload status and report id.
- Buttons: `生成诊断报告`, `复制报告`, `下载报告`, `上传报告`.
- A short summary of FPS/memory/Three counts and last fatal event.

This gives a way to get evidence even when F12 cannot be opened.

## Soak Test Plan

After the recorder is deployed:

1. Run a live Playwright soak test against `https://zhenchuan.renstoolbox.com/`.
2. Join/create a collision-test game with the normal test account/session.
3. Keep the match alive for 30-60 minutes.
4. Collect Playwright `pageerror`, `console`, screenshots every minute, trace/video if feasible, and periodic `window.__zhenchuanCrashRecorder?.snapshot()`.
5. Exercise likely leak paths: camera movement, repeated ability casts, ground zones, sounds, exported-map rendering, jump/dash, and reconnect.

## Triage Rules

Use the captured report to classify the failure:

- **Last event is JS error / unhandled rejection**: fix the stack trace root cause and add a regression test.
- **Memory grows steadily**: inspect arrays, event retention, textures, geometries, audio nodes, and React state history.
- **Three texture/geometry/object count grows steadily**: look for missing disposal or unstable React keys remounting 3D objects.
- **WebGL context lost appears before white screen**: reduce GPU memory pressure and add context-loss recovery/fallback UI.
- **Heartbeat stops with no JS error and no clean exit**: likely renderer crash/OOM/GPU crash; use the last metrics trend.
- **All clients lose heartbeat together**: check backend/PM2/network logs for the same timestamp.

## Implementation Order

1. Add frontend recorder with durable IndexedDB/localStorage ring buffer and global error hooks.
2. Add React error boundary around the in-game screen with a non-white fallback and report upload.
3. Add backend crash-report endpoint and file append storage.
4. Add heartbeat snapshots and previous-session suspected-crash upload.
5. Add WebGL context loss and renderer/memory metric sampling.
6. Add ESC/Test diagnostics panel for copy/download/upload.
7. Add live Playwright soak test that reads uploaded report ids and captures screenshots/video.

## First Pass Success Criteria

- A random white-screen or tab crash leaves a report in backend JSONL or IndexedDB on the next load.
- The report includes the last 1-5 minutes of runtime breadcrumbs and metric trends.
- The report can be obtained without F12.
- The overhead is low enough to leave enabled during normal testing.