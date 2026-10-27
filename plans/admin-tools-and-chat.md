# Admin tools + in-game chat

**Status:** Approved by Boss 2026-10-27 ("approved, you may begin"), plus slice S0 (root badge). In progress:
S0 and S1. Open questions O1-O6 still default to the recommendation until Boss answers.
**Lane:** Minor (new wire messages, an engine change, migration 009, legal change): CI + targeted tests + the
determinism suite + migration rehearsal and a trial on a throwaway stack, then a **24 h watch**.
**Ships after:** Update 2 (target Thu 2026-10-29 / Fri 2026-10-30) and its 24 h watch. Never in the same release.
**Exit test:** two accounts in a public game chat on Global and Alliance (alliance hidden from a third,
non-allied player); root mutes one, shadow-mutes another, reads every channel; root opens the live-games list,
spectates invisibly, takes over a chosen nation, plays it, everyone sees the feed line, nobody desyncs, a late
spectator joining after the takeover sees the same state, and the takeover player gets no XP. Every root action
is in `admin_audit`.

---

## Context

Boss wants moderation for a 13+ school player base and a way to drop into live games. Today HT has quick chat
and emoji only (intents, in the Turn), upstream's admin kick (`kick_player`, `isAdminRole`), and no way to ban,
mute, broadcast or join a running game. This plan adds root-only tools (server-authorized, audited), free-text
chat with Global and Alliance channels (never in the Turn), and a deterministic bot takeover.

---

## 1. Findings

### What already exists (reuse)

| Need            | Existing code                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root check      | `isAdminRole(role)` (`packages/shared/src/ApiSchemas.ts:59`, `admin` or `root`); our API only ever mints `root` (`packages/api/src/tokens.ts:18`, rank `THE_STRONGEST`). Server copy: `client.role`, `GameServer.ts:812`                                                                      |
| Kick            | `kick_player` intent, admin path already in `GameServer.handleIntent` (`GameServer.ts:441`, `KICK_REASON_ADMIN`), `Roster.kick` bans the persistentID from rejoin (`Roster.ts:73`). UI: `hud/layers/PlayerModerationModal.ts`                                                                 |
| Audit log       | `admin_audit (actor, action, target, detail)` (`migrations/003_admin_audit.sql`), `store.logAdmin()` (`store.ts:160/894`)                                                                                                                                                                     |
| Account disable | `users.disabled_at` (`001_init.sql`), sessions table with `revoked_at`                                                                                                                                                                                                                        |
| Spectators      | `ClientMessage spectate`, `client.spectator`, `SocketIngress` drops `SPECTATOR_BLOCKED_MESSAGES` from spectators (`IntentAuthorization.ts:186`); joining a started game makes you a spectator (`GameServer.joinClient`, `:603-626`); admins bypass the allowlist (`passesAllowlist`, `:1312`) |
| Late join       | No snapshot over the wire: `sendStartGameMsg(ws, 0)` sends **every Turn from 0** (`ServerStartGameMessage.turns`) and the client replays them. Snapshots (`packages/engine/src/snapshot/`) exist for pause/fork/seek only                                                                     |
| Player reports  | `ClientMessage report` + `ReportReasonSchema` (`WireSchemas.ts:646`), kept out of the Turn, emitted in `info.reports`. UI `PlayerReportModal.ts`                                                                                                                                              |
| Chat display    | `hud/layers/ChatDisplay.ts` (log of `MessageType.CHAT` display messages, collapsible), `ChatModal.ts` (quick-chat picker with a text input at `:206`)                                                                                                                                         |
| Censor          | `profanityMatcher` (`src/server/Censor.ts:115`) mirrored in `packages/api/src/censor.ts` (parity test `tests/api/Routes.test.ts`)                                                                                                                                                             |
| Live games      | `GameManager.games` per worker (`GameManager.ts:32`), `publicLobbies()` (pre-start only). Admin-bot HTTP routes `AdminBotRoutes.ts` (`/api/adminbot/game/:id/roster`, `/intent`; API-key, not JWT)                                                                                            |
| Spectator UI    | `GameView.isSpectator()` = `!myPlayer()?.isAlive()                                                                                                                                                                                                                                            |     | isReplay` (`GameView.ts:863`); `ClientGameRunner`re-resolves`myPlayer`with`playerByClientID(this.clientID)` while it is null (`ClientGameRunner.ts:1251` and others) |
| Enter key       | `InputHandler.ts:812` uses Enter only while a ghost structure is placed                                                                                                                                                                                                                       |

