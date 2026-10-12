#!/usr/bin/env bash
# Back up the Hostile Takeover database (ht-db) to ~/backups/hostile-takeover/ on this VM.
#
#   ./ht-backup.sh                 dump now, check it, delete our dumps older than 14 days
#   ./ht-backup.sh --install-cron  add (or replace) the daily 04:30 America/Chicago cron job
#
# Dumps are custom-format (pg_dump -Fc) files named ht-YYYY-MM-DDTHHMMSSZ.dump (UTC), mode 600, in a
# mode 700 directory. A dump is written under a temporary name and renamed only once it checks out, and
# nothing is rotated unless the new dump is non-empty and readable by pg_restore. Restore: docs/restore.md.
# Env knobs: HT_BACKUP_DIR (default ~/backups/hostile-takeover), HT_BACKUP_KEEP_DAYS (default 14).
set -euo pipefail

DIR="${HT_BACKUP_DIR:-$HOME/backups/hostile-takeover}"
KEEP_DAYS="${HT_BACKUP_KEEP_DAYS:-14}"
CONTAINER=ht-db
TAG="# hostile-takeover-daily-backup"
LOG="$DIR/backup.log"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

install_cron() {
    mkdir -p "$DIR"
    chmod 700 "$DIR"
    local current new
    current="$(crontab -l 2> /dev/null || true)"
    # Keep every existing line untouched; drop only our own tagged lines, then append them again at the end.
    new="$(printf '%s\n' "$current" | grep -vF "$TAG" || true)"
    {
        [ -n "$new" ] && printf '%s\n' "$new"
        printf 'CRON_TZ=America/Chicago %s\n' "$TAG"
        printf '30 4 * * * /bin/bash %s >> %s/cron.log 2>&1 %s\n' "$SELF" "$DIR" "$TAG"
    } | crontab -
    echo "ht-backup: cron installed:"
    crontab -l | grep -F "$TAG"
}

if [ "${1:-}" = "--install-cron" ]; then
    install_cron
    exit 0
fi
[ $# -eq 0 ] || {
    echo "usage: $0 [--install-cron]" >&2
    exit 2
}

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FINAL="$DIR/ht-$STAMP.dump"
TMP="$DIR/.ht-$STAMP.dump.partial"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }
fail() {
    echo "ht-backup: $*" >&2
    log "FAILED: $*"
    rm -f "$TMP"
    exit 1
}
trap 'fail "error at line $LINENO"' ERR

# User and database come from the container's own environment; the dump uses its local socket, so no password.
docker exec "$CONTAINER" sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$TMP"
[ -s "$TMP" ] || fail "dump is empty, nothing rotated"
docker exec -i "$CONTAINER" pg_restore --list < "$TMP" > /dev/null || fail "pg_restore cannot read the dump, nothing rotated"
chmod 600 "$TMP"
mv "$TMP" "$FINAL"

# Rotate: only our own file names, only in this directory.
mapfile -t OLD < <(find "$DIR" -maxdepth 1 -type f -name 'ht-????-??-??T??????Z.dump' -mmin "+$((KEEP_DAYS * 1440))")
for f in "${OLD[@]}"; do rm -f -- "$f"; done

SIZE="$(stat -c %s "$FINAL")"
log "OK $(basename "$FINAL") ${SIZE} bytes, rotated ${#OLD[@]} old"
tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
echo "ht-backup: wrote $FINAL (${SIZE} bytes), removed ${#OLD[@]} old"
