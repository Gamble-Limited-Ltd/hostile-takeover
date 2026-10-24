# Upstream sync — OpenFront v0.35.3

**Status:** In progress on `sync/upstream-2026-10-24` (target moved to v0.35.3; merge, no push, no deploy yet). Runbook: the
`ht-upstream-sync` skill (`.claude/skills/ht-upstream-sync/`). This file is the plan for the sync that
opens next week's update, before the Update 2 features are built on top (see `update-2-progression.md`).

**Goal:** bring HT up to OpenFront's latest stable tag with our fork changes intact, so Update 2 builds
on current code.

**Exit test:** the merged build passes typecheck, lint and the targeted tests; a rehearsal stack signs in
(password and GLL ID), plays a multiplayer game with two clients to the end, and shows no store, ad,
Turnstile or other-login entry point. Then it survives its 72 h watch in prod.

---

## Triage (2026-10-23, read-only)

- Target **v0.35.2** (08b63c054, 2026-10-16). Merge base a15138358 (2026-10-10). 99 upstream commits to
  take, 110 of ours since the base. Commits on `upstream/main` after the tag are skipped.
- 18 predicted conflicts (16 client UI/auth/server files plus two tests). Only
  `tests/client/components/LobbyPlayerView.levelBadge.test.ts` is missing from `FORK_CHANGES.md`.
- **Lane: Major** (72 h watch, full rehearsal). Engine files changed (42, including `AttackExecution`,
  `GameRunner`, `Config`) and so did the wire/API schemas (`ApiSchemas`, `ClanApiSchemas`,
  `CosmeticSchemas`, `WireSchemas`).

## Known items to handle

| Item                                                    | Action                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AdShield re-enabled (`b8f0fca50`)                       | Hide the entry point again; check `AdGatekeeper` paths                                                   |
| Prettier replaced by Oxfmt (`48ede83b6`)                | Update `ht-ci.yml` and the `prettier --check` step in the skill to whatever the tag now uses              |
| New/changed workflows (`cherry-pick-milestone.yml`, `ci.yml`, `deploy.yml`, `release.yml`) | `gh workflow disable` each on the fork; only `ht-ci.yml` and `ht-upstream-watch.yml` run                  |
| "Kick every connected session of a kicked account"      | Check whether our API / admin tools need a matching change                                               |
| Halloween homepage theme (Oct 25 to Nov 1) and a toggle | Strip any store/Discord links; keep the toggle                                                           |
| Store/Steam/portal paths (19 files flagged)             | Re-hide new entry points; new screens count                                                              |
| Schema changes                                          | Diff `/users/@me`, JWT, `cosmetics.json`, `cluster.json`; `/users/@me` parses strictly                  |
| `src/server/Censor.ts`                                  | If changed, mirror into `packages/api/src/censor.ts` (parity test)                                       |
| `package.json` / lockfile                               | `npm run inst`                                                                                           |
| New "OpenFront" strings, `news.json`, `changelog.md`    | Rebrand in `en.json` only; strip store/Discord/paid links                                                |

## Schedule

1. **Weekend before the update:** Phase 0 brief re-run, then Phase 1 on `sync/upstream-YYYY-MM-DD`
   (merge, no push, no deploy). Fix conflicts per `references/conflicts.md`, update `FORK_CHANGES.md`.
2. **Before deploy:** Phase 3 verify (targeted tests, then CI on the pushed branch), rehearsal on a
   throwaway stack (not prod, not GLL/Meridian).
3. **Day of implementation:** re-run `triage.sh` first. If a newer stable tag landed, ask Boss whether
   to take it or stay on v0.35.3. Then the release record, and Boss gets the exact deploy and rollback
   commands in a fenced block.
4. **Deploy window:** not between 10 pm and 7 am Chicago; one non-hotfix deploy per day. The daily host
   rotation (see `daily-rotation.md`) is not a release, but it must not land the same day.
5. **Watch:** 72 h before the next non-hotfix release (Update 2 features wait for it).

## Gates

Zero open P0/P1, release record written, rollback sha recorded, docs in the same commit
(`CLAUDE.md`, `FORK_CHANGES.md`, the sync log, the player changelog, the vault). Override rule: push
back once, then log `Override: <gate> — Boss: <reason>`.

## Decision log

| Date       | Decision                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| 2026-10-23 | Sync first, to v0.35.3 (re-check on the day). Major lane. No work starts until Boss says go.      |
| 2026-10-24 | Target moved to v0.35.3 (troop duplication fix), Boss approved. |
