// @vitest-environment node
import { NewsItemSchema } from "@openfront/shared/ApiSchemas";
import { ReservedClanTagsResponseSchema } from "@openfront/shared/ClanApiSchemas";
import { CosmeticsSchema } from "@openfront/shared/CosmeticSchemas";
import {
  pickServerForBuild,
  ServerListSchema,
} from "@openfront/shared/ServerList";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../packages/api/src/app";
import { censorPlayer as apiCensor } from "../../packages/api/src/censor";
import { isLoopbackHost, readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import type { Store } from "../../packages/api/src/store";
import newsFile from "../../resources/news.json";
import { censorPlayer as serverCensor } from "../../src/server/Censor";
import { sendCheckin } from "../../src/server/ClusterCheckin";
import { fetchCustomTribes } from "../../src/server/CustomTribes";
import { verifyJoin } from "../../src/server/JoinVerify";
import { ServerEnv } from "../../src/server/ServerEnv";

const KEY = "secret";
const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
  API_KEY: KEY,
  HT_GAME_HOST: "game.test:3400",
  HT_GAME_VERSION: "abcdef1",
});

let base = "";
let close: () => void;

beforeAll(async () => {
  const keys = await keysFromPem(generatePrivateKeyPem());
  const ctx = { env, keys, store: {} as Store };
  const server = createApp({ query: async () => ({}) }, ctx).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  // The real server-side callers read the API URL and key from ServerEnv.
  vi.spyOn(ServerEnv, "jwtIssuer").mockReturnValue(base);
  vi.spyOn(ServerEnv, "apiKey").mockReturnValue(KEY);
});
afterAll(() => {
  vi.restoreAllMocks();
  close();
});

const json = { "content-type": "application/json" };
const keyed = { ...json, "x-api-key": KEY };
const post = (path: string, headers: Record<string, string>, body = "{}") =>
  fetch(base + path, { method: "POST", headers, body });

