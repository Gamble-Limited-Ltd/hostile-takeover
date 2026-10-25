// @vitest-environment node
import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import {
  GameXpResponseSchema,
  PlayerProfileSchema,
  ProgressionConfigSchema,
  PublicPlayerGamesResponseSchema,
  PublicProgressSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
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
import { signJwt } from "../../packages/api/src/tokens";
import type { UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const KEY = "secret";
const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
  API_KEY: KEY,
});

function user(name = "u" + randomUUID().slice(0, 6)): UserRow {
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

async function harness(store: Store) {
  const keys = await keysFromPem(generatePrivateKeyPem());
  const server = createApp(
    { query: async () => ({}) },
    { env, keys, store },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    jwt: (u: UserRow) => signJwt(keys, env, u),
    close: () => server.close(),
  };
}

function record(
  u: UserRow,
  o: { gameType?: string; gameMode?: string; seconds?: number; win?: boolean },
) {
  const seconds = o.seconds ?? 600;
  const end = Date.now() - 1000;
  const gameID = randomUUID().replace(/-/g, "").slice(0, 8);
  const info = {
    gameID,
    lobbyCreatedAt: end - seconds * 1000,
    lobbyFillTime: 0,
    config: {
      gameMap: Object.values(GameMapType)[0],
      difficulty: "Medium",
      donateGold: false,
      donateTroops: false,
      gameType: o.gameType ?? "Public",
      gameMode: o.gameMode ?? "Free For All",
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
        username: "playerA",
        clanTag: null,
        persistentID: u.id,
        stats:
          o.win === false
            ? { killedAt: "3000", deathPosition: 2 }
            : { finalTiles: "500" },
      },
      {
        clientID: "BBBBBBBB",
        username: "playerB",
        clanTag: null,
        persistentID: randomUUID(),
        stats: o.win === false ? { finalTiles: "900" } : { deathPosition: 2 },
      },
    ],
    start: end - seconds * 1000,
    end,
    duration: seconds,
    num_turns: seconds * 10,
    winner: ["player", o.win === false ? "BBBBBBBB" : "AAAAAAAA"],
  };
  if (o.gameType === "Singleplayer") info.players.length = 1;
  return { info, version: "v0.0.2", turns: [] as unknown[] };
}

