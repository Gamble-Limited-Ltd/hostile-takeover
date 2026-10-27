import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType } from "@openfront/engine-api/game/GameTypes";
import { PartialGameRecord } from "@openfront/shared/WireSchemas";
import { createGameWireContext } from "@openfront/shared/ZbinWire";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

const archive = vi.fn(async (_record: PartialGameRecord) => {});

describe("GameServer chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    archive.mockReset();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("relays chat but never puts it in a turn, the start message or the archive", async () => {
    const A = cid("a");
    const B = cid("b");
    const game = makeGame({
      creatorPersistentID: "a-pid",
      config: { gameType: GameType.Private, maxPlayers: 2 },
      deps: { archive },
    });
    const a = makeClient({ clientID: A, persistentID: "a-pid", ip: "1.1.1.1" });
    const b = makeClient({ clientID: B, persistentID: "b-pid", ip: "2.2.2.2" });
    expect(game.joinClient(a)).toBe("joined");
    expect(game.joinClient(b)).toBe("joined");
    startGame(game);
    const ctx = createGameWireContext([{ clientID: A }, { clientID: B }]);

    await mockWsOf(a).emit({
      type: "chat",
      channel: "global",
      text: "SECRETCHATTEXT",
    });
    vi.advanceTimersByTime(300);

    const bFrames = mockWsOf(b).sent(ctx);
    const relayed = bFrames.filter((m) => m.type === "chat");
    expect(relayed).toHaveLength(1);
    expect((relayed[0] as any).text).toBe("SECRETCHATTEXT");
    // Turns went out; none carries the chat.
    const turns = bFrames.filter((m) => m.type === "turn");
    expect(turns.length).toBeGreaterThan(0);
    expect(JSON.stringify(turns)).not.toContain("SECRETCHATTEXT");

    // A rejoin replays turns in "start" and then sends the chat history.
    const again = makeMockWs();
    expect(game.rejoinClient(again as any, "b-pid", 0)).toBe(true);
    const frames = again.sent(ctx);
    const start = frames.find((m) => m.type === "start");
    expect(JSON.stringify(start)).not.toContain("SECRETCHATTEXT");
    const history = frames.find((m) => m.type === "chat_history") as any;
    expect(history.messages.map((m: any) => m.text)).toEqual([
      "SECRETCHATTEXT",
    ]);
    expect(frames.indexOf(history)).toBeGreaterThan(frames.indexOf(start!));

    const winner = {
      type: "winner" as const,
      winner: ["player", A] as any,
      allPlayersStats: {},
    };
    await mockWsOf(a).emit(winner);
    await mockWsOf(b).emit(winner);
    await game.end();
    expect(JSON.stringify(archive.mock.calls[0]?.[0])).not.toContain(
      "SECRETCHATTEXT",
    );
  });

  it("drops a spectator's chat, lets a root spectator's through, and gives mid-game joiners history", async () => {
    const game = makeGame({
      config: { gameType: GameType.Private, maxPlayers: 2 },
      deps: { archive },
    });
    const a = makeClient({ clientID: cid("a"), ip: "1.1.1.1" });
    const b = makeClient({ clientID: cid("b"), ip: "2.2.2.2" });
    game.joinClient(a);
    game.joinClient(b);
    startGame(game);
    const spec = makeClient({
      clientID: cid("spec"),
      spectator: true,
      ip: "3.3.3.3",
    });
    const root = makeClient({
      clientID: cid("root"),
      spectator: true,
      role: "root",
      ip: "4.4.4.4",
    });
    game.joinClient(spec);
    game.joinClient(root);
    await mockWsOf(spec).emit({
      type: "chat",
      channel: "global",
      text: "nope",
    });
    await mockWsOf(root).emit({ type: "chat", channel: "global", text: "yes" });
    const texts = (c: typeof a) =>
      mockWsOf(c)
        .sent()
        .filter((m) => m.type === "chat")
        .map((m: any) => m.text);
    expect(texts(a)).toEqual(["yes"]);

    const late = makeClient({
      clientID: cid("late"),
      spectator: true,
      ip: "5.5.5.5",
    });
    game.joinClient(late);
    const hist = mockWsOf(late)
      .sent()
      .find((m) => m.type === "chat_history") as any;
    expect(hist.messages.map((m: any) => m.text)).toEqual(["yes"]);
  });
});
