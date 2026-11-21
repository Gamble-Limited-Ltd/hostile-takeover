// Hostile Takeover: the host table written by Wayfinder (the rotation daemon).
// Server-only: it reads a file, so never import it from client code.
//
// Dual mode: when the runtime file does not exist every function answers "not
// Wayfinder" (null / [] / false) and callers keep their env-based behaviour.
import crypto from "crypto";
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
  value: any;
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

function load<T = Parsed>(
  file: string,
  parser: (text: string) => T | null = parse as any,
): T | null {
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
    slot.value = parser(fs.readFileSync(file, "utf8"));
  } catch {
    // Unreadable or half-written: keep the last good table.
  }
  return slot.value;
}

// --- Wayfinder v2 (personal routes). Off unless WAYFINDER_ROUTES_FILE is set
// and readable; then it wins over the v1 host table. ---

export interface RoutesV2 {
  domain: string;
  /** gate sub -> app -> in-use label */
  players: Record<string, Partial<Record<WayfinderKey, string>>>;
  /** app -> every label accepted now (live, spare and grace; all players) */
  accepted: Record<WayfinderKey, string[]>;
}

const KEYS: WayfinderKey[] = ["ht", "htapi"];

function parseV2(text: string): RoutesV2 | null {
  const j = JSON.parse(text) as Record<string, any>;
  if (!j || typeof j.players !== "object" || j.players === null) return null;
  const domain =
    process.env.WAYFINDER_DOMAIN ?? j.domain ?? "taps-holdings.org";
  if (typeof domain !== "string" || !/^[a-z0-9.-]+$/.test(domain)) return null;
  const players: RoutesV2["players"] = {};
  const seen: Record<WayfinderKey, Set<string>> = {
    ht: new Set(),
    htapi: new Set(),
  };
  for (const [sub, apps] of Object.entries<any>(j.players)) {
    const row: Partial<Record<WayfinderKey, string>> = {};
    for (const k of KEYS) {
      const l = apps?.[k];
      if (typeof l === "string" && LABEL_RE.test(l)) {
        row[k] = l;
        seen[k].add(l);
      }
    }
    players[sub] = row;
  }
  const accepted = {} as RoutesV2["accepted"];
  for (const k of KEYS) {
    // Until the table lists `accepted`, the in-use labels are all we know.
    const list = Array.isArray(j.accepted?.[k]) ? j.accepted[k] : [...seen[k]];
    accepted[k] = list.filter(
      (l: unknown): l is string => typeof l === "string" && LABEL_RE.test(l),
    );
  }
  return { domain, players, accepted };
}

/** The v2 route table, or null when the flag is off or the file is absent. */
export function routesV2(): RoutesV2 | null {
  const file = process.env.WAYFINDER_ROUTES_FILE;
  return file ? load<RoutesV2>(file, parseV2) : null;
}

/** Either Wayfinder mode is on (v2 table or v1 host table). */
export function wayfinderOn(): boolean {
  return routesV2() !== null || wayfinderHosts() !== null;
}

/** Full name of the in-use route of `sub` for `app`; null in v1 or legacy mode. */
export function routeFor(sub: string, app: WayfinderKey): string | null {
  const r = routesV2();
  const l = r?.players[sub]?.[app];
  return r && l ? `${l}.${r.domain}` : null;
}

/**
 * One trust check for every edge header (x-wayfinder-*, x-forwarded-host): a
 * loopback peer and, when WAYFINDER_EDGE_SECRET_FILE or WAYFINDER_EDGE_SECRET
 * is set, a matching x-wayfinder-edge (timing-safe). Unset keeps the
 * loopback-only rule; set but unreadable or short fails closed.
 */
function edgeTrusted(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): boolean {
  if (!remoteAddress || !LOOPBACK.has(remoteAddress)) return false;
  const file = process.env.WAYFINDER_EDGE_SECRET_FILE;
  let want = process.env.WAYFINDER_EDGE_SECRET ?? "";
  if (!file && !want) return true;
  if (file) {
    try {
      want = fs.readFileSync(file, "utf8").trim();
    } catch {
      return false;
    }
  }
  const v = headers["x-wayfinder-edge"];
  const got = Buffer.from((Array.isArray(v) ? v[0] : v) ?? "");
  const exp = Buffer.from(want);
  return (
    exp.length >= 32 &&
    got.length === exp.length &&
    crypto.timingSafeEqual(got, exp)
  );
}

/** The trusted edge player header: only from a trusted edge, like requestHost. */
export function requestPlayer(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): string | undefined {
  if (!edgeTrusted(headers, remoteAddress)) return undefined;
  const v = headers["x-wayfinder-player"];
  const p = (Array.isArray(v) ? v[0] : v)?.trim();
  if (!p) return undefined;
  return p;
}

/** The trusted edge route label this request arrived on, if any. */
export function requestLabel(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
): string | undefined {
  if (!edgeTrusted(headers, remoteAddress)) return undefined;
  const v = headers["x-wayfinder-label"];
  const l = (Array.isArray(v) ? v[0] : v)?.trim();
  return l && LABEL_RE.test(l) ? l : undefined;
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
  const r = routesV2();
  if (r) return r.accepted[key].map((l) => `${l}.${r.domain}`);
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
  player?: string,
): { ht: string; htapi: string } | null {
  const r = routesV2();
  if (r) {
    // v2: the player's own routes. Owner is the trusted edge player, else
    // whoever has this label in use (spare and grace labels need the header).
    const label = bareHost(host).split(".")[0];
    const sub =
      player ??
      Object.keys(r.players).find(
        (s) => r.players[s].ht === label || r.players[s].htapi === label,
      );
    const row = sub ? r.players[sub] : undefined;
    return row?.ht && row.htapi
      ? { ht: `${row.ht}.${r.domain}`, htapi: `${row.htapi}.${r.domain}` }
      : null;
  }
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
  if (edgeTrusted(headers, remoteAddress)) {
    const fwd = first(headers["x-forwarded-host"]);
    if (fwd) return fwd;
  }
  return first(headers.host);
}
