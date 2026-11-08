# Release record: HT Patch, legal v2 dark deploy (prepared 2026-11-08)

```
Release: legal v2 code, shipped dark behind LEGAL_VERSION (unset/empty = behaviour exactly as main).
Lane: Patch (no new systems; migration 010 is additive: one nullable column, no backfill).
  Boss deploys. Claude does not deploy.
What changed (only when LEGAL_VERSION is set on ht-api):
  - Footer, sign-up and account links point at the HALL legal pages.
  - Direct sign-up wording: "I am 18 or older, or I am at least 13 and my parent or guardian has agreed
    to the Terms of Service and Privacy Policy for me." Stored with a timestamp, not verified.
  - Local acceptance: a GATE legal_version claim equal to LEGAL_VERSION records acceptance and skips
    the prompt; otherwise the re-accept modal asks once. Password accounts always use the local path.
  - /auth/config carries legalVersion only while on.
Gates:
  Typecheck on the build PC after rebase onto main 6e633c8bf [x]
  Targeted tests (7 files, 211 tests) [x]; full suite: HT CI green on 93c8492 [x]
  Redirect sign-in with the switch on: unrehearsed (manual steps in the handoff) [ ]
Kill switch: unset LEGAL_VERSION in .env.prod and restart ht-api.
Go-live: same YYYY-MM-DD on GATE, HT, others; must differ from GATE TOS_VERSION / PRIVACY_VERSION.
Watch period: 24 h not required while dark.
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh 6e633c8bf296e06c3705a9664db52df65a73a7f4
```
