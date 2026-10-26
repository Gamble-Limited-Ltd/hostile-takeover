import { base64urlToUuid, uuidToBase64url } from "@openfront/shared/Base64";
import express from "express";
import { mountAccountRoutes } from "./accountRoutes";
import { mountAdminXpRoutes } from "./adminXpRoutes";
import { hasValidApiKey } from "./apiKey";
import type { ApiEnv } from "./env";
import { mountFlagRoutes } from "./flagRoutes";
import { mountGameRoutes } from "./gameRoutes";
import { createGate, type GateClient } from "./gate";
import { mountGateRoutes } from "./gateRoutes";
import type { SigningKeys } from "./keys";
import { mountLeaderboardRoutes } from "./leaderboardRoutes";
import { mountProgressionRoutes } from "./progressionRoutes";
import { defaultRateLimits, type RateLimits } from "./rateLimit";
import type { SessionRow, Store } from "./store";
import {
  hashRefreshToken,
  JWT_TTL_SECONDS,
  newRefreshToken,
  REFRESH_TTL_SECONDS,
  signJwt,
  verifyJwt,
} from "./tokens";
import { buildUserMe, type UserRow } from "./userMe";

/** The slice of pg.Pool the app uses. */
export interface Queryable {
  query(sql: string): Promise<unknown>;
}

export interface AppContext {
  env: ApiEnv;
  keys: SigningKeys;
  store: Store;
  /** In-memory rate limits; tests pass tight ones. */
  limits?: RateLimits;
}

/** A just-rotated refresh token still works this long (two tabs refreshing at once). */
export const REFRESH_GRACE_MS = 30_000;

export const REFRESH_COOKIE = "ht_refresh";

const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Whether the TCP peer is this machine. Uses the socket address on purpose,
 * not req.ip: X-Forwarded-For is client-controlled and a proxied request
 * would look loopback.
 */
export function isLoopbackPeer(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_ADDRS.has(remoteAddress);
}

/**
 * Dev login exists only off production and only for DOMAIN=localhost; each
 * request must also come from a loopback socket (the API may listen on the
 * LAN in `npm run dev:lan`).
 */
export function devLoginEnabled(env: ApiEnv): boolean {
  return env.nodeEnv !== "production" && env.domain === "localhost";
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

/** Headers on every API response: it serves JSON only and is never framed. */
export const API_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export function createApp(pool: Queryable, ctx?: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Behind the tunnel, X-Forwarded-For comes from a trusted proxy only
  // (HT_TRUST_PROXY; loopback unless the deployment says otherwise).
  app.set("trust proxy", ctx?.env.trustProxy ?? "loopback");
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    next();
  });

  app.get("/healthz", async (_req, res) => {
    const db = await pool.query("SELECT 1").then(
      () => true,
      () => false,
    );
    res.json({ ok: true, db });
  });

  if (ctx) mountAuth(app, ctx);
  return app;
}

