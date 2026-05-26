#!/usr/bin/env node

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGO_DB_NAME = "zhenchuan_app";

const mongoUri = process.env.MONGO_URI || DEFAULT_MONGO_URI;
const dbName = process.env.MONGO_DB_NAME || DEFAULT_MONGO_DB_NAME;
const command = process.argv[2] || "list";

const isLocalMongoUri = (uri) => /(^|[/:,@])(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(uri);

function assertLocalZhenchuanMongo() {
  if (!isLocalMongoUri(mongoUri)) {
    throw new Error("Remote MongoDB access is disabled for this branch. User maintenance only runs against local zhenchuan_app.");
  }
  if (dbName !== DEFAULT_MONGO_DB_NAME) {
    throw new Error(`Unexpected MongoDB database '${dbName}'. User maintenance only runs against '${DEFAULT_MONGO_DB_NAME}'.`);
  }
}

const retainedExistingUsers = [
  { username: "catcake", displayName: "剑心猫猫糕", school: "七秀", isAdmin: true },
  { username: "guest", displayName: "游客", school: "通用", isAdmin: false },
];

const seededPasswordUsers = [
  { username: "juzi", displayName: "桔貂", school: "霸刀" },
  { username: "suoyi", displayName: "所以", school: "凌雪" },
  { username: "chenglaohei", displayName: "程老黑", school: "纯阳" },
  { username: "lizhizhi", displayName: "鲤枝枝", school: "蓬莱" },
  { username: "achuo", displayName: "阿绰", school: "明教" },
  { username: "yanshen", displayName: "言深", school: "苍云" },
  { username: "testuser1", displayName: "测试账号一", school: "少林", isAdmin: true },
  { username: "testuser2", displayName: "测试账号二", school: "万花", isAdmin: true },
].map((user) => ({
  ...user,
  password: `${user.username}@${user.username}`,
  isAdmin: user.isAdmin === true,
}));

const displayNameByUsername = new Map(
  [...retainedExistingUsers, ...seededPasswordUsers].map((user) => [user.username, user.displayName])
);

const schoolByUsername = new Map(
  [...retainedExistingUsers, ...seededPasswordUsers].map((user) => [user.username, user.school])
);

const legacyTestDisplayNames = new Map([
  ["testuser1", new Set(["一"])],
  ["testuser2", new Set(["二"])],
]);

function shouldRepairDefaultDisplayName(username, displayName) {
  const rawDisplayName = String(displayName ?? "").trim();
  if (!rawDisplayName) return true;
  const compactDisplayName = rawDisplayName.toLowerCase().replace(/\s+/g, "");
  return compactDisplayName === username || legacyTestDisplayNames.get(username)?.has(rawDisplayName) === true;
}

async function syncGameSessionUserMetadata(db) {
  const users = db.collection("users");
  const gamesessions = db.collection("gamesessions");
  const currentUsers = await users.find({}, { projection: { username: 1, displayName: 1, school: 1 } }).toArray();
  const displayNameById = new Map(currentUsers.map((user) => [String(user._id), user.displayName || user.username]));
  const schoolById = new Map(currentUsers.map((user) => [String(user._id), user.school || null]));
  let syncedGames = 0;

  for await (const game of gamesessions.find({})) {
    const playerNames = { ...(game.playerNames || {}) };
    const playerSchools = { ...(game.playerSchools || {}) };
    let changed = false;

    for (const userId of game.players || []) {
      const id = String(userId);
      const displayName = displayNameById.get(id);
      const school = schoolById.get(id);
      if (displayName && playerNames[id] !== displayName) {
        playerNames[id] = displayName;
        changed = true;
      }
      if (school && playerSchools[id] !== school) {
        playerSchools[id] = school;
        changed = true;
      }
    }

    if (changed) {
      await gamesessions.updateOne({ _id: game._id }, { $set: { playerNames, playerSchools } });
      syncedGames += 1;
    }
  }

  return syncedGames;
}

async function syncDefaultSchools(db) {
  const users = db.collection("users");
  const now = new Date();
  let matchedUsers = 0;
  let modifiedUsers = 0;

  for (const [username, school] of schoolByUsername.entries()) {
    const existing = await users.findOne({ username }, { projection: { displayName: 1 } });
    const set = { school, updatedAt: now };
    const defaultDisplayName = displayNameByUsername.get(username);
    if (existing && defaultDisplayName && shouldRepairDefaultDisplayName(username, existing.displayName)) {
      set.displayName = defaultDisplayName;
    }
    const result = await users.updateOne(
      { username },
      { $set: set }
    );
    matchedUsers += result.matchedCount;
    modifiedUsers += result.modifiedCount;
  }

  const syncedGames = await syncGameSessionUserMetadata(db);
  console.log(JSON.stringify({ ok: true, matchedUsers, modifiedUsers, syncedGameSessions: syncedGames }, null, 2));
}

async function resetLocalUsers(db) {
  const users = db.collection("users");
  const gamesessions = db.collection("gamesessions");
  const now = new Date();

  const retainedUsernames = retainedExistingUsers.map((user) => user.username);
  const deleted = await users.deleteMany({ username: { $nin: retainedUsernames } });

  for (const user of retainedExistingUsers) {
    const existing = await users.findOne({ username: user.username });
    if (!existing) {
      throw new Error(`Required retained account '${user.username}' was not found. Create it before resetting local users.`);
    }

    await users.updateOne(
      { username: user.username },
      {
        $set: {
          displayName: user.displayName,
          school: user.school,
          isAdmin: user.isAdmin,
          updatedAt: now,
        },
      }
    );
  }

  for (const user of seededPasswordUsers) {
    const passwordHash = await bcrypt.hash(user.password, 12);
    await users.insertOne({
      username: user.username,
      displayName: user.displayName,
      school: user.school,
      passwordHash,
      tokenVersion: 0,
      isAdmin: user.isAdmin,
      battleArenaUiLayout: null,
      battleArenaMartialPresets: [],
      battleArenaMartialFavoriteOrder: [],
      lastSeenAt: null,
      lastSeenIp: null,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
  }

  await users.createIndex({ username: 1 }, { unique: true, name: "username_1" });
  await users.createIndex({ displayName: 1 }, { unique: true, name: "displayName_1" });

  const syncedGames = await syncGameSessionUserMetadata(db);

  console.log(JSON.stringify({
    ok: true,
    deletedUsers: deleted.deletedCount,
    retainedUsers: retainedUsernames,
    seededUsers: seededPasswordUsers.map((user) => user.username),
    syncedGameSessions: syncedGames,
  }, null, 2));
}

async function listUsers(db) {
  const users = await db.collection("users")
    .find({}, { projection: { username: 1, displayName: 1, school: 1, isAdmin: 1, lastSeenAt: 1, lastSeenIp: 1 } })
    .sort({ username: 1 })
    .toArray();

  console.table(users.map((user) => ({
    username: user.username,
    displayName: user.displayName || displayNameByUsername.get(user.username) || user.username,
    school: user.school || schoolByUsername.get(user.username) || "-",
    admin: user.isAdmin === true ? "yes" : "no",
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : "never",
    lastSeenIp: user.lastSeenIp || "-",
  })));
}

async function main() {
  assertLocalZhenchuanMongo();

  await mongoose.connect(mongoUri, {
    dbName,
    serverSelectionTimeoutMS: 5000,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection did not expose a db handle.");

  if (command === "reset-local-users") await resetLocalUsers(db);
  else if (command === "sync-default-schools") await syncDefaultSchools(db);
  else if (command === "list") await listUsers(db);
  else throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });