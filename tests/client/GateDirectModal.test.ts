import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
vi.mock("../../src/client/GateAuthApi", () => ({
  fetchAuthConfig: vi.fn(async () => ({
    gate: true,
    legacy: false,
    gateUrl: "https://id.test",
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
const type = (name: string, value: string) => {
  const i = modal.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  i.value = value;
  i.dispatchEvent(new Event("input"));
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

  it("an unlinked player reloads onto #gate=link, the redirect's own landing", async () => {
    // Regression (2026-10-19): setting the hash on the live page was handled
    // twice (popstate, then hashchange) and the second pass dropped the link
    // card, so players without an HT account landed back on sign-in.
    directCall.mockResolvedValue({ ok: true, status: "link" });
    const reload = vi.fn();
    (modal as unknown as { reload: () => void }).reload = reload;
    const hashChanges = vi.fn();
    window.addEventListener("hashchange", hashChanges);
    type("identifier", "newplayer");
    type("password", "pw");
    await submit();
    await new Promise((r) => setTimeout(r, 10));
    window.removeEventListener("hashchange", hashChanges);
    expect(reload).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#gate=link");
    expect(hashChanges).not.toHaveBeenCalled();
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
    modal
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((c) => {
        c.checked = true;
        c.dispatchEvent(new Event("change"));
      });
    await submit();
    expect(modal.textContent).toContain("That login name is taken.");
    expect(directCall.mock.calls[0][1]).toMatchObject({ ageConfirmed13: true });
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
