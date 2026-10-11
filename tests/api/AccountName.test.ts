// @vitest-environment node
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createApp, REFRESH_COOKIE } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";
import {
  generatePrivateKeyPem,
  keysFromPem,
} from "../../packages/api/src/keys";
import { generatePublicId } from "../../packages/api/src/publicId";
import type { UserRow } from "../../packages/api/src/userMe";
import { forcedAccountUsername } from "../../src/server/AccountName";
import { ServerEnv } from "../../src/server/ServerEnv";
import { memoryStore } from "./memoryStore";

const KEY = "secret";
const row: UserRow = {
  id: randomUUID(),
  public_id: generatePublicId(),
  username: "Sam The Man",
  first_name: "S",
  last_name: "M",
  email: "sam@kmlhs.org",
  rank: "PLAYER",
  disabled_at: null,
};

let base = "";
let jwt = "";
let close: () => void;

beforeAll(async () => {
  const env = readEnv({
    API_URL: "http://localhost:8787",
    DOMAIN: "localhost",
    GAME_ORIGIN: "http://localhost:5178",
    API_KEY: KEY,
  });
  const keys = await keysFromPem(generatePrivateKeyPem());
  const server = createApp(
    { query: async () => ({}) },
    { env, keys, store: memoryStore([row]).store },
  ).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  vi.spyOn(ServerEnv, "jwtIssuer").mockReturnValue(base);
  vi.spyOn(ServerEnv, "apiKey").mockReturnValue(KEY);

  const login = await fetch(`${base}/dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: row.username }),
  });
  const cookie = login.headers
    .getSetCookie()
    .find((c) => c.startsWith(REFRESH_COOKIE))!
    .split(";")[0];
  const refreshed = await fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: { cookie },
  });
  jwt = (await refreshed.json()).jwt;
});
afterAll(() => {
  vi.restoreAllMocks();
  close();
});

describe("forcedAccountUsername (game server join)", () => {
  test("a signed-in token resolves to the account username", async () => {
    expect(await forcedAccountUsername(jwt, true)).toBe("Sam The Man");
  });

  test("a signed-out join is left alone and makes no API call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await forcedAccountUsername(jwt, false)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("an unreadable /users/@me leaves the client's name to the join's own check", async () => {
    expect(await forcedAccountUsername("not-a-jwt", true)).toBeNull();
  });
});