### How bots are represented

- `PlayerType` = `Bot` (tribes, `TribeExecution`, made by `TribeSpawner` with `clientID: null`), `Nation`
  (`NationExecution`, `clientID: null`, created in `ExecutionManager:170`), `Human` (from `gameStartInfo.players`).
- `PlayerImpl.playerInfo` is a `PlayerInfo` (name, type, clientID, id, ...). `clientID()` reads it (`PlayerImpl.ts:438`).
- Every intent becomes an execution through `ExecutionManager.createExec`: `mg.playerByClientID(intent.clientID)`
  (`ExecutionManager.ts:61`); unknown client -> `NoOpExecution`. So **whoever owns the clientID controls the player.**
- Nation/Tribe AI runs as an execution that holds `this.player` and stays active while the player lives.
- Snapshot restore re-reads player info from the game's original list: `findPlayerInfo(s.info.id) ?? newPlayerInfo(s.info)`
  (`PlayerImpl.ts:2048`), so a snapshot taken after a takeover would restore the bot's old info.

### Answer: takeover is feasible deterministically

Takeover is an **intent in the Turn**, applied by every client's engine at the same tick:

1. Root spectates the game (already a connected spectator with a server-assigned clientID).
2. Root sends `admin_takeover { targetPlayerID }`. The server authorizes it (root, game started, public game,
   target is an alive `Bot` or `Nation` with `clientID === null`, sender is a spectator not already a player,
   one takeover per game), stamps it with root's clientID like any intent and adds it to the Turn.
3. `ExecutionManager.createExec` handles `admin_takeover` **before** the `playerByClientID` lookup (the sender has
   no player yet) and returns a `TakeoverExecution`, which calls a new `GameImpl.takeOverPlayer(id, clientID, name)`:
   - replaces the player's `PlayerInfo` with `PlayerInfo(name, Human, clientID, sameID, ..., nationFlag)`.
     Same `id` means the same seeded PRNG, colour and smallID;
   - emits a `displayMessage` to everyone: "{root} took over {bot}" (default yes);
   - the bot's AI stops: `NationExecution.tick` and `TribeExecution.tick` set `active = false` once
     `player.clientID() !== null` (two-line guard each).
4. Server side, on accept: `client.spectator = false` (intents now pass `SocketIngress`, root joins the winner and
   hash votes), and the game is flagged `takeover` for the archive.
5. Client side, nothing special: `playerByClientID(myClientID)` starts matching on the next update, `myPlayer`
   resolves and `isSpectator()` turns false, so the normal HUD appears.

**Late joiners** get the full Turn list from 0 and replay the same intent at the same tick: identical state.
**Snapshots:** fix `restoreSnapshot` to keep `s.info` when its clientID differs from the original (test it).
**Name/flag/stats:** name becomes root's account username (Boss can't hide behind the bot's name; the feed line says
who), flag = root's account flag, territory/colour/units/gold kept. Stats from the takeover tick on are keyed by
root's clientID. **XP:** root is not in `gameStartInfo.players`, so `GameEndInfo` never credits them; the archive
also sends `htTakeover: true` and the API stores `games.unranked_reason = 'takeover'` for the record (others keep XP;
see Open O4).
**Not feasible / out:** taking over a _human's_ player, takeover in private or singleplayer games, more than one
takeover per game, and handing control back to the AI (no clean way to rebuild the AI's internal state; the player
just goes idle like a disconnected human).

---

## 2. Slices (Sonnet implements, Opus reviews and merges on green CI; at most 2 in flight)

Order: foundation, then global chat, alliance chat, spectate-any-game, takeover, remaining admin tools.
S1 and S2 can pair; S3 needs S2; S5 needs S4.

### S0 - Root badge (Boss, 2026-10-27)

- **Scope:** a visible special badge for the `thestrongest` account (rank `THE_STRONGEST`, JWT `role: "root"`)
  in game (lobby roster, player panel, name on the map if the verified check renders there) and on leaderboard rows.
