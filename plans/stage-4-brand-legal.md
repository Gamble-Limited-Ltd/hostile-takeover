# Stage 4 — Brand and legal

**Goal:** the game presents itself as Hostile Takeover, published by Gamble Limited Ltd., and credits
OpenFront exactly as the hard rules in `CLAUDE.md` say. Our own ToS and privacy policy are live.

### Branding decisions (owner, 2026-10-10)

- **Logo:** a text wordmark, "HOSTILE TAKEOVER", in the game's existing font, in the logo's spot at the same
  size. Real art can replace it later with no layout change.
- **Gamble Limited Ltd.** is the publisher and the **legal entity** behind the ToS, the privacy policy and
  data requests.
- **Three-way cross-promotion** between Hostile Takeover, GLL and Meridian (once Meridian launches):
  - In this repo: a small "More from Gamble Limited" pair of links (GLL now, Meridian behind a flag
    until it launches), placed with the footer's existing link style. **Links only** (URLs, no shared code,
    accounts or data), so the AGPL doesn't spread.
  - GLL's and Meridian's links to us are changed in **their own repos and sessions**, never from here.
- **External links:** keep **OpenFront's wiki** (so new players can learn the game). Hide Discord, the
  store pages, and OpenFront's GitHub and social links. Our Source (AGPL) link goes to the fork.
- **News modal: keep it.** It reads `resources/changelog.md` and `resources/news.json` from this repo,
  so OpenFront's announcements come with each upstream merge. Strip anything in a news entry that
  links to their store, Discord or paid features, keeping the text. Add that check to the upstream-sync steps.

Slices 4.1 and 4.2 can run in parallel. Slice 4.3 needs the owner to review the text.

---

## Slice 4.1 — Rebrand strings and hosts (Sonnet; Haiku for the `en.json` edits)

- `index.html`: the title, `og:*` and `twitter:*` meta, the description and the theme colour (only if the owner
  asks for a change). No new tags.
- `resources/lang/en.json`: every user-visible "OpenFront" (about 47) that names the game becomes
  "Hostile Takeover". The attribution and credits lines keep "OpenFront". **Only `en.json` is edited.**
- Hardcoded `openfront.io` / `openfront.dev` in the runtime code (`ClientEnv.ts`, `ServerList`,
  `GameApiCors.ts`, `ClusterCheckin.ts`, `ClusterConfig.ts`, `nginx.conf`, `Dockerfile`):
  move them to config or our domains. Tests that use `openfront.io` as example data can stay.
- The `resources/public/press/` page, and `docs` links shown in the UI: hide or repoint them.
- External links: keep the OpenFront wiki link, and hide Discord, store, GitHub and social links (decisions above).
- News: keep the modal. Strip store, Discord and paid-feature links from `news.json` / `changelog.md` entries, keeping the text.

## Slice 4.2 — Attribution, NOTICE and logo (Sonnet, UI)

- Footer and loading screen: keep "© OpenFront and Contributors" and add
  "Hostile Takeover is published by Gamble Limited Ltd. · Based on OpenFront · Modified ·
  Source (AGPL v3)", with Source linking to `https://github.com/Gamble-Limited-Ltd/hostile-takeover`.
  Use the footer's existing text style.
- `NOTICE` at the repo root: what's OpenFront's (code AGPL v3, `resources/` CC BY-SA,
  `proprietary/` untouched and unused), what's ours, and which license covers what. `LICENSE`
  and `LICENSING.md` stay as they are.
- Logo: replace OpenFront's logo files with ours **at the same size and position**, per the owner's
  answer. If we have no art yet, use a text wordmark in the existing font.
- Favicon and app icons: the same files, new art (a simple monogram until real art exists).
- Cross-promotion links (GLL, and Meridian behind `MERIDIAN_URL` being set) in the footer's existing link style.

## Slice 4.3 — ToS and privacy policy (Sonnet drafts, owner approves the text)

