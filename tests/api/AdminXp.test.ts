// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { createApp } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { generatePublicId } from "../../packages/api/src/publicId";
import { signJwt } from "../../packages/api/src/tokens";
import type { UserRow } from "../../packages/api/src/userMe";
import { buildLevels, xpToNext } from "../../packages/api/src/xp/rules";
import { memoryStore } from "./memoryStore";

const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
});

const row = (rank: string, name: string): UserRow => ({
  id: randomUUID(),
  public_id: generatePublicId(),
  username: name,
  first_name: "F",
  last_name: "L",
  email: `${name}@kmlhs.org`,
  rank,
  disabled_at: null,
});

async function setup() {
  const boss = row("THE_STRONGEST", "boss");
  const alice = row("PLAYER", "alice");
  const mem = memoryStore([boss, alice], {});
  const keys = await keysFromPem(generatePrivateKeyPem());
  const server = createApp(
    { query: async () => ({}) },
    { env, keys, store: mem.store },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (
    method: string,
    path: string,
    as?: UserRow,
    body?: unknown,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as
          ? { authorization: `Bearer ${await signJwt(keys, env, as)}` }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { mem, boss, alice, call, close: () => server.close() };
}

async function using(
  fn: (h: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const h = await setup();
  try {
    await fn(h);
  } finally {
    h.close();
  }
}

const P = "/admin/users/alice/progress";

describe("admin XP", () => {
  test("anonymous 401, non-root 403, unknown user 404", async () => {
    await using(async (h) => {
      expect((await h.call("GET", P)).status).toBe(401);
      expect((await h.call("GET", P, h.alice)).status).toBe(403);
      expect(
        (await h.call("POST", P, h.alice, { action: "reset" })).status,
      ).toBe(403);
      expect(
        (await h.call("GET", "/admin/users/nobody/progress", h.boss)).status,
      ).toBe(404);
    });
  });

  test("view, set recomputes the level, reset, and both are audited", async () => {
    await using(async (h) => {
      const v = await (await h.call("GET", P, h.boss)).json();
      expect(v).toMatchObject({
        username: "alice",
        publicId: h.alice.public_id,
        games: 0,
        progress: { level: 1, lifetimeXp: 0 },
      });

      const xp = buildLevels()[2].cumulativeXp + 5;
      const set = await (
        await h.call("POST", P, h.boss, { action: "set", lifetimeXp: xp })
      ).json();
      expect(set.progress).toMatchObject({
        level: 3,
        xpInLevel: 5,
        xpForNext: xpToNext(3),
        lifetimeXp: xp,
      });
      const again = await (await h.call("GET", P, h.boss)).json();
      expect(again.progress.level).toBe(3);

      const reset = await (
        await h.call("POST", P, h.boss, { action: "reset" })
      ).json();
      expect(reset.progress).toMatchObject({
        level: 1,
        xpInLevel: 0,
        lifetimeXp: 0,
      });

      expect(h.mem.audit.map((a) => [a.actor, a.action, a.target])).toEqual([
        ["boss", "xp_set", "alice"],
        ["boss", "xp_reset", "alice"],
      ]);
      expect(h.mem.audit[0].detail).toMatchObject({
        before: { level: 1 },
        after: { level: 3, xpInLevel: 5 },
      });
    });
  });

  test("bad bodies are 400 and change nothing", async () => {
    await using(async (h) => {
      for (const body of [
        {},
        { action: "set" },
        { action: "set", lifetimeXp: -1 },
        { action: "set", lifetimeXp: 1.5 },
        { action: "set", lifetimeXp: "5" },
      ]) {
        expect((await h.call("POST", P, h.boss, body)).status).toBe(400);
      }
      expect(h.mem.audit).toHaveLength(0);
    });
  });
});
