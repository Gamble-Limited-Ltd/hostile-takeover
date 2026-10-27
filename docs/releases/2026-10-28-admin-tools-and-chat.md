# Release record: HT Minor, admin tools and in-game chat (planned 2026-10-28 or later)

```
Release: in-game chat (Global + Alliance), root moderation tools, root bot takeover.
  Slices at.0-at.6 and at.8 (browser-test fixes) on main; at.7 (legal, changelog, this record).
Lane: Minor (new wire messages, an engine change, migration 009, ToS/privacy change).
  Boss deploys with up (~/updates/ht-admin-chat.md). Claude does not deploy.
What changed:
  - Chat: its own wire messages, never an intent or in the Turn. 200 chars, 5 msgs/10 s, bad
    words masked, 50-message in-memory buffer per game. Alliance chat is filtered on each client
    (documented leak). Reports store the server's copy of the message for 30 days.
  - Moderation (root only, every action in admin_audit): timed/permanent bans (refused at sign-in,
    refresh, /users/@me and game join), chat mute and shadow-mute, /mute /shadow /unmute /kick /say
    /endgame /unranked, site banner and maintenance mode (pauses new lobbies, fails open),
    live-games list with invisible spectating, crown badge for the root account.
  - Takeover: root spectator takes over one alive Bot/Nation per started public game through the
    admin_takeover Turn intent; the AI stops, everyone sees a feed line, the game gives no XP.
  - Migration 009: additive only (4 nullable/defaulted columns on users, 1 on games, 2 new tables).
    The old build runs on the new schema; no down migration.
  - Legal: ToS section 4 (chat rules, admin presence) and 6 (suspensions); privacy sections 1, 2, 4.
Gates:
  CI green on every slice (typecheck, lint, format, 4 shards + server, real-Postgres API, prod build) [x]
  Determinism suite: live vs replay-from-0 vs snapshot after/before takeover, equal hashes [x]
  Browser test on dev (2026-10-27): crown, admin cards, chat, spectate, root commands, reports,
    /endgame [x]; 4 bugs found and fixed in at.8 with failing tests first [x]
  Takeover re-test in the browser after the at.8 view fix [x] (both clients: Human, root's
    clientID and name; root HUD and feed line; no desync)
  Migration 009 applied on dev DB 5436 [x]; rehearsal on a copy of the prod schema [ ] (additive DDL,
    low risk; Boss may accept dev-only)
  Boss reviews the ToS/privacy diff [x] (approved 2026-10-27)
  Zero open P0/P1 [x]
Known issues:
  - Alliance chat leak to modified clients (accepted). Alliance visibility uses the alliance state
    when the message arrives.
  - Client-side mute is by display name.
  - Live-games card shows 0 bots (the server has no sim); root picks the bot in game.
  - Root's winner vote after a takeover is not checked; the whole game is unranked anyway.
  - The takeover feed line uses the alliance-accepted message style.
  - After a takeover the map name label may keep the bot's name (leaderboard, panel and feed
    show root's name). Cosmetic, follow-up.
  - Not re-checked in the browser (covered by unit tests): late joiner after takeover, the
    maintenance toast when hosting, the /endgame alert.
  - Roster crown and map-label crown deferred (wire header limit, WebGL atlas glyph).
Kill switches: HT_CHAT=off (server), Features.chat; HT_ADMIN_TAKEOVER=off, Features.adminTakeover;
  maintenance mode itself.
Watch period: 24 h (desync reports, chat_error rates, ban/mute audit rows, API 5xx).
Schedule: daytime Chicago only (no deploy 10 pm - 7 am), 1 non-hotfix deploy that day.
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh 907f8fb879f7bde5cb5b5a7e00dd71465c598258
```
