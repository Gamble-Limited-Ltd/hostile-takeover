import type { UserMeResponse } from "@openfront/shared/ApiSchemas";

/**
 * Hostile Takeover: a signed-in player plays under their account username
 * (users.username, returned by /users/@me as `player.username`). The game
 * server enforces the same name at join (src/server/AccountName.ts), so this
 * is presentation: the name box shows it read-only instead of a free field.
 * Signed-out players keep the anonymous, editable name.
 *
 * Only for accounts without `usernameStatus`: our API leaves it out on purpose
 * (no username changes in v1), while OpenFront's always sends it and keeps its
 * own verified-name flow, so upstream behaviour and tests are untouched.
 */
export function accountPlayName(
  userMe: UserMeResponse | false | null,
): string | null {
  if (userMe === null || userMe === false) return null;
  if (userMe.player.usernameStatus !== undefined) return null;
  const name = userMe.player.username;
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}
