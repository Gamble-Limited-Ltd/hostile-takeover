#!/usr/bin/env bash
# Hostile Takeover preship: the checks themselves. Run through preship.sh (inside the offload
# container, or directly); you normally do not call this by hand.
#
#   bash scripts/preship-inner.sh quick [-- CHANGED_FILE...]
#   bash scripts/preship-inner.sh full
#
# quick: typecheck (whole repo), then oxlint, eslint, prettier and `vitest related` on the changed
#        files only; a step with nothing to check is skipped. The file list comes from preship.sh
#        (the container has no .git).
# full:  what GitHub CI runs: typecheck, oxlint, eslint, `prettier --check .`, `vitest run`, then
#        `vitest run tests/server`, and `npm run build-prod` only when PRESHIP_BUILD=1 (set by
#        preship.sh for offloaded runs; the build writes static/ and src/assets/, so it never runs
#        in your own tree).
# The independent steps run in parallel, each logging to its own temp file; results print in a
# fixed order with seconds. Exit 0 only if every step that ran passed. Docs: docs/Preship.md.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/preship-lib.sh
source "$HERE/preship-lib.sh"

mode=${1:-}
case "$mode" in quick | full) shift ;; *)
    echo "usage: preship-inner.sh quick|full [-- FILE...]" >&2
    exit 2
    ;;
esac
FILES=()
if [ "${1:-}" = "--" ]; then
    shift
    FILES=("$@")
fi

if [ ! -d node_modules ]; then
    echo "preship: node_modules is missing; run 'npm run inst' first" >&2
    exit 1
fi

# Leave room for the other parallel steps: vitest gets cores minus 4 (at least 2, at most 8).
cpus=$(nproc 2> /dev/null || echo 4)
workers=$((cpus - 4))
[ "$workers" -lt 2 ] && workers=2
[ "$workers" -gt 8 ] && workers=8

LOGS=$(mktemp -d "${TMPDIR:-/tmp}/ht-preship.XXXXXX")
trap 'rm -rf "$LOGS"' EXIT
ORDER=(typecheck oxlint eslint prettier vitest build-prod)
declare -A SKIP_REASON=()

# start_step NAME CMD...: run in the background; leaves NAME.log, NAME.rc, NAME.secs in $LOGS.
start_step() {
    local name=$1
    shift
    (
        t0=$(date +%s)
        rc=0
        "$@" > "$LOGS/$name.log" 2>&1 || rc=$?
        echo $(($(date +%s) - t0)) > "$LOGS/$name.secs"
        echo "$rc" > "$LOGS/$name.rc"
    ) &
}

skip_step() { SKIP_REASON[$1]=$2; }

# The offload image (plain node) has no jq, which tests/UpdateRegister.test.ts shells out to
# (update.sh needs it). Leave that file out there and say so loudly; GitHub CI and this VM have jq.
VITEST_EXTRA=()
NOTES=()
if [ "${PRESHIP_ASSUME_NO_JQ:-0}" = 1 ] || ! command -v jq > /dev/null 2>&1; then
    VITEST_EXTRA+=(--exclude tests/UpdateRegister.test.ts)
    NOTES+=("jq is not installed here, so tests/UpdateRegister.test.ts was NOT run (update.sh needs jq). GitHub CI runs it.")
fi

vitest_full() {
    local a=0 b=0
    npx vitest run --maxWorkers="$workers" "${VITEST_EXTRA[@]}" || a=$?
    echo "--- tests/server alone (as CI and npm test do) ---"
    npx vitest run tests/server --maxWorkers="$workers" || b=$?
    [ "$a" -eq 0 ] && [ "$b" -eq 0 ]
}

# Build waits for vitest so it cannot write static/ while tests read the tree.
build_after_vitest() {
    while [ ! -f "$LOGS/vitest.rc" ]; do sleep 1; done
    npm run build-prod
}

# Offloaded full runs only (PRESHIP_BUILD=1 never happens on this VM): drop leftover build output
# from an earlier run, because tests such as RenderHtml fail when static/asset-hashes.json exists.
if [ "${PRESHIP_BUILD:-0}" = 1 ]; then rm -rf static; fi

start_step typecheck npm run typecheck

