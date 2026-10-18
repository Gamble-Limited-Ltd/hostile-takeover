import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "http://api.test",
}));

import {
  confirmGateLink,
  createErrorKey,
  fetchAuthConfig,
  fetchGatePending,
  gateCreate,
  gateErrorKey,
  gateLinkWithPassword,
  gateStartUrl,
  linkErrorKey,
} from "../../src/client/GateAuthApi";

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAuthConfig", () => {
  it("returns the config", async () => {
    vi.stubGlobal("fetch", reply(200, { gate: true, legacy: false }));
    expect(await fetchAuthConfig()).toEqual({ gate: true, legacy: false });
  });

  it("falls back on http error, bad shape or network failure", async () => {
    const fallback = { gate: false, legacy: true };
    vi.stubGlobal("fetch", reply(500, {}));
    expect(await fetchAuthConfig()).toEqual(fallback);
    vi.stubGlobal("fetch", reply(200, { gate: "yes" }));
    expect(await fetchAuthConfig()).toEqual(fallback);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await fetchAuthConfig()).toEqual(fallback);
  });
});

describe("gate calls", () => {
  it("builds the start url", () => {
    expect(gateStartUrl()).toBe("http://api.test/auth/gate/start");
  });

  it("pending ok and no_pending", async () => {
    const pending = {
      loginName: "bob",
      displayName: "Bob",
      email: null,
      match: null,
      canCreate: false,
      usernameTaken: false,
    };
    vi.stubGlobal("fetch", reply(200, pending));
    expect(await fetchGatePending()).toEqual({ ok: true, pending });
    vi.stubGlobal("fetch", reply(401, { error: "no_pending" }));
    expect(await fetchGatePending()).toEqual({
      ok: false,
      status: 401,
      code: "no_pending",
    });
  });

  it("posts JSON with credentials and returns error codes", async () => {
    const fetchMock = reply(409, { error: "already_linked" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await gateLinkWithPassword("a", "b")).toEqual({
      ok: false,
      status: 409,
      code: "already_linked",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/auth/gate/link/password");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ username: "a", password: "b" }));

    vi.stubGlobal("fetch", reply(201, { ok: true }));
    expect(await gateCreate("bob")).toEqual({ ok: true });
    vi.stubGlobal("fetch", reply(429, {}));
    expect(await confirmGateLink()).toMatchObject({ code: "rate_limited" });
  });
});

describe("error keys", () => {
  it("maps known and unknown codes", () => {
    expect(gateErrorKey("denied")).toBe("gate_auth.error_denied");
    expect(gateErrorKey("account_disabled")).toBe(
      "gate_auth.error_account_disabled",
    );
    expect(gateErrorKey("weird")).toBe("gate_auth.error_unavailable");
    expect(linkErrorKey("invalid_credentials")).toBe(
      "gate_auth.error_invalid_credentials",
    );
    expect(linkErrorKey("x")).toBe("gate_auth.error_generic");
    expect(createErrorKey("username_taken")).toBe(
      "gate_auth.error_username_taken",
    );
    expect(createErrorKey("email_domain")).toBe("gate_auth.error_email_domain");
    expect(createErrorKey("email_not_approved")).toBe(
      "gate_auth.error_email_not_approved",
    );
  });
});
