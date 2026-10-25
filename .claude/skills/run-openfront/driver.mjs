// Headless-Chromium driver for OpenFront. Run from the repo root:
//   node .claude/skills/run-openfront/driver.mjs          # smoke flow
// or import { launch, gotoHome, openSoloModal } from it in an ad-hoc
// script placed inside the repo (so `playwright` resolves from
// node_modules). Requires setup.sh to have been run once on this machine.
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const CACHE =
  process.env.OPENFRONT_RUN_CACHE ??
  path.join(os.homedir(), ".cache", "openfront-run");
// Hostile Takeover dev client (Vite). NEVER 9000 (Portainer on this VM), 3000,
// 3001, 8080 or 80 (other projects). OPENFRONT_URL overrides; the check below
// refuses the known foreign ports so a stale default can't creep back in.
export const BASE_URL = process.env.OPENFRONT_URL ?? "http://localhost:5178";
export const API_URL = process.env.HT_API_URL ?? "http://localhost:8787";
const FORBIDDEN_PORTS = new Set(["80", "3000", "3001", "8080", "9000", "9443"]);
for (const u of [BASE_URL, API_URL]) {
  if (FORBIDDEN_PORTS.has(new URL(u).port || "80")) {
    throw new Error(
      `Refusing ${u}: that port belongs to another project/service on this VM. ` +
        `Use http://localhost:5178 (game) and http://localhost:8787 (API).`,
    );
  }
}

// Playwright is not a repo dependency. Resolve it from the repo's node_modules
// if present, else from the skill cache ($CACHE/node_modules, see setup.sh).
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {}
  const req = createRequire(path.join(CACHE, "node_modules", "x.js"));
  return await import(pathToFileURL(req.resolve("playwright")).href);
}
const pw = await loadPlaywright();
// A file-URL import of the CJS entry puts the exports under `default`.
const chromium = pw.chromium ?? pw.default.chromium;

// Launch chromium with the locally-extracted system libraries and fontconfig
// (see setup.sh). Without them the headless shell dies on libnspr4.so, and
// later Skia FATALs on the missing fontconfig.
// opts:
//   viewport      - {width, height}, default 1400x1000
//   rafIntervalMs - throttle requestAnimationFrame to one frame per interval.
//                   Essential for in-game testing: SwiftShader needs seconds
//                   of CPU per frame, and an unthrottled rAF loop starves the
//                   main thread (timers, the singleplayer turn loop, input).
//                   ~1000 is a good value; frames still render for screenshots.
//   args          - extra Chromium flags appended to the defaults.
export async function launch({ viewport, rafIntervalMs, args } = {}) {
  const env = { ...process.env };
  const libs = path.join(CACHE, "extracted", "usr", "lib", "x86_64-linux-gnu");
  if (fs.existsSync(libs)) {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
      ? `${libs}:${env.LD_LIBRARY_PATH}`
      : libs;
    env.FONTCONFIG_FILE = path.join(CACHE, "fonts.conf");
  }
  const browser = await chromium.launch({
    // swiftshader flags: software GL that Chromium 13x+ otherwise refuses
    // headless. The game's WebGLGate is then defeated by prepContext().
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--use-gl=angle",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      ...(args ?? []),
    ],
    env,
  });
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1400, height: 1000 },
  });
  await prepContext(context);
  if (rafIntervalMs) {
    await context.addInitScript((interval) => {
      let last = 0;
      window.requestAnimationFrame = (cb) => {
        const now = performance.now();
        const wait = Math.max(0, interval - (now - last));
        return setTimeout(() => {
          last = performance.now();
          cb(last);
        }, wait);
      };
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    }, rafIntervalMs);
  }
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    console.log("PAGEERROR:", e.message.split("\n")[0]),
  );
  page.on("crash", () => console.log("PAGE CRASHED"));
  return { browser, page };
}

// Defeat the game's software-GL gate (src/client/render/gl/initGL.ts,
// components/WebGLGate.ts) without touching game source. The gate (a) asks for
// failIfMajorPerformanceCaveat:true and (b) rejects renderers matching
// /swiftshader|llvmpipe|software/i read via WEBGL_debug_renderer_info.
// We drop (a) and spoof (b).
export async function prepContext(context) {
  await context.addInitScript(() => {
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, a) {
      if (a && a.failIfMajorPerformanceCaveat)
        a = { ...a, failIfMajorPerformanceCaveat: false };
      return gc.call(this, t, a);
    };
    for (const C of [
      window.WebGL2RenderingContext,
      window.WebGLRenderingContext,
    ]) {
      if (!C) continue;
      const gp = C.prototype.getParameter;
      C.prototype.getParameter = function (p) {
        if (p === 0x9246) return "ANGLE (Hostile Takeover test GPU)"; // UNMASKED_RENDERER_WEBGL
        if (p === 0x9245) return "Google Inc. (Test)"; // UNMASKED_VENDOR_WEBGL
        return gp.call(this, p);
      };
    }
  });
}

// Sign in as a seeded dev user (thestrongest | tester1). Needs the API on
// :8787 (npm run dev:all). The API sets the `ht_refresh` cookie on its own
// origin; call this after gotoHome (so we are on the game origin), then
// reload so the client picks up the session.
export async function devLogin(page, username = "tester1") {
  const status = await page.evaluate(
    async ([api, u]) => {
      const r = await fetch(`${api}/dev/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: u }),
      });
      return r.status;
    },
    [API_URL, username],
  );
  if (status !== 200) throw new Error(`dev login failed: HTTP ${status}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(5000);
}

export async function gotoHome(page) {
  await page.goto(BASE_URL, { waitUntil: "load", timeout: 60000 });
  // Lit components render client-side after load.
  await page.waitForTimeout(3000);
}

// The single-player button is labeled "Solo". There are multiple Solo
// buttons in the DOM (responsive layouts) — only one is visible.
export async function openSoloModal(page) {
  await page.locator("button:visible", { hasText: /solo/i }).first().click();
  await page.waitForTimeout(1500);
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const outDir = "/tmp/openfront-run";
  fs.mkdirSync(outDir, { recursive: true });
  const { browser, page } = await launch();
  await gotoHome(page);
  await page.screenshot({ path: `${outDir}/home.png` });
  await openSoloModal(page);
  await page.screenshot({ path: `${outDir}/solo-modal.png` });
  // Reach into a Lit component for ground-truth state (light DOM, no shadow
  // root — properties are directly on the element).
  const picker = await page.evaluate(() => {
    const p = document.querySelector("map-picker");
    return { selectedMap: p?.selectedMap, activeTab: p?.activeTab };
  });
  console.log("map-picker state:", JSON.stringify(picker));
  console.log(`screenshots: ${outDir}/home.png ${outDir}/solo-modal.png`);
  await browser.close();
}
