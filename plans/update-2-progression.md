# Update 2 — Progression (XP, levels, profile, leaderboard)

**Status:** Planned 2026-10-24. Waiting for Boss to approve the brief. Nothing here is built yet.
**Lane:** Minor (new migration, new stored data, legal change): CI + targeted tests + a migration
rehearsal on a throwaway stack, then a **24 h watch**.
**Ships after:** the daily rotation (live Mon 2026-10-26) and the v0.35.3 watch (ends ~2026-10-27).
**Target:** Thu 2026-10-29 or Fri 2026-10-30, daytime Chicago. The date moves with the work (Boss,
2026-10-24): slices land as time allows, and the release goes out once every slice is green.

**Goal:** players earn XP from finished games, level 1 to 100, and see their level in lobbies, in game,
on the win screen, in the account menu and on a public profile. The leaderboard ranks by XP, wins,
games and win rate. Players can change their username and save their flag to the account. Root can
view and fix anyone's XP. Almost all of the UI is upstream's, hidden by Slice 3.5; we build the API
behind it and turn the switches on.

**Exit test:** two accounts finish a multiplayer game. Both see the XP breakdown on the win screen,
their new level in the nav menu and lobby, each other on every leaderboard tab, and each other's
profile (stats per mode, level bar, join date, flag). A singleplayer game gives half XP. A rename
shows everywhere after reload. Root fixes one player's XP and it appears in `admin_audit`.

---

## Decided (owner, 2026-10-12)

| Area       | Decision                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Prestige   | Levels 1-100 now. Keep a `prestige` column (always 0). `canPrestige` is always false and `POST /users/@me/prestige` stays a 404     |
| XP sources | Multiplayer (public and private), reported by the game server with the API key. Singleplayer at **half XP, no daily cap**           |
| Storage    | Per-game summaries (`games`, `game_players`), no turns, no replays. Reverses "no game records"                                      |
| XP rules   | Played + time alive, placement + win, first game of the day, feats. Leaving early while alive forfeits played, placement and win XP |
| Pace       | A regular player reaches level 100 in about **300 games**                                                                           |
| Rewards    | Levels are a badge only. No Caps, Plutonium, flares or cosmetics                                                                    |
| Old games  | No backfill. Everyone starts at level 1                                                                                             |

## Decided (owner, 2026-10-19)

| Area             | Decision                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope            | XP + levels **plus** profile page, username change, profile flag, admin XP tools, leaderboard tabs. Out: achievements, prestige, game history, friends, clans |
| Private farming  | A private game with fewer than 3 humans scores at 500 permille, like singleplayer                                                                             |
| Feats            | Most territory at the end, eliminated a player, survived to the end. 5 XP each (cap 15). No nuke feat                                                         |
| Visibility       | No opt-out. Every account is on the leaderboard and has a public profile                                                                                      |
| XP numbers       | As proposed below, **after a simulation** that checks the ~300-games pace                                                                                     |
| Profile page     | `Features.profile` on: stats per mode (Singleplayer/Public/Private), level + XP bar, join date. No recent-games list                                          |
| Opening profiles | From a leaderboard row, the lobby roster and the win screen                                                                                                   |
| Username change  | `Features.usernameChange`. Once per 7 days, censor + uniqueness checks, old name freed at once. Root renames anyone any time. Never pushed to GATE            |
| Profile flag     | A signed-in player's flag pick is saved to the account and shown on the profile and leaderboard rows                                                          |
| Admin XP         | Root views, fixes or resets a player's XP from the admin tools; each change goes to `admin_audit`                                                             |
| Leaderboard tabs | Level/XP, Wins, Games played, Win rate (minimum 10 games)                                                                                                     |

## Decided (owner, 2026-10-24)

| Area           | Decision                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Release cut    | One release with the full scope; the date moves with the work                                                                |
| Provisional XP | Skipped. The config never publishes `formula`/`xp`, so the win screen waits for the server's number (no client formula copy) |
| Reward track   | Hidden. The Progression tab shows the level and XP bar only (passed levels would read as "claimed" with no rewards)          |
| Target         | Thu 2026-10-29 / Fri 2026-10-30, Minor lane                                                                                  |

---

## What already exists (reuse, don't rebuild)

