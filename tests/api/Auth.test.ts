// @vitest-environment node
import {
  TokenPayloadSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { base64urlToUuid, uuidToBase64url } from "@openfront/shared/Base64";
import { PersistentIdSchema } from "@openfront/shared/WireSchemas";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, test } from "vitest";
import {
  createApp,
  devLoginEnabled,
  isLoopbackPeer,
  REFRESH_COOKIE,
  type AppContext,
} from "../../packages/api/src/app";
import { readEnv, type ApiEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
  loadSigningKeys,
} from "../../packages/api/src/keys";
import { generatePublicId } from "../../packages/api/src/publicId";
import { pgStore, type Store } from "../../packages/api/src/store";
import { hashRefreshToken } from "../../packages/api/src/tokens";
import { buildUserMe, type UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const GAME = "http://localhost:5178";

function user(rank: string, name = "u" + randomUUID().slice(0, 6)): UserRow {
  return {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: name,
    first_name: "F",
    last_name: "L",
    email: `${name}@example.org`,
    rank,
    disabled_at: null,
  };
}

const baseEnv: ApiEnv = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: GAME,
  API_KEY: "secret",
});

async function harness(
  users: UserRow[],
  envOver: Partial<ApiEnv> = {},
  store?: Store,
) {
  const keys = await keysFromPem(generatePrivateKeyPem());
  const mem = memoryStore(users);
  const ctx: AppContext = {
    env: { ...baseEnv, ...envOver },
    keys,
    store: store ?? mem.store,
  };
  const server = createApp({ query: async () => ({}) }, ctx).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    keys,
    ctx,
    sessions: mem.sessions,
    mem,
    close: () => server.close(),
  };
}

/** A tiny cookie jar: the value of the refresh cookie, or null once cleared. */
function cookieOf(res: Response): { value: string | null; raw: string } {
  const raw = res.headers
    .getSetCookie()
    .find((c) => c.startsWith(REFRESH_COOKIE))!;
  const value = raw.split(";")[0].split("=")[1];
  return { value: value === "" ? null : value, raw };
}

