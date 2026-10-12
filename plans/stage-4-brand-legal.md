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
