import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";

// Profile flag (U2.7): the signed-in player's flag pick lives on the account
// too (packages/api/src/flagRoutes.ts). Local settings stay the source the
// game reads; the account value is copied into them on load.

async function request(method: "GET" | "PUT", flag?: string | null) {
  const authorization = await getAuthHeader();
  if (!authorization) return null;
  const response = await fetch(`${getApiBase()}/users/@me/flag`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: method === "PUT" ? JSON.stringify({ flag }) : undefined,
  });
  return response.ok
    ? ((await response.json()) as { flag: string | null })
    : null;
}

/** Fire and forget: saves a flag pick (null clears) when signed in. */
export function saveAccountFlag(flag: string | null): void {
  request("PUT", flag === "country:xx" ? null : flag).catch(() => {});
}

let synced = false;

interface FlagStore {
  getFlag(): string | null;
  setFlag(flag: string): void;
}

/**
 * Signed in: the account flag wins over the local one. An account with no
 * flag yet adopts the local pick instead of erasing it.
 */
export async function syncAccountFlag(settings: FlagStore): Promise<void> {
  // Once per page load: a later refresh must not undo a pick still in flight.
  if (synced) return;
  try {
    const account = await request("GET");
    if (!account) return;
    synced = true;
    if (account.flag) {
      if (account.flag !== settings.getFlag()) settings.setFlag(account.flag);
    } else {
      const local = settings.getFlag();
      if (local) saveAccountFlag(local);
    }
  } catch {
    // Offline or signed out: keep the local flag.
  }
}
