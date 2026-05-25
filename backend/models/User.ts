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
  displayName?: string;
  passwordHash: string;
  tokenVersion: number;
  isAdmin?: boolean;
  battleArenaUiLayout?: BattleArenaUiLayout | null;
  battleArenaMartialPresets?: BattleArenaMartialPreset[] | null;
  battleArenaMartialFavoriteOrder?: string[] | null;

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

    displayName: {
      type: String,
      required: true,
      default: function (this: IUser) {
        return this.username;
      },
      trim: true,
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

    isAdmin: {
      type: Boolean,
      required: true,
      default: false,
    },

    battleArenaUiLayout: {
      type: Schema.Types.Mixed,
      default: null,
    },

    battleArenaMartialPresets: {
      type: Schema.Types.Mixed,
      default: [],
    },

    battleArenaMartialFavoriteOrder: {
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
  if (!this.displayName || !this.displayName.trim()) {
    this.displayName = this.username;
  } else {
    this.displayName = this.displayName.trim();
  }
  next();
});

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
