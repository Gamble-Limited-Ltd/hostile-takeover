// @vitest-environment node
import { GameMapType } from "@openfront/engine-api/game/GameTypes";
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

const gameId = () => randomUUID().replace(/-/g, "").slice(0, 8);

interface P {
  id: string | null;
  clientID: string;
  stats?: Record<string, unknown>;
}

function record(o: {
  gameID?: string;
  gameType?: string;
  gameMode?: string;
  seconds?: number;
  players: P[];
  winner?: unknown;
  statsAgreed?: boolean;
  numTurns?: number;
  endedAgoMs?: number;
}) {
  const seconds = o.seconds ?? 600;
  const end = Date.now() - (o.endedAgoMs ?? 1000);
  const info = {
    gameID: o.gameID ?? gameId(),
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
    players: o.players.map((p) => ({
      clientID: p.clientID,
      username: "player" + p.clientID,
      clanTag: null,
      persistentID: p.id,
      stats: p.stats ?? {},
    })),
    start: end - seconds * 1000,
    end,
    duration: seconds,
    num_turns: o.numTurns ?? seconds * 10,
    winner: o.winner,
    statsAgreed: o.statsAgreed,
  };
  return { info, version: "v0.0.2", turns: [] as unknown[] };
}

const keyed = { "content-type": "application/json", "x-api-key": KEY };
const postGame = (base: string, rec: { info: { gameID: string } }) =>
  fetch(`${base}/game/${rec.info.gameID}`, {
    method: "POST",
    headers: keyed,
    body: JSON.stringify(rec),
  });
const postSingle = (base: string, jwt: string | null, rec: unknown) =>
  fetch(`${base}/archive_singleplayer_game`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: gzipSync(JSON.stringify(rec)),
  });

/** A winner who ate someone and a player killed at 5 min (tick 3000). */
function twoPlayerGame(a: UserRow, b: UserRow, extra = {}) {
  return record({
    players: [
      {
        id: a.id,
        clientID: "AAAAAAAA",
        stats: { finalTiles: "500", conquests: ["1"] },
      },
      {
        id: b.id,
        clientID: "BBBBBBBB",
        stats: { killedAt: "3000", deathPosition: 2 },
      },
      { id: randomUUID(), clientID: "GGGGGGGG", stats: { deathPosition: 3 } },
    ],
    winner: ["player", "AAAAAAAA"],
    ...extra,
  });
}

