/**
 * Hostile Takeover feature switches.
 *
 * One frozen object of booleans, all off. Each switch gates the *entry points*
 * of a feature (nav items, buttons, menu rows, URL routes). The feature's
 * modules stay in the tree and stay loadable so upstream merges stay cheap;
 * flipping a switch to `true` brings its entry points back.
 *
 * Add new switches here rather than scattering ad-hoc `hidden` attributes.
 * Keep every default `false`. Turning a feature back on is: implement its
 * endpoints in packages/api, then flip its switch.
 */
export const Features = Object.freeze({
  /**
   * Menu and gameplay music. Off: OpenFront's two tracks live in
   * proprietary/ (all rights reserved) and we ship none, so neither track is
   * requested. The music volume setting stays and does nothing until we have
   * tracks of our own.
   */
  music: false,
  /**
   * The store: STORE nav item and its notification dot, `#modal=store`,
   * `#modal=subscription` and `#affiliate=` routes, the subscription menu
   * row, and the purchase promo in the win box. Stripe loads only from the
   * store's purchase flow, so with this off it never loads.
   */
  store: false,
  /**
   * Paid-cosmetic UI: the Skins, Crowns and Effects categories in the
   * inventory, plus loadouts and "unequip all". Country flags are not
   * cosmetics in this sense (they ship with the game), so the inventory, and
   * its Flags category, stay reachable with this off.
   */
  cosmetics: false,
  /**
   * Ads: with this off `window.adsEnabled` stays false, so Admiral, the
   * AdGatekeeper probe and every Playwire/RAMP slot loader never run. The
   * ad and analytics scripts in index.html are separately guarded by an EJS
   * `adsEnabled` render local that nothing sets.
   */
  ads: false,
  /**
   * XP and levels (on since U2.4): the XP panel in the win box, the level
   * badge on player names (lobby roster, player panel) and in the account
   * menu, the account modal's level card and Progression tab (level and XP
   * bar only). Also gates the request layer (`ProgressionApi`:
   * `/users/@me/xp*`, `/public/progression/config`,
   * `/public/player/<id>/progress`), so with this off none of them is called.
   */
  xp: true,
  /**
   * Prestige: the Prestige button and `PrestigeFlow` in the account modal,
   * the Legend ceremony in the win box, `/users/@me/prestige`, and (with it
   * off) the Progression tab's reward track, prestige history and milestones.
   */
  prestige: false,
  /**
   * Achievements: the SOLO modal's achievements toggle / "sign in for
   * achievements" button.
   */
  achievements: false,
  /**
   * Ranked and matchmaking: the homepage RANKED button, `#modal=ranked`,
   * the `?requeue=` reopen and the win box's requeue button. With no way in,
   * `Matchmaking.ts` (`/matchmaking/join`) and `RankedModal` never load.
   */
  ranked: false,
  /**
   * Leaderboards: the LEADERBOARD item in the desktop and mobile nav and
   * the `#modal=leaderboard` route (player, clan and tribe boards).
   */
  leaderboard: false,
  /**
   * Clans: the CLANS nav item (desktop and mobile), `#modal=clan`, and the
   * clan TAG box in `UsernameInput` (also keeps a stored tag from being
   * read, so no `/public/clan/<tag>/exists` check runs).
   */
  clans: false,
  /**
   * Friends: the account modal's FRIENDS tab (`FriendsList`, `/friends*`).
   */
  friends: false,
  /**
   * Public profiles and stats (on since U2.4): the account modal's STATS tab
   * and "Share Profile" button (and the `/player/<id>` fetch behind them), the
   * account menu's "Copy profile URL", `#modal=profile` and the `/player/<id>`
   * route, and `TribeStatsView` (`/public/tribe/*`).
   */
  profile: true,
  /**
   * Game history: the GAMES tab (account modal and profile) and
   * `#modal=stats` (per-game stats). We store no games, so the list is empty.
   * The profile's CLANS tab follows `clans`.
   */
  gameHistory: false,
  /**
   * The profile's per-game detail groups (buildings, naval, combat, gold).
   * We store none of those stats, so they would always read 0.
   */
  gameStatDetails: false,
  /**
   * The "Share on X" and "Copy for Discord" share buttons. "Copy link" stays.
   */
  socialShare: false,
  /**
   * Username changes (on since U2.6): the account menu's "Change username" row
   * and `#modal=change-username`.
   */
  usernameChange: true,
  /**
   * The featured stream panel and "Streaming now" strip. With this off the
   * shared poller never starts, so `/streams.json` is never fetched.
   */
  stream: false,
  /**
   * Steam wishlist promos: the footer banner, the mobile play-page widget
   * and the win box promo (and the Steam iframe behind them). Also gates the
   * "Open Lobby Links in Steam" setting and the lobby-link Steam handoff.
   */
  steam: false,
  /**
   * Discord and community promos: the footer Discord icon, the win box's
   * "Join Discord" promo, and the news box's tournament / Discord items
   * (the news modal and other news items stay).
   */
  discord: false,
  /**
   * OpenFront's own social links in the footer (their GitHub repo and
   * subreddit). The wiki link stays on regardless: it teaches new players the
   * game. Our Source link goes to the fork (Slice 4.2).
   */
  upstreamSocials: false,
  /**
   * YouTube embeds (third-party requests to youtube.com, ytimg, gstatic,
   * doubleclick...): the Help modal's VIDEO TUTORIAL section and the loser's
   * "Need some help?" win-box tutorial. The desktop shell's local <video>
   * is unaffected. Plain links to YouTube stay (no request until clicked).
   */
  youtube: false,
});
