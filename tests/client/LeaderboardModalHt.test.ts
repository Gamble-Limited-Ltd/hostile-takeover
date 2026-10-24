import { beforeEach, describe, expect, it, vi } from "vitest";

// Hostile Takeover: with Features.ranked off (the real value) the modal offers
// only our XP / wins / games / win-rate tabs.

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => false),
  fetchPlayerLeaderboard: vi.fn(async () => false),
  fetchTribeLeaderboard: vi.fn(async () => false),
}));
vi.mock("../../src/client/ClanApi", () => ({
  fetchClanLeaderboard: vi.fn(async () => false),
}));
vi.mock("../../src/client/HtLeaderboardApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/client/HtLeaderboardApi")
  >()),
  fetchHtLeaderboard: vi.fn(async () => [
    {
      rank: 1,
      publicId: "abc",
      username: "ann",
      flag: "country:us",
      level: 4,
      prestige: 0,
      lifetimeXp: 700,
      games: 12,
      wins: 6,
      winRate: 0.5,
    },
  ]),
}));

import "../../src/client/LeaderboardModal";
import type { LeaderboardModal } from "../../src/client/LeaderboardModal";

type Internals = {
  activeTab: string;
  modalConfig(): { tabs: { key: string; label: string }[] };
};

describe("LeaderboardModal (ranked off)", () => {
  let modal: LeaderboardModal;
  beforeEach(async () => {
    document.body.innerHTML = "";
    modal = document.createElement("leaderboard-modal") as LeaderboardModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  it("offers the four HT tabs and defaults to Level / XP", () => {
    const i = modal as unknown as Internals;
    expect(i.modalConfig().tabs.map((t) => t.key)).toEqual([
      "htXp",
      "htWins",
      "htGames",
      "htWinrate",
    ]);
    expect(i.activeTab).toBe("htXp");
  });

  it("renders one list per tab, shows only the active one, and badges the row", async () => {
    const lists = modal.querySelectorAll(
      "leaderboard-player-list[data-ht-tab]",
    );
    expect(lists).toHaveLength(4);
    const active = modal.querySelector(
      'leaderboard-player-list[data-ht-tab="htXp"]',
    ) as HTMLElement & {
      ensureLoaded(): Promise<void>;
      updateComplete: Promise<unknown>;
    };
    expect(active.className).toContain("h-full");
    await active.ensureLoaded();
    await active.updateComplete;
    expect(active.querySelector("level-badge")).not.toBeNull();
    expect(active.querySelector('img[src$="flags/us.svg"]')).not.toBeNull();
    expect(active.textContent).toContain("leaderboard_modal.xp");
    expect(active.textContent).toContain("700");
  });
});
