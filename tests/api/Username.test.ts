// @vitest-environment node
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, test } from "vitest";
import {
  createApp,
  REFRESH_COOKIE,
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
import { pgStore, type Store } from "../../packages/api/src/store";
import type { UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const PW = "correct horse battery";
const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
});
const DAY = 24 * 60 * 60 * 1000;

function row(
  rank: string,
  name: string,
  extra: Partial<UserRow> = {},
): UserRow {
  return {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: name,
    first_name: "F",
    last_name: "L",
    email: `${name}@kmlhs.org`,
    rank,
    disabled_at: null,
    ...extra,
  };
}

async function harness(store: Store, limits = defaultRateLimits()) {
  limits.loginIp = new RateLimiter(1000, 60_000);
  const ctx: AppContext = {
    env,
    keys: await keysFromPem(generatePrivateKeyPem()),
    store,
    limits,
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
    h: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...h },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const as = async (login: string) => {
    const r = await call("POST", "/auth/login", {
      usernameOrEmail: login,
      password: PW,
    });
    const cookie = r.headers
      .getSetCookie()
      .find((c) => c.startsWith(REFRESH_COOKIE))!
      .split(";")[0];
    const jwt = (
      await (await call("POST", "/auth/refresh", undefined, { cookie })).json()
    ).jwt;
    return { authorization: `Bearer ${jwt}` };
  };
  return { call, as, close: () => server.close() };
}
type H = Awaited<ReturnType<typeof harness>>;

async function setup(limits?: ReturnType<typeof defaultRateLimits>) {
  const pw = await hashPassword(PW);
  const alice = row("PLAYER", "alice");
  const bob = row("PLAYER", "bob");
  const boss = row("THE_STRONGEST", "boss");
  const linked = row("PLAYER", "linked", { gate_sub: "gate-sub-1" });
  const m = memoryStore([alice, bob, boss, linked], {
    [alice.id]: pw,
    [bob.id]: pw,
    [boss.id]: pw,
    [linked.id]: pw,
  });
  return { m, alice, bob, boss, linked, h: await harness(m.store, limits) };
}

const meOf = async (h: H, a: Record<string, string>) =>
  (await (await h.call("GET", "/users/@me", undefined, a)).json()).player;
const put = (h: H, a: Record<string, string>, username: string) =>
  h.call("PUT", "/users/@me/username", { username }, a);

describe("PUT /users/@me/username", () => {
  test("renames, answers the client schema, shows in /users/@me, starts the 7-day cooldown", async () => {
    const { h } = await setup();
    try {
      const a = await h.as("alice");
      const r = await put(h, a, "Alicia");
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toMatchObject({
        username: "Alicia",
        base: "Alicia",
        discriminator: "",
      });
      const next = new Date(body.nextUsernameChangeAt).getTime();
      expect(Math.abs(next - (Date.now() + 7 * DAY))).toBeLessThan(5000);
      const me = await meOf(h, a);
      expect(me.username).toBe("Alicia");
      expect(me.usernameBase).toBe("Alicia");
      expect(me.nextUsernameChangeAt).toBe(body.nextUsernameChangeAt);
      expect(me.usernameStatus).toBeUndefined();
      const again = await put(h, a, "Alicia2");
      expect(again.status).toBe(429);
      expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(
        6 * 86400,
      );
    } finally {
      h.close();
    }
  });

  test("allowed again after 7 days", async () => {
    const { h, alice } = await setup();
    try {
      alice.username_changed_at = new Date(Date.now() - 7 * DAY - 1000);
      expect((await put(h, await h.as("alice"), "Alicia")).status).toBe(200);
    } finally {
      h.close();
    }
  });

  test("censored and malformed names are 400 and spend nothing", async () => {
    const { h, alice } = await setup();
    try {
      const a = await h.as("alice");
      const bad = await put(h, a, "fuck");
      expect(bad.status).toBe(400);
      expect((await bad.json()).code).toBe("USERNAME_PROFANE");
      const inv = await put(h, a, "a!");
      expect(inv.status).toBe(400);
      expect(typeof (await inv.json()).reason).toBe("string");
      expect(alice.username_changed_at).toBeUndefined();
    } finally {
      h.close();
    }
  });

  test("taken is 409, case-insensitive; the old name is free at once", async () => {
    const { h } = await setup();
    try {
      const a = await h.as("alice");
      const b = await h.as("bob");
      expect((await put(h, a, "BOB")).status).toBe(409);
      expect((await put(h, a, "Alicia")).status).toBe(200);
      expect((await put(h, b, "alice")).status).toBe(200);
    } finally {
      h.close();
    }
  });

  test("needs a sign-in and is rate limited", async () => {
    const limits = defaultRateLimits();
    limits.usernameChange = new RateLimiter(1, 60_000);
    const { h } = await setup(limits);
    try {
      expect((await h.call("PUT", "/users/@me/username", {})).status).toBe(401);
      const a = await h.as("alice");
      expect((await put(h, a, "fuck")).status).toBe(400);
      expect((await put(h, a, "Alicia")).status).toBe(429);
    } finally {
      h.close();
    }
  });

  test("a GLL-linked account renames in HT only (gate_sub unchanged)", async () => {
    const { h, linked } = await setup();
    try {
      expect((await put(h, await h.as("linked"), "Linked2")).status).toBe(200);
      expect(linked.username).toBe("Linked2");
      expect(linked.gate_sub).toBe("gate-sub-1");
    } finally {
      h.close();
    }
  });
});

