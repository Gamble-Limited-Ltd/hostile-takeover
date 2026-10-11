# Stage 1 — API foundation

**Goal:** replace OpenFront's closed API with ours, so that a production-mode game server (real
EdDSA JWTs, not `GAME_ENV=dev` persistent IDs) accepts a signed-in player into a singleplayer
game and a 2-player private lobby.

**Exit test:** with the dev stack running (game 3400/5178, API 8787, Postgres 5436), a seeded
user takes the refresh-cookie → JWT path, `/users/@me` parses on both the client and the server,
and the player spawns and plays. Nothing calls `*.openfront.io`.

Run the slices in order: 1.1 → 1.2 → 1.3 → 1.4. Slice 1.5 can run alongside 1.4.

---

## Slice 1.1 — Make the API URL configurable (Sonnet)

Today both sides derive the API host as `https://api.<DOMAIN>`, which would be a two-level
subdomain on our domain.

- `src/server/ServerEnv.ts` `jwtIssuer()`: return `process.env.API_URL` when it's set (no trailing
  slash), otherwise keep today's logic.
- `src/client/ApiBase.ts` `getApiBase()`: read the API URL from the bootstrap config the server
  already injects (follow how `jwtAudience` reaches `ClientEnv`; `src/server/RenderHtml.ts`
  renders it). Fall back to today's logic.
- `jwtAudience()` keeps coming from `DOMAIN`.
- Tests: unit tests for both functions, with and without `API_URL`. Update any existing tests
  that assume `api.<domain>`.
- Record the edits in `FORK_CHANGES.md`.

## Slice 1.2 — API package skeleton and database (Sonnet)

- Create `packages/api` (`@hostile-takeover/api`, AGPL header, its own `tsconfig`, added to the
  root workspaces and `npm run typecheck`). Its entry point is `src/main.ts` (Express, port from
  `API_PORT`, default 8787).
- Allow it in `tests/LayerBoundaries.test.ts`: it may import `@openfront/shared` and
  `engine-api`, but never `engine`, `src/client` or `src/server`. Nothing else may import it.
- Dev Postgres: `docker-compose.dev.yml` (project name `hostile_takeover_dev`), Postgres on
  **127.0.0.1:5436**, a named volume, and credentials from `.env` (`HT_DB_*`). Add the variables
  to `example.env`. **Never use 5433 or 5435.**
- Migrations: `packages/api/migrations/NNN_name.sql`, plus a runner (`npm run api:migrate`) that
  records applied files in a `schema_migrations` table.
- `001_init.sql`:
  - `users`: `id uuid pk`, `public_id text unique`, `username citext unique`, `first_name`,
    `last_name`, `email citext unique`, `password_hash`, `rank text default 'PLAYER'`,
    `age_confirmed_at timestamptz`, `created_at`, `disabled_at`.
  - `sessions`: refresh tokens, stored hashed, with `user_id`, `expires_at`, `rotated_from` and
    `revoked_at`.
  - `password_resets`: one-time token hash, `user_id`, `expires_at`, `used_at`, and `created_by`
    (the admin).
- Scripts: `npm run api:dev` (tsx watch), and `npm run dev:all` (game, API and DB check). The
  existing `npm run dev` stays as it is.
- Haiku can do: the compose file, the `example.env` lines and the `package.json` script wiring.

## Slice 1.3 — Tokens and identity (Sonnet)

Read `docs/Auth.md`, `src/server/jwt.ts`, `src/client/Auth.ts` and `packages/shared/src/ApiSchemas.ts`
(`TokenPayloadSchema`, `UserMeResponseSchema`).

- Generate an Ed25519 keypair from `HT_JWT_PRIVATE_KEY` (PEM in `.env`; a
  `npm run api:keygen` script writes one). Publish it at `GET /.well-known/jwks.json`.
