// @vitest-environment node
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  createApp,
  REFRESH_COOKIE,
  REFRESH_GRACE_MS,
  type AppContext,
} from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { hashPassword } from "../../packages/api/src/passwords";
import { generatePublicId } from "../../packages/api/src/publicId";
import {
  defaultRateLimits,
  RateLimiter,
} from "../../packages/api/src/rateLimit";
import { createPasswordReset } from "../../packages/api/src/resets";
import { hashRefreshToken } from "../../packages/api/src/tokens";
import type { UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const GAME = "http://localhost:5178";
const PW = "correct horse battery";
const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: GAME,
});

function row(rank: string, name: string, disabled = false): UserRow {
  return {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: name,
    first_name: "F",
    last_name: "L",
    email: `${name}@kmlhs.org`,
    rank,
    disabled_at: disabled ? new Date() : null,
  };
}

async function harness(
  opts: { limits?: ReturnType<typeof defaultRateLimits> } = {},
) {
  const pw = await hashPassword(PW);
  const alice = row("PLAYER", "alice");
  const boss = row("THE_STRONGEST", "boss");
  const gone = row("PLAYER", "gone", true);
  const mem = memoryStore([alice, boss, gone], {
    [alice.id]: pw,
    [boss.id]: pw,
    [gone.id]: pw,
  });
  const ctx: AppContext = {
    env,
    keys: await keysFromPem(generatePrivateKeyPem()),
    store: mem.store,
    limits: opts.limits ?? generous(),
  };
  const server = createApp({ query: async () => ({}) }, ctx).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    base,
    mem,
    alice,
    boss,
    gone,
    ctx,
    call,
    close: () => server.close(),
  };
}
type H = Awaited<ReturnType<typeof harness>>;

function generous() {
  const l = defaultRateLimits();
  l.loginIp = new RateLimiter(1000, 60_000);
  l.registerIp = new RateLimiter(1000, 60_000);
  return l;
}

const cookieOf = (res: Response) => {
  const raw = res.headers
    .getSetCookie()
    .find((c) => c.startsWith(REFRESH_COOKIE));
  const value = raw?.split(";")[0].split("=")[1];
  return value === "" ? null : (value ?? null);
};
const withCookie = (c: string | null) => ({ cookie: `${REFRESH_COOKIE}=${c}` });

const good = {
  firstName: "New",
  lastName: "Kid",
  email: "newkid@kmlhs.org",
  username: "NewKid",
  password: PW,
  ageConfirmed: true,
};

async function jwtFor(h: H, login: string, password = PW) {
  const r = await h.call("POST", "/auth/login", {
    usernameOrEmail: login,
    password,
  });
  const cookie = cookieOf(r);
  const jwt = (
    await (
      await h.call("POST", "/auth/refresh", undefined, withCookie(cookie))
    ).json()
  ).jwt as string;
  return { jwt, auth: { authorization: `Bearer ${jwt}` } };
}

async function using(fn: (h: H) => Promise<void>) {
  const h = await harness();
  try {
    await fn(h);
  } finally {
    h.close();
  }
}

