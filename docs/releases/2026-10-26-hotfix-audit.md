# Release record: HT hotfix, audit fixes (2026-10-26)

```
Release: GATE link and account security fixes. Branches fix/audit-s1-auth and fix/audit-s2-abuse.
Lane: Hotfix (security: an unverified legacy account could be taken over through the GATE
  "Continue as" link). Boss said hotfix; Claude deploys only after Boss's `go`.
What changed:
  - /auth/gate/link/confirm no longer links an old account without its password (403 password_required);
    the client then shows the old-password form.
  - Password reset spends the token and sets the password in one transaction; disabled accounts cannot reset.
  - GATE id_token no longer stored; migration 008 sets stored tokens to NULL (data only, not reversible,
    harmless to old code). Local email is set once at link time.
  - Singleplayer records older than 24h are refused; 25 singleplayer games per user per UTC day.
  - /auth/refresh swaps sessions in one statement; login limiter keyed on account+IP; per-username
    register limiter removed; rate-limit map capped at 10k; leaderboard cached 45 s.
Gates: tests/api with HT_TEST_DB=1 on dev DB 5436 + GATE client tests 499/499 [x]  typecheck/oxfmt/eslint [x]
  new tests fail without their fix (checked) [x]  Opus review [x]  zero open P0/P1 [x]
  Not run: full e2e; golden path on dev (sign in with GLL ID, link with password) [ ] run before deploy.
Player note: matches resources/changelog.md.
Known issues: 25/day cap lock is per process (single API container today); a GATE email change no
  longer updates the local email; leaderboard up to 45 s stale.
Kill switches: none new. Legacy register can be stopped by taking /auth/register out at nginx if needed.
Watch period: 2 h
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh 6544ea29ac43304a33ae51f0526d052ae84dffbd
```
