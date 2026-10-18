import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "http://api.test",
}));

import { directCall } from "../../src/client/GateDirectApi";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("directCall", () => {
  it("posts JSON with credentials to the direct route", async () => {
    const f = reply(200, { status: "ok" });
    vi.stubGlobal("fetch", f);
    expect(
      await directCall("login", { identifier: "a", password: "b" }),
    ).toEqual({ ok: true, status: "ok", pending: undefined });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/gate/direct/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("returns GLL ID's message and field messages as sent", async () => {
    vi.stubGlobal(
      "fetch",
      reply(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Check the form.",
          fields: { password: "Too short.", junk: 5 },
        },
      }),
    );
    expect(await directCall("signup", {})).toEqual({
      ok: false,
      pending: undefined,
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the form.",
        fields: { password: "Too short." },
      },
    });
  });

  it("keeps the pending handle of EMAIL_UNVERIFIED", async () => {
    vi.stubGlobal(
      "fetch",
      reply(403, {
        error: { code: "EMAIL_UNVERIFIED", message: "Check your email." },
        pending: "h1",
      }),
    );
    const r = await directCall("login", {});
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pending).toBe("h1");
  });

  it("shows GLL ID's DIRECT_SIGNIN_DISABLED message", async () => {
    vi.stubGlobal(
      "fetch",
      reply(403, {
        error: { code: "DIRECT_SIGNIN_DISABLED", message: "Turned off." },
      }),
    );
    const r = await directCall("login", {});
    expect(r.ok === false && r.error.message).toBe("Turned off.");
  });

  it("a network failure resolves with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("x"))),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await directCall("login", {});
    expect(r.ok).toBe(false);
  });
});
