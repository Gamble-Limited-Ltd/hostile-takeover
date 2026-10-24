// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { describe, expect, test } from "vitest";
import { createApp } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { generatePublicId } from "../../packages/api/src/publicId";
import { pgStore, type Store } from "../../packages/api/src/store";
import { signJwt } from "../../packages/api/src/tokens";
import type { UserRow } from "../../packages/api/src/userMe";
import countries from "../../resources/countries.json";
import { memoryStore } from "./memoryStore";

const env = readEnv({
  API_URL: "http://localhost:8787",
  DOMAIN: "localhost",
  GAME_ORIGIN: "http://localhost:5178",
});

const CODE = `country:${countries.find((c) => c.code !== "xx" && !(c as { restricted?: boolean }).restricted)!.code}`;

async function harness(store: Store) {
  const keys = await keysFromPem(generatePrivateKeyPem());
  const server = createApp(
    { query: async () => ({}) },
    { env, keys, store },
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
  return { call, close: () => server.close() };
}

async function scenario(store: Store, u: UserRow, publicId: string) {
  const h = await harness(store);
  try {
    expect((await h.call("PUT", "/users/@me/flag", undefined, {})).status).toBe(
      401,
    );
    expect((await h.call("GET", "/users/@me/flag")).status).toBe(401);
    for (const bad of [
      { flag: "country:nope" },
      { flag: "country:xx" },
      { flag: 5 },
      {},
    ]) {
      expect((await h.call("PUT", "/users/@me/flag", u, bad)).status).toBe(400);
    }
    expect(await (await h.call("GET", "/users/@me/flag", u)).json()).toEqual({
      flag: null,
    });
    expect(
      (await h.call("PUT", "/users/@me/flag", u, { flag: CODE })).status,
    ).toBe(200);
    expect(await (await h.call("GET", "/users/@me/flag", u)).json()).toEqual({
      flag: CODE,
    });
    expect(
      (await (await h.call("GET", `/public/player/${publicId}`)).json()).flag,
    ).toBe(CODE);
    await h.call("PUT", "/users/@me/flag", u, { flag: null });
    expect(await (await h.call("GET", "/users/@me/flag", u)).json()).toEqual({
      flag: null,
    });
  } finally {
    h.close();
  }
}

const row = (name: string): UserRow => ({
  id: randomUUID(),
  public_id: generatePublicId(),
  username: name,
  first_name: "F",
  last_name: "L",
  email: `${name}@kmlhs.org`,
  rank: "PLAYER",
  disabled_at: null,
});

describe("profile flag", () => {
  test("validate, save, read, clear (memory store)", async () => {
    const u = row("alice");
    await scenario(memoryStore([u], {}).store, u, u.public_id);
  });
});

describe.skipIf(process.env.HT_TEST_DB !== "1")("real database", () => {
  test("same scenario against Postgres", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const name = "itest" + randomUUID().slice(0, 8);
    const publicId = generatePublicId();
    try {
      const r = await pool.query(
        `INSERT INTO users (public_id, username, first_name, last_name, email, password_hash, age_confirmed_at)
         VALUES ($1, $2, 'I', 'T', $3, 'x', now()) RETURNING id`,
        [publicId, name, `${name}@example.org`],
      );
      const u: UserRow = {
        ...row(name),
        id: r.rows[0].id,
        public_id: publicId,
      };
      await scenario(pgStore(pool), u, publicId);
    } finally {
      await pool.query("DELETE FROM users WHERE username = $1", [name]);
      await pool.end();
    }
  });
});
