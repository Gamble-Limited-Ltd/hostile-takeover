import { hash } from "@node-rs/argon2";
import { fileURLToPath } from "node:url";
import { createPool } from "./db";
import { readEnv } from "./env";
import { generatePublicId } from "./publicId";

const SEED_USERS = [
  {
    username: "thestrongest",
    first: "The",
    last: "Strongest",
    email: "thestrongest@kmlhs.org",
    rank: "THE_STRONGEST",
    passwordVar: "HT_SEED_PASSWORD_THESTRONGEST",
  },
  {
    username: "tester1",
    first: "Test",
    last: "One",
    email: "tester1@kmlhs.org",
    rank: "PLAYER",
    passwordVar: "HT_SEED_PASSWORD_TESTER1",
  },
] as const;

// `npm run api:seed`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(readEnv());
  try {
    for (const u of SEED_USERS) {
      const password = process.env[u.passwordVar];
      if (!password) throw new Error(`${u.passwordVar} is not set in .env`);
      const r = await pool.query(
        `INSERT INTO users (public_id, username, first_name, last_name, email,
                            password_hash, rank, age_confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (username) DO UPDATE SET
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
           rank = EXCLUDED.rank, age_confirmed_at = now(), disabled_at = NULL
         RETURNING (xmax = 0) AS inserted`,
        [
          generatePublicId(),
          u.username,
          u.first,
          u.last,
          u.email,
          await hash(password),
          u.rank,
        ],
      );
      console.log(
        `${r.rows[0].inserted ? "created" : "updated"} ${u.username}`,
      );
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
