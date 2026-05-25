# Zhenchuan Database Migration Report

Date: 2026-05-25

## Executive Answer

- Before the local-DB change, this app connected to MongoDB through `MONGO_URI`, and the backend forcibly used database `baizhan_V2`.
- In the current Zhenchuan codebase, only two MongoDB collections are actively used by the app: `users` and `gamesessions`.
- Those are the collections that should be migrated out of the shared baizhan-app database.
- The other collections currently present in `baizhan_V2` are not referenced by the current Zhenchuan workspace code and should not be treated as Zhenchuan runtime dependencies unless another repo or external job still uses them.
- The earlier no-database idea is dropped. The practical direction is a Zhenchuan-owned local MongoDB database, with portable snapshots of the app-owned collections tracked in git.

## What The App Is Connected To Right Now

Code path:

- `backend/db.ts` reads `MONGO_URI` from the environment, defaulting to `mongodb://127.0.0.1:27017`.
- `backend/db.ts` reads `MONGO_DB_NAME` from the environment, defaulting to `zhenchuan_app`.
- `backend/app.ts` calls `connectDB()` during startup.
- `backend/db.ts` exits the backend process if MongoDB is unavailable.
- Local empty databases can seed from tracked Extended JSON snapshots in `data/mongo/zhenchuan-app`.

Pre-migration runtime check:

- The configured endpoint is a `mongodb+srv` host on MongoDB Atlas.
- The active host resolves to `cluster0.sedw7v9.mongodb.net`.
- The database name is not taken from the URI path at runtime because the code hard-forces `baizhan_V2`.

Original conclusion:

- Zhenchuan is not merely using a shared Mongo server.
- Zhenchuan was using the shared baizhan database name directly before the local-DB switch.

New target:

- Local MongoDB server on `127.0.0.1:27017`.
- App-owned database name `zhenchuan_app`.
- Git-tracked portable snapshots for `users` and `gamesessions` only.
- Current PM2 backend startup has been verified against `zhenchuan_app`.

## Live `baizhan_V2` Collection Inventory

The live shared database contained the following collections during audit. Counts can move over time; the important result is which collections the current Zhenchuan code references.

| Collection | Count | Used by current Zhenchuan code? | Migration status for Zhenchuan |
| --- | ---: | --- | --- |
| `users` | 38 | Yes | Migrate |
| `gamesessions` | 3 | Yes | Migrate |
| `abilities` | 152 | No source references found | Do not migrate for Zhenchuan runtime |
| `abilityhistories` | 3461 | No source references found | Do not migrate for Zhenchuan runtime |
| `bossplans` | 13 | No source references found | Do not migrate for Zhenchuan runtime |
| `characters` | 42 | No source references found | Do not migrate for Zhenchuan runtime |
| `standardschedules` | 53 | No source references found | Do not migrate for Zhenchuan runtime |
| `systemjobs` | 1 | No source references found | Do not migrate for Zhenchuan runtime |
| `targetedplans` | 11 | No source references found | Do not migrate for Zhenchuan runtime |
| `weeklymaps` | 38 | No source references found | Do not migrate for Zhenchuan runtime |

Size check on 2026-05-25:

| Collection | Count | Logical size | Average document |
| --- | ---: | ---: | ---: |
| `users` | 38 | 20,492 bytes | 539 bytes |
| `gamesessions` | 3 | 20,785 bytes | 6,928 bytes |

Even doubling the expected future usage to around 20 accounts and 10 concurrent sessions, the logical data remains small. MongoDB itself has storage/index minimums, but the git-tracked Extended JSON snapshot is expected to stay tiny for this app unless sessions accumulate indefinitely.

Important clarification:

- The word `abilities` appears heavily in the codebase, but Zhenchuan gameplay abilities come from source files and local JSON override files, not from the MongoDB `abilities` collection.
- No current Zhenchuan backend `.ts` or `.js` source files reference `weeklymaps`, `systemjobs`, `targetedplans`, `abilities`, `abilityhistories`, `characters`, `standardschedules`, or `bossplans` as Mongo collections.
- That means these extra collections look like shared baizhan-app data, older data, or data used by some other service, not current Zhenchuan runtime dependencies.

## What Zhenchuan Actually Uses In MongoDB

### 1. `users`

This is the account and per-account gameplay preference store.

Current code usage:

