import type { UserRow } from "./userMe";

/** Thrown when a banned account tries to get a session; the app answers 403. */
export class AccountBannedError extends Error {}

/** Number() covers a Date, pg's Infinity and a far-future date alike. */
export function isBanned(u: Pick<UserRow, "banned_until">, now = Date.now()) {
  return !!u.banned_until && Number(u.banned_until) > now;
}
