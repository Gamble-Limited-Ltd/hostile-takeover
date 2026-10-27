// @vitest-environment node
import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { uuidToBase64url } from "@openfront/shared/Base64";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { describe, expect, test } from "vitest";
import { createApp, REFRESH_COOKIE } from "../../packages/api/src/app";
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
import { signJwt } from "../../packages/api/src/tokens";
import type { UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const KEY = "secret";
const PW = "correct-horse-battery";
const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
  API_KEY: KEY,
});

const row = (rank: string, name: string): UserRow => ({
  id: randomUUID(),
  public_id: generatePublicId(),
  username: name,
  first_name: "F",
  last_name: "L",
  email: `${name}@kmlhs.org`,
  rank,
  disabled_at: null,
});

async function setup() {
  const boss = row("THE_STRONGEST", "boss");
  const alice = row("PLAYER", "alice");
  const bob = row("PLAYER", "bob");
  const pw = await hashPassword(PW);
  const mem = memoryStore([boss, alice, bob], {
    [boss.id]: pw,
    [alice.id]: pw,
    [bob.id]: pw,
  });
  const keys = await keysFromPem(generatePrivateKeyPem());
  const limits = defaultRateLimits();
  limits.loginIp = new RateLimiter(1000, 60_000);
  const server = createApp(
    { query: async () => ({}) },
    { env, keys, store: mem.store, limits },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (
    method: string,
    path: string,
    o: {
      as?: UserRow;
      body?: unknown;
      key?: string;
      cookie?: string | null;
    } = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(o.as
          ? { authorization: `Bearer ${await signJwt(keys, env, o.as)}` }
          : {}),
        ...(o.key !== undefined ? { "x-api-key": o.key } : {}),
        ...(o.cookie ? { cookie: `${REFRESH_COOKIE}=${o.cookie}` } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  const login = async (name: string) => {
    const r = await call("POST", "/auth/login", {
      body: { usernameOrEmail: name, password: PW },
    });
    const raw = r.headers
      .getSetCookie()
      .find((c) => c.startsWith(REFRESH_COOKIE));
    return { res: r, cookie: raw?.split(";")[0].split("=")[1] ?? null };
  };
  return {
    mem,
    boss,
    alice,
    bob,
    keys,
    call,
    login,
    limits,
    close: () => server.close(),
  };
}
type H = Awaited<ReturnType<typeof setup>>;

async function using(fn: (h: H) => Promise<void>) {
  const h = await setup();
  try {
    await fn(h);
  } finally {
    h.close();
  }
}

const sub = (u: UserRow) => uuidToBase64url(u.id);
const mod = (h: H, u: UserRow) =>
  h
    .call("GET", `/game-server/moderation/${sub(u)}`, { key: KEY })
    .then((r) => r.json());
const adminCalls: [string, string, unknown?][] = [
  ["POST", "/admin/users/alice/ban", { minutes: 5 }],
  ["POST", "/admin/users/alice/unban"],
  ["POST", "/admin/users/alice/mute", { minutes: 5 }],
  ["POST", "/admin/users/alice/unmute"],
  ["GET", "/admin/site-status"],
  ["PUT", "/admin/site-status", { banner: null, maintenance: false }],
  ["GET", "/admin/chat-reports"],
  ["DELETE", `/admin/chat-reports/${randomUUID()}`],
  ["POST", "/admin/games/g1/unranked", {}],
];

describe("admin auth", () => {
  test("unauthenticated 401, non-root 403, on every admin route", async () => {
    await using(async (h) => {
      for (const [m, p, body] of adminCalls) {
        expect((await h.call(m, p, { body })).status, p).toBe(401);
        expect((await h.call(m, p, { body, as: h.alice })).status, p).toBe(403);
      }
      expect(h.mem.audit).toHaveLength(0);
    });
  });

  test("admin routes are rate limited", async () => {
    await using(async (h) => {
      h.limits.admin = new RateLimiter(2, 60_000);
      const get = () => h.call("GET", "/admin/site-status", { as: h.boss });
      expect((await get()).status).toBe(200);
      expect((await get()).status).toBe(200);
      expect((await get()).status).toBe(429);
    });
  });
});

describe("bans", () => {
  test("ban revokes sessions, blocks refresh, login and /users/@me, audited", async () => {
    await using(async (h) => {
      const { cookie } = await h.login("alice");
      expect(cookie).toBeTruthy();
      const r = await h.call("POST", "/admin/users/alice/ban", {
        as: h.boss,
        body: { minutes: 60, reason: "spam" },
      });
      expect(r.status).toBe(200);
      expect(
        h.mem.sessions.filter((s) => s.user_id === h.alice.id && !s.revoked_at),
      ).toHaveLength(0);
      const refresh = await h.call("POST", "/auth/refresh", { cookie });
      expect(refresh.status).toBe(403);
      expect(await refresh.json()).toEqual({ error: "account_banned" });
      expect(refresh.headers.getSetCookie()).toEqual([]);
      const again = await h.login("alice");
      expect(again.res.status).toBe(403);
      expect(await again.res.json()).toEqual({ error: "account_banned" });
      const me = await h.call("GET", "/users/@me", { as: h.alice });
      expect(me.status).toBe(403);
      expect((await mod(h, h.alice)).banned).toBe(true);
      expect(h.mem.audit).toEqual([
        {
          actor: "boss",
          action: "ban",
          target: "alice",
          detail: { minutes: 60, reason: "spam" },
        },
      ]);
    });
  });

  test("an expired ban lets the user back in, unban too", async () => {
    await using(async (h) => {
      await h.call("POST", "/admin/users/alice/ban", {
        as: h.boss,
        body: { minutes: 60 },
      });
      h.alice.banned_until = new Date(Date.now() - 1000);
      const { res, cookie } = await h.login("alice");
      expect(res.status).toBe(200);
      expect((await h.call("POST", "/auth/refresh", { cookie })).status).toBe(
        200,
      );
      expect((await h.call("GET", "/users/@me", { as: h.alice })).status).toBe(
        200,
      );
      expect((await mod(h, h.alice)).banned).toBe(false);

      await h.call("POST", "/admin/users/bob/ban", {
        as: h.boss,
        body: { minutes: null },
      });
      expect((await h.login("bob")).res.status).toBe(403);
      await h.call("POST", "/admin/users/bob/unban", { as: h.boss });
      expect((await h.login("bob")).res.status).toBe(200);
    });
  });

  test("a permanent ban holds, and THE_STRONGEST cannot be banned", async () => {
    await using(async (h) => {
      await h.call("POST", "/admin/users/alice/ban", {
        as: h.boss,
        body: { minutes: null },
      });
      expect((await mod(h, h.alice)).banned).toBe(true);
      expect((await h.login("alice")).res.status).toBe(403);
      const r = await h.call("POST", "/admin/users/boss/ban", {
        as: h.boss,
        body: { minutes: 5 },
      });
      expect(r.status).toBe(403);
      expect((await h.login("boss")).res.status).toBe(200);
      expect(h.mem.audit).toHaveLength(1);
    });
  });

  test("bad input is a 400 and writes nothing", async () => {
    await using(async (h) => {
      for (const body of [{ minutes: 0 }, { minutes: "5" }, {}]) {
        const r = await h.call("POST", "/admin/users/alice/ban", {
          as: h.boss,
          body,
        });
        expect(r.status).toBe(400);
      }
      expect(h.mem.audit).toHaveLength(0);
      const gone = await h.call("POST", "/admin/users/nobody/unban", {
        as: h.boss,
      });
      expect(gone.status).toBe(404);
    });
  });
});

describe("mutes and the game server lookup", () => {
  test("mute, shadow and unmute show in /game-server/moderation", async () => {
    await using(async (h) => {
      expect(await mod(h, h.alice)).toEqual({
        banned: false,
        mutedUntil: null,
        shadow: false,
      });
      await h.call("POST", "/admin/users/alice/mute", {
        as: h.boss,
        body: { minutes: 10 },
      });
      const m = await mod(h, h.alice);
      expect(m.shadow).toBe(false);
      expect(Date.parse(m.mutedUntil) - Date.now()).toBeGreaterThan(9 * 60_000);
      await h.call("POST", "/admin/users/alice/mute", {
        as: h.boss,
        body: { minutes: 10, shadow: true },
      });
      expect((await mod(h, h.alice)).shadow).toBe(true);
      await h.call("POST", "/admin/users/alice/unmute", { as: h.boss });
      expect(await mod(h, h.alice)).toEqual({
        banned: false,
        mutedUntil: null,
        shadow: false,
      });
      expect(h.mem.audit.map((a) => a.action)).toEqual([
        "mute",
        "mute",
        "unmute",
      ]);
    });
  });

  test("an expired mute reads as unmuted; an unknown sub is clean", async () => {
    await using(async (h) => {
      h.alice.chat_muted_until = new Date(Date.now() - 1000);
      h.alice.chat_shadow_muted = true;
      expect(await mod(h, h.alice)).toEqual({
        banned: false,
        mutedUntil: null,
        shadow: false,
      });
      expect((await mod(h, { ...h.alice, id: randomUUID() })).banned).toBe(
        false,
      );
    });
  });

  test("the key-only routes refuse a JWT and a wrong key", async () => {
    await using(async (h) => {
      const calls: [string, string, unknown?][] = [
        ["GET", `/game-server/moderation/${sub(h.alice)}`],
        [
          "POST",
          "/game-server/audit",
          { actor: "boss", action: "kick", target: "alice" },
        ],
        [
          "POST",
          "/game-server/chat-report",
          {
            gameId: "g",
            reporterSub: sub(h.alice),
            targetSub: sub(h.bob),
            message: "hi",
          },
        ],
      ];
      for (const [m, p, body] of calls) {
        expect((await h.call(m, p, { body, as: h.boss })).status, p).toBe(401);
        expect((await h.call(m, p, { body, key: "wrong" })).status, p).toBe(
          401,
        );
        expect((await h.call(m, p, { body })).status, p).toBe(401);
      }
      expect(h.mem.audit).toHaveLength(0);
      expect(h.mem.reports).toHaveLength(0);
    });
  });

  test("POST /game-server/audit writes one row", async () => {
    await using(async (h) => {
      const r = await h.call("POST", "/game-server/audit", {
        key: KEY,
        body: {
          actor: "boss",
          action: "kick",
          target: "bob",
          detail: { a: 1 },
        },
      });
      expect(r.status).toBe(200);
      expect(h.mem.audit).toEqual([
        { actor: "boss", action: "kick", target: "bob", detail: { a: 1 } },
      ]);
      const bad = await h.call("POST", "/game-server/audit", {
        key: KEY,
        body: { actor: "boss" },
      });
      expect(bad.status).toBe(400);
    });
  });

  test("POST /game-server/mute and /unmute: key-only, audited as the actor, unknown target 404", async () => {
    await using(async (h) => {
      const body = {
        actorUsername: "boss",
        targetSub: sub(h.alice),
        minutes: 10,
        shadow: true,
      };
      for (const p of ["/game-server/mute", "/game-server/unmute"]) {
        expect((await h.call("POST", p, { body, as: h.boss })).status).toBe(
          401,
        );
        expect((await h.call("POST", p, { body })).status).toBe(401);
      }
      expect(h.mem.audit).toHaveLength(0);

      const r = await h.call("POST", "/game-server/mute", { key: KEY, body });
      expect(r.status).toBe(200);
      expect(await mod(h, h.alice)).toMatchObject({ shadow: true });

      const u = await h.call("POST", "/game-server/unmute", {
        key: KEY,
        body: { actorUsername: "boss", targetSub: sub(h.alice) },
      });
      expect(u.status).toBe(200);
      expect((await mod(h, h.alice)).mutedUntil).toBeNull();
      expect(h.mem.audit).toEqual([
        {
          actor: "boss",
          action: "mute",
          target: "alice",
          detail: { minutes: 10, shadow: true },
        },
        { actor: "boss", action: "unmute", target: "alice", detail: undefined },
      ]);

      const missing = {
        ...body,
        targetSub: sub({ ...h.alice, id: randomUUID() }),
      };
      expect(
        (await h.call("POST", "/game-server/mute", { key: KEY, body: missing }))
          .status,
      ).toBe(404);
      expect(
        (
          await h.call("POST", "/game-server/mute", {
            key: KEY,
            body: { ...body, minutes: 0 },
          })
        ).status,
      ).toBe(400);
      expect(h.mem.audit).toHaveLength(2);
    });
  });
});

describe("site status", () => {
  test("defaults, update, public read, audit", async () => {
    await using(async (h) => {
      const dflt = { banner: null, maintenance: false };
      expect(await (await h.call("GET", "/public/site-status")).json()).toEqual(
        dflt,
      );
      expect(
        await (
          await h.call("GET", "/admin/site-status", { as: h.boss })
        ).json(),
      ).toEqual(dflt);
      const put = { banner: "Back at 5", maintenance: true };
      const r = await h.call("PUT", "/admin/site-status", {
        as: h.boss,
        body: put,
      });
      expect(r.status).toBe(200);
      const pub = await h.call("GET", "/public/site-status");
      expect(await pub.json()).toEqual(put);
      expect(pub.headers.get("cache-control")).toContain("max-age");
      expect(h.mem.audit).toHaveLength(1);
      expect(h.mem.audit[0]).toMatchObject({
        action: "site_status",
        detail: put,
      });
      for (const body of [
        { banner: "x".repeat(201), maintenance: false },
        { banner: null },
        { banner: 5, maintenance: false },
      ]) {
        expect(
          (await h.call("PUT", "/admin/site-status", { as: h.boss, body }))
            .status,
        ).toBe(400);
      }
    });
  });
});

describe("chat reports", () => {
  test("insert, list newest first, delete, 30-day purge", async () => {
    await using(async (h) => {
      const post = (message: string) =>
        h.call("POST", "/game-server/chat-report", {
          key: KEY,
          body: {
            gameId: "g1",
            reporterSub: sub(h.alice),
            targetSub: sub(h.bob),
            message,
          },
        });
      expect((await post("first")).status).toBe(201);
      expect((await post("second")).status).toBe(201);
      expect((await post("x".repeat(201))).status).toBe(400);
      const list = async () =>
        (
          await (
            await h.call("GET", "/admin/chat-reports", { as: h.boss })
          ).json()
        ).reports;
      let reports = await list();
      expect(reports.map((r: { message: string }) => r.message)).toEqual([
        "second",
        "first",
      ]);
      expect(reports[0]).toMatchObject({
        gameId: "g1",
        reporter: "alice",
        target: "bob",
      });
      const del = await h.call(
        "DELETE",
        `/admin/chat-reports/${reports[0].id}`,
        {
          as: h.boss,
        },
      );
      expect(del.status).toBe(200);
      expect(
        (
          await h.call("DELETE", `/admin/chat-reports/${reports[0].id}`, {
            as: h.boss,
          })
        ).status,
      ).toBe(404);
      expect(h.mem.audit.map((a) => a.action)).toEqual(["chat_report_delete"]);
      h.mem.reports[0].createdAt = new Date(Date.now() - 31 * 24 * 3600_000);
      reports = await list();
      expect(reports).toHaveLength(0);
    });
  });
});

describe("unranked games", () => {
  const gameID = () => randomUUID().replace(/-/g, "").slice(0, 8);
  function record(id: string, a: UserRow, extra: Record<string, unknown> = {}) {
    const end = Date.now() - 1000;
    return {
      info: {
        gameID: id,
        lobbyCreatedAt: end - 600_000,
        lobbyFillTime: 0,
        config: {
          gameMap: Object.values(GameMapType)[0],
          difficulty: "Medium",
          donateGold: false,
          donateTroops: false,
          gameType: "Public",
          gameMode: "Free For All",
          gameMapSize: "Normal",
          nations: "default",
          bots: 10,
          infiniteGold: false,
          infiniteTroops: false,
          instantBuild: false,
          randomSpawn: false,
        },
        players: [
          {
            clientID: "AAAAAAAA",
            username: "playerAAAAAAAA",
            clanTag: null,
            persistentID: a.id,
            stats: { finalTiles: "500", conquests: ["1"] },
          },
        ],
        start: end - 600_000,
        end,
        duration: 600,
        num_turns: 6000,
        winner: ["player", "AAAAAAAA"],
      },
      version: "v0.0.2",
      turns: [],
      ...extra,
    };
  }
  const post = (h: H, rec: ReturnType<typeof record>) =>
    h.call("POST", `/game/${rec.info.gameID}`, { key: KEY, body: rec });
  const xp = (h: H) =>
    h.mem.store.getProgress(h.alice.id).then((p) => p.lifetimeXp);

  test("a normal game awards XP", async () => {
    await using(async (h) => {
      expect((await post(h, record(gameID(), h.alice))).status).toBe(204);
      expect(await xp(h)).toBeGreaterThan(0);
      expect(h.mem.games[0].unrankedReason ?? null).toBeNull();
    });
  });

  test.each([
    [{ htUnranked: true }, "unranked"],
    [{ htTakeover: true }, "takeover"],
  ])("%j stores the game and awards no XP", async (flag, reason) => {
    await using(async (h) => {
      expect((await post(h, record(gameID(), h.alice, flag))).status).toBe(204);
      expect(await xp(h)).toBe(0);
      expect(h.mem.games).toHaveLength(1);
      expect(h.mem.games[0].unrankedReason).toBe(reason);
    });
  });

  test("root flags a stored game unranked, audited; unknown game 404", async () => {
    await using(async (h) => {
      const rec = record(gameID(), h.alice);
      await post(h, rec);
      const r = await h.call(
        "POST",
        `/admin/games/${rec.info.gameID}/unranked`,
        {
          as: h.boss,
          body: {},
        },
      );
      expect(r.status).toBe(200);
      expect(h.mem.games[0].unrankedReason).toBe("admin");
      expect(h.mem.audit).toEqual([
        {
          actor: "boss",
          action: "game_unranked",
          target: rec.info.gameID,
          detail: { reason: "admin" },
        },
      ]);
      const gone = await h.call("POST", "/admin/games/nope/unranked", {
        as: h.boss,
        body: { reason: "x" },
      });
      expect(gone.status).toBe(404);
      expect(h.mem.audit).toHaveLength(1);
    });
  });
});

describe.skipIf(process.env.HT_TEST_DB !== "1")("real database", () => {
  test("ban, mute, settings, reports and unranked through pgStore", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const store: Store = pgStore(pool);
    const names = [1, 2].map(() => "mtest" + randomUUID().slice(0, 8));
    const ids: string[] = [];
    const gid = "mt" + randomUUID().slice(0, 8);
    const actor = "mtest-actor-" + randomUUID().slice(0, 6);
    try {
      for (const name of names) {
        const r = await pool.query(
          `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at)
           VALUES ($1, $2, 'I', 'T', $3, 'x', now()) RETURNING id`,
          [generatePublicId(), name, `${name}@example.org`],
        );
        ids.push(r.rows[0].id);
      }
      const [a, b] = ids;
      const isBanned = async () => (await store.findUserById(a))!.banned_until;
      await store.setBan(a, "infinity", "r");
      expect(Number(await isBanned())).toBe(Infinity);
      await store.setBan(a, new Date(Date.now() + 60_000), "r");
      expect(Number(await isBanned())).toBeGreaterThan(Date.now());
      await store.setBan(a, null, null);
      expect(await isBanned()).toBeNull();
      await store.setMute(a, new Date(Date.now() + 60_000), true);
      const u = (await store.findUserById(a))!;
      expect(u.chat_shadow_muted).toBe(true);
      await store.setMute(a, null, false);
      expect((await store.findUserById(a))!.chat_muted_until).toBeNull();

      await store.setSetting("mtest", { banner: "x" }, actor);
      await store.setSetting("mtest", { banner: "y" }, actor);
      expect(await store.getSetting("mtest")).toEqual({ banner: "y" });
      expect(await store.getSetting("mtest-missing")).toBeNull();

      await store.addChatReport({
        gameId: gid,
        reporterId: a,
        targetId: b,
        message: "m",
      });
      const found = (await store.listChatReports()).filter(
        (r) => r.gameId === gid,
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ reporter: names[0], target: names[1] });
      await pool.query(
        "UPDATE chat_reports SET created_at = now() - interval '31 days' WHERE game_id = $1",
        [gid],
      );
      expect(
        (await store.listChatReports()).filter((r) => r.gameId === gid),
      ).toHaveLength(0);

      expect(await store.setGameUnranked(gid, "admin")).toBe(false);
      await store.logAdmin({ actor, action: "x", target: null });
    } finally {
      await pool.query("DELETE FROM site_settings WHERE key = 'mtest'");
      await pool.query("DELETE FROM admin_audit WHERE actor = $1", [actor]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
      await pool.end();
    }
  });
});
