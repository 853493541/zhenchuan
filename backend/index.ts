import dotenv from "dotenv";
dotenv.config();

console.log("🔧 Loading app...");
import app from "./app";

console.log("📡 App imported successfully!");
console.log("🎯 App object:", typeof app);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("📡 Server is listening for connections");
});
