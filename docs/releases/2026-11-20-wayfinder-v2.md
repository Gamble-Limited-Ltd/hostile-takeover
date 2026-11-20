# Release record: HT Minor, WAYFINDER v2 personal routes, dark (prepared 2026-11-20)

```
Release: WAYFINDER v2 soft launch (D63), HT part, branch slice/wayfinder-v2 (one commit on main 37902415a). OFF by default: without
  env WAYFINDER_ROUTES_FILE behaviour is exactly as main (W3b dual mode and the v1 host table untouched).
Lane: Minor proposed (changes CSP, CORS, the GATE/launch sign-in path and adds an outbound call; the changelog line is player-visible).
  Patch is defensible (same as the W3b dark deploy: no migration, no behaviour change while dark); Boss picks. Boss deploys.
Version: HT has no version number; the changelog line in resources/changelog.md is the player-facing record.
Code under release: tip of slice/wayfinder-v2 (0 behind origin/main). Live is 2307870d4 (W3b). main also holds 37902415a
  (ht-deploy.sh build-only and ship subcommands, undeployed, needed by gll ship); the merge ships both.
What changes with the flag OFF: the new changelog line only (D44): "With Wayfinder, each player gets their own game address, and it
  changes over time. Settings the game keeps in your browser (such as your game options) belong to one address, so after a move to a
  new address you may need to set them again." Code paths: routes.v2.json helper in packages/shared/src/Wayfinder.ts (routeFor,
  routesV2, wayfinderOn, requestPlayer/requestLabel, loopback-only trust of x-wayfinder-*), accepted-label CORS and CSP, owner-check
  leak report (packages/api/src/leak.ts, fire and forget, no-op without WAYFINDER_API_URL).
Compose and rotation: NO change to docker-compose*.yml, ht-deploy.sh, manage.sh or Dockerfile on this branch (git diff origin/main...HEAD
  lists none). Rotation safety verdict: SAFE for this branch. Note for Boss: main already carries the ht-deploy.sh change (37902415a) that
  the 06:00 rotation reads from the working tree; that was merged before this work and is unchanged by it.
  Turn-on later needs compose changes (separate slice, rehearse on the old image): a read-only mount of the Wayfinder runtime/ DIRECTORY into BOTH the game
  and API containers (directory, not the file: the tick replaces routes.v2.json by rename; WAYFINDER_ROUTES_FILE=/run/wayfinder/routes.v2.json
  inside it; today docker-compose.prod.yml mounts only /run/keys), and env.
  Network: ht-api is on `default` (a normal bridge) plus the internal gll_gate, so it reaches http://172.17.0.1:8987 via default; not tested
  from inside the container (curl it at turn-on).
Turn-on later (Boss, at V11): env on game and API: WAYFINDER_ROUTES_FILE (path of the mounted routes.v2.json; optional WAYFINDER_DOMAIN,
  default taps-holdings.org); on the API: WAYFINDER_API_URL=http://172.17.0.1:8987 and WAYFINDER_SERVICE_TOKEN (32+ chars, same token as
  GATE, casino and Wayfinder). The open-tab notice is injected by the edge, no HT code. HT handles no money: no step-up.
Gates (2026-11-20):
  Targeted, local, Node 24.21: tests/shared/WayfinderV2.test.ts + tests/shared/Wayfinder.test.ts 21/21; tests/server/LaunchPage.test.ts,
    tests/server/WayfinderGame.test.ts, tests/api (whole folder) 26 files, 543 passed, 9 skipped [x].
  buildpc-run typecheck with --fallback none: exit 75, not offloaded (play-active); no local run (full checks never run on this VM).
  HT CI (typecheck, lint, Oxfmt, full suite in shards) runs on every push: HT_CI_RESULT
  FORK_CHANGES.md: the touched files (packages/api/src/*, packages/shared/src/Wayfinder.ts, src/server/LaunchPage.ts) were created by us,
    none is an upstream file, so no new row; re-check if CI's fork-drift step objects.
Kill switch: unset WAYFINDER_ROUTES_FILE and recreate (no deploy). Before turn-on nothing to switch off.
Smoke after deploy: game loads on the current ht-N host, sign-in via GATE works, /auth/launch still works as in W3b; gll ship runs
  both HTTP checks (127.0.0.1:8280 and :8287/healthz) and rotate.sh check (preflight OK).
Watch period: 24 h if Minor, none if Patch.
Merge (Boss):
  cd ~/hostile-takeover && git fetch origin && git merge --ff-only origin/slice/wayfinder-v2 && git push origin main
Deploy and rollback (Boss):
  cd ~/hostile-takeover && gll ship ht "$(git rev-parse HEAD)"
  gll ship ht --rollback 2307870d4e2a874409332972c1e63b2d3c094b86
```
