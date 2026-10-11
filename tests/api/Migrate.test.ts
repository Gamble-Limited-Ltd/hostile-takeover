// @vitest-environment node
import pg from "pg";
import { describe, expect, test } from "vitest";
import {
  dirSource,
  migrate,
  runMigrations,
  type MigrationClient,
  type MigrationSource,
} from "../../packages/api/src/migrate";

/** An in-memory stand-in that records every statement it is given. */
function fakeClient(opts: { failOn?: string } = {}) {
  const applied = new Set<string>();
  const log: string[] = [];
  const client: MigrationClient = {
    async query(sql, params) {
      log.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      if (sql.startsWith("SELECT filename")) {
        return { rows: [...applied].map((filename) => ({ filename })) };
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        applied.add(params![0] as string);
      }
      if (opts.failOn && sql.includes(opts.failOn)) throw new Error("boom");
      return { rows: [] };
    },
  };
  return { client, applied, log };
}

const source = (files: Record<string, string>): MigrationSource => ({
  list: async () => Object.keys(files),
  read: async (f) => files[f],
});

describe("runMigrations", () => {
  test("applies pending files in filename order, each in a transaction", async () => {
    const { client, applied, log } = fakeClient();
    const result = await runMigrations(
      client,
      source({
        "002_b.sql": "SELECT b",
        "001_a.sql": "SELECT a",
        "notes.txt": "ignored",
      }),
    );
    expect(result).toEqual(["001_a.sql", "002_b.sql"]);
    expect([...applied]).toEqual(["001_a.sql", "002_b.sql"]);
    expect(log.filter((l) => l !== "SELECT filename")).toEqual([
      "CREATE TABLE",
      "BEGIN",
      "SELECT a",
      "INSERT INTO",
      "COMMIT",
      "BEGIN",
      "SELECT b",
      "INSERT INTO",
      "COMMIT",
    ]);
  });

  test("a second run applies nothing", async () => {
    const { client } = fakeClient();
    const src = source({ "001_a.sql": "SELECT a" });
    expect(await runMigrations(client, src)).toEqual(["001_a.sql"]);
    expect(await runMigrations(client, src)).toEqual([]);
  });

  test("a failing migration is rolled back and not recorded", async () => {
    const { client, applied, log } = fakeClient({ failOn: "bad" });
    await expect(
      runMigrations(
        client,
        source({ "001_a.sql": "SELECT a", "002_b.sql": "bad sql" }),
      ),
    ).rejects.toThrow(/002_b.sql failed: boom/);
    expect([...applied]).toEqual(["001_a.sql"]);
    expect(log[log.length - 1]).toBe("ROLLBACK");
  });

  test("migrate() releases the connection", async () => {
    const { client } = fakeClient();
    let released = false;
    await migrate({
      connect: async () => ({
        ...client,
        release: () => {
          released = true;
        },
      }),
    });
    expect(released).toBe(true);
  });

  test("the shipped migrations are named NNN_name.sql", async () => {
    const files = await dirSource().list();
    expect(files).toContain("001_init.sql");
    expect(files.every((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))).toBe(true);
  });
});

// Opt-in: HT_TEST_DB=1 npx vitest tests/api --run (needs `npm run api:db:up`).
describe.skipIf(process.env.HT_TEST_DB !== "1")("real database", () => {
  test("migrations apply once into a scratch schema", async () => {
    const pool = new pg.Pool({
      host: process.env.HT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.HT_DB_PORT ?? 5436),
      database: process.env.HT_DB_NAME ?? "hostile_takeover",
      user: process.env.HT_DB_USER ?? "hostile_takeover",
      password: process.env.HT_DB_PASSWORD ?? "",
    });
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS ht_test CASCADE");
      await client.query("CREATE SCHEMA ht_test");
      await client.query("SET search_path TO ht_test, public");
      const first = await runMigrations(client);
      expect(first).toContain("001_init.sql");
      expect(await runMigrations(client)).toEqual([]);
    } finally {
      await client.query("DROP SCHEMA IF EXISTS ht_test CASCADE");
      client.release();
      await pool.end();
    }
  });
});
