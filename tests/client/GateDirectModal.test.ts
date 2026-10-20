import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
vi.mock("../../src/client/GateAuthApi", async (orig) => ({
  ...(await orig<typeof import("../../src/client/GateAuthApi")>()),
  fetchAuthConfig: vi.fn(async () => ({
    gate: true,
    legacy: false,
    gateUrl: "https://id.test",
  })),
  fetchGatePending: vi.fn(async () => ({
    ok: false,
    status: 401,
    code: "no_pending",
  })),
}));
const { directCall } = vi.hoisted(() => ({ directCall: vi.fn() }));
vi.mock("../../src/client/GateDirectApi", () => ({ directCall }));

import { GateDirectModal } from "../../src/client/GateDirectModal";

let modal: GateDirectModal;
const settle = async () => {
  await modal.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await modal.updateComplete;
};
// Sets the value the way a password manager does: no input event.
const type = (name: string, value: string) => {
  (modal.querySelector(`input[name="${name}"]`) as HTMLInputElement).value =
    value;
};
const toSignUp = () =>
  [...modal.querySelectorAll("button")]
    .find((b) => b.textContent?.includes("gate_direct.create_account"))!
    .click();
const submit = async () => {
  modal
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
};

beforeEach(async () => {
  directCall.mockReset();
  if (!customElements.get("gate-direct-modal")) {
    customElements.define("gate-direct-modal", GateDirectModal);
  }
  modal = document.createElement("gate-direct-modal") as GateDirectModal;
  document.body.appendChild(modal);
  modal.open();
  await settle();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("GateDirectModal", () => {
  it("is branded GLL ID and sends login name + password", async () => {
    directCall.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_CREDENTIALS", message: "Nope.", fields: {} },
    });
    expect(modal.textContent).toContain("gate_direct.title");
    type("identifier", " alice ");
    type("password", "pw");
    await submit();
    expect(directCall).toHaveBeenCalledWith("login", {
      identifier: "alice",
      password: "pw",
    });
    expect(modal.textContent).toContain("Nope.");
  });

  it("match / rename show the link card in the modal instead of reloading", async () => {
    const reload = vi.fn();
    (modal as unknown as { reload: () => void }).reload = reload;
    for (const status of ["match", "rename"]) {
      directCall.mockResolvedValue({ ok: true, status });
      type("identifier", "newplayer");
      type("password", "pw");
      await submit();
      expect(modal.querySelector("gate-link-card")).not.toBeNull();
      expect(reload).not.toHaveBeenCalled();
      // Back to a fresh sign-in form for the next round.
      modal.open();
      await settle();
      expect(modal.querySelector("gate-link-card")).toBeNull();
    }
  });

  it("the link card finishing the account reloads once", async () => {
    directCall.mockResolvedValue({ ok: true, status: "rename" });
    const reload = vi.fn();
    (modal as unknown as { reload: () => void }).reload = reload;
    type("identifier", "newplayer");
    type("password", "pw");
    await submit();
    modal
      .querySelector("gate-link-card")!
      .dispatchEvent(new CustomEvent("auth-success", { bubbles: true }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("a linked player reloads with the hash as it was", async () => {
    history.replaceState(null, "", "/#modal=account");
    directCall.mockResolvedValue({ ok: true, status: "ok" });
    const reload = vi.fn();
    (modal as unknown as { reload: () => void }).reload = reload;
    type("identifier", "boss");
    type("password", "pw");
    await submit();
    expect(reload).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#modal=account");
  });

  it("shows GLL ID's DIRECT_SIGNIN_DISABLED message as returned", async () => {
    directCall.mockResolvedValue({
      ok: false,
      error: {
        code: "DIRECT_SIGNIN_DISABLED",
        message: "Signing in here is turned off right now.",
        fields: {},
      },
    });
    type("identifier", "a");
    type("password", "b");
    await submit();
    expect(modal.textContent).toContain(
      "Signing in here is turned off right now.",
    );
  });

  it("EMAIL_UNVERIFIED moves to the code step, and the code goes to verify", async () => {
    directCall.mockResolvedValueOnce({
      ok: false,
      pending: "h1",
      error: {
        code: "EMAIL_UNVERIFIED",
        message: "We emailed you.",
        fields: {},
      },
    });
    type("identifier", "a");
    type("password", "b");
    await submit();
    expect(modal.querySelector('input[name="code"]')).not.toBeNull();
    directCall.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CODE_INVALID",
        message: "That code is not right.",
        fields: {},
      },
    });
    type("code", "123456");
    await submit();
    expect(directCall).toHaveBeenLastCalledWith("verify", {
      pending: "h1",
      code: "123456",
    });
    expect(modal.textContent).toContain("That code is not right.");
  });

  it("field messages from GLL ID show under the field", async () => {
    toSignUp();
    await settle();
    directCall.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the form.",
        fields: { loginName: "That login name is taken." },
      },
    });
    (
      modal.querySelector('input[type="checkbox"]') as HTMLInputElement
    ).checked = true;
    await submit();
    expect(modal.textContent).toContain("That login name is taken.");
  });

  it("sign-up has one consent checkbox, no display name, and sends what was filled in", async () => {
    toSignUp();
    await settle();
    expect(modal.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(modal.querySelector('input[name="displayName"]')).toBeNull();
    const auto = (n: string) =>
      (modal.querySelector(`input[name="${n}"]`) as HTMLInputElement)
        .autocomplete;
    expect(
      ["firstName", "lastName", "loginName", "email", "password"].map(auto),
    ).toEqual([
      "given-name",
      "family-name",
      "username",
      "email",
      "new-password",
    ]);
    expect(modal.textContent).toContain("gate_direct.login_name_hint");

    directCall.mockResolvedValue({ ok: true, pending: "p1" });
    type("firstName", "Al");
    type("lastName", "Ice");
    type("loginName", " alice ");
    type("email", "a@kmlhs.org");
    type("password", "Aa1!aaaa");
    await submit();
    expect(directCall).not.toHaveBeenCalled();
    expect(modal.textContent).toContain("gate_direct.error_consent");
    (
      modal.querySelector('input[type="checkbox"]') as HTMLInputElement
    ).checked = true;
    await submit();
    expect(directCall).toHaveBeenCalledWith("signup", {
      firstName: "Al",
      lastName: "Ice",
      loginName: "alice",
      email: "a@kmlhs.org",
      password: "Aa1!aaaa",
      ageConfirmed13: true,
      acceptedLegal: true,
    });
  });

  it("the code and reset forms read autofilled values too; reset signs in when GLL ID did", async () => {
    directCall.mockResolvedValueOnce({ ok: true, pending: "h2" });
    [...modal.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("gate_direct.forgot"))!
      .click();
    await settle();
    type("identifier", "alice");
    await submit();
    expect(directCall).toHaveBeenLastCalledWith("recover", {
      identifier: "alice",
    });
    type("code", "654321");
    await submit();
    const reload = vi.fn();
    (modal as unknown as { reload: () => void }).reload = reload;
    directCall.mockResolvedValueOnce({ ok: true, status: "ok" });
    type("newPassword", "Bb2@bbbb");
    await submit();
    expect(directCall).toHaveBeenLastCalledWith("reset", {
      pending: "h2",
      code: "654321",
      newPassword: "Bb2@bbbb",
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reset with no sign-in (204) goes back to sign in", async () => {
    directCall.mockResolvedValueOnce({ ok: true, pending: "h3" });
    [...modal.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("gate_direct.forgot"))!
      .click();
    await settle();
    type("identifier", "alice");
    await submit();
    type("code", "654321");
    await submit();
    directCall.mockResolvedValueOnce({ ok: true });
    type("newPassword", "Bb2@bbbb");
    await submit();
    expect(modal.querySelector('input[name="identifier"]')).not.toBeNull();
    expect(modal.textContent).toContain("gate_direct.reset_done");
  });

  it("sign-up links point at GLL ID's /terms and /privacy", async () => {
    toSignUp();
    await settle();
    const hrefs = [...modal.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["https://id.test/terms", "https://id.test/privacy"]);
  });
});
