import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Features", () => ({ Features: { profile: true } }));
vi.mock("../../src/client/ApiBase", () => ({ getApiBase: () => "http://api" }));
vi.mock("../../src/client/utilities/PlayerProfileUrl", () => ({
  playerProfileUrl: (id: string) => `http://site/player/${id}`,
}));

import { openPlayerProfile } from "../../src/client/OpenPlayerProfile";

function setup(res: Partial<Response>) {
  const tab = { location: { href: "" }, close: vi.fn(), opener: {} };
  const open = vi.fn(() => tab);
  vi.stubGlobal("open", open);
  const fetchMock = vi.fn(async () => res as Response);
  vi.stubGlobal("fetch", fetchMock);
  return { tab, open, fetchMock };
}

describe("openPlayerProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a tab at once and points it at the looked-up profile", async () => {
    const { tab, open, fetchMock } = setup({
      ok: true,
      json: async () => ({ publicId: "pub1" }),
    });
    openPlayerProfile("Some Name");
    expect(open).toHaveBeenCalledWith("", "_blank");
    await vi.waitFor(() =>
      expect(tab.location.href).toBe("http://site/player/pub1"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api/public/player/by-username/Some%20Name",
    );
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the tab on a 404", async () => {
    const { tab } = setup({ ok: false });
    openPlayerProfile("ghost");
    await vi.waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.href).toBe("");
  });

  it("does nothing without a username", () => {
    const { open } = setup({ ok: false });
    openPlayerProfile(undefined);
    expect(open).not.toHaveBeenCalled();
  });
});
