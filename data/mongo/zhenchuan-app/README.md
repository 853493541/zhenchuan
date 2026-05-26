# Zhenchuan Tracked Mongo Snapshot

This directory is intentionally git-trackable. It stores portable Extended JSON snapshots of only the two MongoDB collections owned by this app:

- `users.ejson`
- `gamesessions.ejson`

Do not commit MongoDB's live WiredTiger data directory here. Runtime MongoDB files are binary, lock-sensitive, and not portable through git. Commit these snapshot files instead, then import them into a local MongoDB database with:

```bash
npm run db:import
```

Export the current app-owned DB state with:

```bash
npm run db:export
```

For a readable local account view, use:

```bash
npm run db:users
```

For full document browsing, use MongoDB Compass or `mongosh` against `mongodb://127.0.0.1:27017/zhenchuan_app`; the tracked `.ejson` files are portable snapshots, not the best day-to-day viewer.

Local test logins for Playwright/manual checks are available from the login page as `一` and `二`; both are admin accounts in this snapshot.

The topbar account switcher lists only accounts that this browser has already authenticated. Switching between remembered accounts does not ask for the password again, and it is allowed only when the current or remembered sessions include an admin account.

The `users.ejson` snapshot contains password hashes. Keep this repository private and rotate passwords if these files are ever exposed.