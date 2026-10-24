# Conflict playbook

Default for every conflicting file: **take upstream's version, then put our `FORK_CHANGES.md` edit
back on top.** Look the file up in `FORK_CHANGES.md` first (it says what we changed and why). A
conflict in a file that is _not_ listed there means a missing record or an upstream rename: find
out which before resolving, and add the row.

Useful: `git checkout --theirs <file>` then re-apply our edit by hand (during a merge, "theirs" is
upstream), or `git diff main...<tag> -- <file>` to see upstream's change alone, and
`git log --oneline main -- <file>` for ours.

| File class                                                                                                                                                    | Rule                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI files where we hid or removed things (`AccountModal`, `Auth`, `Main`, nav bars, `GameModeSelector`, `SinglePlayerModal`, `WinModal`, `UsernameInput`, ...) | Take upstream, re-apply our edit. Re-hide any **new** store/ad/login/Turnstile/Steam entry point that came in. Keep the layout otherwise untouched (strict UI rule 3).                                                        |
| Features we removed (store, `InventoryModal`, purchase nudges, ads, telemetry, other logins)                                                                  | Keep them hidden or removed. Dead modules may stay if the build passes. Do not delete modules to resolve a conflict; hide the entry point.                                                                                    |
| `index.html`, `resources/lang/en.json`                                                                                                                        | Take upstream, re-apply branding and footer attribution ("© OpenFront and Contributors" plus our Gamble Limited line). Only `en.json` is edited, no other language files. New "OpenFront" strings get rebranded (names only). |
| `package.json`, `package-lock.json`                                                                                                                           | Take upstream's, re-add our scripts and workspace entries (API package), then `npm run inst`. Never `npm install`.                                                                                                            |
| `packages/engine`, `engine-api`, `engine-lib`                                                                                                                 | Take upstream **wholesale**. We make no fork edits to the engine. If a fork test fails because of the engine, fix the test or our code around it. Engine changes make the sync a Major.                                       |
| `packages/shared` schemas                                                                                                                                     | Take upstream, then check our API still satisfies them (Phase 2).                                                                                                                                                             |
| `src/server/Censor.ts`                                                                                                                                        | Take upstream, mirror to `packages/api/src/censor.ts`.                                                                                                                                                                        |
| `src/server/ServerEnv.ts`, env/config                                                                                                                         | Keep our env-var-with-upstream-default pattern (`MASTER_PORT`, `API_URL`, `jwtIssuer()`).                                                                                                                                     |
| `.github/workflows/*`                                                                                                                                         | Take upstream's file; then disable each new or changed one on the fork except `ht-ci.yml` and `ht-upstream-watch.yml`.                                                                                                        |
| `CLAUDE.md`                                                                                                                                                   | Keep our "Hostile Takeover" section at the top; take upstream's changes below it.                                                                                                                                             |
| Tests                                                                                                                                                         | Update the test to match the merged behaviour. Do not delete or weaken a test to go green; if a store/ad test is dead because the feature is hidden, say so in the commit.                                                    |
| `LICENSE`, `LICENSING.md`, `proprietary/`, `NOTICE`                                                                                                           | Do not edit LICENSE/LICENSING/proprietary. Keep `NOTICE` accurate.                                                                                                                                                            |

## After resolving

- `git grep -n '<<<<<<<\|>>>>>>>'` is empty.
- Typecheck, lint and the Oxfmt check clean; targeted tests for each resolved file pass.
- `FORK_CHANGES.md` updated for every file whose fork edit changed, was dropped, or is new.
- Re-check UI strict rules 1 to 5 on any resolved UI file (no new colors, fonts or nav items; strings via `translateText()`).

## When it is a mess

Stop. Do not push. `git merge --abort` (or delete the `sync/` branch) loses nothing. Re-triage and
consider syncing in stages (an earlier stable tag first), then tell Boss why.
