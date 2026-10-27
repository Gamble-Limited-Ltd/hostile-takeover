import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "AdminTakeover" });

// Fork-only (S5) kill switch: HT_ADMIN_TAKEOVER=off makes the server refuse
// the admin_takeover intent.
export function adminTakeoverEnabled(): boolean {
  return process.env.HT_ADMIN_TAKEOVER !== "off";
}

export interface AdminAuditEntry {
  actor: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

// Fire-and-forget audit row in the API (POST /game-server/audit). Never throws.
export async function postAdminAudit(entry: AdminAuditEntry): Promise<void> {
  try {
    const res = await fetch(`${ServerEnv.jwtIssuer()}/game-server/audit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log.warn(`audit post failed: ${res.status}`);
  } catch (error) {
    log.warn(`audit post failed: ${error}`);
  }
}
