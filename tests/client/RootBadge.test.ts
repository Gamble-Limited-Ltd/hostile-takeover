import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import { rootBadge } from "../../src/client/components/ui/RootBadge";
import { visibleCosmetics } from "../../src/client/view/CosmeticVisibility";

describe("rootBadge", () => {
  it("renders the crown with the translated label", () => {
    const host = document.createElement("div");
    render(rootBadge(), host);
    const img = host.querySelector("img[data-badge='root']")!;
    expect(img.getAttribute("alt")).toBe("player_badge.root");
    expect(img.getAttribute("src")).toContain("CrownIcon.svg");
  });

  it("survives the 'cosmetics from nobody' filter, like verified", () => {
    const c = { verified: true, root: true };
    expect(visibleCosmetics(c, { showFrom: "self" }, "other")).toEqual(c);
    expect(
      visibleCosmetics({}, { showFrom: "self" }, "other").root,
    ).toBeUndefined();
  });
});
