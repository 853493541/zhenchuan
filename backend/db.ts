import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI as string;

export const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: "baizhan_V2",   // 👈 force database
      maxPoolSize: 50,        // Allow more concurrent connections
      minPoolSize: 5,         // Keep min connections open
      socketTimeoutMS: 45000, // 45s timeout for queries
      serverSelectionTimeoutMS: 5000,
    });

    console.log("Connected DB name:", mongoose.connection.db?.databaseName);
    console.log("✅ MongoDB connected to baizhan_V2 (pool: 5-50 connections)");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};
