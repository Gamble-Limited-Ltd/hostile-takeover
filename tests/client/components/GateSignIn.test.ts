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
  vi.mocked(fetchAuthConfig).mockResolvedValue({ ...config, gateUrl: "" });
  el = document.createElement("gate-sign-in");
  Object.assign(el, props);
  document.body.appendChild(el);
  await settle();
  return el;
}

const pendingBase: GatePending = {
  loginName: "bob",
  email: "bob@kmlhs.org",
  match: null,
  suggestion: "bob_2",
};

async function mountLink(pending: GatePending | "no_pending") {
  vi.mocked(fetchGatePending).mockResolvedValue(
    pending === "no_pending"
      ? { ok: false, status: 401, code: "no_pending" }
      : { ok: true, pending },
  );
  await mount({ gate: true, legacy: true }, { linkMode: true });
}

// Sets the value the way a password manager does: no input event.
function fill(name: string, value: string) {
  (el.querySelector(`input[name="${name}"]`) as HTMLInputElement).value = value;
}

const click = (selector: string) =>
  (el.querySelector(selector) as HTMLElement).click();

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

  it("the GLL ID button opens a new tab; a blocked popup falls back to this tab", async () => {
    const open = vi.fn(() => ({}));
    vi.stubGlobal("open", open);
    await mount({ gate: true, legacy: false });
    const click = () =>
      (
        el.querySelector(
          "o-button[translationKey='gate_auth.sign_in'] button",
        ) as HTMLButtonElement
      ).click();
    click();
    expect(open).toHaveBeenCalledWith(
      "http://api.test/auth/gate/start?tab=1",
      "_blank",
    );
    vi.unstubAllGlobals();
  });

  it("always shows 'Redirect failed? Sign in here' under the button", async () => {
    for (const legacy of [true, false]) {
      document.body.innerHTML = "";
      await mount({ gate: true, legacy });
      const link = el.querySelector(
        "button[name=redirectFailed]",
      ) as HTMLButtonElement;
      expect(link.textContent?.trim()).toBe("gate_auth.direct_link");
    }
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

  it("match: one button, confirms, and fires auth-success", async () => {
    vi.mocked(confirmGateLink).mockResolvedValue({ ok: true });
    await mountLink({ ...pendingBase, match: { username: "bobby" } });
    expect(el.textContent).toContain("gate_auth.match_found");
    expect(el.querySelector("b")?.textContent).toBe("bobby");
    expect(el.querySelectorAll("o-button")).toHaveLength(1);
    expect(el.querySelector("form")).toBeNull();
    const onSuccess = vi.fn();
    el.addEventListener("auth-success", onSuccess);
    click('o-button[title=\'gate_auth.match_continue:{"username":"bobby"}\']');
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(confirmGateLink).toHaveBeenCalled();
  });

  it("rename: names the taken login and creates as the suggestion", async () => {
    vi.mocked(gateCreate).mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: "username_taken",
    });
    await mountLink(pendingBase);
    expect(el.textContent).toContain('gate_auth.name_taken:{"name":"bob"}');
    expect(el.querySelector("form")).toBeNull();
    click('o-button[title=\'gate_auth.rename_continue:{"username":"bob_2"}\']');
    await settle();
    expect(gateCreate).toHaveBeenCalledWith("bob_2");
    expect(el.textContent).toContain("gate_auth.error_username_taken");

    vi.mocked(gateCreate).mockResolvedValueOnce({ ok: true });
    const onSuccess = vi.fn();
    el.addEventListener("auth-success", onSuccess);
    click("o-button");
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it("rename without a suggestion asks for a username (autofilled value counts)", async () => {
    vi.mocked(gateCreate).mockResolvedValue({ ok: true });
    await mountLink({ ...pendingBase, suggestion: null });
    fill("username", " Bobby ");
    await submit("form");
    expect(gateCreate).toHaveBeenCalledWith("Bobby");
  });

  it("'It's my old account' reveals the password form; autofilled values are sent; errors map", async () => {
    await mountLink(pendingBase);
    expect(el.querySelector("input[type=password]")).toBeNull();
    click("button:not([type=submit]):not(o-button button)");
    await settle();
    const pw = el.querySelector("input[type=password]") as HTMLInputElement;
    expect(pw.autocomplete).toBe("current-password");
    fill("username", " old ");
    fill("password", "pw");
    vi.mocked(gateLinkWithPassword).mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "invalid_credentials",
    });
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

    vi.mocked(gateLinkWithPassword).mockResolvedValueOnce({ ok: true });
    const onSuccess = vi.fn();
    el.addEventListener("auth-success", onSuccess);
    await submit("form");
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