describe("POST /auth/register", () => {
  test("creates the account, sets the cookie, and the cookie refreshes", async () => {
    await using(async (h) => {
      const res = await h.call("POST", "/auth/register", good);
      expect(res.status).toBe(201);
      expect((await res.json()).ok).toBe(true);
      const cookie = cookieOf(res);
      expect(cookie).toBeTruthy();
      const user = h.mem.users.find((u) => u.username === "NewKid")!;
      expect(user.rank).toBe("PLAYER");
      expect(h.mem.hashes[user.id]).toMatch(/^\$argon2id\$/);
      const r = await h.call(
        "POST",
        "/auth/refresh",
        undefined,
        withCookie(cookie),
      );
      expect(r.status).toBe(200);
    });
  });

  test.each([
    ["bad email domain", { email: "x@gmail.com" }, 400, "email_domain"],
    [
      "lookalike email domain",
      { email: "x@kmlhs.org.evil.com" },
      400,
      "email_domain",
    ],
    ["missing age", { ageConfirmed: false }, 400, "age_unconfirmed"],
    ["string age", { ageConfirmed: "true" }, 400, "age_unconfirmed"],
    ["short password", { password: "short" }, 400, "password_too_short"],
    ["short username", { username: "ab" }, 400, "username_invalid"],
    ["bad username chars", { username: "a.b!" }, 400, "username_invalid"],
    ["censored username", { username: "fuck_you" }, 400, "username_censored"],
    ["empty first name", { firstName: " " }, 400, "first_name_invalid"],
    ["empty last name", { lastName: "" }, 400, "last_name_invalid"],
    [
      "taken username, other case",
      { username: "ALICE" },
      409,
      "username_taken",
    ],
    [
      "taken email, other case",
      { email: "Alice@KMLHS.org" },
      409,
      "email_taken",
    ],
  ])("%s", async (_n, over, status, code) => {
    await using(async (h) => {
      const before = h.mem.users.length;
      const res = await h.call("POST", "/auth/register", { ...good, ...over });
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(code);
      expect(h.mem.users).toHaveLength(before);
      expect(cookieOf(res)).toBeNull();
    });
  });

  test("malformed JSON is a 400", async () => {
    await using(async (h) => {
      const res = await fetch(`${h.base}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{nope",
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_request");
    });
  });
});

describe("POST /auth/login", () => {
  test("by username (any case) or email, sets the cookie", async () => {
    await using(async (h) => {
      for (const login of [
        "alice",
        "ALICE",
        "alice@kmlhs.org",
        "Alice@KMLHS.org",
      ]) {
        const res = await h.call("POST", "/auth/login", {
          usernameOrEmail: login,
          password: PW,
        });
        expect(res.status).toBe(200);
        expect(cookieOf(res)).toBeTruthy();
      }
    });
  });

  test("wrong password, unknown user and disabled user give the same answer", async () => {
    await using(async (h) => {
      const bodies: string[] = [];
      for (const [login, password] of [
        ["alice", "wrong password!!"],
        ["nobody", PW],
        ["gone", PW],
        ["", ""],
      ]) {
        const res = await h.call("POST", "/auth/login", {
          usernameOrEmail: login,
          password,
        });
        expect(res.status).toBe(401);
        expect(cookieOf(res)).toBeNull();
        bodies.push(JSON.stringify(await res.json()));
      }
      expect(new Set(bodies).size).toBe(1);
      expect(JSON.parse(bodies[0]).error).toBe("invalid_credentials");
      expect(h.mem.sessions).toHaveLength(0);
    });
  });

  test("rate limits per account after repeated failures, and per IP", async () => {
    const limits = generous();
    limits.loginAccount = new RateLimiter(3, 60_000);
    const h = await harness({ limits });
    try {
      for (let i = 0; i < 3; i++) {
        expect(
          (
            await h.call("POST", "/auth/login", {
              usernameOrEmail: "alice",
              password: "nope nope nope",
            })
          ).status,
        ).toBe(401);
      }
      // even the right password is refused now
      const blocked = await h.call("POST", "/auth/login", {
        usernameOrEmail: "alice",
        password: PW,
      });
      expect(blocked.status).toBe(429);
      expect((await blocked.json()).error).toBe("rate_limited");
      // another account is unaffected
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "boss",
            password: PW,
          })
        ).status,
      ).toBe(200);
    } finally {
      h.close();
    }
    const ipLimits = generous();
    ipLimits.loginIp = new RateLimiter(2, 60_000);
    const h2 = await harness({ limits: ipLimits });
    try {
      await h2.call("POST", "/auth/login", {
        usernameOrEmail: "alice",
        password: PW,
      });
      await h2.call("POST", "/auth/login", {
        usernameOrEmail: "alice",
        password: PW,
      });
      expect(
        (
          await h2.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: PW,
          })
        ).status,
      ).toBe(429);
    } finally {
      h2.close();
    }
  });
});

describe("RateLimiter", () => {
  test("caps its map at 10k keys, evicting the oldest", () => {
    const l = new RateLimiter(1, 60_000);
    for (let i = 0; i <= 10_000; i++) l.hit(`k${i}`);
    // k0 was evicted, so it counts as fresh; the newest is still limited
    expect(l.blocked("k0")).toBe(false);
    expect(l.blocked("k10000")).toBe(true);
    expect(l.blocked("k1")).toBe(true);
  });
});

describe("login account limiter", () => {
  test("is keyed on account and IP, so one IP cannot lock the name for others", async () => {
    const limits = generous();
    limits.loginAccount = new RateLimiter(3, 60_000);
    const h = await harness({ limits });
    try {
      const login = (ip: string, password: string) =>
        h.call(
          "POST",
          "/auth/login",
          { usernameOrEmail: "alice", password },
          { "x-forwarded-for": ip },
        );
      for (let i = 0; i < 3; i++) {
        expect((await login("1.1.1.1", "nope nope nope")).status).toBe(401);
      }
      expect((await login("1.1.1.1", PW)).status).toBe(429);
      expect((await login("2.2.2.2", PW)).status).toBe(200);
    } finally {
      h.close();
    }
  });
});

describe("register rate limits", () => {
  test("per IP only", async () => {
    const ipLimits = generous();
    ipLimits.registerIp = new RateLimiter(2, 60_000);
    const h = await harness({ limits: ipLimits });
    try {
      await h.call("POST", "/auth/register", {
        ...good,
        username: "aa1",
        email: "a1@kmlhs.org",
      });
      await h.call("POST", "/auth/register", {
        ...good,
        username: "aa2",
        email: "a2@kmlhs.org",
      });
      const res = await h.call("POST", "/auth/register", {
        ...good,
        username: "aa3",
        email: "a3@kmlhs.org",
      });
      expect(res.status).toBe(429);
    } finally {
      h.close();
    }
    const h2 = await harness({ limits: generous() });
    try {
      // no per-name limit: a repeated name is a 409, never a 429
      for (let i = 0; i < 7; i++) {
        const res = await h2.call("POST", "/auth/register", good);
        expect(res.status).not.toBe(429);
      }
    } finally {
      h2.close();
    }
  });
});

describe("DELETE /users/@me", () => {
  test("deletes the user and sessions using the refresh cookie alone, answers 204", async () => {
    await using(async (h) => {
      const login = await h.call("POST", "/auth/login", {
        usernameOrEmail: "alice",
        password: PW,
      });
      const cookie = cookieOf(login);
      const res = await h.call(
        "DELETE",
        "/users/@me",
        undefined,
        withCookie(cookie),
      );
      expect(res.status).toBe(204);
      expect(cookieOf(res)).toBeNull();
      expect(h.mem.users.find((u) => u.username === "alice")).toBeUndefined();
      expect(h.mem.sessions).toHaveLength(0);
      expect(
        (await h.call("POST", "/auth/refresh", undefined, withCookie(cookie)))
          .status,
      ).toBe(401);
    });
  });

  test("also accepts a Bearer JWT", async () => {
    await using(async (h) => {
      const { auth } = await jwtFor(h, "alice");
      expect(
        (await h.call("DELETE", "/users/@me", undefined, auth)).status,
      ).toBe(204);
      expect(h.mem.users.find((u) => u.username === "alice")).toBeUndefined();
    });
  });

  test("401 with no credentials, a revoked cookie, and for another origin 403", async () => {
    await using(async (h) => {
      expect((await h.call("DELETE", "/users/@me")).status).toBe(401);
      const login = await h.call("POST", "/auth/login", {
        usernameOrEmail: "alice",
        password: PW,
      });
      const cookie = cookieOf(login);
      await h.call("POST", "/auth/logout", undefined, withCookie(cookie));
      expect(
        (await h.call("DELETE", "/users/@me", undefined, withCookie(cookie)))
          .status,
      ).toBe(401);
      const evil = await h.call("DELETE", "/users/@me", undefined, {
        origin: "https://evil.example",
        ...withCookie(cookie),
      });
      expect(evil.status).toBe(403);
      expect(h.mem.users.find((u) => u.username === "alice")).toBeDefined();
    });
  });
});

describe("PATCH /users/@me/password", () => {
  test("changes the password, revokes other sessions, keeps the caller signed in", async () => {
    await using(async (h) => {
      const other = cookieOf(
        await h.call("POST", "/auth/login", {
          usernameOrEmail: "alice",
          password: PW,
        }),
      );
      const { auth } = await jwtFor(h, "alice");
      const res = await h.call(
        "PATCH",
        "/users/@me/password",
        { currentPassword: PW, newPassword: "brand new password" },
        auth,
      );
      expect(res.status).toBe(200);
      const fresh = cookieOf(res);
      expect(fresh).toBeTruthy();
      expect(
        (await h.call("POST", "/auth/refresh", undefined, withCookie(other)))
          .status,
      ).toBe(401);
      // (reuse of a revoked token above revokes everything, so log in again)
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: PW,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: "brand new password",
          })
        ).status,
      ).toBe(200);
    });
  });

  test("the cookie it sets refreshes when no other session is touched", async () => {
    await using(async (h) => {
      const { auth } = await jwtFor(h, "alice");
      const res = await h.call(
        "PATCH",
        "/users/@me/password",
        { currentPassword: PW, newPassword: "brand new password" },
        auth,
      );
      const r = await h.call(
        "POST",
        "/auth/refresh",
        undefined,
        withCookie(cookieOf(res)),
      );
      expect(r.status).toBe(200);
    });
  });

  test("wrong current password, short new password, no token", async () => {
    await using(async (h) => {
      const { auth } = await jwtFor(h, "alice");
      const wrong = await h.call(
        "PATCH",
        "/users/@me/password",
        {
          currentPassword: "nope nope nope",
          newPassword: "brand new password",
        },
        auth,
      );
      expect(wrong.status).toBe(403);
      expect((await wrong.json()).error).toBe("wrong_password");
      const short = await h.call(
        "PATCH",
        "/users/@me/password",
        { currentPassword: PW, newPassword: "short" },
        auth,
      );
      expect(short.status).toBe(400);
      expect((await short.json()).error).toBe("password_too_short");
      expect(
        (
          await h.call("PATCH", "/users/@me/password", {
            currentPassword: PW,
            newPassword: "brand new password",
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: PW,
          })
        ).status,
      ).toBe(200);
    });
  });
});

describe("admin password resets", () => {
  async function createReset(h: H, as = "boss", target = "alice") {
    const { auth } = await jwtFor(h, as);
    return h.call("POST", "/admin/password-resets", { username: target }, auth);
  }

  test("root creates a reset; it works once; sessions are revoked; audit is logged", async () => {
    await using(async (h) => {
      const old = cookieOf(
        await h.call("POST", "/auth/login", {
          usernameOrEmail: "alice",
          password: PW,
        }),
      );
      const res = await createReset(h);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.link).toBe(`${GAME}/#reset=${body.token}`);
      expect(h.mem.resets).toHaveLength(1);
      expect(h.mem.resets[0].token_hash).toBe(hashRefreshToken(body.token));
      expect(h.mem.resets[0].token_hash).not.toBe(body.token);
      expect(h.mem.resets[0].created_by).toBe(h.boss.id);
      const ttl = h.mem.resets[0].expires_at.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(23.9 * 3600_000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
      expect(h.mem.audit).toEqual([
        expect.objectContaining({
          actor: "boss",
          action: "password_reset.create",
          target: "alice",
        }),
      ]);

      const use = await h.call("POST", "/auth/reset", {
        token: body.token,
        newPassword: "reset password 1",
      });
      expect(use.status).toBe(200);
      expect(
        (await h.call("POST", "/auth/refresh", undefined, withCookie(old)))
          .status,
      ).toBe(401);
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: PW,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: "reset password 1",
          })
        ).status,
      ).toBe(200);

      const again = await h.call("POST", "/auth/reset", {
        token: body.token,
        newPassword: "reset password 2",
      });
      expect(again.status).toBe(400);
      expect((await again.json()).error).toBe("invalid_token");
    });
  });

  test("a disabled account cannot be reset, and the token is left unspent", async () => {
    await using(async (h) => {
      const { token } = await (await createReset(h)).json();
      const alice = h.mem.users.find((u) => u.username === "alice")!;
      alice.disabled_at = new Date();
      const res = await h.call("POST", "/auth/reset", {
        token,
        newPassword: "reset password 1",
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_token");
      expect(h.mem.resets[0].used_at).toBeNull();
      expect(await h.mem.store.findPasswordHash(alice.id)).not.toBeNull();
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: PW,
          })
        ).status,
      ).toBe(401);
    });
  });

  test("an expired token and a made-up token are refused", async () => {
    await using(async (h) => {
      const { token } = await (await createReset(h)).json();
      h.mem.resets[0].expires_at = new Date(Date.now() - 1000);
      const expired = await h.call("POST", "/auth/reset", {
        token,
        newPassword: "reset password 1",
      });
      expect(expired.status).toBe(400);
      expect((await expired.json()).error).toBe("invalid_token");
      expect(
        (
          await h.call("POST", "/auth/reset", {
            token: "nope",
            newPassword: "reset password 1",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await h.call("POST", "/auth/login", {
            usernameOrEmail: "alice",
            password: PW,
          })
        ).status,
      ).toBe(200);
    });
  });

  test("a short new password is refused and does not burn the token", async () => {
    await using(async (h) => {
      const { token } = await (await createReset(h)).json();
      const short = await h.call("POST", "/auth/reset", {
        token,
        newPassword: "short",
      });
      expect(short.status).toBe(400);
      expect((await short.json()).error).toBe("password_too_short");
      expect(
        (
          await h.call("POST", "/auth/reset", {
            token,
            newPassword: "reset password 1",
          })
        ).status,
      ).toBe(200);
    });
  });

  test("non-root, anonymous and unknown-target calls are refused", async () => {
    await using(async (h) => {
      const user = await createReset(h, "alice", "boss");
      expect(user.status).toBe(403);
      expect(
        (await h.call("POST", "/admin/password-resets", { username: "alice" }))
          .status,
      ).toBe(401);
      const missing = await createReset(h, "boss", "nobody");
      expect(missing.status).toBe(404);
      expect(h.mem.resets).toHaveLength(0);
      expect(h.mem.audit).toHaveLength(0);
    });
  });

  test("createPasswordReset (the CLI path) logs actor cli", async () => {
    await using(async (h) => {
      const r = await createPasswordReset(h.mem.store, env, {
        username: "alice",
        actor: "cli",
        createdBy: null,
      });
      expect(r!.link.startsWith(`${GAME}/#reset=`)).toBe(true);
      expect(h.mem.audit[0]).toMatchObject({ actor: "cli", target: "alice" });
      expect(
        await createPasswordReset(h.mem.store, env, {
          username: "zzz",
          actor: "cli",
          createdBy: null,
        }),
      ).toBeNull();
    });
  });
});

