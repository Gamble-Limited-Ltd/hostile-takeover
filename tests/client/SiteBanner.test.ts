import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ApiBase", () => ({ getApiBase: () => "http://api" }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { SiteBanner } from "../../src/client/SiteBanner";

describe("site-banner", () => {
  let el: SiteBanner;

  async function mount(body: unknown, ok = true) {
    const fetchMock = vi.fn(async () => ({ ok, json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);
    if (!customElements.get("site-banner")) {
      customElements.define("site-banner", SiteBanner);
    }
    el = document.createElement("site-banner") as SiteBanner;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    return fetchMock;
  }
  afterEach(() => {
    el.remove();
    vi.unstubAllGlobals();
  });

  it("shows the banner text and the maintenance notice", async () => {
    const f = await mount({ banner: "Back at 5pm", maintenance: true });
    expect(f).toHaveBeenCalledWith("http://api/public/site-status");
    expect(el.textContent).toContain("Back at 5pm");
    expect(el.textContent).toContain("site_banner.maintenance");
  });

  it("renders nothing when there is no banner and no maintenance", async () => {
    await mount({ banner: null, maintenance: false });
    expect(el.querySelector("div")).toBeNull();
  });

  it("renders nothing when the API fails", async () => {
    await mount({}, false);
    expect(el.querySelector("div")).toBeNull();
  });
});
