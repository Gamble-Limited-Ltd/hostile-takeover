import { GameType } from "@openfront/engine-api/game/GameTypes";
import { PartialGameRecord } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuditEntry } from "../../src/server/AdminTakeover";
import { authorizeIntent } from "../../src/server/IntentAuthorization";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

const ALICE = cid("alice");
const BOB = cid("bob");
const CAROL = cid("carol");
const ROOT = cid("root");
const TARGET = "nation01";

const takeover = {
  type: "intent",
  intent: { type: "admin_takeover", targetPlayerID: TARGET, name: "forged" },
} as const;

describe("admin_takeover (server)", () => {
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;
  let audit: ReturnType<typeof vi.fn<(e: AdminAuditEntry) => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    archive = vi.fn(async () => {});
    audit = vi.fn(async () => {});
    delete process.env.HT_ADMIN_TAKEOVER;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.HT_ADMIN_TAKEOVER;
  });

  function started(type: GameType = GameType.Public) {
    const game = makeGame({
      config: { gameType: type, maxPlayers: 3 },
      deps: { archive, audit },
    });
    const players = [ALICE, BOB, CAROL].map((id, i) =>
      makeClient({ clientID: id, ip: `${i + 1}.1.1.1` }),
    );
    players.forEach((p) => game.joinClient(p));
    startGame(game);
    return { game, players };
  }

  function rootSpectator(
    game: ReturnType<typeof started>["game"],
    role = "root",
  ) {
    const c = makeClient({ clientID: ROOT, role, username: "bossname" });
    game.joinClient(c);
    return c;
  }

  const queued = (game: object) =>
    (
      game as unknown as { intents: { type: string; name?: string }[] }
    ).intents.filter((i) => i.type === "admin_takeover");

  it("accepts a root spectator, overwrites the name, flips spectator, audits", async () => {
    const { game } = started();
    const root = rootSpectator(game);
    expect(root.spectator).toBe(true);
    await mockWsOf(root).emit(takeover);
    expect(queued(game)).toHaveLength(1);
    expect(queued(game)[0].name).toBe("bossname");
    expect(root.spectator).toBe(false);
    expect(audit).toHaveBeenCalledWith({
      actor: "bossname",
      action: "takeover",
      target: game.id,
      detail: { targetPlayerID: TARGET },
    });
  });

  it("refuses a second takeover", async () => {
    const { game } = started();
    const root = rootSpectator(game);
    await mockWsOf(root).emit(takeover);
    root.spectator = true; // even if it somehow spectated again
    await mockWsOf(root).emit(takeover);
    expect(queued(game)).toHaveLength(1);
  });

  it("refuses non-root and admin roles", async () => {
    const { game } = started();
    const admin = rootSpectator(game, "admin");
    await mockWsOf(admin).emit(takeover);
    const plain = makeClient({ clientID: cid("plain"), role: null });
    game.joinClient(plain);
    await mockWsOf(plain).emit(takeover);
    expect(queued(game)).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("accepts private games too", async () => {
    const { game } = started(GameType.Private);
    const root = rootSpectator(game);
    await mockWsOf(root).emit(takeover);
    expect(queued(game)).toHaveLength(1);
  });

  it("refuses when HT_ADMIN_TAKEOVER=off", async () => {
    process.env.HT_ADMIN_TAKEOVER = "off";
    const { game } = started();
    const root = rootSpectator(game);
    await mockWsOf(root).emit(takeover);
    expect(queued(game)).toHaveLength(0);
  });

  it("refuses a sender who is not a spectator or is in the roster", async () => {
    const game = makeGame({
      config: { gameType: GameType.Public, maxPlayers: 3 },
      deps: { archive, audit },
    });
    const rootPlayer = makeClient({ clientID: ROOT, role: "root" });
    game.joinClient(rootPlayer);
    game.joinClient(makeClient({ clientID: BOB, ip: "2.1.1.1" }));
    startGame(game);
    // In the roster and not a spectator.
    await mockWsOf(rootPlayer).emit(takeover);
    expect(queued(game)).toHaveLength(0);
    // In the roster, even if flagged as a spectator.
    rootPlayer.spectator = true;
    await mockWsOf(rootPlayer).emit(takeover);
    expect(queued(game)).toHaveLength(0);
  });

  it("refuses before the game has started and after it ended", () => {
    const base = {
      isPublic: true,
      isListed: false,
      isQueued: false,
      hasStarted: true,
    };
    const actor = {
      clientID: ROOT,
      isLobbyCreator: false,
      isAdmin: true,
      isAdminBot: false,
      isRoot: true,
      isSpectator: true,
      inRoster: false,
    };
    const intent = {
      type: "admin_takeover",
      targetPlayerID: TARGET,
    } as const;
    expect(authorizeIntent(intent, actor, base)).toBeNull();
    expect(
      authorizeIntent(intent, actor, { ...base, hasStarted: false })?.status,
    ).toBe(409);
    expect(
      authorizeIntent(intent, actor, { ...base, hasEnded: true })?.status,
    ).toBe(409);
  });

  it("flags the archive record with htTakeover and not otherwise", async () => {
    const { game, players } = started();
    const root = rootSpectator(game);
    await mockWsOf(root).emit(takeover);
    for (const c of [...players, root]) {
      await mockWsOf(c).emit({
        type: "winner",
        winner: ["player", ALICE],
        allPlayersStats: {},
      });
    }
    expect(archive).toHaveBeenCalledTimes(1);
    expect(
      (archive.mock.calls[0][0] as unknown as Record<string, unknown>)
        .htTakeover,
    ).toBe(true);

    archive.mockClear();
    const plain = started();
    for (const c of plain.players) {
      await mockWsOf(c).emit({
        type: "winner",
        winner: ["player", ALICE],
        allPlayersStats: {},
      });
    }
    expect(archive).toHaveBeenCalledTimes(1);
    expect(
      (archive.mock.calls[0][0] as unknown as Record<string, unknown>)
        .htTakeover,
    ).toBeUndefined();
  });
});
