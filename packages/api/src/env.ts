import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// The repo root .env, wherever the process was started from.
dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
  quiet: true,
});

export interface ApiEnv {
  apiPort: number;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  migrateOnBoot: boolean;
}

function str(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return n;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return {
    apiPort: int(source.API_PORT, 8787),
    dbHost: str(source.HT_DB_HOST, "127.0.0.1"),
    dbPort: int(source.HT_DB_PORT, 5436),
    dbName: str(source.HT_DB_NAME, "hostile_takeover"),
    dbUser: str(source.HT_DB_USER, "hostile_takeover"),
    dbPassword: source.HT_DB_PASSWORD ?? "",
    migrateOnBoot: source.HT_DB_MIGRATE_ON_BOOT === "true",
  };
}
