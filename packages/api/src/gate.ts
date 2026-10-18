// OIDC client for GLL ID (GATE). Talks to GATE only over standard
// OpenID Connect / OAuth 2.0 (authorization code + PKCE S256, client_secret_basic).
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { ApiEnv } from "./env";

export type GateErrorCode = "expired" | "invalid" | "unavailable";

/** A sign-in failure carrying the code the browser is sent back with. */
export class GateError extends Error {
  constructor(
    readonly code: GateErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface GateIdentity {
  sub: string;
  /** The verified email claim, or null when GATE sent none. */
  email: string | null;
  /**
   * GATE's `email_approved` claim (id_token first, then userinfo): true when the
   * email is @kmlhs.org or covered by an owner exception. null when GATE sent
   * none; callers must treat anything but true as not approved.
   */
  emailApproved: boolean | null;
  loginName: string;
  displayName: string;
  /** The raw id_token: kept only as the logout `id_token_hint`. Never log or return it. */
  idToken: string;
}

export interface GateClient {
  readonly enabled: boolean;
  authorizeUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  exchange(p: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GateIdentity>;
  /** POST to GATE's /oidc/direct/<op> with the client's Basic credentials. */
  direct(op: string, body: Record<string, unknown>): Promise<DirectResult>;
  /** GATE's current terms / privacy versions, for direct sign-up. */
  legalVersions(): Promise<{ tos: string; privacy: string } | null>;
  /** Where to send the browser to end the GATE session too. */
  logoutUrl(idTokenHint?: string | null): Promise<string>;
}

export interface DirectResult {
  status: number;
  /** The parsed JSON body; null for 204 or a non-JSON answer. */
  body: Record<string, unknown> | null;
  retryAfter: string | null;
}

export const randomToken = (): string => randomBytes(32).toString("base64url");
export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s).digest("hex");
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

const TIMEOUT_MS = 5_000;
const DISCOVERY_TTL_MS = 60 * 60_000;
const CLOCK_TOLERANCE_S = 30;
const MAX_EMAIL = 254;

interface Discovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint: string | null;
  userinfoEndpoint: string | null;
  fetchedAt: number;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

/** form-urlencoded, as RFC 6749 section 2.3.1 asks of the Basic credentials. */
const userinfoUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    new URL(v);
    return v;
  } catch {
    return null;
  }
};

const formEncode = (s: string): string =>
  new URLSearchParams({ x: s }).toString().slice(2);

