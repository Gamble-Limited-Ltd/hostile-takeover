// @vitest-environment node
// Hostile Takeover game server under Wayfinder: hosts come from the runtime
// file per request; with no file everything is the legacy env behaviour.
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyGameApiCorsHeaders } from "../../src/server/GameApiCors";
import {
  clearAppShellContentCache,
  getAppShellContent,
} from "../../src/server/RenderHtml";
import { securityHeaders } from "../../src/server/SecurityHeaders";
import { ServerEnv } from "../../src/server/ServerEnv";

let dir: string;
let file: string;
const write = (ht: string, htapi: string, prev?: [string, string]) => {
  // Atomic swap, as Wayfinder writes it.
  fs.writeFileSync(
    file + ".tmp",
    JSON.stringify({
      domain: "taps-holdings.org",
      current: { ht, htapi },
      previous: prev
        ? {
            hosts: { ht: prev[0], htapi: prev[1] },
            expires: new Date(Date.now() + 3600_000).toISOString(),
          }
        : null,
    }),
  );
  fs.renameSync(file + ".tmp", file);
};
const bump = () => vi.setSystemTime(Date.now() + 1500);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfg-"));
  file = path.join(dir, "hosts.json");
  process.env.WAYFINDER_HOSTS_FILE = file;
  vi.stubEnv("DOMAIN", "ht-5.taps-holdings.org");
  vi.stubEnv("GAME_HOST", "ht-5.taps-holdings.org");
  vi.stubEnv("API_URL", "https://ht-api-5.taps-holdings.org");
  vi.stubEnv("INSTANCE_LETTER", "a");
  vi.stubEnv("NUM_WORKERS", "1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.WAYFINDER_HOSTS_FILE;
  clearAppShellContentCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function cspFor(): string {
  let csp = "";
  securityHeaders()(
    {} as never,
    {
      setHeader: (n: string, v: string) =>
        n === "Content-Security-Policy" && (csp = v),
    } as never,
    () => {},
  );
  return csp;
}
// One middleware instance across rotations, as the server has.
function liveMiddleware() {
  const mw = securityHeaders();
  return () => {
    let csp = "";
    mw(
      {} as never,
      {
        setHeader: (n: string, v: string) =>
          n === "Content-Security-Policy" && (csp = v),
      } as never,
      () => {},
    );
    return csp;
  };
}

describe("CSP per request", () => {
  test("legacy: no file, CSP names the env hosts", () => {
    const csp = cspFor();
    expect(csp).toContain("wss://ht-5.taps-holdings.org");
    expect(csp).toContain("https://ht-api-5.taps-holdings.org");
  });

  test("a rotation without restart changes the CSP: current and previous hosts, no stale env", () => {
    write("bbb", "ccc", ["aaa", "zzz"]);
    const csp = liveMiddleware();
    const first = csp();
    for (const h of ["bbb", "aaa"]) {
      expect(first).toContain(`wss://${h}.taps-holdings.org`);
    }
    for (const h of ["ccc", "zzz"]) {
      expect(first).toContain(`https://${h}.taps-holdings.org`);
    }
    expect(first).not.toContain("ht-5");
    write("ddd", "eee", ["bbb", "ccc"]);
    bump();
    const second = csp();
    expect(second).toContain("wss://ddd.taps-holdings.org");
    expect(second).toContain("https://eee.taps-holdings.org");
    expect(second).not.toContain("aaa.taps-holdings.org");
  });
});

describe("CORS and publicHost", () => {
  const allowed = (origin: string) => {
    const h = new Map<string, string>();
    applyGameApiCorsHeaders(origin, (n, v) => void h.set(n, v));
    return h.get("Access-Control-Allow-Origin") === origin;
  };

  test("legacy: env host only", () => {
    expect(ServerEnv.publicHost()).toBe("ht-5.taps-holdings.org");
    expect(allowed("https://ht-5.taps-holdings.org")).toBe(true);
    expect(allowed("https://bbb.taps-holdings.org")).toBe(false);
  });

  test("Wayfinder: current and previous game hosts allowed, API host and unknown not", () => {
    write("bbb", "ccc", ["aaa", "zzz"]);
    expect(ServerEnv.publicHost()).toBe("bbb.taps-holdings.org");
    expect(allowed("https://bbb.taps-holdings.org")).toBe(true);
    expect(allowed("https://aaa.taps-holdings.org")).toBe(true);
    expect(allowed("https://ccc.taps-holdings.org")).toBe(false);
    expect(allowed("https://evil.example")).toBe(false);
    expect(allowed("http://bbb.taps-holdings.org")).toBe(false);
  });
});

describe("app shell host", () => {
  const html =
    "<%- typeof serverHost !== 'undefined' ? serverHost : 'none' %>|" +
    "<%- typeof apiUrl !== 'undefined' ? apiUrl : 'none' %>|<%- cluster %>";
  async function shell(host?: string) {
    const p = path.join(dir, "index.html");
    await fsp.writeFile(p, html);
    return getAppShellContent(p, host);
  }

  test("legacy: env values", async () => {
    const out = await shell();
    expect(out).toContain(
      '"ht-5.taps-holdings.org"|"https://ht-api-5.taps-holdings.org"',
    );
  });

  test("Wayfinder: the page names its own host and that generation's API", async () => {
    write("bbb", "ccc", ["aaa", "zzz"]);
    const cur = await shell("bbb.taps-holdings.org");
    expect(cur).toContain(
      '"bbb.taps-holdings.org"|"https://ccc.taps-holdings.org"',
    );
    expect(cur).toContain('"host":"bbb.taps-holdings.org"');
    const prev = await shell("aaa.taps-holdings.org");
    expect(prev).toContain(
      '"aaa.taps-holdings.org"|"https://zzz.taps-holdings.org"',
    );
    expect(prev).toContain('"host":"aaa.taps-holdings.org"');
  });

  test("Wayfinder: an unknown host gets the current generation", async () => {
    write("bbb", "ccc");
    const out = await shell("evil.example");
    expect(out).toContain(
      '"bbb.taps-holdings.org"|"https://ccc.taps-holdings.org"',
    );
  });
});
