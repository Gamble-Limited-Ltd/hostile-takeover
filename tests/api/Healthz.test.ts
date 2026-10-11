// @vitest-environment node
import type { AddressInfo } from "net";
import { describe, expect, test } from "vitest";
import { createApp, type Queryable } from "../../packages/api/src/app";
import { readEnv } from "../../packages/api/src/env";

async function get(pool: Queryable, path: string) {
  const server = createApp(pool).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

describe("GET /healthz", () => {
  test("reports db true after SELECT 1", async () => {
    const sql: string[] = [];
    const out = await get(
      {
        query: async (s) => {
          sql.push(s);
          return {};
        },
      },
      "/healthz",
    );
    expect(out).toEqual({ status: 200, body: { ok: true, db: true } });
    expect(sql).toEqual(["SELECT 1"]);
  });

  test("reports db false when the query fails", async () => {
    const out = await get(
      {
        query: async () => {
          throw new Error("down");
        },
      },
      "/healthz",
    );
    expect(out).toEqual({ status: 200, body: { ok: true, db: false } });
  });
});

describe("readEnv", () => {
  test("defaults", () => {
    expect(readEnv({})).toMatchObject({ apiPort: 8787, dbPort: 5436 });
    expect(readEnv({}).migrateOnBoot).toBe(false);
  });
  test("reads overrides and rejects bad ports", () => {
    const e = readEnv({ API_PORT: "9", HT_DB_MIGRATE_ON_BOOT: "true" });
    expect(e.apiPort).toBe(9);
    expect(e.migrateOnBoot).toBe(true);
    expect(() => readEnv({ HT_DB_PORT: "x" })).toThrow();
  });
});
