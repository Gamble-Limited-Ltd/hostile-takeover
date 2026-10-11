import { fileURLToPath } from "node:url";
import { createPool } from "./db";
import { readEnv } from "./env";
import { createPasswordReset } from "./resets";
import { pgStore } from "./store";

// `npm run api:admin -- reset <username>`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, username] = process.argv.slice(2);
  if (cmd !== "reset" || !username) {
    console.error("usage: npm run api:admin -- reset <username>");
    process.exit(2);
  }
  const env = readEnv();
  const pool = createPool(env);
  try {
    const r = await createPasswordReset(pgStore(pool), env, {
      username,
      actor: "cli",
      createdBy: null,
    });
    if (!r) {
      console.error(`no such user: ${username}`);
      process.exitCode = 1;
    } else {
      console.log(`reset link for ${username} (valid 24 hours, one use):`);
      console.log(r.link);
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