- **In game:** server-set, never client-sent. Follow the `cosmetics.verified` pattern: the worker sets
  `cosmetics.root = true` when the joining client's JWT role is `root` (`isAdminRole` is not enough: `admin` must
  not get it). The client renders it wherever the verified check renders.
- **Leaderboard:** API rows carry `root: true` for rank `THE_STRONGEST` (fork-only `HtLeaderboardSchemas.ts`);
  `LeaderboardPlayerList` shows the badge next to the name.
- **Look:** existing asset `resources/images/CrownIcon.svg` (already in the repo, CC BY-SA) at the size of the
  verified check / level badge slot, no new colours or CSS. Boss override of strict UI rule 2 (a new badge),
  logged in `FORK_CHANGES.md` like the Portfolio Stamp.
- **Failing tests first:** a root join gets `cosmetics.root`, a normal or `admin` join does not, a client-sent
  `root` is ignored; leaderboard row for `THE_STRONGEST` has `root: true`, others omit it; renders in roster,
  player panel and leaderboard row.
- **Risk:** low. Screenshots next to the verified check and level badge.
- **Built (2026-10-27, `slice/at.0`):** crown in the in-game player panel, the hover overlay and leaderboard rows
  (`src/server/Privilege.ts` `applyRootBadge`, `src/client/components/ui/RootBadge.ts`).
  **Deferred:** the lobby roster (`ClientInfoSchema` already has 8 fields, a full one-byte zbin header; a 9th field
  changes every roster frame and breaks old/new clients mid-deploy) and the on-map name label (the verified check
  is a WebGL atlas glyph). Follow-up if Boss wants them: roster via a fork-only API lookup of root usernames
  (no wire change); map label via a second atlas slot.

### S1 - Moderation foundation (API + migration 009)

- **Scope:** bans (timed/permanent, revoke sessions), chat mutes (timed, shadow), site settings (banner,
  maintenance), a game-server moderation lookup, audit ingest from the game server.
- **Add:** `packages/api/migrations/009_moderation.sql`, `packages/api/src/moderationRoutes.ts`, `tests/api/Moderation.test.ts`.
- **Change:** `store.ts` + `tests/api/memoryStore.ts` (new methods), `app.ts` (mount before `mountGameRoutes`),
  `userMe.ts`/refresh path (banned -> 403 `account_banned`, refresh refused).
- **Migration 009:** `users` + `banned_until timestamptz`, `ban_reason text`, `chat_muted_until timestamptz`,
  `chat_shadow_muted boolean NOT NULL DEFAULT false`; `site_settings (key text PK, value jsonb, updated_at, updated_by text)`;
  `chat_reports (id, game_id, reporter_id, target_id, message text, created_at)` (deleted after 30 days, cascade on user delete);
  `games` + `unranked_reason text`. Audit stays in `admin_audit` (no new table).
- **Failing tests first:** non-root 403 on every admin route; ban revokes sessions and blocks refresh and `/users/@me`;
  expired ban lets the user in; every action writes one `admin_audit` row; API-key-only routes refuse JWTs; real-DB run (`HT_TEST_DB=1`).
- **Risk:** low-medium (auth paths). A banned player's live 15-min JWT still joins: the game server also checks S1's lookup at join.

### S2 - Global chat

- **Scope:** wire messages, server relay with censor, rate limit, mute/shadow-mute, ring buffer for reconnects; client input and log.
- **Add:** `src/server/ChatRelay.ts` (ring buffer 50 messages per game, token bucket 5 msgs/10 s per client,
  censor via `profanityMatcher` with the obscenity censor, mute checks), `src/client/hud/layers/ChatInput.ts`,
  `src/client/ChatState.ts`, tests `tests/server/ChatRelay.test.ts`, `tests/client/ChatInput.test.ts`, `tests/ZbinChat.test.ts`.
- **Change (upstream, record in `FORK_CHANGES.md`):** `WireSchemas.ts` (3 schemas + 2 union entries),
  `GameServer.ts` (2 cases in `handleClientMessage`, history on join/rejoin), `ChatDisplay.ts` (also lists our
  events), `InputHandler.ts` (Enter opens chat when no ghost structure, keys ignored while typing),
  `Worker.ts` (moderation lookup at join), `en.json`, `Features.ts` (`chat`).