if [ "$mode" = full ]; then
    start_step oxlint npm run lint:oxlint
    start_step eslint npm run lint:eslint
    start_step prettier npx prettier --check .
    start_step vitest vitest_full
    if [ "${PRESHIP_BUILD:-0}" = 1 ]; then
        start_step build-prod build_after_vitest
    else
        skip_step build-prod "PRESHIP_BUILD is not set (the build only runs on the offload PC, never in your own tree); CI runs it"
    fi
else
    skip_step build-prod "full mode only"
    LINT=() PRETTY=() TESTS=()
    if [ "${#FILES[@]}" -gt 0 ]; then
        mapfile -t LINT < <(printf '%s\n' "${FILES[@]}" | ps_filter_kind lint)
        mapfile -t PRETTY < <(printf '%s\n' "${FILES[@]}" | ps_filter_kind prettier)
        mapfile -t TESTS < <(printf '%s\n' "${FILES[@]}" | ps_filter_kind test)
    fi
    if [ "${#LINT[@]}" -gt 0 ]; then
        start_step oxlint npm run lint:oxlint -- "${LINT[@]}"
        start_step eslint npm run lint:eslint -- --no-warn-ignored "${LINT[@]}"
    else
        skip_step oxlint "skipped: no changed files"
        skip_step eslint "skipped: no changed files"
    fi
    if [ "${#PRETTY[@]}" -gt 0 ]; then
        start_step prettier npx prettier --check --ignore-unknown "${PRETTY[@]}"
    else
        skip_step prettier "skipped: no changed files"
    fi
    if [ "${#TESTS[@]}" -gt 0 ]; then
        start_step vitest npx vitest related --run "${TESTS[@]}" --passWithNoTests --maxWorkers="$workers" "${VITEST_EXTRA[@]}"
    else
        skip_step vitest "skipped: no changed files"
    fi
fi

wait || true
if [ "${PRESHIP_BUILD:-0}" = 1 ]; then rm -rf static; fi

# show_failure NAME: the useful part of a failed step's log (no ANSI, no per-file noise).
show_failure() {
    local clean
    clean=$(sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOGS/$1.log" \
        | grep -vE '^ *(stdout \||stderr \||✓ |$)|injected env|No OTLP endpoint' || true)
    if [ "$1" = vitest ]; then
        printf '%s\n' "$clean" | grep -E '^ *FAIL ' | sort -u | head -40 | sed 's/^/   | /' || true
    fi
    printf '%s\n' "$clean" | tail -n 40 | sed 's/^/   | /'
}

overall=0
echo "preship $mode: results"
for name in "${ORDER[@]}"; do
    if [ -n "${SKIP_REASON[$name]:-}" ]; then
        case "${SKIP_REASON[$name]}" in
            skipped*) echo "== $name: ${SKIP_REASON[$name]}" ;;
            *) echo "== $name: skipped: ${SKIP_REASON[$name]}" ;;
        esac
        continue
    fi
    rc=$(cat "$LOGS/$name.rc" 2> /dev/null || echo 1)
    secs=$(cat "$LOGS/$name.secs" 2> /dev/null || echo "?")
    if [ "$rc" = 0 ]; then
        echo "== $name: ok (${secs}s)"
    else
        overall=1
        echo "== $name: FAIL (exit $rc, ${secs}s); last lines of its log:"
        show_failure "$name"
        if [ "$name" = vitest ] && ps_only_inventory_failures "$LOGS/vitest.log"; then
            echo "   NOTE: the only failing tests are InventoryModal ones (known flaky timeouts under load, see"
            echo "   CLAUDE.md baseline). The run is still a FAIL: rerun it, or confirm green in GitHub CI."
        fi
    fi
done

echo
printf '%-11s %-7s %s\n' step result seconds
for name in "${ORDER[@]}"; do
    if [ -n "${SKIP_REASON[$name]:-}" ]; then
        printf '%-11s %-7s %s\n' "$name" skip -
        continue
    fi
    rc=$(cat "$LOGS/$name.rc" 2> /dev/null || echo 1)
    res=PASS
    [ "$rc" = 0 ] || res=FAIL
    printf '%-11s %-7s %s\n' "$name" "$res" "$(cat "$LOGS/$name.secs" 2> /dev/null || echo '?')"
done
for note in "${NOTES[@]}"; do echo "NOTE: $note"; done
if [ "$overall" = 0 ]; then echo "preship $mode: PASS"; else echo "preship $mode: FAILED"; fi
exit "$overall"
