import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string, p?: Record<string, string>) =>
    p ? `${key}:${JSON.stringify(p)}` : key,
  ),
}));
vi.mock("../../../src/client/GateAuthApi", async (orig) => ({
  ...(await orig<typeof import("../../../src/client/GateAuthApi")>()),
  fetchAuthConfig: vi.fn(),
  fetchGatePending: vi.fn(),
  confirmGateLink: vi.fn(),
  gateLinkWithPassword: vi.fn(),
  gateCreate: vi.fn(),
  gateStartUrl: vi.fn(() => "http://api.test/auth/gate/start"),
}));

import "../../../src/client/components/account/GateSignIn";
import type { GateSignIn } from "../../../src/client/components/account/GateSignIn";
import {
  confirmGateLink,
  fetchAuthConfig,
  fetchGatePending,
  gateCreate,
  gateLinkWithPassword,
  GatePending,
} from "../../../src/client/GateAuthApi";

let el: HTMLElement;

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await (el as GateSignIn).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

async function mount(
  config: { gate: boolean; legacy: boolean },
  props: Partial<GateSignIn> = {},
) {
  vi.mocked(fetchAuthConfig).mockResolvedValue(config);
  el = document.createElement("gate-sign-in");
  Object.assign(el, props);
  document.body.appendChild(el);
  await settle();
  return el;
}

const pendingBase: GatePending = {
  loginName: "bob",
  displayName: "Bob",
  email: "bob@kmlhs.org",
  match: null,
  canCreate: true,
  usernameTaken: false,
};

async function mountLink(pending: GatePending | "no_pending") {
  vi.mocked(fetchGatePending).mockResolvedValue(
    pending === "no_pending"
      ? { ok: false, status: 401, code: "no_pending" }
      : { ok: true, pending },
  );
  await mount({ gate: true, legacy: true }, { linkMode: true });
}

function type(name: string, value: string) {
  const input = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

async function submit(selector: string) {
  el.querySelector(selector)!.dispatchEvent(
    new Event("submit", { cancelable: true }),
  );
  await settle();
}

afterEach(() => {
  el?.remove();
  vi.clearAllMocks();
});

describe("gate-sign-in views", () => {
  it("gate off: form only", async () => {
    await mount({ gate: false, legacy: true });
    expect(el.querySelector("password-auth-form")).not.toBeNull();
    expect(
      el.querySelector("o-button[translationKey='gate_auth.sign_in']"),
    ).toBeNull();
  });

  it("gate on + legacy on: button, then the form behind a link", async () => {
    await mount({ gate: true, legacy: true });
    expect(
      el.querySelector("o-button[translationKey='gate_auth.sign_in']"),
    ).not.toBeNull();
    expect(el.querySelector("password-auth-form")).toBeNull();
    (el.querySelector("button[name=usePassword]") as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector("password-auth-form")).not.toBeNull();
  });

  it("gate on + legacy off: button only", async () => {
    await mount({ gate: true, legacy: false });
    expect(
      el.querySelector("o-button[translationKey='gate_auth.sign_in']"),
    ).not.toBeNull();
    expect(el.querySelector("button[name=usePassword]")).toBeNull();
    expect(el.querySelector("password-auth-form")).toBeNull();
  });

  it("a reset token shows the form even with legacy off", async () => {
    await mount({ gate: true, legacy: false }, { resetToken: "t".repeat(20) });
    expect(el.querySelector("password-auth-form")).not.toBeNull();
  });

  it("maps a gate error code to its message", async () => {
    await mount({ gate: true, legacy: false }, { errorCode: "denied" });
    expect(el.textContent).toContain("gate_auth.error_denied");
    el.remove();
    await mount(
      { gate: true, legacy: false },
      { errorCode: "account_disabled" },
    );
    expect(el.textContent).toContain("gate_auth.error_account_disabled");
  });
});

describe("gate-link-card", () => {
  it("no_pending: expired message and sign-in button", async () => {
    await mountLink("no_pending");
    expect(el.textContent).toContain("gate_auth.link_expired");
    expect(
      el.querySelector("o-button[translationKey='gate_auth.sign_in']"),
    ).not.toBeNull();
  });

  it("match: asks, confirms, and fires auth-success", async () => {
    vi.mocked(confirmGateLink).mockResolvedValue({ ok: true });
    await mountLink({ ...pendingBase, match: { username: "bobby" } });
    expect(el.textContent).toContain("gate_auth.signed_in_as");
    expect(el.textContent).toContain("bobby");
    expect(el.querySelector("form")).toBeNull();
    const onSuccess = vi.fn();
    el.addEventListener("auth-success", onSuccess);
    (
      el.querySelector(
        "o-button[translationKey='gate_auth.match_yes']",
      ) as HTMLElement
    ).click();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(confirmGateLink).toHaveBeenCalled();
  });

  it("match then No reveals the other options", async () => {
    await mountLink({ ...pendingBase, match: { username: "bobby" } });
    (
      el.querySelector(
        "o-button[translationKey='gate_auth.match_no']",
      ) as HTMLElement
    ).click();
    await settle();
    expect(el.querySelectorAll("form").length).toBe(2);
  });

  it("no match + canCreate: link and create forms, prefilled name", async () => {
    vi.mocked(gateCreate).mockResolvedValue({
      ok: false,
      status: 409,
      code: "username_taken",
    });
    await mountLink({ ...pendingBase, usernameTaken: true });
    expect(el.querySelectorAll("form").length).toBe(2);
    expect(el.textContent).toContain("gate_auth.username_taken_hint");
    const name = el.querySelector(
      "input[name=newUsername]",
    ) as HTMLInputElement;
    expect(name.value).toBe("bob");
    await submit("form:last-of-type");
    expect(gateCreate).toHaveBeenCalledWith("bob");
    expect(el.textContent).toContain("gate_auth.error_username_taken");
  });

  it("no match + !canCreate: explains, link form only", async () => {
    await mountLink({ ...pendingBase, canCreate: false });
    expect(el.querySelectorAll("form").length).toBe(1);
    expect(el.textContent).toContain("gate_auth.cannot_create");
  });

  it("link with password: errors map, success fires auth-success", async () => {
    await mountLink({ ...pendingBase, canCreate: false });
    vi.mocked(gateLinkWithPassword).mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "invalid_credentials",
    });
    type("username", "old");
    type("password", "pw");
    await submit("form");
    expect(gateLinkWithPassword).toHaveBeenCalledWith("old", "pw");
    expect(el.textContent).toContain("gate_auth.error_invalid_credentials");

    vi.mocked(gateLinkWithPassword).mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: "already_linked",
    });
    await submit("form");
    expect(el.textContent).toContain("gate_auth.error_already_linked");

    vi.mocked(gateLinkWithPassword).mockResolvedValueOnce({
      ok: false,
      status: 429,
      code: "rate_limited",
    });
    await submit("form");
    expect(el.textContent).toContain("gate_auth.error_rate_limited");

    vi.mocked(gateLinkWithPassword).mockResolvedValueOnce({ ok: true });
    const onSuccess = vi.fn();
    el.addEventListener("auth-success", onSuccess);
    await submit("form");
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
