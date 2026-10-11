# Stage 5 — Deploy

**Goal:** Hostile Takeover runs on this VM at `hostile-takeover.taps-holdings.org` (game) and
`hostile-takeover-api.taps-holdings.org` (API), through Cloudflare Tunnel, with daily DB
backups. **It never touches the GLL or Meridian containers, ports, nginx or DBs.**

**Exit test:** from a phone off the VM's network, sign up, play, and reload. Restarting the VM brings
everything back. Restoring a backup into a scratch DB works.

Slice 5.1 comes first, then 5.2 and 5.3. Mutating cloudflared or DNS needs the owner's go.

---

## Slice 5.1 — Production compose (Sonnet)

- `docker-compose.prod.yml`, with compose project `hostile_takeover` and container names `ht-*`:
  - `ht-game`: built from the repo's `Dockerfile`, adapted. Drop GHCR, supervisord's
    multi-host pieces and the OTEL sidecars. Keep nginx inside it if upstream's design needs that.
    Publish it only on `127.0.0.1:<free port>`, picked after checking `ss -ltn`.
  - `ht-api`: `packages/api`, on `127.0.0.1:<free port>`.
  - `ht-db`: Postgres 17 on **127.0.0.1:5436**, on a named volume, with credentials from `.env.prod`
    (gitignored, mode 600).
  - Healthchecks on all three, plus `restart: unless-stopped`.
- Prod env: `DOMAIN=hostile-takeover.taps-holdings.org`,
  `API_URL=https://hostile-takeover-api.taps-holdings.org`, `GAME_ENV=prod`, `NUM_WORKERS=2`,
  `INSTANCE_LETTER=a`, Turnstile, Faro and OTEL unset, and the JWT key from a file.
- Replace `deploy.sh` / `update.sh` with a single `ht-deploy.sh`: `git pull`, build, run migrations,
  `docker compose up -d`, check health, and write `.last-deploy-hash`. Keep the old scripts in the tree
  (upstream files) but don't use them.
- Disable OpenFront's GitHub workflows that deploy or touch their infrastructure (`deploy.yml`,
  `release.yml`, the issue/PR bots) **in the fork's settings**, and keep `ci.yml`.

## Slice 5.2 — Tunnel and DNS (main session with the owner, step by step)

- Find out how the existing tunnel is configured (the cloudflared service or config that GLL uses).
  Read it only, and **show the owner the exact change before applying it.**
- Add two ingress rules, game host → `ht-game` and API host → `ht-api`, plus the two DNS CNAMEs.
  Both names are one level deep, so the free certificate covers them.
- WebSockets work through the tunnel without extra setup. Check `/w0` and `/w1` lobby sockets after it's live.

## Slice 5.3 — Backups and ops (Sonnet, small)

- A daily `pg_dump` from `ht-db` to `~/backups/hostile-takeover/` (a systemd user timer or cron),
  keeping 14 days, plus a `restore.md` with the commands. **Ask the owner** whether to copy backups off the VM.
- Log rotation for the containers (`json-file`, size-capped).
- `docs/HT-RUNBOOK.md`: deploy, rollback (redeploy the previous hash), reset a password, back up and restore, and
  the upstream sync procedure (pointing to `CLAUDE.md`).

**Approval:** the owner plays on the live URL from their phone, and the backup file exists.