- **Failing tests first:** chat never appears in `turns` or the archive; 201 chars refused; profanity masked; muted
  sender gets an error; shadow-muted sender sees own message, nobody else does; 6th message in 10 s dropped;
  rejoin gets the buffer; spectators and dead players can't send (server: spectators; client: dead).
- **Risk:** medium (hot path in `GameServer`, keyboard conflicts with existing hotkeys).

### S3 - Alliance channel, root powers, reports, client mute

- **Scope:** `alliance` channel (client-filtered), Tab and `/a` `/g`, channel badge, root badge, root reads all,
  `/mute <name> [min]`, `/shadow <name>`, `/kick <name>`, `/say <text>` (server-parsed, root only), report button,
  per-player mute (localStorage by publicId).
- **Change:** `ChatRelay.ts`, `ChatInput.ts`, `ChatState.ts`, `PlayerModerationModal.ts` (mute/shadow buttons for root),
  `PlayerReportModal.ts` (report a message), `en.json`.
- **Rule:** server sends alliance messages to non-spectator players and to root only; each client shows one when
  the sender is allied (`isAlliedWith`) or on the same team; root shows all. **Known leak, documented:** a modified
  client can read other alliances' messages. No server-side alliance tracking.
- **Failing tests first:** filter shows/hides by alliance and team; spectators never receive alliance frames;
  non-root `/mute` is rejected server-side; root command writes an audit row through the API; report stores the
  ring-buffer text (not client-supplied text).
- **Risk:** medium (the leak is accepted; root reading alliance chat needs the disclosure, section 5).

### S4 - Spectate any game (root)

- **Scope:** list of live public games, invisible spectate.
- **Add:** `src/server/AdminLiveGames.ts` (worker route `GET /api/admin/live_games`, root JWT via existing
  `verifyClientToken`), `src/client/components/AdminLiveGamesCard.ts`.
- **Change:** `Worker.ts` (mount), `GameServer.ts` (root spectators left out of `lobby_info` client lists and player
  counts), `AccountSettingsPanel.ts` (card, root only, beside `<admin-reset-card>`).
- **Failing tests first:** non-root 403; list has only started public games with id, map, mode, players, bots, tick;
  root spectator absent from `lobby_info`; join path returns spectator mode for root on any started game.
- **Risk:** low. Client calls each worker (`/w{N}/api/admin/live_games`, N from `numWorkers()`).

### S5 - Bot takeover (engine)

- **Scope:** section 1's design.
- **Add:** `packages/engine/src/execution/TakeoverExecution.ts`, tests `tests/TakeoverExecution.test.ts`,
  `tests/TakeoverDeterminism.test.ts`, `tests/server/AdminTakeover.test.ts`, `src/client/hud/layers/TakeoverPicker.ts`.
- **Change:** `engine-api/src/Schemas.ts` (`AdminTakeoverIntentSchema`), `ExecutionManager.ts` (case before the
  player lookup), `GameImpl.ts` (`takeOverPlayer`), `NationExecution.ts` + `TribeExecution.ts` (guard),
  `PlayerImpl.ts` (snapshot restore), `IntentAuthorization.ts` + `GameServer.ts` (authorize, flip spectator, flag game),
  `Archive.ts` (`htTakeover`), API `gameRoutes.ts` (store `unranked_reason`), `en.json`. Run `tests/LayerBoundaries.test.ts`.
- **Failing tests first (written before the code):**
  1. Takeover at tick N: the player's clientID is root's, type Human, AI execution inactive, later root intents apply.
  2. Determinism: runner A live, runner B replays all turns from 0 later, runner C restores a snapshot taken after
     tick N: equal hashes at N+500.
  3. Server refuses: non-root, private game, target human, dead target, second takeover, sender already a player.
  4. Feed message emitted once; no XP for root (`GameEndInfo` has no root entry), `unranked_reason='takeover'` stored.
- **Risk:** **high** (engine, determinism, upstream-file edits). Kill switch `Features.adminTakeover` (client) and
  `HT_ADMIN_TAKEOVER=off` (server refuses the intent).

### S6 - Remaining admin tools

- **Scope:** global banner, maintenance mode (blocks new lobbies), cancel/end a game, mark a game unranked,
  ban/unban UI, in-game kick audit.
