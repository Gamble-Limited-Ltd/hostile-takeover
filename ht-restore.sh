#!/usr/bin/env bash
# Restore a Hostile Takeover database dump (made by ht-backup.sh). See docs/restore.md.
#
#   ./ht-restore.sh <dump> --into-scratch   restore into a throwaway container (ht-restore-test), compare
#                                           row counts with ht-db, remove the container. Safe: never writes to ht-db.
#   ./ht-restore.sh <dump>                  REAL restore into ht-db. Asks you to type "restore". Stops ht-game and
#                                           ht-api, runs pg_restore --clean --if-exists, starts them, checks health.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=hostile_takeover
FILE=docker-compose.prod.yml
TABLES="users sessions password_resets schema_migrations admin_audit"
dc() { docker compose -p "$PROJECT" -f "$FILE" "$@"; }
fail() {
    echo "ht-restore: $*" >&2
    exit 1
}

DUMP="${1:-}"
MODE="${2:-}"
[ -n "$DUMP" ] && [ -f "$DUMP" ] || fail "usage: $0 <dump file> [--into-scratch]"
[ -z "$MODE" ] || [ "$MODE" = --into-scratch ] || fail "unknown option '$MODE'"
[ -s "$DUMP" ] || fail "$DUMP is empty"
docker exec -i ht-db pg_restore --list < "$DUMP" > /dev/null || fail "$DUMP is not a readable pg_dump -Fc file"

count() { # container user db table
    docker exec "$1" psql -U "$2" -d "$3" -Atc "select count(*) from $4"
}

if [ "$MODE" = --into-scratch ]; then
    NAME=ht-restore-test
    docker ps -a --format '{{.Names}}' | grep -qx "$NAME" && fail "$NAME already exists; remove it with: docker rm -f $NAME"
    trap 'docker rm -f ht-restore-test > /dev/null 2>&1 || true' EXIT
    PW="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
    # No published ports: nothing outside the container can reach it.
    docker run -d --name "$NAME" -e POSTGRES_USER=restore -e POSTGRES_DB=restore -e POSTGRES_PASSWORD="$PW" postgres:17-alpine > /dev/null
    for _ in $(seq 40); do docker exec "$NAME" pg_isready -U restore -d restore -q && break || sleep 1; done
    sleep 2
    docker exec -i "$NAME" pg_restore -U restore -d restore --no-owner --no-privileges < "$DUMP"
    bad=0
    for t in $TABLES; do
        a="$(count ht-db "$(docker exec ht-db printenv POSTGRES_USER)" "$(docker exec ht-db printenv POSTGRES_DB)" "$t")"
        b="$(count "$NAME" restore restore "$t")"
        echo "$t: ht-db=$a restored=$b"
        [ "$a" = "$b" ] || bad=1
    done
    [ "$bad" = 0 ] && echo "Row counts match (rows added to ht-db after the dump will show as differences)." || echo "Row counts differ (expected if ht-db changed since the dump)."
    exit 0
fi

echo "This REPLACES the live database (ht-db) with: $DUMP"
echo "ht-game and ht-api will be stopped while it runs. The game is down for about a minute."
read -r -p 'Type "restore" to continue: ' answer
[ "$answer" = restore ] || fail "cancelled"

dc stop ht-game ht-api
trap 'echo "ht-restore: FAILED; ht-game/ht-api are still stopped. Fix it, then: docker compose -p $PROJECT -f $FILE start ht-api ht-game" >&2' ERR
docker exec -i ht-db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "$DUMP"
trap - ERR
dc start ht-api ht-game
for _ in $(seq 80); do
    s="$(docker inspect -f '{{.State.Health.Status}}' ht-api ht-game | tr '\n' ' ')"
    [ "$s" = "healthy healthy " ] && break
    sleep 3
done
dc ps
[ "$s" = "healthy healthy " ] || fail "ht-api / ht-game are not healthy yet: $s"
echo "Restored from $DUMP and healthy."
