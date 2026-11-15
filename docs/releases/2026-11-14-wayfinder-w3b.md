# Release record: HT Patch, WAYFINDER W3b dual mode (prepared 2026-11-14)

```
Release: WAYFINDER W3b, shipped dual mode (plan ~/gll-planning/wayfinder/04). With no /run/wayfinder/hosts.json
  (the case in prod until the cutover) behaviour is exactly as main: tests/server/WayfinderGame.test.ts and
  tests/api/WayfinderApi.test.ts cover the no-file path.
Lane: Patch proposed (no migration, no change while the host file is absent; same lane as the legal v2 dark deploy).
  Boss picks; Minor would add a throwaway-stack trial run and a 24 h hold. Boss deploys. Claude does not deploy.
What changed (only once the host file exists):
  - CSP, game and API CORS, page serverHost/apiUrl, GATE redirect URI, cluster.json host, news notice: per request.
  - HALL launch tickets: GET /auth/launch + /auth/launch.js (game), POST /auth/launch (API): EdDSA, aud = GATE client id,
    60 s, single-use jti; per-IP flood limit 600/min. 404 without the host file.
  - Admin password-reset links use the current game host.
Player note: none (nothing visible until the Wayfinder cutover).
Gates:
  HT CI (typecheck, lint, format, full suite in 4 shards + tests/server) green on fd2637435 (run 43655930483) [x]
  Targeted: tests/api/WayfinderApi.test.ts + Accounts.test.ts 53/53 locally [x]
  FORK_CHANGES.md entry for the upstream files touched [x]
Known issues: launch jti replay set is in memory (fine with one API process).
Kill switch: none needed while dark; after cutover, removing the /run/wayfinder mount returns to env behaviour.
Smoke after deploy: game loads on the current ht-N host, sign-in via GATE works, /auth/launch answers 404.
Watch period: none required while dark (Patch).
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh 2827891f69a8057a8b9a1283c43bc6e1d0f523a4
```
