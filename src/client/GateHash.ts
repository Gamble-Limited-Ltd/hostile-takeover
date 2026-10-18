// GLL ID sign-in comes back to the game origin as one of:
//   `#gate=ok`            signed in (the startup refresh picks the session up)
//   `#gate=link`          signed in to GLL ID, but not linked to a game account yet
//   `#gate_error=<code>`  the sign-in failed
// Main strips the hash and parks link/error here for the account modal to pick
// up on open, same idea as PasswordResetHash.

export type GateHash = (
  | { kind: "ok" }
  | { kind: "link" }
  | { kind: "error"; code: string }
) & {
  /** `&tab=1`: the sign-in ran in a new tab opened from another HT tab. */
  tab: boolean;
};

const CODE_RE = /^[a-z_]{1,32}$/;

/** What a `#gate=...` / `#gate_error=...` hash says, or null if it isn't one. */
export function parseGateHash(hash: string): GateHash | null {
  if (!hash.startsWith("#")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const gate = params.get("gate");
  const tab = params.get("tab") === "1";
  if (gate === "ok") return { kind: "ok", tab };
  if (gate === "link") return { kind: "link", tab };
  const code = params.get("gate_error");
  if (code !== null && CODE_RE.test(code)) return { kind: "error", code, tab };
  return null;
}

let pendingLink = false;
let pendingError: string | null = null;

export function stashGateLink(): void {
  pendingLink = true;
}

export function stashGateError(code: string): void {
  pendingError = code;
}

/** True once after a `#gate=link` redirect; later calls get false. */
export function takeGateLink(): boolean {
  const link = pendingLink;
  pendingLink = false;
  return link;
}

/** The parked error code once; later calls get null. */
export function takeGateError(): string | null {
  const code = pendingError;
  pendingError = null;
  return code;
}

// The GATE end-session URL from /auth/logout, parked for the account modal.
let gateLogoutUrl: string | null = null;

export function stashGateLogoutUrl(url: string | null): void {
  gateLogoutUrl = url;
}

export function takeGateLogoutUrl(): string | null {
  const url = gateLogoutUrl;
  gateLogoutUrl = null;
  return url;
}
