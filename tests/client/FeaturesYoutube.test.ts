import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

// Slice 3.6a: YouTube embeds and the achievements toggle are hidden by
// default. This file runs against the real (all-off) Features.

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
  prewarmCosmetics: vi.fn(),
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));
vi.mock("../../src/client/UserMeBroadcast", () => ({
  lastUserMeResponse: () => null,
}));
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { Features } from "../../src/client/Features";
import "../../src/client/HelpModal";
import "../../src/client/hud/layers/WinModal";
import "../../src/client/SinglePlayerModal";

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("Slice 3.6a switches", () => {
  it("youtube defaults to off", () => {
    expect(Features.youtube).toBe(false);
  });

  it("the Help modal renders no iframe", async () => {
    const el = document.createElement("help-modal") as Mountable;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.innerHTML).not.toContain("youtube");
  });

  it("the loser's end box has no YouTube embed", () => {
    localStorage.setItem("gamesPlayed", "0");
    const el = document.createElement("win-modal") as any;
    el.isWin = false;
    const host = document.createElement("div");
    render(el.innerHtml(), host);
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.innerHTML).not.toContain("youtube");
  });

  it("the SOLO modal has no achievements toggle with xp off", async () => {
    const el = document.createElement("single-player-modal") as Mountable;
    document.body.appendChild(el);
    await el.updateComplete;
    const html = el.innerHTML;
    expect(html).not.toContain("MedalIconWhite");
    expect(html.toLowerCase()).not.toContain("achievements");
  });
});
