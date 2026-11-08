# Update 3 - Friends (through GATE) and Achievements

**Status:** Draft 2026-10-28. Waiting for Boss to approve the brief and the open decisions. Nothing here is built.
**Lane:** Minor (new migrations in HT and GATE, new stored data, legal change): CI + targeted tests + migration
rehearsal on throwaway stacks, then a **24 h watch**.
**Release date:** unknown. Slices land as time allows; the release goes out when every slice is green, on Boss's go,
inside the light schedule (not 10 pm to 7 am Chicago, 1 non-hotfix deploy per day).
**Ships after:** Update 2 (progression) and the admin tools + chat release have finished their watch periods.
**Slices in flight:** at most 2 (F1 GATE friends and A1 achievements can run in parallel; F2 waits for F1).

**Goal:** players keep one friends list across all Gamble Limited games, owned by GATE, and see it in HT's account
modal. Players earn achievements from finished games and see them on their profile.

**Exit test:** two GLL ID accounts become friends in GATE, both see each other in HT's FRIENDS tab, one removes the
other and it disappears in both. A player finishes a multiplayer game and unlocks an achievement that shows on their
profile and in the account modal; the same game replayed through the API unlocks nothing twice. A taken-over or
unranked game awards nothing. Switching `Features.friends` or `Features.achievements` off hides everything.

---

## Open decisions (Boss, before the brief is approved)

| #   | Question                                                    | Recommendation                                                                                          |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D1  | Who pulls: does HT ask GATE on demand, or does GATE push?   | HT pulls on demand, short cache (30 s). No webhooks                                                      |
| D2  | Do friends need a GLL ID link in HT?                        | Yes. Unlinked accounts see "Link your GLL ID to add friends"                                             |
| D3  | Online/in-lobby presence and "join friend's lobby"?         | Not in this update                                                                                      |
| D4  | Which achievements count?                                   | OpenFront's map-clear ones plus ~8 of our own simple feats (list in A1). Boss edits the list            |
| D5  | Do singleplayer games award achievements?                   | Multiplayer only at first (see Risks: singleplayer records are client-authored)                         |
| D6  | Friend cap and block list?                                  | Cap 100 friends, block list in GATE v1                                                                  |
| D7  | Privacy: can anyone send a request, or only by exact name?  | By exact GLL ID username only, rate limited; blocked users cannot request                               |

## Slice F1 - GATE friend graph (repo: `~/gll-id`, needs Boss's OK to write there)

- Migration: `friendships` (`user_a`, `user_b` ordered pair, `status` pending/accepted, `requested_by`, timestamps) and
  `blocks`. Keyed on the GLL ID `sub`.
