#!/usr/bin/env bash
# Deploy (or roll back) the Hostile Takeover production stack on this VM.
#
#   ./ht-deploy.sh            git pull --ff-only, build images tagged with the git hash, migrate, up, wait healthy
#   ./ht-deploy.sh <hash>     roll back to the images already built for that commit (no pull, no build)
#
# Only touches the compose project `hostile_takeover` (containers ht-db, ht-api, ht-game). Fails loudly.
# Env knobs: HT_SKIP_PULL=1 (no git pull), HT_ALLOW_DIRTY=1 (build a tree with uncommitted changes; the
# image is still tagged with HEAD's hash, so only for testing).
set -Eeuo pipefail
cd "$(dirname "$0")"

PROJECT=hostile_takeover
FILE=docker-compose.prod.yml
GAME_IMAGE=hostile-takeover-game
API_IMAGE=hostile-takeover-api
WAIT_SECONDS="${HT_WAIT_SECONDS:-240}"

dc() { docker compose -p "$PROJECT" -f "$FILE" "$@"; }
fail() {
    echo "ht-deploy: $*" >&2
    exit 1
}
trap 'echo "ht-deploy: FAILED (line $LINENO)" >&2' ERR

[ -f .env.prod ] || fail ".env.prod is missing; run ./ht-init-prod.sh first"
[ "$(stat -c %a .env.prod)" = 600 ] || fail ".env.prod must be mode 600 (chmod 600 .env.prod)"
KEYS_DIR="${HT_KEYS_DIR:-$HOME/.config/hostile-takeover/keys}"
[ -r "$KEYS_DIR/jwt-ed25519.pem" ] || fail "JWT key missing at $KEYS_DIR/jwt-ed25519.pem; run ./ht-init-prod.sh first"
# MERIDIAN_URL is optional and only used at build time; .env.prod is not sourced wholesale.
MERIDIAN_URL="$(sed -n 's/^MERIDIAN_URL=//p' .env.prod | tail -n 1)"
export MERIDIAN_URL

wait_healthy() {
    local deadline=$((SECONDS + WAIT_SECONDS)) c status all
    while [ "$SECONDS" -lt "$deadline" ]; do
        all=healthy
        for c in "$@"; do
            status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2> /dev/null || echo missing)"
            [ "$status" = unhealthy ] && {
                dc ps
                docker logs --tail 40 "$c" >&2 || true
                fail "$c is unhealthy"
            }
            [ "$status" = healthy ] || all=waiting
        done
        [ "$all" = healthy ] && return 0
        sleep 3
    done
    dc ps
    fail "timed out after ${WAIT_SECONDS}s waiting for: $*"
}

if [ $# -ge 1 ]; then
    HASH="$1"
    [[ "$HASH" =~ ^[0-9a-f]{7,40}$ ]] || fail "'$HASH' is not a commit hash"
    for img in "$GAME_IMAGE" "$API_IMAGE"; do
        docker image inspect "$img:$HASH" > /dev/null 2>&1 || fail "no image $img:$HASH on this machine (images are only kept for commits that were deployed here)"
    done
    echo "Rolling back to $HASH"
else
    if [ -z "${HT_ALLOW_DIRTY:-}" ] && ! git diff --quiet HEAD --; then
        fail "tracked files have uncommitted changes; commit them (or HT_ALLOW_DIRTY=1 for a test build)"
    fi
    [ -n "${HT_SKIP_PULL:-}" ] || git pull --ff-only
    HASH="$(git rev-parse HEAD)"
    echo "Building $HASH"
    HT_TAG="$HASH" dc build
fi

# `latest` always points at what is deployed, so a bare `docker compose up -d` stays consistent.
for img in "$GAME_IMAGE" "$API_IMAGE"; do docker tag "$img:$HASH" "$img:latest"; done
export HT_TAG="$HASH"

echo "Starting the database"
dc up -d ht-db
wait_healthy ht-db

echo "Running migrations"
dc run --rm --no-deps ht-api node_modules/.bin/tsx packages/api/src/migrate.ts

echo "Starting the stack"
dc up -d
wait_healthy ht-db ht-api ht-game

echo "$HASH" > .last-deploy-hash
dc ps
echo "Deployed $HASH"
