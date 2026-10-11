import { randomBytes } from "node:crypto";
import type { ApiEnv } from "./env";
import type { Store } from "./store";
import { hashRefreshToken } from "./tokens";

export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

/** The link the sign-in UI reads: the game origin with `#reset=<token>`. */
export function resetLink(env: Pick<ApiEnv, "gameOrigin">, token: string) {
  return `${env.gameOrigin}/#reset=${token}`;
}

/**
 * Creates a one-time reset token for `username` and records the admin action.
 * `actor` is the admin's username, or "cli" for the command line.
 * Returns null when there is no such user.
 */
export async function createPasswordReset(
  store: Store,
  env: Pick<ApiEnv, "gameOrigin">,
  opts: { username: string; actor: string; createdBy: string | null },
): Promise<{ token: string; link: string; expiresAt: Date } | null> {
  const user = await store.findUserByUsername(opts.username);
  if (!user) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await store.createReset({
    userId: user.id,
    tokenHash: hashRefreshToken(token),
    createdBy: opts.createdBy,
    expiresAt,
  });
  await store.logAdmin({
    actor: opts.actor,
    action: "password_reset.create",
    target: user.username,
    detail: { userId: user.id },
  });
  return { token, link: resetLink(env, token), expiresAt };
}
