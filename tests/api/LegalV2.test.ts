// @vitest-environment node
// Legal v2 dark launch (plans: ~/gll-planning/legal-hall/PLAN.md). LEGAL_VERSION unset = today.
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createApp, REFRESH_COOKIE } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { hashPassword } from "../../packages/api/src/passwords";
import { generatePublicId } from "../../packages/api/src/publicId";
import {
  defaultRateLimits,
  RateLimiter,
} from "../../packages/api/src/rateLimit";
import type { UserRow } from "../../packages/api/src/userMe";
import { memoryStore } from "./memoryStore";

const PW = "correct horse battery";
const VERSION = "2026-11-15";
const base = { API_URL: "http://localhost:8787", DOMAIN: "localhost" };

describe("LEGAL_VERSION env", () => {
  test("unset or empty is off; a date is on; anything else is refused", () => {
    expect(readEnv({ ...base }).legalVersion).toBe("");
    expect(readEnv({ ...base, LEGAL_VERSION: "" }).legalVersion).toBe("");
    expect(readEnv({ ...base, LEGAL_VERSION: VERSION }).legalVersion).toBe(
      VERSION,
    );
    for (const bad of ["tomorrow", "2026-1-5", "2026-11-15T00:00", "1"]) {
      expect(() => readEnv({ ...base, LEGAL_VERSION: bad })).toThrow(
        /LEGAL_VERSION/,
      );
    }
  });
});

describe("migration", () => {
  test("010_legal_v2.sql is additive: only ADD COLUMN IF NOT EXISTS on users", () => {
    const dir = "packages/api/migrations";
    expect(readdirSync(dir)).toContain("010_legal_v2.sql");
    const sql = readFileSync(`${dir}/010_legal_v2.sql`, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).toMatch(/ALTER TABLE users/i);
    expect(sql).toMatch(/legal_version/);
    expect(sql).toMatch(/legal_accepted_at/);
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|TRUNCATE/i);
  });
});

async function harness(legal: string) {
  const env = readEnv({
    ...base,
    GAME_ORIGIN: "http://localhost:5178",
    ...(legal ? { LEGAL_VERSION: legal } : {}),
  });
  const pw = await hashPassword(PW);
  const alice: UserRow = {
    id: randomUUID(),
    public_id: generatePublicId(),
    username: "alice",
    first_name: "F",
    last_name: "L",
    email: "alice@kmlhs.org",
    rank: "PLAYER",
    disabled_at: null,
  };
  const mem = memoryStore([alice], { [alice.id]: pw });
  const limits = defaultRateLimits();
  limits.loginIp = new RateLimiter(1000, 60_000);
  limits.registerIp = new RateLimiter(1000, 60_000);
  const server = createApp(
    { query: async () => ({}) },
    {
      env,
      keys: await keysFromPem(generatePrivateKeyPem()),
      store: mem.store,
      limits,
    },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    method: string,
    path: string,
    body?: unknown,
    h: Record<string, string> = {},
  ) =>
    fetch(url + path, {
      method,
      headers: { "content-type": "application/json", ...h },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const jwtFor = async (login: string) => {
    const r = await call("POST", "/auth/login", {
      usernameOrEmail: login,
      password: PW,
    });
    const raw = r.headers
      .getSetCookie()
      .find((c) => c.startsWith(REFRESH_COOKIE))!;
    const cookie = `${REFRESH_COOKIE}=${raw.split(";")[0].split("=")[1]}`;
    const jwt = (
      await (await call("POST", "/auth/refresh", undefined, { cookie })).json()
    ).jwt;
    return { authorization: `Bearer ${jwt}` };
  };
  return { mem, call, jwtFor, close: () => server.close() };
}

const signup = {
  firstName: "New",
  lastName: "Kid",
  email: "newkid@kmlhs.org",
  username: "NewKid",
  password: PW,
};

describe("dark (LEGAL_VERSION unset): exactly today", () => {
  test("config, @me and the accept route show nothing of legal v2", async () => {
    const h = await harness("");
    try {
      expect(
        await (await h.call("GET", "/auth/config")).json(),
      ).not.toHaveProperty("legalVersion");
      const auth = await h.jwtFor("alice");
      const me = await (
        await h.call("GET", "/users/@me", undefined, auth)
      ).json();
      expect(me).not.toHaveProperty("legal");
      expect((await h.call("POST", "/users/@me/legal", {}, auth)).status).toBe(
        404,
      );
    } finally {
      h.close();
    }
  });

  test("register still needs ageConfirmed, ignores legalAccepted, stores nothing", async () => {
    const h = await harness("");
    try {
      const no = await h.call("POST", "/auth/register", {
        ...signup,
        legalAccepted: true,
      });
      expect(no.status).toBe(400);
      expect((await no.json()).error).toBe("age_unconfirmed");
      const ok = await h.call("POST", "/auth/register", {
        ...signup,
        ageConfirmed: true,
      });
      expect(ok.status).toBe(201);
      const u = h.mem.users.find((x) => x.username === "NewKid")!;
      expect(u.legal_version ?? null).toBeNull();
    } finally {
      h.close();
    }
  });
});

describe("on (LEGAL_VERSION set)", () => {
  test("config announces the version", async () => {
    const h = await harness(VERSION);
    try {
      expect(
        (await (await h.call("GET", "/auth/config")).json()).legalVersion,
      ).toBe(VERSION);
    } finally {
      h.close();
    }
  });

  test("register needs legalAccepted and stores the version", async () => {
    const h = await harness(VERSION);
    try {
      const no = await h.call("POST", "/auth/register", {
        ...signup,
        ageConfirmed: true,
      });
      expect(no.status).toBe(400);
      expect((await no.json()).error).toBe("legal_unaccepted");
      const ok = await h.call("POST", "/auth/register", {
        ...signup,
        legalAccepted: true,
      });
      expect(ok.status).toBe(201);
      expect(
        h.mem.users.find((x) => x.username === "NewKid")!.legal_version,
      ).toBe(VERSION);
    } finally {
      h.close();
    }
  });

  test("@me reports required and accepted; accept records the server's version", async () => {
    const h = await harness(VERSION);
    try {
      const auth = await h.jwtFor("alice");
      const before = await (
        await h.call("GET", "/users/@me", undefined, auth)
      ).json();
      expect(before.legal).toEqual({ required: VERSION, accepted: null });
      const acc = await h.call(
        "POST",
        "/users/@me/legal",
        { version: "1999-01-01" },
        auth,
      );
      expect(acc.status).toBe(200);
      const after = await (
        await h.call("GET", "/users/@me", undefined, auth)
      ).json();
      expect(after.legal).toEqual({ required: VERSION, accepted: VERSION });
      expect((await h.call("POST", "/users/@me/legal", {})).status).toBe(401);
    } finally {
      h.close();
    }
  });
});
