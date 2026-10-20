# Production deploy (Hostile Takeover, this VM)

Three containers in the compose project `hostile_takeover` (`docker-compose.prod.yml`): `ht-game`
(upstream's Dockerfile: nginx + supervisord + the Node server, serving its own static files),
`ht-api` (`Dockerfile.api`, `packages/api`) and `ht-db` (Postgres 17, volume `ht_db_data`, no host
port). Host ports, loopback only: game `127.0.0.1:8280`, API `127.0.0.1:8287`. The tunnel (Slice 5.2)
points `hostile-takeover.taps-holdings.org` at 8280 and `hostile-takeover-api.taps-holdings.org` at 8287.

Day-to-day operations (deploy, rollback, admins, backups, logs): [HT-RUNBOOK.md](HT-RUNBOOK.md).

## First time

```bash
./ht-init-prod.sh # .env.prod (mode 600, random secrets) + JWT key in ~/.config/hostile-takeover/keys/
./ht-deploy.sh    # git pull --ff-only, build, migrate, up -d, wait healthy, write .last-deploy-hash
```

Every compose command needs `-p hostile_takeover -f docker-compose.prod.yml`. Never run `down -v`
(it deletes the database volume) and never touch other projects' containers.

## Update and roll back

- `./ht-deploy.sh` deploys `origin`'s newest commit. Images are tagged with the git hash.
- `./ht-deploy.sh <hash>` goes back to the images already built for that commit.
- Migrations run from the deploy script, not on container start.
- Logs: `docker logs ht-game` (and `ht-api`, `ht-db`); json-file, 10 MB x 3 each.
- `ht-game` runs `start.sh`'s plain branch. The daily `timeout 25h` restart only applies to
  `DOMAIN=openfront.dev`, so it never fires here; `restart: unless-stopped` covers crashes.

## Make the first admin (`thestrongest`)

There are no seeded users in production. Register `thestrongest` through the normal sign-up form
(an `@kmlhs.org` address), then promote it from the host:

```bash
docker exec ht-api node_modules/.bin/tsx packages/api/src/admin.ts rank thestrongest THE_STRONGEST
```

Rank takes effect at the player's next token refresh (sign out and in, or wait up to 15 minutes).
Reset links for forgotten passwords: `... admin.ts reset <username>`. Both commands log to `admin_audit`.

## Notes

- The game server calls the API on its public URL (`API_URL`), so a working tunnel is required for
  public lobbies: until `ht-api` answers `POST /cluster/checkin` the game schedules no public games.
- `.env.prod` values: `POSTGRES_*` and `HT_DB_*` must match (the script writes both). The Postgres
  password is only read when the volume is first created.

## Release record: GLL ID direct sign-in (2026-10-18)

```
Release: new-tab "Sign in with GLL ID", "Redirect failed? Sign in here" (GLL ID forms inside HT,
  /auth/gate/direct/*), ht-api joins the private network gll_gate (GATE_DIRECT_URL=http://gate:3301)
Lane: Minor (feature, sign-in). Deployed by: Boss, after GATE's direct sign-in release.
Gates: typecheck + lint clean [x]  new GLL ID tests green [x]  dev rehearsal HT dev -> GATE dev,
  no fakes [x]  full vitest: 6 failures (5 InventoryModal, 1 RenderHtml) that fail the same on main [ ]
Known issues: the 6 full-suite failures above predate this change (same on main a9ff986); Boss to decide.
Needs in .env.prod: GATE_DIRECT_URL=http://gate:3301
Kill switch: GATE side, `cd ~/gll-id && ./manage.sh clients direct hostile-takeover off`
Watch period: 24 h
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh a9ff9862a4c4caa0d9a04a99b1804f09f045c9b6
Overrides:
  Override: ships inside GATE's watch period — Boss: this can be a blocker for users to play the game at all; GATE was just released today, so this is an update for a same-launch-day feature.
```

## Release record: direct sign-in link hand-off hotfix (2026-10-19)

```
Release: "Redirect failed? Sign in here" for players with no linked HT account. GATE issued the
  code and HT answered status "link", but the modal set location.hash = "gate=link" on the live
  page: Main handled it twice (popstate, then hashchange) and the second pass reopened the account
  modal without the link card, so the player landed back on sign-in. Prod evidence: gate_pending
  rows created 3 to 7 times per player on 2026-10-19 and never used; only 3 of 50 users linked.
  Fix: replace the hash with #gate=link and reload, the redirect's own landing (client only).
Lane: Hotfix (sign-in blocked for every unlinked player using the fallback). Deployed by: Boss's go.
Gates: regression test written first and failing [x]  gate client + API tests green (54) [x]
  typecheck + lint + prettier clean [x]  golden path: headless Chromium on the prod page with the
  fixed chunk and a mocked API shows the link card and fetches /auth/gate/pending [x]
Watch period: 2 h (patch watch)
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh ea4a80a7cb060ff49a90674003b5f947e62a117f
```

## Release record: simpler GLL ID sign-in, login name is your HT name (2026-10-20)

```
Release: first GLL ID sign-in makes the HT account with the GLL ID login name (no second form);
  an old HT account with the same email is one "Continue as X" click; a taken or blocked name is
  one "Create as X_2" click ("It's my old account" keeps the old-password link). Direct login,
  verify and reset take GATE's id_token directly (no PKCE/code); reset ends signed in; sign-up has
  no display name and one consent box; forms read values at submit (password-manager autofill).
  Migration 006: gate_pending.display_name nullable (additive).
Lane: Patch (sign-in polish, no new system). Deployed by: Boss, after GATE's release (§13 in
  ~/gll-id/docs/LAUNCH.md) is live: this build needs GATE's token mode.
Gates: typecheck + lint clean [x]  GLL ID client + API tests green (155) [x]  full vitest: 4318
  passed, failures only in InventoryModal (known flake, CLAUDE.md) and one MainInitialize timeout
  that passed on re-run [ ]  dev rehearsal HT dev -> GATE dev in Chromium, no fakes: sign-up with
  autofill-style input, sign-in, match, rename, forgot password [x]  zero open P0/P1 [x]
Needs in .env.prod: nothing new.
Kill switch: GATE side, `cd ~/gll-id && ./manage.sh clients direct hostile-takeover off`
Watch period: 2 h
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh 2ea2a7f00aebf4f8a94c346f9c3db8c086d8122e
  (works with the new GATE too: GATE keeps code mode for one release)
```
