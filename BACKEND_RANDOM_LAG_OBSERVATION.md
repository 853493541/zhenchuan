# Backend Random Lag Observation

Scope: observation only. No source code was changed, no PM2 process was restarted, and `EXPERIENCES.md` was not edited.

## User Premise

The lag should be treated as random backend/system stutter, not movement/jump-specific behavior. The useful question is: when the game appears to freeze briefly and then resume, did the backend event loop stop running, did requests sit in a queue before Express handled them, did WebSocket delivery stall, or did the delay happen outside the backend process?

## What I Observed

- The backend PM2 process was online during inspection. Recent PM2 tail did not show a fatal game-loop exception, out-of-memory error, or crash at the moment inspected.
- The backend PM2 logs did show a lot of normal/error console output, including repeated ability debug logs and repeated `ERR_ON_COOLDOWN` stack traces. This can create stdout/stderr pressure during active play.
- Existing backend timing logs are not enough to identify a short freeze. The current `/movement` route reports `serverProcessingMs`, but that timer starts only after Express begins handling the request. If the Node event loop is blocked before the handler starts, this number can still be small.
- Sanitized latency logs for `2026-05-28` show movement POST durations reaching about 1.8-1.9 seconds while `serverProcessingMs` is usually only 1-23ms. That means the slow samples are not explained by measured route body execution time.
- State-diff WebSocket receive lag in the same latency log peaked around 381ms in the inspected samples. Some state-diff `intervalMs` values were much larger, but those had low receive lag and likely indicate no incoming diffs, reconnect/inactivity, tab timing, or game state cadence rather than proof that one backend tick took that long.
- The frontend latency recorder is still active and flushes to `/api/diagnostics/client-latency-batch` every 10 seconds. The backend diagnostics route sanitizes the batch and appends JSONL to disk.
- Current log files are large. Examples from inspection: `logs/latency/2026-05-28.jsonl` was about 28.5MB; current-day frontend/client-crash logs were also multi-MB, and previous days were much larger.
- The WebSocket broadcast path still serializes each broadcast message with `JSON.stringify(message)` and sends synchronously through all subscribers in the same backend process.
- The game loop persists state every 50 versions with an async Mongo update. The call is fire-and-forget, so the loop's existing `saveTime` measurement does not tell us how long Mongo serialization/write actually takes after it is scheduled.
- Several hot paths clone state with `structuredClone`, including loop state access/update paths. Those clones may be cheap most of the time but can become important when state, events, buffs, or ability data grows.

## Current Best Reading

I do not see evidence that movement collision or jump logic is the root cause. The better working theory is short event-loop or process pressure spikes from one or more of these:

1. JSON serialization and WebSocket send bursts.
2. `structuredClone` of growing battle state.
3. Mongo state save serialization/write pressure every 50 versions.
4. Periodic diagnostics uploads and disk append/prune work, especially on the 10-second flush cadence.
5. Console logging and repeated stack traces during active play.
6. Garbage collection from repeated clone/stringify/log allocations.
7. Proxy/network/browser delay that looks like backend lag from the client side.

The movement latency data is especially important: high client duration with low `serverProcessingMs` means the next probe must measure time before the route handler starts, not only time inside the handler.

## Should We Record Down Time?

Yes. The next step should be to record backend down time/tick gaps directly. The goal is not just "request was slow"; the goal is to prove whether the Node event loop stopped responding for 100ms, 300ms, 1000ms, etc., and then correlate that timestamp with what else the backend was doing.

## Recommended Diagnostic Plan

Implement these as temporary, low-volume instrumentation, then remove or gate them after the cause is found.

1. Event-loop delay monitor
   - Use Node's event-loop delay monitoring to record p50/p95/p99/max delay every few seconds.
   - Log only when max delay crosses a threshold, such as 100ms or 250ms.
   - This answers: did the backend process itself pause?

2. Game-loop gap recorder
   - In the 30Hz loop, record actual wall-clock time between callbacks.
   - Log when callback gap exceeds thresholds, for example `>100ms`, `>250ms`, `>500ms`.
   - Include current game id, version, player count, event count, and whether catch-up ticks ran.
   - This answers: did authoritative simulation stop advancing smoothly?

3. Pre-handler request gap recorder
   - Add lightweight middleware near the top of Express that stamps request arrival time as early as possible.
   - In `/movement`, compare early arrival time to handler start/end time.
   - This answers: did the request sit waiting before the movement handler started?

4. Broadcast cost recorder
   - Measure diff payload size, `JSON.stringify` duration, subscriber count, and total `ws.send` loop time.
   - Log only when broadcast exceeds a threshold.
   - This answers: are state updates freezing the process while serializing/sending?

5. Actual DB save duration recorder
   - Time the async Mongo save completion, not just the synchronous scheduling time.
   - Log duration, state size estimate, and version.
   - This answers: do stutters align with the every-50-version save cadence?

6. Clone cost recorder
   - Measure `structuredClone` duration around `getState()`, `updateState()`, and ability play clone/diff areas.
   - Log only slow clones.
   - This answers: is state size causing occasional CPU spikes?

7. Diagnostics upload/write recorder
   - Measure batch size, sample count, sanitize time, append time, and prune time for `/client-latency-batch`.
   - Compare timestamps to the frontend recorder's 10-second flush cadence.
   - This answers the user's hypothesis: did removed/remaining upload code leave a periodic backend stall?

8. Correlation output
   - When a stall threshold is crossed, write one compact structured line with:
     - timestamp
     - process memory
     - event-loop max delay
     - game id/version
     - active subscribers
     - last broadcast duration/bytes
     - last DB save duration
     - last diagnostics batch duration/bytes
     - recent route durations
   - This avoids huge noisy logs and lets us line up backend stalls with frontend `movement`, `state-diff`, and `ping` samples.

## What Would Confirm Each Cause

- Backend event-loop stall: event-loop delay and game-loop callback gap spike at the same timestamp as client movement/state-diff delays.
- Mongo save pressure: stall timestamps repeat close to every 50 versions or overlap with long async save completion.
- Broadcast pressure: stall timestamps overlap with large payloads, many subscribers, or slow stringify/send time.
- Diagnostics upload pressure: stalls repeat near the 10-second latency flush and overlap with slow JSONL append/sanitize/prune.
- Logging pressure: stalls overlap with bursts of stack traces/debug logs.
- Outside-backend delay: client request duration is high, but event-loop delay, game-loop gap, broadcast, DB, and diagnostics timers stay normal.

## Immediate Conclusion

The best next move is to add temporary downtime instrumentation, not to change movement logic. The current evidence already argues against movement/jump being the primary suspect and shows that existing route timing is too late in the request lifecycle to catch a backend event-loop pause.
