# Stage 3 — Strip

**Goal:** take out everything that depends on OpenFront's services or makes money, **at the entry
points**. Modules stay where removing them would cause merge conflicts later. The UI must look
like the same game with fewer buttons. No gaps get filled with new content.

**Exit test:** a full play session (homepage → sign in → singleplayer → private lobby → end of game →
back to the homepage) with **zero** requests to third-party hosts in the network log (except Google
Fonts, if the page uses them) and no dead buttons.

All of these touch `Main.ts`, `ClientEnv.ts`, `ServerEnv.ts` and `RenderHtml.ts`, so run them
**one after another** in this order. Each one updates `FORK_CHANGES.md`.

---

## Slice 3.1 — Turnstile (Sonnet)

Files: `TurnstileToken.ts`, `Transport.ts`, `ClientGameRunner.ts`, `Auth.ts`, `Main.ts`,
`GameModeSelector.ts`, `BootInterrupts.ts`, `src/server/JoinVerify.ts`, `Worker.ts` (the turnstile
block around lines 614–690), `GameServer.ts`, `Roster.ts`, `ServerEnv.ts`, `RenderHtml.ts`, `shared/WireSchemas.ts`,
`shared/configuration/Env.ts`, and `CloseCodes.ts`.

- Turnstile becomes **off when `TURNSTILE_SITE_KEY` is unset**: the client never loads the widget
  script, and the server never asks for or checks a token. Prefer this flag over deleting code,
  because a flag is cheaper to keep through upstream merges.
- `ServerEnv.turnstileSiteKey()` must stop throwing when the key is unset.
- Update the tests that assume Turnstile is always on.

## Slice 3.2 — Login providers (Sonnet; Haiku for the test fixtures)

- Hide Google, Discord, Steam, CrazyGames and Desktop login and linking everywhere in the UI
  (`NavAccountButton.ts`, `NavAccountMenu.ts`, `AccountModal.ts`, `AccountSettingsPanel.ts`,
  `GoogleLinkButton.ts`, `SteamWishlist*`).
- Steam, CrazyGames and Desktop shell modules stay dead in the tree unless they break the build.
  The CrazyGames SDK must never load (check `index.html` and `CrazyGamesSDK.ts`).

## Slice 3.3 — Store, Stripe, cosmetics, currency, subscription (Sonnet; the biggest slice)

There are about 17 Stripe files and about 41 subscription files.

- Hide the Store, Inventory, Subscription and Rewards entry points, the currency display, purchase
  nudges, the creator-code panel and anything that opens Stripe.
- `/users/@me` already returns `adfree: true` and `subscription: null`, and the cosmetics catalog
  is empty. Check that nothing renders an empty store tile or a "0 coins" badge.
