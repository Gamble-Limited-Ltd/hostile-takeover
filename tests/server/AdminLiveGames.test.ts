import { GameType } from "@openfront/engine-api/game/GameTypes";
import { AdminLiveGamesSchema } from "@openfront/shared/HtAdminSchemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyClientToken } = vi.hoisted(() => ({
  verifyClientToken: vi.fn(),
}));
vi.mock("../../src/server/jwt", () => ({ verifyClientToken }));

import { registerAdminLiveGames } from "../../src/server/AdminLiveGames";
import { GameManager } from "../../src/server/GameManager";
import {
  cid,
  makeClient,
  makeGame,
  startGame,
} from "../util/GameServerHarness";

function setup(games: ReturnType<typeof makeGame>[]) {
  let handler: (req: any, res: any) => Promise<void> = async () => {};
  const app: any = {
    get(path: string, h: any) {
      expect(path).toBe("/api/admin/live_games");
      handler = h;
    },
  };
  const gm = { startedGames: () => games } as unknown as GameManager;
  registerAdminLiveGames({ app, gm });
  return async (authorization?: string) => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(c: number) {
        res.statusCode = c;
        return res;
      },
      json(b: unknown) {
        res.body = b;
        return res;
      },
    };
    await handler({ headers: { authorization } }, res);
    return res;
  };
}

function publicGame(id: string) {
  const g = makeGame({ id: cid(id), config: { gameType: GameType.Public } });
  g.joinClient(makeClient({ clientID: cid(id + "p"), username: "alice" }));
  startGame(g);
  return g;
}

beforeEach(() => {
  verifyClientToken.mockReset();
  vi.useFakeTimers();
});

describe("GET /api/admin/live_games", () => {
  it("401 without a token or with a bad one", async () => {
    const call = setup([]);
    expect((await call()).statusCode).toBe(401);
    verifyClientToken.mockResolvedValue({ type: "error", message: "x" });
    expect((await call("Bearer bad")).statusCode).toBe(401);
  });

  it.each(["admin", null, undefined])("403 for role %s", async (role) => {
    verifyClientToken.mockResolvedValue({
      type: "success",
      persistentId: "p",
      claims: role === undefined ? null : { role },
    });
    expect((await setup([])("Bearer t")).statusCode).toBe(403);
  });

  it("200 for root with the listed fields, schema-valid", async () => {
    verifyClientToken.mockResolvedValue({
      type: "success",
      persistentId: "p",
      claims: { role: "root" },
    });
    const res = await setup([publicGame("live")])("Bearer t");
    expect(res.statusCode).toBe(200);
    const parsed = AdminLiveGamesSchema.parse(res.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      gameID: cid("live"),
      gameType: GameType.Public,
      tick: 0,
      bots: [],
    });
    expect(parsed[0].map).toBeTruthy();
    expect(parsed[0].mode).toBeTruthy();
    expect(parsed[0].startedAt).toBeGreaterThan(0);
    expect(parsed[0].players).toEqual([
      { name: "alice", clientID: cid("livep") },
    ]);
  });
});

describe("GameManager.startedGames", () => {
  it("lists every started, not-ended game, private ones too", () => {
    const gm = new GameManager({
      info() {},
      warn() {},
      debug() {},
      error() {},
    } as any);
    const games = (gm as any).games as Map<string, any>;
    const started = publicGame("a");
    const lobby = makeGame({
      id: cid("b"),
      config: { gameType: GameType.Public },
    });
    const priv = makeGame({ id: cid("c") });
    priv.joinClient(makeClient());
    startGame(priv);
    for (const g of [started, lobby, priv]) games.set(g.id, g);
    expect(gm.startedGames().map((g) => g.id)).toEqual([cid("a"), cid("c")]);
  });
});