describe("server callers parse the real responses", () => {
  test("join_verify: verifyJoin() approves and censors like the server's Censor", async () => {
    const ok = await verifyJoin("1.2.3.4", null, "Alice", "abc");
    expect(ok).toEqual({
      status: "approved",
      username: "Alice",
      clanTag: "ABC",
    });
    const bad = await verifyJoin("1.2.3.4", null, "xXniggerXx", "hit");
    expect(bad).toEqual({
      status: "approved",
      ...serverCensor("xXniggerXx", "hit"),
    });
    expect((bad as { username: string }).username).not.toBe("xXniggerXx");
  });

  test("the API's censor copy agrees with src/server/Censor", () => {
    const cases: [string, string | null][] = [
      ["Alice", null],
      ["Alice", "ss"],
      ["xXfaggotXx", "ab"],
      ["niiiigger", null],
      ["n.i.g.g.e.r", "x"],
      ["LER", "HIT"],
      ["fine", "kkk"],
      ["Bob", "tag"],
    ];
    for (const [u, t] of cases)
      expect(apiCensor(u, t)).toEqual(serverCensor(u, t));
  });

  test("custom_tribes: fetchCustomTribes() gets an empty pool", async () => {
    await expect(fetchCustomTribes([])).resolves.toEqual([]);
  });

  test("cluster/checkin: sendCheckin() reads 'open'", async () => {
    const body = {
      site: "localhost",
      letter: "a",
      host: env.gameHost,
      version: "abcdef1",
      numWorkers: 2,
      liveGames: 0,
    };
    await expect(sendCheckin(body)).resolves.toBe("open");
  });

  test("cosmetics.json and reserved_clan_tags parse (PrivilegeRefresher, Cosmetics.ts)", async () => {
    const c = CosmeticsSchema.parse(
      await (await fetch(base + "/cosmetics.json")).json(),
    );
    expect(c.patterns).toEqual({});
    expect(c.flags).toEqual({});
    const tags = ReservedClanTagsResponseSchema.parse(
      await (await fetch(base + "/reserved_clan_tags")).json(),
    );
    expect(tags).toEqual([]);
  });

  test("news.json is the bundled file and parses as NewsItem[] (getNews)", async () => {
    const res = await fetch(base + "/news.json");
    expect(res.status).toBe(200);
    const items = z.array(NewsItemSchema).parse(await res.json());
    expect(items.length).toBeGreaterThan(0);
    expect(items).toEqual(newsFile);
  });

  test("cluster.json parses as the client's ServerList and picks server a", async () => {
    const res = await fetch(base + "/cluster.json?site=localhost");
    const list = ServerListSchema.parse(await res.json());
    expect(list.servers.a).toMatchObject({
      host: "game.test:3400",
      numWorkers: 2,
      state: "open",
    });
    expect(pickServerForBuild(list, "abcdef1234", () => 0)).toBe("a");
    expect(pickServerForBuild(list, "DEV", () => 0)).toBe("a");
  });

  test("cluster.json is 404 for a loopback game host (default env)", async () => {
    const dev = readEnv({ API_KEY: KEY });
    expect(dev.gameHost).toBe("localhost:3400");
    const keys = await keysFromPem(generatePrivateKeyPem());
    const server = createApp(
      { query: async () => ({}) },
      { env: dev, keys, store: {} as Store },
    ).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/cluster.json?site=x`);
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });

  test("isLoopbackHost only matches loopback names", () => {
    for (const h of [
      "localhost",
      "LocalHost:3400",
      "127.0.0.1",
      "127.0.0.1:3400",
      "::1",
      "[::1]",
      "[::1]:3400",
    ]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of [
      "game.test:3400",
      "hostile-takeover.taps-holdings.org",
      "localhost.evil.org",
      "10.0.0.5:3400",
    ]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });
});

describe("x-api-key on server-only routes", () => {
  const serverOnly = [
    "/join_verify",
    "/custom_tribes",
    "/cluster/checkin",
    "/game/abc12345",
  ];
  test.each(serverOnly)("%s refuses a missing or wrong key", async (path) => {
    expect((await post(path, json)).status).toBe(401);
    expect((await post(path, { ...json, "x-api-key": "nope" })).status).toBe(
      401,
    );
  });

  test("an empty API_KEY never matches", async () => {
    const keys = await keysFromPem(generatePrivateKeyPem());
    const app = createApp(
      { query: async () => ({}) },
      { env: { ...env, apiKey: "" }, keys, store: {} as Store },
    ).listen(0, "127.0.0.1");
    await new Promise((r) => app.once("listening", r));
    try {
      const b = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
      const res = await fetch(b + "/cluster/checkin", {
        method: "POST",
        headers: { ...json, "x-api-key": "" },
        body: "{}",
      });
      expect(res.status).toBe(401);
    } finally {
      app.close();
    }
  });

  test("join_verify rejects a malformed body", async () => {
    expect((await post("/join_verify", keyed, "{}")).status).toBe(400);
  });
});

describe("every Stage 1.4 route, in process", () => {
  const table: [string, string, Record<string, string>, string, number][] = [
    ["POST", "/join_verify", keyed, '{"username":"a","clanTag":null}', 200],
    ["GET", "/cosmetics.json", {}, "", 200],
    ["GET", "/reserved_clan_tags", {}, "", 200],
    ["POST", "/custom_tribes", keyed, '{"players":[]}', 200],
    ["GET", "/cluster.json?site=localhost", {}, "", 200],
    ["POST", "/cluster/checkin", keyed, "{}", 200],
    ["POST", "/game/abc12345", keyed, '{"info":{}}', 204],
    ["GET", "/game/abc12345", {}, "", 404],
    [
      "POST",
      "/archive_singleplayer_game",
      { authorization: "Bearer x" },
      "zz",
      204,
    ],
    ["POST", "/matchmaking/checkin", keyed, "{}", 404],
    ["POST", "/users/@me/lobby_queue", keyed, "{}", 404],
    ["GET", "/public/player/abc/progress", {}, "", 404],
    ["GET", "/public/progression/config", {}, "", 404],
    ["GET", "/public/clans/leaderboard", {}, "", 404],
    ["GET", "/friends", {}, "", 404],
    ["GET", "/users/@me/xp/abc12345", {}, "", 404],
    ["POST", "/users/@me/prestige", {}, "", 404],
  ];
  test.each(table)(
    "%s %s -> %i",
    async (method, path, headers, body, status) => {
      const res = await fetch(base + path, {
        method,
        headers,
        body: method === "POST" ? body : undefined,
      });
      expect(res.status).toBe(status);
    },
  );
});
