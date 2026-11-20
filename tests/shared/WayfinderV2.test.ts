// @vitest-environment node
import {
  isOwnHost,
  ownHosts,
  pairFor,
  requestLabel,
  requestPlayer,
  routeFor,
  wayfinderOn,
} from "@openfront/shared/Wayfinder";
import { reportLeak } from "../../packages/api/src/leak";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let dir: string;
let file: string;
const put = (doc: unknown) => fs.writeFileSync(file, JSON.stringify(doc));
const DOC = {
  generation: 3,
  players: {
    alice: { ht: "a1ht", htapi: "a1api" },
    bob: { ht: "b1ht", htapi: "b1api" },
  },
  accepted: {
    ht: ["a1ht", "a0ht", "b1ht"],
    htapi: ["a1api", "a0api", "b1api"],
  },
};
const LO = "127.0.0.1";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf2-"));
  file = path.join(dir, "routes.v2.json");
  process.env.WAYFINDER_HOSTS_FILE = path.join(dir, "absent.json");
});
afterEach(() => {
  delete process.env.WAYFINDER_ROUTES_FILE;
  delete process.env.WAYFINDER_HOSTS_FILE;
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("flag off", () => {
  test("no env flag: nothing changes", () => {
    put(DOC);
    expect(wayfinderOn()).toBe(false);
    expect(ownHosts("ht")).toEqual([]);
    expect(routeFor("alice", "ht")).toBeNull();
  });
  test("flag set, file absent: legacy", () => {
    process.env.WAYFINDER_ROUTES_FILE = file;
    expect(wayfinderOn()).toBe(false);
  });
});

describe("v2 table", () => {
  beforeEach(() => {
    process.env.WAYFINDER_ROUTES_FILE = file;
    put(DOC);
  });
  test("own host = accepted label (live, spare, grace)", () => {
    expect(wayfinderOn()).toBe(true);
    expect(isOwnHost("ht", "a0ht.taps-holdings.org")).toBe(true);
    expect(isOwnHost("ht", "A1HT.taps-holdings.org:443")).toBe(true);
    expect(isOwnHost("ht", "a1api.taps-holdings.org")).toBe(false);
    expect(isOwnHost("htapi", "a0api.taps-holdings.org")).toBe(true);
    expect(isOwnHost("ht", "evil.example.com")).toBe(false);
  });
  test("without `accepted` the in-use labels are accepted", () => {
    put({ ...DOC, accepted: undefined });
    expect(ownHosts("ht").sort()).toEqual([
      "a1ht.taps-holdings.org",
      "b1ht.taps-holdings.org",
    ]);
  });
  test("routeFor and pairFor", () => {
    expect(routeFor("alice", "htapi")).toBe("a1api.taps-holdings.org");
    expect(routeFor("nobody", "ht")).toBeNull();
    expect(pairFor("b1api.taps-holdings.org")).toEqual({
      ht: "b1ht.taps-holdings.org",
      htapi: "b1api.taps-holdings.org",
    });
    // a spare label has no owner by itself: the edge player decides
    expect(pairFor("a0ht.taps-holdings.org")).toBeNull();
    expect(pairFor("a0ht.taps-holdings.org", "alice")?.ht).toBe(
      "a1ht.taps-holdings.org",
    );
  });
  test("edge headers are trusted from loopback only", () => {
    const h = { "x-wayfinder-player": "alice", "x-wayfinder-label": "a1api" };
    expect(requestPlayer(h, LO)).toBe("alice");
    expect(requestLabel(h, LO)).toBe("a1api");
    expect(requestPlayer(h, "203.0.113.9")).toBeUndefined();
    expect(requestLabel(h, undefined)).toBeUndefined();
  });
});

describe("leak report", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  const req = (sock: string, player = "alice") => ({
    headers: { "x-wayfinder-player": player, "x-wayfinder-label": "a1api" },
    socket: { remoteAddress: sock },
  });
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.WAYFINDER_ROUTES_FILE = file;
    process.env.WAYFINDER_API_URL = "http://wf.local/";
    process.env.WAYFINDER_SERVICE_TOKEN = "tok";
    put(DOC);
  });
  afterEach(() => {
    delete process.env.WAYFINDER_API_URL;
    delete process.env.WAYFINDER_SERVICE_TOKEN;
  });
  test("mismatch posts label and sub with the bearer token", () => {
    reportLeak(req(LO) as any, "bob");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, any];
    expect(url).toBe("http://wf.local/internal/leak");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      label: "a1api",
      signedInSub: "bob",
    });
  });
  test("owner match, untrusted peer, flag off: no report", () => {
    reportLeak(req(LO) as any, "alice");
    reportLeak(req("203.0.113.9") as any, "bob");
    delete process.env.WAYFINDER_ROUTES_FILE;
    reportLeak(req(LO) as any, "bob");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("a failing report never throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(() => reportLeak(req(LO) as any, "bob")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
