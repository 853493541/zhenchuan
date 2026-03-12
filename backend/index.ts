import dotenv from "dotenv";
dotenv.config();

console.log("🔧 Loading app...");
import app from "./app";
import { createServer } from "http";
import { setupWebSocket } from "./websocket";

console.log("📡 App imported successfully!");
console.log("🎯 App object:", typeof app);

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = createServer(app);

// Setup WebSocket on the same server
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("📡 Express + WebSocket listening for connections");
});
