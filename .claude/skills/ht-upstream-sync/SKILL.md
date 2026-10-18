---
name: ht-upstream-sync
description: Sync Hostile Takeover with upstream OpenFront - triage a new stable release, merge it on a sync/ branch, resolve conflicts against FORK_CHANGES.md, verify, and hand Boss the deploy. Use when the user says sync upstream, merge OpenFront, update from upstream, a new OpenFront release is out, or asks what upstream changed or whether a sync is worth it.
---

# Upstream sync (OpenFront -> Hostile Takeover)

Repo rules in `CLAUDE.md` ("Hard rules", "Syncing with upstream") and the global release
procedure (`~/.claude/docs/release-procedure.md`) are authoritative. This skill is the runbook that
ties them together. Read `references/conflicts.md` before touching a conflict and
`references/sync-log.md` for lessons from earlier syncs.

## Rules

- **Merge, never rebase.** `upstream` is `openfrontio/openfrontio`. Work only on `sync/upstream-YYYY-MM-DD`, then merge to `main` with `--no-ff`.
- **Stable tags only** (`v0.NN.N`, no `-beta`/`-rc`) and not raw `upstream/main`. An urgent engine or security fix between releases is cherry-picked on its own branch.
- **Fork code stays in new files.** Edits to upstream files stay small, and each one is recorded in `FORK_CHANGES.md`. Hide features at their entry points, never redesign.
- **Never** touch the GLL (`gamble-limited-v2-*`, DB 5433) or Meridian containers or databases, and never copy code out of this repo (AGPL).
- **Boss runs the prod deploy.** Claude prepares the release and pastes the exact deploy and rollback commands in a fenced block. Claude deploys only a hotfix, and only after Boss says `go`.
- **Ask before outward-facing steps:** pushing the `sync/` branch, merging to `main`, pushing `main`. One approval does not cover the next.
- Node: `export PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH` before any npm command. Never run the full test suite on the VM while the dev stack or headless Chromium is up (CI does that).

## Schedule

- Upstream cuts stable tags every few days to weeks. We sync **only stable tags**, **when the changes are noticeable** (player-visible features, balance, engine or security fixes), and **at least about every 2 weeks** if so. Not every tag needs a sync; skipping to the next one is fine.
- The Monday `ht-upstream-watch` run flags new upstream commits. When a session starts (or Boss asks), run Phase 0 and report whether a sync is worth it.
- Deploy window: never 10 pm to 7 am America/Chicago, at most one non-hotfix deploy per project per day, zero open P0/P1 issues, and the previous release's watch period must be over.

## Lane

A sync is a **Minor** (24 h watch, trial on a throwaway stack). It becomes a **Major** (72 h watch,
full rehearsal) if `triage.sh` flags engine changes (`packages/engine*`) or wire/API schema changes,
because a deterministic engine change affects every client. If Boss rushes past a gate, push back
once (risk and rule), then follow Boss and log `Override: <gate> - Boss: <reason>` in the release
record and the vault.

## Phase 0: triage (read-only)

1. `bash .claude/skills/ht-upstream-sync/scripts/triage.sh [tag]` (default: newest stable tag). It only runs `git fetch upstream`.
2. Read the upstream changelog/news for the target tag. Judge: is it noticeable? Does it fix or break something for us?
3. Give Boss a brief of at most 10 lines: target tag, commits taken, conflict count (and any not in `FORK_CHANGES.md`), lane and why, risks, recommendation (sync now / wait for next tag). **Wait for Boss's approval** before Phase 1.

## Phase 1: merge

1. Clean tree on `main`, `git fetch upstream --tags`, `git switch -c sync/upstream-YYYY-MM-DD main`.
2. `git merge <tag>` (a stable tag, not `upstream/main`). Resolve conflicts per `references/conflicts.md`.
3. `npm run inst` (the lockfile may have changed), then `npm run typecheck`, `npm run lint`, `npx prettier --check` on touched files.
4. Run **targeted** tests for touched areas (`npx vitest <file> --run`). Fix tests by updating them, never by weakening assertions. If a bad merge gets tangled, `git merge --abort` or delete the branch; main is untouched.

## Phase 2: post-merge checklist

- New files under `.github/workflows/` arrive enabled: `gh workflow disable <name> -R Gamble-Limited-Ltd/hostile-takeover` for each (only `ht-ci.yml` and `ht-upstream-watch.yml` run).
- `resources/news.json` / `changelog.md`: strip store, Discord and paid-feature links. Rebrand new "OpenFront" strings in `en.json` (names only).
- New entry points for the store, ads, Turnstile, Steam, CrazyGames or other logins: hide them (see conflicts.md). New upstream screens count.
- `src/server/Censor.ts` changed: mirror into `packages/api/src/censor.ts` (parity test in `tests/api/Routes.test.ts`).
- API contract: diff `/users/@me`, the JWT, `cosmetics.json` and `cluster.json` schemas under `packages/shared/src` and update `packages/api` to match. `/users/@me` parses strictly, so one bad field shows players as signed out.
- `tests/LayerBoundaries.test.ts` still passes; add the API package allowance back if a merge dropped it.
- Update `FORK_CHANGES.md` (new/changed/dropped edits) in the same merge. Update `CLAUDE.md` if a rule or command changed.

## Phase 3: verify

1. Push the `sync/` branch (after Boss's OK). Wait for `ht-ci.yml` green (typecheck, lint, Prettier, 4 test shards plus `tests/server`).
2. **Smoke test** with the `run-openfront` skill: lobby loads, singleplayer starts and plays a few ticks, a multiplayer join works, sign-in works. For a Major, also a longer game and a replay of determinism-sensitive paths.
3. **Screenshots, minimal:** only if the diff touches the UI (the triage "UI changed" line is a hint, but judge by what really renders). Take a few core screens (home/lobby, sign-in modal, in-game HUD) and compare with the previous prod look under the strict UI rules. Skip them otherwise.
4. Lane gates from the release procedure, then a release record: lane, what changed, player note, known issues, kill switches, **rollback sha and the exact rollback command**.

## Phase 4: ship and watch

1. With Boss's go, `git switch main && git merge --no-ff sync/upstream-YYYY-MM-DD`, push `origin main`.
2. Paste the exact deploy command and the rollback command (real sha, paths, `cd`) for Boss, per `docs/Deploy.md` and `docs/HT-RUNBOOK.md`.
3. Watch period (24 h Minor, 72 h Major): error logs, player reports, health. No other non-hotfix deploy until it ends without a new P0/P1.
4. Same commit as the merge or right after: player changelog, vault handoff and Work Log, an entry in `references/sync-log.md`, and the company site (`cd ~/gll-site && ./deploy.sh`, check `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8480/` is 200, tell Boss).

## Giving back

An engine fix worth upstreaming goes on its own branch off `upstream/main` with none of our fork changes, then a PR to `openfrontio/openfrontio`. Never mix it into a sync.
