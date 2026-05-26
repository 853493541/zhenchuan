import mongoose, { Schema, Document, Model } from "mongoose";

export const USER_SCHOOLS = [
  "少林", "万花", "天策", "纯阳", "七秀", "藏剑", "五毒", "唐门",
  "丐帮", "明教", "苍云", "长歌", "霸刀", "蓬莱", "凌雪", "衍天",
  "药宗", "刀宗", "万灵", "段氏", "通用",
] as const;

export type UserSchool = (typeof USER_SCHOOLS)[number];

type BattleArenaUiPosition = {
  left: number;
  top: number;
};

type BattleArenaUiViewport = {
  w: number;
  h: number;
};

type BattleArenaChatLayout = {
  panelSize?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  settingsModalSize?: Record<string, unknown> | null;
  windows?: unknown[] | null;
  activeWindowId?: string | null;
  detachedWindows?: unknown[] | null;
  detachedPanelSizes?: Record<string, unknown> | null;
};

export type BattleArenaUiLayout = {
  positions: Record<string, BattleArenaUiPosition>;
  viewport?: BattleArenaUiViewport | null;
  chat?: BattleArenaChatLayout | null;
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
  school?: UserSchool | null;
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

const SEEDED_TEST_DISPLAY_NAMES: Record<string, string> = {
  testuser1: "测试账号一",
  testuser2: "测试账号二",
};

const LEGACY_TEST_DISPLAY_NAMES: Record<string, Set<string>> = {
  testuser1: new Set(["一"]),
  testuser2: new Set(["二"]),
};

export function getSeededTestDisplayName(username: unknown): string | null {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  return SEEDED_TEST_DISPLAY_NAMES[normalizedUsername] ?? null;
}

export function normalizeStoredUserDisplayName(username: unknown, displayName: unknown): string {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  const rawDisplayName = String(displayName ?? "").trim();
  const seededDisplayName = SEEDED_TEST_DISPLAY_NAMES[normalizedUsername];
  if (seededDisplayName) {
    const compactDisplayName = rawDisplayName.toLowerCase().replace(/\s+/g, "");
    if (!rawDisplayName || compactDisplayName === normalizedUsername || LEGACY_TEST_DISPLAY_NAMES[normalizedUsername]?.has(rawDisplayName)) {
      return seededDisplayName;
    }
  }
  return rawDisplayName || normalizedUsername;
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

    school: {
      type: String,
      enum: USER_SCHOOLS,
      default: null,
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
  this.displayName = normalizeStoredUserDisplayName(this.username, this.displayName);
  if (this.school && !(USER_SCHOOLS as readonly string[]).includes(this.school)) {
    this.school = null;
  }
  next();
});

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