- Login reads user by `username`.
- Auth middleware reloads user by `_id` to validate `tokenVersion`.
- `/api/auth/me` updates `lastSeenAt` and `lastSeenIp`.
- Bootstrap creates the first user.
- Password change updates `passwordHash` and increments `tokenVersion`.
- Gameplay UI settings read and write `battleArenaUiLayout`.
- Martial preset plans read and write `battleArenaMartialPresets`.
- Lobby creation looks up the player's `username` for `playerNames`.

Live top-level fields observed in this collection:

- `username`
- `passwordHash`
- `tokenVersion`
- `battleArenaUiLayout`
- `battleArenaMartialPresets`
- `battleArenaMartialFavoriteOrder`
- `lastSeenAt`
- `lastSeenIp`
- `createdAt`
- `updatedAt`

Important note about `battleArenaMartialFavoriteOrder`:

- This field exists in live `users` documents.
- The current backend code does not reference it.
- The current frontend stores martial favorites in browser localStorage under an account-scoped key.
- Treat this field as legacy Zhenchuan app data: export it once during migration, then decide whether to keep or discard it after verifying no older client still expects it.

Indexes observed:

- `_id`
- unique index on `username`

Migration decision:

- `users` must be migrated.
- If this collection stays in the shared baizhan database, account ownership and per-account gameplay preferences remain coupled to baizhan-app data.

### 2. `gamesessions`

This is the lobby, draft, match, and reconnect persistence store.

Current code usage:

- Create game room.
- Join waiting room.
- Toggle auto-start.
- List waiting rooms and delete stale waiting rooms.
- Draft shop, select, move, sell, refresh, lock, finalize.
- Battle start and battle completion.
- Gameplay state persistence for play, pass, buff cancel, target selection, leave/end, pickups, and cheat/test flows.
- Snapshot and diff polling.
- GameLoop background save.
- WebSocket presence broadcasts and empty-room disband.
- Battle loop hydration after reconnect or route polling.
- Diagnostics session enrichment.

Live top-level fields observed in this collection:

- `players`
- `playerNames`
- `started`
- `autoStart`
- `mode`
- `turn`
- `state`
- `tournament`
- `createdAt`
- `updatedAt`

Fields defined in code that should still be considered part of the migration surface even if not present in every live document:

- `draftReady`

Live top-level keys observed inside `state`:

- `version`
- `turn`
- `activePlayerIndex`
- `gameOver`
- `players`
- `events`
- `pickups`
- `leaveNotice`
- `endedByUserId`
- `unitScale`

Live top-level keys observed inside `tournament`:

- `phase`
- `battleNumber`
- `battleHistory`
- `economy`
- `shop`
- `bench`
- `selectedAbilities`
- `gameHp`

Indexes observed:

- `_id`

Migration decision:

- `gamesessions` must be migrated.
- This collection is the main runtime persistence layer for Zhenchuan matches.
- If it stays in the shared baizhan database, Zhenchuan battle state remains coupled to baizhan-app infrastructure and namespace.

## What Zhenchuan Does Not Need From MongoDB

These are already local or non-Mongo persistence paths and do not need to be migrated out of `baizhan_V2`:

### Ability and buff editor overrides

- `backend/game/abilities/ability-property-overrides.json`
- `backend/game/abilities/buff-attribute-overrides.json`

These are file-backed and already local to the repo / VM.

### Diagnostics and latency logs

- `logs/client-crashes/*.jsonl`
- `logs/frontend/*.jsonl`
- `logs/latency/*.jsonl`
- `logs/latency/starred-games.json`

These are file-backed and already local.

### Martial favorite ordering

- Current source usage is browser localStorage, not MongoDB.
- The live `battleArenaMartialFavoriteOrder` field in `users` appears to be leftover app data rather than an active dependency.

## Direct Answer To The Original Questions

### Where do we get accounts from?

- Before migration: MongoDB collection `users` in database `baizhan_V2`.
- After migration: MongoDB collection `users` in local database `zhenchuan_app`.
- Login reads by username.
- Auth middleware reads by user id.
- Password and profile-like gameplay settings are stored back into the same collection.

### Where do we store game sessions?

- Before migration: MongoDB collection `gamesessions` in database `baizhan_V2`.
- After migration: MongoDB collection `gamesessions` in local database `zhenchuan_app`.
- This includes waiting rooms, draft state, battle state, reconnect state, and periodic loop saves.

### Where else do we use the database?

- Accounts and auth session validation: `users`
- UI layout and martial preset persistence: `users`
- Lobby player-name lookup: `users`
- Waiting rooms, draft, battle progression, live state persistence, reconnect hydration, and websocket cleanup: `gamesessions`
- Diagnostics summary enrichment by game id: `gamesessions`