describe("POST /admin/users/:username/rename", () => {
  test("root renames anyone with no cooldown, does not spend theirs, and logs it", async () => {
    const { h, m, alice } = await setup();
    try {
      const a = await h.as("boss");
      const rename = (from: string, to: string) =>
        h.call("POST", `/admin/users/${from}/rename`, { username: to }, a);
      expect((await rename("alice", "Renamed")).status).toBe(200);
      expect(alice.username).toBe("Renamed");
      expect(alice.username_changed_at).toBeUndefined();
      expect((await rename("Renamed", "Again")).status).toBe(200);
      expect(m.audit[m.audit.length - 1]).toMatchObject({
        actor: "boss",
        action: "user.rename",
        target: "Renamed",
      });
    } finally {
      h.close();
    }
  });

  test("non-root is 403; unknown 404; taken 409; censored 400", async () => {
    const { h } = await setup();
    try {
      const rename = (a: Record<string, string>, from: string, to: string) =>
        h.call("POST", `/admin/users/${from}/rename`, { username: to }, a);
      expect((await rename(await h.as("alice"), "bob", "Xyz")).status).toBe(
        403,
      );
      const a = await h.as("boss");
      expect((await rename(a, "nobody", "Xyz")).status).toBe(404);
      expect((await rename(a, "bob", "Alice")).status).toBe(409);
      expect((await rename(a, "bob", "fuck")).status).toBe(400);
    } finally {
      h.close();
    }
  });
});

describe.skipIf(process.env.HT_TEST_DB !== "1")("real database", () => {
  test("rename SQL: cooldown, citext uniqueness, old name reuse, root bypass", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const n = [1, 2].map(() => "itest" + randomUUID().slice(0, 8));
    const ids: string[] = [];
    const store = pgStore(pool);
    try {
      for (const name of n) {
        const r = await pool.query(
          `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at)
           VALUES ($1, $2, 'I', 'T', $3, 'x', now()) RETURNING id`,
          [generatePublicId(), name, `${name}@example.org`],
        );
        ids.push(r.rows[0].id);
      }
      const opts = { cooldownMs: 7 * DAY };
      const first = await store.renameUser(ids[0], n[0] + "b", opts);
      expect(first.ok && first.user.username_changed_at).toBeInstanceOf(Date);
      expect(await store.renameUser(ids[0], n[0] + "c", opts)).toMatchObject({
        ok: false,
        taken: false,
      });
      expect(
        await store.renameUser(ids[1], (n[0] + "B").toUpperCase(), opts),
      ).toEqual({ ok: false, taken: true });
      expect((await store.renameUser(ids[1], n[0], opts)).ok).toBe(true);
      const root = await store.renameUser(ids[0], n[0] + "d", {
        cooldownMs: null,
      });
      expect(root.ok && root.user.username).toBe(n[0] + "d");
    } finally {
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
      await pool.end();
    }
  });
});