async function devLogin(base: string, username: string) {
  const res = await fetch(`${base}/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return { res, cookie: res.status === 200 ? cookieOf(res).value : null };
}

const refresh = (base: string, cookie: string | null, extra = {}) =>
  fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: cookie
      ? { cookie: `${REFRESH_COOKIE}=${cookie}`, ...extra }
      : extra,
  });

describe("buildUserMe", () => {
  test.each(["PLAYER", "THE_STRONGEST"])("parses for %s", (rank) => {
    const row = user(rank);
    const parsed = UserMeResponseSchema.parse(buildUserMe(row));
    expect(parsed.user.email).toBe(row.email);
    expect(parsed.player.publicId).toBe(row.public_id);
    expect(parsed.player.username).toBe(row.username);
    expect(parsed.player.trustTier).toBe("trusted");
    expect(parsed.player.achievements).toEqual({
      singleplayerMap: [],
      player: [],
    });
    expect(parsed.player.subscription).toBeNull();
  });
});

describe("keys and tokens", () => {
  test("JWKS parses for the game server and verifies a refreshed JWT", async () => {
    const u = user("THE_STRONGEST");
    const h = await harness([u]);
    try {
      const { cookie } = await devLogin(h.base, u.username);
      const jwt = (await (await refresh(h.base, cookie)).json()).jwt as string;

      const jwks = await (
        await fetch(`${h.base}/.well-known/jwks.json`)
      ).json();
      const key = jwks.keys[0];
      expect(key).toMatchObject({
        kty: "OKP",
        crv: "Ed25519",
        alg: "EdDSA",
        use: "sig",
      });
      expect(typeof key.kid).toBe("string");

      // What verifyClientToken does: verify with iss/aud, then TokenPayloadSchema.
      const { payload } = await jwtVerify(jwt, createLocalJWKSet(jwks), {
        algorithms: ["EdDSA"],
        issuer: "http://localhost:8787",
        audience: "localhost",
      });
      const claims = TokenPayloadSchema.parse(payload);
      expect(claims.sub).toBe(u.id);
      expect(PersistentIdSchema.safeParse(claims.sub).success).toBe(true);
      expect(claims.role).toBe("root");
      expect(claims.exp - claims.iat).toBe(900);
      expect(claims.provider).toBeUndefined();
      expect(decodeJwt(jwt).sub).toBe(uuidToBase64url(u.id));
      expect(base64urlToUuid(decodeJwt(jwt).sub!)).toBe(u.id);
    } finally {
      h.close();
    }
  });

  test("no role claim for a PLAYER", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie } = await devLogin(h.base, u.username);
      const body = await (await refresh(h.base, cookie)).json();
      expect("role" in decodeJwt(body.jwt)).toBe(false);
      expect(body.expiresIn).toBe(900);
      expect(body.token).toBe(body.jwt);
    } finally {
      h.close();
    }
  });

  test("loadSigningKeys fails clearly when the key is missing", async () => {
    await expect(loadSigningKeys("/nonexistent/key.pem")).rejects.toThrow(
      /api:keygen/,
    );
  });
});

describe("refresh cookie", () => {
  test("rotates on every refresh, stores only the hash, and links the chain", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie: c1 } = await devLogin(h.base, u.username);
      const r2 = await refresh(h.base, c1);
      expect(r2.status).toBe(200);
      const c2 = cookieOf(r2);
      expect(c2.value).not.toBe(c1);
      expect(c2.raw).toMatch(/HttpOnly/);
      expect(c2.raw).toMatch(/Path=\//);
      expect(c2.raw).toMatch(/SameSite=Lax/);
      expect(c2.raw).not.toMatch(/Secure/);
      expect(c2.raw).toMatch(/Max-Age=2592000/);
      expect(h.sessions.some((s) => s.token_hash === c1)).toBe(false);
      const first = h.sessions.find(
        (s) => s.token_hash === hashRefreshToken(c1!),
      )!;
      const second = h.sessions.find(
        (s) => s.token_hash === hashRefreshToken(c2.value!),
      )!;
      expect(first.revoked_at).not.toBeNull();
      expect(second.rotated_from).toBe(first.id);
    } finally {
      h.close();
    }
  });

  test("a failing session insert during refresh leaves the user a live session", async () => {
    const u = user("PLAYER");
    const mem = memoryStore([u]);
    let fail = false;
    const store: Store = {
      ...mem.store,
      createSession: async (x) => {
        if (fail) throw new Error("db down");
        return mem.store.createSession(x);
      },
    };
    const h = await harness([u], {}, store);
    try {
      const { cookie: c1 } = await devLogin(h.base, u.username);
      fail = true;
      await refresh(h.base, c1);
      expect(mem.sessions.some((s) => !s.revoked_at)).toBe(true);
    } finally {
      h.close();
    }
  });

  test("reusing a rotated token revokes every session and returns 401", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie: c1 } = await devLogin(h.base, u.username);
      const c2 = cookieOf(await refresh(h.base, c1)).value;
      // Outside the grace window a rotated token is a reuse.
      h.sessions[0].revoked_at = new Date(Date.now() - 60_000);
      const reuse = await refresh(h.base, c1);
      expect(reuse.status).toBe(401);
      expect(cookieOf(reuse).value).toBeNull();
      expect(h.sessions.every((s) => s.revoked_at)).toBe(true);
      expect((await refresh(h.base, c2)).status).toBe(401);
    } finally {
      h.close();
    }
  });

  test("grace: a rotated token gets a JWT but no cookie and no rotation", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie: c1 } = await devLogin(h.base, u.username);
      const r2 = await refresh(h.base, c1);
      const c2 = cookieOf(r2).value;
      const before = h.sessions.length;
      const stale = await refresh(h.base, c1);
      expect(stale.status).toBe(200);
      expect(stale.headers.getSetCookie()).toEqual([]);
      const body = await stale.json();
      expect(decodeJwt(body.jwt).sub).toBe(uuidToBase64url(u.id));
      expect(body.token).toBe(body.jwt);
      expect(h.sessions.length).toBe(before);
      // The successor is untouched and still the live one.
      const live = h.sessions.filter((s) => !s.revoked_at);
      expect(live.map((s) => s.token_hash)).toEqual([hashRefreshToken(c2!)]);
    } finally {
      h.close();
    }
  });

  test.each([
    ["reply order as sent", false],
    ["reply order reversed", true],
  ])(
    "two concurrent refreshes with one cookie (%s) leave the jar on the live token",
    async (_name, reversed) => {
      const u = user("PLAYER");
      const h = await harness([u]);
      try {
        const { cookie: c1 } = await devLogin(h.base, u.username);
        const replies = await Promise.all([
          refresh(h.base, c1),
          refresh(h.base, c1),
        ]);
        expect(replies.map((r) => r.status)).toEqual([200, 200]);
        const withCookie = replies.filter(
          (r) => r.headers.getSetCookie().length > 0,
        );
        expect(withCookie).toHaveLength(1);
        // Whatever order the replies are applied in, the jar ends on the one
        // cookie that was set, and it is the only live session.
        let jar: string | null = c1;
        for (const r of reversed ? [...replies].reverse() : replies) {
          if (r.headers.getSetCookie().length > 0) jar = cookieOf(r).value;
        }
        const live = h.sessions.filter((s) => !s.revoked_at);
        expect(live).toHaveLength(1);
        expect(live[0].token_hash).toBe(hashRefreshToken(jar!));
        // ...and it still works, long after the grace window.
        h.sessions.forEach((s) => {
          if (s.revoked_at) s.revoked_at = new Date(Date.now() - 60_000);
        });
        expect((await refresh(h.base, jar)).status).toBe(200);
      } finally {
        h.close();
      }
    },
  );

  test("a chain of three rapid refreshes survives stale cookies in any order", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie: c1 } = await devLogin(h.base, u.username);
      const c2 = cookieOf(await refresh(h.base, c1)).value;
      const c3 = cookieOf(await refresh(h.base, c2)).value;
      const c4 = cookieOf(await refresh(h.base, c3)).value;
      for (const stale of [c2, c1, c3, c1]) {
        const r = await refresh(h.base, stale);
        expect(r.status).toBe(200);
        expect(r.headers.getSetCookie()).toEqual([]);
      }
      const live = h.sessions.filter((s) => !s.revoked_at);
      expect(live.map((s) => s.token_hash)).toEqual([hashRefreshToken(c4!)]);
    } finally {
      h.close();
    }
  });

  test("an in-flight refresh racing a password change does not undo it", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie: c1 } = await devLogin(h.base, u.username);
      // Password change: sign out everywhere, then a fresh session.
      await h.ctx.store.revokeAllForUser(u.id);
      const fresh = (await (async () => {
        const { cookie } = await devLogin(h.base, u.username);
        return cookie;
      })())!;
      // The refresh that was already on the wire carries the old cookie.
      const stale = await refresh(h.base, c1);
      expect(stale.status).toBe(401);
      expect(stale.headers.getSetCookie()).toEqual([]);
      expect((await refresh(h.base, fresh)).status).toBe(200);
    } finally {
      h.close();
    }
  });

  test("missing, unknown, expired and disabled all give 401 and clear the cookie", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      expect((await refresh(h.base, null)).status).toBe(401);
      const unknown = await refresh(h.base, "nope");
      expect(unknown.status).toBe(401);
      expect(cookieOf(unknown).raw).toMatch(/Expires=Thu, 01 Jan 1970/);

      const { cookie } = await devLogin(h.base, u.username);
      h.sessions[0].expires_at = new Date(Date.now() - 1000);
      expect((await refresh(h.base, cookie)).status).toBe(401);

      const { cookie: c2 } = await devLogin(h.base, u.username);
      u.disabled_at = new Date();
      expect((await refresh(h.base, c2)).status).toBe(401);
    } finally {
      h.close();
    }
  });

  test("production attributes: SameSite=None; Secure", async () => {
    const u = user("PLAYER");
    const h = await harness([u], { apiUrl: "https://api.example.org" });
    try {
      // dev login is available because DOMAIN is still localhost here
      const res = await fetch(`${h.base}/dev/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: u.username }),
      });
      const raw = cookieOf(res).raw;
      expect(raw).toMatch(/SameSite=None/);
      expect(raw).toMatch(/Secure/);
      expect(raw).toMatch(/HttpOnly/);
    } finally {
      h.close();
    }
  });

  test("logout revokes this session and clears the cookie; revoke kills all", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const { cookie: a } = await devLogin(h.base, u.username);
      const { cookie: b } = await devLogin(h.base, u.username);
      const out = await fetch(`${h.base}/auth/logout`, {
        method: "POST",
        headers: { cookie: `${REFRESH_COOKIE}=${a}` },
      });
      expect(out.status).toBe(200);
      expect(cookieOf(out).value).toBeNull();
      expect(h.sessions.filter((s) => s.revoked_at)).toHaveLength(1);

      const all = await fetch(`${h.base}/auth/revoke`, {
        method: "POST",
        headers: { cookie: `${REFRESH_COOKIE}=${b}` },
      });
      expect(all.status).toBe(200);
      expect(h.sessions.every((s) => s.revoked_at)).toBe(true);
    } finally {
      h.close();
    }
  });
});