- Replace `resources/public/terms-of-service.html` and `privacy-policy.html` with our own short
  plain-English text, written from scratch (nothing copied from OpenFront).
  - Operator: Gamble Limited Ltd.
  - Players must be 13 or older. The game is for invited @kmlhs.org friends.
  - What we collect: first and last name, email, username, password hash, session cookies,
    and in-game names and chat during a match. No game records are kept and there's no advertising.
  - Analytics: Cloudflare Web Analytics only (owner keeps it on across their platforms). Say what it is:
    cookieless page-view counts collected by Cloudflare, our host/CDN. No other analytics or trackers.
  - How long we keep it: until the account is deleted, and sessions expire after 30 days.
  - Account deletion: in-game (Delete account) or by asking the owner.
  - The AGPL note: the source is available at the fork. The ToS can't restrict the rights the AGPL gives.
  - A line recommending a lawyer review before any wider release (shown to the owner, not in the page text).
- Keep the same page layout and styling as the existing pages. Link them from the sign-up checkbox and the footer.

**Approval:** screenshots of the footer, loading screen and homepage, plus the owner's sign-off on the legal text.

## Slice 4.4 — Stop serving OpenFront's proprietary assets (Sonnet; added 2026-10-12)

Found in 4.2: the build serves `proprietary/` (OpenFront's font, logos, favicon, menu and gameplay music, the
game-start alert). Its license allows use only "as part of the complete OpenFront software package". Owner's call:
keep the files in the tree untouched (clean merges) but stop serving and bundling them, behind one switch that
defaults off. The font becomes Overpass Bold (OFL, already in `resources/fonts`), images point at our 4.2 art,
music is silent until we have our own tracks, and the game-start alert uses `resources/sounds/effects/game-start.mp3`.

## Stage 4 decisions made while building

- **Legal text (owner, 2026-10-12):** Opus writes the ToS and privacy policy directly, in GLL's format
  (`§ N — Title` sections, "Gamble Limited Ltd." / Effective Date header, data table, 30-day responses, Wisconsin
  law and courts, USD $0 liability cap, the note that Gamble Limited Ltd. isn't incorporated and who runs it).
  Wording is our own. GLL's anti-reverse-engineering, exclusive-IP and non-compete clauses are left out because
  they conflict with the AGPL. Contact: the admin in person, else `gamblelimitedsupport@taps-holdings.org`.
- **Wordmark font:** Overpass Bold, not the OpenFront font (that font is under `proprietary/`).
- **Footer:** the cross-promo row is labelled "More games".
- **Recommend** a lawyer reads the ToS and privacy policy before anyone outside the friend group plays.

## Stage 4 as built (exit test 2026-10-12)

- **4.1:** title, meta and `en.json` say Hostile Takeover; OpenFront's GitHub/Reddit footer links behind
  `Features.upstreamSocials` (off); credits link → our `CREDITS.md`; OpenFront's press kit and `ads.txt` deleted;
  the bell shows our changelog with OpenFront's notes below.
- **4.2:** attribution row in the footer and loading screen; "More games" → Gamble Limited (Meridian when
  `MERIDIAN_URL` is set at build time); `NOTICE`; wordmark, favicon and app icons in Overpass Bold.
- **4.3:** our ToS and privacy policy (GLL format, our wording); already linked from the footer and sign-up checkbox.
- **4.4:** `proprietary/` not served, bundled or copied unless `SERVE_PROPRIETARY=true`; display font loads
  Overpass Bold under the old family name; music off behind `Features.music`; the alert plays `game-start.mp3`.
- **Exit test:** guest home (1440 and 390), legal pages, sign-up, register, solo game, two-player private lobby to
  the win screen, delete account: all pass. Network: only the game origin and the API; nothing from OpenFront hosts
  or `proprietary/`. Only expected 4xx (`/cluster.json` 404 in dev, signed-out `/auth/refresh` 401).

### Left for later stages

- **Stage 5:** in the Vite dev server a browser navigation to `/terms-of-service.html` or `/privacy-policy.html`
  returns the SPA homepage (a plain fetch gets the file). Confirm production serves the real pages from the
  footer and sign-up links. A Docker build needs `MERIDIAN_URL` as a build arg once Meridian launches.
- **Stage 6:** add the SIL OFL licence text for Overpass next to `resources/fonts/`; our own music tracks (then
  turn `Features.music` on); hidden `DiscordLogo.svg`/`GoogleLogo.svg` are still fetched from our origin (harmless).
  A lawyer should read the ToS and privacy policy before anyone outside the friend group plays.