const postGame = (base: string, rec: { info: { gameID: string } }) =>
  fetch(`${base}/game/${rec.info.gameID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(rec),
  });
const postSingle = (base: string, jwt: string, rec: unknown) =>
  fetch(`${base}/archive_singleplayer_game`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      authorization: `Bearer ${jwt}`,
    },
    body: gzipSync(JSON.stringify(rec)),
  });

async function scenario(store: Store, a: UserRow, disabled?: UserRow) {
  const h = await harness(store);
  try {
    const jwt = await h.jwt(a);
    const auth = { authorization: `Bearer ${jwt}` };
    const get = (path: string, headers: Record<string, string> = {}) =>
      fetch(`${h.base}${path}`, { headers });

    // fresh account: level 1, and the strict /users/@me parse holds
    let me = UserMeResponseSchema.parse(
      await (await get("/users/@me", auth)).json(),
    );
    expect(me.player?.progress).toMatchObject({
      level: 1,
      xpInLevel: 0,
      xpForNext: 100,
      lifetimeXp: 0,
      legend: false,
      canPrestige: false,
    });
    expect((await get("/users/@me/xp/nope", auth)).status).toBe(404);
    expect((await get("/users/@me/xp/nope")).status).toBe(401);

    // public win, public loss, singleplayer win, too-short Team game
    const win = record(a, {});
    const loss = record(a, { win: false });
    const solo = record(a, { gameType: "Singleplayer" });
    const short = record(a, {
      gameMode: "Team",
      gameType: "Private",
      seconds: 60,
    });
    for (const r of [win, loss, short])
      expect((await postGame(h.base, r)).status).toBe(204);
    expect((await postSingle(h.base, jwt, solo)).status).toBe(204);

    me = UserMeResponseSchema.parse(
      await (await get("/users/@me", auth)).json(),
    );
    const prog = me.player!.progress!;
    expect(prog.lifetimeXp).toBeGreaterThan(0);
    expect(prog.level).toBeGreaterThan(1);

    const xp = GameXpResponseSchema.parse(
      await (await get(`/users/@me/xp/${win.info.gameID}`, auth)).json(),
    );
    expect(xp).toMatchObject({ eligible: true, gameId: win.info.gameID });
    if (xp.eligible) {
      expect(xp.breakdown.win).toBe(50);
      expect(xp.before).toMatchObject({ prestige: 0, level: 1, xpInLevel: 0 });
      expect("rewards" in xp ? xp.rewards : undefined).toBeUndefined();
    }
    // the singleplayer award is stored as sp:<id> and found by the plain id
    const spXp = GameXpResponseSchema.parse(
      await (await get(`/users/@me/xp/${solo.info.gameID}`, auth)).json(),
    );
    expect(spXp).toMatchObject({ eligible: true, gameId: solo.info.gameID });
    expect(
      GameXpResponseSchema.parse(
        await (await get(`/users/@me/xp/${short.info.gameID}`, auth)).json(),
      ),
    ).toEqual({
      eligible: false,
      gameId: short.info.gameID,
      reason: "too_short",
    });

    const cfgRes = await get("/public/progression/config");
    const cfgRaw = await cfgRes.json();
    const cfg = ProgressionConfigSchema.parse(cfgRaw);
    expect(cfg).toMatchObject({ version: 1, maxLevel: 100, maxPrestige: 0 });
    expect(cfg.levels).toHaveLength(100);
    for (const k of [
      "formula",
      "xp",
      "levelRewards",
      "prestige",
      "requireStatsAgreed",
    ])
      expect(cfgRaw).not.toHaveProperty(k);

    const pid = a.public_id;
    const pp = PublicProgressSchema.parse(
      await (await get(`/public/player/${pid}/progress`)).json(),
    );
    expect(pp).toMatchObject({
      level: prog.level,
      lifetimeXp: prog.lifetimeXp,
      legend: false,
    });
    expect((await get("/public/player/nobody/progress")).status).toBe(404);

    const pub = await (await get(`/public/player/${pid}`)).json();
    const profile = PlayerProfileSchema.parse(pub);
    expect(profile.username).toBe(a.username);
    expect(profile.stats.Public?.["Free For All"]?.Medium).toMatchObject({
      wins: 1n,
      losses: 1n,
      total: 2n,
    });
    expect(profile.stats.Singleplayer?.["Free For All"]?.Medium).toMatchObject({
      wins: 1n,
      total: 1n,
    });
    expect(profile.stats.Private?.Team?.Medium).toMatchObject({
      total: 1n,
      wins: 1n,
    });
    expect(await (await get(`/player/${pid}`, auth)).json()).toEqual(pub);
    expect((await get(`/player/${pid}`)).status).toBe(401);
    expect((await get("/public/player/nobody")).status).toBe(404);
    expect(
      await (
        await get(`/public/player/by-username/${a.username.toUpperCase()}`)
      ).json(),
    ).toEqual({ publicId: pid });
    expect((await get("/public/player/by-username/nobody")).status).toBe(404);

    const games = PublicPlayerGamesResponseSchema.parse(
      await (await get(`/public/player/${pid}/games`)).json(),
    );
    expect(games).toEqual({ results: [], nextCursor: null });

    if (disabled) {
      for (const p of ["", "/progress"])
        expect(
          (await get(`/public/player/${disabled.public_id}${p}`)).status,
        ).toBe(404);
      expect(
        (await get(`/public/player/by-username/${disabled.username}`)).status,
      ).toBe(404);
    }
    const prestige = await fetch(`${h.base}/users/@me/prestige`, {
      method: "POST",
      headers: auth,
    });
    expect(prestige.status).toBe(404);
  } finally {
    h.close();
  }
}

describe("progression read endpoints", () => {
  test("memory store", async () => {
    const a = user();
    const off = { ...user(), disabled_at: new Date() };
    await scenario(memoryStore([a, off]).store, a, off);
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
    const names = [1, 2].map(() => "itest" + randomUUID().slice(0, 8));
    const ids: string[] = [];
    try {
      for (const [i, name] of names.entries()) {
        const r = await pool.query(
          `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at, disabled_at)
           VALUES ($1, $2, 'I', 'T', $3, 'x', now(), ${i === 1 ? "now()" : "NULL"}) RETURNING id`,
          [generatePublicId(), name, `${name}@example.org`],
        );
        ids.push(r.rows[0].id);
      }
      const rows = await Promise.all(
        ids.map(
          async (id) =>
            (
              await pool.query("SELECT public_id FROM users WHERE id = $1", [
                id,
              ])
            ).rows[0],
        ),
      );
      const [a, off] = ids.map((id, i) => ({
        ...user(names[i]),
        id,
        public_id: rows[i].public_id,
      }));
      await scenario(pgStore(pool), a, off);
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
