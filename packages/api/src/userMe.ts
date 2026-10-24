import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { toProgress, type ProgressState } from "./xp/rules";

export interface UserRow {
  id: string;
  public_id: string;
  username: string;
  /** NULL for accounts created through GLL ID. */
  first_name: string | null;
  last_name: string | null;
  email: string;
  rank: string;
  disabled_at: Date | null;
  /** The linked GLL ID (GATE) subject, if any. */
  gate_sub?: string | null;
  /** Last self-service rename; null if never. */
  username_changed_at?: Date | null;
}

/**
 * The /users/@me body. The game server and client both run it through
 * UserMeResponseSchema.parse; one bad field makes the player look signed out.
 * Optional fields are left out. usernameStatus is left out on purpose: its
 * presence would unlock the free in-game name box and stop the game server
 * forcing the account name; the username panel works without it.
 */
export function buildUserMe(
  row: UserRow,
  progress: ProgressState = {
    prestige: 0,
    level: 1,
    xpInLevel: 0,
    lifetimeXp: 0,
  },
): UserMeResponse {
  return {
    user: { email: row.email },
    steamLicence: false,
    steamLicenceSince: null,
    noticesSeen: [],
    player: {
      publicId: row.public_id,
      adfree: true,
      unlimitedRanked: false,
      canCreatePublicLobbies: true,
      trustTier: "trusted",
      username: row.username,
      usernameBase: row.username,
      nextUsernameChangeAt: row.username_changed_at
        ? new Date(
            row.username_changed_at.getTime() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
      progress: toProgress(progress),
    },
  };
}
