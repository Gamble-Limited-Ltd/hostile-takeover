import {
  PartialGameRecord,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatEnv } from "../../src/server/ChatEnv";
import { ChatRelay } from "../../src/server/ChatRelay";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  createBlocked,
  refreshSiteStatus,
  resetSiteStatus,
  siteStatus,
} from "../../src/server/SiteStatus";
import {
  cid,
  makeClient,
  makeGame,
  startGame,
} from "../util/GameServerHarness";

vi.mock("../../src/server/PollingLoop", () => ({ startPolling: vi.fn() }));

const SUB = "00000000-0000-4000-8000-000000000001";
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown, ok = true) =>
  fetchMock.mockResolvedValue({ ok, json: async () => body });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DOMAIN", "localhost");
  resetSiteStatus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ChatEnv.moderation (join lookup)", () => {
  it("reports a ban and a mute from one request", async () => {
    reply({
      banned: true,
      mutedUntil: new Date(Date.now() + 60_000).toISOString(),
      shadow: true,
    });
    const m = await ChatEnv.moderation(SUB);
    expect(m.banned).toBe(true);
    expect(m.mute?.shadow).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("allows a clean account", async () => {
    reply({ banned: false, mutedUntil: null, shadow: false });
    expect(await ChatEnv.moderation(SUB)).toEqual({
      banned: false,
      mute: null,
    });
  });
  it("fails open when the API is down or errors", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    expect((await ChatEnv.moderation(SUB)).banned).toBe(false);
    reply({}, false);
    expect((await ChatEnv.moderation(SUB)).banned).toBe(false);
  });
});

describe("SiteStatus", () => {
  it("defaults to no banner and no maintenance", () => {
    expect(siteStatus()).toEqual({ banner: null, maintenance: false });
  });
  it("caches the polled value and keeps it when the poll fails", async () => {
    reply({ banner: "hi", maintenance: true });
    await refreshSiteStatus();
    expect(siteStatus()).toEqual({ banner: "hi", maintenance: true });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/public\/site-status$/,
    );
    fetchMock.mockRejectedValue(new Error("down"));
    await refreshSiteStatus();
    reply({}, false);
    await refreshSiteStatus();
    expect(siteStatus()).toEqual({ banner: "hi", maintenance: true });
  });
  it("blocks create_game for everyone but root while on", async () => {
    expect(createBlocked(undefined)).toBe(false);
    reply({ banner: null, maintenance: true });
    await refreshSiteStatus();
    expect(createBlocked(undefined)).toBe(true);
    expect(createBlocked("mod")).toBe(true);
    expect(createBlocked("root")).toBe(false);
  });
});

describe("public lobby scheduler under maintenance", () => {
  it("skips creating lobbies while on, resumes after", async () => {
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    const worker = Object.assign(new EventEmitter(), { send: vi.fn() });
    const service = new MasterLobbyService(
      { gameConfig: vi.fn(async () => ({})) } as any,
      { info: vi.fn(), error: vi.fn() } as any,
    );
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
    const task = vi
      .mocked(startPolling)
      .mock.calls.find(([, ms]) => ms === 1000)![0];
    const created = () =>
      worker.send.mock.calls.filter(([m]) => m.type === "createGame").length;

    reply({ banner: null, maintenance: true });
    await refreshSiteStatus();
    await task();
    expect(created()).toBe(0);

    reply({ banner: null, maintenance: false });
    await refreshSiteStatus();
    await task();
    expect(created()).toBeGreaterThan(0);
  });
});

describe("ChatRelay /endgame and /unranked", () => {
  const setup = () => {
    const ended: string[] = [];
    const sent: ServerMessage[] = [];
    const root = makeClient({
      clientID: cid("boss"),
      username: "boss",
      role: "root",
    });
    const other = makeClient({ clientID: cid("a"), username: "a" });
    const relay = new ChatRelay({
      recipients: () => [root, other],
      send: (_c, m) => sent.push(m),
      turn: () => 1,
      kick: () => {},
      gameId: () => "game1",
      endGame: () => ended.push("end"),
      markUnranked: () => ended.push("unranked"),
    });
    const say = (c: typeof root, text: string) =>
      relay.handle(c, { type: "chat", channel: "global", text });
    return { ended, sent, root, other, say };
  };
  const audits = () =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

  it("run the hooks for root and are audited", () => {
    fetchMock.mockResolvedValue({ ok: true });
    const { ended, root, say } = setup();
    say(root, "/endgame");
    say(root, "/unranked");
    expect(ended).toEqual(["end", "unranked"]);
    expect(audits()).toEqual([
      { actor: "boss", action: "end_game", target: "game1" },
      { actor: "boss", action: "game_unranked", target: "game1" },
    ]);
  });

  it("are plain text for everyone else", () => {
    fetchMock.mockResolvedValue({ ok: true });
    const { ended, sent, other, say } = setup();
    say(other, "/endgame");
    say(other, "/unranked");
    expect(ended).toEqual([]);
    expect(sent.filter((m) => m.type === "chat")).toHaveLength(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GameServer.endGame / markUnranked", () => {
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;
  beforeEach(() => {
    vi.useFakeTimers();
    archive = vi.fn(async () => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  const started = () => {
    const game = makeGame({
      config: { maxPlayers: 3 },
      deps: { archive },
    });
    const players = ["a", "b"].map((n, i) =>
      makeClient({ clientID: cid(n), ip: `${i + 1}.1.1.1` }),
    );
    players.forEach((p) => game.joinClient(p));
    startGame(game);
    return { game, players };
  };
  const body = () => archive.mock.calls[0][0] as unknown as Record<string, any>;

  it("kicks everyone, ends the game and archives it unranked with no winner", async () => {
    const { game, players } = started();
    game.endGame();
    for (const p of players) {
      expect(p.ws.close).toHaveBeenCalled();
    }
    const frames = vi
      .mocked(players[0].ws.send)
      .mock.calls.map(([f]) => Buffer.from(f as Uint8Array).toString("latin1"));
    expect(frames.some((f) => f.includes("kick_reason.admin_ended"))).toBe(
      true,
    );
    await game.end();
    await vi.runAllTimersAsync();
    expect(archive).toHaveBeenCalledTimes(1);
    expect(body().htUnranked).toBe(true);
    expect(body().info.winner).toBeUndefined();
  });

  it("markUnranked flags the archive", async () => {
    const { game } = started();
    game.markUnranked();
    await game.end();
    await vi.runAllTimersAsync();
    expect(body().htUnranked).toBe(true);
  });

  it("a normal game has no flag", async () => {
    const { game } = started();
    await game.end();
    await vi.runAllTimersAsync();
    expect(body().htUnranked).toBeUndefined();
  });
});
