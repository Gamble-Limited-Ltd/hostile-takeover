import { base64urlToUuid } from "@openfront/shared/Base64";
import type { ApiEnv } from "./env";
import type { Store } from "./store";

// Reports which GLL ID (GATE) accounts are in a game or lobby right now, once
// a minute, so HALL can show play time. The game server hands us the signed-in
// player ids with its 10 s cluster check-in (ClusterCheckin.ts); this module
// keeps the latest list per server and posts the GATE subjects over HTTP.

const INTERVAL_MS = 60_000;
const TIMEOUT_MS = 3_000;
const BATCH = 500;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
/** A server that missed ~3 check-ins no longer counts as online. */
const FRESH_MS = 35_000;

export class PresenceTracker {
  /** Last logged problem: the same one repeating every minute is logged once. */
  lastError = "";
  private readonly bySource = new Map<string, { at: number; ids: string[] }>();

  record(source: string, ids: string[], now = Date.now()): void {
    this.bySource.set(source, { at: now, ids });
  }

  /** Unique HT account ids (JWT subjects) from servers heard from recently. */
  online(now = Date.now()): string[] {
    const out = new Set<string>();
    for (const [source, v] of this.bySource) {
      if (now - v.at > FRESH_MS) this.bySource.delete(source);
      else for (const id of v.ids) out.add(id);
    }
    return [...out];
  }
}

export function presenceEnabled(env: ApiEnv, source = process.env): boolean {
  return (
    source.HT_GATE_PRESENCE !== "off" &&
    env.gateIssuer !== "" &&
    env.gateClientId !== "" &&
    env.gateClientSecret !== ""
  );
}

/** One report round. Never throws. */
export async function reportPresence(
  env: ApiEnv,
  store: Pick<Store, "gateSubsForUserIds">,
  tracker: PresenceTracker,
  fetchFn: typeof fetch = fetch,
  log: (msg: string) => void = console.error,
): Promise<void> {
  let problem = "";
  try {
    const uuids: string[] = [];
    for (const id of tracker.online()) {
      try {
        const u = base64urlToUuid(id);
        if (UUID.test(u)) uuids.push(u);
      } catch {
        // not an HT account id; nothing to report
      }
    }
    if (uuids.length === 0) return;
    const subs = [...new Set(await store.gateSubsForUserIds(uuids))];
    const base = env.gateDirectUrl || env.gateIssuer;
    // RFC 6749 2.3.1: id and secret are form-urlencoded before Basic.
    const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
    const auth = `Basic ${Buffer.from(
      `${enc(env.gateClientId)}:${enc(env.gateClientSecret)}`,
    ).toString("base64")}`;
    for (let i = 0; i < subs.length; i += BATCH) {
      const res = await fetchFn(`${base}/oidc/presence`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ subs: subs.slice(i, i + BATCH) }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) problem = `HTTP ${res.status}`;
    }
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  if (problem !== tracker.lastError) {
    if (problem) log(`gate presence: ${problem}`);
    tracker.lastError = problem;
  }
}

/** Starts the 60 s job when enabled; returns the stop function. */
export function startPresence(
  env: ApiEnv,
  store: Store,
  tracker: PresenceTracker,
): () => void {
  if (!presenceEnabled(env)) return () => {};
  const t = setInterval(
    () => void reportPresence(env, store, tracker),
    INTERVAL_MS,
  );
  t.unref();
  return () => clearInterval(t);
}
