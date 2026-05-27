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

    // 🏷️ Player selected 门派: maps userId -> school
    playerSchools: { type: mongoose.Schema.Types.Mixed, default: {} },

    // 💬 Bounded in-game chat history for current session search/refetch
    chatMessages: { type: mongoose.Schema.Types.Mixed, default: [] },

    // 🔄 Auto-start when room is full
    autoStart: { type: Boolean, default: true },

    // 🎮 Game mode: 'arena' | 'pubg' | 'collision-test' | 'yumen-1v1-basic'
    mode: { type: String, enum: ['arena', 'pubg', 'collision-test', 'yumen-1v1-basic'], default: 'yumen-1v1-basic' },

    // 🎮 Tournament/Draft/Economy state (persists across battles)
    tournament: { type: mongoose.Schema.Types.Mixed, default: null },

    // 📋 Track which players are ready to start battle (userId -> true)
    draftReady: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("GameSession", GameSessionSchema);