- **Add:** `src/server/SiteStatus.ts` (master polls `GET /public/site-status` every 30 s, cached),
  `src/client/components/AdminModerationCard.ts`, `src/client/SiteBanner.ts`.
- **Change:** `Worker.ts` (`create_game` 503 `maintenance` while on), `Master.ts` (public lobby scheduler pauses),
  `GameServer.ts` (admin `end_game`: kick all with `KICK_REASON_MATCH_CANCELLED`, archive with `htUnranked`),
  `PlayerModerationModal.ts` (ban, end game), `en.json`.
- **Failing tests first:** maintenance blocks `create_game` and new public lobbies but not running games;
  banner shows from site status; end game ends it for everyone and the API stores no XP; unranked game scores nobody;
  each action audited.
- **Risk:** medium (maintenance must fail open when the API is down: last known value, default off).

### S7 - Legal, docs, release record (Opus)

- ToS + privacy (section 5), `CLAUDE.md` decisions table (chat, moderation, takeover), `docs/Auth.md` (bans),
  `docs/API.md`, `FORK_CHANGES.md`, `resources/changelog.md`, release record, vault, company site redeploy.

---

## 3. Wire and API design

**Client -> server (WireSchemas, zbin):**

- `chat { channel: "global" | "alliance", text: string(1..200) }`
- `chat_report { messageId: uint }`
- Intent `admin_takeover { targetPlayerID: ID }` (engine-api `Schemas.ts`, in the Turn by design)

**Server -> client:**

- `chat { id: uint, fromClientID: ID, channel, text, root: boolean, system: boolean, turn: uint }`
  (`system` = `/say` and mute notices; `fromClientID` resolves name/team/alliance on the client)
- `chat_history { messages: chat[] }` sent after `start` on join/rejoin (spectators: global only)
- `chat_error { reason: "muted" | "rate_limited" | "too_long" | "disabled" }`

**API (root JWT unless noted, all audited):**

- `POST /admin/users/:username/ban {minutes|null, reason}`, `POST /admin/users/:username/unban`
- `POST /admin/users/:username/mute {minutes, shadow:boolean}`, `POST /admin/users/:username/unmute`
- `GET/PUT /admin/site-status {banner: string|null, maintenance: boolean}`; `GET /public/site-status`
- `GET /admin/chat-reports`, `DELETE /admin/chat-reports/:id`
- `POST /admin/games/:id/unranked`
- API key (game server): `GET /game-server/moderation/:sub` (`{banned, mutedUntil, shadow}`),
  `POST /game-server/audit {actor, action, target, detail}`, `POST /game-server/chat-report`

**Game server (root JWT):** `GET /api/admin/live_games` -> `[{gameID, map, mode, players, bots:[{id,name,type,alive}], tick}]`.
Admin actions in game go through the WebSocket (`kick_player`, `admin_takeover`, chat commands) so the existing
`client.role` check applies; the server forwards each to `/game-server/audit`.

---

## 4. UI plan (strict UI rules)

| Screen                                 | Copy from                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Chat log                               | `ChatDisplay.ts` itself (our messages added to its list; same table, colours, collapse)                              |
| Chat input + channel badge             | input markup and classes from `ChatModal.ts:206`; badge styled like the existing team/level tags in `PlayerPanel.ts` |
| Root badge in chat                     | the same tag classes as the channel badge, `root` string                                                             |
| Mute/shadow/ban/end buttons            | add rows to `PlayerModerationModal.ts` (same button list as kick)                                                    |
| Report a message                       | `PlayerReportModal.ts` (reason list + submit)                                                                        |
| Admin moderation card, live games card | `AdminResetCard.ts` inside `AccountSettingsPanel.ts`                                                                 |
| Takeover picker                        | `PlayerModerationModal` structure; opened from the spectator's player panel                                          |
| Site banner                            | `HeadsUpMessage.ts` style on the homepage strip used by `NewsBox` (pick the closest; justify in screenshots)         |

All strings via `translateText()` with `en.json` keys (`chat.*`, `admin.*`), no new colours, fonts, icons or CSS.
Takeover picker and admin cards are not lazy modals unless they become modals; if they do, they follow
`LazyModals.ts` (`whenModalLoaded`, `import type`). **Verify:** `run-openfront` skill, screenshot each new or changed
screen next to its source component (chat open/closed, both channels, root badge, moderation modal, admin cards,
takeover picker, banner), and fix any difference beyond content.

