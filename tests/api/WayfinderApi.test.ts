// @vitest-environment node
// HT API under Wayfinder: hosts come from the runtime host table per request;
// with no table the env behaviour is unchanged. Also the HALL launch ticket.
import fs from "fs";
import { SignJWT, generateKeyPair } from "jose";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp, REFRESH_COOKIE } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { generatePublicId } from "../../packages/api/src/publicId";
import {
  defaultRateLimits,
  RateLimiter,
} from "../../packages/api/src/rateLimit";
import { resetLink } from "../../packages/api/src/resets";
import type { UserRow } from "../../packages/api/src/userMe";
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, startFakeGate } from "./fakeGate";
import { memoryStore } from "./memoryStore";

const DOMAIN = "taps-holdings.org";
let dir: string;
let table: string;
const write = (ht: string, htapi: string, prev?: [string, string]) => {
  fs.writeFileSync(
    table + ".tmp",
    JSON.stringify({
      domain: DOMAIN,
      current: { ht, htapi },
      previous: prev
        ? {
            hosts: { ht: prev[0], htapi: prev[1] },
            expires: new Date(Date.now() + 3600_000).toISOString(),
          }
        : null,
    }),
  );
  fs.renameSync(table + ".tmp", table);
};

const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfa-"));
  table = path.join(dir, "hosts.json");
  process.env.WAYFINDER_HOSTS_FILE = table;
});
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  vi.useRealTimers();
  delete process.env.WAYFINDER_HOSTS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

function row(name: string, extra: Partial<UserRow> = {}): UserRow {
  return {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: name,
    first_name: "F",
    last_name: "L",
    email: `${name}@kmlhs.org`,
    rank: "PLAYER",
    disabled_at: null,
    gate_sub: null,
    ...extra,
  };
}

async function harness(users: UserRow[] = [], limits = defaultRateLimits()) {
  const fake = await startFakeGate();
  cleanup.push(fake.close);
  const hall = await generateKeyPair("EdDSA", { extractable: true });
  const mem = memoryStore(users, {});
  const env = readEnv({
    API_URL: "https://ht-api.taps-holdings.org",
    DOMAIN: "ht.taps-holdings.org",
    GAME_ORIGIN: "https://ht-7.taps-holdings.org",
    HT_GAME_HOST: "ht-7.taps-holdings.org",
    GATE_ISSUER: fake.issuer,
    GATE_CLIENT_ID: FAKE_CLIENT_ID,
    GATE_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    HT_NEWS_NOTICE: "Tomorrow we move to ht-8",
  });
  const server = createApp(
    { query: async () => ({}) },
    {
      env,
      keys: await keysFromPem(generatePrivateKeyPem()),
      store: mem.store,
      limits,
      launchKeys: async () => hall.publicKey,
    },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The test peer is loopback, like the edge, so X-Forwarded-Host is trusted.
  const req = (p: string, o: RequestInit & { host?: string } = {}) =>
    fetch(base + p, {
      redirect: "manual",
      ...o,
      headers: {
        ...(o.host ? { "x-forwarded-host": o.host } : {}),
        ...(o.headers as Record<string, string>),
      },
    });
  const ticket = async (
    over: Record<string, unknown> = {},
    key = hall.privateKey,
  ) =>
    new SignJWT({
      login_name: "alice",
      email: "alice@kmlhs.org",
      email_approved: true,
      ...over,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "h1" })
      .setIssuer((over.iss as string) ?? "https://hall.taps-holdings.org")
      .setAudience((over.aud as string) ?? FAKE_CLIENT_ID)
      .setSubject((over.sub as string) ?? "gate-sub-1")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime((over.exp as string) ?? "60s")
      .sign(key);
  const launch = (t: string, host = "ccc.taps-holdings.org") =>
    req("/auth/launch", {
      method: "POST",
      host,
      headers: {
        "content-type": "application/json",
        origin: `https://${host.replace("ccc", "bbb")}`,
      },
      body: JSON.stringify({ ticket: t }),
    });
  return { fake, mem, env, req, ticket, launch, hall };
}

describe("legacy (no host table)", () => {
  test("env hosts, env notice, launch route off", async () => {
    const h = await harness();
    const c = await (await h.req("/cluster.json")).json();
    expect(c.servers.a.host).toBe("ht-7.taps-holdings.org");
    const news = await (await h.req("/news.json")).json();
    expect(news[0].title).toBe("Tomorrow we move to ht-8");
    const pre = await h.req("/auth/config", {
      method: "OPTIONS",
      headers: { origin: "https://bbb.taps-holdings.org" },
    });
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const l = await h.req("/auth/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: await h.ticket() }),
    });
    expect(l.status).toBe(404);
  });
});

