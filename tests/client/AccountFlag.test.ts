import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "http://api.test",
}));
const { getAuthHeader } = vi.hoisted(() => ({ getAuthHeader: vi.fn() }));
vi.mock("../../src/client/Auth", () => ({ getAuthHeader }));

const load = async () => {
  vi.resetModules();
  return import("../../src/client/AccountFlag");
};

function stubFetch(flag: string | null) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ flag }),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("AccountFlag", () => {
  beforeEach(() => getAuthHeader.mockResolvedValue("Bearer t"));

  it("account flag wins over the local one", async () => {
    const { syncAccountFlag } = await load();
    stubFetch("country:fr");
    const s = { getFlag: () => "country:de", setFlag: vi.fn() };
    await syncAccountFlag(s);
    expect(s.setFlag).toHaveBeenCalledWith("country:fr");
  });

  it("an empty account adopts the local flag", async () => {
    const { syncAccountFlag } = await load();
    const fetchFn = stubFetch(null);
    const s = { getFlag: () => "country:de", setFlag: vi.fn() };
    await syncAccountFlag(s);
    expect(s.setFlag).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    expect(fetchFn.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ flag: "country:de" }),
    });
  });

  it("signed out does nothing", async () => {
    const { syncAccountFlag, saveAccountFlag } = await load();
    getAuthHeader.mockResolvedValue("");
    const fetchFn = stubFetch("country:fr");
    const s = { getFlag: () => null, setFlag: vi.fn() };
    await syncAccountFlag(s);
    saveAccountFlag("country:fr");
    await Promise.resolve();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(s.setFlag).not.toHaveBeenCalled();
  });
});
