#!/usr/bin/env bash
# ht-deploy.sh build-only and ship, with a stubbed docker and throwaway repos. Touches nothing real.
# Run: bash tests/deploy/ht-deploy-ship.test.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)/ht-deploy.sh"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; fail=0
git init -q --bare -b main "$T/origin.git"; git clone -q "$T/origin.git" "$T/work" 2> /dev/null; W="$T/work"
g() { git -C "$W" -c user.email=t@t -c user.name=t "$@"; }
cp "$SRC" "$W/"; echo a > "$W/f"; touch "$W/docker-compose.prod.yml"; printf 'HT_DB=x\n' > "$W/.env.prod"; chmod 600 "$W/.env.prod"
g add ht-deploy.sh f docker-compose.prod.yml; g commit -qm one; g push -q origin HEAD:main; ONE="$(g rev-parse HEAD)"
echo b > "$W/f"; g commit -qam two; g push -q origin HEAD:main; TWO="$(g rev-parse HEAD)"
g reset -q --hard "$ONE"; g fetch -q origin main; g update-ref refs/remotes/origin/main "$TWO"
g branch -q side "$ONE"; git -C "$W" -c user.email=t@t -c user.name=t checkout -q --detach; git -C "$W" checkout -q main
echo c > "$W/f"; g commit -qam side; SIDE="$(g rev-parse HEAD)"; g reset -q --hard "$ONE"
mkdir -p "$T/bin" "$T/keys"; : > "$T/keys/jwt-ed25519.pem"; : > "$T/log"
cat > "$T/bin/docker" <<'D'
#!/usr/bin/env bash
echo "$*" >> "$DOCKER_LOG"
case "$1" in
  image) [ -n "${FAKE_IMAGES:-}" ] && [[ "$3" == *"$FAKE_IMAGES"* ]]; exit $? ;;
  inspect) echo healthy ;;
esac
exit 0
D
chmod +x "$T/bin/docker"
export DOCKER_LOG="$T/log" HT_KEYS_DIR="$T/keys" HT_WAIT_SECONDS=1
run() { ( cd "$W" && PATH="$T/bin:$PATH" bash ./ht-deploy.sh "$@" ) 2>&1; }
ok() { echo "ok   $1"; }; bad() { echo "FAIL $1"; fail=1; }
: > "$T/log"; run build-only "$SIDE" > /dev/null && bad "build-only built a sha not on origin/main" || ok "build-only refuses a sha not on origin/main"
run build-only > /dev/null && bad "build-only without a sha" || ok "build-only needs a sha"
run build-only "$TWO" > /dev/null || bad "build-only failed"
if grep -q "compose -p hostile_takeover -f .*/docker-compose.prod.yml build" "$T/log" && grep -q "tag hostile-takeover-game:$TWO hostile-takeover-game:${TWO:0:12}" "$T/log" \
  && grep -q "tag hostile-takeover-api:$TWO hostile-takeover-api:${TWO:0:12}" "$T/log" && ! grep -qE ' (up|run|down|stop) ' "$T/log" && [ ! -e "$W/.last-deploy-hash" ] \
  && [ "$(git -C "$W" rev-parse HEAD)" = "$ONE" ] && [ -z "$(git -C "$W" worktree list | sed -n 2p)" ]; then ok "build-only builds from a worktree, tags full and 12-char, starts nothing, leaves HEAD and hash alone, cleans up"
else bad "build-only wrong"; cat "$T/log"; fi
: > "$T/log"; out="$(FAKE_IMAGES=$TWO run build-only "$TWO")"
if echo "$out" | grep -q "already exist" && ! grep -q " build" "$T/log"; then ok "build-only reuses existing images"; else bad "rebuilt existing images: $out"; fi
: > "$T/log"; run ship "$SIDE" > /dev/null && bad "ship of a sha not on origin/main" || ok "ship refuses a sha not on origin/main"
: > "$T/log"; FAKE_IMAGES=$TWO run ship "$TWO" > /dev/null
if [ "$(git -C "$W" rev-parse HEAD)" = "$TWO" ] && [ "$(cat "$W/.last-deploy-hash")" = "$TWO" ] && ! grep -q " build" "$T/log" \
  && grep -q "tag hostile-takeover-game:$TWO hostile-takeover-game:latest" "$T/log" && grep -q "up -d" "$T/log"; then ok "ship fast-forwards to the sha, reuses the prebuilt images, deploys, records the hash"
else bad "ship wrong"; cat "$T/log"; fi
exit "$fail"
