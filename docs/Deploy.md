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
