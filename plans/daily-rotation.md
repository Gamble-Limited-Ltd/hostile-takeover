# Daily host rotation + status page

**Status:** Prep (owner approved the design on 2026-10-23; nothing built). This is VM-level ops work for
every project on the gamble tunnel, so the code lives in an ops folder outside the game repos (path
to confirm before building). Writing to GLL, Meridian or GATE, or touching their containers, needs
Boss's OK, which he gave in principle on 2026-10-23; ask again before the first real run.

**Goal:** every day at 7 AM America/Chicago, all projects move to new hostnames (`<name>-N`), restart,
and are back by about 7:30, with N going up by one. Players can always find today's URL.

**Exit test:** on a rehearsal run, N goes up by one, every project answers on its new name and
rejects the old one, sign-in works on all of them (GATE included), and a forced failure rolls back
to yesterday's names and alerts Boss.

---

## Decided (owner, 2026-10-23)

| Area        | Decision                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope       | HT, HT API, GATE (`id`), GLL (`icantstopwinning`) and Meridian. Everything on the gamble tunnel on this VM. nodeterm and Limitless are excluded                  |
| Counter     | One shared counter N for all projects, +1 each day. The start number is Boss's call; he is moving HT by hand first and will say when it's ready                  |
| Cloudflare  | Wildcard DNS record + wildcard tunnel route for `*.taps-holdings.org`; nginx routes by Host and rejects unknown names. Existing explicit records keep precedence |
| Old hosts   | Die immediately (nginx rejects them)                                                                                                                             |
| Notice      | In every game, the **existing news/notice banner** says "Tomorrow's URL is GAME-URL-N+1" (no new UI)                                                             |
| Status page | A plain static site on a name that never rotates (e.g. `uptime.taps-holdings.org`), brand colors, links to today's URL for each game, Limitless left out         |
| Timing      | Systemd user timer, America/Chicago. Staggered 7:00 to 7:30: GATE first, then APIs, then games                                                                   |

## Risks (raised once, Boss chose to include GATE)

- Rotating GATE changes its issuer URL; HT, GLL and Meridian trust it, so one bad morning breaks sign-in
  everywhere. Every project's sessions reset daily (JWT `iss` and cookies change).
- GATE sits behind Cloudflare Access, which is per hostname: rotate the Access app too (needs the API key)
  or give Access a wildcard policy.
- Each project's OIDC client in GATE (callback and post-logout URIs) must be updated by script every day.
- Players lose per-origin localStorage daily.

## Design

1. **One-time setup (Boss):** add the wildcard DNS record and tunnel route; create a Cloudflare API key
   scoped only to what the Access step needs, stored chmod 600 outside every repo. Nginx gets a catch-all
   that returns 444 for unknown hosts (verify no default site leaks).
2. **Daily job** (`rotate.sh`, one orchestrator with a small hook per project):
   1. read and increment N (state file, written only after success);
   2. GATE: new host, Access app, client URIs for each consumer; health check;
   3. HT API, GLL, Meridian: new env, `up -d` (no rebuild if the host isn't baked into the bundle: to
      verify), health check;
   4. games: staggered restarts; each gets the banner text for N+1;
   5. regenerate the status page; write today's URLs to a file and the vault;
   6. on any failure: roll back to N-1 names, alert Boss.
3. **HT hook** reuses `HT_DOMAIN_NUMBER` / `ht-deploy.sh` logic, minus the rebuild.
4. **Rehearsal:** against dev stacks only (GATE dev 3302, HT dev, a throwaway nginx), then one
   supervised prod run with Boss watching.

## Slices (to be briefed after the upstream sync)

- R1 Nginx catch-all + wildcard setup notes (Boss runs the Cloudflare steps).
- R2 `rotate.sh` core: counter, per-project hooks, rollback, alert.
- R3 GATE hook: issuer, Access app, client URI updates.
- R4 Game banner text through the existing notice slot (HT first; GLL and Meridian follow their own repos).
- R5 Status page and the daily URL file.
- R6 Timer, stagger, logging; supervised first run.

## Gates

Its own slice, never the same day as the upstream sync. Dev rehearsal passes, forced-failure rollback
tested, Boss present for the first prod run. Light-schedule note: a restart is not a release, but any
code change that ships with it follows the normal lanes.

## Open

- Start number (Boss will say).
- Where the ops folder lives, and the status page's final hostname.
- Whether `ht-deploy.sh` can skip the rebuild when only the host changes.

## Decision log

| Date       | Decision                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- |
| 2026-10-23 | Rotate everything on the gamble tunnel incl. GATE; wildcard route; old hosts die at once    |
| 2026-10-23 | Shared counter; banner via the existing notice slot; static status page; Limitless excluded |
