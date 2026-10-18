import type { UserMeResponse } from "@openfront/shared/ApiSchemas";

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
}

/**
 * The /users/@me body. The game server and client both run it through
 * UserMeResponseSchema.parse; one bad field makes the player look signed out.
 * Optional fields are left out. usernameStatus is left out on purpose: its
 * presence turns on the custom-username UI, which Stage 2 decides on.
 */
export function buildUserMe(row: UserRow): UserMeResponse {
  return {
    user: { email: row.email },
    player: {
      publicId: row.public_id,
      adfree: true,
      unlimitedRanked: false,
      canCreatePublicLobbies: true,
      trustTier: "trusted",
      username: row.username,
      usernameBase: row.username,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
    },
  };
}
