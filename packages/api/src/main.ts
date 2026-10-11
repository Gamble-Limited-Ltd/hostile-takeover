import { createApp } from "./app";
import { createPool } from "./db";
import { readEnv } from "./env";
import { loadSigningKeys } from "./keys";
import { migrate } from "./migrate";
import { pgStore } from "./store";

const env = readEnv();
const pool = createPool(env);
// An idle client dropping must not crash the process.
pool.on("error", (err) => console.error("pg pool error", err));

if (env.migrateOnBoot) {
  const applied = await migrate(pool);
  console.log(`migrations applied: ${applied.length}`);
}

const keys = await loadSigningKeys(env.jwtPrivateKeyFile).catch((err) => {
  console.error(err.message);
  process.exit(1);
});

const server = createApp(pool, { env, keys, store: pgStore(pool) }).listen(
  env.apiPort,
  env.apiHost,
  () => {
    console.log(`api listening on ${env.apiHost}:${env.apiPort}`);
  },
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
