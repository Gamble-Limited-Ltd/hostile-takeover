import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost", apiUrl: () => undefined },
}));

import {
  HT_LEADERBOARD_SORTS,
  type HtLeaderboardEntry,
} from "@openfront/shared/HtLeaderboardSchemas";
import {
  fetchHtLeaderboard,
  HT_LEADERBOARD_TABS,
  htLeaderboardValue,
} from "../../src/client/HtLeaderboardApi";

const entry: HtLeaderboardEntry = {
  rank: 1,
  publicId: "abc",
  username: "u",
  flag: null,
  level: 3,
  prestige: 0,
  lifetimeXp: 400,
  games: 8,
  wins: 5,
  winRate: 0.625,
};

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("HT leaderboard tabs", () => {
  it("cover each API sort once", () => {
    expect(Object.values(HT_LEADERBOARD_TABS).map((t) => t.sort)).toEqual([
      ...HT_LEADERBOARD_SORTS,
    ]);
  });

  it("show XP on the XP tab and wins on the others", () => {
    expect(htLeaderboardValue("xp", entry)).toBe(400);
    expect(htLeaderboardValue("wins", entry)).toBe(5);
    expect(htLeaderboardValue("games", entry)).toBe(5);
    expect(htLeaderboardValue("winrate", entry)).toBe(5);
  });
});

describe("fetchHtLeaderboard", () => {
  const reply = (body: unknown, ok = true) =>
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok,
      json: async () => body,
    });

  it("returns parsed entries and asks for the sort and page", async () => {
    reply({ sort: "wins", page: 2, entries: [entry] });
    expect(await fetchHtLeaderboard("wins", 2)).toEqual([entry]);
    expect(
      String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]),
    ).toContain("/public/leaderboard/players?sort=wins&page=2");
  });

  it("returns false on a bad status or body", async () => {
    reply({}, false);
    expect(await fetchHtLeaderboard("xp", 1)).toBe(false);
    reply({ nope: 1 });
    expect(await fetchHtLeaderboard("xp", 1)).toBe(false);
  });
});
