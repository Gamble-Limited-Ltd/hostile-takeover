# Restoring the database from a backup

Backups come from `./ht-backup.sh`: custom-format `pg_dump` files named `ht-YYYY-MM-DDTHHMMSSZ.dump` (UTC) in
`~/backups/hostile-takeover/` (mode 700; files mode 600; the last 14 days are kept). They stay on this VM only.

```bash
cd ~/hostile-takeover
ls -lt ~/backups/hostile-takeover/ | head
LATEST=$(ls -t ~/backups/hostile-takeover/ht-*.dump | head -n 1)
docker exec -i ht-db pg_restore --list < "$LATEST" | head # proves the file is readable
```

## (a) Test restore into a throwaway container (safe, never touches ht-db)

Shortcut: `./ht-restore.sh "$LATEST" --into-scratch`. The same thing by hand:

```bash
PW=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)
docker run -d --name ht-restore-test -e POSTGRES_USER=restore -e POSTGRES_DB=restore -e POSTGRES_PASSWORD="$PW" postgres:17-alpine
sleep 8
docker exec -i ht-restore-test pg_restore -U restore -d restore --no-owner --no-privileges < "$LATEST"
for t in users sessions password_resets schema_migrations admin_audit; do
  echo "$t: $(docker exec ht-restore-test psql -U restore -d restore -Atc "select count(*) from $t")"
done
docker rm -f ht-restore-test
```

No ports are published, so nothing outside the container can reach it. Compare the counts with the same query
run in `ht-db` (`docker exec ht-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -Atc "select count(*) from users"'`).

## (b) Real restore into ht-db

This replaces the live database. Take a fresh backup first (`./ht-backup.sh`). Shortcut, which asks you to type
`restore` before it does anything: `./ht-restore.sh "$LATEST"`. By hand:

```bash
cd ~/hostile-takeover
DC="docker compose -p hostile_takeover -f docker-compose.prod.yml"
$DC stop ht-game ht-api
docker exec -i ht-db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "$LATEST"
$DC start ht-api ht-game
sleep 40
docker inspect -f '{{.Name}} {{.State.Health.Status}}' ht-db ht-api ht-game
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8287/cluster.json # 200
```

Never use `docker compose down -v`: it deletes the database volume. If `ht-db` itself is gone, run
`./ht-deploy.sh` to recreate it (the volume is only empty on a first start), then restore as above; the
migrations table comes back with the dump.