describe("CORS", () => {
  test("the game origin gets credentials; others are refused", async () => {
    const h = await harness([]);
    try {
      const pre = await fetch(`${h.base}/users/@me`, {
        method: "OPTIONS",
        headers: {
          origin: GAME,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization,x-api-key",
        },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-origin")).toBe(GAME);
      expect(pre.headers.get("access-control-allow-credentials")).toBe("true");
      expect(pre.headers.get("access-control-allow-headers")).toContain(
        "authorization",
      );
      // Site status and the account flag are saved with PUT.
      expect(pre.headers.get("access-control-allow-methods")).toContain("PUT");

      const evilPut = await fetch(`${h.base}/admin/site-status`, {
        method: "PUT",
        headers: { origin: "https://evil.example" },
      });
      expect(evilPut.status).toBe(403);

      const evilPre = await fetch(`${h.base}/users/@me`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      });
      expect(evilPre.status).toBe(403);
      expect(evilPre.headers.get("access-control-allow-origin")).toBeNull();

      const evilPost = await fetch(`${h.base}/auth/refresh`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
      });
      expect(evilPost.status).toBe(403);

      const evilGet = await fetch(`${h.base}/.well-known/jwks.json`, {
        headers: { origin: "https://evil.example" },
      });
      expect(evilGet.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      h.close();
    }
  });
});

describe("GET /users/@me", () => {
  test("returns a body that parses, for the browser and the game server", async () => {
    const u = user("THE_STRONGEST");
    const h = await harness([u]);
    try {
      const { cookie } = await devLogin(h.base, u.username);
      const { jwt } = await (await refresh(h.base, cookie)).json();
      const browser = await fetch(`${h.base}/users/@me`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(browser.status).toBe(200);
      expect(UserMeResponseSchema.parse(await browser.json()).user.email).toBe(
        u.email,
      );
      const server = await fetch(`${h.base}/users/@me`, {
        headers: { authorization: `Bearer ${jwt}`, "x-api-key": "secret" },
      });
      expect(server.status).toBe(200);
      const wrongKey = await fetch(`${h.base}/users/@me`, {
        headers: { authorization: `Bearer ${jwt}`, "x-api-key": "wrong" },
      });
      expect(wrongKey.status).toBe(401);
    } finally {
      h.close();
    }
  });

  test("401 without a token, with a bad token, and for a disabled user", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      expect((await fetch(`${h.base}/users/@me`)).status).toBe(401);
      const bad = await fetch(`${h.base}/users/@me`, {
        headers: { authorization: "Bearer abc.def.ghi" },
      });
      expect(bad.status).toBe(401);

      const { cookie } = await devLogin(h.base, u.username);
      const { jwt } = await (await refresh(h.base, cookie)).json();
      u.disabled_at = new Date();
      const res = await fetch(`${h.base}/users/@me`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
    } finally {
      h.close();
    }
  });
});

describe("POST /dev/login guard", () => {
  test("enabled only off production and for DOMAIN=localhost", () => {
    expect(devLoginEnabled({ ...baseEnv, nodeEnv: "" })).toBe(true);
    expect(devLoginEnabled({ ...baseEnv, nodeEnv: "development" })).toBe(true);
    expect(devLoginEnabled({ ...baseEnv, nodeEnv: "production" })).toBe(false);
    expect(devLoginEnabled({ ...baseEnv, domain: "example.org" })).toBe(false);
  });

  test.each([
    { nodeEnv: "production" },
    { domain: "hostile-takeover.example.org" },
  ])("the route is absent with %o", async (over) => {
    const u = user("PLAYER");
    const h = await harness([u], over);
    try {
      const { res } = await devLogin(h.base, u.username);
      expect(res.status).toBe(404);
      expect(h.sessions).toHaveLength(0);
    } finally {
      h.close();
    }
  });
});

describe("public ids", () => {
  test("are short, unique base64url strings", () => {
    const a = generatePublicId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(generatePublicId()).not.toBe(a);
  });
});

describe.skipIf(process.env.HT_TEST_DB !== "1")("real database flow", () => {
  test("dev login, refresh, /users/@me against the dev database", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const name = "itest" + randomUUID().slice(0, 8);
    try {
      await pool.query(
        `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at)
         VALUES ($1, $2, 'I', 'T', $3, 'x', now())`,
        [generatePublicId(), name, `${name}@example.org`],
      );
      const h = await harness([], {}, pgStore(pool));
      try {
        const { cookie } = await devLogin(h.base, name);
        expect(cookie).toBeTruthy();
        const r = await refresh(h.base, cookie);
        expect(r.status).toBe(200);
        const { jwt } = await r.json();
        const me = await fetch(`${h.base}/users/@me`, {
          headers: { authorization: `Bearer ${jwt}` },
        });
        expect(me.status).toBe(200);
        expect(
          UserMeResponseSchema.parse(await me.json()).player.username,
        ).toBe(name);
        // Reusing the rotated cookie inside the grace window (Slice 2.5) gets a
        // JWT for the live successor and no new cookie.
        const reuse = await refresh(h.base, cookie);
        expect(reuse.status).toBe(200);
        expect(reuse.headers.getSetCookie()).toEqual([]);
      } finally {
        h.close();
      }
    } finally {
      await pool.query("DELETE FROM users WHERE username = $1", [name]);
      await pool.end();
    }
  });
});

