// The password-reset link is `<game origin>/#reset=<token>` (packages/api
// accountRoutes). Main strips it from the URL and parks the token here for the
// account modal to pick up on open, so it never lands in the router's
// `#modal=account&...` hash or in the browser history.

const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;

/** The reset token in a `#reset=<token>` hash, or null if it isn't one. */
export function parseResetHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("reset");
  return token !== null && TOKEN_RE.test(token) ? token : null;
}

let pendingToken: string | null = null;

export function stashResetToken(token: string): void {
  pendingToken = token;
}

/** Returns the parked token once; later calls get null. */
export function takeResetToken(): string | null {
  const token = pendingToken;
  pendingToken = null;
  return token;
}
