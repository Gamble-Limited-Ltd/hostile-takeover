import { afterEach, describe, expect, it, vi } from "vitest";

const { userAuth, getAuthHeader } = vi.hoisted(() => ({
  userAuth: vi.fn(),
  getAuthHeader: vi.fn(async () => "Bearer tok"),
}));
vi.mock("../../src/client/Auth", () => ({ getAuthHeader, userAuth }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    numWorkers: () => 2,
    serverHttpBase: () => "https://srv",
    gameNavigateBase: () => "https://srv",
    gamePath: (id: string) => `/w1/game/${id}`,
  },
}));

import { AdminLiveGamesCard } from "../../src/client/components/account/AdminLiveGamesCard";

const game = (gameID: string, extra = {}) => ({
  gameID,
  map: "World",
  mode: "Free For All",
  gameType: "Public",
  startedAt: Date.now() - 120_000,
  tick: 10,
  players: [{ name: "a", clientID: "c1" }],
  bots: [],
  ...extra,
});

describe("admin-live-games-card", () => {
  let el: AdminLiveGamesCard;

  async function mount(role?: string) {
    userAuth.mockResolvedValue(
      role === undefined ? false : { claims: { role } },
    );
    if (!customElements.get("admin-live-games-card")) {
      customElements.define("admin-live-games-card", AdminLiveGamesCard);
    }
    el = document.createElement("admin-live-games-card") as AdminLiveGamesCard;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
  afterEach(() => {
    el.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([undefined, "admin"])("is hidden for role %s", async (role) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount(role);
    expect(el.innerHTML).not.toContain("admin.live_games");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("merges games from every worker and spectates on click", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: unknown) => ({
      ok: true,
      json: async () =>
        url.includes("/w0/") ? [game("GAME0000")] : [game("GAME1111")],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const loc = { href: "" };
    vi.stubGlobal("location", loc);
    await mount("root");
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://srv/w0/api/admin/live_games",
      "https://srv/w1/api/admin/live_games",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer tok" },
    });
    const buttons = el.querySelectorAll<HTMLElement>("[data-spectate]");
    expect(buttons).toHaveLength(2);
    el.querySelector<HTMLElement>('[data-spectate="GAME1111"]')!.click();
    expect(loc.href).toBe("https://srv/w1/game/GAME1111?spectate");
  });
});
