// Hostile Takeover: the host table written by Wayfinder (the rotation daemon).
// Server-only: it reads a file, so never import it from client code.
//
// Dual mode: when the runtime file does not exist every function answers "not
// Wayfinder" (null / [] / false) and callers keep their env-based behaviour.
import fs from "fs";

const DEFAULT_FILE = "/run/wayfinder/hosts.json";
const CACHE_MS = 1000;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type WayfinderKey = "ht" | "htapi";

export interface WayfinderHosts {
  domain: string;
  current: Record<WayfinderKey, string>;
  previous: Record<WayfinderKey, string> | null;
}

interface Parsed extends WayfinderHosts {
  previousExpires: number;
}

interface Slot {
  checkedAt: number;
  sig: string;
  value: Parsed | null;
}
const slots = new Map<string, Slot>();

function parse(text: string): Parsed | null {
  const j = JSON.parse(text) as Record<string, any>;
  const domain = j?.domain;
  if (typeof domain !== "string" || !/^[a-z0-9.-]+$/.test(domain)) return null;
  const pick = (o: any): Record<WayfinderKey, string> | null => {
    if (!o || typeof o !== "object") return null;
    const out = { ht: o.ht, htapi: o.htapi };
    if (
      ![out.ht, out.htapi].every(
        (l) => typeof l === "string" && LABEL_RE.test(l),
      )
    ) {
      return null;
    }
    return out as Record<WayfinderKey, string>;
  };
  const current = pick(j.current);
  if (!current) return null;
  const previous = pick(j.previous?.hosts);
  const expires = Date.parse(j.previous?.expires);
  return {
    domain,
    current,
    previous: previous && !Number.isNaN(expires) ? previous : null,
    previousExpires: previous && !Number.isNaN(expires) ? expires : 0,
  };
}

function load(file: string): Parsed | null {
  const now = Date.now();
  let slot = slots.get(file);
  if (slot && now - slot.checkedAt < CACHE_MS) return slot.value;
  slot ??= { checkedAt: 0, sig: "", value: null };
  slots.set(file, slot);
  slot.checkedAt = now;
  let sig: string;
  try {
    const st = fs.statSync(file);
    // The rename swap changes the inode even if the mtime does not move.
    sig = `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    slot.sig = "";
    slot.value = null; // absent: legacy mode
    return null;
  }
  if (sig === slot.sig) return slot.value;
  slot.sig = sig;
  try {
    slot.value = parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Unreadable or half-written: keep the last good table.
  }
  return slot.value;
}

/** The current and previous hosts, or null when Wayfinder is not running. */
export function wayfinderHosts(): WayfinderHosts | null {
  const p = load(process.env.WAYFINDER_HOSTS_FILE ?? DEFAULT_FILE);
  if (!p) return null;
  const live = p.previous !== null && p.previousExpires > Date.now();
  return {
    domain: p.domain,
    current: p.current,
    previous: live ? p.previous : null,
  };
}

/** Full names for `key`, current first; empty in legacy mode. */
export function ownHosts(key: WayfinderKey): string[] {
  const w = wayfinderHosts();
  if (!w) return [];
  const names = [w.current[key]];
  if (w.previous) names.push(w.previous[key]);
  return names.map((l) => `${l}.${w.domain}`);
}

function bareHost(host: string | undefined): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export function isOwnHost(
  key: WayfinderKey,
  host: string | undefined,
): boolean {
  const h = bareHost(host);
  return h !== "" && ownHosts(key).includes(h);
}

/**
 * The game host and API host of the generation `host` belongs to; the current
 * generation for an unknown or missing host. Null in legacy mode.
 */
export function pairFor(
  host: string | undefined,
): { ht: string; htapi: string } | null {
  const w = wayfinderHosts();
  if (!w) return null;
  const h = bareHost(host);
  const gen =
    [w.current, w.previous].find(
      (g) =>
        g && (`${g.ht}.${w.domain}` === h || `${g.htapi}.${w.domain}` === h),
    ) ?? w.current;
  return { ht: `${gen!.ht}.${w.domain}`, htapi: `${gen!.htapi}.${w.domain}` };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The request's public host: X-Forwarded-Host only when the peer is loopback. */
export function requestHost(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): string | undefined {
  const first = (v: string | string[] | undefined) => {
    const h = (Array.isArray(v) ? v[0] : v)?.split(",")[0].trim();
    return h === "" ? undefined : h;
  };
  if (remoteAddress && LOOPBACK.has(remoteAddress)) {
    const fwd = first(headers["x-forwarded-host"]);
    if (fwd) return fwd;
  }
  return first(headers.host);
}
