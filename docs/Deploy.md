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
Needs in .env.prod: GATE_DIRECT_URL=http://gate:3301
Kill switch: GATE side, `cd ~/gll-id && ./manage.sh clients direct hostile-takeover off`
Watch period: 24 h
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh a9ff9862a4c4caa0d9a04a99b1804f09f045c9b6
Overrides:
  Override: ships inside GATE's watch period — Boss: this can be a blocker for users to play the game at all; GATE was just released today, so this is an update for a same-launch-day feature.
  Override: full test suite not green (6 failures also on main, not from this change) — Boss: same reason.
```
