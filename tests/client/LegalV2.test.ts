// Legal v2 dark launch, client side. The API field `legalVersion` on /auth/config
// (absent while dark) switches the sign-up wording and the legal links to HALL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";

// translateText stand-in that resolves real en.json strings.
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) =>
    key
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) ??
    key,
}));
vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "http://api.test",
}));
const { getAuthHeader, logOut, clearLocalSession } = vi.hoisted(() => ({
  getAuthHeader: vi.fn(async () => "Bearer t"),
  logOut: vi.fn(async () => true),
  clearLocalSession: vi.fn(),
}));
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader,
  logOut,
  clearLocalSession,
}));
const { deleteAccount } = vi.hoisted(() => ({
  deleteAccount: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/client/Api", () => ({ deleteAccount }));
const { fetchAuthConfig } = vi.hoisted(() => ({ fetchAuthConfig: vi.fn() }));
vi.mock("../../src/client/GateAuthApi", async (orig) => ({
  ...(await orig<typeof import("../../src/client/GateAuthApi")>()),
  fetchAuthConfig,
}));

import { LEGAL_SIGNUP_WORDING } from "@openfront/shared/Legal";
import { PasswordAuthForm } from "../../src/client/components/account/PasswordAuthForm";
import { OModal } from "../../src/client/components/baseComponents/Modal";
import { Footer } from "../../src/client/components/Footer";
import { LegalReconsentModal } from "../../src/client/components/LegalReconsentModal";
import { resetLegalV2ForTests } from "../../src/client/LegalV2";

const DARK = { gate: true, legacy: true, gateUrl: "https://id.test" };
const ON = { ...DARK, legalVersion: "2026-11-15" };
const define = (tag: string, c: CustomElementConstructor) => {
  if (!customElements.get(tag)) customElements.define(tag, c);
};
const settle = async (el: { updateComplete: Promise<unknown> }) => {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => resetLegalV2ForTests());
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount<
  T extends HTMLElement & { updateComplete: Promise<unknown> },
>(tag: string, cls: CustomElementConstructor, cfg: unknown): Promise<T> {
  fetchAuthConfig.mockResolvedValue(cfg);
  define(tag, cls);
  const el = document.createElement(tag) as T;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

describe("footer links", () => {
  const hrefs = (el: HTMLElement) =>
    [...el.querySelectorAll("a")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => /terms|privacy/.test(h ?? ""));

  it("dark: the static pages", async () => {
    const f = await mount("page-footer", Footer, DARK);
    expect(hrefs(f)).toEqual([
      "/terms-of-service.html",
      "/privacy-policy.html",
    ]);
  });
  it("on: HALL", async () => {
    const f = await mount("page-footer", Footer, ON);
    expect(hrefs(f)).toEqual([
      "https://hall.taps-holdings.org/legal/terms",
      "https://hall.taps-holdings.org/legal/privacy",
    ]);
  });
});

describe("sign-up wording", () => {
  it("the shared constant is the contract sentence", () => {
    expect(LEGAL_SIGNUP_WORDING).toBe(
      "I am 18 or older, or I am at least 13 and my parent or guardian has agreed to the Terms of Service and Privacy Policy for me.",
    );
  });

  async function signUpForm(cfg: unknown) {
    const f = await mount<PasswordAuthForm>(
      "password-auth-form",
      PasswordAuthForm,
      cfg,
    );
    f.mode = "signup";
    await settle(f);
    return f;
  }

  it("dark: today's checkbox and links", async () => {
    const f = await signUpForm(DARK);
    const label = f.querySelector("label")!;
    expect(norm(label.textContent)).toBe(
      "I'm 13 or older and agree to the Terms of Service and Privacy Policy",
    );
    expect(
      [...label.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual(["/terms-of-service.html", "/privacy-policy.html"]);
  });

  it("on: the exact wording, HALL links, and legalAccepted is sent", async () => {
    const f = await signUpForm(ON);
    const label = f.querySelector("label")!;
    expect(norm(label.textContent)).toBe(LEGAL_SIGNUP_WORDING);
    expect(
      [...label.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual([
      "https://hall.taps-holdings.org/legal/terms",
      "https://hall.taps-holdings.org/legal/privacy",
    ]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const set = (n: string, v: string) =>
      ((f.querySelector(`input[name="${n}"]`) as HTMLInputElement).value = v);
    for (const [n, v] of [
      ["firstName", "A"],
      ["lastName", "B"],
      ["email", "ab@kmlhs.org"],
      ["username", "abcd"],
      ["password", "correct horse battery"],
    ]) {
      (f as unknown as { values: Record<string, string> }).values[n] = v;
    }
    set("age", "");
    const box = f.querySelector('input[name="age"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    f.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await settle(f);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(
      calls.find((c) => c[0].endsWith("/auth/register"))![1].body as string,
    );
    expect(body.legalAccepted).toBe(true);
  });
});

describe("reconsent prompt", () => {
  const me = (legal?: { required: string; accepted: string | null }) =>
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: { user: {}, player: {}, ...(legal ? { legal } : {}) },
      }),
    );
  async function modal() {
    define("legal-reconsent-modal", LegalReconsentModal);
    const el = document.createElement(
      "legal-reconsent-modal",
    ) as LegalReconsentModal;
    document.body.appendChild(el);
    await settle(el);
    return el;
  }
  const isOpen = (el: HTMLElement) =>
    el.querySelector("o-modal") as unknown as { isModalOpen?: boolean } | null;

  it("shows nothing while dark (no legal field)", async () => {
    const el = await modal();
    me();
    await settle(el);
    expect(el.querySelector("o-modal")).toBeNull();
  });
  it("shows nothing when the account accepted this version", async () => {
    const el = await modal();
    me({ required: "2026-11-15", accepted: "2026-11-15" });
    await settle(el);
    expect(el.querySelector("o-modal")).toBeNull();
  });
  it("prompts when the version differs, with HALL links, and Accept posts then hides", async () => {
    const el = await modal();
    me({ required: "2026-11-15", accepted: "2026-01-01" });
    await settle(el);
    expect(isOpen(el)).not.toBeNull();
    expect(
      [...el.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual([
      "https://hall.taps-holdings.org/legal/terms",
      "https://hall.taps-holdings.org/legal/privacy",
    ]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    (el.querySelector("[data-legal-accept]") as HTMLElement).click();
    await settle(el);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/users/@me/legal");
    expect(init.method).toBe("POST");
    expect(el.querySelector("o-modal")).toBeNull();
  });
  it("a never-accepted account (null) is prompted too", async () => {
    const el = await modal();
    me({ required: "2026-11-15", accepted: null });
    await settle(el);
    expect(el.querySelector("o-modal")).not.toBeNull();
  });
});

describe("reconsent blocks play while it is needed", () => {
  it("has no close button, reopens when closed, and offers read, sign out and delete", async () => {
    define("o-modal", OModal);
    define("legal-reconsent-modal", LegalReconsentModal);
    const el = document.createElement(
      "legal-reconsent-modal",
    ) as LegalReconsentModal;
    document.body.appendChild(el);
    await settle(el);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: {
          user: {},
          player: {},
          legal: { required: "2026-11-15", accepted: null },
        },
      }),
    );
    await settle(el);
    const modal = el.querySelector("o-modal") as OModal;
    expect(modal.isModalOpen).toBe(true);
    expect(modal.hideCloseButton).toBe(true);
    modal.close();
    await settle(el);
    expect(modal.isModalOpen).toBe(true);
    (el.querySelector("[data-legal-decline]") as HTMLElement).click();
    expect(logOut).toHaveBeenCalled();
    vi.stubGlobal("confirm", () => true);
    (el.querySelector("[data-legal-delete]") as HTMLElement).click();
    await settle(el);
    expect(deleteAccount).toHaveBeenCalled();
    expect(clearLocalSession).toHaveBeenCalled();
  });
  it("once accepted it really closes", async () => {
    define("o-modal", OModal);
    define("legal-reconsent-modal", LegalReconsentModal);
    const el = document.createElement(
      "legal-reconsent-modal",
    ) as LegalReconsentModal;
    document.body.appendChild(el);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: {
          user: {},
          player: {},
          legal: { required: "2026-11-15", accepted: null },
        },
      }),
    );
    await settle(el);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    (el.querySelector("[data-legal-accept]") as HTMLElement).click();
    await settle(el);
    expect(el.querySelector("o-modal")).toBeNull();
  });
});
