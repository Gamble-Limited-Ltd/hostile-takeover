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
friends, news promos, featured stream and the Steam wishlist**. For each one:

- Remove its nav, menu and homepage entry points, and its parts of the post-game screen (`GameXpPanel`,
  `PastGameXpCard`, `Ceremony`, `LevelBadge` on player names).
- Make sure no request goes to its endpoint (`/public/*`, `/friends`, `/users/@me/xp`,
  `/matchmaking/*`).
- Use the 404 list from Stage 1's end-to-end check to catch anything missed.

**Approval:** the network log from the exit test, plus before/after screenshots of the homepage,
account menu, lobby, in-game HUD and win screen.
