import { base64urlToUuid, uuidToBase64url } from "@openfront/shared/Base64";
import express from "express";
import { mountAccountRoutes } from "./accountRoutes";
import { sameSecret } from "./apiKey";
import type { ApiEnv } from "./env";
import { mountGameRoutes } from "./gameRoutes";
import type { SigningKeys } from "./keys";
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

export function createApp(pool: Queryable, ctx?: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // nginx on this host sets X-Forwarded-For; trust it from loopback only.
  app.set("trust proxy", "loopback");

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
    rotatedFrom?: string,
  ) {
    const { token, hash } = newRefreshToken();
    await store.createSession({
      userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      rotatedFrom,
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

  app.post("/auth/refresh", async (req, res, next) => {
    try {
      const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (!raw) return deny(res);
      const found = await store.findSessionByHash(hashRefreshToken(raw));
      if (!found) return deny(res);
      let session = found;
      let graced = false;
      if (found.revoked_at) {
        // A rotated token came back. Within the grace window it is another tab
        // that raced us: continue from the live successor. Otherwise assume
        // the token leaked and revoke everything.
        const live = await liveSuccessor(found);
        if (!live) {
          await store.revokeAllForUser(found.user_id);
          return deny(res);
        }
        session = live;
        graced = true;
      }
      if (session.expires_at.getTime() <= Date.now()) return deny(res);
      const user = await store.findUserById(session.user_id);
      if (!user || user.disabled_at) return deny(res);
      if (!(await store.rotateSession(session.id))) {
        // Lost a race to another refresh: only a reuse when not in grace.
        if (!graced) await store.revokeAllForUser(session.user_id);
        return deny(res);
      }
      await startSession(res, user.id, req.headers["user-agent"], session.id);
      const jwt = await signJwt(keys, env, user);
      // The client reads `jwt` and `expiresIn`; RefreshResponseSchema's
      // `token` is kept too so either shape parses.
      res.json({ jwt, token: jwt, expiresIn: JWT_TTL_SECONDS });
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
    if (raw) {
      const session = await store.findSessionByHash(hashRefreshToken(raw));
      if (session) {
        if (all) await store.revokeAllForUser(session.user_id);
        else await store.revokeSession(session.id);
      }
    }
    clearRefreshCookie(res);
    res.json({ ok: true });
  }
  app.post("/auth/logout", (req, res, next) => {
    endSession(req, res, false).catch(next);
  });
  app.post("/auth/revoke", (req, res, next) => {
    endSession(req, res, true).catch(next);
  });

  app.get("/users/@me", async (req, res, next) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== undefined) {
        if (
          typeof apiKey !== "string" ||
          env.apiKey === "" ||
          !sameSecret(apiKey, env.apiKey)
        ) {
          return void res.status(401).json({ error: "unauthorized" });
        }
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
      res.json(buildUserMe(user));
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

  mountAccountRoutes(app, {
    ctx,
    limits: ctx.limits ?? defaultRateLimits(),
    startSession: (res, userId, ua) => startSession(res, userId, ua),
    clearRefreshCookie,
    readRefreshCookie: (req) => readCookie(req.headers.cookie, REFRESH_COOKIE),
    authenticate,
  });

  mountGameRoutes(app, env);

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