describe("refresh grace window", () => {
  test("a just-rotated token still works and does not revoke the chain", async () => {
    await using(async (h) => {
      const c1 = cookieOf(
        await h.call("POST", "/auth/login", {
          usernameOrEmail: "alice",
          password: PW,
        }),
      );
      const r2 = await h.call(
        "POST",
        "/auth/refresh",
        undefined,
        withCookie(c1),
      );
      const c2 = cookieOf(r2);
      // the second tab, still holding c1
      const r3 = await h.call(
        "POST",
        "/auth/refresh",
        undefined,
        withCookie(c1),
      );
      expect(r3.status).toBe(200);
      expect((await r3.json()).jwt).toBeTruthy();
      // the grace path rotates nothing and sets no cookie
      expect(r3.headers.getSetCookie()).toEqual([]);
      // exactly one live session remains, and it is c2's
      const live = h.mem.sessions.filter((s) => !s.revoked_at);
      expect(live).toHaveLength(1);
      expect(live[0].token_hash).toBe(hashRefreshToken(c2!));
      // the jar still holds c2, which keeps working
      expect(
        (await h.call("POST", "/auth/refresh", undefined, withCookie(c2)))
          .status,
      ).toBe(200);
    });
  });

  test("outside the window it is reuse: 401 and everything is revoked", async () => {
    await using(async (h) => {
      const c1 = cookieOf(
        await h.call("POST", "/auth/login", {
          usernameOrEmail: "alice",
          password: PW,
        }),
      );
      const c2 = cookieOf(
        await h.call("POST", "/auth/refresh", undefined, withCookie(c1)),
      );
      h.mem.sessions[0].revoked_at = new Date(
        Date.now() - REFRESH_GRACE_MS - 1000,
      );
      const reuse = await h.call(
        "POST",
        "/auth/refresh",
        undefined,
        withCookie(c1),
      );
      expect(reuse.status).toBe(401);
      expect(h.mem.sessions.every((s) => s.revoked_at)).toBe(true);
      expect(
        (await h.call("POST", "/auth/refresh", undefined, withCookie(c2)))
          .status,
      ).toBe(401);
    });
  });

  test("a logged-out token is never graced", async () => {
    await using(async (h) => {
      const c1 = cookieOf(
        await h.call("POST", "/auth/login", {
          usernameOrEmail: "alice",
          password: PW,
        }),
      );
      await h.call("POST", "/auth/logout", undefined, withCookie(c1));
      expect(
        (await h.call("POST", "/auth/refresh", undefined, withCookie(c1)))
          .status,
      ).toBe(401);
    });
  });
});

describe("RateLimiter", () => {
  test("counts within a window and resets after it", () => {
    const l = new RateLimiter(2, 1000);
    expect(l.hit("k", 0)).toBe(true);
    expect(l.hit("k", 1)).toBe(true);
    expect(l.hit("k", 2)).toBe(false);
    expect(l.hit("k", 1001)).toBe(true);
  });
});
