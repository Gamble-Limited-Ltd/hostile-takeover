# Release record: HT Minor, WAYFINDER v2 personal routes, dark (prepared 2026-11-20)

```
Release: WAYFINDER v2 soft launch (D63), HT part, branch slice/wayfinder-v2 (one commit on main 37902415a). OFF by default: without
  env WAYFINDER_ROUTES_FILE behaviour is exactly as main (W3b dual mode and the v1 host table untouched).
Lane: Minor proposed (changes CSP, CORS, the GATE/launch sign-in path and adds an outbound call; the changelog line is player-visible).
  Patch is defensible (same as the W3b dark deploy: no migration, no behaviour change while dark); Boss picks. Boss deploys.
Version: HT has no version number; the changelog line in resources/changelog.md is the player-facing record.
Code under release: tip of slice/wayfinder-v2 (code head c61facdaf; the merge ships the branch tip, which also holds record-only commits after it) (0 behind origin/main). Live is 2307870d4 (W3b). main also holds 37902415a
  (ht-deploy.sh build-only and ship subcommands, undeployed, needed by gll ship); the merge ships both.
What changes with the flag OFF: the new changelog line only (D44): "With Wayfinder, each player gets their own game address, and it
  changes over time. Settings the game keeps in your browser (such as your game options) belong to one address, so after a move to a
  new address you may need to set them again." Code paths: routes.v2.json helper in packages/shared/src/Wayfinder.ts (routeFor,
  routesV2, wayfinderOn, requestPlayer/requestLabel, loopback-only trust of x-wayfinder-*), accepted-label CORS and CSP, owner-check
  leak report (packages/api/src/leak.ts, fire and forget, no-op without WAYFINDER_API_URL).
Compose and rotation (updated 2026-11-20, turn-on wiring added so one deploy is enough): docker-compose.prod.yml gains one volume line on BOTH ht-api and
  ht-game: ${WAYFINDER_RUNTIME_DIR:-./wayfinder-runtime-empty}:/run/wayfinder:ro (directory, not the file: the tick replaces routes.v2.json by rename).
  The default is wayfinder-runtime-empty/ (committed, .gitkeep): empty, so nothing is read and behaviour is unchanged. ht-deploy.sh gains 3 lines that
  read WAYFINDER_RUNTIME_DIR from .env.prod (same sed pattern as HT_NEWS_NOTICE; absent key = empty = default), because compose is run without --env-file
  and rotation calls ht-deploy.sh. No other deploy script, Dockerfile or manage.sh change.
  docker compose config evidence (render only, scratch .env.prod, removed after): env unset -> both services mount .../wayfinder-runtime-empty at /run/wayfinder,
  read_only true; WAYFINDER_RUNTIME_DIR=/home/thestrongest/gll-planning/wayfinder/runtime -> both mount that dir, read_only true. Both render without error; bash -n ht-deploy.sh ok.
  Rotation safety verdict: SAFE. Merged, the 06:00 rotation recreates on the deployed image with the empty read-only mount; WAYFINDER_ROUTES_FILE stays unset.
  Network: ht-api is on `default` (a normal bridge) plus the internal gll_gate, so it reaches http://172.17.0.1:8987 via default. No network change needed.
  Not tested from inside the container (none touched): curl it at turn-on.
  Token: HT reads WAYFINDER_SERVICE_TOKEN as a value (leak.ts, no _FILE variant): it goes in .env.prod (mode 600), not a mount.
Turn-on later (Boss, at V11; env only, no new compose change): .env.prod gets WAYFINDER_RUNTIME_DIR=/home/thestrongest/gll-planning/wayfinder/runtime and WAYFINDER_ROUTES_FILE=/run/wayfinder/routes.v2.json (the switch; WAYFINDER_V2 is not used in HT; optional WAYFINDER_DOMAIN,
  default taps-holdings.org); on the API: WAYFINDER_API_URL=http://172.17.0.1:8987 and WAYFINDER_SERVICE_TOKEN (32+ chars, same token as
  GATE, casino and Wayfinder). The open-tab notice is injected by the edge, no HT code. HT handles no money: no step-up.
Gates (2026-11-20):
  Targeted, local, Node 24.21: tests/shared/WayfinderV2.test.ts + tests/shared/Wayfinder.test.ts 21/21; tests/server/LaunchPage.test.ts,
    tests/server/WayfinderGame.test.ts, tests/api (whole folder) 26 files, 543 passed, 9 skipped [x].
  buildpc-run typecheck with --fallback none: exit 75, not offloaded (play-active); no local run (full checks never run on this VM).
  HT CI (typecheck, lint, Oxfmt, full suite in shards) runs on every push: the first run on eb9fca4f4 FAILED only the lint/format job (oxlint prefer-nullish-coalescing in
    packages/shared/src/Wayfinder.ts:160, plus Oxfmt on gateRoutes.ts, hosts.ts, WayfinderV2.test.ts); build, API tests and all 5 test shards
    passed. Fixed in the commit after this record's first push (lint and format clean locally on the changed files, targeted tests 554 passed).
    HT CI re-run on f105ae549: green (all jobs) [x]. The record commit after it changes docs only
  FORK_CHANGES.md: the touched files (packages/api/src/*, packages/shared/src/Wayfinder.ts, src/server/LaunchPage.ts) were created by us,
    none is an upstream file, so no new row; re-check if CI's fork-drift step objects.
C1 edge proof (added 2026-11-20, c61facdaf): optional WAYFINDER_EDGE_SECRET_FILE (in-container path) or WAYFINDER_EDGE_SECRET. When set, x-wayfinder-player,
  x-wayfinder-label and x-forwarded-host are trusted only from a loopback peer that also sends a matching x-wayfinder-edge (timing-safe; unreadable or short
  secret fails closed); otherwise the request is treated as not through the edge. Unset keeps loopback-only, so deploy order does not matter. Never logged, nothing
  is forwarded. One check, edgeTrusted in packages/shared/src/Wayfinder.ts, used by requestPlayer, requestLabel and requestHost (so LaunchPage.ts, hosts.ts,
  leak.ts and RenderHtml.ts all go through it). Compose adds an inert read-only file mount in ht-api and ht-game:
  ${WAYFINDER_EDGE_SECRET_HOST_FILE:-./wayfinder-runtime-empty/no-secret}:/run/secrets/wf-edge-secret:ro (committed empty file); ht-deploy.sh passes
  WAYFINDER_EDGE_SECRET_HOST_FILE on from .env.prod like WAYFINDER_RUNTIME_DIR. Turn-on adds to .env.prod: WAYFINDER_EDGE_SECRET_HOST_FILE=/home/thestrongest/.config/gll-wayfinder/edge-secret,
  WAYFINDER_EDGE_SECRET_FILE=/run/secrets/wf-edge-secret (check the container user can read the file). Tests: 3 new cases in tests/shared/WayfinderV2.test.ts;
  affected folders tests/shared, tests/api, LaunchPage and WayfinderGame tests 567 passed, 9 skipped locally; oxfmt clean. CI on ced103d50 (run 44859139596): green (all jobs) [x].
Kill switch: unset WAYFINDER_ROUTES_FILE (and the token) in .env.prod and recreate via ht-deploy.sh (no new image). Before turn-on nothing to switch off.
Smoke after deploy: game loads on the current ht-N host, sign-in via GATE works, /auth/launch still works as in W3b; gll ship runs
  both HTTP checks (127.0.0.1:8280 and :8287/healthz) and rotate.sh check (preflight OK).
Watch period: 24 h if Minor, none if Patch.
Merge (Boss):
  cd ~/hostile-takeover && git fetch origin && git merge --ff-only origin/slice/wayfinder-v2 && git push origin main
Deploy and rollback (Boss):
  cd ~/hostile-takeover && gll ship ht "$(git rev-parse HEAD)"
  gll ship ht --rollback 2307870d4e2a874409332972c1e63b2d3c094b86
```