describe("with a host table", () => {
  beforeEach(() => write("bbb", "ccc", ["aaa", "zzz"]));

  test("CORS: own game hosts only (current and previous), credentials on", async () => {
    const h = await harness();
    for (const o of ["bbb", "aaa"]) {
      const r = await h.req("/auth/config", {
        headers: { origin: `https://${o}.taps-holdings.org` },
      });
      expect(r.headers.get("access-control-allow-origin")).toBe(
        `https://${o}.taps-holdings.org`,
      );
      expect(r.headers.get("access-control-allow-credentials")).toBe("true");
    }
    const bad = await h.req("/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(bad.status).toBe(403);
    const api = await h.req("/auth/logout", {
      method: "POST",
      headers: { origin: "https://ccc.taps-holdings.org" },
    });
    expect(api.status).toBe(403);
  });

  test("cluster.json names the game host of the asking API host's generation", async () => {
    const h = await harness();
    expect(
      (
        await (
          await h.req("/cluster.json", { host: "ccc.taps-holdings.org" })
        ).json()
      ).servers.a.host,
    ).toBe("bbb.taps-holdings.org");
    expect(
      (
        await (
          await h.req("/cluster.json", { host: "zzz.taps-holdings.org" })
        ).json()
      ).servers.a.host,
    ).toBe("aaa.taps-holdings.org");
    expect(
      (await (await h.req("/cluster.json", { host: "evil.example" })).json())
        .servers.a.host,
    ).toBe("bbb.taps-holdings.org");
  });

  test("news notice is 'Always play through HALL', never tomorrow's address", async () => {
    const h = await harness();
    const news = await (await h.req("/news.json")).json();
    expect(news[0].title).toBe("Always play through HALL");
    expect(JSON.stringify(news)).not.toContain("ht-8");
  });

  test("GATE sign-in uses the redirect URI and return host of the request's own generation", async () => {
    const h = await harness();
    const r = await h.req("/auth/gate/start", {
      host: "zzz.taps-holdings.org",
    });
    const loc = new URL(r.headers.get("location")!);
    expect(loc.searchParams.get("redirect_uri")).toBe(
      "https://zzz.taps-holdings.org/auth/gate/callback",
    );
    // A host that is not ours never ends up in a URL: current generation.
    const r2 = await h.req("/auth/gate/start", { host: "evil.example" });
    expect(
      new URL(r2.headers.get("location")!).searchParams.get("redirect_uri"),
    ).toBe("https://ccc.taps-holdings.org/auth/gate/callback");
  });
});

describe("launch ticket", () => {
  beforeEach(() => write("bbb", "ccc"));

  test("signs a linked player in once; the same ticket twice is a replay", async () => {
    const h = await harness([row("alice", { gate_sub: "gate-sub-1" })]);
    const t = await h.ticket();
    const ok = await h.launch(t);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ hash: "gate=ok" });
    expect(
      ok.headers.getSetCookie().some((c) => c.startsWith(`${REFRESH_COOKIE}=`)),
    ).toBe(true);
    expect((await h.launch(t)).status).toBe(400);
  });

  test("an unlinked player lands in the normal link/create flow", async () => {
    const h = await harness([row("alice")]);
    const r = await h.launch(await h.ticket({ sub: "new-sub" }));
    expect(r.status).toBe(200);
    expect((await r.json()).hash).toBe("gate=link");
  });

  test.each([
    ["wrong audience", { aud: "casino" }],
    ["wrong issuer", { iss: "https://evil.example" }],
    ["expired", { exp: "-10s" }],
  ])("%s is refused and sets no cookie", async (_n, over) => {
    const h = await harness([row("alice", { gate_sub: "gate-sub-1" })]);
    const r = await h.launch(await h.ticket(over));
    expect(r.status).toBe(400);
    expect(r.headers.getSetCookie()).toEqual([]);
  });

  test("a ticket signed by another key is refused", async () => {
    const h = await harness([row("alice", { gate_sub: "gate-sub-1" })]);
    const other = await generateKeyPair("EdDSA");
    expect((await h.launch(await h.ticket({}, other.privateKey))).status).toBe(
      400,
    );
  });

  test("a disabled account gets no session", async () => {
    const h = await harness([
      row("alice", { gate_sub: "gate-sub-1", disabled_at: new Date() }),
    ]);
    const r = await h.launch(await h.ticket());
    expect(r.status).toBe(403);
    expect(r.headers.getSetCookie()).toEqual([]);
  });

  test("from a foreign origin the route is refused (CORS)", async () => {
    const h = await harness([row("alice", { gate_sub: "gate-sub-1" })]);
    const r = await h.req("/auth/launch", {
      method: "POST",
      host: "ccc.taps-holdings.org",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ ticket: await h.ticket() }),
    });
    expect(r.status).toBe(403);
  });

  test("garbage body is a 400, not a crash", async () => {
    const h = await harness();
    const r = await h.req("/auth/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(400);
  });
  test("a flood from one address is cut off with 429", async () => {
    const limits = defaultRateLimits();
    limits.launchIp = new RateLimiter(2, 60_000);
    const h = await harness([], limits);
    const post = () =>
      h.req("/auth/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(429);
  });
});

describe("password reset link", () => {
  test("points at the current game host under Wayfinder", () => {
    write("bbb", "ccc", ["old", "olda"]);
    expect(resetLink({ gameOrigin: "https://ht-7.x" }, "tok")).toBe(
      `https://bbb.${DOMAIN}/#reset=tok`,
    );
  });

  test("uses GAME_ORIGIN in legacy mode", () => {
    expect(resetLink({ gameOrigin: "https://ht-7.x" }, "tok")).toBe(
      "https://ht-7.x/#reset=tok",
    );
  });
});
