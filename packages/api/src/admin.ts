import { fileURLToPath } from "node:url";
import { createPool } from "./db";
import { readEnv } from "./env";
import { createPasswordReset } from "./resets";
import { pgStore } from "./store";

const RANKS = ["PLAYER", "THE_STRONGEST"] as const;
const USAGE =
  "usage: admin reset <username>\n" +
  `       admin rank <username> <${RANKS.join("|")}>`;

// `npm run api:admin -- reset <username>` / `-- rank <username> <RANK>`.
// In production: `docker exec ht-api node_modules/.bin/tsx packages/api/src/admin.ts ...`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, username, rank] = process.argv.slice(2);
  const ok =
    username &&
    (cmd === "reset" ||
      (cmd === "rank" && RANKS.includes(rank as (typeof RANKS)[number])));
  if (!ok) {
    console.error(USAGE);
    process.exit(2);
  }
  const env = readEnv();
  const pool = createPool(env);
  try {
    const store = pgStore(pool);
    if (cmd === "rank") {
      const r = await pool.query(
        "UPDATE users SET rank = $2 WHERE username = $1 RETURNING username::text AS username",
        [username, rank],
      );
      if (r.rowCount === 0) {
        console.error(`no such user: ${username}`);
        process.exitCode = 1;
      } else {
        await store.logAdmin({
          actor: "cli",
          action: "set_rank",
          target: r.rows[0].username,
          detail: { rank },
        });
        console.log(
          `${r.rows[0].username} is now ${rank} (takes effect at their next token refresh)`,
        );
      }
    } else {
      const r = await createPasswordReset(store, env, {
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
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
