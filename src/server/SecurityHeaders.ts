import { GameEnv } from "@openfront/shared/configuration/Env";
import { ownHosts } from "@openfront/shared/Wayfinder";
import { createHash } from "crypto";
import type { RequestHandler, Response } from "express";
import { ServerEnv } from "./ServerEnv";

// Hostile Takeover: response headers for the page and its static files.
//
// The CSP is a backstop: nothing third-party is meant to run, so script-src and
// connect-src name only our own hosts plus Cloudflare Web Analytics (the owner
// keeps it on; Cloudflare injects its beacon at the edge). If a third-party
// script ever creeps back in, the browser blocks it instead of loading it.

const CF_BEACON_SCRIPT = "https://static.cloudflareinsights.com";
const CF_BEACON_REPORT = "https://cloudflareinsights.com";

export interface CspOptions {
  /** The account API's origin (scheme + host), e.g. https://ht-api... */
  apiOrigin: string;
  /** The game's own host[:port], where the page, /w<N>/ sockets and /api live. */
  gameHost: string;
  /** More game hosts and API origins (Wayfinder keeps the previous generation live). */
  extraGameHosts?: readonly string[];
  extraApiOrigins?: readonly string[];
  /** Allow plain http/ws to the game host (local dev only; production is TLS). */
  allowInsecure?: boolean;
  /** `sha256-...` sources for the page's inline <script> blocks. */
  inlineScriptHashes?: readonly string[];
}

export function buildCsp(opts: CspOptions): string {
  const own: string[] = [];
  for (const host of [opts.gameHost, ...(opts.extraGameHosts ?? [])]) {
    own.push(`https://${host}`, `wss://${host}`);
    if (opts.allowInsecure) own.push(`http://${host}`, `ws://${host}`);
  }
  const hashes = (opts.inlineScriptHashes ?? []).map((h) => `'${h}'`);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // No 'unsafe-inline': the page's few inline scripts are allowed by hash.
    "script-src": ["'self'", ...hashes, CF_BEACON_SCRIPT],
    // The Lit components and the page set inline styles all over, and a style
    // hash cannot cover style="" attributes, so styles keep 'unsafe-inline'.
    "style-src": ["'self'", "'unsafe-inline'"],
    "connect-src": [
      "'self'",
      ...own,
      opts.apiOrigin,
      ...(opts.extraApiOrigins ?? []),
      CF_BEACON_SCRIPT,
      CF_BEACON_REPORT,
    ],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "data:", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/** CSP hash sources for every inline <script> (one without a src) in `html`. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    if (/\bsrc\s*=/i.test(m[1]) || m[2].trim() === "") continue;
    hashes.add(`sha256-${createHash("sha256").update(m[2]).digest("base64")}`);
  }
  return [...hashes];
}

function cspOptions(): CspOptions {
  // Wayfinder: hosts come from the runtime file, read on every call (it is
  // cached for 1 s inside ownHosts), so a rotation needs no restart.
  const [gameHost, ...extraGameHosts] = ownHosts("ht");
  if (gameHost !== undefined) {
    const [api, ...extraApi] = ownHosts("htapi").map((h) => `https://${h}`);
    return {
      apiOrigin: api,
      extraApiOrigins: extraApi,
      gameHost,
      extraGameHosts,
      allowInsecure: ServerEnv.env() === GameEnv.Dev,
    };
  }
  const legacyGameHost =
    ServerEnv.publicHost() ?? (ServerEnv.domain() || "localhost");
  return {
    apiOrigin: ServerEnv.jwtIssuer(),
    gameHost: legacyGameHost,
    allowInsecure: ServerEnv.env() === GameEnv.Dev,
  };
}

export const COMMON_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** Express middleware: CSP, nosniff and Referrer-Policy on every response. */
export function securityHeaders(): RequestHandler {
  // Built on first use so importing the module never reads the environment.
  // Legacy hosts never change while running, so that CSP is cached; with
  // Wayfinder it is rebuilt per request (cheap string work).
  let csp: string | undefined;
  return (_req, res, next) => {
    const live = ownHosts("ht").length > 0;
    const value = live
      ? buildCsp(cspOptions())
      : (csp ??= buildCsp(cspOptions()));
    for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    res.setHeader("Content-Security-Policy", value);
    next();
  };
}

/** The app shell has inline scripts: replace the base CSP with one that hashes them. */
export function applyAppShellCsp(res: Response, html: string): void {
  res.setHeader(
    "Content-Security-Policy",
    buildCsp({ ...cspOptions(), inlineScriptHashes: inlineScriptHashes(html) }),
  );
}
