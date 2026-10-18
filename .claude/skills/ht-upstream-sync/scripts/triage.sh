#!/usr/bin/env bash
# Phase 0 triage for an upstream OpenFront sync. Read-only: the only write is
# `git fetch upstream` (remote refs and tags). Usage: triage.sh [tag]
# With no tag, targets the newest stable v0.NN.N tag (no -beta/-rc).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

git fetch --quiet upstream --tags
tag="${1:-$(git tag --list 'v0.*' --sort=-v:refname | grep -Ev -- '-(beta|rc|alpha)' | head -1)}"
git rev-parse --verify --quiet "$tag^{commit}" > /dev/null || {
    echo "No such tag: $tag" >&2
    exit 1
}

base=$(git merge-base main "$tag")
echo "## Target: $tag ($(git log -1 --format='%h %ad' --date=short "$tag"))"
echo "- Merge base: $(git log -1 --format='%h %ad' --date=short "$base")"
echo "- Upstream commits to take: $(git rev-list --count main.."$tag")"
echo "- Our commits since base:   $(git rev-list --count "$tag"..main)"
echo "- Stable tags newer than our base:"
git tag --list 'v0.*' --sort=v:refname --merged upstream/main | grep -Ev -- '-(beta|rc|alpha)' \
    | while read -r t; do git merge-base --is-ancestor "$t" main 2> /dev/null || echo "    $t"; done

echo
echo "## Predicted conflicts (git merge-tree, nothing written to the work tree)"
out=$(git merge-tree --write-tree --name-only main "$tag" 2>&1 || true)
conflicts=$(printf '%s\n' "$out" | sed -n 's/^CONFLICT (.*): Merge conflict in //p; s/^CONFLICT (modify\/delete): \(.*\) deleted in.*/\1/p' | sort -u)
if [ -z "$conflicts" ]; then echo "none"; else
    n=$(printf '%s\n' "$conflicts" | wc -l)
    echo "$n file(s):"
    while read -r f; do
        if grep -qF "\`$f\`" FORK_CHANGES.md; then m="in FORK_CHANGES"; else m="NOT in FORK_CHANGES (investigate)"; fi
        echo "- $f  [$m]"
    done <<< "$conflicts"
fi

echo
echo "## Risk flags"
files=$(git diff --name-only "$base" "$tag")
flag() { # label, regex
    local hits
    hits=$(printf '%s\n' "$files" | grep -E "$2" || true)
    if [ -n "$hits" ]; then
        echo "- $1: $(printf '%s\n' "$hits" | wc -l) file(s)"
        printf '%s\n' "$hits" | head -8 | sed 's/^/    /'
    fi
}
flag "ENGINE changed (lane becomes MAJOR)" '^packages/(engine|engine-api|engine-lib)/'
flag "Wire/HTTP schemas (check API contract)" '^packages/shared/src/(.*Schema|.*Wire|ApiSchemas|.*Cosmetic|.*Cluster)'
flag "Censor.ts (mirror into packages/api/src/censor.ts)" '^src/server/Censor\.ts$'
flag "New or changed GitHub workflows (disable new ones)" '^\.github/workflows/'
flag "Dependencies" '^(package\.json|package-lock\.json)$'
flag "Store/ads/login/telemetry paths (re-hide entry points)" '(Store|Purchase|Inventory|Turnstile|Stripe|Ads?[A-Z/]|Telemetry|Discord|Steam|CrazyGames|Login)'
flag "Server env / deploy / nginx" '^(src/server/ServerEnv\.ts|Dockerfile|nginx|.*docker-compose|example\.env)'
flag "Tests/LayerBoundaries" '^tests/LayerBoundaries'
flag "Player-facing news/changelog (strip store/Discord links)" '^(resources/news\.json|changelog\.md)'
echo "- UI changed: $(printf '%s\n' "$files" | grep -cE '^(src/client/|resources/lang/en\.json|index\.html)' || true) client file(s)"

echo
echo "## Upstream commit subjects (newest 40)"
git log --no-merges --format='- %h %s' main.."$tag" | head -40
