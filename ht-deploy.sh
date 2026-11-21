#!/usr/bin/env bash
# Deploy (or roll back) the Hostile Takeover production stack on this VM.
#
#   ./ht-deploy.sh            git pull --ff-only, build images tagged with the git hash, migrate, up, wait healthy
#   ./ht-deploy.sh <hash>     roll back to the images already built for that commit (no pull, no build)
#   HT_SKIP_BUILD=1 ./ht-deploy.sh   same, for the current HEAD's images (host change only; no pull, no build)
#   ./ht-deploy.sh build-only <sha>  build the images for a commit on origin/main (no fetch) and stop: nothing is started,
#                                    stopped or recorded (used by gll-prebuild). Also tags <image>:<first 12 of the sha>.
#   ./ht-deploy.sh ship <sha>        what `gll ship` runs: fetch, fast-forward to <sha> (it must be on origin/main), reuse the
#                                    images build-only made (build them if missing), then the normal deploy steps
#
# Only touches the compose project `hostile_takeover` (containers ht-db, ht-api, ht-game). Fails loudly.
# Env knobs: HT_SKIP_PULL=1 (no git pull), HT_SKIP_BUILD=1 (reuse HEAD's images; implies no pull), HT_ALLOW_DIRTY=1 (build a tree with uncommitted changes; the
# image is still tagged with HEAD's hash, so only for testing).
set -Eeuo pipefail
cd "$(dirname "$0")"
MODE=
case "${1:-}" in build-only | ship) MODE="$1"; shift ;; esac

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
# HT_NEWS_NOTICE is optional runtime text for the news box (e.g. "Tomorrow's URL is ...").
HT_NEWS_NOTICE="$(sed -n 's/^HT_NEWS_NOTICE=//p' .env.prod | tail -n 1)"
export HT_NEWS_NOTICE
# Wayfinder v2: host dir that docker-compose.prod.yml mounts read-only at /run/wayfinder. Empty/unset = the empty folder in the repo (inert).
WAYFINDER_RUNTIME_DIR="$(sed -n 's/^WAYFINDER_RUNTIME_DIR=//p' .env.prod | tail -n 1)"
export WAYFINDER_RUNTIME_DIR
# Wayfinder v2 C1: host file mounted read-only at /run/secrets/wf-edge-secret. Empty/unset = the empty file in the repo (inert).
WAYFINDER_EDGE_SECRET_HOST_FILE="$(sed -n 's/^WAYFINDER_EDGE_SECRET_HOST_FILE=//p' .env.prod | tail -n 1)"
export WAYFINDER_EDGE_SECRET_HOST_FILE
# HT_DOMAIN_NUMBER=N moves the game to ht-N and the API to ht-api-N (.taps-holdings.org).
# Empty/unset = ht.taps-holdings.org (API ht-api). docker-compose.prod.yml reads HT_DOMAIN_SUFFIX.
HT_DOMAIN_NUMBER="$(sed -n 's/^HT_DOMAIN_NUMBER=//p' .env.prod | tail -n 1)"
case "$HT_DOMAIN_NUMBER" in
'') HT_DOMAIN_SUFFIX= ;;
*[!0-9]*) fail "HT_DOMAIN_NUMBER in .env.prod must be a whole number (got '$HT_DOMAIN_NUMBER')" ;;
*) HT_DOMAIN_SUFFIX="-$HT_DOMAIN_NUMBER" ;;
esac
export HT_DOMAIN_SUFFIX
# Optional prefix overrides, only for the one-time cutover from hostile-takeover-N (see plans/ht-front-rotation.md): the
# rotation clears them. Empty = ht / ht-api. A rollback restores the old .env.prod, so old hosts keep their old names.
HT_GAME_PREFIX="$(sed -n 's/^HT_GAME_PREFIX=//p' .env.prod | tail -n 1)"
HT_API_PREFIX="$(sed -n 's/^HT_API_PREFIX=//p' .env.prod | tail -n 1)"
for p in "$HT_GAME_PREFIX" "$HT_API_PREFIX"; do
    case "$p" in *[!a-z0-9-]*) fail "HT_GAME_PREFIX/HT_API_PREFIX in .env.prod may only hold a-z, 0-9 and - (got '$p')" ;; esac
