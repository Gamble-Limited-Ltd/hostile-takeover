# Stage 6 — Playtest and harden

**Goal:** a session with 4–8 real friends runs without anything breaking, and the problems found
get fixed.

---

## Slice 6.1 — Pre-playtest checklist (main session, with Sonnet fixing)

- Full `npm test` is green, with no known flakes left.
- Load check: 8 browser clients plus nations in one lobby on the prod stack. Watch CPU and RAM next to
  GLL and Meridian (the VM's load average is already 4–6), and set container CPU and memory limits if needed.
- Abuse basics: the login and register rate limits work, a non-`@kmlhs.org` email is refused, the 13+ box
  is required, and a deleted account can't refresh.
- Security pass (the `/security-review` skill) over `packages/api` and the auth changes.
- **`sec/deps-hardening` is merged into `main`** (owner, 2026-10-12: must land before people play). It bumps
  vulnerable dependencies (`npm audit fix`: proxy-addr, compression, ip-address, dompurify, undici) and guards
  `deepAssign` against prototype pollution. Merge `main` into it, get CI green, then merge it. It touches
  `package-lock.json`, so do it after Stage 3 lands and re-run `npm run inst` locally afterwards.

## Slice 6.2 — Playtest (owner and friends)

- The owner runs a session and collects bugs and feedback (a doc or a channel). The main session sorts
  them into fix now, later, or upstream.

## Slice 6.3 — Fix round (Sonnet slices, as briefed after the sort)

## Slice 6.4 — First upstream sync (main session and Sonnet)

- Run the "Syncing with upstream" procedure from `CLAUDE.md` once for real, to prove it works,
  and adjust the procedure based on what hurt.

## Later (not planned yet)

- Our own XP and level system and a simple leaderboard (needs a results table, which changes the
  "no game records" decision).
- Optional email for password resets.
- Moderation tools for `root`: kick and ban are already in the game, so check that they work with our JWTs.