- **Client UI** behind `Features.xp` / `profile` / `leaderboard` / `usernameChange` (`src/client/Features.ts`;
  every gate is ours, listed in `FORK_CHANGES.md` Slice 3.5): badges (`LobbyPlayerView`, `PlayerPanel`),
  win-screen XP panel + polling (`WinModal`, `ProvisionalProgress.ts`), nav menu level and "Change
  username" (`NavAccountMenu`), `AccountModal` Progression tab, `PlayerProfileModal`, `ChangeUsernameModal`,
  `LeaderboardModal` + `LeaderboardPlayerList` (shows level badges when rows carry `level`).
- **In-game badges** come from `src/server/LevelBadge.ts`, which reads `/users/@me` `progress`. No work.
- **Contract (don't edit):** `packages/shared/src/ApiSchemas.ts`: `ProgressSchema` :146, `XpBreakdownSchema`
  :196, `GameXpResponseSchema` :271, `PublicProgressSchema` :280, `ProgressionConfigSchema` :387,
  `PlayerProfileSchema` :1158, `PublicPlayerGamesResponseSchema` :1216, `PutUsernameResponseSchema`,
  `RowLevelFields` :340, `UserMeResponse.player.progress` :574.
- **Client calls our API must answer:** `GET /users/@me/xp/:gameId` (404 = keep polling),
  `GET /public/progression/config` (404 = progression off), `GET /public/player/:id/progress`,
  `GET /public/player/:id`, `GET /player/:id` (auth), `GET /public/player/:id/games`,
  `PUT /users/@me/username`.
- **Trusted results:** `src/server/Archive.ts` POSTs `{info: GameEndInfo, ...}` to `POST /game/:id` with the
  API key after the winner vote. `info.players[].persistentID` is the JWT `sub`.
- **Singleplayer:** `src/client/LocalServer.ts` POSTs a gzipped record with a Bearer token to
  `/archive_singleplayer_game`. Forgeable, hence half XP.
- **API plumbing:** `authenticate()` (`app.ts:206`), `requireApiKey()` (`apiKey.ts`), root check pattern
  (`accountRoutes.ts:225`), `store.logAdmin()` (`store.ts:450`), `RateLimiter` (`rateLimit.ts`),
  `buildUserMe` (`userMe.ts`), censor (`censor.ts`), `AdminResetCard.ts` (pattern for the admin XP card).
- **Footguns:** `gameRoutes.ts` ends with a catch-all 404, so new routes mount **before**
  `mountGameRoutes`. Every new `Store` method also needs a `tests/api/memoryStore.ts` version.
  `/users/@me` is parsed strictly: one bad field signs the player out. Don't send `levelHidden` or
  `searchHidden` (no opt-out, and sending them shows the privacy card). Send no `rewards`.

## XP numbers (locked 2026-10-24 by Boss after the U2.1 simulation: 10% win rate 348 games to 100, 25% 277, 40% 248; test band 240-360)

- **Curve:** `xpToNext(level) = 100 + 4 * (level - 1)`. 1 to 100 = 29,304 XP.
- **Per game:** played 20; 3 per minute alive (cap 60); placement up to 30 (last 0, first 30); win 50 in
  FFA, 35 per winning-team member; first game of the day +50 (America/Chicago day); feats 5 each, cap 15.
- **Multipliers (`gamePermille`):** 1000 multiplayer; 500 singleplayer and private games with < 3 humans.
  `subscriberPermille` always 1000.
- **Not eligible** (`eligible: false`): shorter than 2 min (`too_short`), no account (`no_account`),
  spectators, and multiplayer records with `statsAgreed === false` (`stats_disputed`).
- One versioned rules module; each award stores its breakdown and rules version.

---

## Slices

Each lands as `slice/u2.<n>` (Sonnet implements and hands back uncommitted; Opus reviews, commits, merges
on green CI). At most 2 in flight. U2.1-U2.3 run in order; after U2.3, the rest can pair up.

### U2.1 — XP rules + simulation (Sonnet, pure, no DB)

- `packages/api/src/xp/rules.ts`: curve, `scoreGame(record, player, ctx) -> XpBreakdown`, `applyXp(progress, total)`
  with `levelsReached`. No DB, no I/O.
- `tests/api/XpRules.test.ts`: unit cases (leave-early forfeit, team win, permille, caps, level-up over
  several levels, level 100 stops) plus the **simulation**: typical game mixes (win rates 10-40%, 8-25 min
  games, ~1 game in 4 first-of-day) assert 250-350 games to level 100. Print the table.
- **Gate:** Boss OKs the numbers from the printed table before U2.2 merges.

### U2.2 — Migration 007 + scoring (Sonnet)

- `packages/api/migrations/007_progression.sql` (one migration for the whole update):
  `games`, `game_players` (placement, won, time alive, left early, feat flags, mode bucket
  `singleplayer|public|private`), `user_progress` (prestige 0, level, xp_in_level, lifetime_xp, last_xp_day),
  `xp_awards` (unique game+user, rules version, breakdown jsonb, before/after), and on `users`:
  `flag text`, `username_changed_at timestamptz`.
- `POST /game/:id` (API key): parse `GameEndInfo`, insert summary, score and award in **one transaction**,
  idempotent on game id. Verify first how `persistentID` maps to `users.id` (UUID vs base64url).
- `/archive_singleplayer_game`: require Bearer JWT; credit only the caller whose `sub` matches the record's
  player; plausibility checks (duration, turns, unused game id); 500 permille.
- Tests: idempotency, unknown player, malformed record, disputed stats, forged singleplayer `sub`, real-DB
  run (`HT_TEST_DB=1`). Update `Routes.test.ts:265` expectations.

### U2.3 — Read endpoints (Sonnet)

- `/users/@me` `player.progress` (`ProgressSchema`), checked against the strict client parse.
- `GET /users/@me/xp/:gameId`, `GET /public/progression/config` (curve only, no `formula`/`xp`/rewards),
  `GET /public/player/:id/progress`, `GET /public/player/:id` + `GET /player/:id` (`PlayerProfileSchema`:
  createdAt, stats per mode bucket, flag), `GET /public/player/:id/games` returning `{results: [], nextCursor: null}`.
- Prestige stays unmounted. Tests parse every response with the shared schema.

### U2.4 — Turn the UI on (Sonnet, screenshots)

- `Features.ts`: add `prestige` and `achievements` (false) and move those gates (including SOLO achievements);
  turn on `xp` and `profile`. Hide the reward track in the Progression tab.
- Profile links: leaderboard row (exists), lobby roster (`LobbyPlayerView`) and win-screen player names. Smallest
  edit that opens `player-profile-modal` via `whenModalLoaded`.
- `en.json`: only our ineligible reasons. Update `FORK_CHANGES.md` and `tests/client/FeaturesHidden.test.ts`.
- Screenshots of every gated spot next to upstream (`run-openfront` skill).

### U2.5 — Leaderboard (Sonnet, screenshots)

- API: `GET /public/leaderboard/players?sort=xp|wins|games|winrate&page=` (win rate needs 10+ games), rows with
  level fields and flag. Schema in a new fork-only file under `packages/shared/src/`.
- Client: four tabs in `LeaderboardModal` reusing `LeaderboardPlayerList`; ranked/clan/tribe tabs stay hidden.
  `Features.leaderboard` on. Record in `FORK_CHANGES.md`.

### U2.6 — Username change (Sonnet)

- `PUT /users/@me/username` (`PutUsernameResponseSchema`): censor + uniqueness, 7-day limit via
  `username_changed_at`, old name freed at once, rate limited, never sent to GATE. Root bypasses the limit.
- New tokens carry the new name (check refresh path and game-server join). `Features.usernameChange` on.

### U2.7 — Profile flag (Sonnet)

- `PUT /users/@me/flag` (validated against the known flag list). Client: when signed in, `UserSettings.setFlag`
  also saves it; on load the account flag wins. Shown on profile and leaderboard rows.

### U2.8 — Admin XP (Sonnet)

- `GET /admin/users/:username/progress`, `POST /admin/users/:username/progress` (`set` lifetime XP or `reset`),
  root only, each change via `store.logAdmin()`. A card next to `AdminResetCard` reusing its markup.

### U2.9 — Legal, docs, release record (Opus)

- `resources/public/privacy-policy.html:179` and ToS: we store per-game results and the profile flag, public on
  the profile and leaderboard, deleted with the account (check `DELETE /users/@me` cascades). Boss reviews.
- `CLAUDE.md` decisions table ("Game records" -> per-game summaries), `plans/README.md`, `resources/changelog.md`,
  release record in `docs/Deploy.md`, vault, then the company site redeploy.

### Release

- Rehearse on a throwaway stack: back up, run migration 007 on a copy of the prod schema, score a game.
- Boss runs `./ht-backup.sh` then `./ht-deploy.sh` (exact commands + rollback sha in the release record).
- Kill switch: `Features.xp`/`profile`/`leaderboard` back to false hides the UI; scoring keeps writing harmlessly.
