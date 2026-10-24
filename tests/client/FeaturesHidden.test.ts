import { beforeEach, describe, expect, it, vi } from "vitest";

// Slice 3.5: every API-only feature is hidden by default. This file runs
// against the real (all-off) Features and checks the entry points.

const { getStreams, getAuthHeader } = vi.hoisted(() => ({
  getStreams: vi.fn(),
  getAuthHeader: vi.fn(async () => "Bearer t"),
}));
vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getStreams,
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getAuthHeader,
}));

import type { NewsItem } from "@openfront/shared/ApiSchemas";
import newsItems from "../../resources/news.json";
import "../../src/client/components/DesktopNavBar";
import { Footer } from "../../src/client/components/Footer";
import "../../src/client/components/MobileNavBar";
import { filterNewsByFeatures } from "../../src/client/components/NewsBox";
import { Features } from "../../src/client/Features";
import {
  fetchMyGameXp,
  fetchProgressionConfig,
  fetchPublicPlayerProgress,
  prestigeMe,
} from "../../src/client/ProgressionApi";
import { streamsFeed } from "../../src/client/StreamsFeed";

const SWITCHES = [
  "xp",
  "ranked",
  "clans",
  "friends",
  "profile",
  "stream",
  "steam",
  "discord",
  "upstreamSocials",
] as const;

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };
async function mount(tag: string): Promise<Mountable> {
  const el = document.createElement(tag) as Mountable;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const isHidden = (el: Element | null): boolean =>
  el !== null && el.closest("[hidden]") !== null;

describe("Slice 3.5 switches", () => {
  it("exist and default to off", () => {
    for (const name of SWITCHES) expect(Features[name]).toBe(false);
    expect(Features.usernameChange).toBe(true);
    expect(Features.leaderboard).toBe(true);
  });
});

describe("nav bars", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.currentPageId = "page-play";
  });
  for (const tag of ["desktop-nav-bar", "mobile-nav-bar"]) {
    it(`${tag} hides CLANS but keeps PLAY and INVENTORY`, async () => {
      const bar = await mount(tag);
      const page = (id: string) => bar.querySelector(`[data-page="${id}"]`);
      expect(isHidden(page("page-leaderboard"))).toBe(false);
      expect(isHidden(page("page-clan"))).toBe(true);
      expect(isHidden(page("page-play"))).toBe(false);
      expect(isHidden(page("page-inventory"))).toBe(false);
    });
  }
});

describe("footer", () => {
  it("has no Discord icon and a hidden Steam banner", async () => {
    if (!customElements.get("page-footer")) {
      customElements.define("page-footer", Footer);
    }
    document.body.innerHTML = "";
    const footer = (await mount("page-footer")) as Mountable;
    const hrefs = Array.from(footer.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((h) => h?.includes("discord"))).toBe(false);
    // The only OpenFront GitHub link is the attribution's "Based on OpenFront".
    expect(hrefs.filter((h) => h?.includes("openfrontio"))).toEqual([
      "https://github.com/openfrontio/openfrontio",
    ]);
    expect(hrefs.some((h) => h?.includes("reddit.com"))).toBe(false);
    expect(hrefs.some((h) => h?.includes("openfront.wiki"))).toBe(true);
    expect(
      footer.querySelector("steam-wishlist-button")?.hasAttribute("hidden"),
    ).toBe(true);
  });
});

describe("news promos", () => {
  it("drops the tournament and Discord items and keeps the rest", () => {
    const kept = filterNewsByFeatures(newsItems as NewsItem[]);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.some((i) => i.type === "tournament")).toBe(false);
    expect(kept.some((i) => (i.url ?? "").includes("discord"))).toBe(false);
    expect(kept.some((i) => i.type === "warning")).toBe(true);
  });
});

describe("no requests while hidden", () => {
  it("never fetches /streams.json", () => {
    const unsubscribe = streamsFeed.subscribe(() => {});
    unsubscribe();
    expect(getStreams).not.toHaveBeenCalled();
  });

  it("never calls an XP, prestige or progression endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchMyGameXp("g")).toEqual({ status: "unavailable" });
    expect(await fetchPublicPlayerProgress("p")).toBe(false);
    expect(await prestigeMe("k")).toEqual({ ok: false, reason: "failed" });
    expect(await fetchProgressionConfig()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