---

## 5. Policy and legal (Boss reviews; changes need Boss's OK)

- **Privacy (`resources/public/privacy-policy.html`):** chat messages pass through our servers, are filtered for
  bad words and kept in memory only while the game runs; **reported** messages are stored up to 30 days with who
  reported whom; moderation records (bans, mutes, reasons) are stored and deleted with the account; staff (the
  operator's admin) can read all chat channels, including alliance chat, during a game.
- **ToS (`terms-of-service.html`):** chat rules (no bullying, slurs, sharing personal info; 13+ school audience),
  mutes/bans at our discretion, staff may watch any public game and may join one by controlling a computer player;
  such games are marked and the staff player earns no XP.
- **NOTICE:** no change (no new third-party assets).
- **Flag for Boss:** root reading alliance chat and invisible spectating need a disclosure decision (O1).

---

## 6. Decision log

**Decided (Boss brief, 2026-10-27):** root-only tools, server-side authorization, everything audited; chat is its
own wire message, never an intent or in replays; client-filtered alliance chat with the leak accepted and
documented; team channel doubles as alliance channel; dead players and spectators read-only; 200 chars, rate limit,
Censor, client mute, report, in-memory ring buffer only; root badge, reads all, `/mute` `/kick` `/say`; takeover
of a chosen bot in a live public game, Boss only. A visible root badge for `thestrongest` in game and on the
leaderboard (S0, override of strict UI rule 2).

**Decided in this plan (Opus, reversible):** takeover = Turn intent + clientID swap (above); late join stays full
replay (no snapshot transfer); takeover only on alive Bot/Nation, public games, once per game; AI does not resume;
root plays under the account name; feed line on; audit reuses `admin_audit`; reported messages are the only
stored chat.

**Open (ranked, Boss decides):**

1. **O1 Disclosure** of root reading alliance chat and invisible spectating: privacy text only (recommended), or
   also an in-game notice?
2. **O2 Lane:** takeover touches the engine; Minor as briefed, or Major (72 h watch)? Recommended: Minor, takeover
   behind its kill switch, off for the first 24 h.
3. **O3 Takeover name:** account name (recommended) or keep the bot's name?
4. **O4 XP for others** in a taken-over game: keep (recommended) or the whole game unranked?
5. **O5 Report retention:** 30 days (recommended)?
6. **O6 Mute scope:** account-level, all games (recommended) or per game?

---

## 7. Release notes

- **Lane:** Minor. **Gates:** CI green (typecheck, lint, format, 4 shards + server); targeted tests per slice;
  determinism suite (S5); migration 009 rehearsed on a copy of the prod schema; trial on a throwaway stack with two
  accounts (exit test); screenshots; zero open P0/P1; release record with rollback sha.
- **Schedule:** not before Update 2's 24 h watch ends; daytime Chicago (no deploy 10 pm - 7 am); 1 deploy that day.
- **Kill switches:** `Features.chat` / `HT_CHAT=off`; `Features.adminTakeover` / `HT_ADMIN_TAKEOVER=off`;
  maintenance mode itself.
- **Ship with `up`:** Boss ships with the `up` CLI. S7 writes the update spec in `~/updates/` (project `ht`, format
  `~/up/README.md`) with the deploy and rollback steps, and the release record links it.
- **Rollback:** the spec's rollback step redeploys the previous sha (exact command also in the release record). Migration 009 is additive only, so the old build runs on the new schema; no down
  migration.
- **Watch (24 h):** desync reports, `chat_error` rates, ban/mute audit rows, API 5xx.
- **Not in this step:** no deploy, no Boss-run commands.

---

## Verification (for the implementation phase)

- Per slice: `npx vitest <file> --run` for the listed tests; API real-DB tests with `HT_TEST_DB=1`.
- Full suite in CI (`ht-ci.yml`) or `buildpc-run --node-from .nvmrc --npm-version 12 --fallback none -- npm test`;
  never on the VM while the dev stack runs.
- End to end: `npm run dev:all`, two browser sessions via `run-openfront` (`devLogin` as `thestrongest` and `tester1`),
  run the exit test, screenshot each UI item.
