import { ServerEnv } from "./ServerEnv";

// Fork-only chat settings, kept out of ServerEnv.ts to keep upstream merges cheap.
export class ChatEnv {
  // Kill switch: HT_CHAT=off refuses every chat message.
  static enabled(): boolean {
    return process.env.HT_CHAT !== "off";
  }

  // Muted accounts are looked up from the API at join; failing open on any error.
  static async muteFor(
    sub: string,
  ): Promise<{ until: number; shadow: boolean } | null> {
    try {
      const res = await fetch(
        `${ServerEnv.jwtIssuer()}/game-server/moderation/${encodeURIComponent(sub)}`,
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