### Which things should be migrated out from baizhan-app's database?

- Migrate `users`
- Migrate `gamesessions`
- Do not treat the other `baizhan_V2` collections as current Zhenchuan requirements unless another repo or external process proves otherwise

## Recommended Direction: Local Or App-Dedicated MongoDB

The no-database option is no longer recommended.

Best options, in order:

1. Local MongoDB on the Zhenchuan app VM, bound to localhost.
2. Dedicated MongoDB database name for Zhenchuan on a shared Mongo server or shared Atlas cluster.
3. Dedicated MongoDB cluster for Zhenchuan.

Git tracking decision:

- Do not track MongoDB's raw live database directory. It contains binary WiredTiger files, locks, and journals that are not git-friendly or portable.
- Track portable Extended JSON snapshots instead: `data/mongo/zhenchuan-app/users.ejson` and `data/mongo/zhenchuan-app/gamesessions.ejson`.
- Import those snapshots into local MongoDB with `npm run db:import`.
- Export current local state back to git-trackable snapshots with `npm run db:export`.
- Treat `users.ejson` as sensitive because it contains password hashes.

Why MongoDB remains the right choice:

- Current backend code is already built around Mongoose.
- `gamesessions.state` and `gamesessions.tournament` are large nested documents stored as `Mixed` values.
- The runtime depends on document-style reads, full nested state writes, and reconnect hydration from MongoDB.
- Switching to SQLite or another relational store would require a real persistence refactor, not a configuration-only move.

## What Needs To Be Migrated Into The Local / Dedicated DB

### Required collections

- `users`
- `gamesessions`

### Required indexes

- `users.username` unique index
- default `_id` indexes

### Data that should be exported and restored

For `users`:

- all current user documents
- especially `username`, `passwordHash`, `tokenVersion`, `battleArenaUiLayout`, `battleArenaMartialPresets`, timestamps, and any legacy user-owned gameplay fields that still exist in live docs

For `gamesessions`:

- all current game session documents
- especially `players`, `playerNames`, `started`, `autoStart`, `mode`, `turn`, `state`, `tournament`, timestamps, and `draftReady` when present

### Things that do not need Mongo migration work

- ability override JSON files
- buff override JSON files
- diagnostics / latency log files
- localStorage-only UI data
- unrelated collections in `baizhan_V2`

## Minimal Code / Config Changes Needed

The local MongoDB migration work is now mostly operational upkeep plus snapshot discipline:

1. Keep `backend/db.ts` using `MONGO_DB_NAME` instead of hardcoded `baizhan_V2`.
2. Keep `MONGO_URI` pointed at the local MongoDB target.
3. Import tracked snapshots into local MongoDB after new server setup.
4. Restart the backend against the local DB.
5. Verify login, `/api/auth/me`, UI layout save/load, preset save/load, create game, join game, battle start, websocket reconnect, and snapshot load.

If the target is local MongoDB on the same VM:

- Bind MongoDB to `127.0.0.1` unless remote access is explicitly needed.
- Keep backups because `users` and `gamesessions` are now fully Zhenchuan-owned state.
- Ensure enough RAM and disk headroom for MongoDB plus Node plus PM2.

## Practical Cutover Plan

1. Create or start local MongoDB bound to `127.0.0.1`.
2. Import the existing tracked snapshots into `zhenchuan_app` if the local DB is empty.
3. Recreate or verify the `users.username` unique index.
4. Keep Zhenchuan backend config at `MONGO_URI=mongodb://127.0.0.1:27017` and `MONGO_DB_NAME=zhenchuan_app`.
5. Build and restart the app.
6. Verify auth, presets, lobby, battle start, reconnect, and websocket behavior.

This branch now refuses remote MongoDB URIs and non-`zhenchuan_app` database names at app startup and in snapshot scripts, so historical online-export commands should not be run from this branch.

The key point is to dump and restore only the two Zhenchuan-owned collections, not the entire shared baizhan database.

## Final Recommendation

Zhenchuan should be isolated from baizhan-app at the database level by moving off the shared `baizhan_V2` database.

Concrete recommendation:

- Keep MongoDB.
- Migrate `users` and `gamesessions` only.
- Do not migrate the unrelated `baizhan_V2` collections for Zhenchuan.
- Use configurable `MONGO_DB_NAME=zhenchuan_app`.
- Prefer a local MongoDB instance on the app VM, with tracked Extended JSON snapshots for portable persistence.