done
export HT_GAME_PREFIX="${HT_GAME_PREFIX:-ht}" HT_API_PREFIX="${HT_API_PREFIX:-ht-api}"

# sha_on_main <ref>: the full sha of a commit that is on origin/main, else fail
sha_on_main() {
    local s
    s="$(git rev-parse --verify "$1^{commit}" 2> /dev/null)" || fail "unknown commit '$1'"
    git merge-base --is-ancestor "$s" refs/remotes/origin/main || fail "$1 is not on origin/main; only pushed commits are built or shipped"
    echo "$s"
}
images_exist() { local img; for img in "$GAME_IMAGE" "$API_IMAGE"; do docker image inspect "$img:$1" > /dev/null 2>&1 || return 1; done; }

if [ "$MODE" = build-only ]; then
    [ $# -eq 1 ] || fail "usage: ./ht-deploy.sh build-only <sha>"
    HASH="$(sha_on_main "$1")"
    if images_exist "$HASH"; then echo "Images for $HASH already exist, not rebuilding"; else
        # Built from a clean checkout of that commit (the compose build context is its directory), never from this working tree.
        WT="$(mktemp -d "${TMPDIR:-/tmp}/ht-build.XXXXXX")"
        trap 'git worktree remove --force "$WT" 2> /dev/null || rm -rf "$WT"; git worktree prune 2> /dev/null || true' EXIT
        git worktree add --detach "$WT" "$HASH" > /dev/null
        ln -s "$PWD/.env.prod" "$WT/.env.prod" # compose reads env_file at parse time; .dockerignore keeps it out of the image
        echo "Building $HASH (nothing is started or stopped)"
        HT_TAG="$HASH" docker compose -p "$PROJECT" -f "$WT/$FILE" build
    fi
    for img in "$GAME_IMAGE" "$API_IMAGE"; do docker tag "$img:$HASH" "$img:${HASH:0:12}"; done
    echo "Images ready: $HASH"
    exit 0
fi

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

if [ "$MODE" != ship ] && { [ $# -ge 1 ] || [ -n "${HT_SKIP_BUILD:-}" ]; }; then
    HASH="${1:-$(git rev-parse HEAD)}"
    [[ "$HASH" =~ ^[0-9a-f]{7,40}$ ]] || fail "'$HASH' is not a commit hash"
    for img in "$GAME_IMAGE" "$API_IMAGE"; do
        docker image inspect "$img:$HASH" > /dev/null 2>&1 || fail "no image $img:$HASH on this machine (images are only kept for commits that were deployed here)"
    done
    echo "Reusing images for $HASH"
else
    if [ -z "${HT_ALLOW_DIRTY:-}" ] && ! git diff --quiet HEAD --; then
        fail "tracked files have uncommitted changes; commit them (or HT_ALLOW_DIRTY=1 for a test build)"
    fi
    if [ "$MODE" = ship ]; then
        [ $# -eq 1 ] || fail "usage: ./ht-deploy.sh ship <sha>"
        GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags origin main
        WANT="$(sha_on_main "$1")"
        [ "$(git rev-parse HEAD)" = "$WANT" ] || git merge --ff-only "$WANT" || fail "cannot fast-forward to ${WANT:0:12}; to go back to an older commit use ./ht-deploy.sh <hash>"
    else
        [ -n "${HT_SKIP_PULL:-}" ] || git pull --ff-only
    fi
    HASH="$(git rev-parse HEAD)"
    if [ "$MODE" = ship ] && images_exist "$HASH"; then
        echo "Reusing prebuilt images for $HASH"
    else
        echo "Building $HASH"
        HT_TAG="$HASH" dc build
    fi
fi

# `latest` always points at what is deployed, so a bare `docker compose up -d` stays consistent.
for img in "$GAME_IMAGE" "$API_IMAGE"; do docker tag "$img:$HASH" "$img:latest"; done
export HT_TAG="$HASH"

echo "Starting the database"
# Private network to GATE (GLL ID); GATE's compose joins it too. Idempotent.
docker network inspect gll_gate > /dev/null 2>&1 || docker network create --internal gll_gate

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
