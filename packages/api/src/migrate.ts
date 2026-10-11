import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPool } from "./db";
import { readEnv } from "./env";

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

/** The slice of pg.Client / pg.PoolClient the runner uses. */
export interface MigrationClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, any>[] }>;
}

export interface MigrationSource {
  list(): Promise<string[]>;
  read(filename: string): Promise<string>;
}

export function dirSource(dir: string = MIGRATIONS_DIR): MigrationSource {
  return {
    list: async () => fs.readdirSync(dir),
    read: async (f) => fs.readFileSync(path.join(dir, f), "utf8"),
  };
}

const NAME = /^\d{3,}_[a-z0-9_]+\.sql$/;

/**
 * Applies the migrations not yet recorded in schema_migrations, in filename
 * order, each in its own transaction. Returns the filenames it applied.
 * `client` must be one connection (not a pool) so BEGIN/COMMIT pair up.
 */
export async function runMigrations(
  client: MigrationClient,
  source: MigrationSource = dirSource(),
): Promise<string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const done = new Set(
    (await client.query("SELECT filename FROM schema_migrations")).rows.map(
      (r) => r.filename as string,
    ),
  );
  const files = (await source.list()).filter((f) => NAME.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await source.read(file);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw Object.assign(
        new Error(`Migration ${file} failed: ${(err as Error).message}`),
        { cause: err },
      );
    }
    applied.push(file);
  }
  return applied;
}

/** Runs the migrations on a connection taken from `pool`. */
export async function migrate(pool: {
  connect(): Promise<MigrationClient & { release(): void }>;
}): Promise<string[]> {
  const client = await pool.connect();
  try {
    return await runMigrations(client);
  } finally {
    client.release();
  }
}

// `npm run api:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(readEnv());
  try {
    const applied = await migrate(pool);
    console.log(
      applied.length === 0
        ? "No pending migrations."
        : `Applied: ${applied.join(", ")}`,
    );
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
