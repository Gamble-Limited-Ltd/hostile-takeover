# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hostile Takeover (this fork) — read first

This repo is **Hostile Takeover**, a fork of OpenFront.io published by **Gamble Limited Ltd.** for a
private friend group. Fork: `github.com/Gamble-Limited-Ltd/hostile-takeover` (public, `origin`);
OpenFront is `upstream`. Where this section conflicts with the OpenFront sections below, this
section wins.

### Hard rules

- **Isolation:** never start/stop/rebuild or touch the GLL (`gamble-limited-v2-*`, DB 5433) or
  Meridian (compose `meridian`, DB 5435) containers or databases.
- **License direction:** never copy code _out of_ this repo into GLL or Meridian (AGPL). Copying GLL
  code _in_ is allowed but avoided — match GLL's look and rules, write the code fresh.
- **Licensing:** all code (including our API) is AGPL v3; `resources/` is CC BY-SA; leave
  `LICENSE`, `LICENSING.md` and `proprietary/` untouched. Keep a `NOTICE` saying what's OpenFront's,
  what's ours and which licenses apply.
- **Attribution:** keep "© OpenFront and Contributors" in the footer and loading screen, and add
  "Hostile Takeover is published by Gamble Limited Ltd. · Based on OpenFront · Modified · Source
  (AGPL v3)" linking to the fork. Never say "created by" or "official", and never use "OpenFront"
  as the main title.
- **Assets:** new art must be ours or CC-licensed. Never pull OpenFront's CDN or premium assets.
- **Upstream changes:** the fork only sends small engine fixes back upstream (separate branches off
  `upstream/main`). Fork-only work stays on `main`.

### Decisions (don't re-ask)

