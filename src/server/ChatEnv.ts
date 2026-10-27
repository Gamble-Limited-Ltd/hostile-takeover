import { uuidToBase64url } from "@openfront/shared/Base64";
import { ServerEnv } from "./ServerEnv";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Token claims carry the account UUID; the API's game-server routes take the
// JWT form of it (base64url).
export const apiSub = (sub: string): string =>
  UUID_RE.test(sub) ? uuidToBase64url(sub) : sub;

// Fork-only chat settings, kept out of ServerEnv.ts to keep upstream merges cheap.
export class ChatEnv {
  // Kill switch: HT_CHAT=off refuses every chat message.
  static enabled(): boolean {
    return process.env.HT_CHAT !== "off";
  }

  // Muted accounts are looked up from the API at join; failing open on any error.
  // Fire-and-forget API-key POST to the API (root chat commands, reports).
  static post(path: string, body: unknown): void {
    try {
      fetch(`${ServerEnv.jwtIssuer()}${path}`, {
        method: "POST",
        headers: {
          "x-api-key": ServerEnv.apiKey(),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(1500),
      }).catch(() => {});
    } catch {
      // fail-safe: the in-game effect never depends on the API
    }
  }

  static async muteFor(
    sub: string,
  ): Promise<{ until: number; shadow: boolean } | null> {
    try {
      const res = await fetch(
        `${ServerEnv.jwtIssuer()}/game-server/moderation/${encodeURIComponent(apiSub(sub))}`,
        {
          headers: { "x-api-key": ServerEnv.apiKey() },
          signal: AbortSignal.timeout(1500),
        },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        mutedUntil?: string | null;
        shadow?: boolean;
      };
      const until = body.mutedUntil ? Date.parse(body.mutedUntil) : NaN;
      if (!Number.isFinite(until) || until <= Date.now()) return null;
      return { until, shadow: body.shadow === true };
    } catch {
      return null;
    }
  }
}