- `POST /auth/refresh`: reads the HTTP-only refresh cookie (30 days, rotated on every use),
  returns `RefreshResponseSchema` with a 15-minute JWT whose claims are `jti`, `sub` (the user UUID as
  base64url, the same shape as `PersistentIdSchema`), `iat`, `iss` (= `API_URL`), `aud` (= `DOMAIN`),
  `exp` and `role` (`root` only when `rank = 'THE_STRONGEST'`).
- `POST /auth/logout` and `POST /auth/revoke`: revoke the session and clear the cookie.
- `GET /users/@me`: build the **full** `UserMeResponseSchema` object:
  - Identity: the `email` block (the user's email).
  - `player`: `adfree: true`, `unlimitedRanked: false`, `canCreatePublicLobbies: true`, and
    `trustTier: "trusted"`.
  - `achievements`: `{ singleplayerMap: [], player: [] }`.
  - `friends: []`, `subscription: null`, and every optional field left out.
  - Add a test that runs the response through `UserMeResponseSchema.parse`. That parse is the
    contract, because if any field fails to parse the player looks signed out.
- CORS: allow the game origin only, with credentials.
- **The cookie has to work across both domains in production**
  (`hostile-takeover.` ↔ `hostile-takeover-api.`): `SameSite=None; Secure` in production, and
  `Lax` on localhost. Write down how the client sends it (`credentials: "include"`).
- Dev seed: `npm run api:seed` creates `thestrongest` (rank `THE_STRONGEST`) and `tester1` with
  passwords from `.env`, plus a dev-only `POST /dev/login` that sets the refresh cookie (refused
  unless `NODE_ENV !== "production"`). This is what makes the exit test possible before Stage 2.

## Slice 1.4 — Endpoints the game server and client call (Sonnet)

Make each endpoint answer in the shape its caller expects. Read the caller before writing the stub:

| Endpoint                                                                                     | Caller                                      | Our answer                                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /join_verify`                                                                          | `src/server/JoinVerify.ts`                  | Approve; reuse the server's own local `Censor` rules for usernames                      |
| `GET /cosmetics.json`                                                                        | `Worker.ts`, `src/client/Cosmetics.ts`      | A valid empty catalog (`CosmeticSchemas.ts`)                                            |
| `GET /reserved_clan_tags`                                                                    | `Worker.ts`                                 | `[]`                                                                                    |
| `GET /custom_tribes`                                                                         | `CustomTribes.ts`                           | Empty / whatever disables it                                                            |
| `GET /cluster.json?site=`                                                                    | `src/client/ServerList.ts`                  | `{ a: { host, numWorkers: 2 } }` from env                                               |
| `POST /cluster/checkin`                                                                      | `ClusterCheckin.ts`                         | `"open"`                                                                                |
| `POST /game/:id`, `GET /game/:id`, `POST /archive_singleplayer_game`                         | `Archive.ts`, `GamePreviewRoute.ts`, client | Accept and discard (no records); GET returns 404, and the callers must handle that      |
| `/matchmaking/checkin`, `/users/@me/lobby_queue`, `/public/*`, `/friends`, `/users/@me/xp/*` | ranked, queue, clans, XP                    | 404, then confirm each caller fails quietly; if one doesn't, add it to the Stage 3 list |

- The API key: the server sends `x-api-key` (`ServerEnv.apiKey()`). The API checks it on the
  server-only routes.
- Integration test: start the API in-process and call each route with the real schema.

## Slice 1.5 — End-to-end check (Sonnet; Haiku can do the screenshots)

- Run the game server in production auth mode against the dev API (`GAME_ENV` stays dev for
  assets; whatever turns off persistent-ID auth: read `jwt.ts`).
- Use the `run-openfront` skill to drive: dev login → signed-in nav button → singleplayer game →
  private lobby with two browser contexts.
- Report every request that still goes to `openfront.io`, `api.localhost` or a 404 that breaks a
  screen. That list feeds Stage 3.

**Approval:** the owner sees screenshots of a signed-in player in a game, and the list of failures.