function mountAuth(app: express.Express, ctx: AppContext): void {
  const { env, keys, store } = ctx;
  const secure = env.apiUrl.startsWith("https://");
  const gate: GateClient = createGate(env);

  // CORS: only the game origin, with credentials. Cross-site POSTs from any
  // other origin are refused outright (the refresh cookie is SameSite=None in
  // production, so the browser alone would not stop them).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (origin !== env.gameOrigin && !env.extraOrigins.includes(origin)) {
        if (
          req.method === "OPTIONS" ||
          req.method === "POST" ||
          req.method === "PATCH" ||
          req.method === "DELETE"
        ) {
          res.status(403).json({ error: "origin_not_allowed" });
          return;
        }
      } else {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.vary("Origin");
      }
    }
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] ??
          "authorization, content-type, x-api-key",
      );
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
    next();
  });

  const cookieOpts = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
  };
  const setRefreshCookie = (res: express.Response, token: string) =>
    res.cookie(REFRESH_COOKIE, token, {
      ...cookieOpts,
      maxAge: REFRESH_TTL_SECONDS * 1000,
    });
  const clearRefreshCookie = (res: express.Response) =>
    res.clearCookie(REFRESH_COOKIE, cookieOpts);

  async function startSession(
    res: express.Response,
    userId: string,
    userAgent: string | undefined,
  ) {
    const { token, hash } = newRefreshToken();
    await store.createSession({
      userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      userAgent,
    });
    setRefreshCookie(res, token);
  }

  const deny = (res: express.Response) => {
    clearRefreshCookie(res);
    res.status(401).json({ error: "unauthorized" });
  };

  app.get("/.well-known/jwks.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ keys: [keys.jwk] });
  });

  async function liveSuccessor(from: SessionRow): Promise<SessionRow | null> {
    let cur = from;
    for (let hop = 0; hop < 5; hop++) {
      if (!cur.revoked_at) return cur;
      if (Date.now() - cur.revoked_at.getTime() > REFRESH_GRACE_MS) return null;
      const next = await store.findSuccessor(cur.id);
      if (!next) return null;
      cur = next;
    }
    return null;
  }

  async function authenticate(
    req: express.Request,
  ): Promise<{ user: UserRow; role: unknown } | null> {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!m) return null;
    try {
      const payload = await verifyJwt(keys, env, m[1]);
      const user = await store.findUserById(
        base64urlToUuid(String(payload.sub)),
      );
      if (!user || user.disabled_at) return null;
      return { user, role: payload.role };
    } catch {
      return null;
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * The live descendant of a revoked session, for a token that was rotated a
   * moment ago. The winner of a concurrent rotation revokes first and writes
   * its successor second, so a missing successor is polled for briefly.
   */
  async function graceSuccessor(from: SessionRow): Promise<SessionRow | null> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const live = await liveSuccessor(from);
      if (live) return live;
      if (!from.revoked_at) return null;
      if (Date.now() - from.revoked_at.getTime() > REFRESH_GRACE_MS) {
        return null;
      }
      if (await store.findSuccessor(from.id)) return null;
      await sleep(40);
    }
    return null;
  }

  /**
   * A revoked token came back. Within the grace window it lost a race with
   * another tab or request: answer with a fresh JWT for the live successor but
   * touch no cookie, so the browser keeps the successor's token whatever order
   * the replies land in. A rotated token outside the window is a reuse and
   * revokes everything; a session revoked without ever being rotated (sign-out,
   * password change) is just refused, and its cookie is left alone because the
   * jar may already hold a newer one.
   */
  async function replyForRevoked(
    found: SessionRow,
    res: express.Response,
  ): Promise<void> {
    const live = await graceSuccessor(found);
    if (live) {
      const user = await store.findUserById(live.user_id);
      if (
        live.expires_at.getTime() <= Date.now() ||
        !user ||
        user.disabled_at
      ) {
        return deny(res);
      }
      return sendJwt(res, await signJwt(keys, env, user));
    }
    const outside = Date.now() - found.revoked_at!.getTime() > REFRESH_GRACE_MS;
    if (outside && (await store.findSuccessor(found.id))) {
      await store.revokeAllForUser(found.user_id);
      return deny(res);
    }
    res.status(401).json({ error: "unauthorized" });
  }

  function sendJwt(res: express.Response, jwt: string) {
    // The client reads `jwt` and `expiresIn`; RefreshResponseSchema's
    // `token` is kept too so either shape parses.
    res.json({ jwt, token: jwt, expiresIn: JWT_TTL_SECONDS });
  }

  app.post("/auth/refresh", async (req, res, next) => {
    try {
      const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (!raw) return deny(res);
      const found = await store.findSessionByHash(hashRefreshToken(raw));
      if (!found) return deny(res);
      if (found.revoked_at) return await replyForRevoked(found, res);
      if (found.expires_at.getTime() <= Date.now()) return deny(res);
      const user = await store.findUserById(found.user_id);
      if (!user || user.disabled_at) return deny(res);
      // Revoke the old session and insert its successor atomically, so a DB
      // error can't leave the user with neither.
      const next = newRefreshToken();
      if (
        !(await store.rotateSession(found.id, {
          userId: user.id,
          tokenHash: next.hash,
          expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
          userAgent: req.headers["user-agent"],
        }))
      ) {
        // Lost a race to a concurrent refresh, or to a sign-out / password
        // change. Re-read to tell which; neither is a reuse by itself.
        const now = await store.findSessionByHash(hashRefreshToken(raw));
        if (now?.revoked_at) return await replyForRevoked(now, res);
        return deny(res);
      }
      setRefreshCookie(res, next.token);
      sendJwt(res, await signJwt(keys, env, user));
    } catch (e) {
      next(e);
    }
  });

  async function endSession(
    req: express.Request,
    res: express.Response,
    all: boolean,
  ) {
    const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
    let gateLogoutUrl: string | undefined;
    if (raw) {
      const session = await store.findSessionByHash(hashRefreshToken(raw));
      if (session) {
        if (all) await store.revokeAllForUser(session.user_id);
        else await store.revokeSession(session.id);
        if (!all && gate.enabled) {
          const user = await store.findUserById(session.user_id);
          if (user?.gate_sub) {
            gateLogoutUrl = await gate.logoutUrl();
          }
        }
      }
    }
    clearRefreshCookie(res);
    res.json(gateLogoutUrl ? { ok: true, gateLogoutUrl } : { ok: true });
  }
  app.post("/auth/logout", (req, res, next) => {
    endSession(req, res, false).catch(next);
  });
  app.post("/auth/revoke", (req, res, next) => {
    endSession(req, res, true).catch(next);
  });

  app.get("/users/@me", async (req, res, next) => {
    try {
      if (
        req.headers["x-api-key"] !== undefined &&
        !hasValidApiKey(req, env.apiKey)
      ) {
        return void res.status(401).json({ error: "unauthorized" });
      }
      const auth = req.headers.authorization ?? "";
      const m = /^Bearer (.+)$/.exec(auth);
      if (!m) return void res.status(401).json({ error: "unauthorized" });
      let user: UserRow | null;
      try {
        const payload = await verifyJwt(keys, env, m[1]);
        user = await store.findUserById(base64urlToUuid(String(payload.sub)));
      } catch {
        return void res.status(401).json({ error: "unauthorized" });
      }
      if (!user || user.disabled_at) {
        return void res.status(401).json({ error: "unauthorized" });
      }
      res.json(buildUserMe(user, await store.getProgress(user.id)));
    } catch (e) {
      next(e);
    }
  });

  if (devLoginEnabled(env)) {
    app.post("/dev/login", express.json(), async (req, res, next) => {
      try {
        if (!isLoopbackPeer(req.socket.remoteAddress)) {
          return void res.status(404).json({ error: "not_found" });
        }
        const username = req.body?.username;
        const user =
          typeof username === "string"
            ? await store.findUserByUsername(username)
            : null;
        if (!user || user.disabled_at) {
          return void res.status(404).json({ error: "no_such_user" });
        }
        await startSession(res, user.id, req.headers["user-agent"]);
        res.json({ ok: true, userId: uuidToBase64url(user.id) });
      } catch (e) {
        next(e);
      }
    });
  }

  const limits = ctx.limits ?? defaultRateLimits();
  mountAccountRoutes(app, {
    ctx,
    limits,
    startSession,
    clearRefreshCookie,
    readRefreshCookie: (req) => readCookie(req.headers.cookie, REFRESH_COOKIE),
    authenticate,
  });

  mountGateRoutes(app, {
    ctx,
    gate,
    limits,
    startSession,
    readCookie: (req, name) => readCookie(req.headers.cookie, name),
    cookieFlags: { secure, sameSite: cookieOpts.sameSite },
  });

  mountProgressionRoutes(app, { store, authenticate });
  mountAdminXpRoutes(app, { store, authenticate });
  mountFlagRoutes(app, { store, authenticate });
  mountLeaderboardRoutes(app, { store });
  mountGameRoutes(app, env, { store, authenticate });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if ((err as { type?: string }).type === "entity.parse.failed") {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      if ((err as { type?: string }).type === "entity.too.large") {
        res.status(413).json({ error: "invalid_request" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "internal" });
    },
  );
}
