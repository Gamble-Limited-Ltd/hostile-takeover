// @vitest-environment node
import express from "express";
import fs from "fs";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { mountLaunch } from "../../src/server/LaunchPage";

let dir: string;
let close: () => void;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-"));
  process.env.WAYFINDER_HOSTS_FILE = path.join(dir, "hosts.json");
});
afterEach(() => {
  close?.();
  delete process.env.WAYFINDER_HOSTS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function get(p: string, host?: string) {
  const app = express();
  mountLaunch(app);
  const s = app.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  close = () => s.close();
  return fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`, {
    headers: host ? { "x-forwarded-host": host } : {},
  });
}
const table = () =>
  fs.writeFileSync(
    path.join(dir, "hosts.json"),
    JSON.stringify({
      domain: "taps-holdings.org",
      current: { ht: "bbb", htapi: "ccc" },
      previous: null,
    }),
  );

test("legacy mode: no launch page, no script", async () => {
  expect((await get("/auth/launch")).status).toBe(404);
  expect((await get("/auth/launch.js")).status).toBe(404);
});

test("page has no inline script and names this host's API", async () => {
  table();
  const r = await get("/auth/launch", "bbb.taps-holdings.org");
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  const html = await r.text();
  expect(html).toContain('<script src="/auth/launch.js"></script>');
  expect(html.replace(/<script src="[^"]*"><\/script>/g, "")).not.toMatch(
    /<script/i,
  );
  expect(html).toContain('content="https://ccc.taps-holdings.org"');
  expect(html).toContain("https://hall.taps-holdings.org");
});

test("script reads the fragment, clears it, posts to the API, only follows known hashes", async () => {
  table();
  const r = await get("/auth/launch.js");
  expect(r.headers.get("content-type")).toContain("javascript");
  const js = await r.text();
  expect(js).toContain("location.hash");
  expect(js).toContain("replaceState");
  expect(js).toContain("/auth/launch");
  expect(js).toContain("gate=(ok|link)");
});
