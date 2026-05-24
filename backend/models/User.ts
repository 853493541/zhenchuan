import mongoose, { Schema, Document, Model } from "mongoose";

type BattleArenaUiPosition = {
  left: number;
  top: number;
};

type BattleArenaUiViewport = {
  w: number;
  h: number;
};

export type BattleArenaUiLayout = {
  positions: Record<string, BattleArenaUiPosition>;
  viewport?: BattleArenaUiViewport | null;
  updatedAt?: Date | null;
};

export type BattleArenaMartialPreset = {
  id: string;
  name: string;
  slots: Array<string | null>;
  updatedAt?: Date | string | null;
};

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  tokenVersion: number;
  battleArenaUiLayout?: BattleArenaUiLayout | null;
  battleArenaMartialPresets?: BattleArenaMartialPreset[] | null;

  lastSeenAt?: Date;
  lastSeenIp?: string;

  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    tokenVersion: {
      type: Number,
      required: true,
      default: 0,
    },

    battleArenaUiLayout: {
      type: Schema.Types.Mixed,
      default: null,
    },

    battleArenaMartialPresets: {
      type: Schema.Types.Mixed,
      default: [],
    },

    // 👀 Presence
    lastSeenAt: {
      type: Date,
      default: null,
    },

    // 🌐 Last known IP (overwritten, not audit)
    lastSeenIp: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Normalize username
UserSchema.pre("save", function (next) {
  if (this.isModified("username")) {
    this.username = this.username.trim().toLowerCase();
  }
  next();
});

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
