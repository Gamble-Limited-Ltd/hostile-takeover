import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({ logOut: vi.fn() }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUserProfile: async () => null,
    showAuthPrompt: async () => null,
  },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(),
}));
vi.mock("../../src/client/Navigation", () => ({
  closeMobileSidebar: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  copyToClipboard: vi.fn(),
  showToast: vi.fn(),
}));

import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { NavAccountMenu } from "../../src/client/components/NavAccountMenu";

// With the real Features (U2.4: profile, xp and usernameChange on) the signed-in
// menu has "Copy profile URL", "Change username" and the level badge, and
// nothing for the features that stay off.
describe("nav-account-menu with hidden features", () => {
  let el: NavAccountMenu;

  beforeEach(async () => {
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    document.body.appendChild(el);
    await el.updateComplete;
  });
  afterEach(() => el.remove());

  it("lists the supported rows only", async () => {
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: {
          user: { email: "player@example.com" },
          player: {
            publicId: "p",
            progress: {
              level: 12,
              prestige: 0,
              legend: false,
              xpInLevel: 1,
              xpForNext: 10,
            },
          },
        } as unknown as UserMeResponse,
      }),
    );
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>("[data-account-trigger]")!.click();
    await el.updateComplete;
    const keys = Array.from(document.querySelectorAll("[data-menu-item]")).map(
      (n) => n.getAttribute("data-menu-item"),
    );
    expect(keys).toEqual([
      "copy-profile-url",
      "view-account",
      "account-settings",
      "change-username",
      "log-out",
    ]);
    expect(el.querySelector("level-badge")).not.toBeNull();
  });
});