describe("POST /game/:id scoring", () => {
  test("awards account players, skips unknown ids, and is idempotent", async () => {
    const a = user();
    const b = user();
    const mem = memoryStore([a, b]);
    const h = await harness(mem.store);
    try {
      const rec = twoPlayerGame(a, b);
      expect((await postGame(h.base, rec)).status).toBe(204);
      expect(mem.games).toHaveLength(1);
      expect(mem.games[0].players.map((p) => p.userId).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      const awardA = mem.awards.find((x) => x.userId === a.id)!;
      expect(awardA.result).toMatchObject({
        eligible: true,
        played: 20,
        time: 30,
        placement: 30,
        win: 50,
        firstGame: 50,
        feats: 15,
        total: 195,
      });
      const awardB = mem.awards.find((x) => x.userId === b.id)!;
      // 5 min alive (15), second of three (15), no win, first game of the day
      expect(awardB.result).toMatchObject({
        eligible: true,
        time: 15,
        placement: 15,
        win: 0,
        firstGame: 50,
        feats: 0,
        total: 100,
      });
      expect(mem.progress.get(a.id)!.state.lifetimeXp).toBe(195);

      const before = JSON.stringify([mem.games, mem.awards, [...mem.progress]]);
      expect((await postGame(h.base, rec)).status).toBe(204);
      expect(JSON.stringify([mem.games, mem.awards, [...mem.progress]])).toBe(
        before,
      );
    } finally {
      h.close();
    }
  });

  test("a malformed record or a mismatched id is a 400", async () => {
    const mem = memoryStore([]);
    const h = await harness(mem.store);
    try {
      const rec = twoPlayerGame(user(), user());
      const bad = await fetch(`${h.base}/game/${rec.info.gameID}`, {
        method: "POST",
        headers: keyed,
        body: JSON.stringify({ info: { gameID: rec.info.gameID } }),
      });
      expect(bad.status).toBe(400);
      const wrongId = await fetch(`${h.base}/game/${gameId()}`, {
        method: "POST",
        headers: keyed,
        body: JSON.stringify(rec),
      });
      expect(wrongId.status).toBe(400);
      expect(mem.games).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  test("disputed stats and short games store the game but award nothing", async () => {
    const a = user();
    const mem = memoryStore([a]);
    const h = await harness(mem.store);
    try {
      const players = [{ id: a.id, clientID: "AAAAAAAA" }];
      const disputed = record({ players, statsAgreed: false });
      expect((await postGame(h.base, disputed)).status).toBe(204);
      const short = record({ players, seconds: 90 });
      expect((await postGame(h.base, short)).status).toBe(204);
      expect(mem.games.map((g) => g.players.length)).toEqual([1, 1]);
      expect(mem.awards.map((x) => x.result)).toEqual([
        { eligible: false, reason: "stats_disputed" },
        { eligible: false, reason: "too_short" },
      ]);
      expect(mem.progress.get(a.id)!.state.lifetimeXp).toBe(0);
      expect(mem.progress.get(a.id)!.lastXpDay).toBeNull();
    } finally {
      h.close();
    }
  });

  test("XP carries across games and levels up", async () => {
    const a = user();
    const b = user();
    const mem = memoryStore([a, b]);
    const h = await harness(mem.store);
    try {
      await postGame(h.base, twoPlayerGame(a, b));
      await postGame(h.base, twoPlayerGame(a, b));
      const [first, second] = mem.awards.filter((x) => x.userId === a.id);
      // 195 XP: level 1 needs 100, level 2 needs 104
      expect(first.levelsReached).toEqual([2]);
      expect(first.after).toMatchObject({ level: 2, xpInLevel: 95 });
      // the day bonus is once per Chicago day
      expect(second.result).toMatchObject({ firstGame: 0, total: 145 });
      expect(second.before).toEqual(first.after);
      expect(second.after.lifetimeXp).toBe(340);
      expect(second.levelsReached).toEqual([3, 4]);
    } finally {
      h.close();
    }
  });

  test("deleting the account removes its games, progress and awards", async () => {
    const a = user();
    const b = user();
    const mem = memoryStore([a, b]);
    const h = await harness(mem.store);
    try {
      await postGame(h.base, twoPlayerGame(a, b));
      await mem.store.deleteUser(a.id);
      expect(mem.progress.has(a.id)).toBe(false);
      expect(mem.awards.map((x) => x.userId)).toEqual([b.id]);
      expect(mem.games[0].players.map((p) => p.userId)).toEqual([b.id]);
    } finally {
      h.close();
    }
  });
});

describe("POST /archive_singleplayer_game", () => {
  const solo = (u: UserRow, over = {}) =>
    record({
      gameType: "Singleplayer",
      players: [{ id: u.id, clientID: "AAAAAAAA" }],
      winner: ["player", "AAAAAAAA"],
      ...over,
    });

  test("credits the caller at half XP and refuses a repeat", async () => {
    const a = user();
    const mem = memoryStore([a]);
    const h = await harness(mem.store);
    try {
      const jwt = await h.jwt(a);
      const rec = solo(a);
      expect((await postSingle(h.base, jwt, rec)).status).toBe(204);
      const award = mem.awards[0];
      // n = 1: 20 + 30 + 30 + 50 + 50 + survived 5 = 185, half of it
      expect(award.result).toMatchObject({
        eligible: true,
        gamePermille: 500,
        subtotal: 185,
        total: 92,
      });
      expect(mem.games[0]).toMatchObject({
        id: `sp:${rec.info.gameID}`,
        source: "singleplayer",
        modeBucket: "singleplayer",
      });
      expect((await postSingle(h.base, jwt, rec)).status).toBe(409);
      expect(mem.awards).toHaveLength(1);
    } finally {
      h.close();
    }
  });

  test("needs a Bearer token, and the record's player must be the caller", async () => {
    const a = user();
    const victim = user();
    const mem = memoryStore([a, victim]);
    const h = await harness(mem.store);
    try {
      expect((await postSingle(h.base, null, solo(a))).status).toBe(401);
      const jwt = await h.jwt(a);
      expect((await postSingle(h.base, jwt, solo(victim))).status).toBe(400);
      expect((await postSingle(h.base, "junk", solo(a))).status).toBe(401);
      expect(mem.games).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  test("implausible records are refused", async () => {
    const a = user();
    const mem = memoryStore([a]);
    const h = await harness(mem.store);
    try {
      const jwt = await h.jwt(a);
      for (const over of [
        { seconds: 60 },
        { seconds: 7 * 3600 },
        { numTurns: 100 },
        { gameType: "Public" },
      ]) {
        expect((await postSingle(h.base, jwt, solo(a, over))).status).toBe(400);
      }
      const twoPlayers = record({
        gameType: "Singleplayer",
        players: [
          { id: a.id, clientID: "AAAAAAAA" },
          { id: user().id, clientID: "BBBBBBBB" },
        ],
      });
      expect((await postSingle(h.base, jwt, twoPlayers)).status).toBe(400);
      expect(mem.games).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  test("refuses a record that ended over 24 hours ago", async () => {
    const a = user();
    const mem = memoryStore([a]);
    const h = await harness(mem.store);
    try {
      const jwt = await h.jwt(a);
      const old = solo(a, { endedAgoMs: 25 * 3600_000 });
      expect((await postSingle(h.base, jwt, old)).status).toBe(400);
      expect(mem.games).toHaveLength(0);
    } finally {
      h.close();
    }
  });

  test("stores at most 25 singleplayer games per user per UTC day", async () => {
    const a = user();
    const b = user();
    const mem = memoryStore([a, b]);
    const h = await harness(mem.store);
    try {
      const jwt = await h.jwt(a);
      for (let i = 0; i < 25; i++) {
        expect((await postSingle(h.base, jwt, solo(a))).status).toBe(204);
      }
      expect((await postSingle(h.base, jwt, solo(a))).status).toBe(409);
      expect(mem.awards).toHaveLength(25);
      // another account is unaffected
      expect((await postSingle(h.base, await h.jwt(b), solo(b))).status).toBe(
        204,
      );
    } finally {
      h.close();
    }
  });

  test("a singleplayer id can't block the same id from a server game", async () => {
    const a = user();
    const mem = memoryStore([a]);
    const h = await harness(mem.store);
    try {
      const id = gameId();
      const rec = solo(a, { gameID: id });
      expect((await postSingle(h.base, await h.jwt(a), rec)).status).toBe(204);
      const server = record({
        gameID: id,
        players: [{ id: a.id, clientID: "AAAAAAAA" }],
      });
      expect((await postGame(h.base, server)).status).toBe(204);
      expect(mem.games.map((g) => g.id)).toEqual([`sp:${id}`, id]);
    } finally {
      h.close();
    }
  });
});

describe.skipIf(process.env.HT_TEST_DB !== "1")("real database", () => {
  test("transactional scoring, idempotency and the delete cascade", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const names = [1, 2].map(() => "itest" + randomUUID().slice(0, 8));
    const ids: string[] = [];
    const gameIDs: string[] = [];
    const h = await harness(pgStore(pool));
    try {
      for (const name of names) {
        const r = await pool.query(
          `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at)
           VALUES ($1, $2, 'I', 'T', $3, 'x', now()) RETURNING id`,
          [generatePublicId(), name, `${name}@example.org`],
        );
        ids.push(r.rows[0].id);
      }
      const [a, b] = ids.map((id, i) => ({ ...user(names[i]), id }));
      const rec = twoPlayerGame(a, b);
      gameIDs.push(rec.info.gameID);
      expect((await postGame(h.base, rec)).status).toBe(204);
      expect((await postGame(h.base, rec)).status).toBe(204);
      const q = (sql: string) => pool.query(sql, [ids, rec.info.gameID]);
      expect(
        (
          await q(
            "SELECT * FROM game_players WHERE user_id = ANY($1) AND game_id = $2",
          )
        ).rows,
      ).toHaveLength(2);
      const aw = await q(
        "SELECT * FROM xp_awards WHERE user_id = ANY($1) AND game_id = $2",
      );
      expect(aw.rows).toHaveLength(2);
      const prog = await pool.query(
        "SELECT level, xp_in_level, lifetime_xp, to_char(last_xp_day, 'YYYY-MM-DD') AS d FROM user_progress WHERE user_id = $1",
        [a.id],
      );
      expect(prog.rows[0]).toMatchObject({ level: 2, xp_in_level: 95 });
      expect(Number(prog.rows[0].lifetime_xp)).toBe(195);
      expect(prog.rows[0].d).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // a second game the same day: no day bonus, XP and level carry over
      const rec2 = twoPlayerGame(a, b);
      gameIDs.push(rec2.info.gameID);
      await postGame(h.base, rec2);
      const after = await pool.query(
        "SELECT level, lifetime_xp FROM user_progress WHERE user_id = $1",
        [a.id],
      );
      expect(after.rows[0].level).toBe(4);
      expect(Number(after.rows[0].lifetime_xp)).toBe(340);

      await pool.query("DELETE FROM users WHERE id = $1", [a.id]);
      for (const t of ["game_players", "user_progress", "xp_awards"]) {
        const r = await pool.query(
          `SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`,
          [a.id],
        );
        expect(r.rows[0].n).toBe(0);
      }
      const left = await pool.query(
        "SELECT count(*)::int AS n FROM xp_awards WHERE user_id = $1",
        [b.id],
      );
      expect(left.rows[0].n).toBe(2);
    } finally {
      h.close();
      await pool.query("DELETE FROM games WHERE id = ANY($1)", [gameIDs]);
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
      await pool.end();
    }
  });
});
