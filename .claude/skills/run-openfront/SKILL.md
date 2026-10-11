---
name: run-openfront
description: Build, run, and drive OpenFront locally — including full in-game WebGL testing. Use when asked to run the game, start the dev server, take a screenshot of the UI, verify a client change in the real app, or interact with the running game (lobby, modals, map picker, starting a singleplayer game, spawning, attacking, build menu, reading live sim state).
---

Hostile Takeover (our OpenFront fork) is a browser game (Lit + WebGL2 client,
Node game server, our own API in `packages/api`). Run the stack with
`npm run dev:all`, then drive it with headless Chromium via
`.claude/skills/run-openfront/driver.mjs`. All paths are relative to the
repo root.

**Ports (this VM is shared; never touch anything else):** game client
**http://localhost:5178** (Vite), game server 3400-3402, API **8787**, Postgres
127.0.0.1:5436. Port 9000 is Portainer, and 3000/3001/8080/80 belong to other
projects. `driver.mjs` defaults to `http://localhost:5178`, honours
`OPENFRONT_URL`, and throws if the URL (or `HT_API_URL`) uses one of those
foreign ports.

Before any npm command: `export PATH=~/.nvm/versions/node/v24.21.0/bin:$PATH`.

## Prerequisites (one-time per machine, no sudo)

`setup.sh` installs Playwright **into the cache dir** (`~/.cache/openfront-run/`,
override `OPENFRONT_RUN_CACHE`; never the repo's package.json/lockfile, never
`npm -g`), downloads chromium-headless-shell (with the ubuntu24.04 platform
override), then only _reports_ missing system libs and fonts (no apt). The
driver imports `playwright` from the repo's `node_modules` if present, else
from the cache dir.

```bash
bash .claude/skills/run-openfront/setup.sh
```

If it lists missing libraries, install them yourself or extract `.deb`s into
`~/.cache/openfront-run/extracted/` (the driver adds that to `LD_LIBRARY_PATH`).
Do not use `npm install` in the repo (`npm run inst` = `npm ci --ignore-scripts`).

## Run the stack

First time only: `npm run api:db:up && npm run api:migrate && npm run api:keygen && npm run api:seed`.

```bash
(npm run dev:all > /tmp/dev.log 2>&1 &) # game server + Vite + API
timeout 90 bash -c 'until curl -sf http://localhost:5178 >/dev/null; do sleep 1; done'
```

Stop it by killing the `concurrently` process (`pgrep -af hostile-takeover`,
then `kill <pid>`) and check ports 5178/8787/3400-3402 are free. Do not
`pkill -f vite` or `pkill -f tsx`: other projects on this VM run those too.

### Testing from another device (LAN)

`npm run dev:lan` (instead of `dev:all`) serves the stack on the VM's LAN IP (`LAN_HOST=<ip>` overrides detection):
Vite on the LAN, the API on `0.0.0.0:8787` with `API_URL`/`EXTRA_GAME_ORIGINS` set to the LAN address. Drive it with
`OPENFRONT_URL=http://<lan-ip>:5178`. `/dev/login` answers 404 unless the TCP peer is loopback, so sign in via
`/auth/register` or `/auth/login` (cookie `ht_refresh`) when browsing by LAN IP. Plain `dev:all` binds the API to 127.0.0.1 only.

### Dev sign-in

Seeded users: `thestrongest` (root) and `tester1`. `POST
http://localhost:8787/dev/login {"username": "..."}` signs in without a
password (localhost only) and sets the `ht_refresh` cookie on the API origin.
In a browser context: `fetch(..., {credentials: "include"})` from a page on
the game origin, then reload. The driver does this:

```js
import {
  launch,
  gotoHome,
  devLogin,
} from "./.claude/skills/run-openfront/driver.mjs";
const { browser, page } = await launch();
await gotoHome(page);
await devLogin(page, "tester1"); // POSTs /dev/login with credentials: "include", reloads
```

## Drive it (agent path)

Smoke flow — home page, open the single-player modal, dump the map-picker
state, screenshot:

```bash
node .claude/skills/run-openfront/driver.mjs
# screenshots: /tmp/openfront-run/home.png, /tmp/openfront-run/solo-modal.png
```

