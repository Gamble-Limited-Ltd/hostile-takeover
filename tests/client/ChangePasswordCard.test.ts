import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock("../../src/client/PasswordAuthApi", async (orig) => ({
  ...(await orig<typeof import("../../src/client/PasswordAuthApi")>()),
  changePassword,
}));
vi.mock("../../src/client/Auth", () => ({ getAuthHeader: vi.fn() }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { ChangePasswordCard } from "../../src/client/components/account/ChangePasswordCard";

describe("change-password-card", () => {
  let el: ChangePasswordCard;

  beforeEach(async () => {
    if (!customElements.get("change-password-card")) {
      customElements.define("change-password-card", ChangePasswordCard);
    }
    el = document.createElement("change-password-card") as ChangePasswordCard;
    document.body.appendChild(el);
    await el.updateComplete;
  });
  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
  });

  function type(name: string, value: string) {
    const input = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }
  async function submit() {
    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }

  it("rejects a short new password without calling the API", async () => {
    type("currentPassword", "old-password-1");
    type("newPassword", "short");
    await submit();
    expect(changePassword).not.toHaveBeenCalled();
    expect(el.textContent).toContain("password_auth.error_password_short");
  });

  it("shows the API's wrong_password error and keeps the fields", async () => {
    changePassword.mockResolvedValue({
      ok: false,
      status: 403,
      code: "wrong_password",
    });
    type("currentPassword", "old-password-1");
    type("newPassword", "new-password-1");
    await submit();
    expect(changePassword).toHaveBeenCalledWith(
      "old-password-1",
      "new-password-1",
    );
    expect(el.textContent).toContain("password_auth.error_wrong_password");
  });

  it("confirms and clears the form on success", async () => {
    changePassword.mockResolvedValue({ ok: true });
    type("currentPassword", "old-password-1");
    type("newPassword", "new-password-1");
    await submit();
    expect(el.textContent).toContain("password_auth.change_password_done");
    expect(
      el.querySelector<HTMLInputElement>("input[name=newPassword]")!.value,
    ).toBe("");
  });
});
