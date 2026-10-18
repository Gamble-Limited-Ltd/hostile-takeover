import { getApiBase } from "./ApiBase";

// Client for the GLL ID (GATE) sign-in routes in packages/api. Every call
// resolves (never throws) with the API's stable error code.

export interface AuthConfig {
  gate: boolean;
  legacy: boolean;
  /** GLL ID's public address ("" when off); the direct form links its Terms and Privacy. */
  gateUrl: string;
}

export interface GatePending {
  loginName: string;
  displayName: string;
  email: string | null;
  match: { username: string } | null;
  canCreate: boolean;
  usernameTaken: boolean;
}

export type GatePendingResult =
  | { ok: true; pending: GatePending }
  | { ok: false; status: number; code: string };

export type GateResult =
  | { ok: true }
  | { ok: false; status: number; code: string };

// What the client assumes when /auth/config can't be read: today's behaviour.
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  gate: false,
  legacy: true,
  gateUrl: "",
};

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const response = await fetch(`${getApiBase()}/auth/config`, {
      credentials: "include",
    });
    if (!response.ok) return DEFAULT_AUTH_CONFIG;
    const body = (await response.json()) as Partial<AuthConfig> | null;
    if (typeof body?.gate !== "boolean" || typeof body?.legacy !== "boolean") {
      return DEFAULT_AUTH_CONFIG;
    }
    return {
      gate: body.gate,
      legacy: body.legacy,
      gateUrl: typeof body.gateUrl === "string" ? body.gateUrl : "",
    };
  } catch {
    return DEFAULT_AUTH_CONFIG;
  }
}

export function gateStartUrl(): string {
  return `${getApiBase()}/auth/gate/start`;
}

async function codeOf(response: Response): Promise<string> {
  const parsed = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (typeof parsed?.error === "string") return parsed.error;
  return response.status === 429 ? "rate_limited" : "unknown";
}

export async function fetchGatePending(): Promise<GatePendingResult> {
  try {
    const response = await fetch(`${getApiBase()}/auth/gate/pending`, {
      credentials: "include",
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: await codeOf(response),
      };
    }
    return { ok: true, pending: (await response.json()) as GatePending };
  } catch (e) {
    console.warn("/auth/gate/pending request failed", e);
    return { ok: false, status: 0, code: "network" };
  }
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<GateResult> {
  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    return {
      ok: false,
      status: response.status,
      code: await codeOf(response),
    };
  } catch (e) {
    console.warn(`${path} request failed`, e);
    return { ok: false, status: 0, code: "network" };
  }
}

export function confirmGateLink(): Promise<GateResult> {
  return post("/auth/gate/link/confirm", {});
}

export function gateLinkWithPassword(
  username: string,
  password: string,
): Promise<GateResult> {
  return post("/auth/gate/link/password", { username, password });
}

export function gateCreate(username: string): Promise<GateResult> {
  return post("/auth/gate/create", { username });
}

// ---- error code -> en.json key ----

const GATE_ERROR_KEYS: Record<string, string> = {
  denied: "gate_auth.error_denied",
  expired: "gate_auth.error_expired",
  invalid: "gate_auth.error_invalid",
  disabled: "gate_auth.error_disabled",
  account_disabled: "gate_auth.error_account_disabled",
  unavailable: "gate_auth.error_unavailable",
};

/** Message key for a `#gate_error=<code>` redirect. */
export function gateErrorKey(code: string): string {
  return GATE_ERROR_KEYS[code] ?? "gate_auth.error_unavailable";
}

const LINK_ERROR_KEYS: Record<string, string> = {
  invalid_credentials: "gate_auth.error_invalid_credentials",
  already_linked: "gate_auth.error_already_linked",
  rate_limited: "gate_auth.error_rate_limited",
  no_pending: "gate_auth.error_no_pending",
  no_match: "gate_auth.error_no_match",
  network: "gate_auth.error_network",
};

/** Message key for a failed confirm / link-with-password call. */
export function linkErrorKey(code: string): string {
  return LINK_ERROR_KEYS[code] ?? "gate_auth.error_generic";
}

const CREATE_ERROR_KEYS: Record<string, string> = {
  username_taken: "gate_auth.error_username_taken",
  username_invalid: "gate_auth.error_username_invalid",
  username_censored: "gate_auth.error_username_censored",
  email_domain: "gate_auth.error_email_domain",
  email_not_approved: "gate_auth.error_email_not_approved",
  rate_limited: "gate_auth.error_rate_limited",
  no_pending: "gate_auth.error_no_pending",
  network: "gate_auth.error_network",
};

/** Message key for a failed create-account call. */
export function createErrorKey(code: string): string {
  return CREATE_ERROR_KEYS[code] ?? "gate_auth.error_generic";
}
