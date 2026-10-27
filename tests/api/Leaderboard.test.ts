// @vitest-environment node
import {
  HT_LEADERBOARD_PAGE_SIZE,
  HtLeaderboardResponseSchema,
} from "@openfront/shared/HtLeaderboardSchemas";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { describe, expect, test } from "vitest";
import { createApp } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { generatePublicId } from "../../packages/api/src/publicId";
import { pgStore, type Store } from "../../packages/api/src/store";
import type { UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
  API_KEY: "secret",
});

function user(name: string): UserRow {
  return {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: name,
    first_name: "F",
    last_name: "L",
    email: `${name}@example.org`,
    rank: "PLAYER",
    disabled_at: null,
  };
}

async function play(store: Store, userId: string, won: boolean) {
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  await store.recordGame(
    {
      id,
      source: "server",
      modeBucket: "public",
      gameType: "Public",
      gameMode: "Free For All",
      map: "World",
      startedAt: now,
      endedAt: now,
      durationMs: 600_000,
      winner: null,
    },
    [
      {
        userId,
        placement: won ? 1 : 2,
        won,
        timeAliveMs: 1,
        leftEarly: false,
        mostTerritory: false,
        eliminatedPlayer: false,
        survived: false,
      },
    ],
    (_p, cur) => ({
      result: { eligible: false, reason: "too_short" },
      rulesVersion: 1,
      before: cur.state,
      after: cur.state,
      levelsReached: [],
      lastXpDay: null,
    }),
  );
}

async function scenario(
  store: Store,
  u: { a: UserRow; f: UserRow; b: UserRow; c: UserRow; off: UserRow },
  isolated: boolean,
  disable: (id: string) => Promise<void>,
) {
  const keys = await keysFromPem(generatePrivateKeyPem());
  const server = createApp(
    { query: async () => ({}) },
    { env, keys, store },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // a and f tie on 12 games / 6 wins; b 12 / 9; c 3 / 3; off 12 / 12.
    for (const [who, games, wins] of [
      [u.a, 12, 6],
      [u.f, 12, 6],
      [u.b, 12, 9],
      [u.c, 3, 3],
      [u.off, 12, 12],
    ] as const)
      for (let i = 0; i < games; i++) await play(store, who.id, i < wins);
    await store.setProgress(
      u.a.id,
      { prestige: 0, level: 5, xpInLevel: 10, lifetimeXp: 500 },
      false,
    );
    await store.setProgress(
      u.b.id,
      { prestige: 0, level: 7, xpInLevel: 0, lifetimeXp: 900 },
      false,
    );
    await store.setFlag(u.b.id, "country:us");
    await disable(u.off.id);

    const get = async (sort: string, page = 1) => {
      const r = await fetch(
        `${base}/public/leaderboard/players?sort=${sort}&page=${page}`,
      );
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("public, max-age=60");
      return HtLeaderboardResponseSchema.parse(await r.json());
    };
    const mine = new Set([u.a, u.f, u.b, u.c, u.off].map((x) => x.public_id));
    const order = async (sort: string) =>
      (await get(sort)).entries
        .filter((e) => mine.has(e.publicId))
        .map((e) => e.publicId);
    const id = (x: UserRow) => x.public_id;
    const [a, f] = [u.a, u.f].sort((x, y) =>
      x.username.toLowerCase().localeCompare(y.username.toLowerCase()),
    );

    // XP: b (900), a (500), then c and f at 0 XP (username order). The
    // disabled account never shows.
    expect(await order("xp")).toEqual([id(u.b), id(u.a), id(u.c), id(u.f)]);
    // wins: b 9, then a/f 6 (username order), then c 3.
    expect(await order("wins")).toEqual([id(u.b), id(a), id(f), id(u.c)]);
    // games: a/f/b tie at 12 -> username order; c 3 last.
    expect(await order("games")).toEqual([id(u.a), id(u.b), id(u.f), id(u.c)]);
    // win rate: needs 10+ games, so c (100%) is out; b .75, then a/f .5.
    expect(await order("winrate")).toEqual([id(u.b), id(a), id(f)]);

    const wins = await get("wins");
    const row = wins.entries.find((e) => e.publicId === id(u.b))!;
    expect(row).toMatchObject({
      username: u.b.username,
      flag: "country:us",
      level: 7,
      prestige: 0,
      lifetimeXp: 900,
      games: 12,
      wins: 9,
      winRate: 0.75,
    });
    if (isolated) {
      expect(wins.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
      expect(wins.entries[0].publicId).toBe(id(u.b));
    }
    for (const q of ["sort=nope", "page=0", "page=x", "page=1.5"])
      expect(
        (await fetch(`${base}/public/leaderboard/players?${q}`)).status,
      ).toBe(400);
  } finally {
    server.close();
  }
}

describe("public player leaderboard", () => {
  test("memory store", async () => {
    const u = {
      a: user("aaa"),
      f: user("fff"),
      b: user("bbb"),
      c: user("ccc"),
      off: user("off"),
    };
    await scenario(memoryStore(Object.values(u)).store, u, true, async (id) => {
      Object.values(u).find((x) => x.id === id)!.disabled_at = new Date();
    });
  });

  test("repeat requests inside the cache window don't hit the store", async () => {
    const x = user("cached");
    const store = memoryStore([x]).store;
    await play(store, x.id, true);
    const keys = await keysFromPem(generatePrivateKeyPem());
    const server = createApp(
      { query: async () => ({}) },
      { env, keys, store },
    ).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const games = async () =>
        (
          await (
            await fetch(`${base}/public/leaderboard/players?sort=games`)
          ).json()
        ).entries[0].games;
      expect(await games()).toBe(1);
      await play(store, x.id, true);
      expect(await games()).toBe(1);
    } finally {
      server.close();
    }
  });

  test("pagination: a full page then the rest", async () => {
    const n = HT_LEADERBOARD_PAGE_SIZE + 3;
    const users = Array.from({ length: n }, (_, i) =>
      user("p" + String(i).padStart(3, "0")),
    );
    const store = memoryStore(users).store;
    for (const x of users) await play(store, x.id, true);
    const keys = await keysFromPem(generatePrivateKeyPem());
    const server = createApp(
      { query: async () => ({}) },
      { env, keys, store },
    ).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const page = async (p: number) =>
        HtLeaderboardResponseSchema.parse(
          await (
            await fetch(
              `${base}/public/leaderboard/players?sort=games&page=${p}`,
            )
          ).json(),
        ).entries;
      const [p1, p2, p3] = [await page(1), await page(2), await page(3)];
      expect(p1).toHaveLength(HT_LEADERBOARD_PAGE_SIZE);
      expect(p1[0].rank).toBe(1);
      expect(p2.map((e) => e.rank)).toEqual([
        HT_LEADERBOARD_PAGE_SIZE + 1,
        HT_LEADERBOARD_PAGE_SIZE + 2,
        HT_LEADERBOARD_PAGE_SIZE + 3,
      ]);
      expect(p3).toEqual([]);
      expect(p2[0].username).toBe(
        "p" + String(HT_LEADERBOARD_PAGE_SIZE).padStart(3, "0"),
      );
    } finally {
      server.close();
    }
  });
});

