#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGO_DB_NAME = "zhenchuan_app";
const DEFAULT_SNAPSHOT_DIR = path.resolve(__dirname, "..", "..", "data", "mongo", "zhenchuan-app");
const APP_COLLECTIONS = ["users", "gamesessions"];
const { EJSON } = mongoose.mongo.BSON;

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }

    const key = value.slice(2);
    if (key === "replace") {
      args.replace = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "status";
const mongoUri = process.env.MONGO_URI || DEFAULT_MONGO_URI;
const dbName = args.db || process.env.MONGO_DB_NAME || DEFAULT_MONGO_DB_NAME;
const snapshotDir = path.resolve(args.dir || process.env.MONGO_TRACKED_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR);

const isLocalMongoUri = (uri) => /(^|[/:,@])(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(uri);

const assertLocalZhenchuanMongo = () => {
  if (!isLocalMongoUri(mongoUri)) {
    throw new Error("Remote MongoDB access is disabled for this branch. Use mongodb://127.0.0.1:27017 with the local zhenchuan_app database.");
  }
  if (dbName !== DEFAULT_MONGO_DB_NAME) {
    throw new Error(`Unexpected MongoDB database '${dbName}'. This branch only uses '${DEFAULT_MONGO_DB_NAME}'.`);
  }
};

const serialize = (value) => `${JSON.stringify(EJSON.serialize(value, { relaxed: false }), null, 2)}\n`;

const readSnapshot = async (collection) => {
  const filePath = path.join(snapshotDir, `${collection}.ejson`);
  const text = await fs.readFile(filePath, "utf8");
  return EJSON.deserialize(JSON.parse(text), { relaxed: false });
};

const writeSnapshot = async (collection, payload) => {
  await fs.mkdir(snapshotDir, { recursive: true });
  const filePath = path.join(snapshotDir, `${collection}.ejson`);
  await fs.writeFile(filePath, serialize(payload), "utf8");
  return filePath;
};

const ensureIndexes = async (db) => {
  await db.collection("users").createIndex(
    { username: 1 },
    { unique: true, name: "username_1" }
  );
  await db.collection("users").createIndex(
    { displayName: 1 },
    { unique: true, name: "displayName_1" }
  );
};

const getCollectionStats = async (db, collection) => {
  const count = await db.collection(collection).estimatedDocumentCount();
  let stats = null;
  try {
    stats = await db.command({ collStats: collection, scale: 1 });
  } catch (_) {
    stats = null;
  }
  return {
    collection,
    count,
    avgObjSize: stats ? stats.avgObjSize || 0 : null,
    sizeBytes: stats ? stats.size || 0 : null,
    storageSizeBytes: stats ? stats.storageSize || 0 : null,
    totalIndexSizeBytes: stats ? stats.totalIndexSize || 0 : null,
  };
};

const exportSnapshot = async (db) => {
  const manifest = {
    exportedAt: new Date(),
    dbName,
    collections: [],
  };

  for (const collection of APP_COLLECTIONS) {
    const documents = await db.collection(collection).find({}).sort({ _id: 1 }).toArray();
    const payload = {
      exportedAt: new Date(),
      dbName,
      collection,
      documentCount: documents.length,
      documents,
    };
    const filePath = await writeSnapshot(collection, payload);
    const stat = await fs.stat(filePath);
    manifest.collections.push({ collection, documentCount: documents.length, file: path.basename(filePath), bytes: stat.size });
    console.log(`Exported ${documents.length} ${collection} documents to ${filePath} (${stat.size} bytes)`);
  }

  const manifestPath = path.join(snapshotDir, "manifest.ejson");
  await fs.writeFile(manifestPath, serialize(manifest), "utf8");
  console.log(`Wrote snapshot manifest to ${manifestPath}`);
};

const importSnapshot = async (db) => {
  for (const collection of APP_COLLECTIONS) {
    const payload = await readSnapshot(collection);
    const documents = Array.isArray(payload.documents) ? payload.documents : [];
    const existingCount = await db.collection(collection).estimatedDocumentCount();

    if (existingCount > 0 && !args.replace) {
      throw new Error(`${collection} already has ${existingCount} documents. Re-run with --replace to overwrite it.`);
    }

    if (args.replace) {
      await db.collection(collection).deleteMany({});
    }

    if (documents.length > 0) {
      await db.collection(collection).insertMany(documents, { ordered: true });
    }

    console.log(`Imported ${documents.length} ${collection} documents into ${dbName}`);
  }

  await ensureIndexes(db);
  console.log("Verified app indexes.");
};

const printStatus = async (db) => {
  const status = [];
  for (const collection of APP_COLLECTIONS) {
    status.push(await getCollectionStats(db, collection));
  }
  console.log(JSON.stringify({ dbName, collections: status }, null, 2));
};

const printHelp = () => {
  console.log(`Usage:
  node scripts/app-db-snapshot.js status [--db DB_NAME] [--dir SNAPSHOT_DIR]
  node scripts/app-db-snapshot.js export [--db DB_NAME] [--dir SNAPSHOT_DIR]
  node scripts/app-db-snapshot.js import [--db DB_NAME] [--dir SNAPSHOT_DIR] [--replace]

Environment:
  MONGO_URI defaults to ${DEFAULT_MONGO_URI}
  MONGO_DB_NAME defaults to ${DEFAULT_MONGO_DB_NAME}
  MONGO_TRACKED_SNAPSHOT_DIR defaults to ${DEFAULT_SNAPSHOT_DIR}

Remote MongoDB URIs and non-${DEFAULT_MONGO_DB_NAME} databases are refused by this branch.
`);
};

const main = async () => {
  if (command === "help" || args.help) {
    printHelp();
    return;
  }

  assertLocalZhenchuanMongo();

  await mongoose.connect(mongoUri, {
    dbName,
    serverSelectionTimeoutMS: 5000,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection did not expose a db handle.");

  if (command === "status") await printStatus(db);
  else if (command === "export") await exportSnapshot(db);
  else if (command === "import") await importSnapshot(db);
  else throw new Error(`Unknown command: ${command}`);
};

main()
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });