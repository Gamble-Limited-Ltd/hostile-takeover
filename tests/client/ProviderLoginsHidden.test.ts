import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Slice 3.2: third-party login providers and the Steam wishlist are hidden,
// and the CrazyGames SDK is never loaded or called outside its iframe.

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("@openfront/shared/AssetUrls", () => ({
  assetUrl: (path: string) => path,
}));

import { Footer } from "../../src/client/components/Footer";
import { PlayPage } from "../../src/client/components/PlayPage";
import { crazyGamesSDK } from "../../src/client/CrazyGamesSDK";

describe("index.html CrazyGames SDK", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

  it("has no static script tag for the SDK", () => {
    expect(html).not.toMatch(/<script[^>]*src="https:\/\/sdk\.crazygames\.com/);
  });

  it("injects the SDK only when the page is framed", () => {
    const at = html.indexOf("crazygames-sdk-v3.js");
    expect(at).toBeGreaterThan(-1);
    const guard = html.lastIndexOf("window.self !== window.top", at);
    expect(guard).toBeGreaterThan(-1);
    // The guard opens the block that holds the injection.
    expect(at - guard).toBeLessThan(200);
  });
});

describe("CrazyGamesSDK off CrazyGames", () => {
  it("never touches window.CrazyGames", async () => {
    const sdk = {
      SDK: new Proxy(
        {},
        {
          get() {
            throw new Error("CrazyGames SDK was used");
          },
        },
      ),
    };
    (window as unknown as { CrazyGames: unknown }).CrazyGames = sdk;
    try {
      expect(crazyGamesSDK.isOnCrazyGames()).toBe(false);
      await crazyGamesSDK.maybeInit();
      expect(crazyGamesSDK.isReady()).toBe(false);
      await expect(crazyGamesSDK.getUserToken()).resolves.toBeNull();
      await expect(crazyGamesSDK.getUserProfile()).resolves.toBeNull();
      await crazyGamesSDK.gameplayStart();
      await crazyGamesSDK.gameplayStop();
      await crazyGamesSDK.happytime();
      await crazyGamesSDK.requestMidgameAd();
      crazyGamesSDK.loadingStart();
      crazyGamesSDK.loadingStop();
      crazyGamesSDK.hideInviteButton();
      expect(crazyGamesSDK.showInviteButton("abc")).toBeNull();
    } finally {
      delete (window as unknown as { CrazyGames?: unknown }).CrazyGames;
    }
  });
});

describe("Steam wishlist entry points", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("hides the footer banner", async () => {
    if (!customElements.get("page-footer")) {
      customElements.define("page-footer", Footer);
    }
    const footer = document.createElement("page-footer") as Footer;
    document.body.appendChild(footer);
    await footer.updateComplete;
    const banner = footer.querySelector("steam-wishlist-button");
    expect(banner).not.toBeNull();
    expect(banner?.hasAttribute("hidden")).toBe(true);
  });

  it("hides the mobile play-page widget and loads no Steam iframe", async () => {
    if (!customElements.get("play-page")) {
      customElements.define("play-page", PlayPage);
    }
    const page = document.createElement("play-page") as PlayPage;
    document.body.appendChild(page);
    await page.updateComplete;
    const widget = page.querySelector("steam-wishlist");
    expect(widget?.closest("[hidden]")).not.toBeNull();
    await (widget as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
    expect(page.querySelector("iframe")).toBeNull();
  });
});
