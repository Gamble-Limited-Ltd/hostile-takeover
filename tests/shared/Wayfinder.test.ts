// @vitest-environment node
import {
  ownHosts,
  isOwnHost,
  pairFor,
  requestHost,
  wayfinderHosts,
} from "@openfront/shared/Wayfinder";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let dir: string;
let file: string;
const table = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    generation: 2,
    domain: "taps-holdings.org",
    current: { ht: "bbb", htapi: "ccc", id: "x" },
    previous: {
      hosts: { ht: "aaa", htapi: "zzz" },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    },
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-"));
  file = path.join(dir, "hosts.json");
  process.env.WAYFINDER_HOSTS_FILE = file;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.WAYFINDER_HOSTS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const bump = (ms = 1500) => vi.setSystemTime(Date.now() + ms);

describe("wayfinderHosts", () => {
  test("file absent is legacy mode: null, no own hosts", () => {
    expect(wayfinderHosts()).toBeNull();
    expect(ownHosts("ht")).toEqual([]);
    expect(isOwnHost("ht", "anything.taps-holdings.org")).toBe(false);
  });

  test("file present gives full names, current first", () => {
    fs.writeFileSync(file, table());
    expect(ownHosts("ht")).toEqual([
      "bbb.taps-holdings.org",
      "aaa.taps-holdings.org",
    ]);
    expect(ownHosts("htapi")).toEqual([
      "ccc.taps-holdings.org",
      "zzz.taps-holdings.org",
    ]);
  });

  test("a change is seen after the 1 s cache window, not before", () => {
    fs.writeFileSync(file, table());
    expect(ownHosts("ht")[0]).toBe("bbb.taps-holdings.org");
    fs.writeFileSync(file, table({ current: { ht: "new", htapi: "n2" } }));
    expect(ownHosts("ht")[0]).toBe("bbb.taps-holdings.org");
    bump();
    expect(ownHosts("ht")[0]).toBe("new.taps-holdings.org");
  });

  test("garbage keeps the last good value", () => {
    fs.writeFileSync(file, table());
    expect(ownHosts("ht")).toHaveLength(2);
    bump();
    fs.writeFileSync(file, "{not json");
    expect(ownHosts("ht")[0]).toBe("bbb.taps-holdings.org");
  });

  test("garbage on first read is legacy mode", () => {
    fs.writeFileSync(file, "nope");
    expect(wayfinderHosts()).toBeNull();
  });

  test("labels that are not plain hostnames are refused", () => {
    fs.writeFileSync(
      file,
      table({ current: { ht: "a.evil.com", htapi: "c" } }),
    );
    expect(wayfinderHosts()).toBeNull();
  });

  test("previous is dropped once it expires", () => {
    fs.writeFileSync(
      file,
      table({
        previous: {
          hosts: { ht: "aaa", htapi: "zzz" },
          expires: new Date(Date.now() + 5000).toISOString(),
        },
      }),
    );
    expect(isOwnHost("ht", "aaa.taps-holdings.org")).toBe(true);
    bump(6000);
    expect(isOwnHost("ht", "aaa.taps-holdings.org")).toBe(false);
    expect(isOwnHost("ht", "bbb.taps-holdings.org")).toBe(true);
  });

  test("previous null is fine; file removed returns to legacy", () => {
    fs.writeFileSync(file, table({ previous: null }));
    expect(ownHosts("ht")).toEqual(["bbb.taps-holdings.org"]);
    bump();
    fs.rmSync(file);
    expect(wayfinderHosts()).toBeNull();
  });
});

describe("isOwnHost", () => {
  test("ignores case and port, rejects unknown and the other key", () => {
    fs.writeFileSync(file, table());
    expect(isOwnHost("ht", "BBB.taps-holdings.org:443")).toBe(true);
    expect(isOwnHost("ht", "ccc.taps-holdings.org")).toBe(false);
    expect(isOwnHost("ht", "evil.example")).toBe(false);
    expect(isOwnHost("ht", undefined)).toBe(false);
  });
});

describe("pairFor", () => {
  test("pairs the game and API host of one generation", () => {
    fs.writeFileSync(file, table());
    expect(pairFor("aaa.taps-holdings.org")).toEqual({
      ht: "aaa.taps-holdings.org",
      htapi: "zzz.taps-holdings.org",
    });
    expect(pairFor("zzz.taps-holdings.org")?.ht).toBe("aaa.taps-holdings.org");
  });
  test("unknown or missing host falls back to current; legacy is null", () => {
    expect(pairFor("x")).toBeNull();
    fs.writeFileSync(file, table());
    bump();
    expect(pairFor("evil.example")?.ht).toBe("bbb.taps-holdings.org");
    expect(pairFor(undefined)?.htapi).toBe("ccc.taps-holdings.org");
  });
});

describe("requestHost", () => {
  test("X-Forwarded-Host is trusted from loopback only", () => {
    const h = {
      host: "inner:3000",
      "x-forwarded-host": "bbb.taps-holdings.org",
    };
    expect(requestHost(h, "127.0.0.1")).toBe("bbb.taps-holdings.org");
    expect(requestHost(h, "::ffff:127.0.0.1")).toBe("bbb.taps-holdings.org");
    expect(requestHost(h, "::1")).toBe("bbb.taps-holdings.org");
    expect(requestHost(h, "10.0.0.5")).toBe("inner:3000");
    expect(requestHost({ host: "h" }, undefined)).toBe("h");
  });
});
