import { HALL_LEGAL } from "@openfront/shared/Legal";
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";
import { fetchAuthConfig } from "./GateAuthApi";

// Legal v2 dark launch. /auth/config carries `legalVersion` only while the API
// has LEGAL_VERSION set; without it every caller keeps today's pages and links.
let on: Promise<boolean> | null = null;

export function legalV2On(): Promise<boolean> {
  on ??= fetchAuthConfig().then((c) => !!c.legalVersion);
  return on;
}

export function resetLegalV2ForTests(): void {
  on = null;
}

export const hallDoc = (doc: "terms" | "privacy"): string =>
  `${HALL_LEGAL}/${doc}`;

/** POST /users/@me/legal: the API records its own current version for this account. */
export async function acceptLegal(): Promise<boolean> {
  const authorization = await getAuthHeader();
  if (!authorization) return false;
  try {
    const r = await fetch(`${getApiBase()}/users/@me/legal`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: authorization },
    });
    return r.ok;
  } catch {
    return false;
  }
}
