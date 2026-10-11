# Hostile Takeover — build plan

Stages run in order. No stage starts until the owner approves it. Each stage file is
written as a set of **slices**: self-contained briefs a Sonnet agent can pick up and finish.

| #   | Stage                                       | Goal                                                                                              | Status            |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | [API foundation](stage-1-api-foundation.md) | Our own API package, Postgres on 5436, real JWTs. A seeded dev user can play a game               | Awaiting approval |
| 2   | [Accounts](stage-2-accounts.md)             | Sign-up, login, logout, admin password reset, delete account, using the existing UI               | Awaiting approval |
| 3   | [Strip](stage-3-strip.md)                   | Remove Turnstile, other logins, store/Stripe, ads, telemetry; hide XP and other API-only features | Awaiting approval |
| 4   | [Brand and legal](stage-4-brand-legal.md)   | Rebrand, NOTICE, attribution, our ToS and privacy policy                                          | Awaiting approval |
| 5   | [Deploy](stage-5-deploy.md)                 | Compose stack on this VM behind cloudflared, backups                                              | Awaiting approval |
| 6   | [Playtest and harden](stage-6-playtest.md)  | Real friends in real games; fix what breaks                                                       | Awaiting approval |

Rough effort: 6–9 working days in total. Stage 1 is the biggest unknown.

## How the work runs (agent roles)

- **Main session (Opus):** plans, decides, writes the brief for each slice, approves finished
  work (a sign-off plus the gates below, not a line-by-line review), and commits. It
  doesn't implement.
- **Sonnet 5.5 agents:** implement each slice, including the core work. They read `CLAUDE.md`
  and `FORK_CHANGES.md` first, check their own work (tests, typecheck, lint, re-reading the diff)
  and hand it back **uncommitted**.
- **Haiku 5.5:** works for Sonnet on small mechanical tasks only (renames, string edits, moving test
  fixtures). Sonnet approves Haiku's output with a sign-off rather than a full review, and
  fixes anything it spots.
- Slices that touch the same files, DB schema or `/users/@me` contract run **one after another**.
  Others can run in parallel (in worktrees where they might collide).

## Gates every slice must pass before approval

1. `npm run typecheck` is clean, and `npm run lint` is clean on the changed files.
2. `npm test` passes, apart from the known flaky `InventoryModal` timeouts (until Stage 3 removes them).
3. Every OpenFront file the slice edited is recorded in `FORK_CHANGES.md`.
4. UI slices: screenshots of the new or changed screen next to the nearest existing screen
   (the STRICT UI rules in `CLAUDE.md`).
5. Dev still comes up on 3400/5178 (and 8787/5436 once the API exists) and doesn't touch GLL or Meridian.

## Decided (don't re-ask)

Everything in the Decisions table in `CLAUDE.md`, plus:

- **XP, levels, prestige, achievements, ranked, leaderboards, clans and friends are hidden** for
  v1 (their entry points come out, the modules stay). We may build our own XP later.
- **API stack:** a new workspace package `packages/api` (`@hostile-takeover/api`), using Express,
  `pg`, `jose` (already a dependency) and `@node-rs/argon2` (prebuilt binaries, so it works with
  `npm ci --ignore-scripts`). Migrations are plain numbered `.sql` files with a small runner,
  and no ORM.
- **Single server:** one game server (instance letter `a`, 2 workers). `cluster.json` and
  `/cluster/checkin` always answer "open" for it.
