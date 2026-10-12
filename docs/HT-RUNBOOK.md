# Hostile Takeover runbook (this VM)

Short and practical. Details: [Deploy.md](Deploy.md), [restore.md](restore.md).

## Where things are

- Containers (compose project `hostile_takeover`, file `docker-compose.prod.yml`): `ht-game`, `ht-api`, `ht-db`.
- Ports, loopback only: game `127.0.0.1:8280`, API `127.0.0.1:8287`. The database has no host port.
- Public: `https://hostile-takeover.taps-holdings.org` and `https://hostile-takeover-api.taps-holdings.org`
  (cloudflared tunnel, host nginx not involved).
- Secrets: `~/hostile-takeover/.env.prod` (mode 600). JWT key: `~/.config/hostile-takeover/keys/`.
- Backups: `~/backups/hostile-takeover/` (VM only, 14 days, `backup.log` inside).
- Cron: `crontab -l | grep hostile-takeover-daily-backup` (daily 04:30 America/Chicago).
- Always use `docker compose -p hostile_takeover -f docker-compose.prod.yml ...`. Never `down -v`. Never touch the
  other projects' containers (GLL, Meridian, codezero).

## Deploy and roll back

```bash
cd ~/hostile-takeover
./ht-deploy.sh            # pull origin, build, migrate, restart, wait healthy
./ht-deploy.sh <hash>     # roll back to a commit that was deployed here before
cat .last-deploy-hash     # what is live now
```

## Admins and passwords

```bash
docker exec ht-api node_modules/.bin/tsx packages/api/src/admin.ts rank <username> THE_STRONGEST
docker exec ht-api node_modules/.bin/tsx packages/api/src/admin.ts rank <username> PLAYER
docker exec ht-api node_modules/.bin/tsx packages/api/src/admin.ts reset <username>   # prints a one-time reset link
```

## Back up and restore

```bash
./ht-backup.sh            # back up now (also what cron runs)
./ht-restore.sh <dump> --into-scratch   # test a backup, safe
./ht-restore.sh <dump>                  # real restore, asks first
```

Full steps: [restore.md](restore.md).

## Logs

`docker logs --tail 100 ht-game` (also `ht-api`, `ht-db`; add `-f` to follow). Each is capped at 10 MB x 3 files.
nginx's access and error logs go to `ht-game`'s log too.

## After a VM reboot

Docker starts at boot and all three containers are `restart: unless-stopped`, so the stack comes back on its own
(`ht-api` waits for a healthy `ht-db`). Check with `docker ps` and `curl -I https://hostile-takeover.taps-holdings.org/`.

## Upstream sync

Follow "Syncing with upstream OpenFront" in `CLAUDE.md` (merge, resolve with `FORK_CHANGES.md`, test, merge to
`main`), then `./ht-deploy.sh`.
