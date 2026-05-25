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
  { username: "catcake", displayName: "猫猫糕", isAdmin: true },
  { username: "guest", displayName: "游客", isAdmin: false },
];

const seededPasswordUsers = [
  { username: "juzi", displayName: "桔貂" },
  { username: "suoyi", displayName: "所以" },
  { username: "chenglaohei", displayName: "程老黑" },
  { username: "lizhizhi", displayName: "鲤枝枝" },
  { username: "achuo", displayName: "阿绰" },
  { username: "yanshen", displayName: "言深" },
  { username: "testuser1", displayName: "一", isAdmin: true },
  { username: "testuser2", displayName: "二", isAdmin: true },
].map((user) => ({
  ...user,
  password: `${user.username}@${user.username}`,
  isAdmin: user.isAdmin === true,
}));

const displayNameByUsername = new Map(
  [...retainedExistingUsers, ...seededPasswordUsers].map((user) => [user.username, user.displayName])
);

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

  const currentUsers = await users.find({}, { projection: { username: 1, displayName: 1 } }).toArray();
  const displayNameById = new Map(currentUsers.map((user) => [String(user._id), user.displayName || user.username]));
  let syncedGames = 0;

  for await (const game of gamesessions.find({})) {
    const playerNames = { ...(game.playerNames || {}) };
    let changed = false;

    for (const userId of game.players || []) {
      const displayName = displayNameById.get(String(userId));
      if (displayName && playerNames[String(userId)] !== displayName) {
        playerNames[String(userId)] = displayName;
        changed = true;
      }
    }

    if (changed) {
      await gamesessions.updateOne({ _id: game._id }, { $set: { playerNames } });
      syncedGames += 1;
    }
  }

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
    .find({}, { projection: { username: 1, displayName: 1, isAdmin: 1, lastSeenAt: 1, lastSeenIp: 1 } })
    .sort({ username: 1 })
    .toArray();

  console.table(users.map((user) => ({
    username: user.username,
    displayName: user.displayName || displayNameByUsername.get(user.username) || user.username,
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