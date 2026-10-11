import { afterEach, describe, expect, it, vi } from "vitest";

const { createResetLink, userAuth } = vi.hoisted(() => ({
  createResetLink: vi.fn(),
  userAuth: vi.fn(),
}));
vi.mock("../../src/client/PasswordAuthApi", async (orig) => ({
  ...(await orig<typeof import("../../src/client/PasswordAuthApi")>()),
  createResetLink,
}));
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(),
  userAuth,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
vi.mock("../../src/client/components/CopyButton", () => ({}));

import { AdminResetCard } from "../../src/client/components/account/AdminResetCard";

describe("admin-reset-card", () => {
  let el: AdminResetCard;

  async function mount(role?: string) {
    userAuth.mockResolvedValue(
      role === undefined ? false : { claims: { role } },
    );
    if (!customElements.get("admin-reset-card")) {
      customElements.define("admin-reset-card", AdminResetCard);
    }
    el = document.createElement("admin-reset-card") as AdminResetCard;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
  });

  async function create(username: string) {
    const input = el.querySelector<HTMLInputElement>(
      "input[name=resetUsername]",
    )!;
    input.value = username;
    input.dispatchEvent(new Event("input"));
    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }

  it("renders nothing for a non-root player", async () => {
    await mount("mod");
    expect(el.querySelector("form")).toBeNull();
  });

  it("renders nothing when signed out", async () => {
    await mount();
    expect(el.querySelector("form")).toBeNull();
  });

  it("shows the link, expiry and hint for root", async () => {
    await mount("root");
    createResetLink.mockResolvedValue({
      ok: true,
      link: "http://x/#reset=abc",
      expiresAt: "2026-10-12T00:00:00.000Z",
    });
    await create(" tester2 ");
    expect(createResetLink).toHaveBeenCalledWith("tester2");
    expect(
      el.querySelector<HTMLInputElement>("input[name=resetLink]")!.value,
    ).toBe("http://x/#reset=abc");
    expect(el.querySelector("copy-button")).not.toBeNull();
    expect(el.textContent).toContain("password_auth.admin_link_expires");
    expect(el.textContent).toContain("password_auth.admin_link_hint");
  });

  it.each([
    ["no_such_user", "password_auth.admin_error_no_such_user"],
    ["forbidden", "password_auth.admin_error_forbidden"],
    ["unauthorized", "password_auth.error_signed_out_admin"],
    ["boom", "password_auth.error_generic"],
  ])("maps %s to %s", async (code, key) => {
    await mount("root");
    createResetLink.mockResolvedValue({ ok: false, status: 400, code });
    await create("someone");
    expect(el.textContent).toContain(key);
    expect(el.querySelector("input[name=resetLink]")).toBeNull();
  });
});
