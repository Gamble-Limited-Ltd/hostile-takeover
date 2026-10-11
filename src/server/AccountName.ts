import { getUserMe } from "./jwt";

/**
 * Hostile Takeover: a signed-in player always plays under their account
 * username, whatever name the client sent, and wears no clan tag (clans are
 * hidden in v1). Returns the username to force for this token, or null for a
 * signed-out join or when /users/@me can't be read (the join's own
 * /users/@me lookup then fails the join as before).
 */
export async function forcedAccountUsername(
  token: string,
  signedIn: boolean,
): Promise<string | null> {
  if (!signedIn) return null;
  const result = await getUserMe(token);
  if (result.type === "error") return null;
  const player = result.response.player;
  // Same rule as src/client/AccountName.ts: our API omits usernameStatus.
  if (player.usernameStatus !== undefined) return null;
  const name = player.username;
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}
