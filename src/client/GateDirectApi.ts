import { getApiBase } from "./ApiBase";

// Client for HT's /auth/gate/direct/* routes ("Redirect failed? Sign in here").
// Every call resolves (never throws). Error text comes from GLL ID as returned.

export type DirectOp =
  | "login"
  | "signup"
  | "verify"
  | "resend"
  | "recover"
  | "reset";

export interface DirectError {
  code: string;
  message: string;
  fields: Record<string, string>;
}

export type DirectResult =
  | {
      ok: true;
      /** login / verify: "ok" = session set, "link" = pick or create an HT account. */
      status?: "ok" | "link";
      /** signup / recover: the handle for the emailed code. */
      pending?: string;
    }
  | {
      ok: false;
      error: DirectError;
      /** EMAIL_UNVERIFIED: GLL ID emailed a code, continue with verify. */
      pending?: string;
    };

const NETWORK: DirectError = {
  code: "HT_NETWORK",
  message: "Couldn't reach the server. Check your connection and try again.",
  fields: {},
};

export async function directCall(
  op: DirectOp,
  body: Record<string, unknown>,
): Promise<DirectResult> {
  try {
    const response = await fetch(`${getApiBase()}/auth/gate/direct/${op}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as {
      status?: unknown;
      pending?: unknown;
      error?: { code?: unknown; message?: unknown; fields?: unknown };
    } | null;
    const pending =
      typeof parsed?.pending === "string" ? parsed.pending : undefined;
    if (response.ok) {
      const status =
        parsed?.status === "ok" || parsed?.status === "link"
          ? parsed.status
          : undefined;
      return { ok: true, status, pending };
    }
    const e = parsed?.error;
    const fields: Record<string, string> = {};
    if (e?.fields && typeof e.fields === "object") {
      for (const [k, v] of Object.entries(e.fields)) {
        if (typeof v === "string") fields[k] = v;
      }
    }
    return {
      ok: false,
      pending,
      error: {
        code: typeof e?.code === "string" ? e.code : "HT_ERROR",
        message:
          typeof e?.message === "string" && e.message !== ""
            ? e.message
            : NETWORK.message,
        fields,
      },
    };
  } catch (e) {
    console.warn(`direct ${op} request failed`, e);
    return { ok: false, error: NETWORK };
  }
}
