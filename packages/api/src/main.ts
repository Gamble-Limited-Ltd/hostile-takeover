import { createApp } from "./app";
import { createPool } from "./db";
import { readEnv } from "./env";
import { migrate } from "./migrate";

const env = readEnv();
const pool = createPool(env);
// An idle client dropping must not crash the process.
pool.on("error", (err) => console.error("pg pool error", err));

if (env.migrateOnBoot) {
  const applied = await migrate(pool);
  console.log(`migrations applied: ${applied.length}`);
}

const server = createApp(pool).listen(env.apiPort, () => {
  console.log(`api listening on :${env.apiPort}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
