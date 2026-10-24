# Update 2 — Progression (XP, levels, leaderboard)

**Status:** Prep. Waiting for the owner to approve this plan. Nothing here is built yet.

**Goal:** players earn XP from finished games, level up from 1 to 100, and see their level badge in
lobbies, in game, on the win screen and in the account menu. A leaderboard ranks players by
lifetime XP. Everything shown is upstream UI that Slice 3.5 hid. This update builds the API behind
it and turns the switches back on.

**Exit test:** two accounts finish a multiplayer game. Both see an XP breakdown on the win screen,
their new level in the nav menu and lobby, and each other on the leaderboard. Playing a
singleplayer game gives half XP. Reloading keeps everything.

---

## Decided (owner, 2026-10-12)

| Area        | Decision                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope       | XP + levels and an XP leaderboard. **Not in this update:** profile/stats page, game history, achievements, prestige, ranked                                                                                             |
| Prestige    | Levels 1–100 now. The data model keeps a `prestige` column (always 0) so prestige can follow as a small update. `canPrestige` is always false and `POST /users/@me/prestige` stays a 404                                |
| XP sources  | Multiplayer (public and private lobbies), reported by the game server with the API key. Singleplayer too, at **half XP, with no daily cap**                                                                             |
| Storage     | A per-game summary: one `games` row and one `game_players` row per account player (placement, won, time alive, left early, the stats feats need). No turns and no replays. This reverses the "no game records" decision |
| XP rules    | Played + time alive, placement + win, first game of the day, feats. Leaving early while still alive forfeits the played, placement and win XP (upstream's rule, already in `XpBreakdownSchema`)                         |
| Pace        | A regular player reaches level 100 in about **300 games**                                                                                                                                                               |
| Leaderboard | One tab ranked by lifetime XP, reusing the existing player list: rank, name, level, games, wins, win rate                                                                                                               |
| Rewards     | Levels are a badge only. No Caps, Plutonium, flares or cosmetics (the store is gone)                                                                                                                                    |
| Old games   | No backfill. Records were never stored, so everyone starts at level 1 on launch day                                                                                                                                     |

## Decided (owner, 2026-10-19): next update's scope

These widen and override the 2026-10-12 scope above where they conflict. Size and date are open:
the owner is still collecting what goes in.

| Area              | Decision                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope             | Update 2 **plus the profile page**, username change, profile flag, admin XP tools, and more leaderboard tabs. Still out: achievements, prestige, game history, friends, clans                  |
| Upstream          | Merge the latest stable tag (`v0.35.3` today) **first**, then build the features on top. The triage runs later in the week                                                                     |
| Private farming   | A private game with fewer than 3 humans scores at 500 permille, like singleplayer (answers open question 2)                                                                                    |
| Feats             | Most territory at the end, eliminated a player, survived to the end. 5 XP each, so the cap is 15 (answers open question 1; no nuke feat)                                                       |
| Visibility        | No opt-out. Every account is on the leaderboard and has a public profile, `thestrongest` too (answers open question 4)                                                                         |
| XP numbers        | As proposed above, **after a simulation** of the curve and per-game XP that checks the ~300-games-to-100 pace                                                                                   |
| Profile page      | Turn on `Features.profile`. It shows stats per mode (Singleplayer/Public/Private), the level + XP bar (read-only for other players) and the join date. No recent-games list                    |
| Opening profiles  | From a leaderboard row, the lobby roster and the win screen                                                                                                                                    |
| Username change   | `Features.usernameChange`. Once per 7 days, with the censor and uniqueness checks. The old name is free right away. Root can rename anyone at any time                                                 |
| HT vs GLL ID      | HT username and display name belong to HT, and changing them never touches GATE. Email/password stay with GATE for linked accounts and with HT for legacy ones. Every change must be possible inside HT |
| Profile flag      | When a signed-in player picks a flag, it's saved to the account and shown on the profile and on leaderboard rows                                                                                  |
| Admin XP          | Root can view a player's progress and fix or reset their XP from the admin tools, and each change is written to `admin_audit`                                                                                |
| Leaderboard tabs  | Level/XP, Wins, Games played, Win rate (with a minimum of 10 games)                                                                                                                            |
| Migration number  | `004`/`005` are taken by GLL ID, so the progression migration is `006_progression.sql`                                                                                                     |

## What already exists (don't rebuild)

- **Client UI, hidden behind `Features.xp`:** level badges (`LobbyPlayerView`, `PlayerPanel`,
  `LobbyRosterLevels`), the win-screen XP panel and its polling (`WinModal`), the nav-menu level
  (`NavAccountMenu`), the level card and prestige flow in `AccountModal`, and `ProgressionApi.ts`. The
  full list is in `FORK_CHANGES.md` under Slice 3.5.
- **Contract:** `packages/shared/src/ApiSchemas.ts` has `ProgressSchema`, `XpBreakdownSchema`,
  `GameXpResponseSchema`, `PublicProgressSchema`, `ProgressionConfigSchema` and the `progress` field
  on `/users/@me`. Our API answers in exactly these shapes. **Don't edit them.**
- **Trusted results:** the game server already POSTs a full `GameRecord` to `POST /game/:id`
  (`src/server/Archive.ts`) once the winner vote settles (or the replay settles a dispute). Each
  player's `persistentID` is their JWT `sub`, so it maps straight to `users.id`. Today
  `gameRoutes.ts` throws it away.
- **Singleplayer:** the browser POSTs its record to `/archive_singleplayer_game`
  (`src/client/LocalServer.ts`). Today that's a no-op. It can be faked, which is why it gets half XP.

## Proposed numbers (owner to confirm or tweak)

These live in one versioned rules module, and `GET /public/progression/config` publishes the curve.
Each game stores its breakdown under the rules version it was scored with.

- **Curve:** `xpToNext(level) = 100 + 4 × (level − 1)`. Level 1→2 takes 100 XP (about one game) and
  99→100 takes 492 (about five games). Reaching 100 takes 29,304 XP, about 300 games at ~100 XP each.
- **Per game** (before multipliers):
  - Played: 20 for finishing.
  - Time: 3 per minute alive, capped at 60 (20 minutes).
  - Placement: up to 30, scaled from last place (0) to first.
  - Win: 50 in FFA, 35 for each member of the winning team.
  - First game of the day: +50 (by the VM's day, America/Chicago).
  - Feats: up to +20 in total, chosen from `PlayerStatsSchema` (see open questions).
- **Multipliers (`gamePermille`):** 1000 for multiplayer and 500 for singleplayer.
  `subscriberPermille` is always 1000.
- **Not eligible** (`eligible: false` with a `reason`): games shorter than 2 minutes (`too_short`),
  players without an account (`no_account`) and spectators.

---

## Slices

These run in order because they share the schema and the `/users/@me` contract. Each one lands as
`slice/u2.<n>` with the usual CI gates.

### Slice U2.1 — Store game summaries (Sonnet)

- Migration `004_progression.sql`:
  - `games`: id (the game id), type, mode, map, started/ended, duration, winner, `source`
    (`server` | `singleplayer`).
  - `game_players`: game id, user id, placement, won, time alive, left early, and feat stats.
  - `user_progress`: user id, prestige (0), level, xp in level, lifetime xp, `last_xp_day`.
  - `xp_awards`: game id, user id, rules version, breakdown JSON, before/after position. Unique on
    (game, user).
- `POST /game/:id` (API key) parses the record, stores the summary and skips players with no
  account. It's idempotent: a repeated POST for the same game changes nothing.
- `GET /game/:id` stays as it is (no replays).
- Tests: idempotency, unknown `persistentID`, a malformed record, and the real-DB job.

### Slice U2.2 — XP rules (Sonnet)

- `packages/api/src/xp/`: a pure module (curve, rules, breakdown), with no DB access and fully
  unit-tested. It returns `XpBreakdown`-shaped output.
- Awarding runs in the same transaction as U2.1's insert, so XP is applied exactly once per (game,
  user), and level-ups fill `levelsReached`.

### Slice U2.3 — Progression endpoints (Sonnet)

- `/users/@me` gets `progress` (`ProgressSchema`). Check it against the strict parse.
- `GET /users/@me/xp/:gameId`: 404 until processed, then eligible or ineligible.
- `GET /public/player/:publicId/progress` and `GET /public/progression/config` (curve only, with no
  caps, plutonium or flares).
- `POST /users/@me/prestige` stays unmounted (404).

### Slice U2.4 — Singleplayer XP (Sonnet)

- `/archive_singleplayer_game` requires the caller's Bearer JWT. It only credits the caller, and
  only when the record's player `persistentID` matches the JWT `sub`.
- Sanity checks: the duration and turn count must be plausible and the game id unused. Then it
  scores at `gamePermille` 500.

### Slice U2.5 — Turn the UI back on (Sonnet, screenshots)

- Split `Features.xp` so levels can be on while these stay off: add `prestige` and `achievements`
  switches. The SOLO achievements toggle moves under `achievements`. Record the change in
  `FORK_CHANGES.md`.
- Turn `xp` on. Then check every gated spot: badges, win-screen panel, nav menu, account level card
  (with no prestige button).
- Follow the strict UI rules: screenshot each screen next to its upstream look. The only new
  strings are for our ineligible reasons (`too_short`, `no_account`), in `en.json`.

### Slice U2.6 — XP leaderboard (Sonnet, screenshots)

- API: `GET /public/leaderboard/xp`, with a page of the top players by lifetime XP.
- Shared: a new fork-only schema file (don't change `PlayerLeaderboardEntrySchema`, whose `elo` is
  required).
- Client: `LeaderboardModal` gets one "Levels" tab that reuses `LeaderboardPlayerList`, with the
  level in place of Elo. The ranked, clan and tribe tabs stay hidden. Turn `Features.leaderboard`
  back on with only that tab. Keep the edit small and record it in `FORK_CHANGES.md`.

### Slice U2.7 — Legal and docs (Opus writes the legal text)

- Privacy policy: we now store per-game results (placement, wins, time played) tied to the account.
  They're deleted along with the account.
- `CLAUDE.md` decisions table: "Game records" changes to "Per-game summaries stored; no replays".
- `plans/README.md`: mark Update 2 in progress, then done.

### Deploy

- `./ht-deploy.sh` runs migration 004. Back up the DB first. The deploy needs the owner's go.

---

## Open questions (before U2.2 starts)

1. **Feats:** which ones? Proposed: most territory at the end, eliminated another player, launched a
   nuke that landed, and survived to the end. 5 XP each, up to 20 in total.
2. **Private-lobby farming:** two friends in a 2-player private lobby earn full XP. Proposed: a
   private game with fewer than 3 humans scores at 500 permille, like singleplayer. Or leave it
   alone and trust the group?
3. **Profile page:** you said "xp/profile" but didn't pick the profile page for this update. Is it
   meant for a follow-up (Update 2b: stats tab, game history, clicking a name), or should it come in
   now?
4. **Leaderboard visibility:** everyone with an account is listed, including `thestrongest`. Should
   there be an opt-out?