For ad-hoc flows, write a script **inside the repo** (so `playwright`
resolves) importing the driver's helpers:

```js
import {
  launch,
  gotoHome,
  openSoloModal,
} from "./.claude/skills/run-openfront/driver.mjs";
const { browser, page } = await launch(); // env/libs/fonts handled here
await gotoHome(page);
await openSoloModal(page);
// Lit components use light DOM — query and read properties directly:
const s = await page.evaluate(
  () => document.querySelector("map-picker")?.selectedMap,
);
await browser.close();
```

## Drive a full game (WebGL, in-game interaction)

`game.mjs` drives an actual singleplayer game end-to-end: start, spawn,
attack/expand, open the radial menu, and read **ground-truth sim state**.
WebGL works headless via SwiftShader. `launch()` passes
`--use-angle=swiftshader --enable-unsafe-swiftshader` and `prepContext()` defeats
the game's software-GL gate ("Hardware acceleration is off", from
`src/client/render/gl/initGL.ts` + `components/WebGLGate.ts`) with an init
script: it drops `failIfMajorPerformanceCaveat` and spoofs the
`WEBGL_debug_renderer_info` renderer string. No game source is touched. The
screenshots show the real rendered map.

Smoke flow (≈2 min: starts a 50-bot game, spawns, expands, opens the
radial menu, asserts territory growth):

```bash
node .claude/skills/run-openfront/game.mjs
# screenshots: /tmp/openfront-run/game-{spawn-phase,spawned,expanded,radial-menu}.png
```

For ad-hoc in-game flows, import the helpers (script must live inside the
repo):

```js
import {
  launch,
  gotoHome,
  openSoloModal,
} from "./.claude/skills/run-openfront/driver.mjs";
import {
  startSoloGame, // set modal options (clicks `game_settings.start`) ({bots, map, difficulty, instantBuild, …}), click Start, wait for sim
  gameState, // {ticks, inSpawnPhase, numPlayers, myPlayer: {troops, gold, tilesOwned, isAlive}, …}
  findSpawnTile,
  spawn, // pick land + click it; waits until myPlayer owns tiles
  waitForSpawnPhaseEnd,
  waitForTick,
  findExpansionTile,
  attack,
  clickWorld,
  panTo,
  setAttackRatio,
  openRadialMenu, // right-click on own territory; returns true if the menu opened
} from "./.claude/skills/run-openfront/game.mjs";

const { browser, page } = await launch({ rafIntervalMs: 3000 }); // throttle is REQUIRED in-game, see below
await gotoHome(page);
await openSoloModal(page);
await startSoloGame(page, { bots: 50 });
const tile = await spawn(page);
await waitForSpawnPhaseEnd(page);
const target = await findExpansionTile(page, tile);
await attack(page, target.x, target.y);
await browser.close();
```

### How it works / in-game gotchas

- **Ground-truth state without any repo changes**: `hud/GameRenderer.ts`
  assigns the `GameView` and `TransformHandler` onto the `<build-menu>`
  Lit element (light DOM). From page JS:
  `document.querySelector("build-menu").game` / `.transformHandler`.
  GameView has `ticks()`, `inSpawnPhase()`, `myPlayer()`, `players()`,
  `ref(x,y)`, `isLand()`, `hasOwner()`; PlayerView has `troops()`,
  `numTilesOwned()`, `gold()`, `isAlive()`, `outgoingAttacks()`.
- **`launch({ rafIntervalMs: 3000 })` is mandatory for in-game work.**
  SwiftShader needs seconds of CPU per frame; an unthrottled rAF loop
  starves the main thread (0.8 fps, 100 ms timers firing every ~4 s) and
  the singleplayer turn loop crawls at ~0.3 ticks/s instead of 10/s. The
  throttle stubs `requestAnimationFrame` to one frame per interval —
  sim runs near full speed, frames still render for screenshots.
- **Solo modal options are settable as element properties** before
  clicking Start: `document.querySelector("single-player-modal").bots = 50`
  (`@state` fields are TS-private only). `startSoloGame` does this.
- **Click tile centers, not corners.** World coords address a tile's
  top-left corner and `screenToWorldCoordinates` floors — a corner click
  can land on the neighboring tile (and clicking your own tile is a
  silent no-op). `clickWorld` aims at `+0.5,+0.5`.