- The in-game flag picker: **keep country flags** (they come with the game and aren't sold). Hide
  premium patterns and skins.
- `StripeInline.ts` and `Payments.ts` must never load the Stripe script.
- Delete or skip the store tests that no longer apply, including the flaky `InventoryModal` ones, and say why
  in the commit message.

## Slice 3.4 — Ads and telemetry (Sonnet, small)

- `Admiral.ts`/googletag and `AdGatekeeper.ts`: no ad scripts, no ad slots (hide the slot containers
  without moving the layout around them).
- Faro (`Telemetry.ts`, `GameMetrics.ts`): off when `FARO_COLLECTOR_URL` is empty. Check that
  it's really off and not just failing.
- Server OTEL / match telemetry: off when `OTEL_*` / `TELEMETRY_ENABLED` are empty or false.
  Check `Logger.ts` doesn't try to export.

## Slice 3.5 — Hide API-only features (Sonnet)

Decided: hide **XP, levels, prestige, achievements, ranked/matchmaking, leaderboards, clans,
friends, news promos, featured stream and the Steam wishlist**.

**Keep them easy to bring back** (owner, 2026-10-11): the owner may self-host XP and the others later.
Gate each hidden feature behind **one switch per feature** (e.g. a small `src/client/Features.ts` read from
the bootstrap config, plus a server-side env flag where the server is involved), defaulting to off. Turning a
feature back on should then be "implement its API endpoints in `packages/api` + flip the switch", with no
UI rework. Don't delete their modules, tests or `en.json` strings.

For each one:

- Remove its nav, menu and homepage entry points, and its parts of the post-game screen (`GameXpPanel`,
  `PastGameXpCard`, `Ceremony`, `LevelBadge` on player names).
- Make sure no request goes to its endpoint (`/public/*`, `/friends`, `/users/@me/xp`,
  `/matchmaking/*`).
- Use the 404 list from Stage 1's end-to-end check to catch anything missed.

### Findings from Slice 1.4 (must be handled here)

- **`/matchmaking/checkin`:** `Worker.ts` starts `startRankedCheckinLoops` with no config check, so every
  worker long-polls 3 modes and logs 404 warnings forever. Add a server-side skip (a flag that defaults to
  upstream's behaviour, for example `RANKED_ENABLED`, which we leave false).
- **Prestige** (`PrestigeFlow`) shows an error on 404. Hide it with XP.
- **Clan screens** (`ClanModal`, `components/clan/*`) show error states. Hide all clan entry points.
  `UsernameInput`'s clan-tag check is already quiet.
- `TribeStatsView` (`/public/tribe/*`) and `Matchmaking.ts` (`/matchmaking/join`) weren't checked. Confirm
  they're unreachable once ranked and stats are hidden.
- The quiet ones that only need their entry points hidden: friends, XP polling, player profile progress,
  progression config, the clan leaderboard, and the lobby queue.

### Findings from Slice 1.5

- Third-party requests on every homepage load: Cloudflare Turnstile, the CrazyGames SDK, Google Tag Manager,
  Analytics and DoubleClick (`G-WQGQQ8RDN4`), Cloudflare Insights (`beacon.min.js`), Intergient ads (`ramp.js`), and
  `introjava.com` (an ad script after game start). Many are probably hardcoded in `index.html`. All must go.
- `/streams.json` and `/news.json` return 404 on every homepage load. Streams get hidden (the featured stream).
  **News stays** (owner decision), so find out why `news.json` 404s in dev (asset path or CDN) and fix it.
- The software-GL gate ("Hardware acceleration is off") blocks headless Chromium. That's fine for players, but
  the `run-openfront` skill needs the driver workaround (see Stage 1 notes).

**Approval:** the network log from the exit test, plus before/after screenshots of the homepage,
account menu, lobby, in-game HUD and win screen.

### From Slice 2.5

- **Residual sign-in display glitch (fixed in 3.6b, see below):** in 1 of 10 baseline UI sign-ins, login, refresh and
  `/users/@me` all returned 200 yet the nav stayed "Sign in" until a reload. Not reproduced in 110 runs after
  the 2.5 API fix, and not caused by the Turnstile `querySelector` error (that can't abort boot). Re-check during
  this stage's exit test once Turnstile is gone; if it shows up, capture the page-event trace.
  **Lead (Slice 3.3):** reloading while on the inventory page (`#modal=inventory`) after first opening it as a
  guest showed "Sign in" plus "Couldn't load your inventory"; a reload from the home page was fine. Try that path first.
- The account modal's "Share Profile" header button still shows when signed in. Hide it with the profile/stats features.
- Login rate limit is 30/IP/15 min; automated test runs from one IP can hit it (restart the API to reset).

### From Slices 3.1 and 3.2 (for 3.3–3.5)

- 3.1: Turnstile is off when the key is unset; the 2.5 sign-in residual did not show in 12 sign-ins. Leftovers:
  `package.json` `start:server-dev` still sets Cloudflare's test key (harmless; the dev join check is skipped),
  the empty `#turnstile-container` div, and the unreachable `turnstile_error` string / `TurnstileFailed` reason.
- 3.2: the CrazyGames SDK loads only when the page is framed; the Steam wishlist promos (footer, mobile play
  page, win box) are hidden at their entry points. When 3.5 adds `Features.ts`, move those three onto a switch.
- **Dead entries for 3.5:** the signed-in account menu's **"Copy profile URL"** (profile) and **"Change
  username"** (username changes are out of v1); the account modal's STATS/GAMES/FRIENDS tabs and "Share
  Profile"; the homepage RANKED button and CLANS nav item; the signed-out TAG box; the footer Discord icon;
  the news/tournament banner's "Sign up on Discord" promo (News stays, but strip Discord/paid links); the
  Firefox warning text says "OpenFront.io" (rebrand is Stage 4).
- **For 3.3:** the nav still shows STORE (with a red dot) and INVENTORY.
- **For 3.4:** still loaded: googletagmanager, analytics.google.com, www.google.com, the doubleclick hosts,
  cdn.intergient.com (ramp), introjava.com, static.cloudflareinsights.com.

## Stage 3 as built (exit test 2026-10-12)

- **Switches** (`src/client/Features.ts`, all off): `store`, `cosmetics`, `ads`, `xp`, `ranked`, `leaderboard`,
  `clans`, `friends`, `profile`, `usernameChange`, `stream`, `steam`, `discord`, `youtube`. Server: Turnstile off
  without `TURNSTILE_SITE_KEY`; ranked check-in loops off unless `RANKED_ENABLED=true`; ad/analytics scripts in
  `index.html` behind an `adsEnabled` render local that nothing sets.
- **Nav:** PLAY · INVENTORY (flags only). Account menu: view account, account settings, log out. Homepage lobby
  row is two columns while ranked is off (owner's call).
- **Network:** a full session (home, sign-in, solo, private lobby, game to the win screen, back home) requests
  only our game and API. Remaining 4xx are expected: dev `/cluster.json` 404 (loopback host, now backed off to
  5 min) and `/auth/refresh` 401 on signed-out boots.
- **3.6a:** the exit test found the YouTube embeds (Help "video tutorial", loser's "Need some help?") still
  making third-party requests; `youtube` switch added. The SOLO achievements toggle moved under `xp`.
- **3.6b (the 2.5 residual):** `AbortSignal.timeout(10s)` on `/auth/refresh` and `/users/@me` is wall-clock; a
  starved main thread (~20 s of software-GL boot on this VM) delivered good 200s late and the overdue timer
  aborted them, so the page showed signed out. `ActiveDeadline.ts` counts only time the page could run.
  Repro (sign in, wait 25 s, reload): 0/9 before, 16/16 after.
- **Win screen in tests:** host options, timer 1 minute, bots 0, nations 0: the largest player wins after 60 s.

### Left for later stages

- **Stage 4:** footer GitHub/Reddit/wiki links and the credits link point at OpenFront; ToS/privacy pages titled
  "OpenFront"; the bell opens OpenFront's sample changelog; Firefox warning and logo alt text say OpenFront.
- **Stage 6:** click-to-spawn in multiplayer is unconfirmed headless (clients load too slowly for the spawn
  phase); random spawn works. Check it with real devices. The same wall-clock timeout pattern remains in
  `doSteamLogin`, `ClanApi`, `ProgressionApi`, `Cosmetics` and `ServerList` (mostly behind hidden features);
  there's no retry if a boot `userAuth`/`getUserMe` really fails.
