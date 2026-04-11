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

    // 🔄 Auto-start when room is full
    autoStart: { type: Boolean, default: true },

    // 🎮 Game mode: 'arena' (100×100 map, 1v1 focused) | 'pubg' (2000×2000 map)
    mode: { type: String, enum: ['arena', 'pubg'], default: 'arena' },

    // 🌍 Optional imported map package (used by PUBG mode)
    exportPackageName: { type: String, default: null },

    // 🎮 Tournament/Draft/Economy state (persists across battles)
    tournament: { type: mongoose.Schema.Types.Mixed, default: null },

    // 📋 Track which players are ready to start battle (userId -> true)
    draftReady: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("GameSession", GameSessionSchema);
