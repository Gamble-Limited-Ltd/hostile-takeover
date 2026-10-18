import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "http://api.test",
}));

import { logOut } from "../../src/client/Auth";
import { takeGateLogoutUrl } from "../../src/client/GateHash";

afterEach(() => vi.unstubAllGlobals());

function reply(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

describe("logOut gate redirect", () => {
  it("parks gateLogoutUrl when the API returns one", async () => {
    reply({ ok: true, gateLogoutUrl: "https://id.test/oidc/logout?x=1" });
    expect(await logOut()).toBe(true);
    expect(takeGateLogoutUrl()).toBe("https://id.test/oidc/logout?x=1");
  });

  it("parks nothing otherwise", async () => {
    reply({ ok: true });
    expect(await logOut()).toBe(true);
    expect(takeGateLogoutUrl()).toBeNull();
  });
});