- **HUD elements swallow canvas clicks.** The leaderboard / control panel
  / modals sit above the `#game-input-overlay`. `clickWorld` verifies
  `document.elementFromPoint` hits the overlay and recenters the camera
  (`panTo`) if not — never click raw screen coords yourself.
- **The camera animates on its own** (post-spawn go-to-player), so screen
  coords computed before the click go stale. `clickWorld` calls
  `transformHandler.clearTarget()` first to freeze it.
- **Spawning**: during the spawn phase a left click on unowned land sends
  the spawn intent; in singleplayer the spawn phase ends as soon as the
  human spawns. `nameLocation()` can still be `{0,0}` for the first ticks
  after spawning — pass the spawn tile as fallback origin (helpers do).
- **Attacking**: a left click outside the spawn phase attacks/expands if
  `canAttack` (unowned land must be connected to your border through
  unowned land). Troops drop and `outgoingAttacks()` becomes non-empty on
  success. The radial menu (right click) is a DOM/SVG overlay —
  `.radial-menu-container` exists from startup; check
  `style.display !== "none"` for "open".
- Verify rendering visually by reading the screenshots — a blank WebGL
  canvas means SwiftShader broke (check `webgl2` context creation and
  `LD_LIBRARY_PATH`/fontconfig from setup.sh).

## Run (human path)

`npm run dev:all`, open http://localhost:5178 in a browser. Useless headless.

## Test

```bash
npm test                                      # full suite (Vitest)
npx vitest tests/MapConsistency.test.ts --run # single file
```

## Gotchas

- **Vite serves on port 5178** (`.env` `VITE_PORT`), not 9000/5173.
- **Playwright on unsupported distros**: `playwright install` may fail with
  "does not support chromium on ...". Fix:
  `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` (setup.sh does this).
- **Browser dies at launch / mid-load**: missing host libs
  (`libnspr4.so`, `libatk-1.0.so.0`, …) then a Skia FATAL
  (`SkFontMgr_FontConfigInterface.cpp: Not implemented`) from the absent
  fontconfig. `launch()` in driver.mjs injects `LD_LIBRARY_PATH` and
  `FONTCONFIG_FILE` pointing at `~/.cache/openfront-run/` (only if `extracted/` exists); diagnose new
  missing libs with `DEBUG=pw:browser` and
  `ldd .../chrome-headless-shell | grep "not found"`.
- **The single-player button is labeled "Solo"** (`main.solo`), and the DOM has more
  than one (responsive layouts) — use `button:visible` with
  `hasText: /solo/i`.
- **Lit + Vite HMR**: custom elements can't be re-registered, so an
  already-open tab keeps old component code after an edit. Hard-reload
  (or re-`goto`) before judging behavior.
- **`PAGEERROR: ... reading 'inSpawnPhase'`** on the home page is
  pre-existing background noise, not your breakage.
- **Start button**: in the solo modal it is
  `o-button[translationkey="game_settings.start"]` (was `single_modal.start`).
- **"Hardware acceleration is off" screen / blank canvas**: the WebGL gate is
  rejecting SwiftShader; make sure you launch through `driver.mjs`' `launch()`
  (or call `prepContext(context)` on your own context).
- **Signed-in state not visible**: the account UI may not show the dev session
  yet; check `ht_refresh` exists for `localhost:8787` and `/users/@me` returns 200.
- **Multiplayer lobbies**: the lobby list polls `/cluster.json`; if the API
  doesn't serve it in dev, expect errors there (solo is unaffected).
- Wait ~3s after `load` before interacting — Lit components render
  client-side (driver's `gotoHome` does this).

## Troubleshooting

- `Cannot find package 'playwright'` — run `setup.sh` (installs it into the
  cache dir). Scripts that only import `driver.mjs` resolve it for you; a
  script that imports `playwright` directly must live inside the repo.
- `Target page, context or browser has been closed` immediately —
  re-run `bash .claude/skills/run-openfront/setup.sh` (the
  `~/.cache/openfront-run` lib cache is missing or was cleared).
- `EADDRINUSE` on relaunch — a previous dev stack is still up: find our
  `concurrently` process with `pgrep -af hostile-takeover` and kill it.