- Endpoints (session auth, in GATE's own client): send request, accept, decline, cancel, remove, list, requests in/out,
  block, unblock. Rate limits, cap from D6, no self-requests, no duplicates.
- Server-to-server read: `GET /internal/friends/:sub` for games, over the private `gll_gate` network, client
  credential per game, returns only that user's accepted friends (`sub`, display name). No bulk listing.
- Friends UI in GATE's client (add by username, requests, list, remove, block).
- Tests first for each rule; `CHANGELOG.md` entry; update GATE's `CLAUDE.md` and the service inventory.
- Deploy: GATE is live behind Cloudflare Access, so the migration is a manual step for Boss (spec in `~/updates/`).
- Effort: 2 to 3 days.

## Slice F2 - HT friends (needs F1 live or a dev GATE stack)

- `packages/api`: `/friends/*` routes in the shape `FriendsApi.ts` already parses (`FriendEntrySchema`,
  requests in/out, accept, remove), forwarding to GATE and mapping GATE `sub` to HT user by the existing link.
- Soft failure: GATE down returns an empty list and a "Friends are unavailable" state, never a broken account modal.
- Flip `Features.friends`; keep the lobby "Invite friends" button as it is. Strings in `en.json` only.
- Rehearse against GATE's dev stack (`127.0.0.1:3302`), not prod 3301. Writing to GATE's dev DB needs Boss's OK per session.
- Strict-UI check: screenshot the FRIENDS tab next to the nearest existing tab.
- Legal: privacy policy mentions the friends list is kept by GATE; Boss reviews.
- Effort: 1 to 1.5 days.

## Slice A1 - Achievements (repo: HT only; can start now)

- Migration `010_achievements.sql`: `player_achievements` (`user_id`, `achievement`, `game_id`, `achieved_at`,
  unique on user + achievement + game) and `singleplayer_map_achievements` (`user_id`, `map`, `difficulty`).
- Catalog file in `packages/api/src/achievements/` (keys, names, rules, `RULES_VERSION` like the XP rules).
  Proposed feats: first win, first multiplayer game, win a team game, win with fewest troops, survive 20 minutes,
  eliminate 3 players in one game, own the most territory at the end, 10 wins, 50 games. Boss edits this list.
- Award where `ingestGame` records a finished game, in the same transaction. Skipped when `htTakeover`, unranked,
  or the private-farming rule from Update 2 applies (fewer than 3 humans).
- `/users/@me` returns `achievements.singleplayerMap` and `achievements.player` (the schema already exists); add a
  public read on the profile route.
- Client: flip `Features.achievements` (SOLO modal toggle already exists); show earned achievements on the profile
  and in the account modal using existing components. No new icons or colours; names only until we have art of our own.
- Tests first: award once, idempotent on replay, nothing for takeover/unranked, schema parses strictly.
- Effort: 1.5 to 2.5 days.

## Slice R - Release (always last)

- Release record (lane Minor), `docs/Deploy.md`, player changelog, `CLAUDE.md` decisions table, `FORK_CHANGES.md` for
  any upstream file touched, the vault handoff, the company-site changelog check (automatic) and its roadmap line.
- Spec in `~/updates/` (project key `ht`): GATE migration step first (Boss), then HT deploy, with rollback.
- Rollback: both changes are additive. Switches go back to false; new tables stay unused. Kill switch
  `HT_FRIENDS=off` on the HT API, like `HT_CHAT=off`.
- Total effort across slices: about 5 to 7 days.

---

## Upstream context (checked 2026-10-28)

**Where we are:** HT is on OpenFront **v0.35.3** (merge base `538d205f1`, 2026-10-16). Upstream has since released
**v0.35.4, v0.35.5, v0.35.6** (Oct 24 to 27), and `main` is 111 commits ahead of our merge base. Upstream's roadmap issue
(#3694, last edited 2026-07-06, "April 2026" body) is stale; real planning is in the milestones: **v35** (due
2026-10-16, 20 open), **v36** (no date, 22 open), Backlog (104).

### Fixes in v0.35.4 to v0.35.6 worth taking (sync candidate)

| Version | Item | Why it matters to us |
| ------- | ---- | -------------------- |
| 0.35.4  | Public games since 0.35.3 were not awarding XP, stats or rewards: the game server gave up saving large games too early | **Check our server.** HT's XP pipeline uses the same save path. Verify large games reach `POST /game/:id` |
| 0.35.3  | Troop duplication exploit when a cancelled attack ended on the same tick a new one started (engine) | Already in our merge. Confirm the test came with it |
| 0.35.5  | "Server security improvements"; privacy policy now discloses hashed network identifiers | Read the diff before merging; our policy and chat/IP handling may need a matching line |
| 0.35.5  | Public lobby map rotation tunable without a release | Check it does not fight our daily rotation |
| 0.35.5  | Team spawns on several maps; leaderboard clan column off by default; Solo page fills small screens | Safe gameplay/UI; check strict-UI rules |
| 0.35.6  | Fix clicking a lobby right after page load skipping the join screen; "Prepare for the Poki integration" | Take the fix; Poki code stays hidden (portal paths) |
| 0.35.6  | Terms: unapproved extensions not allowed | Our ToS is our own wording; no copy |

### Open upstream bugs and proposals worth watching

| Issue | Title | Relevance |
| ----- | ----- | --------- |
| #5978 | Arbitrary XP fabrication via client-authored singleplayer game records (open) | **Applies to us.** See Risks |
| #6011 | XP from games with nations disabled (that had some by default) | Check our XP rules for the same hole |
| #6174, #5018, #3211, #2921 | Nameplate hover area when zoomed out; train path preview; map spoiled in invite embed; PollingLoop stop | Minor client bugs, approved for PRs upstream |
| #5989, #5963 | Connection error joining a game; reconnecting banner when the connection stalls | Could help our friends playing over Cloudflare tunnel |
| #3144 | Public achievements support (API + UI) | Upstream's own achievements; closed API, not usable. Our A1 is independent |
| #5752, #5969, #5603 | Nations "gratitude" system, better nation behaviour, MIRV hits the full team (proposed) | Gameplay changes coming in v36 or later; engine files, expect conflicts |

### Upcoming (milestones)

- **v35 leftovers (20 open):** replay viewer fixes (#6179, #5994, #5535), music streaming through Web Audio (#5877;
  we ship no tracks), automated map rotation and game mode (#5600), compressed map data (#5599), leaderboard tabs (#5595),
  diplomacy/communication shortcuts (#5596), ranked FFA and clan wars (#4941, #4942, closed API, not for us), npm security hardening (#5537).
- **v36 (22 open):** battle pass (#4032), discount codes (#4044), referrals (#4044), a Zealandia map (#5780). Mostly
  store and monetisation, which we keep hidden.
- **Backlog themes:** end-of-game recap/awards, lobby presets (#2489, #6051), Firefox performance (#3651, tied to the
  rendering migration #893), hotkeys, colourblind options, oil rigs (#3129).
- No dates anywhere upstream. They ship small releases every 1 to 3 days (v0.35.0 on Oct 16, v0.35.6 on Oct 27).

### Recommendation

1. Do a small **sync to v0.35.6** (Patch lane, 2 h watch if no engine files change, otherwise Minor) before or inside
   this update. The v0.35.4 XP-save fix is the one that could affect us.
2. Leave v36's battle pass, discounts and referrals out; they depend on the store.
3. Upstream's replay viewer, once stable, is a candidate for a later update, but HT stores no full records today.

## Risks

- **Singleplayer records are client-authored (D5).** Our `POST /archive_singleplayer_game`
  (`packages/api/src/gameRoutes.ts:181`) checks duration, `num_turns` and that `turns.length <= num_turns`, but not that
  turns are dense, so a signed-in player can submit a sparse record and get XP or an achievement without playing.
  Same class as upstream #5978. A1 therefore awards only from multiplayer games reported by the game server; singleplayer
  map achievements stay off until the record is verified (dense-turn check or a heartbeat). Separate fix, own slice,
  failing test first.
- **GATE becomes a dependency for friends.** Fail soft (empty list). Cache for 30 s.
- **Privacy.** A friends graph is new personal data held by GATE. Update GATE's privacy text; Boss reviews legal changes.
- **Schedule.** Two repos means two deploys. GATE deploys first; HT's F2 must tolerate GATE not having the endpoint yet.
- **Upstream drift.** The longer HT sits on v0.35.3, the bigger the next merge. Do the sync first if release is far off.
