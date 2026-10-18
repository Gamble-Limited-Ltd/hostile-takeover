#!/usr/bin/env bash
# Hostile Takeover preship: a fast local gate, offloaded to the spare build PC when it is free.
#
#   bash preship.sh            quick: typecheck + lint/prettier/tests for the CHANGED files (about a minute)
#   bash preship.sh --full     everything CI runs, incl. the production build (offload PC only; exit 75 if unavailable)
#   bash preship.sh --status   is there a FULL pass for exactly the current tree?
#   bash preship.sh --local    never offload (quick on this machine; --full --local skips the build)
#   bash preship.sh --help
#
# The checks live in scripts/preship-inner.sh (runs inside the offload container or locally);
# helpers in scripts/preship-lib.sh. Result record: <git dir>/ht-preship-last (never tracked).
# Exit codes: 0 pass, 1 a check failed, 2 bad usage, 75 not offloaded (push the branch for CI).
# Docs: docs/Preship.md.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"
# shellcheck source=scripts/preship-lib.sh
source scripts/preship-lib.sh

usage() {
    sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

ps_parse_args "$@" || exit 2
case "$PS_MODE" in
    help)
        usage
        exit 0
        ;;
    status)
        ps_status
        exit $?
        ;;
esac

NO_OFFLOAD_MSG="full needs the offload PC or GitHub CI: push the branch, ht-ci.yml runs it for free
  git push -u origin $(git branch --show-current 2> /dev/null || echo '<branch>')"

# HT needs Node from .nvmrc; the VM default is older. Only matters for runs on this machine.
use_pinned_node() {
    local want dir
    want=$(tr -d '[:space:]' < .nvmrc 2> /dev/null || true)
    [ -n "$want" ] || return 0
    dir="$HOME/.nvm/versions/node/v${want#v}/bin"
    if [ -d "$dir" ]; then
        PATH="$dir:$PATH"
        export PATH
    fi
}

# Changed files only matter for quick; computed here because the offload container has no .git.
CHANGED=()
if [ "$PS_MODE" = quick ]; then
    mapfile -t CHANGED < <(ps_changed_files)
    if printf '%s\n' "${CHANGED[@]}" | grep -qxE 'package(-lock)?\.json|vite\.config\.ts|tsconfig.*\.json|eslint\.config\.js'; then
        echo "preship: a build or lint config changed; quick only checks changed files, run --full before you ship" >&2
    fi
fi
inner_args=("$PS_MODE")
if [ "$PS_MODE" = quick ] && [ "${#CHANGED[@]}" -gt 0 ]; then
    inner_args+=(-- "${CHANGED[@]}")
fi

fp_note=$(ps_tree_fingerprint)
start=$SECONDS
rc=0
if [ "$PS_LOCAL" = 1 ] || ! command -v buildpc-run > /dev/null 2>&1; then
    if [ "$PS_MODE" = full ] && [ "$PS_LOCAL" = 0 ]; then
        echo "preship: buildpc-run is not installed. $NO_OFFLOAD_MSG" >&2
        exit 75
    fi
    [ "$PS_MODE" = full ] && echo "preship: --full --local: running on this machine without the production build (slow; CI is faster)" >&2
    use_pinned_node
    bash scripts/preship-inner.sh "${inner_args[@]}" || rc=$?
elif [ "$PS_MODE" = full ]; then
    export PRESHIP_BUILD=1
    buildpc-run --heavy --fallback none --env PRESHIP_BUILD -- bash scripts/preship-inner.sh "${inner_args[@]}" || rc=$?
else
    buildpc-run --light --fallback local -- bash scripts/preship-inner.sh "${inner_args[@]}" || rc=$?
fi

if [ "$rc" = 75 ]; then
    echo "preship: not run (offload PC unavailable). $NO_OFFLOAD_MSG" >&2
    exit 75
fi

secs=$((SECONDS - start))
# Record against the tree as it was when the run started; skip if it moved meanwhile.
if [ "$(ps_tree_fingerprint)" = "$fp_note" ]; then
    if [ "$rc" = 0 ]; then ps_write_record "$PS_MODE" pass "$secs"; else ps_write_record "$PS_MODE" fail "$secs"; fi
fi
if [ "$rc" = 0 ]; then
    echo "preship $PS_MODE: PASS in ${secs}s"
else
    echo "preship $PS_MODE: FAIL (exit $rc) after ${secs}s"
fi
exit "$rc"