describe("dev login peer check and LAN env", () => {
  test("isLoopbackPeer accepts only loopback socket addresses", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopbackPeer(a)).toBe(true);
    }
    for (const a of ["10.1.1.251", "::ffff:10.1.1.251", "", undefined]) {
      expect(isLoopbackPeer(a)).toBe(false);
    }
  });

  test("/dev/login works from loopback even with a spoofed X-Forwarded-For", async () => {
    const u = user("PLAYER");
    const h = await harness([u]);
    try {
      const res = await fetch(`${h.base}/dev/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.1.1.251",
        },
        body: JSON.stringify({ username: u.username }),
      });
      expect(res.status).toBe(200);
    } finally {
      h.close();
    }
  });

  test("readEnv: loopback bind and no extra origins by default", () => {
    expect(baseEnv.apiHost).toBe("127.0.0.1");
    expect(baseEnv.extraOrigins).toEqual([]);
    const lan = readEnv({
      API_HOST: "0.0.0.0",
      EXTRA_GAME_ORIGINS: "http://10.1.1.251:5178/, http://b:1",
    });
    expect(lan.apiHost).toBe("0.0.0.0");
    expect(lan.extraOrigins).toEqual(["http://10.1.1.251:5178", "http://b:1"]);
  });

  test("an extra origin is allowed by CORS, a stranger is not", async () => {
    const h = await harness([], { extraOrigins: ["http://10.1.1.251:5178"] });
    try {
      const ok = await fetch(`${h.base}/auth/refresh`, {
        method: "POST",
        headers: { origin: "http://10.1.1.251:5178" },
      });
      expect(ok.status).not.toBe(403);
      expect(ok.headers.get("access-control-allow-origin")).toBe(
        "http://10.1.1.251:5178",
      );
      const bad = await fetch(`${h.base}/auth/refresh`, {
        method: "POST",
        headers: { origin: "http://evil.example" },
      });
      expect(bad.status).toBe(403);
    } finally {
      h.close();
    }
  });
});
