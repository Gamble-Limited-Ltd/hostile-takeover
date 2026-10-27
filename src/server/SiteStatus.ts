import { logger } from "./Logger";
import { startPolling } from "./PollingLoop";
import { ServerEnv } from "./ServerEnv";

export interface SiteStatus {
  banner: string | null;
  maintenance: boolean;
}

export const SITE_STATUS_POLL_MS = 30_000;

// Fork-only (S6). Fails open: the last good value is kept on any error, and
// until the first answer lands maintenance is off.
let current: SiteStatus = { banner: null, maintenance: false };

export const siteStatus = (): SiteStatus => current;

// Maintenance refuses new games from everyone but root.
export const createBlocked = (role: string | undefined): boolean =>
  current.maintenance && role !== "root";

export function resetSiteStatus(): void {
  current = { banner: null, maintenance: false };
}

export async function refreshSiteStatus(): Promise<void> {
  try {
    const res = await fetch(`${ServerEnv.jwtIssuer()}/public/site-status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as Partial<SiteStatus>;
    current = {
      banner: typeof body.banner === "string" ? body.banner : null,
      maintenance: body.maintenance === true,
    };
  } catch (e) {
    logger.debug("site-status poll failed, keeping last value", {
      error: String(e),
    });
  }
}

export function startSiteStatusPolling(): void {
  startPolling(refreshSiteStatus, SITE_STATUS_POLL_MS);
}
