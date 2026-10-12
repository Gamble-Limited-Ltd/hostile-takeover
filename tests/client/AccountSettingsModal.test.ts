import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/AccountSettingsModal";
import type { AccountSettingsModal } from "../../src/client/AccountSettingsModal";
import { getIdentityTokenAudiences, getUserMe } from "../../src/client/Api";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  getIdentityTokenAudiences: vi.fn(),
}));

const userMe = {
  user: {},
  player: { publicId: "test-player" },
} as unknown as UserMeResponse;

describe("AccountSettingsModal — identity token sites", () => {
  let modal: AccountSettingsModal;

  beforeEach(async () => {
    vi.mocked(getUserMe).mockResolvedValue(userMe);
    vi.mocked(getIdentityTokenAudiences).mockResolvedValue(["ofstats.io"]);
    modal = document.createElement(
      "account-settings-modal",
    ) as AccountSettingsModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    modal.remove();
    vi.clearAllMocks();
  });

  // Upstream fetches the site list once a player opens account settings.
  // Hostile Takeover keeps the identity-token card in a hidden wrapper
  // (Slice 2.3) and a hidden card fetches nothing (Slice 3.5b), so the list
  // is never requested, before or after opening.
  it("never fetches the site list for the hidden card", async () => {
    expect(getIdentityTokenAudiences).not.toHaveBeenCalled();

    modal.open();

    await vi.waitFor(() =>
      expect(modal.querySelector("identity-token-card")).not.toBeNull(),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getIdentityTokenAudiences).not.toHaveBeenCalled();
  });
});
