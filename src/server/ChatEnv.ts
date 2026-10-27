import { uuidToBase64url } from "@openfront/shared/Base64";
import { logger } from "./Logger";
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

  // One API lookup per join: ban state and chat mute. Fails open (not banned,
  // not muted) on any error, with a warning.
  static async moderation(sub: string): Promise<{
    banned: boolean;
    mute: { until: number; shadow: boolean } | null;
  }> {
    try {
      const res = await fetch(
        `${ServerEnv.jwtIssuer()}/game-server/moderation/${encodeURIComponent(apiSub(sub))}`,
        {
          headers: { "x-api-key": ServerEnv.apiKey() },
          signal: AbortSignal.timeout(1500),
        },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as {
        banned?: boolean;
        mutedUntil?: string | null;
        shadow?: boolean;
      };
      const until = body.mutedUntil ? Date.parse(body.mutedUntil) : NaN;
      const muted = Number.isFinite(until) && until > Date.now();
      return {
        banned: body.banned === true,
        mute: muted ? { until, shadow: body.shadow === true } : null,
      };
    } catch (e) {
      logger.warn("moderation lookup failed, failing open", {
        error: String(e),
      });
      return { banned: false, mute: null };
    }
  }
}
