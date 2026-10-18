// A test double for the GATE OIDC provider: discovery, JWKS and the token
// endpoint (client_secret_basic only, PKCE S256, single-use codes). It is not
// GATE code; it only speaks the standard protocol.
import express from "express";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { createHash, randomBytes, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";

export const FAKE_CLIENT_ID = "hostile-takeover";
// Characters that must be form-urlencoded before Basic encoding (RFC 6749 2.3.1).
export const FAKE_CLIENT_SECRET = "s3cr3t/+= &x%y";
export const FAKE_KID = "k1";

type Key = CryptoKey | KeyObject;

export interface MintOptions {
  /** Merged over the default claims; an `undefined` value drops the claim. */
  claims?: Record<string, unknown>;
  alg?: "ES256" | "HS256" | "none";
  kid?: string;
  /** Sign with this key instead of the published one (for ES256). */
  signWith?: Key;
  /** Seconds from now; negative makes an already-expired token. */
  expiresIn?: number;
}

interface CodeRecord {
  challenge: string;
  redirectUri: string;
  idToken: string;
}

export async function startFakeGate(
  opts: { publicIssuer?: string; endSession?: boolean | string } = {},
) {
  const app = express();
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: FAKE_KID,
    alg: "ES256",
    use: "sig",
  };
  const codes = new Map<string, CodeRecord>();
  const state = {
    discoveryHits: 0,
    jwksHits: 0,
    tokenRequests: [] as {
      authorization: string | undefined;
      body: Record<string, string>;
    }[],
    /** Every id_token minted, oldest first. */
    idTokens: [] as string[],
    discoveryIssuer: undefined as string | undefined,
    tokenOverride: null as null | { status: number; body: unknown },
    /** Body served by the userinfo endpoint (404 when null). */
    userinfo: null as null | Record<string, unknown>,
    userinfoRequests: [] as (string | undefined)[],
    /** Every /oidc/direct/<op> request, oldest first. */
    directRequests: [] as {
      op: string;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }[],
    /** Per-op answers for /oidc/direct/<op>; an op with none answers 404. */
    direct: {} as Record<
      string,
      (body: Record<string, unknown>) =>
        | { status: number; json?: unknown; headers?: Record<string, string> }
        | Promise<{
            status: number;
            json?: unknown;
            headers?: Record<string, string>;
          }>
    >,
    /** Body served by GET /api/legal/versions. */
    legal: {
      tosVersion: "2026-10-18",
      privacyVersion: "2026-10-18",
    } as unknown,
  };
  let origin = "";
  const pub = () => opts.publicIssuer ?? origin;

  app.get("/.well-known/openid-configuration", (_req, res) => {
    state.discoveryHits++;
    const doc: Record<string, unknown> = {
      issuer: state.discoveryIssuer ?? pub(),
      authorization_endpoint: `${pub()}/oidc/auth`,
      token_endpoint: `${pub()}/oidc/token`,
      jwks_uri: `${pub()}/oidc/jwks`,
      userinfo_endpoint: `${pub()}/oidc/me`,
      id_token_signing_alg_values_supported: ["ES256"],
    };
    if (opts.endSession !== false) {
      doc.end_session_endpoint =
        typeof opts.endSession === "string"
          ? opts.endSession
          : `${pub()}/oidc/logout`;
    }
    res.json(doc);
  });
  app.get("/oidc/me", (req, res) => {
    state.userinfoRequests.push(req.headers.authorization);
    if (req.headers.authorization !== "Bearer at" || !state.userinfo) {
      return void res.status(state.userinfo ? 401 : 404).json({});
    }
    res.json(state.userinfo);
  });
  app.get("/api/legal/versions", (_req, res) => {
    res.json(state.legal);
  });
  app.post("/oidc/direct/:op", express.json(), async (req, res) => {
    const op = String(req.params.op);
    state.directRequests.push({
      op,
      authorization: req.headers.authorization,
      body: req.body as Record<string, unknown>,
    });
    const h = state.direct[op];
    if (!h) return void res.status(404).json({});
    const r = await h(req.body as Record<string, unknown>);
    for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
    if (r.json === undefined) return void res.status(r.status).end();
    res.status(r.status).json(r.json);
  });
  app.get("/oidc/jwks", (_req, res) => {
    state.jwksHits++;
    res.json({ keys: [jwk] });
  });
  app.post(
    "/oidc/token",
    express.urlencoded({ extended: false }),
    (req, res) => {
      const body = req.body as Record<string, string>;
      state.tokenRequests.push({
        authorization: req.headers.authorization,
        body,
      });
      if (state.tokenOverride) {
        return void res
          .status(state.tokenOverride.status)
          .json(state.tokenOverride.body);
      }
      const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
      const [id, secret] = m
        ? Buffer.from(m[1], "base64")
            .toString("utf8")
            .split(":")
            .map((x) => decodeURIComponent(x.replace(/\+/g, " ")))
        : [];
      if (
        id !== FAKE_CLIENT_ID ||
        secret !== FAKE_CLIENT_SECRET ||
        "client_secret" in body
      ) {
        return void res.status(401).json({ error: "invalid_client" });
      }
      const rec = codes.get(body.code);
      codes.delete(body.code);
      const challenge = createHash("sha256")
        .update(body.code_verifier ?? "")
        .digest("base64url");
      if (
        body.grant_type !== "authorization_code" ||
        !rec ||
        rec.redirectUri !== body.redirect_uri ||
        rec.challenge !== challenge
      ) {
        return void res.status(400).json({ error: "invalid_grant" });
      }
      res.json({
        access_token: "at",
        token_type: "Bearer",
        id_token: rec.idToken,
        expires_in: 300,
      });
    },
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** Issues a code for the authorization request in `authorizeUrl`, as GATE would after login. */
  async function mint(
    authorizeUrl: string,
    o: MintOptions = {},
  ): Promise<string> {
    const u = new URL(authorizeUrl);
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: pub(),
      sub: "gate-sub-1",
      aud: FAKE_CLIENT_ID,
      azp: FAKE_CLIENT_ID,
      nonce: u.searchParams.get("nonce"),
      auth_time: now,
      login_name: "gatealice",
      display_name: "Gate Alice",
      global_rank: "PLAYER",
      email_verified: true,
      email: "alice@kmlhs.org",
      email_approved: true,
      ...o.claims,
    };
    for (const k of Object.keys(claims))
      if (claims[k] === undefined) delete claims[k];
    const alg = o.alg ?? "ES256";
    const exp = now + (o.expiresIn ?? 300);
    // jose's SignJWT stamps iat/exp itself; explicit claims win when present.
    const jwt = new SignJWT(claims)
      .setIssuedAt(
        now - (o.expiresIn !== undefined && o.expiresIn < 0 ? 600 : 0),
      )
      .setExpirationTime(exp);
    let idToken: string;
    if (alg === "none") {
      const b = (x: unknown) =>
        Buffer.from(JSON.stringify(x)).toString("base64url");
      idToken = `${b({ alg: "none", typ: "JWT" })}.${b({ ...claims, iat: now, exp })}.`;
    } else if (alg === "HS256") {
      idToken = await jwt
        .setProtectedHeader({ alg: "HS256", kid: o.kid ?? FAKE_KID })
        .sign(
          new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!!"),
        );
    } else {
      idToken = await jwt
        .setProtectedHeader({ alg: "ES256", kid: o.kid ?? FAKE_KID })
        .sign((o.signWith ?? privateKey) as CryptoKey);
    }
    state.idTokens.push(idToken);
    const code = randomBytes(12).toString("base64url");
    codes.set(code, {
      challenge: u.searchParams.get("code_challenge") ?? "",
      redirectUri: u.searchParams.get("redirect_uri") ?? "",
      idToken,
    });
    return code;
  }

  return {
    origin,
    issuer: pub(),
    state,
    mint,
    lastIdToken: () => state.idTokens[state.idTokens.length - 1],
    otherKey: async () => (await generateKeyPair("ES256")).privateKey,
    close: () => server.close(),
  };
}
export type FakeGate = Awaited<ReturnType<typeof startFakeGate>>;
