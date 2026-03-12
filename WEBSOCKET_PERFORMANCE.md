# WebSocket Sync Performance Metrics

This document explains how to measure and interpret WebSocket synchronization latency in your game.

## How It Works

### The Sync Flow

```
Client                          Server                      Client
─────────────────────────────────────────────────────────────────
  │
  │ 1. Send action (playCard/passTurn)
  ├────────────────────────────────────────►  Process action
  │                                            Save to DB
  │                                            Calculate diff
  │   2. Broadcast diff via WebSocket
  │◄─────────────────────────────────────────  (with timestamp)
  │
  │ 3. Receive message
  │    Calculate RTT = now - timestamp
  │    Apply diff to state
  │
```

### Key Metrics

- **RTT (Round-Trip Time)**: Time from when server processes action to when client receives diff
  - `RTT = clientReceiveTime - serverTimestamp`
  - Includes: network latency + server processing

- **DB Save Time**: Time to save to MongoDB
  - Measured on server

- **Total Server Time**: Complete server-side action processing

## Viewing Metrics

### In Browser Console

When playing a game, watch the browser DevTools console for timing logs:

```
⚡ [Sync] RTT: 23ms (3 patches, v42)    ← Excellent (<50ms)
✅ [Sync] RTT: 67ms (5 patches, v43)    ← Good (<100ms)
⚠️  [Sync] RTT: 142ms (2 patches, v44)  ← Acceptable (<200ms)
❌ [Sync] RTT: 250ms (1 patch, v45)     ← Slow (>200ms)
```

### In Server Logs

Timing information is logged during game actions:

```
[Timing] PlayCard gameId123: DB=15ms, Total=18ms, Patches=3
[Timing] PassTurn gameId456: DB=12ms, Total=16ms, Patches=5
```

## Performance Targets

| Metric | Excellent | Good | Acceptable | Poor |
|--------|-----------|------|-----------|------|
| RTT | <50ms | <100ms | <200ms | >200ms |
| DB Save | <20ms | <50ms | <100ms | >100ms |
| Total Server | <30ms | <100ms | <150ms | >150ms |

## Factors Affecting Performance

1. **Network Latency**
   - Distance to server
   - WiFi vs Ethernet
   - Network congestion

2. **Server Processing**
   - Game state complexity
   - Number of effects to apply
   - DB write speed

3. **State Diff Size**
   - More patches = larger message
   - Larger diff = more bandwidth

## Testing

Run the performance test script:

```bash
# Check server response time for actions
node perf-test.js <gameId> <userId> <token> play_card
node perf-test.js <gameId> <userId> <token> pass_turn
```

Or monitor live in the game UI:
1. Start a game
2. Open DevTools → Console
3. Watch for `[Sync]` messages
4. Record typical RTT values

## Optimization Tips

If RTT is consistently high:

1. **Server-Side**
   - Profile action processing with `/backend/utils/timing.ts`
   - Check MongoDB query performance
   - Consider caching game state

2. **Network**
   - Reduce diff patch count (optimize state diff algorithm)
   - Use gzip compression for WebSocket messages
   - Verify nginx is properly configured

3. **Client-Side**
   - Optimize state diff application (`applyDiff` in useGameState)
   - Profile React re-renders
   - Check for excessive state updates

## Related Files

- **Timing utilities**: [`/backend/utils/timing.ts`](backend/utils/timing.ts)
- **Broadcast**: [`/backend/game/services/broadcast.ts`](backend/game/services/broadcast.ts)
- **Play Service**: [`/backend/game/services/gameplay/playService.ts`](backend/game/services/gameplay/playService.ts)
- **Client Hook**: [`/frontend/app/game/screens/in-game/hooks/useGameState.ts`](frontend/app/game/screens/in-game/hooks/useGameState.ts)
- **Subscription Manager**: [`/backend/websocket/GameSubscriptionManager.ts`](backend/websocket/GameSubscriptionManager.ts)
