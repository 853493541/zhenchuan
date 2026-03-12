// backend/game/models/GameSession.ts

import mongoose from "mongoose";

const GameSessionSchema = new mongoose.Schema(
  {
    players: { type: [String], required: true },

    // ✅ Use Mixed so nested updates (like state.events push) are always persisted safely
    state: { type: mongoose.Schema.Types.Mixed, required: true },

    // ✅ ADD THESE (nothing else)
    started: { type: Boolean, default: false },
    turn: { type: String, default: null },

    // 👤 Player names/metadata: maps userId -> username (as plain object for JSON serialization)
    playerNames: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("GameSession", GameSessionSchema);