| Area           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domains        | Game `hostile-takeover.taps-holdings.org`, API `hostile-takeover-api.taps-holdings.org` (one level each, so the free Cloudflare cert covers them). Both go through cloudflared. From 2026-10-26 the game and API hosts rotate daily as `hostile-takeover-N` / `hostile-takeover-api-N` (see `plans/daily-rotation.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| API URL        | Comes from its own `API_URL` env var, never derived as `api.<DOMAIN>`. JWT `iss` must equal `API_URL` exactly. `aud` comes from `DOMAIN`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| API            | Our own workspace package in this repo, AGPL. Uses schemas from `@openfront/shared`. Update `tests/LayerBoundaries.test.ts` to allow it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Accounts       | Username + password (argon2id). Sign-up asks for first name, last name, email, username, password and a required "I'm 13 or older" checkbox                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gatekeeping    | Emails must end in `@kmlhs.org`. The address is never verified and no email is ever sent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Password reset | An admin issues a one-time reset link or a temporary password                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GLL ID         | (2026-10-17) "Sign in with GLL ID" (GATE, `~/gll-id`, proprietary) as a standard OIDC client; HT still mints its own JWT and refresh cookie. Never copy GATE code here. Callback `https://hostile-takeover-api.taps-holdings.org/auth/gate/callback`, post-logout `https://hostile-takeover.taps-holdings.org/`. Old accounts link by email match (one-click "Continue as X") or, via "It's my old account", the old password once. A new player whose GLL ID name is free gets an account with it automatically; a taken name gets a suggested `name_2` to confirm. New accounts need GATE's `email_approved` claim to be exactly `true` (id_token, else userinfo); without a match, missing or false is refused up front with `email_not_approved`; legacy register stays `@kmlhs.org` only. `LEGACY_LOGIN` stays on 2 to 3 days after launch, then off. HT `rank` stays the root source (GATE `global_rank` ignored). GLL ID opens in a new tab, with a "Redirect failed? Sign in here" fallback modal that posts to HT's `/auth/gate/direct/*` (token mode: GATE returns an id_token, no PKCE; server to server to GATE, over the private `gll_gate` network via `GATE_DIRECT_URL`). Details: `docs/Auth.md` |
| Ranks          | Rank is a DB column. `THE_STRONGEST` (the `thestrongest` account, as in GLL/Meridian) becomes JWT `role: "root"`. Every other account gets no role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Database       | Our own Postgres container on port **5436** with its own credentials. Tables: `users`, `sessions` (refresh tokens), `password_resets`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Game records   | (2026-10-24, Update 2) A summary of each finished game (players, placement, win, time alive) is stored for XP, levels and the leaderboard: `POST /game/:id` with the game server's API key, signed-in singleplayer via `/archive_singleplayer_game`. No full records, so no replays                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Removed        | Turnstile, Stripe and the store, ads, telemetry, and the Google/Discord/Steam/CrazyGames logins. `/users/@me` returns `adfree: true`. Dead platform modules can stay as long as the build passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Hosting        | This VM: Docker Compose + nginx + cloudflared. No GHCR and no multi-host deploy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Legal          | Our own short plain-English ToS and privacy policy with Gamble Limited Ltd. as operator. Covers 13+, the data we collect (name, email, username) and account deletion (keep the delete-account route). Never copy OpenFront's wording                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### STRICT UI rules

The UI must stay **as close as possible to the current OpenFront UI**. New screens should look like
they were always part of the game.

1. **Reuse, don't invent.** Build new screens (login, sign-up, admin reset, ToS/privacy pages) from
   the existing building blocks: `BaseModal.ts`, `components/baseComponents/` (`Button.ts`,
   `Modal.ts`, `SharedStyles.ts`, `setting/`) and the patterns in `AccountModal.ts` and
   `TokenLoginModal.ts`. Copy the structure of an existing modal before writing new markup.
2. **No new visual language.** No new colors, fonts, font sizes, radii, shadows, spacing scales,
   icons, animations or CSS files. Use only Tailwind classes and tokens that are already in the
   codebase. If a value you need doesn't exist, use the closest one that does.
   One exception (Boss, 2026-10-16): the Gamble Limited Ltd. Portfolio Stamp image in the footer
   (`resources/images/gll-portfolio-stamp-dark.svg`, copied from gll-shared, all rights reserved per
   `NOTICE`, not CC BY-SA). Never copy it into other art or restyle around it.
3. **Remove by hiding, not redesigning.** When removing the store, ads, providers or Turnstile, take out
   the entry points (buttons, menu items, slots) and leave the surrounding layout as it was.
   No reflowing, re-centering or "filling the gap" with new content.
4. **Same placement.** Login and sign-up open from where the current login button is
   (`NavAccountButton.ts` / the account menu). Don't add new nav items, pages or routes beyond
   what the feature needs.
5. **Text.** Every string goes through `translateText()` with an `en.json` entry, worded in the
   game's existing tone. Edit only `en.json`. Rebranding changes names only, not layout.
6. **Lazy loading.** New modals follow the `LazyModals.ts` rules in the Architecture section below.
7. **Verify visually.** Before calling UI work done, run the game (`run-openfront` skill), take a
   screenshot of the new or changed screen next to the nearest existing screen, and compare them.
   Any visible difference beyond the content has to be justified or fixed.

### Work plan (in order)

1. Make the API URL configurable (`src/client/ApiBase.ts`, `src/server/ServerEnv.ts` `jwtIssuer()`)
2. Stub API: JWKS (Ed25519), refresh, `/auth/revoke`, `/users/@me`, `POST/GET /game/:id`,
   join_verify, `cosmetics.json`, `cluster.json`
3. Sign-up/login with username + password, ranks, admin reset
4. Remove, in this order: Turnstile → login providers → Stripe/store → ads/telemetry
5. Rebrand (index.html, `en.json`, logo, hardcoded `openfront.io`/`openfront.dev` hosts, nginx, deploy scripts)
6. Deploy: Compose, nginx, tunnel, Postgres 5436
7. Fix tests as you go (`npm test`, `npm run typecheck`, `npm run lint`)

Facts:

- Raw persistent-ID auth only works with `GAME_ENV=dev` (`jwt.ts`). Production needs real EdDSA
  JWTs with `jti`, `sub` (UUID as base64url), `iat`, `iss`, `aud`, `exp`, and optional `role` and `provider`.
- `/users/@me` is parsed strictly. If any field fails to parse, the player shows as signed out.

### Dev setup on the shared VM

- **Node 24.21 + npm 12, for this repo only.** `.nvmrc` pins it. The VM's nvm default stays on
  Node 22 for GLL and Meridian. Run `export PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH` in a
  shell before any npm command (`nvm use` complains about the `prefix` in `~/.npmrc`; leave that
  file alone). Never `npm install -g` into `~/.npm-global`, because the other projects share it.
- **Ports.** Upstream's dev ports (3000, 3001, 9000) are taken on this VM. The gitignored `.env`
  sets `MASTER_PORT=3400` (workers 3401+) and `VITE_PORT=5178`; `example.env` documents them. The
  dev API will use 8787 (the client's built-in dev default), and the dev Postgres 5436. Open the
  game at `http://localhost:5178`.
- **`.env` leaks into Vitest's `process.env`.** Only put values in `.env` that differ from the
  code defaults (`API_URL`, `DOMAIN` and `GAME_ORIGIN` already default to the local dev values), or
  upstream tests that assume the defaults will break.
- **Dev API:** run `npm run api:db:up` once, then `npm run api:migrate`, `api:keygen` and `api:seed`. After that,
  `npm run dev:all` runs the game plus the API. Seeded users are `thestrongest` (root) and `tester1`. `POST /dev/login`
  `{username}` signs in without a password, on localhost only (the API binds `127.0.0.1` by default, and
  `/dev/login` also checks the socket's remote address is loopback, so it answers 404 over the LAN).
- **GLL ID in dev:** GLL ID is off unless `GATE_ISSUER` is set. To rehearse against GATE's dev stack (`~/gll-id`,
  server `127.0.0.1:3302`, never prod 3301): start it with `CLIENT_DIST=$PWD/apps/client/dist
PUBLIC_BASE_URL=http://127.0.0.1:3302 npm run dev` after `npm run build` there, register a dev client once
  (`npm run clients:add -- hostile-takeover-dev --name "Hostile Takeover (dev)" --redirect
http://localhost:8787/auth/gate/callback --post-logout http://localhost:5178/`), then run `npm run dev:all` here
  with `GATE_ISSUER=http://127.0.0.1:3302 GATE_CLIENT_ID=hostile-takeover-dev GATE_CLIENT_SECRET=<secret>` inline
  (never in `.env`). Writing to GATE's dev DB this way needs Boss's OK per session; GATE prod clients are Boss's step.
- **Testing from another device (LAN):** `npm run dev:lan` runs `dev:all` with `VITE_HOST=lan`,
  `API_HOST=0.0.0.0`, `API_URL=http://<lan-ip>:8787` and `EXTRA_GAME_ORIGINS=http://<lan-ip>:5178` set inline
  (never in `.env`); it detects the IP, or use `LAN_HOST=<ip>`. Open the printed URL on the other device. Sign in
  with a real account (register/login); `/dev/login` only works from the VM itself. localhost still works on the VM.
- **Baseline** (2026-10-10): typecheck is clean, and 7980/7982 tests pass. The failures are
  `InventoryModal` tests timing out at random under VM load; they belong to the store UI we're
  removing.
- **CI (GitHub Actions):** `.github/workflows/ht-ci.yml` (ours) runs typecheck, lint, the Oxfmt format check and the
  full test suite (4 shards plus `tests/server` alone) on every pushed branch. Upstream's workflows stay
  in the tree but are disabled on the fork with `gh workflow disable`. Slices land as `slice/<n>` branches:
  run targeted tests locally (`npx vitest <file> --run`), push, and merge to `main` once CI is green.
  Never run the full suite on the VM while the dev stack or headless Chromium is up.

### Syncing with upstream OpenFront

The `ht-upstream-sync` skill (`.claude/skills/ht-upstream-sync/`) is the runbook for this: triage script, conflict playbook, lane and verification. The steps below are the short version.

`upstream` is `openfrontio/openfrontio`. We forked from its `main`. We never rebase our `main`;
upstream changes come in by **merging**, so our history and the public fork stay intact.

**When:** at each upstream release (tags `v0.NN.x`, release branches `vNN`), or sooner for a
security or engine fix we want. Check what's waiting with
`git fetch upstream && git log --oneline main..upstream/main | wc -l`.

**How:**

1. `git fetch upstream`, then `git switch -c sync/upstream-YYYY-MM-DD main`.
2. `git merge upstream/main` (or a release tag). Resolve conflicts using `FORK_CHANGES.md`. For each
   conflicting file, keep upstream's change and put our edit back on top. Don't revert upstream
   code except where we deliberately removed a feature (Turnstile, store, ads, telemetry, other
   logins), and then remove the _new_ entry points that came in with it as well.
3. `npm run inst` (the lockfile may have changed), then `npm run typecheck`, `npm test` and
   `npm run lint`.
4. Check new `resources/news.json` / `changelog.md` entries and strip store, Discord or paid-feature links.
5. Quickly check the UI against the strict UI rules: new upstream screens may bring back
   store, ad or login entry points, and new `OpenFront` strings may need rebranding in `en.json`.
6. If `src/server/Censor.ts` changed, mirror it into `packages/api/src/censor.ts` (the parity test in
   `tests/api/Routes.test.ts` fails when they drift).
7. Check whether the API contract changed: diff `/users/@me` and the JWT, `cosmetics.json` and
   `cluster.json` schemas under `packages/shared/src`, and update our API to match.
8. New workflow files under `.github/workflows/` arrive enabled: disable each one on the fork
   (`gh workflow disable <name> -R Gamble-Limited-Ltd/hostile-takeover`); only `ht-ci.yml` runs.
9. Merge into `main` with `--no-ff`, push to `origin`, then deploy.

**Keeping merges cheap** (every fork change must follow these):

- Put new code in **new files** (our API package, our sign-up and login modals, etc.) rather
  than inside upstream files.
- When an upstream file has to change, keep the edit small. Prefer an env var or flag that
  defaults to upstream's behaviour (as with `MASTER_PORT`/`VITE_PORT`) over rewriting the code.
- Hide features at their entry points rather than deleting their modules.
- Record every upstream file we edit, and why, in `FORK_CHANGES.md` (create it with the first such
  edit). It's the checklist for resolving conflicts.

**Giving back:** an engine fix worth upstreaming goes on its own branch off `upstream/main`, with
none of our fork changes, and gets a PR to `openfrontio/openfrontio`.

## Commands

```bash
npm run inst             # Install deps (uses npm ci --ignore-scripts — do NOT use npm install)
npm run dev              # Run client + server in dev mode with hot reload
npm run start:client     # Client only
npm run start:server-dev # Server only
npm test                 # Run all tests (Vitest)
npm run test:coverage    # Tests with coverage
npm run lint             # Oxlint + ESLint
npm run lint:fix         # Oxlint + ESLint with auto-fix
npm run format           # Oxfmt
npm run build-prod       # Production build
npm run typecheck        # tsc for the root project and each package
```

**Run a single test file:**

```bash
npx vitest tests/YourTest.test.ts --run
npx vitest NationAllianceBehavior --run # match by name pattern
```

## Architecture

OpenFront.io is a real-time multiplayer territorial strategy game. There are four components:

1. **The engine** — Deterministic game simulation, split into npm workspace packages under `packages/` (see below). Pure TypeScript with **no external dependencies** beyond zod. Must stay bit-identical on every client: use the seeded PRNG, and use `packages/engine-lib/src/DetMath.ts` instead of `Math.exp`/`log`/`pow`/`sin`/… or `**` with an exponent other than 2 (ESLint enforces this). Runs in a Web Worker thread. All `packages/engine`, `packages/engine-api` and `packages/engine-lib` changes **must** include tests.
2. **`src/client/`** — Rendering (custom WebGL2 renderer in `src/client/render/`), UI (Lit web components + Tailwind CSS 4), WebSocket communication.
3. **`src/server/`** — Game coordination, intent relay, WebSocket management (Node.js/Express/ws).
4. **API** — Closed-source Cloudflare Worker handling auth, stats, cosmetics, monetization. Not in this repo.

### Packages

| Package                 | Directory             | Contents                                                                                                                                                     |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@openfront/engine-api` | `packages/engine-api` | The contract with the engine: intent/config schemas, game types and enums, `GameUpdates`, the worker protocol, the `GameMap` interface, read-view interfaces |
| `@openfront/engine-lib` | `packages/engine-lib` | Engine code that also runs outside the engine: the tile grid (`GameMapImpl`), terrain loading, the rules `Config`, `UnitGrid`, PRNG, `DetMath`, formatting   |
| `@openfront/engine`     | `packages/engine`     | The simulation: executions, `*Impl`, pathfinding, snapshots, `GameRunner`, the worker entry                                                                  |
| `@openfront/shared`     | `packages/shared`     | Client/server code that isn't simulation: wire and HTTP schemas, `ZbinWire`, env, asset URLs, map loaders (`GameMapLoader`, `FetchGameMapLoader`)            |
| `@openfront/zbin`       | `packages/zbin`       | Binary wire format for zod schemas                                                                                                                           |

Import them as `@openfront/<pkg>/<path>` (e.g. `@openfront/engine-api/game/GameMap`); paths mirror `packages/<pkg>/src/`. The allowed graph is enforced by `tests/LayerBoundaries.test.ts`:

- `engine-api` imports only zod, `zbin` and `resources/*.json`; `engine-lib` adds `engine-api`; `engine` adds `engine-lib`. None of them may import `shared`, `src/client` or `src/server`, use `Math.random`/`Date.now`/`new Date` or the approximated `Math` functions (`sin`, `pow`, `exp`, `log`, `atan2`…; `engine-lib/DetMath` has exact ones), use host APIs beyond `console`, `performance` and `TextEncoder`/`TextDecoder` (their tsconfigs use `lib: ["ES2022"]` plus `packages/engine-api/globals.d.ts`; only the worker entry and protocol, `src/worker/`, get the WebWorker lib), or fetch anything: the engine's host passes it the map files in `init`.
- `shared` may import `engine-api` and `engine-lib`, never `engine`.
- `src/client` and `src/server` import `engine-api`, `engine-lib` and `shared`; the client loads `engine` only through `packages/engine/src/worker/Worker.worker.ts`, and the server only through `packages/engine/src/WinnerReplay.ts` (the winner-replay subprocess).
- The homepage (`src/client/Main.ts` and its static imports) never statically imports the game client (`ClientGameRunner`, `Transport`, `hud/`, `render/`, `view/`, `controllers/`…): it's a separate chunk, loaded through `GameClientLoader` on join and prefetched once the page is idle. Load it with `import()`, or move what the homepage needs into a small module of its own (e.g. `LobbyEvents.ts`). The same goes for the modals in `LazyModals.ts`: `showPage` and the modal router load them, and code that calls one of them directly loads it first (`whenModalLoaded(tag, open)`, or await `loadModal(tag)`) and imports its class only with `import type`. They load after Main's `userMeResponse` broadcast, so one that listens for it also reads `lastUserMeResponse()` (`UserMeBroadcast.ts`) when it connects.
- Rules that run on both sides (e.g. `Config.maxTroops`) take `PlayerLike`/`UnitLike`/`GameLike` from `engine-api/game/ReadViews.ts` and live in `engine-lib`; both the engine objects and the client views implement.

### Simulation Flow (Intent → Execution)

The game simulation runs **on each client**, not the server. The server only relays intents.

1. Player action → client creates an **Intent** → sent to server
2. Server bundles all intents for the tick into a **Turn** → relays to all clients
3. Client forwards Turn to the Core worker
4. Core creates an **Execution** for each intent
5. Core calls `executeNextTick()` — all executions run and mutate game state
6. Core sends **GameUpdates** back to client → client renders

Intents are Zod-validated schemas defined in `packages/engine-api/src/Schemas.ts`; client↔server
messages and game records are in `packages/shared/src/WireSchemas.ts`.
Every WebSocket frame is a compact binary encoding of those schemas
(`packages/shared/src/ZbinWire.ts`, library docs in `packages/zbin/README.md`). HTTP stays JSON.

### CDN / Static Assets

The game server only serves `index.html` and the WebSocket. All other assets (JS bundle, images, maps, worker) come from a CDN bucket. `CDN_BASE` is an empty string in dev (falls back to same-origin) and a full origin (e.g. `https://cdn.example.com`) in production. It is set as both a Vite build-time variable and a server runtime env var.

## Key Files

| File                                   | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `packages/engine-api/src/Schemas.ts`   | Intent and game config types (Zod schemas) |
| `packages/shared/src/WireSchemas.ts`   | Client/server message types (Zod schemas)  |
| `packages/engine/src/GameRunner.ts`    | Simulation orchestrator                    |
| `packages/engine/src/game/GameImpl.ts` | Game state implementation                  |
| `src/server/GameServer.ts`             | Main WebSocket server, game loop           |
| `src/server/Master.ts`                 | Lobby and game registry                    |
| `tests/util/Setup.ts`                  | Test helper — creates test games           |
| `tests/LayerBoundaries.test.ts`        | Enforces the package import rules          |
| `docs/Architecture.md`                 | Architecture overview                      |
| `packages/zbin/README.md`              | Binary wire format for zod schemas         |
| `docs/Auth.md`                         | JWT/auth flow                              |
| `docs/API.md`                          | Public API endpoints                       |
| `vite.config.ts`                       | Build config, CDN handling                 |

## UI Text / i18n

All user-visible text must go through `translateText()` and have a corresponding entry added to `resources/lang/en.json`. Translations are managed via Crowdin. DO NOT modify any other translation files.

## Testing Patterns

Tests use a `setup()` helper from `tests/util/Setup.ts` that creates a full game instance with map data from `tests/testdata/maps/`. Write tests that exercise the core simulation directly — not mocks.

Only `tests/client/**` runs under jsdom; everything else runs in the `node` environment. A test outside `tests/client` that needs `document`/`window` starts with `// @vitest-environment jsdom`.

## Tech Stack

- **Bundler:** Vite + TypeScript 6
- **Rendering:** Custom WebGL2 renderer (`src/client/render/`)
- **UI Components:** Lit (LitElement) + Tailwind CSS 4
- **Audio:** Howler.js
- **Schemas/Validation:** Zod
- **Testing:** Vitest
- **Server:** Node.js, Express, ws (WebSocket)