export function createGate(env: ApiEnv): GateClient {
  const enabled = env.gateIssuer !== "" && env.gateClientId !== "";

  /**
   * Server-to-server fetches go to GATE_DIRECT_URL's origin (else
   * GATE_BACKCHANNEL_URL's) when set; discovered URLs are rewritten onto it.
   */
  function backchannel(url: string): string {
    const base = env.gateDirectUrl || env.gateBackchannelUrl;
    if (base === "") return url;
    const u = new URL(url);
    const to = new URL(base);
    u.protocol = to.protocol;
    u.host = to.host;
    return u.toString();
  }

  async function fetchJson(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(backchannel(url), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GateError("unavailable", "GATE unreachable");
    }
  }

  const basicAuth = (): string =>
    `Basic ${Buffer.from(
      `${formEncode(env.gateClientId)}:${formEncode(env.gateClientSecret)}`,
    ).toString("base64")}`;

  let cached: Discovery | null = null;
  let inflight: Promise<Discovery> | null = null;

  async function loadDiscovery(): Promise<Discovery> {
    const res = await fetchJson(
      `${env.gateIssuer}/.well-known/openid-configuration`,
    );
    if (!res.ok) throw new GateError("unavailable", "discovery failed");
    const doc = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!doc || doc.issuer !== env.gateIssuer) {
      throw new GateError("unavailable", "discovery issuer mismatch");
    }
    const url = (k: string): string => {
      const v = doc[k];
      if (typeof v !== "string") throw new GateError("unavailable", k);
      new URL(v);
      return v;
    };
    let jwksUri: string;
    let authorizationEndpoint: string;
    let tokenEndpoint: string;
    try {
      authorizationEndpoint = url("authorization_endpoint");
      tokenEndpoint = url("token_endpoint");
      jwksUri = url("jwks_uri");
    } catch {
      throw new GateError("unavailable", "discovery incomplete");
    }
    const end = doc.end_session_endpoint;
    return {
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      endSessionEndpoint: typeof end === "string" ? end : null,
      userinfoEndpoint: userinfoUrl(doc.userinfo_endpoint),
      fetchedAt: Date.now(),
      jwks: createRemoteJWKSet(new URL(backchannel(jwksUri)), {
        timeoutDuration: TIMEOUT_MS,
      }),
    };
  }

  async function discovery(): Promise<Discovery> {
    if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
      return cached;
    }
    inflight ??= loadDiscovery()
      .then((d) => (cached = d))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  /** `email_approved` from userinfo; null on any problem, so the caller fails closed. */
  async function userinfoApproved(
    d: Discovery,
    accessToken: string | null,
    sub: string,
  ): Promise<boolean | null> {
    if (!d.userinfoEndpoint || !accessToken) return null;
    try {
      const res = await fetchJson(d.userinfoEndpoint, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      // OIDC Core 5.3.2: the userinfo `sub` must match the id_token's.
      if (!body || body.sub !== sub) return null;
      return typeof body.email_approved === "boolean"
        ? body.email_approved
        : null;
    } catch {
      return null;
    }
  }

  async function verifyIdToken(
    idToken: string,
    d: Discovery,
    nonce: string,
    accessToken: string | null,
  ): Promise<GateIdentity> {
    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(idToken, d.jwks, {
        algorithms: ["ES256"],
        issuer: env.gateIssuer,
        audience: env.gateClientId,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ["exp", "iat", "sub"],
      });
      claims = payload;
    } catch (e) {
      if (e instanceof errors.JWKSTimeout) throw new GateError("unavailable");
      if (e instanceof errors.JOSEError) throw new GateError("invalid", e.code);
      throw new GateError("unavailable");
    }
    if (claims.nonce !== nonce) throw new GateError("invalid", "nonce");
    if (claims.azp !== undefined && claims.azp !== env.gateClientId) {
      throw new GateError("invalid", "azp");
    }
    if (claims.email_verified !== true) {
      throw new GateError("invalid", "email_verified");
    }
    const sub = claims.sub;
    if (typeof sub !== "string" || sub === "") {
      throw new GateError("invalid", "sub");
    }
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    const email = str(claims.email);
    const loginName = str(claims.login_name) ?? sub;
    const fromToken =
      typeof claims.email_approved === "boolean" ? claims.email_approved : null;
    const emailApproved =
      fromToken ?? (await userinfoApproved(d, accessToken, sub));
    return {
      sub,
      emailApproved,
      email: email !== null && email.length <= MAX_EMAIL ? email : null,
      loginName: loginName.slice(0, 100),
      displayName: (str(claims.display_name) ?? loginName).slice(0, 100),
      idToken,
    };
  }

  return {
    enabled,

    async authorizeUrl(p) {
      const d = await discovery();
      const u = new URL(d.authorizationEndpoint);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("client_id", env.gateClientId);
      u.searchParams.set("redirect_uri", env.gateRedirectUri);
      u.searchParams.set("scope", "openid profile email");
      u.searchParams.set("state", p.state);
      u.searchParams.set("nonce", p.nonce);
      u.searchParams.set("code_challenge", p.codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      return u.toString();
    },

    async exchange(p) {
      const d = await discovery();
      const res = await fetchJson(d.tokenEndpoint, {
        method: "POST",
        headers: {
          authorization: basicAuth(),
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: p.code,
          redirect_uri: env.gateRedirectUri,
          code_verifier: p.codeVerifier,
        }),
      });
      const body = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (res.status >= 500) throw new GateError("unavailable", "token 5xx");
      if (!res.ok) {
        // A code that was already used (or timed out) is a stale sign-in.
        if (body?.error === "invalid_grant") throw new GateError("expired");
        throw new GateError("invalid", `token ${res.status}`);
      }
      const idToken = body?.id_token;
      if (typeof idToken !== "string" || idToken === "") {
        throw new GateError("invalid", "no id_token");
      }
      const at = body?.access_token;
      return verifyIdToken(
        idToken,
        d,
        p.nonce,
        typeof at === "string" && at !== "" ? at : null,
      );
    },

    async direct(op, body) {
      const res = await fetchJson(`${env.gateIssuer}/oidc/direct/${op}`, {
        method: "POST",
        headers: {
          authorization: basicAuth(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      return {
        status: res.status,
        body:
          json && typeof json === "object" && !Array.isArray(json)
            ? (json as Record<string, unknown>)
            : null,
        retryAfter: res.headers.get("retry-after"),
      };
    },

    async legalVersions() {
      try {
        const res = await fetchJson(`${env.gateIssuer}/api/legal/versions`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) return null;
        const j = (await res.json()) as Record<string, unknown>;
        const tos = j.tosVersion;
        const privacy = j.privacyVersion;
        return typeof tos === "string" && typeof privacy === "string"
          ? { tos, privacy }
          : null;
      } catch {
        return null;
      }
    },

    async logoutUrl(idTokenHint) {
      let endpoint = `${env.gateIssuer}/oidc/logout`;
      try {
        endpoint = (await discovery()).endSessionEndpoint ?? endpoint;
      } catch {
        // Fall back to GATE's documented path.
      }
      const u = new URL(endpoint);
      u.searchParams.set("client_id", env.gateClientId);
      if (idTokenHint) u.searchParams.set("id_token_hint", idTokenHint);
      u.searchParams.set("post_logout_redirect_uri", env.gatePostLogoutUri);
      return u.toString();
    },
  };
}
