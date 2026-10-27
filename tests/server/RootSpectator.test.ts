import { GameType } from "@openfront/engine-api/game/GameTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cid,
  makeClient,
  makeGame,
  startGame,
} from "../util/GameServerHarness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("root spectator", () => {
  it("is absent from lobby info, a normal spectator stays", () => {
    const g = makeGame({ config: { gameType: GameType.Public } });
    g.joinClient(makeClient({ clientID: cid("p1") }));
    g.joinClient(
      makeClient({ clientID: cid("root"), role: "root", spectator: true }),
    );
    g.joinClient(makeClient({ clientID: cid("spec"), spectator: true }));
    expect(g.gameInfo().clients?.map((c) => c.clientID)).toEqual([
      cid("p1"),
      cid("spec"),
    ]);
    expect(g.numPlayers()).toBe(1);
  });

  it("a root player (non-spectator) is still listed", () => {
    const g = makeGame({ config: { gameType: GameType.Public } });
    g.joinClient(makeClient({ clientID: cid("root"), role: "root" }));
    expect(g.gameInfo().clients).toHaveLength(1);
  });

  it("joins a started public game as a spectator, even inside the late-join grace", () => {
    const g = makeGame({ config: { gameType: GameType.Public } });
    g.joinClient(makeClient({ clientID: cid("p1") }));
    startGame(g);
    const root = makeClient({ clientID: cid("root"), role: "root" });
    expect(g.joinClient(root)).toBe("joined");
    expect(root.spectator).toBe(true);
    expect(g.gameInfo().clients?.map((c) => c.clientID)).toEqual([cid("p1")]);
  });
});
