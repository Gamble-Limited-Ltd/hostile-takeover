import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../src/client/components/DesktopNavBar";
import "../../src/client/components/MobileNavBar";
import { navNotifications } from "../../src/client/components/NavNotificationsController";
import { Features } from "../../src/client/Features";
import "../../src/client/InventoryModal";

// Keep the inventory modal off the network (it loads the catalog and profile).
vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  userAuth: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn().mockResolvedValue(null),
}));

type Mountable = HTMLElement & { updateComplete: Promise<unknown> };

async function mount(tag: string): Promise<Mountable> {
  const el = document.createElement(tag) as Mountable;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

// An element is hidden when it, or an ancestor inside the bar, carries `hidden`.
const isHidden = (el: Element | null): boolean =>
  el !== null && el.closest("[hidden]") !== null;

describe("Features", () => {
  it("is frozen and defaults every switch to off", () => {
    expect(Object.isFrozen(Features)).toBe(true);
    for (const [key, value] of Object.entries(Features))
      expect(value).toBe(["usernameChange", "xp", "profile"].includes(key));
    expect(Features.store).toBe(false);
  });
});

describe("store entry points are hidden", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.currentPageId = "page-play";
  });

  for (const tag of ["desktop-nav-bar", "mobile-nav-bar"]) {
    it(`${tag} hides STORE but keeps INVENTORY and the other items`, async () => {
      const bar = await mount(tag);
      const page = (id: string) => bar.querySelector(`[data-page="${id}"]`);
      expect(page("page-item-store")).not.toBeNull();
      expect(isHidden(page("page-item-store"))).toBe(true);
      expect(isHidden(page("page-inventory"))).toBe(false);
      expect(isHidden(page("page-play"))).toBe(false);
    });
  }

  it("never shows the store notification dot", () => {
    expect(navNotifications.showStoreDot()).toBe(false);
  });
});

describe("inventory with cosmetics off", () => {
  let modal: HTMLElement & { updateComplete: Promise<unknown> };

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = "";
    modal = document.createElement("inventory-modal") as typeof modal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: { patterns: {}, flags: {}, packs: {}, skins: {} },
      userMeResponse: false,
      ownershipState: "guest",
      isLoading: false,
      loadFailed: false,
      isModalOpen: true,
      // Narrow the ~250 country tiles so jsdom renders a handful of cards.
      search: "canada",
    });
    (modal as unknown as { requestUpdate(): void }).requestUpdate();
    await modal.updateComplete;
  });

  it("offers only the Flags category, and opens on it", () => {
    const config = (
      modal as unknown as { modalConfig(): { tabs: Array<{ key: string }> } }
    ).modalConfig();
    expect(config.tabs.map((tab) => tab.key)).toEqual(["flags"]);
    expect(modal.querySelector('[data-inventory-grid="flags"]')).not.toBeNull();
    expect(modal.querySelector('[data-inventory-grid="skins"]')).toBeNull();
    expect(modal.querySelector("inventory-loadout-menu")).toBeNull();
    expect(modal.querySelector("[data-inventory-sign-in]")).toBeNull();
  });

  it("lets a guest pick a country flag", () => {
    expect(
      modal.querySelectorAll('[data-inventory-grid="flags"] cosmetic-card')
        .length,
    ).toBeGreaterThan(0);
  });
});
