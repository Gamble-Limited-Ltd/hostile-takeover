import { base64urlToUuid, uuidToBase64url } from "@openfront/shared/Base64";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import type { ApiEnv } from "./env";
import type { SigningKeys } from "./keys";
import type { Store } from "./store";
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
}

export const REFRESH_COOKIE = "ht_refresh";

/** Dev login exists only off production and only for DOMAIN=localhost. */
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

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(pool: Queryable, ctx?: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");

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
      if (origin !== env.gameOrigin) {
        if (req.method === "OPTIONS" || req.method === "POST") {
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
        "GET, POST, DELETE, OPTIONS",
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

  app.post("/auth/refresh", async (req, res, next) => {
    try {
      const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (!raw) return deny(res);
      const session = await store.findSessionByHash(hashRefreshToken(raw));
      if (!session) return deny(res);
      if (session.revoked_at) {
        // A rotated or revoked token came back: assume it leaked.
        await store.revokeAllForUser(session.user_id);
        return deny(res);
      }
      if (session.expires_at.getTime() <= Date.now()) return deny(res);
      const user = await store.findUserById(session.user_id);
      if (!user || user.disabled_at) return deny(res);
      if (!(await store.rotateSession(session.id))) {
        await store.revokeAllForUser(session.user_id);
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

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(err);
      res.status(500).json({ error: "internal" });
    },
  );
}