describe.skipIf(process.env.HT_TEST_DB !== "1")("real database", () => {
  test("same scenario against Postgres", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const tag = randomUUID().slice(0, 6);
    const names = ["aaa", "fff", "bbb", "ccc", "off"].map((n) => `${n}${tag}`);
    const ids: string[] = [];
    try {
      for (const name of names) {
        const r = await pool.query(
          `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at)
           VALUES ($1, $2, 'I', 'T', $3, 'x', now()) RETURNING id, public_id`,
          [generatePublicId(), name, `${name}@example.org`],
        );
        ids.push(r.rows[0].id);
      }
      const rows = (
        await pool.query("SELECT id, public_id FROM users WHERE id = ANY($1)", [
          ids,
        ])
      ).rows;
      const [a, f, b, c, off] = ids.map((id, i) => ({
        ...user(names[i]),
        id,
        public_id: rows.find((r) => r.id === id).public_id,
      }));
      // Other rows in a shared dev DB make absolute ranks unknowable.
      await scenario(pgStore(pool), { a, f, b, c, off }, false, async (id) => {
        await pool.query("UPDATE users SET disabled_at = now() WHERE id = $1", [
          id,
        ]);
      });
    } finally {
      await pool.query(
        "DELETE FROM games WHERE id IN (SELECT game_id FROM game_players WHERE user_id = ANY($1))",
        [ids],
      );
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
      await pool.end();
    }
  });
});

describe("root badge on leaderboard rows", () => {
  test("only THE_STRONGEST rows carry root: true", async () => {
    const boss = { ...user("boss"), rank: "THE_STRONGEST" };
    const pal = user("pal");
    const store = memoryStore([boss, pal]).store;
    await play(store, boss.id, true);
    await play(store, pal.id, true);
    const keys = await keysFromPem(generatePrivateKeyPem());
    const server = createApp(
      { query: async () => ({}) },
      { env, keys, store },
    ).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const body = await (
        await fetch(`${base}/public/leaderboard/players?sort=games`)
      ).json();
      const row = (u: UserRow) =>
        body.entries.find(
          (e: { publicId: string }) => e.publicId === u.public_id,
        );
      expect(row(boss).root).toBe(true);
      expect("root" in row(pal)).toBe(false);
      HtLeaderboardResponseSchema.parse(body);
    } finally {
      server.close();
    }
  });
});
