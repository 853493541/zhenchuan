import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config({ quiet: true });

const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGO_DB_NAME = "zhenchuan_app";
const APP_COLLECTIONS = ["users", "gamesessions"] as const;

const MONGO_URI = process.env.MONGO_URI || DEFAULT_MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || DEFAULT_MONGO_DB_NAME;
const TRACKED_SNAPSHOT_DIR =
  process.env.MONGO_TRACKED_SNAPSHOT_DIR ||
  path.resolve(process.cwd(), "../data/mongo/zhenchuan-app");

const shouldSeedFromTrackedSnapshot =
  process.env.MONGO_SEED_FROM_TRACKED_SNAPSHOT !== "false";

const isLocalMongoUri = (uri: string) =>
  /(^|[/:,@])(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(uri);

const assertLocalZhenchuanMongo = () => {
  if (!isLocalMongoUri(MONGO_URI)) {
    throw new Error("Remote MongoDB access is disabled for this branch. Use mongodb://127.0.0.1:27017 with the local zhenchuan_app database.");
  }
  if (MONGO_DB_NAME !== DEFAULT_MONGO_DB_NAME) {
    throw new Error(`Unexpected MongoDB database '${MONGO_DB_NAME}'. This branch only uses '${DEFAULT_MONGO_DB_NAME}'.`);
  }
};

const ensureAppIndexes = async () => {
  const db = mongoose.connection.db;
  if (!db) return;

  await db.collection("users").createIndex(
    { username: 1 },
    { unique: true, name: "username_1" }
  );
};

const seedTrackedSnapshotIfEmpty = async () => {
  const db = mongoose.connection.db;
  if (!db || !shouldSeedFromTrackedSnapshot || !isLocalMongoUri(MONGO_URI)) return;

  const counts = await Promise.all(
    APP_COLLECTIONS.map(async (collection) => ({
      collection,
      count: await db.collection(collection).estimatedDocumentCount(),
    }))
  );

  if (counts.some(({ count }) => count > 0)) {
    const summary = counts.map(({ collection, count }) => `${collection}:${count}`).join(", ");
    console.log(`Tracked DB snapshot seed skipped; local collections are not empty (${summary}).`);
    return;
  }

  let loadedAnyCollection = false;

  for (const collection of APP_COLLECTIONS) {
    const snapshotPath = path.join(TRACKED_SNAPSHOT_DIR, `${collection}.ejson`);
    let text: string;

    try {
      text = await fs.readFile(snapshotPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }

    const rawPayload = JSON.parse(text);
    const payload = mongoose.mongo.BSON.EJSON.deserialize(rawPayload, { relaxed: false }) as {
      documents?: unknown[];
    };
    const documents = Array.isArray(payload.documents) ? payload.documents : [];

    if (documents.length === 0) continue;

    await db.collection(collection).insertMany(documents as Record<string, unknown>[]);
    loadedAnyCollection = true;
    console.log(`Loaded ${documents.length} ${collection} documents from tracked DB snapshot.`);
  }

  if (loadedAnyCollection) {
    await ensureAppIndexes();
    console.log(`Tracked DB snapshot seed completed from ${TRACKED_SNAPSHOT_DIR}`);
  } else {
    console.log(`No tracked DB snapshot documents found in ${TRACKED_SNAPSHOT_DIR}`);
  }
};

export const connectDB = async () => {
  try {
    assertLocalZhenchuanMongo();

    await mongoose.connect(MONGO_URI, {
      dbName: MONGO_DB_NAME,
      maxPoolSize: 50,
      minPoolSize: 5,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
    });

    console.log("Connected DB name:", mongoose.connection.db?.databaseName);
    console.log(`✅ MongoDB connected to ${MONGO_DB_NAME} (pool: 5-50 connections)`);
    await seedTrackedSnapshotIfEmpty();
    await ensureAppIndexes();
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};
