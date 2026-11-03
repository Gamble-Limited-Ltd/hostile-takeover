# HT front rotation: ht-N and ht-api-N

## Change
With `HT_DOMAIN_NUMBER=N` (read by `ht-deploy.sh` from `.env.prod`, interface unchanged) the game is
`ht-N.taps-holdings.org` and the API `ht-api-N.taps-holdings.org`. `HT_DOMAIN_SUFFIX` (`-N` or empty) is
still the single derived value; `docker-compose.prod.yml` now uses `ht${HT_DOMAIN_SUFFIX}` and
`ht-api${HT_DOMAIN_SUFFIX}` for DOMAIN, GAME_ORIGIN, HT_GAME_HOST, GAME_HOST and API_URL.
Empty number now means `ht.` / `ht-api.` (was `hostile-takeover.` / `hostile-takeover-api.`).
Also updated: `ht-deploy.sh` comments, `ht-name`, `example.env(.prod)`, `docs/Deploy.md`, `docs/HT-RUNBOOK.md`,
`CLAUDE.md`, test fixtures and a comment in `SecurityHeaders.ts`. Image names (`hostile-takeover-game`,
`hostile-takeover-api`), container names, key dir and backup paths are not public hostnames and stay.
CORS/origin lists, OIDC callback and post-logout URLs, and the news notice are all built at runtime from
DOMAIN / API_URL / GAME_ORIGIN, so no src logic changed.

## Release or rebuild?
No. The only build args are `GIT_COMMIT` and `MERIDIAN_URL`; no hostname is baked into an image. The new
compose and script are enough: `HT_SKIP_BUILD=1` deploys (and the rotation's restarts on the deployed image)
work. No version bump, no player changelog entry. If bundled with a normal release, lane Patch; alone it
needs no release record beyond the rotation log.

## Cutover dependency
The working-tree compose and `ht-deploy.sh` reach prod at the next rotation run. So this branch must be
merged into the live tree together with the rotation repo change (`rotate.sh` expecting `ht-N` /
`ht-api-N`) before the first 06:00 prestage. The first run is the bridge from `hostile-takeover-14` to
`ht-15` (game) and `ht-api-15` (API). Mismatch in either direction makes rotate.sh's host check fail.
Boss steps for the first run: GATE client callback and post-logout URIs for `ht-15` / `ht-api-15`
(rotation already handles this daily), and Cloudflare routes for the new prefixes.

## Cutover prefix override (hardening, 2026-11-03)
`.env.prod` may hold `HT_GAME_PREFIX` and `HT_API_PREFIX` (default `ht` / `ht-api`, a-z 0-9 and - only). Before the bridge rotation Boss sets them to `hostile-takeover` / `hostile-takeover-api`, so the new `ht-deploy.sh` still derives the live names (`hostile-takeover-14`) and any rollback or manual deploy before the bridge run is safe. The bridge rotation deletes both keys while moving to `ht-15`; a rolled-back run restores the old `.env.prod` and keeps the old names. After the bridge the keys are gone and unused.
