import pg from "pg";
import type { ApiEnv } from "./env";

export function createPool(env: ApiEnv): pg.Pool {
  return new pg.Pool({
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    user: env.dbUser,
    password: env.dbPassword,
  });
}
