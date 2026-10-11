import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => false),
  showInGameAlert: vi.fn(async () => undefined),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  showToast: vi.fn(),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUsername: vi.fn(async () => null),
    addAuthListener: vi.fn(),
  },
}));
vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false, getPersonaName: vi.fn(async () => null) },
}));

import { accountPlayName } from "../../src/client/AccountName";
import { UsernameInput } from "../../src/client/UsernameInput";

function me(username: string | null | undefined): UserMeResponse {
  return {
    user: { email: "sam@kmlhs.org" },
    player: { publicId: "p", username, usernameBase: username },
  } as unknown as UserMeResponse;
}

describe("accountPlayName", () => {
  it("is the account username when signed in", () => {
    expect(accountPlayName(me("Sam"))).toBe("Sam");
  });
  it("leaves OpenFront-style accounts (usernameStatus set) to the verified flow", () => {
    const m = me("Sam");
    (m.player as { usernameStatus?: string }).usernameStatus = "premium";
    expect(accountPlayName(m)).toBeNull();
  });
  it("is null when signed out, unknown or nameless", () => {
    expect(accountPlayName(false)).toBeNull();
    expect(accountPlayName(null)).toBeNull();
    expect(accountPlayName(me(null))).toBeNull();
    expect(accountPlayName(me("  "))).toBeNull();
    expect(accountPlayName(me(undefined))).toBeNull();
  });
});

describe("username-input name selection", () => {
  let el: UsernameInput;

  beforeEach(async () => {
    localStorage.clear();
    if (!customElements.get("username-input")) {
      customElements.define("username-input", UsernameInput);
    }
    el = document.createElement("username-input") as UsernameInput;
    document.body.appendChild(el);
    await el.updateComplete;
  });
  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
  });

  async function signal(detail: UserMeResponse | false) {
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
    await el.updateComplete;
  }

  it("signed out: the editable anonymous name, with the tag field", async () => {
    await signal(false);
    const name = el.resolvedName();
    expect(name.name).toMatch(/^Anon/);
    expect(name.verified).toBe(false);
    expect(el.querySelector("input[type=text]")).not.toBeNull();
    expect(el.querySelector("button")).not.toBeNull();
    expect(el.canPlay()).toBe(true);
  });

  it("signed in: plays as the account username, read-only, no tag", async () => {
    await signal(me("Sam The Man"));
    const name = el.resolvedName();
    expect(name).toEqual({
      name: "Sam The Man",
      source: "stored",
      verified: false,
    });
    expect(el.getClanTag()).toBeNull();
    expect(el.querySelector("input")).toBeNull();
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain("Sam The Man");
    expect(el.canPlay()).toBe(true);
  });

  it("signing out brings the anonymous name back", async () => {
    await signal(me("Sam The Man"));
    await signal(false);
    expect(el.resolvedName().name).toMatch(/^Anon/);
    expect(el.querySelector("input[type=text]")).not.toBeNull();
  });
});
